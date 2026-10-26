import { contextBridge, ipcRenderer } from 'electron'

const listeners: Record<string, Array<(...args: any[]) => void>> = {}
const registered: Record<string, boolean> = {}

function on(channel: string, cb: (...args: any[]) => void) {
  if (!registered[channel]) {
    registered[channel] = true
    ipcRenderer.on(channel, (_, ...args) => {
      (listeners[channel] || []).forEach(f => f(...args))
    })
  }
  if (!listeners[channel]) listeners[channel] = []
  listeners[channel].push(cb)
}

function off(channel: string, cb: (...args: any[]) => void) {
  if (listeners[channel]) {
    listeners[channel] = listeners[channel].filter(f => f !== cb)
  }
}

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg: any) => ipcRenderer.invoke('save-config', cfg),
  testLlm: (llm: any) => ipcRenderer.invoke('test-llm', llm),
  getStatus: () => ipcRenderer.invoke('get-status'),
  startCollector: () => ipcRenderer.invoke('start-collector'),
  stopCollector: () => ipcRenderer.invoke('stop-collector'),
  generateReport: () => ipcRenderer.invoke('generate-report'),
  getReports: () => ipcRenderer.invoke('get-reports'),
  getReport: (date: string) => ipcRenderer.invoke('get-report', date),
  deleteReport: (date: string) => ipcRenderer.invoke('delete-report', date),
  getTodayMessages: () => ipcRenderer.invoke('get-today-messages'),
  getMessageFiles: (date: string, messageId: number) => ipcRenderer.invoke('get-message-files', date, messageId),
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  revealFile: (filePath: string) => ipcRenderer.invoke('reveal-file', filePath),
  getTodos: () => ipcRenderer.invoke('get-todos'),
  addTodo: (todo: any) => ipcRenderer.invoke('add-todo', todo),
  removeTodo: (id: string) => ipcRenderer.invoke('remove-todo', id),
  updateTodoDeadline: (id: string, deadline: string) => ipcRenderer.invoke('update-todo-deadline', id, deadline),
  getGroupNames: () => ipcRenderer.invoke('get-group-names'),
  cleanupNow: () => ipcRenderer.invoke('cleanup-now'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  exportReport: (date: string, content: string) => ipcRenderer.invoke('export-report', date, content),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),
  onStatus: (cb: (status: string) => void) => on('status', cb),
  offStatus: (cb: (status: string) => void) => off('status', cb),
  onReportReady: (cb: (content: string) => void) => on('report-ready', cb),
  offReportReady: (cb: (content: string) => void) => off('report-ready', cb),
  onQrCode: (cb: (dataUrl: string) => void) => on('qrcode', cb),
  offQrCode: (cb: (dataUrl: string) => void) => off('qrcode', cb),
  onMessageSaved: (cb: (record: any) => void) => on('message-saved', cb),
  offMessageSaved: (cb: (record: any) => void) => off('message-saved', cb),
  onTodayDeadlineAlert: (cb: (msg: string) => void) => on('today-deadline-alert', cb),
  offTodayDeadlineAlert: (cb: (msg: string) => void) => off('today-deadline-alert', cb),
  onGroupNames: (cb: (map: any) => void) => on('group-names', cb),
  offGroupNames: (cb: (map: any) => void) => off('group-names', cb),
  onTodoReminder: (cb: (items: any) => void) => on('todo-reminder', cb),
  offTodoReminder: (cb: (items: any) => void) => off('todo-reminder', cb),
  onReportProgress: (cb: (p: any) => void) => on('report-progress', cb),
  offReportProgress: (cb: (p: any) => void) => off('report-progress', cb),
})