# 日本电力期货数据日报 · Netlify 部署包（华泰期货）

一个可直接部署到 **Netlify** 的**公网公开**网页，采用**华泰期货研究报告风格**
（顶部 Logo + 机构署名 + 左侧目录 + 五大板块单页报告布局），用于在线查看
日本电力期货（JEPX）数据统计，并具备**每日自动更新**机制。解压后即可通过
Netlify「拖拽部署」或「连接 Git 仓库」直接上线。

视觉与模块分类参考：华泰期货研究报告页（顶栏 Logo、市场概览 / 重点合约 / 新闻 /
交易逻辑 / 关注事项 五大板块）。

## 目录结构
```
netlify-deploy/
├── netlify.toml              # Netlify 配置：构建命令 + 发布目录 + 公开重定向
├── _redirects                # （在 src/ 内，构建后进入 dist）单页回退，公开访问
├── package.json              # 构建脚本
├── build.js                  # 构建：src/ + data/ → dist/
├── seed.js                   # 生成示例数据（首次部署用）
├── src/                      # 前端源码（华泰期货报告风格）
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── assets/logo.png        # 华泰期货 Logo
│   └── _redirects
├── data/                     # 数据（latest.json / history.json），每日被更新覆盖
├── automation/               # 每日自动更新 Python 脚本（见 automation/README.md）
│   ├── japan_power_futures_updater.py
│   ├── config.yaml
│   ├── requirements.txt
│   ├── install_cron.sh
│   ├── install_task_scheduler.ps1
│   └── 日本电力期货数据展示网页_方案说明.md
├── .github/workflows/        # GitHub Actions 每日更新（推送触发 Netlify 部署）
│   └── daily-update.yml
└── README.md
```

## 一键部署到 Netlify

### 方式一：拖拽部署（最快，无需 Git）
1. 解压本包。
2. 打开 https://app.netlify.com/drop
3. 拖入 **`dist/` 文件夹**（已预构建；若需重新构建先跑 `npm install && npm run build`）。
4. 站点立即获得一个公网 HTTPS 地址，**默认公开访问**。

### 方式二：连接 Git 仓库（推荐，支持每日自动更新）
1. 将本包内容推送到 GitHub / GitLab 仓库。
2. 在 Netlify 选择「Import from Git」导入该仓库。
3. Netlify 按 `netlify.toml` 自动识别：
   - **Build command**：`npm run build`
   - **Publish directory**：`dist`
4. 部署完成后获得公网地址。
5. 启用每日更新：本仓库已内置 GitHub Actions（`.github/workflows/daily-update.yml`），
   每天 09:30 自动更新 `data/` 并推送，Netlify 监听到 push 即**自动重新部署**。

> 若使用 GitLab / Bitbucket，可改用对应 CI 执行 `automation/` 下的更新脚本并推送；
> 或直接在本机用 `automation/install_cron.sh`（Linux/macOS）做每日更新 + 定时 `git push`。

## 配置说明（netlify.toml 要点）
```toml
[build]
  command = "npm run build"   # 打包前端与数据到 dist/
  publish = "dist"            # 发布目录

# 默认即为公网公开访问；以下重定向仅用于强制 HTTPS（可选）
[[redirects]]
  from = "http://:splat"
  to = "https://:splat"
  status = 301
  force = true
```
`_redirects`（`src/_redirects` → `dist/_redirects`）实现单页回退 `/* /index.html 200`，同样无需鉴权。

## 本地预览
```bash
npm install
npm run seed     # 生成示例数据到 data/
npm run build    # 构建到 dist/
# 用任意静态服务器预览，例如：
npx serve dist
```

## 数据来源与每日更新
- 数据源：腾讯自选股-金融数据查询、东方财富妙想（详见 `automation/`）。
- 更新流：每日 09:30 脚本拉取 → 写入 `data/` → 构建发布到 `dist/data/` → 网页刷新。
- 网页读取 `./data/latest.json` 与 `./data/history.json` 渲染看板与趋势图。

## 说明
本平台仅用于数据展示与统计分析，不构成投资建议；数据以公开/授权来源为准。
