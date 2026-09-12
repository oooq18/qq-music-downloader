const keywordEl = document.getElementById("keyword");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("resultMeta");
const listEl = document.getElementById("songList");
const headerStatus = document.getElementById("headerStatus");

const QUALITY_LABELS = { flac: "FLAC 无损", 320: "320kbps", 128: "128kbps" };
const QUALITY_SIZE_KEYS = { flac: "sizeflac", 320: "size320", 128: "size128" };
const downloadStates = new Map();
let currentSongs = [];

// 播放/暂停图标（内联 SVG，避免 emoji 在不同平台渲染不一致）
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const ICON_RETRY = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const ICON_DL = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

// ---- 播放器状态 ----
let audio = null;          // 当前 Audio 实例
let currentSong = null;    // 当前播放的歌曲对象
let playBtnOf = null;      // 当前高亮的播放按钮
const playerEl = document.getElementById("player");
const playerCover = document.getElementById("playerCover");
const playerName = document.getElementById("playerName");
const playerSinger = document.getElementById("playerSinger");
const playerFill = document.getElementById("playerFill");
const playerCur = document.getElementById("playerCur");
const playerDur = document.getElementById("playerDur");
const playerPlay = document.getElementById("playerPlay");
const playerClose = document.getElementById("playerClose");

function formatSize(bytes) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function formatDuration(s) {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- 封面取色：从专辑封面提取主色，驱动页面氛围光 ----
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function extractPalette(img) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    if (lum < 20 || lum > 240) continue; // 剔除纯黑纯白
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    const w = 1 + sat / 255; // 高饱和像素加权
    r += R * w; g += G * w; b += B * w; n += w;
  }
  if (!n) { r = 210; g = 210; b = 218; }
  else { r /= n; g /= n; b /= n; }

  // 氛围色：保持色相，提亮提饱和（保证在深色背景上可见）
  const [h, s, l] = rgbToHsl(r, g, b);
  const amb = hslToRgb(h, Math.min(s * 0.7 + 0.18, 0.5), 0.52);
  const softBase = hslToRgb(h, Math.min(s * 0.6 + 0.12, 0.42), 0.42);

  return {
    accent: "rgb(" + Math.round(r * 0.85) + "," + Math.round(g * 0.85) + "," + Math.round(b * 0.85) + ")",
    soft: "rgba(" + amb[0] + "," + amb[1] + "," + amb[2] + ",0.30)",
    glow: "rgba(" + softBase[0] + "," + softBase[1] + "," + softBase[2] + ",0.15)",
  };
}
function applyTheme(color) {
  if (!color) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", color.accent);
  root.setProperty("--accent-soft", color.soft);
  root.setProperty("--accent-glow", color.glow);
}
function coverOf(song) {
  return song && song.albummid ? API_BASE + "/api/cover?albummid=" + encodeURIComponent(song.albummid) : "";
}

async function handleSearch() {
  const kw = keywordEl.value.trim();
  if (!kw) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "搜索中...";
  headerStatus.textContent = "SEARCHING";
  statusEl.innerHTML = '<div class="spinner"></div><p>正在搜索...</p>';
  metaEl.textContent = "";
  listEl.innerHTML = "";
  try {
    const res = await fetch(API_BASE + "/api/music/search?q=" + encodeURIComponent(kw) + "&pageSize=20");
    if (!res.ok) throw new Error("搜索请求失败");
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      statusEl.innerHTML = "<p>没有找到相关歌曲，换个关键词试试</p>";
      headerStatus.textContent = "EMPTY";
      return;
    }
    statusEl.innerHTML = "";
    metaEl.innerHTML = "共找到 <b>" + data.total + "</b> 首歌曲";
    currentSongs = data.items;
    renderSongs(currentSongs);
    // 用首曲封面驱动页面氛围
    const first = currentSongs[0];
    if (first && first.albummid) {
      const img = new Image();
      img.onload = () => { try { applyTheme(extractPalette(img)); } catch (_) {} };
      img.src = coverOf(first);
    }
    headerStatus.textContent = "FOUND " + data.total;
    headerStatus.classList.add("live");
  } catch (err) {
    statusEl.innerHTML = "<p>搜索失败：" + escapeHtml(err.message) + "</p>";
    headerStatus.textContent = "ERROR";
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "搜索";
  }
}

