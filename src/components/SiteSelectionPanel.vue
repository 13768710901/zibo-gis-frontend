<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const props = defineProps({
  loading: Boolean,
  results: Object
})

const emit = defineEmits(['update:loading', 'run-analysis', 'clear-results', 'export-results', 'close'])

// 选址参数
const selectedType = ref('hospital')
const gridSize = ref(1000)
const topN = ref(10)
const analysisStatus = ref('') // idle | running | success | error

// 设施类型选项（四个核心类型）
const facilityTypes = [
  { value: 'hospital', icon: '', label: '医疗卫生', desc: '医疗急救与健康服务', color: '#ef4444' },
  { value: 'school', icon: '', label: '教育服务', desc: '学校及教育机构', color: '#3b82f6' },
  { value: 'shelter', icon: '', label: '应急避难', desc: '灾害应急避难场所', color: '#fb923c' },
  { value: 'commercial', icon: '', label: '商业/商场', desc: '商业与购物场所', color: '#eab308' }
]

// 执行分析
const runAnalysis = async () => {
  analysisStatus.value = 'running'
  emit('update:loading', true)
  
  try {
    // 获取当前地图视野范围（简化为张店区范围）
    const bounds = [117.95, 36.75, 118.15, 36.90] // [minLon, minLat, maxLon, maxLat]
    
    const response = await axios.post('/api/siteselection/analyze', {
      facilityType: selectedType.value,
      gridSizeMeters: gridSize.value,
      bounds: bounds,
      topN: topN.value
    })
    
    if (response.data.success) {
      emit('run-analysis', {
        ...response.data,
        facilityType: selectedType.value,
        facilityColor: facilityTypes.find(t => t.value === selectedType.value)?.color
      })
      analysisStatus.value = 'success'
    } else {
      analysisStatus.value = 'error'
      alert('分析失败：' + response.data.message)
    }
  } catch (error) {
    analysisStatus.value = 'error'
    console.error('Site analysis failed:', error)
    alert('网络错误，请稍后重试')
  } finally {
    emit('update:loading', false)
  }
}

// 清空结果
const clearResults = () => {
  analysisStatus.value = 'idle'
  emit('clear-results')
}

// 导出Excel
const exportExcel = () => {
  if (!props.results?.recommendations?.length) {
    alert('暂无数据可导出')
    return
  }
  
  // 生成CSV内容
  const headers = ['排名', '建议设施名称', '经度', '纬度', '评分', '覆盖人口', '推荐理由']
  const rows = props.results.recommendations.map(r => [
    r.rank,
    r.suggestedFacilityName,
    r.lon.toFixed(6),
    r.lat.toFixed(6),
    r.score.toFixed(2),
    r.estimatedPopulation,
    r.reasons.join('; ')
  ])
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')
  
  // 下载文件
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `设施选址推荐_${selectedType.value}_${new Date().toLocaleDateString()}.csv`
  link.click()
  
  alert('CSV文件已导出')
}

// 获取当前选中类型信息
const selectedTypeInfo = computed(() => 
  facilityTypes.find(t => t.value === selectedType.value)
)
</script>

<template>
  <div class="site-selection-container">
    <!-- 头部 -->
    <div class="panel-header">
      <h3>📍 选址模拟</h3>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>
    
    <!-- 参数设置 -->
    <div class="panel-content">
      <div class="section">
        <h4>设施类型</h4>
        <div class="type-options">
          <label 
            v-for="type in facilityTypes" 
            :key="type.value"
            class="type-option"
            :class="{ active: selectedType === type.value }"
          >
            <input 
              type="radio" 
              v-model="selectedType" 
              :value="type.value"
              :disabled="props.loading"
            />
            <span class="type-label">{{ type.icon }} {{ type.label }}</span>
            <span class="type-desc">{{ type.desc }}</span>
          </label>
        </div>
      </div>
      
      <div class="section">
        <h4>分析参数</h4>
        <div class="param-row">
          <label>网格大小</label>
          <select v-model="gridSize" :disabled="props.loading">
            <option :value="500">500米</option>
            <option :value="1000">1000米</option>
            <option :value="2000">2000米</option>
          </select>
        </div>
        <div class="param-row">
          <label>推荐数量</label>
          <select v-model="topN" :disabled="props.loading">
            <option :value="5">Top 5</option>
            <option :value="10">Top 10</option>
            <option :value="20">Top 20</option>
          </select>
        </div>
      </div>
      
      <!-- 操作按钮 -->
      <div class="actions">
        <button 
          class="btn-primary" 
          @click="runAnalysis"
          :disabled="props.loading"
        >
          <span v-if="props.loading" class="loading-spinner"></span>
          <span v-else>🔍 开始分析</span>
        </button>
        
        <button 
          class="btn-secondary" 
          @click="clearResults"
          :disabled="props.loading || !props.results"
        >
          🗑️ 清空结果
        </button>
      </div>
      
      <!-- 分析统计 -->
      <div v-if="props.results?.summary" class="summary-section">
        <h4>📊 分析概况</h4>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">{{ props.results.summary.totalGrids }}</span>
            <span class="stat-label">分析网格</span>
          </div>
          <div class="stat-item highlight">
            <span class="stat-value">{{ props.results.summary.shortageGrids }}</span>
            <span class="stat-label">短缺区域</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ props.results.summary.avgSupplyRatio.toFixed(1) }}</span>
            <span class="stat-label">平均供需比</span>
          </div>
        </div>
      </div>
      
      <!-- 推荐列表 -->
      <div v-if="props.results?.recommendations?.length" class="recommendations">
        <div class="rec-header">
          <h4>🏆 选址推荐 (Top {{ props.results.recommendations.length }})</h4>
          <button class="btn-export" @click="exportExcel">
            📥 导出Excel
          </button>
        </div>
        
        <div class="rec-list">
          <div 
            v-for="rec in props.results.recommendations" 
            :key="rec.gridId"
            class="rec-item"
            :class="{ 'priority-high': rec.priority === 'high', 'priority-medium': rec.priority === 'medium' }"
          >
            <div class="rec-rank">#{{ rec.rank }}</div>
            <div class="rec-content">
              <div class="rec-name">{{ rec.suggestedFacilityName }}</div>
              <div class="rec-coords">
                {{ rec.lon.toFixed(4) }}, {{ rec.lat.toFixed(4) }}
              </div>
              <div class="rec-stats">
                <span class="score">评分: {{ rec.score.toFixed(1) }}</span>
                <span class="population">覆盖人口: {{ rec.estimatedPopulation }}人</span>
              </div>
              <div class="rec-reasons">
                <span v-for="(reason, idx) in rec.reasons" :key="idx" class="reason-tag">
                  {{ reason }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="!props.loading && analysisStatus !== 'running'" class="empty-state">
        <div class="empty-icon">📍</div>
        <p>选择设施类型并开始分析</p>
        <p class="hint">系统将推荐最优选址位置</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.site-selection-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: calc(100vh - 200px);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.6);
}

