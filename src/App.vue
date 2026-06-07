<script setup>
import { onMounted, onBeforeUnmount, ref, provide, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import WeatherWidget from './components/WeatherWidget.vue'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

const router = useRouter()
const route = useRoute()

// 判断是否为全屏独立布局页面（登录/注册/移动端灾情上报）
const isAuthPage = computed(() => {
  return route.path === '/login' || 
         route.path === '/register' || 
         (route.path === '/disaster-report' && route.meta.mobileStandalone)
})
const nowText = ref('')
const weekdayText = ref('')

// 登录状态
const isLoggedIn = ref(false)
const currentUser = ref(null)

// 检查登录状态
const checkLoginStatus = () => {
  const token = sessionStorage.getItem('token')
  const userStr = sessionStorage.getItem('user')
  if (token && userStr) {
    isLoggedIn.value = true
    try {
      currentUser.value = JSON.parse(userStr)
    } catch {
      currentUser.value = null
    }
  } else {
    isLoggedIn.value = false
    currentUser.value = null
  }
}

// 退出登录
const handleLogout = () => {
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('user')
  isLoggedIn.value = false
  currentUser.value = null
  router.push('/login')
}

// 全局搜索功能
const searchQuery = ref('')
const searchResults = ref([])
const showSearchResults = ref(false)
const isSearching = ref(false)
const userLocation = ref(null)
const locationPermission = ref('prompt') // 'granted', 'denied', 'prompt'
const locationError = ref(null)
const showLocationDialog = ref(false)

// 高德地图API配置 - 搜索专用密钥
const AMAP_KEY = '0b440760c47124fdfe1d1a4961f6d4dc'

const formatDateTime = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

const formatWeekday = (date) => {
  const map = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return map[date.getDay()] || ''
}

// 获取用户位置
const getUserLocation = () => {
  if (navigator.geolocation) {
    // 检查权限状态
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      locationPermission.value = result.state
      
      if (result.state === 'granted') {
        // 权限已授予，直接获取位置
        getCurrentPosition()
      } else if (result.state === 'denied') {
        // 权限被拒绝
        locationError.value = '位置权限被拒绝，请手动开启'
        console.warn('位置权限被拒绝')
      } else {
        // 权限未确定，显示弹窗请求权限
        showLocationDialog.value = true
      }
      
      // 监听权限变化
      result.addEventListener('change', () => {
        locationPermission.value = result.state
        if (result.state === 'granted') {
          getCurrentPosition()
        }
      })
    })
  } else {
    locationError.value = '浏览器不支持地理定位'
    console.warn('浏览器不支持地理定位')
  }
}

// 确认获取位置
const confirmLocationAccess = () => {
  showLocationDialog.value = false
  getCurrentPosition()
}

// 拒绝获取位置
const denyLocationAccess = () => {
  showLocationDialog.value = false
  locationPermission.value = 'denied'
  locationError.value = '位置权限被拒绝'
}

// 获取当前位置
const getCurrentPosition = () => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation.value = {
        longitude: position.coords.longitude,
        latitude: position.coords.latitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      }
      locationError.value = null
      console.log('用户位置获取成功:', userLocation.value)
      
      // 分发位置更新事件
      window.dispatchEvent(new CustomEvent('user-location-updated', {
        detail: userLocation.value
      }))
    },
    (error) => {
      locationError.value = getLocationErrorMessage(error)
      console.warn('获取用户位置失败:', error)
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000 // 5分钟缓存
    }
  )
}

// 获取位置错误信息
const getLocationErrorMessage = (error) => {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return '位置权限被拒绝'
    case error.POSITION_UNAVAILABLE:
      return '位置信息不可用'
    case error.TIMEOUT:
      return '获取位置超时'
    default:
      return '未知错误'
  }
}

