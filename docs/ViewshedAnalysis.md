<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import axios from 'axios'

// Cesium Ion token
Cesium.Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYmZmMWRmOS0yY2RlLTQ0NjMtOGE5Yy02OWM3MWM3MTc2ZGUiLCJpZCI6MzkzMjQ1LCJpYXQiOjE3NzE4MzI4NDV9.gXXxAwMo31mBsVDlfvQC4lfvX0gQo_6xZvysYzmq5r4'

// API基础地址
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

const mapContainer = ref(null)
let viewer = null
let buildingsDataSource = null
let facilitiesLoaded = false

// 设施类型颜色映射
const categoryColors = {
  hospital: Cesium.Color.fromCssColorString('#ef4444'), // 红色
  school: Cesium.Color.fromCssColorString('#10b981'), // 绿色
  shelter: Cesium.Color.fromCssColorString('#f59e0b'), // 橙色
  resident: Cesium.Color.fromCssColorString('#22d3ee'), // 青色
  commercial: Cesium.Color.fromCssColorString('#eab308'), // 黄色
  other: Cesium.Color.fromCssColorString('#9333ea'), // 紫色
}

// 设施类型高度映射（用于面数据拉伸）
const categoryHeights = {
  hospital: 60,
  school: 35,
  shelter: 40,
  resident: 30,
  commercial: 70,
  other: 40,
}

// 热力图相关变量
let heatmapDataSource = null
const heatmapVisible = ref(false)

// 视域分析相关变量
const viewshedActive = ref(false)
let viewshedObserverPosition = null
let viewshedRadius = 2000 // 视域半径（米）
const viewshedHeight = ref(30) // 观察高度（米），默认30m，可调

// ==================== 淹没分析相关变量 ====================
const floodActive = ref(false)
const floodCenterPosition = ref(null)  // 淹没中心点（响应式）
const floodWaterLevel = ref(5)   // 默认水深5米（0-5米范围）位高度（米）
const FLOOD_RADIUS = 2000       // 分析半径2000米

// ==================== 动态水流模拟参数 ====================
const floodFlowRate = ref(100)     // 流量：立方米/秒
const floodSimSpeed = ref(1)       // 模拟速度倍率
const floodAnimationRunning = ref(false)  // 动画运行状态
const floodCurrentTime = ref(0)    // 当前模拟时间（秒）
const floodWaterVolume = ref(0)    // 累计水量（立方米）

// 可视化实体
let floodCenterEntity = null    // 中心点标记
let floodStats = ref({          // 统计数据
  totalBuildings: 0,           // 范围内总建筑物数
  floodedBuildings: 0,         // 被淹没建筑物数
  floodedArea: 0               // 被淹没总占地面积(m²)
})

// 状态追踪（用于差量更新）
let previousFloodedIds = new Set()  // 上次被淹没的建筑ID集合
let floodDebounceTimer = null        // 防抖定时器

// 水面平面实体
let floodWaterPlane = null

// 调试线条实体（用于可视化阻挡检测）
let floodDebugLines = []

// 动态水流模拟相关
let floodAnimationFrame = null   // 动画帧ID
let floodStartTime = null        // 动画开始时间
let floodWaterFrontEntities = [] // 水波前锋实体数组（用于动画效果）
let floodedBuildingWaterDepths = new Map()  // 每个建筑的水深记录
let floodTotalSpreadDistance = 0 // 累积的水流扩散距离（米）

// 创建动态水面材质（带流动纹理）
function createWaterSurfaceMaterial() {
  // 使用Cesium内置水材质或创建自定义流动材质
  return new Cesium.ImageMaterialProperty({
    image: '/water-texture.png', // 水纹纹理图片
    color: new Cesium.Color(0, 0.4, 0.8, 0.7),
    repeat: new Cesium.Cartesian2(20, 20),
    transparent: true
  })
}

// 创建动态水面材质（使用Checkerboard模拟流动效果）
function createDynamicWaterMaterial() {
  return new Cesium.Material({
    fabric: {
      type: 'Water',
      uniforms: {
        baseWaterColor: new Cesium.Color(0.0, 0.4, 0.8, 0.7),
        blendColor: new Cesium.Color(0.0, 0.4, 0.8, 0.7),
        specularMap: null,
        normalMap: null,
        frequency: 1000.0,
        animationSpeed: 0.01,
        amplitude: 5.0,
        specularIntensity: 0.5
      }
    }
  })
}

function normalizeCategory(rawType) {
  const t = (rawType || '').toLowerCase()
  if (t.includes('hospital') || t.includes('医院') || t.includes('医疗')) return 'hospital'
  if (t.includes('school') || t.includes('学校') || t.includes('教育') || t.includes('小学') || t.includes('中学')) return 'school'
  if (t.includes('shelter') || t.includes('避难') || t.includes('应急')) return 'shelter'
  if (t.includes('居民') || t.includes('小区') || t.includes('社区') || t.includes('住宅')) return 'resident'
  if (t.includes('商业') || t.includes('商场') || t.includes('超市') || t.includes('mall') || t.includes('购物')) return 'commercial'
  return 'other'
}

// 添加设施点
function addFacilityPoint(f) {
  if (!viewer) return
  if (f.lon == null || f.lat == null) return

  const category = normalizeCategory(f.type)
  const color = categoryColors[category] || categoryColors.other

  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 15),
    point: {
      pixelSize: 12,
      color: color.withAlpha(0.9),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: f.name || '',
      font: '12pt sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -15),
      show: false,
    },
    name: f.name || '设施',
    description: `
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold;">名称</td><td style="padding:5px;border:1px solid #ddd;">${f.name || ''}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold;">类型</td><td style="padding:5px;border:1px solid #ddd;">${f.type || ''}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold;">经度</td><td style="padding:5px;border:1px solid #ddd;">${f.lon}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold;">纬度</td><td style="padding:5px;border:1px solid #ddd;">${f.lat}</td></tr>
      </table>
    `,
    properties: {
      type: f.type || '',
      category,
    },
  })

  return entity
}

// 加载后端设施数据
async function loadFacilities() {
  if (!viewer || facilitiesLoaded) return

  try {
    const res = await axios.get(`${API_BASE}/facilities`)
    const facilities = res.data || []

    facilities.forEach((f) => {
      addFacilityPoint(f)
    })

    facilitiesLoaded = true
    console.log(`已加载 ${facilities.length} 个设施点`)
  } catch (err) {
    console.error('加载设施数据失败', err)
  }
}

// GCJ-02 转 WGS84 坐标转换（中国地图数据常用）
function gcj02ToWgs84(lng, lat) {
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

  return { lng: lng * 2 - mglng, lat: lat * 2 - mglat }
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng, lat) {
  const pi = 3.14159265358979324
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * pi) + 40.0 * Math.sin((lat / 3.0) * pi)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * pi) + 320 * Math.sin((lat * pi) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(lng, lat) {
  const pi = 3.14159265358979324
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * pi) + 40.0 * Math.sin((lng / 3.0) * pi)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * pi) + 300.0 * Math.sin((lng / 30.0) * pi)) * 2.0) / 3.0
  return ret
}

// 6类设施GeoJSON配置
const buildingFiles = [
  { name: '教育服务', category: 'school', url: '/data/教育服务.geojson' },
  { name: '居民小区', category: 'resident', url: '/data/居民小区.geojson' },
  { name: '其他设施', category: 'other', url: '/data/其他设施1.geojson' },
  { name: '商业商场', category: 'commercial', url: '/data/商业商场.geojson' },
  { name: '医疗卫生', category: 'hospital', url: '/data/医疗卫生.geojson' },
  { name: '应急避难', category: 'shelter', url: '/data/应急避难.geojson' },
]

// 加载所有GeoJSON面数据并拉伸为3D建筑
async function loadAllBuildings() {
  if (!viewer) return

  let totalLoaded = 0

  for (const file of buildingFiles) {
    try {
      const color = categoryColors[file.category] || categoryColors.other
      const height = categoryHeights[file.category] || 25

      const dataSource = await Cesium.GeoJsonDataSource.load(file.url, {
        stroke: Cesium.Color.TRANSPARENT,
        fill: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
      })

      await viewer.dataSources.add(dataSource)

      // 遍历实体并拉伸
      let successCount = 0
      let failCount = 0
      dataSource.entities.values.forEach((entity, index) => {
        if (!entity.polygon) {
          console.warn(`${file.name} 第${index}个实体没有polygon`)
          return
        }

        try {
          // 检查多边形是否有效
          const hierarchy = entity.polygon.hierarchy?.getValue?.()
          if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) {
            console.warn(`${file.name} 第${index}个实体多边形顶点不足`)
            failCount++
            return
          }

          // 转换坐标：GCJ-02 -> WGS84
          const newPositions = hierarchy.positions.map((cartesian) => {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
            const lng = Cesium.Math.toDegrees(cartographic.longitude)
            const lat = Cesium.Math.toDegrees(cartographic.latitude)
            const wgs84 = gcj02ToWgs84(lng, lat)
            return Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat, 0)
          })
          entity.polygon.hierarchy = new Cesium.PolygonHierarchy(newPositions)

          // 设置拉伸样式 - 贴地显示
          entity.polygon.extrudedHeight = height
          entity.polygon.height = 0
          entity.polygon.heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND
          entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND
          // 确保 color 是 Cesium.Color 类型
          let safeColor = Cesium.Color.WHITE
          if (color instanceof Cesium.Color) {
            safeColor = color
          } else if (typeof color === 'string') {
            safeColor = Cesium.Color.fromCssColorString(color)
          }
          entity.polygon.material = safeColor.withAlpha(0.55)
          entity.polygon.outline = true
          entity.polygon.outlineColor = safeColor.withAlpha(0.85)
          entity.polygon.outlineWidth = 1
          entity.polygon.classificationType = Cesium.ClassificationType.BOTH

          // 添加属性标记
          entity.properties = entity.properties || {}
          if (!entity.properties.category) {
            entity.properties.category = file.category
          }
          successCount++
        } catch (err) {
          console.error(`${file.name} 第${index}个实体处理失败:`, err.message)
          failCount++
        }
      })

      console.log(`${file.name}: 成功${successCount}个, 失败${failCount}个`)

      totalLoaded += dataSource.entities.values.length
      console.log(`加载 ${file.name}: ${dataSource.entities.values.length} 个面`)
    } catch (err) {
      console.warn(`加载 ${file.name} 失败:`, err.message)
    }
  }

  console.log(`共加载 ${totalLoaded} 个3D建筑面`)
}

