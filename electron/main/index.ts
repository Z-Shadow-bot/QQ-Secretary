import { app, BrowserWindow, ipcMain, shell, Notification, clipboard, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import { loadConfig, saveConfig, log, AppConfig, LlmConfig } from './config'
import { OneBotClient, GroupMessageEvent } from './onebot'
import { saveMessage, getTodayMessages, getRecentReports, getReport, deleteReport, hasReportForToday, updateFileDownloaded, getFilePath, getMessageFiles, getTodos, addTodo, removeTodo, updateTodoDeadline, getGroupNames, setGroupName, cleanupOldData, TodoItem, MessageRecord } from './storage'
import { generateReport, matchTodayDeadlineKeywords } from './report'
import { chat } from './llm'

let mainWindow: BrowserWindow
let oneBotClient: OneBotClient | null = null
let config: AppConfig
let schedulerTimer: NodeJS.Timeout | null = null
let qrcodeWatcher: NodeJS.Timeout | null = null
let lastQrcodeMtime = 0
let lastReportCheckMinute = -1
let currentStatus = 'disconnected'
let instantReportRunning = false
let lastInstantReportTime = 0

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900, height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function sendToRenderer(channel: string, ...args: any[]): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()
        && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  } catch {}
}

function startCollector(): void {
  config = loadConfig()
  if (oneBotClient) oneBotClient.disconnect()
  lastReportCheckMinute = -1
  oneBotClient = new OneBotClient(config.oneBot.wsUrl, config.oneBot.accessToken)
  oneBotClient.onGroupMessage = (event) => {
    const record = saveMessage(event)
    log('Main', `Saved msg from group=${event.groupId} user=${event.userId}`)
    sendToRenderer('message-saved', record)
    downloadFiles(event, record)
    checkTodayDeadline(record)
    fetchGroupNameIfNeeded(event.groupId)
  }
  oneBotClient.onStatusChange = (status) => {
    currentStatus = status
    sendToRenderer('status', status)
    if (status === 'connected') {
      stopQrCodeWatcher()
    } else if (status === 'disconnected') {
      startQrCodeWatcher()
    }
  }
  oneBotClient.connect()
  startScheduler()
}

function stopCollector(): void {
  oneBotClient?.disconnect()
  oneBotClient = null
  currentStatus = 'disconnected'
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null }
  stopQrCodeWatcher()
}

function checkTodayDeadline(record: MessageRecord): void {
  const keyword = matchTodayDeadlineKeywords(record.plainText)
  if (!keyword) return
  log('Main', `Today deadline detected (keyword="${keyword}"), triggering instant report`)
  triggerInstantReport(keyword)
}

async function triggerInstantReport(keyword: string): Promise<void> {
  const now = Date.now()
  if (instantReportRunning) return
  if (now - lastInstantReportTime < 30000) return
  instantReportRunning = true
  lastInstantReportTime = now
  try {
    sendToRenderer('today-deadline-alert', `检测到当天截止的通知（"${keyword}"），正在生成日报…`)
    const content = await generateReport(config.llm, config.report, sendReportProgress)
    if (content) {
      sendToRenderer('report-ready', content)
      sendToRenderer('today-deadline-alert', '当天截止通知已整理完成')
      new Notification({ title: '当天截止通知', body: '检测到当天截止的通知，日报已更新' }).show()
    }
  } catch (e: any) {
    log('Main', `Instant report failed: ${e.message}`, 'E')
    sendToRenderer('today-deadline-alert', `日报生成失败: ${e.message}`)
  } finally {
    instantReportRunning = false
    sendToRenderer('report-progress', { done: true })
  }
}

function sendReportProgress(current: number, total: number, phase: string): void {
  sendToRenderer('report-progress', { current, total, phase, done: false })
}

function formatDateLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  const f = new Date(from + 'T00:00:00').getTime()
  const t = new Date(to + 'T00:00:00').getTime()
  return Math.round((t - f) / 86400000)
}

const groupNameFetching = new Set<number>()

async function fetchGroupNameIfNeeded(groupId: number): Promise<void> {
  if (getGroupNames()[String(groupId)]) return
  if (groupNameFetching.has(groupId)) return
  if (!oneBotClient) return
  groupNameFetching.add(groupId)
  try {
    const info = await oneBotClient.getGroupInfo(groupId)
    if (info && info.groupName) {
      setGroupName(groupId, info.groupName)
      log('Main', `Group name cached: ${groupId} = ${info.groupName}`)
      sendToRenderer('group-names', getGroupNames())
    }
  } catch (e: any) {
    log('Main', `fetchGroupName failed: ${e.message}`, 'W')
  } finally {
    groupNameFetching.delete(groupId)
  }
}

let lastReminderDate = ''
let lastCleanupDate = ''
const maintenanceTimers: NodeJS.Timeout[] = []

