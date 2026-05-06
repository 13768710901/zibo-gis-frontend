<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()

const loading = ref(false)
const error = ref('')
const facilities = ref([])

const keyword = ref('')
const typeFilter = ref('all')
const selectedIds = ref([])
const selectionMode = ref(false)
const useGcj = ref(false)

// CSV导入相关
const fileInputRef = ref(null)
const importCoordSystem = ref('wgs84') // 'wgs84' | 'gcj02'
const importing = ref(false)
const importResult = ref({ success: 0, failed: 0, errors: [] })

// 与筛选下拉和三维图例保持一致的一套类型显示文本
const typeOptions = [
  { value: 'all', label: '全部类型' },
  { value: '医疗卫生', label: '医疗卫生' },
  { value: '教育服务', label: '教育服务' },
  { value: '应急避难', label: '应急避难' },
  { value: '居民/小区', label: '居民/小区' },
  { value: '商业/商场', label: '商业/商场' },
  { value: '其他设施', label: '其他设施' }
]

const newFacility = ref({
  name: '',
  // 默认与筛选下拉中的“其他设施”文案一致
  type: '其他设施',
  longitude: '',
  latitude: '',
  address: '数据来源：手动录入'
})

// WGS-84 转 GCJ-02
const wgs84ToGcj02 = (lng, lat) => {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLng = transformLon(lng - 105, lat - 35)
  let dLat = transformLat(lng - 105, lat - 35)
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - 0.00669342162296594323 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLng = (dLng * 180) / (6378245 / sqrtMagic * Math.cos(radLat) * Math.PI)
  dLat = (dLat * 180) / ((6356752.3142 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI)
  return [lng + dLng, lat + dLat]
}

// GCJ-02（高德/腾讯）转 WGS-84，便于在 Cesium 中准确显示
const outOfChina = (lng, lat) => {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

const transformLat = (x, y) => {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret +=
    ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) /
    3.0
  return ret
}

const transformLon = (x, y) => {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret +=
    ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0
  return ret
}

const gcj02ToWgs84 = (lng, lat) => {
  const a = 6378245.0
  const ee = 0.00669342162296594323
  if (outOfChina(lng, lat)) {
    return [lng, lat]
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLon(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI)
  const mgLat = lat + dLat
  const mgLng = lng + dLng
  return [lng * 1.0 - (mgLng - lng), lat * 1.0 - (mgLat - lat)]
}

const mapTypeKey = (typeText) => {
  if (!typeText) return '其他设施'
  const raw = String(typeText)
  const t = raw.toLowerCase()

  if (raw.includes('医') || t.includes('hospital')) return '医疗卫生'
  // 教育类：兼容“教育服务”“学校”等关键词
  if (raw.includes('教育') || raw.includes('学') || t.includes('school')) return '教育服务'
  if (raw.includes('避') || raw.includes('应急') || t.includes('shelter')) return '应急避难'
  if (raw.includes('居民') || raw.includes('小区') || raw.includes('社区')) return '居民/小区'
  if (raw.includes('商业') || raw.includes('商场') || raw.includes('超市') || t.includes('mall'))
    return '商业/商场'
  return '其他设施'
}

const filteredFacilities = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const type = typeFilter.value

  return facilities.value.filter((f) => {
    if (type !== 'all' && mapTypeKey(f.type) !== type) {
      return false
    }

    if (!kw) return true

    const text = `${f.name || ''} ${f.type || ''} ${f.address || ''}`.toLowerCase()
    return text.includes(kw)
  })
})

const fetchFacilities = async () => {
  loading.value = true
  error.value = ''
  try {
    const resp = await axios.get('/api/facilities')
    const arr = Array.isArray(resp.data) ? resp.data : []
    // 兼容后端返回 lon/lat 字段，将其规范为 longitude/latitude，便于表格展示和三维地图使用
    facilities.value = arr.map((f) => ({
      ...f,
      longitude: f.longitude ?? f.lon ?? null,
      latitude: f.latitude ?? f.lat ?? null,
    }))
  } catch (e) {
    console.error(e)
    error.value = '加载设施数据失败，请检查后端服务是否已启动。'
  } finally {
    loading.value = false
  }
}

