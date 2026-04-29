/* ============================================================
   表情包工坊 – Vanilla JS Application
   ============================================================ */

"use strict";

// ── App state ──────────────────────────────────────────────────────────────

const state = {
  prompt: "",
  refImageB64: null,
  refImageMime: "image/png",

  // Generation results
  gridImageB64: null,
  gridImageMime: "image/png",
  bannerImageB64: null,
  bannerImageMime: "image/png",
  logoImageB64: null,
  logoImageMime: "image/png",
  title: "",
  description: "",
  slices: [],

  // Crop studio
  xCuts: [],
  yCuts: [],
  origWidth: 0,
  origHeight: 0,

  // Generated prompts
  gridPrompt: "",
  bannerPrompt: "",
  logoPrompt: "",

  // Uploaded assets (pending, before "use" is clicked)
  uploadedGrid: null,
  uploadedBanner: null,
  uploadedLogo: null,

  // UI
  generating: false,
  generatingPrompts: false,
  hasResults: false,
  cropStudioOpen: false,
};

// ── DOM refs ───────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── SVG Icon helpers ──────────────────────────────────────────────────────

const icons = {
  spinner: '<span class="spinner"></span>',
  spinnerDark: '<span class="spinner spinner-dark"></span>',
  bolt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  crop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6.13 1L6 16a2 2 0 002 2h15"/><path d="M1 6.13L16 6a2 2 0 012 2v15"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
};

// ── Settings (localStorage) ────────────────────────────────────────────────

const SETTINGS_KEY = "wxemoji_settings";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(obj) {
  const current = loadSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...obj }));
}

function getApiHeaders() {
  const s = loadSettings();
  const h = {};
  if (s.apiKey) h["X-Api-Key"] = s.apiKey;
  if (s.baseUrl) h["X-Base-Url"] = s.baseUrl;
  return h;
}

// ── Toast notifications ────────────────────────────────────────────────────