function startMaintenance(): void {
  maintenanceTimers.push(setInterval(checkTodoReminders, 10 * 60 * 1000))
  maintenanceTimers.push(setInterval(maybeCleanup, 60 * 60 * 1000))
  maintenanceTimers.push(setTimeout(() => { checkTodoReminders(); maybeCleanup() }, 15000))
}

function stopMaintenance(): void {
  maintenanceTimers.forEach(t => clearInterval(t))
  maintenanceTimers.length = 0
}

function checkTodoReminders(): void {
  if (!config.reminder.enabled) return
  const today = formatDateLocal()
  if (lastReminderDate === today) return
  const daysAhead = config.reminder.daysAhead ?? 1
  const todos = getTodos()
  const due = todos.filter(t => {
    if (!t.deadline) return false
    return daysBetween(today, t.deadline) <= daysAhead
  })
  if (due.length === 0) return
  lastReminderDate = today
  const body = due.map(t => `· ${t.title}${t.deadline ? ` (截止 ${t.deadline})` : ''}`).join('\n')
  log('Main', `Todo reminder: ${due.length} items due`)
  try {
    new Notification({ title: `待办提醒（${due.length} 条）`, body: body.slice(0, 200) }).show()
  } catch {}
  sendToRenderer('todo-reminder', due.map(t => ({ title: t.title, deadline: t.deadline, id: t.id })))
}

function maybeCleanup(): void {
  if (!config.cleanup.enabled) return
  const today = formatDateLocal()
  if (lastCleanupDate === today) return
  lastCleanupDate = today
  const result = cleanupOldData(config.cleanup.keepDays || 30)
  log('Main', `Auto cleanup: ${JSON.stringify(result)}`)
}

function getNapCatPath(): string {
  if (config.napcatPath) return config.napcatPath
  const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
  const beside = path.join(baseDir, 'NapCat.Shell')
  if (fs.existsSync(beside)) return beside
  const besideUnpacked = path.join(baseDir, '..', 'NapCat.Shell')
  if (fs.existsSync(besideUnpacked)) return besideUnpacked
  return path.resolve(__dirname, '../../../NapCat.Shell')
}

function startQrCodeWatcher(): void {
  if (qrcodeWatcher) return
  const qrcodePath = path.join(getNapCatPath(), 'cache', 'qrcode.png')
  log('Main', `Watching QR code: ${qrcodePath}`)
  qrcodeWatcher = setInterval(() => {
    try {
      if (fs.existsSync(qrcodePath)) {
        const stat = fs.statSync(qrcodePath)
        if (stat.mtimeMs !== lastQrcodeMtime && stat.size > 0) {
          lastQrcodeMtime = stat.mtimeMs
          const imageData = fs.readFileSync(qrcodePath)
          const base64 = `data:image/png;base64,${imageData.toString('base64')}`
          sendToRenderer('qrcode', base64)
          log('Main', `QR code sent (${stat.size} bytes)`)
        }
      }
    } catch {}
  }, 2000)
}

function stopQrCodeWatcher(): void {
  if (qrcodeWatcher) { clearInterval(qrcodeWatcher); qrcodeWatcher = null }
}

function startScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = setInterval(async () => {
    const now = new Date()
    const currentMinute = now.getHours() * 60 + now.getMinutes()
    if (currentMinute === lastReportCheckMinute) return
    const targetMinute = config.report.dailyHour * 60 + config.report.dailyMinute
    if (currentMinute >= targetMinute && currentMinute < targetMinute + 5) {
      if (!hasReportForToday() && getTodayMessages().length > 0) {
        log('Scheduler', `Auto generating report`)
        const content = await generateReport(config.llm, config.report, sendReportProgress)
        sendToRenderer('report-progress', { done: true })
        if (content) {
          sendToRenderer('report-ready', content)
          new Notification({ title: '日报已生成', body: '今日群消息日报已就绪' }).show()
        }
      }
      lastReportCheckMinute = currentMinute
    }
  }, 60000)
}

