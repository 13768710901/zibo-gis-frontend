# 淄博GIS平台免费部署方案

## 🆓 完全免费部署方案

本指南使用完全免费的云服务部署淄博GIS平台，零成本上线！

## 📋 免费资源清单

### 前端托管
- **Vercel** - 免费额度：100GB带宽/月
- **Netlify** - 免费额度：100GB带宽/月
- **GitHub Pages** - 完全免费

### 后端托管
- **Render** - 免费额度：750小时/月
- **Railway** - 免费额度：$5/月额度
- **Fly.io** - 免费额度：3个应用

### 数据库
- **Supabase** - 免费额度：500MB数据库
- **MongoDB Atlas** - 免费额度：512MB
- **PlanetScale** - 免费额度：5GB存储

### 域名
- **Freenom** - 完全免费域名（.tk、.ml等）
- **使用子域名** - 项目名.github.io

---

## 🚀 推荐方案：Vercel + Render + Supabase

### 方案优势
- **完全免费**：所有服务都有免费额度
- **自动化部署**：Git推送自动部署
- **SSL证书**：自动配置HTTPS
- **监控日志**：内置监控和日志
- **扩展性好**：需要时可以付费升级

---

## 📝 详细部署步骤

### 第一步：准备代码仓库

#### 1. 创建GitHub仓库
```bash
# 在GitHub上创建两个仓库
# 1. zibo-gis-frontend（前端）
# 2. zibo-gis-backend（后端）
```

#### 2. 上传代码
```bash
# 前端代码
cd zibo-gis-web
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/zibo-gis-frontend.git
git push -u origin main

# 后端代码（同样操作）
cd zibo-gis-backend
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/zibo-gis-backend.git
git push -u origin main
```

---

### 第二步：配置数据库（Supabase）

#### 1. 注册Supabase
- 访问 https://supabase.com
- 使用GitHub账号登录
- 创建新项目：`zibo-gis-db`

#### 2. 获取数据库连接信息
- 在项目设置中找到Connection String
- 复制数据库连接字符串
- 格式：`postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres`

#### 3. 创建数据表
在Supabase的SQL Editor中执行：

```sql
-- 创建用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建设施表
CREATE TABLE facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    address VARCHAR(200),
    longitude DECIMAL(10, 7),
    latitude DECIMAL(10, 7),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建灾情表
CREATE TABLE disasters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    consequence_level INTEGER,
    description TEXT,
    location_lat DECIMAL(10, 7),
    location_lng DECIMAL(10, 7),
    images TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 4. 配置后端连接字符串
修改后端的配置文件，使用Supabase连接字符串。

---

### 第三步：部署后端（Render）

#### 1. 注册Render
- 访问 https://render.com
- 使用GitHub账号登录
- 授权访问你的GitHub仓库

#### 2. 创建Web Service
1. 点击 "New +" -> "Web Service"
2. 选择 `zibo-gis-backend` 仓库
3. 配置构建和启动：

**Build Command**:
```bash
dotnet publish -c Release -o out
```

**Start Command**:
```bash
dotnet out/YourBackend.dll
```

#### 3. 配置环境变量
在Render中添加以下环境变量：

```env
ConnectionStrings__DefaultConnection=postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres
ASPNETCORE_URLS=http://0.0.0.0:5000
```

#### 4. 部署
- 点击 "Create Web Service"
- 等待构建完成（约2-3分钟）
- 获取后端URL：`https://your-backend.onrender.com`

---

### 第四步：部署前端（Vercel）

#### 1. 注册Vercel
- 访问 https://vercel.com
- 使用GitHub账号登录
- 授权访问你的GitHub仓库

#### 2. 导入项目
1. 点击 "Add New..." -> "Project"
2. 选择 `zibo-gis-frontend` 仓库
3. 配置项目设置：

**Framework Preset**: Vite
**Build Command**: `npm run build`
**Output Directory**: `dist`

#### 3. 配置环境变量
在Vercel中添加环境变量：

```env
VITE_API_BASE_URL=https://your-backend.onrender.com/api
```

#### 4. 部署
- 点击 "Deploy"
- 等待构建完成（约1-2分钟）
- 获取前端URL：`https://your-frontend.vercel.app`

---

### 第五步：配置域名（可选）

#### 方案A：使用免费域名（Freenom）

