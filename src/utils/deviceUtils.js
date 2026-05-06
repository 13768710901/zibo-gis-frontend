/**
 * 设备检测工具
 * 用于检测用户设备类型，实现移动端功能限制
 */

/**
 * 检测是否为移动设备
 */
export function isMobileDevice() {
  // 检测用户代理字符串
  const userAgent = navigator.userAgent || navigator.vendor || window.opera
  
  // 移动设备关键词
  const mobileKeywords = [
    'Android', 'iPhone', 'iPad', 'iPod', 'BlackBerry', 
    'Windows Phone', 'webOS', 'Opera Mini', 'IEMobile'
  ]
  
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword))
  
  // 检测屏幕宽度作为辅助判断
  const isMobileWidth = window.innerWidth <= 768
  
  // 检测触摸支持
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  
  return isMobileUA || (isMobileWidth && hasTouchScreen)
}

/**
 * 检测是否为平板设备
 */
export function isTabletDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera
  const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(userAgent)
  const isTabletWidth = window.innerWidth > 768 && window.innerWidth <= 1024
  
  return isTablet || isTabletWidth
}

/**
 * 获取设备类型
 */
export function getDeviceType() {
  if (isTabletDevice()) return 'tablet'
  if (isMobileDevice()) return 'mobile'
  return 'desktop'
}

/**
 * 移动端允许的路由列表
 */
export const MOBILE_ALLOWED_ROUTES = [
  '/login',
  '/register', 
  '/disaster-report'
]

/**
 * 检查路由是否在移动端允许列表中
 */
export function isRouteAllowedForMobile(route) {
  return MOBILE_ALLOWED_ROUTES.includes(route)
}