function downloadFiles(event: GroupMessageEvent, record: MessageRecord): void {
  const d = new Date(event.time * 1000)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  let fileIdx = 0
  for (const seg of event.segments) {
    if (!['file', 'image', 'video', 'record'].includes(seg.type) || !seg.data.url) continue
    const currentFileIdx = fileIdx++
    const destDir = getFilePath(event.groupId, date)
    const fileName = seg.data.name || seg.data.file || `file_${Date.now()}`
    const destPath = path.join(destDir, fileName)
    downloadFile(seg.data.url, destPath).then(() => {
      updateFileDownloaded(date, record.id, currentFileIdx, destPath)
      log('Download', `Saved: ${fileName}`)
    }).catch(e => log('Download', `Failed: ${e}`, 'E'))
  }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, (resp) => {
      if (resp.statusCode !== 200) { reject(new Error(`HTTP ${resp.statusCode}`)); return }
      const file = fs.createWriteStream(destPath)
      resp.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(new Error('download timeout')); reject(new Error('download timeout')) })
  })
}

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, cfg: AppConfig) => { saveConfig(cfg); config = cfg })
ipcMain.handle('get-status', () => currentStatus)
ipcMain.handle('start-collector', () => startCollector())
ipcMain.handle('stop-collector', () => stopCollector())
ipcMain.handle('generate-report', async () => {
  try {
    const content = await generateReport(config.llm, config.report, sendReportProgress)
    return content
  } finally {
    sendToRenderer('report-progress', { done: true })
  }
})
ipcMain.handle('get-reports', () => getRecentReports())
ipcMain.handle('get-report', (_, date: string) => getReport(date))
ipcMain.handle('delete-report', (_, date: string) => deleteReport(date))
ipcMain.handle('get-today-messages', () => getTodayMessages())
ipcMain.handle('get-message-files', (_, date: string, messageId: number) => getMessageFiles(date, messageId))
ipcMain.handle('open-file', (_, filePath: string) => shell.openPath(filePath))
ipcMain.handle('reveal-file', (_, filePath: string) => shell.showItemInFolder(filePath))
ipcMain.handle('get-group-names', () => getGroupNames())
ipcMain.handle('get-todos', () => getTodos())
ipcMain.handle('add-todo', (_, todo: TodoItem) => addTodo(todo))
ipcMain.handle('remove-todo', (_, id: string) => removeTodo(id))
ipcMain.handle('update-todo-deadline', (_, id: string, deadline: string) => updateTodoDeadline(id, deadline))
ipcMain.handle('cleanup-now', () => {
  const result = cleanupOldData(config.cleanup.keepDays || 30)
  return result
})
ipcMain.handle('copy-text', (_, text: string) => { clipboard.writeText(text || ''); return true })
ipcMain.handle('export-report', async (_, date: string, content: string) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出日报',
      defaultPath: `群消息日报_${date}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本', extensions: ['txt'] }],
    })
    if (canceled || !filePath) return { ok: false }
    fs.writeFileSync(filePath, content || '', 'utf-8')
    log('Main', `Report exported: ${filePath}`)
    return { ok: true, path: filePath }
  } catch (e: any) {
    log('Main', `Export failed: ${e.message}`, 'E')
    return { ok: false, message: e.message }
  }
})
ipcMain.handle('get-auto-launch', () => {
  try { return app.getLoginItemSettings().openAtLogin } catch { return false }
})
ipcMain.handle('set-auto-launch', (_, enabled: boolean) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath })
    config.autoLaunch = !!enabled
    saveConfig(config)
    log('Main', `Auto launch set: ${enabled}`)
    return !!enabled
  } catch (e: any) {
    log('Main', `set auto launch failed: ${e.message}`, 'E')
    return false
  }
})
ipcMain.handle('test-llm', async (_, llm: LlmConfig) => {
  log('Main', `Testing LLM: ${llm.apiUrl} model=${llm.model}`)
  const testConfig: LlmConfig = { ...llm, timeoutMs: Math.min(llm.timeoutMs || 60000, 30000) }
  try {
    const resp = await chat(testConfig, [
      { role: 'user', content: '请只回复"连接成功"四个字' }
    ], '你是一个测试助手，请简短回复。', 0.1)
    if (resp && resp.trim()) {
      log('Main', `LLM test OK: ${resp.trim().slice(0, 60)}`)
      return { ok: true, message: resp.trim().slice(0, 100) }
    }
    return { ok: false, message: 'API 返回空内容，请检查模型是否支持 chat 接口' }
  } catch (e: any) {
    const friendly = classifyLlmError(e)
    log('Main', `LLM test failed: ${e?.message}`, 'E')
    return { ok: false, message: friendly }
  }
})

function classifyLlmError(err: any): string {
  const msg = err?.message || String(err)
  if (msg.includes('404')) return 'API 地址不正确（404）。请填写完整的 chat completions 端点，如 https://integrate.api.nvidia.com/v1（会自动补全 /chat/completions）'
  if (msg.includes('401') || msg.includes('403')) return 'API Key 无效或无权限（401/403），请检查 Key 是否正确'
  if (msg.includes('429')) return '请求过于频繁（429），请稍后重试或检查额度'
  if (msg.includes('400')) return '请求参数错误（400），请检查模型名称是否正确'
  if (msg.includes('abort') || msg.includes('timeout')) return '请求超时，请检查网络或增大超时时间'
  if (msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) return '网络连接失败，请检查网络和 API 地址'
  return msg
}

app.whenReady().then(() => {
  config = loadConfig()
  createWindow()
  startCollector()
  startQrCodeWatcher()
  startMaintenance()
  try {
    app.setLoginItemSettings({ openAtLogin: !!config.autoLaunch, path: process.execPath })
  } catch {}
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopMaintenance()
  stopCollector()
  if (process.platform !== 'darwin') app.quit()
})