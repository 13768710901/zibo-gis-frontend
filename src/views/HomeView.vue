<template>
  <div class="home">
    <section class="home-header">
      <div>
        <h2 class="home-title">数据总览</h2>
        <p class="home-subtitle">淄博市张店区三维公共服务设施平台</p>
      </div>
      <div class="home-tag">数据来源 · 更新时间</div>
    </section>

    <section class="home-stats">
      <div
        v-for="item in stats"
        :key="item.label"
        class="stat-card"
      >
        <div class="stat-label">{{ item.label }}</div>
        <div class="stat-value-line">
          <span class="stat-value">{{ item.value }}</span>
          <span class="stat-unit">{{ item.unit }}</span>
        </div>
      </div>
    </section>

    <section class="home-bottom">
      <div class="panel panel-main">
        <div class="panel-header">
          <h3>设施类型分布</h3>
          <span class="panel-desc">数据来源</span>
        </div>
        <div class="panel-body">
          <div ref="chartRef" class="chart"></div>
        </div>
      </div>

      <div class="panel panel-side">
        <div class="panel-header">
          <h3>设施密度热力图</h3>
          <span class="panel-desc">数据来源</span>
        </div>
        <div class="panel-body">
          <div ref="heatmapMapRef" class="heatmap-map"></div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, inject } from 'vue'
import axios from 'axios'
import * as echarts from 'echarts'

// 高德 Web JS API Key 和安全密钥（复用RouteView的配置）
const AMAP_MAP_KEY = '664e5e7e33673e5fb1f99ded7979abdd'
const AMAP_SECURITY_CODE = 'e5d2676893cfd6c5785e1297392998d9'

// 顶部统计卡片（从后端设施数据实时统计）
const stats = ref([
  { label: '公共服务设施总数', value: 0, unit: '个' },
  { label: '医疗卫生设施', value: 0, unit: '个' },
  { label: '教育服务设施', value: 0, unit: '个' },
  { label: '应急避难场所', value: 0, unit: '个' },
  { label: '居民/小区设施', value: 0, unit: '个' },
  { label: '商业/商场设施', value: 0, unit: '个' }
])

// 设施类型统计（用于饼图）- 硬编码中文标签
const facilityTypes = ref([
  { label: '医疗卫生', value: 0, color: '#ef4444' },
  { label: '教育服务', value: 0, color: '#3b82f6' },
  { label: '应急避难', value: 0, color: '#fb923c' },
  { label: '居民/小区', value: 0, color: '#22c55e' },
  { label: '商业/商场', value: 0, color: '#eab308' },
  { label: '其他', value: 0, color: '#60a5fa' }
])

// 设施类型分布（柱状图）——与列表/三维图例保持相同的 6 类
const typeDistribution = ref([
  { label: '医疗卫生', value: 0, color: '#ef4444' },
  { label: '教育服务', value: 0, color: '#3b82f6' },
  { label: '应急避难', value: 0, color: '#fb923c' },
  { label: '居民/小区', value: 0, color: '#22c55e' },
  { label: '商业/商场', value: 0, color: '#eab308' },
  { label: '其他', value: 0, color: '#60a5fa' }
])

// 热力图数据
const heatmapData = ref([])

const chartRef = ref(null)
const heatmapMapRef = ref(null)
let chartInstance
let heatmapMapInstance
let amapInstance = null
let heatmapLayer = null

// 注入全局位置状态
// const userLocation = inject('userLocation')
// const locationPermission = inject('locationPermission')
// const locationError = inject('locationError')

