import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.join(app.getPath('userData'), 'secretary')
const LOG_DIR = path.join(DATA_DIR, 'logs')
const MSG_DIR = path.join(DATA_DIR, 'messages')
const REPORT_DIR = path.join(DATA_DIR, 'reports')
const FILE_DIR = path.join(DATA_DIR, 'files')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

for (const dir of [DATA_DIR, LOG_DIR, MSG_DIR, REPORT_DIR, FILE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export interface OneBotConfig {
  wsUrl: string
  accessToken: string
}

export interface LlmConfig {
  apiUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  timeoutMs: number
}

export interface ReportConfig {
  userRole: string
  targetGroups: number[]
  dailyHour: number
  dailyMinute: number
  customRequirements: string
  batchSize: number
}

export interface LlmProfile {
  name: string
  apiUrl: string
  apiKey: string
  model: string
}

export interface CleanupConfig {
  enabled: boolean
  keepDays: number
}

export interface ReminderConfig {
  enabled: boolean
  daysAhead: number
}

export interface AppConfig {
  oneBot: OneBotConfig
  llm: LlmConfig
  llmProfiles: LlmProfile[]
  report: ReportConfig
  napcatPath: string
  cleanup: CleanupConfig
  reminder: ReminderConfig
  autoLaunch: boolean
}

const defaultConfig: AppConfig = {
  oneBot: { wsUrl: 'ws://127.0.0.1:3001', accessToken: '' },
  llm: {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '', model: 'deepseek-chat', systemPrompt: '', timeoutMs: 60000,
  },
  llmProfiles: [],
  report: {
    userRole: '', targetGroups: [], dailyHour: 22, dailyMinute: 0,
    customRequirements: '', batchSize: 50,
  },
  napcatPath: '',
  cleanup: { enabled: false, keepDays: 30 },
  reminder: { enabled: true, daysAhead: 1 },
  autoLaunch: false,
}

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      const saved = JSON.parse(raw)
      return {
        oneBot: { ...defaultConfig.oneBot, ...saved.oneBot },
        llm: { ...defaultConfig.llm, ...saved.llm },
        llmProfiles: Array.isArray(saved.llmProfiles) ? saved.llmProfiles : [],
        report: { ...defaultConfig.report, ...saved.report },
        napcatPath: saved.napcatPath || '',
        cleanup: { ...defaultConfig.cleanup, ...saved.cleanup },
        reminder: { ...defaultConfig.reminder, ...saved.reminder },
        autoLaunch: !!saved.autoLaunch,
      }
    }
  } catch (e) {
    log('Config', `Load failed: ${e}`, 'E')
  }
  return JSON.parse(JSON.stringify(defaultConfig))
}

export function saveConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    log('Config', `Save failed: ${e}`, 'E')
  }
}

export function log(tag: string, msg: string, level: string = 'I'): void {
  const now = new Date()
  const ts = now.toISOString()
  const line = `${ts} ${level}/${tag}: ${msg}\n`
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const logFile = path.join(LOG_DIR, `secretary_${date}.log`)
  try { fs.appendFileSync(logFile, line) } catch {}
}

export { DATA_DIR, LOG_DIR, MSG_DIR, REPORT_DIR, FILE_DIR }