// 日本电力期货数据日报 - 前端逻辑（华泰期货风格外壳，数据驱动）
// 读取 ./data/latest.json 与 ./data/history.json（由每日自动更新脚本生成）

const METRICS = [
  { key: "latest_price",  label: "最新结算价", unit: "¥/kWh" },
  { key: "change_pct",    label: "当日涨跌",   unit: "%" },
  { key: "volume",        label: "成交量",     unit: "MWh" },
  { key: "open_interest", label: "持仓量",     unit: "手" },
  { key: "market_heat",   label: "市场热度",   unit: "" },
];

let LATEST = null;
let HISTORY = [];

function fmt(v, d = 2) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function chgClass(s) {
  if (s === null || s === undefined) return "flat";
  const n = Number(s);
  if (!isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function fmtTime(iso) {
  if (!iso) return "—";
  // "2026-08-26T01:30:00" -> "2026-08-26 01:30"
  return String(iso).replace("T", " ").slice(0, 16);
}
function isFresh(iso) {
  if (!iso) return false;
  const t = Date.parse(String(iso).replace(" ", "T"));
  if (isNaN(t)) return false;
  const diffH = (Date.now() - t) / 36e5;     // 小时
  return diffH >= -1 && diffH <= 30;          // 30 小时内视为更新正常
}

async function boot() {
  try {
    const [latest, history] = await Promise.all([
      fetch("./data/latest.json").then(r => r.json()),
      fetch("./data/history.json").then(r => r.json()),
    ]);
    LATEST = latest;
    HISTORY = Array.isArray(history) ? history : [];
    renderCover();
    renderToc();
    renderContent();
    bindSmoothScroll();
  } catch (e) {
    document.getElementById("content").innerHTML =
      '<div class="muted-note">数据加载失败：' + e.message + '（请确认 data/latest.json 已生成）</div>';
  }
}

/* ---- 报头 ---- */
function renderCover() {
  const m = (LATEST && LATEST.metrics) || {};
  const cp = LATEST?.change_pct;
  const updated = LATEST?.updated_at || "";
  const wsRaw = LATEST?.raw?.westock;
  const hasWS = !!(wsRaw && Object.keys(wsRaw).length > 0);
  const hasEM = !!LATEST?.raw?.eastmoney_markdown;
  const fresh = isFresh(updated);
  const statusCls = fresh ? "ok" : "warn";
  const statusText = fresh ? "更新正常" : "更新可能延迟";
  document.getElementById("cover-card").innerHTML =
    '<div class="cover-meta">' +
      '<span class="pill pill-blue">日本电力期货</span>' +
      '<span class="pill pill-gray">每日数据跟踪</span>' +
    '</div>' +
    '<h1>日本电力期货（JEPX）每日数据日报</h1>' +
    '<p class="subtitle">数据看板 · 历史趋势 · 每日 09:30 自动更新</p>' +
    '<div class="cover-info">' +
      '<div><div class="k">报告日期</div><div class="v">' + (LATEST?.date || "—") + '</div></div>' +
      '<div><div class="k">最新结算价</div><div class="v">' + fmt(m.latest_price) + ' ¥/kWh</div></div>' +
      '<div><div class="k">当日涨跌</div><div class="v ' + chgClass(cp) + '">' + (cp >= 0 ? "+" : "") + fmt(cp) + '%</div></div>' +
      '<div><div class="k">研究机构</div><div class="v">华泰期货 · 研究</div></div>' +
    '</div>' +
    '<div class="status-bar ' + statusCls + '">' +
      '<span class="sb-dot"></span>' +
      '<span>最后更新：' + fmtTime(updated) + '</span>' +
      '<span class="sb-sep">·</span>' +
      '<span class="src-badge ' + (hasWS ? "on" : "off") + '">腾讯自选股 ' + (hasWS ? "✓" : "—") + '</span>' +
      '<span class="src-badge ' + (hasEM ? "on" : "off") + '">东方财富妙想 ' + (hasEM ? "✓" : "—") + '</span>' +
      '<span class="sb-status">' + statusText + '</span>' +
    '</div>';
}

/* ---- 目录 ---- */
function renderToc() {
  const items = [
    ["overview", "一、市场概览"],
    ["contracts", "二、重点合约行情表"],
    ["news", "三、市场新闻与动态"],
    ["logics", "四、交易逻辑"],
    ["watchlist", "五、关注事项"],
  ];
  document.getElementById("toc").innerHTML =
    '<div class="toc-title">目录 Contents</div>' +
    items.map(it => '<a href="#' + it[0] + '"><span class="dot">·</span>' + it[1] + '</a>').join("");
}

/* ---- 正文 ---- */
function sec(id, no, title, inner) {
  return '<section id="' + id + '">' +
    '<h2 class="sec-title"><span class="bar"></span><span class="no">' + no + '</span>' + title + '</h2>' +
    inner + '</section>';
}

function renderContent() {
  const m = (LATEST && LATEST.metrics) || {};
  const h = [];

  /* 一、市场概览（数据看板 + 图表） */
  const cards = METRICS.map(def => {
    const v = m[def.key];
    const cls = def.key === "change_pct" ? chgClass(v) : "";
    const sign = def.key === "change_pct" && v >= 0 ? "+" : "";
    return '<div class="index-card">' +
      '<div class="nm">' + def.label + '</div>' +
      '<div class="cd">' + def.unit + '</div>' +
      '<div class="chg ' + cls + '">' + sign + fmt(v) + '</div>' +
    '</div>';
  }).join("");

  h.push(sec("overview", "一、", "市场概览",
    '<p>以下为日本电力期货（JEPX）最新交易日核心指标与近期走势。数据经腾讯自选股、东方财富妙想金融数据技能聚合，每日 09:30 自动刷新。</p>' +
    '<div class="index-grid">' + cards + '</div>' +
    '<div class="chart-box"><div class="cb-title">结算价走势（近 30 日）</div><div class="canvas-wrap"><canvas id="priceChart"></canvas></div></div>' +
    '<div class="chart-box"><div class="cb-title">成交量走势（近 30 日）</div><div class="canvas-wrap"><canvas id="volumeChart"></canvas></div></div>'
  ));

  /* 二、重点合约行情表（近期交易日） */
  const recent = HISTORY.slice(-12).reverse();
  const rows = recent.map(r => {
    const mm = r.metrics || {};
    return '<tr><td>' + r.date + '</td>' +
      '<td class="num">' + fmt(mm.latest_price) + '</td>' +
      '<td class="num ' + chgClass(mm.change_pct) + '">' + (mm.change_pct >= 0 ? "+" : "") + fmt(mm.change_pct) + '%</td>' +
      '<td class="num">' + fmt(mm.volume, 0) + '</td>' +
      '<td class="num">' + fmt(mm.open_interest, 0) + '</td></tr>';
  }).join("");
  h.push(sec("contracts", "二、", "重点合约行情表",
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>交易日</th><th class="num">结算价(¥/kWh)</th><th class="num">涨跌</th><th class="num">成交量(MWh)</th><th class="num">持仓量(手)</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="5" class="muted-note">暂无数据</td></tr>') + '</tbody></table></div>'
  ));

  /* 三、市场新闻与动态 */
  const news = [
    { title: "日本电力期货每日数据自动更新已上线", source: "华泰期货 · 研究", type: "官方",
      summary: "平台已接入每日 09:30 自动抓取与入库流程，客户打开网页即可查看截至最新交易日的数据，无需手动操作。" },
    { title: "JEPX 市场数据来源说明", source: "华泰期货 · 研究", type: "行业媒体",
      summary: "数据来自日本电力期货交易所公开行情，并经腾讯自选股、东方财富妙想金融数据技能聚合，最终以交易所官方发布为准。" },
    { title: "夏季制冷与冬季采暖季节性影响电价", source: "市场观察", type: "行业媒体",
      summary: "极端气温会显著抬升日内与峰值负荷，进而推高电力期货价格波动，建议关注季节性供需变化。" },
  ];
  h.push(sec("news", "三、", "市场新闻与动态",
    news.map((n, i) => {
      const tagCls = n.type === "官方" ? "tag-official" : (n.type === "行业媒体" ? "tag-industry" : "tag-media");
      return '<div class="news-item">' +
        '<div class="n-title">' + (i + 1) + '. ' + n.title + '</div>' +
        '<div class="n-meta"><span><b>来源：</b>' + n.source + '</span><span class="tag ' + tagCls + '">' + n.type + '</span></div>' +
        '<div style="font-size:13.5px;color:var(--ink-soft)">' + n.summary + '</div></div>';
    }).join("")
  ));

  /* 四、交易逻辑 */
  const logics = [
    { title: "季节性供需", text: "夏季制冷、冬季采暖推升电力需求，易在峰值时段形成价格高点；关注季节切换前后的持仓变化。" },
    { title: "燃料成本传导", text: "天然气、煤炭等边际机组燃料价格上行，会抬升电力边际成本，进而传导至期货价格。" },
    { title: "天气与新能源出力", text: "光伏、风电等可再生能源出力波动会影响日内供需平衡， cloudy/无风时段价格通常走高。" },
  ];
  h.push(sec("logics", "四、", "交易逻辑",
    logics.map((l, i) => '<div class="logic-card"><div class="l-title">' + (i + 1) + '. ' + l.title + '</div><div class="l-text">' + l.text + '</div></div>').join("")
  ));

  /* 五、关注事项 */
  const watch = [
    { date: "每日 09:30", event: "数据自动更新与重新部署", impact: "网页展示截至最新交易日的数据" },
    { date: "交易所休市日", event: "无当日行情", impact: "数据沿用上一交易日，页面标注日期" },
    { date: "极端天气", event: "价格异动风险", impact: "关注成交量与持仓量异常放大" },
  ];
  h.push(sec("watchlist", "五、", "关注事项",
    '<div class="table-wrap"><table>' +
    '<thead><tr><th style="width:22%">时间/情形</th><th>事件</th><th>可能影响</th></tr></thead>' +
    '<tbody>' + watch.map(w => '<tr><td>' + w.date + '</td><td>' + w.event + '</td><td>' + w.impact + '</td></tr>').join("") + '</tbody></table></div>'
  ));

  document.getElementById("content").innerHTML = h.join("");
  document.getElementById("disc").textContent =
    "本平台仅用于数据展示与统计分析，不构成任何投资建议；数据以公开/授权来源为准，最终以交易所官方发布为准。© 华泰期货 · 研究";

  drawCharts();
}

/* ---- 图表 ---- */
function drawCharts() {
  const data = HISTORY.slice(-30);
  const labels = data.map(d => d.date);
  const prices = data.map(d => d.metrics?.latest_price ?? null);
  const volumes = data.map(d => d.metrics?.volume ?? null);

  const baseOpts = (title, yTitle) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { title: { display: false }, legend: { display: false } },
    scales: {
      x: { ticks: { color: "#8a949e", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
      y: { ticks: { color: "#8a949e" }, grid: { color: "#eef2f6" }, title: { display: !!yTitle, text: yTitle, color: "#8a949e" } },
    },
  });

  if (document.getElementById("priceChart")) {
    new Chart(document.getElementById("priceChart"), {
      type: "line",
      data: { labels, datasets: [{ data: prices, borderColor: "#1f6fb2", backgroundColor: "rgba(31,111,178,.12)", fill: true, tension: .3, pointRadius: 2 }] },
      options: baseOpts("结算价", "¥/kWh"),
    });
  }
  if (document.getElementById("volumeChart")) {
    new Chart(document.getElementById("volumeChart"), {
      type: "bar",
      data: { labels, datasets: [{ data: volumes, backgroundColor: "rgba(31,111,178,.45)" }] },
      options: baseOpts("成交量", "MWh"),
    });
  }
}

function bindSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener("click", e => {
      const t = document.querySelector(a.getAttribute("href"));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
  });
}

boot();