// 初始化Cesium场景
async function initCesium() {
  if (!mapContainer.value) return

  // 确保容器有尺寸
  const container = mapContainer.value
  if (container.clientWidth === 0 || container.clientHeight === 0) {
    console.warn('Container size is 0, forcing min size')
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.minWidth = '800px'
    container.style.minHeight = '600px'
  }

  // 等待一下确保DOM渲染完成
  await new Promise(resolve => setTimeout(resolve, 100))

  viewer = new Cesium.Viewer(mapContainer.value, {
    timeline: false,
    animation: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    // 使用世界地形
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    // 使用Cesium默认底图（Bing Maps卫星影像）
    useDefaultRenderLoop: true,
  })

  // 禁用渲染错误弹窗
  viewer.cesiumWidget.showRenderLoopErrors = false

  // 内存缓存优化
  viewer.scene.globe.tileCacheSize = 200

  // 绑定点击事件（用于视域分析）
  viewer.screenSpaceEventHandler.setInputAction(handleMapClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 飞到淄博张店附近上空 - 与MapView一致的视角
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(118.010, 36.920, 9000),
    orientation: {
      heading: Cesium.Math.toRadians(-180),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
    duration: 1.5,
  })

  // 启用深度测试
  viewer.scene.globe.depthTestAgainstTerrain = true

  // 加载设施数据
  await loadFacilities()

  // 加载6类3D建筑面数据
  await loadAllBuildings()
}

// 重置视角
function resetView() {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(118.060, 36.810, 8000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-50),
      roll: 0,
    },
    duration: 1.5,
  })
}

onMounted(() => {
  initCesium()
})

onBeforeUnmount(() => {
  // 清理淹没分析
  clearFlood()
  if (floodDebounceTimer) {
    clearTimeout(floodDebounceTimer)
  }

  if (viewer) {
    viewer.destroy()
    viewer = null
  }
})

// 热力图显示/隐藏控制
function setHeatmapVisible(visible) {
  if (visible) {
    // 激活热力图时关闭淹没分析（互斥）
    if (floodActive.value) {
      floodActive.value = false
      clearFlood()
    }
    loadHeatmap()
  } else if (heatmapDataSource) {
    heatmapDataSource.show = false
  }
}

// 切换热力图
function toggleHeatmap() {
  heatmapVisible.value = !heatmapVisible.value
  setHeatmapVisible(heatmapVisible.value)
}

// 加载热力图
async function loadHeatmap() {
  if (!viewer) return
  
  try {
    // 清除之前的热力图数据
    if (heatmapDataSource) {
      try {
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
        console.log('清理热力图数据源:', e?.message || '未知错误')
      }
      heatmapDataSource = null
    }
    
    console.log('开始构建网格热力图')
    
    // 获取设施数据
    const res = await axios.get(`${API_BASE}/facilities`)
    const facilities = res.data || []
    
    if (!Array.isArray(facilities) || facilities.length === 0) {
      console.error('没有设施数据')
      return
    }
    
    // 创建热力图数据源
    heatmapDataSource = new Cesium.CustomDataSource('heatmap')
    
    // 定义网格大小：根据经纬度计算（约1km）
    const gridSize = 0.009
    const gridStats = new Map()
    
    // 遍历设施点，计算每个网格的设施数量
    facilities.forEach((facility) => {
      const lon = facility.longitude ?? facility.lon
      const lat = facility.latitude ?? facility.lat
      
      if (!lon || !lat) return
      
      // 计算网格坐标
      const gridX = Math.floor(lon / gridSize) * gridSize
      const gridY = Math.floor(lat / gridSize) * gridSize
      const gridKey = `${gridX.toFixed(4)},${gridY.toFixed(4)}`
      
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
    
    const sortedGrids = Array.from(gridStats.values()).sort((a, b) => b.count - a.count)
    
    if (sortedGrids.length === 0) {
      console.error('没有有效的网格数据')
      return
    }
    
    const maxCount = sortedGrids[0].count
    const minCount = sortedGrids[sortedGrids.length - 1].count
    
    // 定义颜色等级
    const colorLevels = [
      { threshold: 0.83, color: '#a50026' },
      { threshold: 0.67, color: '#ff7f00' },
      { threshold: 0.50, color: '#ffff00' },
      { threshold: 0.33, color: '#00ff00' },
      { threshold: 0.17, color: '#00bfff' },
      { threshold: 0.0,  color: '#0000ff' },
    ]
    
    // 为每个网格创建矩形
    sortedGrids.forEach((grid) => {
      const normalizedCount = (grid.count - minCount) / (maxCount - minCount || 1)
      let color = '#0000ff'
      
      for (const level of colorLevels) {
        if (normalizedCount >= level.threshold) {
          color = level.color
          break
        }
      }
      
      heatmapDataSource.entities.add({
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
          height: 0,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          classificationType: Cesium.ClassificationType.BOTH
        },
        properties: {
          gridData: grid,
          type: 'grid'
        }
      })
    })
    
    // 添加数据源
    let alreadyAdded = false
    for (let i = 0; i < viewer.dataSources.length; i++) {
      if (viewer.dataSources.get(i) === heatmapDataSource) {
        alreadyAdded = true
        break
      }
    }
    if (!alreadyAdded) {
      await viewer.dataSources.add(heatmapDataSource)
    }
    
    // 将热力图置于底层
    try {
      if (heatmapDataSource) {
        viewer.dataSources.lower(heatmapDataSource)
      }
    } catch (e) {
      console.log('调整热力图层级:', e?.message || '未知错误')
    }
    
    console.log(`网格热力图加载完成，共创建 ${sortedGrids.length} 个网格`)
  } catch (err) {
    console.error('加载网格热力图失败', err)
  }
}

// 视域分析控制
function setViewshedVisible(visible) {
  viewshedActive.value = visible

  if (!visible) {
    clearViewshed()
    return
  }

  // 激活视域分析时关闭淹没分析（互斥）
  if (floodActive.value) {
    floodActive.value = false
    clearFlood()
  }

  // 如果已经有观察点，重新计算视域
  if (viewshedObserverPosition) {
    calculateViewshed(viewshedObserverPosition)
  }
}

// 切换视域分析
function toggleViewshed() {
  viewshedActive.value = !viewshedActive.value
  setViewshedVisible(viewshedActive.value)
}

// 清除视域分析结果
function clearViewshed() {
  if (!viewer) return
  
  const entitiesToRemove = viewer.entities.values.filter(e => {
    const type = e.properties?.type?.getValue?.()
    return type === 'viewshedVisible' || type === 'viewshedObserver'
  })
  
  entitiesToRemove.forEach(e => viewer.entities.remove(e))
}

// ==================== 坐标转换工具（统一简化投影）====================
// 经纬度转平面米制坐标（相对于中心点）
function lonLatToMeters(lon, lat, centerLon, centerLat) {
  const toRad = Math.PI / 180
  // 在淄博纬度(~36度)处，1度经度≈111320*cos(36°)≈90000米
  // 1度纬度≈111000米
  const metersPerLon = 111320 * Math.cos(centerLat * toRad)
  const metersPerLat = 111000
  
  return { 
    x: (lon - centerLon) * metersPerLon, 
    y: (lat - centerLat) * metersPerLat 
  }
}

// 平面坐标转回经纬度（Web Mercator反向投影）
function metersToLonLat(x, y, observerLon, observerLat) {
  // 使用 Cesium WebMercatorProjection 保持一致性
  const projection = new Cesium.WebMercatorProjection()
  
  // 观察点投影
  const observerCartographic = Cesium.Cartographic.fromDegrees(observerLon, observerLat)
  const observerMercator = projection.project(observerCartographic)
  
  // 计算目标点的 Web Mercator 坐标（局部坐标 + 观察点坐标）
  const targetMercator = {
    x: observerMercator.x + x,
    y: observerMercator.y + y
  }
  
  // 反向投影回经纬度
  const targetCartographic = projection.unproject(targetMercator)
  
  return {
    lon: Cesium.Math.toDegrees(targetCartographic.longitude),
    lat: Cesium.Math.toDegrees(targetCartographic.latitude)
  }
}

// 判断点是否在多边形内（Ray Casting算法，平面坐标）
function isPointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// 边界框快速检测
function isRayIntersectingBounds(observer, angle, bounds) {
  // 简化的边界框检测：检查射线方向是否与边界框相交
  // 这里使用保守估计，只要射线方向指向边界框区域就返回true
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  
  // 计算边界框中心方向
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const toCenterX = centerX - observer.x
  const toCenterY = centerY - observer.y
  
  // 计算角度差
  const angleToCenter = Math.atan2(toCenterY, toCenterX)
  const angleDiff = Math.abs(angle - angleToCenter)
  const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff)
  
  // 如果射线方向与指向边界框中心的方向偏差小于90度，进一步检测
  if (normalizedDiff > Math.PI / 2) return false
  
  // 计算到边界框的距离
  const distToCenter = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY)
  const boxRadius = Math.sqrt(
    Math.pow(bounds.maxX - bounds.minX, 2) + 
    Math.pow(bounds.maxY - bounds.minY, 2)
  ) / 2
  
  return distToCenter < (2000 + boxRadius) // 在最大半径范围内
}

// ==================== 视域分析核心算法（平面几何版）====================

/**
 * 计算射线与AABB包围盒的相交距离
 * 射线: P(t) = O + t*D, t >= 0
 * AABB: [minX, maxX] × [minY, maxY]
 * 返回射线进入包围盒的距离 tEnter，如果相交
 */
function rayBoxIntersection(ox, oy, dx, dy, minX, minY, maxX, maxY) {
  let tMin = -Infinity
  let tMax = Infinity

  // X轴方向
  if (Math.abs(dx) < 0.00001) {
    // 射线平行于X轴
    if (ox < minX || ox > maxX) return null
  } else {
    const t1 = (minX - ox) / dx
    const t2 = (maxX - ox) / dx
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
  }

  // Y轴方向
  if (Math.abs(dy) < 0.00001) {
    // 射线平行于Y轴
    if (oy < minY || oy > maxY) return null
  } else {
    const t1 = (minY - oy) / dy
    const t2 = (maxY - oy) / dy
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
  }

  // 相交条件: tMax >= tMin 且 tMax > 0 (射线前方有交点)
  if (tMax >= tMin && tMax > 0) {
    // 返回进入距离 (tMin > 0 ? tMin : 0)
    // 如果观察点在包围盒内部，tMin可能是负数，此时返回0
    const enterDist = tMin > 0 ? tMin : 0
    return { enter: enterDist, exit: tMax }
  }

  return null
}

/**
 * 计算射线与线段的交点
 * 射线: P = O + t*D
 * 线段: P = A + u(B-A)
 */