// 搜索本地设施
const searchLocalFacilities = async (query) => {
  try {
    const response = await axios.get(`${API_BASE}/facilities`)
    const facilities = Array.isArray(response.data) ? response.data : []
    
    const results = facilities
      .filter(f => {
        const searchText = `${f.name || ''} ${f.type || ''} ${f.address || ''}`.toLowerCase()
        const queryLower = query.toLowerCase()
        
        // 精确匹配优先
        if (searchText.includes(queryLower)) {
          return true
        }
        return false
      })
      .slice(0, 10) // 限制结果数量
      .map(f => ({
        id: f.id,
        name: f.name,
        type: 'facility',
        typeName: mapTypeKey(f.type),
        address: f.address,
        longitude: f.longitude ?? f.lon,
        latitude: f.latitude ?? f.lat,
        source: '本地设施'
      }))
    
    return results
  } catch (error) {
    console.error('搜索本地设施失败:', error)
    return []
  }
}

// 搜索在线地点 - 使用标准API调用
const searchOnlinePlaces = (query) => {
  return new Promise((resolve) => {
    // 创建JSONP回调函数名
    const callbackName = `amap_callback_${Date.now()}`
    
    // 设置全局回调函数
    window[callbackName] = (data) => {
      if (data && data.status === '1' && data.pois && data.pois.length > 0) {
        const results = data.pois.map(poi => {
          const [lng, lat] = poi.location.split(',').map(coord => parseFloat(coord.trim()))
          
          return {
            id: `online_${poi.id}`,
            name: poi.name,
            type: 'online',
            typeName: poi.type || '地点',
            address: poi.address || poi.pname || poi.cityname || poi.location,
            longitude: lng,
            latitude: lat,
            source: '高德地图'
          }
        })
        resolve(results)
      } else {
        resolve([])
      }
      
      // 清理回调函数
      delete window[callbackName]
    }
    
    // 创建script标签，使用简单有效的参数
    const script = document.createElement('script')
    script.src = `https://restapi.amap.com/v3/place/text?key=${AMAP_KEY}&keywords=${encodeURIComponent(query)}&city=淄博&output=json&callback=${callbackName}`
    script.onerror = () => {
      delete window[callbackName]
      resolve([])
    }
    
    // 添加到页面
    document.head.appendChild(script)
    
    // 设置超时清理
    setTimeout(() => {
      if (window[callbackName]) {
        delete window[callbackName]
        if (document.head.contains(script)) {
          document.head.removeChild(script)
        }
        resolve([])
      }
    }, 10000)
  })
}

// 设施类型映射函数
const mapTypeKey = (typeText) => {
  if (!typeText) return '其他设施'
  const raw = String(typeText)
  const t = raw.toLowerCase()

  if (raw.includes('医') || t.includes('hospital')) return '医疗卫生'
  if (raw.includes('教育') || raw.includes('学') || t.includes('school')) return '教育服务'
  if (raw.includes('应急') || raw.includes('避难') || t.includes('shelter')) return '应急避难'
  if (raw.includes('居民') || raw.includes('小区') || raw.includes('社区')) return '居民/小区'
  if (raw.includes('商业') || raw.includes('商场') || raw.includes('超市') || t.includes('mall')) return '商业/商场'
  return '其他设施'
}

// 执行搜索
const performSearch = async (query) => {
  if (!query.trim()) {
    searchResults.value = []
    showSearchResults.value = false
    return
  }

  isSearching.value = true
  
  try {
    // 并行搜索本地设施和在线地点
    const [localResults, onlineResults] = await Promise.all([
      searchLocalFacilities(query),
      searchOnlinePlaces(query)
    ])

    // 合并结果，本地设施优先
    searchResults.value = [...localResults, ...onlineResults]
    showSearchResults.value = true
  } catch (error) {
    console.error('搜索失败:', error)
  } finally {
    isSearching.value = false
  }
}

// 处理搜索结果点击
const handleSearchResultClick = (result) => {
  showSearchResults.value = false
  searchQuery.value = ''
  
  // 检查是否是路径规划的搜索请求
  const isRoutePlanningSearch = window.__routePlanningSearch
  
  if (isRoutePlanningSearch) {
    // 发送搜索结果给路径规划组件
    window.dispatchEvent(new CustomEvent('search-result', {
      detail: {
        longitude: result.longitude,
        latitude: result.latitude,
        name: result.name
      }
    }))
    // 清除标记
    window.__routePlanningSearch = false
  } else if (result.type === 'facility') {
    // 跳转到三维地图并聚焦设施
    router.push('/map')
    // 延迟发送聚焦事件，确保地图已加载
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('facility-focus', {
        detail: {
          id: result.id,
          name: result.name,
          type: result.typeName,
          lon: result.longitude,
          lat: result.latitude,
          address: result.address
        }
      }))
    }, 500)
  } else {
    // 跳转到二维地图并定位
    router.push('/route')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('location-search', {
        detail: {
          longitude: result.longitude,
          latitude: result.latitude,
          name: result.name
        }
      }))
    }, 500)
  }
}

