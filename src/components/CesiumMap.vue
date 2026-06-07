<script setup>
import { onMounted, onBeforeUnmount, ref, defineExpose, nextTick, defineEmits } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import axios from 'axios'

// 定义向父组件传递的事件
const emit = defineEmits(['on-click'])

// 开发环境使用的 Cesium ion 访问令牌，避免泄露到公共仓库
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYmZmMWRmOS0yY2RlLTQ0NjMtOGE5Yy02OWM3MWM3MTc2ZGUiLCJpZCI6MzkzMjQ1LCJpYXQiOjE3NzE4MzI4NDV9.gXXxAwMo31mBsVDlfvQC4lfvX0gQo_6xZvysYzmq5r4'

// 天气组件使用的高德 Key（保留以免影响天气功能）
const AMAP_WEATHER_KEY = 'ba90fd503153d5c05bc955178c26ff58'

// 专门用于高德地图瓦片的 Key（你新申请的这一枚）
const AMAP_MAP_KEY = '38bfd013171ad0ef9ea8fb222fe2cf36'
// 高德路径规划 Key（用于步行可达性分析）
const AMAP_DIRECTION_KEY = '0b440760c47124fdfe1d1a4961f6d4dc'
const AMAP_ROUTE_CONCURRENCY = 3 // 高德路径规划并发上限

// API基础地址
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://zibo-gis-backend.onrender.com/api'

const mapContainer = ref(null)
let viewer
let hoverHandler
let measureHandler
let clickHandler
let userLocationMarker = null
// 等时圈起点：支持“我的定位”或“选中任意地点（点击空白也算）”
let isochroneOrigin = null // { longitude, latitude }
let isochroneOriginMarker = null // Cesium entity (visual)
let isochroneLastOptions = null // 记录最近一次等时圈分析参数，用于起点变化后重算

let highlighted = {
  entity: undefined,
  originalColor: undefined,
}
let measureMode = null // 'distance' | 'area' | null
let measurePositions = [] // Cartesian3 数组
let measureEntity = null // 线或面实体
let measureLabel = null // 结果文字
let measureEntities = [] // 所有测量相关实体，便于统一清理
let onFacilityAdded
let onFacilityRemoved
let defaultImageryProvider = null
let roadsDataSource = null
let onFacilityFocused
let heatmapDataSource = null
let coverageDataSource = null
let accessibilityDataSource = null
let siteSelectionDataSource = null // 选址分析结果数据源
let facilitiesLoaded = false // 标记设施数据是否已加载
let heatmapLoaded = false // 标记热力图是否已加载
let roadsLoaded = false // 标记道路是否已加载
let coverageStats = null // 服务范围统计结果
let accessibilityStats = null // 可达性分析统计结果
let coverageInFlight = false // 服务范围分析执行中：避免旧结果覆盖新状态
let coveragePendingOptions = null
let coverageActive = false
let coverageRunId = 0
const walkingDurationCache = new Map() // 缓存步行时长，减少重复 API 调用
const drivingDurationCache = new Map() // 缓存驾车时长，减少重复 API 调用
const walkingRouteInfoCache = new Map() // 缓存步行路程信息（时间+距离）
const drivingRouteInfoCache = new Map() // 缓存驾车路程信息（时间+距离）
// 缓存上限：避免长时间多次分析导致内存无限增长（Map 保序，删除最早插入的 key）
const walkingDurationCacheMax = 10000
const drivingDurationCacheMax = 10000
const walkingRouteInfoCacheMax = 5000
const drivingRouteInfoCacheMax = 5000
const accessibilityGridCacheMax = 20000
const isochroneMinDurationCacheMax = 20000

function setCacheWithLimit(cache, key, value, maxEntries) {
  if (!cache || typeof cache.set !== 'function') return
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
    cache.set(key, value)
    return
  }

  // 更新已有 key：不改变 Map 的插入顺序
  if (cache.has(key)) {
    cache.set(key, value)
    return
  }

  while (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }

  cache.set(key, value)
}

let accessibilityInFlight = false // 避免重复触发导致 Cesium 数据源更新冲突
let accessibilityPendingOptions = null
let accessibilityActive = false
let accessibilityRunId = 0
let accessibilityLoading = false // 可达性分析执行中
let accessibilityRunPromise = null // 供切换类型时等待
const accessibilityGridCache = new Map() // 缓存网格可达性结果，减少重复计算/API 调用

let isochroneDataSource = null
let isochroneStats = null
let isochroneLoading = false
let isochroneInFlight = false
let isochronePendingOptions = null
let isochroneActive = false
let isochroneRunId = 0
const isochroneMinDurationCache = new Map() // 缓存网格最短步行时长（用于等时圈分级）
let isochroneOriginPicking = false // 等时圈起点选择状态：仅在需要时接受点击
let isochroneConnectorDataSource = null // 起点到最近设施连线
let topArrivalHighlighted = new Map() // 记录高亮设施点的原始样式：key -> { entity, pixelSize, color, outlineColor, outlineWidth }

// 灾情展示相关变量
let disasterDataSource = null // 灾情数据源
let disasterRippleAnimations = [] // 涟漪动画回调列表

function normalizeCategory(rawType) {
  const t = (rawType || '').toLowerCase()
  if (t.includes('hospital') || t.includes('医院') || t.includes('医疗')) return 'hospital'
  if (t.includes('school') || t.includes('学校') || t.includes('教育')) return 'school'
  if (t.includes('shelter') || t.includes('避难') || t.includes('应急')) return 'shelter'
  if (t.includes('居民') || t.includes('小区') || t.includes('社区')) return 'resident'
  if (t.includes('商业') || t.includes('商场') || t.includes('超市') || t.includes('mall'))
    return 'commercial'
  return 'other'
}

function addFacilityPoint(f) {
  if (!viewer) return
  if (f.lon == null || f.lat == null) return

  const category = normalizeCategory(f.type)
  let color = Cesium.Color.fromCssColorString('#2563eb') // 默认蓝色
  if (category === 'hospital') {
    color = Cesium.Color.fromCssColorString('#ef4444') // 红色：医院
  } else if (category === 'school') {
    color = Cesium.Color.fromCssColorString('#10b981') // 绿色：学校
  } else if (category === 'shelter') {
    color = Cesium.Color.fromCssColorString('#f59e0b') // 橙色：避难场所
  } else if (category === 'resident') {
    color = Cesium.Color.fromCssColorString('#22d3ee') // 青色：居民/小区
  } else if (category === 'commercial') {
    color = Cesium.Color.fromCssColorString('#eab308') // 黄色：商业/商场
  }

  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 10), // 高度10米，确保在热力图之上
    point: {
      pixelSize: 10,
      color: color.withAlpha(0.9),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, // 始终显示在最上层
    },
    // 默认不在地图上显示名称标签，只保留彩色点，避免文字过密影响观感。
    // 设施详情可通过点击点后弹出的 infoBox / 自定义详情面板查看。
    label: {
      text: f.name || '',
      show: false,
    },
    name: '地点详情',
    description: `
      <table class="zw-table">
        <tr><th>名称</th><td>${f.name || ''}</td></tr>
        <tr><th>类型</th><td>${f.type || ''}</td></tr>
        <tr><th>经度</th><td>${f.lon}</td></tr>
        <tr><th>纬度</th><td>${f.lat}</td></tr>
      </table>
    `,
    properties: {
      type: f.type || '',
      category,
    },
  })

  return entity
}

async function loadFacilities() {
  if (!viewer) return

  try {
    const res = await axios.get(`${API_BASE}/facilities`)
    const facilities = res.data || []

    facilities.forEach((f) => {
      addFacilityPoint(f)
    })

    // 再加载前端本地新增但尚未入库的设施点
    if (typeof window !== 'undefined' && Array.isArray(window.__localFacilities)) {
      window.__localFacilities.forEach((f) => {
        addFacilityPoint(f)
      })
    }
  } catch (err) {
    console.error('加载设施数据失败（地图）', err)
  }
}

async function reloadFacilities() {
  if (!viewer) return
  const entitiesToRemove = viewer.entities.values.filter((e) => {
    const cat = e.properties?.category?.getValue()
    return !!cat
  })
  entitiesToRemove.forEach((e) => viewer.entities.remove(e))
  facilitiesLoaded = false
  await loadFacilities()
  facilitiesLoaded = true
}

// 安全移除数据源的辅助函数
function safeRemoveDataSource(viewer, dataSource) {
  if (!viewer || !dataSource) return false
  try {
    const dataSources = viewer.dataSources
    let exists = false
    for (let i = 0; i < dataSources.length; i++) {
      if (dataSources.get(i) === dataSource) {
        exists = true
        break
      }
    }
    if (exists) {
      dataSources.remove(dataSource, true)
      return true
    }
  } catch (e) {
    console.log('移除数据源失败:', e?.message || '未知错误')
  }
  return false
}

// 安全添加数据源的辅助函数
function safeAddDataSource(viewer, dataSource) {
  if (!viewer || !dataSource) return false
  try {
    // 检查是否已存在
    for (let i = 0; i < viewer.dataSources.length; i++) {
      if (viewer.dataSources.get(i) === dataSource) {
        return true // 已存在，视为成功
      }
    }
    viewer.dataSources.add(dataSource)
    return true
  } catch (e) {
    console.log('添加数据源失败:', e?.message || '未知错误')
    return false
  }
}

function resetView() {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(118.010, 36.920, 9000),
    orientation: {
      heading: Cesium.Math.toRadians(-180),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0
    },
    duration: 2
  })
}

function setRoadsVisible(visible) {
  if (!roadsDataSource && visible) {
    // 第一次开启时才加载道路数据
    loadRoads()
  }
  if (roadsDataSource) {
    roadsDataSource.show = !!visible
  }
}

async function loadRoads() {
  if (roadsLoaded || !viewer) return
  
  try {
    roadsDataSource = await Cesium.GeoJsonDataSource.load(
      '/data/roads_wgs.geojson',
      {
        stroke: Cesium.Color.fromCssColorString('#f97316'), // 橙色主干路
        strokeWidth: 4, //适当加粗线宽，提升可点击性
      }
    )
    viewer.dataSources.add(roadsDataSource)
    roadsLoaded = true

    // 为每条道路附加详情描述，点击线要素时在 infoBox 中展示
    roadsDataSource.entities.values.forEach((entity) => {
      const props = entity.properties
      if (!props) return

      const getVal = (p) => (p && p.getValue ? p.getValue(Cesium.JulianDate.now()) : p)

      // 名称：兼容 NAME / name / 道路名称
      const name =
        getVal(props.NAME || props.Name || props.name || props['道路名称']) || ''

      // 等级：兼容 LEVEL / level / 道路等级 / LEVEL_CODE
      const level =
        getVal(
          props.LEVEL ||
            props.Level ||
            props.level ||
            props['道路等级'] ||
            props.LEVEL_CODE
        ) || ''

      // 长度：兼容 LENGTH_KM / length_km / 道路长度
      const lengthKm = getVal(
        props.LENGTH_KM || props.Length_km || props.length_km || props['道路长度']
      )

      entity.description = `
        <table class="zw-table">
          <tr><th>道路名称</th><td>${name}</td></tr>
          <tr><th>道路等级</th><td>${level}</td></tr>
          <tr><th>长度</th><td>${
            typeof lengthKm === 'number' && !Number.isNaN(lengthKm)
              ? lengthKm.toFixed(3) + ' km'
              : '—'
          }</td></tr>
        </table>
      `
    })
  } catch (err) {
    console.error('加载道路数据失败', err)
  }
}

function setHeatmapVisible(visible, type = 'grid') {
  if (visible) {
    // 开启热力图时，总是重新加载以应用新类型
    loadHeatmap(type)
  } else if (heatmapDataSource) {
    // 关闭热力图时，隐藏数据源
    heatmapDataSource.show = false
  }
}

function distanceMeters(lon1, lat1, lon2, lat2) {
  const R = 6378137
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function getCoverageStats() {
  return coverageStats
}

function getAccessibilityStats() {
  return accessibilityStats
}

function getAccessibilityLoading() {
  return accessibilityLoading
}

function getIsochroneStats() {
  return isochroneStats
}

function getIsochroneLoading() {
  return isochroneLoading
}

function getEntityLonLat(entity) {
  if (!entity) return null

  // 1) properties 里直接带 longitude/latitude（如 userLocationMarker）
  try {
    const lonProp = entity?.properties?.longitude
    const latProp = entity?.properties?.latitude
    const hasLonLatProps = lonProp != null && latProp != null
    if (hasLonLatProps) {
      const now = Cesium.JulianDate.now()
      const lonVal = typeof lonProp?.getValue === 'function' ? lonProp.getValue(now) : lonProp
      const latVal = typeof latProp?.getValue === 'function' ? latProp.getValue(now) : latProp
      const lon = Number(lonVal)
      const lat = Number(latVal)
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { longitude: lon, latitude: lat }
    }
  } catch {
    // ignore
  }

  // 2) 从 entity.position 反推经纬度
  try {
    const pos = entity.position
    if (!pos) return null
    const now = Cesium.JulianDate.now()
    const cartesian = pos._value || (typeof pos.getValue === 'function' ? pos.getValue(now) : null)
    if (!cartesian) return null
    const cart = Cesium.Cartographic.fromCartesian(cartesian)
    if (!cart) return null
    const lon = Cesium.Math.toDegrees(cart.longitude)
    const lat = Cesium.Math.toDegrees(cart.latitude)
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { longitude: lon, latitude: lat }
    return null
  } catch {
    return null
  }
}

function setIsochroneOriginFromLonLat(lon, lat, { rerunIfActive = true } = {}) {
  if (!viewer) return
  const nextLon = Number(lon)
  const nextLat = Number(lat)
  if (!Number.isFinite(nextLon) || !Number.isFinite(nextLat)) {
    isochroneOrigin = null
    if (isochroneOriginMarker) {
      try {
        viewer.entities.remove(isochroneOriginMarker)
      } catch {
        // ignore
      }
    }
    isochroneOriginMarker = null
    return
  }

  const prev = isochroneOrigin
  const changed =
    !prev ||
    Math.abs(prev.longitude - nextLon) > 1e-7 ||
    Math.abs(prev.latitude - nextLat) > 1e-7

  isochroneOrigin = { longitude: nextLon, latitude: nextLat }

  if (!isochroneOriginMarker) {
    isochroneOriginMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(nextLon, nextLat, 80),
      point: {
        pixelSize: 14,
        color: Cesium.Color.MAGENTA.withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '等时圈起点',
        font: 'bold 12pt sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 18),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        type: 'isochroneOrigin',
      },
    })
  } else {
    isochroneOriginMarker.position = Cesium.Cartesian3.fromDegrees(nextLon, nextLat, 80)
  }

  if (rerunIfActive && isochroneActive && isochroneLastOptions && changed) {
    // 不 await：避免点击卡住；内部已用 runId/队列机制处理并发
    setIsochroneVisible(true, isochroneLastOptions)
  }

  // 只在“需要起点选择”的阶段监听用户点击；起点一旦确定就关闭拾取模式
  isochroneOriginPicking = false
}

function lonLatKey(lon, lat) {
  const x = Number(lon)
  const y = Number(lat)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // 精度控制：设施点是离散数据，做约束匹配
  return `${x.toFixed(5)}_${y.toFixed(5)}`
}

function clearTopArrivalHighlights() {
  if (!viewer) return
  if (!topArrivalHighlighted.size) return

  for (const [, v] of topArrivalHighlighted.entries()) {
    const entity = v.entity
    if (!entity || !entity.point) continue
    try {
      entity.point.pixelSize = v.pixelSize
      entity.point.color = v.color
      entity.point.outlineColor = v.outlineColor
      entity.point.outlineWidth = v.outlineWidth
    } catch {
      // ignore
    }
  }
  topArrivalHighlighted.clear()
}

function highlightTopArrivalFacilities(topArrivals, lineColors) {
  if (!viewer || !Array.isArray(topArrivals) || !topArrivals.length) return

  // 构建：设施点实体索引（按经纬度 key）
  const entityByKey = new Map()
  for (const e of viewer.entities.values) {
    if (!e || !e.point || !e.position) continue
    // 设施点才有 category（避免高亮起点/量测点/其它标记）
    if (!e.properties || !e.properties.category) continue
    try {
      const p = e.position._value || (typeof e.position.getValue === 'function' ? e.position.getValue(Cesium.JulianDate.now()) : null)
      if (!p) continue
      const cart = Cesium.Cartographic.fromCartesian(p)
      if (!cart) continue
      const lon = Cesium.Math.toDegrees(cart.longitude)
      const lat = Cesium.Math.toDegrees(cart.latitude)
      const k = lonLatKey(lon, lat)
      if (k) entityByKey.set(k, e)
    } catch {
      // ignore
    }
  }

  clearTopArrivalHighlights()

  topArrivals.forEach((item, idx) => {
    const k = lonLatKey(item.longitude, item.latitude)
    if (!k) return
    const entity = entityByKey.get(k)
    if (!entity || !entity.point) return

    if (!topArrivalHighlighted.has(k)) {
      topArrivalHighlighted.set(k, {
        entity,
        pixelSize: entity.point.pixelSize,
        color: entity.point.color,
        outlineColor: entity.point.outlineColor,
        outlineWidth: entity.point.outlineWidth,
      })
    }

    const rank = idx + 1
    const c = Cesium.Color.fromCssColorString(lineColors[idx % lineColors.length]).withAlpha(1.0)
    const pixelSize = Math.max(14, 22 - rank * 2) // Top1最大，逐级减小

    entity.point.pixelSize = pixelSize
    entity.point.color = c
    entity.point.outlineColor = Cesium.Color.WHITE
    entity.point.outlineWidth = 4
  })
}

