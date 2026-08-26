# ============================================================
# Windows 任务计划程序 注册脚本（PowerShell）
# 每天上午 09:30 自动执行日本电力期货数据更新
# 以管理员身份运行本脚本即可完成注册。
# ============================================================
param(
    [string]$PythonExe = "python",
    [string]$TaskName  = "JapanPowerFuturesDailyUpdate"
)

$AutomationDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ScriptPath    = Join-Path $AutomationDir "japan_power_futures_updater.py"
$ConfigPath    = Join-Path $AutomationDir "config.yaml"
$BatPath       = Join-Path $AutomationDir "run_daily.bat"
$LogPath      = Join-Path $AutomationDir "logs\cron.out"

# 动作：调用 run_daily.bat（更新 -> git 提交 -> 推送，触发 Netlify 重部署）
$Action = New-ScheduledTaskAction `
    -Execute $BatPath `
    -WorkingDirectory $AutomationDir

# 触发器：每天 09:30
$Trigger = New-ScheduledTaskTrigger -Daily -At "09:30"

# 条件/设置：无论是否登录都运行、失败重试、最长运行 1 小时
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# 以当前用户身份运行（如需 SYSTEM 账号，加上 -User "SYSTEM"）
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Force

Write-Host "已注册计划任务：$TaskName （每天 09:30 执行）"
Write-Host "查看：taskschd.msc  →  任务计划程序库  →  $TaskName"
Write-Host "手动测试：Start-ScheduledTask -TaskName $TaskName"
Write-Host "删除任务：Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
