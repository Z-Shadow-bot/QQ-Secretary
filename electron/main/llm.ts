import { LlmConfig, log } from './config'

export interface LlmMessage {
  role: string
  content: string
}

let serialPromise: Promise<any> = Promise.resolve()

export async function chat(
  config: LlmConfig,
  messages: LlmMessage[],
  system?: string,
  temperature: number = 0.3,
): Promise<string> {
  const result = serialPromise.then(() =>
    doChat(config, messages, system, temperature)
  )
  serialPromise = result.catch(() => {})
  return result
}

export async function chatWithRetry(
  config: LlmConfig,
  messages: LlmMessage[],
  system?: string,
  maxRetries: number = 2,
  temperature: number = 0.3,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await chat(config, messages, system, temperature)
      if (result.trim()) return result
      log('LLM', `Attempt ${attempt}: empty response, retrying`, 'W')
    } catch (e: any) {
      log('LLM', `Attempt ${attempt} failed: ${e.message}`, 'W')
    }
  }
  throw new Error(`LLM failed after ${maxRetries} attempts`)
}

function resolveApiUrl(baseUrl: string): string {
  let url = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!url) return url
  if (url.includes('/chat/completions')) return url
  return `${url}/chat/completions`
}

async function doChat(
  config: LlmConfig,
  messages: LlmMessage[],
  system?: string,
  temperature: number = 0.3,
): Promise<string> {
  const msgArray: any[] = []
  if (system || config.systemPrompt) {
    msgArray.push({ role: 'system', content: system || config.systemPrompt })
  }
  for (const m of messages) {
    msgArray.push({ role: m.role, content: m.content })
  }

  const body = JSON.stringify({
    model: config.model,
    messages: msgArray,
    temperature,
    stream: false,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const requestUrl = resolveApiUrl(config.apiUrl)

  try {
    const resp = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json',
      },
      body,
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errorBody = await resp.text()
      log('LLM', `HTTP ${resp.status} at ${requestUrl}: ${errorBody.slice(0, 300)}`, 'E')
      throw new Error(`HTTP ${resp.status}`)
    }

    const data = await resp.json()
    const choice = data.choices?.[0]
    let content = choice?.message?.content || ''

    if (!content && choice?.message?.reasoning_content) {
      content = choice.message.reasoning_content
    }

    content = removeThinkTags(content)
    return content.trim()
  } finally {
    clearTimeout(timer)
  }
}

function removeThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim()
}