async function runWithConcurrency(taskFns, maxConcurrent = 3) {
  const results = new Array(taskFns.length)
  let cursor = 0

  const workers = Array.from({ length: Math.max(1, maxConcurrent) }, async () => {
    while (true) {
      const current = cursor
      cursor += 1
      if (current >= taskFns.length) break
      try {
        results[current] = await taskFns[current]()
      } catch (err) {
        results[current] = { ok: false, error: err }
      }
    }
  })

  await Promise.all(workers)
  return results
}

// 坐标转换：将 WGS84(常见 Cesium 经度纬度体系)转为 GCJ-02（高德默认坐标体系）
function wgs84ToGcj02(lng, lat) {
  const a = 6378245.0
  const ee = 0.00669342162296594323
  const pi = 3.14159265358979324

  if (outOfChina(lng, lat)) return { lng, lat }

  let dlat = transformLat(lng - 105.0, lat - 35.0)
  let dlng = transformLng(lng - 105.0, lat - 35.0)
  const radlat = (lat / 180.0) * pi
  const magic = Math.sin(radlat)
  const magic2 = 1 - ee * magic * magic
  const sqrtmagic = Math.sqrt(magic2)

  dlat = (dlat * 180.0) / (((a * (1 - ee)) / (magic2 * sqrtmagic)) * pi)
  dlng = (dlng * 180.0) / ((a / sqrtmagic) * Math.cos(radlat) * pi)

  const mglat = lat + dlat
  const mglng = lng + dlng
  return { lng: mglng, lat: mglat }
}

function outOfChina(lng, lat) {
  return (
    lng < 72.004 ||
    lng > 137.8347 ||
    lat < 0.8293 ||
    lat > 55.8271
  )
}

// 根据起点、距离(米)、方位角(弧度)计算目标点经纬度（近似球面）
function destinationLonLat(lon, lat, distanceMeters, bearingRad) {
  const R = 6378137
  const δ = distanceMeters / R
  const φ1 = (lat * Math.PI) / 180
  const λ1 = (lon * Math.PI) / 180
  const sinφ1 = Math.sin(φ1)
  const cosφ1 = Math.cos(φ1)

  const sinδ = Math.sin(δ)
  const cosδ = Math.cos(δ)

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(bearingRad)
  const φ2 = Math.asin(sinφ2)

  const y = Math.sin(bearingRad) * sinδ * cosφ1
  const x = cosδ - sinφ1 * sinφ2
  const λ2 = λ1 + Math.atan2(y, x)

  return { lon: (λ2 * 180) / Math.PI, lat: (φ2 * 180) / Math.PI }
}

function transformLat(lng, lat) {
  const pi = 3.14159265358979324
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * pi) + 40.0 * Math.sin((lat / 3.0) * pi)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * pi) + 320 * Math.sin((lat * pi) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(lng, lat) {
  const pi = 3.14159265358979324
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * pi) + 40.0 * Math.sin((lng / 3.0) * pi)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * pi) + 300.0 * Math.sin((lng / 30.0) * pi)) * 2.0) / 3.0
  return ret
}

async function getWalkingDurationSeconds(fromLon, fromLat, toLon, toLat) {
  if (typeof window === 'undefined') {
    // SSR/非浏览器环境直接使用估算
    return distanceMeters(fromLon, fromLat, toLon, toLat) * 0.75
  }

  const cacheKey = [
    Number(fromLon).toFixed(5),
    Number(fromLat).toFixed(5),
    Number(toLon).toFixed(5),
    Number(toLat).toFixed(5),
  ].join('_')
  if (walkingDurationCache.has(cacheKey)) return walkingDurationCache.get(cacheKey)

  // 步行速度近似：80m/分钟 -> 1m 约 0.75 秒
  const fallbackSec = Math.max(0, distanceMeters(fromLon, fromLat, toLon, toLat) * 0.75)

  // 高德步行接口默认坐标为 GCJ-02，所以这里按 WGS84->GCJ-02 做转换（Cesium 经纬度通常是 WGS84）
  const startGcj = wgs84ToGcj02(fromLon, fromLat)
  const endGcj = wgs84ToGcj02(toLon, toLat)

  const callbackName = `walking_dur_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const seconds = await new Promise((resolve) => {
    let done = false
    let scriptEl = null

    const cleanup = () => {
      if (done) return
      done = true
      try {
        // 删除回调，避免内存泄漏
        delete window[callbackName]
      } catch {
        // ignore
      }
      try {
        // 清理 script 节点，避免 JSONP 反复请求导致 DOM 不断累积
        if (scriptEl && scriptEl.parentNode) {
          scriptEl.parentNode.removeChild(scriptEl)
        }
      } catch {
        // ignore
      }
    }

    window[callbackName] = (data) => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }

      try {
        if (
          data &&
          data.status === '1' &&
          data.route &&
          Array.isArray(data.route.paths) &&
          data.route.paths[0]
        ) {
          const parsed = Number(data.route.paths[0].duration)
          resolve(Number.isFinite(parsed) ? parsed : fallbackSec)
          return
        }
      } catch {
        // ignore
      }

      resolve(fallbackSec)
    }

    const url = `https://restapi.amap.com/v3/direction/walking?key=${AMAP_DIRECTION_KEY}` +
      `&origin=${startGcj.lng},${startGcj.lat}&destination=${endGcj.lng},${endGcj.lat}` +
      `&output=json&callback=${callbackName}`

    try {
      scriptEl = document.createElement('script')
      scriptEl.src = url
      scriptEl.async = true
      scriptEl.onerror = () => {
        cleanup()
        resolve(fallbackSec)
      }
      document.head.appendChild(scriptEl)
    } catch {
      cleanup()
      resolve(fallbackSec)
    }

    // 超时后回落到直线距离估算，避免请求失败导致等待太久
    setTimeout(() => {
      if (done) return
      cleanup()
      resolve(fallbackSec)
    }, 3000)
  })

  setCacheWithLimit(walkingDurationCache, cacheKey, seconds, walkingDurationCacheMax)
  return seconds
}

async function getWalkingRouteInfoSecondsDistanceMeters(fromLon, fromLat, toLon, toLat) {
  if (typeof window === 'undefined') {
    const dist = distanceMeters(fromLon, fromLat, toLon, toLat)
    return { durationSec: dist * 0.75, distanceMeters: dist }
  }

  const cacheKey = [
    'walking',
    Number(fromLon).toFixed(5),
    Number(fromLat).toFixed(5),
    Number(toLon).toFixed(5),
    Number(toLat).toFixed(5),
  ].join('_')
  if (walkingRouteInfoCache.has(cacheKey)) return walkingRouteInfoCache.get(cacheKey)

  const fallbackDist = Math.max(0, distanceMeters(fromLon, fromLat, toLon, toLat))
  const fallbackSec = fallbackDist * 0.75

  const startGcj = wgs84ToGcj02(fromLon, fromLat)
  const endGcj = wgs84ToGcj02(toLon, toLat)

  const callbackName = `walking_route_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const info = await new Promise((resolve) => {
    let done = false
    let scriptEl = null

    const cleanup = () => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }
      try {
        // 清理 script 节点，避免 JSONP 反复请求导致 DOM 不断累积
        if (scriptEl && scriptEl.parentNode) {
          scriptEl.parentNode.removeChild(scriptEl)
        }
      } catch {
        // ignore
      }
    }

    window[callbackName] = (data) => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }

      try {
        if (
          data &&
          data.status === '1' &&
          data.route &&
          Array.isArray(data.route.paths) &&
          data.route.paths[0]
        ) {
          const path = data.route.paths[0]
          const durParsed = Number(path.duration)
          const distParsed = Number(path.distance)
          resolve({
            durationSec: Number.isFinite(durParsed) ? durParsed : fallbackSec,
            distanceMeters: Number.isFinite(distParsed) ? distParsed : fallbackDist,
          })
          return
        }
      } catch {
        // ignore
      }

      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }

    const url =
      `https://restapi.amap.com/v3/direction/walking?key=${AMAP_DIRECTION_KEY}` +
      `&origin=${startGcj.lng},${startGcj.lat}&destination=${endGcj.lng},${endGcj.lat}` +
      `&output=json&callback=${callbackName}`

    try {
      scriptEl = document.createElement('script')
      scriptEl.src = url
      scriptEl.async = true
      scriptEl.onerror = () => {
        cleanup()
        resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
      }
      document.head.appendChild(scriptEl)
    } catch {
      cleanup()
      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }

    setTimeout(() => {
      if (done) return
      cleanup()
      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }, 3000)
  })

  setCacheWithLimit(walkingRouteInfoCache, cacheKey, info, walkingRouteInfoCacheMax)
  return info
}

async function getDrivingDurationSeconds(fromLon, fromLat, toLon, toLat) {
  if (typeof window === 'undefined') {
    // 估算：驾车速度近似更高，时间更短
    return distanceMeters(fromLon, fromLat, toLon, toLat) * 0.25
  }

  const cacheKey = [
    'driving',
    Number(fromLon).toFixed(5),
    Number(fromLat).toFixed(5),
    Number(toLon).toFixed(5),
    Number(toLat).toFixed(5),
  ].join('_')
  if (drivingDurationCache.has(cacheKey)) return drivingDurationCache.get(cacheKey)

  const fallbackSec = Math.max(0, distanceMeters(fromLon, fromLat, toLon, toLat) * 0.25) // 约 240m/min

  const startGcj = wgs84ToGcj02(fromLon, fromLat)
  const endGcj = wgs84ToGcj02(toLon, toLat)

  const callbackName = `driving_dur_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const seconds = await new Promise((resolve) => {
    let done = false
    let scriptEl = null

    const cleanup = () => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }
      try {
        // 清理 script 节点，避免 JSONP 反复请求导致 DOM 不断累积
        if (scriptEl && scriptEl.parentNode) {
          scriptEl.parentNode.removeChild(scriptEl)
        }
      } catch {
        // ignore
      }
    }

    window[callbackName] = (data) => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }

      try {
        if (
          data &&
          data.status === '1' &&
          data.route &&
          Array.isArray(data.route.paths) &&
          data.route.paths[0]
        ) {
          const parsed = Number(data.route.paths[0].duration)
          resolve(Number.isFinite(parsed) ? parsed : fallbackSec)
          return
        }
      } catch {
        // ignore
      }
      resolve(fallbackSec)
    }

    const url =
      `https://restapi.amap.com/v3/direction/driving?key=${AMAP_DIRECTION_KEY}` +
      `&origin=${startGcj.lng},${startGcj.lat}&destination=${endGcj.lng},${endGcj.lat}` +
      `&output=json&callback=${callbackName}`

    try {
      scriptEl = document.createElement('script')
      scriptEl.src = url
      scriptEl.async = true
      scriptEl.onerror = () => {
        cleanup()
        resolve(fallbackSec)
      }
      document.head.appendChild(scriptEl)
    } catch {
      cleanup()
      resolve(fallbackSec)
    }

    setTimeout(() => {
      if (done) return
      cleanup()
      resolve(fallbackSec)
    }, 3000)
  })

  setCacheWithLimit(drivingDurationCache, cacheKey, seconds, drivingDurationCacheMax)
  return seconds
}

async function getDrivingRouteInfoSecondsDistanceMeters(fromLon, fromLat, toLon, toLat) {
  if (typeof window === 'undefined') {
    const dist = distanceMeters(fromLon, fromLat, toLon, toLat)
    return { durationSec: dist * 0.25, distanceMeters: dist }
  }

  const cacheKey = [
    'driving',
    Number(fromLon).toFixed(5),
    Number(fromLat).toFixed(5),
    Number(toLon).toFixed(5),
    Number(toLat).toFixed(5),
  ].join('_')
  if (drivingRouteInfoCache.has(cacheKey)) return drivingRouteInfoCache.get(cacheKey)

  const fallbackDist = Math.max(0, distanceMeters(fromLon, fromLat, toLon, toLat))
  const fallbackSec = fallbackDist * 0.25

  const startGcj = wgs84ToGcj02(fromLon, fromLat)
  const endGcj = wgs84ToGcj02(toLon, toLat)

  const callbackName = `driving_route_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const info = await new Promise((resolve) => {
    let done = false
    let scriptEl = null

    const cleanup = () => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }
      try {
        // 清理 script 节点，避免 JSONP 反复请求导致 DOM 不断累积
        if (scriptEl && scriptEl.parentNode) {
          scriptEl.parentNode.removeChild(scriptEl)
        }
      } catch {
        // ignore
      }
    }

    window[callbackName] = (data) => {
      if (done) return
      done = true
      try {
        delete window[callbackName]
      } catch {
        // ignore
      }

      try {
        if (
          data &&
          data.status === '1' &&
          data.route &&
          Array.isArray(data.route.paths) &&
          data.route.paths[0]
        ) {
          const path = data.route.paths[0]
          const durParsed = Number(path.duration)
          const distParsed = Number(path.distance)
          resolve({
            durationSec: Number.isFinite(durParsed) ? durParsed : fallbackSec,
            distanceMeters: Number.isFinite(distParsed) ? distParsed : fallbackDist,
          })
          return
        }
      } catch {
        // ignore
      }

      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }

    const url =
      `https://restapi.amap.com/v3/direction/driving?key=${AMAP_DIRECTION_KEY}` +
      `&origin=${startGcj.lng},${startGcj.lat}&destination=${endGcj.lng},${endGcj.lat}` +
      `&output=json&callback=${callbackName}`

    try {
      scriptEl = document.createElement('script')
      scriptEl.src = url
      scriptEl.async = true
      scriptEl.onerror = () => {
        cleanup()
        resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
      }
      document.head.appendChild(scriptEl)
    } catch {
      cleanup()
      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }

    setTimeout(() => {
      if (done) return
      cleanup()
      resolve({ durationSec: fallbackSec, distanceMeters: fallbackDist })
    }, 3000)
  })

  setCacheWithLimit(drivingRouteInfoCache, cacheKey, info, drivingRouteInfoCacheMax)
  return info
}

