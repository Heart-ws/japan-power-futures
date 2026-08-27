@echo off
REM ============================================================
REM 每日 09:30 由 Windows 任务计划程序调用
REM 流程：运行更新脚本 -> 提交 data/ 变更 -> 推送到 Git -> Netlify 自动重部署
REM 前置：本机已配置好 Git 且已认证（credential helper / SSH），
REM       netlify-deploy/ 本身是一个已连好 origin 远端、与 Netlify 关联的 Git 仓库。
REM ============================================================
setlocal
cd /d "%~dp0"

REM 1) 抓取 JEPX 真实数据（写入 ../data/latest.json、history.json）
REM    数据源：JEPX 日本卸電力取引所官方公开 CSV，纯标准库、零第三方依赖
REM    注意：若本机只有 py 命令而没有 python，把下面的 python 改成 py
python jepx_fetch.py
if ERRORLEVEL 1 (
  echo [run_daily] JEPX 抓取失败，跳过推送（保留既有数据）。
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
