<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'

// 高德 Web JS API Key 和安全密钥（只在前端开发环境使用）
const AMAP_MAP_KEY = '664e5e7e33673e5fb1f99ded7979abdd' // 地图API Key（仅用于地图显示）
const AMAP_DIRECTION_KEY = '0b440760c47124fdfe1d1a4961f6d4dc' // 使用搜索/高权限 Key 用于路径规划
const AMAP_SEARCH_KEY = '0b440760c47124fdfe1d1a4961f6d4dc' // 搜索API Key（用于高精度定位）
const AMAP_SECURITY_CODE = 'e5d2676893cfd6c5785e1297392998d9'

const mapContainer = ref(null)
let amapInstance = null
let satelliteLayer = null
let roadNetLayer = null
let searchMarker = null
let infoWindow = null
let userLocationMarker = null
const isManualCalibratingLocation = ref(false) // 精度不达标时，下一次地图点击用于手动校准
let routeLine = null // 路径线
let walkingPolylines = [] // 新增：存储步行轨迹对象数组
let startMarker = null // 起点标记
let endMarker = null // 终点标记
const walkingCache = new Map() // 新增：步行数据缓存，避免重复请求相同的起点终点
const baseType = ref('vector') // 'vector' | 'image'

// 自定义换乘站（文档 2.2：用户在重合段内选择换乘站）
const customTransfer = ref({
  isActive: false,
  stopName: '',
  fromSegIndex: -1,
  toSegIndex: -1
})

// 自定义换乘站选择面板
const showTransferPicker = ref(false)
const transferPicker = ref({
  fromSegIndex: -1,
  toSegIndex: -1,
  candidates: [] // { name, walkingDistance }
})

// 路径规划状态
const routePlanning = ref({
  isActive: false,
  startPoint: null,
  endPoint: null,
  travelMode: 'driving', // 'driving' | 'walking' | 'transit'
  isPrePlanning: false, // 是否正在预规划
  prePlannedRoutes: null // 预规划的路线结果
})

// 路线规划配置
const routeConfig = {
  walkingDistanceThreshold: 2000, // 步行距离阈值（米）
  transferWalkingThreshold: 400, // 换乘步行阈值（米）
  transferWalkingTimeThreshold: 5, // 换乘步行时间阈值（分钟）
  maxConcurrentRequests: 3, // 最大并发请求数
  apiRetryCount: 2, // API重试次数
  apiRetryDelay: 1000, // API重试延迟（毫秒）
  batchRequestDelay: 500, // 批量请求延迟（毫秒）
  debounceDelay: 300, // 防抖延迟（毫秒）
  throttleDelay: 100 // 节流延迟（毫秒）
}

// 缓存管理
const cacheManager = {
  // 内存缓存（当前会话）
  memoryCache: new Map(),
  // 本地缓存（24小时有效）
  localCache: {
    get(key) {
      const item = localStorage.getItem(`route_cache_${key}`)
      if (item) {
        const data = JSON.parse(item)
        if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
          return data.value
        }
        localStorage.removeItem(`route_cache_${key}`)
      }
      return null
    },
    set(key, value) {
      localStorage.setItem(`route_cache_${key}`, JSON.stringify({
        value,
        timestamp: Date.now()
      }))
    },
    clear() {
      // 清理超过7天的缓存
      const keys = Object.keys(localStorage)
      const now = Date.now()
      keys.forEach(key => {
        if (key.startsWith('route_cache_')) {
          const item = localStorage.getItem(key)
          if (item) {
            const data = JSON.parse(item)
            if (now - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
              localStorage.removeItem(key)
            }
          }
        }
      })
    }
  }
}

// API请求队列管理
const apiQueue = {
  queue: [],
  running: 0,
  maxConcurrent: routeConfig.maxConcurrentRequests,
  
  async add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject })
      this.process()
    })
  },
  
  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return
    }
    
    this.running++
    const { requestFn, resolve, reject } = this.queue.shift()
    
    try {
      const result = await requestFn()
      resolve(result)
    } catch (error) {
      reject(error)
    } finally {
      this.running--
      this.process()
    }
  }
}

// 防抖函数
const debounce = (func, delay) => {
  let timeoutId
  return function (...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func.apply(this, args), delay)
  }
}

// 节流函数
const throttle = (func, delay) => {
  let lastCall = 0
  return function (...args) {
    const now = Date.now()
    if (now - lastCall >= delay) {
      lastCall = now
      return func.apply(this, args)
    }
  }
}

// 路径规划表单
const routeForm = ref({
  startAddress: '',
  endAddress: '',
  currentLocation: null // 存储用户当前位置
})

// 起点搜索相关
const startSearchResults = ref([])
const isStartSearching = ref(false)
const showStartSearchResults = ref(false)

// 终点搜索相关
const endSearchResults = ref([])
const isEndSearching = ref(false)
const showEndSearchResults = ref(false)

// 路径规划结果相关
const routeResults = ref([])
const showRouteResults = ref(false)
const selectedRouteIndex = ref(0)
const showRouteStations = ref(false) // 是否显示站点详情
const selectedRouteStations = ref([]) // 当前选中路线的站点信息

// 路线规划历史记录
const routeHistory = ref([])
const maxHistoryCount = 10
const showHistory = ref(false) // 历史记录面板显示状态

// 站点筛选配置
const stopFilterConfig = {
  // 上车站点筛选权重
  startStopWeights: {
    walkingDistance: 0.4,
    lineCoverage: 0.3,
    operatingHours: 0.2,
    accessibility: 0.1
  },
  // 换乘站点筛选权重
  transferStopWeights: {
    walkingDistance: 0.5,
    operatingHours: 0.3,
    samePlatform: 0.2
  },
  // 下车站点筛选权重
  endStopWeights: {
    walkingDistance: 0.6,
    operatingHours: 0.3,
    accessibility: 0.1
  }
}

// 路线排序配置
const routeSortConfig = {
  default: {
    time: 0.6,
    transfers: 0.4,
    maxTransfers: 2
  },
  minTransfer: {
    transfers: 1,
    timeTolerance: 0.2,
    walkingTolerance: 0.2
  },
  minWalking: {
    walking: 1,
    timeTolerance: 0.3
  },
  minCost: {
    cost: 1,
    excludeSubway: true,
    excludeCustomBus: true
  }
}

// 公交方案排序模式
// time: 时间最短；walking: 步行最少；cost: 花费最少
const transitSortMode = ref('time')

// 驾车/步行路线排序模式
// time: 时间最短；distance: 距离最短
const nonTransitSortMode = ref('time')

// 出行方式选项
const travelModes = [
  { value: 'driving', label: '驾车', icon: '🚗' },
  { value: 'walking', label: '步行', icon: '🚶‍♀️' },
  { value: 'transit', label: '公交', icon: '🚌' }
]
  
// 处理全局搜索事件
const handleLocationSearch = (event) => {
  const { longitude, latitude, name } = event.detail
    if (amapInstance) {
    // 确保坐标是数字类型
    const lng = Number(longitude)
    const lat = Number(latitude)
    
    if (!isNaN(lng) && !isNaN(lat)) {
      // 移除之前的标记
      if (searchMarker) {
        amapInstance.remove(searchMarker)
      }
      
      // 添加新标记
      searchMarker = new AMap.Marker({
        position: [lng, lat],
        title: name || '搜索位置',
        animation: 'AMAP_ANIMATION_DROP'
      })
      
      amapInstance.add(searchMarker)
      amapInstance.setCenter([lng, lat])
      amapInstance.setZoom(15)
    }
  }
}

// 处理全局搜索结果
const handleGlobalSearchResult = (event) => {
  const { result } = event.detail
  if (result && amapInstance) {
    const lng = Number(result.location.lng)
    const lat = Number(result.location.lat)
    
    if (!isNaN(lng) && !isNaN(lat)) {
      // 移除之前的标记
      if (searchMarker) {
        amapInstance.remove(searchMarker)
      }
      
      // 添加新标记
      searchMarker = new AMap.Marker({
        position: [lng, lat],
        title: result.name || '搜索位置',
        animation: 'AMAP_ANIMATION_DROP'
      })
      
      amapInstance.add(searchMarker)
      amapInstance.setCenter([lng, lat])
      amapInstance.setZoom(15)
    }
  }
}

// 路径规划功能

// WGS84到GCJ02坐标转换函数
// 统一返回对象 { lng, lat }，避免部分调用方把数组当对象用导致运行时异常
const wgs84ToGcj02 = (lng, lat) => {
  // 简化的坐标转换算法
  const a = 6378245.0
  const ee = 0.00669342162296594323
  const pi = 3.14159265358979324
  
  if (outOfChina(lng, lat)) {
    return { lng, lat }
  }
  
  let dlat = transformLat(lng - 105.0, lat - 35.0)
  let dlng = transformLng(lng - 105.0, lat - 35.0)
  const radlat = lat / 180.0 * pi
  let magic = Math.sin(radlat)
  magic = 1 - ee * magic * magic
  const sqrtmagic = Math.sqrt(magic)
  dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * pi)
  dlng = (dlng * 180.0) / (a / sqrtmagic * Math.cos(radlat) * pi)
  const mglat = lat + dlat
  const mglng = lng + dlng
  
  return { lng: mglng, lat: mglat }
}

// 兼容：需要数组解构的场景使用此方法
const wgs84ToGcj02Arr = (lng, lat) => {
  const p = wgs84ToGcj02(lng, lat)
  return [p.lng, p.lat]
}

// 统一把点转成 GCJ02（高德底图坐标体系）。
// point._coord 用于标记输入坐标系，避免对已经是 gcj02 的点做二次换算导致精度丢失。
const toGcj02Arr = (point) => {
  const lng = Number(point?.lng)
  const lat = Number(point?.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [lng, lat]

  // 只有当明确标记为 gps/wgs84 时才做转换；其余情况默认已经是 gcj02。
  if (point?._coord === 'gps' || point?._coord === 'wgs84') {
    return wgs84ToGcj02Arr(lng, lat)
  }
  return [lng, lat]
}


const transformLat = (lng, lat) => {
  const pi = 3.14159265358979324
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += (20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(lat * pi) + 40.0 * Math.sin(lat / 3.0 * pi)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(lat / 12.0 * pi) + 320 * Math.sin(lat * pi / 30.0)) * 2.0 / 3.0
  return ret
}

const transformLng = (lng, lat) => {
  const pi = 3.14159265358979324
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += (20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(lng * pi) + 40.0 * Math.sin(lng / 3.0 * pi)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(lng / 12.0 * pi) + 300.0 * Math.sin(lng / 30.0 * pi)) * 2.0 / 3.0
  return ret
}

const outOfChina = (lng, lat) => {
  return (lng < 72.004 || lng > 137.8347) || ((lat < 0.8293 || lat > 55.8271) || false)
}

// 临时静态地图 URL 生成函数（用于恢复地图显示）
const getStaticMapUrl = (lng = 116.397428, lat = 39.90923, zoom = 12) => {
  const size = '1024*768'
  const markers = `mid,0xFF0000,A:${lng},${lat}`
  return `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=${zoom}&size=${size}&markers=${markers}&key=${AMAP_SEARCH_KEY}`
}

// 网络连接检测
const checkNetworkConnection = async () => {
  try {
    // 检查是否能访问高德API域名
    const response = await fetch('https://webapi.amap.com/maps?v=2.0', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache'
    })
    console.log('网络连接正常')
    return true
  } catch (error) {
    console.error('网络连接检查失败:', error)
    return false
  }
}

