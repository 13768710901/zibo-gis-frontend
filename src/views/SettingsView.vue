<template>
  <div class="settings-page">
    <h2>⚙️ 系统设置</h2>
    
    <div class="settings-card">
      <h3>外观设置</h3>
      
      <div class="setting-item">
        <div class="setting-label">
          <label>主题</label>
          <span>亮色 / 暗色</span>
        </div>
        <select v-model="settings.theme">
          <option value="dark">暗色</option>
          <option value="light">亮色</option>
        </select>
      </div>
    </div>
    
    <div class="settings-card">
      <h3>功能设置</h3>
      
      <div class="setting-item">
        <div class="setting-label">
          <label>消息通知</label>
          <span>启用系统消息通知</span>
        </div>
        <label class="toggle">
          <input type="checkbox" v-model="settings.notifications" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      
      <div class="setting-item">
        <div class="setting-label">
          <label>自动刷新</label>
          <span>自动刷新地图数据</span>
        </div>
        <label class="toggle">
          <input type="checkbox" v-model="settings.autoRefresh" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    
    <button class="save-btn" @click="saveSettings" :class="{ 'saved': saved }">
      {{ saved ? '✓ 已保存' : '保存设置' }}
    </button>
    
    <!-- 保存成功提示 -->
    <div v-if="showToast" class="toast">
      <span class="toast-icon">✓</span>
      <span>设置已保存</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const settings = ref({
  theme: 'dark',
  notifications: true,
  autoRefresh: false
})

const saved = ref(false)
const showToast = ref(false)

const saveSettings = () => {
  localStorage.setItem('app_settings', JSON.stringify(settings.value))
  
  // 立即应用主题
  applyTheme(settings.value.theme)
  
  saved.value = true
  showToast.value = true
  
  // 3秒后隐藏提示
  setTimeout(() => {
    showToast.value = false
  }, 3000)
}

// 应用主题到全局
const applyTheme = (theme) => {
  if (theme === 'light') {
    document.body.classList.add('light-theme')
    document.body.classList.remove('dark-theme')
  } else {
    document.body.classList.add('dark-theme')
    document.body.classList.remove('light-theme')
  }
}

// 加载设置
onMounted(() => {
  const savedSettings = localStorage.getItem('app_settings')
  if (savedSettings) {
    const parsed = JSON.parse(savedSettings)
    settings.value = { ...settings.value, ...parsed }
    // 应用保存的主题
    applyTheme(settings.value.theme)
  }
})
</script>

<style scoped>
.settings-page {
  padding: 1rem;
}

h2 {
  margin: 0 0 1.5rem;
  color: #f1f5f9;
  font-size: 1.25rem;
}

.settings-card {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.settings-card h3 {
  margin: 0 0 1rem;
  color: #e2e8f0;
  font-size: 1rem;
  font-weight: 500;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.setting-label label {
  color: #f1f5f9;
  font-size: 0.95rem;
}

.setting-label span {
  color: #64748b;
  font-size: 0.8rem;
}

select {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.8);
  color: #f1f5f9;
  font-size: 0.9rem;
  cursor: pointer;
}

select:focus {
  outline: none;
  border-color: #3b82f6;
}

.toggle {
  position: relative;
  width: 48px;
  height: 24px;
  cursor: pointer;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  transition: 0.3s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: 0.3s;
}

.toggle input:checked + .toggle-slider {
  background: #3b82f6;
}

.toggle input:checked + .toggle-slider::before {
  transform: translateX(24px);
}

.save-btn {
  padding: 0.75rem 2rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.save-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}

.save-btn.saved {
  background: linear-gradient(135deg, #22c55e, #16a34a);
}

/* Toast提示 */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.3s ease;
  z-index: 1000;
}

.toast-icon {
  font-size: 1.2rem;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* 浅色主题覆盖 */
:global(body.light-theme) .settings-page h2 {
  color: #1e293b !important;
}

:global(body.light-theme) .settings-card {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

:global(body.light-theme) .settings-card h3 {
  color: #1e293b !important;
}

:global(body.light-theme) .setting-label label {
  color: #1e293b !important;
}

:global(body.light-theme) .setting-label span {
  color: #64748b !important;
}

:global(body.light-theme) select {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}
</style>
