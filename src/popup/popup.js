const $ = (id) => document.getElementById(id);

const enabledToggle = $("enabledToggle");
const pausedToggle = $("pausedToggle");
const thresholdValue = $("thresholdValue");
const thresholdUnit = $("thresholdUnit");
const saveThreshold = $("saveThreshold");
const statusPill = $("statusPill");
const statusHint = $("statusHint");
const statToday = $("statToday");
const statTabs = $("statTabs");
const previewList = $("previewList");
const refreshPreview = $("refreshPreview");
const runSweep = $("runSweep");
const openArchive = $("openArchive");
const openOptions = $("openOptions");
const toastEl = $("toast");

let state = null;

init();

async function init() {
  await loadState();
  bind();
  await loadPreview();
}

function bind() {
  enabledToggle.addEventListener("change", async () => {
    const patch = { enabled: enabledToggle.checked };
    if (enabledToggle.checked && (!state.settings.thresholdMs || state.settings.thresholdMs <= 0)) {
      toast("Set and save a threshold first");
      enabledToggle.checked = false;
      return;
    }
    await send({ type: "SET_SETTINGS", patch });
    await loadState();
    await loadPreview();
  });

  pausedToggle.addEventListener("change", async () => {
    await send({ type: "SET_SETTINGS", patch: { paused: pausedToggle.checked } });
    await loadState();
    await loadPreview();
  });

  saveThreshold.addEventListener("click", async () => {
    const value = Math.max(1, Number(thresholdValue.value) || 1);
    const unit = thresholdUnit.value;
    const res = await send({
      type: "SET_SETTINGS",
      patch: {
        thresholdValue: value,
        thresholdUnit: unit,
        enabled: true,
      },
    });
    if (res.ok) {
      toast("Threshold saved · auto-close on");
      await loadState();
      await loadPreview();
    }
  });

  refreshPreview.addEventListener("click", loadPreview);
  runSweep.addEventListener("click", async () => {
    runSweep.disabled = true;
    const res = await send({ type: "RUN_SWEEP" });
    runSweep.disabled = false;
    if (res.ok) {
      toast(res.closedCount ? `Closed ${res.closedCount} tab(s)` : "Nothing eligible");
      await loadState();
      await loadPreview();
    }
  });

  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  openArchive.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#archive") });
  });
}

async function loadState() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok) return;
  state = res;
  const s = res.settings;

  enabledToggle.checked = !!s.enabled;
  pausedToggle.checked = !!s.paused;
  thresholdValue.value = s.thresholdValue || 1;
  thresholdUnit.value = s.thresholdUnit || "hours";
  statToday.textContent = String(res.stats?.closedToday ?? 0);
  statTabs.textContent = String(res.tabCount ?? 0);

  updateStatusUi(s);
}

function updateStatusUi(s) {
  statusPill.classList.remove("live", "paused");
  if (!s.enabled || !s.thresholdMs) {
    statusPill.textContent = "Off";
    statusHint.textContent = "Set a threshold to enable";
  } else if (s.paused) {
    statusPill.textContent = "Paused";
    statusPill.classList.add("paused");
    statusHint.textContent = "Auto-close paused";
  } else {
    statusPill.textContent = "Live";
    statusPill.classList.add("live");
    statusHint.textContent = `Idle ≥ ${s.thresholdValue} ${s.thresholdUnit}`;
  }
}

async function loadPreview() {
  const res = await send({ type: "PREVIEW" });
  if (!res.ok) {
    previewList.innerHTML = `<div class="empty">Could not load preview</div>`;
    return;
  }
  const items = res.candidates || [];
  if (!items.length) {
    previewList.innerHTML = `<div class="empty">No tabs eligible right now</div>`;
    return;
  }
  previewList.innerHTML = items
    .map(
      (c) => `
    <div class="list-item" role="listitem">
      <div>
        <div class="title">${escapeHtml(c.title || c.url || "Tab")}</div>
        <div class="sub mono">${formatIdle(c.idleMs)} idle · ${escapeHtml(shortUrl(c.url))}</div>
      </div>
    </div>`
    )
    .join("");
}

function formatIdle(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname === "/" ? "" : u.pathname.slice(0, 24));
  } catch {
    return url || "";
  }
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}
