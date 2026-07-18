const $ = (id) => document.getElementById(id);

const tabs = [...document.querySelectorAll("[data-tab]")];
const panels = {
  general: $("panel-general"),
  whitelist: $("panel-whitelist"),
  archive: $("panel-archive"),
  data: $("panel-data"),
};

const toastEl = $("toast");

init();

async function init() {
  bindTabs();
  bindGeneral();
  bindWhitelist();
  bindArchive();
  bindData();
  await refreshAll();

  const hash = (location.hash || "").replace("#", "");
  if (hash && panels[hash]) selectTab(hash);
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
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("hidden", !on);
  });
  if (name === "archive") loadArchive();
  if (name === "whitelist") loadWhitelist();
  history.replaceState(null, "", `#${name}`);
}

function bindGeneral() {
  $("saveGeneral").addEventListener("click", saveGeneral);
  $("refreshPreview").addEventListener("click", loadPreview);
  $("runSweep").addEventListener("click", async () => {
    const res = await send({ type: "RUN_SWEEP" });
    toast(res.closedCount ? `Closed ${res.closedCount}` : "Nothing eligible");
    await refreshAll();
  });

  // Live-save toggles for protect flags
  for (const id of ["protectPinned", "protectAudio", "showPageButton", "enabledToggle", "pausedToggle"]) {
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
  };
  if (patch.enabled && !patch.thresholdValue) {
    toast("Set a threshold first");
    return;
  }
  const res = await send({ type: "SET_SETTINGS", patch });
  if (res.ok && showToast) toast("Settings saved");
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
    toast("Rule added");
    renderWhitelist(res.whitelist || []);
  });
}

function bindArchive() {
  let t;
  $("archiveQuery").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(loadArchive, 180);
  });
  $("clearArchive").addEventListener("click", async () => {
    if (!confirm("Clear the entire local archive?")) return;
    await send({ type: "CLEAR_ARCHIVE" });
    toast("Archive cleared");
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
    toast("Export downloaded");
  });

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await send({ type: "IMPORT", bundle });
      if (!res.ok) throw new Error(res.error || "Import failed");
      toast("Import complete");
      await refreshAll();
    } catch (err) {
      toast(err.message || "Invalid JSON");
    }
    e.target.value = "";
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

  $("statToday").textContent = String(res.stats?.closedToday ?? 0);
  $("statTotal").textContent = String(res.stats?.closedTotal ?? 0);
  $("statTabs").textContent = String(res.tabCount ?? 0);
  $("statArchive").textContent = String(res.archive?.length ?? 0);

  renderWhitelist(res.whitelist || []);
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
    list.innerHTML = `<div class="empty">Preview unavailable</div>`;
    return;
  }
  const items = res.candidates || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">No tabs would close right now</div>`;
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

function renderWhitelist(rules) {
  const list = $("whitelistList");
  if (!rules.length) {
    list.innerHTML = `<div class="empty">No whitelist rules yet</div>`;
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
        <button type="button" class="btn btn-sm btn-danger" data-remove="${esc(r.id)}">Remove</button>
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
    list.innerHTML = `<div class="empty">Could not load archive</div>`;
    return;
  }
  const items = res.archive || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">Archive empty</div>`;
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
        <button type="button" class="btn btn-sm btn-primary" data-restore="${esc(e.id)}">Restore</button>
        <button type="button" class="btn btn-sm btn-ghost" data-del="${esc(e.id)}">Delete</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "RESTORE_ARCHIVE", id: btn.getAttribute("data-restore"), remove: false });
      toast("Restored");
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
  if (m < 60) return `${m}m idle`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h idle`;
  return `${Math.floor(h / 24)}d idle`;
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