function getIntersection(ox, oy, dx, dy, x1, y1, x2, y2) {
  const x12 = x1 - x2
  const y12 = y1 - y2
  const det = -dx * y12 + dy * x12

  if (Math.abs(det) < 0.00001) return null // 平行

  const t = ((ox - x2) * y12 - (oy - y2) * x12) / det
  const u = (-(ox - x2) * dy + (oy - y2) * dx) / det

  // t > 0 表示在射线前方，0 <= u <= 1 表示在线段上
  if (t > 0 && u >= 0 && u <= 1) {
    return { dist: t, x: ox + t * dx, y: oy + t * dy }
  }
  return null
}

/**
 * 核心射线投射函数（平面几何版）
 * @param {number} angle - 射线角度（弧度）
 * @param {Object} observer - 观察点 { x: 0, y: 0, height: 18 }
 * @param {Array} buildings - 建筑物列表 (已转换为平面坐标)
 * @param {number} maxRadius - 最大半径
 */
function castRay(angle, observer, buildings, maxRadius, debug = false) {
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)

  // 收集所有有效交点：{dist, height, buildingId}
  const intersections = []

  for (const building of buildings) {
    const height = Number(building.height)
    const bounds = building.bounds

    // 【粗筛】快速距离检查：计算建筑中心到观察点的距离
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const centerDist = Math.sqrt(centerX * centerX + centerY * centerY)
    const boxRadius = Math.sqrt(
      Math.pow(bounds.maxX - bounds.minX, 2) +
      Math.pow(bounds.maxY - bounds.minY, 2)
    ) / 2

    // 如果建筑中心太远（超过 maxRadius + 建筑半径），直接跳过
    if (centerDist > maxRadius + boxRadius) {
      continue
    }

    // 【精算】射线与包围盒相交检测
    const boxHit = rayBoxIntersection(
      observer.x, observer.y, dirX, dirY,
      bounds.minX, bounds.minY, bounds.maxX, bounds.maxY
    )

    if (boxHit && boxHit.enter > 0 && boxHit.enter <= maxRadius) {
      intersections.push({
        dist: boxHit.enter,
        height: height,
        buildingId: building.id
      })
      if (debug && boxHit.enter < 500) {
        console.log(`  包围盒相交: 距离${boxHit.enter.toFixed(1)}m, 建筑高${height}m, 尺寸${(bounds.maxX-bounds.minX).toFixed(0)}×${(bounds.maxY-bounds.minY).toFixed(0)}m`)
      }
    }
  }

  // 按进入距离排序
  intersections.sort((a, b) => a.dist - b.dist)

  // 找到最近的能挡住视线的交点
  let closestBlockDist = maxRadius
  let isBlocked = false
  let hitBuildingHeight = null

  for (const hit of intersections) {
    // 在距离 hit.dist 处，视线高度 = 观察点高度（假设水平视线）
    const viewHeightAtDist = observer.height

    // 如果建筑高度 > 视线高度，则被挡住
    if (hit.height > viewHeightAtDist) {
      closestBlockDist = hit.dist
      isBlocked = true
      hitBuildingHeight = hit.height
      break // 找到最近的遮挡就停止
    }
    // 如果挡不住，继续检查后面的交点
  }

  if (debug) {
    if (isBlocked) {
      console.log(`  → 遮挡! 距离${closestBlockDist.toFixed(1)}m, 建筑高${hitBuildingHeight}m > 视线高${observer.height.toFixed(0)}m`)
    } else if (intersections.length > 0) {
      console.log(`  可越过所有建筑, 最近交点${intersections[0].dist.toFixed(0)}m, 但建筑高${intersections[0].height}m <= 视线高${observer.height.toFixed(0)}m`)
    } else {
      console.log(`  无交点, 自由视域${maxRadius}m`)
    }
  }

  return {
    dist: closestBlockDist,
    blocked: isBlocked,
    x: observer.x + dirX * closestBlockDist,
    y: observer.y + dirY * closestBlockDist
  }
}

// 计算视域分析（基于墨卡托投影平面坐标）
async function calculateViewshed(observerPos) {
  if (!viewer) return
  
  viewshedObserverPosition = observerPos
  
  // 如果视域分析未激活，不计算
  if (!viewshedActive.value) return
  
  // 清除之前的视域结果
  clearViewshed()
  
  const { lon, lat } = observerPos
  const radius = viewshedRadius
  const observerHeight = viewshedHeight.value
  
  // 获取观察点地形高度
  const observerCart = Cesium.Cartesian3.fromDegrees(lon, lat)
  const observerCartographic = Cesium.Cartographic.fromCartesian(observerCart)
  const terrainHeight = await viewer.scene.globe.getHeight(observerCartographic) || 0
  const observerEyeHeight = terrainHeight + observerHeight
  
  // 添加观察点（黄色标记）
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, observerEyeHeight),
    point: {
      pixelSize: 20,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
    },
    properties: {
      type: 'viewshedObserver'
    }
  })
  
  console.log(`视域分析开始: 观察点(${lon.toFixed(4)}, ${lat.toFixed(4)}), 高度${observerHeight}m`)
  
  // ==================== 步骤1：Cesium WebMercator投影坐标转换 ====================
  // 使用 Cesium 标准的 WebMercatorProjection
  const projection = new Cesium.WebMercatorProjection()
  
  // 观察点转为 Web Mercator
  const obsCarto = Cesium.Cartographic.fromDegrees(lon, lat)
  const observerMercator = projection.project(obsCarto)
  console.log(`Observer Mercator: x=${observerMercator.x.toFixed(0)}, y=${observerMercator.y.toFixed(0)}`)
  console.log(`Observer Local X, Y: (0, 0)`)
  
  const buildings = []
  let entityCount = 0
  let debugBuildings = []
  
  const dataSourceCount = viewer.dataSources.length
  for (let dsIdx = 0; dsIdx < dataSourceCount; dsIdx++) {
    const dataSource = viewer.dataSources.get(dsIdx)
    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue
      
      // 获取高度
      let height = 30
      const category = entity.properties?.category?.getValue?.() || 
                       dataSource.name?.toLowerCase?.() || 'other'
      if (category && categoryHeights[category]) {
        height = categoryHeights[category]
      }
      
      entityCount++
      
      try {
        const hierarchy = entity.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now())
        if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) continue
        
        // 转换多边形顶点为相对于观察点的局部坐标
        const polygon = []
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        let firstVertexRealPos = null
        let firstVertexMercator = null
        
        for (let i = 0; i < hierarchy.positions.length; i++) {
          const pos = hierarchy.positions[i]
          
          // 获取经纬度
          const carto = Cesium.Cartographic.fromCartesian(pos)
          const pLon = Cesium.Math.toDegrees(carto.longitude)
          const pLat = Cesium.Math.toDegrees(carto.latitude)
          
          // 投影到 Web Mercator
          const posCartographic = Cesium.Cartographic.fromDegrees(pLon, pLat)
          const posMercator = projection.project(posCartographic)
          
          // 保存第一个顶点的原始位置用于调试
          if (i === 0) {
            firstVertexRealPos = { lon: pLon, lat: pLat }
            firstVertexMercator = { x: posMercator.x, y: posMercator.y }
          }
          
          // 计算相对于观察点的局部坐标（关键！）
          const relativeX = posMercator.x - observerMercator.x
          const relativeY = posMercator.y - observerMercator.y
          
          polygon.push({ x: relativeX, y: relativeY })
          
          minX = Math.min(minX, relativeX)
          maxX = Math.max(maxX, relativeX)
          minY = Math.min(minY, relativeY)
          maxY = Math.max(maxY, relativeY)
        }
        
        if (polygon.length >= 3) {
          const building = {
            id: entity.id,
            height: height,
            polygon: polygon,
            bounds: { minX, maxX, minY, maxY },
            firstVertexRealPos: firstVertexRealPos,
            firstVertexMercator: firstVertexMercator
          }
          buildings.push(building)
          
          // 收集前3个用于调试输出
          if (debugBuildings.length < 3) {
            const relativeX = polygon[0].x
            const relativeY = polygon[0].y
            debugBuildings.push({
              index: debugBuildings.length,
              mercatorX: firstVertexMercator.x.toFixed(0),
              mercatorY: firstVertexMercator.y.toFixed(0),
              relativeX: relativeX.toFixed(0),
              relativeY: relativeY.toFixed(0),
              realLon: firstVertexRealPos.lon.toFixed(6),
              realLat: firstVertexRealPos.lat.toFixed(6)
            })
          }
        }
      } catch (e) {
        // 跳过
      }
    }
  }
  
  console.log(`提取了 ${buildings.length} 个建筑物`)
  
  // 调试输出：建筑物坐标
  debugBuildings.forEach(b => {
    console.log(`Building ${b.index} Mercator: (${b.mercatorX}, ${b.mercatorY}) -> Relative: (${b.relativeX}, ${b.relativeY}), Real: (${b.realLon}, ${b.realLat})`)
  })
  
  // ==================== 步骤2：720方向射线投射（每0.5度一根，更平滑）====================
  const directions = 720  // 增加密度：0.5度一根
  const visibleBoundaries = []
  
  // 观察点平面坐标（中心点，所以是0,0），高度为纯观察高度（不含地形）
  const observer = { x: 0, y: 0, height: observerHeight }
  
  for (let d = 0; d < directions; d++) {
    const angle = (d / directions) * Math.PI * 2
    
    // 前20条射线启用调试模式
    const debug = d < 20
    const result = castRay(angle, observer, buildings, radius, debug)
    
    // 转换回经纬度
    const endLonLat = metersToLonLat(result.x, result.y, lon, lat)
    
    visibleBoundaries.push({
      lon: endLonLat.lon,
      lat: endLonLat.lat,
      angle: angle,
      dist: result.dist,
      blocked: result.blocked
    })
  }
  
  // 边缘平滑插值：在遮挡状态变化的地方插入中间点
  function smoothBoundaries(boundaries) {
    const smoothed = [boundaries[0]]
    
    for (let i = 1; i < boundaries.length; i++) {
      const prev = boundaries[i - 1]
      const curr = boundaries[i]
      
      // 如果遮挡状态变化了，或者距离变化超过100m，插入中间点
      const distDiff = Math.abs(curr.dist - prev.dist)
      const stateChanged = curr.blocked !== prev.blocked
      
      if (stateChanged || distDiff > 100) {
        // 插值中间点
        const midAngle = (prev.angle + curr.angle) / 2
        const midDist = (prev.dist + curr.dist) / 2
        const midBlocked = prev.blocked && curr.blocked  // 都遮挡才算遮挡
        
        // 计算中间点坐标
        const midX = Math.cos(midAngle) * midDist
        const midY = Math.sin(midAngle) * midDist
        const midLonLat = metersToLonLat(midX, midY, lon, lat)
        
        smoothed.push({
          lon: midLonLat.lon,
          lat: midLonLat.lat,
          angle: midAngle,
          dist: midDist,
          blocked: midBlocked
        })
      }
      
      smoothed.push(curr)
    }
    
    return smoothed
  }
  
  // 应用平滑（如果性能允许）
  const smoothedBoundaries = smoothBoundaries(visibleBoundaries)
  console.log(`视域边界: 原始${visibleBoundaries.length}点 → 平滑后${smoothedBoundaries.length}点`)
  
  // ==================== 步骤3：绘制视域多边形 ====================
  // 使用平滑后的边界点绘制
  const finalBoundaries = smoothedBoundaries.length >= 3 ? smoothedBoundaries : visibleBoundaries
  
  if (finalBoundaries.length >= 3) {
    // 按角度排序形成闭合多边形
    const sorted = finalBoundaries.sort((a, b) => a.angle - b.angle)
    
    // 构建多边形顶点（贴地）
    const positions = sorted.map(p => 
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, terrainHeight + 2)
    )
    
    // 创建视域多边形（深绿色贴地光斑）
    viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString('#228b22').withAlpha(0.75),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#006400'),
        outlineWidth: 2,
        height: terrainHeight + 2,
        extrudedHeight: undefined,
        perPositionHeight: false,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      properties: {
        type: 'viewshedVisible'
      }
    })
  }
  
  console.log(`视域分析完成: 共${visibleBoundaries.length}个边界点`)
}

