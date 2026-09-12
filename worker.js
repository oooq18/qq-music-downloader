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

// 歌词（LRC 文本 + 翻译）
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
  let trans = "";
  if (lj && lj.trans) {
    try {
      trans = decodeURIComponent(escape(atob(lj.trans)));
    } catch (_) { trans = ""; }
  }
  return { lyric, trans };
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
        return json(await search(q, page, pageSize));
      }
      if (url.pathname === "/api/music/download") {
        const songmid = url.searchParams.get("songmid") || "";
        const quality = ["flac", "320", "128"].includes(url.searchParams.get("quality"))
          ? url.searchParams.get("quality")
          : "320";
        if (!songmid) return json({ message: "songmid 不能为空" }, 400);
        const streamUrl = await getDownloadUrl(songmid, quality, env);
        return json({ url: streamUrl });
      }
      if (url.pathname === "/api/cover") {
        const albummid = url.searchParams.get("albummid") || "";
        if (!albummid) return json({ message: "albummid 不能为空" }, 400);
        return await getCover(albummid);
      }
      if (url.pathname === "/api/lyric") {
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
