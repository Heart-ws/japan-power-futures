@echo off
REM ============================================================
REM 每日 09:30 由 Windows 任务计划程序调用
REM 流程：运行更新脚本 -> 提交 data/ 变更 -> 推送到 Git -> Netlify 自动重部署
REM 前置：本机已配置好 Git 且已认证（credential helper / SSH），
REM       netlify-deploy/ 本身是一个已连好 origin 远端、与 Netlify 关联的 Git 仓库。
REM ============================================================
setlocal
cd /d "%~dp0"

REM 1) 运行更新（写入 ../data/latest.json、history.json）
python japan_power_futures_updater.py --config config.yaml --run-once
if ERRORLEVEL 1 (
  echo [run_daily] 更新脚本返回失败，跳过推送。
  exit /b 1
)

REM 2) 切到仓库根（netlify-deploy/）提交数据变更
cd ..
git add data
git commit -m "daily auto-update %date% %time%" >nul 2>&1
if ERRORLEVEL 1 (
  echo [run_daily] 无新数据可提交（data/ 未变化）。
) else (
  REM 3) 推送到远端，触发 Netlify 通过 npm run build 重新部署
  git push
  echo [run_daily] 已推送，Netlify 将自动重新部署。
)
endlocal