// 防抖搜索
let searchTimeout
const onSearchInput = (event) => {
  const query = event.target.value
  searchQuery.value = query
  
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    performSearch(query)
  }, 300)
}

// 点击外部关闭搜索结果
const handleClickOutside = (event) => {
  const searchBox = document.querySelector('.global-search')
  if (searchBox && !searchBox.contains(event.target)) {
    showSearchResults.value = false
  }
}

let timerId
let loginSuccessHandler
let searchHandler

// 应用主题
const applyTheme = (theme) => {
  if (theme === 'light') {
    document.body.classList.add('light-theme')
    document.body.classList.remove('dark-theme')
  } else {
    document.body.classList.add('dark-theme')
    document.body.classList.remove('light-theme')
  }
}

onMounted(() => {
  // 检查登录状态
  checkLoginStatus()
  
  // 加载并应用主题设置
  const savedSettings = localStorage.getItem('app_settings')
  if (savedSettings) {
    const parsed = JSON.parse(savedSettings)
    applyTheme(parsed.theme || 'dark')
  }
  
  // 监听登录成功事件
  loginSuccessHandler = (event) => {
    isLoggedIn.value = true
    currentUser.value = event.detail
  }
  window.addEventListener('login-success', loginSuccessHandler)
  
  // 监听全局搜索触发事件
  searchHandler = (event) => {
    const { query } = event.detail
    searchQuery.value = query
    performSearch(query)
  }
  window.addEventListener('trigger-search', searchHandler)

  const update = () => {
    const now = new Date()
    nowText.value = formatDateTime(now)
    weekdayText.value = formatWeekday(now)
  }
  update()
  timerId = window.setInterval(update, 1000)
  
  // 获取用户位置
  getUserLocation()
  
  // 提供全局位置状态给子组件
  provide('userLocation', userLocation)
  provide('locationPermission', locationPermission)
  provide('locationError', locationError)
  
  // 添加点击外部关闭事件
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  if (timerId) {
    window.clearInterval(timerId)
  }
  document.removeEventListener('click', handleClickOutside)
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  if (loginSuccessHandler) {
    window.removeEventListener('login-success', loginSuccessHandler)
  }
  if (searchHandler) {
    window.removeEventListener('trigger-search', searchHandler)
  }
})
</script>

