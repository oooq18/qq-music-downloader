// ============================================================
// QQ 音乐下载器 - Cloudflare Workers 版（单文件，直接粘贴部署）
// ============================================================
// 部署步骤：
// 1. 登录 dash.cloudflare.com → 左侧 Workers & Pages → Create application
//    → Create Worker → 名字填 qq-music-downloader → Deploy
// 2. 点 Edit code，删除默认代码，粘贴本文件全部内容 → Deploy
// 3. Settings → Variables and Secrets → Add：
//    QQ     = 你的QQ号
//    AUTHST = 你的QQ音乐登录密钥
// 4. 拿 Worker 域名（https://qq-music-downloader.xxx.workers.dev）
// 5. 把域名填到前端 config.js 的 API_BASE，推送 GitHub 即可
// ============================================================

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json; charset=utf-8",
};

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function makeCookie(env) {
  return `uin=${env.QQ}; qqmusic_key=${env.AUTHST}; qm_keyst=${env.AUTHST}; tmeLoginType=1; wxuin=${env.QQ}`;
}

// AES-128-GCM 加密请求体（输出 = 12字节nonce + 密文 + tag，整体 base64）
async function aesEncrypt(plainText) {
  const key = await crypto.subtle.importKey("raw", hexToBytes(AES_KEY_HEX), { name: "AES-GCM" }, false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plainText);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data);
  const out = new Uint8Array(nonce.length + encrypted.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(encrypted), nonce.length);
  return bytesToBase64(out);
}

// 响应 XOR 解密
function xorDecrypt(buf) {
  const key = hexToBytes(RESPONSE_XOR_KEY_HEX);
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return new TextDecoder().decode(out);
}

// zzc 签名（SHA-1 + 取位 + XOR + base64）
async function generateZzcSign(plainJson) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(plainJson));
  const h = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  let part1 = "";
  for (const idx of [23, 14, 6, 36, 16, 40, 7, 19]) part1 += h[idx];
  let part2 = "";
  for (const idx of [16, 1, 32, 12, 19, 27, 8, 5]) part2 += h[idx];
  const bytes = hexToBytes(h);
  const xorResult = bytes.slice(0, SIGN_XOR_BYTES.length).map((b, i) => b ^ SIGN_XOR_BYTES[i]);
  const part3 = bytesToBase64(xorResult).replace(/[\\/+=\s]/g, "");
  return ("zzc" + part1 + part3 + part2).toLowerCase();
}

function generateGuid() {
  let r = "";
  for (let i = 0; i < 10; i++) r += Math.floor(Math.random() * 10);
  return r;
}

// ---- 酷狗：登录 Cookie（未配置时为空串，免费歌曲仍可下载 128k） ----
function kgCookie(env) {
  const parts = [];
  if (env.KG_UID) parts.push("KugooID=" + env.KG_UID);
  if (env.KG_TOKEN) parts.push("t=" + env.KG_TOKEN);
  if (env.KG_DFID) parts.push("dfid=" + env.KG_DFID + "; kg_dfid=" + env.KG_DFID);
  if (env.KG_MID) parts.push("mid=" + env.KG_MID + "; kg_mid=" + env.KG_MID);
  if (env.KG_USERNAME) parts.push("UserName=" + env.KG_USERNAME);
  return parts.join("; ");
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
  });
  if (!res.ok) throw new Error("搜索服务返回 " + res.status);
  const data = await res.json();
  const list = data?.data?.song?.list ?? [];
  const total = data?.data?.song?.totalnum ?? 0;
  const items = list.map((s) => ({
    songmid: s.songmid || "",
    songname: s.songname || "",
    singer: (s.singer || []).map((x) => x.name).join(" / "),
    albumname: s.albumname || "",
    albummid: s.albummid || "",
    interval: s.interval || 0,
    sizeflac: s.sizeflac || 0,
    size320: s.size320 || 0,
    size128: s.size128 || 0,
  }));
  return { items, total };
}

// 封面图片（Worker 代理，附带 CORS 头供前端 fetch）
async function getCover(albummid) {
  const img = await fetch(`https://y.qq.com/music/photo_new/T002R800x800M000${albummid}_2.jpg?max_age=2592000`, {
    headers: { "User-Agent": UA, Referer: REFERER },
  });
  if (!img.ok) throw new Error("封面获取失败");
  const buf = await img.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": img.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// 歌词（LRC 文本）
async function getLyric(songmid) {
  const lr = await fetch(
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json`,
    { headers: { Referer: REFERER, "User-Agent": UA } }
  );
  if (!lr.ok) throw new Error("歌词获取失败");
  const lj = await lr.json();
  let lyric = "";
  if (lj && lj.lyric) {
    lyric = decodeURIComponent(escape(atob(lj.lyric)));
  }
  return { lyric };
}

// 获取下载地址（ag-1 协议）
async function getDownloadUrl(songmid, quality, env) {
  if (!env.QQ || !env.AUTHST) throw new Error("服务端未配置 QQ/AUTHST 登录态");
  const filename = getFileName(songmid, quality);
  const plainBody = JSON.stringify({
    comm: { ct: 19, cv: 13020508, v: 13020508, format: "json", qq: env.QQ, authst: env.AUTHST, tmeLoginType: 1 },
    "music.vkey.GetVkey.UrlGetVkey": {
      module: "music.vkey.GetVkey",
      method: "UrlGetVkey",
      param: { filename: [filename], guid: generateGuid(), songmid: [songmid], songtype: [0] },
    },
  });
  const sign = await generateZzcSign(plainBody);
  const body = await aesEncrypt(plainBody);
  const url = `${VKEY_URL}?_=${Date.now()}&encoding=ag-1&sign=${sign}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Referer: REFERER,
      Origin: "https://y.qq.com",
      Accept: "application/octet-stream",
      Cookie: makeCookie(env),
      "User-Agent": UA,
    },
    body,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = xorDecrypt(buf);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("下载地址解析失败");
  }

  const inner = result?.["music.vkey.GetVkey.UrlGetVkey"] ?? {};
  if (inner.code === 2000 || inner.code === 1000 || result.code === 2000) {
    throw new Error("登录态已失效，请更新 QQ 音乐登录密钥");
  }
  const purl = inner?.data?.midurlinfo?.[0]?.purl;
  if (!purl) throw new Error("该音质暂无版权或无法获取下载地址");
  const sip = inner?.data?.sip?.[0] || STREAM_BASE;
  return sip + purl;
}

