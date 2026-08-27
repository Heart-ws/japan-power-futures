// 日本电力期货数据日报 - 前端逻辑（华泰期货风格外壳，数据驱动）
// 读取 ./data/latest.json 与 ./data/history.json（由每日自动更新脚本生成）

const METRICS = [
  { key: "latest_price", label: "系统价格(日均)", unit: "円/kWh" },
  { key: "change_pct",   label: "日环比",         unit: "%" },
  { key: "volume",       label: "约定总量",       unit: "MWh" },
  { key: "tokyo_price",  label: "东京区域价格",   unit: "円/kWh" },
  { key: "spread",       label: "日内峰谷价差",   unit: "円/kWh" },
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
  const cp = m.change_pct;   // 修正：change_pct 位于 metrics 内，原先读顶层恒为 undefined
  const updated = LATEST?.updated_at || "";
  const jepxRaw = LATEST?.raw?.jepx;
  const hasJEPX = !!(jepxRaw && Object.keys(jepxRaw).length > 0);
  const slots = jepxRaw?.slots || 0;
  const fresh = isFresh(updated);
  const statusCls = fresh ? "ok" : "warn";
  const statusText = fresh ? "更新正常" : "更新可能延迟";
  document.getElementById("cover-card").innerHTML =
    '<div class="cover-meta">' +
      '<span class="pill pill-blue">日本电力期货</span>' +
      '<span class="pill pill-gray">每日数据跟踪</span>' +
    '</div>' +
    '<h1>日本电力市场（JEPX）每日数据日报</h1>' +
    '<p class="subtitle">数据看板 · 历史趋势 · 每日 09:30 自动更新</p>' +
    '<div class="cover-info">' +
      '<div><div class="k">交割日</div><div class="v">' + (LATEST?.date || "—") + '</div></div>' +
      '<div><div class="k">系统价格(日均)</div><div class="v">' + fmt(m.latest_price) + ' 円/kWh</div></div>' +
      '<div><div class="k">日环比</div><div class="v ' + chgClass(cp) + '">' + (cp >= 0 ? "+" : "") + fmt(cp) + '%</div></div>' +
      '<div><div class="k">研究机构</div><div class="v">华泰期货 · 研究</div></div>' +
    '</div>' +
    '<div class="status-bar ' + statusCls + '">' +
      '<span class="sb-dot"></span>' +
      '<span>最后更新：' + fmtTime(updated) + '</span>' +
      '<span class="sb-sep">·</span>' +
      '<span class="src-badge ' + (hasJEPX ? "on" : "off") + '">JEPX 官方数据 ' + (hasJEPX ? "✓" : "—") + '</span>' +
      '<span class="src-badge ' + (slots >= 48 ? "on" : "off") + '">' + (slots ? slots + "/48 时段" : "时段缺失") + '</span>' +
      '<span class="sb-status">' + statusText + '</span>' +
    '</div>';
}