function showToast(message, type = "info", duration = 3500) {
  const container = $("#toast-container");
  const svgIcons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${svgIcons[type] || svgIcons.info}</span>
                  <span class="toast-msg">${escHtml(message)}</span>`;
  container.appendChild(el);

  const remove = () => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };

  const timer = setTimeout(remove, duration);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}

// ── Lightbox ───────────────────────────────────────────────────────────────

function openLightbox(src) {
  const lb = $("#lightbox-backdrop");
  const img = $("#lightbox-img");
  img.src = `data:image/png;base64,${src}`;
  lb.classList.add("open");
}

function closeLightbox() {
  const lb = $("#lightbox-backdrop");
  lb.classList.remove("open");
  setTimeout(() => {
    $("#lightbox-img").src = "";
  }, 300);
}

// ── Settings modal ─────────────────────────────────────────────────────────

function openSettings() {
  const s = loadSettings();
  $("#settings-api-key").value = s.apiKey || "";
  $("#settings-base-url").value = s.baseUrl || "";
  $("#settings-modal").classList.add("open");
}

function closeSettings() {
  $("#settings-modal").classList.remove("open");
}

function saveSettingsFromModal() {
  const apiKey = $("#settings-api-key").value.trim();
  const baseUrl = $("#settings-base-url").value.trim();
  saveSettings({ apiKey, baseUrl });
  closeSettings();
  showToast("设置已保存", "success");
}

// ── Reference image upload ─────────────────────────────────────────────────

function handleRefImageUpload(file) {
  const imageMime = getImageMime(file);
  if (!imageMime) {
    showToast("请上传图片文件", "warning");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("图片文件不能超过 10MB", "warning");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const [header, b64] = dataUrl.split(",");
    const mime = header.match(/data:([^;]+)/)?.[1] || imageMime;

    state.refImageB64 = b64;
    state.refImageMime = mime;

    const preview = $("#ref-image-preview");
    const zone = $("#upload-zone");
    preview.querySelector("img").src = dataUrl;
    preview.classList.remove("hidden");
    zone.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

function getImageMime(file) {
  if (!file) return null;
  if (file.type?.startsWith("image/")) return file.type;

  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeByExt = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jpge: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return mimeByExt[ext] || null;
}

function removeRefImage() {
  state.refImageB64 = null;
  state.refImageMime = "image/png";
  $("#ref-image-preview").classList.add("hidden");
  $("#upload-zone").classList.remove("hidden");
  $("#ref-file-input").value = "";
}

// ── Progress UI ────────────────────────────────────────────────────────────

const STEPS = [
  { key: "grid", label: "生成网格图" },
  { key: "grid_done", label: "自动切片" },
  { key: "slice_done", label: "生成横幅" },
  { key: "banner_done", label: "生成图标" },
  { key: "logo_done", label: "生成文案" },
  { key: "meta_done", label: "完成" },
];

function showProgress() {
  const wrap = $("#progress-wrap");
  wrap.classList.add("visible");

  const stepsEl = $("#progress-steps");
  stepsEl.innerHTML = STEPS.map(
    (s) => `<span class="progress-step" data-step="${s.key}">${s.label}</span>`,
  ).join("");
}

function updateProgress(step, message, pct) {
  $("#progress-message").textContent = message;
  $("#progress-pct").textContent = `${pct}%`;
  $("#progress-bar-fill").style.width = `${pct}%`;

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  $$(".progress-step").forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i < stepIdx) el.classList.add("done");
    else if (i === stepIdx) el.classList.add("active");
  });
}

function hideProgress() {
  $("#progress-wrap").classList.remove("visible");
}

// ── Generate pipeline (SSE) ────────────────────────────────────────────────

async function generateAll() {
  if (state.generating) return;

  const prompt = $("#prompt-input").value.trim();
  if (!prompt) {
    showToast("请输入提示词", "warning");
    $("#prompt-input").focus();
    return;
  }

  state.prompt = prompt;
  state.generating = true;

  const btn = $("#btn-generate");
  btn.disabled = true;
  btn.innerHTML = `${icons.spinner} 生成中…`;

  showProgress();
  updateProgress("grid", "正在连接服务…", 5);

  clearResults();

  try {
    const body = {
      prompt,
      reference_image_base64: state.refImageB64 || null,
      reference_image_mime: state.refImageMime,
    };

    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "请求失败" }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const chunk of events) {
        if (!chunk.trim()) continue;

        let eventType = "message";
        let dataStr = "";

        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          if (line.startsWith("data: ")) dataStr = line.slice(6);
        }

        if (!dataStr) continue;

        let data;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        if (eventType === "progress") {
          updateProgress(data.step, data.message, data.pct);
        } else if (eventType === "error") {
          throw new Error(data.message || "生成失败");
        } else if (eventType === "done") {
          handleGenerationDone(data);
        }
      }
    }
  } catch (err) {
    hideProgress();
    showToast(`生成失败：${err.message}`, "error", 6000);
    console.error("[generate]", err);
  } finally {
    state.generating = false;
    btn.disabled = false;
    btn.innerHTML = `${icons.bolt} 开始生成`;
  }
}

function handleGenerationDone(data) {
  state.gridImageB64 = data.grid_image || null;
  state.gridImageMime = "image/png";
  state.bannerImageB64 = data.banner_image || null;
  state.bannerImageMime = "image/png";
  state.logoImageB64 = data.logo_image || null;
  state.logoImageMime = "image/png";
  state.title = data.title || "";
  state.description = data.description || "";
  state.slices = data.slices || [];
  state.xCuts = data.x_cuts || [];
  state.yCuts = data.y_cuts || [];

  if (state.xCuts.length) state.origWidth = state.xCuts[state.xCuts.length - 1];
  if (state.yCuts.length) state.origHeight = state.yCuts[state.yCuts.length - 1];

  state.hasResults = true;
  hideProgress();
  renderResults();
  showToast("生成完成！", "success");

  switchTab("generate");

  const cropTab = $("#tab-crop");
  cropTab.classList.remove("hidden");
  cropTab.classList.add("has-badge");
}

// ── Clear / render results ─────────────────────────────────────────────────

function clearResults() {
  state.hasResults = false;
  state.gridImageB64 = null;
  state.gridImageMime = "image/png";
  state.bannerImageB64 = null;
  state.bannerImageMime = "image/png";
  state.logoImageB64 = null;
  state.logoImageMime = "image/png";
  state.title = "";
  state.description = "";
  state.slices = [];
  state.xCuts = [];
  state.yCuts = [];

  $("#results-area").classList.add("hidden");
  $("#empty-state").classList.remove("hidden");
  $("#tab-crop").classList.add("hidden");
}

function renderResults() {
  $("#empty-state").classList.add("hidden");
  $("#results-area").classList.remove("hidden");

  $("#meta-title").textContent = state.title;
  $("#meta-description").textContent = state.description;

  if (state.bannerImageB64) {
    const bannerImg = $("#banner-img");
    bannerImg.src = `data:${state.bannerImageMime || "image/png"};base64,${state.bannerImageB64}`;
    $("#banner-card").classList.remove("hidden");
  }

  if (state.logoImageB64) {
    const logoImg = $("#logo-img");
    logoImg.src = `data:${state.logoImageMime || "image/png"};base64,${state.logoImageB64}`;
    $("#logo-card").classList.remove("hidden");
  }

  renderSlices(state.slices);

  if (state.gridImageB64) {
    $("#grid-card").classList.remove("hidden");
  }
}

function renderSlices(slices) {
  const grid = $("#meme-grid-display");
  grid.innerHTML = "";

  slices.forEach((b64, idx) => {
    const cell = document.createElement("div");
    cell.className = "meme-cell";
    cell.innerHTML = `
      <img src="data:image/png;base64,${b64}" alt="表情 ${idx + 1}" loading="lazy">
      <div class="meme-cell-overlay">
        <span class="meme-cell-overlay-icon">${icons.search}</span>
      </div>`;
    cell.addEventListener("click", () => openLightbox(b64));
    grid.appendChild(cell);
  });
}

// ── Tab switching ──────────────────────────────────────────────────────────

function switchTab(tabName) {
  $$(".nav-tab").forEach((t) => t.classList.remove("active"));
  $$(".tab-panel").forEach((p) => {
    p.classList.remove("active");
    p.style.display = "none";
  });

  const tab = $(`#tab-${tabName}`);
  const panel = $(`#panel-${tabName}`);
  if (tab) tab.classList.add("active");
  if (panel) {
    if (tabName === "upload" || tabName === "crop") {
      document.body.appendChild(panel);
    } else {
      const main = $(".main-content");
      if (main && panel.parentElement !== main) main.appendChild(panel);
    }
    panel.classList.add("active");
    panel.style.display = "flex";
    panel.style.minHeight = "1px";
    if (tabName === "upload" || tabName === "crop") {
      Object.assign(panel.style, {
        width: "auto",
        position: "fixed",
        top: "var(--header-height)",
        left: "var(--sidebar-width)",
        right: "0",
        bottom: "0",
        zIndex: "5",
        overflowY: "auto",
        padding: "28px",
        background: "var(--bg)",
        boxSizing: "border-box",
        opacity: "1",
        visibility: "visible",
        pointerEvents: "auto",
      });
    } else {
      Object.assign(panel.style, {
        width: "100%",
        position: "",
        top: "",
        left: "",
        right: "",
        bottom: "",
        zIndex: "",
        overflowY: "",
        padding: "",
        background: "",
      });
    }
  }

  if (tabName === "crop") {
    if (state.hasResults && state.gridImageB64) {
      initCropStudio();
    }
  }
}

