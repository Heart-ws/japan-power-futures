#!/usr/bin/env bash
# 安装 crontab 定时任务（Linux / macOS）
# 用法：bash install_cron.sh
set -e

AUTOMATION_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="$(command -v python3 || echo /usr/bin/python3)"
CRON_LINE="30 9 * * * cd ${AUTOMATION_DIR} && ${PYTHON_BIN} japan_power_futures_updater.py --config config.yaml --run-once >> ${AUTOMATION_DIR}/logs/cron.out 2>&1"

# 避免重复添加：先移除旧条目再追加
( crontab -l 2>/dev/null | grep -v "japan_power_futures_updater.py" ; echo "${CRON_LINE}" ) | crontab -

echo "已安装定时任务："
echo "${CRON_LINE}"
echo "可用 'crontab -l' 查看；取消执行：crontab -l | grep -v japan_power_futures_updater.py | crontab -"
