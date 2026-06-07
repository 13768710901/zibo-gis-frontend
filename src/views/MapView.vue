<template>
  <div class="map-page">
    <header class="map-header">
      <div class="header-title">
        <h2>三维可视化分析</h2>
        <span class="panel-title">图层控制</span>
      </div>
      <div class="map-toolbar-container">
        <!-- 一级菜单栏 -->
        <div class="map-toolbar primary-menu">
          <!-- 基础工具 -->
          <button class="tool-btn" title="定位" @click="handleToolClick('location')">
            <span class="tool-icon">📍</span>
            <span class="tool-name">定位</span>
          </button>
          <button class="tool-btn" title="重置视图" @click="handleToolClick('reset')">
            <span class="tool-icon">🏠</span>
            <span class="tool-name">重置视图</span>
          </button>

          <!-- 一级菜单按钮 -->
          <button
            class="tool-btn primary-menu-btn"
            :class="{ 'layer-active': activePrimaryMenu === 'measure' }"
            @click="setPrimaryMenu('measure')"
          >
            <span class="tool-icon">📐</span>
            <span class="tool-name">测量工具</span>
          </button>

          <button
            class="tool-btn primary-menu-btn"
            :class="{ 'layer-active': activePrimaryMenu === 'spatial' }"
            @click="setPrimaryMenu('spatial')"
          >
            <span class="tool-icon">📊</span>
            <span class="tool-name">空间分析</span>
          </button>

          <button
            class="tool-btn"
            :class="{ 'layer-active': showSiteSelectionPanel }"
            title="选址模拟"
            @click="toggleSiteSelectionPanel"
          >
            <span class="tool-icon">📍</span>
            <span class="tool-name">选址模拟</span>
          </button>

          <button
            class="tool-btn"
            :class="{ 'layer-active': showDisasterPanel }"
            title="灾情管理"
            @click="toggleDisasterPanel"
          >
            <span class="tool-icon">🚨</span>
            <span class="tool-name">灾情管理</span>
          </button>

          <!-- 图层控制：始终在最右边 -->
          <button
            class="tool-btn"
            :class="{ 'layer-active': layerPanelOpen }"
            title="图层控制"
            @click="toggleLayerPanel"
          >
            <span class="tool-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="9" x2="15" y2="9"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
            </span>
            <span class="tool-name">图层</span>
          </button>
        </div>

        <!-- 二级菜单栏 -->
        <div class="map-toolbar secondary-menu" v-show="activePrimaryMenu">
          <!-- 测量工具二级菜单 -->
          <template v-if="activePrimaryMenu === 'measure'">
            <button class="tool-btn secondary-menu-btn" :class="{ 'layer-active': measureActive === 'distance' }" @click="handleToolClick('measure'); measureActive = 'distance'">
              <span class="tool-icon">📏</span>
              <span class="tool-name">距离测量</span>
            </button>
            <button class="tool-btn secondary-menu-btn" :class="{ 'layer-active': measureActive === 'area' }" @click="handleToolClick('area'); measureActive = 'area'">
              <span class="tool-icon">📐</span>
              <span class="tool-name">面积测量</span>
            </button>
            <button class="tool-btn secondary-menu-btn" @click="handleToolClick('clear')">
              <span class="tool-icon">🧹</span>
              <span class="tool-name">清除绘制</span>
            </button>
          </template>

          <!-- 空间分析二级菜单 -->
          <template v-if="activePrimaryMenu === 'spatial'">
            <!-- 平面分析按钮 -->
            <button
              class="tool-btn secondary-menu-btn"
              :class="{ 'layer-active': spatialActive === 'planar' }"
              @click="togglePlanarDrawer"
            >
              <span class="tool-icon">🔍</span>
              <span class="tool-name">平面分析</span>
            </button>

            <!-- 平面分析三级菜单 -->
            <div class="analysis-drawer sub-drawer" :class="{ expanded: planarDrawerOpen }">
              <button class="tool-btn drawer-item" :class="{ 'layer-active': heatmapVisible }" @click="toggleHeatmap">
                <span class="tool-icon">🔥</span>
                <span class="tool-name">热力图</span>
              </button>
              <button class="tool-btn drawer-item" :class="{ 'layer-active': coverageVisible }" @click="toggleCoverage">
                <span class="tool-icon">📍</span>
                <span class="tool-name">覆盖范围</span>
              </button>
              <button class="tool-btn drawer-item" :class="{ 'layer-active': accessibilityVisible }" @click="toggleAccessibility">
                <span class="tool-icon">🚶</span>
                <span class="tool-name">可达性</span>
              </button>
              <button class="tool-btn drawer-item" :class="{ 'layer-active': isochroneVisible }" @click="toggleIsochrone">
                <span class="tool-icon">⏱️</span>
                <span class="tool-name">等时圈</span>
              </button>
            </div>

            <!-- 三维分析按钮 -->
            <button
              class="tool-btn secondary-menu-btn"
              :class="{ 'layer-active': spatialActive === '3d' }"
              @click="toggle3DAnalysis"
            >
              <span class="tool-icon">🗺️</span>
              <span class="tool-name">三维分析</span>
            </button>

            <!-- 三维分析三级菜单 -->
            <div class="analysis-drawer sub-drawer" :class="{ expanded: analysis3DDrawerOpen }">
              <button class="tool-btn drawer-item" :class="{ 'layer-active': viewshedVisible }" @click="toggleViewshed">
                <span class="tool-icon">👁️</span>
                <span class="tool-name">视域分析</span>
              </button>
              <button class="tool-btn drawer-item" :class="{ 'layer-active': visibilityActive }" @click="toggleVisibility">
                <span class="tool-icon">🔍</span>
                <span class="tool-name">通视分析</span>
              </button>
              <button class="tool-btn drawer-item" :class="{ 'layer-active': profileActive }" @click="toggleProfile">
                <span class="tool-icon">📈</span>
                <span class="tool-name">剖面分析</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </header>

    <div class="map-main">
      <div class="map-wrapper">
        <CesiumMap ref="mapRef" @on-click="handleMapClick" />

        <!-- 视域分析提示 -->
        <div v-if="viewshedVisible" class="viewshed-hint">
          <span>👁️ 点击地图设置观察点</span>
        </div>

        <!-- 视域高度控制 -->
        <div v-if="viewshedVisible" class="viewshed-control">
          <label>观察高度: {{ viewshedHeight }}m</label>
          <input
            type="range"
            v-model.number="viewshedHeight"
            min="1"
            max="100"
            step="1"
            @change="recalculateViewshed"
          />
          <div class="height-markers">
            <span>1m</span>
            <span>50m</span>
            <span>100m</span>
          </div>
        </div>

        <!-- 剖面分析面板 -->
        <div v-if="profileActive" class="profile-panel">
          <div class="panel-header">
            <span>📊 地形剖面分析</span>
            <button @click="profileActive = false; clearProfile()" class="close-btn">×</button>
          </div>
          <div class="panel-content">
            <p v-if="profilePoints.length < 2" class="hint-text">请在地图上点击两点以生成地形剖面</p>
            <div v-else class="profile-info">
              <div class="info-row">
                <span>起点海拔:</span>
                <span class="value">{{ profileData[0]?.elevation?.toFixed(1) || '--' }} m</span>
              </div>
              <div class="info-row">
                <span>终点海拔:</span>
                <span class="value">{{ profileData[profileData.length - 1]?.elevation?.toFixed(1) || '--' }} m</span>
              </div>
              <div class="info-row">
                <span>最大高差:</span>
                <span class="value">{{ calculateElevationDiff().toFixed(1) }} m</span>
              </div>
              <div class="info-row">
                <span>剖面长度:</span>
                <span class="value">{{ calculateProfileLength().toFixed(0) }} m</span>
              </div>
            </div>
            <canvas ref="profileChartRef" class="profile-chart"></canvas>
          </div>
        </div>

        <!-- 通视分析面板 -->
        <div v-if="visibilityActive" class="visibility-panel">
          <div class="panel-header">
            <span>👁️ 两点间通视分析</span>
            <button @click="visibilityActive = false; clearVisibility()" class="close-btn">×</button>
          </div>
          <div class="panel-content">
            <p v-if="visibilityPoints.length < 2" class="hint-text">
              请点击选择观察点和目标点<br>
              <small>（视线高度 = 地面高程 + 1.7m人眼高度）</small>
            </p>
            <div v-else-if="visibilityResult" class="visibility-info">
              <div class="visibility-status" :class="visibilityResult.isVisible ? 'visible' : 'blocked'">
                {{ visibilityResult.isVisible ? '✅ 两点间通视' : '❌ 两点间有遮挡' }}
              </div>
              <div class="info-row">
                <span>水平距离:</span>
                <span class="value">{{ (visibilityResult.distance).toFixed(0) }} m</span>
              </div>
              <div class="info-row">
                <span>观察点地面高程:</span>
                <span class="value">{{ visibilityResult.startPoint.height.toFixed(1) }} m</span>
              </div>
              <div class="info-row">
                <span>视线高度:</span>
                <span class="value">{{ (visibilityResult.startPoint.height + 1.7).toFixed(1) }} m（+1.7m人眼）</span>
              </div>
              <div class="info-row">
                <span>目标点高程:</span>
                <span class="value">{{ visibilityResult.endPoint.height.toFixed(1) }} m</span>
              </div>
              <div class="info-row">
                <span>高差:</span>
                <span class="value">{{ visibilityResult.elevationDiff.toFixed(1) }} m</span>
              </div>
              <div v-if="!visibilityResult.isVisible && visibilityResult.blockPoint" class="block-info">
                <div class="info-row">
                  <span>遮挡类型:</span>
                  <span class="value">{{ visibilityResult.blockPoint.blockType || '地形' }}</span>
                </div>
                <div class="info-row">
                  <span>遮挡点距离:</span>
                  <span class="value">{{ visibilityResult.blockPoint.distance.toFixed(0) }} m</span>
                </div>
                <div class="info-row">
                  <span>遮挡点高程:</span>
                  <span class="value">{{ visibilityResult.blockPoint.terrainHeight.toFixed(1) }} m</span>
                </div>
                <div class="info-row">
                  <span>遮挡高差:</span>
                  <span class="value">+{{ visibilityResult.blockPoint.heightDiff?.toFixed(2) || '--' }} m</span>
                </div>
              </div>
            </div>
            <div class="visibility-legend">
              <div class="legend-item">
                <span class="legend-line" style="background: #22c55e;"></span>
                <span>可见区域</span>
              </div>
              <div class="legend-item">
                <span class="legend-line" style="background: #ef4444;"></span>
                <span>被遮挡区域</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 热力图图例 -->
        <div v-if="heatmapVisible" class="heatmap-legend">
          <div class="legend-header">
            <div class="legend-title">设施密度</div>
            <div class="export-buttons-small">
              <button class="export-btn-small" @click="exportHeatmap('png')" title="导出截图">📷</button>
              <button class="export-btn-small" @click="exportHeatmap('json')" title="导出数据">📊</button>
            </div>
          </div>
          <div class="legend-bar"></div>
          <div class="legend-labels">
            <span>高</span>
            <span>低</span>
          </div>
        </div>
      </div>

      <!-- 覆盖范围配置面板 - 独立于图层面板 -->
      <div v-if="coverageVisible" class="coverage-panel panel-float">
        <div class="panel-header-with-export">
          <h4>覆盖范围分析</h4>
          <div class="export-buttons">
            <button class="export-btn" @click="exportCoverage('png')" title="导出截图">📷</button>
            <button class="export-btn" @click="exportCoverage('json')" title="导出JSON">📊</button>
          </div>
        </div>
        <div class="coverage-settings">
          <div class="setting-item">
            <label>服务半径：</label>
            <select v-model.number="coverageRadius" @change="onCoverageRadiusChange">
              <option :value="500">500米</option>
              <option :value="1000">1000米</option>
              <option :value="1500">1500米</option>
              <option :value="2000">2000米</option>
            </select>
          </div>
          <div class="setting-item">
            <label>设施类型：</label>
            <div class="coverage-tags">
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('all') }"
                @click="toggleCoverageCategory('all')"
              >全部</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('hospital') }"
                @click="toggleCoverageCategory('hospital')"
              >医疗</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('school') }"
                @click="toggleCoverageCategory('school')"
              >教育</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('shelter') }"
                @click="toggleCoverageCategory('shelter')"
              >避难</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('resident') }"
                @click="toggleCoverageCategory('resident')"
              >居民</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('commercial') }"
                @click="toggleCoverageCategory('commercial')"
              >商业</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('other') }"
                @click="toggleCoverageCategory('other')"
              >其他</button>
            </div>
          </div>
          <div v-if="coverageLoading" class="coverage-loading">
            <div class="loading-spinner"></div>
            <span>分析中...</span>
          </div>
          <div v-else-if="coverageStats" class="coverage-stats">
            <div>设施数：{{ coverageStats.facilityCount }}</div>
            <div>总网格：{{ coverageStats.totalGridCount }}</div>
            <div>已覆盖：{{ coverageStats.coveredGridCount }}</div>
            <div>盲区：{{ coverageStats.uncoveredGridCount }}</div>
            <div>覆盖率：{{ (coverageStats.coverageRate * 100).toFixed(1) }}%</div>
          </div>
        </div>
      </div>

      <!-- 可达性分析配置面板 - 独立于图层面板 -->
      <div v-if="accessibilityVisible" class="coverage-panel panel-float">
        <div class="panel-header-with-export">
          <h4>可达性分析</h4>
          <div class="export-buttons">
            <button class="export-btn" @click="exportAccessibility('png')" title="导出截图">📷</button>
            <button class="export-btn" @click="exportAccessibility('json')" title="导出JSON">📊</button>
          </div>
        </div>
        <div v-if="accessibilityLoading" class="coverage-loading">
          <div class="loading-spinner"></div>
          <span>分析中...</span>
        </div>
        <div class="coverage-settings">
          <div class="setting-item">
            <label>步行阈值：</label>
            <select v-model.number="accessibilityTimeThreshold" @change="onAccessibilityTimeChange">
              <option :value="10">10分钟</option>
              <option :value="15">15分钟</option>
              <option :value="20">20分钟</option>
            </select>
          </div>
          <div class="setting-item">
            <label>设施类型：</label>
            <div class="coverage-tags">
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('all') }"
                @click="toggleCoverageCategory('all')"
              >全部</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('hospital') }"
                @click="toggleCoverageCategory('hospital')"
              >医疗</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('school') }"
                @click="toggleCoverageCategory('school')"
              >教育</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('shelter') }"
                @click="toggleCoverageCategory('shelter')"
              >避难</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('resident') }"
                @click="toggleCoverageCategory('resident')"
              >居民</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('commercial') }"
                @click="toggleCoverageCategory('commercial')"
              >商业</button>
              <button
                class="coverage-tag"
                :class="{ active: coverageCategories.includes('other') }"
                @click="toggleCoverageCategory('other')"
              >其他</button>
            </div>
          </div>
          <div class="coverage-legend">
            <span class="legend-dot covered"></span><span>已可达</span>
            <span class="legend-dot uncovered"></span><span>不可达</span>
          </div>
          <div v-if="accessibilityStats" class="coverage-stats">
            <div>设施数：{{ accessibilityStats.facilityCount }}</div>
            <div>阈值：{{ accessibilityStats.timeThresholdMinutes }} 分钟</div>
            <div>覆盖网格：{{ accessibilityStats.coveredGridCount }}/{{ accessibilityStats.totalGridCount }}</div>
            <div>覆盖率：{{ (accessibilityStats.coverageRate * 100).toFixed(1) }}%</div>
            <div>盲区网格：{{ accessibilityStats.uncoveredGridCount }}</div>
          </div>
        </div>
      </div>

      <!-- 等时圈分析配置面板 - 独立于图层面板 -->
      <div v-if="isochroneVisible" class="coverage-panel panel-float" @click.stop>
        <div class="panel-header-with-export">
          <h4>等时圈分析</h4>
          <div class="export-buttons">
            <button class="export-btn" @click="exportIsochrone('png')" title="导出截图">📷</button>
            <button class="export-btn" @click="exportIsochrone('json')" title="导出JSON">📊</button>
          </div>
        </div>
        <div v-if="isochroneLoading" class="coverage-loading">
          <div class="loading-spinner"></div>
          <span>分析中...</span>
        </div>
        <div class="coverage-settings">
          <div class="setting-item">
            <label>出行方式：</label>
            <select v-model="isochroneTravelMode" @change="refreshIsochrone">
              <option value="walking">步行</option>
              <option value="driving">驾车</option>
            </select>
          </div>
          <div class="setting-item">
            <label>Top数量：</label>
            <select v-model.number="isochroneTopN" @change="refreshIsochrone">
              <option :value="3">Top 3</option>
              <option :value="5">Top 5</option>
              <option :value="8">Top 8</option>
              <option :value="10">Top 10</option>
            </select>
          </div>
          <div class="setting-item">
            <label>显示连线：</label>
            <select v-model="isochroneShowTopConnectors" @change="refreshIsochrone">
              <option :value="true">显示</option>
              <option :value="false">不显示</option>
            </select>
          </div>
          <div class="coverage-legend">
            <span class="legend-dot" style="background: #22c55e"></span><span><=10分钟</span>
            <span class="legend-dot" style="background: #3b82f6"></span><span>10-15分钟</span>
            <span class="legend-dot" style="background: #f43f5e"></span><span>15-20分钟</span>
          </div>
          <div v-if="isochroneStats" class="coverage-stats">
            <div>设施数：{{ isochroneStats.facilityCount }}</div>
            <div v-if="isochroneStats.topArrivals?.length">
              最近到达（Top {{ isochroneStats.topArrivals.length }}）
            </div>
            <div
              v-for="(item, idx) in isochroneStats.topArrivals || []"
              :key="idx"
              class="iso-top-arrival"
            >
              <div class="iso-top-main">
                <span class="iso-top-rank">{{ idx + 1 }}.</span>
                <span class="iso-top-name">{{ item.facility?.name || item.facility?.address || '设施' }}</span>
              </div>
              <div class="iso-top-sub">
                <span>{{ formatDurationMinutes(item.durationSec) }}</span>
                <span>·</span>
                <span>{{ formatDistance(item.distanceMeters) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 灾情管理面板 -->
      <div class="disaster-panel-container" :class="{ open: showDisasterPanel }">
        <DisasterManagementPanel @close="showDisasterPanel = false" />
      </div>

      <!-- 设施选址模拟面板 -->
      <div class="site-selection-panel" :class="{ open: showSiteSelectionPanel }">
        <SiteSelectionPanel
          v-model:loading="siteSelectionLoading"
          :results="siteSelectionResults"
          @run-analysis="runSiteSelection"
          @clear-results="clearSiteSelection"
          @close="showSiteSelectionPanel = false"
        />
      </div>

      <!-- 现代化图层控制面板 -->
      <div class="layer-control" :class="{ open: layerPanelOpen }">
        <!-- 抽屉式图层面板 -->
        <div class="layer-panel">
          <div class="panel-header">
            <h3>图层控制</h3>
            <button class="close-btn" @click="toggleLayerPanel">✕</button>
          </div>
          <div class="panel-content">
            <!-- 设施类型图例 -->
          <div class="legend-section">
            <h4>设施类型图例</h4>
              <div class="layer-items">
                <div
                  v-for="item in legends"
                  :key="item.id"
                  class="layer-item"
                  :class="{ inactive: !activeCategories.includes(item.id) }"
                  @click="toggleCategory(item.id)"
                >
                  <div class="layer-color" :style="{ backgroundColor: item.color }"></div>
                  <span class="layer-name">{{ item.name }}</span>
                  <div class="layer-toggle">
                    <div class="toggle-switch" :class="{ active: activeCategories.includes(item.id) }"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="layer-section">
              <h4>基础图层</h4>
              <div class="layer-items">
                <div class="layer-item" :class="{ inactive: !roadsVisible }" @click="toggleRoads">
                  <div class="layer-icon">🛣️</div>
                  <span class="layer-name">道路</span>
                  <div class="layer-toggle" :class="{ active: roadsVisible }">
                    <div class="toggle-switch" :class="{ active: roadsVisible }"></div>
                  </div>
                </div>
              </div>
            </div>
              <div class="layer-section">
              <h4>灾情监测</h4>
              <div class="layer-items">
                <div class="layer-item" :class="{ inactive: !disasterLayerVisible }" @click="toggleDisasterLayer">
                  <div class="layer-color" style="background: linear-gradient(135deg, #FFD700, #FF4500)">🚨</div>
                  <span class="layer-name">灾情点位</span>
                  <div class="layer-toggle">
                    <div class="toggle-switch" :class="{ active: disasterLayerVisible }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 悬浮详情卡片 (有选中时显示) -->
      <!-- <div v-if="selectedInfo" class="info-card">
        <div class="info-header">
          <h3>设施详情</h3>
          <button class="close-btn" @click="selectedInfo = null">✕</button>
        </div>
        <div class="info-body">
          <div class="info-row">
            <span class="info-label">名称：</span>
            <span class="info-value">{{ selectedInfo.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">类型：</span>
            <span class="info-value">{{ selectedInfo.type }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">坐标：</span>
            <span class="info-value">{{ selectedInfo.lng }}, {{ selectedInfo.lat }}</span>
          </div>
        </div>
      </div> -->
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as turf from '@turf/turf'
import CesiumMap from '../components/CesiumMap.vue'
import DisasterManagementPanel from '../components/DisasterManagementPanel.vue'
import SiteSelectionPanel from '../components/SiteSelectionPanel.vue'
import {
  exportCesiumScene,
  exportCesiumSceneWithDecorations,
  exportCompositeScreenshot,
  exportJsonData,
  exportCsvData,
  generateFilename
} from '../utils/exportUtils.js'

const mapRef = ref(null)

const mapTools = [
  { id: 'location', name: '定位', icon: '📍' },
  { id: 'reset', name: '重置视图', icon: '🏠' },
  { id: 'measure', name: '距离测量', icon: '📏' },
  { id: 'area', name: '面积测量', icon: '📐' },
  { id: 'clear', name: '清除绘制', icon: '🧹' }
]

const legends = [
  { id: 'hospital', name: '医疗卫生', color: '#ef4444' },
  { id: 'school', name: '教育服务', color: '#10b981' },
  { id: 'shelter', name: '应急避难', color: '#f59e0b' },
  { id: 'resident', name: '居民/小区', color: '#22d3ee' },
  { id: 'commercial', name: '商业/商场', color: '#eab308' },
  { id: 'other', name: '其他', color: '#60a5fa' },
]

const activeCategories = ref(['hospital', 'school', 'shelter', 'resident', 'commercial', 'other']) // 默认显示所有设施类型

const roadsVisible = ref(true) // 默认显示道路
const heatmapVisible = ref(false) // 默认不显示热力图
const heatmapType = ref('grid') // 热力图类型：'grid'
const coverageVisible = ref(false) // 服务范围分析图层
const coverageRadius = ref(1000) // 服务半径（米）
const coverageCategories = ref(['all']) // 分析设施类型（支持组合）
const coverageStats = ref(null) // 服务范围统计
const coverageLoading = ref(false) // 服务范围分析加载中
const accessibilityVisible = ref(false) // 可达性分析图层
const accessibilityTimeThreshold = ref(15) // 步行可达阈值（分钟）
const accessibilityStats = ref(null) // 可达性分析统计
const accessibilityLoading = ref(false) // 可达性分析加载中

const isochroneVisible = ref(false) // 等时圈分析图层
const isochroneStats = ref(null) // 等时圈分析统计
const isochroneLoading = ref(false) // 等时圈分析加载中
const isochroneTimeThresholdsMinutes = [10, 15, 20] // 等时圈分级阈值（分钟）
const isochroneTravelMode = ref('walking') // 'walking' | 'driving'
const isochroneTopN = ref(5) // Top N 最近到达设施
const isochroneShowTopConnectors = ref(true) // 是否显示起点到 Top N 连线

// 分析工具配置变量（用于独立面板）
const coverageType = ref('walking')
const coverageTime = ref(15)
const accessibilityMode = ref('nearest')
const accessibilityRadius = ref(1000)
const accessibilityFacilityType = ref('hospital')
const isochroneCenter = ref({ lng: 118.05, lat: 36.81 })
const isochroneMode = ref('walking')
const isochroneTimes = ref([15, 30])
const isochronePicking = ref(false)

const layerPanelOpen = ref(false) // 图层面板开关状态
const showDisasterPanel = ref(false) // 灾情面板开关状态
const disasterLayerVisible = ref(true) // 灾情图层显示状态
const showSiteSelectionPanel = ref(false) // 选址模拟面板开关状态
const viewshedVisible = ref(false) // 视域分析开关状态
const visibilityActive = ref(false) // 通视分析开关状态
const profileActive = ref(false) // 剖面分析开关状态
const siteSelectionLoading = ref(false) // 选址分析加载中
const siteSelectionResults = ref(null) // 选址分析结果

// ==================== 剖面分析相关变量 ====================
const profilePoints = ref([]) // 剖面线的点
const profileData = ref([]) // 剖面数据（距离+高程）
let profileLineEntity = null // 剖面线实体
let profileChartInstance = null // 图表实例

// ==================== 通视分析相关变量 ====================
const visibilityPoints = ref([]) // 通视线段的点（起点和终点）
const visibilityResult = ref(null) // 通视分析结果
let visibilityLineVisible = null // 可见线段实体
let visibilityLineBlocked = null // 被遮挡线段实体
let visibilityObserverEntity = null // 观察点实体
let visibilityTargetEntity = null // 目标点实体
let visibilityBlockPointEntity = null // 遮挡点实体

// ==================== 菜单状态变量 ====================
const activePrimaryMenu = ref('') // 当前激活的一级菜单：'measure' | 'spatial' | ''
const measureActive = ref('') // 测量工具二级菜单激活状态：'distance' | 'area' | ''
const spatialActive = ref('') // 空间分析二级菜单激活状态：'planar' | '3d' | ''

// ==================== 抽屉式菜单变量（保留用于三级菜单） ====================
const planarDrawerOpen = ref(false) // 平面分析三级抽屉展开状态
const analysis3DDrawerOpen = ref(false) // 三维分析三级抽屉展开状态

// ==================== 三维建筑分析变量 ====================
const analysis3DActive = ref(false) // 三维分析状态（控制建筑和点的显隐）
const buildingsLoaded = ref(false) // 建筑是否已加载
let originalPointOpacity = {} // 存储点原始透明度
let originalBuildingVisibility = {} // 存储建筑原始显示状态
let originalOSMVisibility = {} // 存储OSM建筑原始显示状态

// 全局存储OSM建筑名称（用于去重）
const osmBuildingNameSet = new Set()
let osmNameCollectionStarted = false

// ==================== 视域分析变量 ====================
let viewshedObserverPosition = null
let viewshedRadius = 2000 // 视域半径（米）
const viewshedHeight = ref(30) // 观察高度（米），默认30m，可调

// 建筑文件配置（从三维测试页迁移）
const buildingFiles = [
  { name: '教育服务', category: 'school', url: '/data/教育服务.geojson' },
  { name: '居民小区', category: 'resident', url: '/data/居民小区.geojson' },
  { name: '其他设施', category: 'other', url: '/data/其他设施.geojson' },
  { name: '商业商场', category: 'commercial', url: '/data/商业商场.geojson' },
  { name: '医疗卫生', category: 'hospital', url: '/data/医疗卫生.geojson' },
  { name: '应急避难', category: 'shelter', url: '/data/应急避难.geojson' },
]

// 类别颜色映射
const categoryColors = {
  hospital: Cesium.Color.fromCssColorString('#ef4444'), // 红色
  school: Cesium.Color.fromCssColorString('#10b981'), // 绿色
  shelter: Cesium.Color.fromCssColorString('#f59e0b'), // 橙色
  resident: Cesium.Color.fromCssColorString('#22d3ee'), // 青色
  commercial: Cesium.Color.fromCssColorString('#eab308'), // 黄色
  other: Cesium.Color.fromCssColorString('#9333ea'), // 紫色
}

// 类别默认高度映射
const categoryHeights = {
  school: 35,
  hospital: 60,
  shelter: 40,
  commercial: 70,
  other: 30,
}

// ==================== GCJ-02 转 WGS84 坐标转换函数 ====================
function gcj02ToWgs84(lng, lat) {
  const a = 6378245.0
  const ee = 0.00669342162296594323
  const pi = 3.14159265358979324

  if (outOfChina(lng, lat)) return { lng, lat }

  let dlat = transformLat(lng - 105.0, lat - 35.0)
  let dlng = transformLng(lng - 105.0, lat - 35.0)
  const radlat = (lat / 180.0) * pi
  const magic = Math.sin(radlat)
  const magic2 = 1 - ee * magic * magic
  const sqrtmagic = Math.sqrt(magic2)

  dlat = (dlat * 180.0) / (((a * (1 - ee)) / (magic2 * sqrtmagic)) * pi)
  dlng = (dlng * 180.0) / ((a / sqrtmagic) * Math.cos(radlat) * pi)

  const mglat = lat + dlat
  const mglng = lng + dlng

  return { lng: lng * 2 - mglng, lat: lat * 2 - mglat }
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng, lat) {
  const pi = 3.14159265358979324
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * pi) + 40.0 * Math.sin((lat / 3.0) * pi)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * pi) + 320 * Math.sin((lat * pi) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(lng, lat) {
  const pi = 3.14159265358979324
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * pi) + 20.0 * Math.sin(2.0 * lng * pi)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * pi) + 40.0 * Math.sin((lng / 3.0) * pi)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * pi) + 300.0 * Math.sin((lng * pi) / 30.0)) * 2.0) / 3.0
  return ret
}