// 重新计算视域（高度改变时）
function recalculateViewshed() {
  if (viewshedObserverPosition && viewshedActive.value) {
    calculateViewshed(viewshedObserverPosition)
  }
}

// 处理地图点击（用于视域分析设置观察点）
function handleMapClick(movement) {
  if (!viewer || !viewshedActive.value) return
  
  const pickedPosition = viewer.scene.pickPosition(movement.position)
  if (!pickedPosition) return
  
  const cartographic = Cesium.Cartographic.fromCartesian(pickedPosition)
  const lon = Cesium.Math.toDegrees(cartographic.longitude)
  const lat = Cesium.Math.toDegrees(cartographic.latitude)
  
  viewshedObserverPosition = { lon, lat }
  calculateViewshed({ lon, lat })
}

// ==================== 淹没分析核心函数 ====================

/**
 * 基于连通性的淹没分析（漫水填充/BFS算法）
 * 核心逻辑：从中心点开始，水只能流向高度低于水位的相邻建筑
 * 水位是相对水深（从地面开始算）
 */
function filterBuildings(centerPos, waterLevel) {
  console.log(`连通性淹没分析: 中心(${centerPos.lon.toFixed(4)}, ${centerPos.lat.toFixed(4)}), 水位${waterLevel}m`)

  const projection = new Cesium.WebMercatorProjection()
  const centerCartographic = Cesium.Cartographic.fromDegrees(centerPos.lon, centerPos.lat)
  const centerMercator = projection.project(centerCartographic)

  // 第一步：收集所有建筑信息
  const allBuildings = []
  const dataSourceCount = viewer.dataSources.length

  for (let dsIdx = 0; dsIdx < dataSourceCount; dsIdx++) {
    const dataSource = viewer.dataSources.get(dsIdx)
    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue

      const hierarchy = entity.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now())
      if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) continue

      // 计算建筑中心点（Web Mercator坐标）
      let sumX = 0, sumY = 0
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

      for (const pos of hierarchy.positions) {
        const carto = Cesium.Cartographic.fromCartesian(pos)
        const pLon = Cesium.Math.toDegrees(carto.longitude)
        const pLat = Cesium.Math.toDegrees(carto.latitude)
        const posCartographic = Cesium.Cartographic.fromDegrees(pLon, pLat)
        const posMercator = projection.project(posCartographic)

        const x = posMercator.x - centerMercator.x
        const y = posMercator.y - centerMercator.y

        sumX += x
        sumY += y
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }

      const count = hierarchy.positions.length
      const centerX = sumX / count
      const centerY = sumY / count
      const bboxCenterX = (minX + maxX) / 2
      const bboxCenterY = (minY + maxY) / 2

      // 计算建筑高度
      const originalHeight = entity.properties?.originalHeight?.getValue?.()
      const currentHeight = entity.polygon.extrudedHeight?.getValue?.(Cesium.JulianDate.now()) ||
                            categoryHeights[entity.properties?.category?.getValue?.()] || 30
      const buildingHeight = originalHeight || currentHeight

      // 只收集在一定范围内的建筑（性能优化）
      const distanceFromCenter = Math.sqrt(bboxCenterX * bboxCenterX + bboxCenterY * bboxCenterY)
      if (distanceFromCenter <= FLOOD_RADIUS * 1.5) {
        allBuildings.push({
          entity,
          id: entity.id,
          x: bboxCenterX,
          y: bboxCenterY,
          height: buildingHeight,
          distanceFromCenter
        })
      }
    }
  }

  console.log(`范围内建筑总数: ${allBuildings.length}`)

  if (allBuildings.length === 0) {
    return { floodedBuildings: [], nearbyBuildings: [] }
  }

  // 第二步：找到离中心点最近的建筑作为起点
  let startBuilding = null
  let minDist = Infinity
  for (const b of allBuildings) {
    if (b.distanceFromCenter < minDist) {
      minDist = b.distanceFromCenter
      startBuilding = b
    }
  }

  // 如果起点建筑本身高于水位，没有建筑会被淹没
  if (!startBuilding || startBuilding.height > waterLevel) {
    console.log('起点建筑高于水位，无淹没区域')
    return { floodedBuildings: [], nearbyBuildings: allBuildings.map(b => b.entity) }
  }

  // 第三步：BFS漫水填充（带阻挡检测）
  const floodedSet = new Set()
  const queue = [startBuilding]
  floodedSet.add(startBuilding.id)

  // 缩小邻接距离阈值，使水流更精确
  const ADJACENT_THRESHOLD = 70  // 70米内认为是相邻建筑

  // 清除之前的调试线条
  floodDebugLines.forEach(line => viewer.entities.remove(line))
  floodDebugLines = []

  while (queue.length > 0) {
    const current = queue.shift()

    // 查找所有相邻且高度低于水位的建筑
    for (const neighbor of allBuildings) {
      if (floodedSet.has(neighbor.id)) continue  // 已访问过
      if (neighbor.height > waterLevel) continue  // 高于水位，水过不去

      // 计算与当前建筑的距离
      const dx = neighbor.x - current.x
      const dy = neighbor.y - current.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      // 距离太远，不算邻居
      if (dist > ADJACENT_THRESHOLD) continue

      // ========== 阻挡检测：检查中间点是否有高地阻挡 ==========
      // 计算中点坐标
      const midX = (current.x + neighbor.x) / 2
      const midY = (current.y + neighbor.y) / 2

      // 检查中点周围是否有其他建筑（堤坝）阻挡
      let isBlocked = false
      let blockingBuilding = null

      // 检查中间点周围100米内的建筑
      const BLOCK_CHECK_RADIUS = 100
      for (const potentialBlock of allBuildings) {
        if (potentialBlock.id === current.id || potentialBlock.id === neighbor.id) continue

        // 计算该建筑到连线的距离（简化版：检查到中点的距离）
        const dpx = potentialBlock.x - midX
        const dpy = potentialBlock.y - midY
        const distToMid = Math.sqrt(dpx * dpx + dpy * dpy)

        // 如果该建筑在中间点附近，且高度高于水位，则形成阻挡
        if (distToMid <= BLOCK_CHECK_RADIUS && potentialBlock.height > waterLevel) {
          isBlocked = true
          blockingBuilding = potentialBlock
          break
        }
      }

      // 可视化调试线条
      if (isBlocked) {
        // 红色：被阻挡的路径
        const line = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
              centerPos.lon + current.x / 111320, centerPos.lat + current.y / 111320, current.height,
              centerPos.lon + neighbor.x / 111320, centerPos.lat + neighbor.y / 111320, neighbor.height
            ]),
            width: 2,
            material: Cesium.Color.RED.withAlpha(0.6),
            clampToGround: true
          }
        })
        floodDebugLines.push(line)
        continue  // 跳过这个邻居，水流不过去
      } else {
        // 蓝色：成功流过的路径
        const line = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
              centerPos.lon + current.x / 111320, centerPos.lat + current.y / 111320, current.height,
              centerPos.lon + neighbor.x / 111320, centerPos.lat + neighbor.y / 111320, neighbor.height
            ]),
            width: 1,
            material: Cesium.Color.BLUE.withAlpha(0.3),
            clampToGround: true
          }
        })
        floodDebugLines.push(line)
      }

      // 水可以流过去
      floodedSet.add(neighbor.id)
      queue.push(neighbor)
    }
  }

  // 收集结果
  const floodedBuildings = allBuildings
    .filter(b => floodedSet.has(b.id))
    .map(b => b.entity)

  console.log(`连通性分析结果: 范围内${allBuildings.length}栋, 被淹${floodedBuildings.length}栋`)

  return {
    floodedBuildings,
    nearbyBuildings: allBuildings.map(b => b.entity)
  }
}

/**
 * 计算多边形面积（简化计算，使用Web Mercator投影后的平面坐标）
 */
function calculatePolygonArea(positions) {
  const projection = new Cesium.WebMercatorProjection()
  let area = 0

  // 投影所有点到Web Mercator
  const points = positions.map(pos => {
    const carto = Cesium.Cartographic.fromCartesian(pos)
    const mercator = projection.project(carto)
    return { x: mercator.x, y: mercator.y }
  })

  // 使用鞋带公式计算面积
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }

  return Math.abs(area) / 2
}

/**
 * 应用淹没视觉效果（差量更新）
 * 只修改状态改变的建筑：新增淹没/恢复干燥
 */
function applyFloodVisuals(floodedBuildings, previousIds) {
  const currentIds = new Set(floodedBuildings.map(b => b.id))

  // 只包围不覆盖：建筑保持原有颜色，不做任何视觉修改
  // 只更新统计信息，不改变建筑外观
  console.log(`包围统计: ${floodedBuildings.length}栋建筑被水流包围`)

  return currentIds
}

/**
 * 提取场景中的所有建筑（用于淹没分析）
 * @returns 建筑列表，包含位置、高度、边界框
 */
