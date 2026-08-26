#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日本电力期货数据 · 每日自动更新脚本
====================================
触发时间：每天上午 09:30（见 config.yaml 中的 cron）
职责：
  1. 读取方案说明 Markdown，确定“要统计哪些指标”
  2. 调用两个金融数据技能拉取数据：
       - 腾讯自选股-金融数据查询 (westockdata)  → 期货行情 / K线
       - 金融数据-东方财富妙想 (mx-finance-data) → 结算价/成交量/持仓量等
  3. 清洗、聚合、落库（data/latest.json + data/history.json 供网页读取）
  4. 完整执行日志 + 失败重试 + 可选告警

部署方式（二选一）：
  A. 系统级定时（推荐）：用 crontab / 任务计划程序，每天 09:30 调用本脚本一次
       python3 japan_power_futures_updater.py --config config.yaml --run-once
  B. 常驻守护：脚本自行按 09:30 调度（需 pip install apscheduler）
       python3 japan_power_futures_updater.py --config config.yaml --daemon
"""

import argparse
import datetime as dt
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from logging.handlers import RotatingFileHandler

# ====== 全局常量 ======
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_python() -> str:
    """自动选择可用的 Python 解释器（Linux/macOS 多为 python3，Windows 多为 python）。"""
    import shutil
    for cand in ("python3", "python"):
        if shutil.which(cand):
            return cand
    return "python3"  # 兜底；若都缺失，运行时会明确报 FileNotFoundError


# =====================================================================
# 配置加载
# =====================================================================
def load_config(path: str) -> dict:
    try:
        import yaml
    except ImportError:
        raise SystemExit("缺少依赖 pyyaml，请先执行：pip install -r requirements.txt")
    with open(path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if not isinstance(cfg, dict):
        raise SystemExit(f"配置文件格式错误：{path}")
    return cfg


# =====================================================================
# 日志
# =====================================================================
def setup_logger(log_file: str) -> logging.Logger:
    os.makedirs(os.path.dirname(log_file), exist_ok=True)
    logger = logging.getLogger("jp_power_futures_updater")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(message)s", "%Y-%m-%d %H:%M:%S"
    )
    fh = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    return logger


# =====================================================================
# 引用方案说明 Markdown：提取“要统计的指标”
# =====================================================================
def load_spec_from_md(md_path: str, logger: logging.Logger) -> list:
    """从方案说明 md 中解析出需统计的核心指标关键词。"""
    keywords = ["最新结算价", "当日涨跌", "成交量", "持仓量", "市场热度"]
    found = []
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            text = f.read()
        for kw in keywords:
            if kw in text:
                found.append(kw)
        logger.info("已引用方案说明 md：%s，识别到指标 %d 项：%s",
                    os.path.basename(md_path), len(found), "、".join(found) or "无")
    except FileNotFoundError:
        logger.warning("方案说明 md 未找到：%s（将使用默认指标集）", md_path)
    return found or keywords


# =====================================================================
# 技能 1：腾讯自选股-金融数据查询 (westockdata)
#   命令：npx -y westock-data-skillhub@1.0.5 <命令> [参数]
# =====================================================================
def fetch_westock(cfg: dict, logger: logging.Logger) -> dict:
    sc = cfg["skills"]["westock"]
    if not sc.get("enabled"):
        logger.info("[westock] 已禁用，跳过。")
        return {}
    base = [sc["command"]] + list(sc.get("args", []))
    symbols = sc.get("symbols", [])
    limit = sc.get("kline_limit", 60)
    result = {"raw": {}, "klines": {}}

    # 每个标的单独查询（期货搜索/行情按单代码更佳）
    for sym in symbols:
        try:
            cmd = base + ["kline", sym, "--period", "day", "--limit", str(limit)]
            logger.info("[westock] 执行：%s", " ".join(cmd))
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=120, cwd=SCRIPT_DIR)
            out = (proc.stdout or "") + (proc.stderr or "")
            if proc.returncode != 0:
                logger.warning("[westock] %s 返回非零：%s", sym, out[:300])
                continue
            # 尽力解析：优先 JSON，否则保留原始文本
            parsed = None
            try:
                parsed = json.loads(out)
            except Exception:
                parsed = None
            result["raw"][sym] = parsed if parsed is not None else out.strip()
            result["klines"][sym] = _extract_metrics_from_text(out)
            logger.info("[westock] %s 拉取完成。", sym)
        except subprocess.TimeoutExpired:
            logger.error("[westock] %s 调用超时。", sym)
        except FileNotFoundError:
            logger.error("[westock] 未找到命令 '%s'，请确认已安装 Node.js(npx)。", sc["command"])
            break
    return result


def _extract_metrics_from_text(text: str) -> dict:
    """从技能返回文本中尽力提取价格/涨跌/成交量等数值。"""
    m = {}
    pat = {
        "latest_price": r"最新[价价]?\s*[:：]?\s*([\d.]+)",
        "change_pct": r"涨[跌]幅?\s*[:：]?\s*([\-\d.]+)%?",
        "volume": r"成交量\s*[:：]?\s*([\d.]+)",
        "open_interest": r"持仓[量量]?\s*[:：]?\s*([\d.]+)",
    }
    for key, p in pat.items():
        mm = re.search(p, text)
        if mm:
            try:
                m[key] = float(mm.group(1))
            except ValueError:
                pass
    return m


# =====================================================================
# 技能 2：金融数据-东方财富妙想 (mx-finance-data)
#   命令：python3 <get_data.py> --query "..." --indicators "..."
#   产物：xlsx + md 文件（路径从 stdout 解析）
# =====================================================================
def fetch_eastmoney(cfg: dict, logger: logging.Logger) -> dict:
    sc = cfg["skills"]["eastmoney_miaoxiang"]
    if not sc.get("enabled"):
        logger.info("[eastmoney] 已禁用，跳过。")
        return {}
    script = sc.get("script", "")
    if not script or not os.path.isfile(script):
        logger.warning("[eastmoney] 未配置有效脚本路径（skills.eastmoney_miaoxiang.script），跳过。")
        return {}

    cmd = [_resolve_python(), script, "--query", sc.get("query", ""),
           "--indicators", sc.get("indicators", "")]
    logger.info("[eastmoney] 执行：%s", " ".join(cmd[:2]) + " --query ... --indicators ...")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, cwd=SCRIPT_DIR)
    except FileNotFoundError:
        logger.error("[eastmoney] 未找到 python3，请确认 Python 环境。")
        return {}
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        logger.warning("[eastmoney] 返回非零：%s", out[:300])
        return {}

    # 解析产物路径：脚本会打印 “Markdown: <path>” / “文件: <path>”
    md_path = None
    for line in out.splitlines():
        if "Markdown:" in line or "文件:" in line:
            md_path = line.split(":", 1)[1].strip()
            break
    if not md_path or not os.path.isfile(md_path):
        logger.warning("[eastmoney] 未解析到产物文件，原始输出：%s", out[:300])
        return {"raw_text": out[:1000]}

    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()
    logger.info("[eastmoney] 产物已生成：%s（%d 字节）", md_path, len(content))
    return {"markdown_path": md_path, "content": content}


# =====================================================================
# 聚合 + 落库
# =====================================================================
def aggregate(westock_data: dict, eastmoney_data: dict,
              spec: list, logger: logging.Logger) -> dict:
    now = dt.datetime.now()
    metrics = {}

    # 优先取 westock 解析出的数值
    for sym, vals in westock_data.get("klines", {}).items():
        for k, v in vals.items():
            metrics.setdefault(k, v)

    # 若 eastmoney 的 md 内容含关键数值，可在此补充解析（保留扩展位）
    if eastmoney_data.get("content"):
        extra = _extract_metrics_from_text(eastmoney_data["content"])
        for k, v in extra.items():
            metrics.setdefault(k, v)

    record = {
        "date": now.strftime("%Y-%m-%d"),
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "spec_indicators": spec,
        "metrics": metrics,
        "sources": {
            "westock": "腾讯自选股-金融数据查询" if westock_data else None,
            "eastmoney_miaoxiang": "金融数据-东方财富妙想" if eastmoney_data else None,
        },
        "raw": {
            "westock": westock_data.get("raw", {}),
            "eastmoney_markdown": eastmoney_data.get("markdown_path"),
        },
    }
    return record


def persist(record: dict, work_dir: str, keep_days: int, logger: logging.Logger):
    os.makedirs(work_dir, exist_ok=True)
    latest_path = os.path.join(work_dir, "latest.json")
    history_path = os.path.join(work_dir, "history.json")

    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    logger.info("已写入 latest.json：%s", latest_path)

    history = []
    if os.path.isfile(history_path):
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []
    history.append(record)

    # 清理超期历史
    if keep_days and history:
        cutoff = dt.datetime.now() - dt.timedelta(days=keep_days)
        history = [r for r in history
                   if dt.datetime.strptime(r["updated_at"], "%Y-%m-%dT%H:%M:%S") >= cutoff]

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    logger.info("已追加 history.json，当前保留 %d 条。", len(history))


# =====================================================================
# 告警
# =====================================================================
def send_alert(cfg: dict, message: str, logger: logging.Logger):
    ac = cfg.get("alert", {})
    if not ac.get("enabled") or not ac.get("webhook"):
        logger.warning("告警已触发（未配置 webhook，仅记录）：%s", message)
        return
    try:
        import urllib.request
        req = urllib.request.Request(
            ac["webhook"],
            data=json.dumps({"msgtype": "text", "text": {"content": message}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
        logger.info("告警已推送至 webhook。")
    except Exception as e:
        logger.error("告警推送失败：%s", e)


# =====================================================================
# 单次更新主流程（含重试）
# =====================================================================
def run_update(cfg: dict, logger: logging.Logger) -> bool:
    spec = load_spec_from_md(cfg["paths"]["md_spec"], logger)
    retry = int(cfg.get("update", {}).get("retry", 3))
    backoff = int(cfg.get("update", {}).get("retry_backoff_seconds", 60))

    for attempt in range(1, retry + 1):
        try:
            logger.info("===== 开始第 %d/%d 次更新 =====", attempt, retry)
            westock_data = fetch_westock(cfg, logger)
            eastmoney_data = fetch_eastmoney(cfg, logger)

            if not westock_data and not eastmoney_data:
                raise RuntimeError("两个数据源均未返回有效数据，请检查技能配置/网络。")

            record = aggregate(westock_data, eastmoney_data, spec, logger)
            persist(record, cfg["paths"]["work_dir"],
                    int(cfg.get("update", {}).get("keep_history_days", 365)), logger)
            logger.info("===== 更新成功：%s =====", record["updated_at"])
            return True

        except Exception as e:
            logger.error("第 %d 次更新失败：%s", attempt, e)
            if attempt < retry:
                logger.info("%d 秒后重试…", backoff)
                import time
                time.sleep(backoff)

    msg = f"[日本电力期货自动更新] {dt.datetime.now():%Y-%m-%d %H:%M} 连续 {retry} 次失败，请检查日志。"
    send_alert(cfg, msg, logger)
    return False


# =====================================================================
# 调度
# =====================================================================
def run_daemon(cfg: dict, logger: logging.Logger):
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        raise SystemExit("守护模式需安装 apscheduler：pip install apscheduler")
    cron = cfg["schedule"]["cron"]            # "30 9 * * *"
    minute, hour, day, month, dow = cron.split()
    tz = cfg["schedule"].get("timezone", "Asia/Shanghai")

    sched = BlockingScheduler(timezone=tz)
    sched.add_job(lambda: run_update(cfg, logger),
                  CronTrigger(minute=minute, hour=hour, day=day, month=month, day_of_week=dow),
                  id="jp_power_daily", max_instances=1, coalesce=True)
    logger.info("守护模式已启动，每天 %s (时区 %s) 自动执行。Ctrl+C 退出。", cron, tz)
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("守护模式已停止。")


# =====================================================================
# 入口
# =====================================================================
def main():
    ap = argparse.ArgumentParser(description="日本电力期货数据 每日自动更新")
    ap.add_argument("--config", default=os.path.join(SCRIPT_DIR, "config.yaml"))
    ap.add_argument("--run-once", action="store_true",
                    help="执行一次更新后退出（配合系统 crontab/任务计划程序使用）")
    ap.add_argument("--daemon", action="store_true",
                    help="常驻进程，自行按 09:30 调度（需 apscheduler）")
    ap.add_argument("--test", action="store_true",
                    help="仅校验配置与技能可用性，不落库")
    args = ap.parse_args()

    cfg = load_config(args.config)
    logger = setup_logger(cfg["paths"]["log_file"])
    logger.info("配置加载完成 | cron=%s | tz=%s",
                cfg["schedule"]["cron"], cfg["schedule"].get("timezone"))

    if args.test:
        logger.info("测试模式：校验技能命令是否可用。")
        shutil.which("npx") and logger.info("npx 可用") or logger.warning("npx 不可用")
        py = _resolve_python()
        logger.info("Python 解释器：%s（可用）", py)
        load_spec_from_md(cfg["paths"]["md_spec"], logger)
        logger.info("测试完成。")
        return

    if args.daemon:
        run_daemon(cfg, logger)
    else:
        # 默认：执行一次（供 crontab 调用）
        ok = run_update(cfg, logger)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
