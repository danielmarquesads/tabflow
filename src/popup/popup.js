import { applyI18n, t } from "../shared/i18n.js";

const $ = (id) => document.getElementById(id);

let state = null;
let previewHorizon = 0;

init();

async function init() {
  applyI18n();
  await loadState();
  bind();
  await loadPreview();
}

function bind() {
  $("keepBtn").addEventListener("click", async () => {
    if (!state?.activeTab?.url) return;
    if (state.activeTab.protected) {
      await send({ type: "UNPROTECT_TAB", tabId: state.activeTab.id });
      toast(t("tabUnprotectedToast"));
    } else {
      await send({ type: "PROTECT_TAB", tabId: state.activeTab.id });
      toast(t("tabProtectedToast"));
    }
    await loadState();
    await loadPreview();
  });

  $("snoozeBtn").addEventListener("click", async () => {
    if (!state?.activeTab?.id) return;
    const res = await send({
      type: "SNOOZE_TAB",
      tabId: state.activeTab.id,
      durationMs: 60 * 60 * 1000,
      mode: "reopen",
    });
    if (res.ok) toast(t("snoozedToast"));
    await loadState();
    await loadPreview();
  });

  $("profileSelect").addEventListener("change", async () => {
    await send({ type: "SET_PROFILE", profileId: $("profileSelect").value });
    await loadState();
    await loadPreview();
  });

  $("enabledToggle").addEventListener("change", async () => {
    if ($("enabledToggle").checked && (!state.settings.thresholdMs || state.settings.thresholdMs <= 0)) {
      toast(t("needThreshold"));
      $("enabledToggle").checked = false;
      return;
    }
    await send({ type: "SET_SETTINGS", patch: { enabled: $("enabledToggle").checked } });
    await loadState();
    await loadPreview();
  });

  $("pausedToggle").addEventListener("change", async () => {
    await send({ type: "SET_SETTINGS", patch: { paused: $("pausedToggle").checked } });
    await loadState();
    await loadPreview();
  });

  $("saveThreshold").addEventListener("click", async () => {
    const value = Math.max(1, Number($("thresholdValue").value) || 1);
    const unit = $("thresholdUnit").value;
    await send({
      type: "SET_SETTINGS",
      patch: { thresholdValue: value, thresholdUnit: unit, enabled: true },
    });
    toast(t("thresholdSaved"));
    await loadState();
    await loadPreview();
  });

  $("refreshPreview").addEventListener("click", async () => {
    previewHorizon = 0;
    await loadPreview();
  });

  $("simulateBtn").addEventListener("click", async () => {
    previewHorizon = 60 * 60 * 1000;
    await loadPreview();
  });

  $("runSweep").addEventListener("click", async () => {
    $("runSweep").disabled = true;
    const res = await send({ type: "RUN_SWEEP" });
    $("runSweep").disabled = false;
    if (res.ok) {
      const parts = [];
      if (res.closedCount) parts.push(t("closedN", [String(res.closedCount)]));
      if (res.warned) parts.push(t("graceWarned", [String(res.warned)]));
      toast(parts.length ? parts.join(" · ") : t("nothingEligible"));
      await loadState();
      await loadPreview();
    }
  });

  $("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("openArchive").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#archive") });
  });
}

async function loadState() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok) return;
  state = res;
  const s = res.settings;

  $("enabledToggle").checked = !!s.enabled;
  $("pausedToggle").checked = !!s.paused;
  $("thresholdValue").value = s.thresholdValue || 1;
  $("thresholdUnit").value = s.thresholdUnit || "hours";
  $("statToday").textContent = String(res.stats?.closedToday ?? 0);
  $("statWeek").textContent = String(res.stats?.closedWeek ?? 0);
  $("statMb").textContent = String(Math.round(res.stats?.estMbSaved ?? 0));

  const sel = $("profileSelect");
  const profiles = res.profiles || [];
  sel.innerHTML = profiles
    .map(
      (p) =>
        `<option value="${escAttr(p.id)}" ${
          p.id === (s.activeProfileId || "default") ? "selected" : ""
        }>${esc(p.name)}</option>`
    )
    .join("");

  updateKeepUi(res.activeTab);
  updateStatusUi(s, res.activeProfile);
  renderGrace(res.pendingGrace || []);
}

