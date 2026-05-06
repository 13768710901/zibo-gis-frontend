<template>
  <div class="disaster-panel">
    <!-- 面板标题 -->
    <div class="panel-header">
      <h3 class="panel-title">
        <span class="header-icon">🚨</span>
        灾情管理
        <span v-if="loading" class="loading-text">加载中...</span>
      </h3>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- 统计概览 -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-num">{{ stats.total }}</span>
        <span class="stat-label">全部</span>
      </div>
      <div class="stat-item pending">
        <span class="stat-num">{{ stats.pending }}</span>
        <span class="stat-label">待审核</span>
      </div>
      <div class="stat-item confirmed">
        <span class="stat-num">{{ stats.confirmed }}</span>
        <span class="stat-label">已确认</span>
      </div>
      <div class="stat-item approved">
        <span class="stat-num">{{ stats.approved }}</span>
        <span class="stat-label">已通过</span>
      </div>
    </div>

    <!-- 筛选条件 -->
    <div class="filter-bar">
      <select v-model="filterStatus" class="filter-select" @change="loadDisasters">
        <option value="">全部状态</option>
        <option value="待审核">待审核</option>
        <option value="已确认">已确认</option>
        <option value="已通过">已通过</option>
        <option value="已驳回">已驳回</option>
        <option value="处理中">处理中</option>
      </select>
      <select v-model="filterType" class="filter-select" @change="loadDisasters">
        <option value="">全部类型</option>
        <option v-for="type in disasterTypes" :key="type.typeCode" :value="type.typeCode">
          {{ type.typeName }}
        </option>
      </select>
      <button class="refresh-btn" @click="loadDisasters" title="刷新">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    </div>

    <!-- 灾情列表 -->
    <div class="disaster-list">
      <div v-if="disasters.length === 0">
        <p class="empty-text">暂无灾情数据</p>
      </div>
      <div
        v-for="item in disasters"
        :key="item.disasterId"
        class="disaster-card"
        :class="[`status-${item.status}`, `level-${item.impactLevel}`]"
      >
        <!-- 卡片头部 -->
        <div class="card-header">
          <span class="confirm-badge">{{ item.confirms }}人确认</span>
          <span class="level-badge" :style="{ backgroundColor: item.color }">
            {{ item.impactLevel }}级
          </span>
          <span class="status-tag" :class="`status-${item.status}`">
            {{ item.status }}
          </span>
        </div>

        <!-- 卡片内容 -->
        <div class="card-body">
          <p class="consequence-text">{{ item.consequenceText }}</p>
          <p v-if="item.description" class="description">{{ item.description }}</p>
          <div class="meta-info">
            <span>📍 {{ formatCoords(item.lon, item.lat) }}</span>
            <span>🕐 {{ formatTime(item.reportedAt) }}</span>
            <span v-if="item.confirmCount > 1">👥 {{ item.confirmCount }}人确认</span>
          </div>
        </div>

        <!-- 图片预览 -->
        <div v-if="item.images" class="image-preview">
          <img
            v-for="(url, idx) in parseImages(item.images).slice(0, 3)"
            :key="idx"
            :src="getImageUrl(url)"
            @click="showImage(url)"
            class="thumb-img"
          />
        </div>

        <!-- 操作按钮 -->
        <div class="card-actions">
          <button class="action-btn view-map" @click="focusOnMap(item)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
            地图定位
          </button>
          <button
            v-if="item.status === '待审核' || item.status === '已确认'"
            class="action-btn review"
            @click="openReview(item)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            审核
          </button>
        </div>

        <!-- 审核信息 -->
        <div v-if="item.reviewedAt" class="review-info">
          <span>审核人: {{ item.reviewerName || '管理员' }}</span>
          <span>{{ formatTime(item.reviewedAt) }}</span>
          <p v-if="item.reviewComment" class="review-comment">{{ item.reviewComment }}</p>
        </div>
      </div>
    </div>

    <!-- 审核弹窗 -->
    <div v-if="reviewModalVisible" class="review-modal" @click.self="closeReview">
      <div class="modal-content">
        <div class="modal-header">
          <h4>灾情管理</h4>
          <button class="close-btn" @click="closeReview">×</button>
        </div>
        <div class="modal-body">
          <div class="review-detail">
            <p><strong>灾情类型：</strong>{{ currentDisaster?.typeName }}</p>
            <p><strong>影响等级：</strong>{{ currentDisaster?.impactLevel }}级</p>
            <p><strong>后果描述：</strong>{{ currentDisaster?.consequenceText }}</p>
            <p v-if="currentDisaster?.description">
              <strong>详细描述：</strong>{{ currentDisaster.description }}
            </p>
            <p><strong>发生位置：</strong>{{ formatCoords(currentDisaster?.lon, currentDisaster?.lat) }}</p>
          </div>
          <div class="review-form">
            <label>审核结果：</label>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" v-model="reviewForm.status" value="已通过" />
                <span class="radio-text approve">✓ 通过</span>
              </label>
              <label class="radio-label">
                <input type="radio" v-model="reviewForm.status" value="已驳回" />
                <span class="radio-text reject">✗ 驳回</span>
              </label>
            </div>
            <label>审核意见：</label>
            <textarea
              v-model="reviewForm.comment"
              placeholder="请输入审核意见..."
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeReview">取消</button>
          <button class="btn-confirm" @click="submitReview" :disabled="!reviewForm.status">
            确认审核
          </button>
        </div>
      </div>
    </div>

    <!-- 图片预览弹窗 -->
    <div v-if="previewImageUrl" class="image-modal" @click.self="previewImageUrl = null">
      <img :src="previewImageUrl" class="preview-img" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'