// ==================== 关键地点配置 ====================
// 定义OSM数据已完善的关键地点坐标（经度, 纬度）
const KEY_LOCATIONS_WITH_OSM = [
  { name: '山东理工大学', lng: 118.014, lat: 36.805 },
  // 可以继续添加其他已知OSM完善的地点
  // { name: '淄博市中心', lng: 118.050, lat: 36.810 },
]

// 检测半径（米）- 在该范围内检测OSM数据
const DETECTION_RADIUS = 1000

/**
 * 检测特定坐标点是否被OSM tileset的bounding volume包含
 */
function isPointCoveredByOSM(viewer, longitude, latitude) {
  try {
    const point = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0)
    
    // 遍历所有primitives查找OSM tilesets
    const primitives = viewer.scene.primitives
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i)
      if (primitive instanceof Cesium.Cesium3DTileset) {
        const url = primitive.url || ''
        const isOSM = url.toLowerCase().includes('osm') || 
                      url.toLowerCase().includes('building') ||
                      url.toLowerCase().includes('buildings') ||
                      !url
        
        if (isOSM && primitive.root) {
          // 检查该tileset的root tile bounding volume是否包含该点
          const boundingVolume = primitive.root.contentBoundingVolume || 
                                primitive.root.boundingVolume
          if (boundingVolume) {
            // 使用distanceToCamera或手动检查点是否在bounding volume内
            const distance = Cesium.Cartesian3.distance(point, boundingVolume.center)
            // 如果距离小于bounding volume的半径，认为该点在范围内
            const radius = boundingVolume.radius || 5000 // 默认5km
            if (distance <= radius + DETECTION_RADIUS) {
              console.log(`[OSM地点检测] ${longitude}, ${latitude} 被OSM tileset覆盖 (距离: ${(distance/1000).toFixed(2)}km)`)
              return true
            }
          }
        }
      }
    }
    return false
  } catch (e) {
    console.warn('[OSM地点检测] 检查失败:', e)
    return false
  }
}

