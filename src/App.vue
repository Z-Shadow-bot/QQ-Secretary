<script setup lang="ts">
import { ref } from 'vue'
import Dashboard from './views/Dashboard.vue'
import Settings from './views/Settings.vue'
import Report from './views/Report.vue'

const tab = ref('dashboard')
const reportDate = ref('')

function showReport(date: string) {
  reportDate.value = date
  tab.value = 'report'
}
</script>

<template>
  <div class="app">
    <nav class="tabs">
      <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">仪表盘</button>
      <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
    </nav>
    <main>
      <Dashboard v-if="tab === 'dashboard'" @view-report="showReport" />
      <Settings v-else-if="tab === 'settings'" />
      <Report v-else-if="tab === 'report'" :date="reportDate" @back="tab = 'dashboard'" />
    </main>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background: #f5f5f5; color: #1a1a1a; }
.app { max-width: 900px; margin: 0 auto; padding: 16px; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button {
  padding: 8px 20px; border: none; background: #fff; border-radius: 8px;
  cursor: pointer; font-size: 14px; color: #666; transition: all 0.2s;
}
.tabs button.active { background: #2563EB; color: #fff; }
.card {
  background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
button.primary {
  background: #2563EB; color: #fff; border: none; padding: 10px 20px;
  border-radius: 8px; cursor: pointer; font-size: 14px;
}
button.outline {
  background: #fff; color: #2563EB; border: 1px solid #2563EB; padding: 10px 20px;
  border-radius: 8px; cursor: pointer; font-size: 14px;
}
input, textarea {
  width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px;
  font-size: 14px; outline: none; transition: border 0.2s;
}
input:focus, textarea:focus { border-color: #2563EB; }
label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; }
</style>