async function setCoverageVisible(visible, options = {}) {
  if (!viewer) return

  coverageActive = !!visible

  if (!visible) {
    coveragePendingOptions = null
    coverageInFlight = false
    coverageStats = null
    if (coverageDataSource) {
      safeRemoveDataSource(viewer, coverageDataSource)
      coverageDataSource = null
    }
    return null
  }

  if (coverageInFlight) {
    coveragePendingOptions = options
    coverageStats = null
    if (coverageDataSource) coverageDataSource.show = false
    // 等待当前分析链条结束（包含后续 pending），避免 MapView 过早读取 stats
    return new Promise((resolve) => {
      const start = Date.now()
      const check = () => {
        if (!coverageInFlight && coverageStats) return resolve(coverageStats)
        if (Date.now() - start > 60000) return resolve(coverageStats || null)
        setTimeout(check, 200)
      }
      check()
    })
  }

  coverageInFlight = true
  const runId = ++coverageRunId
  coverageStats = null

  const radiusMeters = Number(options.radiusMeters) || 1000
  const selectedCategories = Array.isArray(options.categories)
    ? options.categories.filter(Boolean)
    : [options.category || 'all']
  const useAllCategories = selectedCategories.includes('all')
  const gridSizeDeg = Number(options.gridSizeDeg) || 0.0045 // 约500m网格

  try {
    if (coverageDataSource) {
      safeRemoveDataSource(viewer, coverageDataSource)
      coverageDataSource = null
    }

    const res = await axios.get(`${API_BASE}/facilities`)

    // 请求期间用户关闭/切换：丢弃本轮结果
    if (!coverageActive || runId !== coverageRunId) return null

    const facilities = Array.isArray(res.data) ? res.data : []
    const filtered = facilities.filter((f) => {
      const lon = Number(f.longitude ?? f.lon)
      const lat = Number(f.latitude ?? f.lat)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
      if (useAllCategories) return true
      return selectedCategories.includes(normalizeCategory(f.type))
    })

    if (filtered.length === 0) {
      coverageStats = {
        totalGridCount: 0,
        coveredGridCount: 0,
        uncoveredGridCount: 0,
        coverageRate: 0,
        radiusMeters,
        categories: useAllCategories ? ['all'] : selectedCategories,
        facilityCount: 0,
      }
      return
    }

    // 视觉优化：默认按“设施分布范围 + 服务半径缓冲”做分析，避免固定大方框导致大片红区难看
    const autoBounds = (() => {
      let minLon = Infinity
      let maxLon = -Infinity
      let minLat = Infinity
      let maxLat = -Infinity
      filtered.forEach((f) => {
        const lon = Number(f.longitude ?? f.lon)
        const lat = Number(f.latitude ?? f.lat)
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })

      // 米转经纬度近似：1度纬度约111320m，经度按当前纬度缩放
      const centerLat = (minLat + maxLat) / 2
      const latDegPad = radiusMeters / 111320
      const lonDegPad = radiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180))
      const pad = Math.max(gridSizeDeg, latDegPad, lonDegPad)

      return {
        minLon: minLon - pad,
        maxLon: maxLon + pad,
        minLat: minLat - pad,
        maxLat: maxLat + pad,
      }
    })()

    const bounds = options.bounds || autoBounds

    coverageDataSource = new Cesium.CustomDataSource('service-coverage')

    let coveredCount = 0
    let uncoveredCount = 0
    const gridCountLon = Math.ceil((bounds.maxLon - bounds.minLon) / gridSizeDeg)
    const gridCountLat = Math.ceil((bounds.maxLat - bounds.minLat) / gridSizeDeg)
    for (let ix = 0; ix < gridCountLon; ix++) {
      for (let iy = 0; iy < gridCountLat; iy++) {
        const minLon = bounds.minLon + ix * gridSizeDeg
        const minLat = bounds.minLat + iy * gridSizeDeg
        const maxLon = Math.min(minLon + gridSizeDeg, bounds.maxLon)
        const maxLat = Math.min(minLat + gridSizeDeg, bounds.maxLat)
        const centerLon = (minLon + maxLon) / 2
        const centerLat = (minLat + maxLat) / 2

        let isCovered = false
        for (const f of filtered) {
          const flon = Number(f.longitude ?? f.lon)
          const flat = Number(f.latitude ?? f.lat)
          if (distanceMeters(centerLon, centerLat, flon, flat) <= radiusMeters) {
            isCovered = true
            break
          }
        }

        if (isCovered) coveredCount++
        else uncoveredCount++

        coverageDataSource.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
            material: isCovered
              ? Cesium.Color.fromCssColorString('#16a34a').withAlpha(0.5)
              : Cesium.Color.fromCssColorString('#dc2626').withAlpha(0.58),
            outline: true,
            outlineColor: isCovered
              ? Cesium.Color.fromCssColorString('#bbf7d0').withAlpha(0.55)
              : Cesium.Color.fromCssColorString('#fecaca').withAlpha(0.22),
            height: 0,
          },
          properties: {
            type: 'coverageGrid',
            covered: isCovered,
          },
          description: `
            <table class="zw-table">
              <tr><th>服务覆盖</th><td>${isCovered ? '已覆盖' : '盲区'}</td></tr>
              <tr><th>半径参数</th><td>${radiusMeters}m</td></tr>
              <tr><th>网格中心</th><td>${centerLon.toFixed(4)}, ${centerLat.toFixed(4)}</td></tr>
            </table>
          `,
        })

        // 支持关闭/切换丢弃本轮结果：每处理一定网格就检查一次
        if ((iy + ix * gridCountLat) % 200 === 0) {
          if (!coverageActive || runId !== coverageRunId) return null
        }
      }
    }

    coverageStats = {
      totalGridCount: coveredCount + uncoveredCount,
      coveredGridCount: coveredCount,
      uncoveredGridCount: uncoveredCount,
      coverageRate: coveredCount + uncoveredCount > 0 ? coveredCount / (coveredCount + uncoveredCount) : 0,
      radiusMeters,
      categories: useAllCategories ? ['all'] : selectedCategories,
      facilityCount: filtered.length,
    }

    // 检查是否已存在，避免重复添加
    let alreadyAdded = false
    for (let i = 0; i < viewer.dataSources.length; i++) {
      if (viewer.dataSources.get(i) === coverageDataSource) {
        alreadyAdded = true
        break
      }
    }
    if (!alreadyAdded) {
      viewer.dataSources.add(coverageDataSource)
    }
    // 降低层级，只有添加成功后才执行
    try {
      if (coverageDataSource) {
        viewer.dataSources.lower(coverageDataSource)
      }
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.error('服务范围分析加载失败', err)
    coverageStats = null
  } finally {
    coverageInFlight = false
    // 如果分析过程中用户又触发了 pending（并且当前仍开启），继续跑最后一次
    if (coverageActive && coveragePendingOptions) {
      const pending = coveragePendingOptions
      coveragePendingOptions = null
      return await setCoverageVisible(true, pending)
    }
  }
}

async function setAccessibilityVisible(visible, options = {}) {
  if (!viewer) return

  accessibilityActive = !!visible

  if (!visible) {
    accessibilityPendingOptions = null
    if (accessibilityDataSource) accessibilityDataSource.show = false
    accessibilityLoading = false
    return null
  }

  // 若当前仍在跑上一次分析，只记录最后一次参数，避免并发导致 Cesium 渲染崩溃
  if (accessibilityInFlight) {
    accessibilityPendingOptions = options
    // 立刻隐藏旧结果，避免用户切换类型期间“看起来在叠加”
    if (accessibilityDataSource) accessibilityDataSource.show = false
    accessibilityStats = null
    // 等待当前分析链条结束（包含后续 pending），避免 MapView 过早读取 stats 导致“没效果”
    return new Promise((resolve) => {
      const start = Date.now()
      const waitBaseRunId = accessibilityRunId
      const check = () => {
        // 只要“分析完成”且 stats 已写入，就认为这次类型切换最终有结果。
        // 这样避免等待条件过于严格导致 accessibilityStats 一直是 null。
        if (!accessibilityInFlight && accessibilityStats) {
          return resolve(accessibilityStats)
        }
        if (Date.now() - start > 60000) return resolve(accessibilityStats || null) // 最长等待 60s，避免永久卡死
        setTimeout(check, 200)
      }
      check()
    })
  }

  accessibilityInFlight = true
  accessibilityLoading = true
  const runId = ++accessibilityRunId

  const timeThresholdMinutes = Number(options.timeThresholdMinutes) || 15
  const timeThresholdSeconds = timeThresholdMinutes * 60
  const selectedCategories = Array.isArray(options.categories)
    ? options.categories.filter(Boolean)
    : [options.category || 'all']
  const useAllCategories = selectedCategories.includes('all')
  // 可达性分析更容易请求很多次：默认网格取更粗一些，避免页面长时间“无响应”
  const gridSizeDeg = Number(options.gridSizeDeg) || 0.009 // 约1km网格
  const candidateFacilityLimit = Number(options.candidateFacilityLimit) || 3

  // 用于生成分析范围：假设步行速度约 80m/分钟（8km/h），用于把“时间阈值”近似转换成“距离缓冲”
  const approxRadiusMeters = Number(options.approxRadiusMeters) || Math.max(300, timeThresholdMinutes * 80)

  try {
    if (accessibilityDataSource) {
      // 只有当确实存在于 dataSources 集合时才 remove，避免 Cesium DeveloperError
      try {
        viewer.dataSources.remove(accessibilityDataSource)
      } catch (e) {
        // 忽略：not in this collection 等异常
      }
      accessibilityDataSource = null
    }

    const res = await axios.get(`${API_BASE}/facilities`)
    const facilities = Array.isArray(res.data) ? res.data : []
    const filtered = facilities.filter((f) => {
      const lon = Number(f.longitude ?? f.lon)
      const lat = Number(f.latitude ?? f.lat)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
      if (useAllCategories) return true
      return selectedCategories.includes(normalizeCategory(f.type))
    })

    if (filtered.length === 0) {
      accessibilityStats = {
        totalGridCount: 0,
        coveredGridCount: 0,
        uncoveredGridCount: 0,
        coverageRate: 0,
        timeThresholdMinutes,
        categories: useAllCategories ? ['all'] : selectedCategories,
        facilityCount: 0,
        mode: 'walking-time',
      }
      return accessibilityStats
    }

    const autoBounds = (() => {
      let minLon = Infinity
      let maxLon = -Infinity
      let minLat = Infinity
      let maxLat = -Infinity
      filtered.forEach((f) => {
        const lon = Number(f.longitude ?? f.lon)
        const lat = Number(f.latitude ?? f.lat)
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })

      const centerLat = (minLat + maxLat) / 2
      const latDegPad = approxRadiusMeters / 111320
      const lonDegPad = approxRadiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180))
      const pad = Math.max(gridSizeDeg, latDegPad, lonDegPad)

      return {
        minLon: minLon - pad,
        maxLon: maxLon + pad,
        minLat: minLat - pad,
        maxLat: maxLat + pad,
      }
    })()

    const bounds = options.bounds || autoBounds

    accessibilityDataSource = new Cesium.CustomDataSource('accessibility-coverage')

    let coveredCount = 0
    let uncoveredCount = 0
    const gridCountLon = Math.ceil((bounds.maxLon - bounds.minLon) / gridSizeDeg)
    const gridCountLat = Math.ceil((bounds.maxLat - bounds.minLat) / gridSizeDeg)

    const grids = []
    for (let ix = 0; ix < gridCountLon; ix++) {
      for (let iy = 0; iy < gridCountLat; iy++) {
        const minLon = bounds.minLon + ix * gridSizeDeg
        const minLat = bounds.minLat + iy * gridSizeDeg
        const maxLon = Math.min(minLon + gridSizeDeg, bounds.maxLon)
        const maxLat = Math.min(minLat + gridSizeDeg, bounds.maxLat)
        const centerLon = (minLon + maxLon) / 2
        const centerLat = (minLat + maxLat) / 2
        grids.push({ minLon, minLat, maxLon, maxLat, centerLon, centerLat })
      }
    }

    const tasks = grids.map((g) => async () => {
      // 先用直线距离找少量候选设施，减少路径规划请求次数
      const maxCandidateDist = approxRadiusMeters * 1.3
      const nearest = filtered
        .map((f) => {
          const lon = Number(f.longitude ?? f.lon)
          const lat = Number(f.latitude ?? f.lat)
          return { f, dist: distanceMeters(g.centerLon, g.centerLat, lon, lat) }
        })
        .filter((item) => item.dist <= maxCandidateDist)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, Math.max(1, candidateFacilityLimit))

      if (nearest.length === 0) {
        return {
          ...g,
          isCovered: false,
          durationSec: null,
        }
      }

      // 网格缓存：同一网格中心 + 阈值 + 候选设施集合 -> 直接复用
      const candidateKey = nearest
        .map((item) => {
          const lon = Number(item.f.longitude ?? item.f.lon)
          const lat = Number(item.f.latitude ?? item.f.lat)
          return `${lon.toFixed(5)},${lat.toFixed(5)}`
        })
        .join('|')

      const gridCacheKey = `${timeThresholdSeconds}_${g.centerLon.toFixed(5)}_${g.centerLat.toFixed(5)}_${candidateKey}`
      const cached = accessibilityGridCache.get(gridCacheKey)
      if (cached) {
        return { ...g, ...cached }
      }

      let minDurationSec = Number.POSITIVE_INFINITY
      for (const item of nearest) {
        const lon = Number(item.f.longitude ?? item.f.lon)
        const lat = Number(item.f.latitude ?? item.f.lat)
        const sec = await getWalkingDurationSeconds(g.centerLon, g.centerLat, lon, lat)
        if (sec < minDurationSec) minDurationSec = sec
        if (sec <= timeThresholdSeconds) {
          const result = { isCovered: true, durationSec: sec }
          setCacheWithLimit(accessibilityGridCache, gridCacheKey, result, accessibilityGridCacheMax)
          return { ...g, ...result }
        }
      }

      const result = {
        isCovered: Number.isFinite(minDurationSec) ? minDurationSec <= timeThresholdSeconds : false,
        durationSec: Number.isFinite(minDurationSec) ? minDurationSec : null,
      }
      setCacheWithLimit(accessibilityGridCache, gridCacheKey, result, accessibilityGridCacheMax)
      return { ...g, ...result }
    })

    const resolved = await runWithConcurrency(tasks, AMAP_ROUTE_CONCURRENCY)

    // 若期间用户切换了类型/关闭了图层，本次结果直接丢弃，避免 Cesium 更新冲突
    if (!accessibilityActive || runId !== accessibilityRunId) return

    for (let i = 0; i < resolved.length; i++) {
      if (!accessibilityActive || runId !== accessibilityRunId) return null

      const item = resolved[i]
      if (!item) continue

      const hasFiniteCoords =
        Number.isFinite(item.minLon) &&
        Number.isFinite(item.minLat) &&
        Number.isFinite(item.maxLon) &&
        Number.isFinite(item.maxLat) &&
        Number.isFinite(item.centerLon) &&
        Number.isFinite(item.centerLat)

      if (!hasFiniteCoords) {
        // 发生任务失败/异常时，跳过该网格，避免 Cesium 内部渲染时报错
        continue
      }

      const isCovered = !!item.isCovered
      if (isCovered) coveredCount++
      else uncoveredCount++

      const durationText =
        typeof item.durationSec === 'number' ? `${Math.round(item.durationSec / 60)} 分钟` : '—'

      accessibilityDataSource.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(item.minLon, item.minLat, item.maxLon, item.maxLat),
          material: isCovered
            ? Cesium.Color.fromCssColorString('#16a34a').withAlpha(0.5)
            : Cesium.Color.fromCssColorString('#dc2626').withAlpha(0.58),
          outline: true,
          outlineColor: isCovered
            ? Cesium.Color.fromCssColorString('#bbf7d0').withAlpha(0.55)
            : Cesium.Color.fromCssColorString('#fecaca').withAlpha(0.22),
          height: 0,
        },
        properties: {
          type: 'accessibilityGrid',
          covered: isCovered,
          timeThresholdMinutes,
          durationSec: item.durationSec ?? null,
        },
        description: `
            <table class="zw-table">
              <tr><th>可达性</th><td>${isCovered ? '已可达' : '不可达'}</td></tr>
              <tr><th>阈值</th><td>${timeThresholdMinutes} 分钟</td></tr>
              <tr><th>最短步行时长</th><td>${durationText}</td></tr>
              <tr><th>网格中心</th><td>${item.centerLon.toFixed(4)}, ${item.centerLat.toFixed(4)}</td></tr>
            </table>
          `,
      })
    }

    accessibilityStats = {
      totalGridCount: coveredCount + uncoveredCount,
      coveredGridCount: coveredCount,
      uncoveredGridCount: uncoveredCount,
      coverageRate: coveredCount + uncoveredCount > 0 ? coveredCount / (coveredCount + uncoveredCount) : 0,
      timeThresholdMinutes,
      categories: useAllCategories ? ['all'] : selectedCategories,
      facilityCount: filtered.length,
      mode: 'walking-time',
    }

    try {
      viewer.dataSources.add(accessibilityDataSource)
      viewer.dataSources.lower(accessibilityDataSource)
    } catch (e) {
      // 即使图层 add/lower 失败，矩形实体仍可能已经渲染；这里不清空统计，避免“只渲染不出统计”
      console.warn('accessibility dataSource add/lower failed:', e)
    }

    return accessibilityStats
  } catch (err) {
    console.error('可达性分析加载失败', err)
    // 若统计已计算出来（例如 add/lower 失败），保留 stats 返回
    return accessibilityStats || null
  } finally {
    // 如果分析过程中用户又切换了参数，立即用最新参数再跑一次
    // 注意：不要在 pending 触发期间把 accessibilityInFlight 置为 false，
    // 否则等待中的 Promise 会过早结束，导致 MapView “不显示结果”。
    if (accessibilityActive && accessibilityPendingOptions) {
      const pending = accessibilityPendingOptions
      accessibilityPendingOptions = null
      // 允许下一轮分析启动；同时等待中的 Promise 会因为 runId 未变化而不会提前 resolve
      accessibilityInFlight = false
      return await setAccessibilityVisible(true, pending)
    }

    accessibilityInFlight = false
    accessibilityLoading = false
  }
}