// 导出设施数据为Excel（CSV格式）
const exportToExcel = () => {
  if (filteredFacilities.value.length === 0) {
    alert('暂无数据可导出')
    return
  }

  // 表头
  const headers = ['ID', '设施名称', '类型', '经度', '纬度', '地址']

  // 数据行
  const rows = filteredFacilities.value.map((item) => [
    item.id,
    item.name || '',
    item.type || '',
    item.longitude || '',
    item.latitude || '',
    item.address || ''
  ])

  // 组合CSV内容
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) => {
          // 处理包含逗号、引号或换行符的单元格
          const cellStr = String(cell ?? '')
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`
          }
          return cellStr
        })
        .join(',')
    )
  ].join('\n')

  // 添加BOM以支持Excel中文显示
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })

  // 下载文件
  const link = document.createElement('a')
  const dateStr = new Date().toLocaleDateString().replace(/\//g, '-')
  link.href = URL.createObjectURL(blob)
  link.download = `设施数据_${dateStr}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 触发文件选择
const triggerFileSelect = () => {
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

// 解析CSV行（处理引号包裹的情况）
const parseCsvLine = (line) => {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // 转义的引号
        current += '"'
        i++ // 跳过下一个引号
      } else {
        // 切换引号状态
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

// 从CSV导入设施数据
const importFromCsv = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return

  // 重置文件输入，允许再次选择同一文件
  event.target.value = ''

  importing.value = true
  importResult.value = { success: 0, failed: 0, errors: [] }

  try {
    const text = await file.text()
    const lines = text.split('\n').filter((line) => line.trim())

    if (lines.length < 2) {
      alert('CSV文件格式不正确，至少需要包含表头和一行数据')
      importing.value = false
      return
    }

    // 解析表头
    const headers = parseCsvLine(lines[0])
    const nameIdx = headers.findIndex((h) => h.includes('设施名称') || h.toLowerCase().includes('name'))
    const typeIdx = headers.findIndex((h) => h.includes('类型') || h.toLowerCase().includes('type'))
    const lonIdx = headers.findIndex((h) => h.includes('经度') || h.toLowerCase().includes('lon'))
    const latIdx = headers.findIndex((h) => h.includes('纬度') || h.toLowerCase().includes('lat'))
    const addrIdx = headers.findIndex((h) => h.includes('地址') || h.toLowerCase().includes('address'))

    if (nameIdx === -1 || lonIdx === -1 || latIdx === -1) {
      alert('CSV文件缺少必要列：设施名称、经度、纬度')
      importing.value = false
      return
    }

    // 解析数据行
    const facilitiesToAdd = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < Math.max(nameIdx, lonIdx, latIdx) + 1) continue

      const name = cols[nameIdx]
      const lon = parseFloat(cols[lonIdx])
      const lat = parseFloat(cols[latIdx])
      const type = typeIdx >= 0 ? mapTypeKey(cols[typeIdx]) : '其他设施'
      const address = addrIdx >= 0 ? cols[addrIdx] : '数据来源：CSV导入'

      if (!name || Number.isNaN(lon) || Number.isNaN(lat)) {
        importResult.value.errors.push(`第${i + 1}行：名称或坐标无效`)
        continue
      }

      // 坐标转换
      let finalLon = lon
      let finalLat = lat
      if (importCoordSystem.value === 'gcj02') {
        // GCJ-02 转 WGS-84
        const converted = gcj02ToWgs84(lon, lat)
        finalLon = converted[0]
        finalLat = converted[1]
      }

      facilitiesToAdd.push({
        name,
        type,
        longitude: finalLon,
        latitude: finalLat,
        address,
      })
    }

    if (facilitiesToAdd.length === 0) {
      alert('没有有效的设施数据可导入')
      importing.value = false
      return
    }

    // 批量导入
    let success = 0
    let failed = 0
    for (const facility of facilitiesToAdd) {
      try {
        await axios.post('/api/facilities', facility)
        success++
      } catch (e) {
        failed++
        importResult.value.errors.push(`${facility.name}: ${e.message || '导入失败'}`)
      }
    }

    importResult.value.success = success
    importResult.value.failed = failed

    // 刷新数据
    await fetchFacilities()

    // 显示结果
    if (failed === 0) {
      alert(`成功导入 ${success} 个设施`)
    } else {
      alert(`导入完成：成功 ${success} 个，失败 ${failed} 个\n前3个错误：\n${importResult.value.errors.slice(0, 3).join('\n')}`)
    }
  } catch (e) {
    console.error('导入失败:', e)
    alert('导入失败：' + (e.message || '未知错误'))
  } finally {
    importing.value = false
  }
}