<template>
  <!-- 登录/注册页：全屏独立布局 -->
  <router-view v-if="isAuthPage" />
  
  <!-- 其他页面：带侧边栏的完整布局 -->
  <div v-else class="layout">
    <header class="header">
      <div class="header-overlay"></div>
      <div class="header-inner">
        <div class="header-left">
          <h1>淄博市张店区三维公共服务设施平台</h1>
        </div>
        <div class="header-right">
          <div class="header-info">
            <div class="weather-time">
              <WeatherWidget />
              <div class="time-line">
                <span class="time">{{ nowText }}</span>
                <span class="weekday">{{ weekdayText }}</span>
              </div>
            </div>
            <div class="global-search">
              <div class="search-input-wrapper">
                <input 
                  v-model="searchQuery"
                  @input="onSearchInput"
                  @focus="showSearchResults = searchResults.length > 0"
                  type="text" 
                  placeholder="搜索设施、地点..." 
                  class="search-input"
                />
                <div class="search-icon">🔍</div>
                <div v-if="isSearching" class="search-loading"></div>
              </div>
              
              <!-- 搜索结果下拉 -->
              <div v-show="showSearchResults && searchResults.length > 0" class="search-results">
                <div 
                  v-for="result in searchResults" 
                  :key="result.id"
                  class="search-result-item"
                  @click="handleSearchResultClick(result)"
                >
                  <div class="result-info">
                    <div class="result-name">{{ result.name }}</div>
                    <div class="result-details">
                      <span class="result-type">{{ result.typeName }}</span>
                      <span class="result-source">{{ result.source }}</span>
                    </div>
                    <div class="result-address">{{ result.address }}</div>
                  </div>
                  <div class="result-action">
                    <span v-if="result.type === 'facility'" class="action-badge">三维</span>
                    <span v-else class="action-badge">二维</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- 用户登录状态 -->
            <div v-if="isLoggedIn" class="user-info" @click="handleLogout">
              <span class="user-name">{{ currentUser?.realName || currentUser?.username }}</span>
              <span class="logout-hint">退出登录</span>
            </div>
            <router-link v-else to="/login" class="user-avatar" title="登录">
              <span>登录</span>
            </router-link>
          </div>
        </div>
      </div>
    </header>

    <div class="body">
      <nav class="sider">
        <div class="sider-section">
          <div class="sider-section-title">首页</div>
          <ul>
            <li><router-link to="/home">首页</router-link></li>
          </ul>
        </div>

        <div class="sider-section">
          <div class="sider-section-title">三维地图</div>
          <ul>
            <li><router-link to="/map">三维地图</router-link></li>
           
          </ul>
        </div>

        <div class="sider-section">
          <div class="sider-section-title">设施管理</div>
          <ul>
            <li><router-link to="/facilities">设施管理</router-link></li>
          </ul>
        </div>

        <div v-if="currentUser?.role === 'admin' || currentUser?.role === 'reviewer'" class="sider-section">
          <div class="sider-section-title">灾情管理</div>
          <ul>
            <li><router-link to="/disaster-manage">灾情管理</router-link></li>
          </ul>
        </div>

        <div class="sider-section">
          <div class="sider-section-title">路线规划</div>
          <ul>
            <li><router-link to="/route">路线规划</router-link></li>
          </ul>
        </div>

        <div class="sider-section">
          <div class="sider-section-title">个人中心 / 设置</div>
          <ul>
            <li><router-link to="/profile">个人中心</router-link></li>
            <li><router-link to="/settings">设置</router-link></li>
          </ul>
        </div>
      </nav>

      <main class="content">
        <div class="content-inner">
          <router-view />
        </div>
      </main>
    </div>
  </div>

  <!-- 位置权限弹窗（仅非登录页显示）-->
  <div v-if="showLocationDialog" class="location-dialog-overlay">
    <div class="location-dialog">
      <div class="dialog-header">
        <h3>📍 位置权限请求</h3>
      </div>
      <div class="dialog-body">
        <p>为了提供更好的地图服务体验，我们需要获取您的位置信息。</p>
        <p>这将帮助我们：</p>
        <ul>
          <li>🗺️ 自动定位到您的当前位置</li>
          <li>🏥 显示附近的公共服务设施</li>
          <li>🚶 提供个性化的导航服务</li>
        </ul>
        <p class="privacy-note">您的位置信息仅用于地图服务，不会用于其他用途。</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-deny" @click="denyLocationAccess">拒绝</button>
        <button class="btn-allow" @click="confirmLocationAccess">允许</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-image: url('/img/淄博市张店区航拍图.jpg');
  background-size: cover;
  background-position: center center;
  background-attachment: fixed;
}

.header {
  position: relative;
  color: #fff;
  padding: 1.0rem 1.5rem;
  overflow: visible;
  z-index: 100;
}

.header::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(90deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.78));
  opacity: 1;
  z-index: 0;
}

.header-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.4); /* 额外的 40% 遮罩，约等于 50% 整体透明效果 */
  z-index: 1;
}

.header-inner {
  position: relative;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: visible;
}

.header-left h1 {
  font-size: 1.5rem; /* 比原来小一号 */
  font-weight: 600;
  margin: 0.3rem 0;
}

