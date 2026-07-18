import { applyI18n, t } from "../shared/i18n.js";

const $ = (id) => document.getElementById(id);

const tabs = [...document.querySelectorAll("[data-tab]")];
const panels = {
  general: $("panel-general"),
  kept: $("panel-kept"),
  whitelist: $("panel-whitelist"),
  archive: $("panel-archive"),
  data: $("panel-data"),
};

const toastEl = $("toast");

init();

async function init() {
  applyI18n();
  bindTabs();
  bindGeneral();
  bindWhitelist();
  bindArchive();
  bindData();
  await refreshAll();

  const hash = (location.hash || "").replace("#", "");
  if (hash === "kept" || hash === "protected") selectTab("kept");
  else if (hash && panels[hash]) selectTab(hash);
}

function bindTabs() {
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });
}

function selectTab(name) {
  tabs.forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  });
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("hidden", !on);
  });
  if (name === "archive") loadArchive();
  if (name === "whitelist") loadWhitelist();
  if (name === "kept") loadKept();
  history.replaceState(null, "", `#${name}`);
}

function bindGeneral() {
  $("saveGeneral").addEventListener("click", () => saveGeneral(true));
  $("refreshPreview").addEventListener("click", loadPreview);
  $("runSweep").addEventListener("click", async () => {
    const res = await send({ type: "RUN_SWEEP" });
    toast(
      res.closedCount ? t("closedN", [String(res.closedCount)]) : t("nothingEligible")
    );
    await refreshAll();
  });

  for (const id of [
    "protectPinned",
    "protectAudio",
    "showPageButton",
    "enabledToggle",
    "pausedToggle",
    "autoSync",
  ]) {
    $(id).addEventListener("change", () => saveGeneral(false));
  }
}

async function saveGeneral(showToast = true) {
  const patch = {
    enabled: $("enabledToggle").checked,
    paused: $("pausedToggle").checked,
    thresholdValue: Math.max(1, Number($("thresholdValue").value) || 1),
    thresholdUnit: $("thresholdUnit").value,
    protectPinned: $("protectPinned").checked,
    protectAudio: $("protectAudio").checked,
    minTabs: Math.max(1, Number($("minTabs").value) || 1),
    archiveCap: Math.min(5000, Math.max(50, Number($("archiveCap").value) || 500)),
    showPageButton: $("showPageButton").checked,
    autoSync: $("autoSync").checked,
  };
  if (patch.enabled && !patch.thresholdValue) {
    toast(t("needThreshold"));
    return;
  }
  const res = await send({ type: "SET_SETTINGS", patch });
  if (res.ok && showToast) toast(t("settingsSaved"));
  await refreshAll();
}

function bindWhitelist() {
  $("addRule").addEventListener("click", async () => {
    const pattern = $("rulePattern").value.trim();
    const mode = $("ruleMode").value;
    const res = await send({ type: "ADD_WHITELIST", pattern, mode });
    if (!res.ok) {
      toast(res.error || "Failed");
      return;
    }
    $("rulePattern").value = "";
    toast(t("ruleAdded"));
    renderWhitelist(res.whitelist || []);
  });
}

function bindArchive() {
  let timer;
  $("archiveQuery").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadArchive, 180);
  });
  $("clearArchive").addEventListener("click", async () => {
    if (!confirm(t("clearArchiveConfirm"))) return;
    await send({ type: "CLEAR_ARCHIVE" });
    toast(t("archiveCleared"));
    loadArchive();
    refreshStatsOnly();
  });
}

function bindData() {
  $("exportBtn").addEventListener("click", async () => {
    const res = await send({ type: "EXPORT" });
    if (!res.ok) return toast("Export failed");
    const blob = new Blob([JSON.stringify(res.bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tabflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("exportDone"));
  });

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await send({ type: "IMPORT", bundle });
      if (!res.ok) throw new Error(res.error || "Import failed");
      toast(t("importDone"));
      await refreshAll();
    } catch (err) {
      toast(err.message || "Invalid JSON");
    }
    e.target.value = "";
  });

  $("syncNow").addEventListener("click", async () => {
    const res = await send({ type: "SYNC_NOW" });
    toast(res.ok ? t("syncDone") : "Sync failed");
  });
}

