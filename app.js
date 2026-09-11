const keywordEl = document.getElementById("keyword");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("resultMeta");
const listEl = document.getElementById("songList");

const QUALITY_LABELS = { flac: "FLAC 无损", 320: "320kbps", 128: "128kbps" };
const QUALITY_SIZE_KEYS = { flac: "sizeflac", 320: "size320", 128: "size128" };
const downloadStates = new Map();
let currentSongs = [];

// 播放/暂停图标（内联 SVG，避免 emoji 在不同平台渲染不一致）
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

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

async function handleSearch() {
  const kw = keywordEl.value.trim();
  if (!kw) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "搜索中...";
  statusEl.innerHTML = '<div class="spinner"></div><p>正在搜索...</p>';
  metaEl.textContent = "";
  listEl.innerHTML = "";
  try {
    const res = await fetch(API_BASE + "/api/music/search?q=" + encodeURIComponent(kw) + "&pageSize=20");
    if (!res.ok) throw new Error("搜索请求失败");
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      statusEl.innerHTML = "<p>没有找到相关歌曲，换个关键词试试</p>";
      return;
    }
    statusEl.innerHTML = "";
    metaEl.innerHTML = "共找到 <b>" + data.total + "</b> 首歌曲";
    currentSongs = data.items;
    renderSongs(currentSongs);
  } catch (err) {
    statusEl.innerHTML = "<p>搜索失败：" + escapeHtml(err.message) + "</p>";
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "搜索";
  }
}

function renderSongs(songs) {
  listEl.innerHTML = "";
  songs.forEach((song) => {
    const card = document.createElement("div");
    card.className = "song";
    card.dataset.mid = song.songmid;

    // 封面圆片（黑胶唱片）
    const disc = document.createElement("div");
    disc.className = "song-disc";
    if (song.albummid) {
      const img = new Image();
      img.onload = () => {
        disc.style.backgroundImage = "url(" + API_BASE + "/api/cover?albummid=" + encodeURIComponent(song.albummid) + ")";
      };
      img.src = API_BASE + "/api/cover?albummid=" + encodeURIComponent(song.albummid);
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

    ["flac", "320", "128"].forEach((q) => {
      actions.appendChild(renderQualityBtn(song, q));
    });
    card.appendChild(actions);
    listEl.appendChild(card);
  });
}

function renderQualityBtn(song, q) {
  const key = song.songmid + "-" + q;
  const size = song[QUALITY_SIZE_KEYS[q]];
  const btn = document.createElement("button");
  btn.className = "q-btn";
  btn.dataset.key = key;

  const state = downloadStates.get(key);
  if (state && state.status === "downloading") {
    btn.classList.add("downloading");
    btn.disabled = true;
    btn.innerHTML = '<span class="q-label">' + (state.progress || 0) + "%</span>";
  } else if (state && state.status === "done") {
    btn.classList.add("done");
    btn.disabled = true;
    btn.innerHTML = '<span class="q-label">✓ 已完成</span>';
  } else if (state && state.status === "error") {
    btn.classList.add("error");
    btn.title = state.error || "";
    btn.innerHTML = '<span class="q-label">⚠ 重试</span><span class="q-size">' + QUALITY_LABELS[q] + "</span>";
    btn.onclick = () => startDownload(song, q);
  } else if (!size) {
    btn.classList.add("unavailable");
    btn.disabled = true;
    btn.title = "该音质不可用";
    btn.innerHTML = '<span class="q-label">' + QUALITY_LABELS[q] + '</span><span class="q-size">暂无</span>';
  } else {
    btn.innerHTML =
      '<span class="q-label">' + QUALITY_LABELS[q] + "</span>" +
      '<span class="q-size">⬇ ' + formatSize(size) + "</span>";
    btn.onclick = () => startDownload(song, q);
  }
  return btn;
}

function replaceBtn(song, q) {
  const old = document.querySelector('.q-btn[data-key="' + song.songmid + "-" + q + '"]');
  if (!old || !old.parentNode) return;
  old.parentNode.replaceChild(renderQualityBtn(song, q), old);
}

async function startDownload(song, q) {
  const key = song.songmid + "-" + q;
  const size = song[QUALITY_SIZE_KEYS[q]];
  if (!size) return;
  if (downloadStates.get(key)?.status === "downloading") return;

  downloadStates.set(key, { status: "downloading", progress: 0 });
  replaceBtn(song, q);

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
    replaceBtn(song, q);

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

    setTimeout(() => { downloadStates.delete(key); replaceBtn(song, q); }, 3000);
  } catch (err) {
    downloadStates.set(key, { status: "error", error: err.message });
    replaceBtn(song, q);
    const errDiv = document.createElement("div");
    errDiv.className = "error-msg";
    errDiv.textContent = "下载失败：" + err.message;
    card.appendChild(errDiv);
  } finally {
    bar.remove();
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
      highlightPlayBtn(song.songmid);
    });
    audio.addEventListener("pause", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      highlightPlayBtn(song.songmid);
    });
    audio.addEventListener("ended", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      highlightPlayBtn(song.songmid);
      playerFill.style.width = "0%";
      playerCur.textContent = "00:00";
    });
    audio.addEventListener("error", () => {
      playerPlay.innerHTML = ICON_PLAY;
      playerCover.classList.remove("spinning");
      btn.innerHTML = ICON_PLAY;
      if (playBtnOf === btn) playBtnOf = null;
    });

    // 更新播放器信息
    playerEl.classList.remove("hidden");
    playerName.textContent = song.songname;
    playerSinger.textContent = song.singer || "未知歌手";
    playerCover.style.backgroundImage = "";

    if (song.albummid) {
      const coverUrl = API_BASE + "/api/cover?albummid=" + encodeURIComponent(song.albummid);
      const img = new Image();
      img.onload = () => {
        playerCover.style.backgroundImage = "url(" + coverUrl + ")";
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
  playerCover.classList.remove("spinning");
  highlightPlayBtn("");
  playerFill.style.width = "0%";
  playerCur.textContent = "00:00";
  playerDur.textContent = "00:00";
});

// 进度条点击跳转
const playerTrack = document.querySelector(".progress-track");
playerTrack.addEventListener("click", (e) => {
  if (!audio || !audio.duration) return;
  const rect = playerTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
});