async function setIsochroneVisible(visible, options = {}) {
  if (!viewer) return null

  isochroneActive = !!visible
  if (isochroneActive) isochroneLastOptions = options

  if (!visible) {
    isochronePendingOptions = null
    isochroneOriginPicking = false
    // 清除起点，下次打开时可以重新点击设置
    isochroneOrigin = null
    if (isochroneOriginMarker) {
      try {
        viewer.entities.remove(isochroneOriginMarker)
      } catch {
        // ignore
      }
      isochroneOriginMarker = null
    }
    if (isochroneDataSource) {
      try {
        isochroneDataSource.show = false
      } catch (e) {
        // ignore
      }
    }
    if (isochroneConnectorDataSource) {
      try {
        viewer.dataSources.remove(isochroneConnectorDataSource)
      } catch {
        // ignore
      }
      isochroneConnectorDataSource = null
    }
    clearTopArrivalHighlights()
    isochroneStats = null
    isochroneLoading = false
    return null
  }

  // 起点选择规则（按你的要求）：
  // - 打开等时圈开关后，如果已经定位成功，则默认用定位点（优先级最高），不需要点击确定起点
  // - 如果尚未定位成功，则等待用户点击地图来确定起点，再生成等时圈
  // 这里用“是否存在有效的 userLocationMarker 坐标”来判断定位是否成功。
  try {
    const userPos = getEntityLonLat(userLocationMarker)
    const hasUserPos = !!userPos && Number.isFinite(userPos.longitude) && Number.isFinite(userPos.latitude)
    const hasExplicitOrigin =
      !!isochroneOrigin && Number.isFinite(isochroneOrigin.longitude) && Number.isFinite(isochroneOrigin.latitude)
    
    // 开关开启但既没有定位点也没有已有起点：先不跑等时圈，等待点击确定起点
    if (!hasUserPos && !hasExplicitOrigin) {
      isochroneOriginPicking = true
      isochroneInFlight = false
      isochroneLoading = false
      isochroneStats = null
      return null
    }

    // 已有定位点：同步可视化起点标记（不触发重新分析）
    if (hasUserPos && !hasExplicitOrigin) {
      setIsochroneOriginFromLonLat(userPos.longitude, userPos.latitude, { rerunIfActive: false })
    }

    isochroneOriginPicking = false
  } catch {
    // ignore：不影响后续等时圈生成
  }

  if (isochroneInFlight) {
    isochronePendingOptions = options
    isochroneStats = null
    if (isochroneDataSource) isochroneDataSource.show = false
    // 切换步行/驾车等参数时：旧的“起点到Top设施”连线应立即移除
    if (isochroneConnectorDataSource) {
      try {
        viewer.dataSources.remove(isochroneConnectorDataSource)
      } catch {
        // ignore
      }
      isochroneConnectorDataSource = null
    }
    // 同时清理旧 Top 点高亮，避免等驾车完成前仍显示旧结果
    clearTopArrivalHighlights()
    return new Promise((resolve) => {
      const start = Date.now()
      const check = () => {
        if (!isochroneInFlight && isochroneStats) return resolve(isochroneStats)
        if (Date.now() - start > 60000) return resolve(isochroneStats || null)
        setTimeout(check, 200)
      }
      check()
    })
  }

  isochroneInFlight = true
  isochroneLoading = true
  const runId = ++isochroneRunId

  const timeThresholdsMinutes = Array.isArray(options.timeThresholdsMinutes)
    ? options.timeThresholdsMinutes.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : [10, 15, 20]

  const timeThresholdsSeconds = timeThresholdsMinutes.map((m) => m * 60)
  const minSec = timeThresholdsSeconds[0]
  const midSec = timeThresholdsSeconds[1]
  const maxSec = timeThresholdsSeconds[timeThresholdsSeconds.length - 1]

  const selectedCategories = Array.isArray(options.categories)
    ? options.categories.filter(Boolean)
    : [options.category || 'all']
  const useAllCategories = selectedCategories.includes('all')

  const candidateFacilityLimit = Number(options.candidateFacilityLimit) || 3
  const gridSizeDeg = Number(options.gridSizeDeg) || 0.009
  const approxRadiusMeters = Number(options.approxRadiusMeters) || timeThresholdsMinutes[timeThresholdsMinutes.length - 1] * 80

  // 3档等时圈配色（如果阈值不是3档，也会尽量用前3档）
  const bandColors = [
    // 底图是影像图：提高饱和度 + 提高透明度，让颜色更亮眼、区分更明显
    { fill: '#22c55e', outline: '#bbf7d0', alpha: 0.55 }, // <=10分钟：亮绿
    { fill: '#3b82f6', outline: '#bfdbfe', alpha: 0.55 }, // 10-15分钟：亮蓝
    { fill: '#f43f5e', outline: '#fecdd3', alpha: 0.55 }, // 15-20分钟：亮红
  ]

  try {
    if (isochroneDataSource) {
      try {
        viewer.dataSources.remove(isochroneDataSource)
      } catch (e) {
        // ignore
      }
      isochroneDataSource = null
    }

    // 重新生成等时圈时清理旧的高亮点
    clearTopArrivalHighlights()

    // 新一轮等时圈开始：清理旧的连线层，避免上一轮（步行）连线等到下一轮（驾车）结束才一起清除
    if (isochroneConnectorDataSource) {
      try {
        viewer.dataSources.remove(isochroneConnectorDataSource)
      } catch {
        // ignore
      }
      isochroneConnectorDataSource = null
    }

    const res = await axios.get(`${API_BASE}/facilities`)
    const facilities = Array.isArray(res.data) ? res.data : []

    const filtered = facilities.filter((f) => {
      const lon = Number(f.longitude ?? f.lon)
      const lat = Number(f.latitude ?? f.lat)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
      if (useAllCategories) return true
      return selectedCategories.includes(normalizeCategory(f.type))
    })

    if (filtered.length === 0) {
      isochroneStats = {
        totalGridCount: 0,
        band0GridCount: 0,
        band1GridCount: 0,
        band2GridCount: 0,
        reachableGridCount: 0,
        coverageRate: 0,
        timeThresholdsMinutes,
        categories: useAllCategories ? ['all'] : selectedCategories,
        facilityCount: 0,
      }
      if (isochroneConnectorDataSource) {
        try {
          viewer.dataSources.remove(isochroneConnectorDataSource)
        } catch {
          // ignore
        }
        isochroneConnectorDataSource = null
      }
      clearTopArrivalHighlights()
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('isochrone-updated', {
              detail: isochroneStats,
            })
          )
        } catch {
          // ignore
        }
      }
      return isochroneStats
    }

    const autoBounds = (() => {
      let minLon = Infinity
      let maxLon = -Infinity
      let minLat = Infinity
      let maxLat = -Infinity
      filtered.forEach((f) => {
        const lon = Number(f.longitude ?? f.lon)
        const lat = Number(f.latitude ?? f.lat)
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })

      const centerLat = (minLat + maxLat) / 2
      const latDegPad = approxRadiusMeters / 111320
      const lonDegPad = approxRadiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180))
      const pad = Math.max(gridSizeDeg, latDegPad, lonDegPad)

      return {
        minLon: minLon - pad,
        maxLon: maxLon + pad,
        minLat: minLat - pad,
        maxLat: maxLat + pad,
      }
    })()

    const bounds = options.bounds || autoBounds

    isochroneDataSource = new Cesium.CustomDataSource('isochrone-coverage')

    // 标准不规则等时圈：用高德路径规划 API 生成轮廓多边形（非网格、非圆）。
    // 思路：对每个设施点，从该点出发按射线方向采样一组“沿距离的目的点”，
    // 通过 walking/driving 的 duration 判断落在哪个时间阈值内，从而得到每条射线的边界点，再拼成多边形。

    const travelMode = options.travelMode === 'driving' ? 'driving' : 'walking'
    const getDurationSeconds = travelMode === 'driving' ? getDrivingDurationSeconds : getWalkingDurationSeconds

    // 等时圈标准形态通常是从“单个起点”出发：
    // 优先使用“当前选中/点击的等时圈起点”，没有的话再退化为“我的定位”。
    // 如果仍不可用，再退化为筛选后的第 1 个设施点。
    // 由于请求量很大，这里默认只取 1 个起点，确保形状清晰且性能可控。
    const rayCount = Number(options.rayCount) || 30
    const sampleCount = Number(options.sampleCount) || 8

    const speedMetersPerMin = travelMode === 'driving' ? 250 : 80
    const maxDist = Number(options.approxRadiusMeters) || timeThresholdsMinutes[timeThresholdsMinutes.length - 1] * speedMetersPerMin

    const getEntityPropNumber = (entity, key) => {
      try {
        const v = entity?.properties?.[key]
        if (v == null) return null
        if (typeof v.getValue === 'function') {
          const val = v.getValue(Cesium.JulianDate.now())
          return Number(val)
        }
        return Number(v)
      } catch {
        return null
      }
    }

    const userLon = getEntityPropNumber(userLocationMarker, 'longitude')
    const userLat = getEntityPropNumber(userLocationMarker, 'latitude')

    const originFromClick = isochroneOrigin
    const origins =
      originFromClick && Number.isFinite(originFromClick.longitude) && Number.isFinite(originFromClick.latitude)
        ? [originFromClick]
        : Number.isFinite(userLon) && Number.isFinite(userLat)
          ? [{ longitude: userLon, latitude: userLat }]
          : filtered.slice(0, 1)

    const maxRadiusMetersByBand = [0, 0, 0]
    const rayAngles = Array.from({ length: rayCount }, (_, i) => (i * Math.PI * 2) / rayCount)
    const distances = Array.from({ length: sampleCount }, (_, i) => ((i + 1) / sampleCount) * maxDist)

    for (const origin of origins) {
      const originLon = Number(origin.longitude ?? origin.lon)
      const originLat = Number(origin.latitude ?? origin.lat)
      if (!Number.isFinite(originLon) || !Number.isFinite(originLat)) continue

      const evalPoints = []
      for (let r = 0; r < rayCount; r++) {
        const bearing = rayAngles[r]
        for (let s = 0; s < distances.length; s++) {
          const d = distances[s]
          const p = destinationLonLat(originLon, originLat, d, bearing)
          if (!p || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue
          evalPoints.push({ rayIndex: r, sampleIndex: s, lon: p.lon, lat: p.lat, dist: d })
        }
      }

      const tasks = evalPoints.map((p) => async () => {
        return getDurationSeconds(originLon, originLat, p.lon, p.lat)
      })

      const resolved = await runWithConcurrency(tasks, AMAP_ROUTE_CONCURRENCY)

        // 防止用户在请求期间快速切换/关闭：旧任务返回后不应再渲染
        if (!isochroneActive || runId !== isochroneRunId) return null

      const durationByRaySample = Array.from({ length: rayCount }, () => Array(distances.length).fill(null))
      resolved.forEach((sec, idx) => {
        const p = evalPoints[idx]
        if (!p) return
        if (Number.isFinite(sec)) durationByRaySample[p.rayIndex][p.sampleIndex] = sec
      })

      // boundaryDistByRayBand[ray][band]
      const boundaryDistByRayBand = Array.from({ length: rayCount }, () => Array(3).fill(0))
      for (let r = 0; r < rayCount; r++) {
        for (let band = 0; band < 3; band++) {
          const tSec = timeThresholdsSeconds[band]
          let best = 0
          for (let s = 0; s < distances.length; s++) {
            const sec = durationByRaySample[r][s]
            if (Number.isFinite(sec) && sec <= tSec) best = distances[s]
          }
          boundaryDistByRayBand[r][band] = best
          if (best > maxRadiusMetersByBand[band]) maxRadiusMetersByBand[band] = best
        }
      }

      // 边缘锯齿通常来自射线采样的离散性：对每个 band 的边界距离做环形滑动平均
      // 规则：只对 d>0 的邻域做平均，避免把不可达边界“抹出来”（d=0 的影响）。
      // 平滑窗口太大容易把不规则轮廓“抹圆”
      // 半径：1 => 3点平滑（更保形，同时能缓解锯齿）
      const raySmoothWindow = Number(options.raySmoothWindow) || 1
      const smoothedBoundaryDistByRayBand = Array.from({ length: rayCount }, () => Array(3).fill(0))
      for (let band = 0; band < 3; band++) {
        for (let r = 0; r < rayCount; r++) {
          let sum = 0
          let cnt = 0
          for (let k = -raySmoothWindow; k <= raySmoothWindow; k++) {
            const idx = (r + k + rayCount) % rayCount
            const d = boundaryDistByRayBand[idx][band]
            if (Number.isFinite(d) && d > 0) {
              sum += d
              cnt++
            }
          }
          smoothedBoundaryDistByRayBand[r][band] = cnt > 0 ? sum / cnt : 0
        }
      }

      const addBandPolygon = (band, colorCfg) => {
        const outerPositions = smoothedBoundaryDistByRayBand.map((arr, r) => {
          const d = arr[band]
          if (!Number.isFinite(d) || d <= 0) return Cesium.Cartesian3.fromDegrees(originLon, originLat, 0)
          const p = destinationLonLat(originLon, originLat, d, rayAngles[r])
          return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
        })

        // 检测是否有效：至少有一个点不等于原点
        const anyReachable = smoothedBoundaryDistByRayBand.some((arr) => arr[band] > 0)
        if (!anyReachable) return

        const hierarchy = new Cesium.PolygonHierarchy(outerPositions)

        // 3D分层效果：不同时间圈不同高度（band 0最低，band 2最高）
        const baseHeight = 50 + band * 80 // 50, 130, 210 米
        const extrudedHeight = baseHeight + 60 // 向上拉伸高度

        // 3D立体等时圈（使用extrudedHeight实现立体效果）
        isochroneDataSource.entities.add({
          polygon: {
            hierarchy,
            material: Cesium.Color.fromCssColorString(colorCfg.fill).withAlpha(0.6),
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
            outlineWidth: 3,
            height: baseHeight, // 底部高度
            extrudedHeight: extrudedHeight, // 向上拉伸形成3D块
          },
          properties: {
            type: 'isochronePolygon',
            bandIndex: band,
            travelMode,
          },
        })
      }

      // 先大后小，让小阈值覆盖显示
      addBandPolygon(2, bandColors[2])
      addBandPolygon(1, bandColors[1])
      addBandPolygon(0, bandColors[0])
    }

    // ===== 等时圈 Plus：起点到“最近设施”的连线 + 距离标签（Top N）=====
    let topArrivals = []
    try {
      const originForLines = origins && origins.length ? origins[0] : null
      const originLon = originForLines ? Number(originForLines.longitude ?? originForLines.lon) : null
      const originLat = originForLines ? Number(originForLines.latitude ?? originForLines.lat) : null

      if (Number.isFinite(originLon) && Number.isFinite(originLat) && Array.isArray(filtered) && filtered.length > 0) {
        const showTopLines = options.showTopArrivalsLines !== false

        // 清理旧连线
        if (isochroneConnectorDataSource) {
          try {
            viewer.dataSources.remove(isochroneConnectorDataSource)
          } catch {
            // ignore
          }
          isochroneConnectorDataSource = null
        }

        if (showTopLines) {
          isochroneConnectorDataSource = new Cesium.CustomDataSource('isochrone-top-arrivals')
        }

        const topN = Number(options.topN) || 5
        const candidateMax = Number(options.topCandidateLimit) || 30
        const maxCandidateDist = (Number.isFinite(maxDist) ? maxDist : approxRadiusMeters) * 1.3

        const candidates = filtered
          .map((f) => {
            const lon = Number(f.longitude ?? f.lon)
            const lat = Number(f.latitude ?? f.lat)
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
            const dist = distanceMeters(originLon, originLat, lon, lat)
            return dist <= maxCandidateDist ? { facility: f, lon, lat, straightDist: dist } : null
          })
          .filter(Boolean)
          .sort((a, b) => a.straightDist - b.straightDist)
          .slice(0, candidateMax)

        const selected = candidates.length
          ? candidates
          : filtered
              .slice(0, Math.min(filtered.length, candidateMax))
              .map((f) => {
                const lon = Number(f.longitude ?? f.lon)
                const lat = Number(f.latitude ?? f.lat)
                if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
                return { facility: f, lon, lat, straightDist: distanceMeters(originLon, originLat, lon, lat) }
              })
              .filter(Boolean)

        const routeTasks = selected.map((c) => async () => {
          return travelMode === 'driving'
            ? await getDrivingRouteInfoSecondsDistanceMeters(originLon, originLat, c.lon, c.lat)
            : await getWalkingRouteInfoSecondsDistanceMeters(originLon, originLat, c.lon, c.lat)
        })

        const resolved = await runWithConcurrency(routeTasks, AMAP_ROUTE_CONCURRENCY)

        // 防止用户在请求期间快速切换/关闭：旧路线结果返回后不应再渲染连线/标签/高亮
        if (!isochroneActive || runId !== isochroneRunId) return null

        const joined = selected
          .map((c, idx) => {
            const info = resolved[idx]
            if (!info || typeof info.durationSec !== 'number' || typeof info.distanceMeters !== 'number') return null
            return {
              facility: c.facility,
              longitude: c.lon,
              latitude: c.lat,
              durationSec: info.durationSec,
              distanceMeters: info.distanceMeters,
            }
          })
          .filter(Boolean)
          .sort((a, b) => a.durationSec - b.durationSec)

        topArrivals = joined.slice(0, topN)

        const lineColors = ['#f97316', '#f43f5e', '#3b82f6', '#22c55e', '#a78bfa', '#f59e0b']

        const formatDistance = (meters) => {
          if (!Number.isFinite(meters) || meters < 0) return '—'
          if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
          return `${Math.round(meters)} m`
        }

        // 2) Top N 设施点高亮（不依赖连线是否显示）
        highlightTopArrivalFacilities(topArrivals, lineColors)

        if (showTopLines && isochroneConnectorDataSource) {
          // 连线略微抬高，避免与等时圈贴地面片发生深度冲突导致“看起来在下面”
          const connectorHeightMeters = Number(options.connectorHeightMeters) || 6
          const originCartesian = Cesium.Cartesian3.fromDegrees(originLon, originLat, connectorHeightMeters)

          // 还需要再检查一次，避免在渲染连线这一段前状态已变更
          if (!isochroneActive || runId !== isochroneRunId) return null

          topArrivals.forEach((item, i) => {
            const destCartesian = Cesium.Cartesian3.fromDegrees(item.longitude, item.latitude, connectorHeightMeters)
            const c = Cesium.Color.fromCssColorString(lineColors[i % lineColors.length]).withAlpha(0.95)

            // 连线
            isochroneConnectorDataSource.entities.add({
              polyline: {
                positions: [originCartesian, destCartesian],
                width: 4,
                material: c,
                clampToGround: false,
                depthFailMaterial: c,
              },
              properties: {
                type: 'isochroneOriginConnector',
                rank: i + 1,
              },
            })

            // 距离标签（放在两点中点附近）
            const midLon = (originLon + item.longitude) / 2
            const midLat = (originLat + item.latitude) / 2
            const labelText = formatDistance(item.distanceMeters)

            isochroneConnectorDataSource.entities.add({
              position: Cesium.Cartesian3.fromDegrees(midLon, midLat, 30),
              label: {
                text: labelText,
                font: '14px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: c,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, 10),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              properties: {
                type: 'isochroneOriginDistanceLabel',
                rank: i + 1,
              },
            })
          })

          viewer.dataSources.add(isochroneConnectorDataSource)
          // 不对连线数据源做 lower：让它在等时圈之上显示
        }
      }
    } catch (e) {
      console.warn('isochrone top-arrivals render failed:', e)
      topArrivals = []
    }

    isochroneStats = {
      facilityCount: origins.length,
      timeThresholdsMinutes,
      maxRadiusMetersByBand,
      categories: useAllCategories ? ['all'] : selectedCategories,
      mode: 'isochrone-polygon',
      travelMode,
      topArrivals,
    }

    try {
      viewer.dataSources.add(isochroneDataSource)
      viewer.dataSources.lower(isochroneDataSource)
      if (isochroneConnectorDataSource) {
        // 把连线层抬到等时圈之上
        viewer.dataSources.raise(isochroneConnectorDataSource)
      }
    } catch (e) {
      console.warn('isochrone dataSource add/lower failed:', e)
    }

    if (typeof window !== 'undefined') {
      // 渲染完成后再做一次最终校验：避免旧 runId 抢走 UI 状态
      if (!isochroneActive || runId !== isochroneRunId) return null
      try {
        window.dispatchEvent(
          new CustomEvent('isochrone-updated', {
            detail: isochroneStats,
          })
        )
      } catch {
        // ignore
      }
    }

    return isochroneStats

    let totalGridCount = 0
    let band0GridCount = 0
    let band1GridCount = 0
    let band2GridCount = 0
    let reachableGridCount = 0

    const gridCountLon = Math.ceil((bounds.maxLon - bounds.minLon) / gridSizeDeg)
    const gridCountLat = Math.ceil((bounds.maxLat - bounds.minLat) / gridSizeDeg)

    const grids = []
    for (let ix = 0; ix < gridCountLon; ix++) {
      for (let iy = 0; iy < gridCountLat; iy++) {
        const minLon = bounds.minLon + ix * gridSizeDeg
        const minLat = bounds.minLat + iy * gridSizeDeg
        const maxLon = Math.min(minLon + gridSizeDeg, bounds.maxLon)
        const maxLat = Math.min(minLat + gridSizeDeg, bounds.maxLat)
        const centerLon = (minLon + maxLon) / 2
        const centerLat = (minLat + maxLat) / 2
        grids.push({ minLon, minLat, maxLon, maxLat, centerLon, centerLat })
      }
    }

    totalGridCount = grids.length

    const tasks = grids.map((g) => async () => {
      const maxCandidateDist = approxRadiusMeters * 1.3
      const nearest = filtered
        .map((f) => {
          const lon = Number(f.longitude ?? f.lon)
          const lat = Number(f.latitude ?? f.lat)
          return { f, dist: distanceMeters(g.centerLon, g.centerLat, lon, lat) }
        })
        .filter((item) => item.dist <= maxCandidateDist)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, Math.max(1, candidateFacilityLimit))

      if (nearest.length === 0) {
        return { ...g, minDurationSec: null, bandIndex: -1 }
      }

      const candidateKey = nearest
        .map((item) => {
          const lon = Number(item.f.longitude ?? item.f.lon)
          const lat = Number(item.f.latitude ?? item.f.lat)
          return `${lon.toFixed(5)},${lat.toFixed(5)}`
        })
        .join('|')

      const cacheKey = `${g.centerLon.toFixed(5)}_${g.centerLat.toFixed(5)}_${candidateKey}`
      const cachedMin = isochroneMinDurationCache.get(cacheKey)
      if (typeof cachedMin === 'number') {
        const sec = cachedMin
        const bandIndex = sec <= minSec ? 0 : sec <= midSec ? 1 : sec <= maxSec ? 2 : -1
        return { ...g, minDurationSec: sec, bandIndex }
      }

      let minDurationSec = Number.POSITIVE_INFINITY
      for (const item of nearest) {
        const lon = Number(item.f.longitude ?? item.f.lon)
        const lat = Number(item.f.latitude ?? item.f.lat)
        const sec = await getWalkingDurationSeconds(g.centerLon, g.centerLat, lon, lat)
        if (sec < minDurationSec) minDurationSec = sec
        // band0 一旦命中就不需要再算精确最小值了（只用于分级展示）
        if (minDurationSec <= minSec) break
      }

      if (!Number.isFinite(minDurationSec)) {
        return { ...g, minDurationSec: null, bandIndex: -1 }
      }

      setCacheWithLimit(isochroneMinDurationCache, cacheKey, minDurationSec, isochroneMinDurationCacheMax)
      const bandIndex = minDurationSec <= minSec ? 0 : minDurationSec <= midSec ? 1 : minDurationSec <= maxSec ? 2 : -1
      return { ...g, minDurationSec: minDurationSec, bandIndex }
    })

    const resolved = await runWithConcurrency(tasks, AMAP_ROUTE_CONCURRENCY)

    if (!isochroneActive || runId !== isochroneRunId) return null

    resolved.forEach((item) => {
      if (!item) return
      if (!Number.isFinite(item.minLon) || !Number.isFinite(item.minLat) || !Number.isFinite(item.maxLon) || !Number.isFinite(item.maxLat))
        return

      const bandIndex = item.bandIndex
      if (bandIndex < 0) return

      const band = Math.min(2, Math.max(0, bandIndex))
      if (band === 0) band0GridCount++
      if (band === 1) band1GridCount++
      if (band === 2) band2GridCount++
      reachableGridCount++

      const colorCfg = bandColors[band]
      isochroneDataSource.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(item.minLon, item.minLat, item.maxLon, item.maxLat),
          material: Cesium.Color.fromCssColorString(colorCfg.fill).withAlpha(colorCfg.alpha),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(colorCfg.outline).withAlpha(0.78),
          height: 0,
        },
        properties: {
          type: 'isochroneGrid',
          bandIndex: band,
          minDurationSec: item.minDurationSec ?? null,
        },
        description: `
          <table class="zw-table">
            <tr><th>等时圈</th><td>${timeThresholdsMinutes[band] || timeThresholdsMinutes[timeThresholdsMinutes.length - 1]} 分钟内可达</td></tr>
            <tr><th>最短步行时长</th><td>${
              typeof item.minDurationSec === 'number' ? `${Math.round(item.minDurationSec / 60)} 分钟` : '—'
            }</td></tr>
            <tr><th>网格中心</th><td>${item.centerLon.toFixed(4)}, ${item.centerLat.toFixed(4)}</td></tr>
          </table>
        `,
      })
    })

    isochroneStats = {
      totalGridCount,
      band0GridCount,
      band1GridCount,
      band2GridCount,
      reachableGridCount,
      coverageRate: totalGridCount > 0 ? reachableGridCount / totalGridCount : 0,
      timeThresholdsMinutes,
      categories: useAllCategories ? ['all'] : selectedCategories,
      facilityCount: filtered.length,
    }

    try {
      viewer.dataSources.add(isochroneDataSource)
      viewer.dataSources.lower(isochroneDataSource)
    } catch (e) {
      console.warn('isochrone dataSource add/lower failed:', e)
    }

    return isochroneStats
  } catch (err) {
    console.error('等时圈分析加载失败', err)
    isochroneStats = null
    return null
  } finally {
    if (isochroneActive && isochronePendingOptions) {
      const pending = isochronePendingOptions
      isochronePendingOptions = null
      isochroneInFlight = false
      isochroneLoading = false
      return await setIsochroneVisible(true, pending)
    }

    isochroneInFlight = false
    isochroneLoading = false
  }
}

