<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{ 'view-report': [date: string] }>()

const status = ref('未连接')
const todayCount = ref(0)
const reports = ref<any[]>([])
const running = ref(false)
const generating = ref(false)
const qrcode = ref<string | null>(null)
const alertMsg = ref('')
const todos = ref<any[]>([])
const groupNames = ref<Record<string, string>>({})
const searchText = ref('')
const reportProgress = ref<{ current: number; total: number; phase: string; done: boolean } | null>(null)
const ctxMenu = ref<{ show: boolean; x: number; y: number; date: string }>({ show: false, x: 0, y: 0, date: '' })
const api = (window as any).api

const filteredReports = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return reports.value
  return reports.value.filter(r => r.date.includes(q) ||
    (r.items || []).some((it: any) =>
      (it.title || '').toLowerCase().includes(q) ||
      (it.originalText || '').toLowerCase().includes(q) ||
      String(it.groupId).includes(q)))
})

const filteredTodos = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return todos.value
  return todos.value.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.originalText || '').toLowerCase().includes(q) ||
    String(t.groupId).includes(q))
})

function groupLabel(groupId: number): string {
  const name = groupNames.value[String(groupId)]
  return name ? `${name}(${groupId})` : `群${groupId}`
}
let refreshTimer: ReturnType<typeof setInterval> | null = null
let alertTimer: ReturnType<typeof setTimeout> | null = null
let statusCb: ((s: string) => void) | null = null
let qrCb: ((d: string) => void) | null = null
let reportCb: (() => void) | null = null
let msgCb: ((r: any) => void) | null = null
let alertCb: ((m: string) => void) | null = null
let groupNamesCb: ((m: any) => void) | null = null
let reminderCb: ((items: any) => void) | null = null
let progressCb: ((p: any) => void) | null = null

function applyStatus(s: string) {
  status.value = s === 'connected' ? '已连接' : s === 'connecting' ? '连接中…' : '未连接'
  running.value = s === 'connected' || s === 'connecting'
  if (s === 'connected') { qrcode.value = null; loadTodayCount() }
}

function showAlert(msg: string) {
  alertMsg.value = msg
  if (alertTimer) clearTimeout(alertTimer)
  alertTimer = setTimeout(() => { alertMsg.value = '' }, 8000)
}

onMounted(async () => {
  statusCb = applyStatus
  qrCb = (dataUrl: string) => { qrcode.value = dataUrl }
  reportCb = () => { loadReports(); loadTodayCount(); loadTodos() }
  msgCb = () => { loadTodayCount() }
  alertCb = (m: string) => { showAlert(m) }
  groupNamesCb = (m: any) => { groupNames.value = m || {} }
  reminderCb = (items: any) => {
    if (Array.isArray(items) && items.length > 0) {
      showAlert(`待办提醒：${items.length} 条待办临近或已过截止日期（${items.map((i: any) => i.title).slice(0, 3).join('、')}${items.length > 3 ? '…' : ''}）`)
    }
  }
  progressCb = (p: any) => {
    if (!p || p.done) { reportProgress.value = null; return }
    reportProgress.value = p
  }
  api.onStatus(statusCb)
  api.onQrCode(qrCb)
  api.onReportReady(reportCb)
  api.onMessageSaved(msgCb)
  api.onTodayDeadlineAlert(alertCb)
  api.onGroupNames(groupNamesCb)
  api.onTodoReminder(reminderCb)
  api.onReportProgress(progressCb)
  document.addEventListener('click', hideContextMenu)

  const s = await api.getStatus()
  applyStatus(s)
  loadReports()
  loadTodayCount()
  loadTodos()
  groupNames.value = await api.getGroupNames()
  refreshTimer = setInterval(loadTodayCount, 30000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (alertTimer) clearTimeout(alertTimer)
  if (statusCb) api.offStatus(statusCb)
  if (qrCb) api.offQrCode(qrCb)
  if (reportCb) api.offReportReady(reportCb)
  if (msgCb) api.offMessageSaved(msgCb)
  if (alertCb) api.offTodayDeadlineAlert(alertCb)
  if (groupNamesCb) api.offGroupNames(groupNamesCb)
  if (reminderCb) api.offTodoReminder(reminderCb)
  if (progressCb) api.offReportProgress(progressCb)
  document.removeEventListener('click', hideContextMenu)
})

function showContextMenu(e: MouseEvent, report: any) {
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, date: report.date }
}

function hideContextMenu() {
  ctxMenu.value.show = false
}

async function confirmDeleteReport() {
  const date = ctxMenu.value.date
  hideContextMenu()
  if (!date) return
  if (!window.confirm(`确定删除 ${date} 的日报吗？此操作不可恢复（不影响已采集的消息和文件）。`)) return
  await api.deleteReport(date)
  loadReports()
}

async function loadReports() {
  reports.value = await api.getReports()
}

async function loadTodayCount() {
  const msgs = await api.getTodayMessages()
  todayCount.value = msgs.length
}

function toggleService() {
  if (running.value) {
    api.stopCollector()
    running.value = false
    status.value = '未连接'
  } else {
    api.startCollector()
    running.value = true
  }
}

async function genReport() {
  generating.value = true
  try {
    const content = await api.generateReport()
    if (content) {
      alert('日报已生成')
      loadReports()
    } else {
      alert('今日无消息，跳过')
    }
  } catch (e: any) {
    alert('生成失败: ' + e.message)
  } finally {
    generating.value = false
  }
}

