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

// ---- 网易云音乐 ----
const NC_UA = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154";
const NC_REFERER = "https://music.163.com/";
const NC_AES_KEY = "e82ckenh8dichen8";
const NC_SEARCH_URL = "https://music.163.com/api/cloudsearch/pc";
const NC_URL_API = "https://interface3.music.163.com/eapi/song/enhance/player/url/v1";
const NC_LYRIC_API = "https://interface3.music.163.com/api/song/lyric";
const NC_DETAIL_API = "https://interface3.music.163.com/api/v3/song/detail";

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

// ---- 网易云：eapi 加密（AES-128-ECB） ----
const AES_SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
const AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aesKeySchedule(keyBytes) {
  const Nk = 4, Nr = 10, Nb = 4;
  const w = new Uint8Array(Nb * (Nr + 1) * 4);
  for (let i = 0; i < Nk * 4; i++) w[i] = keyBytes[i];
  let i = Nk * 4;
  while (i < Nb * (Nr + 1) * 4) {
    let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
    if (i / 4 % Nk === 0) {
      const tmp = t0;
      t0 = AES_SBOX[t1] ^ AES_RCON[i / 4 / Nk - 1];
      t1 = AES_SBOX[t2];
      t2 = AES_SBOX[t3];
      t3 = AES_SBOX[tmp];
    }
    w[i] = w[i - Nk * 4] ^ t0;
    w[i + 1] = w[i - Nk * 4 + 1] ^ t1;
    w[i + 2] = w[i - Nk * 4 + 2] ^ t2;
    w[i + 3] = w[i - Nk * 4 + 3] ^ t3;
    i += 4;
  }
  return w;
}

function aesEncryptBlock(w, input) {
  const s = Array.from(input);
  const addRoundKey = (round) => {
    const o = round * 16;
    for (let i = 0; i < 16; i++) s[i] ^= w[o + i];
  };
  const subBytes = () => { for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]]; };
  const shiftRows = () => {
    [s[1], s[5], s[9], s[13]] = [s[5], s[9], s[13], s[1]];
    [s[2], s[6], s[10], s[14]] = [s[10], s[14], s[2], s[6]];
    [s[3], s[7], s[11], s[15]] = [s[15], s[3], s[7], s[11]];
  };
  const gm = (a, b) => {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  const mixColumns = () => {
    for (let c = 0; c < 4; c++) {
      const o = c * 4;
      const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
      s[o] = gm(a0, 2) ^ gm(a1, 3) ^ a2 ^ a3;
      s[o + 1] = a0 ^ gm(a1, 2) ^ gm(a2, 3) ^ a3;
      s[o + 2] = a0 ^ a1 ^ gm(a2, 2) ^ gm(a3, 3);
      s[o + 3] = gm(a0, 3) ^ a1 ^ a2 ^ gm(a3, 2);
    }
  };
  addRoundKey(0);
  for (let round = 1; round <= 10; round++) {
    subBytes(); shiftRows();
    if (round < 10) mixColumns();
    addRoundKey(round);
  }
  return s;
}

function ncAesEcbEncryptHex(plainText) {
  const keyBytes = new TextEncoder().encode(NC_AES_KEY);
  const w = aesKeySchedule(keyBytes);
  const data = new TextEncoder().encode(plainText);
  // PKCS7 填充
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);
  const out = [];
  for (let i = 0; i < padded.length; i += 16) {
    const block = aesEncryptBlock(w, padded.subarray(i, i + 16));
    for (let j = 0; j < 16; j++) out.push(block[j]);
  }
  return out.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ncEncryptParams(urlPath, payload) {
  const digest = md5Hex(`nobody${urlPath}use${JSON.stringify(payload)}md5forencrypt`);
  const raw = `${urlPath}-36cd479b6b5-${JSON.stringify(payload)}-36cd479b6b5-${digest}`;
  return ncAesEcbEncryptHex(raw);
}

