// QQ 音乐下载器后端（Node.js + Express）
// 实现搜索、ag-1 加密协议获取下载地址、流式下载
// 登录态从环境变量读取（.env 文件），不要硬编码在代码里
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 登录态（从环境变量读取；QQ=QQ号，AUTHST=登录密钥）
const QQ = process.env.QQ || "";
const AUTHST = process.env.AUTHST || "";

// 多账号（ACCOUNTS = JSON 字符串），与 worker.js 保持同构
function parseAccounts() {
  let accs = [];
  try {
    const arr = JSON.parse(process.env.ACCOUNTS || "[]");
    if (Array.isArray(arr)) accs = arr;
  } catch (_) {}
  const clean = accs
    .filter((a) => a && a.qq && a.authst)
    .map((a) => ({ name: a.name || "账号", qq: String(a.qq), authst: a.authst, cookie: a.cookie || "" }));
  if (QQ && AUTHST && !clean.some((a) => a.qq === QQ)) {
    clean.unshift({ name: "主账号", qq: QQ, authst: AUTHST, cookie: process.env.QQ_COOKIE || "" });
  }
  return clean;
}
function findAccount(key) {
  const accs = parseAccounts();
  if (!accs.length) return null;
  if (key) {
    const hit = accs.find((a) => a.qq === key || a.name === key);
    if (hit) return hit;
  }
  return accs[0];
}

const AES_KEY_HEX = "bd305f10d0ff74b6ef54dab835b5e1cf";
const RESPONSE_XOR_KEY_HEX = "7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81";
const SIGN_XOR_BYTES = [89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com/";
const SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const VKEY_URL = "https://u6.y.qq.com/cgi-bin/musics.fcg";
const STREAM_BASE = "https://isure.stream.qqmusic.qq.com/";


function makeCookie(acc) {
  // 优先使用完整登录态（含 euin/uikey 等绿钻身份 cookie）
  if (acc && acc.cookie) return acc.cookie;
  if (process.env.QQ_COOKIE) return process.env.QQ_COOKIE;
  const a = acc || { qq: QQ, authst: AUTHST };
  return `uin=${a.qq}; qqmusic_key=${a.authst}; qm_keyst=${a.authst}; tmeLoginType=1; wxuin=${a.qq}`;
}

// AES-256-GCM（16字节密钥 = AES-128-GCM）加密请求体
function aesEncrypt(plainText) {
  const key = Buffer.from(AES_KEY_HEX, "hex");
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([nonce, encrypted]).toString("base64");
}

// 响应 XOR 解密
function xorDecrypt(buffer) {
  const key = Buffer.from(RESPONSE_XOR_KEY_HEX, "hex");
  const out = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] ^ key[i % key.length];
  return out.toString("utf8");
}

// zzc 签名
function generateZzcSign(plainJson) {
  const h = crypto.createHash("sha1").update(plainJson).digest("hex").toUpperCase();
  let part1 = "";
  for (const idx of [23, 14, 6, 36, 16, 40, 7, 19]) if (idx < h.length) part1 += h[idx];
  let part2 = "";
  for (const idx of [16, 1, 32, 12, 19, 27, 8, 5]) if (idx < h.length) part2 += h[idx];
  const bytes = [];
  for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.substring(i, i + 2), 16));
  const xorResult = bytes.slice(0, SIGN_XOR_BYTES.length).map((b, i) => b ^ SIGN_XOR_BYTES[i]);
  const part3 = Buffer.from(xorResult).toString("base64").replace(/[\\/+=\s]/g, "");
  return ("zzc" + part1 + part3 + part2).toLowerCase();
}

function generateGuid() {
  let r = "";
  for (let i = 0; i < 10; i++) r += Math.floor(Math.random() * 10);
  return r;
}

function getFileName(songmid, quality) {
  if (quality === "flac") return `F000${songmid}${songmid}.flac`;
  if (quality === "320") return `M800${songmid}${songmid}.mp3`;
  return `M500${songmid}${songmid}.mp3`;
}

// 搜索
async function search(keyword, page = 1, pageSize = 20) {
  const params = new URLSearchParams({ w: keyword, format: "json", n: String(pageSize), p: String(page), cr: "1", aggr: "0", t: "0" });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Referer: REFERER, "User-Agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  const list = data?.data?.song?.list ?? [];
  const total = data?.data?.song?.totalnum ?? 0;
  const items = list.map((s) => ({
    songmid: s.songmid || "",
    albummid: s.albummid || "",
    songname: s.songname || "",
    singer: (s.singer || []).map((x) => x.name).join("、"),
    albumname: s.albumname || "",
    interval: s.interval || 0,
    sizeflac: s.sizeflac || 0,
    size320: s.size320 || 0,
    size128: s.size128 || 0,
    vip: (s.pay && s.pay.payplay === 1) ? true : false,
  }));
  return { items, total };
}

