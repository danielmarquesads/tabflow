import { applyI18n, t, loadLocale, UI_LOCALES } from "../shared/i18n.js";

const $ = (id) => document.getElementById(id);
const panels = {};
["general", "profiles", "domains", "kept", "whitelist", "archive", "import", "data"].forEach(
  (k) => {
    panels[k] = $(`panel-${k}`);
  }
);

let archiveMode = "groups";
let previewHorizon = 0;
const toastEl = $("toast");

init();

async function init() {
  fillLocaleSelect();
  const boot = await send({ type: "GET_STATE" });
  if (boot?.ok) await loadLocale(boot.settings?.uiLocale || "auto");
  applyI18n();
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });
  bindGeneral();
  bindProfiles();
  bindDomains();
  bindWhitelist();
  bindArchive();
  bindImport();
  bindData();
  await refreshAll();
  const hash = (location.hash || "").replace("#", "");
  if (hash && panels[hash]) selectTab(hash);
}

function fillLocaleSelect() {
  const sel = $("uiLocale");
  if (!sel) return;
  sel.innerHTML = UI_LOCALES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join("");
}

function selectTab(name) {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  });
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("hidden", !on);
  });
  if (name === "archive") loadArchive();
  if (name === "kept") loadKept();
  if (name === "whitelist") loadWhitelist();
  if (name === "domains") loadDomains();
  if (name === "profiles") loadProfiles();
  history.replaceState(null, "", `#${name}`);
}

function bindGeneral() {
  $("saveGeneral").addEventListener("click", () => saveGeneral(true));
  $("refreshPreview").addEventListener("click", () => {
    previewHorizon = 0;
    loadPreview();
  });
  $("simulateBtn").addEventListener("click", () => {
    previewHorizon = 3600000;
    loadPreview();
  });
  $("runSweep").addEventListener("click", async () => {
    const res = await send({ type: "RUN_SWEEP" });
    toast(
      res.closedCount
        ? t("closedN", [String(res.closedCount)])
        : t("nothingEligible")
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
    "graceEnabled",
  ]) {
    $(id)?.addEventListener("change", () => saveGeneral(false));
  }
  $("uiLocale")?.addEventListener("change", async () => {
    await saveGeneral(false);
    await loadLocale($("uiLocale").value || "auto");
    applyI18n();
    fillLocaleSelect();
    $("uiLocale").value = (await send({ type: "GET_STATE" })).settings?.uiLocale || "auto";
    toast(t("settingsSaved"));
  });
}

async function saveGeneral(showToast) {
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
    graceEnabled: $("graceEnabled").checked,
    graceSeconds: Math.max(0, Number($("graceSeconds").value) || 0),
    estMbPerTab: Math.max(1, Number($("estMbPerTab").value) || 50),
    uiLocale: $("uiLocale")?.value || "auto",
  };
  await send({ type: "SET_SETTINGS", patch });
  await loadLocale(patch.uiLocale);
  applyI18n();
  if (showToast) toast(t("settingsSaved"));
  await refreshAll();
}

function bindProfiles() {
  $("saveProfiles").addEventListener("click", async () => {
    const list = collectProfilesFromUi();
    await send({ type: "SAVE_PROFILES", profiles: list });
    let schedule = {};
    try {
      schedule = JSON.parse($("scheduleJson").value || "{}");
    } catch {
      toast("Invalid schedule JSON");
      return;
    }
    await send({
      type: "SET_SETTINGS",
      patch: {
        scheduleEnabled: $("scheduleEnabled").checked,
        schedule,
      },
    });
    toast(t("settingsSaved"));
    await refreshAll();
  });
}

function collectProfilesFromUi() {
  const rows = [...document.querySelectorAll("[data-profile-id]")];
  return rows.map((row) => ({
    id: row.getAttribute("data-profile-id"),
    name: row.querySelector("[data-p-name]")?.value || "Profile",
    thresholdValue: Math.max(1, Number(row.querySelector("[data-p-val]")?.value) || 1),
    thresholdUnit: row.querySelector("[data-p-unit]")?.value || "hours",
  }));
}