function md5Hex(text) {
  // 纯 JS MD5（public domain 算法）
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const bytes = new Uint8Array(new TextEncoder().encode(text));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    const M = [];
    for (let i = 0; i < 16; i++) M.push(dv.getUint32(off + i * 4, true));
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (b & c) | (~b & d); g = i; }
      else if (i < 32) { F = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { F = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c; c = b;
      b = (b + rotl((a + F + K[i] + M[g]) >>> 0, S[i])) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = [];
  for (const v of [a0, b0, c0, d0]) {
    out.push((v & 0xff).toString(16).padStart(2, "0"), ((v >>> 8) & 0xff).toString(16).padStart(2, "0"), ((v >>> 16) & 0xff).toString(16).padStart(2, "0"), ((v >>> 24) & 0xff).toString(16).padStart(2, "0"));
  }
  return out.join("");
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

// ---- 网易云：搜索 ----
async function ncSearch(keyword, page = 1, pageSize = 20, env = {}) {
  const body = new URLSearchParams({ s: keyword, type: 1, limit: String(pageSize), offset: String((page - 1) * pageSize) });
  const res = await fetch(NC_SEARCH_URL, {
    method: "POST",
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie(env) },
    body: body,
  });
  if (!res.ok) throw new Error("网易云搜索服务返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云搜索失败: " + (data.message || data.code));
  const songs = data.result?.songs ?? [];
  const items = songs.map((s) => {
    const artists = (s.ar || []).map((a) => a.name).join("/");
    return {
      songmid: String(s.id),
      songname: s.name || "",
      singer: artists,
      albumname: s.al?.name || "",
      albummid: s.al ? String(s.al.id) : "",
      picUrl: s.al?.picUrl || "",
      interval: Math.floor((s.dt || 0) / 1000),
      size128: 0,
      size320: 0,
      sizeflac: 0,
    };
  });
  return { items, total: data.result?.songCount ?? items.length };
}

// ---- 网易云：eapi 播放地址 ----
async function ncGetPlayUrl(id, quality, env = {}) {
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
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie(env) },
    body: body,
  });
  if (!res.ok) throw new Error("网易云接口返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云播放地址获取失败: " + (data.message || data.code));
  const d = data.data?.[0];
  if (!d || !d.url) throw new Error("该歌曲在网易云需要 VIP 会员或无法获取播放地址");
  return { url: d.url, br: d.br || 0, size: d.size || 0, level };
}

// ---- 网易云：封面代理 ----
async function ncGetCover(picUrl, env = {}) {
  let img = picUrl;
  if (!/^https?:/i.test(img)) img = "https:" + img;
  const imgRes = await fetch(img, {
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie(env) },
  });
  if (!imgRes.ok) throw new Error("网易云封面获取失败");
  const buf = await imgRes.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": imgRes.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ---- 网易云：歌词 ----
async function ncGetLyric(id, env = {}) {
  const body = new URLSearchParams({
    id: String(id), cp: "false", tv: "0", lv: "0", rv: "0", kv: "0", yv: "0", ytv: "0", yrv: "0",
  });
  const res = await fetch(NC_LYRIC_API, {
    method: "POST",
    headers: { "User-Agent": NC_UA, Referer: NC_REFERER, Cookie: ncCookie(env) },
    body: body,
  });
  if (!res.ok) throw new Error("网易云歌词接口返回 " + res.status);
  const data = await res.json();
  if (data.code !== 200) throw new Error("网易云歌词获取失败: " + (data.message || data.code));
  const lyric = (data.lrc?.lyric || "").replace(/^\uFEFF/, "");
  const tlyric = (data.tlyric?.lyric || "").replace(/^\uFEFF/, "");
  return { lyric, tlyric };
}

// ---- 网易云：登录 Cookie（可选；无 cookie 时 128/320 可下载，无损降级 320） ----
function ncCookie(env) {
  return (env.NC_COOKIE || "").trim();
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
        if (source === "netease") return json(await ncSearch(q, page, pageSize, env));
        return json(await search(q, page, pageSize));
      }
      if (url.pathname === "/api/music/download") {
        const songmid = url.searchParams.get("songmid") || url.searchParams.get("hash") || "";
        const quality = ["flac", "320", "128"].includes(url.searchParams.get("quality"))
          ? url.searchParams.get("quality")
          : "320";
        const source = url.searchParams.get("source") || "qq";
        if (!songmid) return json({ message: "songmid 不能为空" }, 400);
        if (source === "netease") {
          const info = await ncGetPlayUrl(songmid, quality, env);
          return json({ url: info.url, source: "netease", level: info.level, br: info.br, size: info.size });
        }
        const streamUrl = await getDownloadUrl(songmid, quality, env);
        return json({ url: streamUrl, source: "qq" });
      }
      if (url.pathname === "/api/cover") {
        const source = url.searchParams.get("source") || "qq";
        if (source === "netease") {
          const pic = url.searchParams.get("pic") || "";
          if (!pic) return json({ message: "pic 不能为空" }, 400);
          return await ncGetCover(pic, env);
        }
        const albummid = url.searchParams.get("albummid") || "";
        if (!albummid) return json({ message: "albummid 不能为空" }, 400);
        return await getCover(albummid);
      }
      if (url.pathname === "/api/lyric") {
        const source = url.searchParams.get("source") || "qq";
        if (source === "netease") {
          const id = url.searchParams.get("id") || "";
          if (!id) return json({ message: "id 不能为空" }, 400);
          return json(await ncGetLyric(id, env));
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