// ── Collapse / accordion ───────────────────────────────────────────────────

function toggleCollapse(toggleEl) {
  const bodyEl = toggleEl.nextElementSibling;
  const isOpen = toggleEl.classList.contains("open");
  toggleEl.classList.toggle("open", !isOpen);
  bodyEl.classList.toggle("open", !isOpen);
}

// ── Crop Studio ────────────────────────────────────────────────────────────

let cropHRatios = [];
let cropVRatios = [];

let cropImg = null;
let cropContainer = null;
let cropImgEl = null;

let dragging = null;

function initCropStudio() {
  const studio = $("#crop-studio-panel");
  studio.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "crop-image-wrapper";

  const container = document.createElement("div");
  container.className = "crop-image-container";
  container.id = "crop-container";

  const img = document.createElement("img");
  img.id = "crop-img";
  img.src = `data:${state.gridImageMime || "image/png"};base64,${state.gridImageB64}`;
  img.draggable = false;
  img.alt = "表情包网格";

  container.appendChild(img);
  wrapper.appendChild(container);
  studio.appendChild(wrapper);

  cropContainer = container;
  cropImgEl = img;

  img.onload = () => {
    cropImg = img;
    const W = state.origWidth || img.naturalWidth;
    const H = state.origHeight || img.naturalHeight;
    state.origWidth = W;
    state.origHeight = H;

    cropVRatios = state.xCuts.slice(1, -1).map((v) => v / W);
    cropHRatios = state.yCuts.slice(1, -1).map((v) => v / H);

    renderCropOverlay();
    buildCropPreviewGrid();
    updateCropPreview();
  };

  if (img.complete && img.naturalWidth > 0) img.onload();
}