function extractAllBuildings() {
  const projection = new Cesium.WebMercatorProjection()
  const buildings = []

  // 遍历所有数据源
  const dataSourceCount = viewer.dataSources.length
  console.log(`扫描${dataSourceCount}个数据源查找建筑...`)

  for (let dsIdx = 0; dsIdx < dataSourceCount; dsIdx++) {
    const dataSource = viewer.dataSources.get(dsIdx)

    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue

      try {
        const hierarchy = entity.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now())
        if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) continue

        // 获取建筑实际高度（处理Property类型）
        let extrudedHeight = 30
        let baseHeight = 0

        // 尝试获取extrudedHeight（可能是Property或直接数值）
        if (entity.polygon.extrudedHeight) {
          if (typeof entity.polygon.extrudedHeight.getValue === 'function') {
            extrudedHeight = entity.polygon.extrudedHeight.getValue(Cesium.JulianDate.now()) || 30
          } else {
            extrudedHeight = entity.polygon.extrudedHeight || 30
          }
        }

        // 尝试获取base height
        if (entity.polygon.height) {
          if (typeof entity.polygon.height.getValue === 'function') {
            baseHeight = entity.polygon.height.getValue(Cesium.JulianDate.now()) || 0
          } else {
            baseHeight = entity.polygon.height || 0
          }
        }

        const buildingHeight = extrudedHeight - baseHeight
        if (buildingHeight <= 0) continue  // 跳过无效建筑

        // 计算建筑边界框（经纬度）
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
        let centerLon = 0, centerLat = 0

        for (const pos of hierarchy.positions) {
          const carto = Cesium.Cartographic.fromCartesian(pos)
          const lon = Cesium.Math.toDegrees(carto.longitude)
          const lat = Cesium.Math.toDegrees(carto.latitude)

          minLon = Math.min(minLon, lon)
          maxLon = Math.max(maxLon, lon)
          minLat = Math.min(minLat, lat)
          maxLat = Math.max(maxLat, lat)
          centerLon += lon
          centerLat += lat
        }

        centerLon /= hierarchy.positions.length
        centerLat /= hierarchy.positions.length

        // 投影到Web Mercator
        const centerCarto = Cesium.Cartographic.fromDegrees(centerLon, centerLat)
        const centerMercator = projection.project(centerCarto)

        buildings.push({
          entity,
          id: entity.id,
          height: buildingHeight,
          centerLon,
          centerLat,
          mercatorX: centerMercator.x,
          mercatorY: centerMercator.y,
          bounds: { minLon, maxLon, minLat, maxLat }
        })
      } catch (e) {
        // 跳过错误建筑
      }
    }
  }

  console.log(`✓ 提取了${buildings.length}栋建筑`)
  return buildings
}

/**
 * 计算淹没统计信息
 */
function calculateFloodStats(floodedBuildings) {
  let totalArea = 0
  const byCategory = {}

  for (const building of floodedBuildings) {
    // 计算占地面积
    const hierarchy = building.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now())
    if (hierarchy && hierarchy.positions) {
      const area = calculatePolygonArea(hierarchy.positions)
      totalArea += area
    }

    // 按类型统计
    const category = normalizeCategory(building.properties?.category?.getValue?.() || 'other')
    byCategory[category] = (byCategory[category] || 0) + 1
  }

  return {
    totalBuildings: floodedBuildings.length,
    floodedArea: totalArea,
    byCategory
  }
}

/**
 * 淹没分析入口函数
 * 处理点击事件，启动水流包围动画
 */
async function calculateFlood(centerPos) {
  if (!viewer) return

  const totalWaterVolume = 50000  // 总水量5万立方米

  console.log(`启动水流包围动画: 总水量${totalWaterVolume}m3, 中心点(${centerPos.lon.toFixed(4)}, ${centerPos.lat.toFixed(4)})`)

  // 清除之前的结果
  clearFlood()

  floodCenterPosition.value = centerPos

  // 获取地形高度
  const sourceCart = Cesium.Cartesian3.fromDegrees(centerPos.lon, centerPos.lat)
  const sourceCartographic = Cesium.Cartographic.fromCartesian(sourceCart)
  const terrainHeight = await viewer.scene.globe.getHeight(sourceCartographic) || 0

  // 创建水源点
  floodCenterEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(centerPos.lon, centerPos.lat, terrainHeight + 8),
    point: {
      pixelSize: 20,
      color: Cesium.Color.fromCssColorString('#0066cc'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2
    },
    label: {
      text: '水源点',
      font: '14px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -25)
    }
  })

  // 提取所有建筑（复用视域分析的坐标转换逻辑）
  const allBuildings = extractAllBuildings()
  console.log(`场景中共${allBuildings.length}栋建筑`)

  if (allBuildings.length === 0) {
    console.warn('没有找到任何建筑，无法进行分析')
    return
  }

  // 启动水流包围动画（无时间限制）
  animateFloodSurround(allBuildings, centerPos, totalWaterVolume, terrainHeight)
}

/**
 * 启动水流动画模拟（新版：基于总水量的包围算法）
 * 水流从中心点扩散，遇到建筑边界停止，10秒内用完5万m³水量
 */
function startFloodAnimation(centerPos) {
  if (!viewer) return

  const totalWaterVolume = 50000  // 总水量5万立方米
  const duration = 10              // 动画时长10秒
  let currentWaterLevel = 0

  // 更新水面高度（贴地显示）
  function updateWaterSurface() {
    if (floodWaterPlane) {
      // 更新位置（地形高度 + 水位高度）
      floodWaterPlane.position = Cesium.Cartesian3.fromDegrees(
        centerPos.lon,
        centerPos.lat,
        terrainHeight + currentWaterLevel
      )
      // 更新椭圆高度（相对地面）
      floodWaterPlane.ellipse.height = currentWaterLevel
      // 更新拉伸高度（水位厚度）
      floodWaterPlane.ellipse.extrudedHeight = currentWaterLevel + 0.1
    }
  }

  function renderFrame() {
    const elapsed = (Date.now() - startTime) / 1000  // 已用时间（秒）

    if (elapsed > duration) {
      console.log('✅ 10秒淹没动画完成')
      return
    }

    // 当前水位 = 目标水位 × (已用时间 / 总时长)
    currentWaterLevel = (elapsed / duration) * targetLevel

    // 每秒输出一次日志（让用户看到动画在进行）
    const currentSecond = Math.floor(elapsed)
    if (currentSecond !== lastSecond) {
      lastSecond = currentSecond
      console.log(`⏱️ 第${currentSecond}秒: 水位=${currentWaterLevel.toFixed(2)}m, 目标=${targetLevel}m`)
    }

    // 更新水面
    updateWaterSurface()

    // 强制刷新Cesium场景（确保动画实时显示）
    viewer.scene.requestRender()

    // 统计
    let floodedCount = 0
    let totalArea = 0

    // 渲染逻辑：仅处理预计算的连通建筑
    floodableBuildings.forEach(building => {
      const entity = building.entity
      if (!entity || !entity.polygon) return

      // 淹没条件：建筑高度 < 当前水位
      if (building.height < currentWaterLevel) {
        floodedCount++
        totalArea += 500  // 粗略估算每栋面积

        // 建筑变色（被淹）
        if (!entity.properties.flooded?.getValue?.()) {
          // 保存原始材质
          if (!entity.properties.originalMaterial) {
            const matValue = entity.polygon.material?.getValue ? entity.polygon.material.getValue() : entity.polygon.material
            entity.properties.addProperty('originalMaterial', matValue || Cesium.Color.WHITE)
          }
          // 变蓝色
          entity.polygon.material = Cesium.Color.fromCssColorString('rgba(0,150,255,0.6)')
          entity.properties.addProperty('flooded', true)
        }
      } else {
        // 未淹，恢复原始颜色
        if (entity.properties.flooded?.getValue?.()) {
          const originalMaterial = entity.properties.originalMaterial?.getValue?.()
          const restoredMat = originalMaterial?.getValue ? originalMaterial.getValue() : originalMaterial
          if (restoredMat) {
            entity.polygon.material = restoredMat instanceof Cesium.Color ? restoredMat : Cesium.Color.WHITE
          }
          entity.properties.addProperty('flooded', false)
        }
      }
    })

    // 更新统计
    floodStats.value = {
      totalBuildings: floodableBuildings.length,
      floodedBuildings: floodedCount,
      floodedArea: totalArea,
      nearbyBuildings: 0
    }

    // 更新标签
    if (floodCenterEntity && floodCenterEntity.label) {
      floodCenterEntity.label.text = `模拟时间:${elapsed.toFixed(1)}s/${duration}s\n` +
                                     `当前水位:${currentWaterLevel.toFixed(1)}m/${targetLevel}m\n` +
                                     `淹没建筑:${floodedCount}/${floodableBuildings.length}栋`
    }

    // 继续下一帧
    animationId = requestAnimationFrame(renderFrame)
  }

  // 开始动画
  renderFrame()

  // 返回停止函数
  return () => {
    if (animationId) cancelAnimationFrame(animationId)
  }
}

/**
 * 基于流量的动态淹没动画（自流平效果）
 * 水像倒进不规则容器一样流动，被建筑阻挡，水位逐渐上升
 */
