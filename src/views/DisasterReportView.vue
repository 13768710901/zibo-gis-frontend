<template>
  <div class="disaster-report-page">
    <!-- 头部 -->
    <header class="report-header">
      <h1>🚨 灾情上报</h1>
      <p class="subtitle">选择灾情类型并填写详细信息</p>
    </header>

    <!-- 上报表单 -->
    <form class="report-form" @submit.prevent="submitReport">
      <!-- 1. 灾情类型 -->
      <section class="form-section">
        <h3>1. 选择灾情类型</h3>
        <div class="type-grid">
          <button
            v-for="type in disasterTypes"
            :key="type.typeCode"
            type="button"
            class="type-btn"
            :class="{ active: selectedType === type.typeCode }"
            @click="selectType(type)"
          >
            <span class="type-icon">{{ getTypeIcon(type.typeCode) }}</span>
            <span class="type-name">{{ type.typeName }}</span>
          </button>
        </div>
      </section>

      <!-- 2. 后果描述（动态显示） -->
      <section class="form-section" v-if="selectedType && currentType">
        <h3>2. 选择后果描述</h3>
        <p class="section-hint">请选择与灾情描述最匹配的选项</p>
        <div class="consequence-list">
          <label
            v-for="(option, index) in currentType.consequenceOptions"
            :key="index"
            class="consequence-item"
            :class="{ active: selectedConsequence === index + 1, level: index + 1 }"
          >
            <input
              type="radio"
              :value="index + 1"
              v-model="selectedConsequence"
              name="consequence"
            />
            <span class="option-index">{{ ['①', '②', '③'][index] }}</span>
            <span class="option-text">{{ option }}</span>
            <span class="level-tag">{{ ['轻度', '中度', '重度'][index] }}</span>
          </label>
        </div>
        
        <!-- 自动计算结果预览 -->
        <div v-if="selectedConsequence" class="level-preview">
          <span class="preview-label">预计影响等级：</span>
          <span class="level-badge" :class="`level-${selectedConsequence}`">
            {{ selectedConsequence }}级 {{ ['轻度', '中度', '重度'][selectedConsequence - 1] }}
          </span>
          <span class="radius-text">
            影响半径约 {{ currentType['radiusLevel' + selectedConsequence] }} 米
          </span>
        </div>
      </section>

      <!-- 3. 拍照上传 -->
      <section class="form-section">
        <h3>3. 拍照上传</h3>
        <p class="section-hint">点击"+"添加照片，最多5张</p>
        <div class="photo-upload">
          <div class="photo-grid">
            <div
              v-for="(photo, index) in photos"
              :key="index"
              class="photo-item"
            >
              <img :src="photo.preview" alt="preview" />
              <button type="button" class="remove-btn" @click="removePhoto(index)">×</button>
            </div>
            <div v-if="photos.length < 5" class="photo-add" @click="triggerCamera">
              <span class="add-icon">+</span>
              <span class="add-text">添加照片</span>
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style="display: none"
            @change="handleFileChange"
          />
        </div>
      </section>

      <!-- 4. GPS定位 -->
      <section class="form-section">
        <h3>4. GPS定位</h3>
        <div class="location-section">
          <button
            type="button"
            class="location-btn"
            :class="{ success: location.lat, loading: locating }"
            @click="getLocation"
            :disabled="locating"
          >
            <span v-if="locating">📡 正在定位...</span>
            <span v-else-if="location.lat">📍 已获取位置</span>
            <span v-else>📍 点击获取定位</span>
          </button>
          <div v-if="location.lat" class="location-info">
            <p>纬度: {{ location.lat.toFixed(6) }}</p>
            <p>经度: {{ location.lon.toFixed(6) }}</p>
            <p v-if="location.address" class="address">{{ location.address }}</p>
          </div>
        </div>
      </section>

      <!-- 5. 补充描述（可选） -->
      <section class="form-section">
        <h3>5. 补充描述（可选）</h3>
        <textarea
          v-model="description"
          placeholder="描述现场情况、影响范围等信息..."
          rows="4"
          maxlength="500"
        ></textarea>
        <span class="char-count">{{ description.length }}/500</span>
      </section>

      <!-- 提交按钮 -->
      <div class="form-actions">
        <button
          type="submit"
          class="submit-btn"
          :disabled="!canSubmit || submitting"
        >
          <span v-if="submitting">提交中...</span>
          <span v-else>提交上报</span>
        </button>
        <p v-if="!canSubmit" class="tip-text">
          {{ tipText }}
        </p>
      </div>
    </form>

    <!-- 提交成功弹窗 -->
    <div v-if="showSuccess" class="success-modal" @click.self="showSuccess = false">
      <div class="success-content">
        <div class="success-icon">✓</div>
        <h3>上报成功！</h3>
        <p>您的灾情上报已提交，ID：{{ submittedId }}</p>
        <p class="status-text">
          当前状态：<span class="status-badge">{{ submittedStatus }}</span>
        </p>
        <p v-if="confirmCount > 1" class="confirm-text">
          已有 {{ confirmCount }} 人确认此灾情
        </p>
        <button class="close-btn" @click="resetForm">继续上报</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

