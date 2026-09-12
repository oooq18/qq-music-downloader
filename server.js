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
// 网易云登录 Cookie（可选；未配置时 128/320 可下载，无损降级 320）
const NC_COOKIE = (process.env.NC_COOKIE || "").trim();

const AES_KEY_HEX = "bd305f10d0ff74b6ef54dab835b5e1cf";
const RESPONSE_XOR_KEY_HEX = "7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81";
const SIGN_XOR_BYTES = [89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com/";
const SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const VKEY_URL = "https://u6.y.qq.com/cgi-bin/musics.fcg";
const STREAM_BASE = "https://isure.stream.qqmusic.qq.com/";

// ---- 网易云音乐 ----
const NC_UA = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154";
const NC_REFERER = "https://music.163.com/";
const NC_AES_KEY = "e82ckenh8dichen8";
const NC_SEARCH_URL = "https://music.163.com/api/cloudsearch/pc";
const NC_URL_API = "https://interface3.music.163.com/eapi/song/enhance/player/url/v1";
const NC_LYRIC_API = "https://interface3.music.163.com/api/song/lyric";

function ncCookie() {
  return NC_COOKIE;
}

function ncEncryptParams(urlPath, payload) {
  const digest = crypto.createHash("md5").update(`nobody${urlPath}use${JSON.stringify(payload)}md5forencrypt`).digest("hex");
  const raw = `${urlPath}-36cd479b6b5-${JSON.stringify(payload)}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(NC_AES_KEY), null);
  return cipher.update(raw, "utf8", "hex") + cipher.final("hex");
}

// ---- 网易云：搜索 ----
async function ncSearch(keyword, page = 1, pageSize = 20) {
  const body = new URLSearchParams({ s: keyword, type: 1, limit: String(pageSize), offset: String((page - 1) * pageSize) });
  const res = await fetch(NC_SEARCH_URL, {
    method: "POST",
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie() },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("网易云搜索服务返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云搜索失败: " + (data.message || data.code));
  const songs = data.result?.songs ?? [];
  const items = songs.map((s) => ({
    songmid: String(s.id),
    songname: s.name || "",
    singer: (s.ar || []).map((a) => a.name).join("/"),
    albumname: s.al?.name || "",
    albummid: s.al ? String(s.al.id) : "",
    picUrl: s.al?.picUrl || "",
    interval: Math.floor((s.dt || 0) / 1000),
    size128: 0,
    size320: 0,
    sizeflac: 0,
  }));
  return { items, total: data.result?.songCount ?? items.length };
}

// ---- 网易云：eapi 播放地址 ----
async function ncGetPlayUrl(id, quality) {
  const level = quality === "flac" ? "lossless" : quality === "320" ? "exhigh" : "standard";
  const payload = {
    ids: [id],
    level,
    encodeType: "flac",
    header: JSON.stringify({ os: "pc", appver: "", osver: "", deviceId: "pyncm!" }),
    requestId: String(Math.floor(Math.random() * 10000000 + 20000000)),
  };
  const params = ncEncryptParams("/api/song/enhance/player/url/v1", payload);
  const body = new URLSearchParams({ params });
  const res = await fetch(NC_URL_API, {
    method: "POST",
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie() },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("网易云接口返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云播放地址获取失败: " + (data.message || data.code));
  const d = data.data?.[0];
  if (!d || !d.url) throw new Error("该歌曲在网易云需要 VIP 会员或无法获取播放地址");
  return { url: d.url, br: d.br || 0, size: d.size || 0, level };
}

// ---- 网易云：封面代理 ----
async function ncGetCover(picUrl, res) {
  let img = picUrl;
  if (!/^https?:/i.test(img)) img = "https:" + img;
  const imgRes = await fetch(img, {
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie() },
    signal: AbortSignal.timeout(10000),
  });
  if (!imgRes.ok) return res.status(502).json({ message: "网易云封面获取失败" });
  res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(await imgRes.arrayBuffer()));
}

// ---- 网易云：歌词 ----
async function ncGetLyric(id) {
  const body = new URLSearchParams({
    id: String(id), cp: "false", tv: "0", lv: "0", rv: "0", kv: "0", yv: "0", ytv: "0", yrv: "0",
  });
  const res = await fetch(NC_LYRIC_API, {
    method: "POST",
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie() },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("网易云歌词接口返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云歌词获取失败: " + (data.message || data.code));
  const lyric = (data.lrc?.lyric || "").replace(/^\uFEFF/, "");
  const tlyric = (data.tlyric?.lyric || "").replace(/^\uFEFF/, "");
  return { lyric, tlyric };
}

function makeCookie() {
  return `uin=${QQ}; qqmusic_key=${AUTHST}; qm_keyst=${AUTHST}; tmeLoginType=1; wxuin=${QQ}`;
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
    singer: (s.singer || []).map((x) => x.name).join(" / "),
    albumname: s.albumname || "",
    interval: s.interval || 0,
    sizeflac: s.sizeflac || 0,
    size320: s.size320 || 0,
    size128: s.size128 || 0,
  }));
  return { items, total };
}

// 获取下载地址（ag-1 协议）
async function getDownloadUrl(songmid, quality) {
  const filename = getFileName(songmid, quality);
  const plainBody = JSON.stringify({
    comm: { ct: 19, cv: 13020508, v: 13020508, format: "json", qq: QQ, authst: AUTHST, tmeLoginType: 1 },
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
      Cookie: makeCookie(),
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
    const source = String(req.query.source || "qq");
    const data = source === "netease" ? await ncSearch(q, page, pageSize) : await search(q, page, pageSize);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || "搜索失败" });
  }
});

app.get("/api/music/download", async (req, res) => {
  try {
    const id = String(req.query.songmid || req.query.hash || "");
    const q = ["flac", "320", "128"].includes(req.query.quality) ? req.query.quality : "320";
    const source = String(req.query.source || "qq");
    if (!id) return res.status(400).json({ message: "songmid 不能为空" });
    if (source === "netease") {
      const info = await ncGetPlayUrl(id, q);
      return res.json({ url: info.url, source: "netease", level: info.level, br: info.br, size: info.size });
    }
    const downloadUrl = await getDownloadUrl(id, q);
    res.json({ url: downloadUrl, source: "qq" });
  } catch (err) {
    res.status(500).json({ message: err.message || "下载失败" });
  }
});

// 封面（代理 QQ 音乐封面图 / 网易云封面图）
app.get("/api/cover", async (req, res) => {
  try {
    const source = String(req.query.source || "qq");
    if (source === "netease") {
      const pic = String(req.query.pic || "");
      if (!pic) return res.status(400).json({ message: "pic 不能为空" });
      return await ncGetCover(pic, res);
    }
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
    const source = String(req.query.source || "qq");
    if (source === "netease") {
      const id = String(req.query.id || "");
      if (!id) return res.status(400).json({ message: "id 不能为空" });
      return res.json(await ncGetLyric(id));
    }
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
    res.json({ lyric });
  } catch (err) {
    res.status(500).json({ message: err.message || "歌词获取失败" });
  }
});

// 健康检查
app.get("/api/health", (req, res) => res.json({ ok: true, authed: Boolean(QQ && AUTHST) }));

// 托管前端静态文件（部署到 Render 时一键全栈）
const clientDir = path.join(__dirname, ".");
app.use(express.static(clientDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QQ 音乐下载器服务已启动: http://localhost:${PORT}`));