/**
 * 检测建筑中心点坐标是否被OSM覆盖
 * 用于名称去重失败时的备用方案
 */
function isBuildingCoveredByOSM(viewer, centerDegrees) {
  return isPointCoveredByOSM(viewer, centerDegrees[0], centerDegrees[1])
}

/**
 * 检测OSM 3D建筑数据的覆盖情况
 * 优先检测关键地点，再检测视野内建筑数量
 */
function checkOSMBuildingsCoverage(viewer) {
  try {
    // 1. 首先检测关键地点是否被OSM覆盖
    const coveredLocations = []
    for (const loc of KEY_LOCATIONS_WITH_OSM) {
      if (isPointCoveredByOSM(viewer, loc.lng, loc.lat)) {
        coveredLocations.push(loc.name)
      }
    }
    
    // 有关键地点被覆盖，认为OSM数据完善
    if (coveredLocations.length > 0) {
      console.log(`[OSM检测] 以下关键地点已被OSM覆盖: ${coveredLocations.join(', ')}`)
      return {
        hasOSM: true,
        coverage: 1000,
        buildingCount: 1000,
        hasSufficientCoverage: true,
        coveredLocations: coveredLocations,
        detectionMethod: 'key_locations'
      }
    }

    // 2. 如果没有关键地点被覆盖，回退到建筑数量检测
    let osmTilesets = []
    let totalBuildingCount = 0
    let coverageScore = 0

    const primitives = viewer.scene.primitives
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i)
      if (primitive instanceof Cesium.Cesium3DTileset) {
        const url = primitive.url || ''
        const isOSM = url.toLowerCase().includes('osm') || 
                      url.toLowerCase().includes('building') ||
                      url.toLowerCase().includes('buildings') ||
                      !url
        
        if (isOSM) {
          const stats = primitive.statistics || {}
          const selected = stats.selected || 0
          const visited = stats.visited || 0
          totalBuildingCount += selected + visited
          
          osmTilesets.push({
            url: url || '内置OSM',
            selected: selected,
            visited: visited,
            ready: primitive.ready,
            tilesLoaded: primitive.tilesLoaded || 0
          })
          
          // 设置tileLoad事件监听，实时收集建筑名称
          if (!osmNameCollectionStarted) {
            osmNameCollectionStarted = true
            primitive.tileLoad.addEventListener((tile) => {
              if (tile.content && tile.content.featuresLength > 0) {
                for (let j = 0; j < tile.content.featuresLength; j++) {
                  try {
                    const feature = tile.content.getFeature(j)
                    if (feature && feature.getProperty) {
                      const name = feature.getProperty('name')
                      if (name && typeof name === 'string' && name.trim()) {
                        osmBuildingNameSet.add(name.trim())
                      }
                    }
                  } catch (e) {
                    // 忽略单个feature错误
                  }
                }
              }
            })
            console.log(`[OSM名称收集] 已为 tileset 设置 tileLoad 事件监听，当前已收集 ${osmBuildingNameSet.size} 个名称`)
          }
        }
      }
    }

    if (osmTilesets.length === 0) {
      return { hasOSM: false, coverage: 0, buildingCount: 0, hasSufficientCoverage: false }
    }

    const MIN_BUILDINGS_FOR_FULL_COVERAGE = 200
    const hasSufficientCoverage = totalBuildingCount >= MIN_BUILDINGS_FOR_FULL_COVERAGE

    console.log(`[OSM检测] 发现 ${osmTilesets.length} 个tilesets, 视野内约 ${totalBuildingCount} 个建筑`)
    osmTilesets.forEach(t => console.log(`  - ${t.url}: selected=${t.selected}, visited=${t.visited}`))

    return {
      hasOSM: osmTilesets.length > 0,
      coverage: totalBuildingCount,
      buildingCount: totalBuildingCount,
      hasSufficientCoverage: hasSufficientCoverage,
      tilesets: osmTilesets,
      detectionMethod: 'building_count'
    }
  } catch (e) {
    console.warn('[OSM检测] 检查失败:', e)
    return { hasOSM: false, coverage: 0, buildingCount: 0, hasSufficientCoverage: false }
  }
}

/**
 * 简化的OSM存在检测
 */
function checkOSMBuildingsExist(viewer) {
  const result = checkOSMBuildingsCoverage(viewer)
  return result.hasOSM && result.hasSufficientCoverage
}

// ==================== 菜单控制函数 ====================
const closeAllDrawers = () => {
  activePrimaryMenu.value = ''
  measureActive.value = ''
  spatialActive.value = ''
  planarDrawerOpen.value = false
  analysis3DDrawerOpen.value = false
}

// ==================== 清除所有分析功能 ====================
const clearAllAnalysis = () => {
  // 清除平面分析功能
  if (heatmapVisible.value) {
    heatmapVisible.value = false
    const map = mapRef.value
    if (map && map.setHeatmapVisible) {
      map.setHeatmapVisible(false, heatmapType.value)
    }
  }

  if (coverageVisible.value) {
    coverageVisible.value = false
    coverageStats.value = null
    coverageLoading.value = false
    const map = mapRef.value
    if (map && map.setCoverageVisible) {
      map.setCoverageVisible(false)
    }
  }

  if (accessibilityVisible.value) {
    accessibilityVisible.value = false
    accessibilityStats.value = null
    accessibilityLoading.value = false
    const map = mapRef.value
    if (map && map.setAccessibilityVisible) {
      map.setAccessibilityVisible(false)
    }
  }

  if (isochroneVisible.value) {
    isochroneVisible.value = false
    isochroneStats.value = null
    isochroneLoading.value = false
    const map = mapRef.value
    if (map && map.setIsochroneVisible) {
      map.setIsochroneVisible(false)
    }
  }

  // 清除三维分析功能
  if (viewshedVisible.value) {
    viewshedVisible.value = false
    clearViewshed()
  }

  if (visibilityActive.value) {
    visibilityActive.value = false
    clearVisibility()
  }

  if (profileActive.value) {
    profileActive.value = false
    clearProfile()
  }
}

// 工具栏滚动控制
const scrollToolbar = (offset) => {
  const toolbar = document.querySelector('.map-toolbar')
  if (toolbar) {
    toolbar.scrollTo({ left: offset, behavior: 'smooth' })
  }
}

// ==================== 一级菜单控制函数 ====================

const setPrimaryMenu = (menu) => {
  // 如果点击已激活的菜单，则关闭
  if (activePrimaryMenu.value === menu) {
    activePrimaryMenu.value = ''
    measureActive.value = ''
    spatialActive.value = ''
    // 收起所有三级菜单
    planarDrawerOpen.value = false
    analysis3DDrawerOpen.value = false

    // 关闭空间分析时，清除所有分析结果并恢复设施点
    if (menu === 'spatial') {
      clearAllAnalysis()
      // 如果在三维分析中，恢复设施点
      if (analysis3DActive.value) {
        analysis3DActive.value = false
        restorePointsAndBuildings()
      }
    }
  } else {
    // 切换到新菜单
    activePrimaryMenu.value = menu
    measureActive.value = ''
    spatialActive.value = ''
    // 收起所有三级菜单
    planarDrawerOpen.value = false
    analysis3DDrawerOpen.value = false
  }
}

// ==================== 二级菜单控制函数 ====================

const togglePlanarDrawer = () => {
  // 如果已经激活，再次点击则收起三级菜单并清除平面分析结果
  if (spatialActive.value === 'planar' && planarDrawerOpen.value) {
    planarDrawerOpen.value = false
    spatialActive.value = ''
    // 清除平面分析功能
    if (heatmapVisible.value) {
      heatmapVisible.value = false
      const map = mapRef.value
      if (map && map.setHeatmapVisible) map.setHeatmapVisible(false, heatmapType.value)
    }
    if (coverageVisible.value) {
      coverageVisible.value = false
      coverageStats.value = null
      coverageLoading.value = false
      const map = mapRef.value
      if (map && map.setCoverageVisible) map.setCoverageVisible(false)
    }
    if (accessibilityVisible.value) {
      accessibilityVisible.value = false
      accessibilityStats.value = null
      accessibilityLoading.value = false
      const map = mapRef.value
      if (map && map.setAccessibilityVisible) map.setAccessibilityVisible(false)
    }
    if (isochroneVisible.value) {
      isochroneVisible.value = false
      isochroneStats.value = null
      isochroneLoading.value = false
      const map = mapRef.value
      if (map && map.setIsochroneVisible) map.setIsochroneVisible(false)
    }
  } else {
    planarDrawerOpen.value = true
    spatialActive.value = 'planar'
  }
}

const toggle3DAnalysis = () => {
  // 如果已经激活，再次点击则收起三级菜单并清除三维分析结果
  if (spatialActive.value === '3d' && analysis3DDrawerOpen.value) {
    analysis3DDrawerOpen.value = false
    spatialActive.value = ''
    // 清除三维分析功能
    if (viewshedVisible.value) {
      viewshedVisible.value = false
      clearViewshed()
    }
    if (visibilityActive.value) {
      visibilityActive.value = false
      clearVisibility()
    }
    if (profileActive.value) {
      profileActive.value = false
      clearProfile()
    }
    // 清除三维建筑并恢复设施点
    analysis3DActive.value = false
    restorePointsAndBuildings()
  } else {
    analysis3DDrawerOpen.value = true
    spatialActive.value = '3d'

    // 三维分析功能：加载建筑
    analysis3DActive.value = true

    if (!buildingsLoaded.value) {
      loadBuildings().then(() => {
        fadeOutPointsAndShowBuildings()
      })
    } else {
      fadeOutPointsAndShowBuildings()
    }
  }
}

/**
 * 从OSM 3D Tiles中收集建筑名称
 * 使用tileLoad事件监听新加载的tile并提取名称
 */
async function collectOSMBuildingNames(viewer) {
  const osmNames = new Set()
  try {
    const primitives = viewer.scene.primitives
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i)
      if (primitive instanceof Cesium.Cesium3DTileset) {
        const url = primitive.url || ''
        const isOSM = url.toLowerCase().includes('osm') || 
                      url.toLowerCase().includes('building') ||
                      url.toLowerCase().includes('buildings') ||
                      !url
        
        if (!isOSM) continue
        
        console.log(`[OSM名称收集] 正在收集 tileset: ${url || '内置OSM'}`)
        
        // 递归遍历tile树
        const traverseTile = (tile) => {
          if (!tile) return
          
          // 检查content是否存在且有features
          if (tile.content) {
            const content = tile.content
            // 方法1: 使用featuresLength和getFeature (3D Tiles格式)
            if (content.featuresLength && content.getFeature) {
              for (let j = 0; j < content.featuresLength; j++) {
                try {
                  const feature = content.getFeature(j)
                  if (feature && feature.getProperty) {
                    const name = feature.getProperty('name')
                    if (name && typeof name === 'string' && name.trim()) {
                      osmNames.add(name.trim())
                    }
                  }
                } catch (e) {
                  // 忽略单个feature错误
                }
              }
            }
            // 方法2: 如果content有batchTable (旧版Cesium格式)
            else if (content.batchTable) {
              const batchTable = content.batchTable
              const batchLength = batchTable.batchLength || 0
              for (let j = 0; j < batchLength; j++) {
                try {
                  const name = batchTable.getProperty(j, 'name')
                  if (name && typeof name === 'string' && name.trim()) {
                    osmNames.add(name.trim())
                  }
                } catch (e) {
                  // 忽略
                }
              }
            }
          }
          
          // 递归遍历子tile
          if (tile.children && tile.children.length > 0) {
            tile.children.forEach(child => traverseTile(child))
          }
        }
        
        // 从root开始遍历
        if (primitive.root) {
          traverseTile(primitive.root)
        }
        
        console.log(`[OSM名称收集] 从该tileset收集到 ${osmNames.size} 个名称`)
      }
    }
    
    const namesList = Array.from(osmNames)
    console.log(`[OSM名称收集] 总共收集 ${namesList.length} 个名称`)
    if (namesList.length > 0) {
      console.log(`[OSM名称收集] 前10个名称:`, namesList.slice(0, 10))
    } else {
      console.warn(`[OSM名称收集] 未收集到任何名称，OSM tile可能尚未完全加载`)
    }
  } catch (e) {
    console.warn('[OSM名称收集] 提取失败:', e)
  }
  return osmNames
}

/**
 * 加载三维建筑数据
 */