const emit = defineEmits(['close'])

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

// 状态
const loading = ref(false)
const disasters = ref([])
const disasterTypes = ref([])
const filterStatus = ref('')
const filterType = ref('')

const stats = reactive({
  total: 0,
  pending: 0,
  confirmed: 0,
  approved: 0
})

// 审核弹窗
const reviewModalVisible = ref(false)
const currentDisaster = ref(null)
const reviewForm = reactive({
  status: '',
  comment: ''
})

// 图片预览
const previewImageUrl = ref(null)

// 加载灾情列表
const loadDisasters = async () => {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filterStatus.value) params.append('status', filterStatus.value)
    if (filterType.value) params.append('type', filterType.value)

    const url = `${API_BASE}/disaster/list?${params}`
    console.log('请求URL:', url)

    const res = await fetch(url)
    console.log('响应状态:', res.status)

    const data = await res.json()
    console.log('响应数据:', data)

    if (data.success) {
      disasters.value = data.data
      console.log('灾情列表:', disasters.value)
      updateStats(data.data)
    } else {
      console.error('API返回错误:', data.message)
    }
  } catch (err) {
    console.error('加载灾情失败:', err)
  } finally {
    loading.value = false
  }
}

// 加载灾情类型
const loadTypes = async () => {
  try {
    const res = await fetch(`${API_BASE}/disaster/types`)
    const data = await res.json()
    if (data.success) {
      disasterTypes.value = data.data
    }
  } catch (err) {
    console.error('加载类型失败:', err)
  }
}

// 更新统计
const updateStats = (list) => {
  stats.total = list.length
  stats.pending = list.filter(d => d.status === '待审核').length
  stats.confirmed = list.filter(d => d.status === '已确认').length
  stats.approved = list.filter(d => d.status === '已通过').length
}

// 格式化坐标
const formatCoords = (lon, lat) => {
  if (!lon || !lat) return '未知位置'
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

// 格式化时间
const formatTime = (timeStr) => {
  if (!timeStr) return ''
  const date = new Date(timeStr)
  const now = new Date()
  const diff = (now - date) / 1000 / 60 // 分钟
  
  if (diff < 60) return `${Math.floor(diff)}分钟前`
  if (diff < 24 * 60) return `${Math.floor(diff / 60)}小时前`
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`
}

// 解析图片JSON
const parseImages = (imagesJson) => {
  try {
    return JSON.parse(imagesJson)
  } catch {
    return []
  }
}

// 获取图片完整URL
const getImageUrl = (url) => {
  if (url.startsWith('http')) return url
  return `${API_BASE.replace('/api', '')}${url}`
}

// 显示图片
const showImage = (url) => {
  previewImageUrl.value = getImageUrl(url)
}

// 地图定位（触发事件）
const focusOnMap = (item) => {
  const event = new CustomEvent('disaster-focus', {
    detail: {
      disasterId: item.disasterId,
      lon: item.lon,
      lat: item.lat,
      impactRadius: item.impactRadiusM,
      impactLevel: item.impactLevel,
      status: item.status,
      color: item.color
    }
  })
  window.dispatchEvent(event)
}

// 打开审核弹窗
const openReview = (item) => {
  currentDisaster.value = item
  reviewForm.status = ''
  reviewForm.comment = ''
  reviewModalVisible.value = true
}

// 关闭审核弹窗
const closeReview = () => {
  reviewModalVisible.value = false
  currentDisaster.value = null
}

// 提交审核
const submitReview = async () => {
  if (!currentDisaster.value || !reviewForm.status) return

  try {
    const res = await fetch(`${API_BASE}/disaster/${currentDisaster.value.disasterId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: reviewForm.status,
        comment: reviewForm.comment
      })
    })
    
    const data = await res.json()
    if (data.success) {
      alert('审核成功')
      closeReview()
      loadDisasters()
    } else {
      alert(data.message || '审核失败')
    }
  } catch (err) {
    console.error('审核失败:', err)
    alert('审核失败，请检查网络')
  }
}

