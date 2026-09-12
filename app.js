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

// 图标（内联 SVG，不用 emoji）
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const ICON_RETRY = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const ICON_DL = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

// ---- 播放器状态 ----
let audio = null;
let currentSong = null;
let playBtnOf = null;

const playerEl = document.getElementById("player");
const playerCover = document.getElementById("playerCover");
const playerName = document.getElementById("playerName");
const playerSinger = document.getElementById("playerSinger");
const playerFill = document.getElementById("playerFill");
const playerPlay = document.getElementById("playerPlay");
const playerBody = document.getElementById("playerBody");

const npEl = document.getElementById("nowPlaying");
const npCover = document.getElementById("npCover");
const npName = document.getElementById("npName");
const npSinger = document.getElementById("npSinger");
const npFill = document.getElementById("npFill");
const npCur = document.getElementById("npCur");
const npDur = document.getElementById("npDur");
const npPlay = document.getElementById("npPlay");
const npHandle = document.getElementById("npHandle");
const npTrack = document.getElementById("npTrack");
const lyricsEl = document.getElementById("lyricsEl");
const lyricsEmpty = document.getElementById("lyricsEmpty");

function formatSize(bytes) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function formatDuration(s) {
  if (!isFinite(s) || s < 0) s = 0;
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- 封面取色：驱动页面亮色渐变与播放页深色渐变 ----
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
    if (lum < 18 || lum > 245) continue;
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    const w = 1 + sat / 255;
    r += R * w; g += G * w; b += B * w; n += w;
  }
  if (!n) { r = 180; g = 184; b = 200; }
  else { r /= n; g /= n; b /= n; }
  const [h, s, l] = rgbToHsl(r, g, b);

  // 页面亮色渐变（粉彩感）
  const bgA = hslToRgb(h, Math.min(s * 0.55 + 0.08, 0.5), 0.93);
  const bgB = hslToRgb((h + 0.08) % 1, Math.min(s * 0.5 + 0.1, 0.55), 0.86);
  const bgC = hslToRgb((h + 0.92) % 1, Math.min(s * 0.42 + 0.06, 0.45), 0.9);
  // 播放页深色渐变
  const npA = hslToRgb(h, Math.min(s * 0.8 + 0.12, 0.6), 0.4);
  const npB = hslToRgb((h + 0.05) % 1, Math.min(s * 0.6 + 0.1, 0.5), 0.24);
  const npC = hslToRgb((h + 0.94) % 1, Math.min(s * 0.55 + 0.08, 0.45), 0.14);

  return {
    bgA: "rgb(" + bgA.join(",") + ")",
    bgB: "rgb(" + bgB.join(",") + ")",
    bgC: "rgb(" + bgC.join(",") + ")",
    npA: "rgb(" + npA.join(",") + ")",
    npB: "rgb(" + npB.join(",") + ")",
    npC: "rgb(" + npC.join(",") + ")",
  };
}
function applyCoverTheme(palette) {
  if (!palette) return;
  const root = document.documentElement.style;
  root.setProperty("--bg-a", palette.bgA);
  root.setProperty("--bg-b", palette.bgB);
  root.setProperty("--bg-c", palette.bgC);
  root.setProperty("--np-a", palette.npA);
  root.setProperty("--np-b", palette.npB);
  root.setProperty("--np-c", palette.npC);
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
      img.onload = () => { try { applyCoverTheme(extractPalette(img)); } catch (_) {} };
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

    const disc = document.createElement("div");
    disc.className = "song-disc";
    if (song.albummid) {
      const img = new Image();
      img.onload = () => {
        disc.style.backgroundImage = "url(" + coverOf(song) + ")";
        disc.classList.add("loaded");
      };
      img.src = coverOf(song);
    } else {
      disc.classList.add("loaded");
    }
    card.appendChild(disc);

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
let panelSong = null;

const QUALITY_DESC = {
  flac: { label: "FLAC 无损", tag: "无损" },
  320: { label: "320kbps", tag: "高清" },
  128: { label: "128kbps", tag: "试听" },
};

function openDlPanel(song) {
  panelSong = song;
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
  dlModal.classList.remove("closing");
  dlModal.classList.remove("hidden");
}

function closeDlPanel() {
  if (dlModal.classList.contains("hidden") || dlModal.classList.contains("closing")) return;
  dlModal.classList.add("closing");
  setTimeout(() => {
    dlModal.classList.add("hidden");
    dlModal.classList.remove("closing");
    panelSong = null;
  }, 260);
}

function renderDlRows() {
  if (!panelSong) return;
  dlRows.innerHTML = "";
  ["flac", "320", "128"].forEach((q, i) => {
    const row = renderDlRow(panelSong, q);
    row.style.animationDelay = (0.06 + i * 0.07).toFixed(2) + "s";
    dlRows.appendChild(row);
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

document.getElementById("dlMask").addEventListener("click", closeDlPanel);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!npEl.classList.contains("hidden")) closeNowPlaying();
  else closeDlPanel();
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
// 播放器（预览 128kbps）+ 滚动歌词
// ============================================================
function setPlayBtn(btn, playing) {
  if (!btn) return;
  btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  btn.classList.toggle("playing", playing);
}

function highlightPlayBtn(songmid) {
  document.querySelectorAll(".song").forEach((c) => {
    c.classList.remove("playing-card");
  });
  if (songmid) {
    const card = document.querySelector('.song[data-mid="' + songmid + '"]');
    if (card && audio && !audio.paused) card.classList.add("playing-card");
  }
  document.querySelectorAll(".song-play").forEach((b) => {
    setPlayBtn(b, b.dataset.mid === songmid && audio && !audio.paused);
  });
  playBtnOf = document.querySelector('.song-play[data-mid="' + songmid + '"]');
}

// ---- 歌词 ----
let lyricsData = [];
let lyricEls = [];
let lastLyricIdx = -1;
const LYRICS_HALF = 8; // 上下保留显示的行数

function parseLrc(lrcText) {
  const lines = String(lrcText || "").trim().split("\n");
  const out = [];
  lines.forEach((line) => {
    const m = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/);
    if (!m) return;
    const text = line.replace(m[0], "").trim();
    if (!text) return;
    const time = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3] || "0", 10) / 1000;
    out.push({ time: time, text: text });
  });
  out.sort((a, b) => a.time - b.time);
  return out;
}