.header-right {
  display: flex;
  align-items: center;
  overflow: visible;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.weather-time {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
  text-align: right;
}

.weather-main {
  font-weight: 600;
}

.weather-sub {
  opacity: 0.85;
  font-size: 0.7rem;
}

.time {
  opacity: 0.85;
}

.weekday {
  opacity: 0.8;
  margin-left: 0.4rem;
}

.search-box input {
  height: 2rem;
  border-radius: 999px;
  border: none;
  padding: 0 0.75rem;
  font-size: 0.8rem;
  min-width: 180px;
}

.search-box input:focus {
  outline: 2px solid rgba(59, 130, 246, 0.7);
}

/* 全局搜索样式 */
.global-search {
  position: relative;
  min-width: 280px;
  z-index: 1000;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input {
  height: 2.2rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  padding: 0 2.5rem 0 0.75rem;
  font-size: 0.85rem;
  min-width: 280px;
  background: rgba(15, 23, 42, 0.8);
  color: #e5e7eb;
  transition: all 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  background: rgba(15, 23, 42, 0.95);
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-icon {
  position: absolute;
  right: 0.75rem;
  color: #9ca3af;
  font-size: 0.9rem;
  pointer-events: none;
}

.search-loading {
  position: absolute;
  right: 2.5rem;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.5rem;
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  max-height: 400px;
  overflow-y: auto;
  z-index: 9999;
  min-width: 300px;
}

.search-result-item {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: rgba(30, 41, 59, 0.8);
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e5e7eb;
  margin-bottom: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-details {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.result-type {
  font-size: 0.75rem;
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.2);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.result-source {
  font-size: 0.75rem;
  color: #9ca3af;
}

.result-address {
  font-size: 0.8rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-action {
  flex-shrink: 0;
  margin-left: 0.75rem;
}

.action-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  text-transform: uppercase;
}

.action-badge:first-child {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.action-badge:last-child {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

/* 滚动条样式 */
.search-results::-webkit-scrollbar {
  width: 6px;
}

.search-results::-webkit-scrollbar-track {
  background: rgba(148, 163, 184, 0.1);
  border-radius: 3px;
}

.search-results::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.3);
  border-radius: 3px;
}

.search-results::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
  background: rgba(15, 23, 42, 0.4);
}

.user-avatar:hover {
  background: rgba(59, 130, 246, 0.6);
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0.25rem 0.75rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s ease;
}

.user-info:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
}

.user-name {
  font-size: 0.75rem;
  font-weight: 500;
  color: #e5e7eb;
}

.logout-hint {
  font-size: 0.65rem;
  color: #9ca3af;
  margin-top: 2px;
}

.user-info:hover .logout-hint {
  color: #f87171;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.sider {
  width: 160px;
  background: radial-gradient(circle at top, rgba(15, 23, 42, 0.95) 0, rgba(15, 23, 42, 0.88) 55%);
  padding: 0.75rem 0.5rem 1rem;
  border-right: 1px solid #111827;
  color: #e5e7eb;
  flex-shrink: 0;
}

.sider-section + .sider-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed #e5e7eb;
}

.sider-section-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: #9ca3af;
  margin-bottom: 0.35rem;
}

.sider ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sider li {
  margin-bottom: 0.5rem;
}

.sider a {
  display: block;
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  color: #e5e7eb;
  text-decoration: none;
  font-size: 0.85rem;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  border: 1px solid transparent;
}

.sider a:hover {
  background: rgba(37, 99, 235, 0.12);
  color: #bfdbfe;
  box-shadow: inset 3px 0 0 #3b82f6;
}

.sider a.router-link-active {
  font-weight: 600;
  color: #eff6ff;
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.65), rgba(59, 130, 246, 0.85));
  border-color: rgba(191, 219, 254, 0.55);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6), 0 14px 35px rgba(15, 23, 42, 0.8);
}

.sider-item-disabled {
  padding: 0.4rem 0.75rem;
  border-radius: 0.375rem;
  color: #6b7280;
  background: rgba(15, 23, 42, 0.75);
  border: 1px dashed rgba(55, 65, 81, 0.9);
  font-size: 0.8rem;
  cursor: default;
}

.content {
  flex: 1;
  padding: 1rem 1.5rem 1.25rem;
  overflow: auto;
  background: radial-gradient(circle at top, rgba(15, 23, 42, 0.94) 0, rgba(15, 23, 42, 0.96) 55%, rgba(15, 23, 42, 0.98) 100%);
}

.content-inner {
  min-height: 100%;
  border-radius: 0.9rem;
  padding: 1rem 1.25rem;
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #e5e7eb;
}