// 高德地图加载函数
function loadAmapScript() {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve(window.AMap)
      return
    }

    // 高德 JS v2 需要提前设置安全密钥配置
    window._AMapSecurityConfig = {
      securityJsCode: AMAP_SECURITY_CODE,
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    // 加载地图和热力图插件
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_MAP_KEY}&plugin=AMap.HeatMap`
    script.onload = () => {
      console.log('高德地图脚本加载完成')
      console.log('window.AMap:', window.AMap)
      console.log('AMap.HeatMap:', AMap.HeatMap)
      
      if (window.AMap) {
        // 等待插件加载完成
        if (AMap.HeatMap) {
          console.log('热力图插件已加载')
          resolve(window.AMap)
        } else {
          console.log('等待热力图插件加载...')
          // 轮询检查插件是否加载
          let attempts = 0
          const checkPlugin = setInterval(() => {
            attempts++
            if (AMap.HeatMap) {
              console.log('热力图插件加载成功')
              clearInterval(checkPlugin)
              resolve(window.AMap)
            } else if (attempts > 10) {
              console.error('热力图插件加载超时')
              clearInterval(checkPlugin)
              resolve(window.AMap) // 即使插件没加载也返回AMap
            }
          }, 100)
        }
      } else {
        reject(new Error('AMap loaded but window.AMap is undefined'))
      }
    }
    script.onerror = (e) => {
      console.error('高德地图脚本加载失败:', e)
      reject(e)
    }
    document.head.appendChild(script)
  })
}

// 与列表/三维图例一致的一套类型归一化函数
const mapTypeKey = (typeText) => {
  if (!typeText) return '其他设施'
  const raw = String(typeText)
  const t = raw.toLowerCase()

  // 直接匹配后端返回的类型
  if (raw === '医疗卫生') return '医疗卫生'
  if (raw === '教育服务') return '教育服务'
  if (raw === '应急避难') return '应急避难'
  if (raw === '居民小区') return '居民/小区'
  if (raw === '商业商场') return '商业/商场'
  
  // 兼容性匹配
  if (raw.includes('医') || t.includes('hospital')) return '医疗卫生'
  if (raw.includes('教育') || raw.includes('学') || t.includes('school')) return '教育服务'
  if (raw.includes('应急') || raw.includes('避难') || t.includes('shelter')) return '应急避难'
  if (raw.includes('居民') || raw.includes('小区') || raw.includes('住宅') || t.includes('residential')) return '居民/小区'
  if (raw.includes('商业') || raw.includes('商场') || raw.includes('购物') || t.includes('commercial')) return '商业/商场'
  
  // 默认归为其他
  return '其他设施'
}

const updateChart = () => {
  if (!chartInstance) return
  
  // 确保使用所有6个类别，不过滤
  const types = facilityTypes.value.slice(0, 6)
  if (types.length === 0) {
    console.log('设施类型数据为空，不更新图表')
    return
  }
  
  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: function (params) {
        const data = params[0]
        return `${data.name}<br/>${data.value}`
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: types.map(item => item.label),
      axisLabel: { interval: 0, rotate: 30, fontSize: 11, color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#334155' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#e5e7eb',
        fontSize: 12
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(75, 85, 99, 0.3)'
        }
      }
    },
    series: [{
      name: '设施数量',
      type: 'bar',
      data: types.map(item => ({
        value: item.value,
        itemStyle: {
          color: item.color
        },
        name: item.label
      })),
      barWidth: '60%',
      itemStyle: {
        borderRadius: [4, 4, 0, 0]
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  }

  console.log('更新柱状图:', option)
  chartInstance.setOption(option)
}

const updateHeatmap = async () => {
  if (!heatmapMapRef.value) {
    console.log('热力图容器不存在')
    return
  }
  
  // 加载高德地图脚本（复用 RouteView.vue 的实现）
  const loadAmapScript = () => {
    return new Promise((resolve, reject) => {
      if (window.AMap) {
        resolve(window.AMap)
        return
      }
      
      // 设置安全密钥（高德地图 2.0 必需）
      window._AMapSecurityConfig = {
        securityJsCode: 'e5d2676893cfd6c5785e1297392998d9'
      }
      
      // 创建脚本元素加载高德地图
      const script = document.createElement('script')
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=664e5e7e33673e5fb1f99ded7979abdd&plugin=AMap.HeatMap'
      script.async = true
      
      script.onload = () => {
        if (window.AMap && typeof window.AMap.Map === 'function') {
          console.log('高德地图SDK加载成功')
          resolve(window.AMap)
        } else {
          reject(new Error('高德地图SDK加载不完整'))
        }
      }
      
      script.onerror = () => {
        console.error('高德地图脚本加载失败')
        reject(new Error('高德地图脚本加载失败'))
      }
      
      document.head.appendChild(script)
    })
  }
  
  try {
    console.log('开始加载高德地图')
    
    // 等待容器渲染完成
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 加载高德地图
    const AMap = await loadAmapScript()
    console.log('高德地图加载成功')
    
    // 初始化高德地图
    amapInstance = new AMap.Map(heatmapMapRef.value, {
      viewMode: '2D',
      zoom: 12,
      center: [118.035, 36.799], // 张店区中心
      mapStyle: 'amap://styles/normal', // 使用标准样式，与 RouteView 一致
      resizeEnable: true,
      showLabel: true
    })
    
    // 监听地图完全加载
    amapInstance.on('complete', () => {
      console.log('高德地图初始化完成')
      console.log('热力图数据:', heatmapData.value)
      
      // 准备热力图数据
      if (heatmapData.value.length > 0) {
        // 转换数据格式为高德热力图需要的格式
        const heatMapData = heatmapData.value
          .filter(grid => grid.count > 0)
          .map(grid => ({
            lng: grid.x,
            lat: grid.y,
            count: grid.count
          }))
        
        console.log('转换后的热力图数据:', heatMapData)
        
        if (heatMapData.length > 0) {
          try {
            console.log('开始创建热力图图层')
            
            // 检查热力图插件是否可用
            if (!AMap.HeatMap) {
              console.error('AMap.HeatMap 插件未加载，降级为 ECharts 显示')
              renderEChartsHeatmap()
              return
            }
            
            // 创建热力图图层
            heatmapLayer = new AMap.HeatMap(amapInstance, {
              radius: 50, // 热力图的半径大小
              opacity: [0, 0.8], // 热力图的透明度范围
              gradient: {
                0.4: 'blue',
                0.6: 'cyan',
                0.7: 'lime',
                0.8: 'yellow',
                1.0: 'red'
              }
            })
            
            console.log('热力图图层创建成功，开始设置数据')
            
            // 设置热力图数据
            heatmapLayer.setDataSet({
              data: heatMapData,
              max: Math.max(...heatMapData.map(item => item.count))
            })
            
            console.log('热力图数据设置完成')
          } catch (heatmapError) {
            console.error('热力图创建失败:', heatmapError)
            renderEChartsHeatmap()
          }
        } else {
          console.log('没有有效的热力图数据点')
        }
      } else {
        console.log('热力图数据为空')
      }
    })
    
    // 监听地图错误
    amapInstance.on('error', (error) => {
      console.error('高德地图初始化错误:', error)
    })
    
  } catch (error) {
    console.error('高德地图加载失败:', error)
    renderEChartsHeatmap()
  }
}

// ECharts 降级显示
const renderEChartsHeatmap = () => {
  if (!heatmapMapRef.value) return
  
  if (!heatmapMapInstance) {
    heatmapMapInstance = echarts.init(heatmapMapRef.value)
  }
  
  if (heatmapData.value.length === 0) {
    console.log('热力图数据为空')
    return
  }
  
  // 转换数据为 ECharts 散点图格式
  const heatMapData = heatmapData.value
    .filter(grid => grid.count > 0)
    .map(grid => ({
      value: [grid.x, grid.y, grid.count],
      itemStyle: {
        color: getHeatmapColor(grid.count)
      }
    }))
  
  const maxCount = Math.max(...heatmapData.value.map(item => item.count))
  
  const option = {
    backgroundColor: '#1a1a2e',
    tooltip: {
      position: 'top',
      formatter: function (params) {
        return `设施数量: ${params.value[2]}`
      }
    },
    grid: {
      top: '10%',
      bottom: '15%',
      left: '5%',
      right: '5%'
    },
    xAxis: {
      type: 'value',
      show: true,
      min: 118.0,
      max: 118.1,
      axisLabel: { show: false },
      axisTick: { show: false },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      show: true,
      min: 36.75,
      max: 36.85,
      axisLabel: { show: false },
      axisTick: { show: false },
      splitLine: { show: false }
    },
    series: [{
      type: 'scatter',
      data: heatMapData,
      symbolSize: function (data) {
        const count = data[2]
        return Math.max(10, Math.min(30, count * 2))
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  }
}

// 根据数量获取颜色
const getHeatmapColor = (count) => {
  if (count <= 2) return '#3b82f6'  // 蓝色
  if (count <= 5) return '#22c55e'  // 绿色
  if (count <= 8) return '#eab308'  // 黄色
  if (count <= 12) return '#f97316' // 橙色
  return '#ef4444'                  // 红色
}

const handleResize = () => {
  if (chartInstance) {
    chartInstance.resize()
  }
  if (heatmapMapInstance) {
    heatmapMapInstance.resize()
  }
  if (amapInstance) {
    amapInstance.getSize()
    amapInstance.setCenter([118.035, 36.799])
  }
}

const loadFacilityStats = async () => {
  try {
    console.log('开始加载设施数据')
    const resp = await axios.get('/api/facilities')
    const arr = Array.isArray(resp.data) ? resp.data : []

    console.log('原始设施数据:', arr)

    const total = arr.length
    let medical = 0
    let education = 0
    let shelter = 0
    let resident = 0
    let commercial = 0
    let other = 0

    arr.forEach(item => {
      const t = mapTypeKey(item.type) // 修复：使用小写的 type 字段
      console.log(`设施类型: ${item.type} -> ${t}`)
      switch (t) {
        case '医疗卫生': medical++; break
        case '教育服务': education++; break
        case '应急避难': shelter++; break
        case '居民/小区': resident++; break
        case '商业/商场': commercial++; break
        default: other++; break
      }
    })

    console.log('分类统计:', { medical, education, shelter, resident, commercial, other })

    stats.value[0].value = total
    stats.value[1].value = medical
    stats.value[2].value = education
    stats.value[3].value = shelter
    stats.value[4].value = resident
    stats.value[5].value = commercial

    facilityTypes.value[0].value = medical
    facilityTypes.value[1].value = education
    facilityTypes.value[2].value = shelter
    facilityTypes.value[3].value = resident
    facilityTypes.value[4].value = commercial
    facilityTypes.value[5].value = other

    console.log('更新后的facilityTypes:', facilityTypes.value)

    // 更新饼图
    if (chartInstance) {
      updateChart()
    }
    // 更新热力图
    if (heatmapMapInstance) {
      updateHeatmap()
    }

    console.log('设施数据加载完成')

    // 加载热力图数据 - 使用网格聚合
    console.log('开始加载热力图数据')
    try {
      // 定义网格大小：约 500m x 500m 的网格
      const gridSize = 0.0045 // 约500m的经纬度度数
      const gridStats = new Map()
      
      // 遍历设施，按网格聚合
      arr.forEach(facility => {
        const lon = facility.longitude ?? facility.lon
        const lat = facility.latitude ?? facility.lat
        
        if (!lon || !lat) return
        
        // 计算网格坐标
        const gridX = Math.floor(lon / gridSize) * gridSize + gridSize / 2
        const gridY = Math.floor(lat / gridSize) * gridSize + gridSize / 2
        const gridKey = `${gridX.toFixed(4)},${gridY.toFixed(4)}`
        
        if (!gridStats.has(gridKey)) {
          gridStats.set(gridKey, {
            x: gridX,
            y: gridY,
            count: 0
          })
        }
        
        gridStats.get(gridKey).count++
      })
      
      // 只保留有设施的网格
      const heatmapDataArray = Array.from(gridStats.values())
        .filter(grid => grid.count > 0)
      
      console.log('网格聚合后的热力图数据:', heatmapDataArray)
      console.log('最大密度:', Math.max(...heatmapDataArray.map(g => g.count)))
      
      heatmapData.value = heatmapDataArray
      
      // 延迟初始化热力图
      setTimeout(() => {
        updateHeatmap()
      }, 100)
      
    } catch (heatmapError) {
      console.error('热力图数据加载失败:', heatmapError)
    }

  } catch (error) {
    console.error('统计数据加载失败:', error)
  }
}

onMounted(async () => {
  console.log('HomeView mounted')
  
  // 初始化图表
  if (chartRef.value) {
    chartInstance = echarts.init(chartRef.value)
    updateChart()
  }
  
  // 初始化热力图
  if (heatmapMapRef.value) {
    heatmapMapInstance = echarts.init(heatmapMapRef.value)
  }
  
  await loadFacilityStats()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  if (heatmapMapInstance) {
    heatmapMapInstance.dispose()
    heatmapMapInstance = null
  }
  if (heatmapLayer) {
    heatmapLayer.setMap(null)
    heatmapLayer = null
  }
  if (amapInstance) {
    amapInstance.destroy()
    amapInstance = null
  }
})
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.home-title {
  font-size: 1.4rem;
  margin: 0;
}

.home-subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.9rem;
  color: #9ca3af;
}

.home-tag {
  font-size: 0.75rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.7);
  color: #e5e7eb;
  background: rgba(15, 23, 42, 0.7);
}

.home-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.stat-card {
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  background: radial-gradient(circle at top, rgba(37, 99, 235, 0.3), rgba(15, 23, 42, 0.95));
  border: 1px solid rgba(129, 140, 248, 0.35);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.8);
}

.stat-label {
  font-size: 0.8rem;
  color: #cbd5f5;
}

.stat-value-line {
  margin-top: 0.25rem;
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
}

.stat-value {
  font-size: 1.4rem;
  font-weight: 600;
}

.stat-unit {
  font-size: 0.75rem;
  color: #a5b4fc;
}

.home-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.9rem;
}

.panel {
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.3);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.9);
  padding: 0.85rem 0.9rem 0.9rem;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.6rem;
}

.panel-header h3 {
  margin: 0;
  font-size: 0.98rem;
}

.panel-desc {
  font-size: 0.78rem;
  color: #9ca3af;
}

.panel-body {
  font-size: 0.85rem;
}

.panel-body-text p {
  margin: 0 0 0.6rem;
  line-height: 1.6;
  color: #e5e7eb;
}

.panel-body-text p:last-child {
  margin: 0;
}

.chart {
  width: 100%;
  height: 300px;
}

.heatmap-chart {
  width: 100%;
  height: 300px;
}

.heatmap-map {
  width: 100%;
  height: 300px;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

@media (max-width: 960px) {
  .home-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .home-bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
