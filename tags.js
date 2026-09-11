// ============================================================
// 音频元数据内嵌模块（纯前端）
// - MP3: 写入 ID3v2.3 标签（标题/歌手/专辑/歌词/封面 APIC）
// - FLAC: 写入 VORBIS_COMMENT + PICTURE 块（标题/歌手/专辑/歌词/封面）
// ============================================================

// ---------- 工具 ----------
function concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function utf16leWithBom(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const hi = 0xd800 + ((code - 0x10000) >> 10);
      const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
      out.push(hi & 0xff, hi >> 8, lo & 0xff, lo >> 8);
    } else {
      out.push(code & 0xff, code >> 8);
    }
  }
  return new Uint8Array(out);
}

function be32(n) {
  return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
function le32(n) {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

// ---------- MP3: ID3v2.3 ----------
function buildId3Frame(id, data) {
  const enc = new TextEncoder();
  const hdr = enc.encode(id); // 4 字节
  const out = new Uint8Array(10 + data.length);
  out.set(hdr, 0);
  out[4] = (data.length >> 24) & 0xff;
  out[5] = (data.length >> 16) & 0xff;
  out[6] = (data.length >> 8) & 0xff;
  out[7] = data.length & 0xff;
  out[8] = 0; out[9] = 0; // flags
  out.set(data, 10);
  return out;
}

// 文本帧（UTF-16 with BOM）
function id3TextFrame(id, text) {
  if (!text) return null;
  const body = utf16leWithBom(text);
  const data = new Uint8Array(1 + 2 + body.length);
  data[0] = 0x01; // encoding: UTF-16
  data[1] = 0xff; data[2] = 0xfe; // BOM
  data.set(body, 3);
  return buildId3Frame(id, data);
}

// 封面帧 APIC
async function id3ApicFrame(coverBlob) {
  if (!coverBlob) return null;
  const mime = (coverBlob.type || "image/jpeg").split(";")[0];
  const mimeB = new TextEncoder().encode(mime);
  const pic = new Uint8Array(await coverBlob.arrayBuffer());
  const data = new Uint8Array(1 + mimeB.length + 1 + 1 + 1 + pic.length);
  data[0] = 0x00; // encoding: latin1
  data.set(mimeB, 1);
  data[1 + mimeB.length] = 0x00; // mime 结束
  data[2 + mimeB.length] = 0x03; // picture type: front cover
  data[3 + mimeB.length] = 0x00; // 空描述
  data.set(pic, 4 + mimeB.length);
  return buildId3Frame("APIC", data);
}

// 歌词帧 USLT（ID3v2.3：desc 和 text 都用 UTF-16 编码）
function id3UsltFrame(lyric) {
  if (!lyric) return null;
  const body = utf16leWithBom(lyric);
  // encoding + lang(3) + desc BOM(2) + desc 空(2) + text BOM(2) + text
  const data = new Uint8Array(1 + 3 + 2 + 2 + 2 + body.length);
  data[0] = 0x01; // encoding: UTF-16
  data[1] = 0x65; data[2] = 0x6e; data[3] = 0x67; // "eng"
  data[4] = 0xff; data[5] = 0xfe; // desc BOM
  data[6] = 0x00; data[7] = 0x00; // desc 空（UTF-16 null）
  data[8] = 0xff; data[9] = 0xfe; // text BOM
  data.set(body, 10);
  return buildId3Frame("USLT", data);
}

// 剥离 MP3 开头自带的旧 ID3v2 标签（避免双标签）
function stripMp3Id3(audioBytes) {
  if (
    audioBytes.length > 10 &&
    audioBytes[0] === 0x49 && audioBytes[1] === 0x44 && audioBytes[2] === 0x33
  ) {
    const size =
      ((audioBytes[6] & 0x7f) << 21) |
      ((audioBytes[7] & 0x7f) << 14) |
      ((audioBytes[8] & 0x7f) << 7) |
      (audioBytes[9] & 0x7f);
    const start = 10 + size;
    if (start > 0 && start < audioBytes.length) return audioBytes.subarray(start);
  }
  return audioBytes;
}

async function embedMp3(audioBytes, meta, coverBlob) {
  audioBytes = stripMp3Id3(audioBytes);
  const frames = [];
  const t = id3TextFrame("TIT2", meta.title);
  const a = id3TextFrame("TPE1", meta.artist);
  const al = id3TextFrame("TALB", meta.album);
  const u = id3UsltFrame(meta.lyric);
  const apic = await id3ApicFrame(coverBlob);
  if (t) frames.push(t);
  if (a) frames.push(a);
  if (al) frames.push(al);
  if (u) frames.push(u);
  if (apic) frames.push(apic);

  const body = concatBytes(frames);
  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // "ID3"
  header[3] = 0x03; header[4] = 0x00; header[5] = 0x00; // v2.3
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;

  return concatBytes([header, body, audioBytes]);
}

// ---------- FLAC: metadata blocks ----------
function parseFlacBlocks(data) {
  // data: Uint8Array，从文件头开始
  const blocks = [];
  let off = 4; // 跳过 "fLaC"
  while (off + 4 <= data.length) {
    const head = (data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3];
    const last = (head >>> 31) & 1;
    const type = (head >>> 24) & 0x7f;
    const len = head & 0xffffff;
    blocks.push({ type, len, last, start: off, end: off + 4 + len });
    off += 4 + len;
    if (last) break;
  }
  return { blocks, audioStart: off };
}

function flacBlockHeader(last, type, len) {
  const out = new Uint8Array(4);
  const t = (last ? 0x80 : 0) | (type & 0x7f);
  out[0] = t;
  out[1] = (len >> 16) & 0xff;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  return out;
}

// VORBIS_COMMENT 块数据
function buildVorbisComment(meta) {
  const enc = new TextEncoder();
  const vendor = enc.encode("QQMusic Downloader");
  const comments = [];
  if (meta.title) comments.push(enc.encode("TITLE=" + meta.title));
  if (meta.artist) comments.push(enc.encode("ARTIST=" + meta.artist));
  if (meta.album) comments.push(enc.encode("ALBUM=" + meta.album));
  if (meta.lyric) comments.push(enc.encode("LYRICS=" + meta.lyric));

  const parts = [le32(vendor.length), vendor, le32(comments.length)];
  for (const c of comments) parts.push(le32(c.length), c);
  return concatBytes(parts);
}

// PICTURE 块数据
async function buildFlacPicture(coverBlob) {
  const pic = new Uint8Array(await coverBlob.arrayBuffer());
  const mime = (coverBlob.type || "image/jpeg").split(";")[0];
  const mimeB = new TextEncoder().encode(mime);
  return concatBytes([
    be32(3), // picture type: front cover
    be32(mimeB.length), mimeB,
    be32(0), // 描述空
    be32(0), be32(0), be32(0), be32(0), // width/height/depth/colors
    be32(pic.length), pic,
  ]);
}

async function embedFlac(audioBytes, meta, coverBlob) {
  const { blocks, audioStart } = parseFlacBlocks(audioBytes);
  if (!blocks.length || blocks[0].type !== 0) {
    throw new Error("无法解析 FLAC 文件结构");
  }
  const streamInfo = blocks[0];
  const rest = blocks.slice(1);

  const vorbis = buildVorbisComment(meta);
  const picData = coverBlob ? await buildFlacPicture(coverBlob) : null;

  const chunks = [];
  // "fLaC" + STREAMINFO（last 位清 0）
  chunks.push(audioBytes.subarray(0, 4));
  const siHead = new Uint8Array(audioBytes.subarray(streamInfo.start, streamInfo.start + 4));
  siHead[0] = siHead[0] & 0x7f;
  chunks.push(siHead);
  chunks.push(audioBytes.subarray(streamInfo.start + 4, streamInfo.end));

  // 新块：PICTURE（如有）→ VORBIS_COMMENT（last）
  if (picData) chunks.push(flacBlockHeader(false, 6, picData.length), picData);
  chunks.push(flacBlockHeader(true, 4, vorbis.length), vorbis);

  // 原其余块：最后一个的 last 位清 0（last 已由 VORBIS_COMMENT 接管）
  for (let i = 0; i < rest.length; i++) {
    const b = rest[i];
    const head = new Uint8Array(audioBytes.subarray(b.start, b.start + 4));
    if (i === rest.length - 1) head[0] = head[0] & 0x7f;
    chunks.push(head);
    chunks.push(audioBytes.subarray(b.start + 4, b.end));
  }

  // 音频数据
  chunks.push(audioBytes.subarray(audioStart));
  return concatBytes(chunks);
}

// ---------- 入口：根据格式内嵌 ----------
async function embedMetaToBytes(audioBytes, format, meta, coverBlob) {
  if (format === "flac") return await embedFlac(audioBytes, meta, coverBlob);
  return await embedMp3(audioBytes, meta, coverBlob);
}

// 供 app.js 使用
window.embedMetaToBytes = embedMetaToBytes;