const editCoordinates = async (item) => {
  if (typeof window === 'undefined') return

  const oldLon = Number(item.longitude ?? item.lon)
  const oldLat = Number(item.latitude ?? item.lat)

  const lonInput = window.prompt('请输入新的经度：', isNaN(oldLon) ? '' : String(oldLon))
  if (lonInput === null) return
  const latInput = window.prompt('请输入新的纬度：', isNaN(oldLat) ? '' : String(oldLat))
  if (latInput === null) return

  const newLon = Number(lonInput)
  const newLat = Number(latInput)
  if (Number.isNaN(newLon) || Number.isNaN(newLat)) {
    window.alert('坐标格式无效，请输入数字。')
    return
  }

  try {
    await axios.put(`/api/facilities/${item.id}`, {
      name: item.name,
      type: item.type,
      longitude: newLon,
      latitude: newLat,
      address: item.address,
    })
  } catch (e) {
    console.error('更新经纬度失败', e)
    window.alert('更新经纬度失败，请稍后重试。')
    return
  }

  // 更新本地列表数据
  item.longitude = newLon
  item.latitude = newLat

  if (typeof window !== 'undefined') {
    // 更新全局本地设施缓存
    if (!Array.isArray(window.__localFacilities)) {
      window.__localFacilities = []
    }
    const idx = window.__localFacilities.findIndex((f) => f.id === item.id)
    if (idx >= 0) {
      window.__localFacilities[idx] = {
        ...window.__localFacilities[idx],
        lon: newLon,
        lat: newLat,
      }
    } else {
      window.__localFacilities.push({
        id: item.id,
        name: item.name,
        type: item.type,
        lon: newLon,
        lat: newLat,
        address: item.address,
      })
    }

    // 通过事件通知三维地图先移除旧点再添加新点
    if (!Number.isNaN(oldLon) && !Number.isNaN(oldLat)) {
      window.dispatchEvent(
        new CustomEvent('facility-removed', {
          detail: {
            id: item.id,
            name: item.name,
            lon: oldLon,
            lat: oldLat,
          },
        })
      )
    }

    if (!Number.isNaN(newLon) && !Number.isNaN(newLat)) {
      window.dispatchEvent(
        new CustomEvent('facility-added', {
          detail: {
            id: item.id,
            name: item.name,
            type: item.type,
            lon: newLon,
            lat: newLat,
            address: item.address,
          },
        })
      )
    }
  }
}

const deleteSelected = async () => {
  if (!selectedIds.value.length) return

  if (
    typeof window !== 'undefined' &&
    !window.confirm(`确定要删除选中的 ${selectedIds.value.length} 项设施吗？此操作不可恢复。`)
  ) {
    return
  }

  const ids = [...selectedIds.value]
  for (const id of ids) {
    await removeFacility(id)
  }

  selectedIds.value = []
  selectionMode.value = false
}

const removeFacility = async (id) => {
  const idx = facilities.value.findIndex((f) => f.id === id)
  if (idx === -1) return

  const removed = facilities.value[idx]

  try {
    await axios.delete(`/api/facilities/${id}`)
  } catch (e) {
    console.error('删除设施失败', e)
    return
  }

  facilities.value.splice(idx, 1)

  // 从全局本地设施数组中移除对应项
  if (typeof window !== 'undefined' && Array.isArray(window.__localFacilities)) {
    window.__localFacilities = window.__localFacilities.filter((f) => f.id !== removed.id)
  }

  if (removed && removed.longitude != null && removed.latitude != null && typeof window !== 'undefined') {
    const lon = Number(removed.longitude)
    const lat = Number(removed.latitude)
    if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
      window.dispatchEvent(
        new CustomEvent('facility-removed', {
          detail: {
            id: removed.id,
            name: removed.name,
            lon,
            lat,
          },
        })
      )
    }
  }
}