const loadBuildings = async () => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  console.log('[三维建筑] 开始加载...')
  let totalLoaded = 0

  for (const file of buildingFiles) {
    try {
      const color = categoryColors[file.category] || categoryColors.other
      const defaultHeight = categoryHeights[file.category] || 25

      const dataSource = await Cesium.GeoJsonDataSource.load(file.url, {
        stroke: Cesium.Color.TRANSPARENT,
        fill: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
        clampToGround: false,
      })

      await viewer.dataSources.add(dataSource)

      // 处理每个实体
      let successCount = 0
      let failCount = 0

      dataSource.entities.values.forEach((entity, index) => {
        if (entity.polygon) {
          try {
            // 检查多边形是否有效
            const hierarchy = entity.polygon.hierarchy?.getValue?.()
            if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) {
              console.warn(`${file.name} 第${index}个实体多边形顶点不足`)
              failCount++
              return
            }

            // 1. 坐标转换：GCJ-02 转 WGS84
            const positions = hierarchy.positions
            const newPositions = positions.map(pos => {
              const cartographic = Cesium.Cartographic.fromCartesian(pos)
              const lng = Cesium.Math.toDegrees(cartographic.longitude)
              const lat = Cesium.Math.toDegrees(cartographic.latitude)
              const wgs84 = gcj02ToWgs84(lng, lat)
              return Cesium.Cartesian3.fromDegrees(wgs84.lng, wgs84.lat, 0)
            })
            entity.polygon.hierarchy = new Cesium.PolygonHierarchy(newPositions)

            // 2. 设置多边形贴地
            entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN

            // 3. 从 GeoJSON 属性获取高度
            const featureHeight = entity.properties?.height?.getValue?.() ??
                                  entity.properties?.Height?.getValue?.() ??
                                  defaultHeight

            // 4. height=0的建筑不显示
            if (featureHeight === 0 || featureHeight === '0') {
              entity.show = false
              return
            }

            // 保存原始高度
            if (!entity.properties.originalHeight) {
              entity.properties.addProperty('originalHeight', featureHeight)
            }

            // 设置拉伸样式
            entity.polygon.extrudedHeight = featureHeight
            entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND
            entity.polygon.perPositionHeight = false

            // 设置材质
            const cesiumColor = typeof color === 'string' ? 
              Cesium.Color.fromCssColorString(color) : color
            entity.polygon.material = cesiumColor.withAlpha(0.8)

            // 默认隐藏建筑（等点击三维分析再显示）
            entity.show = false

            successCount++
          } catch (err) {
            console.warn(`${file.name} 第${index}个实体处理失败:`, err)
            failCount++
          }
        }
      })

      console.log(`${file.name}: 成功${successCount}个, 失败${failCount}个`)
      totalLoaded += successCount
    } catch (err) {
      console.warn(`加载 ${file.name} 失败:`, err.message)
    }
  }

  buildingsLoaded.value = true
  console.log(`[三维建筑] 加载完成，共 ${totalLoaded} 个面`)
}

/**
 * 隐藏OSM建筑
 */
const hideOSMBuildings = () => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  // 遍历所有primitives，找到OSM建筑并隐藏
  for (let i = 0; i < viewer.scene.primitives.length; i++) {
    const primitive = viewer.scene.primitives.get(i)
    if (primitive instanceof Cesium.Cesium3DTileset) {
      // 存储原始显示状态
      originalOSMVisibility[primitive.url || 'osm-tileset'] = primitive.show
      // 隐藏OSM建筑
      primitive.show = false
      console.log('[三维分析] 已隐藏OSM 3D建筑')
    }
  }
}

/**
 * 显示OSM建筑
 */
const showOSMBuildings = () => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  // 恢复所有primitives的显示状态
  for (let i = 0; i < viewer.scene.primitives.length; i++) {
    const primitive = viewer.scene.primitives.get(i)
    if (primitive instanceof Cesium.Cesium3DTileset) {
      // 恢复原始显示状态
      const originalState = originalOSMVisibility[primitive.url || 'osm-tileset']
      primitive.show = originalState !== undefined ? originalState : true
    }
  }
  
  // 清空存储
  originalOSMVisibility = {}
  console.log('[三维分析] 已恢复OSM 3D建筑显示')
}

/**
 * 淡出点并显现建筑
 */
const fadeOutPointsAndShowBuildings = () => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  // 1. 淡出所有设施点（只处理有category属性的点）
  const pointEntities = viewer.entities.values.filter(e => e.point && e.properties?.category)
  pointEntities.forEach(entity => {
    // 存储原始完整状态（包括颜色值，不只是透明度）
    const originalColor = entity.point.color?.getValue?.()
    const originalOutlineColor = entity.point.outlineColor?.getValue?.()
    
    originalPointOpacity[entity.id] = {
      color: originalColor,
      outlineColor: originalOutlineColor,
      outlineWidth: entity.point.outlineWidth?.getValue?.() || 0
    }
    // 设置为几乎完全透明（包括轮廓）
    entity.point.color = Cesium.Color.WHITE.withAlpha(0.05) // 更透明的颜色
    entity.point.outlineColor = Cesium.Color.TRANSPARENT // 完全透明的轮廓
    entity.point.outlineWidth = 0 // 完全禁用轮廓宽度
    
    // 多重保险：分阶段彻底隐藏
    setTimeout(() => {
      if (entity.point) {
        entity.point.outlineColor = Cesium.Color.TRANSPARENT
        entity.point.outlineWidth = 0
        entity.point.color = Cesium.Color.TRANSPARENT
      }
    }, 50)
    
    setTimeout(() => {
      if (entity.point) {
        // 最后保险：完全禁用点的显示
        entity.point.show = false
      }
    }, 100)
  })

  // 2. 显现所有三维建筑（从所有 dataSources 中获取）
  const buildingEntities = []
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i)
    if (ds.entities) {
      for (const entity of ds.entities.values) {
        if (entity.polygon) {
          buildingEntities.push(entity)
        }
      }
    }
  }

  buildingEntities.forEach((entity) => {
    const id = entity.id
    originalBuildingVisibility[id] = entity.show
    entity.show = true
  })

  // 3. 隐藏OSM建筑
  hideOSMBuildings()

  console.log(`[三维分析] 淡出 ${pointEntities.length} 个点，显现 ${buildingEntities.length} 个建筑，隐藏OSM建筑`)
}

/**
 * 恢复点标记和建筑显示
 */
const restorePointsAndBuildings = () => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  // 1. 恢复点标记（设施点有 category 属性）
  const pointEntities = viewer.entities.values.filter(e => e.point && e.properties?.category)
  pointEntities.forEach(entity => {
    // 首先恢复点的显示
    entity.show = true
    if (entity.point) {
      entity.point.show = true
    }
    
    // 获取原始状态信息
    const originalState = originalPointOpacity[entity.id]
    if (originalState) {
      // 恢复原始颜色和状态
      if (originalState.color) {
        entity.point.color = originalState.color
      }
      if (originalState.outlineColor) {
        entity.point.outlineColor = originalState.outlineColor
      }
      if (originalState.outlineWidth !== undefined) {
        entity.point.outlineWidth = originalState.outlineWidth
      }
    } else {
      // 如果没有原始信息，保持当前状态不变
      console.log(`[三维分析] 点 ${entity.id} 没有原始状态信息，保持当前状态`)
    }
  })

  // 2. 恢复建筑显示状态（隐藏）- 从所有 dataSources 获取
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i)
    if (ds.entities) {
      for (const entity of ds.entities.values) {
        if (entity.polygon) {
          entity.show = false
        }
      }
    }
  }

  // 3. 恢复OSM建筑显示
  showOSMBuildings()

  // 清空存储
  originalPointOpacity = {}
  originalBuildingVisibility = {}

  console.log('[三维分析] 点和建筑已恢复，OSM建筑已恢复显示')
}

// ==================== 视域分析控制函数 ====================

function setViewshedVisible(visible) {
  if (!visible) {
    clearViewshed()
    return
  }

  // 如果已经有观察点，重新计算视域
  if (viewshedObserverPosition) {
    calculateViewshed(viewshedObserverPosition)
  }
}

// 切换视域分析
function toggleViewshed() {
  // 如果激活，先清除其他所有分析功能
  if (!viewshedVisible.value) {
    clearAllAnalysis()
  }
  viewshedVisible.value = !viewshedVisible.value
  console.log('[toggleViewshed] 视域分析状态切换为:', viewshedVisible.value)
  setViewshedVisible(viewshedVisible.value)
  // 不关闭菜单，保持展开状态方便切换功能
}

// 清除视域分析结果
function clearViewshed() {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  const entitiesToRemove = viewer.entities.values.filter(e => {
    const type = e.properties?.type?.getValue?.()
    return type === 'viewshedVisible' || type === 'viewshedObserver'
  })

  entitiesToRemove.forEach(e => viewer.entities.remove(e))

  // 不要清除观察点变量，保留观察点位置
  console.log('[视域分析] 地图实体已清除，观察点保留:', viewshedObserverPosition)
}

// 重新计算视域（高度改变时）
function recalculateViewshed() {
  console.log('[recalculateViewshed] 高度调节触发，当前高度:', viewshedHeight.value)
  console.log('[recalculateViewshed] 观察点存在:', !!viewshedObserverPosition)
  console.log('[recalculateViewshed] 视域分析激活:', viewshedVisible.value)
  
  if (viewshedObserverPosition && viewshedVisible.value) {
    console.log('[recalculateViewshed] 开始重新计算视域')
    calculateViewshed(viewshedObserverPosition)
  } else {
    console.log('[recalculateViewshed] 条件不满足，跳过重新计算')
  }
}

// 平面坐标转回经纬度（Web Mercator反向投影）
function metersToLonLat(x, y, observerLon, observerLat) {
  // 使用 Cesium WebMercatorProjection 保持一致性
  const projection = new Cesium.WebMercatorProjection()

  // 观察点投影
  const observerCartographic = Cesium.Cartographic.fromDegrees(observerLon, observerLat)
  const observerMercator = projection.project(observerCartographic)

  // 计算目标点的 Web Mercator 坐标（局部坐标 + 观察点坐标）
  const targetMercator = {
    x: observerMercator.x + x,
    y: observerMercator.y + y
  }

  // 反向投影回经纬度
  const targetCartographic = projection.unproject(targetMercator)

  return {
    lon: Cesium.Math.toDegrees(targetCartographic.longitude),
    lat: Cesium.Math.toDegrees(targetCartographic.latitude)
  }
}

// 判断点是否在多边形内（Ray Casting算法，平面坐标）
function isPointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// 边界框快速检测
function isRayIntersectingBounds(observer, angle, bounds) {
  // 简化的边界框检测：检查射线方向是否与边界框相交
  // 这里使用保守估计，只要射线方向指向边界框区域就返回true
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  
  // 计算边界框中心方向
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const toCenterX = centerX - observer.x
  const toCenterY = centerY - observer.y
  
  // 计算角度差
  const angleToCenter = Math.atan2(toCenterY, toCenterX)
  const angleDiff = Math.abs(angle - angleToCenter)
  const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff)
  
  // 如果射线方向与指向边界框中心的方向偏差小于90度，进一步检测
  if (normalizedDiff > Math.PI / 2) return false
  
  // 计算到边界框的距离
  const distToCenter = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY)
  const boxRadius = Math.sqrt(
    Math.pow(bounds.maxX - bounds.minX, 2) + 
    Math.pow(bounds.maxY - bounds.minY, 2)
  ) / 2
  
  return distToCenter < (2000 + boxRadius) // 在最大半径范围内
}

/**
 * 计算射线与AABB包围盒的相交距离
 * 射线: P(t) = O + t*D, t >= 0
 * AABB: [minX, maxX] × [minY, maxY]
 * 返回射线进入包围盒的距离 tEnter，如果相交
 */
function rayBoxIntersection(ox, oy, dx, dy, minX, minY, maxX, maxY) {
  let tMin = -Infinity
  let tMax = Infinity

  // X轴方向
  if (Math.abs(dx) < 0.00001) {
    // 射线平行于X轴
    if (ox < minX || ox > maxX) return null
  } else {
    const t1 = (minX - ox) / dx
    const t2 = (maxX - ox) / dx
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
  }

  // Y轴方向
  if (Math.abs(dy) < 0.00001) {
    // 射线平行于Y轴
    if (oy < minY || oy > maxY) return null
  } else {
    const t1 = (minY - oy) / dy
    const t2 = (maxY - oy) / dy
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
  }

  // 相交条件: tMax >= tMin 且 tMax > 0 (射线前方有交点)
  if (tMax >= tMin && tMax > 0) {
    // 返回进入距离 (tMin > 0 ? tMin : 0)
    // 如果观察点在包围盒内部，tMin可能是负数，此时返回0
    const enterDist = tMin > 0 ? tMin : 0
    return { enter: enterDist, exit: tMax }
  }

  return null
}

/**
 * 核心射线投射函数（平面几何版）
 * @param {number} angle - 射线角度（弧度）
 * @param {Object} observer - 观察点 { x: 0, y: 0, height: 18 }
 * @param {Array} buildings - 建筑物列表 (已转换为平面坐标)
 * @param {number} maxRadius - 最大半径
 */
function castRay(angle, observer, buildings, maxRadius, debug = false) {
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)

  // 收集所有有效交点：{dist, height, buildingId}
  const intersections = []

  for (const building of buildings) {
    const height = Number(building.height)
    const bounds = building.bounds

    // 【粗筛】快速距离检查：计算建筑中心到观察点的距离
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const centerDist = Math.sqrt(centerX * centerX + centerY * centerY)
    const boxRadius = Math.sqrt(
      Math.pow(bounds.maxX - bounds.minX, 2) +
      Math.pow(bounds.maxY - bounds.minY, 2)
    ) / 2

    // 如果建筑中心太远（超过 maxRadius + 建筑半径），直接跳过
    if (centerDist > maxRadius + boxRadius) {
      continue
    }

    // 【精算】射线与包围盒相交检测
    const boxHit = rayBoxIntersection(
      observer.x, observer.y, dirX, dirY,
      bounds.minX, bounds.minY, bounds.maxX, bounds.maxY
    )

    if (boxHit && boxHit.enter > 0 && boxHit.enter <= maxRadius) {
      intersections.push({
        dist: boxHit.enter,
        height: height,
        buildingId: building.id
      })
    }
  }

  // 按进入距离排序
  intersections.sort((a, b) => a.dist - b.dist)

  // 找到最近的能挡住视线的交点
  let closestBlockDist = maxRadius
  let isBlocked = false
  let hitBuildingHeight = null

  for (const hit of intersections) {
    // 在距离 hit.dist 处，视线高度 = 观察点高度（假设水平视线）
    const viewHeightAtDist = observer.height

    // 如果建筑高度 > 视线高度，则被挡住
    if (hit.height > viewHeightAtDist) {
      closestBlockDist = hit.dist
      isBlocked = true
      hitBuildingHeight = hit.height
      break // 找到最近的遮挡就停止
    }
    // 如果挡不住，继续检查后面的交点
  }

  return {
    dist: closestBlockDist,
    blocked: isBlocked,
    x: observer.x + dirX * closestBlockDist,
    y: observer.y + dirY * closestBlockDist
  }
}

/**
 * 计算视域分析（基于墨卡托投影平面坐标）
 */
