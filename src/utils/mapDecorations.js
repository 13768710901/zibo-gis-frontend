/**
 * 地图规范元素绘制工具
 * 用于在导出截图上添加指北针、图例、比例尺、图名等元素
 */

/**
 * 在 canvas 上绘制指北针（指北箭头样式）
 * @param {CanvasRenderingContext2D} ctx - canvas 上下文
 * @param {number} x - 中心点 x 坐标
 * @param {number} y - 箭头底部 y 坐标
 * @param {number} size - 箭头大小
 */
export function drawCompass(ctx, x, y, size = 50) {
  const arrowHeight = size * 0.9
  const arrowWidth = size * 0.5
  
  // 绘制指北箭头（黑色三角形）
  ctx.beginPath()
  ctx.moveTo(x, y - arrowHeight) // 箭头顶点
  ctx.lineTo(x - arrowWidth / 2, y) // 左下角
  ctx.lineTo(x + arrowWidth / 2, y) // 右下角
  ctx.closePath()
  ctx.fillStyle = '#1f2937'
  ctx.fill()
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = 1
  ctx.stroke()
  
  // 绘制 N 字母（箭头上方）
  ctx.font = 'bold 16px Arial'
  ctx.fillStyle = '#1f2937'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('N', x, y - arrowHeight - 5)
}

/**
 * 在 canvas 上绘制比例尺
 * @param {CanvasRenderingContext2D} ctx - canvas 上下文
 * @param {number} x - 起始点 x 坐标
 * @param {number} y - 起始点 y 坐标
 * @param {number} pixelDistance - 像素距离
 * @param {string} label - 标签（如 "1km"）
 */
export function drawScaleBar(ctx, x, y, pixelDistance, label) {
  const barHeight = 8
  const tickHeight = 12
  const segments = 5 // 5段黑白相间，每格1km，共5km
  const segmentWidth = pixelDistance / segments
  
  // 绘制主线
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + pixelDistance, y)
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 2
  ctx.stroke()
  
  // 绘制刻度（每个分段点）
  ctx.lineWidth = 1
  for (let i = 0; i <= segments; i++) {
    ctx.beginPath()
    ctx.moveTo(x + i * segmentWidth, y - tickHeight / 2)
    ctx.lineTo(x + i * segmentWidth, y + tickHeight / 2)
    ctx.stroke()
  }
  
  // 绘制多段黑白相间的矩形
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#333' : '#fff'
    ctx.fillRect(x + i * segmentWidth, y - barHeight, segmentWidth, barHeight)
  }
  
  // 绘制外边框
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y - barHeight, pixelDistance, barHeight)
  
  // 解析标签中的总数值和单位
  const numMatch = label.match(/[0-9.]+/)
  const unitMatch = label.match(/[^0-9.]+/)
  const totalValue = numMatch ? parseFloat(numMatch[0]) : 0
  const unit = unitMatch ? unitMatch[0] : ''
  
  // 绘制每个分段点的标签
  ctx.font = '11px Arial'
  ctx.fillStyle = '#333'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  
  for (let i = 0; i <= segments; i++) {
    const value = (totalValue * i / segments).toFixed(1)
    // 如果数值是整数，去掉小数点
    const displayValue = value.endsWith('.0') ? value.slice(0, -2) : value
    ctx.fillText(displayValue + unit, x + i * segmentWidth, y + 5)
  }
}

/**
 * 在 canvas 上绘制图名（标题）
 * @param {CanvasRenderingContext2D} ctx - canvas 上下文
 * @param {number} x - x 坐标
 * @param {number} y - y 坐标
 * @param {string} title - 标题文本
 * @param {string} subtitle - 副标题（可选）
 */
export function drawMapTitle(ctx, x, y, title, subtitle = '') {
  // 绘制标题背景
  const padding = 15
  ctx.font = 'bold 18px Arial'
  const titleWidth = ctx.measureText(title).width
  ctx.font = '14px Arial'
  const subtitleWidth = subtitle ? ctx.measureText(subtitle).width : 0
  const maxWidth = Math.max(titleWidth, subtitleWidth)
  
  const bgHeight = subtitle ? 60 : 40
  
  // 绘制背景框
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.fillRect(x - padding, y - padding, maxWidth + padding * 2, bgHeight)
  ctx.strokeRect(x - padding, y - padding, maxWidth + padding * 2, bgHeight)
  
  // 绘制主标题
  ctx.font = 'bold 18px Arial'
  ctx.fillStyle = '#1f2937'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(title, x, y)
  
  // 绘制副标题
  if (subtitle) {
    ctx.font = '14px Arial'
    ctx.fillStyle = '#4b5563'
    ctx.fillText(subtitle, x, y + 26)
  }
}

/**
 * 在 canvas 上绘制图例
 * @param {CanvasRenderingContext2D} ctx - canvas 上下文
 * @param {number} x - x 坐标
 * @param {number} y - y 坐标
 * @param {Array} legendItems - 图例项数组 [{color, label}]
 * @param {string} title - 图例标题
 */
