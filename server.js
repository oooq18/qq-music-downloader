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
// 酷狗登录态（可选；未配置时免费歌曲仍可下载 128k）
const KG_UID = process.env.KG_UID || "";
const KG_TOKEN = process.env.KG_TOKEN || "";
const KG_DFID = process.env.KG_DFID || "";
const KG_MID = process.env.KG_MID || "";
const KG_USERNAME = process.env.KG_USERNAME || "";

const AES_KEY_HEX = "bd305f10d0ff74b6ef54dab835b5e1cf";
const RESPONSE_XOR_KEY_HEX = "7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81";
const SIGN_XOR_BYTES = [89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com/";
const SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const VKEY_URL = "https://u6.y.qq.com/cgi-bin/musics.fcg";
const STREAM_BASE = "https://isure.stream.qqmusic.qq.com/";

// ---- 酷狗音乐 ----
const KG_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const KG_REFERER = "https://m.kugou.com/";
const KG_SEARCH_URL = "https://songsearch.kugou.com/song_search_v2";
const KG_INFO_URL = "https://m.kugou.com/app/i/getSongInfo.php";
const KG_LRC_SEARCH_URL = "https://krcs.kugou.com/search";
const KG_LRC_DL_URL = "https://lyrics.kugou.com/download";

function kgCookie() {
  const parts = [];
  if (KG_UID) parts.push("KugooID=" + KG_UID);
  if (KG_TOKEN) parts.push("t=" + KG_TOKEN);
  if (KG_DFID) parts.push("dfid=" + KG_DFID + "; kg_dfid=" + KG_DFID);
  if (KG_MID) parts.push("mid=" + KG_MID + "; kg_mid=" + KG_MID);
  if (KG_USERNAME) parts.push("UserName=" + KG_USERNAME);
  return parts.join("; ");
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

// ---- 酷狗：搜索 ----
async function kgSearch(keyword, page = 1, pageSize = 20) {
  const params = new URLSearchParams({
    keyword, page: String(page), pagesize: String(pageSize), platform: "WebFilter",
    userid: "-1", clientver: "2000", iscorrection: "1", filter: "2",
  });
  const res = await fetch(`${KG_SEARCH_URL}?${params}`, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie() },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("酷狗搜索服务返回 " + res.status);
  const data = await res.json();
  const lists = data?.data?.lists ?? [];
  const items = lists.map((s) => {
    const fn = String(s.FileName || "");
    const dash = fn.indexOf(" - ");
    const singer = s.SingerName || (dash > 0 ? fn.slice(0, dash) : "");
    const songname = s.SongName || (dash > 0 ? fn.slice(dash + 3) : fn);
    return {
      songmid: s.FileHash || "",
      hash: s.FileHash || "",
      hash320: s.HQFileHash || "",
      hashFlac: s.SQFileHash || "",
      songname,
      singer,
      albumname: s.AlbumName || "",
      album_id: s.AlbumID ? String(s.AlbumID) : "",
      interval: s.Duration || 0,
      sizeflac: s.SQFileSize || 0,
      size320: s.HQFileSize || 0,
      size128: s.FileSize || 0,
      vip128: s.Privilege !== 0,
      vip320: s.HQPrivilege !== 0,
      vipFlac: s.SQPrivilege !== 0,
    };
  });
  return { items, total: data?.data?.total ?? items.length };
}

// ---- 酷狗：歌曲详情 ----
async function kgGetInfo(hash) {
  const url = `${KG_INFO_URL}?cmd=playInfo&hash=${encodeURIComponent(hash)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie() },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("酷狗接口返回 " + res.status);
  return await res.json();
}

async function kgGetPlayUrl(hash) {
  const d = await kgGetInfo(hash);
  if (!d.url) throw new Error("该歌曲在酷狗需要 VIP 会员或无法获取下载地址");
  return d.url;
}

async function kgGetCover(hash, res) {
  const d = await kgGetInfo(hash);
  let img = d.album_img || "";
  img = img.replace("{size}", "400");
  if (!/^https?:/i.test(img)) img = "https:" + img;
  const imgRes = await fetch(img, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie() },
    signal: AbortSignal.timeout(10000),
  });
  if (!imgRes.ok) return res.status(502).json({ message: "酷狗封面获取失败" });
  res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(await imgRes.arrayBuffer()));
}

async function kgGetLyric(hash) {
  const d = await kgGetInfo(hash);
  const songname = d.songName || "";
  const duration = Math.max(0, Math.ceil((d.timeLength || 0) / 1000));
  const sres = await fetch(
    `${KG_LRC_SEARCH_URL}?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(songname)}&duration=${duration}&hash=${encodeURIComponent(hash)}`,
    { headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie() }, signal: AbortSignal.timeout(10000) }
  );
  const sj = await sres.json();
  const cand = (sj.candidates || [])[0];
  if (!cand) return { lyric: "" };
  const lres = await fetch(
    `${KG_LRC_DL_URL}?ver=1&client=mobi&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}&fmt=lrc&charset=utf8`,
    { headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie() }, signal: AbortSignal.timeout(10000) }
  );
  const lj = await lres.json();
  let lyric = "";
  if (lj.content) {
    try { lyric = decodeURIComponent(escape(Buffer.from(lj.content, "base64").toString("binary"))); } catch (_) {}
  }
  return { lyric: lyric.replace(/^\uFEFF/, "") };
}

app.get("/api/music/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "搜索关键词不能为空" });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));
    const source = String(req.query.source || "qq");
    const data = source === "kugou" ? await kgSearch(q, page, pageSize) : await search(q, page, pageSize);
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
    if (!id) return res.status(400).json({ message: "songmid/hash 不能为空" });
    if (source === "kugou") {
      const downloadUrl = await kgGetPlayUrl(id);
      return res.json({ url: downloadUrl, source: "kugou" });
    }
    const downloadUrl = await getDownloadUrl(id, q);
    res.json({ url: downloadUrl, source: "qq" });
  } catch (err) {
    res.status(500).json({ message: err.message || "下载失败" });
  }
});

// 封面（代理 QQ 音乐封面图 / 酷狗封面图）
app.get("/api/cover", async (req, res) => {
  try {
    const source = String(req.query.source || "qq");
    if (source === "kugou") {
      const hash = String(req.query.hash || "");
      if (!hash) return res.status(400).json({ message: "hash 不能为空" });
      return await kgGetCover(hash, res);
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
    if (source === "kugou") {
      const hash = String(req.query.hash || "");
      if (!hash) return res.status(400).json({ message: "hash 不能为空" });
      return res.json(await kgGetLyric(hash));
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