// 初始化
onMounted(() => {
  loadTypes()
  loadDisasters()
})
</script>

<style scoped>
.disaster-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  color: #e0e0e0;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #2d2d44;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-header .close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.panel-header .close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.header-icon {
  font-size: 18px;
}

.loading-text {
  font-size: 12px;
  color: #888;
  font-weight: normal;
}

/* 统计栏 */
.stats-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px 16px;
  background: #16162a;
}

.stat-item {
  text-align: center;
  padding: 8px;
  background: #252540;
  border-radius: 8px;
}

.stat-num {
  display: block;
  font-size: 20px;
  font-weight: bold;
  color: #fff;
}

.stat-item.pending .stat-num { color: #f59e0b; }
.stat-item.confirmed .stat-num { color: #3b82f6; }
.stat-item.approved .stat-num { color: #10b981; }

.stat-label {
  font-size: 11px;
  color: #888;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #2d2d44;
}

.filter-select {
  flex: 1;
  padding: 8px 12px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 13px;
  cursor: pointer;
}

.refresh-btn {
  padding: 8px 12px;
  background: #252540;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #888;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.refresh-btn:hover {
  background: #3d3d5c;
  color: #fff;
}

/* 列表 */
.disaster-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-tip {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.disaster-card {
  background: #252540;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
  border-left: 4px solid transparent;
}

.disaster-card.level-1 { border-left-color: #FFD700; }
.disaster-card.level-2 { border-left-color: #FF8C00; }
.disaster-card.level-3 { border-left-color: #FF4500; }

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.type-tag {
  font-size: 12px;
  color: #a0a0c0;
  background: #1a1a2e;
  padding: 2px 8px;
  border-radius: 4px;
}

.level-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  color: #fff;
  font-weight: bold;
}

.status-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: auto;
}

.status-tag.status-待审核 { background: #f59e0b33; color: #f59e0b; }
.status-tag.status-已确认 { background: #3b82f633; color: #3b82f6; }
.status-tag.status-已通过 { background: #10b98133; color: #10b981; }
.status-tag.status-已驳回 { background: #ef444433; color: #ef4444; }

.card-body {
  margin-bottom: 10px;
}

.consequence-text {
  font-size: 14px;
  margin: 0 0 6px 0;
  color: #fff;
}

.description {
  font-size: 13px;
  color: #888;
  margin: 0 0 8px 0;
}

.meta-info {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #666;
}

/* 图片预览 */
.image-preview {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.thumb-img {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #3d3d5c;
}

.thumb-img:hover {
  border-color: #3b82f6;
}

/* 操作按钮 */
.card-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.2s;
}

.action-btn.view-map {
  background: #3b82f6;
  color: #fff;
}

.action-btn.view-map:hover {
  background: #2563eb;
}

.action-btn.review {
  background: #10b981;
  color: #fff;
}

.action-btn.review:hover {
  background: #059669;
}

/* 审核信息 */
.review-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #3d3d5c;
  font-size: 12px;
  color: #888;
}

.review-info span {
  margin-right: 16px;
}

.review-comment {
  margin: 6px 0 0 0;
  padding: 8px;
  background: #1a1a2e;
  border-radius: 4px;
  color: #aaa;
}

/* 审核弹窗 */
.review-modal, .image-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #252540;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: 80vh;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #3d3d5c;
}

.modal-header h4 {
  margin: 0;
  font-size: 16px;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  max-height: 50vh;
}

.review-detail {
  margin-bottom: 20px;
}

.review-detail p {
  margin: 8px 0;
  font-size: 14px;
}

.review-form label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
}

.radio-group {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.radio-text {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
}

.radio-text.approve {
  background: #10b98133;
  color: #10b981;
}

.radio-text.reject {
  background: #ef444433;
  color: #ef4444;
}

.review-form textarea {
  width: 100%;
  padding: 10px;
  background: #1a1a2e;
  border: 1px solid #3d3d5c;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #3d3d5c;
}

.btn-cancel, .btn-confirm {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-cancel {
  background: #3d3d5c;
  color: #e0e0e0;
}

.btn-confirm {
  background: #3b82f6;
  color: #fff;
}

.btn-confirm:disabled {
  background: #3d3d5c;
  cursor: not-allowed;
}

/* 图片弹窗 */
.image-modal .preview-img {
  max-width: 90%;
  max-height: 90vh;
  border-radius: 8px;
}
</style>