function renderLyrics(list) {
  lyricsEl.innerHTML = "";
  lyricsData = list;
  lyricEls = [];
  lastLyricIdx = -1;
  if (!list.length) {
    lyricsEmpty.style.display = "flex";
    return;
  }
  lyricsEmpty.style.display = "none";
  list.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "lyric-line" + (i === 0 ? " active" : "");
    div.textContent = item.text;
    lyricsEl.appendChild(div);
    lyricEls.push(div);
  });
  // 等待布局后居中第一行
  requestAnimationFrame(() => updateLyrics(0));
}

function updateLyrics(time) {
  if (!lyricEls.length) return;
  let idx = 0;
  for (let i = 0; i < lyricsData.length; i++) {
    if (time >= lyricsData[i].time) idx = i;
    else break;
  }
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;

  lyricEls.forEach((el, i) => {
    const dist = i - idx;
    el.classList.remove("active", "near");
    if (i === idx) el.classList.add("active");
    else if (Math.abs(dist) <= 3) el.classList.add("near");
    el.style.visibility = Math.abs(dist) > LYRICS_HALF ? "hidden" : "";
  });

  const wrap = lyricsEl.parentElement;
  const wrapH = wrap.clientHeight;
  const el = lyricEls[idx];
  const target = wrapH / 2 - el.offsetTop - el.clientHeight / 2;
  lyricsEl.style.transform = "translateY(" + target + "px)";
}

async function loadLyrics(song) {
  renderLyrics([]);
  try {
    const res = await fetch(API_BASE + "/api/lyric?songmid=" + encodeURIComponent(song.songmid));
    if (!res.ok) throw new Error("no lyric");
    const j = await res.json();
    renderLyrics(parseLrc(j.lyric));
  } catch (_) {
    lyricsEmpty.style.display = "flex";
  }
}

// ---- 播放核心 ----
async function togglePlay(song, btn) {
  if (audio && currentSong && currentSong.songmid === song.songmid) {
    if (audio.paused) {
      audio.play();
      setPlayBtn(btn, true);
      setPlayerIcons(true);
    } else {
      audio.pause();
      setPlayBtn(btn, false);
      setPlayerIcons(false);
    }
    return;
  }

  if (audio) {
    audio.pause();
    audio.src = "";
  }

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
      const pct = (audio.currentTime / audio.duration) * 100;
      playerFill.style.width = pct + "%";
      npFill.style.width = pct + "%";
      npCur.textContent = formatDuration(audio.currentTime);
      npDur.textContent = formatDuration(audio.duration);
      updateLyrics(audio.currentTime);
    });
    audio.addEventListener("play", () => {
      setPlayerIcons(true);
      highlightPlayBtn(song.songmid);
      syncListenBtn();
    });
    audio.addEventListener("pause", () => {
      setPlayerIcons(false);
      highlightPlayBtn(song.songmid);
      syncListenBtn();
    });
    audio.addEventListener("ended", () => {
      setPlayerIcons(false);
      highlightPlayBtn(song.songmid);
      playerFill.style.width = "0%";
      npFill.style.width = "0%";
      npCur.textContent = "0:00";
      syncListenBtn();
    });
    audio.addEventListener("error", () => {
      setPlayerIcons(false);
      btn.innerHTML = ICON_PLAY;
      if (playBtnOf === btn) playBtnOf = null;
      syncListenBtn();
    });

    // 更新播放器信息
    playerEl.classList.remove("hidden");
    playerName.textContent = song.songname;
    playerSinger.textContent = song.singer || "未知歌手";
    npName.textContent = song.songname;
    npSinger.textContent = song.singer || "未知歌手";
    playerCover.style.backgroundImage = "";
    npCover.style.backgroundImage = "";

    const coverUrl = coverOf(song);
    if (coverUrl) {
      const img = new Image();
      img.onload = () => {
        playerCover.style.backgroundImage = "url(" + coverUrl + ")";
        npCover.style.backgroundImage = "url(" + coverUrl + ")";
        try { applyCoverTheme(extractPalette(img)); } catch (_) {}
      };
      img.src = coverUrl;
    }

    await audio.play();
    setPlayBtn(btn, true);
    setPlayerIcons(true);
    loadLyrics(song); // 异步加载歌词，不阻塞播放
  } catch (err) {
    btn.innerHTML = ICON_PLAY;
    statusEl.innerHTML = "<p>播放失败：" + escapeHtml(err.message) + "</p>";
  }
}

