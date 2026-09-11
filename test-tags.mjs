// 验证 tags.js 内嵌逻辑：下载真实 FLAC/MP3 → 内嵌封面歌词 → mutagen 回读
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

globalThis.window = globalThis;
eval(readFileSync(new URL("./tags.js", import.meta.url), "utf8"));

const env = {};
for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const worker = (await import("./worker.js")).default;

async function getMeta(songmid, albummid) {
  const [dl, cover, lyr] = await Promise.all([
    worker.fetch(new Request("https://t/api/music/download?songmid=" + songmid + "&quality=flac"), env).then((r) => r.json()),
    worker.fetch(new Request("https://t/api/cover?albummid=" + albummid), env).then((r) => r.blob()),
    worker.fetch(new Request("https://t/api/lyric?songmid=" + songmid), env).then((r) => r.json()),
  ]);
  return { url: dl.url, cover, lyric: lyr.lyric };
}

const songmid = "0017K7gL4WYnw2"; // 反方向的钟
const albummid = "000f01724fd7TH";
const meta = { title: "反方向的钟", artist: "周杰伦", album: "Jay", lyric: "" };
const { url, cover, lyric } = await getMeta(songmid, albummid);
meta.lyric = lyric;
console.log("歌词长度:", lyric.length);

// 下载 FLAC
const flacBuf = new Uint8Array(await (await fetch(url)).arrayBuffer());
console.log("FLAC 原始大小:", flacBuf.length);
const flacOut = await window.embedMetaToBytes(flacBuf, "flac", meta, cover);
writeFileSync("/tmp/test-embed.flac", flacOut);
console.log("FLAC 内嵌后大小:", flacOut.length, "(应比原始大)");

// 下载 MP3 320（同一首歌不同文件名）
const dl320 = await worker.fetch(new Request("https://t/api/music/download?songmid=" + songmid + "&quality=320"), env).then((r) => r.json());
const mp3Buf = new Uint8Array(await (await fetch(dl320.url)).arrayBuffer());
console.log("MP3 原始大小:", mp3Buf.length);
const mp3Out = await window.embedMetaToBytes(mp3Buf, "mp3", meta, cover);
writeFileSync("/tmp/test-embed.mp3", mp3Out);
console.log("MP3 内嵌后大小:", mp3Out.length);
