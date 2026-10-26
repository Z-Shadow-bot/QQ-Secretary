import { LlmConfig, ReportConfig, log } from './config'
import { MessageRecord, DailyReport, ReportItem, getTodayMessages, saveReport } from './storage'
import { chatWithRetry } from './llm'

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildExtractSystemPrompt(): string {
  return [
    '你是一个群通知整理助手。请把群消息整理成一条条通知。',
    '',
    '重要 - 合并规则：',
    '如果多条消息属于同一条通知（例如同一人短时间内连续发送的一段文字和多个文件、或几段互为补充的说明），请将它们合并为一个条目，并在 indices 中列出所有相关消息的序号。',
    '只把明显独立的通知拆成不同条目。',
    '',
    '输出必须是合法的JSON数组，不要包含任何其他文字。每个元素包含：',
    '- indices: 该条目包含的消息序号数组，如 [1,2,3]',
    '- title: 通知核心内容（不超过20字，作为条目标题）',
    '- deadline: 截止日期（格式YYYY-MM-DD，无截止日期则为空字符串""）',
    '截止日期判断规则：',
    '- "今天"、"当天"、"今日"、"今晚" → 今天日期',
    '- "明天" → 明天日期；"后天" → 后天日期',
    '- 具体日期如"10月26日" → 当年该日期（若已过则明年）',
    '- "本周五"等 → 计算对应日期',
    '- 无法确定截止日期时填 ""',
  ].join('\n')
}

function buildExtractPrompt(messages: MessageRecord[]): string {
  const today = formatDate(new Date())
  const timeFmt = (ts: number) => new Date(ts * 1000).toTimeString().slice(0, 5)
  let s = `今天是 ${today}。请把以下${messages.length}条群消息整理成通知条目。\n`
  s += `如果多条消息属于同一条通知，请合并为一个条目（在 indices 中列出这些消息的序号）。\n\n消息列表：\n`
  messages.forEach((msg, i) => {
    s += `${i + 1}. [${timeFmt(msg.timestamp)}][群${msg.groupId}][${msg.senderName}] `
    s += msg.plainText.replace(/\n/g, ' ').slice(0, 300)
    if (msg.hasFile) s += ` [含文件:${msg.files.map(f => f.fileName).join('、')}]`
    s += '\n'
  })
  s += '\n请输出JSON数组。'
  return s
}

function extractJsonArray(text: string): string {
  let result = text.trim()
  if (result.startsWith('```json')) result = result.slice(7).trim()
  else if (result.startsWith('```')) result = result.slice(3).trim()
  if (result.endsWith('```')) result = result.slice(0, -3).trim()
  const start = result.indexOf('[')
  const end = result.lastIndexOf(']')
  if (start >= 0 && end > start) return result.slice(start, end + 1)
  return ''
}

function buildItemFromGroup(msgs: MessageRecord[], title: string, deadline: string): ReportItem {
  const timeFmt = (ts: number) => new Date(ts * 1000).toTimeString().slice(0, 5)
  const first = msgs[0]
  const allFiles = msgs.flatMap(m => m.files)
  const originalText = msgs
    .map(m => m.plainText)
    .filter(t => t && t.trim())
    .join('\n')
  return {
    title: title || (originalText.slice(0, 20) || '[消息]'),
    deadline: deadline || '',
    originalText: originalText || '(无文字内容)',
    groupId: first.groupId,
    sender: first.senderName,
    time: timeFmt(first.timestamp),
    hasFile: allFiles.length > 0,
    messageIds: msgs.map(m => m.id),
    files: allFiles.map(f => ({
      fileName: f.fileName,
      localPath: f.localPath,
      downloaded: f.downloaded,
    })),
  }
}

function parseExtractResponse(response: string, batch: MessageRecord[]): ReportItem[] {
  const jsonStr = extractJsonArray(response)
  const items: ReportItem[] = []
  if (jsonStr) {
    try {
      const arr = JSON.parse(jsonStr)
      const covered = new Set<number>()
      for (const obj of arr) {
        let indices: number[] = []
        if (Array.isArray(obj.indices)) {
          indices = obj.indices.map((i: any) => Number(i) - 1)
        } else if (typeof obj.index === 'number') {
          indices = [obj.index - 1]
        }
        indices = indices
          .filter((i: number) => Number.isInteger(i) && i >= 0 && i < batch.length && !covered.has(i))
          .sort((a: number, b: number) => a - b)
        if (indices.length === 0) continue
        indices.forEach(i => covered.add(i))
        const msgs = indices.map(i => batch[i])
        items.push(buildItemFromGroup(msgs, obj.title || '', normalizeDeadline(obj.deadline || '')))
      }
      for (let i = 0; i < batch.length; i++) {
        if (!covered.has(i)) items.push(buildItemFromGroup([batch[i]], '', ''))
      }
      return items
    } catch (e) {
      log('Report', `Extract JSON parse failed: ${e}`, 'W')
    }
  }
  return batch.map(m => buildItemFromGroup([m], '', ''))
}