async function loadHeatmap(type = 'grid') {
  if (!viewer) return
  
  try {
    // 清除之前的热力图数据
    if (heatmapDataSource) {
      try {
        // 检查数据源是否存在于集合中
        const dataSources = viewer.dataSources
        let exists = false
        for (let i = 0; i < dataSources.length; i++) {
          if (dataSources.get(i) === heatmapDataSource) {
            exists = true
            break
          }
        }
        if (exists) {
          dataSources.remove(heatmapDataSource, true)
        }
      } catch (e) {
        // 忽略数据源不存在于集合中的错误
        console.log('清理热力图数据源:', e?.message || '未知错误')
      }
      heatmapDataSource = null
    }
    heatmapLoaded = false
    
    console.log(`开始构建网格热力图`)
    
    // 获取设施数据
    const facilitiesResponse = await fetch(`${API_BASE}/facilities`)
    const facilities = await facilitiesResponse.json()
    
    console.log('设施数据:', facilities)
    
    if (!Array.isArray(facilities) || facilities.length === 0) {
      console.error('没有设施数据')
      return
    }
    
    // 创建热力图数据源
    heatmapDataSource = new Cesium.CustomDataSource('heatmap')
    
    // 定义网格大小：根据经纬度计算（约1km）
    const gridSize = 0.009 // 约1km的经纬度度数（1度≈111km）
    const gridStats = new Map() // 存储网格统计信息
    
    // 遍历设施点，计算每个网格的设施数量
    facilities.forEach((facility) => {
      const lon = facility.longitude ?? facility.lon
      const lat = facility.latitude ?? facility.lat
      
      if (!lon || !lat) return
      
      // 计算网格坐标（基于经纬度的网格划分）
      const gridX = Math.floor(lon / gridSize) * gridSize
      const gridY = Math.floor(lat / gridSize) * gridSize
      const gridKey = `${gridX.toFixed(4)},${gridY.toFixed(4)}`
      
      // 更新网格统计
      if (!gridStats.has(gridKey)) {
        gridStats.set(gridKey, {
          minX: gridX,
          minY: gridY,
          maxX: gridX + gridSize,
          maxY: gridY + gridSize,
          count: 0,
          facilities: []
        })
      }
      
      const grid = gridStats.get(gridKey)
      grid.count++
      grid.facilities.push(facility)
    })
    
    console.log('网格统计结果:', Array.from(gridStats.entries()))
    
    // 将网格转换为数组并按设施数量排序
    const sortedGrids = Array.from(gridStats.values()).sort((a, b) => b.count - a.count)
    
    if (sortedGrids.length === 0) {
      console.error('没有有效的网格数据')
      return
    }
    
    // 计算分位数，确保颜色分布合理
    const maxCount = sortedGrids[0].count
    const minCount = sortedGrids[sortedGrids.length - 1].count
    
    console.log(`设施数量范围: ${minCount} - ${maxCount}`)
    
    // 定义颜色等级（完整色系梯度，6级）
    const colorLevels = [
      { threshold: 0.83, color: '#a50026' }, // 1级 - 深红色（最高密度）
      { threshold: 0.67, color: '#ff7f00' }, // 2级 - 橙色
      { threshold: 0.50, color: '#ffff00' }, // 3级 - 黄色
      { threshold: 0.33, color: '#00ff00' }, // 4级 - 绿色
      { threshold: 0.17, color: '#00bfff' }, // 5级 - 天蓝色
      { threshold: 0.0,  color: '#0000ff' }, // 6级 - 深蓝色（最低密度）
    ]
    
    // 为每个网格创建矩形
    sortedGrids.forEach((grid, index) => {
      // 根据设施数量确定颜色
      const normalizedCount = (grid.count - minCount) / (maxCount - minCount || 1)
      let color = '#0000ff' // 默认深蓝色（最低密度）
      
      for (const level of colorLevels) {
        if (normalizedCount >= level.threshold) {
          color = level.color
          break
        }
      }
      
      console.log(`网格 ${index}: 设施数量=${grid.count}, 归一化值=${normalizedCount.toFixed(2)}, 颜色=${color}`)
      
      // 平面网格热力图 - 置于底层
      const entity = heatmapDataSource.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray([
            grid.minX, grid.minY,
            grid.maxX, grid.minY,
            grid.maxX, grid.maxY,
            grid.minX, grid.maxY
          ]),
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.55),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
          outlineWidth: 1,
          height: 0, // 平面高度
          classificationType: Cesium.ClassificationType.BOTH // 确保在地形上正确渲染
        },
        properties: {
          gridData: grid,
          type: 'grid'
        },
        description: `
          <table class="zw-table">
            <tr><th>网格区域</th><td>[${grid.minX.toFixed(4)}, ${grid.minY.toFixed(4)}]</td></tr>
            <tr><th>设施数量</th><td>${grid.count}</td></tr>
            <tr><th>密度等级</th><td>${normalizedCount > 0.7 ? '高密度' : normalizedCount > 0.3 ? '中密度' : '低密度'}</td></tr>
            <tr><th>覆盖范围</th><td>${gridSize}km × ${gridSize}km</td></tr>
          </table>
        `
      })
    })
    
    // 检查是否已存在于 dataSources 中，避免重复添加
    let alreadyAdded = false
    for (let i = 0; i < viewer.dataSources.length; i++) {
      if (viewer.dataSources.get(i) === heatmapDataSource) {
        alreadyAdded = true
        break
      }
    }
    if (!alreadyAdded) {
      viewer.dataSources.add(heatmapDataSource)
    }
    // 将热力图图层置于底层（只有成功添加后才执行）
    try {
      if (heatmapDataSource) {
        viewer.dataSources.lower(heatmapDataSource)
      }
    } catch (e) {
      console.log('调整热力图层级:', e?.message || '未知错误')
    }
    heatmapLoaded = true
    
    console.log(`网格热力图加载完成，共创建 ${sortedGrids.length} 个网格`)
    
    // 设置热力图点击事件
    setupHeatmapInteraction()
  } catch (err) {
    console.error('加载网格热力图失败', err)
    console.error('错误详情:', err.message, err.stack)
    // 不抛出错误，避免阻塞其他功能
  }
}

// 创建热力图材质函数
function createHeatmapMaterial(intensity = 1.0, baseColor = 'yellow') {
  // 使用渐变材质模拟热力效果
  return new Cesium.ImageMaterialProperty({
    image: createHeatmapGradient(intensity, baseColor),
    transparent: true
  })
}

// 创建热力渐变图像
function createHeatmapGradient(intensity, baseColor) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  
  // 创建径向渐变
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  
  // 根据基础颜色和强度设置渐变
  if (baseColor === 'red') {
    // 红色系
    gradient.addColorStop(0, `rgba(255, 0, 0, ${0.8 * intensity})`)
    gradient.addColorStop(0.5, `rgba(255, 100, 0, ${0.4 * intensity})`)
    gradient.addColorStop(1, `rgba(255, 200, 0, 0)`)
  } else if (baseColor === 'green') {
    // 绿色系
    gradient.addColorStop(0, `rgba(0, 255, 0, ${0.8 * intensity})`)
    gradient.addColorStop(0.5, `rgba(100, 255, 0, ${0.4 * intensity})`)
    gradient.addColorStop(1, `rgba(200, 255, 0, 0)`)
  } else if (baseColor === 'orange') {
    // 橙色系
    gradient.addColorStop(0, `rgba(255, 165, 0, ${0.8 * intensity})`)
    gradient.addColorStop(0.5, `rgba(255, 200, 0, ${0.4 * intensity})`)
    gradient.addColorStop(1, `rgba(255, 255, 0, 0)`)
  } else {
    // 默认黄色系
    gradient.addColorStop(0, `rgba(255, 255, 0, ${0.8 * intensity})`)
    gradient.addColorStop(0.5, `rgba(200, 255, 0, ${0.4 * intensity})`)
    gradient.addColorStop(1, `rgba(100, 255, 0, 0)`)
  }
  
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  
  return canvas
}