1. 访问 https://www.freenom.com
2. 注册账号
3. 搜索免费域名（.tk、.ml、.ga等）
4. 购买（免费）
5. 配置DNS解析：

**Vercel域名配置**：
- 在Vercel项目设置中添加域名
- Vercel会提供DNS记录
- 在Freenom中添加这些DNS记录

**Render域名配置**：
- 在Render项目设置中添加自定义域名
- 同样配置DNS记录

#### 方案B：使用子域名（最简单）
- 前端：`your-username.github.io`
- 后端：使用Render提供的默认域名

---

## 🔧 配置调整

### 1. 前端配置

修改 `.env.production`：
```env
VITE_API_BASE_URL=https://your-backend.onrender.com/api
```

### 2. 后端配置

修改 `appsettings.json`：
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres"
  },
  "AllowedHosts": "*"
}
```

### 3. CORS配置

在后端中配置CORS，允许前端域名：

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowVercel", policy =>
    {
        policy.WithOrigins("https://your-frontend.vercel.app")
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});
```

---

## 🧪 测试部署

### 1. 测试后端
```bash
# 测试API
curl https://your-backend.onrender.com/api/health

# 测试登录
curl -X POST https://your-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

### 2. 测试前端
- 访问 `https://your-frontend.vercel.app`
- 测试登录功能
- 测试地图加载
- 测试灾情上报

### 3. 测试移动端
- 使用手机浏览器访问
- 验证路由限制
- 测试灾情上报功能

---

## 📊 免费额度监控

### Vercel免费额度
- 100GB带宽/月
- 无限构建
- 自动SSL
- 全球CDN

### Render免费额度
- 750小时/月（足够运行一个应用）
- 自动休眠（无流量时）
- SSL证书
- 日志保留

### Supabase免费额度
- 500MB数据库
- 1GB文件存储
- 2GB带宽/月
- 50,000次API调用/月

---

## ⚠️ 免费方案限制

### Render限制
- 应用无流量15分钟后休眠
- 首次访问需要冷启动（约30秒）
- 免费额度用完后需要付费

### Supabase限制
- 数据库大小限制500MB
- API调用次数限制
- 不支持备份功能

### Vercel限制
- 构建时间限制
- 带宽限制100GB/月

---

## 🚀 优化建议

### 1. 减少冷启动时间
- 使用Render的Spin功能（付费）
- 或使用Railway（冷启动更快）

### 2. 数据库优化
- 定期清理无用数据
- 使用索引优化查询
- 压缩图片文件

### 3. 前端优化
- 启用代码分割
- 使用CDN加速
- 压缩静态资源

---

## 🔄 更新部署

### 自动部署
- 推送代码到GitHub
- Vercel和Render自动检测并部署
- 无需手动操作

### 手动触发
- 在Vercel控制台点击 "Redeploy"
- 在Render控制台点击 "Manual Deploy"

---

## 📞 故障排查

### 1. 后端无法启动
- 检查环境变量配置
- 查看Render日志
- 确认数据库连接正常

### 2. 前端无法访问后端
- 检查CORS配置
- 确认API地址正确
- 查看浏览器控制台错误

### 3. 数据库连接失败
- 检查连接字符串
- 确认Supabase项目状态
- 验证网络连接

---

## 🎉 完成清单

- [ ] 创建GitHub仓库
- [ ] 上传前后端代码
- [ ] 注册Supabase并创建数据库
- [ ] 在Render部署后端
- [ ] 在Vercel部署前端
- [ ] 配置环境变量
- [ ] 配置CORS
- [ ] 测试所有功能
- [ ] 配置域名（可选）
- [ ] 设置自动部署

---

## 💰 成本总结

### 完全免费方案
- **前端托管**：Vercel（免费）
- **后端托管**：Render（免费）
- **数据库**：Supabase（免费）
- **域名**：Freenom（免费）或子域名（免费）
- **SSL证书**：自动配置（免费）

**总成本：$0/月**

### 付费升级建议
如果免费额度不够，可以按需升级：
- Render：$7/月起
- Supabase：$25/月起
- Vercel：$20/月起
- 域名：$10/年起

---

## 📚 参考资源

- Vercel文档：https://vercel.com/docs
- Render文档：https://render.com/docs
- Supabase文档：https://supabase.com/docs
- 免费域名：https://www.freenom.com

按照这个指南，你可以完全免费地部署淄博GIS平台，适合个人项目或演示使用！