function renderCropOverlay() {
  $$(".crop-line, .crop-handle", cropContainer).forEach((el) => el.remove());

  const dispW = cropImgEl.offsetWidth || cropImgEl.clientWidth;
  const dispH = cropImgEl.offsetHeight || cropImgEl.clientHeight;

  if (!dispW || !dispH) {
    requestAnimationFrame(renderCropOverlay);
    return;
  }

  cropHRatios.forEach((ratio, i) => {
    const px = ratio * dispH;

    const line = document.createElement("div");
    line.className = "crop-line horizontal";
    line.dataset.axis = "y";
    line.dataset.index = i;
    line.style.top = `${px}px`;

    const handle = document.createElement("div");
    handle.className = "crop-handle h-handle";
    handle.dataset.axis = "y";
    handle.dataset.index = i;
    handle.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,107,0.9)" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

    line.appendChild(handle);
    cropContainer.appendChild(line);

    addDragListeners(line, "y", i);
    addDragListeners(handle, "y", i);
  });

  cropVRatios.forEach((ratio, i) => {
    const px = ratio * dispW;

    const line = document.createElement("div");
    line.className = "crop-line vertical";
    line.dataset.axis = "x";
    line.dataset.index = i;
    line.style.left = `${px}px`;

    const handle = document.createElement("div");
    handle.className = "crop-handle v-handle";
    handle.dataset.axis = "x";
    handle.dataset.index = i;
    handle.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(66,165,245,0.9)" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/></svg>';

    line.appendChild(handle);
    cropContainer.appendChild(line);

    addDragListeners(line, "x", i);
    addDragListeners(handle, "x", i);
  });
}

// ── Drag logic ─────────────────────────────────────────────────────────────

function addDragListeners(el, axis, index) {
  const onStart = (e) => {
    e.preventDefault();
    const clientPos = e.touches
      ? e.touches[0][axis === "y" ? "clientY" : "clientX"]
      : e[axis === "y" ? "clientY" : "clientX"];
    dragging = { axis, index, startClient: clientPos };

    el.classList.add("dragging");
    document.body.style.cursor = axis === "y" ? "ns-resize" : "ew-resize";
    document.body.style.userSelect = "none";
  };

  el.addEventListener("mousedown", onStart);
  el.addEventListener("touchstart", onStart, { passive: false });
}

function onDragMove(e) {
  if (!dragging || !cropImgEl) return;
  e.preventDefault();

  const { axis, index, startClient } = dragging;
  const clientPos = e.touches
    ? e.touches[0][axis === "y" ? "clientY" : "clientX"]
    : e[axis === "y" ? "clientY" : "clientX"];

  const rect = cropImgEl.getBoundingClientRect();
  const dispLen = axis === "y" ? rect.height : rect.width;

  const relPos = clientPos - (axis === "y" ? rect.top : rect.left);

  let newRatio = Math.max(0.001, Math.min(0.999, relPos / dispLen));

  const MIN_GAP = 20 / dispLen;

  if (axis === "y") {
    const prev = index === 0 ? 0 : cropHRatios[index - 1];
    const next = index === cropHRatios.length - 1 ? 1 : cropHRatios[index + 1];
    newRatio = Math.max(prev + MIN_GAP, Math.min(next - MIN_GAP, newRatio));
    cropHRatios[index] = newRatio;

    const lineEl = cropContainer.querySelector(
      `.crop-line.horizontal[data-index="${index}"]`,
    );
    if (lineEl) lineEl.style.top = `${newRatio * dispLen}px`;
  } else {
    const prev = index === 0 ? 0 : cropVRatios[index - 1];
    const next = index === cropVRatios.length - 1 ? 1 : cropVRatios[index + 1];
    newRatio = Math.max(prev + MIN_GAP, Math.min(next - MIN_GAP, newRatio));
    cropVRatios[index] = newRatio;

    const lineEl = cropContainer.querySelector(
      `.crop-line.vertical[data-index="${index}"]`,
    );
    if (lineEl) lineEl.style.left = `${newRatio * dispLen}px`;
  }

  scheduleCropPreviewUpdate();
}

function onDragEnd() {
  if (!dragging) return;
  const { axis, index } = dragging;

  const lineEl = cropContainer
    ? cropContainer.querySelector(
        `.crop-line[data-axis="${axis}"][data-index="${index}"]`,
      )
    : null;
  if (lineEl) lineEl.classList.remove("dragging");

  dragging = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  updateCropPreview();
}

document.addEventListener("mousemove", onDragMove);
document.addEventListener("touchmove", onDragMove, { passive: false });
document.addEventListener("mouseup", onDragEnd);
document.addEventListener("touchend", onDragEnd);

// ── Crop preview grid ──────────────────────────────────────────────────────

let cropPreviewCanvases = [];

function buildCropPreviewGrid() {
  const grid = $("#crop-preview-grid");
  grid.innerHTML = "";
  cropPreviewCanvases = [];

  for (let i = 0; i < 24; i++) {
    const cell = document.createElement("div");
    cell.className = "crop-preview-cell";
    const canvas = document.createElement("canvas");
    cell.appendChild(canvas);
    grid.appendChild(cell);
    cropPreviewCanvases.push(canvas);
  }
}

let previewRafId = null;