.panel-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #f1f5f9;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.section {
  margin-bottom: 20px;
}

.section h4 {
  margin: 0 0 12px;
  font-size: 0.9rem;
  color: #e2e8f0;
  font-weight: 500;
}

/* 设施类型选项 */
.type-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.type-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 2px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.5);
  cursor: pointer;
  transition: all 0.2s;
}

.type-option:hover {
  border-color: rgba(148, 163, 184, 0.4);
}

.type-option.active {
  border-color: var(--type-color);
  background: rgba(255, 255, 255, 0.05);
}

.type-option input {
  display: none;
}

.type-label {
  font-weight: 500;
  color: #f1f5f9;
  font-size: 0.95rem;
}

.type-desc {
  font-size: 0.8rem;
  color: #64748b;
  margin-left: auto;
}

/* 参数设置 */
.param-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.param-row label {
  color: #94a3b8;
  font-size: 0.9rem;
}

.param-row select {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.8);
  color: #f1f5f9;
  font-size: 0.9rem;
  cursor: pointer;
}

/* 按钮 */
.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn-primary,
.btn-secondary {
  flex: 1;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-primary {
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}

.btn-secondary {
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(51, 65, 85, 0.8);
  border-color: rgba(148, 163, 184, 0.5);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 统计概况 */
.summary-section {
  margin-top: 20px;
  padding: 16px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.stat-item {
  text-align: center;
  padding: 12px 8px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 6px;
}

.stat-item.highlight {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: #f1f5f9;
}

.stat-item.highlight .stat-value {
  color: #f87171;
}

.stat-label {
  display: block;
  font-size: 0.75rem;
  color: #94a3b8;
  margin-top: 4px;
}

/* 推荐列表 */
.recommendations {
  margin-top: 20px;
}

.rec-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.rec-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: #e2e8f0;
}

.btn-export {
  padding: 6px 12px;
  font-size: 0.8rem;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #22c55e;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-export:hover {
  background: rgba(34, 197, 94, 0.3);
}

.rec-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rec-item {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  transition: all 0.2s;
}

.rec-item:hover {
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(15, 23, 42, 0.7);
}

.rec-item.priority-high {
  border-left: 3px solid #ef4444;
}

.rec-item.priority-medium {
  border-left: 3px solid #f59e0b;
}

.rec-rank {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.rec-content {
  flex: 1;
  min-width: 0;
}

.rec-name {
  font-weight: 500;
  color: #f1f5f9;
  font-size: 0.9rem;
  margin-bottom: 4px;
}

.rec-coords {
  font-size: 0.75rem;
  color: #64748b;
  font-family: monospace;
  margin-bottom: 6px;
}

.rec-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.rec-stats .score {
  font-size: 0.8rem;
  color: #22c55e;
  font-weight: 500;
}

.rec-stats .population {
  font-size: 0.8rem;
  color: #94a3b8;
}

.rec-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.reason-tag {
  font-size: 0.7rem;
  padding: 3px 8px;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #64748b;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 8px;
  font-size: 0.95rem;
  color: #94a3b8;
}

.empty-state .hint {
  font-size: 0.8rem;
  color: #64748b;
}
</style>
