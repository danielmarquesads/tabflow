import { applyI18n, t } from "../shared/i18n.js";

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
const keepBtn = $("keepBtn");
const keepLabel = $("keepLabel");
const keepHint = $("keepHint");
const toastEl = $("toast");

let state = null;

init();

async function init() {
  applyI18n();
  await loadState();
  bind();
  await loadPreview();
}

function bind() {
  keepBtn.addEventListener("click", async () => {
    if (!state?.activeTab?.url) {
      toast(t("needThreshold"));
      return;
    }
    if (state.activeTab.protected) {
      const res = await send({ type: "UNPROTECT_TAB", tabId: state.activeTab.id });
      if (res.ok) {
        toast(t("tabUnprotectedToast"));
        await loadState();
        await loadPreview();
      }
      return;
    }
    const res = await send({ type: "PROTECT_TAB", tabId: state.activeTab.id, match: "url" });
    if (res.ok) {
      toast(t("tabProtectedToast"));
      await loadState();
      await loadPreview();
    }
  });

  enabledToggle.addEventListener("change", async () => {
    const patch = { enabled: enabledToggle.checked };
    if (enabledToggle.checked && (!state.settings.thresholdMs || state.settings.thresholdMs <= 0)) {
      toast(t("needThreshold"));
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
      toast(t("thresholdSaved"));
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
      toast(
        res.closedCount
          ? t("closedN", [String(res.closedCount)])
          : t("nothingEligible")
      );
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

  updateKeepUi(res.activeTab);
  updateStatusUi(s);
}

function updateKeepUi(activeTab) {
  const protectedOn = !!activeTab?.protected;
  keepBtn.classList.toggle("is-protected", protectedOn);
  if (protectedOn) {
    keepLabel.textContent = t("tabProtected");
    keepHint.textContent = activeTab?.title || activeTab?.url || "";
    keepBtn.textContent = t("removeKeep");
  } else {
    keepLabel.textContent = t("keepTabOpen");
    keepHint.textContent = t("keepTabOpenHint");
    keepBtn.textContent = t("keepTabOpen");
  }
  keepBtn.disabled = !activeTab?.url || activeTab.url.startsWith("chrome://");
}

function updateStatusUi(s) {
  statusPill.classList.remove("live", "paused");
  if (!s.enabled || !s.thresholdMs) {
    statusPill.textContent = t("statusOff");
    statusHint.textContent = t("autoCloseHint");
  } else if (s.paused) {
    statusPill.textContent = t("statusPaused");
    statusPill.classList.add("paused");
    statusHint.textContent = t("pausedHint");
  } else {
    statusPill.textContent = t("statusLive");
    statusPill.classList.add("live");
    statusHint.textContent = `≥ ${s.thresholdValue} ${t("unit" + cap(s.thresholdUnit))}`;
  }
}

function cap(unit) {
  const map = { minutes: "Minutes", hours: "Hours", days: "Days", months: "Months" };
  return map[unit] || "Hours";
}

async function loadPreview() {
  const res = await send({ type: "PREVIEW" });
  if (!res.ok) {
    previewList.innerHTML = `<div class="empty">${escapeHtml(t("previewFail"))}</div>`;
    return;
  }
  const items = res.candidates || [];
  if (!items.length) {
    previewList.innerHTML = `<div class="empty">${escapeHtml(t("noEligible"))}</div>`;
    return;
  }
  previewList.innerHTML = items
    .map(
      (c) => `
    <div class="list-item" role="listitem">
      <div>
        <div class="title">${escapeHtml(c.title || c.url || "Tab")}</div>
        <div class="sub mono">${formatIdle(c.idleMs)} ${escapeHtml(t("idleSuffix"))} · ${escapeHtml(shortUrl(c.url))}</div>
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
