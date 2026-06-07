import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import FacilitiesView from '../views/FacilitiesView.vue'
import MapView from '../views/MapView.vue'
import RouteView from '../views/RouteView.vue'
import DisasterReportView from '../views/DisasterReportView.vue'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import DisasterManageView from '../views/DisasterManageView.vue'
import ProfileView from '../views/ProfileView.vue'
import SettingsView from '../views/SettingsView.vue'
import { isMobileDevice, isRouteAllowedForMobile } from '../utils/deviceUtils.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', name: 'login', component: LoginView, meta: { guest: true } },
    { path: '/home', name: 'home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/map', name: 'map', component: MapView, meta: { requiresAuth: true } },
    { path: '/route', name: 'route', component: RouteView, meta: { requiresAuth: true } },
    { path: '/facilities', name: 'facilities', component: FacilitiesView, meta: { requiresAuth: true } },
    { path: '/disaster-report', name: 'disaster-report', component: DisasterReportView, meta: { requiresAuth: true, mobileStandalone: true } },
    { path: '/disaster-manage', name: 'disaster-manage', component: DisasterManageView, meta: { requiresAuth: true } },
    { path: '/profile', name: 'profile', component: ProfileView, meta: { requiresAuth: true } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
    { path: '/register', name: 'register', component: RegisterView, meta: { guest: true } },
    // 捕获所有未匹配路由，重定向到登录页
    { path: '/:pathMatch(.*)*', redirect: '/login' }
  ]
})

// 路由守卫 - 检查登录状态和设备类型
router.beforeEach((to, from, next) => {
  const token = sessionStorage.getItem('token')
  const isLoggedIn = !!token
  const isMobile = isMobileDevice()

  // 移动端访问限制
  if (isMobile) {
    // 检查目标路由是否在移动端允许列表中
    if (!isRouteAllowedForMobile(to.path)) {
      console.log('[移动端限制] 路由不允许访问:', to.path)
      // 如果已登录，重定向到灾情上报页面
      if (isLoggedIn) {
        next('/disaster-report')
      } else {
        // 未登录则重定向到登录页
        next('/login')
      }
      return
    }
  }

  // 需要登录但未登录，跳转到登录页
  if (to.meta.requiresAuth && !isLoggedIn) {
    next('/login')
  }
  // 已登录用户访问登录/注册页，自动跳转到首页
  else if (to.meta.guest && isLoggedIn) {
    // 移动端已登录用户跳转到灾情上报
    if (isMobile) {
      next('/disaster-report')
    } else {
      next('/home')
    }
  }
  // 其他情况正常放行
  else {
    next()
  }
})

export default router