// 加载高德地图脚本（带网络检测和重试）
const loadAmapScript = () => {
  return new Promise(async (resolve, reject) => {
    // 先检查网络连接
    const isNetworkOk = await checkNetworkConnection()
    if (!isNetworkOk) {
      console.error('无法连接到高德地图服务，请检查网络连接')
      alert('网络连接异常，无法加载地图。请检查网络连接后刷新页面。')
      reject(new Error('网络连接失败'))
      return
    }
    
    // convertFrom / 部分能力在脚本加载前需要先配置安全码
    window._AMapSecurityConfig = {
      securityJsCode: AMAP_SECURITY_CODE,
    }

    if (window.AMap) {
      console.log('地图SDK已加载，直接返回')
      resolve(window.AMap)
      return
    }
    
    console.log('开始加载高德地图SDK...')
    
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_MAP_KEY}&plugin=AMap.Scale,AMap.ToolBar,AMap.PlaceSearch,AMap.AutoComplete,AMap.Geocoder,AMap.Directions,AMap.Walking`
    script.async = true
    
    // 设置超时
    const timeout = setTimeout(() => {
      console.error('地图SDK加载超时')
      alert('地图加载超时，请检查网络连接或刷新页面重试。')
      reject(new Error('地图SDK加载超时'))
    }, 15000) // 15秒超时
    
    script.onload = () => {
      clearTimeout(timeout)
      console.log('地图SDK加载成功')
      
      // 验证SDK是否正确加载
      if (window.AMap && typeof window.AMap.Map === 'function') {
        resolve(window.AMap)
      } else {
        console.error('地图SDK加载不完整')
        alert('地图SDK加载不完整，请刷新页面重试。')
        reject(new Error('地图SDK加载不完整'))
      }
    }
    
    script.onerror = (error) => {
      clearTimeout(timeout)
      console.error('地图SDK加载失败:', error)
      alert('地图加载失败，请检查网络连接或联系管理员。\n错误信息: ' + (error.message || '未知错误'))
      reject(error || new Error('地图SDK加载失败'))
    }
    
    document.head.appendChild(script)
  })
}

// 网络诊断工具
window.diagnoseNetwork = async () => {
  console.log('%c=== 网络诊断工具 ===', 'color: #3B82F6; font-size: 16px; font-weight: bold')
  
  const tests = [
    {
      name: '高德地图API',
      url: 'https://webapi.amap.com/maps?v=2.0',
      description: '地图SDK加载域名'
    },
    {
      name: '高德静态地图API',
      url: 'https://restapi.amap.com/v3/staticmap',
      description: '静态地图服务域名'
    },
    {
      name: '百度',
      url: 'https://www.baidu.com',
      description: '通用网络连接测试'
    },
    {
      name: '谷歌',
      url: 'https://www.google.com',
      description: '国际网络连接测试'
    }
  ]
  
  console.log('%c1. 网络连接测试:', 'color: #10B981')
  
  for (const test of tests) {
    try {
      console.log(`测试 ${test.name}...`)
      const startTime = Date.now()
      
      const response = await fetch(test.url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache'
      })
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      console.log(`✅ ${test.name}: 连接成功 (${duration}ms)`)
    } catch (error) {
      console.error(`❌ ${test.name}: 连接失败 - ${error.message}`)
    }
  }
  
  // 检查在线状态
  console.log('%c2. 浏览器在线状态:', 'color: #10B981')
  console.log('navigator.onLine:', navigator.onLine)
  
  // 检查当前页面协议
  console.log('%c3. 页面信息:', 'color: #10B981')
  console.log('当前协议:', location.protocol)
  console.log('当前域名:', location.hostname)
  console.log('当前端口:', location.port)
  
  // API Key 检查
  console.log('%c4. API Key 配置:', 'color: #F59E0B')
  console.log('地图Key:', AMAP_MAP_KEY ? '✅ 已配置' : '❌ 未配置')
  console.log('安全码:', AMAP_SECURITY_CODE ? '✅ 已配置' : '❌ 未配置')
  
  // DNS 检查建议
  console.log('%c5. 故障排除建议:', 'color: #8B5CF6')
  console.log('1. 检查网络连接是否正常')
  console.log('2. 尝试访问 https://webapi.amap.com 确认域名可解析')
  console.log('3. 检查防火墙或代理设置')
  console.log('4. 尝试切换网络（WiFi/移动网络）')
  console.log('5. 清除浏览器缓存和DNS缓存')
  console.log('6. 检查 hosts 文件是否有相关配置')
  
  // 手动测试 URL
  console.log('%c6. 手动测试 URL:', 'color: #EF4444')
  const testUrl = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_MAP_KEY}`
  console.log('可以直接在浏览器中打开以下URL测试:')
  console.log(testUrl)
  
  return {
    timestamp: new Date().toISOString(),
    online: navigator.onLine,
    protocol: location.protocol,
    hostname: location.hostname,
    apiConfig: {
      mapKey: !!AMAP_MAP_KEY,
      securityCode: !!AMAP_SECURITY_CODE
    }
  }
}

// 调试函数 - 用于测试
window.debugRoutePlanning = async () => {
  console.log('开始调试公交路线规划功能...')
  
  // 检查关键变量
  console.log('routePlanning:', routePlanning.value)
  console.log('routeForm:', routeForm.value)
  console.log('routeResults:', routeResults.value)
  console.log('showRouteResults:', showRouteResults.value)
  
  // 检查关键函数
  console.log('planRouteFromForm:', typeof planRouteFromForm)
  console.log('getAllRoutePlans:', typeof getAllRoutePlans)
  console.log('getSingleRoutePlan:', typeof getSingleRoutePlan)
  console.log('getRouteApiUrl:', typeof getRouteApiUrl)
  
  // 检查地图实例
  console.log('amapInstance:', !!amapInstance)
  console.log('window.AMap:', !!window.AMap)
  
  // 测试API URL生成
  if (routePlanning.value.startPoint && routePlanning.value.endPoint) {
    const testUrl = getRouteApiUrl('transit', routePlanning.value.startPoint, routePlanning.value.endPoint)
    console.log('测试API URL:', testUrl)
  }
  
  return {
    routePlanning: routePlanning.value,
    routeForm: routeForm.value,
    routeResults: routeResults.value,
    showRouteResults: showRouteResults.value,
    functions: {
      planRouteFromForm: typeof planRouteFromForm,
      getAllRoutePlans: typeof getAllRoutePlans,
      getSingleRoutePlan: typeof getSingleRoutePlan,
      getRouteApiUrl: typeof getRouteApiUrl
    },
    map: {
      amapInstance: !!amapInstance,
      AMap: !!window.AMap
    }
  }
}

// 基础诊断函数
window.basicDiagnosis = () => {
  console.log('%c=== 基础诊断 ===', 'color: #EF4444; font-size: 16px; font-weight: bold')
  
  const checks = {
    mapContainer: !!mapContainer.value,
    amapInstance: !!amapInstance,
    AMapLoaded: !!window.AMap,
    AMapVersion: window.AMap ? window.AMap.version : 'N/A',
    routePlanningState: routePlanning.value,
    routeFormState: routeForm.value,
    routeResultsCount: routeResults.value.length,
    showRouteResults: showRouteResults.value
  }
  
  console.table(checks)
  
  // 检查地图状态
  if (amapInstance) {
    console.log('%c✅ 地图实例正常', 'color: #10B981')
    const center = amapInstance.getCenter()
    const zoom = amapInstance.getZoom()
    console.log(`地图中心: [${center.lng}, ${center.lat}], 缩放: ${zoom}`)
  } else {
    console.log('%c❌ 地图实例不存在', 'color: #EF4444')
  }
  
  // 检查API密钥
  console.log('%cAPI密钥检查:', 'color: #3B82F6')
  console.log('AMAP_MAP_KEY:', AMAP_MAP_KEY ? '✅ 已设置' : '❌ 未设置')
  console.log('AMAP_DIRECTION_KEY:', AMAP_DIRECTION_KEY ? '✅ 已设置' : '❌ 未设置')
  
  return checks
}

// 测试单个API调用
window.testSingleAPI = async () => {
  console.log('%c=== 测试单个API调用 ===', 'color: #F59E0B; font-size: 16px; font-weight: bold')
  
  try {
    const testStart = { lng: 118.059, lat: 36.816 }
    const testEnd = { lng: 118.089, lat: 36.826 }
    
    // 测试驾车API
    console.log('测试驾车API...')
    const drivingUrl = getRouteApiUrl('driving', testStart, testEnd)
    console.log('驾车API URL:', drivingUrl)
    
    // 测试步行API
    console.log('测试步行API...')
    const walkingUrl = getRouteApiUrl('walking', testStart, testEnd)
    console.log('步行API URL:', walkingUrl)
    
    // 测试公交API
    console.log('测试公交API...')
    const transitUrl = getRouteApiUrl('transit', testStart, testEnd)
    console.log('公交API URL:', transitUrl)
    
    return {
      drivingUrl,
      walkingUrl,
      transitUrl,
      success: true
    }
  } catch (error) {
    console.error('API测试失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// 测试基础的路线绘制
window.testBasicDrawing = async () => {
  console.log('%c=== 测试基础路线绘制 ===', 'color: #8B5CF6; font-size: 16px; font-weight: bold')
  
  try {
    if (!amapInstance) {
      throw new Error('地图实例不存在')
    }
    
    // 清除现有路线
    clearRoute()
    
    // 创建测试路线数据
    const testPath = {
      paths: [{
        polyline: '118.059,36.816;118.069,36.819;118.079,36.822;118.089,36.826',
        distance: 5000,
        duration: 600
      }]
    }
    
    console.log('测试绘制驾车路线...')
    await drawSimpleRoute(testPath, 'driving')
    
    console.log('测试绘制步行路线...')
    clearRoute()
    await drawSimpleRoute(testPath, 'walking')
    
    console.log('%c✅ 基础绘制测试完成', 'color: #10B981')
    return { success: true }
  } catch (error) {
    console.error('基础绘制测试失败:', error)
    return { success: false, error: error.message }
  }
}
// 简化的API调用测试（使用fetch）
window.testFetchAPI = async () => {
  console.log('%c=== 测试Fetch API调用 ===', 'color: #06B6D4; font-size: 16px; font-weight: bold')
  
  try {
    const testStart = { lng: 118.059, lat: 36.816 }
    const testEnd = { lng: 118.089, lat: 36.826 }
    
    // 测试驾车API
    console.log('测试驾车API（fetch）...')
    const drivingUrl = getRouteApiUrl('driving', testStart, testEnd)
    console.log('驾车API URL:', drivingUrl)
    
    try {
      const response = await fetch(drivingUrl)
      const data = await response.json()
      console.log('驾车API响应:', data)
      
      if (data.status === '1') {
        console.log('%c✅ 驾车API调用成功', 'color: #10B981')
      } else {
        console.log('%c❌ 驾车API调用失败', 'color: #EF4444', data.info)
      }
    } catch (error) {
      console.log('%c❌ 驾车API fetch失败', 'color: #EF4444', error.message)
    }
    
    return { success: true }
  } catch (error) {
    console.error('Fetch API测试失败:', error)
    return { success: false, error: error.message }
  }
}

// 修复的API调用函数
const getSingleRoutePlanFixed = async (mode, startPoint, endPoint) => {
  const apiUrl = getRouteApiUrl(mode, startPoint, endPoint)
  
  try {
    // 使用fetch方式调用
    const response = await fetch(apiUrl)
    const data = await response.json()
    
    if (data.status === '1') {
      return data
    } else {
      throw new Error(`${mode}路线规划失败: ${data?.info || '未知错误'}`)
    }
  } catch (error) {
    console.error(`${mode} API调用失败:`, error)
    throw error
  }
}

// 测试修复的API调用
window.testFixedAPI = async () => {
  console.log('%c=== 测试修复的API调用 ===', 'color: #10B981; font-size: 16px; font-weight: bold')
  
  try {
    const testStart = { lng: 118.059, lat: 36.816 }
    const testEnd = { lng: 118.089, lat: 36.826 }
    
    // 测试驾车API
    console.log('测试修复的驾车API...')
    const drivingResult = await getSingleRoutePlanFixed('driving', testStart, testEnd)
    console.log('驾车API结果:', drivingResult)
    
    // 测试步行API
    console.log('测试修复的步行API...')
    const walkingResult = await getSingleRoutePlanFixed('walking', testStart, testEnd)
    console.log('步行API结果:', walkingResult)
    
    // 测试公交API
    console.log('测试修复的公交API...')
    const transitResult = await getSingleRoutePlanFixed('transit', testStart, testEnd)
    console.log('公交API结果:', transitResult)
    
    return {
      success: true,
      driving: drivingResult,
      walking: walkingResult,
      transit: transitResult
    }
  } catch (error) {
    console.error('修复API测试失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// 一键启动完整路线规划流程
window.startCompleteRoutePlanning = async () => {
  console.log('%c🚀 一键启动完整路线规划流程', 'color: #3B82F6; font-size: 16px; font-weight: bold')
  
  try {
    // 1. 激活路线规划
    console.log('📍 步骤1: 激活路线规划...')
    routePlanning.value.isActive = true
    console.log('✅ 路线规划已激活')
    
    // 2. 设置起点（使用当前位置）
    console.log('📍 步骤2: 设置起点...')
    if (routeForm.value.currentLocation) {
      routePlanning.value.startPoint = {
        lng: routeForm.value.currentLocation.lng,
        lat: routeForm.value.currentLocation.lat,
        _coord: routeForm.value.currentLocation._coord || 'gcj02'
      }
      routeForm.value.startAddress = `当前位置 (${routeForm.value.currentLocation.lng.toFixed(4)}, ${routeForm.value.currentLocation.lat.toFixed(4)})`
      console.log('✅ 起点设置完成:', routePlanning.value.startPoint)
    } else {
      // 使用默认位置（张店区中心）
      routePlanning.value.startPoint = { lng: 118.059, lat: 36.816, _coord: 'gcj02' }
      routeForm.value.startAddress = '张店区中心'
      console.log('✅ 起点设置完成（默认位置）:', routePlanning.value.startPoint)
    }
    
    // 3. 设置终点（淄博站）
    console.log('📍 步骤3: 设置终点...')
    routePlanning.value.endPoint = { lng: 118.089, lat: 36.826, _coord: 'gcj02' }
    routeForm.value.endAddress = '淄博站'
    console.log('✅ 终点设置完成:', routePlanning.value.endPoint)
    
    // 4. 切换到公交模式
    console.log('📍 步骤4: 切换到公交模式...')
    routePlanning.value.travelMode = 'transit'
    console.log('✅ 已切换到公交模式')
    
    // 5. 启动预规划机制
    console.log('📍 步骤5: 启动预规划机制...')
    routePlanning.value.isPrePlanning = true
    console.log('✅ 预规划机制已启动')
    
    // 6. 检查最终状态
    console.log('\n📊 最终状态检查:')
    const finalState = {
      isActive: routePlanning.value.isActive,
      startPoint: routePlanning.value.startPoint,
      endPoint: routePlanning.value.endPoint,
      startAddress: routeForm.value.startAddress,
      endAddress: routeForm.value.endAddress,
      travelMode: routePlanning.value.travelMode,
      isPrePlanning: routePlanning.value.isPrePlanning,
      prePlannedRoutes: routePlanning.value.prePlannedRoutes
    }
    console.table(finalState)
    
    // 7. 等待状态更新
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 8. 执行路线规划
    console.log('\n🚀 步骤6: 执行路线规划...')
    await planRouteFromForm()
    
    // 9. 检查规划结果
    console.log('\n📊 路线规划结果:')
    const results = {
      routeResultsCount: routeResults.value.length,
      showRouteResults: showRouteResults.value,
      selectedRouteIndex: selectedRouteIndex.value
    }
    console.table(results)
    
    console.log('%c✅ 完整路线规划流程执行完成！', 'color: #10B981; font-size: 14px; font-weight: bold')
    
    return {
      success: true,
      state: finalState,
      results: results,
      message: '路线规划流程已完成，请查看地图上的路线显示'
    }
    
  } catch (error) {
    console.error('❌ 路线规划流程执行失败:', error)
    return {
      success: false,
      error: error.message,
      message: '路线规划流程执行失败，请查看控制台错误信息'
    }
  }
}

// 快速修复函数 - 只设置状态不执行规划
window.quickFixRoutePlanning = () => {
  console.log('%c🔧 快速修复路线规划状态', 'color: #F59E0B; font-size: 16px; font-weight: bold')
  
  try {
    // 激活路线规划
    routePlanning.value.isActive = true
    
    // 设置起点
    if (routeForm.value.currentLocation) {
      routePlanning.value.startPoint = {
        lng: routeForm.value.currentLocation.lng,
        lat: routeForm.value.currentLocation.lat,
        _coord: routeForm.value.currentLocation._coord || 'gcj02'
      }
      routeForm.value.startAddress = `当前位置`
    } else {
      routePlanning.value.startPoint = { lng: 118.059, lat: 36.816, _coord: 'gcj02' }
      routeForm.value.startAddress = '张店区中心'
    }
    
    // 设置终点
    routePlanning.value.endPoint = { lng: 118.089, lat: 36.826, _coord: 'gcj02' }
    routeForm.value.endAddress = '淄博站'
    
    // 切换到公交模式
    routePlanning.value.travelMode = 'transit'
    
    // 启动预规划
    routePlanning.value.isPrePlanning = true
    
    console.log('%c✅ 状态修复完成，现在可以点击"规划路线"按钮', 'color: #10B981')
    console.log('修复后的状态:', {
      isActive: routePlanning.value.isActive,
      startPoint: routePlanning.value.startPoint,
      endPoint: routePlanning.value.endPoint,
      travelMode: routePlanning.value.travelMode
    })
    
    return { success: true, message: '状态修复完成' }
  } catch (error) {
    console.error('状态修复失败:', error)
    return { success: false, error: error.message }
  }
}

window.setupUserFlow = async () => {
  console.log('%c=== 自动完成用户选点流程 ===', 'color: #8B5CF6; font-size: 16px; font-weight: bold')
  
  try {
    // 1. 激活路线规划
    console.log('1. 激活路线规划...')
    routePlanning.value.isActive = true
    console.log('路线规划状态:', routePlanning.value.isActive)
    
    // 2. 设置起点（使用当前位置或默认位置）
    console.log('2. 设置起点...')
    const startPoint = routeForm.value.currentLocation || { lng: 118.059, lat: 36.816, _coord: 'gcj02' }
    if (startPoint && !startPoint._coord) startPoint._coord = 'gcj02'
    routePlanning.value.startPoint = startPoint
    routeForm.value.startAddress = '张店区中心（测试起点）'
    console.log('起点设置完成:', routePlanning.value.startPoint)
    console.log('起点地址:', routeForm.value.startAddress)
    
    // 3. 设置终点
    console.log('3. 设置终点...')
    const endPoint = { lng: 118.089, lat: 36.826, _coord: 'gcj02' }
    routePlanning.value.endPoint = endPoint
    routeForm.value.endAddress = '测试终点（淄博站）'
    console.log('终点设置完成:', routePlanning.value.endPoint)
    console.log('终点地址:', routeForm.value.endAddress)
    
    // 4. 切换到公交模式
    console.log('4. 切换到公交模式...')
    routePlanning.value.travelMode = 'transit'
    console.log('出行模式:', routePlanning.value.travelMode)
    
    // 5. 检查最终状态
    console.log('%c✅ 用户选点流程完成', 'color: #10B981')
    console.log('最终状态:', {
      isActive: routePlanning.value.isActive,
      startPoint: routePlanning.value.startPoint,
      endPoint: routePlanning.value.endPoint,
      startAddress: routeForm.value.startAddress,
      endAddress: routeForm.value.endAddress,
      travelMode: routePlanning.value.travelMode
    })
    
    return {
      success: true,
      message: '用户选点流程已完成，可以开始路线规划'
    }
  } catch (error) {
    console.error('设置用户流程失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// 完整的用户流程测试（包含选点+规划）
window.testCompleteUserFlow = async () => {
  console.log('%c=== 完整用户流程测试 ===', 'color: #3B82F6; font-size: 16px; font-weight: bold')
  
  try {
    // 1. 设置用户选点流程
    const setupResult = await setupUserFlow()
    if (!setupResult.success) {
      throw new Error(setupResult.error)
    }
    
    // 2. 等待一秒确保状态更新
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 3. 执行路线规划
    console.log('\n开始执行路线规划...')
    await planRouteFromForm()
    
    // 4. 检查结果
    console.log('%c✅ 完整用户流程测试完成', 'color: #10B981')
    console.log('路线规划结果:', {
      resultsCount: routeResults.value.length,
      showResults: showRouteResults.value,
      selectedRoute: selectedRouteIndex.value
    })
    
    return {
      success: true,
      resultsCount: routeResults.value.length,
      showResults: showRouteResults.value
    }
  } catch (error) {
    console.error('完整用户流程测试失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}
window.testCompleteRoutePlanning = async () => {
  console.log('=== 开始完整路径规划测试 ===')
  
  try {
    // 1. 测试驾车路线规划
    console.log('\n1. 测试驾车路线规划...')
    routePlanning.value.startPoint = { lng: 118.059, lat: 36.816, _coord: 'gcj02' }
    routePlanning.value.endPoint = { lng: 118.089, lat: 36.826, _coord: 'gcj02' }
    routePlanning.value.travelMode = 'driving'
    routeForm.value.startAddress = '张店区中心'
    routeForm.value.endAddress = '测试终点'
    
    await planRouteFromForm()
    console.log('驾车路线规划结果:', routeResults.value)
    
    // 2. 测试步行路线规划
    console.log('\n2. 测试步行路线规划...')
    routePlanning.value.travelMode = 'walking'
    await planRouteFromForm()
    console.log('步行路线规划结果:', routeResults.value)
    
    // 3. 测试公交路线规划
    console.log('\n3. 测试公交路线规划...')
    routePlanning.value.travelMode = 'transit'
    await planRouteFromForm()
    console.log('公交路线规划结果:', routeResults.value)
    
    // 4. 测试路线绘制
    console.log('\n4. 测试路线绘制...')
    if (routeResults.value.length > 0) {
      console.log('测试绘制第一个路线方案...')
      await selectRoute(0)
      console.log('路线绘制完成')
    }
    
    return {
      success: true,
      drivingResults: routeResults.value.filter(r => r.mode === 'driving'),
      walkingResults: routeResults.value.filter(r => r.mode === 'walking'),
      transitResults: routeResults.value.filter(r => r.mode === 'transit'),
      totalResults: routeResults.value.length
    }
  } catch (error) {
    console.error('测试失败:', error)
    return {
      success: false,
      error: error.message,
      stack: error.stack
    }
  }
}

// 测试公交路线规划功能
window.testTransitRoute = async () => {
  console.log('开始测试公交路线规划...')
  
  try {
    // 设置测试起点和终点（淄博市内的两个点）
    const testStart = { lng: 118.059, lat: 36.816 } // 张店区中心
    const testEnd = { lng: 118.089, lat: 36.826 }   // 另一个位置
    
    console.log('测试起点:', testStart)
    console.log('测试终点:', testEnd)
    
    // 设置起点和终点
    routePlanning.value.startPoint = testStart
    routePlanning.value.endPoint = testEnd
    routePlanning.value.travelMode = 'transit'
    
    // 设置表单地址
    routeForm.value.startAddress = '张店区中心'
    routeForm.value.endAddress = '测试终点'
    
    console.log('设置完成，开始规划路线...')
    
    // 调用路线规划
    await planRouteFromForm()
    
    console.log('路线规划完成')
    console.log('路线结果:', routeResults.value)
    console.log('显示结果:', showRouteResults.value)
    
    return {
      success: true,
      results: routeResults.value,
      showResults: showRouteResults.value
    }
  } catch (error) {
    console.error('测试失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// 自动执行调试
setTimeout(() => {
  if (window.location.hostname === 'localhost') {
    console.log('%c🗺️ 公交路线规划系统调试信息', 'color: #3B82F6; font-size: 16px; font-weight: bold')
    console.log('%c🚀 推荐测试命令（一键修复）:', 'color: #10B981; font-size: 14px')
    console.log('%c• startCompleteRoutePlanning() - 一键启动完整流程', 'color: #6B7280; font-size: 12px')
    console.log('%c• quickFixRoutePlanning() - 快速修复状态', 'color: #6B7280; font-size: 12px')
    console.log('%c🔧 其他测试命令:', 'color: #F59E0B; font-size: 12px')
    console.log('%c• basicDiagnosis() - 基础系统诊断', 'color: #6B7280; font-size: 12px')
    console.log('%c• testFetchAPI() - 测试API调用', 'color: #6B7280; font-size: 12px')
    console.log('%c• testFixedAPI() - 测试修复的API', 'color: #6B7280; font-size: 12px')
    console.log('%c• testBasicDrawing() - 测试基础绘制', 'color: #6B7280; font-size: 12px')
    console.log('%c🎯 用户流程测试:', 'color: #8B5CF6; font-size: 12px')
    console.log('%c• setupUserFlow() - 自动设置起点终点', 'color: #6B7280; font-size: 12px')
    console.log('%c• testCompleteUserFlow() - 完整用户流程测试', 'color: #6B7280; font-size: 12px')
    console.log('%c📋 功能验证:', 'color: #10B981; font-size: 12px')
    console.log('%c• checkTransitPrePlanning() - 检查公交预规划', 'color: #6B7280; font-size: 12px')
  }
}, 2000)

// 专门检查公交预规划状态的函数
window.checkTransitPrePlanning = () => {
  console.log('%c🔍 检查公交预规划状态', 'color: #3B82F6; font-size: 14px; font-weight: bold')
  console.log('isActive:', routePlanning.value.isActive)
  console.log('travelMode:', routePlanning.value.travelMode)
  console.log('startPoint:', routePlanning.value.startPoint)
  console.log('endPoint:', routePlanning.value.endPoint)
  console.log('isPrePlanning:', routePlanning.value.isPrePlanning)
  console.log('prePlannedRoutes:', routePlanning.value.prePlannedRoutes)
  console.log('routeResultsCount:', routeResults.value.length)
  console.log('showRouteResults:', showRouteResults.value)
  
  if (routePlanning.value.isPrePlanning && !routePlanning.value.prePlannedRoutes) {
    console.log('%c⚠️ 预规划正在进行但数据为空', 'color: #F59E0B')
  } else if (!routePlanning.value.isPrePlanning && !routePlanning.value.prePlannedRoutes) {
    console.log('%c❌ 预规划未启动或失败', 'color: #EF4444')
  } else {
    console.log('%c✅ 预规划数据已生成', 'color: #10B981')
  }
}

// 全局定位状态管理
const locationState = ref({
  isLocating: false,
  lastResult: null,
  error: null,
  plugin: null
})

// 加载定位插件并初始化
const ensureGeolocationPlugin = () => {
  return new Promise((resolve, reject) => {
    if (window.AMap && window.AMap.Geolocation) {
      resolve();
      return;
    }
    // 定位插件使用高权限 SEARCH_KEY 单独加载，避免与地图 Key 冲突
    window.AMap.plugin('AMap.Geolocation', () => {
      resolve();
    }, { key: AMAP_SEARCH_KEY });
  });
}

// 初始化并启动定位逻辑（用户主动触发时调用）
const initLocationService = async () => {
  if (typeof window === 'undefined' || !window.AMap) return

  try {
    await ensureGeolocationPlugin();
    
    locationState.value.plugin = new window.AMap.Geolocation({
      enableHighAccuracy: true,   // 开启高精度
      timeout: 15000,             // 超时时间 15s
      positionByGPS: true,        // 强制使用 GPS 定位
      useNative: false,           // 禁用原生降级
      maximumAge: 30000,          // 允许使用 30s 内缓存
      convert: true,              // 自动偏移坐标
      showButton: false,
      GeoLocationFirst: true,
      noIpLocate: 3,              // 彻底禁止 IP 定位
      extensions: 'all'
    })

    console.log('定位服务已初始化，等待用户主动触发')
    // 不再自动启动后台静默定位，避免违反浏览器安全策略
    // startSilentLocation()
    // setInterval(startSilentLocation, 120000)
  } catch (error) {
    console.error('定位插件加载失败:', error);
  }
}

// 静默定位（后台运行）
const startSilentLocation = () => {
  if (!locationState.value.plugin) return
  
  console.log('启动后台静默定位 (强制 GPS)...')
  locationState.value.plugin.getCurrentPosition((status, result) => {
    if (status === 'complete') {
      // GPS 精度校验：放宽到 200m，适应室内环境
      if (result.accuracy > 200) {
        console.warn('后台定位精度过低:', result.accuracy, 'm');
        return;
      }
      
      locationState.value.lastResult = result
      locationState.value.error = null
      console.log('后台预定位成功 (GPS):', result.position.toString())
      
      const pos = {
        lng: result.position.lng,
        lat: result.position.lat,
        _coord: 'gcj02',
        accuracy: result.accuracy,
        location_type: result.location_type,
        timestamp: Date.now()
      }
      localStorage.setItem('userLocation', JSON.stringify(pos))
    } else {
      locationState.value.error = result
      console.warn('后台预定位失败:', result.message)
    }
  })
}

// 检查定位权限
const checkLocationPermission = async () => {
  if (!navigator.permissions) {
    console.log('浏览器不支持权限API，将直接请求定位权限')
    return 'prompt'
  }
  
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' })
    console.log('定位权限状态:', permission.state)
    
    // 监听权限变化
    permission.addEventListener('change', () => {
      console.log('定位权限状态变化:', permission.state)
    })
    
    return permission.state
  } catch (error) {
    console.error('查询定位权限失败:', error)
    return 'prompt'
  }
}

// 使用浏览器原生定位获取 WGS84 坐标（增强版）
const getNativeGeolocation = () => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持定位功能'))
      return
    }
    
    console.log('开始使用浏览器原生定位...')
    
    // 更严格的高精度配置
    const options = {
      enableHighAccuracy: true,  // 强制启用高精度
      timeout: 20000,           // 增加超时时间到20秒
      maximumAge: 0             // 禁用缓存，强制获取新的位置
    }
    
    // 不需要清除监听器，因为我们使用的是 getCurrentPosition 而不是 watchPosition
    // if (navigator.geolocation.clearWatch) {
    //   // 清除所有监听器
    //   navigator.geolocation.clearWatch()
    // }
    
    const startTime = Date.now()
    
    navigator.geolocation.getCurrentPosition(
      // 成功回调
      (position) => {
        const endTime = Date.now()
        const duration = endTime - startTime
        
        console.log('原生定位成功:', {
          position: position,
          duration: `${duration}ms`,
          accuracy: `${position.coords.accuracy}m`,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy
        })
        
        const wgs84Coords = {
          lng: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
          _coord: 'wgs84', // 标记为WGS84坐标系
          duration: duration,
          source: 'browser_native'
        }
        
        // 精度分析和建议
        if (position.coords.accuracy > 100) {
          console.warn(`定位精度较低 (${position.coords.accuracy}m)，可能原因：`)
          
          // 检测设备类型
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
          if (!isMobile) {
            console.warn('- 检测到桌面设备，建议使用移动设备测试GPS精度')
          } else {
            console.warn('- 建议移至开阔地带或窗边')
            console.warn('- 确保手机GPS功能已开启')
            console.warn('- 检查浏览器定位权限是否为“允许”')
          }
        }
        
        resolve(wgs84Coords)
      },
      // 失败回调
      (error) => {
        console.error('原生定位失败:', {
          code: error.code,
          message: error.message,
          PERMISSION_DENIED: error.PERMISSION_DENIED,
          POSITION_UNAVAILABLE: error.POSITION_UNAVAILABLE,
          TIMEOUT: error.TIMEOUT
        })
        
        let errorMessage = '定位失败'
        let suggestion = ''
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = '定位权限被拒绝'
            suggestion = '请在浏览器设置中允许定位权限，或点击地址栏的位置图标授权'
            break
          case error.POSITION_UNAVAILABLE:
            errorMessage = '无法获取位置信息'
            suggestion = '请检查GPS是否开启，或移至信号较好的地方'
            break
          case error.TIMEOUT:
            errorMessage = '定位超时'
            suggestion = '请重试或移至开阔地带'
            break
          default:
            errorMessage = '未知定位错误'
            suggestion = '请刷新页面重试'
            break
        }
        
        reject(new Error(`${errorMessage}。${suggestion}`))
      },
      options
    )
  })
}

// 精度深度诊断工具
window.diagnoseAccuracy = async () => {
  console.log('%c=== 定位精度深度诊断 ===', 'color: #3B82F6; font-size: 16px; font-weight: bold')
  
  // 1. 设备和环境分析
  console.log('%c1. 设备环境分析:', 'color: #10B981')
  
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent)
  const isDesktop = !isMobile && !isTablet
  
  console.log('设备类型:', isMobile ? '📱 移动设备' : isTablet ? '📱 平板设备' : '🖥️ 桌面设备')
  console.log('User Agent:', navigator.userAgent)
  console.log('平台:', navigator.platform)
  
  // 2. 浏览器定位能力检测
  console.log('%c2. 浏览器定位能力:', 'color: #10B981')
  console.log('支持定位:', !!navigator.geolocation)
  console.log('支持权限API:', !!navigator.permissions)
  
  // 3. 连续定位测试（分析精度稳定性）
  console.log('%c3. 连续定位测试（5次）:', 'color: #F59E0B')
  
  const results = []
  for (let i = 0; i < 5; i++) {
    try {
      console.log(`第${i + 1}次定位...`)
      const result = await getNativeGeolocation()
      results.push(result)
      console.log(`✅ 第${i + 1}次: ${result.accuracy}m, 经度${result.lng.toFixed(6)}, 纬度${result.lat.toFixed(6)}`)
      
      // 等待2秒再进行下一次
      if (i < 4) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    } catch (error) {
      console.error(`❌ 第${i + 1}次失败:`, error.message)
    }
  }
  
  // 4. 精度统计分析
  if (results.length > 0) {
    console.log('%c4. 精度统计分析:', 'color: #EF4444')
    
    const accuracies = results.map(r => r.accuracy)
    const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length
    const minAccuracy = Math.min(...accuracies)
    const maxAccuracy = Math.max(...accuracies)
    const variance = Math.max(...accuracies) - Math.min(...accuracies)
    
    console.log(`成功次数: ${results.length}/5`)
    console.log(`平均精度: ${avgAccuracy.toFixed(2)}m`)
    console.log(`最佳精度: ${minAccuracy.toFixed(2)}m`)
    console.log(`最差精度: ${maxAccuracy.toFixed(2)}m`)
    console.log(`精度波动: ${variance.toFixed(2)}m`)
    
    // 位置稳定性分析
    if (results.length >= 2) {
      const positions = results.map(r => ({ lng: r.lng, lat: r.lat }))
      let totalDistance = 0
      
      for (let i = 1; i < positions.length; i++) {
        const distance = getStraightLineDistance(positions[i-1], positions[i])
        totalDistance += distance
      }
      
      const avgDrift = totalDistance / (positions.length - 1)
      console.log(`平均位置漂移: ${avgDrift.toFixed(2)}m`)
      
      // 精度等级评估
      console.log('%c5. 精度等级评估:', 'color: #8B5CF6')
      
      if (minAccuracy <= 10) {
        console.log('🎯 优秀精度 - GPS信号良好')
      } else if (minAccuracy <= 30) {
        console.log('👍 良好精度 - 适合一般应用')
      } else if (minAccuracy <= 100) {
        console.log('⚠️ 中等精度 - 可能受环境影响')
      } else {
        console.log('❌ 较差精度 - 建议改善环境或设备')
      }
      
      // 稳定性评估
      if (variance < 20) {
        console.log('📊 精度稳定 - 信号质量一致')
      } else if (variance < 50) {
        console.log('📊 精度中等稳定 - 有轻微波动')
      } else {
        console.log('📊 精度不稳定 - 信号质量波动较大')
      }
    }
  }
  
  // 6. 针对性建议
  console.log('%c6. 改善建议:', 'color: #F59E0B')
  
  if (isDesktop) {
    console.log('🖥️ 桌面设备建议:')
    console.log('  - 桌面设备主要依赖WiFi/IP定位，精度通常50-500米')
    console.log('  - 178m在桌面设备中属于较好水平')
    console.log('  - 如需更高精度，建议使用移动设备')
  } else {
    console.log('📱 移动设备建议:')
    console.log('  - 移至窗边或开阔地带')
    console.log('  - 确保GPS功能已开启')
    console.log('  - 避免地下室和密闭空间')
    console.log('  - 检查是否在省电模式')
  }
  
  console.log('🔧 通用建议:')
  console.log('  - 确保浏览器定位权限为"允许"')
  console.log('  - 使用HTTPS协议访问')
  console.log('  - 清除浏览器缓存后重试')
  console.log('  - 尝试不同浏览器对比')
  
  return {
    deviceType: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
    results,
    summary: results.length > 0 ? {
      count: results.length,
      avgAccuracy: accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length,
      bestAccuracy: Math.min(...accuracies),
      worstAccuracy: Math.max(...accuracies)
    } : null
  }
}
window.diagnoseLocation = async () => {
  console.log('%c=== 定位诊断工具 ===', 'color: #3B82F6; font-size: 16px; font-weight: bold')
  
  // 1. 环境信息
  console.log('%c1. 环境信息:', 'color: #10B981')
  console.log('User Agent:', navigator.userAgent)
  console.log('平台:', navigator.platform)
  console.log('是否HTTPS:', location.protocol === 'https:')
  
  // 2. 设备类型检测
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent)
  console.log('%c2. 设备类型:', 'color: #10B981')
  console.log('移动设备:', isMobile)
  console.log('平板设备:', isTablet)
  console.log('桌面设备:', !isMobile && !isTablet)
  
  // 3. 权限状态检查
  console.log('%c3. 权限状态:', 'color: #10B981')
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' })
    console.log('定位权限:', permission.state)
  } catch (e) {
    console.log('权限API不支持:', e.message)
  }
  
  // 4. 测试多次定位
  console.log('%c4. 多次定位测试:', 'color: #F59E0B')
  const attempts = []
  
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`第${i + 1}次定位尝试...`)
      const result = await getNativeGeolocation()
      attempts.push({
        attempt: i + 1,
        accuracy: result.accuracy,
        lng: result.lng,
        lat: result.lat,
        duration: result.duration,
        timestamp: result.timestamp
      })
      console.log(`第${i + 1}次成功: 精度${result.accuracy}m, 耗时${result.duration}ms`)
      
      // 等待1秒再进行下一次尝试
      if (i < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(`第${i + 1}次失败:`, error.message)
      attempts.push({
        attempt: i + 1,
        error: error.message
      })
    }
  }
  
  // 5. 分析结果
  console.log('%c5. 定位分析:', 'color: #EF4444')
  const successful = attempts.filter(a => !a.error)
  
  if (successful.length > 0) {
    const accuracies = successful.map(a => a.accuracy)
    const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length
    const minAccuracy = Math.min(...accuracies)
    const maxAccuracy = Math.max(...accuracies)
    
    console.log(`成功次数: ${successful.length}/3`)
    console.log(`平均精度: ${avgAccuracy.toFixed(2)}m`)
    console.log(`最佳精度: ${minAccuracy.toFixed(2)}m`)
    console.log(`最差精度: ${maxAccuracy.toFixed(2)}m`)
    
    // 精度稳定性分析
    const accuracyVariance = Math.max(...accuracies) - Math.min(...accuracies)
    if (accuracyVariance < 10) {
      console.log('✅ 精度稳定，信号良好')
    } else if (accuracyVariance < 50) {
      console.log('⚠️ 精度中等稳定，建议改善环境')
    } else {
      console.log('❌ 精度不稳定，建议移至开阔地带')
    }
    
    // 位置变化分析
    if (successful.length >= 2) {
      const pos1 = successful[0]
      const pos2 = successful[successful.length - 1]
      const distance = getStraightLineDistance(
        { lng: pos1.lng, lat: pos1.lat },
        { lng: pos2.lng, lat: pos2.lat }
      )
      console.log(`位置漂移: ${distance.toFixed(2)}m`)
      
      if (distance < 5) {
        console.log('✅ 位置稳定')
      } else if (distance < 20) {
        console.log('⚠️ 位置有轻微漂移')
      } else {
        console.log('❌ 位置漂移较大，可能受环境影响')
      }
    }
  } else {
    console.log('❌ 所有定位尝试都失败了')
  }
  
  // 6. 建议
  console.log('%c6. 改善建议:', 'color: #8B5CF6')
  if (!isMobile) {
    console.log('📱 建议使用移动设备测试，桌面设备主要依赖WiFi定位，精度较低')
  }
  
  if (location.protocol !== 'https:') {
    console.log('🔒 建议使用HTTPS协议，某些浏览器在HTTP下会限制定位精度')
  }
  
  console.log('🪟 建议移至窗边或开阔地带')
  console.log('📡 确保设备GPS功能已开启')
  console.log('🔋 确保设备电量充足，低电量会影响GPS性能')
  
  return {
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      isHTTPS: location.protocol === 'https:',
      isMobile,
      isTablet
    },
    attempts,
    summary: {
      successCount: successful.length,
      avgAccuracy: successful.length > 0 ? successful.reduce((sum, a) => sum + a.accuracy, 0) / successful.length : null,
      bestAccuracy: successful.length > 0 ? Math.min(...successful.map(a => a.accuracy)) : null
    }
  }
}

// 获取用户位置（用户点击定位按钮时触发）
const getUserLocation = async () => {
  if (!amapInstance) return

  try {
    // 1. 检查定位权限
    const permissionState = await checkLocationPermission()
    
    if (permissionState === 'denied') {
      alert('定位权限被拒绝，请在浏览器设置中允许定位权限后重试')
      return
    }
    
    // 2. 使用浏览器原生定位获取 WGS84 坐标
    console.log('开始获取用户位置...')
    const wgs84Coords = await getNativeGeolocation()
    
    // 3. 转换为 GCJ02 坐标系
    console.log('转换坐标系: WGS84 -> GCJ02')
    const gcj02Coords = wgs84ToGcj02(wgs84Coords.lng, wgs84Coords.lat)
    gcj02Coords.accuracy = wgs84Coords.accuracy
    gcj02Coords.timestamp = wgs84Coords.timestamp
    gcj02Coords._coord = 'gcj02' // 标记为GCJ02坐标系
    
    console.log('转换后的GCJ02坐标:', gcj02Coords)
    
    // 4. 保存当前位置
    routeForm.value.currentLocation = gcj02Coords
    locationState.value.currentPosition = gcj02Coords
    locationState.value.accuracy = gcj02Coords.accuracy
    locationState.value.timestamp = gcj02Coords.timestamp
    
    // 保存到本地存储
    localStorage.setItem('userLocation', JSON.stringify(gcj02Coords))
    
    // 5. 在地图上显示位置标记
    // 移除之前的标记
    if (userLocationMarker) {
      amapInstance.remove(userLocationMarker)
    }
    if (window.userLocationCircle) {
      amapInstance.remove(window.userLocationCircle)
    }
    
    // 创建用户位置标记
    userLocationMarker = new AMap.Marker({
      position: [gcj02Coords.lng, gcj02Coords.lat],
      title: '我的位置',
      content: `
        <div style="position: relative;">
          <div style="width: 22px; height: 22px; background: #3B82F6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>
          <div style="position: absolute; top: -30px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap;">精度: ±${Math.round(gcj02Coords.accuracy)}米</div>
        </div>
      `,
      offset: new AMap.Pixel(-11, -11),
      zIndex: 1000
    })
    
    amapInstance.add(userLocationMarker)
    
    // 添加精度圆圈
    window.userLocationCircle = new AMap.Circle({
      center: [gcj02Coords.lng, gcj02Coords.lat],
      radius: gcj02Coords.accuracy,
      strokeColor: '#3B82F6',
      strokeOpacity: 0.3,
      strokeWeight: 1,
      fillColor: '#3B82F6',
      fillOpacity: 0.1,
      zIndex: 999
    })
    
    amapInstance.add(window.userLocationCircle)
    
    // 地图中心移动到用户位置
    amapInstance.setCenter([gcj02Coords.lng, gcj02Coords.lat])
    amapInstance.setZoom(16)
    
    console.log('用户位置已显示在地图上')
    
    // 6. 如果正在路线规划且起点为空，自动填充起点
    if (routePlanning.value.isActive && !routeForm.value.startAddress) {
      useCurrentLocationAsStart()
    }
    
    alert(`定位成功！精度：±${Math.round(gcj02Coords.accuracy)}米`)
    
  } catch (error) {
    console.error('获取用户位置失败:', error)
    alert(error.message || '定位失败，请重试')
  }
}

// 路径规划功能
const toggleRoutePlanning = () => {
  routePlanning.value.isActive = !routePlanning.value.isActive
  
  // 打开卡片时，如果有当前位置且起点为空，自动填充
  if (routePlanning.value.isActive && routeForm.value.currentLocation && !routeForm.value.startAddress) {
    useCurrentLocationAsStart()
  }
}

const useCurrentLocationAsStart = () => {
  if (routeForm.value.currentLocation) {
    routeForm.value.startAddress = `当前位置 (${routeForm.value.currentLocation.lng.toFixed(8)}, ${routeForm.value.currentLocation.lat.toFixed(8)})`
    routePlanning.value.startPoint = {
      lng: routeForm.value.currentLocation.lng,
      lat: routeForm.value.currentLocation.lat,
      _coord: routeForm.value.currentLocation._coord || 'gcj02'
    }
    // 若终点已存在，触发预规划（符合“选定起终点后立即预规划”的设计）
    if (routePlanning.value.endPoint) {
      prePlanRoutes(routePlanning.value.startPoint, routePlanning.value.endPoint)
    }
  } else {
    alert('请先定位获取当前位置')
  }
}

// 选定起终点后自动触发预规划（文档 1.1：进入页面并确定起终点后立即预规划三类路线）
watch(
  () => [
    routePlanning.value.isActive,
    routePlanning.value.startPoint?.lng,
    routePlanning.value.startPoint?.lat,
    routePlanning.value.endPoint?.lng,
    routePlanning.value.endPoint?.lat
  ],
  ([isActive, slng, slat, elng, elat], _prev) => {
    if (!isActive) return
    if (
      typeof slng !== 'number' || typeof slat !== 'number' ||
      typeof elng !== 'number' || typeof elat !== 'number'
    ) return

    // 使用已有的防抖配置，避免用户频繁输入/点选造成多次预规划
    clearTimeout(window.__prePlanTimeout)
    window.__prePlanTimeout = setTimeout(() => {
      prePlanRoutes(routePlanning.value.startPoint, routePlanning.value.endPoint)
    }, routeConfig.debounceDelay)
  }
)

// 起点搜索输入处理
const onStartSearchInput = (event) => {
  const query = event.target.value
  routeForm.value.startAddress = query
  
  if (query.trim().length < 2) {
    startSearchResults.value = []
    showStartSearchResults.value = false
    return
  }
  
  // 防抖搜索
  clearTimeout(window.startSearchTimeout)
  window.startSearchTimeout = setTimeout(() => {
    performStartSearch(query)
  }, 300)
}

// 执行起点搜索
const performStartSearch = async (query) => {
  if (!query.trim()) return
  
  isStartSearching.value = true
  showStartSearchResults.value = true
  
  try {
    const onlineResults = await searchOnlinePlaces(query)
    
    startSearchResults.value = onlineResults.slice(0, 8)
  } catch (error) {
    console.error('起点搜索失败:', error)
  } finally {
    isStartSearching.value = false
    if (startSearchResults.value.length > 0) {
      showStartSearchResults.value = true
    }
  }
}

// 选择起点搜索结果
const selectStartResult = async (result) => {
  routeForm.value.startAddress = result.name
  showStartSearchResults.value = false
  startSearchResults.value = []
  
  const startPoint = {
    lng: parseFloat(result.longitude),
    lat: parseFloat(result.latitude),
    _coord: 'gcj02'
  }
  
  routePlanning.value.startPoint = startPoint
  
  // 在地图上添加临时标记
  const tempMarker = new AMap.Marker({
    position: [startPoint.lng, startPoint.lat],
    content: '<div style="background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">起点</div>',
    offset: new AMap.Pixel(-20, -10)
  })
  amapInstance.add(tempMarker)
  
  // 飞到起点位置
  amapInstance.setCenter([startPoint.lng, startPoint.lat])
  amapInstance.setZoom(15)
  
  // 如果已经有终点，触发路线预规划
  if (routePlanning.value.endPoint) {
    await prePlanRoutes(routePlanning.value.startPoint, routePlanning.value.endPoint)
  }
  
  console.log('起点选择成功:', result.name)
}

// 终点搜索输入处理
const onEndSearchInput = (event) => {
  const query = event.target.value
  routeForm.value.endAddress = query
  
  if (query.trim().length < 2) {
    endSearchResults.value = []
    showEndSearchResults.value = false
    return
  }
  
  // 防抖搜索
  clearTimeout(window.endSearchTimeout)
  window.endSearchTimeout = setTimeout(() => {
    performEndSearch(query)
  }, 300)
}

// 执行终点搜索
const performEndSearch = async (query) => {
  if (!query.trim()) return
  
  isEndSearching.value = true
  showEndSearchResults.value = true
  
  try {
    const onlineResults = await searchOnlinePlaces(query)
    
    endSearchResults.value = onlineResults.slice(0, 8)
  } catch (error) {
    console.error('终点搜索失败:', error)
  } finally {
    isEndSearching.value = false
    if (endSearchResults.value.length > 0) {
      showEndSearchResults.value = true
    }
  }
}

// 搜索在线地点
const searchOnlinePlaces = async (query) => {
  const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(query)}&city=淄博&key=${AMAP_SEARCH_KEY}&output=json`
  
  try {
    const response = await fetch(url)
    const data = await response.json()
    if (data && data.status === '1' && data.pois && data.pois.length > 0) {
      return data.pois.map(poi => {
        const [lng, lat] = poi.location.split(',').map(coord => parseFloat(coord.trim()))
        return {
          id: `online_${poi.id}`,
          name: poi.name,
          address: poi.address || poi.district || '',
          longitude: lng,
          latitude: lat,
          type: 'place',
          typeName: poi.type || '地点',
          source: '高德地图'
        }
      }).slice(0, 8)
    }
    return []
  } catch (error) {
    console.error('在线地点搜索失败:', error)
    // 降级尝试 JSONP
    return new Promise((resolve) => {
      const callbackName = `search_callback_${Date.now()}`
      window[callbackName] = (data) => {
        if (data && data.status === '1' && data.pois) {
          const results = data.pois.map(poi => {
            const [lng, lat] = poi.location.split(',').map(coord => parseFloat(coord.trim()))
            return {
              id: `online_${poi.id}`,
              name: poi.name,
              address: poi.address || poi.district || '',
              longitude: lng,
              latitude: lat,
              type: 'place',
              typeName: poi.type || '地点',
              source: '高德地图'
            }
          })
          resolve(results.slice(0, 8))
        } else {
          resolve([])
        }
        delete window[callbackName]
      }
      const script = document.createElement('script')
      script.src = `${url}&callback=${callbackName}`
      document.head.appendChild(script)
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName]
          resolve([])
        }
      }, 5000)
    })
  }
}

// 选择终点搜索结果
const selectEndResult = async (result) => {
  routeForm.value.endAddress = result.name
  showEndSearchResults.value = false
  endSearchResults.value = []
  
  const endPoint = {
    lng: parseFloat(result.longitude),
    lat: parseFloat(result.latitude),
    _coord: 'gcj02'
  }
  
  routePlanning.value.endPoint = endPoint
  
  // 在地图上添加临时标记
  const tempMarker = new AMap.Marker({
    position: [endPoint.lng, endPoint.lat],
    content: '<div style="background: #F59E0B; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">终点</div>',
    offset: new AMap.Pixel(-20, -10)
  })
  amapInstance.add(tempMarker)
  
  // 飞到终点位置
  amapInstance.setCenter([endPoint.lng, endPoint.lat])
  amapInstance.setZoom(15)
  
  // 如果已经有起点，触发路线预规划
  if (routePlanning.value.startPoint) {
    await prePlanRoutes(routePlanning.value.startPoint, routePlanning.value.endPoint)
  }
  
  console.log('终点选择成功:', result.name)
}

// 添加路线到历史记录
const addToHistory = (startPoint, endPoint, mode, selectedRoute) => {
  const historyItem = {
    id: Date.now(),
    startPoint: {
      name: routeForm.value.startAddress,
      ...startPoint
    },
    endPoint: {
      name: routeForm.value.endAddress,
      ...endPoint
    },
    mode,
    selectedRoute: selectedRoute ? {
      index: selectedRouteIndex.value,
      duration: selectedRoute.duration,
      distance: selectedRoute.distance,
      transfers: selectedRoute.transfers
    } : null,
    timestamp: Date.now()
  }
  
  // 添加到历史记录开头
  routeHistory.value.unshift(historyItem)
  
  // 限制历史记录数量
  if (routeHistory.value.length > maxHistoryCount) {
    routeHistory.value = routeHistory.value.slice(0, maxHistoryCount)
  }
  
  // 保存到本地缓存
  cacheManager.localCache.set('route_history', routeHistory.value)
}

// 加载历史记录
const loadHistory = () => {
  const cached = cacheManager.localCache.get('route_history')
  if (cached) {
    routeHistory.value = cached
  }
}

// 重新规划历史路线
const replanHistoryRoute = async (historyItem) => {
  // 激活路径规划面板
  routePlanning.value.isActive = true

  routeForm.value.startAddress = historyItem.startPoint.name
  routeForm.value.endAddress = historyItem.endPoint.name
  routePlanning.value.startPoint = {
    lng: historyItem.startPoint.lng,
    lat: historyItem.startPoint.lat,
    _coord: 'gcj02'
  }
  routePlanning.value.endPoint = {
    lng: historyItem.endPoint.lng,
    lat: historyItem.endPoint.lat,
    _coord: 'gcj02'
  }
  routePlanning.value.travelMode = historyItem.mode

  await getAllRoutePlans()
}

// 防抖的路线规划
const debouncedPlanRoute = debounce(async () => {
  await getAllRoutePlans()
}, routeConfig.debounceDelay)

// 节流的换乘站选择
const throttledTransferChange = throttle(async (transferData) => {
  await handleTransferChange(transferData)
}, routeConfig.throttleDelay)

// 获取当前选中方案在指定相邻段(from->to)上的重合站候选
const getTransferCandidates = (fromSegIndex, toSegIndex) => {
  const current = routeResults.value[selectedRouteIndex.value]
  const list = (current?.allStations || [])
    .filter(s => s?.isTransferOption && Array.isArray(s.transferPair) && s.transferPair[0] === fromSegIndex && s.transferPair[1] === toSegIndex)
    .map(s => ({ name: s.name, walkingDistance: Number(s.walkingDistance) || 0 }))

  const map = new Map()
  list.forEach(i => {
    if (!map.has(i.name)) map.set(i.name, i)
  })
  return Array.from(map.values())
}

const openTransferPicker = (stopName, fromSegIndex, toSegIndex) => {
  transferPicker.value = {
    fromSegIndex,
    toSegIndex,
    candidates: getTransferCandidates(fromSegIndex, toSegIndex)
  }
  // 候选为空时兜底：至少提供点击的那个站点
  if (transferPicker.value.candidates.length === 0 && typeof stopName === 'string') {
    transferPicker.value.candidates = [{ name: stopName, walkingDistance: 0 }]
  }
  showTransferPicker.value = true
}

const closeTransferPicker = () => {
  showTransferPicker.value = false
}

// 应用自定义换乘：将包含该换乘站的方案置顶并自动切换
const applyCustomTransfer = async (stopName) => {
  const { fromSegIndex, toSegIndex } = transferPicker.value
  customTransfer.value = {
    isActive: true,
    stopName,
    fromSegIndex,
    toSegIndex
  }

  const match = (r) => {
    const stations = r?.allStations || []
    return stations.some(s =>
      s?.isTransferOption &&
      s.name === stopName &&
      Array.isArray(s.transferPair) &&
      s.transferPair[0] === fromSegIndex &&
      s.transferPair[1] === toSegIndex
    )
  }

  const matched = []
  const others = []
  routeResults.value.forEach(r => (match(r) ? matched : others).push(r))
  routeResults.value = [...matched, ...others]

  if (matched.length > 0) {
    selectedRouteIndex.value = 0
    await selectRoute(0)
  }

  showTransferPicker.value = false
}

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) { // 1分钟内
    return '刚刚'
  } else if (diff < 3600000) { // 1小时内
    return `${Math.floor(diff / 60000)}分钟前`
  } else if (diff < 86400000) { // 24小时内
    return `${Math.floor(diff / 3600000)}小时前`
  } else {
    return `${Math.floor(diff / 86400000)}天前`
  }
}

// 获取出行方式标签
const getModeLabel = (mode) => {
  const modeMap = {
    'driving': '驾车',
    'walking': '步行',
    'transit': '公交'
  }
  return modeMap[mode] || mode
}

// 驾车策略（AMap direction/direction/driving）
// 你提供的要求：10~20 会返回多条路径结果，0~9 通常只会返回 1 条。
// 这里优先选择 10~20 以获得更多可选方案，并减少“单方案缓存”带来的体验下降。
const DRIVING_STRATEGY_VERSION = 'v10_12_13_14_18_19'
const DRIVING_STRATEGIES_MULTI = [10, 12, 13, 14, 18, 19]

const planRouteFromForm = async () => {
  if (!routePlanning.value.startPoint) {
    alert('请设置起点')
    return
  }
  
  if (!routePlanning.value.endPoint) {
    alert('请选择终点')
    return
  }
  
  // 获取所有路径方案
  await getAllRoutePlans()
}

// 生成缓存键
const generateCacheKey = (startPoint, endPoint, mode) => {
  // 驾车策略集合会影响 driving 路径结果；加版本号避免命中旧缓存
  const drivingStrategySuffix = (mode === 'driving' || mode === 'all') ? `_${DRIVING_STRATEGY_VERSION}` : ''
  return `${mode}${drivingStrategySuffix}_${startPoint.lng}_${startPoint.lat}_${endPoint.lng}_${endPoint.lat}`
}

// 检查是否为高频起点/终点
const isHighFrequencyLocation = (point) => {
  const highFreqLocations = ['家', '公司', '学校', '商场', '医院']
  // 这里可以根据实际需求扩展，比如基于历史记录判断
  return false // 暂时返回false，后续可以基于历史记录实现
}

// 路线预规划机制
const prePlanRoutes = async (startPoint, endPoint) => {
  if (!startPoint || !endPoint) return
  
  // 进入预规划时，先写一个非空占位，避免 UI/诊断出现 “isPrePlanning=true 但 prePlannedRoutes=null”
  routePlanning.value.isPrePlanning = true
  if (!routePlanning.value.prePlannedRoutes) {
    routePlanning.value.prePlannedRoutes = {
      driving: null,
      walking: null,
      transit: null,
      timestamp: Date.now()
    }
  }
  
  try {
    // 检查缓存
    const cacheKey = generateCacheKey(startPoint, endPoint, 'all')
    const cachedResult = cacheManager.localCache.get(cacheKey)
    
    if (cachedResult) {
      console.log('使用预规划缓存结果:', cachedResult)
      // 原子更新：先写数据，再关 loading
      routePlanning.value.prePlannedRoutes = cachedResult
      routePlanning.value.isPrePlanning = false
      return
    }
    
    // 并发获取三种出行方式的路线
    const modes = ['driving', 'walking', 'transit']
    const promises = modes.map(mode => 
      apiQueue.add(() => getSingleRoutePlan(mode, startPoint, endPoint))
    )
    
    const results = await Promise.allSettled(promises)
    console.log('预规划API返回结果:', results)

    const prePlannedData = {
      driving: results[0].status === 'fulfilled' && results[0].value && (results[0].value.status === '1' || results[0].value.route) ? results[0].value : null,
      walking: results[1].status === 'fulfilled' && results[1].value && (results[1].value.status === '1' || results[1].value.route) ? results[1].value : null,
      transit: results[2].status === 'fulfilled' && results[2].value && (results[2].value.status === '1' || results[2].value.route) ? results[2].value : null,
      timestamp: Date.now()
    }
    
    console.log('解析后的预规划数据:', prePlannedData)
    
    // 原子更新：必须确保 prePlannedRoutes 先被赋值，UI 才能在 isPrePlanning 变为 false 时读到数据
    routePlanning.value.prePlannedRoutes = prePlannedData
    
    // 缓存预规划结果
    cacheManager.localCache.set(cacheKey, prePlannedData)
    
    // 关闭 loading（这里不再依赖 setTimeout，避免异常/中断导致永远不落盘）
    routePlanning.value.isPrePlanning = false
    
    // 如果当前就是公交模式且预规划成功，尝试直接处理结果
    if (routePlanning.value.travelMode === 'transit' && prePlannedData.transit) {
      console.log('公交模式预规划成功，自动触发结果处理')
      await getEnhancedTransitRoutes(startPoint, endPoint)
    } else if (routePlanning.value.travelMode !== 'transit' && prePlannedData[routePlanning.value.travelMode]) {
      console.log(`${routePlanning.value.travelMode}模式预规划成功，自动触发结果处理`)
      processRouteResults(prePlannedData[routePlanning.value.travelMode], routePlanning.value.travelMode)
    }
    
    console.log('路线预规划完成')
  } catch (error) {
    console.error('路线预规划失败:', error)
    // 确保不会卡在 “预规划中” 且数据为空的状态
    routePlanning.value.prePlannedRoutes = routePlanning.value.prePlannedRoutes || {
      driving: null,
      walking: null,
      transit: null,
      timestamp: Date.now()
    }
    routePlanning.value.isPrePlanning = false
  }
}

// 获取单一出行方式路线
const getSingleRoutePlan = async (mode, startPoint, endPoint) => {
  const apiUrl = getRouteApiUrl(mode, startPoint, endPoint)
  const finalUrl = apiUrl

  const fetchJson = async (url) => {
    const response = await fetch(url)
    const data = await response.json()
    return { response, data }
  }

  try {
    if (mode === 'driving') {
      // 驾车多策略：优先使用 10~20（会返回多条路径结果）
      // 10: 默认（与你备注的“高德默认不勾选”一致）
      // 12/13/14/18/19: 分别覆盖“躲避拥堵/不走高速/避免收费/多组合/高速优先”
      const strategies = DRIVING_STRATEGIES_MULTI
      const mergedPaths = []
      let lastErr = null

      for (let i = 0; i < strategies.length; i++) {
        const stg = strategies[i]
        try {
          // alternatives=1：作为兜底参数，尽量让接口返回更多备选 paths
          const url = `${finalUrl}&strategy=${stg}&alternatives=1`
          const { response, data } = await fetchJson(url)
          if (!response.ok) throw new Error(`driving http ${response.status}`)
          if (!data || data.status !== '1' || !data.route || !Array.isArray(data.route.paths) || data.route.paths.length === 0) {
            throw new Error(`driving bad payload: ${data?.info || data?.infocode || 'unknown'}`)
          }
          // 每个策略收集全部 paths，再由几何去重筛选出真正不同的
          data.route.paths.forEach((p) => {
            p.__strategy = stg
            mergedPaths.push(p)
          })
        } catch (e) {
          lastErr = e
        }
        // 小间隔，减少触发上游限流概率
        if (i < strategies.length - 1) await new Promise(r => setTimeout(r, 150))
      }

      if (mergedPaths.length > 0) {
        // 去重：不同 strategy 很可能返回同一条路线
        const sigToBest = new Map()
        const getSig = (p) => {
          const poly =
            (typeof p?.polyline === 'string' && p.polyline.trim())
              ? p.polyline.trim()
              : (Array.isArray(p?.steps) ? joinStepsPolyline(p.steps) : '')
          if (!poly) return `EMPTY`

          // 解析 polyline -> 点列
          const rawPts = poly
            .split(';')
            .map(s => s.split(','))
            .map(parts => {
              if (parts.length !== 2) return null
              const lng = Number(parts[0])
              const lat = Number(parts[1])
              return (Number.isFinite(lng) && Number.isFinite(lat)) ? { lng, lat } : null
            })
            .filter(Boolean)

          if (rawPts.length < 2) return `EMPTY|n=${rawPts.length}`

          // Haversine distance (meters) 用于按“弧长”重采样，避免不同 polyline 采样点数导致签名失配
          const distM = (a, b) => {
            const R = 6371000
            const toRad = (d) => d * Math.PI / 180
            const dLat = toRad(b.lat - a.lat)
            const dLng = toRad(b.lng - a.lng)
            const lat1 = toRad(a.lat)
            const lat2 = toRad(b.lat)
            const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
          }

          // 生成累计弧长
          const cum = [0]
          for (let i = 1; i < rawPts.length; i++) {
            cum[i] = cum[i - 1] + distM(rawPts[i - 1], rawPts[i])
          }
          const total = cum[cum.length - 1]
          if (!Number.isFinite(total) || total <= 0) return `EMPTY|t=${total}`

          // 等距重采样 + 更粗量化：减少“几米级差异”导致伪不同
          const sampleCount = 30
          const precision = 3 // toFixed(3) 大致粒度 ~ 100m（进一步归并重复路线）
          const sampled = []

          let segIdx = 0
          for (let i = 0; i < sampleCount; i++) {
            const target = total * (i / (sampleCount - 1))
            while (segIdx < cum.length - 2 && cum[segIdx + 1] < target) segIdx++
            const leftIdx = segIdx
            const rightIdx = Math.min(segIdx + 1, rawPts.length - 1)
            const leftD = cum[leftIdx]
            const rightD = cum[rightIdx]

            const ratio = (rightD - leftD) > 0 ? (target - leftD) / (rightD - leftD) : 0
            const a = rawPts[leftIdx]
            const b = rawPts[rightIdx]
            const lng = a.lng + (b.lng - a.lng) * ratio
            const lat = a.lat + (b.lat - a.lat) * ratio

            sampled.push(`${lng.toFixed(precision)},${lat.toFixed(precision)}`)
          }

          // 仅用几何签名去重；耗时/距离用于“选择更优”而不是“是否认为同一路”
          return sampled.join('|')
        }
        const better = (a, b) => {
          const da = Number(a?.duration) || 0
          const db = Number(b?.duration) || 0
          if (da !== db) return da < db
          const distA = Number(a?.distance) || 0
          const distB = Number(b?.distance) || 0
          return distA < distB
        }
        mergedPaths.forEach(p => {
          const sig = getSig(p)
          const prev = sigToBest.get(sig)
          if (!prev || better(p, prev)) sigToBest.set(sig, p)
        })
        // 最多保留 3 条“真正不同”的备选，避免刷屏
        const uniquePaths = Array.from(sigToBest.values())
          .sort((a, b) => (Number(a?.duration) || 0) - (Number(b?.duration) || 0))
          .slice(0, 3)
        return { status: '1', route: { paths: uniquePaths } }
      }
      throw lastErr || new Error('driving no results from all strategies')
    }

    if (mode === 'transit') {
      // 同时尝试多种策略，增加“更少步行/更少换乘/不乘地铁”等方案覆盖面
      // 0: 最快捷, 2: 最少换乘, 3: 最少步行, 5: 不乘地铁
      const strategies = [0, 2, 3, 5]
      const merged = []
      let lastErr = null

      // 小并发 + 小间隔，减少触发上游限流的概率
      const batchSize = 2
      for (let i = 0; i < strategies.length; i += batchSize) {
        const batch = strategies.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(async (stg) => {
            const url = `${finalUrl}&strategy=${stg}`
            const { response, data } = await fetchJson(url)
            if (!response.ok) throw new Error(`transit http ${response.status}`)
            if (!data || data.status !== '1' || !data.route || !Array.isArray(data.route.transits)) {
              throw new Error(`transit bad payload: ${data?.info || data?.infocode || 'unknown'}`)
            }
            // 标记策略，方便调试/去重
            data.route.transits.forEach(t => {
              t.__strategy = stg
              merged.push(t)
            })
            return true
          })
        )
        results.forEach(r => {
          if (r.status === 'rejected') lastErr = r.reason
        })
        if (i + batchSize < strategies.length) {
          await new Promise(r => setTimeout(r, 250))
        }
      }

      if (merged.length > 0) {
        return { status: '1', route: { transits: merged } }
      }
      throw lastErr || new Error('transit no results from all strategies')
    }

    const { response, data } = await fetchJson(finalUrl)
    if (!response.ok) {
      throw new Error(`${mode} http ${response.status}`)
    }
    if (data && data.status === '1') return data
    throw new Error(`${mode}路线规划失败: ${data?.info || '未知错误'}`)
  } catch (error) {
    console.error(`${mode} API调用失败:`, error)
    // 降级尝试 JSONP 模式（针对某些环境下的跨域限制）
    return new Promise((resolve, reject) => {
      const callbackName = `${mode}_callback_${Date.now()}_${Math.floor(Math.random() * 1000)}`
      window[callbackName] = (data) => {
        if (data && data.status === '1') {
          resolve(data)
        } else {
          reject(new Error(`${mode}路线规划失败: ${data?.info || '未知错误'}`))
        }
        delete window[callbackName]
      }
      const script = document.createElement('script')
      // JSONP 不支持多策略合并，这里仅回退“默认策略”（不额外加 strategy 以保持和 fetch 路径一致）
      script.src = `${finalUrl}&callback=${callbackName}`
      script.onerror = () => reject(new Error(`${mode} API脚本加载失败`))
      document.head.appendChild(script)
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName]
          reject(new Error(`${mode} API请求超时`))
        }
      }, 10000)
    })
  }
}

// 多维度站点筛选
const filterBusStops = async (point, stopType, options = {}) => {
  const config = stopFilterConfig[`${stopType}StopWeights`]
  const threshold = stopType === 'start' ? routeConfig.walkingDistanceThreshold : 
                    stopType === 'transfer' ? routeConfig.transferWalkingThreshold : 
                    routeConfig.walkingDistanceThreshold
  
  try {
    // 获取周边公交站点
    const nearbyStops = await getNearbyBusStops(point, threshold)
    
    // 计算每个站点的综合得分
    const scoredStops = await Promise.all(
      nearbyStops.map(async (stop) => {
        const score = await calculateStopScore(stop, point, stopType, config)
        return { ...stop, score }
      })
    )
    
    // 按得分排序并过滤
    const filteredStops = scoredStops
      .filter(stop => stop.score > 0.3) // 基础得分阈值
      .sort((a, b) => b.score - a.score)
      .slice(0, 3) // 最多返回3个备选站点
    
    return filteredStops
  } catch (error) {
    console.error(`${stopType}站点筛选失败:`, error)
    return []
  }
}

// 获取周边公交站点
const getNearbyBusStops = async (point, radius) => {
  const [gcjLng, gcjLat] = toGcj02Arr(point)
  const url = `https://restapi.amap.com/v3/place/around?key=${AMAP_SEARCH_KEY}&location=${gcjLng},${gcjLat}&radius=${radius}&keywords=公交站点&type=&output=json`

  try {
    const response = await fetch(url)
    const data = await response.json()
    if (data && data.status === '1' && data.pois) {
      return data.pois
        .filter(poi => poi.type === '公交站点' || poi.type === '公交车站')
        .map(poi => {
          const [lng, lat] = poi.location.split(',').map(coord => parseFloat(coord.trim()))
          return {
            id: poi.id,
            name: poi.name,
            address: poi.address || '',
            location: [lng, lat],
            lines: poi.lineinfo ? poi.lineinfo.split(';') : []
          }
        })
    }
    return []
  } catch (error) {
    console.error('获取周边公交站点失败:', error)
    // 降级尝试 JSONP
    return new Promise((resolve) => {
      const callbackName = `bus_stop_search_${Date.now()}`
      window[callbackName] = (data) => {
        if (data && data.status === '1' && data.pois) {
          const stops = data.pois
            .filter(poi => poi.type === '公交站点' || poi.type === '公交车站')
            .map(poi => {
              const [lng, lat] = poi.location.split(',').map(coord => parseFloat(coord.trim()))
              return {
                id: poi.id,
                name: poi.name,
                address: poi.address || '',
                location: [lng, lat],
                lines: poi.lineinfo ? poi.lineinfo.split(';') : []
              }
            })
          resolve(stops)
        } else {
          resolve([])
        }
        delete window[callbackName]
      }
      const script = document.createElement('script')
      script.src = `${url}&callback=${callbackName}`
      document.head.appendChild(script)
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName]
          resolve([])
        }
      }, 5000)
    })
  }
}