// 状态
const disasterTypes = ref([])
const selectedType = ref('')
const selectedConsequence = ref(0)
const currentType = computed(() => {
  return disasterTypes.value.find(t => t.typeCode === selectedType.value)
})

const photos = ref([])
const fileInput = ref(null)

const location = ref({ lat: null, lon: null, address: '' })
const locating = ref(false)

const description = ref('')

const submitting = ref(false)
const showSuccess = ref(false)
const submittedId = ref('')
const submittedStatus = ref('')
const confirmCount = ref(1)

// 计算属性
const canSubmit = computed(() => {
  return selectedType.value &&
         selectedConsequence.value > 0 &&
         photos.value.length > 0 &&
         location.value.lat !== null
})

const tipText = computed(() => {
  if (!selectedType.value) return '请选择灾情类型'
  if (selectedConsequence.value === 0) return '请选择后果描述'
  if (photos.value.length === 0) return '请上传现场照片'
  if (location.value.lat === null) return '请获取GPS定位'
  return ''
})

// 加载灾情类型
const loadTypes = async () => {
  try {
    const res = await fetch(`${API_BASE}/disaster/types`)
    const data = await res.json()
    if (data.success) {
      // 转换属性名
      disasterTypes.value = data.data.map(t => ({
        typeCode: t.typeCode,
        typeName: t.typeName,
        consequenceOptions: t.consequenceOptions,
        radiusLevel1: t.radiusLevel1,
        radiusLevel2: t.radiusLevel2,
        radiusLevel3: t.radiusLevel3
      }))
    }
  } catch (err) {
    console.error('加载类型失败:', err)
    alert('网络错误，请检查连接')
  }
}

// 获取类型图标
const getTypeIcon = (code) => {
  const icons = {
    'WATERLOG': '💧',
    'COLLAPSE': '🕳️',
    'TREEFALL': '🌲',
    'DAMAGE': '🏚️',
    'FIRE': '🔥',
    'TRAPPED': '🆘'
  }
  return icons[code] || '🚨'
}

// 选择类型
const selectType = (type) => {
  selectedType.value = type.typeCode
  selectedConsequence.value = 0
}

// 触发相机
const triggerCamera = () => {
  fileInput.value?.click()
}

// 处理文件选择
const handleFileChange = (e) => {
  const files = Array.from(e.target.files)
  const remainingSlots = 5 - photos.value.length
  const validFiles = files.slice(0, remainingSlots)

  validFiles.forEach(file => {
    if (file.size > 10 * 1024 * 1024) {
      alert('单张图片不能超过10MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      photos.value.push({
        file: file,
        preview: e.target?.result
      })
    }
    reader.readAsDataURL(file)
  })

  // 清空input，允许重复选择
  e.target.value = ''
}

// 移除照片
const removePhoto = (index) => {
  photos.value.splice(index, 1)
}

// 获取GPS位置
const getLocation = () => {
  if (!navigator.geolocation) {
    alert('您的设备不支持GPS定位')
    return
  }

  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      location.value.lat = position.coords.latitude
      location.value.lon = position.coords.longitude
      locating.value = false
      // TODO: 反向地理编码获取地址
      location.value.address = '淄博市张店区'
    },
    (error) => {
      locating.value = false
      let msg = '定位失败'
      switch (error.code) {
        case error.PERMISSION_DENIED:
          msg = '请允许使用位置权限'
          break
        case error.POSITION_UNAVAILABLE:
          msg = '位置信息不可用'
          break
        case error.TIMEOUT:
          msg = '定位超时'
          break
      }
      alert(msg)
    },
    {
      enableHighAccuracy: true,  // 启用高精度定位
      timeout: 10000,             // 10秒超时
      maximumAge: 0              // 不使用缓存位置
    }
  )
}