function scheduleCropPreviewUpdate() {
  if (previewRafId) cancelAnimationFrame(previewRafId);
  previewRafId = requestAnimationFrame(updateCropPreview);
}

function updateCropPreview() {
  previewRafId = null;
  if (!cropImg || !cropImg.complete || !cropImg.naturalWidth) return;

  const W = state.origWidth;
  const H = state.origHeight;

  const xCuts = [0, ...cropVRatios.map((r) => Math.round(r * W)), W];
  const yCuts = [0, ...cropHRatios.map((r) => Math.round(r * H)), H];

  const COLS = 6,
    ROWS = 4;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      const canvas = cropPreviewCanvases[idx];
      if (!canvas) continue;

      const sx = xCuts[col];
      const sy = yCuts[row];
      const sw = xCuts[col + 1] - sx;
      const sh = yCuts[row + 1] - sy;

      const cellSize = canvas.parentElement.clientWidth || 60;
      canvas.width = cellSize;
      canvas.height = cellSize;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, cellSize, cellSize);

      if (sw > 0 && sh > 0) {
        const scale = Math.min(cellSize / sw, cellSize / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (cellSize - dw) / 2;
        const dy = (cellSize - dh) / 2;

        ctx.drawImage(cropImg, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    }
  }
}

// ── Confirm crop (send to backend) ────────────────────────────────────────

