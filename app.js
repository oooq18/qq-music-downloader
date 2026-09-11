const keywordEl = document.getElementById("keyword");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("resultMeta");
const listEl = document.getElementById("songList");

const QUALITY_LABELS = { flac: "FLAC 无损", 320: "320kbps", 128: "128kbps" };
const QUALITY_SIZE_KEYS = { flac: "sizeflac", 320: "size320", 128: "size128" };
const downloadStates = new Map();
let currentSongs = [];

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

    const top = document.createElement("div");
    top.className = "song-top";

    const info = document.createElement("div");
    info.style.flex = "1";
    info.style.minWidth = "0";
    info.innerHTML =
      '<div class="song-name">' + escapeHtml(song.songname) + "</div>" +
      '<div class="song-meta">' +
        "<span>" + escapeHtml(song.singer || "未知歌手") + "</span>" +
        '<span class="sep">·</span>' +
        "<span>" + escapeHtml(song.albumname || "未知专辑") + "</span>" +
        '<span class="sep">·</span>' +
        "<span>🕒 " + formatDuration(song.interval) + "</span>" +
      "</div>";
    top.appendChild(info);

    const qualities = document.createElement("div");
    qualities.className = "qualities";
    ["flac", "320", "128"].forEach((q) => {
      qualities.appendChild(renderQualityBtn(song, q));
    });
    top.appendChild(qualities);
    card.appendChild(top);
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
    const res = await fetch(
      API_BASE + "/api/music/download?songmid=" + encodeURIComponent(song.songmid) + "&quality=" + q
    );
    if (!res.ok) {
      let msg = "下载失败";
      try { const j = await res.json(); msg = j.message || j.error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
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
    downloadStates.get(key).status = "done";
    fill.style.width = "100%";

    const blob = new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
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