// ---- 酷狗：搜索 ----
async function kgSearch(keyword, page = 1, pageSize = 20, env = {}) {
  const params = new URLSearchParams({
    keyword, page: String(page), pagesize: String(pageSize), platform: "WebFilter",
    userid: "-1", clientver: "2000", iscorrection: "1", filter: "2",
  });
  const res = await fetch(`${KG_SEARCH_URL}?${params}`, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie(env) },
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

// ---- 酷狗：歌曲详情（播放地址 / 封面 / 时长） ----
async function kgGetInfo(hash, env = {}) {
  const url = `${KG_INFO_URL}?cmd=playInfo&hash=${encodeURIComponent(hash)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie(env) },
  });
  if (!res.ok) throw new Error("酷狗接口返回 " + res.status);
  return await res.json();
}

async function kgGetPlayUrl(hash, env = {}) {
  const d = await kgGetInfo(hash, env);
  if (!d.url) throw new Error("该歌曲在酷狗需要 VIP 会员或无法获取下载地址");
  return d.url;
}

// ---- 酷狗：封面（代理 imge.kugou.com） ----
async function kgGetCover(hash, env = {}) {
  const d = await kgGetInfo(hash, env);
  let img = d.album_img || "";
  img = img.replace("{size}", "400");
  if (!/^https?:/i.test(img)) img = "https:" + img;
  const imgRes = await fetch(img, {
    headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie(env) },
  });
  if (!imgRes.ok) throw new Error("酷狗封面获取失败");
  const buf = await imgRes.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": imgRes.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ---- 酷狗：歌词（krcs 搜索 + fmt=lrc 明文下载） ----
async function kgGetLyric(hash, env = {}) {
  const d = await kgGetInfo(hash, env);
  const songname = d.songName || "";
  const duration = Math.max(0, Math.ceil((d.timeLength || 0) / 1000));
  const sres = await fetch(
    `${KG_LRC_SEARCH_URL}?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(songname)}&duration=${duration}&hash=${encodeURIComponent(hash)}`,
    { headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie(env) } }
  );
  const sj = await sres.json();
  const cand = (sj.candidates || [])[0];
  if (!cand) return { lyric: "" };
  const lres = await fetch(
    `${KG_LRC_DL_URL}?ver=1&client=mobi&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}&fmt=lrc&charset=utf8`,
    { headers: { "User-Agent": KG_UA, Referer: KG_REFERER, Cookie: kgCookie(env) } }
  );
  const lj = await lres.json();
  let lyric = "";
  if (lj.content) {
    try { lyric = decodeURIComponent(escape(atob(lj.content))); } catch (_) {}
  }
  return { lyric: lyric.replace(/^\uFEFF/, "") };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, authed: Boolean(env.QQ && env.AUTHST) });
      }
      if (url.pathname === "/api/music/search") {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ message: "搜索关键词不能为空" }, 400);
        const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
        const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 20));
        const source = url.searchParams.get("source") || "qq";
        if (source === "kugou") return json(await kgSearch(q, page, pageSize, env));
        return json(await search(q, page, pageSize));
      }
      if (url.pathname === "/api/music/download") {
        const songmid = url.searchParams.get("songmid") || url.searchParams.get("hash") || "";
        const quality = ["flac", "320", "128"].includes(url.searchParams.get("quality"))
          ? url.searchParams.get("quality")
          : "320";
        const source = url.searchParams.get("source") || "qq";
        if (!songmid) return json({ message: "songmid/hash 不能为空" }, 400);
        if (source === "kugou") {
          const streamUrl = await kgGetPlayUrl(songmid, env);
          return json({ url: streamUrl, source: "kugou" });
        }
        const streamUrl = await getDownloadUrl(songmid, quality, env);
        return json({ url: streamUrl, source: "qq" });
      }
      if (url.pathname === "/api/cover") {
        const source = url.searchParams.get("source") || "qq";
        if (source === "kugou") {
          const hash = url.searchParams.get("hash") || "";
          if (!hash) return json({ message: "hash 不能为空" }, 400);
          return await kgGetCover(hash, env);
        }
        const albummid = url.searchParams.get("albummid") || "";
        if (!albummid) return json({ message: "albummid 不能为空" }, 400);
        return await getCover(albummid);
      }
      if (url.pathname === "/api/lyric") {
        const source = url.searchParams.get("source") || "qq";
        if (source === "kugou") {
          const hash = url.searchParams.get("hash") || "";
          if (!hash) return json({ message: "hash 不能为空" }, 400);
          return json(await kgGetLyric(hash, env));
        }
        const songmid = url.searchParams.get("songmid") || "";
        if (!songmid) return json({ message: "songmid 不能为空" }, 400);
        return json(await getLyric(songmid));
      }
      return json({ message: "Not Found" }, 404);
    } catch (err) {
      return json({ message: err.message || "服务错误" }, 500);
    }
  },
};
