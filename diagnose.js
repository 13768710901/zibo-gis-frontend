const fs = require('fs');
const path = require('path');

const viewsDir = path.join(process.cwd(), 'src/views');

console.log('=== Vue 文件结构诊断 ===\n');

const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.vue'));

files.forEach(file => {
  const filePath = path.join(viewsDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  console.log(`\n检查: ${file}`);
  
  // 检查第一行
  const firstLine = lines[0].trim();
  if (firstLine.startsWith('<template')) {
    console.log('  ✓ 以 <template> 开头');
  } else if (firstLine.startsWith('<script')) {
    console.log('  ✗ 以 <script> 开头 - 结构错误!');
  } else {
    console.log(`  ? 以 "${firstLine.substring(0, 30)}" 开头`);
  }
  
  // 检查必要的标签
  const hasTemplate = content.includes('<template>');
  const hasScript = content.includes('<script');
  const hasStyle = content.includes('<style');
  const hasTemplateEnd = content.includes('</template>');
  const hasScriptEnd = content.includes('</script>');
  
  console.log(`  template: ${hasTemplate ? '✓' : '✗'}, script: ${hasScript ? '✓' : '✗'}, style: ${hasStyle ? '✓' : '✗'}`);
  console.log(`  </template>: ${hasTemplateEnd ? '✓' : '✗'}, </script>: ${hasScriptEnd ? '✓' : '✗'}`);
  
  // 检查 i18n 残留
  const i18nCount = (content.match(/\$t\(/g) || []).length;
  const useI18nCount = (content.match(/useI18n/g) || []).length;
  if (i18nCount > 0 || useI18nCount > 0) {
    console.log(`  ⚠️ i18n残留: $t(${i18nCount}次), useI18n(${useI18nCount}次)`);
  }
});

console.log('\n=== 路由配置诊断 ===\n');

const routerPath = path.join(process.cwd(), 'src/router/index.js');
if (fs.existsSync(routerPath)) {
  const routerContent = fs.readFileSync(routerPath, 'utf-8');
  
  if (routerContent.includes('createWebHashHistory')) {
    console.log('✓ 使用 createWebHashHistory - 正确');
  } else if (routerContent.includes('createWebHistory')) {
    console.log('✗ 使用 createWebHistory - 可能导致需要刷新');
  }
  
  // 检查所有路由路径
  const routeMatches = routerContent.match(/path:\s*['"]([^'"]+)['"]/g) || [];
  console.log(`\n路由路径 (${routeMatches.length}个):`);
  routeMatches.slice(0, 10).forEach(m => console.log(`  ${m}`));
}

console.log('\n=== 诊断完成 ===');