/* 位置权限弹窗样式 */
.location-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.location-dialog {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  border-radius: 12px;
  padding: 2rem;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(148, 163, 184, 0.2);
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.2rem;
  color: #f1f5f9;
  font-weight: 600;
}

.dialog-body {
  margin-bottom: 1.5rem;
}

.dialog-body p {
  margin: 0 0 1rem;
  color: #e2e8f0;
  line-height: 1.6;
  font-size: 0.9rem;
}

.dialog-body ul {
  margin: 0.5rem 0 1rem 1rem;
  padding: 0;
}

.dialog-body li {
  margin-bottom: 0.5rem;
  color: #cbd5e1;
  font-size: 0.85rem;
}

.privacy-note {
  font-size: 0.8rem !important;
  color: #94a3b8 !important;
  font-style: italic;
}

.dialog-footer {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.btn-deny, .btn-allow {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-deny {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.btn-deny:hover {
  background: rgba(239, 68, 68, 0.2);
}

.btn-allow {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.btn-allow:hover {
  background: rgba(34, 197, 94, 0.2);
}

/* ==================== 浅色主题样式 ==================== */

/* 全局浅色主题变量 */
body.light-theme {
  --bg-primary: #f8fafc;
  --bg-secondary: #ffffff;
  --bg-card: rgba(255, 255, 255, 0.95);
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --border-color: #e2e8f0;
  --accent-color: #3b82f6;
  --accent-hover: #2563eb;
  --shadow-color: rgba(0, 0, 0, 0.08);
  color: #1e293b;
}

/* 全局字体颜色重置 - 强制所有元素继承 */
body.light-theme,
body.light-theme * {
  color: #1e293b !important;
}

/* 特定元素字体颜色 - 覆盖特定的深色文字 */
body.light-theme h1, 
body.light-theme h2, 
body.light-theme h3, 
body.light-theme h4, 
body.light-theme h5, 
body.light-theme h6,
body.light-theme p,
body.light-theme span,
body.light-theme div,
body.light-theme label,
body.light-theme li,
body.light-theme a,
body.light-theme button,
body.light-theme input,
body.light-theme select,
body.light-theme textarea {
  color: var(--text-primary) !important;
}

body.light-theme .text-secondary,
body.light-theme .muted,
body.light-theme small {
  color: var(--text-secondary) !important;
}

/* 布局背景 */
body.light-theme .layout {
  background-image: none;
  background-color: var(--bg-primary);
}

/* 头部样式 */
body.light-theme .header {
  border-bottom: 1px solid #1e293b !important;
}

body.light-theme .header::before {
  background-image: linear-gradient(90deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.92));
}

body.light-theme .header-overlay {
  background: rgba(255, 255, 255, 0.1);
}

body.light-theme .header-left h1,
body.light-theme .header-info,
body.light-theme .header-info * {
  color: #1e293b !important;
}

body.light-theme .header-left h1 {
  color: #1e293b !important;
}

/* 搜索框 */
body.light-theme .search-input {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-color);
}

body.light-theme .search-input::placeholder {
  color: var(--text-muted);
}

body.light-theme .search-input:focus {
  background: var(--bg-secondary);
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

body.light-theme .search-icon {
  color: var(--text-muted);
}

/* 搜索结果 */
body.light-theme .search-results {
  background: var(--bg-secondary);
  border-color: var(--border-color);
  box-shadow: 0 10px 30px var(--shadow-color);
}

body.light-theme .search-result-item:hover {
  background: var(--bg-primary);
}

body.light-theme .result-name {
  color: var(--text-primary);
}

body.light-theme .result-address {
  color: var(--text-secondary);
}

body.light-theme .result-source {
  color: var(--text-muted);
}

/* 侧边栏 */
body.light-theme .sider {
  background: var(--bg-secondary);
  border-right-color: var(--border-color);
  color: var(--text-primary);
}

body.light-theme .sider-section-title {
  color: var(--text-secondary);
}

body.light-theme .sider a {
  color: var(--text-primary);
}

body.light-theme .sider a:hover {
  background: rgba(59, 130, 246, 0.08);
  color: var(--accent-color);
  box-shadow: inset 3px 0 0 var(--accent-color);
}

body.light-theme .sider a.router-link-active {
  color: var(--accent-color);
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.15));
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6), 0 4px 12px rgba(59, 130, 246, 0.15);
}