onMounted(() => {
  fetchFacilities()
})

const addLocalFacility = async () => {
  if (!newFacility.value.name || !newFacility.value.longitude || !newFacility.value.latitude) {
    return
  }

  const rawLon = Number(newFacility.value.longitude)
  const rawLat = Number(newFacility.value.latitude)
  if (Number.isNaN(rawLon) || Number.isNaN(rawLat)) {
    return
  }

  // 如果勾选“来源为高德/腾讯坐标”，先从 GCJ-02 转成 WGS-84
  const [lon, lat] = useGcj.value ? gcj02ToWgs84(rawLon, rawLat) : [rawLon, rawLat]
  try {
    // 调用后端接口写入数据库
    const resp = await axios.post('/api/facilities', {
      name: newFacility.value.name,
      type: newFacility.value.type,
      longitude: lon,
      latitude: lat,
      address: newFacility.value.address,
    })

    const data = resp.data || {}
    const id = Number(data.id) || (facilities.value.length
      ? Math.max(...facilities.value.map((f) => Number(f.id) || 0)) + 1
      : 1)

    const record = {
      id,
      name: data.name || newFacility.value.name,
      type: data.type || newFacility.value.type,
      longitude: data.lon ?? lon,
      latitude: data.lat ?? lat,
      address: data.address ?? newFacility.value.address,
    }

    facilities.value.push(record)

    // 维护一个全局的本地设施数组，供地图组件初次加载时使用
    if (typeof window !== 'undefined') {
      if (!Array.isArray(window.__localFacilities)) {
        window.__localFacilities = []
      }
      window.__localFacilities.push({
        id: record.id,
        name: record.name,
        type: record.type,
        lon: record.longitude,
        lat: record.latitude,
        address: record.address,
      })

      // 同步到打开的三维地图（如果存在）：通过全局事件通知 CesiumMap
      if (!Number.isNaN(record.longitude) && !Number.isNaN(record.latitude)) {
        window.dispatchEvent(
          new CustomEvent('facility-added', {
            detail: {
              id: record.id,
              name: record.name,
              type: record.type,
              lon: record.longitude,
              lat: record.latitude,
              address: record.address,
            },
          })
        )
      }
    }

    newFacility.value = {
      name: '',
      type: newFacility.value.type,
      longitude: '',
      latitude: '',
      address: ''
    }
  } catch (e) {
    console.error('新增设施保存到数据库失败', e)
  }
}

const focusOnMap = (item) => {
  if (!item) return

  const lon = Number(item.longitude ?? item.lon)
  const lat = Number(item.latitude ?? item.lat)
  if (Number.isNaN(lon) || Number.isNaN(lat)) return

  if (typeof window !== 'undefined') {
    const payload = {
      id: item.id,
      name: item.name,
      type: item.type,
      lon,
      lat,
      address: item.address,
    }

    // 供三维页面首次加载时使用
    window.__pendingFacilityFocus = payload

    // 如果三维页面当前已经打开，则直接触发聚焦事件
    window.dispatchEvent(
      new CustomEvent('facility-focus', {
        detail: payload,
      })
    )
  }

  router.push('/map')
}
</script>

