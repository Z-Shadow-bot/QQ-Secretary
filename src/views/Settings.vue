<script setup lang="ts">
import { ref, onMounted } from 'vue'

const api = (window as any).api
const cfg = ref<any>(null)
const saved = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const newProfileName = ref('')
const autoLaunch = ref(false)
const cleaning = ref(false)

onMounted(async () => {
  cfg.value = await api.getConfig()
  if (!Array.isArray(cfg.value.llmProfiles)) cfg.value.llmProfiles = []
  if (!cfg.value.cleanup) cfg.value.cleanup = { enabled: false, keepDays: 30 }
  if (!cfg.value.reminder) cfg.value.reminder = { enabled: true, daysAhead: 1 }
  autoLaunch.value = await api.getAutoLaunch()
})

async function save() {
  const plainConfig = JSON.parse(JSON.stringify(cfg.value))
  await api.saveConfig(plainConfig)
  saved.value = true
  setTimeout(() => saved.value = false, 2000)
}

async function testLlm() {
  if (!cfg.value?.llm) return
  testing.value = true
  testResult.value = null
  try {
    const plainLlm = JSON.parse(JSON.stringify(cfg.value.llm))
    testResult.value = await api.testLlm(plainLlm)
  } catch (e: any) {
    testResult.value = { ok: false, message: e.message || String(e) }
  } finally {
    testing.value = false
  }
}

function saveProfile() {
  const name = newProfileName.value.trim()
  if (!name) { alert('请输入配置名称'); return }
  const profile = {
    name,
    apiUrl: cfg.value.llm.apiUrl,
    apiKey: cfg.value.llm.apiKey,
    model: cfg.value.llm.model,
  }
  const idx = cfg.value.llmProfiles.findIndex((p: any) => p.name === name)
  if (idx >= 0) cfg.value.llmProfiles[idx] = profile
  else cfg.value.llmProfiles.push(profile)
  newProfileName.value = ''
}

function applyProfile(p: any) {
  cfg.value.llm.apiUrl = p.apiUrl
  cfg.value.llm.apiKey = p.apiKey
  cfg.value.llm.model = p.model
  testResult.value = null
}

function deleteProfile(i: number) {
  cfg.value.llmProfiles.splice(i, 1)
}

async function cleanupNow() {
  cleaning.value = true
  try {
    const r = await api.cleanupNow()
    alert(`清理完成：消息 ${r.messages} 个、日报 ${r.reports} 个、文件目录 ${r.files} 个`)
  } finally {
    cleaning.value = false
  }
}

async function toggleAutoLaunch() {
  const val = await api.setAutoLaunch(autoLaunch.value)
  autoLaunch.value = val
}
</script>