function renderSongs(songs) {
  listEl.innerHTML = "";
  songs.forEach((song, i) => {
    const card = document.createElement("div");
    card.className = "song";
    card.dataset.mid = song.songmid;
    card.style.animationDelay = Math.min(i * 45, 700) + "ms";

    // 封面圆片（黑胶唱片）
    const disc = document.createElement("div");
    disc.className = "song-disc";
    if (song.albummid) {
      const img = new Image();
      img.onload = () => {
        disc.style.backgroundImage = "url(" + coverOf(song) + ")";
      };
      img.src = coverOf(song);
    }
    card.appendChild(disc);

    // 歌曲信息
    const body = document.createElement("div");
    body.className = "song-body";
    body.innerHTML =
      '<div class="song-name">' + escapeHtml(song.songname) + "</div>" +
      '<div class="song-meta">' +
        "<span>" + escapeHtml(song.singer || "未知歌手") + "</span>" +
        '<span class="sep">/</span>' +
        "<span>" + escapeHtml(song.albumname || "未知专辑") + "</span>" +
        '<span class="sep">/</span>' +
        "<span>" + formatDuration(song.interval) + "</span>" +
      "</div>";
    card.appendChild(body);

    // 操作区：播放 + 音质
    const actions = document.createElement("div");
    actions.className = "song-actions";

    const playBtn = document.createElement("button");
    playBtn.className = "song-play";
    playBtn.innerHTML = ICON_PLAY;
    playBtn.title = "预览播放";
    playBtn.dataset.mid = song.songmid;
    playBtn.addEventListener("click", () => togglePlay(song, playBtn));
    actions.appendChild(playBtn);

    const dlBtn = document.createElement("button");
    dlBtn.className = "dl-open";
    dlBtn.innerHTML = ICON_DL + " 下载";
    dlBtn.title = "选择音质并下载";
    dlBtn.addEventListener("click", () => openDlPanel(song));
    actions.appendChild(dlBtn);

    card.appendChild(actions);
    listEl.appendChild(card);
  });
}

// ---- 音质选择面板 ----
const dlModal = document.getElementById("dlModal");
const dlCover = document.getElementById("dlCover");
const dlName = document.getElementById("dlName");
const dlSinger = document.getElementById("dlSinger");
const dlListen = document.getElementById("dlListen");
const dlRows = document.getElementById("dlRows");
let panelSong = null; // 面板当前歌曲
let panelListenPlaying = false;

const QUALITY_DESC = {
  flac: { label: "FLAC 无损", tag: "无损" },
  320: { label: "320kbps", tag: "高清" },
  128: { label: "128kbps", tag: "试听" },
};

function openDlPanel(song) {
  panelSong = song;
  panelListenPlaying = false;
  dlListen.classList.remove("listening");
  dlListen.innerHTML = ICON_PLAY + " 试听预览";
  dlName.textContent = song.songname;
  dlSinger.textContent = song.singer || "未知歌手";
  dlCover.style.backgroundImage = "";
  const coverUrl = coverOf(song);
  if (coverUrl) {
    const img = new Image();
    img.onload = () => { dlCover.style.backgroundImage = "url(" + coverUrl + ")"; };
    img.src = coverUrl;
  }
  renderDlRows();
  dlModal.classList.remove("hidden");
}

function closeDlPanel() {
  dlModal.classList.add("hidden");
  panelSong = null;
  panelListenPlaying = false;
}

function renderDlRows() {
  if (!panelSong) return;
  dlRows.innerHTML = "";
  ["flac", "320", "128"].forEach((q) => {
    dlRows.appendChild(renderDlRow(panelSong, q));
  });
}