// 设置热力图点击事件
function setupHeatmapInteraction() {
  if (!viewer) return
  
  viewer.screenSpaceEventHandler.setInputAction((movement) => {
    const pickedObject = viewer.scene.pick(movement.position)
    if (Cesium.defined(pickedObject) && pickedObject.id) {
      let facility = null
      let infoTitle = '设施详情'
      
      // 根据不同的热力图类型获取设施信息
      if (pickedObject.id.rectangle) {
        // 网格热力图
        const props = pickedObject.id.properties
        const gridDataProp = props && props.gridData
        if (!gridDataProp) return

        const gridData = gridDataProp.getValue ? gridDataProp.getValue() : gridDataProp
        if (gridData) {
          const info = `
            <div class="zw-info-window">
              <h4>网格热力图 - 区域详情</h4>
              <table class="zw-table">
                <tr><th>网格区域</th><td>[${gridData.minX.toFixed(4)}, ${gridData.minY.toFixed(4)}]</td></tr>
                <tr><th>设施数量</th><td>${gridData.count}</td></tr>
                <tr><th>覆盖范围</th><td>≈1km × 1km</td></tr>
                <tr><th>设施列表</th><td>${gridData.facilities.slice(0, 3).map(f => f.name || '未命名').join(', ')}${gridData.facilities.length > 3 ? '...' : ''}</td></tr>
              </table>
            </div>
          `
          viewer.selectedEntity = pickedObject.id
          viewer.infoBox.setVisible(true)
        }
        return
      }
      
      if (pickedObject.id.cylinder) {
        // 3D立体柱或霓虹灯光
        const type = pickedObject.id.properties.type.getValue ? 
          pickedObject.id.properties.type.getValue() : 
          pickedObject.id.properties.type
        
        facility = pickedObject.id.properties.facility.getValue ? 
          pickedObject.id.properties.facility.getValue() : 
          pickedObject.id.properties.facility
          
        if (type === '3d-column') {
          infoTitle = '3D热力柱 - 设施详情'
        } else if (type === 'neon') {
          infoTitle = '霓虹灯光 - 设施详情'
        }
      } else if (pickedObject.id.ellipse) {
        // 传统热力图、脉冲热力图或波纹热力图
        const type = pickedObject.id.properties.type.getValue ? 
          pickedObject.id.properties.type.getValue() : 
          pickedObject.id.properties.type
        
        facility = pickedObject.id.properties.facility.getValue ? 
          pickedObject.id.properties.facility.getValue() : 
          pickedObject.id.properties.facility
          
        if (type === 'traditional') {
          infoTitle = '传统热力图 - 设施详情'
        } else if (type === 'pulse') {
          infoTitle = '动态脉冲 - 设施详情'
        } else if (type === 'wave') {
          infoTitle = '波纹扩散 - 设施详情'
        }
      } else if (pickedObject.id.point) {
        // 粒子云或霓虹灯光顶部发光点
        const type = pickedObject.id.properties.type.getValue ? 
          pickedObject.id.properties.type.getValue() : 
          pickedObject.id.properties.type
        
        facility = pickedObject.id.properties.facility.getValue ? 
          pickedObject.id.properties.facility.getValue() : 
          pickedObject.id.properties.facility
          
        if (type === 'particle') {
          infoTitle = '粒子云 - 设施详情'
        } else if (type === 'neon') {
          infoTitle = '霓虹灯光 - 设施详情'
        }
      }
      
      if (facility) {
        const info = `
          <div class="zw-info-window">
            <h4>${infoTitle}</h4>
            <table class="zw-table">
              <tr><th>名称</th><td>${facility.name || ''}</td></tr>
              <tr><th>类型</th><td>${facility.type || ''}</td></tr>
              <tr><th>经度</th><td>${facility.lon || facility.longitude}</td></tr>
              <tr><th>纬度</th><td>${facility.lat || facility.latitude}</td></tr>
            </table>
          </div>
        `
        viewer.selectedEntity = pickedObject.id
        viewer.infoBox.setVisible(true)
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function clearDrawings() {
  if (!viewer) return
  if (measureEntities.length) {
    measureEntities.forEach((e) => viewer.entities.remove(e))
    measureEntities = []
  }
  if (measureHandler) {
    measureHandler.destroy()
    measureHandler = undefined
  }
  measureMode = null
  measurePositions = []
  measureEntity = null
  measureLabel = null
}

function setupMeasureHandler() {
  if (!viewer) return
  if (measureHandler) {
    measureHandler.destroy()
    measureHandler = undefined
  }

  measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

  // 左键：添加一个控制点
  measureHandler.setInputAction((click) => {
    if (!measureMode) return
    const cartesian = viewer.scene.pickPosition(click.position)
    if (!cartesian) return

    measurePositions.push(cartesian)

    // 每个控制点画一个小红点
    const point = viewer.entities.add({
      position: cartesian,
      point: {
        pixelSize: 8,
        color: Cesium.Color.RED,
      },
    })
    measureEntities.push(point)

    // 第一次创建线/面实体，之后通过 CallbackProperty 动态更新
    if (!measureEntity) {
      if (measureMode === 'distance') {
        measureEntity = viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => measurePositions, false),
            width: 3,
            material: Cesium.Color.CYAN,
          },
        })
      } else if (measureMode === 'area') {
        measureEntity = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.CallbackProperty(
              () => new Cesium.PolygonHierarchy(measurePositions),
              false
            ),
            material: Cesium.Color.CYAN.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
          },
        })
      }
      measureEntities.push(measureEntity)
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 右键：结束测量并计算结果
  measureHandler.setInputAction(() => {
    if (!measureMode || measurePositions.length < 2) {
      clearDrawings()
      return
    }

    let text = ''
    if (measureMode === 'distance') {
      // 多段距离累加
      let total = 0
      for (let i = 1; i < measurePositions.length; i++) {
        const c1 = Cesium.Cartographic.fromCartesian(measurePositions[i - 1])
        const c2 = Cesium.Cartographic.fromCartesian(measurePositions[i])
        const g = new Cesium.EllipsoidGeodesic(c1, c2)
        total += g.surfaceDistance
      }
      text = total > 1000 ? `${(total / 1000).toFixed(2)} km` : `${total.toFixed(1)} m`
    } else if (measureMode === 'area' && measurePositions.length >= 3) {
      // 近似：以第一个点为原点，把经纬度换算到以米为单位的平面坐标，用多边形鞋带公式求面积
      const R = 6378137 // 地球半径（米）
      const cartographics = measurePositions.map((p) =>
        Cesium.Ellipsoid.WGS84.cartesianToCartographic(p)
      )
      const lon0 = cartographics[0].longitude
      const lat0 = cartographics[0].latitude
      const cosLat0 = Math.cos(lat0)

      const points = cartographics.map((c) => {
        const x = (c.longitude - lon0) * cosLat0 * R
        const y = (c.latitude - lat0) * R
        return { x, y }
      })

      let area = 0
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length
        area += points[i].x * points[j].y - points[j].x * points[i].y
      }
      area = Math.abs(area) / 2
      text = area > 1_000_000 ? `${(area / 1_000_000).toFixed(2)} km²` : `${area.toFixed(0)} m²`
    }

    if (text && viewer) {
      const last = measurePositions[measurePositions.length - 1]
      measureLabel = viewer.entities.add({
        position: last,
        label: {
          text,
          font: '14px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      measureEntities.push(measureLabel)
    }

    // 结束当前测量模式，但保留图形和结果
    measureMode = null
    if (measureHandler) {
      measureHandler.destroy()
      measureHandler = undefined
    }
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
}

function startDistanceMeasure() {
  clearDrawings()
  measureMode = 'distance'
  setupMeasureHandler()
}

function startAreaMeasure() {
  clearDrawings()
  measureMode = 'area'
  setupMeasureHandler()
}

function setBaseLayer(type) {
  // 暂时禁用在线底图切换逻辑，避免因各种网络 / CORS / 配置问题导致蓝屏。
  // 三维页面统一使用 Cesium 初始化时配置的默认影像。
  console.info('setBaseLayer called with type =', type, '（当前已禁用底图切换，仅使用默认三维底图）')
}

function setVisibleCategories(categories) {
  if (!viewer) return
  const set = new Set((categories || []).map((c) => c.toString().toLowerCase()))

  // 如果是第一次调用且有选中的类型，才加载设施数据
  if (!facilitiesLoaded && set.size > 0) {
    loadFacilities()
    facilitiesLoaded = true
  }

  viewer.entities.values.forEach((entity) => {
    const props = entity.properties
    if (!props || !props.category) return
    const cat = props.category.getValue ? props.category.getValue() : props.category
    // 修复逻辑：只有当categories不为空且包含该类型时才显示
    if (set.size > 0 && set.has(cat)) {
      entity.show = true
    } else {
      entity.show = false
    }
  })
}

// 获取用户位置
const getUserLocation = () => {
  if (!viewer) return
  
  if (!navigator.geolocation) {
    alert('您的浏览器不支持地理定位')
    return
  }

  // 先请求权限
  navigator.permissions.query({ name: 'geolocation' }).then((result) => {
    if (result.state === 'denied') {
      alert('位置权限被拒绝，请在浏览器设置中允许位置访问')
      return
    }
    
    // 显示权限申请提示
    if (result.state === 'prompt') {
      const confirmLocation = confirm('是否允许获取您的精确位置用于地图定位？')
      if (!confirmLocation) return
    }
    
    // 显示加载状态
    const loadingEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(118.035, 36.799),
      label: {
        text: '正在获取位置...',
        font: '16pt sans-serif',
        fillColor: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -30)
      }
    })

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // 移除加载提示
        viewer.entities.remove(loadingEntity)
        
        const { longitude, latitude } = position.coords
        
        // 移除之前的标记
        if (userLocationMarker) {
          viewer.entities.remove(userLocationMarker)
        }
        
        // 添加用户位置标记（永久显示）
        userLocationMarker = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 50), // 固定50米高度
          point: {
            pixelSize: 15,
            color: Cesium.Color.BLUE,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, // 相对地面高度
            show: true, // 确保显示
            disableDepthTestDistance: Number.POSITIVE_INFINITY // 禁用深度测试
          },
          label: {
            text: '您的位置',
            font: 'bold 14pt sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, 25),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            show: true, // 确保显示
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // 禁用深度测试
            eyeOffset: new Cesium.Cartesian3(0, 0, 100) // 向上偏移，避免被遮挡
          },
          // 设置友好的名称
          name: '地点详情',
          // 存储坐标信息用于点击显示
          properties: {
            longitude: longitude.toFixed(6),
            latitude: latitude.toFixed(6),
            type: 'userLocation'
          }
        })
        
        // 飞到用户位置（视野中心向下偏移一点，确保定位点在视野内）
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude + 0.003, 1000),
          orientation: {
            heading: Cesium.Math.toRadians(180),
            pitch: Cesium.Math.toRadians(-70),
            roll: 0
          },
          duration: 2.0
        })
      },
      (error) => {
        // 移除加载提示
        viewer.entities.remove(loadingEntity)
        
        let errorMessage = '获取位置失败'
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = '位置权限被拒绝'
            break
          case error.POSITION_UNAVAILABLE:
            errorMessage = '位置信息不可用'
            break
          case error.TIMEOUT:
            errorMessage = '获取位置超时'
            break
        }
        
        // 显示错误信息
        const errorEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(118.035, 36.799),
          label: {
            text: errorMessage,
            font: '14pt sans-serif',
            fillColor: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -30)
          }
        })
        
        // 3秒后移除错误信息
        setTimeout(() => {
          viewer.entities.remove(errorEntity)
        }, 3000)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    )
  })
}

function focusFacilityByLonLat(lon, lat) {
  if (!viewer) return
  const nextLon = Number(lon)
  const nextLat = Number(lat)
  if (!Number.isFinite(nextLon) || !Number.isFinite(nextLat)) return

  const targetEntity = viewer.entities.values.find((e) => {
    const p = e.position
    if (!p) return false
    try {
      const cart = Cesium.Cartographic.fromCartesian(p._value || p.getValue?.(Cesium.JulianDate.now()))
      if (!cart) return false
      const elon = Cesium.Math.toDegrees(cart.longitude)
      const elat = Cesium.Math.toDegrees(cart.latitude)
      return Math.abs(elon - nextLon) < 1e-4 && Math.abs(elat - nextLat) < 1e-4
    } catch {
      return false
    }
  })

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(nextLon, nextLat, 5000),
    orientation: {
      heading: Cesium.Math.toRadians(180),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0
    },
    duration: 2
  })
  if (targetEntity) viewer.selectedEntity = targetEntity
}

// ==========================================
// 灾情展示功能
// ==========================================

// 清除所有灾情实体
function clearDisasters() {
  if (!viewer) return
  
  // 停止所有涟漪动画
  disasterRippleAnimations.forEach(callback => {
    if (callback) viewer.clock.onTick.removeEventListener(callback)
  })
  disasterRippleAnimations = []
  
  // 移除所有灾情实体
  const entitiesToRemove = viewer.entities.values.filter(e => e._isDisaster)
  entitiesToRemove.forEach(e => viewer.entities.remove(e))
}

// 异步加载图片
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

// ==========================================
// 设施选址分析功能
// ==========================================

// 执行选址分析
async function runSiteSelectionAnalysis(params) {
  if (!viewer) return null
  
  // 先清除旧的结果
  clearSiteSelection()
  
  try {
    const response = await axios.post(`${API_BASE}/siteselection/analyze`, {
      facilityType: params.facilityType || 'hospital',
      gridSizeMeters: params.gridSizeMeters || 1000,
      bounds: params.bounds || [117.95, 36.75, 118.15, 36.90],
      topN: params.topN || 10
    })
    
    if (!response.data.success) {
      console.error('选址分析失败:', response.data.message)
      return null
    }
    
    const { recommendations, gridAnalysis, summary } = response.data
    
    // 在地图上可视化推荐点位
    if (recommendations && recommendations.length > 0) {
      visualizeSiteRecommendations(recommendations, params.facilityColor || '#3b82f6')
    }
    
    // 可视化网格分析结果（短缺区域）
    if (gridAnalysis && gridAnalysis.length > 0) {
      visualizeGridAnalysis(gridAnalysis)
    }
    
    return {
      recommendations,
      gridAnalysis,
      summary
    }
  } catch (error) {
    console.error('选址分析请求失败:', error)
    return null
  }
}

// 可视化选址推荐点位
function visualizeSiteRecommendations(recommendations, color) {
  if (!viewer) return
  
  recommendations.forEach((rec, index) => {
    const priority = rec.priority
    const size = priority === 'high' ? 24 : priority === 'medium' ? 18 : 14
    const height = priority === 'high' ? 150 : priority === 'medium' ? 100 : 50
    
    // 创建标注点
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, height),
      billboard: {
        image: createSiteMarkerCanvas(index + 1, color, size),
        scale: 1,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: rec.suggestedFacilityName,
        font: 'bold 12pt sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        type: 'siteRecommendation',
        rank: rec.rank,
        data: rec
      }
    })
    
    // 添加垂直引线
    viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          rec.lon, rec.lat, 0,
          rec.lon, rec.lat, height
        ]),
        material: Cesium.Color.fromCssColorString(color).withAlpha(0.6),
        width: 2,
      },
      properties: {
        type: 'siteRecommendationLine',
        parentRank: rec.rank
      }
    })
  })
}

// 创建选址标记画布
function createSiteMarkerCanvas(rank, color, size) {
  const canvas = document.createElement('canvas')
  canvas.width = size * 2
  canvas.height = size * 2 + 8
  const ctx = canvas.getContext('2d')
  
  const centerX = size
  const centerY = size
  const radius = size * 0.8
  
  // 绘制圆形标记
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  
  ctx.shadowColor = 'transparent'
  
  // 绘制排名数字
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${size * 0.6}pt sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(rank.toString(), centerX, centerY)
  
  // 绘制向下的指针
  ctx.beginPath()
  ctx.moveTo(centerX - 6, centerY + radius - 2)
  ctx.lineTo(centerX, centerY + radius + 8)
  ctx.lineTo(centerX + 6, centerY + radius - 2)
  ctx.fillStyle = color
  ctx.fill()
  
  return canvas.toDataURL()
}

