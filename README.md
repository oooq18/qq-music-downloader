# 🎵 QQ 音乐下载器（网页版）

搜索 QQ 音乐歌曲，选择音质（FLAC 无损 / 320kbps / 128kbps），一键下载到本地。

## 功能

- 🔍 搜索歌曲 / 歌手，展示歌名、歌手、专辑、时长、各音质文件大小
- 🎚️ 三档音质下载：FLAC 无损、320kbps、128kbps（无版权的音质自动标注"暂无"）
- 📊 实时下载进度条，完成后自动保存到本地
- 🌙 深色 QQ 绿主题，桌面 / 移动端自适应

## 目录结构

```
qq-music-downloader/
├── index.html      # 前端页面
├── style.css       # 前端样式
├── app.js          # 前端逻辑
├── config.js       # 后端 API 地址配置
├── server.js       # Node.js 后端（搜索 + 加密下载协议）
├── package.json
└── .env.example    # 登录态配置示例（复制为 .env 使用）
```

## 本地运行

```bash
npm install
cp .env.example .env    # 填入你的 QQ 音乐登录态
npm start               # 打开 http://localhost:3000
```

> 后端已托管前端静态文件，本地一条命令即可全栈运行。

## 免费部署到线上（GitHub Pages + Render）

本应用有 Node.js 后端（QQ 音乐下载协议必须在服务端运行），**GitHub Pages 只能托管静态页面**，因此分两步部署：

### 1. 前端 → GitHub Pages（免费）

1. 把本仓库 fork 到你的账号（或直接用你的仓库）
2. 仓库 Settings → Pages → Source 选 `main` 分支、根目录 → Save
3. 稍等几分钟，前端界面即可通过 `https://<你的用户名>.github.io/<仓库名>/` 访问

### 2. 后端 → Render（免费 Node 服务）

1. 登录 [render.com](https://render.com)（GitHub 登录即可）
2. New → Web Service → 连接本仓库
3. 设置：
   - Build Command：`npm install`
   - Start Command：`npm start`
   - 添加环境变量：`QQ` 和 `AUTHST`（你的 QQ 音乐登录态）
4. 部署完成后拿到服务地址，例如 `https://xxx.onrender.com`
5. 修改前端 `config.js`：
   ```js
   const API_BASE = "https://xxx.onrender.com";
   ```
6. 重新提交，GitHub Pages 上的页面就会调用你的后端，全功能可用

## 登录态说明

- 登录态（QQ 号 + 密钥）是你的 QQ 音乐会员凭证，**只应放在后端环境变量或本地 `.env` 中，绝不要提交到代码仓库**（`.env` 已在 `.gitignore` 中）
- 登录态会过期。失效时后端会提示"登录态已失效"，重新登录 QQ 音乐网页版后从 Cookie 提取 `qqmusic_key` 更新即可

## 免责声明

本工具仅供个人学习研究使用，请支持正版音乐。