async function calculateViewshed(observerPos) {
  console.log('[calculateViewshed] 开始计算，传入观察点:', observerPos)
  console.log('[calculateViewshed] 当前视域分析状态:', viewshedVisible.value)
  console.log('[calculateViewshed] 计算前观察点状态:', viewshedObserverPosition)
  
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  // 如果视域分析未激活，不计算
  if (!viewshedVisible.value) {
    console.log('[calculateViewshed] 视域分析未激活，退出计算')
    return
  }

  viewshedObserverPosition = observerPos
  console.log('[calculateViewshed] 观察点已更新:', viewshedObserverPosition)

  // 清除之前的视域结果
  clearViewshed()

  const { lon, lat } = observerPos
  const radius = viewshedRadius
  const observerHeight = viewshedHeight.value

  // 获取观察点地形高度
  const observerCart = Cesium.Cartesian3.fromDegrees(lon, lat)
  const observerCartographic = Cesium.Cartographic.fromCartesian(observerCart)
  const terrainHeight = await viewer.scene.globe.getHeight(observerCartographic) || 0
  const observerEyeHeight = terrainHeight + observerHeight

  // 添加观察点（黄色标记）
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, observerEyeHeight),
    point: {
      pixelSize: 20,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
    },
    properties: {
      type: 'viewshedObserver'
    }
  })

  console.log(`[视域分析] 观察点(${lon.toFixed(4)}, ${lat.toFixed(4)}), 高度${observerHeight}m`)

  // 使用 Cesium 标准的 WebMercatorProjection
  const projection = new Cesium.WebMercatorProjection()

  // 观察点转为 Web Mercator
  const obsCarto = Cesium.Cartographic.fromDegrees(lon, lat)
  const observerMercator = projection.project(obsCarto)

  // 提取建筑物数据
  const buildings = []
  const dataSourceCount = viewer.dataSources.length
  console.log(`[视域分析] 开始检查数据源，共${dataSourceCount}个数据源`)
  
  for (let dsIdx = 0; dsIdx < dataSourceCount; dsIdx++) {
    const dataSource = viewer.dataSources.get(dsIdx)
    console.log(`[视域分析] 数据源${dsIdx}: ${dataSource.name || '未命名'}, 实体数量: ${dataSource.entities.values.length}`)
    
    let entityCount = 0
    let polygonCount = 0
    let osmBuildingCount = 0
    
    for (const entity of dataSource.entities.values) {
      entityCount++
      if (!entity.polygon) {
        continue
      }
      polygonCount++
      
      // 检查是否是OSM建筑（有extrudedHeight字段）
      const hasExtrudedHeight = entity.polygon?.extrudedHeight !== undefined
      if (hasExtrudedHeight) {
        osmBuildingCount++
      }
      
      if (entityCount <= 3) { // 只记录前几个实体的详细信息
        console.log(`[视域分析] 实体${entityCount}: ID=${entity.id}, 有polygon=${!!entity.polygon}, 有extrudedHeight=${hasExtrudedHeight}`)
      }
    }
    
    console.log(`[视域分析] 数据源${dsIdx}统计: 总实体=${entityCount}, 多边形=${polygonCount}, OSM建筑=${osmBuildingCount}`)
    
    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue

      // 获取建筑高度 - 优先使用OSM建筑的extrudedHeight字段
      let height = null
      
      // 1. 首先尝试获取OSM 3D建筑的extrudedHeight（这是OSM建筑的标准高度字段）
      if (entity.polygon?.extrudedHeight) {
        if (typeof entity.polygon.extrudedHeight.getValue === 'function') {
          height = entity.polygon.extrudedHeight.getValue(Cesium.JulianDate.now())
        } else {
          height = entity.polygon.extrudedHeight
        }
      }
      
      // 2. 如果没有extrudedHeight，尝试获取properties中的高度字段
      if (!height) {
        height = entity.properties?.originalHeight?.getValue?.() ||
                 entity.properties?.height?.getValue?.() ||
                 null
      }
      
      // 3. 如果仍然没有高度，使用类别映射
      if (!height) {
        const category = entity.properties?.category?.getValue?.() ||
                         dataSource.name?.toLowerCase?.() || 'other'
        height = categoryHeights[category] || 40
      }

      height = Number(height)
      
      // 调试：记录建筑高度来源
      const heightSource = entity.polygon?.extrudedHeight ? 'OSM extrudedHeight' :
                          entity.properties?.originalHeight?.getValue?.() ? 'properties originalHeight' :
                          entity.properties?.height?.getValue?.() ? 'properties height' :
                          'category default'
      
      if (dsIdx === 0 && buildings.length < 3) { // 只记录前几个建筑的调试信息
        console.log(`[视域分析] 建筑${buildings.length + 1}: 高度=${height}m, 来源=${heightSource}, ID=${entity.id}`)
      }

      try {
        const hierarchy = entity.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now())
        if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) continue

        // 转换多边形顶点为相对于观察点的局部坐标
        const polygon = []
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

        for (let i = 0; i < hierarchy.positions.length; i++) {
          const pos = hierarchy.positions[i]

          // 获取经纬度
          const carto = Cesium.Cartographic.fromCartesian(pos)
          const pLon = Cesium.Math.toDegrees(carto.longitude)
          const pLat = Cesium.Math.toDegrees(carto.latitude)

          // 投影到 Web Mercator
          const posCartographic = Cesium.Cartographic.fromDegrees(pLon, pLat)
          const posMercator = projection.project(posCartographic)

          // 计算相对于观察点的局部坐标
          const relativeX = posMercator.x - observerMercator.x
          const relativeY = posMercator.y - observerMercator.y

          polygon.push({ x: relativeX, y: relativeY })

          minX = Math.min(minX, relativeX)
          maxX = Math.max(maxX, relativeX)
          minY = Math.min(minY, relativeY)
          maxY = Math.max(maxY, relativeY)
        }

        if (polygon.length >= 3) {
          buildings.push({
            id: entity.id,
            height: height,
            polygon: polygon,
            bounds: { minX, maxX, minY, maxY }
          })
        }
      } catch (e) {
        // 跳过
      }
    }
  }

  console.log(`[视域分析] 提取了 ${buildings.length} 个建筑物`)

  // 720方向射线投射（每0.5度一根）
  const directions = 720
  const visibleBoundaries = []

  // 观察点平面坐标（中心点，所以是0,0）
  const observer = { x: 0, y: 0, height: observerHeight }

  for (let d = 0; d < directions; d++) {
    const angle = (d / directions) * Math.PI * 2
    const result = castRay(angle, observer, buildings, radius)

    // 转换回经纬度
    const endLonLat = metersToLonLat(result.x, result.y, lon, lat)

    visibleBoundaries.push({
      lon: endLonLat.lon,
      lat: endLonLat.lat,
      angle: angle,
      dist: result.dist,
      blocked: result.blocked
    })
  }

  // 边缘平滑插值
  function smoothBoundaries(boundaries) {
    const smoothed = [boundaries[0]]

    for (let i = 1; i < boundaries.length; i++) {
      const prev = boundaries[i - 1]
      const curr = boundaries[i]

      // 如果遮挡状态变化了，或者距离变化超过100m，插入中间点
      const distDiff = Math.abs(curr.dist - prev.dist)
      const stateChanged = curr.blocked !== prev.blocked

      if (stateChanged || distDiff > 100) {
        // 插值中间点
        const midAngle = (prev.angle + curr.angle) / 2
        const midDist = (prev.dist + curr.dist) / 2
        const midBlocked = prev.blocked && curr.blocked

        // 计算中间点坐标
        const midX = Math.cos(midAngle) * midDist
        const midY = Math.sin(midAngle) * midDist
        const midLonLat = metersToLonLat(midX, midY, lon, lat)

        smoothed.push({
          lon: midLonLat.lon,
          lat: midLonLat.lat,
          angle: midAngle,
          dist: midDist,
          blocked: midBlocked
        })
      }

      smoothed.push(curr)
    }

    return smoothed
  }

  // 应用平滑
  const smoothedBoundaries = smoothBoundaries(visibleBoundaries)
  console.log(`[视域分析] 边界: ${visibleBoundaries.length}点 → ${smoothedBoundaries.length}点`)

  // 绘制视域多边形
  const finalBoundaries = smoothedBoundaries.length >= 3 ? smoothedBoundaries : visibleBoundaries

  if (finalBoundaries.length >= 3) {
    // 按角度排序形成闭合多边形
    const sorted = finalBoundaries.sort((a, b) => a.angle - b.angle)

    // 构建多边形顶点（贴地）
    const positions = sorted.map(p =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, terrainHeight + 2)
    )

    // 创建视域多边形（深绿色贴地光斑）
    viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString('#228b22').withAlpha(0.75),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#006400'),
        outlineWidth: 2,
        height: terrainHeight + 2,
        perPositionHeight: false,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      properties: {
        type: 'viewshedVisible'
      }
    })
  }

  console.log(`[视域分析] 完成，共${visibleBoundaries.length}个边界点`)
}


const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters < 0) return '—'
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

const formatDurationMinutes = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return '<1 分钟'
  return `${Math.round(seconds / 60)} 分钟`
}

const onIsochroneUpdated = (evt) => {
  const detail = evt?.detail
  isochroneStats.value = detail || null
}

// 这里预留处理地图点击的回调逻辑
const handleMapClick = (info) => {
  console.log('[handleMapClick] 收到点击事件:', info)

  // 视域分析处理
  console.log('[handleMapClick] 视域分析状态:', viewshedVisible.value)
  console.log('[handleMapClick] 点击信息:', info)
  if (viewshedVisible.value && info?.lon && info?.lat) {
    console.log('[handleMapClick] 开始视域分析，观察点:', info.lon, info.lat)
    viewshedObserverPosition = { lon: info.lon, lat: info.lat }
    console.log('[handleMapClick] 观察点已设置:', viewshedObserverPosition)
    calculateViewshed({ lon: info.lon, lat: info.lat })
    return
  }

  // 剖面分析处理
  if (profileActive.value && profilePoints.value.length < 2 && info?.position) {
    console.log('[handleMapClick] 开始剖面分析')
    handleProfileClick(info.position)
    return
  }

  // 通视分析处理
  if (visibilityActive.value && visibilityPoints.value.length < 2 && info?.position) {
    console.log('[handleMapClick] 开始通视分析')
    handleVisibilityClick(info.position)
    return
  }

  // 不再显示坐标弹窗
}

const handleToolClick = (toolId) => {
  const map = mapRef.value
  if (!map) return
  switch (toolId) {
    case 'location':
      map.getUserLocation && map.getUserLocation()
      break
    case 'reset':
      map.resetView && map.resetView()
      break
    case 'measure':
      map.startDistanceMeasure && map.startDistanceMeasure()
      break
    case 'area':
      map.startAreaMeasure && map.startAreaMeasure()
      break
    case 'clear':
      map.clearDrawings && map.clearDrawings()
      break
  }
}

const toggleCategory = (id) => {
  const idx = activeCategories.value.indexOf(id)
  if (idx >= 0) {
    activeCategories.value.splice(idx, 1)
  } else {
    activeCategories.value.push(id)
  }

  const map = mapRef.value
  if (map && map.setVisibleCategories) {
    map.setVisibleCategories(activeCategories.value)
  }
}

const toggleRoads = () => {
  roadsVisible.value = !roadsVisible.value
  const map = mapRef.value
  if (map && map.setRoadsVisible) {
    map.setRoadsVisible(roadsVisible.value)
  }
}

// ==================== 空间分析菜单控制函数 ====================

const toggleSpatialAnalysisMenu = () => {
  spatialAnalysisMenuOpen.value = !spatialAnalysisMenuOpen.value
  // 默认展开子菜单
  if (spatialAnalysisMenuOpen.value) {
    planarAnalysisOpen.value = true
    analysis3DOpen.value = true
  }
}

const closeSpatialMenu = () => {
  spatialAnalysisMenuOpen.value = false
}

const togglePlanarAnalysis = () => {
  planarAnalysisOpen.value = !planarAnalysisOpen.value
}

const toggleAnalysis3D = () => {
  analysis3DOpen.value = !analysis3DOpen.value
}


const toggleVisibility = () => {
  // 如果激活，先清除其他所有分析功能
  if (!visibilityActive.value) {
    clearAllAnalysis()
  }
  visibilityActive.value = !visibilityActive.value

  if (visibilityActive.value) {
    // 激活时清空之前的数据
    clearVisibility()
    console.log('[通视分析] 已激活，请点击两点（观察点和目标点）')
  } else {
    clearVisibility()
  }
  // 不关闭菜单，保持展开状态方便切换功能
}

const toggleProfile = () => {
  // 如果激活，先清除其他所有分析功能
  if (!profileActive.value) {
    clearAllAnalysis()
  }
  profileActive.value = !profileActive.value

  if (profileActive.value) {
    // 激活时清空之前的数据
    clearProfile()
    console.log('[剖面分析] 已激活，请在地图上点击两点')
  } else {
    clearProfile()
  }
  // 不关闭菜单，保持展开状态方便切换功能
}

const toggleHeatmap = () => {
  // 如果激活，先清除其他所有分析功能
  if (!heatmapVisible.value) {
    clearAllAnalysis()
  }
  heatmapVisible.value = !heatmapVisible.value
  console.log(`切换热力图: ${heatmapVisible.value}, 类型: ${heatmapType.value}`)
  const map = mapRef.value
  if (map && map.setHeatmapVisible) {
    map.setHeatmapVisible(heatmapVisible.value, heatmapType.value)
  }
  // 不关闭菜单，保持展开状态方便切换功能
}

const setHeatmapType = (type) => {
  console.log(`设置热力图类型: ${type}`)
  heatmapType.value = type
  // 如果热力图当前是开启的，重新加载以应用新类型
  if (heatmapVisible.value) {
    const map = mapRef.value
    if (map && map.setHeatmapVisible) {
      map.setHeatmapVisible(false) // 先关闭
      setTimeout(() => {
        console.log(`重新开启热力图，新类型: ${type}`)
        map.setHeatmapVisible(true, type) // 再开启新类型
      }, 100)
    }
  }
}

const refreshCoverage = async () => {
  const map = mapRef.value
  if (!map || !map.setCoverageVisible) return
  coverageLoading.value = true
  coverageStats.value = null // 清空旧数据，显示加载状态
  try {
    await map.setCoverageVisible(coverageVisible.value, {
      radiusMeters: Number(coverageRadius.value),
      categories: coverageCategories.value,
    })
    coverageStats.value = map.getCoverageStats ? map.getCoverageStats() : null
  } finally {
    coverageLoading.value = false
  }
}

const toggleCoverage = async () => {
  // 如果激活，先清除其他所有分析功能
  if (!coverageVisible.value) {
    clearAllAnalysis()
  }
  coverageVisible.value = !coverageVisible.value
  await refreshCoverage()
}

const onCoverageRadiusChange = async () => {
  if (!coverageVisible.value) return
  await refreshCoverage()
}

const onCoverageCategoryChange = async () => {
  if (!coverageVisible.value) return
  await refreshCoverage()
}

const toggleCoverageCategory = async (category) => {
  const list = coverageCategories.value
  const hasAll = list.includes('all')

  if (category === 'all') {
    coverageCategories.value = ['all']
  } else {
    if (hasAll) {
      coverageCategories.value = [category]
    } else if (list.includes(category)) {
      const next = list.filter((c) => c !== category)
      coverageCategories.value = next.length > 0 ? next : ['all']
    } else {
      coverageCategories.value = [...list, category]
    }
  }

  if (coverageVisible.value) await refreshCoverage()
  if (accessibilityVisible.value) await refreshAccessibility()
  // 等时圈起点/分析类型不再依赖“设施类型”，无需随设施类型变化自动重算
}

const refreshAccessibility = async () => {
  const map = mapRef.value
  if (!map || !map.setAccessibilityVisible) return
  accessibilityLoading.value = true
  try {
    const stats = await map.setAccessibilityVisible(accessibilityVisible.value, {
      timeThresholdMinutes: Number(accessibilityTimeThreshold.value),
      categories: coverageCategories.value,
    })
    accessibilityStats.value = stats || null
  } finally {
    accessibilityLoading.value = false
  }
}