function animateFloodFlow(allBuildings, centerPos, flowRate, duration, terrainHeight) {
  const projection = new Cesium.WebMercatorProjection()
  const startTime = Date.now()
  let animationId = null
  let lastSecond = -1

  // 水源点投影
  const sourceCarto = Cesium.Cartographic.fromDegrees(centerPos.lon, centerPos.lat)
  const sourceMercator = projection.project(sourceCarto)

  // 创建水面实体（初始很小）
  floodWaterPlane = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(centerPos.lon, centerPos.lat, terrainHeight),
    ellipse: {
      semiMinorAxis: 10,  // 初始10米
      semiMajorAxis: 10,
      height: 0,
      material: Cesium.Color.fromCssColorString('rgba(0,150,255,0.6)'),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('rgba(0,100,200,0.9)'),
      outlineWidth: 2
    }
  })

  // 用于跟踪已淹没的建筑
  const floodedBuildingIds = new Set()

  function renderFrame() {
    const elapsed = (Date.now() - startTime) / 1000

    if (elapsed > duration) {
      console.log('✅ 水流淹没动画完成')
      floodAnimationRunning.value = false
      return
    }

    // 计算当前水体积 = 流量 × 时间
    const waterVolume = flowRate * elapsed

    // 使用BFS计算当前水体积下的淹没区域
    // 水位从0开始尝试，找到能容纳当前水体积的水位
    let currentWaterLevel = 0
    let floodedBuildings = []
    let floodedArea = 0

    // 二分查找或逐步增加水位来找到合适的水位
    for (let tryLevel = 0; tryLevel <= 50; tryLevel += 0.5) {
      const flooded = []
      let area = 0

      for (const b of allBuildings) {
        const dx = b.mercatorX - sourceMercator.x
        const dy = b.mercatorY - sourceMercator.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        // 建筑在范围内且高度 < 尝试水位
        if (dist <= FLOOD_RADIUS && b.height < tryLevel) {
          flooded.push(b)
          area += 1000  // 每栋建筑约1000m²
        }
      }

      // 计算需要的水体积 = 面积 × 水位高度
      const requiredVolume = area * tryLevel

      if (requiredVolume >= waterVolume) {
        currentWaterLevel = tryLevel
        floodedBuildings = flooded
        floodedArea = area
        break
      }
    }

    // 更新水面大小（基于淹没范围）
    if (floodWaterPlane && floodedBuildings.length > 0) {
      // 计算淹没区域的半径（基于最远的被淹建筑）
      let maxDist = 0
      for (const b of floodedBuildings) {
        const dx = b.mercatorX - sourceMercator.x
        const dy = b.mercatorY - sourceMercator.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        maxDist = Math.max(maxDist, dist)
      }
      // 水面半径 = 最远距离 + 缓冲区
      const waterRadius = Math.max(maxDist + 20, 10)
      floodWaterPlane.ellipse.semiMinorAxis = waterRadius
      floodWaterPlane.ellipse.semiMajorAxis = waterRadius
      floodWaterPlane.ellipse.height = currentWaterLevel
      floodWaterPlane.ellipse.extrudedHeight = currentWaterLevel + 0.2
    }

    // 更新建筑颜色（新淹没的变蓝）
    for (const b of floodedBuildings) {
      const entity = b.entity
      if (!entity || !entity.polygon) continue

      if (!floodedBuildingIds.has(b.id)) {
        // 新淹没的建筑
        floodedBuildingIds.add(b.id)

        // 保存原始材质
        if (!entity.properties.originalMaterial) {
          const matValue = entity.polygon.material?.getValue ? entity.polygon.material.getValue() : entity.polygon.material
          entity.properties.addProperty('originalMaterial', matValue || Cesium.Color.WHITE)
        }

        // 变蓝色
        entity.polygon.material = Cesium.Color.fromCssColorString('rgba(0,150,255,0.7)')
      }
    }

    // 每秒输出日志
    const currentSecond = Math.floor(elapsed)
    if (currentSecond !== lastSecond) {
      lastSecond = currentSecond
      console.log(`⏱️ 第${currentSecond}秒: 水量=${(waterVolume/1000).toFixed(1)}千m³, 水位=${currentWaterLevel.toFixed(2)}m, 淹没=${floodedBuildings.length}栋`)
    }

    // 更新统计
    floodStats.value = {
      totalBuildings: allBuildings.length,
      floodedBuildings: floodedBuildingIds.size,
      floodedArea: floodedArea,
      nearbyBuildings: 0
    }

    // 更新标签
    if (floodCenterEntity && floodCenterEntity.label) {
      floodCenterEntity.label.text = `时间:${elapsed.toFixed(1)}s/${duration}s\n` +
                                     `水量:${(waterVolume/1000).toFixed(1)}千m³\n` +
                                     `水位:${currentWaterLevel.toFixed(1)}m\n` +
                                     `淹没:${floodedBuildingIds.size}栋`
    }

    // 强制刷新
    viewer.scene.requestRender()

    // 继续动画
    animationId = requestAnimationFrame(renderFrame)
  }

  // 启动动画
  floodAnimationRunning.value = true
  renderFrame()

  // 返回停止函数
  return () => {
    if (animationId) cancelAnimationFrame(animationId)
    floodAnimationRunning.value = false
  }
}

/**
 * 预设水量的自流平淹没动画
 * 水量固定，水位上升填充建筑间隙，实时显示水多边形
 */
function animateSelfLevelingFlood(allBuildings, centerPos, totalWaterVolume, duration, terrainHeight) {
  const projection = new Cesium.WebMercatorProjection()
  const startTime = Date.now()
  let animationId = null
  let lastSecond = -1

  // 水源点投影
  const sourceCarto = Cesium.Cartographic.fromDegrees(centerPos.lon, centerPos.lat)
  const sourceMercator = projection.project(sourceCarto)

  // 创建水多边形实体（初始为空）
  floodWaterPlane = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy([]),
      material: Cesium.Color.fromCssColorString('rgba(0,150,255,0.5)'),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('rgba(0,100,200,0.8)'),
      outlineWidth: 2,
      height: 0,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
    }
  })

  // 被水包围的建筑集合
  const surroundedBuildingIds = new Set()

  function renderFrame() {
    const elapsed = (Date.now() - startTime) / 1000

    if (elapsed > duration) {
      console.log('✅ 自流平淹没动画完成')
      console.log(`📊 最终结果: 填充面积=${floodStats.value.floodedArea.toFixed(0)}m², 包围建筑=${surroundedBuildingIds.size}栋`)
      floodAnimationRunning.value = false
      return
    }

    // 计算进度 (0-1)
    const progress = elapsed / duration

    // 剩余水量 = 总量 × (1 - 进度)
    const remainingVolume = totalWaterVolume * (1 - progress)
    const usedVolume = totalWaterVolume * progress

    // 水位上升：从0到目标水位（根据剩余水量计算）
    // 水体积 = 填充面积 × 水位高度
    // 我们逐步增加水位，找到合适的填充区域

    let currentWaterLevel = 0
    let filledBuildings = []
    let waterBoundaryPoints = []

    // 尝试不同的水位，找到能容纳当前用水量的配置
    for (let tryLevel = 0.1; tryLevel <= 50; tryLevel += 0.2) {
      // 找到高度 < 尝试水位的建筑（水可以覆盖它们）
      const lowBuildings = []
      for (const b of allBuildings) {
        const dx = b.mercatorX - sourceMercator.x
        const dy = b.mercatorY - sourceMercator.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        // 建筑在范围内且高度 < 尝试水位
        if (dist <= FLOOD_RADIUS && b.height < tryLevel) {
          lowBuildings.push(b)
        }
      }

      if (lowBuildings.length === 0) continue

      // 计算水多边形边界（简化为圆形+建筑裁剪）
      // 找到最远的低建筑距离
      let maxDist = 0
      for (const b of lowBuildings) {
        const dx = b.mercatorX - sourceMercator.x
        const dy = b.mercatorY - sourceMercator.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        maxDist = Math.max(maxDist, dist)
      }

      // 估算填充面积（圆形减去建筑占地面积）
      const circleArea = Math.PI * maxDist * maxDist
      const buildingArea = lowBuildings.length * 800  // 假设每栋800m²
      const fillArea = Math.max(circleArea - buildingArea, 1000)

      // 计算需要的水体积
      const requiredVolume = fillArea * tryLevel

      if (requiredVolume >= usedVolume || tryLevel >= 50) {
        currentWaterLevel = tryLevel
        filledBuildings = lowBuildings

        // 生成水多边形边界点（圆形边界）
        const numPoints = 32
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2
          const r = maxDist + 10  // 稍微超出建筑
          const x = sourceMercator.x + Math.cos(angle) * r
          const y = sourceMercator.y + Math.sin(angle) * r

          // 转换回经纬度
          const mercatorPos = new Cesium.Cartesian3(x, y, 0)
          const carto = projection.unproject(mercatorPos)
          const lon = Cesium.Math.toDegrees(carto.longitude)
          const lat = Cesium.Math.toDegrees(carto.latitude)

          waterBoundaryPoints.push(Cesium.Cartesian3.fromDegrees(lon, lat, terrainHeight + currentWaterLevel))
        }
        break
      }
    }

    // 更新水多边形
    if (floodWaterPlane && waterBoundaryPoints.length >= 3) {
      floodWaterPlane.polygon.hierarchy = new Cesium.PolygonHierarchy(waterBoundaryPoints)
      floodWaterPlane.polygon.height = currentWaterLevel
    }

    // 更新被包围的建筑统计（水多边形内部的建筑）
    for (const b of filledBuildings) {
      surroundedBuildingIds.add(b.id)
    }

    // 每秒输出日志
    const currentSecond = Math.floor(elapsed)
    if (currentSecond !== lastSecond) {
      lastSecond = currentSecond
      console.log(`⏱️ 第${currentSecond}秒: 剩余水量=${(remainingVolume/1000).toFixed(1)}千m³, 水位=${currentWaterLevel.toFixed(2)}m, 填充建筑间隙=${filledBuildings.length}处`)
    }

    // 估算填充面积
    const filledArea = surroundedBuildingIds.size * 800

    // 更新统计
    floodStats.value = {
      totalBuildings: allBuildings.length,
      floodedBuildings: filledBuildings.length,
      floodedArea: filledArea,
      nearbyBuildings: surroundedBuildingIds.size
    }

    // 更新标签
    if (floodCenterEntity && floodCenterEntity.label) {
      floodCenterEntity.label.text = `时间:${elapsed.toFixed(1)}s/${duration}s\n` +
                                     `剩余水量:${(remainingVolume/1000).toFixed(1)}千m³\n` +
                                     `水位:${currentWaterLevel.toFixed(1)}m\n` +
                                     `填充面积:${filledArea.toFixed(0)}m²\n` +
                                     `包围建筑:${surroundedBuildingIds.size}栋`
    }

    // 强制刷新
    viewer.scene.requestRender()

    // 继续动画
    animationId = requestAnimationFrame(renderFrame)
  }

  // 启动动画
  floodAnimationRunning.value = true
  renderFrame()

  // 返回停止函数
  return () => {
    if (animationId) cancelAnimationFrame(animationId)
    floodAnimationRunning.value = false
  }
}

/**
 * 停止水流动画
 */
function stopFloodAnimation() {
  floodAnimationRunning.value = false
  if (floodAnimationFrame) {
    cancelAnimationFrame(floodAnimationFrame)
    floodAnimationFrame = null
  }
  console.log('水流模拟动画停止')
}

/**
 * 更新水流模拟状态（每帧调用）
 * deltaTime: 时间步长（秒）
 */
