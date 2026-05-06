<script setup>
import { onMounted, ref } from 'vue'
import axios from 'axios'

defineProps({
  msg: String,
})

const facilities = ref([])
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  loading.value = true
  try {
    // TODO: 如果端口不同，请将下面的地址改成你后端实际运行地址
    const res = await axios.get('/api/facilities')
    facilities.value = res.data
  } catch (e) {
    console.error(e)
    error.value = '加载设施数据失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h1>{{ msg }}</h1>

    <div class="card">
      <p v-if="loading">正在加载设施数据...</p>
      <p v-else-if="error">{{ error }}</p>
      <ul v-else>
        <li v-for="f in facilities" :key="f.id">
          {{ f.name }}（{{ f.type }}）- {{ f.lon }}, {{ f.lat }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.card {
  margin-top: 1rem;
}

ul {
  padding-left: 1.25rem;
}

li {
  margin-bottom: 0.25rem;
}
</style>
