<script setup>
import { onMounted, ref, computed, inject, watch } from 'vue'
import axios from 'axios'

const loading = ref(true)
const error = ref('')
const weather = ref({
  city: '',
  weather: '',
  temperature: ''
})

// 注入全局位置状态
// const userLocation = inject('userLocation')

const AMAP_KEY = 'ba90fd503153d5c05bc955178c26ff58'

const weatherIcon = computed(() => {
  const text = (weather.value.weather || '').toLowerCase()

  if (!text) return '🌡'
  if (text.includes('晴')) return '☀'
  if (text.includes('云') || text.includes('阴')) return '☁'
  if (text.includes('雨')) return '☂'
  if (text.includes('雪')) return '❄'
  if (text.includes('雾') || text.includes('霾') || text.includes('沙')) return '🌫'

  return '⛅'
})

const fetchWeather = async (location) => {
  if (!location) {
    error.value = '等待位置信息...'
    loading.value = false
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    const { latitude, longitude } = location
    const locationStr = `${longitude},${latitude}`

    // 1. 逆地理编码获取城市编码（adcode）
    const geoResp = await axios.get('https://restapi.amap.com/v3/geocode/regeo', {
      params: {
        key: AMAP_KEY,
        location: locationStr,
        extensions: 'base'
      }
    })

    const geoInfo = geoResp.data
    if (geoInfo.status !== '1' || !geoInfo.regeocode?.addressComponent) {
      throw new Error('逆地理编码失败')
    }

    const comp = geoInfo.regeocode.addressComponent
    const adcode = comp.adcode
    const cityName = comp.city || comp.district || comp.province || '当前位置'

    // 2. 根据 adcode 获取实时天气
    const weatherResp = await axios.get('https://restapi.amap.com/v3/weather/weatherInfo', {
      params: {
        key: AMAP_KEY,
        city: adcode,
        extensions: 'base'
      }
    })

    const wData = weatherResp.data
    if (wData.status !== '1' || !Array.isArray(wData.lives) || wData.lives.length === 0) {
      throw new Error('天气数据为空')
    }

    const live = wData.lives[0]
    weather.value = {
      city: cityName,
      weather: live.weather || '',
      temperature: live.temperature ? `${live.temperature}℃` : ''
    }
  } catch (e) {
    console.error(e)
    error.value = '天气获取失败'
  } finally {
    loading.value = false
  }
}

// 监听位置变化
// watch(userLocation, (newLocation) => {
//   if (newLocation) {
//     fetchWeather(newLocation)
//   } else {
//     error.value = '请同意位置权限以获取天气信息'
//     loading.value = false
//   }
// }, { immediate: true })

onMounted(() => {
  // 恢复原来的位置获取逻辑
  if (!('geolocation' in navigator)) {
    error.value = '当前浏览器不支持定位'
    loading.value = false
    return
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords
        const location = { latitude, longitude }
        await fetchWeather(location)
      } catch (e) {
        console.error(e)
        error.value = '天气获取失败'
      }
    },
    (err) => {
      console.error(err)
      error.value = '定位失败，请检查浏览器定位权限'
      loading.value = false
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 300000
    }
  )
})
</script>

<template>
  <div class="weather-widget">
    <div v-if="loading" class="weather-line">正在获取天气...</div>
    <div v-else-if="error" class="weather-line weather-error">{{ error }}</div>
    <template v-else>
      <div class="weather-line">
        <span class="weather-icon">{{ weatherIcon }}</span>
        <span class="weather-city">{{ weather.city }}</span>
        <span class="weather-sep">|</span>
        <span class="weather-main">{{ weather.weather }}</span>
        <span v-if="weather.temperature" class="weather-temp">{{ weather.temperature }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.weather-widget {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.85rem;
}

.weather-line {
  white-space: nowrap;
}

.weather-error {
  color: #fecaca;
}

.weather-city {
  font-weight: 600;
}

.weather-icon {
  margin-right: 0.25rem;
}

.weather-sep {
  margin: 0 0.25rem;
}

.weather-main {
  margin-right: 0.25rem;
}

.weather-temp {
  color: #fee2e2;
}
</style>