function updateFloodSimulation(deltaTime, centerPos) {
  // 1. 更新累计水量
  const flowVolume = floodFlowRate.value * deltaTime  // 这段时间流入的水量(m³)
  floodWaterVolume.value += flowVolume

  // 2. 根据水量计算当前水位高度（简化的物理模型）
  // 假设水在平地上扩散，水位高度 = 水量 / 扩散面积
  // 这里使用简化模型：水位随时间增长，但增长速率逐渐减慢
  const maxWaterLevel = floodWaterLevel.value  // 最大水位由滑块控制
  const fillRate = Math.min(1, floodWaterVolume.value / 50000)  // 达到最大水位的进度
  const currentWaterLevel = maxWaterLevel * Math.pow(fillRate, 0.5)  // 非线性增长

  // 3. 更新累积水流扩散距离
  const FLOW_SPEED = 30  // 水流扩散速度 30米/秒
  floodTotalSpreadDistance += FLOW_SPEED * deltaTime * floodSimSpeed.value

  // 4. 更新水面高度和半径
  if (floodWaterPlane) {
    updateFloodWaterLevel(currentWaterLevel)
    // 同时更新水面半径，让水面向外扩散
    floodWaterPlane.ellipse.semiMinorAxis = Math.min(floodTotalSpreadDistance, FLOOD_RADIUS)
    floodWaterPlane.ellipse.semiMajorAxis = Math.min(floodTotalSpreadDistance, FLOOD_RADIUS)
  } else {
    createFloodWaterPlane(centerPos, currentWaterLevel)
  }

  console.log(`[模拟] 时间:${floodCurrentTime.value.toFixed(1)}s, 扩散距离:${floodTotalSpreadDistance.toFixed(0)}m, 水位:${currentWaterLevel.toFixed(1)}m`)

  // 5. 执行动态淹没分析（只分析当前水位下的淹没情况）
  const floodedBuildings = simulateWaterSpread(centerPos, currentWaterLevel, floodTotalSpreadDistance)

  console.log(`[结果] 已淹:${floodedBuildings.flooded.length}, 新增:${floodedBuildings.newlyFlooded.length}, 退去:${floodedBuildings.dried.length}`)

  // 6. 更新统计
  floodStats.value = {
    totalBuildings: previousFloodedIds.size + floodedBuildings.newlyFlooded.length,
    floodedBuildings: floodedBuildings.flooded.length,
    floodedArea: floodedBuildings.flooded.length * 500  // 粗略估算面积
  }

  // 7. 应用视觉效果（差量更新）
  applyFloodVisuals(floodedBuildings.flooded, floodedBuildings.dried)

  // 8. 更新标签显示
  if (floodCenterEntity) {
    floodCenterEntity.label.text = `模拟时间:${floodCurrentTime.value.toFixed(1)}s\n` +
                                   `累计水量:${(floodWaterVolume.value/1000).toFixed(1)}千m³\n` +
                                   `当前水位:${currentWaterLevel.toFixed(1)}m\n` +
                                   `淹没建筑:${floodedBuildings.flooded.length}栋`
  }
}

// 注意：computeFloodZone和extractAllBuildings已在上方定义

/**
 * 水流包围动画（新版算法）
 * 水流从中心点扩散，遇到建筑边界停止，直到用完总水量
 * 统计被包围的建筑数量和总覆盖面积
 */
function animateFloodSurround(allBuildings, centerPos, totalWaterVolume, terrainHeight) {
  const projection = new Cesium.WebMercatorProjection()
  const startTime = Date.now()
  let animationId = null
  let lastSecond = -1

  // 水源点投影（复用视域分析逻辑）
  const sourceCarto = Cesium.Cartographic.fromDegrees(centerPos.lon, centerPos.lat)
  const sourceMercator = projection.project(sourceCarto)

  // 转换建筑坐标为相对于水源点的局部坐标（复用视域分析逻辑）
  const buildings = allBuildings.map(b => {
    const dx = b.mercatorX - sourceMercator.x
    const dy = b.mercatorY - sourceMercator.y
    // 计算建筑占地面积（用于最终统计）
    const footprintArea = b.bounds ? 
      (b.bounds.maxLon - b.bounds.minLon) * (b.bounds.maxLat - b.bounds.minLat) * 111000 * 111000 : 
      800 // 默认800平方米
    return {
      ...b,
      relativeX: dx,
      relativeY: dy,
      footprintArea: Math.abs(footprintArea)
    }
  })

  console.log(`开始水流包围动画: ${buildings.length}栋建筑, 总水量${totalWaterVolume}m3`)

  // 创建水多边形实体
  floodWaterPlane = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy([]),
      material: Cesium.Color.fromCssColorString('rgba(0,150,255,0.5)'),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('rgba(0,100,200,0.8)'),
      outlineWidth: 2,
      height: 0,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
    }
  })

  // 被包围的建筑集合
  const surroundedBuildingIds = new Set()
  let finalWaterArea = 0
  let currentWaterLevel = 0

  function renderFrame() {
    const elapsed = (Date.now() - startTime) / 1000

    // 动画完成条件：水位达到上限或水量用完
    if (currentWaterLevel >= 50) {
      console.log('✅ 水流动画完成（水位达到上限）')
      console.log(`📊 最终结果: 包围建筑=${surroundedBuildingIds.size}栋, 水覆盖面积=${finalWaterArea.toFixed(0)}m², 被包围建筑面积=${Array.from(surroundedBuildingIds).reduce((sum, id) => {
        const b = buildings.find(b => b.id === id)
        return sum + (b ? b.footprintArea : 0)
      }, 0).toFixed(0)}m²`)
      floodAnimationRunning.value = false
      return
    }

    // 每帧增加水位（模拟水流持续注入）
    const waterLevelIncrement = 0.1
    currentWaterLevel += waterLevelIncrement

    // 根据已用水量计算当前水位
    // 简化的物理模型：水位从0开始上升
    let currentWaterLevel = 0
    let waterRadius = 0

    // 尝试不同的水位，找到能容纳当前用水量的配置
    for (let tryLevel = 0.1; tryLevel <= 10; tryLevel += 0.1) {
      // 在当前水位下，计算水流可以扩散到的半径
      // 水流遇到高于水位的建筑会停止
      let maxRadius = 0
      const numRays = 72 // 72个方向射线

      for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * Math.PI * 2
        const dirX = Math.cos(angle)
        const dirY = Math.sin(angle)

        // 沿此方向射线检测建筑
        let rayMaxDist = 1000 // 默认最大1000米

        for (const b of buildings) {
          // 只考虑高于当前水位的建筑（阻挡水流）
          if (b.height > tryLevel) {
            // 计算射线与建筑包围盒的相交（复用视域分析的射线包围盒检测）
            const boxHit = rayBoxIntersection(
              0, 0, dirX, dirY,
              b.relativeX - 15, b.relativeY - 15, // 建筑边界（简化）
              b.relativeX + 15, b.relativeY + 15
            )

            if (boxHit && boxHit.enter > 0 && boxHit.enter < rayMaxDist) {
              rayMaxDist = boxHit.enter
            }
          }
        }

        maxRadius = Math.max(maxRadius, rayMaxDist)
      }

      // 估算当前水位下的水体积
      // 简化：水体积 ≈ 水覆盖面积 × 水位高度
      const waterArea = Math.PI * maxRadius * maxRadius
      const requiredVolume = waterArea * tryLevel

      if (requiredVolume >= usedVolume || tryLevel >= 10) {
        currentWaterLevel = tryLevel
        waterRadius = maxRadius
        break
      }
    }

    // 生成水多边形边界点（基于视域分析射线检测，但水流可填充缝隙）
    const waterBoundaryPoints = []
    const numPoints = 72

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)

      // 收集此方向上的所有建筑阻挡点（视域分析方式）
      const obstacles = []
      for (const b of buildings) {
        if (b.height > currentWaterLevel) {
          const boxHit = rayBoxIntersection(
            0, 0, dirX, dirY,
            b.relativeX - 15, b.relativeY - 15,
            b.relativeX + 15, b.relativeY + 15
          )
          if (boxHit && boxHit.enter > 0) {
            obstacles.push({
              dist: boxHit.enter,
              building: b,
              exit: boxHit.exit
            })
          }
        }
      }

      // 按距离排序
      obstacles.sort((a, b) => a.dist - b.dist)

      // 水流逻辑：如果有建筑阻挡，水流绕过建筑边缘继续扩散
      // 简化为：如果建筑间缝隙足够大，水流可以通过
      let maxDist = waterRadius
      let lastObstacleEnd = 0

      for (const obs of obstacles) {
        // 检查建筑间的缝隙是否足够水流通过
        const gap = obs.dist - lastObstacleEnd
        if (gap < 5) {
          // 缝隙太小，水流被阻挡在此
          maxDist = Math.min(maxDist, obs.dist)
          break
        }
        // 水流可以通过缝隙，继续检查下一个阻挡
        lastObstacleEnd = obs.exit
      }

      // 转换回经纬度坐标
      const x = sourceMercator.x + Math.cos(angle) * maxDist
      const y = sourceMercator.y + Math.sin(angle) * maxDist
      const mercatorPos = new Cesium.Cartesian3(x, y, 0)
      const carto = projection.unproject(mercatorPos)
      const lon = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)

      waterBoundaryPoints.push(Cesium.Cartesian3.fromDegrees(lon, lat, terrainHeight + currentWaterLevel))
    }

    // 更新水多边形
    if (floodWaterPlane && waterBoundaryPoints.length >= 3) {
      floodWaterPlane.polygon.hierarchy = new Cesium.PolygonHierarchy(waterBoundaryPoints)
      floodWaterPlane.polygon.height = currentWaterLevel
      // 计算水面积
      finalWaterArea = calculatePolygonArea(waterBoundaryPoints)
    }

    // 更新被包围的建筑（建筑边界被水覆盖）
    for (const b of buildings) {
      const dist = Math.sqrt(b.relativeX * b.relativeX + b.relativeY * b.relativeY)
      // 如果建筑边界在水流范围内，则认为被包围
      if (dist <= waterRadius && !surroundedBuildingIds.has(b.id)) {
        // 检查建筑是否高于水位（不被淹没，只是被包围）
        if (b.height > currentWaterLevel) {
          surroundedBuildingIds.add(b.id)
        }
      }
    }

    // 每秒输出日志
    const currentSecond = Math.floor(elapsed)
    if (currentSecond !== lastSecond) {
      lastSecond = currentSecond
      const surroundedArea = Array.from(surroundedBuildingIds).reduce((sum, id) => {
        const b = buildings.find(b => b.id === id)
        return sum + (b ? b.footprintArea : 0)
      }, 0)
      console.log(`⏱️ 第${currentSecond}秒: 剩余水量=${(remainingVolume/1000).toFixed(1)}千m³, 水位=${currentWaterLevel.toFixed(2)}m, 水流半径=${waterRadius.toFixed(0)}m, 包围=${surroundedBuildingIds.size}栋`)
    }

    // 更新统计
    const totalSurroundedArea = Array.from(surroundedBuildingIds).reduce((sum, id) => {
      const b = buildings.find(b => b.id === id)
      return sum + (b ? b.footprintArea : 0)
    }, 0)

    floodStats.value = {
      totalBuildings: buildings.length,
      floodedBuildings: surroundedBuildingIds.size,
      floodedArea: finalWaterArea + totalSurroundedArea, // 水面积 + 被包围建筑面积
      nearbyBuildings: surroundedBuildingIds.size
    }

    // 更新标签
    if (floodCenterEntity && floodCenterEntity.label) {
      floodCenterEntity.label.text = `时间:${elapsed.toFixed(1)}s\n` +
                                     `剩余水量:${(remainingVolume/1000).toFixed(1)}千m³\n` +
                                     `水位:${currentWaterLevel.toFixed(1)}m\n` +
                                     `包围建筑:${surroundedBuildingIds.size}栋\n` +
                                     `总覆盖面积:${(finalWaterArea + totalSurroundedArea).toFixed(0)}m²`
    }

    // 强制刷新
    viewer.scene.requestRender()

    // 继续动画
    animationId = requestAnimationFrame(renderFrame)
  }

  // 启动动画
  floodAnimationRunning.value = true
  renderFrame()

  // 返回停止函数
  return () => {
    if (animationId) cancelAnimationFrame(animationId)
    floodAnimationRunning.value = false
  }
}