async function loadProfiles() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok) return;
  const el = $("profilesList");
  el.innerHTML = (res.profiles || [])
    .map(
      (p) => `
    <div class="list-item profile-row" data-profile-id="${esc(p.id)}">
      <div class="profile-grid">
        <input data-p-name value="${esc(p.name)}" />
        <input data-p-val type="number" min="1" value="${esc(p.thresholdValue)}" />
        <select data-p-unit>
          <option value="minutes" ${p.thresholdUnit === "minutes" ? "selected" : ""}>min</option>
          <option value="hours" ${p.thresholdUnit === "hours" ? "selected" : ""}>h</option>
          <option value="days" ${p.thresholdUnit === "days" ? "selected" : ""}>d</option>
        </select>
        <span class="muted tiny mono">${esc(p.id)}</span>
      </div>
    </div>`
    )
    .join("");
  $("scheduleEnabled").checked = !!res.settings.scheduleEnabled;
  $("scheduleJson").value = JSON.stringify(res.settings.schedule || {}, null, 2);
}

function bindDomains() {
  $("addDomain").addEventListener("click", async () => {
    const res = await send({
      type: "ADD_DOMAIN_RULE",
      pattern: $("domainPattern").value.trim(),
      mode: $("domainMode").value,
      thresholdValue: Number($("domainValue").value) || 1,
      thresholdUnit: $("domainUnit").value,
    });
    if (!res.ok) return toast(res.error || "Failed");
    $("domainPattern").value = "";
    toast(t("ruleAdded"));
    renderDomains(res.domainRules || []);
  });
}

async function loadDomains() {
  const res = await send({ type: "GET_STATE" });
  if (res.ok) renderDomains(res.domainRules || []);
}

function renderDomains(rules) {
  const el = $("domainList");
  if (!rules.length) {
    el.innerHTML = `<div class="empty">${esc(t("noWhitelist"))}</div>`;
    return;
  }
  el.innerHTML = rules
    .map(
      (r) => `
    <div class="list-item">
      <div>
        <div class="title">${esc(r.pattern)}</div>
        <div class="sub mono">${esc(r.mode)} · ${esc(r.thresholdValue)} ${esc(r.thresholdUnit)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-rm-domain="${esc(r.id)}">${esc(
        t("remove")
      )}</button>
    </div>`
    )
    .join("");
  el.querySelectorAll("[data-rm-domain]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await send({ type: "REMOVE_DOMAIN_RULE", id: btn.getAttribute("data-rm-domain") });
      if (res.ok) renderDomains(res.domainRules || []);
    });
  });
}

function bindWhitelist() {
  $("addRule").addEventListener("click", async () => {
    const res = await send({
      type: "ADD_WHITELIST",
      pattern: $("rulePattern").value.trim(),
      mode: $("ruleMode").value,
    });
    if (!res.ok) return toast(res.error || "Failed");
    $("rulePattern").value = "";
    toast(t("ruleAdded"));
    renderWhitelist(res.whitelist || []);
  });
}