function setPlayerIcons(playing) {
  playerPlay.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  npPlay.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

// ---- 全屏播放页 ----
function openNowPlaying() {
  npEl.classList.remove("closing");
  npEl.classList.remove("hidden");
  resetNpDrag();
  document.body.style.overflow = "hidden";
  updateLyrics(audio ? audio.currentTime : 0);
}
function closeNowPlaying() {
  if (npEl.classList.contains("hidden") || npEl.classList.contains("closing")) return;
  npEl.classList.add("closing");
  setTimeout(() => {
    npEl.classList.add("hidden");
    npEl.classList.remove("closing");
    resetNpDrag();
    document.body.style.overflow = "";
  }, 300);
}
playerBody.addEventListener("click", openNowPlaying);

// ---- 下拉手势关闭（拉住顶部横条往下拉） ----
const NP_DRAG_THRESHOLD = 130; // 超过该距离松手即关闭
let npDragging = false;
let npDragMoved = false;
let npDragStartY = 0;
let npDragDy = 0;

function resetNpDrag() {
  npDragging = false;
  npDragMoved = false;
  npDragDy = 0;
  npEl.style.transition = "";
  npEl.style.transform = "";
  npEl.style.opacity = "";
  npEl.classList.remove("dragging");
}

npHandle.addEventListener("pointerdown", (e) => {
  if (npEl.classList.contains("hidden") || npEl.classList.contains("closing")) return;
  npDragging = true;
  npDragMoved = false;
  npDragStartY = e.clientY;
  npDragDy = 0;
  npEl.classList.add("dragging");
  try { npHandle.setPointerCapture(e.pointerId); } catch (_) {}
});

npHandle.addEventListener("pointermove", (e) => {
  if (!npDragging) return;
  const dy = e.clientY - npDragStartY;
  if (dy > 4) npDragMoved = true;
  if (dy <= 0) { npDragDy = 0; return; }
  npDragDy = dy;
  // 纯跟手位移，不淡出不变糊
  npEl.style.transform = "translateY(" + dy + "px)";
});

function endNpDrag() {
  if (!npDragging) return;
  npDragging = false;
  npEl.classList.remove("dragging");
  npEl.style.transition = "transform 0.3s cubic-bezier(0.33, 1, 0.68, 1)";
  if (npDragDy >= NP_DRAG_THRESHOLD) {
    // 超过阈值：滑出屏幕关闭
    npEl.style.transform = "translateY(110%)";
    setTimeout(() => {
      npEl.classList.add("hidden");
      resetNpDrag();
      document.body.style.overflow = "";
    }, 300);
  } else {
    // 未到阈值：弹回
    npEl.style.transform = "";
    setTimeout(resetNpDrag, 350);
  }
  npDragDy = 0;
}
npHandle.addEventListener("pointerup", endNpDrag);
npHandle.addEventListener("pointercancel", endNpDrag);

// 点击横条 = 快速收起；拖动过则不触发
npHandle.addEventListener("click", () => {
  if (npDragMoved) {
    npDragMoved = false;
    return;
  }
  closeNowPlaying();
});

playerPlay.addEventListener("click", () => {
  if (!audio || !currentSong) return;
  if (audio.paused) audio.play();
  else audio.pause();
});
npPlay.addEventListener("click", () => {
  if (!audio || !currentSong) return;
  if (audio.paused) audio.play();
  else audio.pause();
});

// 全屏进度条点击跳转
npTrack.addEventListener("click", (e) => {
  if (!audio || !audio.duration) return;
  const rect = npTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
  npFill.style.width = ratio * 100 + "%";
  updateLyrics(audio.currentTime);
});