// 提交上报
const submitReport = async () => {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('disasterType', selectedType.value)
    formData.append('consequenceIndex', selectedConsequence.value.toString())
    formData.append('lon', location.value.lon.toString())
    formData.append('lat', location.value.lat.toString())
    formData.append('description', description.value)
    formData.append('deviceId', getDeviceId())

    photos.value.forEach((photo, index) => {
      formData.append('images', photo.file)
    })

    const res = await fetch(`${API_BASE}/disaster/report`, {
      method: 'POST',
      body: formData
    })

    const data = await res.json()
    if (data.success) {
      submittedId.value = data.disasterId
      submittedStatus.value = data.status
      confirmCount.value = data.confirmCount
      showSuccess.value = true
    } else {
      alert(data.message || '提交失败，请重试')
    }
  } catch (err) {
    console.error('上报失败:', err)
    alert('网络错误，请检查连接')
  } finally {
    submitting.value = false
  }
}

// 获取设备标识
const getDeviceId = () => {
  let deviceId = localStorage.getItem('device_id')
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('device_id', deviceId)
  }
  return deviceId
}

// 重置表单
const resetForm = () => {
  selectedType.value = ''
  selectedConsequence.value = 0
  photos.value = []
  location.value = { lat: null, lon: null, address: '' }
  description.value = ''
  showSuccess.value = false
}

// 初始化
onMounted(() => {
  loadTypes()
})
</script>

<style scoped>
.disaster-report-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* 移动端优化 */
@media (max-width: 768px) {
  .disaster-report-page {
    padding: 16px;
    padding-top: max(16px, env(safe-area-inset-top));
    padding-bottom: max(16px, env(safe-area-inset-bottom));
  }

  .report-header {
    text-align: center;
    margin-bottom: 20px;
  }

  .report-header h1 {
    font-size: 24px;
    margin-bottom: 8px;
  }

  .report-header .subtitle {
    font-size: 14px;
    opacity: 0.9;
  }

  /* 添加移动端提示 */
  .mobile-hint {
    display: block;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
    font-size: 13px;
    color: white;
    text-align: center;
  }
}

.report-header {
  text-align: center;
  padding: 40px 20px 30px;
  background: linear-gradient(135deg, #e94560 0%, #0f3460 100%);
}

.report-header h1 {
  margin: 0 0 10px 0;
  font-size: 28px;
  color: #fff;
}

.subtitle {
  margin: 0;
  font-size: 14px;
  color: rgba(255,255,255,0.8);
}

.report-form {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.form-section {
  background: rgba(255,255,255,0.05);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 20px;
}

.form-section h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  color: #fff;
}

.section-hint {
  margin: -8px 0 16px 0;
  font-size: 13px;
  color: #888;
}

/* 类型选择 */
.type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  background: rgba(255,255,255,0.1);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  color: #e0e0e0;
}

.type-btn:hover {
  background: rgba(255,255,255,0.15);
  transform: translateY(-2px);
}

.type-btn.active {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.2);
}

.type-icon {
  font-size: 32px;
}

.type-name {
  font-size: 14px;
}

/* 后果选择 */
.consequence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.consequence-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(255,255,255,0.1);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
}

.consequence-item:hover {
  background: rgba(255,255,255,0.15);
}

.consequence-item.active {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.2);
}