function renderDlRow(song, q) {
  const size = song[QUALITY_SIZE_KEYS[q]];
  const key = song.songmid + "-" + q;
  const row = document.createElement("button");
  row.className = "dl-row";
  row.dataset.key = key;

  const state = downloadStates.get(key);
  if (state && state.status === "downloading") {
    row.classList.add("downloading");
    row.disabled = true;
    row.innerHTML =
      '<span class="dl-q">' + QUALITY_DESC[q].label + "</span>" +
      '<span class="dl-size">' + (size ? formatSize(size) : "") + "</span>" +
      '<span class="dl-status">' + (state.progress || 0) + "%</span>" +
      '<span class="dl-progress" style="width:' + (state.progress || 0) + '%"></span>';
  } else if (state && state.status === "done") {
    row.classList.add("done");
    row.disabled = true;
    row.innerHTML =
      '<span class="dl-q">' + QUALITY_DESC[q].label + "</span>" +
      '<span class="dl-size">' + (size ? formatSize(size) : "") + "</span>" +
      '<span class="dl-status">' + ICON_CHECK + " 已完成</span>";
  } else if (state && state.status === "error") {
    row.classList.add("error");
    row.title = state.error || "";
    row.innerHTML =
      '<span class="dl-q">' + QUALITY_DESC[q].label + "</span>" +
      '<span class="dl-size">' + (size ? formatSize(size) : "") + "</span>" +
      '<span class="dl-status">' + ICON_RETRY + " 重试</span>";
    row.addEventListener("click", () => startDownload(song, q));
  } else if (!size) {
    row.classList.add("unavailable");
    row.disabled = true;
    row.title = "该音质不可用";
    row.innerHTML =
      '<span class="dl-q">' + QUALITY_DESC[q].label + "</span>" +
      '<span class="dl-tag">' + QUALITY_DESC[q].tag + "</span>" +
      '<span class="dl-size">暂无</span>' +
      '<span class="dl-status">不可用</span>';
  } else {
    row.innerHTML =
      '<span class="dl-q">' + QUALITY_DESC[q].label + "</span>" +
      '<span class="dl-tag">' + QUALITY_DESC[q].tag + "</span>" +
      '<span class="dl-size">' + formatSize(size) + "</span>" +
      '<span class="dl-status">' + ICON_DL + ' 下载</span>';
    row.addEventListener("click", () => startDownload(song, q));
  }
  return row;
}

function refreshDlRow(song, q) {
  if (!panelSong || panelSong.songmid !== song.songmid) return;
  const row = dlRows.querySelector('.dl-row[data-key="' + song.songmid + "-" + q + '"]');
  if (row) row.parentNode.replaceChild(renderDlRow(song, q), row);
}

// 试听预览：复用播放器
dlListen.addEventListener("click", async () => {
  if (!panelSong) return;
  // 若正在播这首歌，切换暂停
  if (audio && currentSong && currentSong.songmid === panelSong.songmid) {
    if (audio.paused) {
      audio.play();
      dlListen.innerHTML = ICON_PAUSE + " 停止试听";
      dlListen.classList.add("listening");
    } else {
      audio.pause();
      dlListen.innerHTML = ICON_PLAY + " 试听预览";
      dlListen.classList.remove("listening");
    }
    return;
  }
  await togglePlay(panelSong, document.querySelector('.song-play[data-mid="' + panelSong.songmid + '"]'));
  if (audio && currentSong && currentSong.songmid === panelSong.songmid && !audio.paused) {
    dlListen.innerHTML = ICON_PAUSE + " 停止试听";
    dlListen.classList.add("listening");
  } else {
    dlListen.innerHTML = ICON_PLAY + " 试听预览";
    dlListen.classList.remove("listening");
  }
});

// 播放器状态变化时同步试听按钮
function syncListenBtn() {
  if (!panelSong || !audio || !currentSong || currentSong.songmid !== panelSong.songmid) {
    dlListen.innerHTML = ICON_PLAY + " 试听预览";
    dlListen.classList.remove("listening");
    return;
  }
  if (audio.paused) {
    dlListen.innerHTML = ICON_PLAY + " 试听预览";
    dlListen.classList.remove("listening");
  } else {
    dlListen.innerHTML = ICON_PAUSE + " 停止试听";
    dlListen.classList.add("listening");
  }
}

document.getElementById("dlClose").addEventListener("click", closeDlPanel);
document.getElementById("dlMask").addEventListener("click", closeDlPanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDlPanel();
});