export function drawLegend(ctx, x, y, legendItems, title = '图例') {
  const itemHeight = 24
  const boxSize = 16
  const padding = 12
  
  // 计算图例高度
  const legendHeight = 35 + legendItems.length * itemHeight + padding
  
  // 计算最大宽度
  ctx.font = '12px Arial'
  let maxTextWidth = ctx.measureText(title).width
  legendItems.forEach(item => {
    const textWidth = ctx.measureText(item.label).width
    maxTextWidth = Math.max(maxTextWidth, textWidth)
  })
  const legendWidth = maxTextWidth + boxSize + padding * 3
  
  // 绘制背景框
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.fillRect(x, y, legendWidth, legendHeight)
  ctx.strokeRect(x, y, legendWidth, legendHeight)
  
  // 绘制标题
  ctx.font = 'bold 13px Arial'
  ctx.fillStyle = '#1f2937'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(title, x + padding, y + padding)
  
  // 绘制分隔线
  ctx.beginPath()
  ctx.moveTo(x + padding, y + 30)
  ctx.lineTo(x + legendWidth - padding, y + 30)
  ctx.strokeStyle = '#ccc'
  ctx.lineWidth = 1
  ctx.stroke()
  
  // 绘制图例项
  legendItems.forEach((item, index) => {
    const itemY = y + 35 + index * itemHeight
    
    // 绘制颜色块
    ctx.fillStyle = item.color
    ctx.fillRect(x + padding, itemY, boxSize, boxSize)
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 0.5
    ctx.strokeRect(x + padding, itemY, boxSize, boxSize)
    
    // 绘制文字
    ctx.font = '12px Arial'
    ctx.fillStyle = '#1f2937'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.label, x + padding + boxSize + 8, itemY + boxSize / 2)
  })
  
  return { width: legendWidth, height: legendHeight }
}

/**
 * 获取不同分析类型的图例定义
 * @param {string} analysisType - 分析类型
 * @param {Object} params - 分析参数
 * @returns {Array} 图例项数组
 */
export function getLegendItems(analysisType, params = {}) {
  const legends = {
    heatmap: [
      { color: '#dc2626', label: '高密度' },
      { color: '#f59e0b', label: '中密度' },
      { color: '#10b981', label: '低密度' },
      { color: '#3b82f6', label: '无设施' }
    ],
    coverage: [
      { color: '#16a34a', label: '覆盖区域' },
      { color: '#dc2626', label: '盲区' },
      { color: 'rgba(59, 130, 246, 0.3)', label: `服务半径 ${params.radius || 1000}m` }
    ],
    accessibility: [
      { color: '#16a34a', label: `可达（≤${params.timeThreshold || 15}分钟）` },
      { color: '#dc2626', label: '不可达' }
    ],
    isochrone: [
      { color: 'rgba(34, 197, 94, 0.6)', label: '≤10分钟' },
      { color: 'rgba(59, 130, 246, 0.6)', label: '10-15分钟' },
      { color: 'rgba(244, 63, 94, 0.6)', label: '15-20分钟' }
    ]
  }
  
  return legends[analysisType] || []
}

/**
 * 计算地图比例尺
 * 根据相机高度估算比例尺
 * @param {Object} viewer - Cesium viewer 实例
 * @returns {Object} 比例尺信息 {pixelDistance, label, metersPerPixel}
 */
export function calculateScale(viewer) {
  if (!viewer) return { pixelDistance: 100, label: '1km', metersPerPixel: 10 }
  
  // 获取相机高度
  const camera = viewer.camera
  const position = camera.positionCartographic
  const height = position.height
  
  // 估算：在屏幕中心 100px 对应的地面距离
  // 简化计算：height / 100 大约是米/像素
  const metersPerPixel = Math.max(1, height / 150)
  
  // 选择5格整数公里的比例尺（一格=1km，总共5km）
  const targetKm = 5 // 5格，每格1km
  const targetMeters = targetKm * 1000
  
  // 根据相机高度动态调整，但保持5格整数公里
  let scaleKm
  if (metersPerPixel < 10) {
    scaleKm = 2 // 2km = 5格，每格400m
  } else if (metersPerPixel < 25) {
    scaleKm = 3 // 3km = 5格，每格600m
  } else if (metersPerPixel < 40) {
    scaleKm = 5 // 5km = 5格，每格1km
  } else if (metersPerPixel < 80) {
    scaleKm = 10 // 10km = 5格，每格2km
  } else if (metersPerPixel < 150) {
    scaleKm = 20 // 20km = 5格，每格4km
  } else {
    scaleKm = 50 // 50km = 5格，每格10km
  }
  
  const scaleMeters = scaleKm * 1000
  const pixelDistance = scaleMeters / metersPerPixel
  
  // 整数公里标签
  const label = `${scaleKm}km`
  
  return { pixelDistance, label, metersPerPixel }
}