/**
 * 清除淹没分析结果
 */
function clearFlood() {
  if (!viewer) return

  // 停止动画
  stopFloodAnimation()

  // 清除实体
  if (floodCenterEntity) {
    viewer.entities.remove(floodCenterEntity)
    floodCenterEntity = null
  }

  // 清除水面平面
  if (floodWaterPlane) {
    viewer.entities.remove(floodWaterPlane)
    floodWaterPlane = null
  }

  // 清除调试线条
  floodDebugLines.forEach(line => viewer.entities.remove(line))
  floodDebugLines = []

  // 重置状态
  previousFloodedIds.clear()
  floodedBuildingWaterDepths.clear()
  floodCurrentTime.value = 0
  floodWaterVolume.value = 0
  floodTotalSpreadDistance = 0
  floodStats.value = {
    totalBuildings: 0,
    floodedBuildings: 0,
    floodedArea: 0,
    nearbyBuildings: 0
  }
}

/**
 * 切换淹没分析模式
 */
function toggleFlood() {
  console.log('切换淹没分析模式')
  floodActive.value = !floodActive.value
  console.log('floodActive:', floodActive.value)

  if (floodActive.value) {
    // 激活淹没分析时关闭其他分析
    if (viewshedActive.value) {
      viewshedActive.value = false
      clearViewshed()
    }
    if (heatmapVisible.value) {
      heatmapVisible.value = false
      clearHeatmap()
    }

    // 添加鼠标点击监听
    console.log('添加鼠标点击监听')
    viewer.screenSpaceEventHandler.setInputAction(handleFloodClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  } else {
    // 关闭淹没分析
    clearFlood()
    floodCenterPosition.value = null

    // 移除鼠标点击监听
    console.log('移除鼠标点击监听')
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }
}

/**
 * 处理淹没分析点击事件
 */
function handleFloodClick(movement) {
  console.log('处理淹没分析点击事件')
  if (!floodActive.value) {
    console.log('淹没分析未激活，忽略点击')
    return
  }

  const pickedPosition = viewer.scene.pickPosition(movement.position)
  if (!pickedPosition) {
    console.log('未获取到点击位置')
    return
  }

  const cartographic = Cesium.Cartographic.fromCartesian(pickedPosition)
  const lon = Cesium.Math.toDegrees(cartographic.longitude)
  const lat = Cesium.Math.toDegrees(cartographic.latitude)

  console.log('点击位置:', { lon, lat })

  floodCenterPosition.value = { lon, lat }
  calculateFlood({ lon, lat })
}

</script>

<template>
  <div class="test-3d-page">
    <header class="page-header">
      <h2>三维测试页</h2>
      <div class="header-actions">
        <button class="action-btn" :class="{ active: heatmapVisible }" @click="toggleHeatmap">
          <span>🔥</span> 热力图
        </button>
        <button class="action-btn" :class="{ active: viewshedActive.value }" @click="toggleViewshed">
          <span>👁️</span> 视域分析
        </button>
        <button class="action-btn" :class="{ active: floodActive.value }" @click="toggleFlood">
          <span>🌊</span> 淹没分析
        </button>
        <button class="action-btn" @click="resetView">
          <span>🏠</span> 重置视角
        </button>
        <router-link to="/home" class="action-btn">
          <span>←</span> 返回首页
        </router-link>
      </div>
    </header>
    
    <div class="map-container">
      <div ref="mapContainer" class="cesium-container"></div>
      
      <!-- 热力图图例 -->
      <div v-if="heatmapVisible" class="heatmap-legend">
        <h4>设施密度</h4>
        <div class="heatmap-gradient"></div>
        <div class="heatmap-labels">
          <span>高</span>
          <span>低</span>
        </div>
      </div>
      
      <!-- 视域分析提示 -->
      <div v-if="viewshedActive" class="viewshed-hint">
        <span>👁️ 点击地图设置观察点</span>
      </div>
      
      <!-- 淹没分析提示 -->
      <div v-if="floodActive" class="flood-hint">
        <span>🌊 点击地图选择淹没分析中心点</span>
      </div>
      
      <!-- 视域高度控制 -->
      <div v-if="viewshedActive" class="viewshed-control">
        <label>观察高度: {{ viewshedHeight }}m</label>
        <input
          type="range"
          v-model.number="viewshedHeight"
          min="1"
          max="100"
          step="1"
          @input="recalculateViewshed"
        />
        <div class="height-markers">
          <span>1m</span>
          <span>50m</span>
          <span>100m</span>
        </div>
      </div>

      <!-- 淹没分析面板 -->
      <div v-if="floodActive && floodCenterPosition" class="flood-panel">
        <div class="panel-header">
          <span>🌊 淹没分析</span>
          <button @click="floodActive = false; clearFlood()" class="close-btn">×</button>
        </div>

        <div class="panel-section info">
          <div class="info-row">
            <span class="label">目标水位:</span>
            <span class="value">5m</span>
          </div>
          <div class="info-row">
            <span class="label">动画时长:</span>
            <span class="value">10秒</span>
          </div>
          <div class="info-row">
            <span class="label">水量:</span>
            <span class="value">50000 m³</span>
          </div>
        </div>

        <div class="panel-section stats">
          <h4>淹没统计</h4>
          <div class="stat-row">
            <span class="label">可淹没建筑:</span>
            <span class="value">{{ floodStats.totalBuildings || 0 }} 栋</span>
          </div>
          <div class="stat-row highlight">
            <span class="label">已淹没:</span>
            <span class="value">{{ floodStats.floodedBuildings || 0 }} 栋</span>
          </div>

          <div v-if="Object.keys(floodStats.byCategory || {}).length > 0" class="category-stats">
            <h5>按类型分布</h5>
            <div
              v-for="(count, category) in floodStats.byCategory"
              :key="category"
              class="category-row"
            >
              <span class="category-name">{{ category }}:</span>
              <span class="category-count">{{ count }} 栋</span>
            </div>
          </div>
        </div>
      </div>

      <div class="legend-panel">
        <h4>设施类型</h4>
        <div class="legend-item">
          <span class="legend-color" style="background: #ef4444;"></span>
          <span>医疗卫生</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background: #10b981;"></span>
          <span>教育服务</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background: #f59e0b;"></span>
          <span>应急避难</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background: #22d3ee;"></span>
          <span>居民小区</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background: #eab308;"></span>
          <span>商业设施</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background: #9333ea;"></span>
          <span>其他设施</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-3d-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  min-height: 600px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #1f2937;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  text-decoration: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.action-btn.active {
  background: #3b82f6;
  color: #fff;
  border-color: #3b82f6;
}

.map-container {
  flex: 1;
  position: relative;
  min-height: 500px;
}

.cesium-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  min-width: 800px;
  min-height: 500px;
}

.legend-panel {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 140px;
}

.legend-panel h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 13px;
  color: #4b5563;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

/* 热力图图例 */
.heatmap-legend {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 120px;
  z-index: 10;
}

.heatmap-legend h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #1f2937;
  text-align: center;
}

.heatmap-gradient {
  height: 15px;
  background: linear-gradient(to right, #a50026, #ff7f00, #ffff00, #00ff00, #00bfff, #0000ff);
  border-radius: 3px;
  margin: 5px 0;
}

.heatmap-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #4b5563;
}

/* 视域分析提示 */
.viewshed-hint {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(59, 130, 246, 0.95);
  color: #fff;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* 视域高度控制 */
.viewshed-control {
  position: absolute;
  top: 70px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
  min-width: 180px;
}

.viewshed-control label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 10px;
}

.viewshed-control input[type="range"] {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: #e5e7eb;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.viewshed-control input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.viewshed-control input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.height-markers {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #6b7280;
  margin-top: 5px;
}

:global(.cesium-viewer-bottom) {
  display: none !important;
}

/* 淹没分析提示 */
.flood-hint {
  position: absolute;
  top: 120px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 102, 204, 0.9);
  color: white;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* 淹没分析面板 */
.flood-panel {
  position: absolute;
  top: 70px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 11;
  min-width: 220px;
  max-width: 280px;
}

.flood-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: rgba(0, 102, 204, 0.1);
  border-radius: 8px 8px 0 0;
}

.flood-panel .panel-header span {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.flood-panel .close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.flood-panel .close-btn:hover {
  color: #ef4444;
}

.flood-panel .panel-section {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.flood-panel .panel-section:last-child {
  border-bottom: none;
  border-radius: 0 0 8px 8px;
}

.flood-panel .slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.flood-panel .slider-label span {
  font-size: 13px;
  font-weight: 500;
  color: #4b5563;
}

.flood-panel .slider-label .value {
  font-size: 13px;
  font-weight: 600;
  color: #0066cc;
}

.flood-panel .slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: #e5e7eb;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.flood-panel .slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: #0066cc;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.flood-panel .slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #0066cc;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.flood-panel .slider-range {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #6b7280;
  margin-top: 5px;
}

.flood-panel .stats h4 {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px 0;
}

.flood-panel .stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.flood-panel .stat-row:last-child {
  margin-bottom: 0;
}

.flood-panel .stat-row .label {
  color: #4b5563;
}

.flood-panel .stat-row .value {
  font-weight: 600;
  color: #1f2937;
}

.flood-panel .stat-row.highlight .value {
  color: #0066cc;
}

.flood-panel .category-stats {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.flood-panel .category-stats h5 {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  margin: 0 0 8px 0;
  text-transform: uppercase;
}

.flood-panel .category-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 11px;
}

.flood-panel .category-row .category-name {
  color: #4b5563;
}

.flood-panel .category-row .category-count {
  font-weight: 500;
  color: #1f2937;
}
</style>