async function startDownload(song, q) {
  const key = song.songmid + "-" + q;
  const size = song[QUALITY_SIZE_KEYS[q]];
  if (!size) return;
  if (downloadStates.get(key)?.status === "downloading") return;

  downloadStates.set(key, { status: "downloading", progress: 0 });
  refreshDlRow(song, q);
  updateListDlBtn(song, q, 0);

  const card = document.querySelector('.song[data-mid="' + song.songmid + '"]');
  const oldErr = card.querySelector(".error-msg");
  if (oldErr) oldErr.remove();

  const bar = document.createElement("div");
  bar.className = "progress-bar";
  bar.innerHTML = '<div class="fill" style="width:0%"></div>';
  card.appendChild(bar);
  const fill = bar.querySelector(".fill");

  try {
    // 1. 获取下载直链，同时并行拉取封面和歌词
    const [dlRes, coverBlob, lyricText] = await Promise.all([
      fetch(API_BASE + "/api/music/download?songmid=" + encodeURIComponent(song.songmid) + "&quality=" + q),
      song.albummid
        ? fetch(API_BASE + "/api/cover?albummid=" + encodeURIComponent(song.albummid))
            .then((r) => (r.ok ? r.blob() : null))
            .catch(() => null)
        : Promise.resolve(null),
      fetch(API_BASE + "/api/lyric?songmid=" + encodeURIComponent(song.songmid))
        .then((r) => (r.ok ? r.json().then((j) => j.lyric || "") : ""))
        .catch(() => ""),
    ]);
    let data = {};
    try { data = await dlRes.json(); } catch (_) {}
    if (!dlRes.ok || !data.url) throw new Error(data.message || "获取下载地址失败");

    // 2. 浏览器直连 QQ 流服务器拉取（已确认支持 CORS），带进度
    const streamRes = await fetch(data.url);
    if (!streamRes.ok) throw new Error("下载失败：" + streamRes.status);
    const total = Number(streamRes.headers.get("Content-Length")) || 0;
    const reader = streamRes.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const pct = Math.min(99, Math.round((received / total) * 100));
        downloadStates.get(key).progress = pct;
        fill.style.width = pct + "%";
        updateDownloadUi(song, q, pct);
      }
    }

    // 3. 内嵌封面和歌词元数据
    fill.style.width = "100%";
    statusEl.innerHTML = '<div class="spinner"></div><p>正在写入封面和歌词...</p>';
    const audioBytes = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      audioBytes.set(c, off);
      off += c.length;
    }
    const meta = { title: song.songname, artist: song.singer, album: song.albumname, lyric: lyricText };
    const finalBytes = await window.embedMetaToBytes(audioBytes, q === "flac" ? "flac" : "mp3", meta, coverBlob);
    const type = q === "flac" ? "audio/flac" : "audio/mpeg";
    statusEl.innerHTML = "";

    downloadStates.set(key, { status: "done" });
    refreshDlRow(song, q);
    updateListDlBtn(song, q, "done");

    // 4. 保存为本地文件（带封面和歌词）
    const blob = new Blob([finalBytes], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (song.songname + " - " + song.singer + (q === "flac" ? ".flac" : ".mp3"))
      .replace(/[\\/:*?"<>|]/g, "_");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setTimeout(() => { downloadStates.delete(key); refreshDlRow(song, q); updateListDlBtn(song, q, null); }, 3000);
  } catch (err) {
    downloadStates.set(key, { status: "error", error: err.message });
    refreshDlRow(song, q);
    updateListDlBtn(song, q, "error");
    const errDiv = document.createElement("div");
    errDiv.className = "error-msg";
    errDiv.textContent = "下载失败：" + err.message;
    card.appendChild(errDiv);
  } finally {
    bar.remove();
  }
}

// 面板行与列表下载按钮的状态联动
function updateDownloadUi(song, q, pct) {
  const key = song.songmid + "-" + q;
  if (panelSong && panelSong.songmid === song.songmid) {
    const row = dlRows.querySelector('.dl-row[data-key="' + key + '"]');
    if (row) {
      row.classList.add("downloading");
      const prog = row.querySelector(".dl-progress");
      const st = row.querySelector(".dl-status");
      if (prog) prog.style.width = pct + "%";
      if (st) st.textContent = pct + "%";
    }
  }
  updateListDlBtn(song, q, pct);
}

function updateListDlBtn(song, q, pct) {
  const card = document.querySelector('.song[data-mid="' + song.songmid + '"]');
  if (!card) return;
  const btn = card.querySelector(".dl-open");
  if (!btn) return;
  if (pct === null) {
    btn.innerHTML = ICON_DL + " 下载";
    btn.classList.remove("busy");
  } else if (pct === "done") {
    btn.innerHTML = ICON_CHECK + " 已完成";
    btn.classList.add("done");
  } else if (pct === "error") {
    btn.innerHTML = ICON_RETRY + " 重试";
    btn.classList.add("error");
  } else {
    btn.innerHTML = pct + "%";
    btn.classList.add("busy");
  }
}

searchBtn.addEventListener("click", handleSearch);
keywordEl.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSearch(); });