// 计算站点得分
const calculateStopScore = async (stop, userPoint, stopType, config) => {
  let totalScore = 0
  
  try {
    // 1. 步行距离得分
    const walkingDistance = await calculateWalkingDistance(userPoint, {
      lng: stop.location[0],
      lat: stop.location[1]
    })
    
    if (walkingDistance > routeConfig.walkingDistanceThreshold) {
      return 0 // 距离过远，直接排除
    }
    
    const distanceScore = Math.max(0, 1 - walkingDistance / routeConfig.walkingDistanceThreshold)
    totalScore += distanceScore * config.walkingDistance
    
    // 2. 线路覆盖度得分（仅对上车和换乘站点）
    if (stopType === 'start' || stopType === 'transfer') {
      const lineCount = stop.lines.length
      const lineScore = Math.min(1, lineCount / 5) // 假设5条线路为满分
      totalScore += lineScore * config.lineCoverage
    }
    
    // 3. 运营时段得分（简化处理，假设所有站点都在运营）
    const operatingScore = 0.8 // 默认运营得分
    totalScore += operatingScore * config.operatingHours
    
    // 4. 通行适配性得分（简化处理）
    const accessibilityScore = 0.7 // 默认通行得分
    totalScore += accessibilityScore * config.accessibility
    
    return totalScore
  } catch (error) {
    console.error('计算站点得分失败:', error)
    return 0
  }
}

// 计算步行距离
const calculateWalkingDistance = async (startPoint, endPoint) => {
  const cacheKey = `walking_${startPoint.lng}_${startPoint.lat}_${endPoint.lng}_${endPoint.lat}`
  
  // 检查缓存
  if (walkingCache.has(cacheKey)) {
    return walkingCache.get(cacheKey)
  }
  
  try {
    const distance = await apiQueue.add(() => {
      return new Promise((resolve, reject) => {
        const callbackName = `walking_dist_${Date.now()}`
        
        window[callbackName] = (data) => {
          if (data && data.status === '1' && data.route && data.route.paths && data.route.paths[0]) {
            const distance = data.route.paths[0].distance
            resolve(Number(distance))
          } else {
            reject(new Error('步行距离计算失败'))
          }
          delete window[callbackName]
        }
        
        const [startGcjLng, startGcjLat] = toGcj02Arr(startPoint)
        const [endGcjLng, endGcjLat] = toGcj02Arr(endPoint)
        
        const url = `https://restapi.amap.com/v3/direction/walking?key=${AMAP_DIRECTION_KEY}&origin=${startGcjLng},${startGcjLat}&destination=${endGcjLng},${endGcjLat}&output=json&callback=${callbackName}`
        
        const script = document.createElement('script')
        script.src = url
        document.head.appendChild(script)
        
        setTimeout(() => {
          if (window[callbackName]) {
            delete window[callbackName]
            reject(new Error('步行距离计算超时'))
          }
        }, 5000)
      })
    })
    
    // 缓存结果
    walkingCache.set(cacheKey, distance)
    return distance
  } catch (error) {
    console.error('步行距离计算失败:', error)
    // 降级为直线距离估算
    const straightDistance = getStraightLineDistance(startPoint, endPoint)
    return straightDistance * 1.3 // 步行距离通常比直线距离长30%
  }
}