// 可视化网格分析（短缺区域）
function visualizeGridAnalysis(gridAnalysis) {
  if (!viewer) return
  
  // 只显示短缺区域的网格
  const shortageGrids = gridAnalysis.filter(g => g.isShortage)
  
  shortageGrids.forEach(grid => {
    const [minLon, minLat, maxLon, maxLat] = grid.bounds
    
    // 绘制半透明矩形表示短缺区域
    viewer.entities.add({
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray([
          minLon, minLat,
          maxLon, minLat,
          maxLon, maxLat,
          minLon, maxLat
        ]),
        material: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.15),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.5),
        outlineWidth: 1,
        height: 10,
        extrudedHeight: 10
      },
      properties: {
        type: 'shortageGrid',
        gridId: grid.gridId,
        data: grid
      }
    })
  })
}

// 清除选址分析结果
function clearSiteSelection() {
  if (!viewer) return
  
  // 移除所有选址推荐相关实体
  const entitiesToRemove = viewer.entities.values.filter(e => {
    const type = e.properties?.type?.getValue()
    return type === 'siteRecommendation' || 
           type === 'siteRecommendationLine' || 
           type === 'shortageGrid'
  })
  
  entitiesToRemove.forEach(e => viewer.entities.remove(e))
}

// ==========================================
// 视域分析功能
// ==========================================
let viewshedActive = false
let viewshedObserverPosition = null
let viewshedRadius = 2000 // 视域半径（米）
let viewshedDataSource = null

// 设置视域分析可见性
function setViewshedVisible(visible) {
  viewshedActive = visible
  
  if (!visible) {
    clearViewshed()
    return
  }
  
  // 如果已经有观察点，重新计算视域
  if (viewshedObserverPosition) {
    calculateViewshed(viewshedObserverPosition)
  }
}

// 清除视域分析结果
function clearViewshed() {
  if (!viewer) return
  
  // 移除视域分析相关实体
  const entitiesToRemove = viewer.entities.values.filter(e => {
    const type = e.properties?.type?.getValue()
    return type === 'viewshedVisible' || type === 'viewshedHidden' || type === 'viewshedObserver'
  })
  
  entitiesToRemove.forEach(e => viewer.entities.remove(e))
  viewshedDataSource = null
}

// 计算视域分析（简化版：基于射线采样）
function calculateViewshed(observerPos) {
  if (!viewer) return
  
  viewshedObserverPosition = observerPos
  
  // 如果视域分析未激活，不计算
  if (!viewshedActive) return
  
  // 清除之前的视域结果
  clearViewshed()
  
  const { lon, lat } = observerPos
  const radius = viewshedRadius
  const sampleCount = 36 // 360度采样点数（每10度一个）
  
  // 添加观察点标记
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 10),
    point: {
      pixelSize: 15,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
    },
    properties: {
      type: 'viewshedObserver'
    }
  })
  
  // 计算各个方向的视域边界
  const visibleBoundaries = []
  const hiddenBoundaries = []
  
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * Math.PI * 2
    const nextAngle = ((i + 1) / sampleCount) * Math.PI * 2
    
    // 简化的视域计算：基于地形和距离
    // 实际应用中这里应该使用视线通视分析
    const isVisible = true // 简化：假设都可视
    
    const r = radius / 111000 // 转换为度（约）
    const destLon = lon + Math.cos(angle) * r
    const destLat = lat + Math.sin(angle) * r
    
    visibleBoundaries.push(Cesium.Cartesian3.fromDegrees(destLon, destLat, 0))
  }
  
  // 3D锥形视域效果 - 创建分层圆环，中心高边缘低
  const layers = 5 // 分层数
  const maxHeight = 300 // 中心最大高度（米）
  
  for (let i = 0; i < layers; i++) {
    const ratio = i / layers // 0到1
    const innerRatio = i / layers
    const outerRatio = (i + 1) / layers
    
    const innerR = radius * innerRatio
    const outerR = radius * outerRatio
    const height = maxHeight * (1 - ratio) // 高度从中心向外递减
    
    // 创建圆环（用ellipse实现）
    if (outerR > innerR && height > 0) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        ellipse: {
          semiMinorAxis: outerR,
          semiMajorAxis: outerR,
          material: Cesium.Color.GREEN.withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.GREEN.withAlpha(0.3),
          outlineWidth: 1,
          extrudedHeight: height, // 向上拉伸形成3D效果
          height: 0,
        },
        properties: {
          type: 'viewshedVisible'
        }
      })
    }
  }
  
  // 添加中心观察塔（圆柱体）
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, maxHeight / 2),
    cylinder: {
      length: maxHeight,
      topRadius: 30,
      bottomRadius: 50,
      material: Cesium.Color.YELLOW.withAlpha(0.6),
      outline: true,
      outlineColor: Cesium.Color.ORANGE,
      outlineWidth: 2,
    },
    properties: {
      type: 'viewshedObserver'
    }
  })
  
  // 添加视域边界线（在最外层）
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    ellipse: {
      semiMinorAxis: radius,
      semiMajorAxis: radius,
      material: Cesium.Color.TRANSPARENT,
      outline: true,
      outlineColor: Cesium.Color.YELLOW.withAlpha(0.8),
      outlineWidth: 3,
      height: 0,
    },
    properties: {
      type: 'viewshedVisible'
    }
  })
}

// 生成灾情自定义图标（圆形灾情图片+底部警告标识）
async function createDisasterIcon(disaster) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  
  const centerX = 32
  const centerY = 28
  const radius = 26
  const colorStr = disaster.color || '#FFD700'
  
  // 1. 绘制圆形背景（带阴影）
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.fillStyle = colorStr
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke()
  
  ctx.shadowColor = 'transparent'
  
  // 2. 圆形裁剪区域绘制灾情图片
  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2)
  ctx.clip()
  
  try {
    // 解析图片列表
    let images = []
    if (disaster.images) {
      try {
        images = JSON.parse(disaster.images)
      } catch {}
    }
    
    if (images.length > 0) {
      // 使用第一张灾情图片
      const imageUrl = images[0].startsWith('http') 
        ? images[0] 
        : `${import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || ''}${images[0]}`
      const img = await loadImage(imageUrl)
      
      // 计算裁剪（保持比例，填满圆形）
      const size = (radius - 2) * 2
      const scale = Math.max(size / img.width, size / img.height)
      const scaledW = img.width * scale
      const scaledH = img.height * scale
      const x = centerX - scaledW / 2
      const y = centerY - scaledH / 2
      
      ctx.drawImage(img, x, y, scaledW, scaledH)
    } else {
      // 没有图片时使用emoji图标
      const iconMap = {
        'FIRE': '🔥',
        'FLOOD': '🌊',
        'EARTHQUAKE': '🏚️',
        'LANDSLIDE': '⛰️',
        'DAMAGE': '⚠️',
        'OTHER': '📍'
      }
      const icon = iconMap[disaster.disasterType] || '🚨'
      ctx.font = 'bold 28px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(icon, centerX, centerY)
    }
  } catch {
    // 图片加载失败时用emoji
    const iconMap = {
      'FIRE': '🔥',
      'FLOOD': '🌊',
      'EARTHQUAKE': '🏚️',
      'LANDSLIDE': '⛰️',
      'DAMAGE': '⚠️',
      'OTHER': '📍'
    }
    const icon = iconMap[disaster.disasterType] || '🚨'
    ctx.font = 'bold 28px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(icon, centerX, centerY)
  }
  
  ctx.restore()
  
  // 3. 底部警告标识（黄色三角形+感叹号）
  const warningY = 62
  const warningR = 14
  
  // 黄色圆形背景
  ctx.beginPath()
  ctx.arc(centerX, warningY, warningR, 0, Math.PI * 2)
  ctx.fillStyle = '#FFD700'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke()
  
  // 红色感叹号
  ctx.font = 'bold 18px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#FF0000'
  ctx.fillText('!', centerX, warningY + 1)
  
  return canvas.toDataURL()
}

// 添加单个灾情点（带涟漪效果）
async function addDisasterPoint(disaster) {
  if (!viewer) return
  
  const lon = disaster.lon
  const lat = disaster.lat
  const level = disaster.impactLevel || 1
  const radius = disaster.impactRadiusM || 100
  const status = disaster.status || '待审核'
  const colorStr = disaster.color || '#FFD700'
  
  const color = Cesium.Color.fromCssColorString(colorStr)
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, 10)
  
  // 生成自定义图标（异步）
  const iconUrl = await createDisasterIcon(disaster)
  
  // 1. 中心点实体（使用自定义图标Billboard）
  const centerEntity = viewer.entities.add({
    _isDisaster: true,
    _disasterId: disaster.disasterId,
    position: position,
    billboard: {
      image: iconUrl,
      width: level === 3 ? 56 : level === 2 ? 48 : 40,
      height: level === 3 ? 70 : level === 2 ? 60 : 50,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      scale: 1.0,
    },
    description: `
      <div style="font-family: system-ui; padding: 10px;">
        <h3 style="margin: 0 0 10px 0; color: ${colorStr};">${disaster.typeName || '灾情'}</h3>
        <p><strong>等级:</strong> ${level}级 (${['轻度', '中度', '重度'][level-1]})</p>
        <p><strong>状态:</strong> ${status}</p>
        <p><strong>时间:</strong> ${new Date(disaster.reportedAt).toLocaleString()}</p>
        <p><strong>位置:</strong> ${lat.toFixed(4)}, ${lon.toFixed(4)}</p>
        ${disaster.description ? `<p><strong>描述:</strong> ${disaster.description}</p>` : ''}
        ${disaster.confirmCount > 1 ? `<p><strong>确认人数:</strong> ${disaster.confirmCount}人</p>` : ''}
      </div>
    `,
  })
  
  // 2. 实际影响范围（半透明填充）
  const impactEntity = viewer.entities.add({
    _isDisaster: true,
    position: position,
    ellipse: {
      semiMinorAxis: radius,
      semiMajorAxis: radius,
      material: color.withAlpha(status === '待审核' ? 0.1 : 0.2),
      outline: true,
      outlineColor: status === '待审核' ? Cesium.Color.GRAY : color,
      outlineWidth: status === '待审核' ? 2 : 3,
    },
  })
  
  // 3. 动态涟漪效果（仅对活跃灾情）
  if (status === '已确认' || status === '已通过') {
    const rippleRadius = radius * 1.2
    const rippleEntities = []
    
    // 创建3个涟漪环
    for (let i = 0; i < 3; i++) {
      const entity = viewer.entities.add({
        _isDisaster: true,
        position: position,
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const offset = (i * 0.33) % 1
            const cycle = (time.secondsOfDay % 2) / 2
            const progress = (cycle + offset) % 1
            return rippleRadius * progress
          }, false),
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const offset = (i * 0.33) % 1
            const cycle = (time.secondsOfDay % 2) / 2
            const progress = (cycle + offset) % 1
            return rippleRadius * progress
          }, false),
          material: color.withAlpha(0),
          outline: true,
          outlineColor: new Cesium.CallbackProperty((time) => {
            const offset = (i * 0.33) % 1
            const cycle = (time.secondsOfDay % 2) / 2
            const progress = (cycle + offset) % 1
            const alpha = (1 - progress) * 0.6
            return color.withAlpha(alpha)
          }, false),
          outlineWidth: 2,
        },
      })
      rippleEntities.push(entity)
    }
  }
  
  return centerEntity
}

// 加载并展示所有灾情
async function loadDisasters() {
  if (!viewer) return
  
  try {
    const response = await axios.get(`${API_BASE}/disaster/list`)
    if (!response.data.success) return
    
    const disasters = response.data.data
    
    // 清除旧数据
    clearDisasters()
    
    // 添加所有灾情点（使用for...of配合await）
    for (const d of disasters) {
      if (d.status !== '已驳回') {  // 不显示已驳回的
        await addDisasterPoint(d)
      }
    }
    
    console.log(`已加载 ${disasters.length} 条灾情数据`)
  } catch (err) {
    console.error('加载灾情失败:', err)
  }
}

// 加载 OSM 3D 建筑（全球免费数据集）
let osmBuildingsTileset = null

// 全局存储OSM建筑名称（用于MapView去重）
const osmBuildingNamesGlobal = new Set()
let osmNameCollectionStartedGlobal = false

async function loadOsmBuildings() {
  if (!viewer) return
  
  try {
    // 检查是否已存在
    if (osmBuildingsTileset) {
      viewer.scene.primitives.remove(osmBuildingsTileset)
    }
    
    // 创建 OSM 建筑数据集（使用 Cesium Ion 的免费数据集）
    osmBuildingsTileset = await Cesium.createOsmBuildingsAsync()
    
    // 设置样式 - 让建筑更有立体感（使用地形后建筑会自动贴地）
    osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
      color: 'color("#e0e0e0", 0.8)',
      show: true
    })
    
    viewer.scene.primitives.add(osmBuildingsTileset)
    
    // 立即设置 tileLoad 事件监听，实时收集建筑名称
    if (!osmNameCollectionStartedGlobal) {
      osmNameCollectionStartedGlobal = true
      let totalCollected = 0
      osmBuildingsTileset.tileLoad.addEventListener((tile) => {
        if (tile.content && tile.content.featuresLength > 0) {
          let tileNamesCount = 0
          for (let j = 0; j < tile.content.featuresLength; j++) {
            try {
              const feature = tile.content.getFeature(j)
              if (feature && feature.getProperty) {
                const name = feature.getProperty('name')
                if (name && typeof name === 'string' && name.trim()) {
                  osmBuildingNamesGlobal.add(name.trim())
                  tileNamesCount++
                  totalCollected++
                }
              }
            } catch (e) {
              // 忽略单个feature错误
            }
          }
          if (tileNamesCount > 0) {
            console.log(`[CesiumMap] Tile加载完成，收集到 ${tileNamesCount} 个名称，总计: ${totalCollected} 个`)
          }
        }
      })
      console.log('[CesiumMap] 已为OSM tileset设置名称收集监听')
    }
    
    console.log('OSM 3D 建筑加载完成')
  } catch (err) {
    console.warn('OSM 3D 建筑加载失败:', err)
  }
}

// 导出获取OSM建筑名称的方法
function getOSMBuildingNames() {
  return osmBuildingNamesGlobal
}

// 聚焦到指定灾情
function focusDisaster(disaster) {
  if (!viewer || !disaster) return
  
  const lon = disaster.lon
  const lat = disaster.lat
  const radius = disaster.impactRadiusM || 100
  
  // 飞行动画
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(radius * 3, 2000)),
    orientation: {
      heading: Cesium.Math.toRadians(270),
      pitch: Cesium.Math.toRadians(-50),
      roll: 0
    },
    duration: 1.5
  })
  
  // 高亮显示该灾情实体
  const targetEntity = viewer.entities.values.find(e => 
    e._isDisaster && e._disasterId === disaster.disasterId
  )
  if (targetEntity) {
    viewer.selectedEntity = targetEntity
  }
}

// 监听灾情聚焦事件
defineExpose({
  resetView,
  startDistanceMeasure,
  startAreaMeasure,
  clearDrawings,
  setBaseLayer,
  setVisibleCategories,
  setRoadsVisible,
  setHeatmapVisible,
  loadHeatmap,
  setCoverageVisible,
  getCoverageStats,
  setAccessibilityVisible,
  setIsochroneVisible,
  getAccessibilityStats,
  getIsochroneLoading,
  getUserLocation,
  focusFacilityByLonLat,
  loadDisasters,
  clearDisasters,
  runSiteSelectionAnalysis,
  clearSiteSelection,
  setViewshedVisible,
  loadOsmBuildings,
  getOSMBuildingNames,
  reloadFacilities,
  getViewer: () => viewer,
  getHeatmapData: () => heatmapDataSource?.entities?.values?.map(e => ({
    id: e.id,
    lon: e.properties?.longitude?.getValue(),
    lat: e.properties?.latitude?.getValue(),
    density: e.properties?.density?.getValue()
  })) || []
})

// ==================== 灾情定位处理 ====================

const handleDisasterFocus = (event) => {
  const { lon, lat, impactRadius, status } = event.detail
  console.log('[CesiumMap] 灾情定位:', { lon, lat, impactRadius, status })

  if (!viewer) {
    console.error('[CesiumMap] viewer不存在')
    return
  }

  const radius = impactRadius || 100
  const height = Math.max(radius * 3, 500)
  const destination = Cesium.Cartesian3.fromDegrees(lon, lat, height)

 

  // 如果是已驳回的灾情，临时添加标记
  let tempMarker = null
  if (status === '已驳回') {
    tempMarker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 20,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      label: {
        text: '已驳回灾情',
        font: '16px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20)
      }
    })
  }

  // 解锁相机，解决flyTo失效问题
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

  viewer.camera.flyTo({
    destination: destination,
    orientation: {
      heading: Cesium.Math.toRadians(180),
      pitch: Cesium.Math.toRadians(-80),
      roll: 0
    },
    duration: 1.5,
    cancelAnimation: true,
    complete: () => {
      console.log('[CesiumMap] 飞行完成')
      // 5秒后移除临时标记
      if (tempMarker) {
        setTimeout(() => {
          viewer.entities.remove(tempMarker)
        }, 5000)
      }
    }
  })

  console.log('[CesiumMap] flyTo命令已发送')
}