<template>
  <div class="fac-page">
    <header class="fac-header">
      <div>
        <h2 class="fac-title">设施管理</h2>
        <p class="fac-subtitle">管理所有公共服务设施数据</p>
      </div>
      <div class="fac-actions">
        <template v-if="selectionMode">
          <button
            class="btn btn-ghost"
            @click="selectionMode = false; selectedIds = []"
          >
            取消选择
          </button>
          <button
            class="btn btn-outline"
            @click="deleteSelected"
            :disabled="!selectedIds.length"
          >
            删除选中 ({{ selectedIds.length }})
          </button>
        </template>
        <template v-else>
          <button class="btn btn-outline" @click="selectionMode = true">
            批量删除
          </button>
        </template>
        <button class="btn btn-outline" @click="fetchFacilities" :disabled="loading">
          刷新数据
        </button>
        <button class="btn btn-outline" @click="exportToExcel" :disabled="loading || filteredFacilities.length === 0">
          导出Excel
        </button>
        <!-- 坐标系选择 -->
        <select v-model="importCoordSystem" class="btn btn-outline" style="padding: 0 12px; min-width: 100px;">
          <option value="wgs84">WGS-84坐标</option>
          <option value="gcj02">GCJ-02坐标</option>
        </select>
        <!-- 导入按钮 -->
        <button class="btn btn-outline" @click="triggerFileSelect" :disabled="importing || loading">
          {{ importing ? '导入中...' : '导入CSV' }}
        </button>
        <!-- 隐藏的文件输入 -->
        <input
          ref="fileInputRef"
          type="file"
          accept=".csv"
          style="display: none"
          @change="importFromCsv"
        />
      </div>
    </header>

    <section class="fac-toolbar">
      <div class="toolbar-group">
        <label class="field-label">设施类型</label>
        <select v-model="typeFilter" class="field-select">
          <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="toolbar-group toolbar-grow">
        <label class="field-label">关键词</label>
        <div class="input-wrap">
          <input
            v-model="keyword"
            type="text"
            class="field-input"
            placeholder="搜索设施名称、类型或地址..."
          />
        </div>
      </div>
    </section>

    <section class="fac-create">
      <div class="create-title">快速添加设施</div>
      <div class="create-fields">
        <div class="create-group">
          <label class="field-label">设施名称 <span class="required">*</span></label>
          <input v-model="newFacility.name" class="field-input" type="text" placeholder="输入设施名称" />
        </div>
        <div class="create-group">
          <label class="field-label">设施类型</label>
          <select v-model="newFacility.type" class="field-select">
            <option value="医疗卫生">医疗卫生</option>
            <option value="教育服务">教育服务</option>
            <option value="应急避难">应急避难</option>
            <option value="居民/小区">居民/小区</option>
            <option value="商业/商场">商业/商场</option>
            <option value="其他设施">其他设施</option>
          </select>
        </div>
        <div class="create-group">
          <label class="field-label">经度 *</label>
          <input v-model="newFacility.longitude" class="field-input" type="text" placeholder="例如：118.051" />
        </div>
        <div class="create-group">
          <label class="field-label">纬度 *</label>
          <input v-model="newFacility.latitude" class="field-input" type="text" placeholder="例如：36.811" />
        </div>
        <div class="create-group create-group-wide">
          <label class="field-label">地址</label>
          <input v-model="newFacility.address" class="field-input" type="text" placeholder="输入设施地址" />
        </div>
        <div class="create-actions">
          <label class="coord-toggle">
            <input v-model="useGcj" type="checkbox" />
            <span>坐标来源：高德/腾讯（GCJ-02）</span>
          </label>
          <button class="btn btn-outline" @click="addLocalFacility">添加到列表</button>
        </div>
      </div>
    </section>

    <section class="fac-table-wrap">
      <div v-if="error" class="fac-error">{{ error }}</div>
      <div v-else class="table-scroll">
        <table class="fac-table">
          <thead>
            <tr>
              <th v-if="selectionMode" style="width: 42px">选择</th>
              <th style="width: 70px">ID</th>
              <th>设施名称</th>
              <th style="width: 120px">类型</th>
              <th style="width: 160px">经度</th>
              <th style="width: 160px">纬度</th>
              <th>地址</th>
              <th style="width: 150px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="fac-empty">加载中...</td>
            </tr>
            <tr v-else-if="filteredFacilities.length === 0">
              <td colspan="7" class="fac-empty">暂无设施数据</td>
            </tr>
            <tr v-else v-for="item in filteredFacilities" :key="item.id">
              <td v-if="selectionMode" class="select-cell">
                <input
                  v-model="selectedIds"
                  type="checkbox"
                  class="select-checkbox"
                  :value="item.id"
                />
              </td>
              <td>{{ item.id }}</td>
              <td class="name-cell" @click="focusOnMap(item)">{{ item.name }}</td>
              <td>{{ item.type }}</td>
              <td>{{ item.longitude }}</td>
              <td>{{ item.latitude }}</td>
              <td>{{ item.address }}</td>
              <td>
                <button class="btn-mini" @click="editCoordinates(item)">修正坐标</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fac-page {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  height: 100%;
}

