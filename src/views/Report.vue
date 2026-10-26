<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'

const props = defineProps<{ date: string }>()
const emit = defineEmits<{ back: [] }>()

const api = (window as any).api
const report = ref<any>(null)
const fileCache = ref<Record<number, any[]>>({})
const todos = ref<any[]>([])
const groupNames = ref<Record<string, string>>({})
const searchText = ref('')
const copied = ref(false)
const filteredItems = computed(() => {
  const items = report.value?.items || []
  const q = searchText.value.trim().toLowerCase()
  if (!q) return items
  return items.filter((it: any) =>
    (it.title || '').toLowerCase().includes(q) ||
    (it.originalText || '').toLowerCase().includes(q) ||
    String(it.groupId).includes(q) ||
    (it.deadline || '').includes(q))
})

function groupLabel(groupId: number): string {
  const name = groupNames.value[String(groupId)]
  return name ? `${name}(${groupId})` : `群${groupId}`
}

async function load() {
  if (!props.date) return
  report.value = await api.getReport(props.date)
  await loadFiles()
  await loadTodos()
  groupNames.value = await api.getGroupNames()
}

async function loadTodos() {
  todos.value = await api.getTodos()
}

async function loadFiles() {
  if (!report.value || !report.value.items) return
  const cache: Record<number, any[]> = {}
  for (const item of report.value.items) {
    if (!item.hasFile) continue
    const ids: number[] = item.messageIds || (item.messageId ? [item.messageId] : [])
    for (const id of ids) {
      cache[id] = await api.getMessageFiles(report.value.date, id)
    }
  }
  fileCache.value = cache
}

onMounted(load)
watch(() => props.date, load)

function openFile(path: string) {
  if (path) api.openFile(path)
}

function revealFile(path: string) {
  if (path) api.revealFile(path)
}

function isToday(deadline: string): boolean {
  if (!deadline) return false
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return deadline === today
}

function itemMessageIds(item: any): number[] {
  return item.messageIds || (item.messageId ? [item.messageId] : [])
}

function todoKey(item: any): string {
  const ids = itemMessageIds(item)
  return `${props.date}#${ids.join(',') || item.title}`
}

function isInTodos(item: any): boolean {
  return todos.value.some(t => t.id === todoKey(item))
}

async function addToTodo(item: any) {
  const todo = {
    id: todoKey(item),
    title: item.title,
    deadline: item.deadline || '',
    originalText: item.originalText,
    groupId: item.groupId,
    sender: item.sender,
    time: item.time,
    hasFile: item.hasFile,
    messageIds: itemMessageIds(item),
    files: item.files || [],
    sourceDate: props.date,
    addedAt: Date.now(),
  }
  todos.value = await api.addTodo(todo)
}

function filesOf(item: any): any[] {
  const ids: number[] = item.messageIds || (item.messageId ? [item.messageId] : [])
  const collected: any[] = []
  for (const id of ids) {
    const cached = fileCache.value[id]
    if (cached) collected.push(...cached)
  }
  if (collected.length > 0) return collected.filter(f => f.fileName || f.localPath)
  if (item.files && item.files.length > 0) return item.files
  if (item.localPath) return [{ fileName: item.fileName, localPath: item.localPath, downloaded: true }]
  return []
}

function buildMarkdown(): string {
  if (!report.value) return ''
  const items = report.value.items || []
  const lines: string[] = [`# ${report.value.date} 群消息日报\n`, `共 ${items.length} 条通知\n`]
  items.forEach((it: any, i: number) => {
    lines.push(`## ${i + 1}. ${it.title}${it.deadline ? ` 【截止 ${it.deadline}】` : ''}`)
    lines.push(`- 来源: ${groupLabel(it.groupId)} ${it.sender} [${it.time}]`)
    lines.push(`- 原文: ${(it.originalText || '').replace(/\n/g, ' ')}`)
    if (it.hasFile) {
      const names = filesOf(it).map((f: any) => f.fileName || '未命名文件').join('、')
      lines.push(`- 关联文件: ${names}`)
    }
    lines.push('')
  })
  return lines.join('\n')
}

