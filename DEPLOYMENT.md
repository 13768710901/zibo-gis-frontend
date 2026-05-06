# 淄博GIS平台部署指南

## 📋 部署前准备

### 1. 环境要求
- Node.js >= 18.0.0
- npm >= 9.0.0
- 现代浏览器（Chrome/Firefox/Edge/Safari）
- 后端API服务已部署

### 2. 依赖安装
```bash
npm install
```

## 🚀 生产环境部署

### 1. 配置环境变量

编辑 `.env.production` 文件，设置生产环境API地址：

```env
VITE_API_BASE_URL=https://your-backend-domain.com/api
```

### 2. 构建生产版本

```bash
npm run build
```

构建完成后，`dist` 目录包含所有生产文件。

### 3. 部署到服务器

#### 方案A：Nginx部署（推荐）

1. 将 `dist` 目录内容上传到服务器
2. 配置Nginx：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    root /var/www/zibo-gis-web/dist;
    index index.html;
    
    # SPA路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # API代理
    location /api {
        proxy_pass https://your-backend-domain.com/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Cesium资源
    location /cesium {
        alias /var/www/zibo-gis-web/dist/cesium;
    }
    
    # Gzip压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

#### 方案B：静态托管服务

支持部署到：
- Vercel
- Netlify  
- GitHub Pages
- 阿里云OSS

### 4. HTTPS配置（推荐）

使用Let's Encrypt免费SSL证书：

```bash
sudo certbot --nginx -d your-domain.com
```

## 📱 移动端配置

### 移动端功能限制

移动端用户只能访问以下功能：
- 登录/注册
- 灾情上报

其他功能（地图分析、设施管理等）仅限桌面端访问。

### 移动端检测逻辑

系统通过以下方式检测移动设备：
1. User-Agent检测
2. 屏幕宽度检测（≤768px）
3. 触摸屏支持检测

### PWA支持

项目已配置PWA，支持：
- 离线访问
- 添加到主屏幕
- 推送通知（需后端支持）

## 🔧 部署后检查清单

- [ ] 环境变量配置正确
- [ ] API连接正常
- [ ] 地图加载正常
- [ ] 灾情上报功能测试
- [ ] 移动端访问测试
- [ ] HTTPS证书配置
- [ ] 性能优化（Gzip、缓存）
- [ ] 监控和日志配置

## 📊 性能优化建议

### 1. CDN加速
- 将静态资源上传到CDN
- 配置Cesium瓦片CDN

### 2. 缓存策略
- 启用浏览器缓存
- 配置Service Worker缓存

### 3. 图片优化
- 使用WebP格式
- 压缩图片大小

## 🐛 常见问题

### 1. 地图加载失败
- 检查Cesium Ion Token
- 确认网络连接
- 检查CORS配置

### 2. API请求失败
- 检查后端服务状态
- 确认API地址配置
- 检查防火墙设置

### 3. 移动端样式问题
- 检查viewport配置
- 测试不同设备
- 检查安全区域适配

## 📞 技术支持

如遇到部署问题，请检查：
1. 浏览器控制台错误信息
2. 网络请求状态
3. 服务器日志

## 🔄 更新部署

每次更新后：
```bash
npm run build
# 上传dist目录到服务器
# 重启Nginx（如需要）
nginx -s reload
```