function sortTodos(list: any[]): any[] {
  return [...list].sort((a, b) => {
    const aHas = !!a.deadline
    const bHas = !!b.deadline
    if (aHas && bHas) return a.deadline.localeCompare(b.deadline)
    if (aHas) return -1
    if (bHas) return 1
    return 0
  })
}

async function loadTodos() {
  todos.value = sortTodos(await api.getTodos())
}

async function removeTodoItem(id: string) {
  todos.value = sortTodos(await api.removeTodo(id))
}

async function updateDeadline(todo: any, e: Event) {
  const val = (e.target as HTMLInputElement).value
  todo.deadline = val
  todos.value = sortTodos(await api.updateTodoDeadline(todo.id, val))
}

function isOverdue(deadline: string): boolean {
  if (!deadline) return false
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return deadline < today
}
</script>

<template>
  <div>
    <div v-if="alertMsg" class="card" style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:12px 16px;">
      <span style="font-size:14px;color:#92400E;">{{ alertMsg }}</span>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;font-weight:bold;">{{ status }}</span>
        <span :style="{width:'10px',height:'10px',borderRadius:'50%',background: status==='已连接'?'#22C55E':'#EF4444'}"></span>
      </div>
      <p style="margin-top:8px;color:#666;font-size:13px;">今日 {{ todayCount }} 条消息</p>
    </div>

    <div v-if="qrcode && status !== '已连接'" class="card" style="text-align:center;">
      <h3 style="margin-bottom:12px;">扫码登录 QQ</h3>
      <img :src="qrcode" style="width:200px;height:200px;border:1px solid #ddd;border-radius:8px;" />
      <p style="margin-top:8px;color:#666;font-size:13px;">用 QQ 扫描上方二维码登录</p>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="primary" @click="toggleService">{{ running ? '停止采集' : '启动采集' }}</button>
      <button class="outline" @click="genReport" :disabled="generating">{{ generating ? '生成中…' : '生成日报' }}</button>
    </div>

    <div v-if="reportProgress" class="card" style="background:#EFF6FF;border-left:4px solid #2563EB;padding:12px 16px;">
      <div style="font-size:13px;color:#2563EB;">{{ reportProgress.phase }}</div>
      <div style="margin-top:6px;height:6px;background:#DBEAFE;border-radius:3px;overflow:hidden;">
        <div :style="{height:'100%',width:(reportProgress.total ? (reportProgress.current/reportProgress.total*100) : 0)+'%',background:'#2563EB',transition:'width .3s'}"></div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <input v-model="searchText" placeholder="搜索日报 / 待办（标题、原文、群号）" />
    </div>

    <div v-if="filteredTodos.length > 0" class="card" style="border-left:4px solid #2563EB;">
      <h3 style="margin-bottom:12px;">我的待办 ({{ filteredTodos.length }})</h3>
      <div v-for="todo in filteredTodos" :key="todo.id"
           style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #eee;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;">{{ todo.title }}</div>
          <div style="font-size:12px;color:#999;margin-top:2px;">{{ groupLabel(todo.groupId) }} · {{ todo.sender }} · 来自 {{ todo.sourceDate }}</div>
          <div v-if="todo.originalText" style="font-size:12px;color:#666;margin-top:4px;line-height:1.5;white-space:pre-wrap;">{{ todo.originalText }}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
            <span style="font-size:12px;color:#666;">截止日期</span>
            <input type="date" :value="todo.deadline"
                   @change="updateDeadline(todo, $event)"
                   style="width:auto;padding:3px 8px;font-size:12px;" />
            <span v-if="isOverdue(todo.deadline)" style="font-size:11px;color:#DC2626;">已逾期</span>
          </div>
        </div>
        <button class="outline" title="标记完成并移除"
                style="flex-shrink:0;padding:6px 14px;font-size:16px;color:#22C55E;border-color:#22C55E;"
                @click="removeTodoItem(todo.id)">✓</button>
      </div>
    </div>

    <h3 style="margin-bottom:8px;">日报列表 <span style="font-size:12px;font-weight:normal;color:#999;">(右键可删除)</span></h3>
    <div v-if="filteredReports.length === 0" class="card" style="text-align:center;color:#999;">
      {{ searchText ? '无匹配结果' : '暂无日报' }}
    </div>
    <div v-for="r in filteredReports" :key="r.date" class="card" style="cursor:pointer;"
         @click="emit('view-report', r.date)"
         @contextmenu.prevent="showContextMenu($event, r)">
      <div style="font-weight:bold;font-size:15px;">{{ r.date }}</div>
      <div style="color:#666;font-size:13px;margin-top:4px;">共 {{ r.messageCount }} 条消息</div>
      <div style="color:#999;font-size:12px;margin-top:2px;">{{ new Date(r.createdAt).toTimeString().slice(0,5) }} 生成</div>
    </div>

    <div v-if="ctxMenu.show"
         :style="{position:'fixed',left:ctxMenu.x+'px',top:ctxMenu.y+'px',background:'#fff',border:'1px solid #ddd',borderRadius:'8px',boxShadow:'0 2px 10px rgba(0,0,0,0.15)',zIndex:1000,minWidth:'140px',overflow:'hidden'}">
      <div class="ctx-item" style="padding:10px 16px;font-size:13px;cursor:pointer;color:#DC2626;"
           @click="confirmDeleteReport">删除日报</div>
    </div>
  </div>
</template>