// Web Worker 管理
const webWorkerManager = {
  worker: null,
  isInitialized: false,
  
  init() {
    if (this.isInitialized) return
    
    try {
      // 创建 Web Worker
      const workerCode = `
        // 路线计算 Worker 代码
        self.addEventListener('message', function(e) {
          const { type, data } = e.data;
          
          switch (type) {
            case 'calculateRouteScore':
              try {
                const score = calculateRouteScore(data);
                self.postMessage({ type: 'routeScore', result: score });
              } catch (err) {
                self.postMessage({ type: 'error', error: err.message });
              }
              break;
              
            case 'filterBusStops':
              try {
                const filteredStops = filterBusStopsSync(data);
                self.postMessage({ type: 'filteredStops', result: filteredStops });
              } catch (err) {
                self.postMessage({ type: 'error', error: err.message });
              }
              break;
              
            case 'calculateWalkingDistance':
              try {
                const distance = calculateWalkingDistanceSync(data);
                self.postMessage({ type: 'walkingDistance', result: distance });
              } catch (err) {
                self.postMessage({ type: 'error', error: err.message });
              }
              break;
              
            default:
              console.warn('未知的 Worker 任务类型:', type);
          }
        });
        
        // 同步版本的路线评分计算
        function calculateRouteScore(route) {
          const config = { time: 0.6, transfers: 0.4, maxTransfers: 2 };
          let score = 0;
          
          const timeScore = Math.max(0, 1 - (route.duration || 0) / 7200);
          score += timeScore * config.time;
          
          const transferCount = route.transfers || 0;
          const transferScore = Math.max(0, 1 - transferCount / 3);
          score += transferScore * config.transfers;
          
          if (transferCount > config.maxTransfers) {
            score *= 0.5;
          }
          
          return score;
        }
        
        // 同步版本的站点筛选
        function filterBusStopsSync(data) {
          const { stops, point, stopType, config, threshold } = data;
          const scoredStops = stops.map(stop => {
            const score = calculateStopScoreSync(stop, point, stopType, config);
            return { ...stop, score };
          });
          
          return scoredStops
            .filter(stop => stop.score > 0.3)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        }
        
        function calculateStopScoreSync(stop, userPoint, stopType, config) {
          let totalScore = 0;
          
          // 简化的步行距离计算（直线距离）
          const walkingDistance = getStraightDistance(userPoint, {
            lng: stop.location[0],
            lat: stop.location[1]
          });
          
          if (walkingDistance > 2000) {
            return 0;
          }
          
          const distanceScore = Math.max(0, 1 - walkingDistance / 2000);
          totalScore += distanceScore * config.walkingDistance;
          
          // 线路覆盖度得分
          if (stopType === 'start' || stopType === 'transfer') {
            const lineCount = stop.lines ? stop.lines.length : 1;
            const lineScore = Math.min(1, lineCount / 5);
            totalScore += lineScore * (config.lineCoverage || 0.3);
          }
          
          // 运营时段得分（默认值）
          totalScore += 0.8 * (config.operatingHours || 0.2);
          
          // 通行适配性得分（默认值）
          totalScore += 0.7 * (config.accessibility || 0.1);
          
          return totalScore;
        }
        
        // 同步版本的步行距离计算
        function calculateWalkingDistanceSync(data) {
          const { startPoint, endPoint } = data;
          return getStraightDistance(startPoint, endPoint) * 1.3;
        }
        
        // 计算直线距离
        function getStraightDistance(point1, point2) {
          const R = 6371000;
          const lat1Rad = point1.lat * Math.PI / 180;
          const lat2Rad = point2.lat * Math.PI / 180;
          const deltaLatRad = (point2.lat - point1.lat) * Math.PI / 180;
          const deltaLngRad = (point2.lng - point1.lng) * Math.PI / 180;
          
          const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
                      Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                      Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          
          return R * c;
        }
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' })
      this.worker = new Worker(URL.createObjectURL(blob))
      this.isInitialized = true
      
      console.log('Web Worker 初始化成功')
    } catch (error) {
      console.error('Web Worker 初始化失败:', error)
    }
  },
  
  async calculateRouteScore(route) {
    if (!this.isInitialized) this.init()
    if (!this.worker) {
      // 降级到主线程计算
      const config = { time: 0.6, transfers: 0.4, maxTransfers: 2 }
      let score = 0
      const timeScore = Math.max(0, 1 - (route.duration || 0) / 7200)
      score += timeScore * config.time
      const transferCount = route.transfers || 0
      const transferScore = Math.max(0, 1 - transferCount / 3)
      score += transferScore * config.transfers
      if (transferCount > config.maxTransfers) {
        score *= 0.5
      }
      return score
    }
    
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'routeScore') {
          this.worker.removeEventListener('message', handler)
          resolve(e.data.result)
        }
      }
      
      this.worker.addEventListener('message', handler)
      this.worker.postMessage({ type: 'calculateRouteScore', data: route })
    })
  },
  
  async filterBusStops(stops, point, stopType, config, threshold) {
    if (!this.isInitialized) this.init()
    if (!this.worker) {
      // 降级到主线程筛选
      const scoredStops = stops.map(stop => {
        let totalScore = 0
        const walkingDistance = getStraightLineDistance(point, {
          lng: stop.location[0],
          lat: stop.location[1]
        })
        
        if (walkingDistance > 2000) {
          return { ...stop, score: 0 }
        }
        
        const distanceScore = Math.max(0, 1 - walkingDistance / 2000)
        totalScore += distanceScore * config.walkingDistance
        
        if (stopType === 'start' || stopType === 'transfer') {
          const lineCount = stop.lines ? stop.lines.length : 1
          const lineScore = Math.min(1, lineCount / 5)
          totalScore += lineScore * (config.lineCoverage || 0.3)
        }
        
        totalScore += 0.8 * (config.operatingHours || 0.2)
        totalScore += 0.7 * (config.accessibility || 0.1)
        
        return { ...stop, score: totalScore }
      })
      
      return scoredStops
        .filter(stop => stop.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    }
    
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'filteredStops') {
          this.worker.removeEventListener('message', handler)
          resolve(e.data.result)
        }
      }
      
      this.worker.addEventListener('message', handler)
      this.worker.postMessage({ 
        type: 'filterBusStops', 
        data: { stops, point, stopType, config, threshold } 
      })
    })
  },
  
  async calculateWalkingDistance(startPoint, endPoint) {
    if (!this.isInitialized) this.init()
    if (!this.worker) {
      return getStraightLineDistance(startPoint, endPoint) * 1.3
    }
    
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'walkingDistance') {
          this.worker.removeEventListener('message', handler)
          resolve(e.data.result)
        }
      }
      
      this.worker.addEventListener('message', handler)
      this.worker.postMessage({ 
        type: 'calculateWalkingDistance', 
        data: { startPoint, endPoint } 
      })
    })
  },
  
  destroy() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
      this.isInitialized = false
    }
  }
}
// 计算直线距离
const getStraightLineDistance = (point1, point2) => {
  const R = 6371000 // 地球半径（米）
  const lat1Rad = point1.lat * Math.PI / 180
  const lat2Rad = point2.lat * Math.PI / 180
  const deltaLatRad = (point2.lat - point1.lat) * Math.PI / 180
  const deltaLngRad = (point2.lng - point1.lng) * Math.PI / 180
  
  const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  
  return R * c
}

// 计算折线长度（米）
const getPathLengthMeters = (points) => {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    const p1 = { lng: Number(a[0]), lat: Number(a[1]) }
    const p2 = { lng: Number(b[0]), lat: Number(b[1]) }
    if (!Number.isFinite(p1.lng) || !Number.isFinite(p1.lat) || !Number.isFinite(p2.lng) || !Number.isFinite(p2.lat)) continue
    total += getStraightLineDistance(p1, p2)
  }
  return total
}

// 判断是否为“同城公交不适用”的超长距离（跨城/跨省会出现离谱结果）
const isLongDistanceForTransit = (startPoint, endPoint) => {
  try {
    const d = getStraightLineDistance(startPoint, endPoint)
    // 50km 以上通常已超出公交/地铁规划的合理范围（尤其跨城）
    return d > 50000
  } catch (e) {
    return false
  }
}
    
// 获取所有路径方案 - 重构版本
const getAllRoutePlans = async () => {
  if (!routePlanning.value.startPoint || !routePlanning.value.endPoint) {
    alert('请设置起点和终点')
    return
  }

  try {
    // 彻底重置状态
    routeResults.value = []
    showRouteResults.value = false
    selectedRouteIndex.value = 0
    clearRoute()
    
    const startPoint = routePlanning.value.startPoint
    const endPoint = routePlanning.value.endPoint
    const mode = routePlanning.value.travelMode

    // 公交规划适用范围保护：超长距离直接禁止公交，避免出现“绕去北京再回来”这类离谱结果
    if (mode === 'transit' && isLongDistanceForTransit(startPoint, endPoint)) {
      const d = Math.round(getStraightLineDistance(startPoint, endPoint) / 1000)
      alert(`当前起终点直线距离约 ${d}km，已超出同城公交规划适用范围。\n建议切换为“驾车/步行”。`)
      routePlanning.value.travelMode = 'driving'
      // 直接走驾车规划
      const data = await getSingleRoutePlan('driving', startPoint, endPoint)
      processRouteResults(data, 'driving')
      return
    }
    
    // 检查是否有预规划结果
    const cacheKey = generateCacheKey(startPoint, endPoint, mode)
    const cachedResult = (routePlanning.value.prePlannedRoutes && routePlanning.value.prePlannedRoutes[mode]) || 
                        cacheManager.memoryCache.get(cacheKey) || 
                        cacheManager.localCache.get(cacheKey)
    
    if (cachedResult) {
      console.log(`使用${mode}预规划或缓存结果:`, cachedResult)
      if (mode === 'transit') {
        // 公交模式需要进一步处理（哪怕已有数据也要走增强逻辑以确保 UI 完整性）
        await getEnhancedTransitRoutes(startPoint, endPoint)
      } else {
        // 缓存兼容：旧版本 driving 只会有 1 条 paths，这里自动刷新为多策略结果
        if (mode === 'driving') {
          const cachedPaths = cachedResult?.route?.paths
          if (Array.isArray(cachedPaths) && cachedPaths.length <= 1) {
            console.log('检测到旧版驾车缓存(<=1条)，自动刷新为多策略方案')
            const fresh = await getSingleRoutePlan('driving', startPoint, endPoint)
            cacheManager.memoryCache.set(cacheKey, fresh)
            cacheManager.localCache.set(cacheKey, fresh)
            processRouteResults(fresh, mode)
            return
          }
        }
        processRouteResults(cachedResult, mode)
      }
      return
    }
    
    // 如果是公交模式，使用增强的路线规划
    if (mode === 'transit') {
      await getEnhancedTransitRoutes(startPoint, endPoint)
    } else {
      // 驾车和步行模式使用原有逻辑
      const data = await getSingleRoutePlan(mode, startPoint, endPoint)
      processRouteResults(data, mode)
    }
    
  } catch (error) {
    console.error('路线规划失败:', error)
    alert('路线规划失败，请稍后重试')
  }
}

// 增强的公交路线规划
const getEnhancedTransitRoutes = async (startPoint, endPoint) => {
  try {
    // 1. 获取基础公交路线
    const basicData = await getSingleRoutePlan('transit', startPoint, endPoint);
    console.log('获取到基础公交路线数据:', basicData);
    
    if (!basicData?.route?.transits || basicData.route.transits.length === 0) {
      console.log('未找到基础公交路线或数据结构不符合预期');
      // 检查是否有 info 或 status 以外的错误信息
      if (basicData?.info) {
        console.error('API 返回详细错误:', basicData.info);
      }
      return;
    }
    
    // 如果 API 返回了 transits，强制确保 showRouteResults 为 true，即使只有 0 个方案（后续会 push）
    showRouteResults.value = true;
    routeResults.value = [];
    
    // 对 transit 生成稳定“签名”，用于跨 strategy/重规划的去重
    const getTransitSignature = (t) => {
      const segs = Array.isArray(t?.segments) ? t.segments : []
      const parts = []
      for (const seg of segs) {
        const buslines =
          (seg?.bus && Array.isArray(seg.bus.buslines) && seg.bus.buslines) ||
          (seg?.subway && Array.isArray(seg.subway.buslines) && seg.subway.buslines) ||
          []
        if (buslines.length > 0) {
          const line = buslines[0]
          const name = String(line?.name || '')
          const dep = String(line?.departure_stop?.name || '')
          const arr = String(line?.arrival_stop?.name || '')
          parts.push(`L:${name}@${dep}->${arr}`)
          continue
        }
        const wdist = Number(seg?.walking?.distance) || 0
        if (wdist > 0) {
          // 50m 粒度，减少“几米差异”导致的伪重复
          const bucket = Math.round(wdist / 50) * 50
          parts.push(`W:${bucket}`)
          continue
        }
        parts.push('X')
      }
      return parts.join('|')
    }

    const dedupeTransits = (list) => {
      const arr = Array.isArray(list) ? list : []
      const best = new Map()
      const better = (a, b) => {
        // 优先更少步行，其次更短耗时，其次更低费用
        const wa = Number(a?.walking_distance) || 0
        const wb = Number(b?.walking_distance) || 0
        if (wa !== wb) return wa < wb
        const da = Number(a?.duration) || 0
        const db = Number(b?.duration) || 0
        if (da !== db) return da < db
        const ca = Number(a?.cost) || 0
        const cb = Number(b?.cost) || 0
        return ca < cb
      }
      arr.forEach(t => {
        const sig = getTransitSignature(t)
        const prev = best.get(sig)
        if (!prev || better(t, prev)) best.set(sig, t)
      })
      return Array.from(best.values())
    }

    // 过滤“明显被更合理方案支配”的方案（解决：已有换乘更合理，但仍残留单线路长接驳）
    // 规则：在“同一终点落点”（按最后一段公交的线路名+到站名）下，
    // 若某方案步行显著更长且并不明显更快，则丢弃。
    const pruneDominatedTransits = (list) => {
      const arr = Array.isArray(list) ? list : []

      const getLastBusInfo = (t) => {
        const segs = Array.isArray(t?.segments) ? t.segments : []
        for (let i = segs.length - 1; i >= 0; i--) {
          const seg = segs[i]
          const buslines =
            (seg?.bus && Array.isArray(seg.bus.buslines) && seg.bus.buslines) ||
            (seg?.subway && Array.isArray(seg.subway.buslines) && seg.subway.buslines) ||
            []
          if (buslines.length > 0) {
            const line = buslines[0]
            return {
              lineName: String(line?.name || ''),
              arrivalStop: String(line?.arrival_stop?.name || '')
            }
          }
        }
        return { lineName: '', arrivalStop: '' }
      }

      const groups = new Map()
      arr.forEach(t => {
        const info = getLastBusInfo(t)
        const key = `${info.lineName}|${info.arrivalStop}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(t)
      })

      const kept = []
      groups.forEach((items) => {
        if (!items || items.length <= 1) {
          if (items?.[0]) kept.push(items[0])
          return
        }

        // 找该组“标杆方案”（步行最少，其次耗时最短）
        const sorted = [...items].sort((a, b) => {
          const wa = Number(a?.walking_distance) || 0
          const wb = Number(b?.walking_distance) || 0
          if (wa !== wb) return wa - wb
          const da = Number(a?.duration) || 0
          const db = Number(b?.duration) || 0
          return da - db
        })
        const baseline = sorted[0]
        const baseWalk = Number(baseline?.walking_distance) || 0
        const baseDur = Number(baseline?.duration) || 0

        sorted.forEach((t, idx) => {
          if (idx === 0) {
            kept.push(t)
            return
          }
          const w = Number(t?.walking_distance) || 0
          const d = Number(t?.duration) || 0

          // "明显更长步行"的判定：多出 >= 800m
          const walkMuchWorse = w >= baseWalk + 800
          // "明显更快"的判定：至少快 5 分钟才可能值得保留
          const durMuchBetter = d > 0 && baseDur > 0 && d <= baseDur - 300

          // 被支配：步行明显更差，同时并没有明显更快
          if (walkMuchWorse && !durMuchBetter) return

          kept.push(t)
        })
      })

      return kept
    }

    // 1.5 站点增强重规划（可选）
    // 说明：该增强会引入“以站点为起终点”的额外方案，若绘制/评估口径不一致，容易出现看起来绕圈的路线。
    // 先默认关闭，保持严格遵循高德原始公交方案 + 文档阈值过滤。
    const ENABLE_STOP_REPLAN = false
    if (ENABLE_STOP_REPLAN) {
      try {
        const startStops = await filterBusStops(startPoint, 'start')
        const endStops = await filterBusStops(endPoint, 'end')
        const bestStart = startStops?.[0]
        const bestEnd = endStops?.[0]

        const toPoint = (stop) => {
          const loc = stop?.location
          if (Array.isArray(loc) && loc.length === 2) {
            const lng = Number(loc[0])
            const lat = Number(loc[1])
            if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat }
          }
          return null
        }

        const sP = toPoint(bestStart)
        const eP = toPoint(bestEnd)

        if (sP && eP) {
          const replanned = await apiQueue.add(() => getSingleRoutePlan('transit', sP, eP))
          if (replanned?.route?.transits?.length) {
            replanned.route.transits.forEach(t => {
              t.__enhancedFromStops = {
                startStop: { name: bestStart?.name, location: bestStart?.location },
                endStop: { name: bestEnd?.name, location: bestEnd?.location }
              }
            })
            basicData.route.transits = [...basicData.route.transits, ...replanned.route.transits]
            console.log('站点增强追加方案数:', replanned.route.transits.length)
          }
        }
      } catch (e) {
        console.warn('站点增强重规划失败（忽略，不影响基础方案）:', e)
      }
    }

    // 去重：多 strategy + 站点重规划会产生大量重复方案
    const beforeDedupe = basicData.route.transits.length
    basicData.route.transits = dedupeTransits(basicData.route.transits)
    const afterDedupe = basicData.route.transits.length
    if (afterDedupe !== beforeDedupe) {
      console.log(`transits 去重完成: ${beforeDedupe} -> ${afterDedupe}`)
    }

    // 再过滤：剔除“单线路长接驳但并不更快”的方案，避免干扰用户选择
    const beforePrune = basicData.route.transits.length
    basicData.route.transits = pruneDominatedTransits(basicData.route.transits)
    const afterPrune = basicData.route.transits.length
    if (afterPrune !== beforePrune) {
      console.log(`transits 支配过滤完成: ${beforePrune} -> ${afterPrune}`)
    }

    // 2. 使用 Web Worker 并行处理每个路线方案
    const enhancedRoutes = await Promise.all(
      basicData.route.transits.map(async (transit, index) => {
        try {
          // 使用 Web Worker 进行增强计算
          const enhancedRoute = await webWorkerManager.calculateRouteScore(transit);
          return {
            ...transit,
            score: enhancedRoute,
            originalIndex: index
          };
        } catch (error) {
          console.error(`处理路线${index}失败:`, error);
          // 降级到原始路线
          return {
            ...transit,
            originalIndex: index,
            score: 0
          };
        }
      })
    );
    
    // 3. 使用 Web Worker 进行路线排序
    const sortedRoutes = await sortTransitRoutesWithWorker(enhancedRoutes)
    
    // 4. 缓存结果
    const cacheKey = generateCacheKey(startPoint, endPoint, 'transit')
    const cacheData = {
      route: { transits: sortedRoutes }
    }
    cacheManager.memoryCache.set(cacheKey, cacheData)
    cacheManager.localCache.set(cacheKey, cacheData)
    
    // 5. 处理结果显示
    if (sortedRoutes && sortedRoutes.length > 0) {
      console.log('公交增强处理完成，准备分发结果:', sortedRoutes.length)
      await processRouteResults({ status: '1', route: { transits: sortedRoutes } }, 'transit')
    } else {
      console.warn('增强后的公交路线列表为空')
      // 尝试使用原始数据
      await processRouteResults(basicData, 'transit')
    }
    
  } catch (error) {
    console.error('增强公交路线规划失败:', error)
    // 降级为基础路线规划
    const basicData = await getSingleRoutePlan('transit', startPoint, endPoint)
    processRouteResults(basicData, 'transit')
  }
}

// 使用 Web Worker 增强单个公交路线
const enhanceTransitRouteWithWorker = async (transit, startPoint, endPoint) => {
  try {
    const enhanced = { ...transit }
    
    // 1. 使用 Web Worker 筛选上车站点
    if (transit.segments && transit.segments[0]) {
      const firstSegment = transit.segments[0]
      if (firstSegment.bus && firstSegment.bus.buslines && firstSegment.bus.buslines[0]) {
        const nearbyStops = await getNearbyBusStops(startPoint, routeConfig.walkingDistanceThreshold)
        if (nearbyStops.length > 0) {
          const config = stopFilterConfig.startStopWeights
          const enhancedStartStops = await webWorkerManager.filterBusStops(
            nearbyStops, startPoint, 'start', config, routeConfig.walkingDistanceThreshold
          )
          enhanced.recommendedStartStops = enhancedStartStops
        }
      }
    }
    
    // 2. 处理换乘站点
    if (transit.segments && transit.segments.length > 1) {
      const transferStops = await processTransferStops(transit)
      enhanced.recommendedTransferStops = transferStops
    }
    
    // 3. 使用 Web Worker 筛选下车站点
    const lastSegment = transit.segments[transit.segments.length - 1]
    if (lastSegment.bus && lastSegment.bus.buslines && lastSegment.bus.buslines[0]) {
      const nearbyStops = await getNearbyBusStops(endPoint, routeConfig.walkingDistanceThreshold)
      if (nearbyStops.length > 0) {
        const config = stopFilterConfig.endStopWeights
        const enhancedEndStops = await webWorkerManager.filterBusStops(
          nearbyStops, endPoint, 'end', config, routeConfig.walkingDistanceThreshold
        )
        enhanced.recommendedEndStops = enhancedEndStops
      }
    }
    
    // 4. 使用 Web Worker 计算综合得分
    enhanced.score = await webWorkerManager.calculateRouteScore(enhanced)
    
    return enhanced
  } catch (error) {
    console.error('增强公交路线失败:', error)
    return transit
  }
}

// 使用 Web Worker 进行公交路线排序
const sortTransitRoutesWithWorker = async (routes) => {
  try {
    const mode = transitSortMode.value
    const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    const sorted = [...routes].sort((a, b) => {
      const da = toNum(a?.duration)
      const db = toNum(b?.duration)
      const wa = toNum(a?.walking_distance ?? a?.walkingDistance)
      const wb = toNum(b?.walking_distance ?? b?.walkingDistance)
      const ca = toNum(a?.cost)
      const cb = toNum(b?.cost)

      if (mode === 'walking') {
        if (wa !== wb) return wa - wb
        if (da !== db) return da - db
        return ca - cb
      }
      if (mode === 'cost') {
        if (ca !== cb) return ca - cb
        if (da !== db) return da - db
        return wa - wb
      }
      // 默认：时间最短
      if (da !== db) return da - db
      if (wa !== wb) return wa - wb
      return ca - cb
    })
    return sorted
  } catch (error) {
    console.error('路线排序失败:', error);
    return routes;
  }
}

// 切换排序方式后，立即对当前公交结果重排（不重新请求接口）
watch(transitSortMode, async () => {
  try {
    if (!Array.isArray(routeResults.value) || routeResults.value.length === 0) return
    if (routePlanning.value.travelMode !== 'transit') return
    const transits = routeResults.value.filter(r => r?.mode === 'transit')
    if (transits.length <= 1) return
    routeResults.value = [...sortTransitRoutes(transits)]
    selectedRouteIndex.value = 0
    await selectRoute(0)
  } catch (e) {
    console.warn('公交方案重排失败（忽略）:', e)
  }
})

// 增强单个公交路线
const enhanceTransitRoute = async (transit, startPoint, endPoint) => {
  try {
    const enhanced = { ...transit }
    
    // 1. 筛选上车站点
    if (transit.segments && transit.segments[0]) {
      const firstSegment = transit.segments[0]
      if (firstSegment.bus && firstSegment.bus.buslines && firstSegment.bus.buslines[0]) {
        const departureStop = firstSegment.bus.buslines[0].departure_stop
        if (departureStop) {
          const enhancedStartStops = await filterBusStops(startPoint, 'start')
          enhanced.recommendedStartStops = enhancedStartStops
        }
      }
    }
    
    // 2. 处理换乘站点
    if (transit.segments && transit.segments.length > 1) {
      const transferStops = await processTransferStops(transit)
      enhanced.recommendedTransferStops = transferStops
    }
    
    // 3. 筛选下车站点
    const lastSegment = transit.segments[transit.segments.length - 1]
    if (lastSegment.bus && lastSegment.bus.buslines && lastSegment.bus.buslines[0]) {
      const arrivalStop = lastSegment.bus.buslines[0].arrival_stop
      if (arrivalStop) {
        const enhancedEndStops = await filterBusStops(endPoint, 'end')
        enhanced.recommendedEndStops = enhancedEndStops
      }
    }
    
    // 4. 计算综合得分
    enhanced.score = calculateRouteScore(enhanced)
    
    return enhanced
  } catch (error) {
    console.error('增强公交路线失败:', error)
    return transit
  }
}

// 计算两点间距离（米）
const getDistance = (loc1, loc2) => {
  const parseCoord = (loc) => {
    if (Array.isArray(loc)) return { lng: loc[0], lat: loc[1] }
    if (typeof loc === 'string') {
      const [lng, lat] = loc.split(',').map(Number)
      return { lng, lat }
    }
    if (loc && typeof loc === 'object') {
      return { lng: loc.lng || loc[0], lat: loc.lat || loc[1] }
    }
    return null
  }

  const p1 = parseCoord(loc1)
  const p2 = parseCoord(loc2)
  if (!p1 || !p2) return Infinity

  const rad = (deg) => deg * Math.PI / 180
  const R = 6371000
  const dLat = rad(p2.lat - p1.lat)
  const dLng = rad(p2.lng - p1.lng)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(p1.lat)) * Math.cos(rad(p2.lat)) *
    Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 查找重合段站点（完整线路比对，基于坐标距离200米内算同一站，重合>=2站触发换乘）
const findOverlapStops = async (bus1, bus2, segIndex1, segIndex2) => {
  if (!bus1.buslines?.length || !bus2.buslines?.length) return []

  const MIN_OVERLAP_COUNT = 2 // 至少2个重合站才触发换乘
  const SAME_STOP_DISTANCE = 200

  for (const line1 of bus1.buslines) {
    for (const line2 of bus2.buslines) {
      // 获取完整站点列表
      let stops1 = await fetchBusLineStops(line1.name, '淄博')
      let stops2 = await fetchBusLineStops(line2.name, '淄博')

      // API失败则使用本地数据
      if (!stops1?.length) {
        stops1 = [line1.departure_stop, ...(line1.via_stops || []), line1.arrival_stop]
          .filter(Boolean).map(s => ({ name: s.name, location: s.location }))
      }
      if (!stops2?.length) {
        stops2 = [line2.departure_stop, ...(line2.via_stops || []), line2.arrival_stop]
          .filter(Boolean).map(s => ({ name: s.name, location: s.location }))
      }

      console.log(`[findOverlapStops] ${line1.name}(${stops1.length}站) vs ${line2.name}(${stops2.length}站)`)
      console.log(`  线路1起终点: ${line1.departure_stop?.name} -> ${line1.arrival_stop?.name}`)
      console.log(`  线路2起终点: ${line2.departure_stop?.name} -> ${line2.arrival_stop?.name}`)

      // 使用完整线路的所有站点进行比对，而不是只取行驶区间
      // 这样可以找到所有重合站，不仅仅是当前行驶区间内的
      const effectiveStops1 = stops1
      const effectiveStops2 = stops2

      console.log(`  使用完整线路比对: line1(${effectiveStops1.length}站) vs line2(${effectiveStops2.length}站)`)

      // 找出所有重合站点（200米内算同一站）
      const matchedPairs = []
      for (const stop1 of effectiveStops1) {
        for (const stop2 of effectiveStops2) {
          const distance = getDistance(stop1.location, stop2.location)
          if (distance <= SAME_STOP_DISTANCE) {
            console.log(`    ✓ 匹配: "${stop1.name}" <-> "${stop2.name}" (${Math.round(distance)}米)`)
            matchedPairs.push({
              name: stop1.name || stop2.name,
              location: stop1.location,
              distance: Math.round(distance),
              line1Name: line1.name,
              line2Name: line2.name,
              stop1Info: stop1,
              stop2Info: stop2,
              segIndex1,
              segIndex2
            })
          }
        }
      }

      // 去重：同名站点保留最近的
      const stopMap = new Map()
      for (const stop of matchedPairs) {
        const key = stop.name
        const existing = stopMap.get(key)
        if (!existing || stop.distance < existing.distance) {
          stopMap.set(key, stop)
        }
      }

      const uniqueStops = Array.from(stopMap.values())
      console.log(`[findOverlapStops] 找到${uniqueStops.length}个重合站:`, uniqueStops.map(s => `${s.name}(${s.distance}米)`))

      // 重合>=2站才返回（触发可自定义换乘选择器）
      if (uniqueStops.length >= MIN_OVERLAP_COUNT) {
        return uniqueStops
      }
    }
  }

  return []
}

// 处理换乘站点
const processTransferStops = async (transit) => {
  const transferStops = []

  for (let i = 0; i < transit.segments.length - 1; i++) {
    const currentSegment = transit.segments[i]
    const nextSegment = transit.segments[i + 1]

    if (currentSegment.bus && nextSegment.bus) {
      // 查找重合段站点（传入段索引用于方向过滤）
      const overlapStops = await findOverlapStops(currentSegment.bus, nextSegment.bus, i, i + 1)
      
      if (overlapStops.length > 0) {
        // 筛选换乘站点
        const filteredTransferStops = await Promise.all(
          overlapStops.map(async (stop) => {
            const score = await calculateTransferScore(stop, currentSegment.bus, nextSegment.bus)
            return { ...stop, score }
          })
        )
        
        transferStops.push({
          transferIndex: i,
          overlapStops: filteredTransferStops.sort((a, b) => b.score - a.score)
        })
      }
    }
  }
  
  return transferStops
}

// 计算换乘站点得分
const calculateTransferScore = async (stop, bus1, bus2) => {
  let score = 0
  
  try {
    // 1. 步行距离得分
    const walkingDistance = await calculateWalkingDistance(
      { lng: stop.location[0], lat: stop.location[1] },
      { lng: stop.location[0], lat: stop.location[1] }
    )
    
    if (walkingDistance <= routeConfig.transferWalkingThreshold) {
      score += 0.5
    }
    
    // 2. 同站台得分（简化处理）
    score += 0.2
    
    // 3. 运营时段得分
    score += 0.3
    
    return score
  } catch (error) {
    console.error('计算换乘得分失败:', error)
    return 0
  }
}

// 计算路线得分
const calculateRouteScore = (route) => {
  const config = routeSortConfig.default
  let score = 0
  
  // 时间得分（归一化）
  const timeScore = Math.max(0, 1 - (route.duration || 0) / 7200) // 假设2小时为0分
  score += timeScore * config.time
  
  // 换乘得分
  const transferCount = route.transfers || 0
  const transferScore = Math.max(0, 1 - transferCount / 3) // 假设3次换乘为0分
  score += transferScore * config.transfers
  
  // 超过最大换乘次数的惩罚
  if (transferCount > config.maxTransfers) {
    score *= 0.5
  }
  
  return score
}

// 公交路线排序
const sortTransitRoutes = (routes) => {
  const mode = transitSortMode.value
  const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return [...routes].sort((a, b) => {
    const da = toNum(a?.duration)
    const db = toNum(b?.duration)
    const wa = toNum(a?.walking_distance ?? a?.walkingDistance)
    const wb = toNum(b?.walking_distance ?? b?.walkingDistance)
    const ca = toNum(a?.cost)
    const cb = toNum(b?.cost)

    if (mode === 'walking') {
      if (wa !== wb) return wa - wb
      if (da !== db) return da - db
      return ca - cb
    }
    if (mode === 'cost') {
      if (ca !== cb) return ca - cb
      if (da !== db) return da - db
      return wa - wb
    }
    if (da !== db) return da - db
    if (wa !== wb) return wa - wb
    return ca - cb
  })
}

// 驾车/步行路线排序（不重新请求，仅重排现有 routeResults）
const sortNonTransitRoutes = (routes) => {
  const mode = nonTransitSortMode.value
  const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return [...routes].sort((a, b) => {
    const da = toNum(a?.duration)
    const db = toNum(b?.duration)
    const distA = toNum(a?.distance)
    const distB = toNum(b?.distance)

    if (mode === 'distance') {
      if (distA !== distB) return distA - distB
      return da - db
    }

    // 默认：时间优先
    if (da !== db) return da - db
    return distA - distB
  })
}

// 切换排序方式后，立即对当前非公交结果重排（不重新请求接口）
watch(nonTransitSortMode, async () => {
  try {
    if (!Array.isArray(routeResults.value) || routeResults.value.length === 0) return
    if (routePlanning.value.travelMode === 'transit') return
    if (routeResults.value.length <= 1) return

    routeResults.value = sortNonTransitRoutes(routeResults.value)
    selectedRouteIndex.value = 0
    await selectRoute(0)
  } catch (e) {
    console.warn('非公交方案重排失败（忽略）:', e)
  }
})

// 获取“相对基准”的差值文案（只用于非公交卡片；基准为排序后的第一条）
const getNonTransitRelativeDiff = (index) => {
  const base = routeResults.value?.[0]
  const current = routeResults.value?.[index]
  if (!base || !current) return { text: '', tone: 'neutral' }
  if (index === 0) {
    const baseLabel = nonTransitSortMode.value === 'distance' ? '距离优先' : '时间优先'
    return { text: `基准（${baseLabel}）`, tone: 'neutral' }
  }

  const baseDistance = Number(base?.distance) || 0
  const baseDuration = Number(base?.duration) || 0
  const curDistance = Number(current?.distance) || 0
  const curDuration = Number(current?.duration) || 0

  const deltaDistance = curDistance - baseDistance // 米
  const deltaDuration = curDuration - baseDuration // 秒

  const fmtDistanceAbs = (meters) => {
    const abs = Math.abs(meters)
    if (abs < 1000) return `${Math.round(abs)}米`
    return `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}公里`
  }

  const fmtMinutesAbs = (seconds) => {
    const absSeconds = Math.abs(seconds)
    const minutes = absSeconds / 60
    const display =
      minutes >= 1
        ? Math.round(minutes)
        : Number(minutes.toFixed(1).replace(/\.0$/, '0'))
    return `${display}分钟`
  }

  const parts = []

  if (deltaDistance !== 0) {
    if (deltaDistance > 0) parts.push(`多${fmtDistanceAbs(deltaDistance)}`)
    else parts.push(`少${fmtDistanceAbs(deltaDistance)}`)
  }

  if (deltaDuration !== 0) {
    if (deltaDuration > 0) parts.push(`慢${fmtMinutesAbs(deltaDuration)}`)
    else parts.push(`快${fmtMinutesAbs(deltaDuration)}`)
  }

  if (parts.length === 0) return { text: '与基准一致', tone: 'neutral' }

  const primaryDelta = nonTransitSortMode.value === 'distance' ? deltaDistance : deltaDuration
  const tone = primaryDelta > 0 ? 'worse' : primaryDelta < 0 ? 'better' : 'neutral'
  return { text: parts.join(' · '), tone }
}

