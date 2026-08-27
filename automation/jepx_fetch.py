#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JEPX（日本卸電力取引所）真实数据抓取器
=====================================

数据源：JEPX 官方现货（スポット / day-ahead）市场公开 CSV
    https://www.jepx.jp/market/excel/spot_<FY>.csv
  · 编码 Shift-JIS(cp932)，每日更新，48 个 30 分钟时段/日
  · 字段：年月日 / 時刻コード / 売り入札量 / 買い入札量 / 約定総量 /
          システムプライス / エリアプライス×9（北海道…九州）

为什么用它：腾讯自选股期货库与东方财富妙想均不覆盖日本电力品种
（已实测：search 日本电力/电力/JEPX --type futures 全部无结果）。
JEPX 系统价格（システムプライス）是日本电力市场的基准价格，
也是日本电力期货（EEX/TOCOM）的结算参考标的，权威且免费。

输出（供前端 app.js 直接读取）：
    ../data/latest.json    最新交割日快照
    ../data/history.json   近 N 日历史序列

特性：零第三方依赖（纯标准库）、自动重试、失败不破坏既有数据、滚动日志。
"""

import csv
import io
import json
import logging
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from logging.handlers import RotatingFileHandler

# ====== 路径常量 ======
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)          # netlify-deploy/
DATA_DIR = os.path.join(PROJECT_DIR, "data")
LOG_DIR = os.path.join(SCRIPT_DIR, "logs")

CSV_URL_TPL = "https://www.jepx.jp/market/excel/spot_{fy}.csv"
HISTORY_DAYS = 30
RETRY_TIMES = 3
RETRY_BACKOFF = 20          # 秒
HTTP_TIMEOUT = 90

JST = timezone(timedelta(hours=9))

# CSV 列索引（0 基）
C_DATE, C_SLOT = 0, 1
C_SELL_BID, C_BUY_BID, C_DEAL = 2, 3, 4
C_SYS_PRICE = 5
AREA_COLS = {                # 区域价格列
    "hokkaido": 6, "tohoku": 7, "tokyo": 8, "chubu": 9, "hokuriku": 10,
    "kansai": 11, "chugoku": 12, "shikoku": 13, "kyushu": 14,
}
AREA_ZH = {
    "hokkaido": "北海道", "tohoku": "东北", "tokyo": "东京", "chubu": "中部",
    "hokuriku": "北陆", "kansai": "关西", "chugoku": "中国", "shikoku": "四国",
    "kyushu": "九州",
}


# ====== 日志 ======
def setup_logger():
    os.makedirs(LOG_DIR, exist_ok=True)
    logger = logging.getLogger("jepx")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    fh = RotatingFileHandler(os.path.join(LOG_DIR, "jepx_fetch.log"),
                             maxBytes=2 * 1024 * 1024, backupCount=3,
                             encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


log = setup_logger()


# ====== 工具 ======
def fiscal_year(d: datetime) -> int:
    """JEPX 财年 4/1 起算：1~3 月归上一财年。"""
    return d.year - 1 if d.month < 4 else d.year


def to_float(s):
    try:
        s = (s or "").strip()
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def fetch_csv(url: str) -> str:
    """带重试地下载 CSV 并解码 Shift-JIS。"""
    last_err = None
    for attempt in range(1, RETRY_TIMES + 1):
        try:
            log.info("下载 JEPX CSV（第 %d/%d 次尝试）：%s", attempt, RETRY_TIMES, url)
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0 (HTF-Research JEPX Fetcher)"})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                if resp.status != 200:
                    raise urllib.error.HTTPError(url, resp.status, "bad status", resp.headers, None)
                raw = resp.read()
            log.info("下载成功：%d 字节", len(raw))
            # JEPX 用 Shift-JIS；容错解码，避免个别脏字节中断
            return raw.decode("cp932", errors="replace")
        except Exception as e:                                  # noqa: BLE001
            last_err = e
            log.warning("下载失败：%s", e)
            if attempt < RETRY_TIMES:
                log.info("等待 %d 秒后重试…", RETRY_BACKOFF)
                time.sleep(RETRY_BACKOFF)
    raise RuntimeError(f"JEPX CSV 下载失败（已重试 {RETRY_TIMES} 次）：{last_err}")


def parse_daily(csv_text: str) -> dict:
    """按交割日聚合 48 个时段 → 日度指标。"""
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if not rows:
        raise ValueError("CSV 内容为空")

    days = {}
    skipped = 0
    for row in rows[1:]:                      # 跳过表头
        if len(row) <= C_SYS_PRICE:
            skipped += 1
            continue
        date_raw = (row[C_DATE] or "").strip()
        if not date_raw or "/" not in date_raw:
            skipped += 1
            continue
        try:
            d = datetime.strptime(date_raw, "%Y/%m/%d").strftime("%Y-%m-%d")
        except ValueError:
            skipped += 1
            continue

        sysp = to_float(row[C_SYS_PRICE])
        if sysp is None:
            skipped += 1
            continue

        bucket = days.setdefault(d, {
            "sys": [], "deal": 0.0, "sell_bid": 0.0, "buy_bid": 0.0,
            "areas": {k: [] for k in AREA_COLS},
        })
        bucket["sys"].append(sysp)
        bucket["deal"] += to_float(row[C_DEAL]) or 0.0
        bucket["sell_bid"] += to_float(row[C_SELL_BID]) or 0.0
        bucket["buy_bid"] += to_float(row[C_BUY_BID]) or 0.0
        for k, idx in AREA_COLS.items():
            if len(row) > idx:
                v = to_float(row[idx])
                if v is not None:
                    bucket["areas"][k].append(v)

    log.info("解析完成：%d 个交割日（跳过 %d 行无效数据）", len(days), skipped)
    if not days:
        raise ValueError("未解析到任何有效交割日数据")
    return days


def build_series(days: dict) -> list:
    """转为按日期升序的指标序列，并计算日环比。"""
    out = []
    for d in sorted(days.keys()):
        b = days[d]
        if len(b["sys"]) < 48:                 # 只取完整交易日（48 时段）
            log.info("跳过不完整交割日 %s（仅 %d 个时段）", d, len(b["sys"]))
            continue
        sys_list = b["sys"]
        avg = sum(sys_list) / len(sys_list)
        peak, trough = max(sys_list), min(sys_list)
        tokyo_list = b["areas"]["tokyo"]
        tokyo_avg = sum(tokyo_list) / len(tokyo_list) if tokyo_list else None
        area_avg = {}
        for k, lst in b["areas"].items():
            area_avg[k] = round(sum(lst) / len(lst), 2) if lst else None

        out.append({
            "date": d,
            "sys_avg": round(avg, 2),
            "peak": round(peak, 2),
            "trough": round(trough, 2),
            "spread": round(peak - trough, 2),
            "deal_mwh": round(b["deal"] / 1000.0, 1),        # kWh -> MWh
            "sell_bid_mwh": round(b["sell_bid"] / 1000.0, 1),
            "buy_bid_mwh": round(b["buy_bid"] / 1000.0, 1),
            "tokyo_avg": round(tokyo_avg, 2) if tokyo_avg is not None else None,
            "area_avg": area_avg,
            "slots": len(sys_list),
        })

    # 日环比
    for i, rec in enumerate(out):
        if i == 0:
            rec["change_pct"] = None
        else:
            prev = out[i - 1]["sys_avg"]
            rec["change_pct"] = round((rec["sys_avg"] - prev) / prev * 100, 2) if prev else None
    return out


def to_snapshot(rec: dict, updated_at: str) -> dict:
    """构造前端消费的单日快照（键名与 app.js 对齐）。"""
    return {
        "date": rec["date"],
        "updated_at": updated_at,
        "spec_indicators": ["系统价格(日均)", "日环比", "约定总量", "东京区域价格", "日内峰谷价差"],
        "metrics": {
            "latest_price": rec["sys_avg"],
            "change_pct": rec["change_pct"],
            "volume": rec["deal_mwh"],
            "tokyo_price": rec["tokyo_avg"],
            "spread": rec["spread"],
            # 附加明细（前端可选用）
            "peak": rec["peak"],
            "trough": rec["trough"],
            "sell_bid_mwh": rec["sell_bid_mwh"],
            "buy_bid_mwh": rec["buy_bid_mwh"],
        },
        "area_avg": rec["area_avg"],
        "area_labels": AREA_ZH,
        "sources": {
            "jepx": "JEPX 日本卸電力取引所 · 现货（day-ahead）市场官方 CSV",
        },
        "raw": {
            "jepx": {
                "url": CSV_URL_TPL,
                "slots": rec["slots"],
                "sys_avg": rec["sys_avg"],
            },
        },
    }


def write_json(path: str, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)                       # 原子替换，避免半截文件
    log.info("已写入 %s（%d 字节）", path, os.path.getsize(path))


def main():
    started = time.time()
    log.info("=" * 60)
    log.info("JEPX 真实数据抓取开始")

    now_jst = datetime.now(JST)
    fy = fiscal_year(now_jst)

    csv_text = None
    for candidate_fy in (fy, fy - 1):           # 财年切换期容错
        url = CSV_URL_TPL.format(fy=candidate_fy)
        try:
            csv_text = fetch_csv(url)
            log.info("使用财年 %d 数据文件", candidate_fy)
            break
        except Exception as e:                  # noqa: BLE001
            log.warning("财年 %d 文件不可用：%s", candidate_fy, e)
    if csv_text is None:
        log.error("所有候选财年文件均不可用，本次放弃（保留既有数据）")
        return 1

    days = parse_daily(csv_text)
    series = build_series(days)
    if not series:
        log.error("无完整交割日数据，本次放弃")
        return 1

    updated_at = now_jst.strftime("%Y-%m-%dT%H:%M:%S")
    history = [to_snapshot(r, updated_at) for r in series[-HISTORY_DAYS:]]
    latest = history[-1]

    write_json(os.path.join(DATA_DIR, "history.json"), history)
    write_json(os.path.join(DATA_DIR, "latest.json"), latest)

    log.info("最新交割日 %s：系统价格 %.2f 円/kWh，日环比 %s%%，约定总量 %.1f MWh",
             latest["date"], latest["metrics"]["latest_price"],
             latest["metrics"]["change_pct"], latest["metrics"]["volume"])
    log.info("历史序列 %d 天（%s ~ %s）", len(history), history[0]["date"], history[-1]["date"])
    log.info("完成，耗时 %.1f 秒", time.time() - started)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("被用户中断")
        sys.exit(130)
    except Exception as e:                      # noqa: BLE001
        log.exception("未捕获异常：%s", e)
        sys.exit(1)