.fac-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.fac-title {
  margin: 0;
  font-size: 1.25rem;
}

.fac-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  color: #9ca3af;
}

.fac-actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  font-size: 0.8rem;
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  transition: all 0.15s;
}

.btn-outline {
  background: rgba(15, 23, 42, 0.6);
  border-color: rgba(59, 130, 246, 0.6);
  color: #bfdbfe;
}

.btn-outline:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.9);
  color: #eff6ff;
}

.btn-ghost {
  background: transparent;
  border-color: rgba(148, 163, 184, 0.45);
  color: #9ca3af;
}

.btn-ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.fac-toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
  justify-content: flex-start; /* 设施类型 和 关键字 挨在左侧 */
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.toolbar-grow {
  flex: 0 0 280px;
  max-width: 100%;
}

.field-label {
  font-size: 0.78rem;
  color: #9ca3af;
}

.field-select,
.field-input {
  background: rgba(15, 23, 42, 0.9);
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  color: #e5e7eb;
  font-size: 0.8rem;
  padding: 0.35rem 0.7rem;
  outline: none;
}

.field-select {
  min-width: 150px;
}

.field-input {
  width: 100%;
  max-width: 100%;
}

.field-input::placeholder {
  color: #6b7280;
}

.input-wrap {
  width: 100%;
}

.fac-create {
  margin-top: 0.35rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.9);
  border: 1px dashed rgba(148, 163, 184, 0.5);
}

.create-title {
  font-size: 0.78rem;
  color: #9ca3af;
  margin-bottom: 0.4rem;
}

.create-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 0.6rem;
  column-gap: 1rem;
  row-gap: 0.75rem;
  align-items: flex-end;
}

.create-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.create-group-wide {
  grid-column: span 2; /* 地址占一半宽度 */
}

.create-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  grid-column: 1 / -1; /* 操作行也占满整行，避免挤在右侧 */
}

/* 快速新增区：限制单个字段输入框（名称 / 类型 / 经度 / 纬度）最大宽度，避免贴右边
   地址行使用 create-group-wide，不受这个限制 */
.create-group:not(.create-group-wide) .field-input,
.create-group:not(.create-group-wide) .field-select {
  max-width: 260px;
}

.coord-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: #9ca3af;
}

.coord-toggle input {
  width: 0.9rem;
  height: 0.9rem;
}

.select-cell {
  text-align: center;
}

.select-checkbox {
  width: 0.9rem;
  height: 0.9rem;
}

.fac-table-wrap {
  flex: 1;
  min-height: 0;
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.25);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.9);
  padding: 0.5rem 0.75rem 0.75rem;
}

.fac-error {
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  color: #fecaca;
}

.table-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.fac-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.fac-table thead {
  background: rgba(15, 23, 42, 0.9);
}

.fac-table th,
.fac-table td {
  padding: 0.45rem 0.4rem;
  text-align: left;
  border-bottom: 1px solid rgba(30, 41, 59, 0.9);
}

.fac-table th {
  font-weight: 500;
  color: #9ca3af;
  position: sticky;
  top: 0;
  background: rgba(15, 23, 42, 0.98);
  z-index: 1;
}

.fac-table tbody tr:hover {
  background: rgba(37, 99, 235, 0.2);
}

.fac-empty {
  text-align: center;
  padding: 0.8rem 0;
  color: #9ca3af;
}

.btn-mini {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  background: transparent;
  color: #e5e7eb;
}

.btn-mini:disabled {
  opacity: 0.6;
}

