# 自动化更新模块（每日 09:30）

本目录包含「每日自动更新数据」的 Python 脚本，配合 Netlify 实现 **数据每日刷新 + 公网展示**。

## 它做什么
1. 读取 `日本电力期货数据展示网页_方案说明.md`，确认要统计的指标
   （最新结算价、当日涨跌、成交量、持仓量、市场热度）。
2. 调用两个金融数据技能拉取数据：
   - **腾讯自选股-金融数据查询**（westockdata）
   - **金融数据-东方财富妙想**（mx-finance-data）
3. 清洗聚合后写入仓库根目录 `../data/latest.json` 与 `../data/history.json`。
4. Netlify 构建（`build.js`）会把 `data/` 复制进 `dist/data/`，随站点发布。

## 触发方式（任选其一）

### 方式 A：GitHub Actions（推荐，与 Netlify 联动）
仓库已包含 `.github/workflows/daily-update.yml`，每天 09:30（北京时间）自动运行，
把新数据 push 回仓库，Netlify 收到推送后**自动重新部署**。
- 在 GitHub 仓库 `Settings → Secrets` 无需额外密钥（公开仓库即可）。
- 手动触发：仓库 `Actions → 每日更新日本电力期货数据 → Run workflow`。

### 方式 B：本机 / 服务器定时（crontab / 任务计划程序）
```bash
# Linux / macOS
bash install_cron.sh

# Windows（管理员 PowerShell）
.\install_task_scheduler.ps1
```
运行后，脚本每天 09:30 更新 `../data/`；若配合 Git 自动推送，同样会触发 Netlify 部署。

## 配置要点（config.yaml）
- `paths.work_dir: "../data"` —— 数据写入仓库根 `data/`（构建后发布）。
- `skills.westock.symbols` —— 日本电力期货标的代码（先用 `search <名称> --type futures` 获取）。
- `skills.eastmoney_miaoxiang.script` —— 妙想 `get_data.py` 真实路径（留空则跳过）。
- `alert.webhook` —— 可选，失败推送企业微信/钉钉机器人。

## 手动验证
```bash
pip install -r requirements.txt
python3 japan_power_futures_updater.py --test        # 校验配置/技能
python3 japan_power_futures_updater.py --run-once    # 立即跑一次
```
