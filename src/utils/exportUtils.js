import html2canvas from 'html2canvas'
import { saveAs } from 'file-saver'
import {
  drawCompass,
  drawScaleBar,
  drawMapTitle,
  drawLegend,
  getLegendItems,
  calculateScale
} from './mapDecorations.js'

/**
 * 导出Cesium场景为PNG图片
 * @param {Object} viewer - Cesium viewer实例
 * @param {string} filename - 文件名（不含扩展名）
 */
export function exportCesiumScene(viewer, filename) {
  return new Promise((resolve, reject) => {
    try {
      // 检查canvas尺寸
      const canvas = viewer.canvas
      if (canvas.width === 0 || canvas.height === 0) {
        reject(new Error('Canvas尺寸为0，无法导出'))
        return
      }
      
      // 确保场景已渲染
      viewer.render()
      
      // 导出canvas
      canvas.toBlob((blob) => {
        if (blob) {
          saveAs(blob, `${filename}.png`)
          resolve()
        } else {
          reject(new Error('截图失败'))
        }
      }, 'image/png')
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 合成截图（地图 + 分析面板）
 * @param {Object} viewer - Cesium viewer实例
 * @param {HTMLElement} panelElement - 分析面板DOM元素
 * @param {string} filename - 文件名（不含扩展名）
 */
export async function exportCompositeScreenshot(viewer, panelElement, filename) {
  try {
    // 检查canvas尺寸
    const cesiumCanvas = viewer.canvas
    if (cesiumCanvas.width === 0 || cesiumCanvas.height === 0) {
      throw new Error('Canvas尺寸为0，无法导出')
    }
    
    // 确保场景已渲染
    viewer.render()
    
    // 获取Cesium canvas数据
    const cesiumDataUrl = cesiumCanvas.toDataURL('image/png')
    
    // 使用html2canvas捕获面板
    const panelCanvas = await html2canvas(panelElement, {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      scale: 1,
      useCORS: true,
      allowTaint: true
    })
    
    // 创建合成canvas
    const compositeCanvas = document.createElement('canvas')
    const ctx = compositeCanvas.getContext('2d')
    
    // 设置尺寸（地图 + 面板并排）
    const mapWidth = cesiumCanvas.width
    const mapHeight = cesiumCanvas.height
    const panelWidth = panelCanvas.width
    const panelHeight = panelCanvas.height
    
    // 如果面板比地图高，以地图高度为准；否则以较高者为准
    const finalHeight = Math.max(mapHeight, panelHeight)
    compositeCanvas.width = mapWidth + panelWidth + 20 // 20px间距
    compositeCanvas.height = finalHeight
    
    // 填充黑色背景
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height)
    
    // 绘制地图
    const mapImg = await loadImage(cesiumDataUrl)
    ctx.drawImage(mapImg, 0, 0)
    
    // 绘制面板（右对齐，顶部对齐）
    const panelImg = await loadImage(panelCanvas.toDataURL())
    ctx.drawImage(panelImg, mapWidth + 20, 0)
    
    // 导出
    compositeCanvas.toBlob((blob) => {
      if (blob) {
        saveAs(blob, `${filename}.png`)
      }
    }, 'image/png')
  } catch (error) {
    console.error('导出截图失败:', error)
    throw error
  }
}

/**
 * 加载图片辅助函数
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * 导出JSON数据
 * @param {Object} data - 要导出的数据对象
 * @param {string} filename - 文件名（不含扩展名）
 */
export function exportJsonData(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  saveAs(blob, `${filename}.json`)
}

/**
 * 导出CSV数据
 * @param {Array} data - 要导出的数据数组（对象数组）
 * @param {string} filename - 文件名（不含扩展名）
 */
export function exportCsvData(data, filename) {
  if (!data || data.length === 0) return
  
  // 获取所有字段
  const headers = Object.keys(data[0])
  
  // 创建CSV内容
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header]
        // 处理包含逗号的值
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return value ?? ''
      }).join(',')
    )
  ].join('\n')
  
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${filename}.csv`)
}

/**
 * 生成带时间戳的文件名
 * @param {string} analysisType - 分析类型名称
 * @param {string} extension - 文件扩展名（不含点）
 * @param {Object} params - 额外参数对象（如半径、时间等）
 * @returns {string} 生成的文件名（不含扩展名）
 */
export function generateFilename(analysisType, extension, params = {}) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '')
  
  // 构建参数部分
  const paramParts = []
  if (params.radius) paramParts.push(`${params.radius}米`)
  if (params.timeThreshold) paramParts.push(`${params.timeThreshold}分钟`)
  if (params.travelMode) paramParts.push(params.travelMode === 'walking' ? '步行' : '驾车')
  
  const paramStr = paramParts.length > 0 ? `_${paramParts.join('_')}` : ''
  
  return `${analysisType}${paramStr}_${dateStr}_${timeStr}`
}

/**
 * 触发浏览器下载
 * @param {Blob} blob - 文件Blob
 * @param {string} filename - 文件名
 */
export function downloadFile(blob, filename) {
  saveAs(blob, filename)
}

/**
 * 导出带地图规范元素的Cesium场景（图名、指北针、图例、比例尺）
 * @param {Object} viewer - Cesium viewer实例
 * @param {string} filename - 文件名（不含扩展名）
 * @param {Object} options - 导出选项
 * @param {string} options.title - 图名（标题）
 * @param {string} options.subtitle - 副标题
 * @param {string} options.analysisType - 分析类型（heatmap/coverage/accessibility/isochrone）
 * @param {Object} options.params - 分析参数（用于图例）
 */
export async function exportCesiumSceneWithDecorations(viewer, filename, options = {}) {
  const { title, subtitle, analysisType, params = {} } = options
  
  return new Promise((resolve, reject) => {
    try {
      // 检查canvas尺寸是否有效
      const cesiumCanvas = viewer.canvas
      if (cesiumCanvas.width === 0 || cesiumCanvas.height === 0) {
        reject(new Error('Canvas尺寸为0，无法导出'))
        return
      }
      
      // 确保场景已渲染
      viewer.render()
      
      // 获取原始canvas数据
      const cesiumDataUrl = cesiumCanvas.toDataURL('image/png')
      
      // 创建新的canvas，增加边距放置地图元素
      const margin = 80
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      // 设置尺寸（原始尺寸 + 边距）
      canvas.width = cesiumCanvas.width + margin * 2
      canvas.height = cesiumCanvas.height + margin * 2
      
      // 填充白色背景
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      // 绘制边框
      ctx.strokeStyle = '#333333'
      ctx.lineWidth = 2
      ctx.strokeRect(margin, margin, cesiumCanvas.width, cesiumCanvas.height)
      
      // 绘制地图
      const mapImg = new Image()
      mapImg.onload = () => {
        ctx.drawImage(mapImg, margin, margin)
        
        // 计算比例尺
        const scaleInfo = calculateScale(viewer)
        
        // 绘制地图元素
        
        // 1. 绘制图名（顶部居中）
        if (title) {
          const titleX = canvas.width / 2
          const titleY = margin / 2 - 10
          ctx.font = 'bold 20px Arial'
          ctx.fillStyle = '#1f2937'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(title, titleX, titleY)
          
          if (subtitle) {
            ctx.font = '14px Arial'
            ctx.fillStyle = '#4b5563'
            ctx.fillText(subtitle, titleX, titleY + 22)
          }
        }
        
        // 2. 绘制指北针（右上角）- 更大更靠右
        const compassX = canvas.width - margin - -35
        const compassY = margin + 50
        drawCompass(ctx, compassX, compassY, 70)
        
        // 3. 绘制比例尺（左下角）- 更靠下，长度增加1.5倍
        const scaleX = margin + 20
        const scaleY = canvas.height - margin - -40
        drawScaleBar(ctx, scaleX, scaleY, scaleInfo.pixelDistance * 3, scaleInfo.label)
        
        // 4. 绘制图例（右下角）- 更靠右
        if (analysisType) {
          const legendItems = getLegendItems(analysisType, params)
          if (legendItems.length > 0) {
            const legendX = canvas.width - margin - 10
            const legendY = canvas.height - margin - 120
            drawLegend(ctx, legendX, legendY, legendItems, '图例')
          }
        }
        
        // 导出
        canvas.toBlob((blob) => {
          if (blob) {
            saveAs(blob, `${filename}.png`)
            resolve()
          } else {
            reject(new Error('导出失败'))
          }
        }, 'image/png')
      }
      mapImg.onerror = reject
      mapImg.src = cesiumDataUrl
    } catch (error) {
      reject(error)
    }
  })
}