/* 内容区域 */
body.light-theme .content {
  background: var(--bg-primary);
}

body.light-theme .content-inner {
  background: var(--bg-card);
  border-color: var(--border-color);
  box-shadow: 0 4px 20px var(--shadow-color);
  color: var(--text-primary);
}

/* 用户信息卡片 */
body.light-theme .user-info {
  background: var(--bg-secondary);
  border-color: var(--border-color);
}

body.light-theme .user-name {
  color: var(--text-primary);
}

body.light-theme .logout-hint {
  color: var(--text-secondary);
}

/* 用户头像 */
body.light-theme .user-avatar {
  background: var(--bg-secondary);
  border-color: var(--border-color);
  color: var(--text-primary);
}

/* 弹窗 */
body.light-theme .location-dialog-overlay {
  background: rgba(0, 0, 0, 0.5);
}

body.light-theme .location-dialog {
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border-color: var(--border-color);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

body.light-theme .dialog-header h3 {
  color: var(--text-primary);
}

body.light-theme .dialog-body p {
  color: var(--text-secondary);
}

body.light-theme .dialog-body li {
  color: var(--text-secondary);
}

body.light-theme .privacy-note {
  color: var(--text-muted) !important;
}

/* 按钮样式 */
body.light-theme .btn-deny {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.2);
}

body.light-theme .btn-allow {
  background: rgba(34, 197, 94, 0.05);
  border-color: rgba(34, 197, 94, 0.2);
}

/* 标签徽章 */
body.light-theme .action-badge:first-child {
  background: rgba(34, 197, 94, 0.1);
}

body.light-theme .action-badge:last-child {
  background: rgba(59, 130, 246, 0.1);
}

/* 结果类型标签 */
body.light-theme .result-type {
  background: rgba(59, 130, 246, 0.1);
}

/* 滚动条 */
body.light-theme .search-results::-webkit-scrollbar-track {
  background: var(--bg-primary);
}

body.light-theme .search-results::-webkit-scrollbar-thumb {
  background: var(--border-color);
}

body.light-theme .search-results::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* 分隔线 */
body.light-theme .sider-section + .sider-section {
  border-top-color: var(--border-color);
}

/* 搜索加载动画 */
body.light-theme .search-loading {
  border-color: rgba(59, 130, 246, 0.2);
  border-top-color: var(--accent-color);
}

/* ==================== 系统设置页面样式 ==================== */

/* 设置卡片标题 */
body.light-theme .settings-card h3 {
  color: var(--text-primary);
}

/* 设置项标签 */
body.light-theme .settings-item label {
  color: var(--text-primary);
}

/* 设置项描述 */
body.light-theme .settings-item .description {
  color: var(--text-secondary);
}

/* 设置页主标题 */
body.light-theme .settings-page h2 {
  color: var(--text-primary);
}

/* 下拉选择框 */
body.light-theme .settings-item select {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-color);
}

/* 保存按钮 */
body.light-theme .save-btn {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
}

/* 保存成功提示 */
body.light-theme .save-toast {
  background: rgba(34, 197, 94, 0.9);
  color: white;
}

/* 开关按钮轨道 */
body.light-theme .toggle-track {
  background: var(--border-color);
}

body.light-theme .toggle-track.active {
  background: var(--accent-color);
}

/* ==================== 全局浅色主题强制覆盖 ==================== */

/* 首页右上角提示 */
body.light-theme .home-tag,
body.light-theme .data-source,
body.light-theme .update-time,
body.light-theme .header-badge {
  color: #1e293b !important;
  background: rgba(255, 255, 255, 0.9) !important;
  border: 1px solid #e2e8f0 !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05) !important;
}

/* 三维地图工具栏 */
body.light-theme .toolbar {
  background: rgba(255, 255, 255, 0.95) !important;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1) !important;
}

body.light-theme .toolbar-btn {
  background: #ffffff !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
}