/* ---- 目录 ---- */
function renderToc() {
  const items = [
    ["overview", "一、市场概览"],
    ["contracts", "二、重点行情表"],
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
    '<p>以下为日本电力市场（JEPX 现货 / day-ahead）最新交割日核心指标与近期走势。数据直接取自 ' +
    '<b>JEPX 日本卸電力取引所官方公开数据</b>（每日 48 个 30 分钟时段），每日 09:30 自动抓取刷新。' +
    '系统价格（システムプライス）为全国统一出清价，是日本电力衍生品的基准结算参考。</p>' +
    '<div class="index-grid">' + cards + '</div>' +
    '<div class="chart-box"><div class="cb-title">系统价格走势（近 30 日，円/kWh）</div><div class="canvas-wrap"><canvas id="priceChart"></canvas></div></div>' +
    '<div class="chart-box"><div class="cb-title">约定总量走势（近 30 日，MWh）</div><div class="canvas-wrap"><canvas id="volumeChart"></canvas></div></div>'
  ));

  /* 二、重点行情表（近期交割日 + 区域价格） */
  const recent = HISTORY.slice(-12).reverse();
  const rows = recent.map(r => {
    const mm = r.metrics || {};
    return '<tr><td>' + r.date + '</td>' +
      '<td class="num">' + fmt(mm.latest_price) + '</td>' +
      '<td class="num ' + chgClass(mm.change_pct) + '">' + (mm.change_pct >= 0 ? "+" : "") + fmt(mm.change_pct) + '%</td>' +
      '<td class="num">' + fmt(mm.volume, 0) + '</td>' +
      '<td class="num">' + fmt(mm.tokyo_price) + '</td>' +
      '<td class="num">' + fmt(mm.spread) + '</td></tr>';
  }).join("");

  // 最新交割日 9 区域价格
  const areas = LATEST?.area_avg || {};
  const labels = LATEST?.area_labels || {};
  const sysAvg = m.latest_price;
  const areaRows = Object.keys(areas).map(k => {
    const v = areas[k];
    const diff = (v !== null && sysAvg) ? v - sysAvg : null;
    return '<tr><td>' + (labels[k] || k) + '</td>' +
      '<td class="num">' + fmt(v) + '</td>' +
      '<td class="num ' + chgClass(diff) + '">' + (diff > 0 ? "+" : "") + fmt(diff) + '</td></tr>';
  }).join("");

  h.push(sec("contracts", "二、", "重点行情表",
    '<div class="cb-title" style="margin-bottom:8px">近期交割日行情（JEPX 现货）</div>' +
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>交割日</th><th class="num">系统价格(円/kWh)</th><th class="num">日环比</th>' +
    '<th class="num">约定总量(MWh)</th><th class="num">东京价格(円/kWh)</th><th class="num">峰谷价差</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="6" class="muted-note">暂无数据</td></tr>') + '</tbody></table></div>' +
    '<div class="cb-title" style="margin:18px 0 8px">最新交割日各区域价格（対 系统价格偏离）</div>' +
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>区域</th><th class="num">区域价格(円/kWh)</th><th class="num">对系统价偏离</th></tr></thead>' +
    '<tbody>' + (areaRows || '<tr><td colspan="3" class="muted-note">暂无数据</td></tr>') + '</tbody></table></div>'
  ));

  /* 三、市场新闻与动态 */
  const news = [
    { title: "已接入 JEPX 官方数据源，每日自动更新上线", source: "华泰期货 · 研究", type: "官方",
      summary: "平台已直连 JEPX 日本卸電力取引所官方公开数据，每日 09:30 自动抓取全部 48 个 30 分钟时段并聚合入库，客户打开网页即可查看最新交割日数据。" },
    { title: "数据来源与口径说明", source: "华泰期货 · 研究", type: "行业媒体",
      summary: "系统价格（システムプライス）为 JEPX 现货市场全国统一出清价；区域价格反映各输配电区域的阻塞情况。约定总量为当日 48 时段成交电量合计，单位 MWh。最终以交易所官方发布为准。" },
    { title: "夏季制冷与冬季采暖的季节性影响", source: "市场观察", type: "行业媒体",
      summary: "极端气温显著抬升日内与峰值负荷，推高日内峰谷价差；建议结合区域价格偏离观察输电阻塞与季节性供需变化。" },
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
    { date: "每日 09:30", event: "数据自动抓取与重新部署", impact: "网页展示截至最新交割日的 JEPX 数据" },
    { date: "JEPX 数据延迟", event: "官方 CSV 未及时更新", impact: "报头状态条转为「更新可能延迟」，数据沿用上一交割日" },
    { date: "极端天气", event: "价格异动风险", impact: "关注峰谷价差走阔与区域价格大幅偏离系统价" },
  ];
  h.push(sec("watchlist", "五、", "关注事项",
    '<div class="table-wrap"><table>' +
    '<thead><tr><th style="width:22%">时间/情形</th><th>事件</th><th>可能影响</th></tr></thead>' +
    '<tbody>' + watch.map(w => '<tr><td>' + w.date + '</td><td>' + w.event + '</td><td>' + w.impact + '</td></tr>').join("") + '</tbody></table></div>'
  ));

  document.getElementById("content").innerHTML = h.join("");
  document.getElementById("disc").textContent =
    "本平台仅用于数据展示与统计分析，不构成任何投资建议；数据来源为 JEPX 日本卸電力取引所公开数据，最终以交易所官方发布为准。© 华泰期货 · 研究";

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
      options: baseOpts("系统价格", "円/kWh"),
    });
  }
  if (document.getElementById("volumeChart")) {
    new Chart(document.getElementById("volumeChart"), {
      type: "bar",
      data: { labels, datasets: [{ data: volumes, backgroundColor: "rgba(31,111,178,.45)" }] },
      options: baseOpts("约定总量", "MWh"),
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
