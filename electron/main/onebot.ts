import WebSocket from 'ws'
import { log } from './config'

export interface MessageSegment {
  type: string
  data: Record<string, any>
}

export interface GroupMessageEvent {
  time: number
  selfId: number
  groupId: number
  userId: number
  messageId: number
  rawMessage: string
  segments: MessageSegment[]
  senderNickname: string
  senderCard: string
}

function segText(seg: MessageSegment): string {
  switch (seg.type) {
    case 'text': return seg.data.text || ''
    case 'at': return `@${seg.data.qq || ''} `
    case 'image': return '[图片]'
    case 'file': return `[文件:${seg.data.name || seg.data.file || ''}]`
    case 'video': return '[视频]'
    case 'record': return '[语音]'
    case 'reply': return ''
    default: return `[${seg.type}]`
  }
}

export function segmentsToText(segments: MessageSegment[]): string {
  return segments.map(segText).join('')
}

export function parseGroupMessage(data: any): GroupMessageEvent | null {
  if (data.post_type !== 'message' || data.message_type !== 'group') return null

  let segments: MessageSegment[]
  if (Array.isArray(data.message)) {
    segments = data.message as MessageSegment[]
  } else if (typeof data.message === 'string') {
    segments = [{ type: 'text', data: { text: data.message } }]
  } else {
    segments = []
  }

  const sender = data.sender || {}
  return {
    time: data.time || 0,
    selfId: data.self_id || 0,
    groupId: data.group_id || 0,
    userId: data.user_id || 0,
    messageId: data.message_id || 0,
    rawMessage: data.raw_message || segmentsToText(segments),
    segments,
    senderNickname: sender.nickname || '',
    senderCard: sender.card || '',
  }
}

export class OneBotClient {
  private ws: WebSocket | null = null
  private shouldReconnect = false
  private selfId = 0
  private echoCounter = 0
  private pendingApis = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>()

  public status: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
  public onGroupMessage: ((event: GroupMessageEvent) => void) | null = null
  public onStatusChange: ((status: string) => void) | null = null

  constructor(private url: string, private token: string) {}

  connect(): void {
    if (this.shouldReconnect) return
    this.shouldReconnect = true
    this.doConnect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.ws?.close()
    this.ws = null
    this.updateStatus('disconnected')
  }

  private doConnect(): void {
    if (!this.shouldReconnect || !this.url) return
    this.updateStatus('connecting')
    try {
      const headers: Record<string, string> = {}
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`
      this.ws = new WebSocket(this.url, { headers })

      this.ws.on('open', () => {
        this.updateStatus('connected')
        log('OneBot', `Connected to ${this.url}`)
        this.callApi('get_login_info').then(resp => {
          this.selfId = resp?.data?.user_id || 0
          log('OneBot', `Self ID: ${this.selfId}`)
        }).catch(e => log('OneBot', `get_login_info failed: ${e}`, 'E'))
      })

      this.ws.on('message', (raw: Buffer) => {
        this.handleMessage(raw.toString())
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        log('OneBot', `Closed: ${code} ${reason}`)
        this.onDisconnected()
      })

      this.ws.on('error', (err: Error) => {
        log('OneBot', `Error: ${err.message}`, 'E')
        this.onDisconnected()
      })
    } catch (e) {
      log('OneBot', `Connect error: ${e}`, 'E')
      this.onDisconnected()
    }
  }

  private onDisconnected(): void {
    if (this.status === 'disconnected') return
    this.updateStatus('disconnected')
    for (const [, pending] of this.pendingApis) {
      clearTimeout(pending.timer)
      pending.reject(new Error('disconnected'))
    }
    this.pendingApis.clear()
    if (this.shouldReconnect) {
      setTimeout(() => this.doConnect(), 5000)
    }
  }

  private updateStatus(status: string): void {
    this.status = status as any
    this.onStatusChange?.(status)
  }

  private handleMessage(text: string): void {
    try {
      const json = JSON.parse(text)
      if (json.echo !== undefined) {
        const pending = this.pendingApis.get(String(json.echo))
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingApis.delete(String(json.echo))
          pending.resolve(json)
        }
        return
      }
      log('OneBot', `Recv: ${text.slice(0, 200)}`, 'D')
      const groupMsg = parseGroupMessage(json)
      if (groupMsg) {
        this.onGroupMessage?.(groupMsg)
      }
    } catch (e) {
      log('OneBot', `Parse error: ${text.slice(0, 200)}`, 'E')
    }
  }

  async callApi(action: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected')
    }
    const echo = String(++this.echoCounter)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApis.delete(echo)
        reject(new Error(`API timeout: ${action}`))
      }, 30000)
      this.pendingApis.set(echo, { resolve, reject, timer })
      this.ws!.send(JSON.stringify({ action, params, echo }))
    })
  }

  async getGroupInfo(groupId: number): Promise<{ groupName: string } | null> {
    try {
      const resp = await this.callApi('get_group_info', { group_id: groupId })
      if (resp && resp.data) {
        return { groupName: resp.data.group_name || '' }
      }
    } catch (e) {
      log('OneBot', `get_group_info failed for ${groupId}: ${e}`, 'W')
    }
    return null
  }
}