const refreshIsochrone = async () => {
  const map = mapRef.value
  if (!map || !map.setIsochroneVisible) return
  isochroneLoading.value = true
  try {
    const stats = await map.setIsochroneVisible(isochroneVisible.value, {
      timeThresholdsMinutes: isochroneTimeThresholdsMinutes,
      categories: ['all'],
      travelMode: isochroneTravelMode.value,
      topN: isochroneTopN.value,
      showTopArrivalsLines: isochroneShowTopConnectors.value,
    })
    isochroneStats.value = stats || null
  } finally {
    isochroneLoading.value = false
  }
}

const toggleIsochrone = async () => {
  // 如果激活，先清除其他所有分析功能
  if (!isochroneVisible.value) {
    clearAllAnalysis()
  }
  isochroneVisible.value = !isochroneVisible.value
  const map = mapRef.value
  if (!map || !map.setIsochroneVisible) return

  if (!isochroneVisible.value) {
    isochroneStats.value = null
    isochroneLoading.value = false
    await map.setIsochroneVisible(false)
    return
  }
  await refreshIsochrone()
}

const focusIsochroneTopArrival = (item) => {
  const map = mapRef.value
  if (!map || !item) return
  if (map.focusFacilityByLonLat && Number.isFinite(item.longitude) && Number.isFinite(item.latitude)) {
    map.focusFacilityByLonLat(item.longitude, item.latitude)
  }
}

const toggleAccessibility = async () => {
  // 如果激活，先清除其他所有分析功能
  if (!accessibilityVisible.value) {
    clearAllAnalysis()
  }
  accessibilityVisible.value = !accessibilityVisible.value
  if (!accessibilityVisible.value) {
    accessibilityStats.value = null
    accessibilityLoading.value = false
  }
  await refreshAccessibility()
}

const onAccessibilityTimeChange = async () => {
  if (!accessibilityVisible.value) return
  await refreshAccessibility()
}

const toggleLayerPanel = () => {
  layerPanelOpen.value = !layerPanelOpen.value
}

const toggleDisasterPanel = () => {
  showDisasterPanel.value = !showDisasterPanel.value
}

const toggleSiteSelectionPanel = () => {
  showSiteSelectionPanel.value = !showSiteSelectionPanel.value
}

// 执行选址分析
const runSiteSelection = async (params) => {
  const map = mapRef.value
  if (!map) return
  
  siteSelectionLoading.value = true
  try {
    const result = await map.runSiteSelectionAnalysis(params)
    siteSelectionResults.value = result
  } finally {
    siteSelectionLoading.value = false
  }
}

// 清空选址结果
const clearSiteSelection = () => {
  const map = mapRef.value
  if (map && map.clearSiteSelection) {
    map.clearSiteSelection()
  }
  siteSelectionResults.value = null
}

const toggleDisasterLayer = () => {
  disasterLayerVisible.value = !disasterLayerVisible.value
  if (disasterLayerVisible.value) {
    // 显示灾情图层
    mapRef.value?.loadDisasters()
  } else {
    // 隐藏灾情图层
    mapRef.value?.clearDisasters()
  }
}

// ========== 导出功能 ==========

// 导出热力图
const exportHeatmap = async (format = 'png') => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  const filename = generateFilename('热力图', format)
  try {
    if (format === 'png') {
      await exportCesiumSceneWithDecorations(viewer, filename, {
        title: '设施分布热力图',
        subtitle: '基于网格密度的空间分析',
        analysisType: 'heatmap',
        params: {}
      })
    } else {
      const heatmapData = map.getHeatmapData?.() || []
      exportJsonData(heatmapData, filename)
    }
  } catch (e) {
    alert('导出失败：' + (e.message || '请检查地图是否加载完成'))
    console.error('Export error:', e)
  }
}

// 设施类型中文映射
const categoryNames = {
  all: '全部',
  hospital: '医疗',
  school: '教育',
  shelter: '避难',
  resident: '居民',
  commercial: '商业',
  other: '其他'
}

// 导出覆盖范围分析
const exportCoverage = async (format = 'png') => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  const filename = generateFilename('覆盖范围分析', format, {
    radius: coverageRadius.value
  })

  // 获取设施类型中文名称
  const categoryLabels = coverageCategories.value.map(c => categoryNames[c] || c).join('、')

  try {
    if (format === 'png') {
      await exportCesiumSceneWithDecorations(viewer, filename, {
        title: `${categoryLabels}设施覆盖范围分析`,
        subtitle: `服务半径 ${coverageRadius.value}米`,
        analysisType: 'coverage',
        params: { radius: coverageRadius.value }
      })
    } else {
      const data = {
        analysisType: '覆盖范围分析',
        radius: coverageRadius.value,
        categories: coverageCategories.value,
        ...coverageStats.value
      }
      if (format === 'csv' && coverageStats.value) {
        exportCsvData([coverageStats.value], filename)
      } else {
        exportJsonData(data, filename)
      }
    }
  } catch (e) {
    alert('导出失败：' + (e.message || '请检查地图是否加载完成'))
    console.error('Export error:', e)
  }
}

// 导出可达性分析
const exportAccessibility = async (format = 'png') => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  const filename = generateFilename('可达性分析', format, {
    timeThreshold: accessibilityTimeThreshold.value
  })

  // 获取设施类型中文名称
  const categoryLabels = coverageCategories.value.map(c => categoryNames[c] || c).join('、')

  try {
    if (format === 'png') {
      await exportCesiumSceneWithDecorations(viewer, filename, {
        title: `${categoryLabels}设施可达性分析`,
        subtitle: `步行 ${accessibilityTimeThreshold.value}分钟可达范围`,
        analysisType: 'accessibility',
        params: { timeThreshold: accessibilityTimeThreshold.value }
      })
    } else {
      const data = {
        analysisType: '可达性分析',
        timeThresholdMinutes: accessibilityTimeThreshold.value,
        categories: coverageCategories.value,
        ...accessibilityStats.value
      }
      if (format === 'csv' && accessibilityStats.value) {
        exportCsvData([accessibilityStats.value], filename)
      } else {
        exportJsonData(data, filename)
      }
    }
  } catch (e) {
    alert('导出失败：' + (e.message || '请检查地图是否加载完成'))
    console.error('Export error:', e)
  }
}

// 导出等时圈分析
const exportIsochrone = async (format = 'png') => {
  const map = mapRef.value
  if (!map) return
  const viewer = map.getViewer?.()
  if (!viewer) return

  const filename = generateFilename('等时圈分析', format, {
    travelMode: isochroneTravelMode.value
  })

  try {
    if (format === 'png') {
      const modeText = isochroneTravelMode.value === 'walking' ? '步行' : '驾车'
      await exportCesiumSceneWithDecorations(viewer, filename, {
        title: '等时圈分析',
        subtitle: `${modeText}出行时间分析`,
        analysisType: 'isochrone',
        params: { travelMode: isochroneTravelMode.value }
      })
    } else {
      const data = {
        analysisType: '等时圈分析',
        travelMode: isochroneTravelMode.value,
        timeThresholdsMinutes: isochroneTimeThresholdsMinutes,
        topN: isochroneTopN.value,
        ...isochroneStats.value
      }
      if (format === 'csv' && isochroneStats.value?.topArrivals) {
        exportCsvData(isochroneStats.value.topArrivals, filename)
      } else {
        exportJsonData(data, filename)
      }
    }
  } catch (e) {
    alert('导出失败：' + (e.message || '请检查地图是否加载完成'))
    console.error('Export error:', e)
  }
}

// ==================== 灾情定位处理 ====================
// 已移至CesiumMap.vue中处理

// 组件挂载后设置初始可见类别
onMounted(() => {
  window.addEventListener('isochrone-updated', onIsochroneUpdated)
  // 等待地图组件初始化完成
  setTimeout(() => {
    const map = mapRef.value
    if (map && map.setVisibleCategories) {
      map.setVisibleCategories(activeCategories.value)
    }
    if (map && map.setRoadsVisible) {
      map.setRoadsVisible(roadsVisible.value)
    }
  }, 1000) // 延迟1秒确保地图组件已完全初始化
})

onBeforeUnmount(() => {
  window.removeEventListener('isochrone-updated', onIsochroneUpdated)
})

// ==================== 剖面分析函数 ====================

/**
 * 处理剖面分析的点击
 */
function handleProfileClick(position) {
  if (!profileActive.value) return

  // 转换为经纬度
  const cartographic = Cesium.Cartographic.fromCartesian(position)
  const lng = Cesium.Math.toDegrees(cartographic.longitude)
  const lat = Cesium.Math.toDegrees(cartographic.latitude)
  const height = cartographic.height

  const point = { lng, lat, height }
  profilePoints.value.push(point)

  // 添加点标记（带类型标记以便清除）
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (viewer) {
    viewer.entities.add({
      position: position,
      point: {
        pixelSize: 10,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
      properties: {
        type: 'profileMarker'
      }
    })
  }

  console.log(`[剖面分析] 添加点 ${profilePoints.value.length}: ${lng.toFixed(4)}, ${lat.toFixed(4)}`)

  // 如果已有两个点，生成剖面
  if (profilePoints.value.length === 2) {
    generateProfile()
  }
}

/**
 * 生成地形剖面数据
 */
async function generateProfile() {
  if (profilePoints.value.length < 2) return

  const start = profilePoints.value[0]
  const end = profilePoints.value[1]

  // 采样点数量（沿剖面线均匀采样）
  const sampleCount = 50
  profileData.value = []

  // 创建采样点
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1)
    const lng = start.lng + (end.lng - start.lng) * t
    const lat = start.lat + (end.lat - start.lat) * t

    // 计算距离起点的水平距离
    const distance = calculateDistance(start.lng, start.lat, lng, lat)

    try {
      const positions = [Cesium.Cartographic.fromDegrees(lng, lat)]
      const map = mapRef.value
      const viewer = map?.getViewer?.()
      if (viewer) {
        const updatedPositions = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions)
        const elevation = updatedPositions[0]?.height || 0

        profileData.value.push({
          index: i,
          lng,
          lat,
          distance,
          elevation
        })
      }
    } catch (e) {
      console.warn('[剖面分析] 获取高程失败:', e)
      profileData.value.push({
        index: i,
        lng,
        lat,
        distance,
        elevation: 0
      })
    }
  }

  // 绘制剖面线
  drawProfileLine()

  // 绘制剖面图表
  drawProfileChart()

  console.log(`[剖面分析] 生成剖面完成，共 ${profileData.value.length} 个采样点`)
}

/**
 * 绘制剖面线
 */
function drawProfileLine() {
  if (profilePoints.value.length < 2) return

  const start = profilePoints.value[0]
  const end = profilePoints.value[1]

  // 移除旧线条
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (!viewer) return

  if (profileLineEntity) {
    viewer.entities.remove(profileLineEntity)
  }

  // 创建新的剖面线
  profileLineEntity = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        start.lng, start.lat, start.height + 10,
        end.lng, end.lat, end.height + 10
      ]),
      width: 3,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.3,
        color: Cesium.Color.YELLOW
      }),
      clampToGround: false
    }
  })
}

/**
 * 绘制剖面图表（使用 Canvas）
 */
function drawProfileChart() {
  const canvas = document.querySelector('.profile-chart')
  if (!canvas || profileData.value.length === 0) return

  // 设置 Canvas 尺寸
  canvas.width = 250
  canvas.height = 150

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 获取高程范围
  const elevations = profileData.value.map(d => d.elevation)
  const minElevation = Math.min(...elevations)
  const maxElevation = Math.max(...elevations)
  const elevationRange = maxElevation - minElevation || 1

  const maxDistance = profileData.value[profileData.value.length - 1]?.distance || 1

  // 绘制坐标轴
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(40, 10)
  ctx.lineTo(40, 130)
  ctx.lineTo(240, 130)
  ctx.stroke()

  // 绘制剖面线
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 2
  ctx.beginPath()

  profileData.value.forEach((point, index) => {
    const x = 40 + (point.distance / maxDistance) * 200
    const y = 130 - ((point.elevation - minElevation) / elevationRange) * 100

    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })

  ctx.stroke()

  // 填充区域
  ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'
  ctx.lineTo(40 + 200, 130)
  ctx.lineTo(40, 130)
  ctx.closePath()
  ctx.fill()

  // 标注高程值
  ctx.fillStyle = '#333'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(maxElevation.toFixed(0) + 'm', 35, 15)
  ctx.fillText(minElevation.toFixed(0) + 'm', 35, 135)

  // 绘制坐标轴标签
  ctx.fillStyle = '#333'
  ctx.font = '10px Arial'
  ctx.fillText('0', 35, 145)
  ctx.fillText(`${(maxDistance / 1000).toFixed(1)}km`, 220, 145)
  ctx.fillText(`${minElevation.toFixed(0)}m`, 5, 135)
  ctx.fillText(`${maxElevation.toFixed(0)}m`, 5, 25)
}

/**
 * 计算高差
 */
function calculateElevationDiff() {
  if (profileData.value.length === 0) return 0
  const elevations = profileData.value.map(d => d.elevation)
  return Math.max(...elevations) - Math.min(...elevations)
}

/**
 * 计算剖面长度
 */
function calculateProfileLength() {
  if (profileData.value.length === 0) return 0
  return profileData.value[profileData.value.length - 1]?.distance || 0
}

/**
 * 清除剖面分析
 */