onMounted(async () => {
  if (!mapContainer.value) return

  const container = mapContainer.value
  
  // 添加灾情定位事件监听
  window.addEventListener('disaster-focus', handleDisasterFocus)
  
  // 使用 ResizeObserver 等待容器获得有效尺寸
  const waitForSize = () => new Promise((resolve) => {
    const checkSize = () => {
      const w = container.clientWidth || container.offsetWidth
      const h = container.clientHeight || container.offsetHeight
      if (w > 0 && h > 0) {
        resolve({ w, h })
      } else {
        setTimeout(checkSize, 100)
      }
    }
    checkSize()
  })

  // 同时设置一个超时兜底
  const size = await Promise.race([
    waitForSize(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
  ]).catch(() => {
    // 超时后使用硬编码的最小尺寸强制初始化
    console.warn('ResizeObserver timeout, forcing initialization with min size')
    return { w: 600, h: 500 }
  })

  console.log(`Cesium container ready: ${size.w}x${size.h}`)
  
  // 强制设置固定像素尺寸，确保容器有实际大小
  if (container.clientWidth === 0 || container.clientHeight === 0) {
    console.warn('Cesium container has zero size, setting fixed dimensions...')
    // 直接设置固定像素尺寸
    container.style.width = '1000px'
    container.style.height = '700px'
    container.style.minWidth = '1000px'
    container.style.minHeight = '700px'
    
    // 强制布局更新
    container.style.position = 'absolute'
    container.style.top = '0'
    container.style.left = '0'
  }
  
  // 再等待一次渲染周期
  await new Promise(resolve => setTimeout(resolve, 300))
  
  // 最终检查
  if (container.clientWidth === 0 || container.clientHeight === 0) {
    console.error('Cesium container still has zero size, cannot initialize')
    return
  }

  console.log(`Cesium container size: ${container.clientWidth}x${container.clientHeight}`)

  // 创建Viewer - 使用世界地形使建筑正确贴地
  viewer = new Cesium.Viewer(mapContainer.value, {
    timeline: false,
    animation: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    // 使用世界地形（建筑会自动适配地形高度）
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    // 禁用渲染错误弹窗
    useDefaultRenderLoop: true
  })

  // 禁用默认的错误弹窗
  viewer.cesiumWidget.showRenderLoopErrors = false

  // 添加渲染错误处理
  viewer.scene.renderError.addEventListener((scene, error) => {
    console.error('Cesium render error:', error)
    // 尝试恢复渲染
    try {
      viewer.resize()
    } catch (e) {
      console.error('Failed to resize:', e)
    }
  })

  // 添加窗口resize处理，确保canvas不会变成0尺寸
  const handleResize = () => {
    if (!viewer || !container) return
    
    // 检查容器尺寸
    const w = container.clientWidth
    const h = container.clientHeight
    
    // 如果尺寸为0，设置最小尺寸
    if (w === 0 || h === 0) {
      console.warn(`Container size is ${w}x${h}, setting min size`)
      container.style.width = '100%'
      container.style.height = '100%'
      container.style.minWidth = '600px'
      container.style.minHeight = '400px'
    }
    
    // 触发viewer resize
    try {
      viewer.resize()
    } catch (e) {
      console.error('Resize error:', e)
    }
  }
  
  window.addEventListener('resize', handleResize)
  
  // 使用ResizeObserver监控容器尺寸变化
  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width === 0 || height === 0) {
          console.warn('Container resized to 0, forcing min size')
          container.style.minWidth = '600px'
          container.style.minHeight = '400px'
        }
      }
      // 触发Cesium resize
      if (viewer) {
        viewer.resize()
      }
    })
    resizeObserver.observe(container)
  }
  
  // 保存引用用于清理
  container._resizeHandler = handleResize
  container._resizeObserver = resizeObserver

  // 记录默认底图提供者，便于之后切换回默认底图
  if (viewer.imageryLayers.length > 0) {
    defaultImageryProvider = viewer.imageryLayers.get(0).imageryProvider
  }

  // 内存缓存优化：增加瓦片缓存数量提升同页面内的重复访问速度
  viewer.scene.globe.tileCacheSize = 200

  // 添加点击事件监听器，向父组件传递点击事件
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement) => {
    const pickedPosition = viewer.scene.pickPosition(movement.position)
    if (!pickedPosition) return

    const cartographic = Cesium.Cartographic.fromCartesian(pickedPosition)
    const lon = Cesium.Math.toDegrees(cartographic.longitude)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    
    // 向父组件传递点击信息
    emit('on-click', {
      lon: lon,
      lat: lat,
      height: cartographic.height,
      position: pickedPosition
    })
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 飞到淄博张店附近上空 - 带倾斜角度的3D视角
  // 视角朝向西（heading 270/-90），这样太阳从东边升起
  // 基于福宁居民小区坐标(118.023, 36.812)调整，向右下角偏移显示更多设施
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(118.010, 36.920, 9000),
    orientation: {
      heading: Cesium.Math.toRadians(-180),  // 朝向西（太阳从东边升起）
      pitch: Cesium.Math.toRadians(-40),    // 俯视角度 -35度（更平缓）
      roll: 0
    },
    duration: 3 // 3秒飞行动画
  })

  // 默认加载设施点和路网，热力图等分析图层用户自己开启
  try {
    await loadFacilities()
  } catch (e) {
    console.error('加载设施点失败', e)
  }
  try {
    await loadRoads()
  } catch (e) {
    console.error('加载路网失败', e)
  }
  // 加载 OSM 3D 建筑（可选，失败不影响主要功能）
  try {
    await loadOsmBuildings()
  } catch (e) {
    console.warn('加载 OSM 建筑失败:', e)
  }
  // 加载等时圈 - 由 MapView 控制，这里不自动加载

  // 如果从设施列表页跳转而来，且预先写入了待聚焦设施，则在初始化后自动飞到该点
  if (typeof window !== 'undefined' && window.__pendingFacilityFocus) {
    try {
      const f = window.__pendingFacilityFocus
      if (f && f.lon != null && f.lat != null) {
        // 飞到设施位置（与定位视角保持一致）
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(f.lon, f.lat + 0.003, 1000),
          orientation: {
            heading: Cesium.Math.toRadians(180),
            pitch: Cesium.Math.toRadians(-70),
            roll: 0
          },
          duration: 2
        })
      }
    } catch (e) {
      console.error('自动聚焦设施失败', e)
    }
    window.__pendingFacilityFocus = null
  }

  // 监听来自设施列表页面的新增事件
  onFacilityAdded = (evt) => {
    const f = evt.detail
    if (!f || f.lon == null || f.lat == null) return
    const entity = addFacilityPoint(f)
    if (entity) {
      // 飞到新增设施位置（与定位视角保持一致）
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(f.lon, f.lat + 0.003, 1000),
        orientation: {
          heading: Cesium.Math.toRadians(180),
          pitch: Cesium.Math.toRadians(-70),
          roll: 0
        },
        duration: 2
      })
      viewer.selectedEntity = entity
    }
  }

  window.addEventListener('facility-added', onFacilityAdded)

  // 监听删除设施事件
  onFacilityRemoved = (evt) => {
    const f = evt.detail
    if (!f) return
    const toRemove = viewer.entities.values.find((e) => {
      const p = e.position
      if (!p) return false
      const cart = Cesium.Cartographic.fromCartesian(p._value || p.getValue?.(Cesium.JulianDate.now()))
      if (!cart) return false
      const lon = Cesium.Math.toDegrees(cart.longitude)
      const lat = Cesium.Math.toDegrees(cart.latitude)
      const sameName = !f.name || e.label?.text?.getValue?.() === f.name
      return Math.abs(lon - f.lon) < 1e-4 && Math.abs(lat - f.lat) < 1e-4 && sameName
    })
    if (toRemove) {
      viewer.entities.remove(toRemove)
    }
  }

  window.addEventListener('facility-removed', onFacilityRemoved)

  // 监听灾情聚焦和刷新事件
  window.addEventListener('disaster-refresh', loadDisasters)

  // 初始加载灾情数据
  loadDisasters()

  onFacilityFocused = (evt) => {
    if (!viewer) return
    const f = evt.detail
    if (!f || f.lon == null || f.lat == null) return

    const lon = Number(f.lon)
    const lat = Number(f.lat)
    if (Number.isNaN(lon) || Number.isNaN(lat)) return

    // 如果视域分析开启，将该设施点设为观察点
    if (viewshedActive) {
      calculateViewshed({ lon, lat })
    }

    // 辅助函数：查找设施实体
    const findTargetEntity = () => {
      let targetEntity = null
      if (f.id != null) {
        targetEntity = viewer.entities.values.find((e) => e.properties?.id?.getValue?.() === f.id)
      }
      if (!targetEntity) {
        targetEntity = viewer.entities.values.find((e) => {
          const p = e.position
          if (!p) return false
          const cart = Cesium.Cartographic.fromCartesian(
            p._value || p.getValue?.(Cesium.JulianDate.now())
          )
          if (!cart) return false
          const elon = Cesium.Math.toDegrees(cart.longitude)
          const elat = Cesium.Math.toDegrees(cart.latitude)
          return Math.abs(elon - lon) < 1e-4 && Math.abs(elat - lat) < 1e-4
        })
      }
      return targetEntity
    }

    // 飞到设施位置（与定位视角保持一致：朝南、俯视70度、高度1000米）
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat + 0.003, 1000),
      orientation: {
        heading: Cesium.Math.toRadians(180),
        pitch: Cesium.Math.toRadians(-70),
        roll: 0
      },
      duration: 2
    })

    // 立即尝试查找并选中实体
    let targetEntity = findTargetEntity()
    if (targetEntity) {
      viewer.selectedEntity = targetEntity
      return
    }

    // 如果未找到（设施数据可能还在加载），延迟重试
    const trySelectEntity = (attempts = 0) => {
      if (attempts > 10) {
        // 最多重试10次（约2秒），如果仍未找到，创建临时实体显示详情
        const tempEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 10),
          point: {
            pixelSize: 12,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: f.name || '设施位置',
            font: 'bold 14pt sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          properties: {
            id: f.id,
            name: f.name,
            type: f.type,
            address: f.address,
            longitude: lon.toFixed(6),
            latitude: lat.toFixed(6)
          }
        })
        viewer.selectedEntity = tempEntity
        return
      }

      targetEntity = findTargetEntity()
      if (targetEntity) {
        viewer.selectedEntity = targetEntity
      } else {
        setTimeout(() => trySelectEntity(attempts + 1), 200)
      }
    }

    // 延迟开始重试，等待设施数据加载
    setTimeout(() => trySelectEntity(0), 300)
  }

  window.addEventListener('facility-focus', onFacilityFocused)

  // 鼠标悬停高亮 + 点击选中显示 infoBox
  hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

  hoverHandler.setInputAction((movement) => {
    const pickedObject = viewer.scene.pick(movement.endPosition)

    // 还原上一次高亮
    if (highlighted.entity && highlighted.originalColor) {
      highlighted.entity.point.color = highlighted.originalColor
      highlighted.entity = undefined
      highlighted.originalColor = undefined
    }

    if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.point) {
      const entity = pickedObject.id
      highlighted.entity = entity
      highlighted.originalColor = entity.point.color.getValue()
      entity.point.color = Cesium.Color.YELLOW.withAlpha(1.0)
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  hoverHandler.setInputAction((click) => {
    // 测量模式下，点击事件由 measureHandler 处理，这里只负责普通选中
    if (measureMode) return
    const pickedObject = viewer.scene.pick(click.position)
    let clickedLonLat = null

    // 1) 点击到实体：设施点/用户定位点/（可能还有等时圈起点标记）
    if (Cesium.defined(pickedObject) && pickedObject.id) {
      clickedLonLat = getEntityLonLat(pickedObject.id)

      // 检查是否是用户位置标记（用于 infoBox 详情）
      const typeProp = pickedObject.id.properties?.type
      const typeVal =
        typeof typeProp?.getValue === 'function' ? typeProp.getValue(Cesium.JulianDate.now()) : typeProp
      if (typeVal === 'userLocation') {
        const entity = pickedObject.id
        const now = Cesium.JulianDate.now()
        const lonProp = entity.properties?.longitude
        const latProp = entity.properties?.latitude
        const lonVal = typeof lonProp?.getValue === 'function' ? lonProp.getValue(now) : lonProp
        const latVal = typeof latProp?.getValue === 'function' ? latProp.getValue(now) : latProp
        
        // 如果视域分析开启且有坐标，计算视域
        if (viewshedActive && lonVal && latVal) {
          calculateViewshed({ lon: Number(lonVal), lat: Number(latVal) })
        }
        
        entity.name = '地点详情'
        entity.description = `
          <div style="padding: 10px;">
            <p><strong>您的位置</strong></p>
            <p><strong>经度：</strong>${lonVal}°</p>
            <p><strong>纬度：</strong>${latVal}°</p>
            <p style="color: #666; font-size: 12px;">点击定位按钮可重新定位</p>
          </div>
        `
        viewer.selectedEntity = entity
      } else {
        // 检查是否是设施点实体
        const entity = pickedObject.id
        if (entity && entity.position && viewshedActive) {
          const cart = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()))
          if (cart) {
            const lon = Cesium.Math.toDegrees(cart.longitude)
            const lat = Cesium.Math.toDegrees(cart.latitude)
            calculateViewshed({ lon, lat })
          }
        }
        viewer.selectedEntity = pickedObject.id
      }
    } else {
      // 2) 点击空白：用 pickPosition 或 globe.pick 得到地表坐标，作为等时圈起点
      try {
        // 先尝试 pickPosition（需要地形深度信息）
        let cartesian = viewer.scene.pickPosition(click.position)
        
        // 如果 pickPosition 失败，使用 globe.pick 作为备选
        if (!cartesian && viewer.scene.globe) {
          const ray = viewer.camera.getPickRay(click.position)
          if (ray) {
            cartesian = viewer.scene.globe.pick(ray, viewer.scene)
          }
        }
        
        if (cartesian) {
          const cart = Cesium.Cartographic.fromCartesian(cartesian)
          const lon = Cesium.Math.toDegrees(cart.longitude)
          const lat = Cesium.Math.toDegrees(cart.latitude)
          if (Number.isFinite(lon) && Number.isFinite(lat)) clickedLonLat = { longitude: lon, latitude: lat }
        }
      } catch {
        // ignore
      }
    }

    if (clickedLonLat) {
      // 只有在"等待用户确定起点"的阶段，才把点击当作起点
      if (isochroneActive && isochroneOriginPicking) {
        setIsochroneOriginFromLonLat(clickedLonLat.longitude, clickedLonLat.latitude)
        // 空白点击时给一个可视化反馈：选中起点标记
        if (!pickedObject && isochroneOriginMarker) viewer.selectedEntity = isochroneOriginMarker
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
})

onBeforeUnmount(() => {
  // 移除灾情定位事件监听
  window.removeEventListener('disaster-focus', handleDisasterFocus)
  
  // 清理resize handler和observer
  if (mapContainer.value) {
    const container = mapContainer.value
    if (container._resizeHandler) {
      window.removeEventListener('resize', container._resizeHandler)
    }
    if (container._resizeObserver) {
      container._resizeObserver.disconnect()
    }
  }
  
  if (viewer) {
    viewer.destroy()
    viewer = undefined
  }
  if (hoverHandler) {
    hoverHandler.destroy()
    hoverHandler = undefined
  }
  if (measureHandler) {
    measureHandler.destroy()
    measureHandler = undefined
  }
  if (clickHandler) {
    clickHandler.destroy()
    clickHandler = undefined
  }
  if (typeof window !== 'undefined') {
    if (onFacilityAdded) {
      window.removeEventListener('facility-added', onFacilityAdded)
    }
    if (onFacilityRemoved) {
      window.removeEventListener('facility-removed', onFacilityRemoved)
    }
    if (onFacilityFocused) {
      window.removeEventListener('facility-focus', onFacilityFocused)
    }
    // 移除灾情事件监听
    window.removeEventListener('disaster-refresh', loadDisasters)
  }
})
</script>

<template>
  <div ref="mapContainer" class="cesium-container"></div>
</template>

<style scoped>
.cesium-container {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 600px;
  min-height: 500px;
  position: relative;
  overflow: hidden;
  background: #000;
}

.cesium-container :deep(.cesium-widget) {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0;
  left: 0;
}

.cesium-container :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
  min-width: 600px;
  min-height: 500px;
}
</style>