// 处理路线结果
const processRouteResults = async (data, mode) => {
  console.log('处理路线结果:', { mode, data })
  
  try {
    if (data.status === '1' && data.route) {
      if (mode === 'transit' && data.route.transits) {
        console.log('公交路径规划，transits数量:', data.route.transits.length)
        
        routeResults.value = []
        showRouteResults.value = true
        selectedRouteIndex.value = 0
        
        // 添加到历史记录
        if (routePlanning.value.startPoint && routePlanning.value.endPoint) {
          addToHistory(
            routePlanning.value.startPoint,
            routePlanning.value.endPoint,
            mode,
            data.route.transits[0] // 添加第一个方案作为默认选中
          )
        }

        const CONCURRENCY_LIMIT = 3
        // 给每个方案打上稳定索引，便于调试识别逻辑到底在比对“哪个方案”
        const queue = data.route.transits.map((t, i) => ({ ...t, __apiIndex: i }))
        let activeCount = 0
        let finishedCount = 0

        const processedRouteKeys = new Set()
        const processNext = async () => {
          if (queue.length === 0) return

          activeCount++
          const transit = queue.shift()

          try {
            // 去重（签名）：避免多 strategy / 增强重规划导致同一方案重复展示
            const signature = (() => {
              const segs = Array.isArray(transit?.segments) ? transit.segments : []
              const parts = []
              for (const seg of segs) {
                const buslines =
                  (seg?.bus && Array.isArray(seg.bus.buslines) && seg.bus.buslines) ||
                  (seg?.subway && Array.isArray(seg.subway.buslines) && seg.subway.buslines) ||
                  []
                if (buslines.length > 0) {
                  const line = buslines[0]
                  parts.push(`L:${String(line?.name || '')}@${String(line?.departure_stop?.name || '')}->${String(line?.arrival_stop?.name || '')}`)
                } else if (seg?.walking) {
                  const wdist = Number(seg.walking.distance) || 0
                  const bucket = Math.round(wdist / 50) * 50
                  parts.push(`W:${bucket}`)
                } else {
                  parts.push('X')
                }
              }
              return parts.join('|')
            })()

            if (!processedRouteKeys.has(signature)) {
              processedRouteKeys.add(signature)
              const routeResult = await processTransitData(transit, routePlanning.value.startPoint, routePlanning.value.endPoint)
              if (routeResult) {
                // 打印识别后的关键字段，确认属性是否存在
                console.log(`方案处理完成，识别到的换乘点数: ${routeResult.allStations.filter(s => s.isTransferOption).length}`)

                // 核心修复：先推入，再强制更新视图
                routeResults.value.push(routeResult)

                // 如果是第一个成功的方案，自动绘制
                if (routeResults.value.length === 1 && !routeLine) {
                  await selectRoute(0)
                }
              }
            }
          } catch (error) {
            console.error('处理单个公交方案失败:', error)
          } finally {
            activeCount--
            finishedCount++
            // 继续处理队列，并加入小延迟避免 API 并发限制
            if (queue.length > 0) {
              await new Promise(r => setTimeout(r, 300))
              processNext()
            }
          }
        }

        // 启动初始并发
        const loadingPromises = []
        for (let j = 0; j < Math.min(CONCURRENCY_LIMIT, queue.length); j++) {
          loadingPromises.push(processNext())
        }

        // 等待第一批结果完成，确保至少显示一个或处理完所有队列
        await Promise.all(loadingPromises)

        console.log('公交方案首屏加载完成')

        // 移除重复的显示逻辑
        console.log('所有公交方案结果处理完成:', routeResults.value)

        if (routeResults.value.length === 0) {
          console.error('没有成功处理任何公交方案')
          alert('公交方案处理失败')
          showRouteResults.value = false
          return
        }

        // 显示结果页面
        showRouteResults.value = true
        selectedRouteIndex.value = 0

        console.log('showRouteResults:', showRouteResults.value)
        console.log('routeResults.length:', routeResults.value.length)

        // 默认显示第一个方案
        if (routeResults.value.length > 0) {
          console.log('准备绘制第一个方案')
          await selectRoute(0) // 使用selectRoute而不是viewRoute
        }
      } else if (data.route.paths && data.route.paths.length > 0) {
        // 驾车和步行路径规划有paths字段
        const paths = data.route.paths

        // 处理所有路径方案
        paths.forEach((path, index) => {
          console.log(`处理第${index}个路径方案:`, path)
          try {
            const routeResult = processRouteData(path, routePlanning.value.travelMode)
            routeResults.value.push(routeResult)
          } catch (error) {
            console.error(`处理第${index}个路径方案失败:`, error)
          }
        })

        console.log('所有路径方案结果:', routeResults.value)

        if (routeResults.value.length === 0) {
          console.error('没有成功处理任何路径方案')
          alert('路径方案处理失败')
          return
        }

        // paths 备选进一步去重：同一路线在不同 strategy 下仍可能返回“看起来一样但签名不同”
        const getSimplePathSignature = (pathData) => {
          const path = (pathData && Array.isArray(pathData.paths)) ? pathData.paths[0] : pathData
          const polylineStr =
            (typeof path?.polyline === 'string' && path.polyline.trim())
              ? path.polyline.trim()
              : (Array.isArray(path?.steps) ? joinStepsPolyline(path.steps) : '')
          if (!polylineStr) return ''

          const pts = polylineStr
            .split(';')
            .map(s => s.split(','))
            .map(parts => {
              if (parts.length !== 2) return null
              const lng = Number(parts[0])
              const lat = Number(parts[1])
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
              return { lng, lat }
            })
            .filter(Boolean)

          if (pts.length < 2) return ''

          // 统一采样点并粗量化，减少“几米差异”带来的伪不同
          const sampleCount = Math.min(25, pts.length)
          const step = Math.max(1, Math.floor(pts.length / sampleCount))
          const sampled = []
          for (let i = 0; i < pts.length; i += step) {
            const pt = pts[i]
            sampled.push(`${pt.lng.toFixed(3)},${pt.lat.toFixed(3)}`)
            if (sampled.length >= sampleCount) break
          }
          return sampled.join('|')
        }

        const betterByDurationThenDistance = (a, b) => {
          const da = Number(a?.duration) || 0
          const db = Number(b?.duration) || 0
          if (da !== db) return da < db
          const distA = Number(a?.distance) || 0
          const distB = Number(b?.distance) || 0
          return distA < distB
        }

        const sigToBest = new Map()
        routeResults.value.forEach(r => {
          const sig = getSimplePathSignature(r?.pathData)
          if (!sig) return
          const prev = sigToBest.get(sig)
          if (!prev || betterByDurationThenDistance(r, prev)) sigToBest.set(sig, r)
        })
        routeResults.value = Array.from(sigToBest.values())
          .sort((a, b) => (Number(a?.duration) || 0) - (Number(b?.duration) || 0))

        // 显示结果页面
        showRouteResults.value = true
        selectedRouteIndex.value = 0

        console.log('showRouteResults:', showRouteResults.value)
        console.log('routeResults.length:', routeResults.value.length)

        // 非公交：一次性渲染所有备选路线，并根据 selectedRouteIndex 高亮
        if (routeResults.value.length > 0) {
          console.log('准备渲染所有备选方案')
          await renderAllSimpleAlternatives(mode)
        }
      } else {
        console.error('没有找到路径数据')
        console.log('route对象:', data.route)
        console.log('是否有transits:', !!(data.route && data.route.transits))
        console.log('是否有paths:', !!(data.route && data.route.paths))
        alert('没有找到路径数据')
      }
    } else {
      console.error('路径规划失败:', data)
      console.log('状态码:', data.status)
      console.log('错误信息:', data.info)
      console.log('完整API响应:', JSON.stringify(data, null, 2))
      alert(`路径规划失败: ${data.info || '未知错误'}\n状态码: ${data.status}`)
    }
  } catch (error) {
    console.error('路径规划错误:', error)
    alert('路径规划失败，请重试')
  }
}

// 获取路径API URL
const getRouteApiUrl = (mode, start, end) => {
  switch (mode) {
    case 'driving':
      return `https://restapi.amap.com/v3/direction/driving?origin=${start.lng},${start.lat}&destination=${end.lng},${end.lat}&key=${AMAP_DIRECTION_KEY}&extensions=all`
    case 'walking':
      return `https://restapi.amap.com/v3/direction/walking?origin=${start.lng},${start.lat}&destination=${end.lng},${end.lat}&key=${AMAP_DIRECTION_KEY}`
    case 'transit':
      // strategy 在请求层单独控制（0/2/3/5），这里返回基础 URL
      return `https://restapi.amap.com/v3/direction/transit/integrated?origin=${start.lng},${start.lat}&destination=${end.lng},${end.lat}&key=${AMAP_DIRECTION_KEY}&city=淄博&extensions=all&nightflag=0`
    default:
      return ''
  }
}

// 获取步行路线数据
const getWalkingRouteData = async (start, end) => {
  const cacheKey = `${start.lng},${start.lat}-${end.lng},${end.lat}`
  if (walkingCache.has(cacheKey)) {
    console.log('使用步行缓存数据:', cacheKey)
    return walkingCache.get(cacheKey)
  }

  try {
    // 验证坐标格式
    console.log('步行API输入坐标验证:')
    console.log('起点:', start, '类型:', typeof start.lng, typeof start.lat)
    console.log('终点:', end, '类型:', typeof end.lng, typeof end.lat)
    
    if (!start || !end || !start.lng || !start.lat || !end.lng || !end.lat) {
      console.error('步行API坐标无效:', { start, end })
      throw new Error('坐标无效')
    }
    
    // 检查坐标范围（淄博市范围）
    if (Math.abs(start.lng) > 180 || Math.abs(start.lat) > 90 || Math.abs(end.lng) > 180 || Math.abs(end.lat) > 90) {
      console.error('步行API坐标超出范围:', { start, end })
      throw new Error('坐标超出范围')
    }
    
    const url = getRouteApiUrl('walking', start, end)
    console.log('调用步行API:', url)
    
    const data = await new Promise((resolve, reject) => {
      const callbackName = `walking_callback_${Date.now()}`
      
      window[callbackName] = (data) => {
        console.log('步行API返回数据:', data)
        if (data && data.status === '1' && data.route && data.route.paths && data.route.paths.length > 0) {
          const path = data.route.paths[0]
          console.log('步行路径数据:', path)
          
          // 检查返回的距离是否合理
          const distance = path.distance || 0
          const duration = path.duration || 0
          
          console.log('步行API返回原始数据检查:')
          console.log(`距离: ${distance}米`)
          console.log(`时间: ${duration} (单位可能是秒或分钟)`)
          
          if (distance > 100000) { // 超过100公里肯定有问题
            console.warn(`⚠️ 步行API返回距离异常: ${distance}米，使用默认值`)
            resolve({
              distance: 200,
              duration: 150,
              steps: path.steps || []
            })
          } else {
            console.log(`✅ 步行数据正常: 距离${distance}米, 时间${duration}秒`)
            resolve({
              distance: distance,
              duration: duration,
              steps: path.steps || []
            })
          }
        } else {
          console.error('步行API返回错误:', data)
          resolve({ distance: 0, duration: 0, steps: [] })
        }
        delete window[callbackName]
      }
      
      const script = document.createElement('script')
      const url = `https://restapi.amap.com/v3/direction/walking?origin=${start.lng},${start.lat}&destination=${end.lng},${end.lat}&key=${AMAP_SEARCH_KEY}&output=json&callback=${callbackName}`
      script.src = url
      script.onerror = () => {
        console.error('步行API脚本加载失败')
        resolve({ distance: 0, duration: 0, steps: [] })
        delete window[callbackName]
      }
      document.head.appendChild(script)
      
      // 超时处理
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName]
          resolve({
            distance: 0,
            duration: 0,
            steps: []
          })
        }
      }, 5000)
    })
    
    walkingCache.set(cacheKey, data)
    return data
  } catch (error) {
    console.error('获取步行数据异常:', error)
    return { distance: 0, duration: 0, steps: [] }
  }
}

// 处理公交路径数据
const processTransitData = async (transit, startPoint, endPoint) => {
  console.log('=== 开始处理公交方案 ===')
  
  // 不可绘制的兜底：高德偶发会返回 segments 为空/缺失的方案
  // 这类方案即使“有耗时/距离”，也无法在地图上绘制，必须过滤掉，否则会出现“最后一个方案没路线”
  if (!transit || !Array.isArray(transit.segments) || transit.segments.length === 0) {
    console.warn('过滤不可绘制公交方案：segments 为空或缺失', transit)
    return null
  }

  const result = {
    mode: 'transit',
    distance: Number(transit.distance) || 0,
    duration: Number(transit.duration) || 0,
    cost: Number(transit.cost) || 0,
    walkingDistance: Number(transit.walking_distance) || 0,
    walkingTime: Number(transit.walking_duration) || 0,
    transfers: 0,
    stations: 0,
    allStations: [],
    busLines: [],
    walkingPaths: [],
    pathData: transit,
    isInvalid: false,
    invalidReason: '',
    // 用于“绕路检测”的参考点
    _startPoint: startPoint,
    _endPoint: endPoint,
    // 调试：标记该方案在 API 返回里的序号
    _apiIndex: typeof transit?.__apiIndex === 'number' ? transit.__apiIndex : -1,
    // 调试：可读的方案标识（后续会补充线路摘要）
    _debugId: ''
  }

  // 1. 遍历所有 segments，提取公交线路并收集站点
  console.log(`[processTransitData] 总段数: ${transit.segments.length}`)
  for (let i = 0; i < transit.segments.length; i++) {
    const segment = transit.segments[i]
    const busInfo = segment.bus?.buslines?.[0]
    const walkInfo = segment.walking
    console.log(`[processTransitData] 段${i}: ${busInfo ? '公交-' + busInfo.name : ''} ${walkInfo ? '步行' + walkInfo.distance + '米' : ''}`)
    
    // 处理公交/地铁线路
    const buslines = (segment.bus && segment.bus.buslines) || (segment.subway && segment.subway.buslines)
    if (buslines && buslines.length > 0) {
      const isSubway = !!segment.subway
      const segmentLines = buslines.map(line => ({
        name: line.name,
        type: isSubway ? 'subway' : 'bus',
        departureStop: line.departure_stop.name,
        arrivalStop: line.arrival_stop.name,
        location: line.location,
        polyline: line.polyline,
        // 只画“本次乘坐区间”的站点序列，避免某些线路 polyline 带整条线路/回场导致绕路
        stopPath: (() => {
          const pts = []
          const pushLoc = (loc) => {
            const p = parseLoc(loc)
            if (p) pts.push([p.lng, p.lat])
          }
          pushLoc(line.departure_stop?.location)
          ;(line.via_stops || []).forEach(s => pushLoc(s.location))
          pushLoc(line.arrival_stop?.location)
          return pts.length >= 2 ? pts : null
        })(),
        via_stops: line.via_stops || []
      }))
      
      result.busLines.push(segmentLines)
      
      // 收集主线路站点用于展示
      const mainLine = buslines[0]
      if (mainLine) {
        // 补充调试：拼线路摘要
        if (!result._debugId) {
          result._debugId = `T#${result._apiIndex} ${mainLine.name}(${mainLine.departure_stop?.name || ''}→${mainLine.arrival_stop?.name || ''})`
        } else if (!result._debugId.includes(mainLine.name)) {
          result._debugId += ` | ${mainLine.name}(${mainLine.departure_stop?.name || ''}→${mainLine.arrival_stop?.name || ''})`
        }
        // 起点站
        result.allStations.push({
          type: 'station',
          name: mainLine.departure_stop.name,
          location: mainLine.departure_stop.location,
          lineName: mainLine.name,
          isDeparture: true,
          segmentIndex: result.busLines.length - 1
        })
        // 途经站
        if (mainLine.via_stops) {
          mainLine.via_stops.forEach(stop => {
            result.allStations.push({
              type: 'station',
              name: stop.name,
              location: stop.location,
              lineName: mainLine.name,
              isVia: true,
              segmentIndex: result.busLines.length - 1
            })
          })
        }
        // 终点站
        result.allStations.push({
          type: 'station',
          name: mainLine.arrival_stop.name,
          location: mainLine.arrival_stop.location,
          lineName: mainLine.name,
          isArrival: true,
          segmentIndex: result.busLines.length - 1
        })
      }
    }

    // 处理步行轨迹并按文档阈值校验（起/终点接驳≤2000m，换乘≤400m）
    if (segment.walking) {
      const segWalkingDist = Number(segment.walking.distance) || 0

      // 识别步行段类型：首段=起点接驳，末段=终点接驳，中间=换乘步行
      const isFirst = i === 0
      const isLast = i === transit.segments.length - 1
      const walkingType = isFirst ? 'access' : (isLast ? 'egress' : 'transfer')

      // 文档阈值：
      // - 起点/终点接驳：<= 2000m
      // - 换乘步行：<= 400m
      const limit =
        walkingType === 'transfer'
          ? routeConfig.transferWalkingThreshold
          : routeConfig.walkingDistanceThreshold

      if (segWalkingDist > limit && limit > 0) {
        // 严格按文档阈值过滤（起/终点接驳≤2000m，换乘≤400m）
        result.isInvalid = true
        result.invalidReason = `${walkingType === 'transfer' ? '换乘' : '接驳'}步行距离过长: ${segWalkingDist}米 > ${limit}米`
        console.warn(`🛑 过滤方案(文档阈值): 段${i} ${walkingType}步行 ${segWalkingDist}米 > ${limit}米`)
        return null
      }

      if (segment.walking.polyline) {
        const path = []
        segment.walking.polyline.split(';').forEach(p => {
          const parts = p.split(',')
          if (parts.length === 2) path.push([parseFloat(parts[0]), parseFloat(parts[1])])
        })
        result.walkingPaths.push({ type: 'segment', path, segIndex: i })
      }
    }
  }

  // 再次过滤：如果整条方案没有任何可绘制的公交 polyline 或步行 polyline，直接丢弃
  const hasWalkPath = Array.isArray(result.walkingPaths) && result.walkingPaths.some(w => Array.isArray(w.path) && w.path.length >= 2)
  const hasTransitPolyline = Array.isArray(result.busLines) && result.busLines.some(lines => Array.isArray(lines) && lines.some(l => typeof l.polyline === 'string' && l.polyline.includes(';')))
  if (!hasWalkPath && !hasTransitPolyline) {
    console.warn('过滤不可绘制公交方案：缺少公交/步行 polyline', transit)
    return null
  }

  // 绕路检测：如果路线距离远超起终点直线距离，则判定为异常方案并过滤
  try {
    const straight = getStraightLineDistance(startPoint, endPoint)
    // 用“实际绘制路径”的长度做绕路判断（比 transit.distance 更可靠）
    let routeDist = 0
    if (Array.isArray(result.busLines) && result.busLines.length > 0) {
      result.busLines.forEach(lines => {
        ;(lines || []).forEach(l => {
          if (Array.isArray(l.stopPath) && l.stopPath.length >= 2) {
            routeDist += getPathLengthMeters(l.stopPath)
          }
        })
      })
    }
    // 加上步行 polyline 的长度（接驳/换乘步行）
    if (Array.isArray(result.walkingPaths)) {
      result.walkingPaths.forEach(w => {
        if (Array.isArray(w?.path) && w.path.length >= 2) {
          routeDist += getPathLengthMeters(w.path)
        }
      })
    }
    // fallback：都拿不到时才用高德返回距离
    if (!routeDist) routeDist = Number(result.distance) || 0
    // 直线距离很小且 routeDist 极大，或绕路倍数过高 => 过滤
    // 阈值经验值：>3.2倍基本属于“绕很大圈”；直线<3km但路线>20km 也很离谱
    const detourRatio = straight > 0 ? routeDist / straight : Infinity
    // 更严格的“绕路”过滤，优先保证路线看起来正常
    const tooDetour =
      // 直线很短但路线拉得很长，基本就是兜圈
      (straight < 4000 && routeDist > 10000) ||
      // 中短距离：绕路倍率稍高就过滤
      (straight < 8000 && detourRatio > 2.2) ||
      // 任意距离：超过 2.8 倍直接判定异常
      detourRatio > 2.8
    if (tooDetour) {
      // 过滤明显绕圈/离谱方案：这类方案会严重干扰用户判断“正常方案”
      result.isInvalid = true
      result.invalidReason = `疑似绕路过大：直线${Math.round(straight)}m，路线${Math.round(routeDist)}m（${detourRatio.toFixed(1)}倍）`
      console.warn('过滤绕路异常公交方案:', result.invalidReason, transit)
      return null
    }
  } catch (e) {
    // 忽略绕路检测异常
  }

  // 步行距离过长过滤：步行超过2.5公里的方案不合理（步行5公里比公交还快是不现实的）
  if (result.walkingDistance > 2500) {
    console.warn(`过滤步行距离过长的方案: 步行${Math.round(result.walkingDistance)}m超过2.5km阈值`, transit)
    return null
  }

  // 2. 识别重合换乘站点（基于坐标匹配，200米内算同一站，>=2站才触发）
  if (result.busLines.length >= 2) {
    console.log(`[重合识别] 基于坐标匹配识别重合站: ${result._debugId || `T#${result._apiIndex}`}`)

    for (let i = 0; i < transit.segments.length - 1; i++) {
      const currentSeg = transit.segments[i]
      const nextSeg = transit.segments[i + 1]

      // 严格判断：两段都必须有有效的公交线路信息
      const hasBusLine1 = currentSeg.bus?.buslines?.length > 0
      const hasBusLine2 = nextSeg.bus?.buslines?.length > 0
      
      if (hasBusLine1 && hasBusLine2) {
        // 使用坐标匹配查找重合站（>=2站才返回）
        const overlapStops = await findOverlapStops(currentSeg.bus, nextSeg.bus, i, i + 1)

        if (overlapStops.length >= 2) {
          console.log(`[重合识别] 段${i}->${i+1} 找到${overlapStops.length}个重合站，标记为可换乘`)

          // 标记所有重合站点为可换乘（橙色显示）
          for (const stop of overlapStops) {
            // 在allStations中查找并标记
            const matchedStation = result.allStations.find(s =>
              s.type === 'station' &&
              (s.name === stop.name || getDistance(s.location, stop.location) <= 200)
            )

            if (matchedStation) {
              matchedStation.isTransferOption = true
              matchedStation.isOverlapTransfer = true // 标记为重合换乘（可用于自定义选择）
              matchedStation.transferPair = [i, i + 1]
              matchedStation.walkingDistance = stop.distance
              console.log(`  ✅ 标记换乘站: ${stop.name}`)
            }
          }

          // 默认第一个为当前换乘站
          const firstStop = overlapStops[0]
          const firstMatched = result.allStations.find(s =>
            s.type === 'station' &&
            (s.name === firstStop.name || getDistance(s.location, firstStop.location) <= 200)
          )
          if (firstMatched) {
            firstMatched.isCurrentTransfer = true
          }

          console.log(`[重合识别] 多个换乘点可选，将显示换乘选择器`)
        } else {
          console.log(`[重合识别] 段${i}->${i+1} 重合站不足2个，使用默认换乘点`)
        }
      }
    }

    // 3. 标记异站换乘点（非重合换乘站）
    // 对于没有重合站的换乘段，标记前一段终点和后一段起点为换乘站
    for (let i = 0; i < transit.segments.length - 1; i++) {
      const currentSeg = transit.segments[i]
      const nextSeg = transit.segments[i + 1]

      // 严格判断：两段都必须有有效的公交线路信息
      const hasBusLine1 = currentSeg.bus?.buslines?.length > 0
      const hasBusLine2 = nextSeg.bus?.buslines?.length > 0
      
      console.log(`[异站换乘检查] 段${i}->${i+1}: hasBusLine1=${hasBusLine1}, hasBusLine2=${hasBusLine2}`)
      console.log(`  currentSeg.bus:`, currentSeg.bus?.buslines?.[0]?.name || '无')
      console.log(`  nextSeg.bus:`, nextSeg.bus?.buslines?.[0]?.name || '无')

      // 只处理两段都是公交且没有重合站的情况
      if (hasBusLine1 && hasBusLine2) {
        // 检查是否已经有重合站被标记
        const hasOverlapStations = result.allStations.some(s =>
          s?.isTransferOption &&
          Array.isArray(s.transferPair) &&
          s.transferPair[0] === i && s.transferPair[1] === i + 1
        )

        // 如果没有重合站，标记异站换乘点
        if (!hasOverlapStations) {
          console.log(`[异站换乘] 段${i}->${i+1} 无重合站，标记换乘点`)

          // 获取前一段的终点和后一段的起点
          const line1 = currentSeg.bus.buslines?.[0]
          const line2 = nextSeg.bus.buslines?.[0]

          if (line1?.arrival_stop && line2?.departure_stop) {
            // 标记前一段终点为换乘站
            const endStation = result.allStations.find(s =>
              s.type === 'station' &&
              s.segmentIndex === i &&
              s.name === line1.arrival_stop.name
            )
            if (endStation) {
              endStation.isTransferOption = true
              endStation.transferPair = [i, i + 1]
              endStation.isCurrentTransfer = true
              endStation.isInterStationTransfer = true // 标记为异站换乘
              console.log(`  ✅ 标记异站换乘(终点): ${endStation.name}`)
            }

            // 标记后一段起点为换乘站
            const startStation = result.allStations.find(s =>
              s.type === 'station' &&
              s.segmentIndex === i + 1 &&
              s.name === line2.departure_stop.name
            )
            if (startStation) {
              startStation.isTransferOption = true
              startStation.transferPair = [i, i + 1]
              startStation.isInterStationTransfer = true // 标记为异站换乘
              console.log(`  ✅ 标记异站换乘(起点): ${startStation.name}`)
            }
          }
        }
      }
    }

    // 通过解构触发响应式更新
    result.allStations = [...result.allStations]
  }

  result.transfers = result.busLines.length > 0 ? result.busLines.length - 1 : 0
  result.stations = result.allStations.filter(s => s.type === 'station').length

  // 过滤逻辑：只有两条公交线路时，如果同时存在异站换乘和同站换乘（重合站>=2），剔除该方案
  if (result.busLines.length === 2) {
    const hasOverlapTransfer = result.allStations.some(s => s?.isOverlapTransfer)
    const hasInterStationTransfer = result.allStations.some(s => s?.isInterStationTransfer)
    
    if (hasOverlapTransfer && hasInterStationTransfer) {
      console.log(`[方案过滤] 剔除方案：只有2条线路但同时存在同站换乘(重合>=2)和异站换乘，逻辑矛盾`)
      return null
    }
  }

  return result
}

// 站名归一化：去掉括号/空格/常见后缀，提升重合站匹配鲁棒性
const normalizeStopName = (name) => {
  if (!name) return ''
  return String(name)
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '') // 去掉括号内容
    .replace(/站台|主站台|东站台|西站台|南站台|北站台/g, '')
    .replace(/东门|西门|南门|北门|东口|西口|南口|北口/g, '')
    .trim()
}

// 站名相似：完全相等 或 互为包含（长度>=2，避免“路/站”等噪音误匹配）
const isStopNameSimilar = (a, b) => {
  const nA = normalizeStopName(a)
  const nB = normalizeStopName(b)
  if (!nA || !nB) return false
  if (nA === nB) return true
  if (nA.length >= 2 && nB.length >= 2) {
    return nA.includes(nB) || nB.includes(nA)
  }
  return false
}

// 坐标解析：支持 "lng,lat" 或 [lng,lat]，返回 {lng,lat} 或 null
const parseLoc = (loc) => {
  if (!loc) return null
  if (Array.isArray(loc) && loc.length === 2) {
    const lng = Number(loc[0])
    const lat = Number(loc[1])
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat }
    return null
  }
  if (typeof loc === 'string') {
    const parts = loc.split(',').map(s => Number(s.trim()))
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return { lng: parts[0], lat: parts[1] }
    }
  }
  return null
}

// 坐标匹配精度函数（字符串归一化展示用）
const getLocStr = (loc) => {
  const p = parseLoc(loc)
  if (!p) return null
  return `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`
}

// 公交线路全站点缓存（用于“重合段>2站”的增强识别）
const busLineStopsCache = new Map() // key: city|keyword -> { timestamp, stops: [{name, location}] }
// 同请求合并（in-flight 去重）：避免同一时刻多个方案重复打同一个 bus/linename
const busLineStopsInFlight = new Map() // key: city|keyword -> Promise<stops[]>
// 高德 bus/linename 限流熔断：遇到 10021（QPS/配额超限）时，短时间内不再继续请求，避免把配额打爆
let busLineApiLimitedUntil = 0
let busLineApiLimitLogAt = 0

// 从线路名提取更适合查询的关键词（去掉括号内容，优先取斜杠前）
const toBusLineKeyword = (rawName) => {
  if (!rawName) return ''
  const s = String(rawName).split('/')[0] // "7路/K7路" -> "7路"
  return s.replace(/[（(].*?[）)]/g, '').trim()
}