function clearProfile() {
  profilePoints.value = []
  profileData.value = []

  // 移除剖面线
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (viewer && profileLineEntity) {
    viewer.entities.remove(profileLineEntity)
    profileLineEntity = null
  }

  // 移除所有点标记（通过类型标记）
  if (viewer) {
    const entitiesToRemove = []
    for (const entity of viewer.entities.values) {
      if (entity.properties?.type?.getValue?.() === 'profileMarker') {
        entitiesToRemove.push(entity)
      }
    }
    entitiesToRemove.forEach(entity => viewer.entities.remove(entity))
  }

  // 清除图表
  const canvas = document.querySelector('.profile-chart')
  if (canvas) {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  console.log('[剖面分析] 已清除')
}

// ==================== 通视分析函数 ====================

/**
 * 处理通视分析的点击
 */
function handleVisibilityClick(position) {
  if (!visibilityActive.value) return

  // 转换为经纬度
  const cartographic = Cesium.Cartographic.fromCartesian(position)
  const lng = Cesium.Math.toDegrees(cartographic.longitude)
  const lat = Cesium.Math.toDegrees(cartographic.latitude)
  const height = cartographic.height

  const point = { lng, lat, height, position }
  visibilityPoints.value.push(point)

  // 添加点标记
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (viewer) {
    const pointColor = visibilityPoints.value.length === 1 ? Cesium.Color.GREEN : Cesium.Color.RED
    const pointName = visibilityPoints.value.length === 1 ? '观察点' : '目标点'
    
    const entity = viewer.entities.add({
      position: position,
      point: {
        pixelSize: 12,
        color: pointColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
      label: {
        text: pointName,
        font: '12pt sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -30),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
      properties: {
        type: 'visibilityMarker',
        pointType: pointName
      }
    })

    // 保存实体引用
    if (visibilityPoints.value.length === 1) {
      visibilityObserverEntity = entity
    } else {
      visibilityTargetEntity = entity
    }
  }

  console.log(`[通视分析] 添加${visibilityPoints.value.length === 1 ? '观察点' : '目标点'}: ${lng.toFixed(4)}, ${lat.toFixed(4)}`)

  // 如果已有两个点，进行通视分析
  if (visibilityPoints.value.length === 2) {
    calculateVisibility()
  }
}

/**
 * 计算通视分析
 */
async function calculateVisibility() {
  if (visibilityPoints.value.length < 2) return

  const observer = visibilityPoints.value[0]
  const target = visibilityPoints.value[1]

  // 清除之前的线段
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (!viewer) return

  if (visibilityLineVisible) {
    viewer.entities.remove(visibilityLineVisible)
    visibilityLineVisible = null
  }
  if (visibilityLineBlocked) {
    viewer.entities.remove(visibilityLineBlocked)
    visibilityLineBlocked = null
  }
  if (visibilityBlockPointEntity) {
    viewer.entities.remove(visibilityBlockPointEntity)
    visibilityBlockPointEntity = null
  }

  try {
    // 创建视线向量
    const observerPos = observer.position
    const targetPos = target.position

    // 进行射线检测
    const result = await performRaycastVisibility(observerPos, targetPos, viewer)

    // 保存结果
    visibilityResult.value = result

    // 绘制结果
    drawVisibilityResult(result)

    console.log('[通视分析] 分析完成:', result)
  } catch (error) {
    console.error('[通视分析] 计算失败:', error)
  }
}

/**
 * 执行通视分析（完整版本，包含建筑物遮挡检测）
 */
async function performRaycastVisibility(observerPos, targetPos, viewer) {
  const observer = visibilityPoints.value[0]
  const target = visibilityPoints.value[1]
  
  // 采样点数量
  const sampleCount = 100
  let isVisible = true
  let blockPoint = null
  let maxBlockHeight = -Infinity

  // 获取观察点和目标点的高程
  const startElevation = observer.height
  const endElevation = target.height

  // 观察者高度（人眼离地高度），默认1.7米
  const OBSERVER_HEIGHT = 1.7

  console.log(`[通视分析] 观察点地面高程: ${startElevation.toFixed(1)}m + 人眼高${OBSERVER_HEIGHT}m, 目标点高程: ${endElevation.toFixed(1)}m`)

  // 缓存建筑数据用于检测
  const buildings = cacheBuildingsData()

  // 沿视线采样
  for (let i = 1; i < sampleCount - 1; i++) {
    const t = i / (sampleCount - 1)
    const lng = observer.lng + (target.lng - observer.lng) * t
    const lat = observer.lat + (target.lat - observer.lat) * t

    // 计算视线高度（线性插值，从人眼高度开始到目标点高度）
    const lineOfSightHeight = startElevation + OBSERVER_HEIGHT + (endElevation - startElevation) * t

    try {
      // 获取地形高程
      const positions = [Cesium.Cartographic.fromDegrees(lng, lat)]
      const updatedPositions = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions)
      const terrainHeight = updatedPositions[0]?.height || 0

      // 检查地形遮挡
      let blockHeight = terrainHeight
      let blockType = '地形'

      // 检查建筑物遮挡
      const point = turf.point([lng, lat])
      for (const building of buildings) {
        try {
          // 检查点是否在建筑物多边形内
          if (turf.booleanPointInPolygon(point, building)) {
            // 获取建筑物高度
            const buildingHeight = building.properties?.height || building.properties?.originalHeight || 3
            const buildingTopHeight = terrainHeight + buildingHeight

            // 如果建筑物顶部高于视线，则判定为遮挡
            if (buildingTopHeight > lineOfSightHeight && buildingTopHeight > blockHeight) {
              blockHeight = buildingTopHeight
              blockType = '建筑物'
              console.log(`[通视分析] 发现建筑物遮挡: 高度${buildingTopHeight.toFixed(1)}m > 视线${lineOfSightHeight.toFixed(1)}m`)
            }
          }
        } catch (e) {
          // 跳过无效的建筑几何体
        }
      }

      // 检查是否有遮挡（添加0.3米容差，避免地形数据误差导致误判）
      const TOLERANCE = 0.3  // 容差：小于0.3米的高差不算遮挡
      if (blockHeight > lineOfSightHeight + TOLERANCE) {
        if (!blockPoint || blockHeight > maxBlockHeight) {
          blockPoint = {
            lng,
            lat,
            terrainHeight: blockHeight,
            lineOfSightHeight,
            distance: calculateDistance(observer.lng, observer.lat, lng, lat),
            blockType,
            heightDiff: blockHeight - lineOfSightHeight  // 记录实际高差
          }
          maxBlockHeight = blockHeight
          isVisible = false
        }
      }
    } catch (e) {
      console.warn('[通视分析] 采样失败:', e)
    }
  }

  const distance = calculateDistance(observer.lng, observer.lat, target.lng, target.lat)
  const elevationDiff = endElevation - startElevation

  return {
    isVisible,
    startPoint: observer,
    endPoint: target,
    blockPoint,
    distance: distance,
    elevationDiff: elevationDiff
  }
}

/**
 * 缓存建筑数据用于通视分析
 */
function cacheBuildingsData() {
  const buildings = []
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  
  if (!viewer) return buildings

  // 从所有数据源获取建筑物
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i)
    if (ds.entities) {
      for (const entity of ds.entities.values) {
        if (entity.polygon && entity.polygon.hierarchy) {
          try {
            const hierarchy = entity.polygon.hierarchy.getValue()
            if (hierarchy && hierarchy.positions && hierarchy.positions.length >= 3) {
              // 转换为GeoJSON多边形
              const coordinates = []
              for (const pos of hierarchy.positions) {
                const cartographic = Cesium.Cartographic.fromCartesian(pos)
                coordinates.push([
                  Cesium.Math.toDegrees(cartographic.longitude),
                  Cesium.Math.toDegrees(cartographic.latitude)
                ])
              }
              
              const polygon = turf.polygon([coordinates])
              polygon.properties = {
                height: entity.properties?.originalHeight?.getValue?.() || 15,
                originalHeight: entity.properties?.originalHeight?.getValue?.() || 15
              }
              
              buildings.push(polygon)
            }
          } catch (e) {
            // 跳过无效的建筑几何体
          }
        }
      }
    }
  }

  console.log(`[通视分析] 缓存了 ${buildings.length} 个建筑物用于遮挡检测`)
  return buildings
}

/**
 * 计算两点间距离（米）
 */
function calculateDistance(lng1, lat1, lng2, lat2) {
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

/**
 * 获取地形高度
 */
async function getTerrainHeight(longitude, latitude, viewer) {
  const positions = [Cesium.Cartesian3.fromRadians(longitude, latitude)]
  try {
    const updatedPositions = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions)
    return updatedPositions[0]?.height || 0
  } catch (error) {
    console.warn('[通视分析] 获取地形高度失败:', error)
    return 0
  }
}

/**
 * 绘制通视分析结果
 */
function drawVisibilityResult(result) {
  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (!viewer || visibilityPoints.value.length < 2) return

  const observerPos = visibilityPoints.value[0].position
  const targetPos = visibilityPoints.value[1].position

  // 清除之前的线段
  if (visibilityLineVisible) {
    viewer.entities.remove(visibilityLineVisible)
    visibilityLineVisible = null
  }
  if (visibilityLineBlocked) {
    viewer.entities.remove(visibilityLineBlocked)
    visibilityLineBlocked = null
  }
  if (visibilityBlockPointEntity) {
    viewer.entities.remove(visibilityBlockPointEntity)
    visibilityBlockPointEntity = null
  }

  if (result.isVisible) {
    // 完全通视，绘制绿色线段
    visibilityLineVisible = viewer.entities.add({
      polyline: {
        positions: [observerPos, targetPos],
        width: 3,
        material: Cesium.Color.GREEN,
        clampToGround: false
      }
    })
  } else {
    // 有遮挡，绘制绿色可见部分和红色被遮挡部分
    if (result.blockPoint) {
      const blockPos = Cesium.Cartesian3.fromDegrees(result.blockPoint.lng, result.blockPoint.lat)
      
      // 绘制可见部分（绿色）
      visibilityLineVisible = viewer.entities.add({
        polyline: {
          positions: [observerPos, blockPos],
          width: 3,
          material: Cesium.Color.GREEN,
          clampToGround: false
        }
      })

      // 绘制被遮挡部分（红色）
      visibilityLineBlocked = viewer.entities.add({
        polyline: {
          positions: [blockPos, targetPos],
          width: 3,
          material: Cesium.Color.RED,
          clampToGround: false
        }
      })

      // 添加遮挡点标记
      visibilityBlockPointEntity = viewer.entities.add({
        position: blockPos,
        point: {
          pixelSize: 10,
          color: Cesium.Color.ORANGE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: '遮挡点',
          font: '10pt sans-serif',
          pixelOffset: new Cesium.Cartesian2(0, -25),
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        }
      })
    }
  }
}

/**
 * 清除通视分析
 */
function clearVisibility() {
  visibilityPoints.value = []
  visibilityResult.value = null

  const map = mapRef.value
  const viewer = map?.getViewer?.()
  if (!viewer) return

  // 移除所有通视分析相关的实体
  const entitiesToRemove = []
  for (const entity of viewer.entities.values) {
    if (entity.properties?.type?.getValue?.() === 'visibilityMarker') {
      entitiesToRemove.push(entity)
    }
  }

  // 移除线段实体
  if (visibilityLineVisible) {
    entitiesToRemove.push(visibilityLineVisible)
    visibilityLineVisible = null
  }
  if (visibilityLineBlocked) {
    entitiesToRemove.push(visibilityLineBlocked)
    visibilityLineBlocked = null
  }
  if (visibilityBlockPointEntity) {
    entitiesToRemove.push(visibilityBlockPointEntity)
    visibilityBlockPointEntity = null
  }

  // 清除实体
  entitiesToRemove.forEach(entity => viewer.entities.remove(entity))

  // 重置引用
  visibilityObserverEntity = null
  visibilityTargetEntity = null
  visibilityBlockPointEntity = null

  console.log('[通视分析] 已清除')
}
</script>

<style scoped>
.map-page {
  display: flex;
  flex-direction: column;
  /* 固定在当前可视区域内，并预留出更多顶部/底部空间，避免出现整体上下滚动 */
  height: calc(70vh - 120px);
  min-height: 540px;
  gap: 0.75rem;
  padding-bottom: 0.2rem; /* 预留一点空间，避免底部内容贴到浏览器/系统状态栏 */
  overflow: hidden;
}

.map-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  gap: 1rem;
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.header-title h2 {
  margin: 0;
  font-size: 1.25rem;
}

.header-status {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  border-radius: 4px;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

/* 菜单容器 */
.map-toolbar-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-end;
}

/* 一级菜单栏 */
.map-toolbar.primary-menu {
  display: flex;
  gap: 0.4rem;
  flex-wrap: nowrap;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  align-items: center;
  justify-content: flex-end;
}

/* 二级菜单栏 */
.map-toolbar.secondary-menu {
  display: flex;
  gap: 0.4rem;
  flex-wrap: nowrap;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  align-items: center;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 6px;
  padding: 0.4rem 0.7rem;
}

.map-toolbar::-webkit-scrollbar {
  display: none;
}

/* 工具栏按钮尺寸 */
.map-toolbar .tool-btn {
  padding: 0.4rem 0.7rem;
  font-size: 0.85rem;
  min-width: auto;
  white-space: nowrap;
  flex-shrink: 0;
}

.map-toolbar .tool-icon {
  font-size: 1rem;
}

.map-toolbar .tool-name {
  font-size: 0.8rem;
}

/* 一级菜单按钮样式 */
.primary-menu-btn {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  border: none;
  font-weight: 500;
  transition: all 0.3s ease;
}

.primary-menu-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.primary-menu-btn.layer-active {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.5);
}

/* 二级菜单按钮样式 */
.secondary-menu-btn {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #93c5fd;
  transition: all 0.3s ease;
}

.secondary-menu-btn:hover {
  background: rgba(59, 130, 246, 0.3);
  transform: translateY(-1px);
}

