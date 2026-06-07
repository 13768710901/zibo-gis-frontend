<template>
  <div class="login-page">
    <div class="login-overlay"></div>
    
    <div class="login-container">
      <div class="login-box">
        <div class="login-header">
          <h1>🔐 用户登录</h1>
          <p>淄博市张店区三维公共服务设施平台</p>
        </div>
        
        <form class="login-form" @submit.prevent="handleLogin">
          <div class="form-group">
            <label>用户名</label>
            <input 
              v-model="form.username"
              type="text"
              placeholder="请输入用户名"
              :disabled="loading"
            />
          </div>
          
          <div class="form-group">
            <label>密码</label>
            <input 
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              :disabled="loading"
            />
          </div>
          
          <div v-if="error" class="error-message">
            {{ error }}
          </div>
          
          <button 
            type="submit" 
            class="login-btn"
            :disabled="loading"
          >
            <span v-if="loading" class="loading-spinner"></span>
            <span v-else>登 录</span>
          </button>
        </form>
        
        <div class="login-footer">
          <p>还没有账号？<router-link to="/register" class="register-link">立即注册</router-link></p>
          <router-link to="/home" class="back-link">← 返回首页</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()

const form = ref({
  username: '',
  password: ''
})

const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!form.value.username || !form.value.password) {
    error.value = '请输入用户名和密码'
    return
  }
  
  loading.value = true
  error.value = ''

  const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

  try {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      username: form.value.username,
      password: form.value.password
    })
    
    if (response.data.success) {
      // 保存token和用户信息到sessionStorage（关闭标签页即退出）
      sessionStorage.setItem('token', response.data.token)
      sessionStorage.setItem('user', JSON.stringify(response.data.user))
      
      // 触发登录状态更新事件
      window.dispatchEvent(new CustomEvent('login-success', {
        detail: response.data.user
      }))
      
      // 跳转到首页
      router.push('/home')
    } else {
      error.value = response.data.message || '登录失败'
    }
  } catch (err) {
    error.value = err.response?.data?.message || '网络错误，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-image: url('/img/淄博市张店区航拍图.jpg');
  background-size: cover;
  background-position: center center;
  position: relative;
}

.login-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.9) 100%);
  backdrop-filter: blur(2px);
}

.login-container {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 420px;
  padding: 0 1.5rem;
}

.login-box {
  background: rgba(15, 23, 42, 0.95);
  border-radius: 16px;
  padding: 2.5rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-header h1 {
  font-size: 1.75rem;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0 0 0.5rem;
}

.login-header p {
  font-size: 0.9rem;
  color: #94a3b8;
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #e2e8f0;
}

.form-group input {
  height: 2.75rem;
  padding: 0 1rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(30, 41, 59, 0.8);
  color: #f1f5f9;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.form-group input::placeholder {
  color: #64748b;
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  text-align: center;
}

.login-btn {
  height: 2.75rem;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
  color: #ffffff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.login-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}

.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-footer {
  margin-top: 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.login-footer p {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
}

.back-link {
  font-size: 0.875rem;
  color: #60a5fa;
  text-decoration: none;
  transition: color 0.2s ease;
}

.back-link:hover {
  color: #3b82f6;
}

.register-link {
  color: #22c55e;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
}

.register-link:hover {
  color: #16a34a;
}
</style>