<template>
  <div v-if="cfg">
    <div class="card">
      <h3 style="margin-bottom:12px;">OneBot 连接配置</h3>
      <label>WebSocket 地址 (如 ws://127.0.0.1:3001)</label>
      <input v-model="cfg.oneBot.wsUrl" placeholder="ws://127.0.0.1:3001" style="margin-bottom:12px;" />
      <label>Access Token (可选)</label>
      <input v-model="cfg.oneBot.accessToken" style="margin-bottom:12px;" />
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">LLM API 配置</h3>
      <label>API 地址 (填基础地址即可，会自动补全 /chat/completions)</label>
      <input v-model="cfg.llm.apiUrl" placeholder="https://api.deepseek.com/v1" style="margin-bottom:12px;" />
      <label>API Key</label>
      <input v-model="cfg.llm.apiKey" type="password" style="margin-bottom:12px;" />
      <label>模型名称</label>
      <input v-model="cfg.llm.model" placeholder="deepseek-chat" style="margin-bottom:12px;" />
      <button class="outline" @click="testLlm" :disabled="testing" style="width:100%;">
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
      <div v-if="testResult"
           :style="{marginTop:'10px',padding:'10px 12px',borderRadius:'8px',fontSize:'13px',lineHeight:'1.5',
                    background:testResult.ok?'#ECFDF5':'#FEF2F2',color:testResult.ok?'#059669':'#DC2626'}">
        <div style="font-weight:bold;margin-bottom:4px;">{{ testResult.ok ? '✅ 连接成功' : '❌ 连接失败' }}</div>
        <div style="word-break:break-all;">{{ testResult.message }}</div>
      </div>

      <div style="margin-top:14px;border-top:1px solid #eee;padding-top:12px;">
        <label>已保存的配置（点击「使用」切换）</label>
        <div v-if="cfg.llmProfiles.length === 0" style="font-size:12px;color:#999;margin-top:6px;">暂无保存的配置</div>
        <div v-for="(p, i) in cfg.llmProfiles" :key="i"
             style="display:flex;gap:6px;align-items:center;margin-top:6px;">
          <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.name }} <span style="color:#999;">({{ p.model }})</span></span>
          <button class="outline" style="padding:3px 10px;font-size:12px;" @click="applyProfile(p)">使用</button>
          <button class="outline" style="padding:3px 10px;font-size:12px;color:#DC2626;border-color:#DC2626;" @click="deleteProfile(i)">删除</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <input v-model="newProfileName" placeholder="配置名称，如 公司API" style="flex:1;" />
          <button class="outline" style="white-space:nowrap;" @click="saveProfile">保存当前</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">日报配置</h3>
      <label>你的身份/角色 (如: 我是后端开发，关注部署和bug)</label>
      <input v-model="cfg.report.userRole" style="margin-bottom:12px;" />
      <label>目标群号 (逗号分隔，留空则采集所有群)</label>
      <input :value="cfg.report.targetGroups.join(',')"
        @input="cfg.report.targetGroups = $event.target.value.split(',').map((s:string)=>parseInt(s.trim())).filter((n:number)=>!isNaN(n))"
        placeholder="123456,789012" style="margin-bottom:12px;" />
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <div style="flex:1;">
          <label>日报时间 (时)</label>
          <input v-model.number="cfg.report.dailyHour" type="number" min="0" max="23" />
        </div>
        <div style="flex:1;">
          <label>分</label>
          <input v-model.number="cfg.report.dailyMinute" type="number" min="0" max="59" />
        </div>
      </div>
      <label>自定义整理要求 (可选)</label>
      <textarea v-model="cfg.report.customRequirements" rows="2" style="margin-bottom:12px;"></textarea>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">通知与提醒</h3>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" v-model="cfg.reminder.enabled" style="width:auto;" />
        待办截止提醒（临近截止时弹系统通知）
      </label>
      <div v-if="cfg.reminder.enabled" style="margin-top:8px;">
        <label>提前提醒天数</label>
        <input v-model.number="cfg.reminder.daysAhead" type="number" min="0" max="30" style="width:100px;" />
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:12px;">
        <input type="checkbox" v-model="autoLaunch" @change="toggleAutoLaunch" style="width:auto;" />
        开机自动启动
      </label>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">数据管理</h3>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" v-model="cfg.cleanup.enabled" style="width:auto;" />
        自动清理旧消息、日报和文件
      </label>
      <div v-if="cfg.cleanup.enabled" style="margin-top:8px;">
        <label>保留天数</label>
        <input v-model.number="cfg.cleanup.keepDays" type="number" min="1" max="3650" style="width:100px;" />
      </div>
      <button class="outline" @click="cleanupNow" :disabled="cleaning" style="margin-top:12px;width:100%;">
        {{ cleaning ? '清理中…' : '立即清理（按上方保留天数）' }}
      </button>
    </div>

    <button class="primary" @click="save" style="width:100%;">保存配置</button>
    <p v-if="saved" style="text-align:center;color:#22C55E;margin-top:8px;">已保存</p>
  </div>
</template>