.secondary-menu-btn.layer-active {
  background: rgba(59, 130, 246, 0.4);
  border-color: rgba(59, 130, 246, 0.6);
  color: #bfdbfe;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

/* 抽屉式菜单样式（三级菜单） */
.analysis-drawer {
  display: flex;
  gap: 0.5rem;
  overflow: hidden;
  width: 0;
  opacity: 0;
  transform: translateX(-20px);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.analysis-drawer.expanded {
  width: auto;
  opacity: 1;
  transform: translateX(0);
}

/* 抽屉内按钮依次出现的动画 */
.analysis-drawer .drawer-item {
  transform: translateX(-30px);
  opacity: 0;
  transition: all 0.3s ease;
  flex-shrink: 0;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
}

.analysis-drawer .drawer-item:hover {
  background: rgba(34, 197, 94, 0.3);
  transform: translateY(-1px);
}

.analysis-drawer .drawer-item.layer-active {
  background: rgba(34, 197, 94, 0.4);
  border-color: rgba(34, 197, 94, 0.6);
  color: #4ade80;
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
}

.analysis-drawer.expanded .drawer-item:nth-child(1) {
  transform: translateX(0);
  opacity: 1;
  transition-delay: 0.05s;
}

.analysis-drawer.expanded .drawer-item:nth-child(2) {
  transform: translateX(0);
  opacity: 1;
  transition-delay: 0.1s;
}

.analysis-drawer.expanded .drawer-item:nth-child(3) {
  transform: translateX(0);
  opacity: 1;
  transition-delay: 0.15s;
}

.analysis-drawer.expanded .drawer-item:nth-child(4) {
  transform: translateX(0);
  opacity: 1;
  transition-delay: 0.2s;
}

/* 三级抽屉（嵌套在二级菜单内） */
.analysis-drawer.sub-drawer {
  width: 0;
  transform: translateX(-20px);
}

.analysis-drawer.sub-drawer.expanded {
  width: auto;
  transform: translateX(0);
}

/* 空间分析主抽屉 - 二级分类按钮 */
.spatial-drawer {
  display: flex;
  gap: 0.5rem;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 6px;
  padding: 0 0.5rem;
}

.spatial-drawer .drawer-item {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.spatial-drawer .drawer-item:hover {
  background: rgba(59, 130, 246, 0.3);
}

.spatial-drawer .drawer-item.layer-active {
  background: rgba(59, 130, 246, 0.5);
  border-color: rgba(59, 130, 246, 0.6);
  color: #60a5fa;
}

/* 三级抽屉内的按钮 */
.sub-drawer {
  background: rgba(15, 23, 42, 0.7);
}

.sub-drawer .drawer-item {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.sub-drawer .drawer-item:hover {
  background: rgba(34, 197, 94, 0.3);
}

.sub-drawer .drawer-item.layer-active {
  background: rgba(34, 197, 94, 0.5);
  border-color: rgba(34, 197, 94, 0.6);
  color: #4ade80;
}

/* 测量工具主按钮样式 */
.measure-main-btn,
.spatial-main-btn {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  border: none;
  font-weight: 500;
  transition: all 0.3s ease;
}

.measure-main-btn:hover,
.spatial-main-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.measure-main-btn.layer-active,
.spatial-main-btn.layer-active {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.5);
}

/* 空间分析下拉菜单样式 */
.dropdown-menu {
  position: relative;
}

.spatial-analysis-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.dropdown-arrow {
  font-size: 0.7rem;
  margin-left: 0.25rem;
  transition: transform 0.2s ease;
}

.dropdown-arrow.open {
  transform: rotate(180deg);
}

.dropdown-content {
  position: absolute;
  top: 0;
  left: calc(100% + 5px);
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  z-index: 1000;
  padding: 0.5rem;
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  white-space: nowrap;
}

/* 测量工具菜单 - 向右展开 */
.measure-dropdown .dropdown-content {
  top: 0;
  left: calc(100% + 5px);
  flex-direction: column;
  min-width: 120px;
}

.submenu {
  position: relative;
  margin-right: 0.5rem;
}

.submenu:last-child {
  margin-right: 0;
}

.submenu-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  color: #374151;
  transition: background-color 0.2s;
  white-space: nowrap;
}

.submenu-header:hover {
  background-color: #f3f4f6;
}

.submenu-arrow {
  font-size: 0.7rem;
  transition: transform 0.2s ease;
}

.submenu-arrow.open {
  transform: rotate(-90deg);
}

/* 子菜单内容 - 向右展开 */
.submenu-content {
  position: absolute;
  top: 0;
  left: calc(100% + 5px);
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  min-width: max-content;
  z-index: 1001;
}

.submenu-content.horizontal {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0.5rem;
}

.submenu-content.horizontal .tool-btn,
.submenu-content .tool-btn {
  flex-shrink: 0;
  width: auto;
  min-width: 80px;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  white-space: nowrap;
  border: none;
  background: transparent;
}

.submenu-content .tool-btn:hover {
  background: #f3f4f6;
}

.submenu-content .tool-btn.layer-active {
  background: #dbeafe;
  color: #1d4ed8;
}

/* 横向下拉内容 - 空间分析主菜单 */
.dropdown-content.horizontal {
  top: 0;
  left: calc(100% + 5px);
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  padding: 0.75rem;
  min-width: auto;
  max-width: none;
  overflow-x: visible;
}

.dropdown-content.horizontal .submenu.horizontal {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 120px;
}

.dropdown-content.horizontal .submenu-header {
  justify-content: space-between;
  background: #f1f5f9;
  font-size: 0.85rem;
  padding: 0.4rem 0.6rem;
}

.submenu-content .tool-btn {
  width: 100%;
  justify-content: flex-start;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  border: none;
  background: transparent;
}

.submenu-content .tool-btn:hover {
  background: #f3f4f6;
}

.submenu-content .tool-btn.layer-active {
  background: #dbeafe;
  color: #1d4ed8;
}

/* 独立浮动面板样式 */
.panel-float {
  position: absolute;
  top: 3.5rem;
  right: 1rem;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  padding: 0.75rem;
  min-width: 220px;
  z-index: 100;
  backdrop-filter: blur(10px);
}

.panel-float h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  color: #e5e7eb;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  padding-bottom: 0.5rem;
}

.panel-float .setting-item {
  margin-bottom: 0.75rem;
}

.panel-float .setting-item label {
  display: block;
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 0.25rem;
}

.panel-float .setting-item select,
.panel-float .setting-item input {
  width: 100%;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 4px;
  color: #e5e7eb;
}

.panel-float .coord-inputs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.panel-float .coord-inputs input {
  flex: 1;
  min-width: 80px;
}

.panel-float .time-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.panel-float .time-checkboxes label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #94a3b8;
}

.panel-float .time-checkboxes input[type="checkbox"] {
  width: auto;
}

.panel-float .apply-btn,
.panel-float .pick-btn {
  width: 100%;
  padding: 0.4rem 0.75rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}

.panel-float .pick-btn {
  width: auto;
  flex: 0 0 auto;
  background: #64748b;
}

.panel-float .apply-btn:hover {
  background: #2563eb;
}

.panel-float .pick-btn:hover {
  background: #475569;
}

/* 热力图图例样式 */
.heatmap-legend {
  top: 4rem;
  right: 1rem;
  min-width: 120px;
}

.heatmap-legend .legend-gradient {
  height: 15px;
  background: linear-gradient(to right, blue, cyan, yellow, red);
  border-radius: 3px;
  margin: 0.5rem 0;
}

.heatmap-legend .legend-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #94a3b8;
}

.tool-btn {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #e5e7eb;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  transition: all 0.2s;
}

.tool-btn.layer-active {
  background: rgba(37, 99, 235, 0.25);
  border-color: #3b82f6;
  color: #eff6ff;
}

.tool-btn:hover {
  background: rgba(37, 99, 235, 0.3);
  border-color: #3b82f6;
}

.map-main {
  flex: 1;
  position: relative;
  border-radius: 0.75rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  min-height: 600px;
  min-width: 800px;
  height: auto;
}

.map-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  min-width: 400px;
  min-height: 300px;
}

/* 热力图图例 */
.heatmap-legend {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(30, 30, 50, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  padding: 12px 16px;
  z-index: 1000;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
}

.legend-title {
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 8px;
  text-align: center;
}

.legend-bar {
  width: 160px;
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(to right,
    #a50026 0%,
    #a50026 16%,
    #ff7f00 16%,
    #ff7f00 33%,
    #ffff00 33%,
    #ffff00 50%,
    #00ff00 50%,
    #00ff00 66%,
    #00bfff 66%,
    #00bfff 83%,
    #0000ff 83%,
    #0000ff 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.legend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: #94a3b8;
}

/* 现代化图层控制面板 */
.layer-control {
  position: fixed;
  top: 160px;
  right: 20px;
  z-index: 1000;
}

.layer-toggle-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  color: #e5e7eb;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

.layer-toggle-btn:hover {
  background: rgba(30, 41, 59, 0.95);
  border-color: rgba(148, 163, 184, 0.5);
  transform: translateY(-2px);
}

.layer-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 320px;
  max-height: 500px;
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px);
  transform: translateX(100%);
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.layer-control.open .layer-panel {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
}

/* 灾情管理面板 */
.disaster-panel-container {
  position: fixed;
  top: 160px;
  right: 20px;
  z-index: 1000;
  width: 320px;
  max-height: calc(100vh - 200px);
  background: rgba(26, 26, 46, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px);
  transform: translateX(120%);
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
}

.disaster-panel-container.open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
}

/* 设施选址模拟面板 */
.site-selection-panel {
  position: fixed;
  top: 160px;
  right: 20px;
  width: 380px;
  max-height: calc(100vh - 200px);
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  z-index: 100;
  transform: translateX(420px);
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.site-selection-panel.open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e5e7eb;
}

.panel-header .close-btn {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.panel-header .close-btn:hover {
  background: rgba(148, 163, 184, 0.2);
  color: #e5e7eb;
}

.panel-content {
  padding: 12px 14px;
  max-height: 400px;
  overflow-y: auto;
}

.layer-section {
  margin-bottom: 12px;
}

.layer-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #cbd5f5;
}

.legend-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #cbd5f5;
}

.layer-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.layer-item:hover {
  background: rgba(30, 41, 59, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
}

.layer-item.inactive {
  opacity: 0.5;
}

.layer-color {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
}

.layer-name {
  flex: 1;
  font-size: 14px;
  color: #e5e7eb;
}

.layer-toggle {
  flex-shrink: 0;
}

.toggle-switch {
  width: 36px;
  height: 20px;
  background: rgba(148, 163, 184, 0.3);
  border-radius: 10px;
  position: relative;
  transition: all 0.2s ease;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #9ca3af;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.toggle-switch.active {
  background: rgba(34, 197, 94, 0.3);
}

.toggle-switch.active::after {
  background: #22c55e;
  transform: translateX(16px);
}

.heatmap-legend {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.heatmap-legend h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #cbd5f5;
}

.legend-gradient {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gradient-bar {
  height: 20px;
  background: linear-gradient(to right, #313695, #4575b4, #74add1, #abd9e9, #e0f3f8, #ffffbf, #fee090, #fdae61, #f46d43, #d73027, #a50026);
  border-radius: 4px;
}

.gradient-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #9ca3af;
}

/* 滚动条样式 */
.panel-content::-webkit-scrollbar {
  width: 6px;
}

.panel-content::-webkit-scrollbar-track {
  background: rgba(148, 163, 184, 0.1);
  border-radius: 3px;
}

.panel-content::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.3);
  border-radius: 3px;
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5);
}


.heatmap-legend h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  color: #e2e8f0;
}

.legend-gradient {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.gradient-bar {
  width: 100%;
  height: 12px;
  background: linear-gradient(to right, #0000ff, #00bfff, #00ff00, #ffff00, #ff7f00, #a50026);
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.gradient-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #94a3b8;
}

.coverage-panel {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.analysis-loading {
  margin-bottom: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.12);
  color: #93c5fd;
  font-size: 0.75rem;
}

.coverage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.coverage-row label {
  font-size: 0.75rem;
  color: #cbd5e1;
}

.coverage-select {
  min-width: 110px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.5);
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 0.75rem;
  padding: 0.2rem 0.35rem;
}

.coverage-stats {
  margin-top: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px dashed rgba(148, 163, 184, 0.35);
  display: grid;
  gap: 0.2rem;
  font-size: 0.73rem;
  color: #e2e8f0;
}

.coverage-loading {
  margin-top: 0.4rem;
  padding: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #93c5fd;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.iso-top-arrival {
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(30, 41, 59, 0.45);
  cursor: pointer;
}

.iso-top-arrival:hover {
  border-color: rgba(59, 130, 246, 0.7);
  background: rgba(30, 41, 59, 0.65);
}

.iso-top-main {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

.iso-top-rank {
  color: #93c5fd;
  font-weight: 700;
}

.iso-top-name {
  color: #e2e8f0;
  font-weight: 650;
}

.iso-top-sub {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.2rem;
  color: #cbd5f5;
  font-size: 0.7rem;
}

.coverage-legend {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.1rem;
  margin-bottom: 0.1rem;
  font-size: 0.72rem;
  color: #e2e8f0;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  border: 1px solid rgba(255, 255, 255, 0.7);
}

.legend-dot.covered {
  background: #16a34a;
}

.legend-dot.uncovered {
  background: #dc2626;
}

.coverage-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.coverage-tag {
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.45);
  color: #cbd5e1;
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 0.16rem 0.5rem;
  cursor: pointer;
}

.coverage-tag.active {
  border-color: rgba(59, 130, 246, 0.9);
  color: #eff6ff;
  background: rgba(37, 99, 235, 0.65);
}

.type-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  margin: 0.2rem 0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.8rem;
}

.type-option:hover {
  background: rgba(100, 116, 139, 0.3);
}

.type-option.active {
  background: rgba(59, 130, 246, 0.3);
  border: 1px solid rgba(59, 130, 246, 0.5);
}

.type-icon {
  font-size: 0.9rem;
}

.type-name {
  color: #e2e8f0;
  font-weight: 500;
}

/* ========== 导出按钮样式 ========== */

.panel-header-with-export {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.panel-header-with-export h4 {
  margin: 0;
  flex: 1;
}

.export-buttons {
  display: flex;
  gap: 0.35rem;
}

.export-btn {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
  color: #e2e8f0;
}

.export-btn:hover {
  background: rgba(59, 130, 246, 0.4);
  border-color: rgba(59, 130, 246, 0.6);
}

/* 热力图导出按钮 */
.legend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.export-buttons-small {
  display: flex;
  gap: 0.25rem;
}

.export-btn-small {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 4px;
  padding: 0.15rem 0.35rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s ease;
  color: #e2e8f0;
}

.export-btn-small:hover {
  background: rgba(59, 130, 246, 0.4);
}

/* 视域分析提示 */
.viewshed-hint {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(59, 130, 246, 0.95);
  color: #fff;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* 视域高度控制 */
.viewshed-control {
  position: absolute;
  top: 70px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
  min-width: 180px;
}

.viewshed-control label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 10px;
}

.viewshed-control input[type="range"] {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: #e5e7eb;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.viewshed-control input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.viewshed-control input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #3b82f6;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.viewshed-control .height-markers {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

/* 剖面分析面板 */
.profile-panel {
  position: absolute;
  top: 70px;
  right: 20px;
  width: 300px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.profile-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #3b82f6;
  color: white;
  border-radius: 8px 8px 0 0;
}

.profile-panel .panel-header span {
  font-size: 14px;
  font-weight: 600;
}

.profile-panel .close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: white;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.profile-panel .close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.profile-panel .panel-content {
  padding: 16px;
}

.profile-panel .hint-text {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 15px;
}

.profile-panel .profile-info {
  margin-bottom: 15px;
}

.profile-panel .info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.profile-panel .info-row span:first-child {
  color: #4b5563;
}

.profile-panel .info-row .value {
  font-weight: 600;
  color: #10b981;
}

.profile-panel .profile-chart {
  width: 100%;
  height: 150px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
}

/* 通视分析面板 */
.visibility-panel {
  position: absolute;
  top: 70px;
  right: 20px;
  width: 300px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.visibility-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #3b82f6;
  color: white;
  border-radius: 8px 8px 0 0;
}

.visibility-panel .panel-header span {
  font-size: 14px;
  font-weight: 600;
}

.visibility-panel .close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: white;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.visibility-panel .close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.visibility-panel .panel-content {
  padding: 16px;
}

.visibility-panel .hint-text {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 15px;
}

.visibility-panel .visibility-result {
  margin-bottom: 15px;
}

.visibility-panel .info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.visibility-panel .info-row span:first-child {
  color: #4b5563;
}

.visibility-panel .info-row .value {
  font-weight: 600;
  color: #10b981;
}

.visibility-panel .info-row .value.blocked {
  color: #ef4444;
}

.visibility-panel .legend {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}

.visibility-panel .legend-item {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: #4b5563;
}

.visibility-panel .legend-color {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  margin-right: 8px;
  border: 1px solid #d1d5db;
}

.visibility-panel .visible-color {
  background: #10b981;
}

.visibility-panel .blocked-color {
  background: #ef4444;
}

.visibility-panel .block-point-color {
  background: #f59e0b;
}

.visibility-panel .visibility-info {
  margin-bottom: 15px;
}

.visibility-panel .visibility-status {
  padding: 8px 12px;
  border-radius: 6px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 12px;
}

.visibility-panel .visibility-status.visible {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.visibility-panel .visibility-status.blocked {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.visibility-panel .block-info {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.visibility-panel .visibility-legend {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}

.visibility-panel .legend-item {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: #4b5563;
}

.visibility-panel .legend-line {
  width: 16px;
  height: 3px;
  margin-right: 8px;
  border-radius: 2px;
}
</style>