async function confirmCrop() {
  if (!state.gridImageB64) {
    showToast("没有可裁切的图像", "warning");
    return;
  }

  const W = state.origWidth;
  const H = state.origHeight;

  const xCuts = [0, ...cropVRatios.map((r) => Math.round(r * W)), W];
  const yCuts = [0, ...cropHRatios.map((r) => Math.round(r * H)), H];

  const btn = $("#btn-confirm-crop");
  btn.disabled = true;
  btn.innerHTML = `${icons.spinner} 裁切中…`;

  try {
    const resp = await fetch("/api/crop", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() },
      body: JSON.stringify({
        image_base64: state.gridImageB64,
        x_cuts: xCuts,
        y_cuts: yCuts,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "请求失败" }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    state.slices = data.slices;
    state.xCuts = xCuts;
    state.yCuts = yCuts;
    state.hasResults = true;

    renderSlices(state.slices);
    _refreshUploadDownloadBar();

    showToast("裁切成功！表情包已更新", "success");

    switchTab("generate");
  } catch (err) {
    showToast(`裁切失败：${err.message}`, "error");
    console.error("[crop]", err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icons.crop} 确认裁切`;
  }
}

// ── Reset crop lines ───────────────────────────────────────────────────────

function resetCropLines() {
  const W = state.origWidth;
  const H = state.origHeight;

  if (!W || !H) return;

  cropVRatios = state.xCuts.slice(1, -1).map((v) => v / W);
  cropHRatios = state.yCuts.slice(1, -1).map((v) => v / H);

  renderCropOverlay();
  updateCropPreview();
  showToast("裁切线已重置", "info");
}

// ── Generate prompts only ──────────────────────────────────────────────────

async function generatePrompts() {
  if (state.generatingPrompts) return;

  const prompt = $("#prompt-input").value.trim();
  if (!prompt) {
    showToast("请先输入提示词描述", "warning");
    $("#prompt-input").focus();
    return;
  }

  state.generatingPrompts = true;
  const btn = $("#btn-gen-prompts");
  btn.disabled = true;
  btn.innerHTML = `${icons.spinnerDark} 生成中…`;

  try {
    const resp = await fetch("/api/generate-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() },
      body: JSON.stringify({ prompt }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    state.gridPrompt   = data.grid_prompt   || "";
    state.bannerPrompt = data.banner_prompt || "";
    state.logoPrompt   = data.logo_prompt   || "";
    if (data.title)       state.title       = data.title;
    if (data.description) state.description = data.description;

    const setEl = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || "";
    };
    setEl("prompt-title-text",  data.title        || "");
    setEl("prompt-desc-text",   data.description  || "");
    setEl("prompt-grid-text",   data.grid_prompt   || "");
    setEl("prompt-banner-text", data.banner_prompt || "");
    setEl("prompt-logo-text",   data.logo_prompt   || "");

    const area = document.getElementById("prompts-area");
    if (area) {
      area.classList.remove("hidden");
      area.style.display = "";
    }

    switchTab("generate");

    setTimeout(() => {
      if (area) area.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    showToast("提示词生成完成！点击复制按钮复制", "success", 4000);
  } catch (err) {
    showToast(`提示词生成失败：${err.message}`, "error", 5000);
    console.error("[gen-prompts]", err);
  } finally {
    state.generatingPrompts = false;
    btn.disabled = false;
    btn.innerHTML = `${icons.doc} 仅生成提示词`;
  }
}

function copyPrompt(elemId) {
  const el = document.getElementById(elemId);
  if (!el) return;
  const text = el.textContent.trim();
  if (!text) {
    showToast("暂无内容", "warning");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("已复制到剪贴板", "success", 2000);
    })
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("已复制", "success", 2000);
    });
}

// ── Upload asset helpers ───────────────────────────────────────────────────

function _readFileAsB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const b64 = dataUrl.split(",")[1];
      const mime =
        dataUrl.split(";")[0].split(":")[1] || getImageMime(file) || "image/png";
      resolve({ b64, mime, name: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function handleUploadDrop(event, type) {
  event.preventDefault();
  const zone = event.currentTarget;
  zone.classList.remove("drag-over");
  const file = event.dataTransfer.files[0];
  if (file) handleUploadFile(file, type);
}

async function handleUploadFile(file, type) {
  if (!getImageMime(file)) {
    showToast("请上传图片文件", "warning");
    return;
  }
  try {
    const asset = await _readFileAsB64(file);

    if (type === "grid") {
      state.uploadedGrid = asset;
      const img = $("#upload-grid-img");
      img.src = `data:${asset.mime};base64,${asset.b64}`;
      $("#upload-grid-placeholder").classList.add("hidden");
      const prev = $("#upload-grid-preview");
      prev.classList.remove("hidden");
      prev.style.display = "";
      $("#upload-grid-filename").textContent = file.name;
      $("#btn-upload-grid-slice").disabled = false;
      $("#btn-upload-grid-clear").style.display = "";
    } else if (type === "banner") {
      state.uploadedBanner = asset;
      state.bannerImageB64 = asset.b64;
      state.bannerImageMime = asset.mime;
      const img = $("#upload-banner-img");
      img.src = `data:${asset.mime};base64,${asset.b64}`;
      $("#upload-banner-placeholder").classList.add("hidden");
      const prev = $("#upload-banner-preview");
      prev.classList.remove("hidden");
      prev.style.display = "";
      $("#upload-banner-filename").textContent = file.name;
      $("#btn-upload-banner-use").disabled = true;
      $("#btn-upload-banner-use").textContent = "已加入打包";
      $("#btn-upload-banner-clear").style.display = "";
    } else if (type === "logo") {
      state.uploadedLogo = asset;
      state.logoImageB64 = asset.b64;
      state.logoImageMime = asset.mime;
      const img = $("#upload-logo-img");
      img.src = `data:${asset.mime};base64,${asset.b64}`;
      $("#upload-logo-placeholder").classList.add("hidden");
      const prev = $("#upload-logo-preview");
      prev.classList.remove("hidden");
      prev.style.display = "";
      $("#upload-logo-filename").textContent = file.name;
      $("#btn-upload-logo-use").disabled = true;
      $("#btn-upload-logo-use").textContent = "已加入打包";
      $("#btn-upload-logo-clear").style.display = "";
    }

    _refreshUploadDownloadBar();
  } catch (err) {
    showToast(`文件读取失败：${err.message}`, "error");
  }
}

function clearUpload(type) {
  if (type === "grid") {
    state.uploadedGrid = null;
    $("#upload-grid-img").src = "";
    $("#upload-grid-placeholder").classList.remove("hidden");
    $("#upload-grid-preview").classList.add("hidden");
    $("#btn-upload-grid-slice").disabled = true;
    $("#btn-upload-grid-clear").style.display = "none";
    document.getElementById("file-input-grid").value = "";
  } else if (type === "banner") {
    state.uploadedBanner = null;
    state.bannerImageB64 = null;
    state.bannerImageMime = "image/png";
    $("#upload-banner-img").src = "";
    $("#upload-banner-placeholder").classList.remove("hidden");
    $("#upload-banner-preview").classList.add("hidden");
    $("#btn-upload-banner-use").disabled = true;
    $("#btn-upload-banner-use").textContent = "✔ 使用此横幅";
    $("#btn-upload-banner-clear").style.display = "none";
    document.getElementById("file-input-banner").value = "";
  } else if (type === "logo") {
    state.uploadedLogo = null;
    state.logoImageB64 = null;
    state.logoImageMime = "image/png";
    $("#upload-logo-img").src = "";
    $("#upload-logo-placeholder").classList.remove("hidden");
    $("#upload-logo-preview").classList.add("hidden");
    $("#btn-upload-logo-use").disabled = true;
    $("#btn-upload-logo-use").textContent = "✔ 使用此图标";
    $("#btn-upload-logo-clear").style.display = "none";
    document.getElementById("file-input-logo").value = "";
  }
  _refreshUploadDownloadBar();
}

function useUploadedAsset(type) {
  if (type === "banner" && state.uploadedBanner) {
    state.bannerImageB64 = state.uploadedBanner.b64;
    state.bannerImageMime = state.uploadedBanner.mime;
    state.hasResults = true;
    const bannerImg = $("#banner-img");
    bannerImg.src = `data:${state.bannerImageMime};base64,${state.bannerImageB64}`;
    $("#banner-card").classList.remove("hidden");
    $("#results-area").classList.remove("hidden");
    $("#empty-state").classList.add("hidden");
    showToast("横幅图已更新", "success");
  } else if (type === "logo" && state.uploadedLogo) {
    state.logoImageB64 = state.uploadedLogo.b64;
    state.logoImageMime = state.uploadedLogo.mime;
    state.hasResults = true;
    const logoImg = $("#logo-img");
    logoImg.src = `data:${state.logoImageMime};base64,${state.logoImageB64}`;
    $("#logo-card").classList.remove("hidden");
    $("#results-area").classList.remove("hidden");
    $("#empty-state").classList.add("hidden");
    showToast("图标已更新", "success");
  }
  _refreshUploadDownloadBar();
}

async function sliceUploadedGrid() {
  const asset = state.uploadedGrid;
  if (!asset) {
    showToast("请先上传网格图", "warning");
    return;
  }

  const btn = $("#btn-upload-grid-slice");
  btn.disabled = true;
  btn.innerHTML = `${icons.spinnerDark} 分析中…`;

  try {
    const resp = await fetch("/api/slice", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() },
      body: JSON.stringify({ image_base64: asset.b64 }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    state.gridImageB64 = asset.b64;
    state.gridImageMime = asset.mime;
    state.xCuts = data.x_cuts;
    state.yCuts = data.y_cuts;
    state.slices = data.slices;
    state.origWidth = data.x_cuts[data.x_cuts.length - 1];
    state.origHeight = data.y_cuts[data.y_cuts.length - 1];
    state.hasResults = true;

    $("#grid-card").classList.remove("hidden");
    $("#results-area").classList.remove("hidden");
    $("#empty-state").classList.add("hidden");
    renderSlices(state.slices);

    const cropTab = $("#tab-crop");
    cropTab.classList.remove("hidden");
    cropTab.classList.add("has-badge");

    const sidebar = document.getElementById("sidebar-actions");
    if (sidebar) sidebar.classList.remove("hidden");

    showToast(
      `已识别 ${data.slices.length} 格，进入裁切工坊微调分割线`,
      "success",
      4000,
    );

    switchTab("crop");
  } catch (err) {
    showToast(`切片失败：${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icons.crop} 自动切片 &amp; 进入裁切工坊`;
  }
}

function getPackageTitle() {
  const promptTitle = ($("#prompt-input")?.value || "").trim().slice(0, 20);
  return state.title || promptTitle || "上传表情包素材";
}

function getPackageDescription() {
  if (state.description) return state.description;

  const parts = [];
  if (state.slices.length > 0) parts.push(`${state.slices.length} 张表情包`);
  if (state.bannerImageB64) parts.push("横幅图");
  if (state.logoImageB64) parts.push("图标");

  if (parts.length === 0) return "";
  return `包含${parts.join("、")}，可用于微信表情包素材整理。`;
}

function _refreshUploadDownloadBar() {
  const bar = $("#upload-download-bar");
  const summary = $("#upload-download-summary");
  if (!bar) return;

  const hasGrid = state.slices.length > 0;
  const hasBanner = !!state.bannerImageB64;
  const hasLogo = !!state.logoImageB64;

  if (!hasGrid && !hasBanner && !hasLogo) {
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  bar.style.display = "";
  const parts = [];
  if (hasGrid) parts.push(`${state.slices.length} 个表情包`);
  if (hasBanner) parts.push("横幅图");
  if (hasLogo) parts.push("图标");
  summary.textContent = parts.join("、");
}

// ── Download ZIP ───────────────────────────────────────────────────────────

async function downloadZip(triggerButton = null) {
  const hasAnything =
    state.slices.length > 0 || state.bannerImageB64 || state.logoImageB64;
  if (!hasAnything) {
    showToast("暂无可下载的素材，请先生成或上传", "warning");
    return;
  }

  const btn = triggerButton || $("#btn-download");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${icons.spinnerDark} 打包中…`;
  }

  try {
    const body = {
      slices: state.slices,
      banner_image: state.bannerImageB64 || "",
      banner_mime: state.bannerImageMime || "image/png",
      logo_image: state.logoImageB64 || "",
      logo_mime: state.logoImageMime || "image/png",
      title: getPackageTitle(),
      description: getPackageDescription(),
    };

    const resp = await fetch("/api/download-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "打包失败" }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    const cd = resp.headers.get("Content-Disposition") || "";
    const fnMatch = cd.match(/filename="([^"]+)"/);
    a.download = fnMatch ? fnMatch[1] : `${getPackageTitle() || "wxemoji"}.zip`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast("ZIP 下载已开始", "success");
  } catch (err) {
    showToast(`下载失败：${err.message}`, "error");
    console.error("[download]", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      const downloadSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      btn.innerHTML = btn.id === "btn-download"
        ? `${downloadSvg} 下载全套资源`
        : `${downloadSvg} 下载 ZIP`;
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Re-render overlay when window resizes
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (cropContainer && cropImgEl) {
      renderCropOverlay();
      updateCropPreview();
    }
  }, 200);
});