@media (max-width: 960px) {
  .fac-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .create-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

<!-- 非scoped样式：浅色主题覆盖 -->
<style>
/* 浅色主题 - 设施列表页面 */
body.light-theme .facilities-page {
  background: #f8fafc;
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

body.light-theme .fac-search-input {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-search-input::placeholder {
  color: #94a3b8 !important;
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
}

body.light-theme .fac-create-section h3 {
  color: #1e293b !important;
}

body.light-theme .create-fields input,
body.light-theme .create-fields select {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-list-section {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
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

body.light-theme .btn-primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
  color: white !important;
}

body.light-theme .btn-secondary {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

/* 设施列表页更多覆盖 */
body.light-theme .fac-page,
body.light-theme .fac-page * {
  color: inherit;
}

body.light-theme .fac-page {
  background: #f8fafc;
}

body.light-theme .fac-create {
  background: #ffffff !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-create .create-title {
  color: #1e293b !important;
}

body.light-theme .fac-create .field-label {
  color: #1e293b !important;
}

body.light-theme .fac-create .field-input,
body.light-theme .fac-create .field-select {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .fac-create .coord-toggle span {
  color: #64748b !important;
}

body.light-theme .fac-list {
  background: #ffffff !important;
  color: #1e293b !important;
}

body.light-theme .fac-header {
  background: #ffffff !important;
}

body.light-theme .fac-header h2,
body.light-theme .fac-header .fac-title {
  color: #1e293b !important;
}

body.light-theme .fac-header .fac-subtitle {
  color: #64748b !important;
}

body.light-theme .fac-toolbar {
  background: #ffffff !important;
}

body.light-theme .fac-toolbar .field-label {
  color: #1e293b !important;
}

/* 右上角按钮 */
body.light-theme .btn-outline {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .btn-outline:hover {
  background: #e2e8f0 !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

/* 添加到当前列表按钮 */
body.light-theme .btn-add {
  background: linear-gradient(135deg, #3b82f6, #2563eb) !important;
  color: white !important;
}

/* 表格区域 */
body.light-theme .fac-table-wrap {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .table-scroll {
  background: #ffffff !important;
}

body.light-theme .fac-table {
  background: #ffffff !important;
  color: #1e293b !important;
}

body.light-theme .fac-table thead {
  background: #f8fafc !important;
}

body.light-theme .fac-table th {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-bottom-color: #e2e8f0 !important;
}

body.light-theme .fac-table td {
  color: #1e293b !important;
  border-bottom-color: #e2e8f0 !important;
  background: #ffffff !important;
}

body.light-theme .fac-table tbody tr {
  background: #ffffff !important;
}

body.light-theme .fac-table tbody tr:hover {
  background: #f8fafc !important;
}

/* 操作按钮 */
body.light-theme .btn-action {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .btn-action:hover {
  background: #e2e8f0 !important;
  border-color: #3b82f6 !important;
  color: #3b82f6 !important;
}

/* 去除表格阴影，确保整体感 */
body.light-theme .fac-table-wrap {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05) !important;
}

body.light-theme .fac-table th,
body.light-theme .fac-table td {
  text-shadow: none !important;
  box-shadow: none !important;
}

body.light-theme .fac-table tbody tr {
  border-bottom: 1px solid #e2e8f0 !important;
}

/* 设施名称列样式 */
body.light-theme .fac-name {
  color: #1e293b !important;
  text-shadow: none !important;
  font-weight: 500 !important;
}

/* 表格行悬停效果 */
body.light-theme .fac-table tbody tr:hover {
  background: #f8fafc !important;
  box-shadow: none !important;
}

body.light-theme .fac-create-section {
  background: #ffffff !important;
}

body.light-theme .fac-create-section * {
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05) !important;
}

body.light-theme .fac-list-section * {
  color: #1e293b !important;
}

body.light-theme .fac-table-wrapper {
  background: #ffffff !important;
}

body.light-theme .fac-table tbody tr {
  background: #ffffff !important;
}

body.light-theme .fac-table tbody tr:hover {
  background: #f8fafc !important;
}

body.light-theme .fac-table tbody td {
  border-bottom-color: #e2e8f0 !important;
  color: #1e293b !important;
}

body.light-theme .fac-table thead th {
  background: #f8fafc !important;
  color: #1e293b !important;
  border-bottom-color: #e2e8f0 !important;
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

body.light-theme .stat-card {
  background: #ffffff !important;
  border-color: #e2e8f0 !important;
}

body.light-theme .stat-card * {
  color: #1e293b !important;
}

body.light-theme .filter-bar {
  background: #ffffff !important;
}

body.light-theme .filter-bar * {
  color: #1e293b !important;
}
</style>
