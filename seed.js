// 生成示例数据到 data/（首次部署用；真实数据由每日自动更新脚本覆盖）
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const SPEC = ["最新结算价", "当日涨跌", "成交量", "持仓量", "市场热度"];
const DAYS = 14;
const today = new Date("2026-08-26T09:30:00");

function rnd(base, spread) { return base + (Math.random() - 0.5) * spread; }

const history = [];
let price = 28.5;
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const dateStr = d.toISOString().slice(0, 10);
  const prev = price;
  price = Math.max(20, rnd(price, 3.2));
  const change_pct = ((price - prev) / prev) * 100;
  history.push({
    date: dateStr,
    updated_at: d.toISOString().slice(0, 19),
    spec_indicators: SPEC,
    metrics: {
      latest_price: Number(price.toFixed(2)),
      change_pct: Number(change_pct.toFixed(2)),
      volume: Math.round(rnd(120000, 40000)),
      open_interest: Math.round(rnd(58000, 12000)),
      market_heat: Math.round(rnd(65, 25)),
    },
    sources: {
      westock: "腾讯自选股-金融数据查询",
      eastmoney_miaoxiang: "金融数据-东方财富妙想",
    },
    raw: { westock: {}, eastmoney_markdown: null },
  });
}

const latest = history[history.length - 1];
fs.writeFileSync(path.join(dataDir, "latest.json"), JSON.stringify(latest, null, 2));
fs.writeFileSync(path.join(dataDir, "history.json"), JSON.stringify(history, null, 2));
console.log(`[seed] 已生成 ${DAYS} 天示例数据 → data/latest.json, data/history.json`);