// 获取下载地址（ag-1 协议）
async function getDownloadUrl(songmid, quality, acc) {
  const filename = getFileName(songmid, quality);
  const plainBody = JSON.stringify({
    comm: { ct: 19, cv: 13020508, v: 13020508, format: "json", qq: acc.qq, authst: acc.authst, tmeLoginType: 1 },
    "music.vkey.GetVkey.UrlGetVkey": {
      module: "music.vkey.GetVkey",
      method: "UrlGetVkey",
      param: { filename: [filename], guid: generateGuid(), songmid: [songmid], songtype: [0] },
    },
  });
  const sign = generateZzcSign(plainBody);
  const body = aesEncrypt(plainBody);
  const url = `${VKEY_URL}?_=${Date.now()}&encoding=ag-1&sign=${sign}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Referer: REFERER,
      Origin: "https://y.qq.com",
      Accept: "application/octet-stream",
      Cookie: makeCookie(acc),
      "User-Agent": UA,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = xorDecrypt(buf);
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("下载地址解析失败"); }

  const inner = result?.["music.vkey.GetVkey.UrlGetVkey"] ?? {};
  if (inner.code === 2000 || inner.code === 1000 || result.code === 2000) {
    throw new Error("登录态已失效，请更新 QQ 音乐登录密钥");
  }
  const purl = inner?.data?.midurlinfo?.[0]?.purl;
  if (!purl) throw new Error("该音质暂无版权或无法获取下载地址");
  const sip = inner?.data?.sip?.[0] || STREAM_BASE;
  return sip + purl;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/music/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "搜索关键词不能为空" });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));
    res.json(await search(q, page, pageSize));
  } catch (err) {
    res.status(500).json({ message: err.message || "搜索失败" });
  }
});

app.get("/api/music/download", async (req, res) => {
  try {
    const id = String(req.query.songmid || req.query.hash || "");
    const q = ["flac", "320", "128"].includes(req.query.quality) ? req.query.quality : "320";
    if (!id) return res.status(400).json({ message: "songmid 不能为空" });
    const acc = findAccount(String(req.query.account || ""));
    if (!acc) return res.status(500).json({ message: "服务端未配置账号" });
    const downloadUrl = await getDownloadUrl(id, q, acc);
    res.json({ url: downloadUrl, source: "qq", account: acc.qq });
  } catch (err) {
    res.status(500).json({ message: err.message || "下载失败" });
  }
});

// 封面（代理 QQ 音乐封面图）
app.get("/api/cover", async (req, res) => {
  try {
    const albummid = String(req.query.albummid || "");
    if (!albummid) return res.status(400).json({ message: "albummid 不能为空" });
    const img = await fetch(`https://y.qq.com/music/photo_new/T002R800x800M000${albummid}_2.jpg?max_age=2592000`, {
      headers: { "User-Agent": UA, Referer: REFERER },
    });
    if (!img.ok) return res.status(502).json({ message: "封面获取失败" });
    res.setHeader("Content-Type", img.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await img.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ message: err.message || "封面获取失败" });
  }
});

// 歌词
app.get("/api/lyric", async (req, res) => {
  try {
    const songmid = String(req.query.songmid || "");
    if (!songmid) return res.status(400).json({ message: "songmid 不能为空" });
    const lr = await fetch(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json`,
      { headers: { Referer: REFERER, "User-Agent": UA } }
    );
    if (!lr.ok) return res.status(502).json({ message: "歌词获取失败" });
    const lj = await lr.json();
    let lyric = "";
    if (lj && lj.lyric) lyric = decodeURIComponent(escape(Buffer.from(lj.lyric, "base64").toString("binary")));
    if (String(req.query.download || "") === "1") {
      const fname = String(req.query.fname || "歌词");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fname)}.lrc`);
      return res.send(lyric);
    }
    res.json({ lyric });
  } catch (err) {
    res.status(500).json({ message: err.message || "歌词获取失败" });
  }
});

// 健康检查
app.get("/api/health", (req, res) => {
  const accs = parseAccounts();
  res.json({ ok: true, authed: accs.length > 0, accounts: accs.length });
});

// 账号列表 + VIP 探测
app.get("/api/accounts", async (req, res) => {
  try {
    const accs = parseAccounts();
    if (!accs.length) return res.status(500).json({ ok: false, message: "服务端未配置账号" });
    const probeSongmid = "0039MnYb0qxYhV"; // 周杰伦《晴天》VIP 独占探测
    const maskQq = (q) => {
      const s = String(q);
      return s.length <= 6 ? s : s.slice(0, 3) + "****" + s.slice(-4);
    };
    const list = [];
    for (const a of accs) {
      let vip = false;
      let error = "";
      try {
        await getDownloadUrl(probeSongmid, "flac", a);
        vip = true;
      } catch (err) {
        const msg = err.message || "";
        if (msg.includes("登录态")) error = "登录失效";
        else vip = false;
      }
      list.push({ name: a.name, qq: a.qq, vip, error });
    }
    const current = findAccount(String(req.query.current || "")).qq;
    res.json({ ok: true, accounts: list, current });
  } catch (err) {
    res.status(500).json({ message: err.message || "账号查询失败" });
  }
});
// 音频代理：绕过 CDN 的 CORS 限制
app.get("/api/stream", async (req, res) => {
  try {
    const target = String(req.query.url || "");
    if (!/^https?:\/\/([\w-]+\.)*(y\.qq\.com|stream\.qqmusic\.qq\.com|qqmusic\.qq\.com)\//i.test(target)) {
      return res.status(400).json({ ok: false, message: "仅允许音乐 CDN 地址" });
    }
    const r = await fetch(target, { headers: { "User-Agent": UA, Referer: REFERER } });
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.set("Content-Length", r.headers.get("content-length") || "");
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.status(502).json({ ok: false, message: "代理失败: " + err.message });
  }
});

// 托管前端静态文件（部署到 Render 时一键全栈）
const clientDir = path.join(__dirname, ".");
app.use(express.static(clientDir));

const PORT = process.env.PORT || 9000;
app.listen(PORT, () => console.log(`QQ 音乐下载器服务已启动: http://localhost:${PORT}`));