// 查询公交线路全站点：v3/bus/linename（返回 stops: [{name, location}]）
const fetchBusLineStops = async (lineName, cityName = '淄博', hint = {}) => {
  if (Date.now() < busLineApiLimitedUntil) {
    return []
  }
  const raw = String(lineName || '').trim()
  const keyword1 = toBusLineKeyword(raw)
  const keyword2 = raw.replace(/[（(].*?[）)]/g, '').trim() // 去掉括号
  const keyword3 = raw.split('/')[0].trim() // "7路/K7路(...)" -> "7路"
  const keywords = Array.from(new Set([keyword1, keyword2, keyword3].filter(Boolean)))
  if (keywords.length === 0) return []

  // 注意：关键词不同会影响返回线路集合，因此缓存按 keyword 维度分开
  const cacheKey = `${cityName}|${keywords[0]}`
  const cached = busLineStopsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 6 * 60 * 60 * 1000) {
    return cached.stops || []
  }

  const parseStopsFromBusline = (busline) => {
    // 高德常见字段：busstops；部分场景是 via_stops + start_stop/end_stop
    if (Array.isArray(busline?.busstops) && busline.busstops.length > 0) {
      return busline.busstops.map(s => ({ name: s.name, location: s.location }))
    }
    const via = Array.isArray(busline?.via_stops) ? busline.via_stops : []
    const all = []
    if (busline?.start_stop) all.push({ name: busline.start_stop.name, location: busline.start_stop.location })
    via.forEach(s => all.push({ name: s.name, location: s.location }))
    if (busline?.end_stop) all.push({ name: busline.end_stop.name, location: busline.end_stop.location })
    return all
  }

  const pickBestLine = (buslines, keywordForMatch = '') => {
    if (!Array.isArray(buslines) || buslines.length === 0) return null
    const hintStart = normalizeStopName(hint?.segmentStartName || '')
    const hintEnd = normalizeStopName(hint?.segmentEndName || '')
    const kwMatch = String(keywordForMatch || '').trim()

    // 给每条候选线路打分：优先包含本方案的上/下车站名（在全站点中能找到）
    const scored = buslines.map(b => {
      const stops = parseStopsFromBusline(b)
      const normStops = new Set(stops.map(s => normalizeStopName(s.name)).filter(Boolean))
      let score = 0
      if (hintStart && normStops.has(hintStart)) score += 5
      if (hintEnd && normStops.has(hintEnd)) score += 5
      if (kwMatch && typeof b?.name === 'string' && b.name.includes(kwMatch)) score += 2
      // 站点越多越像“完整线路”
      score += Math.min(2, Math.floor((stops.length || 0) / 20))
      return { b, score, stopsLen: stops.length || 0 }
    })

    scored.sort((x, y) => y.score - x.score)
    return scored[0]?.b || buslines[0]
  }

  const requestOnce = async (kw) => {
    if (Date.now() < busLineApiLimitedUntil) {
      return []
    }
    const inflightKey = `${cityName}|${kw}`
    const existing = busLineStopsInFlight.get(inflightKey)
    if (existing) {
      try {
        return await existing
      } catch {
        return []
      }
    }

    // 优先走后端代理，避免前端直连导致 CORS/限流
    const url = `/api/amap/bus/linename?keywords=${encodeURIComponent(kw)}&city=${encodeURIComponent(cityName)}&extensions=all&offset=10&page=1&output=json`
    const doRequest = async () => {
      let data = null
      let transport = 'fetch'
      try {
        const resp = await fetch(url)
        // 后端对 10021 会返回 429；这里要显式识别，避免当成“无结果”而反复触发
        const isJson = (resp.headers.get('content-type') || '').includes('application/json')
        data = isJson ? await resp.json() : null

        if (resp.status === 429) {
          busLineApiLimitedUntil = Date.now() + 10 * 60 * 1000 // 10分钟
          if (Date.now() - busLineApiLimitLogAt > 30 * 1000) {
            busLineApiLimitLogAt = Date.now()
            console.warn(`[bus/linename] 触发限流熔断：HTTP 429（后端判定 infocode=10021），10分钟内跳过全站点增强识别（仍保留基础重合识别）。`)
          }
          return []
        }

        if (!resp.ok) {
          transport = 'proxy_bad_status'
          console.warn('[bus/linename] 代理返回非200:', resp.status, data)
          return []
        }
      } catch (e) {
        // 代理请求失败：直接返回空（避免继续用前端 key 去打爆配额）
        transport = 'proxy_error'
        console.warn('[bus/linename] 代理请求异常:', e)
        return []
      }

      if (data?.status !== '1' || !Array.isArray(data.buslines) || data.buslines.length === 0) {
        const msg = `[bus/linename] 查询失败/无结果 | transport=${transport} | kw="${kw}" | city="${cityName}" | status=${data?.status} | info=${data?.info} | infocode=${data?.infocode} | count=${data?.count}`
        // 用字符串打印，避免控制台折叠 Object 导致看不到关键字段
        console.warn(msg)
        // 限流/配额超限：熔断一段时间，避免持续请求
        if (String(data?.infocode) === '10021' || String(data?.info || '').includes('CUQPS_HAS_EXCEEDED_THE_LIMIT')) {
          busLineApiLimitedUntil = Date.now() + 10 * 60 * 1000 // 10分钟
          if (Date.now() - busLineApiLimitLogAt > 30 * 1000) {
            busLineApiLimitLogAt = Date.now()
            console.warn(`[bus/linename] 触发限流熔断：infocode=10021，10分钟内跳过全站点增强识别（仍保留基础重合识别）。`)
          }
        }
        return []
      }

      const best = pickBestLine(data.buslines, kw)
      const stops = parseStopsFromBusline(best).filter(s => s?.name && s?.location)
      if (!stops.length) {
        console.warn('[bus/linename] 有buslines但解析stops为空:', {
          kw,
          cityName,
          lineName: best?.name,
          keys: best ? Object.keys(best) : []
        })
      }
      return stops
    }

    const p = apiQueue.add(doRequest)
    busLineStopsInFlight.set(inflightKey, p)
    try {
      return await p
    } finally {
      busLineStopsInFlight.delete(inflightKey)
    }
  }

  // 依次尝试多个关键词，取第一个拿到 stops 的
  let finalStops = []
  for (const kw of keywords) {
    finalStops = await requestOnce(kw)
    if (finalStops.length) break
    if (Date.now() < busLineApiLimitedUntil) break
  }

  // 失败时不要长时间缓存空结果，避免“卡死”6小时
  if (!finalStops.length) {
    busLineStopsCache.set(cacheKey, { timestamp: Date.now(), stops: [] })
    setTimeout(() => {
      const c = busLineStopsCache.get(cacheKey)
      if (c && Array.isArray(c.stops) && c.stops.length === 0) busLineStopsCache.delete(cacheKey)
    }, 30 * 1000)
    return []
  }

  busLineStopsCache.set(cacheKey, { timestamp: Date.now(), stops: finalStops })
  return finalStops
}

// 计算两条线路的“连续重合段”（相邻站点>2），返回候选站点名数组
const computeContinuousOverlapStops = (stopsA, stopsB) => {
  const a = Array.isArray(stopsA) ? stopsA : []
  const b = Array.isArray(stopsB) ? stopsB : []
  if (a.length === 0 || b.length === 0) return []

  // 构建 B 的索引（按归一化名，允许多个同名）
  const bIndex = new Map() // normName -> [{ idx, loc, name }]
  b.forEach((s, idx) => {
    const key = normalizeStopName(s.name)
    if (!key) return
    const loc = parseLoc(s.location)
    if (!bIndex.has(key)) bIndex.set(key, [])
    bIndex.get(key).push({ idx, loc, name: s.name })
  })

  // A 中每个站点在 B 中选择“坐标最近”的对应 idx
  const aToB = [] // { aIdx, bIdx, name, norm }
  a.forEach((s, aIdx) => {
    const key = normalizeStopName(s.name)
    if (!key) return
    const candidates = bIndex.get(key) || []
    if (candidates.length === 0) return
    const locA = parseLoc(s.location)
    let best = candidates[0]
    if (locA) {
      let bestD = Infinity
      candidates.forEach(c => {
        if (!c.loc) return
        const d = getStraightLineDistance(locA, c.loc)
        if (Number.isFinite(d) && d < bestD) {
          bestD = d
          best = c
        }
      })
    }
    aToB.push({ aIdx, bIdx: best.idx, name: s.name, norm: key })
  })

  // 寻找 bIdx “近似连续递增”的最长段：
  // 允许少量只属于其中一条线路的站点插入（bIdx 步长 <= 2），避免误判为 0。
  let bestRun = []
  let run = []
  for (let i = 0; i < aToB.length; i++) {
    const cur = aToB[i]
    if (run.length === 0) {
      run = [cur]
      continue
    }
    const prev = run[run.length - 1]
    if (cur.bIdx > prev.bIdx && cur.bIdx - prev.bIdx <= 2) {
      run.push(cur)
    } else {
      if (run.length > bestRun.length) bestRun = run
      run = [cur]
    }
  }
  if (run.length > bestRun.length) bestRun = run

  return bestRun.length >= 3 ? bestRun.map(r => r.name) : []
}

// 识别换乘重合站点
const identifyTransferOverlap = (result) => {
  console.log(`=== 识别换乘重合站点 (方向感知) | 方案: ${result?._debugId || 'unknown'} ===`)
  
  if (!result.busLines || result.busLines.length < 2) {
    return 0
  }

  // 1. 获取所有交通站点引用
  const stations = result.allStations.filter(s => s.type === 'station')
  
  // 2. 按名称（归一化）和坐标（近似）进行深度匹配
  let matchCount = 0
  
  // 遍历每一对相邻的公交/地铁段
  for (let i = 0; i < result.busLines.length - 1; i++) {
    // 获取当前段和下一段的所有站点
    const segmentI = stations.filter(s => s.segmentIndex === i)
    const segmentJ = stations.filter(s => s.segmentIndex === i + 1)
    
    const lineI = (result.busLines[i]?.[0]?.name) || 'unknown'
    const lineJ = (result.busLines[i + 1]?.[0]?.name) || 'unknown'
    console.log(`[重合识别] 方案 ${result?._debugId || 'unknown'} | 段${i}(${lineI})[${segmentI.length}站] vs 段${i+1}(${lineJ})[${segmentJ.length}站]`)

    // 提取重合站点（基于名称归一化或坐标近似匹配）
    const commonPairsRaw = []
    segmentI.forEach(sI => {
      segmentJ.forEach(sJ => {
        const nI = normalizeStopName(sI.name)
        const nJ = normalizeStopName(sJ.name)
        const nameMatch = isStopNameSimilar(nI, nJ)

        const pI = parseLoc(sI.location)
        const pJ = parseLoc(sJ.location)
        let locClose = false
        if (pI && pJ) {
          // 站点坐标在不同线路/上下行返回时可能有更大偏差，放宽到 120m
          const d = getStraightLineDistance(pI, pJ)
          locClose = Number.isFinite(d) && d <= 120
        }
        
        if (nameMatch || locClose) {
          commonPairsRaw.push({ sI, sJ, name: sI.name, normName: nI || nJ || '' })
        }
      })
    })

    // 去重：同名可能被多次匹配，优先保留一对
    const byName = new Map()
    commonPairsRaw.forEach(p => {
      const key = p.normName || normalizeStopName(p.name) || p.name
      if (!key) return
      if (!byName.has(key)) byName.set(key, p)
    })
    const commonPairs = Array.from(byName.values())

    if (commonPairs.length > 0) {
      console.log(`[重合识别] 方案 ${result?._debugId || 'unknown'} | 段${i}->${i+1} 初筛重合站(${commonPairs.length}):`, commonPairs.map(p => p.name).slice(0, 12))
    }

    if (commonPairs.length < 2) {
      console.log(`段${i}与段${i+1}重合站不足2个，不具备方向判断条件`)
      // 如果只有一个重合站，直接打标签
      if (commonPairs.length === 1) {
        const { sI, sJ } = commonPairs[0]
        sI.isTransferOption = true
        sJ.isTransferOption = true
        sI.transferPair = [i, i + 1]
        sJ.transferPair = [i, i + 1]
        sI.walkingDistance = 0
        sJ.walkingDistance = 0
        matchCount++
      }
      continue
    }

    // 方向感知逻辑：
    // 检查重合站在两个段中的索引顺序是否一致
    const sortedPairs = [...commonPairs].sort((a, b) => segmentI.indexOf(a.sI) - segmentI.indexOf(b.sI))
    const indicesJ = sortedPairs.map(p => segmentJ.indexOf(p.sJ))
    
    // 检查 indicesJ 是否是单调递增的
    const isSameDirection = indicesJ.every((val, idx, arr) => !idx || val >= arr[idx - 1])

    if (isSameDirection) {
      console.log(`✅ 方向一致，标记 ${commonPairs.length} 个重合站`)
      commonPairs.forEach(({ sI, sJ, name }) => {
        sI.isTransferOption = true
        sJ.isTransferOption = true
        sI.transferPair = [i, i + 1]
        sJ.transferPair = [i, i + 1]
        sI.walkingDistance = 0
        sJ.walkingDistance = 0
        matchCount++
        console.log(`✅ 标记重合换乘站: "${name}"`)
      })
    } else {
      console.log(`❌ 段${i}与段${i+1}重合站点顺序不匹配，可能方向相反（上下行），已过滤`)
    }
  }

  // 3. 强制刷新引用以触发响应式渲染（针对 Vue 3 的列表更新）
  if (matchCount > 0) {
    result.allStations = result.allStations.map(s => ({...s}))
    console.log(`=== 识别完成：共识别并标记 ${matchCount} 对重合站点，已触发 UI 强制重绘 ===`)
  } else {
    console.log('--- 识别完成：未发现符合条件的相邻重合站 ---')
  }

  return matchCount
}

// 增强识别：当方案内只识别到 0~1 个重合站时，使用“整条线路全站点”计算连续重合段（相邻>2）
const identifyTransferOverlapEnhanced = async (result) => {
  if (!result?.busLines || result.busLines.length < 2) return

  const baseMatchCount = identifyTransferOverlap(result)
  console.log(`[重合增强] baseMatchCount=${baseMatchCount} | 方案: ${result?._debugId || 'unknown'}`)
  if (baseMatchCount >= 2) return

  try {
    for (let i = 0; i < result.busLines.length - 1; i++) {
      const lineI = result.busLines[i]?.[0]?.name
      const lineJ = result.busLines[i + 1]?.[0]?.name
      if (!lineI || !lineJ) continue

      const segI = result.busLines[i]?.[0] || {}
      const segJ = result.busLines[i + 1]?.[0] || {}
      console.log(`[重合增强] 准备拉取全站点 | 段${i}->${i+1}:`, {
        lineI,
        lineJ,
        segI: `${segI.departureStop || ''}→${segI.arrivalStop || ''}`,
        segJ: `${segJ.departureStop || ''}→${segJ.arrivalStop || ''}`
      })

      const [stopsI, stopsJ] = await Promise.all([
        fetchBusLineStops(lineI, '淄博', { segmentStartName: segI.departureStop, segmentEndName: segI.arrivalStop }),
        fetchBusLineStops(lineJ, '淄博', { segmentStartName: segJ.departureStop, segmentEndName: segJ.arrivalStop })
      ])

      console.log(`[重合增强] 全站点长度 | 段${i}->${i+1}: stopsI=${stopsI.length}, stopsJ=${stopsJ.length}`)
      console.log(`[重合增强] stopsI前10站(${toBusLineKeyword(lineI)}):`, stopsI.slice(0, 10).map(s => s.name))
      console.log(`[重合增强] stopsJ前10站(${toBusLineKeyword(lineJ)}):`, stopsJ.slice(0, 10).map(s => s.name))

      const overlapNames = computeContinuousOverlapStops(stopsI, stopsJ)
      console.log(`[重合增强] 连续重合段候选站数量 | 段${i}->${i+1}: ${overlapNames.length}`, overlapNames)
      if (overlapNames.length < 3) {
        console.log(`[重合增强] 段${i}->${i+1}(${lineI} vs ${lineJ}) 全线路连续重合站不足3：`, overlapNames)
        continue
      }

      console.log(`[重合增强] 命中全线路连续重合段(>=3) | 段${i}->${i+1}:`, overlapNames)

      // 将这些站点回灌到当前方案的 allStations（两段都标记）
      let marked = 0
      result.allStations.forEach(s => {
        if (s?.type !== 'station') return
        if (s.segmentIndex !== i && s.segmentIndex !== i + 1) return
        if (overlapNames.some(n => isStopNameSimilar(n, s.name))) {
          s.isTransferOption = true
          s.transferPair = [i, i + 1]
          s.walkingDistance = 0
          marked++
        }
      })

      console.log(`[重合增强] 回灌标记完成 | 段${i}->${i+1}: 标记到 ${marked} 个站点（注意：两段可能各出现一次）`)
    }

    // 强制刷新引用
    result.allStations = result.allStations.map(s => ({ ...s }))
  } catch (e) {
    console.warn('[重合增强] 识别失败:', e)
  }
}

// 计算两段之间的步行距离
const calculateTransferWalkingDistance = (currentSegmentLines, nextSegmentLines, transferStopName) => {
  // 简化计算：假设同站换乘距离为0米
  // 实际应该根据坐标计算，但这里先用简化逻辑
  
  // 查找当前段的终点站位置
  let currentEndPoint = null
  currentSegmentLines.forEach(line => {
    if (line.arrivalStop === transferStopName && line.location) {
      currentEndPoint = line.location
    }
  })
  
  // 查找下一段的起点站位置
  let nextStartPoint = null
  nextSegmentLines.forEach(line => {
    if (line.departureStop === transferStopName && line.location) {
      nextStartPoint = line.location
    }
  })
  
  // 如果是同一个站点，步行距离为0
  if (currentEndPoint && nextStartPoint) {
    // 简化处理：同站换乘距离为0
    return 0
  }
  
  // 如果找不到位置信息，返回一个合理的默认值
  // 这里假设是合理的换乘点
  return 100
}

// 处理路径数据
const processRouteData = (path, mode) => {
  console.log('处理路径数据，模式:', mode)
  console.log('原始路径数据:', path)
  
  const result = {
    mode: mode,
    distance: path.distance || 0,
    duration: path.duration || 0,
    // 驾车策略标记（便于调试/展示）
    strategy: typeof path?.__strategy === 'number' ? path.__strategy : undefined,
    pathData: path
  }
  
  return result
}

// 选择路径方案
const selectRoute = async (index) => {
  console.log(`选择第${index}个路径方案`)
  selectedRouteIndex.value = index
  
  // 非公交场景：已一次性渲染全部备选，只做高亮切换
  if (routePlanning.value.travelMode !== 'transit') {
    highlightSimpleAlternativeRoute(index)
    return
  }

  // 公交场景：保持原逻辑（清空后绘制选中方案）
  const result = routeResults.value[index]
  console.log('自动绘制路线:', result)
  clearRoute()
  await drawRoute(result.pathData, result.mode)
}

// 获取当前方案的换乘站选项（只返回重合换乘的站点，用于自定义选择）
const getTransferOptions = (result) => {
  if (!result?.allStations) return []
  // 只返回重合换乘的站点（>=2个重合站时才显示选择器）
  return result.allStations.filter(s => s?.isTransferOption && s?.isOverlapTransfer)
}

// 切换换乘站
const onTransferSelectChange = async (event, result) => {
  const selectedName = event.target.value
  if (!selectedName) return

  const allStations = result.allStations || []

  // 找到选中的换乘站
  const selectedStation = allStations.find(s =>
    s?.isTransferOption &&
    s.name === selectedName
  )

  if (!selectedStation) return

  console.log(`切换换乘站到: ${selectedName}`)

  // 清除当前换乘标记
  allStations.forEach(s => {
    if (s?.isTransferOption) {
      s.isCurrentTransfer = false
    }
  })

  // 设置新的当前换乘站
  selectedStation.isCurrentTransfer = true

  // 重新绘制路线以更新地图显示
  clearRoute()
  await drawRoute(result.pathData, result.mode)
}

// 显示站点详情
const showStationsDetail = (index) => {
  const result = routeResults.value[index]
  selectedRouteStations.value = result.allStations || []
  showRouteStations.value = true
  console.log('显示站点详情:', selectedRouteStations.value)
}

// 关闭站点详情
const closeStationsDetail = () => {
  showRouteStations.value = false
  selectedRouteStations.value = []
}

// 路线图层管理
const routeLayers = {
  walking: null,
  transit: null,
  transfer: null,
  markers: null,
  stations: null
}

// 驾车/步行备选路线（多条）折线引用，用于“只切换高亮，不重绘”
let simpleAlternativePolylines = []

// 非公交场景下：切换选中路线的颜色/透明度/线宽
const highlightSimpleAlternativeRoute = (index) => {
  if (!Array.isArray(simpleAlternativePolylines) || simpleAlternativePolylines.length === 0) return

  const mode = routePlanning.value.travelMode
  const selectedStrokeColor = mode === 'walking' ? '#10B981' : '#3B82F6'
  const unSelectedStrokeColor = '#9CA3AF' // 未选中统一灰色，更清晰

  simpleAlternativePolylines.forEach((poly, i) => {
    if (!poly || typeof poly.setOptions !== 'function') return
    const isSelected = i === index
    const commonStrokeWeight = 6
    poly.setOptions({
      strokeColor: isSelected ? selectedStrokeColor : unSelectedStrokeColor,
      strokeWeight: commonStrokeWeight,
      strokeOpacity: 1,
      // 非选中不使用虚线，避免观感“发虚不好看”
      strokeStyle: 'solid',
      zIndex: isSelected ? 300 : 210
    })
  })
}

// 清除路线图层
const clearRouteLayers = () => {
  // 正确清理并重置 routeLayers 的引用（原先 layer = null 不会回写到对象属性）
  Object.keys(routeLayers).forEach((key) => {
    const layer = routeLayers[key]
    if (layer) {
      try {
        amapInstance.remove(layer)
      } catch (e) {
        console.warn('移除图层失败:', key, e)
      }
      routeLayers[key] = null
    }
  })
  
  // 清除所有标记
  if (startMarker) {
    amapInstance.remove(startMarker)
    startMarker = null
  }
  if (endMarker) {
    amapInstance.remove(endMarker)
    endMarker = null
  }
  if (searchMarker) {
    amapInstance.remove(searchMarker)
    searchMarker = null
  }
  if (userLocationMarker) {
    amapInstance.remove(userLocationMarker)
    userLocationMarker = null
  }
  
  // 清除步行轨迹
  walkingPolylines.forEach(polyline => {
    amapInstance.remove(polyline)
  })
  walkingPolylines = []

  // 清除备选简单路线折线
  if (Array.isArray(simpleAlternativePolylines) && simpleAlternativePolylines.length > 0) {
    simpleAlternativePolylines.forEach(poly => {
      if (!poly) return
      try {
        amapInstance.remove(poly)
      } catch (e) {}
    })
  }
  simpleAlternativePolylines = []
}

// 绘制路径 - 增强版本
const drawRoute = async (pathData, mode) => {
  console.log('绘制路径，模式:', mode)
  console.log('路径数据:', pathData)
  
  // 清除之前的路线
  clearRouteLayers()
  
  if (mode === 'transit') {
    await drawTransitRoute(pathData)
  } else {
    await drawSimpleRoute(pathData, mode)
  }
  
  // 自适应视野
  fitRouteToView()
}

// 解析 polyline 字符串为坐标点数组
const parsePolylineToPoints = (polylineStr) => {
  if (!polylineStr || typeof polylineStr !== 'string') return []
  return polylineStr.split(';').map(point => {
    const parts = point.split(',')
    return parts.length === 2 ? [parseFloat(parts[0]), parseFloat(parts[1])] : null
  }).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

// 从 steps[].polyline 拼接 polyline（适配驾车/步行/公交步行段）
const joinStepsPolyline = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return ''
  const parts = []
  steps.forEach(s => {
    if (s && typeof s.polyline === 'string' && s.polyline.trim()) {
      parts.push(s.polyline.trim())
    }
  })
  return parts.join(';')
}

// 绘制公交路线
const drawTransitRoute = async (transitData) => {
  if (!transitData.segments || transitData.segments.length === 0) {
    console.warn('没有公交路段数据')
    return
  }
  
  if (!window.AMap || !amapInstance) {
    console.error('地图实例未就绪')
    return
  }

  console.log('开始绘制公交路线，换乘段数:', transitData.segments.length)
  
  // 彻底清除旧路线
  clearRoute()
  
  // 创建覆盖物群组 (AMap 2.0：OverlayGroup 支持 addOverlay / addOverlays，而不是 add)
  const walkingLayer = new window.AMap.OverlayGroup()
  const transitLayer = new window.AMap.OverlayGroup()
  const transferLayer = new window.AMap.OverlayGroup()
  const stationLayer = new window.AMap.OverlayGroup()

  const addToGroup = (group, overlays) => {
    if (!group || !overlays) return
    const list = Array.isArray(overlays) ? overlays : [overlays]
    const valid = list.filter(Boolean)
    if (valid.length === 0) return
    // 兼容不同 API 形态：优先 addOverlays，其次 addOverlay
    if (typeof group.addOverlays === 'function') {
      group.addOverlays(valid)
    } else if (typeof group.addOverlay === 'function') {
      valid.forEach(o => group.addOverlay(o))
    } else {
      // 最后兜底：直接逐个加到地图，避免渲染中断
      console.warn('OverlayGroup 不支持 addOverlays/addOverlay，降级为 amapInstance.add')
      valid.forEach(o => amapInstance.add(o))
    }
  }
  
  let allCoordinates = []
  
  // 绘制每个路段
  for (let segIndex = 0; segIndex < transitData.segments.length; segIndex++) {
    const segment = transitData.segments[segIndex]
    
    // 1. 绘制步行段
    if (segment.walking) {
      const overlays = await drawWalkingSegment(segment.walking, segIndex)
      if (Array.isArray(overlays)) {
        addToGroup(walkingLayer, overlays)
        overlays.forEach((overlay) => {
          if (overlay && overlay.getPath) {
            const path = overlay.getPath()
            if (Array.isArray(path)) {
              allCoordinates = allCoordinates.concat(path.map(p => [p.lng, p.lat]))
            }
          }
        })
      }
    }
    
    // 2. 绘制公交段
    if (segment.bus && segment.bus.buslines && segment.bus.buslines.length > 0) {
      const transitPolylines = await drawTransitSegment(segment.bus, segIndex)
      if (Array.isArray(transitPolylines)) {
        addToGroup(transitLayer, transitPolylines)
        transitPolylines.forEach((polyline) => {
          if (polyline && polyline.getPath) {
            const path = polyline.getPath()
            if (Array.isArray(path)) {
              allCoordinates = allCoordinates.concat(path.map(p => [p.lng, p.lat]))
            }
          }
        })
      }
      
      // 3. 绘制站点标记
      const stationMarkers = await drawTransitStations(segment.bus, segIndex)
      if (Array.isArray(stationMarkers)) {
        addToGroup(stationLayer, stationMarkers)
      }
    }
    
    // 4. 绘制换乘连接
    if (segIndex < transitData.segments.length - 1) {
      const transferPath = await drawTransferConnection(segment, transitData.segments[segIndex + 1], segIndex)
      if (transferPath) {
        addToGroup(transferLayer, transferPath)
        // transferPath 可能是 Polyline（异站换乘）或 Marker（同站换乘圆点）
        if (typeof transferPath.getPath === 'function') {
          const p = transferPath.getPath()
          if (Array.isArray(p)) {
            allCoordinates = allCoordinates.concat(p.map(coord => [coord.lng, coord.lat]))
          }
        } else if (typeof transferPath.getPosition === 'function') {
          const pos = transferPath.getPosition()
          if (pos && typeof pos.getLng === 'function' && typeof pos.getLat === 'function') {
            allCoordinates.push([pos.getLng(), pos.getLat()])
          }
        }
      }
    }
  }
  
  // 将群组添加到地图
  amapInstance.add(walkingLayer)
  amapInstance.add(transitLayer)
  amapInstance.add(transferLayer)
  amapInstance.add(stationLayer)
  
  // 保存引用以便后续清除
  routeLayers.walking = walkingLayer
  routeLayers.transit = transitLayer
  routeLayers.transfer = transferLayer
  routeLayers.stations = stationLayer
  
  // 添加起点和终点标记
  await addStartEndMarkers()
  
  // 自适应视野
  // ⚠️ AMap 的 setFitView 需要的是覆盖物/覆盖物数组，不支持直接传 OverlayGroup（否则会触发 getBounds is not a function）
  if (allCoordinates.length > 0) {
    try {
      const fitOverlays = [
        ...(typeof walkingLayer.getOverlays === 'function' ? walkingLayer.getOverlays() : []),
        ...(typeof transitLayer.getOverlays === 'function' ? transitLayer.getOverlays() : []),
        ...(typeof transferLayer.getOverlays === 'function' ? transferLayer.getOverlays() : []),
        ...(typeof stationLayer.getOverlays === 'function' ? stationLayer.getOverlays() : []),
        ...(startMarker ? [startMarker] : []),
        ...(endMarker ? [endMarker] : [])
      ].filter(Boolean)
      
      if (fitOverlays.length > 0) {
        amapInstance.setFitView(fitOverlays, false, [60, 60, 60, 60])
      }
    } catch (e) {
      console.warn('公交路线 setFitView 失败（忽略不影响绘制）:', e)
    }
  }
  
  console.log('公交路线绘制完成')
}

// 绘制步行段（公交方案中的 walking）
const drawWalkingSegment = async (walkingData, segIndex) => {
  try {
    const polylineStr =
      (typeof walkingData?.polyline === 'string' && walkingData.polyline.trim())
        ? walkingData.polyline.trim()
        : (walkingData?.steps ? joinStepsPolyline(walkingData.steps) : '')
    
    const points = parsePolylineToPoints(polylineStr)
    
    if (points.length < 2) {
      console.warn('步行段数据不足')
      return null
    }
    
    const polyline = new window.AMap.Polyline({
      path: points,
      strokeColor: '#9CA3AF', // 灰色
      strokeStyle: 'dashed', // 虚线
      strokeWeight: 4,
      strokeOpacity: 0.8,
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 100
    })
    
    // 添加步行信息标签
    const centerIndex = Math.floor(points.length / 2)
    const centerPoint = points[centerIndex]
    
    const infoMarker = new window.AMap.Marker({
      position: centerPoint,
      content: `
        <div style="
          background: rgba(156, 163, 175, 0.9);
          color: white;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        ">
          步行 ${Math.round(Number(walkingData.distance) || 0)}米
        </div>
      `,
      offset: new window.AMap.Pixel(-30, -20),
      zIndex: 101
    })
    
    // 返回包含这两个覆盖物的数组，而不是 LayerGroup
    return [polyline, infoMarker]
  } catch (error) {
    console.error('绘制步行段失败:', error)
    return null
  }
}

// 绘制公交段
const drawTransitSegment = async (busData, segIndex) => {
  const polylines = [];
  
  if (!busData.buslines || busData.buslines.length === 0) {
    return polylines;
  }
  
  // 为每条线路绘制路径
  for (const busLine of busData.buslines) {
    try {
      // 优先使用 stopPath（本次乘坐区间），避免整线 polyline 导致绕路
      const points = Array.isArray(busLine.stopPath) && busLine.stopPath.length >= 2
        ? busLine.stopPath
        : (busLine.polyline ? parsePolylineToPoints(busLine.polyline) : [])
      
      if (points.length < 2) continue;
      
      const polyline = new window.AMap.Polyline({
        path: points,
        strokeColor: '#3B82F6', // 蓝色
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 110
      });
      
      polylines.push(polyline);
    } catch (error) {
      console.error('绘制单条公交线路失败:', error);
    }
  }
  
  return polylines; // 返回数组，由外部 OverlayGroup.add 处理
}