.consequence-item.active.level-1 { border-color: #FFD700; background: rgba(255, 215, 0, 0.2); }
.consequence-item.active.level-2 { border-color: #FF8C00; background: rgba(255, 140, 0, 0.2); }
.consequence-item.active.level-3 { border-color: #FF4500; background: rgba(255, 69, 0, 0.2); }

.consequence-item input {
  display: none;
}

.option-index {
  font-size: 18px;
  font-weight: bold;
  color: #888;
}

.consequence-item.active .option-index {
  color: #fff;
}

.option-text {
  flex: 1;
  font-size: 14px;
}

.level-tag {
  font-size: 12px;
  padding: 4px 10px;
  background: rgba(255,255,255,0.2);
  border-radius: 20px;
  color: #fff;
}

/* 等级预览 */
.level-preview {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0,0,0,0.3);
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-label {
  font-size: 14px;
  color: #888;
}

.level-badge {
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
}

.level-badge.level-1 { background: linear-gradient(135deg, #FFD700, #FFA500); }
.level-badge.level-2 { background: linear-gradient(135deg, #FF8C00, #FF6347); }
.level-badge.level-3 { background: linear-gradient(135deg, #FF4500, #DC143C); }

.radius-text {
  font-size: 13px;
  color: #888;
}

/* 照片上传 */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.photo-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
}

.photo-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  background: rgba(0,0,0,0.6);
  border: none;
  border-radius: 50%;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-add {
  aspect-ratio: 1;
  border: 2px dashed rgba(255,255,255,0.3);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.photo-add:hover {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.add-icon {
  font-size: 32px;
  color: #e94560;
}

.add-text {
  font-size: 12px;
  color: #888;
}

/* 定位按钮 */
.location-btn {
  width: 100%;
  padding: 20px;
  background: rgba(255,255,255,0.1);
  border: 2px dashed rgba(255,255,255,0.3);
  border-radius: 12px;
  color: #e0e0e0;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s;
}

.location-btn:hover:not(:disabled) {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.location-btn.success {
  border-style: solid;
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.location-btn.loading {
  opacity: 0.7;
  cursor: wait;
}

.location-info {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0,0,0,0.3);
  border-radius: 12px;
}

.location-info p {
  margin: 4px 0;
  font-size: 14px;
  color: #888;
}

.location-info .address {
  color: #e0e0e0;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

/* 描述文本框 */
textarea {
  width: 100%;
  padding: 16px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 12px;
  color: #e0e0e0;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}

textarea:focus {
  outline: none;
  border-color: #e94560;
}

textarea::placeholder {
  color: #666;
}

.char-count {
  display: block;
  text-align: right;
  font-size: 12px;
  color: #666;
  margin-top: 8px;
}

/* 提交按钮 */
.form-actions {
  padding: 20px 0;
}

.submit-btn {
  width: 100%;
  padding: 18px;
  background: linear-gradient(135deg, #e94560 0%, #c9184a 100%);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(233, 69, 96, 0.4);
}

.submit-btn:disabled {
  background: #3d3d5c;
  cursor: not-allowed;
  opacity: 0.7;
}

.tip-text {
  text-align: center;
  font-size: 13px;
  color: #888;
  margin-top: 12px;
}

/* 成功弹窗 */
.success-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.success-content {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20px;
  padding: 40px;
  text-align: center;
  max-width: 360px;
  width: 100%;
  border: 1px solid rgba(233, 69, 96, 0.3);
}

.success-icon {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #10b981, #059669);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: #fff;
  margin: 0 auto 24px;
}

.success-content h3 {
  margin: 0 0 16px 0;
  font-size: 24px;
  color: #fff;
}

.success-content p {
  margin: 8px 0;
  font-size: 14px;
  color: #888;
}

.status-badge {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border-radius: 20px;
  font-size: 13px;
}

.confirm-text {
  color: #10b981 !important;
}

.success-content .close-btn {
  margin-top: 24px;
  padding: 14px 40px;
  background: linear-gradient(135deg, #e94560 0%, #c9184a 100%);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}

/* ==================== 移动端适配 ==================== */
@media (max-width: 480px) {
  .report-header {
    padding: 24px 16px 20px;
  }

  .report-header h1 {
    font-size: 22px;
  }

  .subtitle {
    font-size: 13px;
  }

  .report-form {
    padding: 12px;
  }

  .form-section {
    padding: 16px;
    margin-bottom: 12px;
    border-radius: 12px;
  }

  .form-section h3 {
    font-size: 16px;
    margin-bottom: 12px;
  }

  .section-hint {
    font-size: 12px;
  }

  /* 类型选择改为单列 */
  .type-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .type-btn {
    padding: 14px 10px;
  }

  .type-icon {
    font-size: 24px;
  }

  .type-name {
    font-size: 13px;
  }

  /* 后果选项优化 */
  .consequence-item {
    padding: 12px;
  }

  .option-index {
    font-size: 16px;
  }

  .option-text {
    font-size: 13px;
  }

  .level-tag {
    font-size: 11px;
    padding: 3px 8px;
  }

  .level-preview {
    padding: 12px;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  /* 照片上传改为2列 */
  .photo-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  /* 定位按钮 */
  .location-btn {
    padding: 16px;
    font-size: 15px;
  }

  .location-info {
    padding: 12px;
  }

  .location-info p {
    font-size: 13px;
  }

  /* 描述文本框 */
  textarea {
    padding: 12px;
    font-size: 16px; /* 防止iOS缩放 */
  }

  /* 提交按钮 */
  .submit-btn {
    padding: 16px;
    font-size: 17px;
  }

  /* 成功弹窗 */
  .success-content {
    padding: 24px;
    margin: 16px;
  }

  .success-icon {
    width: 60px;
    height: 60px;
    font-size: 30px;
  }

  .success-content h3 {
    font-size: 20px;
  }

  .success-content p {
    font-size: 13px;
  }
}

/* iPhone刘海屏适配 */
@supports (padding-top: env(safe-area-inset-top)) {
  .disaster-report-page {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
}
</style>