async function loadWhitelist() {
  const res = await send({ type: "GET_STATE" });
  if (res.ok) renderWhitelist(res.whitelist || []);
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
      <div><div class="title">${esc(r.pattern)}</div><div class="sub mono">${esc(r.mode)}</div></div>
      <button type="button" class="btn btn-sm btn-danger" data-remove="${esc(r.id)}">${esc(
        t("remove")
      )}</button>
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
        <div class="sub mono">${esc(item.url)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-unkeep="${esc(item.id)}">${esc(
        t("remove")
      )}</button>
    </div>`
    )
    .join("");
  el.querySelectorAll("[data-unkeep]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await send({ type: "UNPROTECT_TAB", id: btn.getAttribute("data-unkeep") });
      if (res.ok) renderKept(res.protected || []);
    });
  });
}

function bindArchive() {
  let tmr;
  $("archiveQuery").addEventListener("input", () => {
    clearTimeout(tmr);
    tmr = setTimeout(loadArchive, 180);
  });
  $("clearArchive").addEventListener("click", async () => {
    if (!confirm(t("clearArchiveConfirm"))) return;
    await send({ type: "CLEAR_ARCHIVE" });
    loadArchive();
  });
  $("viewFlat").addEventListener("click", () => {
    archiveMode = "flat";
    loadArchive();
  });
  $("viewGroups").addEventListener("click", () => {
    archiveMode = "groups";
    loadArchive();
  });
}

async function loadArchive() {
  const res = await send({ type: "SEARCH_ARCHIVE", query: $("archiveQuery").value });
  const list = $("archiveList");
  if (!res.ok) {
    list.innerHTML = `<div class="empty">${esc(t("previewFail"))}</div>`;
    return;
  }
  if (archiveMode === "groups") {
    const groups = res.groups || [];
    if (!groups.length) {
      list.innerHTML = `<div class="empty">${esc(t("archiveEmpty"))}</div>`;
      return;
    }
    list.innerHTML = groups
      .map(
        (g) => `
      <div class="group-block">
        <div class="row between group-head">
          <strong>${esc(g.domain)} <span class="muted">(${g.count})</span></strong>
          <button type="button" class="btn btn-sm btn-primary" data-reopen-domain="${esc(
            g.domain
          )}">${esc(t("reopenSession"))}</button>
        </div>
        ${g.entries
          .slice(0, 8)
          .map(
            (e) => `
          <div class="list-item">
            <div>
              <div class="title">${esc(e.title || e.url)}</div>
              <div class="sub mono">${esc(e.url)}</div>
            </div>
            <button type="button" class="btn btn-sm" data-restore="${esc(e.id)}">${esc(
              t("restore")
            )}</button>
          </div>`
          )
          .join("")}
      </div>`
      )
      .join("");
  } else {
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
          <div class="sub mono">${esc(e.url)}</div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-sm btn-primary" data-restore="${esc(e.id)}">${esc(
            t("restore")
          )}</button>
          <button type="button" class="btn btn-sm" data-del="${esc(e.id)}">${esc(t("delete"))}</button>
        </div>
      </div>`
      )
      .join("");
  }

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
    });
  });
  list.querySelectorAll("[data-reopen-domain]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res2 = await send({
        type: "RESTORE_DOMAIN",
        domain: btn.getAttribute("data-reopen-domain"),
        remove: false,
      });
      toast(t("reopenedN", [String(res2.opened || 0)]));
    });
  });
}

function bindImport() {
  $("importOpen").addEventListener("click", async () => {
    const res = await send({ type: "IMPORT_URLS", text: $("importText").value, mode: "open" });
    toast(res.ok ? t("importedN", [String(res.count)]) : res.error || "Fail");
  });
  $("importArchive").addEventListener("click", async () => {
    const res = await send({ type: "IMPORT_URLS", text: $("importText").value, mode: "archive" });
    toast(res.ok ? t("importedN", [String(res.count)]) : res.error || "Fail");
  });
}

function bindData() {
  $("exportBtn").addEventListener("click", async () => {
    const res = await send({ type: "EXPORT" });
    if (!res.ok) return;
    const blob = new Blob([JSON.stringify(res.bundle, null, 2)], { type: "application/json" });
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
      await send({ type: "IMPORT", bundle: JSON.parse(await file.text()) });
      toast(t("importDone"));
      await refreshAll();
    } catch (err) {
      toast(err.message || "Invalid JSON");
    }
    e.target.value = "";
  });
  $("syncNow").addEventListener("click", async () => {
    await send({ type: "SYNC_NOW" });
    toast(t("syncDone"));
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
  $("graceEnabled").checked = s.graceEnabled !== false;
  $("graceSeconds").value = Math.round((s.graceMs || 60000) / 1000);
  $("estMbPerTab").value = s.estMbPerTab ?? 50;
  if ($("uiLocale")) $("uiLocale").value = s.uiLocale || "auto";

  $("statToday").textContent = String(res.stats?.closedToday ?? 0);
  $("statWeek").textContent = String(res.stats?.closedWeek ?? 0);
  $("statTotal").textContent = String(res.stats?.closedTotal ?? 0);
  $("statMb").textContent = String(Math.round(res.stats?.estMbSaved ?? 0));

  renderWhitelist(res.whitelist || []);
  renderKept(res.protected || []);
  renderDomains(res.domainRules || []);
  await loadPreview();
}

async function loadPreview() {
  const type = previewHorizon > 0 ? "SIMULATE" : "PREVIEW";
  const res = await send({ type, horizonMs: previewHorizon });
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
        <div class="sub mono">${c.action === "warn" ? "grace · " : ""}${esc(c.url)}</div>
      </div>
    </div>`
    )
    .join("");
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