// ── DOM ready ──────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // ── File upload zone ───────────────────────────────────────────

  const fileInput = $("#ref-file-input");
  const uploadZone = $("#upload-zone");

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleRefImageUpload(fileInput.files[0]);
  });

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("drag-over");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleRefImageUpload(file);
  });

  // ── Remove ref image ───────────────────────────────────────────

  $("#btn-remove-ref").addEventListener("click", removeRefImage);

  // ── Generate button ────────────────────────────────────────────

  $("#btn-generate").addEventListener("click", generateAll);

  // Allow Ctrl+Enter in textarea
  $("#prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      generateAll();
    }
  });

  // ── Generate prompts button ────────────────────────────────────

  const btnGenPrompts = $("#btn-gen-prompts");
  if (btnGenPrompts) btnGenPrompts.addEventListener("click", generatePrompts);

  // ── Nav tabs ───────────────────────────────────────────────────

  $$(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      if (!name) return;
      if (name === "crop" && !state.gridImageB64) {
        showToast("请先生成或上传表情包网格图", "warning");
        return;
      }
      switchTab(name);
    });
  });

  // ── Settings ───────────────────────────────────────────────────

  $("#btn-open-settings").addEventListener("click", openSettings);
  $("#btn-close-settings").addEventListener("click", closeSettings);
  $("#btn-save-settings").addEventListener("click", saveSettingsFromModal);

  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // ── Lightbox ───────────────────────────────────────────────────

  $("#lightbox-backdrop").addEventListener("click", closeLightbox);
  $("#btn-lightbox-close").addEventListener("click", closeLightbox);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLightbox();
      if ($("#settings-modal").classList.contains("open")) closeSettings();
    }
  });

  // ── Image click-to-open ────────────────────────────────────────

  $("#banner-img").addEventListener("click", () => {
    if (state.bannerImageB64) openLightbox(state.bannerImageB64);
  });

  $("#logo-img").addEventListener("click", () => {
    if (state.logoImageB64) openLightbox(state.logoImageB64);
  });

  // ── Download ───────────────────────────────────────────────────

  $("#btn-download").addEventListener("click", (e) => downloadZip(e.currentTarget));

  // ── Crop studio buttons ────────────────────────────────────────

  $("#btn-open-crop").addEventListener("click", () => {
    if (!state.hasResults) {
      showToast("请先生成表情包", "warning");
      return;
    }
    switchTab("crop");
  });

  $("#btn-confirm-crop").addEventListener("click", confirmCrop);
  $("#btn-reset-crop").addEventListener("click", resetCropLines);

  // ── Settings collapse ──────────────────────────────────────────

  const settingsToggle = $("#settings-collapse-toggle");
  if (settingsToggle) {
    settingsToggle.addEventListener("click", () => {
      toggleCollapse(settingsToggle);
    });
  }

  // ── Load saved settings into form ────────────────────────────

  const saved = loadSettings();
  if (saved.apiKey) $("#settings-api-key").value = saved.apiKey;
  if (saved.baseUrl) $("#settings-base-url").value = saved.baseUrl;

  // ── Initial tab ────────────────────────────────────────────────

  switchTab("generate");

  // ── Expose globals used by inline HTML handlers ────────────────
  window.handleUploadDrop = handleUploadDrop;
  window.handleUploadFile = handleUploadFile;
  window.clearUpload = clearUpload;
  window.useUploadedAsset = useUploadedAsset;
  window.sliceUploadedGrid = sliceUploadedGrid;
  window.downloadZip = downloadZip;
  window.copyPrompt = copyPrompt;
  window.toggleCollapse = toggleCollapse;

  console.log("[wxemoji] 表情包工坊 已就绪");
});