// ============================================================
// 播放器（预览 128kbps）
// ============================================================
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

function setPlayBtn(btn, playing) {
  if (!btn) return;
  btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  btn.classList.toggle("playing", playing);
}

function highlightPlayBtn(songmid) {
  document.querySelectorAll(".song-play").forEach((b) => {
    setPlayBtn(b, b.dataset.mid === songmid && audio && !audio.paused);
  });
  playBtnOf = document.querySelector('.song-play[data-mid="' + songmid + '"]');
}

async function togglePlay(song, btn) {
  // 同一首歌：切换播放/暂停
  if (audio && currentSong && currentSong.songmid === song.songmid) {
    if (audio.paused) {
      audio.play();
      setPlayBtn(btn, true);
      playerPlay.innerHTML = ICON_PAUSE;
    } else {
      audio.pause();
      setPlayBtn(btn, false);
      playerPlay.innerHTML = ICON_PLAY;
    }
    return;
  }

  // 切歌：先停旧的
  if (audio) {
    audio.pause();
    audio.src = "";
  }

  // 获取 128kbps 直链
  setPlayBtn(btn, false);
  try {
    const res = await fetch(
      API_BASE + "/api/music/download?songmid=" + encodeURIComponent(song.songmid) + "&quality=128"
    );
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data.url) throw new Error(data.message || "获取播放地址失败");

    currentSong = song;
    audio = new Audio(data.url);
    audio.preload = "auto";

    audio.addEventListener("timeupdate", () => {
      if (!audio.duration) return;
      playerFill.style.width = (audio.currentTime / audio.duration) * 100 + "%";
      playerCur.textContent = fmtTime(audio.currentTime);
      playerDur.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("play", () => {
      playerPlay.innerHTML = ICON_PAUSE;
      playerCover.classList.add("spinning");
      playerEl.classList.add("playing");
      highlightPlayBtn(song.songmid);
      syncListenBtn();
    });
    audio.addEventListener("pause", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      playerEl.classList.remove("playing");
      highlightPlayBtn(song.songmid);
      syncListenBtn();
    });
    audio.addEventListener("ended", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      playerEl.classList.remove("playing");
      highlightPlayBtn(song.songmid);
      playerFill.style.width = "0%";
      playerCur.textContent = "00:00";
      syncListenBtn();
    });
    audio.addEventListener("error", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      btn.innerHTML = ICON_PLAY;
      if (playBtnOf === btn) playBtnOf = null;
      syncListenBtn();
    });

    // 更新播放器信息
    playerEl.classList.remove("hidden");
    playerName.textContent = song.songname;
    playerSinger.textContent = song.singer || "未知歌手";
    playerCover.style.backgroundImage = "";

    const coverUrl = coverOf(song);
    if (coverUrl) {
      const img = new Image();
      img.onload = () => {
        playerCover.style.backgroundImage = "url(" + coverUrl + ")";
        // 播放时整页氛围色随封面变化
        try { applyTheme(extractPalette(img)); } catch (_) {}
      };
      img.src = coverUrl;
    }

    await audio.play();
    setPlayBtn(btn, true);
    playerPlay.innerHTML = ICON_PAUSE;
    playerCover.classList.add("spinning");
  } catch (err) {
    btn.innerHTML = ICON_PLAY;
    statusEl.innerHTML = "<p>播放失败：" + escapeHtml(err.message) + "</p>";
  }
}

// 播放器控制
playerPlay.addEventListener("click", () => {
  if (!audio || !currentSong) return;
  if (audio.paused) audio.play();
  else audio.pause();
});
playerClose.addEventListener("click", () => {
  if (audio) { audio.pause(); audio.src = ""; }
  currentSong = null;
  playerEl.classList.add("hidden");
  playerEl.classList.remove("playing");
  playerCover.classList.remove("spinning");
  highlightPlayBtn("");
  playerFill.style.width = "0%";
  playerCur.textContent = "00:00";
  playerDur.textContent = "00:00";
  syncListenBtn();
});

// 进度条点击跳转
const playerTrack = document.querySelector(".progress-track");
playerTrack.addEventListener("click", (e) => {
  if (!audio || !audio.duration) return;
  const rect = playerTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
});