// 绘制换乘连接（异站换乘尽量渲染真实步行轨迹；同站换乘用圆点标记）
const drawTransferConnection = async (currentSeg, nextSeg, segIndex) => {
  try {
    // 获取当前段的终点和下一段的起点
    let currentEndPoint = null;
    let nextStartPoint = null;
    
    if (currentSeg.bus && currentSeg.bus.buslines && currentSeg.bus.buslines.length > 0) {
      const lastLine = currentSeg.bus.buslines[currentSeg.bus.buslines.length - 1];
      if (lastLine.arrival_stop && lastLine.arrival_stop.location) {
        const location = lastLine.arrival_stop.location.split(',').map(coord => parseFloat(coord));
        if (location.length === 2) {
          currentEndPoint = location;
        }
      }
    } else if (currentSeg.walking && currentSeg.walking.polyline) {
      const points = currentSeg.walking.polyline.split(';');
      const parts = points[points.length - 1].split(',');
      if (parts.length === 2) {
        currentEndPoint = [parseFloat(parts[0]), parseFloat(parts[1])];
      }
    }
    
    if (nextSeg.bus && nextSeg.bus.buslines && nextSeg.bus.buslines.length > 0) {
      const firstLine = nextSeg.bus.buslines[0];
      if (firstLine.departure_stop && firstLine.departure_stop.location) {
        const location = firstLine.departure_stop.location.split(',').map(coord => parseFloat(coord));
        if (location.length === 2) {
          nextStartPoint = location;
        }
      }
    } else if (nextSeg.walking && nextSeg.walking.polyline) {
      const points = nextSeg.walking.polyline.split(';');
      const parts = points[0].split(',');
      if (parts.length === 2) {
        nextStartPoint = [parseFloat(parts[0]), parseFloat(parts[1])];
      }
    }
    
    if (!currentEndPoint || !nextStartPoint) {
      return null;
    }
    
    // 如果是同站换乘，返回一个标记
    const isSameStation = (
      Math.abs(currentEndPoint[0] - nextStartPoint[0]) < 0.0001 &&
      Math.abs(currentEndPoint[1] - nextStartPoint[1]) < 0.0001
    );
    
    if (isSameStation) {
      // 获取当前段的换乘站信息
      const currentRoute = routeResults.value[selectedRouteIndex.value];
      const allStations = currentRoute?.allStations || [];

      // 找到当前段的所有可选换乘站（重合站点>=2时才会有多个）
      const availableTransfers = allStations.filter(s =>
        s?.isTransferOption &&
        Array.isArray(s.transferPair) &&
        (s.transferPair[0] === segIndex || s.transferPair[1] === segIndex)
      );

      // 找到当前选中的换乘站（如果没有则使用默认终点）
      const currentTransfer = allStations.find(s =>
        s?.isTransferOption &&
        s.isCurrentTransfer &&
        Array.isArray(s.transferPair) &&
        (s.transferPair[0] === segIndex || s.transferPair[1] === segIndex)
      );

      const stationName = currentTransfer?.name || (currentSeg.bus?.buslines?.[0]?.arrival_stop?.name) || '换乘站';

      // 使用当前换乘站的坐标（如果设置了自定义换乘）
      let labelPosition = currentEndPoint;
      if (currentTransfer?.location) {
        if (typeof currentTransfer.location === 'string') {
          const parts = currentTransfer.location.split(',').map(Number);
          if (parts.length === 2) labelPosition = parts;
        } else if (Array.isArray(currentTransfer.location)) {
          labelPosition = currentTransfer.location;
        }
      }

      // 创建可点击的换乘标签（放在当前换乘站位置）
      const transferLabel = new window.AMap.Marker({
        position: labelPosition,
        content: `
          <div style="
            background: rgba(245, 158, 11, 0.95);
            color: white;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.3);
            cursor: pointer;
          ">换乘</div>
        `,
        offset: new window.AMap.Pixel(-16, -25),
        zIndex: 160,
        bubble: false,
        clickable: true
      });
      
      // 如果有多个可选换乘站，点击显示切换选项
      if (availableTransfers.length > 1) {
        transferLabel.on('click', () => {
          let content = `<div class="transfer-info-window" style="padding: 12px; min-width: 180px;">
            <div style="font-weight: bold; color: #1f2937; margin-bottom: 8px; font-size: 14px;">当前换乘站: ${stationName}</div>
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 10px;">点击下方切换到其他换乘站</div>`;
          
          availableTransfers.forEach(s => {
            if (s.name !== stationName) {
              content += `<button onclick="window.handleTransferChange('${s.name}', ${s.transferPair[0]}, ${s.transferPair[1]})"
                style="display: block; width: 100%; margin-bottom: 6px; padding: 6px 10px; background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; cursor: pointer; text-align: left;">
                → ${s.name}
              </button>`;
            }
          });
          
          content += `</div>`;
          
          const infoWindow = new window.AMap.InfoWindow({
            content: content,
            offset: new window.AMap.Pixel(0, -30),
            autoMove: true,
            closeWhenClickMap: true
          });
          
          infoWindow.open(amapInstance, labelPosition);
        });
      }

      return transferLabel;
    } else {
      // 异站换乘：优先用步行 API 获取真实步行轨迹（灰色虚线），失败再降级直线连接（橙色虚线）
      try {
        const start = { lng: currentEndPoint[0], lat: currentEndPoint[1] }
        const end = { lng: nextStartPoint[0], lat: nextStartPoint[1] }
        const walking = await getWalkingRouteData(start, end)
        const walkingPolylineStr = joinStepsPolyline(walking?.steps || [])
        const walkingPoints = parsePolylineToPoints(walkingPolylineStr)
        
        if (walkingPoints.length >= 2) {
          const polyline = new window.AMap.Polyline({
            path: walkingPoints,
            strokeColor: '#9CA3AF',
            strokeStyle: 'dashed',
            strokeWeight: 4,
            strokeOpacity: 0.85,
            zIndex: 150
          })

          const centerIndex = Math.floor(walkingPoints.length / 2)
          const centerPoint = walkingPoints[centerIndex]
          const infoMarker = new window.AMap.Marker({
            position: centerPoint,
            content: `
              <div style="
                background: rgba(245, 158, 11, 0.9);
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
                white-space: nowrap;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              ">
                换乘步行 ${Math.round(Number(walking?.distance) || 0)}米
              </div>
            `,
            offset: new window.AMap.Pixel(-40, -20),
            zIndex: 151
          })

          // 异站换乘的起点和终点也添加橙色圆点标记
          const startMarker = new window.AMap.Marker({
            position: walkingPoints[0],
            content: `
              <div style="
                width: 14px;
                height: 14px;
                background: #F59E0B;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              "></div>
            `,
            offset: new window.AMap.Pixel(-7, -7),
            zIndex: 155
          })

          const endMarker = new window.AMap.Marker({
            position: walkingPoints[walkingPoints.length - 1],
            content: `
              <div style="
                width: 14px;
                height: 14px;
                background: #F59E0B;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              "></div>
            `,
            offset: new window.AMap.Pixel(-7, -7),
            zIndex: 155
          })

          return [polyline, infoMarker, startMarker, endMarker]
        }
      } catch (e) {
        console.warn('异站换乘步行轨迹获取失败，降级直线连接:', e)
      }
      
      // 降级：直线连接
      return new window.AMap.Polyline({
        path: [currentEndPoint, nextStartPoint],
        strokeColor: '#F59E0B',
        strokeStyle: 'dashed',
        strokeWeight: 3,
        strokeOpacity: 0.8,
        zIndex: 150
      })
    }
  } catch (error) {
    console.error('绘制换乘连接失败:', error);
    return null;
  }
}

// 绘制站点标记
const drawTransitStations = async (busData, segIndex) => {
  const markers = [];
  
  if (!busData.buslines || busData.buslines.length === 0) return markers;

  // 辅助函数：解析坐标
  const parseLoc = (loc) => {
    if (!loc) return null;
    if (Array.isArray(loc)) return new window.AMap.LngLat(loc[0], loc[1]);
    const parts = loc.split(',');
    return new window.AMap.LngLat(parseFloat(parts[0]), parseFloat(parts[1]));
  };

  // 获取当前选中路线的站点数据（包含换乘信息）
  const currentRoute = routeResults.value[selectedRouteIndex.value];
  const allStationsWithTransferInfo = currentRoute?.allStations || [];

  const createMarker = (stop, type, originalStation = null) => {
    const pos = parseLoc(stop.location);
    if (!pos) return null;

    // 查找匹配的站点数据（支持坐标距离匹配，200米内算同一站）
    const matchedStation = allStationsWithTransferInfo.find(as => {
      // 放宽名称匹配：完全相等或互为包含
      const nameMatch = as.name === stop.name || 
                        as.name.includes(stop.name) || 
                        stop.name.includes(as.name)
      if (!nameMatch) return false
      
      // 处理不同格式的location
      let asLng, asLat
      if (Array.isArray(as.location)) {
        asLng = as.location[0]
        asLat = as.location[1]
      } else if (typeof as.location === 'string') {
        const parts = as.location.split(',')
        asLng = parseFloat(parts[0])
        asLat = parseFloat(parts[1])
      }
      if (!asLng || !asLat) return false

      // 计算距离（允许200米误差，提高容错）
      const dist = getDistance([asLng, asLat], [pos.getLng(), pos.getLat()])
      return dist <= 200
    })

    const stationWithTransferInfo = matchedStation || originalStation || stop;

    // 调试：检查换乘状态（包含所有可能的换乘站）
    if (stationWithTransferInfo?.isTransferOption || type !== 'via') {
      console.log(`[drawTransitStations] 站点 ${stop.name} (${type}):`, {
        matched: !!matchedStation,
        isTransferOption: stationWithTransferInfo?.isTransferOption,
        isCurrentTransfer: stationWithTransferInfo?.isCurrentTransfer,
        isInterStationTransfer: stationWithTransferInfo?.isInterStationTransfer
      })
    }

    let marker;

    // 判断是否是换乘站点
    const isTransferOption = stationWithTransferInfo?.isTransferOption;
    const isCurrentTransfer = stationWithTransferInfo?.isCurrentTransfer;
    
    if (type === 'via') {
      // 途经站：换乘站点显示橙色，普通站点显示蓝色
      const markerColor = isTransferOption ? '#F59E0B' : '#3b82f6';
      const markerSize = isTransferOption ? (isCurrentTransfer ? '16px' : '14px') : '10px';
      const offset = isTransferOption ? (isCurrentTransfer ? -8 : -7) : -5;
      const zIndex = isTransferOption ? 120 : 100;
      
      marker = new window.AMap.Marker({
        position: pos,
        title: stop.name,
        zIndex: zIndex,
        content: `<div style="
          width: ${markerSize}; 
          height: ${markerSize}; 
          background-color: ${markerColor}; 
          border: 2px solid #ffffff; 
          border-radius: 50%; 
          box-shadow: 0 0 4px rgba(0,0,0,0.5); 
          cursor: pointer;
        "></div>`,
        offset: new window.AMap.Pixel(offset, offset),
        bubble: false,
        clickable: true,
        extData: { stop, type, station: stationWithTransferInfo }
      });
    } else if (isTransferOption) {
      // 换乘站点即使是起点/终点也要渲染（异站换乘场景）
      const markerColor = '#F59E0B';
      const markerSize = isCurrentTransfer ? '16px' : '14px';
      const offset = isCurrentTransfer ? -8 : -7;
      
      marker = new window.AMap.Marker({
        position: pos,
        title: stop.name,
        zIndex: 120,
        content: `<div style="
          width: ${markerSize}; 
          height: ${markerSize}; 
          background-color: ${markerColor}; 
          border: 2px solid #ffffff; 
          border-radius: 50%; 
          box-shadow: 0 0 4px rgba(0,0,0,0.5); 
          cursor: pointer;
        "></div>`,
        offset: new window.AMap.Pixel(offset, offset),
        bubble: false,
        clickable: true,
        extData: { stop, type, station: stationWithTransferInfo }
      });
    } else {
      // 非换乘的起点/终点站不在此函数中绘制，由addStartEndMarkers统一处理
      return null;
    }

    // 绑定点击事件弹出信息窗体
    marker.on('click', (e) => {
      console.log('[Marker Click] 站点被点击:', e.target.getExtData());
      const stationData = e.target.getExtData().station;
      console.log('[Marker Click] stationData:', stationData);
      let content = `<div class="station-info-window" style="padding: 10px; min-width: 150px;">
        <div style="font-weight: bold; color: #1f2937; margin-bottom: 4px; font-size: 14px;">${stationData.name}</div>
        <div style="font-size: 12px; color: #4b5563; margin-bottom: 8px;">途径站</div>`;

      if (stationData.isTransferOption) {
        // 判断是当前换乘站还是可选换乘站
        const isCurrent = stationData.isCurrentTransfer;
        
        if (isCurrent) {
          content += `<div style="font-size: 12px; color: #F59E0B; margin-top: 4px;">
            <span>✓ 当前换乘站</span>
          </div>`;
        } else if (Array.isArray(stationData.transferPair)) {
          content += `<div style="margin-top: 8px;">
            <button onclick="window.handleTransferChange('${stop.name}', ${stationData.transferPair[0]}, ${stationData.transferPair[1]})"
              style="width: 100%; padding: 6px 12px; background: #F59E0B; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              设为换乘站
            </button>
          </div>`;
        }
      }

      content += `</div>`;

      const infoWindow = new window.AMap.InfoWindow({
        content: content,
        offset: new window.AMap.Pixel(0, -10),
        autoMove: true,
        closeWhenClickMap: true
      });
      
      infoWindow.open(amapInstance, pos);
    });

    return marker;
  };

  const line = busData.buslines[0];
  
  // 只绘制途经站，起点/终点由addStartEndMarkers统一处理
  // 收集所有站点（途经站+起点+终点）检查换乘选项
  const allLineStops = [];
  if (line.via_stops && Array.isArray(line.via_stops)) {
    allLineStops.push(...line.via_stops);
  }
  if (line.departure_stop) {
    allLineStops.push(line.departure_stop);
  }
  if (line.arrival_stop) {
    allLineStops.push(line.arrival_stop);
  }
  
  // 去重并创建标记
  const seenNames = new Set();
  allLineStops.forEach(stop => {
    if (!seenNames.has(stop.name)) {
      seenNames.add(stop.name);
      const m = createMarker(stop, 'via');
      if (m) markers.push(m);
    }
  });

  return markers;
}

// 处理换乘站点变化（支持两种调用方式：对象或单独参数）
const handleTransferChange = async (stopNameOrData, fromSegIndex, toSegIndex) => {
  try {
    let stopName, fromIdx, toIdx;
    
    // 判断是第一个参数是对象还是字符串
    if (typeof stopNameOrData === 'object' && stopNameOrData !== null) {
      // 对象方式调用：{ stopName, fromSegIndex, toSegIndex }
      stopName = stopNameOrData.stopName;
      fromIdx = stopNameOrData.fromSegIndex;
      toIdx = stopNameOrData.toSegIndex;
    } else {
      // 单独参数方式调用：(stopName, fromSegIndex, toSegIndex)
      stopName = stopNameOrData;
      fromIdx = fromSegIndex;
      toIdx = toSegIndex;
    }
    
    if (typeof fromIdx !== 'number' || typeof toIdx !== 'number') return;
    
    console.log(`[handleTransferChange] 切换换乘站: ${stopName}, 段${fromIdx} -> ${toIdx}`);
    
    // 更新自定义换乘站状态
    customTransfer.value = {
      isActive: true,
      stopName: stopName,
      fromSegIndex: fromIdx,
      toSegIndex: toIdx
    };
    
    // 重新绘制路线以反映新的换乘站
    await redrawRouteWithCustomTransfer();
  } catch (error) {
    console.error('换乘站点更新失败:', error);
    // errorHandler 可能不存在，避免二次异常
    try {
      if (typeof errorHandler?.handleApiFailure === 'function') {
        await errorHandler.handleApiFailure(error);
      }
    } catch (e) {}
  }
}

// 暴露到window供地图弹窗内按钮调用
window.handleTransferChange = handleTransferChange

// 使用自定义换乘站重新绘制路线
const redrawRouteWithCustomTransfer = async () => {
  if (!routeResults.value.length || selectedRouteIndex.value < 0) return;
  
  const result = routeResults.value[selectedRouteIndex.value];
  if (!result?.pathData) return;
  
  // 更新allStations中的isCurrentTransfer状态
  if (result.allStations && Array.isArray(result.allStations)) {
    result.allStations.forEach(station => {
      if (station.isTransferOption) {
        // 检查是否匹配当前自定义换乘站
        station.isCurrentTransfer = station.name === customTransfer.value.stopName;
      }
    });
  }
  
  // 重新绘制路线
  clearRoute();
  await drawRoute(result.pathData, result.mode);
}

// 添加起点和终点标记
const addStartEndMarkers = async () => {
  const startPoint = routePlanning.value.startPoint
  const endPoint = routePlanning.value.endPoint
  
  if (startPoint) {
    startMarker = new AMap.Marker({
      position: [startPoint.lng, startPoint.lat],
      content: `
        <div style="
          position: relative;
          width: 28px;
          height: 36px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        ">
          <!-- 圆形主体 -->
          <div style="
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 24px;
            height: 24px;
            background: #10B981;
            border-radius: 50%;
            border: 3px solid white;
            box-sizing: border-box;
          "></div>
          <!-- 向下箭头 -->
          <div style="
            position: absolute;
            bottom: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-top: 10px solid #10B981;
          "></div>
        </div>
      `,
      offset: new AMap.Pixel(-14, -36),
      zIndex: 400
    })
    
    amapInstance.add(startMarker)
  }
  
  if (endPoint) {
    endMarker = new AMap.Marker({
      position: [endPoint.lng, endPoint.lat],
      content: `
        <div style="
          position: relative;
          width: 28px;
          height: 36px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        ">
          <!-- 圆形主体 -->
          <div style="
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 24px;
            height: 24px;
            background: #EF4444;
            border-radius: 50%;
            border: 3px solid white;
            box-sizing: border-box;
          "></div>
          <!-- 向下箭头 -->
          <div style="
            position: absolute;
            bottom: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-top: 10px solid #EF4444;
          "></div>
        </div>
      `,
      offset: new AMap.Pixel(-14, -36),
      zIndex: 400
    })
    
    amapInstance.add(endMarker)
  }
}

// 自适应视野
const fitRouteToView = () => {
  if (!amapInstance) return

  const allOverlays = []
  
  // 1. 收集所有图层中的覆盖物
  Object.values(routeLayers).forEach(layer => {
    if (layer) {
      if (layer.getOverlays) {
        allOverlays.push(...layer.getOverlays())
      } else {
        allOverlays.push(layer)
      }
    }
  })

  // 1.5 收集简单备选折线覆盖物（驾车/步行）
  if (Array.isArray(simpleAlternativePolylines) && simpleAlternativePolylines.length > 0) {
    allOverlays.push(...simpleAlternativePolylines)
  }

  // 2. 收集起点和终点标记
  if (startMarker) allOverlays.push(startMarker)
  if (endMarker) allOverlays.push(endMarker)

  // 3. 使用 setFitView 自动调整视野
  if (allOverlays.length > 0) {
    try {
      amapInstance.setFitView(allOverlays, false, [60, 60, 60, 60])
      console.log('已自动调整视野以适应路线')
    } catch (error) {
      console.error('自适应视野失败:', error)
    }
  }
}

// 绘制简单路线（驾车/步行）
const drawSimpleRoute = async (pathData, mode) => {
  try {
    // 兼容两种入参：
    // - route 对象：{ paths: [...] }
    // - 单个 path：{ polyline: 'lng,lat;...' }
    const path = (pathData && Array.isArray(pathData.paths)) ? pathData.paths[0] : pathData
    if (!path) {
      console.warn('没有路线数据')
      return
    }
    
    // 部分 API 响应不会给 path.polyline，而是拆分在 steps[].polyline 里
    const getPolylineFromSteps = (steps) => {
      if (!Array.isArray(steps) || steps.length === 0) return ''
      const parts = []
      steps.forEach(s => {
        if (s && typeof s.polyline === 'string' && s.polyline.trim()) {
          parts.push(s.polyline.trim())
        }
      })
      // steps 的 polyline 本身就是 "lng,lat;lng,lat" 形式，直接用 ';' 拼接
      return parts.join(';')
    }
    
    const polylineStr =
      (typeof path.polyline === 'string' && path.polyline.trim()) ? path.polyline.trim()
      : (path.steps ? getPolylineFromSteps(path.steps) : '')
    
    if (!polylineStr) {
      console.warn('没有路径坐标数据')
      console.log('path keys:', Object.keys(path || {}))
      return
    }
    
    // 解析路径坐标
    const points = polylineStr.split(';').map(point => {
      const parts = point.split(',')
      return parts.length === 2 ? 
        [parseFloat(parts[0]), parseFloat(parts[1])] : null
    }).filter(point => point !== null)
    
    if (points.length < 2) {
      console.warn('路径坐标不足')
      return
    }
    
    // 设置路线样式
    const strokeColor = mode === 'driving' ? '#3B82F6' : '#10B981'
    const strokeWeight = mode === 'driving' ? 6 : 4
    
    const polyline = new AMap.Polyline({
      path: points,
      strokeColor,
      strokeWeight,
      strokeOpacity: 0.8,
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: 200
    })
    
    amapInstance.add(polyline)
    // 修复：根据模式设置正确的图层
    if (mode === 'driving') {
      routeLayers.transit = polyline
    } else {
      routeLayers.walking = polyline
    }
    
    // 添加起点终点标记
    await addStartEndMarkers()
    
    console.log(`${mode === 'driving' ? '驾车' : '步行'}路线绘制完成`)
  } catch (error) {
    console.error('绘制简单路线失败:', error)
  }
}

// 一次性绘制（驾车/步行）所有备选折线，并初始化高亮
const renderAllSimpleAlternatives = async (mode) => {
  // 公交不走这里
  if (mode === 'transit') return
  if (!Array.isArray(routeResults.value) || routeResults.value.length === 0) return

  // 清空旧路线与标记（只清一次）
  clearRoute()

  const selectedIndex = selectedRouteIndex.value || 0
  simpleAlternativePolylines = []

  const baseStrokeColor = mode === 'walking' ? '#10B981' : '#3B82F6'

  for (let i = 0; i < routeResults.value.length; i++) {
    const result = routeResults.value[i]
    if (!result?.pathData) continue

    const path = (result.pathData && Array.isArray(result.pathData.paths))
      ? result.pathData.paths[0]
      : result.pathData

    const polylineStr =
      (typeof path?.polyline === 'string' && path.polyline.trim())
        ? path.polyline.trim()
        : (Array.isArray(path?.steps) ? joinStepsPolyline(path.steps) : '')

    const points = parsePolylineToPoints(polylineStr)
    if (!points || points.length < 2) continue

    const isSelected = i === selectedIndex
    const unSelectedStrokeColor = '#9CA3AF'
    const polyline = new window.AMap.Polyline({
      path: points,
      strokeColor: isSelected ? baseStrokeColor : unSelectedStrokeColor,
      // 粗细统一，仅用颜色区分选中/未选中
      strokeWeight: 6,
      strokeOpacity: 1,
      // 非选中不使用虚线，保持“浅色实线”的观感
      strokeStyle: 'solid',
      lineJoin: 'round',
      lineCap: 'round',
      zIndex: isSelected ? 300 : 210
    })

    amapInstance.add(polyline)
    simpleAlternativePolylines.push(polyline)

    // 地图交互：点击某条未选中的备选线路 -> 切换为当前方案
    polyline.on('click', () => {
      // 非公交场景：selectRoute 只做高亮切换，不会清空重绘
      if (routePlanning.value.travelMode !== 'transit') {
        void selectRoute(i)
      }
    })
  }

  // 起点终点只需要添加一次
  await addStartEndMarkers()

  // 视野适配：包含所有备选折线 + 起终点
  fitRouteToView()

  // 确保高亮状态与 selectedRouteIndex 一致
  highlightSimpleAlternativeRoute(selectedIndex)
}

// 添加公交站点标记
const addTransitStationMarkers = (transitData) => {
  console.log('开始添加公交站点标记', transitData)
  
  if (!window.AMap || !amapInstance) {
    console.error('地图实例未就绪')
    return
  }

  // 清除旧标记
  window.transitStationMarkers = window.transitStationMarkers || []
  window.transitStationMarkers.forEach(m => amapInstance.remove(m))
  window.transitStationMarkers = []

  if (!transitData.segments || transitData.segments.length === 0) {
    console.warn('无段信息')
    return
  }

  // 辅助函数：解析坐标
  const parseLoc = (loc) => {
    if (!loc) return null
    if (Array.isArray(loc)) return new window.AMap.LngLat(loc[0], loc[1])
    const parts = loc.split(',')
    return new window.AMap.LngLat(parseFloat(parts[0]), parseFloat(parts[1]))
  }

  // 检查并确保 marker-label 样式存在
  const styleId = 'amap-marker-label-style'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.innerHTML = `
      .marker-label {
        background: white;
        padding: 4px 8px;
        border-radius: 4px;
        border: 2px solid #ef4444;
        color: #333;
        font-size: 12px;
        font-weight: bold;
        white-space: nowrap;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        pointer-events: none;
      }
      .amap-marker-content {
        white-space: nowrap;
      }
    `
    document.head.appendChild(style)
  }

  const markers = []
  
  // 获取当前选中路线的站点数据（包含换乘信息）
  const currentRoute = routeResults.value[selectedRouteIndex.value]
  const allStationsWithTransferInfo = currentRoute?.allStations || []
  console.log('当前路线的站点数据（包含换乘信息）:', allStationsWithTransferInfo)
  console.log('所有站点名称:', allStationsWithTransferInfo.map(s => s.name))
  console.log('可换乘站点:', allStationsWithTransferInfo.filter(s => s.isTransferOption).map(s => s.name))

  transitData.segments.forEach((segment) => {
    const buslines = (segment.bus && segment.bus.buslines) || (segment.subway && segment.subway.buslines)
    if (!buslines || buslines.length === 0) return

    const line = buslines[0]

    // 处理站点创建
    const createMarker = (stop, type, originalStation = null) => {
      const pos = parseLoc(stop.location)
      if (!pos) return null
      
      // 核心修复：直接从 allStationsWithTransferInfo 中查找最新的站点数据，确保获取到 isTransferOption 标记
      const matchedStation = allStationsWithTransferInfo.find(as => 
        as.name === stop.name && 
        (getLocStr(as.location) === getLocStr(stop.location))
      )
      
      const stationWithTransferInfo = matchedStation || originalStation || stop
      console.log(`站点 ${stop.name} 的最终换乘状态:`, stationWithTransferInfo.isTransferOption)

      let marker
      if (type === 'via') {
        // 途经站：缩小尺寸并确保中心对齐
        marker = new window.AMap.Marker({
          position: pos,
          title: stop.name,
          zIndex: 100,
          content: '<div style="width: 10px; height: 10px; background-color: #3b82f6; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 3px rgba(0,0,0,0.5); cursor: pointer;"></div>',
          offset: new window.AMap.Pixel(-7, -7),
          map: amapInstance,
          bubble: false, // 改为 false 确保事件不穿透
          clickable: true,
          extData: { stop, type, station: stationWithTransferInfo }
        })
      } else {
        // 起点/终点站使用 AMap 默认图标 (红色图钉)
        marker = new window.AMap.Marker({
          position: pos,
          title: stop.name,
          zIndex: 110,
          map: amapInstance,
          bubble: false, // 改为 false
          clickable: true,
          extData: { stop, type, station: stationWithTransferInfo }
        })
        
        /* marker.setLabel({
          content: `<div class="marker-label">${stop.name}</div>`,
          direction: 'top',
          offset: new window.AMap.Pixel(0, -5)
        }) */
      }

      // 绑定点击事件弹出信息窗体
      marker.on('click', (e) => {
        const stationData = e.target.getExtData().station
        console.log('站点被点击:', stationData.name, '是否可换乘:', stationData.isTransferOption);
        
        // 如果是自主换乘可选站，增加换乘建议按钮
        let content = `<div class="station-info-window" style="padding: 10px; min-width: 150px;">
          <div style="font-weight: bold; color: #1f2937; margin-bottom: 4px; font-size: 14px;">${stationData.name}</div>
          <div style="font-size: 12px; color: #4b5563; margin-bottom: 8px;">${type === 'dep' ? t('route.depStation') : type === 'arr' ? t('route.arrStation') : t('route.viaStation')}</div>`;

        if (stationData.isTransferOption) {
          console.log(`显示换乘按钮 for ${stationData.name}, 换乘段:`, stationData.transferPair);
          const walkingDistance = stationData.walkingDistance || 0;
          content += `<div style="border-top: 1px dashed #e5e7eb; padding-top: 8px;">
            <div style="font-size: 11px; color: #3b82f6; margin-bottom: 4px;">发现多条线路重合，可在此换乘</div>
            <div style="font-size: 10px; color: #6b7280; margin-bottom: 4px;">步行距离: ${walkingDistance}米</div>
            <button onclick="window.handleTransferChange('${stationData.name}', ${stationData.transferPair[0]}, ${stationData.transferPair[1]})"
              style="width: 100%; padding: 4px 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              设为换乘点
            </button>
          </div>`;
        } else {
          console.log(`不显示换乘按钮 for ${stationData.name}`);
        }

        content += `</div>`;
        
        const infoWindow = new window.AMap.InfoWindow({
          content: content,
          offset: type === 'via' ? new window.AMap.Pixel(0, -10) : new window.AMap.Pixel(0, -31),
          autoMove: true,
          closeWhenClickMap: true
        });
        
        infoWindow.open(amapInstance, pos);
      });

      return marker
    }

    // 1. 起点站
    if (line.departure_stop) {
      const matchingStation = allStationsWithTransferInfo.find(s => s.name === line.departure_stop.name || s.name.includes(line.departure_stop.name) || line.departure_stop.name.includes(s.name))
      console.log(`起点站 ${line.departure_stop.name} 匹配结果:`, matchingStation)
      const m = createMarker(line.departure_stop, 'dep', matchingStation)
      if (m) markers.push(m)
    }

    // 2. 途经站
    if (line.via_stops && Array.isArray(line.via_stops)) {
      line.via_stops.forEach(stop => {
        const matchingStation = allStationsWithTransferInfo.find(s => s.name === stop.name || s.name.includes(stop.name) || stop.name.includes(s.name))
        console.log(`途经站 ${stop.name} 匹配结果:`, matchingStation)
        const m = createMarker(stop, 'via', matchingStation)
        if (m) markers.push(m)
      })
    }

    // 3. 终点站
    if (line.arrival_stop) {
      const matchingStation = allStationsWithTransferInfo.find(s => s.name === line.arrival_stop.name || s.name.includes(line.arrival_stop.name) || line.arrival_stop.name.includes(s.name))
      console.log(`终点站 ${line.arrival_stop.name} 匹配结果:`, matchingStation)
      const m = createMarker(line.arrival_stop, 'arr', matchingStation)
      if (m) markers.push(m)
    }
  })

  // 将所有标记添加到地图并存储
  markers.forEach(marker => {
    // 已经在 createMarker 中设置了 map: amapInstance，但这里显式添加一次确保万无一无
    amapInstance.add(marker)
    window.transitStationMarkers.push(marker)
  })
  
  console.log(`成功添加 ${window.transitStationMarkers.length} 个站点标记`)
  
  // 检查标记状态
  window.transitStationMarkers.forEach((m, i) => {
    console.log(`标记 ${i} 状态:`, {
      name: m.getTitle ? m.getTitle() : '圆点',
      visible: m.getVisible(),
      map: !!m.getMap(),
      zIndex: m.getZIndex ? m.getZIndex() : 'unknown',
      position: m.getPosition ? m.getPosition().toString() : (m.getCenter ? m.getCenter().toString() : 'unknown')
    })
  })
  
  // 调整视野
  if (window.transitStationMarkers.length > 0) {
    setTimeout(() => {
      if (amapInstance && routeLine) {
        amapInstance.setFitView([routeLine, ...window.transitStationMarkers])
        console.log('公交站点视野已调整')
      }
    }, 200)
  }
}

// 格式化距离
const formatDistance = (distance) => {
  if (distance < 1000) {
    return `${Math.round(distance)}米`
  } else {
    return `${(distance / 1000).toFixed(1)}公里`
  }
}

