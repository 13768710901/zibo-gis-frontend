<template>
  <div class="profile-page">
    <h2>👤 个人信息</h2>
    
    <div class="profile-card">
      <div class="avatar-section">
        <div class="avatar">{{ user.realName?.charAt(0) || user.username?.charAt(0) || '?' }}</div>
      </div>
      
      <div class="info-section">
        <div class="info-row">
          <label>用户名</label>
          <span>{{ user.username }}</span>
        </div>
        <div class="info-row">
          <label>真实姓名</label>
          <span>{{ user.realName || '未设置' }}</span>
        </div>
        <div class="info-row">
          <label>角色</label>
          <span class="role-tag">{{ user.role }}</span>
        </div>
        
        <!-- 可编辑的联系方式 -->
        <div class="divider"></div>
        
        <div class="info-row editable">
          <label>电话</label>
          <div class="input-group">
            <input 
              v-if="isEditing"
              v-model="editForm.phone"
              type="text"
              placeholder="请输入电话号码"
              maxlength="20"
            />
            <span v-else>{{ user.phone || '未设置' }}</span>
          </div>
        </div>
        
        <div class="info-row editable">
          <label>邮箱</label>
          <div class="input-group">
            <input 
              v-if="isEditing"
              v-model="editForm.email"
              type="email"
              placeholder="请输入邮箱地址"
              maxlength="100"
            />
            <span v-else>{{ user.email || '未设置' }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 操作按钮 -->
    <div class="action-buttons">
      <template v-if="isEditing">
        <button class="btn btn-primary" @click="saveProfile" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
        <button class="btn btn-secondary" @click="cancelEdit" :disabled="saving">
          取消
        </button>
      </template>
      <template v-else>
        <button class="btn btn-primary" @click="startEdit">
          修改联系方式
        </button>
      </template>
    </div>
    
    <!-- 提示信息 -->
    <div v-if="message" class="alert" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const user = ref({
  username: '',
  realName: '',
  role: '',
  phone: '',
  email: ''
})

const isEditing = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref('')

const editForm = ref({
  phone: '',
  email: ''
})

// 获取用户详细信息
const fetchUserProfile = async () => {
  try {
    const token = sessionStorage.getItem('token')
    if (!token) return

    const response = await axios.get('/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (response.data.success) {
      user.value = response.data.user
      // 同步更新本地存储
      sessionStorage.setItem('user', JSON.stringify(response.data.user))
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  }
}

// 开始编辑
const startEdit = () => {
  editForm.value = {
    phone: user.value.phone || '',
    email: user.value.email || ''
  }
  isEditing.value = true
  message.value = ''
}

// 取消编辑
const cancelEdit = () => {
  isEditing.value = false
  message.value = ''
}

// 验证电话号码格式（中国手机号：11位，以1开头）
const validatePhone = (phone) => {
  if (!phone) return true // 允许为空
  return /^1\d{10}$/.test(phone)
}

// 验证邮箱格式
const validateEmail = (email) => {
  if (!email) return true // 允许为空
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
}

// 保存个人信息
const saveProfile = async () => {
  saving.value = true
  message.value = ''

  // 前端格式验证
  if (editForm.value.phone && !validatePhone(editForm.value.phone)) {
    message.value = '请输入正确的11位手机号码（以1开头）'
    messageType.value = 'error'
    saving.value = false
    return
  }

  if (editForm.value.email && !validateEmail(editForm.value.email)) {
    message.value = '请输入正确的邮箱格式'
    messageType.value = 'error'
    saving.value = false
    return
  }

  try {
    const token = sessionStorage.getItem('token')
    const response = await axios.put('/api/auth/profile', {
      phone: editForm.value.phone || null,
      email: editForm.value.email || null
    }, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (response.data.success) {
      message.value = '个人信息更新成功'
      messageType.value = 'success'
      isEditing.value = false
      // 重新获取最新用户信息
      await fetchUserProfile()
    } else {
      message.value = response.data.message || '更新失败'
      messageType.value = 'error'
    }
  } catch (error) {
    message.value = error.response?.data?.message || '网络错误，请稍后重试'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  // 先从本地存储加载基本信息
  const userStr = sessionStorage.getItem('user')
  if (userStr) {
    user.value = JSON.parse(userStr)
  }
  // 再从服务器获取完整信息（包括电话和邮箱）
  fetchUserProfile()
})
</script>

<style scoped>
.profile-page {
  padding: 1rem;
}

h2 {
  margin: 0 0 1.5rem;
  color: #f1f5f9;
  font-size: 1.25rem;
}

.profile-card {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 2rem;
  display: flex;
  gap: 2rem;
  align-items: flex-start;
}

.avatar-section {
  flex-shrink: 0;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 600;
  color: #fff;
}

.info-section {
  flex: 1;
}

.info-row {
  display: flex;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.info-row:last-child {
  border-bottom: none;
}

.info-row label {
  width: 100px;
  color: #94a3b8;
  font-size: 0.9rem;
}

.info-row span {
  flex: 1;
  color: #f1f5f9;
  font-size: 1rem;
}

.role-tag {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  font-size: 0.85rem;
  text-transform: capitalize;
}

.tips {
  margin-top: 1.5rem;
  padding: 1rem;
  background: rgba(59, 130, 246, 0.1);
  border-left: 4px solid #3b82f6;
  border-radius: 4px;
}

.tips p {
  margin: 0;
  color: #94a3b8;
  font-size: 0.9rem;
}

/* 分隔线 */
.divider {
  height: 1px;
  background: rgba(148, 163, 184, 0.2);
  margin: 1rem 0;
}

/* 可编辑行样式 */
.info-row.editable {
  background: rgba(59, 130, 246, 0.05);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin: 0.5rem 0;
}

/* 输入框样式 */
.input-group {
  flex: 1;
}

.input-group input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.input-group input:focus {
  border-color: #3b82f6;
}

.input-group input::placeholder {
  color: #64748b;
}

/* 操作按钮 */
.action-buttons {
  margin-top: 1.5rem;
  display: flex;
  gap: 1rem;
}

.btn {
  padding: 0.625rem 1.25rem;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: rgba(148, 163, 184, 0.2);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.3);
  color: #f1f5f9;
}

/* 提示信息 */
.alert {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
}

.alert.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.alert.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
}
</style>
