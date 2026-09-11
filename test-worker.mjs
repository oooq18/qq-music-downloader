// 验证 worker.js（Cloudflare Workers 版）在 Node 下端到端可用
import { readFileSync } from "node:fs";

const envRaw = readFileSync(new URL("./.env", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
console.log("登录态:", env.QQ ? "已加载" : "缺失", "|", env.AUTHST ? "已加载" : "缺失");

const worker = (await import("./worker.js")).default;

// 1. 健康检查
const h = await worker.fetch(new Request("https://test/api/health"), env);
console.log("health:", h.status, await h.text());

// 2. 搜索
const s = await worker.fetch(new Request("https://test/api/music/search?q=" + encodeURIComponent("反方向的钟")), env);
const sj = await s.json();
console.log("搜索:", s.status, "总数", sj.total, "| 第一条:", sj.items?.[0]?.songname, "-", sj.items?.[0]?.singer);

// 3. 获取 FLAC 下载地址（ag-1 协议）
const d = await worker.fetch(new Request("https://test/api/music/download?songmid=0017K7gL4WYnw2&quality=flac"), env);
const dj = await d.json();
console.log("下载:", d.status, "| 流地址:", dj.url || dj.message);

// 4. 验证流地址可访问
if (dj.url) {
  const head = await fetch(dj.url, { method: "HEAD" }).catch(() => null);
  console.log("流地址 HEAD:", head ? head.status + " " + head.headers.get("content-type") : "不可达");
}