function updateKeepUi(activeTab) {
  const on = !!activeTab?.protected;
  $("keepBtn").classList.toggle("is-protected", on);
  $("keepLabel").textContent = on ? t("tabProtected") : t("keepTabOpen");
  $("keepHint").textContent = on
    ? activeTab?.title || activeTab?.url || ""
    : t("keepTabOpenHint");
  $("keepBtn").textContent = on ? t("removeKeep") : t("keepTabOpen");
  const bad = !activeTab?.url || /^(chrome|edge|about|moz-extension):/i.test(activeTab.url);
  $("keepBtn").disabled = bad;
  $("snoozeBtn").disabled = bad;
}

function updateStatusUi(s, profile) {
  const pill = $("statusPill");
  pill.classList.remove("live", "paused");
  if (!s.enabled || !s.thresholdMs) {
    pill.textContent = t("statusOff");
    $("statusHint").textContent = t("autoCloseHint");
  } else if (s.paused) {
    pill.textContent = t("statusPaused");
    pill.classList.add("paused");
    $("statusHint").textContent = t("pausedHint");
  } else {
    pill.textContent = t("statusLive");
    pill.classList.add("live");
    const name = profile?.name ? ` · ${profile.name}` : "";
    $("statusHint").textContent = `≥ ${s.thresholdValue} ${unitLabel(s.thresholdUnit)}${name}`;
  }
}

function unitLabel(unit) {
  const map = {
    minutes: t("unitMinutes"),
    hours: t("unitHours"),
    days: t("unitDays"),
    months: t("unitMonths"),
  };
  return map[unit] || unit;
}

function renderGrace(list) {
  const section = $("graceSection");
  const el = $("graceList");
  if (!list.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  el.innerHTML = list
    .map((g) => {
      const left = Math.max(0, Math.round((g.closeAfter - Date.now()) / 1000));
      return `<div class="list-item">
        <div>
          <div class="title">${esc(g.title || g.url)}</div>
          <div class="sub mono"><span class="tag-grace">${left}s</span> · ${esc(shortUrl(g.url))}</div>
        </div>
        <button type="button" class="btn btn-sm" data-keep-grace="${g.tabId}">${esc(t("keepTabOpen"))}</button>
      </div>`;
    })
    .join("");
  el.querySelectorAll("[data-keep-grace]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "DISMISS_GRACE", tabId: Number(btn.getAttribute("data-keep-grace")) });
      await send({ type: "PROTECT_TAB", tabId: Number(btn.getAttribute("data-keep-grace")) });
      toast(t("tabProtectedToast"));
      await loadState();
      await loadPreview();
    });
  });
}

async function loadPreview() {
  const type = previewHorizon > 0 ? "SIMULATE" : "PREVIEW";
  const res = await send({ type, horizonMs: previewHorizon });
  $("previewModeLabel").textContent =
    previewHorizon > 0 ? t("simulateLabel") : t("wouldCloseNow");

  if (!res.ok) {
    $("previewList").innerHTML = `<div class="empty">${esc(t("previewFail"))}</div>`;
    return;
  }
  const items = res.candidates || [];
  if (!items.length) {
    $("previewList").innerHTML = `<div class="empty">${esc(t("noEligible"))}</div>`;
    return;
  }
  $("previewList").innerHTML = items
    .map((c) => {
      const tag = c.inGrace || c.action === "warn" ? `<span class="tag-grace">grace</span> · ` : "";
      return `<div class="list-item" role="listitem">
        <div>
          <div class="title">${esc(c.title || c.url || "Tab")}</div>
          <div class="sub mono">${tag}${formatIdle(c.idleMs)} ${esc(t("idleSuffix"))} · ${esc(
            shortUrl(c.url)
          )}</div>
        </div>
      </div>`;
    })
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
    return u.hostname + (u.pathname === "/" ? "" : u.pathname.slice(0, 20));
  } catch {
    return url || "";
  }
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s) {
  return esc(s);
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}
