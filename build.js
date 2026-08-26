// 构建脚本：将 src/ 与 data/ 打包到 dist/，生成可直接由 Netlify 发布的静态站点。
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 重建 dist（覆盖式复制；避免调用 rmSync 以适配安全删除拦截环境）
fs.mkdirSync(dist, { recursive: true });

copyDir(path.join(root, "src"), dist);     // 前端页面（含 _redirects）
copyDir(path.join(root, "data"), path.join(dist, "data")); // 数据（latest/history）

console.log(`[build] 发布目录已生成：dist/ （${fs.readdirSync(dist).join(", ")}）`);
