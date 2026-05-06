/**
 * PWA图标生成脚本
 * 运行: node generate-icons.mjs
 * 将在 public/ 目录下生成所有尺寸的图标
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 检查是否有 Sharp 库
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.log('正在安装 sharp 库...');
  import('child_process').then(cp => {
    cp.execSync('npm install sharp --save-dev', { stdio: 'inherit' });
  });
  sharp = (await import('sharp')).default;
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = path.join(__dirname, 'public', 'icon.svg');
const outputDir = path.join(__dirname, 'public');

async function generateIcons() {
  console.log('🎨 正在生成 PWA 图标...\n');
  
  // 读取SVG
  const svgBuffer = fs.readFileSync(inputSvg);
  
  for (const size of sizes) {
    const outputFile = path.join(outputDir, `pwa-${size}x${size}.png`);
    
    try {
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(outputFile);
      
      console.log(`✅ pwa-${size}x${size}.png`);
    } catch (err) {
      console.error(`❌ pwa-${size}x${size}.png 生成失败:`, err.message);
    }
  }
  
  console.log('\n🎉 图标生成完成！');
  console.log('📁 图标保存在 public/ 目录下');
  console.log('\n接下来可以运行：');
  console.log('  npm run build');
  console.log('  npm run preview');
}

// 如果没有icon.svg，创建一个默认的
if (!fs.existsSync(inputSvg)) {
  const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6"/>
      <stop offset="100%" style="stop-color:#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)" rx="100"/>
  <circle cx="256" cy="256" r="80" fill="url(#accent)" opacity="0.2"/>
  <circle cx="256" cy="256" r="40" fill="url(#accent)"/>
  <circle cx="256" cy="256" r="120" fill="none" stroke="#3b82f6" stroke-width="4" opacity="0.5"/>
  <circle cx="330" cy="180" r="25" fill="#ef4444"/>
  <text x="330" y="190" text-anchor="middle" fill="white" font-size="28" font-weight="bold">!</text>
  <circle cx="180" cy="330" r="15" fill="#10b981"/>
  <circle cx="330" cy="330" r="15" fill="#f59e0b"/>
</svg>`;
  
  fs.writeFileSync(inputSvg, defaultSvg);
  console.log('📝 已创建默认图标 SVG\n');
}

generateIcons().catch(err => {
  console.error('生成图标失败:', err);
  process.exit(1);
});