// 格式化时间
const formatDuration = (duration, walkingTime = 0) => {
  const d = Number(duration) || 0
  const w = Number(walkingTime) || 0
  
  console.log('时间格式化调试:')
  console.log(`公交时间: ${d}秒 (${Math.round(d/60)}分钟)`)
  console.log(`步行时间: ${w}秒 (${Math.round(w/60)}分钟)`)
  
  const totalSeconds = d + w
  console.log(`总时间: ${totalSeconds}秒 (${Math.round(totalSeconds/60)}分钟)`)
  
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) {
    return `${minutes}分钟`
  } else {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}小时${remainingMinutes}分钟`
  }
}


// 关闭路线结果
const closeRouteResults = () => {
  showRouteResults.value = false
  routeResults.value = []
  selectedRouteIndex.value = 0
  clearRoute()
}

const clearRouteForm = () => {
  clearRoute()
  routeForm.value.startAddress = ''
  routeForm.value.endAddress = ''
  routePlanning.value.startPoint = null
  routePlanning.value.endPoint = null
  routePlanning.value.prePlannedRoutes = null
  routePlanning.value.isPrePlanning = false
  customTransfer.value = { isActive: false, stopName: '', fromSegIndex: -1, toSegIndex: -1 }
  
  // 清除路径规划结果
  showRouteResults.value = false
  routeResults.value = []
  selectedRouteIndex.value = 0
}

// 清除路径相关的所有覆盖物
const clearRoute = () => {
  console.log('清除路线和标记')
  clearRouteLayers()
}

// 地图点击事件处理
const handleMapClick = (e) => {
  // 1) 手动校准优先级最高：精度不达标时，下一次点击用于覆盖缓存
  if (isManualCalibratingLocation.value) {
    const lng = e.lnglat.getLng()
    const lat = e.lnglat.getLat()
    const now = Date.now()

    routeForm.value.currentLocation = {
      lng,
      lat,
      _coord: 'gcj02',
      accuracy: 5,
      timestamp: now
    }
    localStorage.setItem('userLocation', JSON.stringify(routeForm.value.currentLocation))

    if (userLocationMarker) {
      amapInstance.remove(userLocationMarker)
    }
    userLocationMarker = new AMap.Marker({
      position: [lng, lat],
      content: `
        <div style="position: relative;">
          <div style="width: 20px; height: 20px; background: #0066ff; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
          <div style="position: absolute; top: -30px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap;">已校准（±5m）</div>
        </div>
      `,
      offset: new AMap.Pixel(-10, -10),
      zIndex: 1000
    })
    amapInstance.add(userLocationMarker)

    isManualCalibratingLocation.value = false

    if (routePlanning.value.isActive && !routeForm.value.startAddress) {
      useCurrentLocationAsStart()
    }
    return
  }

  if (!routePlanning.value.isActive) return
  
  const lng = e.lnglat.getLng()
  const lat = e.lnglat.getLat()
  
  if (routePlanning.value.isSettingStart) {
    routePlanning.value.startPoint = { lng, lat, _coord: 'gcj02' }
    routePlanning.value.isSettingStart = false
    
    // 如果已经有终点，直接规划路径
    if (routePlanning.value.endPoint) {
      planRoute(routePlanning.value.startPoint, routePlanning.value.endPoint)
    }
  } else if (routePlanning.value.isSettingEnd) {
    routePlanning.value.endPoint = { lng, lat, _coord: 'gcj02' }
    routePlanning.value.isSettingEnd = false
    
    // 如果已经有起点，直接规划路径
    if (routePlanning.value.startPoint) {
      planRoute(routePlanning.value.startPoint, routePlanning.value.endPoint)
    }
  }
}

// 初始化地图
const initMap = async () => {
  try {
    const AMap = await loadAmapScript()
    
    if (mapContainer.value) {
      // 淄博市中心坐标
      const ziboCenter = [118.047665, 36.814907]
      
      amapInstance = new AMap.Map(mapContainer.value, {
        zoom: 13,
        center: ziboCenter,
        viewMode: '2D',
        pitch: 0,
        rotation: 0,
        mapStyle: 'amap://styles/normal',
        features: ['bg', 'road', 'building', 'point'],
        resizeEnable: true,
        doubleClickZoom: false,
        showLabel: true
      })

      // 添加控件
      amapInstance.addControl(new AMap.Scale())

      // 加载并添加ToolBar
      window.AMap.plugin(['AMap.ToolBar'], () => {
        const toolBar = new window.AMap.ToolBar({
          position: 'LB'
        })
        amapInstance.addControl(toolBar)
      })

      // 初始化卫星图层
      satelliteLayer = new AMap.TileLayer.Satellite()
      roadNetLayer = new AMap.TileLayer.RoadNet()
      
      // 绑定地图事件
      amapInstance.on('click', handleMapClick)
      amapInstance.on('complete', () => {
        console.log('地图加载完成，中心点：', ziboCenter)
        // 不再自动初始化定位服务，等待用户主动点击定位按钮
        console.log('地图已就绪，可以开始使用定位功能')
      })
    }
    
    return amapInstance
  } catch (error) {
    console.error('地图初始化失败:', error)
    throw error
  }
}

onMounted(async () => {
  if (!mapContainer.value) return

  try {
    // 加载历史记录
    loadHistory()
    
    // 清理过期缓存
    cacheManager.localCache.clear()
    
    // 初始化地图（动态地图）
    await initMap()
    
    console.log('页面初始化完成')
  } catch (error) {
    console.error('页面初始化失败:', error)
  }
})

// 检查保存的位置信息
const checkSavedLocation = () => {
  // 从localStorage或其他地方获取保存的位置
  const savedLocation = localStorage.getItem('userLocation')
  if (!savedLocation) {
    getUserLocation()
    return
  }

  try {
    const location = JSON.parse(savedLocation)
    if (!location || typeof location !== 'object') {
      localStorage.removeItem('userLocation')
      routeForm.value.currentLocation = null
      getUserLocation()
      return
    }

    const MAX_ACCURACY_METERS = 30
    const accuracy = Number(location.accuracy)
    const timestamp = Number(location.timestamp)
    const now = Date.now()
    const isFresh = Number.isFinite(timestamp) && now - timestamp <= 2 * 60 * 60 * 1000
    const isAccurate = Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS

    // 若旧数据缺失 _coord，默认按 gcj02 处理，避免二次偏移。
    if (!location._coord) location._coord = 'gcj02'

    if (!isFresh || !isAccurate) {
      localStorage.removeItem('userLocation')
      routeForm.value.currentLocation = null
      getUserLocation()
      return
    }

    routeForm.value.currentLocation = location

    // 如果路径规划卡片已打开且起点为空，自动填充
    if (routePlanning.value.isActive && !routeForm.value.startAddress) useCurrentLocationAsStart()
  } catch (e) {
    console.error('解析保存的位置信息失败:', e)
    localStorage.removeItem('userLocation')
    routeForm.value.currentLocation = null
    getUserLocation()
  }
}

// 清理事件监听
onBeforeUnmount(() => {
  // 清理 Web Worker
  webWorkerManager.destroy()
  
  // 清理地图事件监听
  if (amapInstance) {
    amapInstance.off('click', handleMapClick)
  }
  
  // 清理全局事件监听
  window.removeEventListener('location-search', handleLocationSearch)
  window.removeEventListener('search-result', handleGlobalSearchResult)
  
  // 清理全局函数
  if (window.handleTransferChange) {
    delete window.handleTransferChange
  }
  
  // 清理定时器
  if (window.startSearchTimeout) {
    clearTimeout(window.startSearchTimeout)
  }
  if (window.endSearchTimeout) {
    clearTimeout(window.endSearchTimeout)
  }
  if (window.__prePlanTimeout) {
    clearTimeout(window.__prePlanTimeout)
  }
})

const switchBase = async (type) => {
  if (!amapInstance) return
  baseType.value = type

  if (type === 'image') {
    // 影像模式：叠加卫星影像 + 路网图
    if (satelliteLayer && roadNetLayer) {
      amapInstance.setLayers([satelliteLayer, roadNetLayer])
    }
  } else {
    // 矢量模式：恢复默认图层
    // 通过重新设置地图样式的方式回到矢量基础底图
    amapInstance.setLayers([])
    amapInstance.setMapStyle('amap://styles/normal')
  }
}

</script>

<template>
  <div class="route-page">
    <header class="route-header">
      <div class="route-header-left">
        <h2>二维地图</h2>
        <span class="map-title">路线规划</span>
      </div>
      <div class="route-header-right">
        <button
          class="route-btn"
          @click="toggleRoutePlanning"
          :class="{ active: routePlanning.isActive }"
          title="路径规划"
        >
          路线规划
        </button>
        <button
          class="location-btn"
          @click="getUserLocation"
          title="定位当前位置"
        >
          定位
        </button>
        <button
          class="base-btn"
          :class="{ active: baseType === 'vector' }"
          @click="switchBase('vector')"
        >
          矢量地图
        </button>
        <button
          class="base-btn"
          :class="{ active: baseType === 'image' }"
          @click="switchBase('image')"
        >
          卫星地图
        </button>
      </div>
    </header>

    <section class="route-main">
      <div ref="mapContainer" class="route-map"></div>
      
      <!-- 路径规划卡片 -->
      <div v-if="routePlanning.isActive" class="route-planning-card">
        <div class="card-header">
          <h3>路线规划</h3>
          <div v-if="routePlanning.isPrePlanning" class="pre-planning-status">
            <div class="loading-spinner"></div>
            <span>规划中...</span>
          </div>
        </div>
        <div class="card-content">
          <div class="input-group">
            <label>起点</label>
            <div class="input-wrapper">
              <input 
                type="text" 
                v-model="routeForm.startAddress" 
                placeholder="输入起点地址或点击地图选择"
                @input="onStartSearchInput"
                @focus="showStartSearchResults = startSearchResults.length > 0"
              >
              <button class="use-location-btn" @click="useCurrentLocationAsStart" title="使用当前位置">
                当前位置
              </button>
            </div>
            
            <!-- 起点搜索候选框 -->
            <div v-if="showStartSearchResults && (startSearchResults.length > 0 || isStartSearching)" class="start-search-results">
              <div 
                v-for="result in startSearchResults" 
                :key="result.id"
                class="start-search-result-item"
                @click="selectStartResult(result)"
              >
                <div class="result-info">
                  <div class="result-name">{{ result.name }}</div>
                  <div class="result-address">{{ result.address || result.typeName }}</div>
                </div>
              </div>
              <div v-if="isStartSearching" class="start-search-loading">搜索中...</div>
            </div>
          </div>
          
          <div class="input-group">
            <label>终点</label>
            <div class="input-wrapper">
              <input 
                type="text" 
                v-model="routeForm.endAddress" 
                placeholder="输入终点地址或点击地图选择"
                @input="onEndSearchInput"
                @focus="showEndSearchResults = endSearchResults.length > 0"
              >
              <button class="search-btn" @click="performEndSearch(routeForm.endAddress)" title="搜索终点">
                搜索终点
              </button>
            </div>
            
            <!-- 终点搜索候选框 -->
            <div v-if="showEndSearchResults && (endSearchResults.length > 0 || isEndSearching)" class="end-search-results">
              <div 
                v-for="result in endSearchResults" 
                :key="result.id"
                class="end-search-result-item"
                @click="selectEndResult(result)"
              >
                <div class="result-info">
                  <div class="result-name">{{ result.name }}</div>
                  <div class="result-address">{{ result.address || result.typeName }}</div>
                </div>
              </div>
              <div v-if="isEndSearching" class="end-search-loading">搜索中...</div>
            </div>
          </div>
          
          <div class="input-group">
            <label>出行方式</label>
            <div class="travel-modes">
              <button 
                v-for="mode in travelModes" 
                :key="mode.value"
                class="mode-btn"
                :class="{ active: routePlanning.travelMode === mode.value }"
                @click="routePlanning.travelMode = mode.value"
              >
                {{ mode.icon }} {{ mode.label }}
              </button>
            </div>
          </div>
          
          <div class="action-buttons">
            <button class="plan-route-btn" @click="planRouteFromForm">
              开始规划
            </button>
            <button class="clear-route-btn" @click="clearRouteForm">
              清空
            </button>
          </div>
        </div>
        
        <!-- 路径规划结果页面 -->
        <div v-if="showRouteResults && routeResults.length > 0" class="route-results-panel">
          <div class="results-header">
            <h4>路线结果</h4>
            <div class="results-sort" v-if="routePlanning.travelMode === 'transit'">
              <select v-model="transitSortMode" class="sort-select" @click.stop>
                <option value="time">时间最短</option>
                <option value="walking">步行最少</option>
                <option value="cost">花费最少</option>
              </select>
            </div>
            <div class="results-sort" v-if="routePlanning.travelMode !== 'transit'">
              <select v-model="nonTransitSortMode" class="sort-select" @click.stop>
                <option value="time">时间优先</option>
                <option value="distance">距离优先</option>
              </select>
            </div>
            <button class="close-results" @click="closeRouteResults">✕</button>
          </div>
          <div class="results-list">
            <div 
              v-for="(result, index) in routeResults" 
              :key="index"
              :class="['route-result-item', { active: selectedRouteIndex === index }, `rank-${Math.min(index, 2)}`]"
              @click="selectRoute(index)"
            >
              <div class="route-info">
                <!-- 核心概览 -->
                <div class="route-main">
                  <div class="route-summary">
                    <span class="route-mode-badge">{{ getModeLabel(result.mode) }}</span>
                    <span class="route-distance">{{ formatDistance(result.distance) }}</span>
                    <span class="route-duration">{{ formatDuration(result.duration, result.walkingTime || 0) }}</span>
                  </div>
                  <div
                    v-if="routePlanning.travelMode !== 'transit'"
                    class="route-diff-text"
                    :class="getNonTransitRelativeDiff(index).tone"
                  >
                    {{ getNonTransitRelativeDiff(index).text }}
                  </div>
                  <div v-if="result.mode === 'transit'" class="route-transit-meta">
                    换乘 {{ result.transfers }} 次 · {{ result.stations }} 站 · 步行 {{ formatDistance(result.walkingDistance || 0) }} · 约 {{ result.cost }} 元
                  </div>
                </div>
                
                <!-- 公交换乘链条 -->
                <div v-if="result.mode === 'transit' && result.busLines && result.busLines.length > 0" class="transit-chain">
                  <div v-for="(lines, segIndex) in result.busLines" :key="segIndex" class="transit-chain-item">
                    <div class="bus-badge-group">
                      <span v-for="(line, lineIndex) in lines" :key="lineIndex" class="bus-badge">
                        {{ line.name.split('(')[0] }}
                        <span v-if="lineIndex < lines.length - 1" class="line-separator">/</span>
                      </span>
                    </div>
                    <span v-if="segIndex < result.busLines.length - 1" class="transit-arrow">→</span>
                  </div>
                </div>

                <!-- 公交线路详情列表 -->
                <div v-if="result.mode === 'transit' && result.busLines && result.busLines.length > 0" class="bus-lines-detail">
                  <div v-for="(lines, segIndex) in result.busLines" :key="segIndex" class="bus-line-row">
                    <div class="line-indicator">
                      <div v-if="segIndex < result.busLines.length - 1" class="line-path"></div>
                    </div>
                    <div class="line-content">
                      <div class="line-title-group">
                        <div v-for="(line, lineIndex) in lines" :key="lineIndex" class="line-title">
                          {{ line.name }}
                          <span v-if="lineIndex < lines.length - 1" class="or-text">或</span>
                        </div>
                      </div>
                      <div class="line-desc">{{ lines[0].departureStop }} → {{ lines[0].arrivalStop }} ({{ lines[0].viaNum }}站)</div>
                    </div>
                  </div>
                </div>

                <!-- 换乘站选择（仅当存在多个换乘点时显示） -->
                <div v-if="index === selectedRouteIndex && getTransferOptions(result).length >= 2" class="transfer-selector">
                  <div class="transfer-hint">
                    <span class="hint-icon">💡</span>
                    <span>当前方案有多个换乘点可选</span>
                  </div>
                  <select
                    class="transfer-select"
                    @change="onTransferSelectChange($event, result)"
                    @click.stop
                  >
                    <option
                      v-for="stop in getTransferOptions(result)"
                      :key="stop.name"
                      :value="stop.name"
                      :selected="stop.isCurrentTransfer"
                    >
                      {{ stop.name }} {{ stop.isCurrentTransfer ? '(当前)' : '' }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 自定义换乘站选择面板（文档 2.2） -->
      <div v-if="showTransferPicker" class="transfer-picker-mask" @click="closeTransferPicker">
        <div class="transfer-picker-panel" @click.stop>
          <div class="transfer-picker-header">
            <h4>更换换乘站</h4>
            <button class="transfer-picker-close" @click="closeTransferPicker">✕</button>
          </div>
          <div class="transfer-picker-subtitle">
            请选择重合段内站点作为换乘点（选择后将自动切换到包含该站的方案）
          </div>
          <div class="transfer-picker-list">
            <button
              v-for="c in transferPicker.candidates"
              :key="c.name"
              class="transfer-candidate"
              @click="applyCustomTransfer(c.name)"
            >
              <span class="candidate-name">{{ c.name }}</span>
              <span class="candidate-meta">步行约 {{ Math.round(c.walkingDistance || 0) }}m</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- 站点详情面板 -->
      <div v-if="showRouteStations" class="route-stations-panel">
        <div class="stations-header">
          <h4>站点详情</h4>
          <button class="close-stations" @click="closeStationsDetail">✕</button>
        </div>
        <div class="stations-list">
          <div 
            v-for="(station, index) in selectedRouteStations" 
            :key="index"
            class="station-item"
            :class="{
              'walking-station': station.type === 'walking',
              'departure-station': station.isDeparture,
              'arrival-station': station.isArrival,
              'via-station': station.isVia
            }"
          >
            <div class="station-number">{{ index + 1 }}</div>
            <div class="station-info">
              <div v-if="station.type === 'walking'" class="station-walking">
                <div class="station-name">步行 {{ station.description }}</div>
                <div class="station-detail">{{ Math.round(station.duration / 60) }}分钟</div>
              </div>
              <div v-else class="station-transit">
                <div class="station-name" style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: #1f2937; font-weight: 500;">{{ station.name }}</span>
                </div>
                <div class="station-detail">{{ station.lineName }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 历史记录面板 -->
      <div v-if="routeHistory.length > 0" class="route-history-panel">
        <div class="history-header">
          <h4>历史路线</h4>
          <button class="toggle-history" @click="showHistory = !showHistory">
            {{ showHistory ? '隐藏' : '显示' }}
          </button>
        </div>
        <div v-if="showHistory" class="history-list">
          <div 
            v-for="(item, index) in routeHistory" 
            :key="item.id"
            class="history-item"
            @click="replanHistoryRoute(item)"
          >
            <div class="history-route-info">
              <div class="history-points">
                <span class="history-point">{{ item.startPoint.name }}</span>
                <span class="mode-label">驾车</span>
                <span class="history-point">{{ item.endPoint.name }}</span>
              </div>
              <div class="history-meta">
                <span class="history-mode">{{ getModeLabel(item.mode) }}</span>
                <span class="history-time">{{ formatTime(item.timestamp) }}</span>
                <span v-if="item.selectedRoute" class="history-summary">
                  {{ formatDuration(item.selectedRoute.duration) }} · {{ formatDistance(item.selectedRoute.distance) }}
                </span>
              </div>
            </div>
            <div class="history-actions">
              <button class="history-replan-btn" @click.stop="replanHistoryRoute(item)">
                查看详情
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.route-page {
  display: flex;
  flex-direction: column;
  /* 与三维页面类似，占满可视高度，避免地图容器过矮 */
  height: calc(100vh - 120px);
  gap: 0.75rem;
}

.route-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.route-header-left h2 {
  margin: 0;
  font-size: 1.25rem;
}

.route-subtitle {
  font-size: 0.8rem;
  color: #9ca3af;
}

.route-header-right {
  display: flex;
  gap: 0.5rem;
}

.location-btn {
  background: rgba(34, 197, 94, 0.8);
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: white;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.location-btn:hover {
  background: rgba(34, 197, 94, 0.9);
  border-color: #22c55e;
  transform: translateY(-1px);
}

.route-btn {
  background: rgba(59, 130, 246, 0.8);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: white;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.route-btn:hover {
  background: rgba(59, 130, 246, 0.9);
  border-color: #3b82f6;
  transform: translateY(-1px);
}

.route-btn.active {
  background: rgba(59, 130, 246, 1);
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.route-point-btn {
  background: rgba(156, 163, 175, 0.8);
  border: 1px solid rgba(156, 163, 175, 0.4);
  color: white;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.route-point-btn:hover {
  background: rgba(156, 163, 175, 0.9);
  border-color: #9ca3af;
  transform: translateY(-1px);
}

.route-point-btn.active {
  background: rgba(34, 197, 94, 0.8);
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
}

.base-btn {
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.4);
  color: #e5e7eb;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.base-btn:hover {
  background: rgba(37, 99, 235, 0.4);
  border-color: #3b82f6;
}

.base-btn.active {
  background: rgba(37, 99, 235, 0.7);
  border-color: #60a5fa;
}

/* 预规划状态样式 */
.pre-planning-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #3b82f6;
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 历史记录面板样式 */
.route-history-panel {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 320px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  z-index: 999;
  max-height: 400px;
  overflow: hidden;
}

.history-header {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.toggle-history {
  background: none;
  border: 1px solid #d1d5db;
  color: #6b7280;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-history:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.history-list {
  max-height: 300px;
  overflow-y: auto;
}

.history-item {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: background 0.2s;
}

.history-item:hover {
  background: rgba(59, 130, 246, 0.05);
}

.history-item:last-child {
  border-bottom: none;
}

.history-route-info {
  margin-bottom: 8px;
}

.history-points {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-point {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-arrow {
  color: #9ca3af;
  font-size: 12px;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
}

.history-mode {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.history-time {
  color: #9ca3af;
}

.history-summary {
  color: #059669;
  font-weight: 500;
}

.history-actions {
  display: flex;
  justify-content: flex-end;
}

.history-replan-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.history-replan-btn:hover {
  background: #2563eb;
}

.route-main {
  flex: 1;
  display: block;
  position: relative;
}

.route-map {
  width: 100%;
  height: 100%;
}

.route-planning-card {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 320px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  z-index: 1000;
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.card-content {
  padding: 20px;
  overflow: visible;
}

.input-group {
  margin-bottom: 16px;
  position: relative;
  overflow: visible;
}

.input-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.input-wrapper {
  display: flex;
  gap: 8px;
}

.input-wrapper input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  background: white;
}

.input-wrapper input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.use-location-btn {
  padding: 8px 12px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.use-location-btn:hover {
  background: #2563eb;
}

.search-btn {
  padding: 8px 12px;
  background: #f59e0b;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.search-btn:hover {
  background: #d97706;
}

.end-search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 9999;
  margin-top: 4px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.start-search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 9999;
  margin-top: 4px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.end-search-result-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background 0.2s ease;
}

.end-search-result-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.end-search-result-item:last-child {
  border-bottom: none;
}

.start-search-result-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background 0.2s ease;
}

.start-search-result-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.start-search-result-item:last-child {
  border-bottom: none;
}

.result-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-name {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
}

.result-address {
  font-size: 12px;
  color: #6b7280;
}

.end-search-loading {
  padding: 10px 12px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.marker-label {
  background: white;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ccc;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* 公交站点标记样式 */
.transit-stop-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 10px;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  pointer-events: auto;
  cursor: pointer;
}

.transit-stop-marker.dep,
.transit-stop-marker.arr {
  width: 20px;
  height: 20px;
  background-color: #10b981; /* 绿色 */
  border-radius: 50%;
}

.transit-stop-marker.via {
  width: 12px;
  height: 12px;
  background-color: #3b82f6; /* 蓝色 */
  border-radius: 50%;
}

.transit-stop-marker:hover {
  transform: scale(1.2);
  z-index: 1000000 !important;
}

.route-results-panel {
  margin-top: 12px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(59, 130, 246, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(to right, #f8fafc, #eff6ff);
  border-bottom: 1px solid rgba(59, 130, 246, 0.1);
}

.results-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1e40af;
}

.results-sort {
  flex: 1;
  display: flex;
  justify-content: center;
}

.sort-select {
  border: 1px solid rgba(59, 130, 246, 0.25);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  color: #1e40af;
  outline: none;
}

.sort-select:focus {
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.results-list {
  max-height: 350px;
  overflow-y: auto;
  padding: 8px;
}

/* 自定义滚动条 */
.results-list::-webkit-scrollbar {
  width: 6px;
}
.results-list::-webkit-scrollbar-track {
  background: transparent;
}
.results-list::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
.results-list::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.route-result-item {
  padding: 16px;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
  background: white;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 方案卡片的“排名梯度”（不影响地图路线颜色） */
.route-result-item.rank-0:not(.active) {
  border-color: rgba(59, 130, 246, 0.35);
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.12), rgba(255, 255, 255, 0.98));
}

.route-result-item.rank-1:not(.active) {
  border-color: rgba(59, 130, 246, 0.22);
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.08), rgba(255, 255, 255, 0.98));
}

.route-result-item.rank-2:not(.active) {
  border-color: rgba(59, 130, 246, 0.12);
  background: rgba(255, 255, 255, 0.98);
}

.route-result-item:hover {
  border-color: #3b82f6;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
}

.route-result-item.active {
  border-color: #3b82f6;
  background: #f0f7ff;
  box-shadow: inset 0 0 0 1px #3b82f6;
}

.route-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.route-mode-badge {
  background: #3b82f6;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.route-distance, .route-duration {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.route-transit-meta {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 12px;
}

.route-diff-text {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.3;
}

.route-diff-text.worse {
  color: #f97316; /* 慢了 */
}

.route-diff-text.better {
  color: #10b981; /* 快了 */
}

.close-results {
  background: none;
  border: none;
  font-size: 18px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.close-results:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* 换乘链条 */
.transit-chain {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  padding: 8px;
  background: #f8fafc;
  border-radius: 6px;
}

.transit-chain-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bus-badge {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #2563eb;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transit-arrow {
  color: #94a3b8;
  font-size: 12px;
}

/* 线路详情行 */
.bus-lines-detail {
  margin-top: 12px;
  padding-left: 4px;
}

/* 换乘站选择器 */
.transfer-selector {
  margin-top: 12px;
  padding: 10px 12px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.03));
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 8px;
}

.transfer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #92400e;
  font-weight: 500;
}

.hint-icon {
  font-size: 14px;
}

.transfer-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  color: #1f2937;
  cursor: pointer;
  outline: none;
  transition: all 0.2s;
}

.transfer-select:hover {
  border-color: #f59e0b;
}

.transfer-select:focus {
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
}

.bus-line-row {
  display: flex;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}

.bus-line-row:last-child {
  padding-bottom: 0;
}

.line-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 12px;
}

.line-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2px solid white;
  box-shadow: 0 0 0 1px #3b82f6;
  z-index: 2;
}

.line-path {
  width: 2px;
  flex: 1;
  background: #bfdbfe;
  margin-top: 2px;
  margin-bottom: 2px;
}

.line-content {
  flex: 1;
}

.line-title {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 2px;
}

.line-desc {
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

/* 站点详情面板优化 */
.bus-badge-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.line-separator {
  color: #94a3b8;
  margin: 0 2px;
  font-weight: normal;
}

.line-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 4px;
}

.or-text {
  display: inline-block;
  font-size: 12px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 0 4px;
  border-radius: 2px;
  margin-left: 6px;
  font-weight: normal;
}

.bus-line-route {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bus-line-stations {
  color: #9ca3af;
  font-size: 10px;
}

.route-stations-panel {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  z-index: 100000;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

/* 自定义换乘站选择器 */
.transfer-picker-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  z-index: 100001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.transfer-picker-panel {
  width: min(420px, 92vw);
  max-height: min(520px, 80vh);
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.transfer-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(249, 250, 251, 0.9);
}

.transfer-picker-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
}

.transfer-picker-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}

.transfer-picker-close:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.transfer-picker-subtitle {
  padding: 10px 16px 0 16px;
  font-size: 12px;
  color: #64748b;
}

.transfer-picker-list {
  padding: 12px 16px 16px 16px;
  overflow-y: auto;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.transfer-candidate {
  text-align: left;
  border: 1px solid rgba(59, 130, 246, 0.2);
  background: white;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: all 0.15s ease;
}

.transfer-candidate:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.06);
}

.candidate-name {
  font-weight: 700;
  color: #1f2937;
  font-size: 13px;
}

.candidate-meta {
  color: #6b7280;
  font-size: 12px;
  white-space: nowrap;
}

.stations-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(249, 250, 251, 0.8);
}

.stations-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.close-stations {
  background: none;
  border: none;
  font-size: 18px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-stations:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.stations-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 16px 20px;
}

.station-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.station-item:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.station-number {
  width: 24px;
  height: 24px;
  background: #3b82f6;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  margin-right: 12px;
  flex-shrink: 0;
}

.station-item.walking-station .station-number {
  background: #10b981;
}

.station-item.departure-station .station-number {
  background: #10b981;
}

.station-item.arrival-station .station-number {
  background: #ef4444;
}

.station-info {
  flex: 1;
  min-width: 0;
}

.station-walking {
  padding: 8px 12px;
  background: rgba(16, 185, 129, 0.1);
  border-radius: 6px;
  border-left: 3px solid #10b981;
}

.station-transit {
  padding: 8px 12px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
}

.station-name {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 4px;
}

.station-detail {
  font-size: 12px;
  color: #6b7280;
}

.travel-modes {
  display: flex;
  gap: 8px;
}

.mode-btn {
  flex: 1;
  padding: 8px 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.mode-btn:hover {
  background: #e5e7eb;
}

.mode-btn.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.plan-route-btn {
  flex: 1;
  padding: 10px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.plan-route-btn:hover {
  background: #2563eb;
}

.clear-route-btn {
  padding: 10px 16px;
  background: #f3f4f6;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.clear-route-btn:hover {
  background: #e5e7eb;
  color: #374151;
}
</style>

<!-- 非scoped样式：浅色主题覆盖 -->
<style>
/* 浅色主题 - 路径规划页面 */
body.light-theme .route-page {
  background: #f8fafc;
}

body.light-theme .route-header h2 {
  color: #1e293b !important;
}

body.light-theme .route-header p {
  color: #64748b !important;
}

body.light-theme .route-panel {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05) !important;
}

body.light-theme .route-input {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .route-input::placeholder {
  color: #94a3b8 !important;
}

body.light-theme .route-btn-primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
  color: white !important;
}

body.light-theme .route-btn-secondary {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .route-result-item {
  background: #f8fafc !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .route-result-item:hover {
  background: rgba(59, 130, 246, 0.05) !important;
}

body.light-theme .route-result-title {
  color: #1e293b !important;
}

body.light-theme .route-result-desc {
  color: #64748b !important;
}
</style>