async function refreshAll() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok) return;
  const s = res.settings;
  $("enabledToggle").checked = !!s.enabled;
  $("pausedToggle").checked = !!s.paused;
  $("thresholdValue").value = s.thresholdValue || 1;
  $("thresholdUnit").value = s.thresholdUnit || "hours";
  $("protectPinned").checked = s.protectPinned !== false;
  $("protectAudio").checked = s.protectAudio !== false;
  $("minTabs").value = s.minTabs ?? 3;
  $("archiveCap").value = s.archiveCap ?? 500;
  $("showPageButton").checked = !!s.showPageButton;
  $("autoSync").checked = s.autoSync !== false;

  $("statToday").textContent = String(res.stats?.closedToday ?? 0);
  $("statTotal").textContent = String(res.stats?.closedTotal ?? 0);
  $("statTabs").textContent = String(res.tabCount ?? 0);
  $("statArchive").textContent = String(res.archive?.length ?? 0);

  renderWhitelist(res.whitelist || []);
  renderKept(res.protected || []);
  await loadPreview();
}

async function refreshStatsOnly() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok) return;
  $("statArchive").textContent = String(res.archive?.length ?? 0);
}

async function loadPreview() {
  const res = await send({ type: "PREVIEW" });
  const list = $("previewList");
  if (!res.ok) {
    list.innerHTML = `<div class="empty">${esc(t("previewFail"))}</div>`;
    return;
  }
  const items = res.candidates || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">${esc(t("noEligible"))}</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (c) => `
    <div class="list-item">
      <div>
        <div class="title">${esc(c.title || c.url)}</div>
        <div class="sub mono">${formatIdle(c.idleMs)} · ${esc(c.url || "")}</div>
      </div>
    </div>`
    )
    .join("");
}

async function loadWhitelist() {
  const res = await send({ type: "GET_STATE" });
  if (res.ok) renderWhitelist(res.whitelist || []);
}

async function loadKept() {
  const res = await send({ type: "LIST_PROTECTED" });
  if (res.ok) renderKept(res.protected || []);
}

function renderKept(list) {
  const el = $("keptList");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${esc(t("noKept"))}</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (item) => `
    <div class="list-item">
      <div>
        <div class="title">${esc(item.title || item.url)}</div>
        <div class="sub mono">${esc(item.url)} · ${esc(
          (item.match || "url") === "origin" ? t("matchOrigin") : t("matchUrl")
        )}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm btn-danger" data-unkeep="${esc(item.id)}">${esc(
          t("remove")
        )}</button>
      </div>
    </div>`
    )
    .join("");

  el.querySelectorAll("[data-unkeep]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await send({ type: "UNPROTECT_TAB", id: btn.getAttribute("data-unkeep") });
      if (res.ok) {
        renderKept(res.protected || []);
        toast(t("tabUnprotectedToast"));
      }
    });
  });
}

function renderWhitelist(rules) {
  const list = $("whitelistList");
  if (!rules.length) {
    list.innerHTML = `<div class="empty">${esc(t("noWhitelist"))}</div>`;
    return;
  }
  list.innerHTML = rules
    .map(
      (r) => `
    <div class="list-item">
      <div>
        <div class="title">${esc(r.pattern)}</div>
        <div class="sub mono">${esc(r.mode)}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm btn-danger" data-remove="${esc(r.id)}">${esc(
          t("remove")
        )}</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await send({ type: "REMOVE_WHITELIST", id: btn.getAttribute("data-remove") });
      if (res.ok) renderWhitelist(res.whitelist || []);
    });
  });
}

async function loadArchive() {
  const q = $("archiveQuery").value;
  const res = await send({ type: "SEARCH_ARCHIVE", query: q });
  const list = $("archiveList");
  if (!res.ok) {
    list.innerHTML = `<div class="empty">${esc(t("previewFail"))}</div>`;
    return;
  }
  const items = res.archive || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">${esc(t("archiveEmpty"))}</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (e) => `
    <div class="list-item">
      <div>
        <div class="title">${esc(e.title || e.url)}</div>
        <div class="sub mono">${esc(e.url)} · ${formatTime(e.closedAt)}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm btn-primary" data-restore="${esc(e.id)}">${esc(
          t("restore")
        )}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-del="${esc(e.id)}">${esc(
          t("delete")
        )}</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "RESTORE_ARCHIVE", id: btn.getAttribute("data-restore"), remove: false });
      toast(t("restored"));
    });
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "DELETE_ARCHIVE", id: btn.getAttribute("data-del") });
      loadArchive();
      refreshStatsOnly();
    });
  });
}

function formatIdle(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}
