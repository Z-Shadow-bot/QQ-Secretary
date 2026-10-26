import * as fs from 'fs'
import * as path from 'path'
import { MSG_DIR, REPORT_DIR, FILE_DIR, DATA_DIR, log } from './config'
import { GroupMessageEvent, segmentsToText } from './onebot'

export interface FileRecord {
  fileName: string
  url: string
  localPath: string
  fileType: string
  downloaded: boolean
}

export interface MessageRecord {
  id: number
  groupId: number
  userId: number
  senderName: string
  plainText: string
  rawMessage: string
  hasFile: boolean
  hasImage: boolean
  timestamp: number
  files: FileRecord[]
}

export interface DailyReport {
  date: string
  content: string
  messageCount: number
  createdAt: number
  items: ReportItem[]
}

export interface ReportFile {
  fileName: string
  localPath: string
  downloaded: boolean
}

export interface ReportItem {
  title: string
  deadline: string
  originalText: string
  groupId: number
  sender: string
  time: string
  hasFile: boolean
  messageIds: number[]
  files: ReportFile[]
}

function dateStr(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function msgFilePath(date: string): string {
  return path.join(MSG_DIR, `${date}.json`)
}

function reportFilePath(date: string): string {
  return path.join(REPORT_DIR, `${date}.json`)
}

export function saveMessage(event: GroupMessageEvent): MessageRecord {
  const date = dateStr(event.time * 1000)
  const filePath = msgFilePath(date)
  let messages: MessageRecord[] = []
  try {
    if (fs.existsSync(filePath)) {
      messages = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (e) {
    log('Storage', `Failed to read messages: ${e}`, 'E')
  }

  const files: FileRecord[] = event.segments
    .filter(s => s.type === 'file' || s.type === 'image' || s.type === 'video' || s.type === 'record')
    .map(s => ({
      fileName: s.data.name || s.data.file || '',
      url: s.data.url || '',
      localPath: '',
      fileType: s.type,
      downloaded: false,
    }))

  const record: MessageRecord = {
    id: messages.length + 1,
    groupId: event.groupId,
    userId: event.userId,
    senderName: event.senderCard || event.senderNickname,
    plainText: segmentsToText(event.segments),
    rawMessage: event.rawMessage,
    hasFile: files.some(f => f.fileType === 'file'),
    hasImage: files.some(f => f.fileType === 'image'),
    timestamp: event.time,
    files,
  }

  messages.push(record)
  try {
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8')
  } catch (e) {
    log('Storage', `Failed to save message: ${e}`, 'E')
  }
  return record
}

export function getMessages(date: string): MessageRecord[] {
  const filePath = msgFilePath(date)
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (e) {
    log('Storage', `Failed to read messages: ${e}`, 'E')
  }
  return []
}

export function getTodayMessages(): MessageRecord[] {
  return getMessages(dateStr())
}

export function getMessageFiles(date: string, messageId: number): FileRecord[] {
  const messages = getMessages(date)
  const msg = messages.find(m => m.id === messageId)
  return msg ? msg.files : []
}

export function getMessageById(date: string, messageId: number): MessageRecord | null {
  const messages = getMessages(date)
  return messages.find(m => m.id === messageId) || null
}

export function updateFileDownloaded(date: string, msgId: number, fileIndex: number, localPath: string): void {
  const messages = getMessages(date)
  if (msgId > 0 && msgId <= messages.length) {
    const msg = messages[msgId - 1]
    if (fileIndex >= 0 && fileIndex < msg.files.length) {
      msg.files[fileIndex].localPath = localPath
      msg.files[fileIndex].downloaded = true
      fs.writeFileSync(msgFilePath(date), JSON.stringify(messages, null, 2), 'utf-8')
    }
  }
}

export function saveReport(report: DailyReport): void {
  const filePath = reportFilePath(report.date)
  try {
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8')
    log('Storage', `Report saved: ${report.date}`)
  } catch (e) {
    log('Storage', `Failed to save report: ${e}`, 'E')
  }
}

export function getReport(date: string): DailyReport | null {
  try {
    const filePath = reportFilePath(date)
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (e) {
    log('Storage', `Failed to read report: ${e}`, 'E')
  }
  return null
}

export function deleteReport(date: string): boolean {
  try {
    const filePath = reportFilePath(date)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      log('Storage', `Report deleted: ${date}`)
      return true
    }
  } catch (e) {
    log('Storage', `Failed to delete report: ${e}`, 'E')
  }
  return false
}

export function getRecentReports(limit: number = 30): DailyReport[] {
  const reports: DailyReport[] = []
  try {
    const files = fs.readdirSync(REPORT_DIR).filter(f => f.endsWith('.json')).sort().reverse()
    for (const f of files.slice(0, limit)) {
      try {
        reports.push(JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf-8')))
      } catch {}
    }
  } catch (e) {
    log('Storage', `Failed to list reports: ${e}`, 'E')
  }
  return reports
}

export function hasReportForToday(): boolean {
  return fs.existsSync(reportFilePath(dateStr()))
}

export function getFilePath(groupId: number, date: string): string {
  const dir = path.join(FILE_DIR, `group_${groupId}`, date)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}
export interface TodoItem {
  id: string
  title: string
  deadline: string
  originalText: string
  groupId: number
  sender: string
  time: string
  hasFile: boolean
  messageIds: number[]
  files: ReportFile[]
  sourceDate: string
  addedAt: number
}

const TODO_PATH = path.join(DATA_DIR, 'todos.json')

export function getTodos(): TodoItem[] {
  try {
    if (fs.existsSync(TODO_PATH)) {
      return JSON.parse(fs.readFileSync(TODO_PATH, 'utf-8'))
    }
  } catch (e) {
    log('Storage', `Failed to read todos: ${e}`, 'E')
  }
  return []
}

function saveTodos(todos: TodoItem[]): void {
  try {
    fs.writeFileSync(TODO_PATH, JSON.stringify(todos, null, 2), 'utf-8')
  } catch (e) {
    log('Storage', `Failed to save todos: ${e}`, 'E')
  }
}

export function addTodo(todo: TodoItem): TodoItem[] {
  const todos = getTodos()
  if (!todos.some(t => t.id === todo.id)) {
    todos.push(todo)
    saveTodos(todos)
  }
  return todos
}

export function removeTodo(id: string): TodoItem[] {
  const todos = getTodos().filter(t => t.id !== id)
  saveTodos(todos)
  return todos
}

export function updateTodoDeadline(id: string, deadline: string): TodoItem[] {
  const todos = getTodos()
  const t = todos.find(x => x.id === id)
  if (t) {
    t.deadline = deadline
    saveTodos(todos)
  }
  return todos
}

export function sortTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const aHas = !!a.deadline
    const bHas = !!b.deadline
    if (aHas && bHas) return a.deadline.localeCompare(b.deadline)
    if (aHas) return -1
    if (bHas) return 1
    return 0
  })
}
const GROUP_NAMES_PATH = path.join(DATA_DIR, 'group_names.json')

export function getGroupNames(): Record<string, string> {
  try {
    if (fs.existsSync(GROUP_NAMES_PATH)) {
      return JSON.parse(fs.readFileSync(GROUP_NAMES_PATH, 'utf-8'))
    }
  } catch (e) {
    log('Storage', `Failed to read group names: ${e}`, 'E')
  }
  return {}
}

export function setGroupName(groupId: number, name: string): void {
  if (!name) return
  const names = getGroupNames()
  if (names[String(groupId)] === name) return
  names[String(groupId)] = name
  try {
    fs.writeFileSync(GROUP_NAMES_PATH, JSON.stringify(names, null, 2), 'utf-8')
  } catch (e) {
    log('Storage', `Failed to save group names: ${e}`, 'E')
  }
}

export function cleanupOldData(keepDays: number): { messages: number; reports: number; files: number } {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - keepDays)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`

  let messages = 0, reports = 0, files = 0

  try {
    for (const f of fs.readdirSync(MSG_DIR).filter(f => f.endsWith('.json'))) {
      const date = f.replace('.json', '')
      if (date < cutoffStr) { fs.unlinkSync(path.join(MSG_DIR, f)); messages++ }
    }
  } catch (e) { log('Storage', `Cleanup messages failed: ${e}`, 'E') }

  try {
    for (const f of fs.readdirSync(REPORT_DIR).filter(f => f.endsWith('.json'))) {
      const date = f.replace('.json', '')
      if (date < cutoffStr) { fs.unlinkSync(path.join(REPORT_DIR, f)); reports++ }
    }
  } catch (e) { log('Storage', `Cleanup reports failed: ${e}`, 'E') }

  try {
    if (fs.existsSync(FILE_DIR)) {
      for (const groupDir of fs.readdirSync(FILE_DIR)) {
        const groupPath = path.join(FILE_DIR, groupDir)
        if (!fs.statSync(groupPath).isDirectory()) continue
        for (const dateDir of fs.readdirSync(groupPath)) {
          if (dateDir < cutoffStr) {
            fs.rmSync(path.join(groupPath, dateDir), { recursive: true, force: true })
            files++
          }
        }
      }
    }
  } catch (e) { log('Storage', `Cleanup files failed: ${e}`, 'E') }

  log('Storage', `Cleanup(keepDays=${keepDays}) done: ${messages} msgs, ${reports} reports, ${files} file-dirs`)
  return { messages, reports, files }
}