function normalizeDeadline(raw: string): string {
  if (!raw) return ''
  const m = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  }
  return ''
}

export function sortByDeadline(items: ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => {
    const aHas = !!a.deadline
    const bHas = !!b.deadline
    if (aHas && bHas) return a.deadline.localeCompare(b.deadline)
    if (aHas) return -1
    if (bHas) return 1
    return 0
  })
}

function buildReportContent(items: ReportItem[], date: string): string {
  const s: string[] = [`# ${date} 群消息日报\n\n`, `共 ${items.length} 条通知\n\n`]
  items.forEach((item, i) => {
    const deadlineTag = item.deadline ? ` 【截止 ${item.deadline}】` : ''
    s.push(`## ${i + 1}. ${item.title}${deadlineTag}\n\n`)
    s.push(`- **截止日期**: ${item.deadline || '无'}\n`)
    s.push(`- **来源**: 群${item.groupId} ${item.sender} [${item.time}]\n`)
    s.push(`- **原文**: ${item.originalText.replace(/\n/g, ' ')}\n`)
    if (item.hasFile) {
      const names = item.files.map(f => f.fileName || '未命名文件').join('、')
      s.push(`- **关联文件**: 📎 ${names}\n`)
    }
    s.push('\n')
  })
  return s.join('')
}

export async function generateReport(
  llmConfig: LlmConfig,
  reportConfig: ReportConfig,
  onProgress?: (current: number, total: number, phase: string) => void,
): Promise<string | null> {
  const today = formatDate(new Date())
  let messages = getTodayMessages()

  if (reportConfig.targetGroups.length > 0) {
    messages = messages.filter(m => reportConfig.targetGroups.includes(m.groupId))
  }

  if (messages.length === 0) {
    log('Report', 'No messages today')
    return null
  }
  log('Report', `Generating report for ${messages.length} messages`)

  const batchSize = reportConfig.batchSize || 50
  const batches: MessageRecord[][] = []
  for (let i = 0; i < messages.length; i += batchSize) {
    batches.push(messages.slice(i, i + batchSize))
  }

  const allItems: ReportItem[] = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    log('Report', `Extracting batch ${b + 1}/${batches.length} (${batch.length} msgs)`)
    onProgress?.(b, batches.length, `正在整理第 ${b + 1}/${batches.length} 批消息`)
    try {
      const resp = await chatWithRetry(llmConfig, [
        { role: 'user', content: buildExtractPrompt(batch) }
      ], buildExtractSystemPrompt())
      allItems.push(...parseExtractResponse(resp, batch))
    } catch (e: any) {
      log('Report', `Batch extraction failed, using fallback: ${e.message}`, 'E')
      allItems.push(...batch.map(m => buildItemFromGroup([m], '', '')))
    }
    onProgress?.(b + 1, batches.length, `已整理 ${b + 1}/${batches.length} 批`)
  }

  onProgress?.(batches.length, batches.length, '正在生成日报…')
  const sorted = sortByDeadline(allItems)
  const content = buildReportContent(sorted, today)

  const report: DailyReport = {
    date: today,
    content,
    messageCount: messages.length,
    createdAt: Date.now(),
    items: sorted,
  }
  saveReport(report)
  log('Report', `Report saved: ${sorted.length} items`)
  return content
}

const TODAY_KEYWORDS = [
  '当天', '今天', '今日', '今晚', '今天内', '今日内',
  '截止今天', '今天截止', '今日截止', '今天前', '今日前',
  '今天为止', '今日为止', '今天之前', '今日之前', '当天截止',
]

export function hasTodayDeadline(text: string): boolean {
  if (!text) return false
  if (TODAY_KEYWORDS.some(k => text.includes(k))) return true

  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const monthPad = String(month).padStart(2, '0')
  const dayPad = String(day).padStart(2, '0')
  const patterns = [
    `${month}月${day}日`, `${month}月${day}号`, `${monthPad}月${dayPad}日`, `${monthPad}月${dayPad}号`,
    `${month}-${day}`, `${month}/${day}`, `${month}.${day}`,
    `${monthPad}-${dayPad}`, `${monthPad}/${dayPad}`, `${monthPad}.${dayPad}`,
  ]
  return patterns.some(p => text.includes(p))
}

export function matchTodayDeadlineKeywords(text: string): string | null {
  if (!text) return null
  for (const k of TODAY_KEYWORDS) {
    if (text.includes(k)) return k
  }
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const monthPad = String(month).padStart(2, '0')
  const dayPad = String(day).padStart(2, '0')
  const patterns = [
    `${month}月${day}日`, `${month}月${day}号`, `${monthPad}月${dayPad}日`, `${monthPad}月${dayPad}号`,
    `${month}-${day}`, `${month}/${day}`, `${month}.${day}`,
    `${monthPad}-${dayPad}`, `${monthPad}/${dayPad}`, `${monthPad}.${dayPad}`,
  ]
  for (const p of patterns) {
    if (text.includes(p)) return p
  }
  return null
}