body.light-theme .toolbar-btn:hover {
  background: #f8fafc !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

/* 设施列表页 - 强制覆盖所有元素 */
body.light-theme .facilities-page,
body.light-theme .facilities-page * {
  color: #1e293b;
}

body.light-theme .facilities-page {
  background: #f8fafc !important;
}

body.light-theme .fac-page-header h1,
body.light-theme .fac-page-header h2 {
  color: #1e293b !important;
}

body.light-theme .fac-page-header p {
  color: #64748b !important;
}

body.light-theme .fac-toolbar {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-search-input,
body.light-theme .fac-search-input::placeholder {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-type-tabs {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-tab {
  color: #64748b !important;
}

body.light-theme .fac-tab.active {
  color: #3b82f6 !important;
  background: rgba(59, 130, 246, 0.1) !important;
}

body.light-theme .fac-create-section {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
  color: #1e293b !important;
}

body.light-theme .fac-create-section h3 {
  color: #1e293b !important;
}

body.light-theme .create-fields label {
  color: #1e293b !important;
}

body.light-theme .create-fields input,
body.light-theme .create-fields select,
body.light-theme .create-fields textarea {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .create-fields .hint {
  color: #64748b !important;
}

body.light-theme .fac-list-section {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
  color: #1e293b !important;
}

body.light-theme .fac-list-section h3 {
  color: #1e293b !important;
}

body.light-theme .fac-table {
  color: #1e293b !important;
}

body.light-theme .fac-table th {
  background: #f8fafc !important;
  color: #1e293b !important;
}

body.light-theme .fac-table td {
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-empty {
  color: #94a3b8 !important;
}

body.light-theme .pagination {
  background: #ffffff !important;
}

body.light-theme .pagination * {
  color: #1e293b !important;
}

body.light-theme .action-btn {
  color: #1e293b !important;
}

/* ==================== 强制覆盖：三维地图工具栏 ==================== */
body.light-theme .map-toolbar {
  background: rgba(255, 255, 255, 0.95) !important;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1) !important;
}

body.light-theme .tool-btn {
  background: #ffffff !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
}

body.light-theme .tool-btn:hover {
  background: #f8fafc !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

body.light-theme .tool-btn.active {
  background: rgba(59, 130, 246, 0.1) !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

/* ==================== 强制覆盖：设施列表页 ==================== */
body.light-theme .fac-page,
body.light-theme .fac-page .fac-create,
body.light-theme .fac-page .fac-list {
  background: #ffffff !important;
  color: #1e293b !important;
}

body.light-theme .fac-page *,
body.light-theme .fac-page .fac-create *,
body.light-theme .fac-page .fac-list * {
  color: #1e293b !important;
}

body.light-theme .fac-page input,
body.light-theme .fac-page select,
body.light-theme .fac-page textarea {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-page .form-label,
body.light-theme .fac-page label {
  color: #1e293b !important;
}

body.light-theme .fac-page .hint,
body.light-theme .fac-page .help-text {
  color: #64748b !important;
}

body.light-theme .fac-page table {
  background: #ffffff !important;
}

body.light-theme .fac-page table th,
body.light-theme .fac-page table td {
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-page table th {
  background: #f8fafc !important;
}

body.light-theme .fac-page table td {
  background: #ffffff !important;
}

/* 设施列表页按钮样式 */
body.light-theme .fac-page .btn,
body.light-theme .fac-page button {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-page .btn:hover,
body.light-theme .fac-page button:hover {
  background: #e2e8f0 !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

body.light-theme .fac-page .btn-primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
  color: white !important;
}

body.light-theme .fac-page .btn-danger {
  background: linear-gradient(135deg, #dc2626, #b91c1c) !important;
  color: white !important;
}

/* 特定按钮样式 */
body.light-theme .fac-page .btn-outline {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-page .btn-outline:hover {
  background: #e2e8f0 !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

body.light-theme .fac-page .btn-add {
  background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
  color: white !important;
}

/* 表格区域样式 */
body.light-theme .fac-page .fac-table-wrap {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-page .table-scroll {
  background: #ffffff !important;
}

body.light-theme .fac-page .fac-table {
  background: #ffffff !important;
}

body.light-theme .fac-page .fac-table th {
  background: #f8fafc !important;
  color: #1e293b !important;
}

body.light-theme .fac-page .fac-table td {
  background: #ffffff !important;
  color: #1e293b !important;
}
</style>