async function copyContent() {
  const text = buildMarkdown()
  await api.copyText(text)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

async function exportReport() {
  const text = buildMarkdown()
  const r = await api.exportReport(props.date, text)
  if (r && r.ok) alert('已导出到: ' + r.path)
  else if (r && r.message) alert('导出失败: ' + r.message)
}
</script>

<template>
  <div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="outline" @click="emit('back')">← 返回</button>
      <button class="outline" @click="copyContent">{{ copied ? '已复制' : '复制内容' }}</button>
      <button class="outline" @click="exportReport">导出 Markdown</button>
    </div>

    <div v-if="report" class="card">
      <h2 style="margin-bottom:8px;">{{ report.date }} 群消息日报</h2>
      <p style="color:#666;font-size:13px;">
        共 {{ report.messageCount }} 条通知 | {{ new Date(report.createdAt).toTimeString().slice(0,5) }} 生成
      </p>
    </div>

    <div v-if="report" style="margin-bottom:12px;">
      <input v-model="searchText" placeholder="搜索条目（标题、原文、群号、截止日期）" />
      <div v-if="searchText" style="font-size:12px;color:#999;margin-top:6px;">匹配 {{ filteredItems.length }} 条</div>
    </div>

    <div v-if="report">
      <div v-for="(item, i) in filteredItems" :key="i" class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <h3 style="font-size:15px;line-height:1.4;flex:1;">{{ item.title }}</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span v-if="item.deadline"
                  :style="{fontSize:'12px',padding:'2px 8px',borderRadius:'6px',whiteSpace:'nowrap',background:isToday(item.deadline)?'#FEE2E2':'#EFF6FF',color:isToday(item.deadline)?'#DC2626':'#2563EB'}">
              截止 {{ item.deadline }}{{ isToday(item.deadline) ? ' (今日)' : '' }}
            </span>
            <button v-if="!isInTodos(item)" class="primary" style="padding:4px 12px;font-size:12px;" @click="addToTodo(item)">加入待办</button>
            <button v-else disabled style="padding:4px 12px;font-size:12px;border:1px solid #ddd;border-radius:8px;background:#f0f0f0;color:#999;cursor:not-allowed;">已加入待办</button>
          </div>
        </div>
        <div style="font-size:12px;color:#999;margin-top:6px;">{{ groupLabel(item.groupId) }} · {{ item.sender }} · {{ item.time }}</div>
        <div style="font-size:13px;color:#444;margin-top:8px;line-height:1.6;white-space:pre-wrap;">{{ item.originalText }}</div>

        <div v-if="item.hasFile" style="margin-top:8px;">
          <div v-for="(f, fi) in filesOf(item)" :key="fi" style="margin-bottom:6px;">
            <div style="font-size:12px;color:#666;">📎 {{ f.fileName || '未命名文件' }}</div>
            <div v-if="f.downloaded && f.localPath" style="font-size:11px;color:#999;word-break:break-all;margin-top:2px;">{{ f.localPath }}</div>
            <button v-if="f.downloaded && f.localPath" class="outline" style="padding:3px 10px;font-size:12px;margin-top:4px;" @click="openFile(f.localPath)">打开</button>
            <button v-if="f.downloaded && f.localPath" class="outline" style="padding:3px 10px;font-size:12px;margin-top:4px;margin-left:6px;" @click="revealFile(f.localPath)">定位文件夹</button>
            <div v-else style="font-size:11px;color:#ccc;margin-top:2px;">文件未下载或已过期</div>
          </div>
        </div>
      </div>
      <div v-if="filteredItems.length === 0 && searchText" class="card" style="text-align:center;color:#999;">无匹配条目</div>
    </div>

    <div v-if="!report" class="card" style="text-align:center;color:#999;">日报不存在</div>
  </div>
</template>