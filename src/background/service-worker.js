import {
  ALARM_CLOSE,
  ALARM_SNOOZE,
  ALARM_PERIOD_MINUTES,
  thresholdToMs,
  DEFAULT_PROFILES,
} from "../lib/constants.js";
import {
  getAll,
  getSettings,
  setSettings,
  touchActivity,
  clearActivity,
  setArchive,
  setStats,
  setActivity,
  getActivity,
  pruneActivity,
  getArchive,
  getWhitelist,
  getProtected,
  setProtected,
  getProfiles,
  setProfiles,
  getDomainRules,
  setDomainRules,
  getSnoozed,
  setSnoozed,
  getPendingGrace,
  setPendingGrace,
  exportBundle,
  importBundle,
  setWhitelist,
  hydrateFromSyncIfNeeded,
  mirrorToSync,
} from "../lib/storage.js";
import {
  evaluateCandidates,
  performClose,
  splitGraceActions,
} from "../lib/closer.js";
import {
  searchArchive,
  removeArchiveEntry,
  groupArchiveByDomain,
  parseUrlList,
  makeArchiveEntry,
  pushArchive,
} from "../lib/archive.js";
import { validateRule } from "../lib/whitelist.js";
import {
  addProtected,
  findProtectedEntry,
  makeProtectedEntry,
  removeProtected,
} from "../lib/protected.js";
import { resolveActiveProfile } from "../lib/policy.js";

const CONTEXT_KEEP = "tabflow-keep-tab";
const CONTEXT_UNKEEP = "tabflow-unkeep-tab";
const CONTEXT_SNOOZE = "tabflow-snooze-1h";

chrome.runtime.onInstalled.addListener(async () => {
  await hydrateFromSyncIfNeeded();
  await ensureDefaults();
  await ensureAlarm();
  await seedActivityForOpenTabs();
  await setupContextMenus();
  await mirrorToSync();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await hydrateFromSyncIfNeeded();
  await ensureAlarm();
  await seedActivityForOpenTabs();
  await setupContextMenus();
  await refreshBadge();
  await processDueSnoozes();
});

async function ensureDefaults() {
  const profiles = await getProfiles();
  if (!profiles?.length) await setProfiles(DEFAULT_PROFILES);
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_CLOSE);
  if (!existing) {
    chrome.alarms.create(ALARM_CLOSE, { periodInMinutes: ALARM_PERIOD_MINUTES });
  }
}

async function setupContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTEXT_KEEP,
      title: chrome.i18n.getMessage("contextKeepTab") || "TabFlow: Keep this tab open",
      contexts: ["page", "action"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_UNKEEP,
      title: chrome.i18n.getMessage("contextUnkeepTab") || "TabFlow: Remove keep-open",
      contexts: ["page", "action"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_SNOOZE,
      title: chrome.i18n.getMessage("contextSnooze1h") || "TabFlow: Snooze 1 hour (close & reopen)",
      contexts: ["page", "action"],
    });
  } catch {
    // ignore
  }
}

async function seedActivityForOpenTabs() {
  const tabs = await chrome.tabs.query({});
  let activity = await pruneActivity(tabs.map((t) => t.id));
  const now = Date.now();
  let changed = false;
  for (const tab of tabs) {
    const key = String(tab.id);
    if (activity[key] == null) {
      activity[key] = typeof tab.lastAccessed === "number" ? tab.lastAccessed : now;
      changed = true;
    }
  }
  if (changed) await setActivity(activity);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_CLOSE) {
    await runCloseSweep();
    await processDueSnoozes();
    await refreshBadge();
  } else if (alarm.name === ALARM_SNOOZE || alarm.name?.startsWith?.("tabflow-snooze-")) {
    await processDueSnoozes();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await touchActivity(tabId);
  await refreshBadge();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    await touchActivity(tabId);
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id != null) await touchActivity(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearActivity(tabId);
});

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === CONTEXT_KEEP) await protectTab(tab, "url");
  else if (info.menuItemId === CONTEXT_UNKEEP) await unprotectTab(tab);
  else if (info.menuItemId === CONTEXT_SNOOZE) {
    await snoozeTab(tab, 60 * 60 * 1000, "reopen");
  }
  await refreshBadge();
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === "toggle-pause") {
    const s = await getSettings();
    await setSettings({ paused: !s.paused });
    await refreshBadge();
  } else if (command === "keep-tab") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await protectTab(tab, "url");
  } else if (command === "open-archive") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#archive") });
  } else if (command === "open-options") {
    chrome.runtime.openOptionsPage();
  } else if (command === "snooze-tab") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await snoozeTab(tab, 60 * 60 * 1000, "reopen");
  }
  await refreshBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

async function handleMessage(message, sender) {
  const type = message?.type;
  if (!type) return { ok: false, error: "Missing type" };

  switch (type) {
    case "PING":
      return { ok: true, pong: true };

    case "ACTIVITY": {
      const tabId = sender.tab?.id;
      if (tabId != null) await touchActivity(tabId);
      return { ok: true };
    }

    case "GET_STATE": {
      const all = await getAll();
      const tabs = await chrome.tabs.query({});
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const profile = resolveActiveProfile(all.settings, all.profiles);
      const activeProtected = active?.url
        ? !!findProtectedEntry(active.url, all.protected)
        : false;
      return {
        ok: true,
        settings: all.settings,
        whitelist: all.whitelist,
        protected: all.protected,
        profiles: all.profiles,
        domainRules: all.domainRules,
        snoozed: all.snoozed,
        pendingGrace: all.pendingGrace,
        archive: all.archive,
        stats: all.stats,
        tabCount: tabs.length,
        activeProfile: profile,
        activeTab: active
          ? {
              id: active.id,
              title: active.title,
              url: active.url,
              protected: activeProtected,
            }
          : null,
      };
    }

    case "SET_SETTINGS": {
      const patch = { ...(message.patch || {}) };
      if (patch.thresholdValue != null || patch.thresholdUnit != null) {
        const cur = await getSettings();
        const value = patch.thresholdValue ?? cur.thresholdValue;
        const unit = patch.thresholdUnit ?? cur.thresholdUnit;
        patch.thresholdMs = thresholdToMs(value, unit);
        patch.thresholdValue = value;
        patch.thresholdUnit = unit;
      }
      if (patch.graceSeconds != null) {
        patch.graceMs = Math.max(0, Number(patch.graceSeconds) || 0) * 1000;
        delete patch.graceSeconds;
      }
      const settings = await setSettings(patch);
      await ensureAlarm();
      await refreshBadge();
      return { ok: true, settings };
    }

    case "SET_PROFILE": {
      const id = message.profileId || "default";
      const settings = await setSettings({ activeProfileId: id });
      // sync threshold display from profile
      const profiles = await getProfiles();
      const p = profiles.find((x) => x.id === id);
      if (p) {
        await setSettings({
          activeProfileId: id,
          thresholdValue: p.thresholdValue,
          thresholdUnit: p.thresholdUnit,
          thresholdMs: thresholdToMs(p.thresholdValue, p.thresholdUnit),
        });
      }
      await refreshBadge();
      return { ok: true, settings: await getSettings() };
    }

    case "SAVE_PROFILES": {
      await setProfiles(message.profiles || DEFAULT_PROFILES);
      return { ok: true, profiles: await getProfiles() };
    }

    case "PREVIEW": {
      return { ok: true, ...(await buildPreview(0, false)) };
    }

    case "SIMULATE": {
      const horizonMs = Number(message.horizonMs) || 60 * 60 * 1000;
      return { ok: true, ...(await buildPreview(horizonMs, true)) };
    }

    case "RUN_SWEEP": {
      const result = await runCloseSweep({ force: !!message.force });
      await refreshBadge();
      return { ok: true, ...result };
    }

    case "PROTECT_TAB": {
      const tab =
        message.tabId != null
          ? await chrome.tabs.get(message.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.url) return { ok: false, error: "No tab" };
      const result = await protectTab(tab, message.match || "url");
      await refreshBadge();
      return { ok: true, ...result };
    }

    case "UNPROTECT_TAB": {
      const tab =
        message.tabId != null
          ? await chrome.tabs.get(message.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const list = await unprotectTab(tab, message.id);
      await refreshBadge();
      return { ok: true, protected: list };
    }

    case "SNOOZE_TAB": {
      const tab =
        message.tabId != null
          ? await chrome.tabs.get(message.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.url) return { ok: false, error: "No tab" };
      const durationMs = Number(message.durationMs) || 60 * 60 * 1000;
      const mode = message.mode === "soft" ? "soft" : "reopen";
      const entry = await snoozeTab(tab, durationMs, mode);
      await refreshBadge();
      return { ok: true, entry, snoozed: await getSnoozed() };
    }

    case "UNSNOOZE": {
      const list = (await getSnoozed()).filter((s) => s.id !== message.id);
      await setSnoozed(list);
      return { ok: true, snoozed: list };
    }

    case "LIST_PROTECTED":
      return { ok: true, protected: await getProtected() };

    case "ADD_DOMAIN_RULE": {
      const pattern = (message.pattern || "").trim();
      const mode = message.mode || "subdomain";
      const thresholdValue = Math.max(1, Number(message.thresholdValue) || 1);
      const thresholdUnit = message.thresholdUnit || "hours";
      if (!pattern) return { ok: false, error: "Pattern required" };
      const list = await getDomainRules();
      const rule = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        pattern,
        mode,
        thresholdValue,
        thresholdUnit,
      };
      list.push(rule);
      await setDomainRules(list);
      return { ok: true, domainRules: list };
    }

    case "REMOVE_DOMAIN_RULE": {
      const list = (await getDomainRules()).filter((r) => r.id !== message.id);
      await setDomainRules(list);
      return { ok: true, domainRules: list };
    }

    case "SEARCH_ARCHIVE": {
      const archive = await getArchive();
      const filtered = searchArchive(archive, message.query || "");
      return {
        ok: true,
        archive: filtered,
        groups: groupArchiveByDomain(filtered),
      };
    }

    case "RESTORE_ARCHIVE": {
      const archive = await getArchive();
      const entry = archive.find((e) => e.id === message.id);
      if (!entry?.url) return { ok: false, error: "Entry not found" };
      await chrome.tabs.create({ url: entry.url, active: true });
      if (message.remove !== false) {
        await setArchive(removeArchiveEntry(archive, entry.id));
      }
      return { ok: true };
    }

    case "RESTORE_DOMAIN": {
      const archive = await getArchive();
      const domain = message.domain;
      const items = archive.filter(
        (e) => (e.domain || "") === domain || (e.url || "").includes(domain)
      );
      for (const e of items.slice(0, 30)) {
        try {
          await chrome.tabs.create({ url: e.url, active: false });
        } catch {
          // skip
        }
      }
      if (message.remove) {
        const ids = new Set(items.map((i) => i.id));
        await setArchive(archive.filter((e) => !ids.has(e.id)));
      }
      return { ok: true, opened: Math.min(items.length, 30) };
    }

    case "DELETE_ARCHIVE": {
      const archive = await getArchive();
      await setArchive(removeArchiveEntry(archive, message.id));
      return { ok: true };
    }

    case "CLEAR_ARCHIVE": {
      await setArchive([]);
      return { ok: true };
    }

    case "IMPORT_URLS": {
      const items = parseUrlList(message.text || "");
      if (!items.length) return { ok: false, error: "No valid URLs" };
      const mode = message.mode || "open"; // open | archive
      if (mode === "archive") {
        let archive = await getArchive();
        const settings = await getSettings();
        for (const item of items.reverse()) {
          archive = pushArchive(
            archive,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title: item.title,
              url: item.url,
              favIconUrl: "",
              closedAt: Date.now(),
              domain: (() => {
                try {
                  return new URL(item.url).hostname.replace(/^www\./, "");
                } catch {
                  return "";
                }
              })(),
            },
            settings.archiveCap || 500
          );
        }
        await setArchive(archive);
        return { ok: true, count: items.length, mode: "archive" };
      }
      let opened = 0;
      for (const item of items.slice(0, 40)) {
        try {
          await chrome.tabs.create({ url: item.url, active: false });
          opened += 1;
        } catch {
          // skip
        }
      }
      return { ok: true, count: opened, mode: "open" };
    }

    case "ADD_WHITELIST": {
      const pattern = (message.pattern || "").trim();
      const mode = message.mode || "subdomain";
      const err = validateRule(pattern, mode);
      if (err) return { ok: false, error: err };
      const list = await getWhitelist();
      const dup = list.some(
        (r) => r.pattern.toLowerCase() === pattern.toLowerCase() && r.mode === mode
      );
      if (dup) return { ok: false, error: "Rule already exists" };
      list.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        pattern,
        mode,
      });
      await setWhitelist(list);
      return { ok: true, whitelist: list };
    }

    case "REMOVE_WHITELIST": {
      const list = (await getWhitelist()).filter((r) => r.id !== message.id);
      await setWhitelist(list);
      return { ok: true, whitelist: list };
    }

    case "EXPORT":
      return { ok: true, bundle: await exportBundle() };

    case "IMPORT": {
      await importBundle(message.bundle);
      await refreshBadge();
      return { ok: true };
    }

    case "SYNC_NOW":
      return { ok: true, ...(await mirrorToSync()) };

    case "DISMISS_GRACE": {
      const grace = await getPendingGrace();
      await setPendingGrace(grace.filter((g) => String(g.tabId) !== String(message.tabId)));
      if (message.tabId != null) await touchActivity(message.tabId);
      await refreshBadge();
      return { ok: true };
    }

    case "GET_FAB_CONFIG": {
      const settings = await getSettings();
      const archive = await getArchive();
      return {
        ok: true,
        show: !!settings.showPageButton,
        recent: archive.slice(0, 8),
      };
    }

    default:
      return { ok: false, error: `Unknown type: ${type}` };
  }
}

async function buildPreview(horizonMs, skipGrace) {
  const all = await getAll();
  const tabs = await chrome.tabs.query({});
  const candidates = evaluateCandidates({
    tabs,
    activity: all.activity,
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
    profiles: all.profiles,
    domainRules: all.domainRules,
    snoozed: all.snoozed,
    pendingGrace: all.pendingGrace,
    horizonMs,
    skipGrace,
  });
  return {
    candidates: candidates.map((c) => ({
      id: c.tab.id,
      title: c.tab.title,
      url: c.tab.url,
      favIconUrl: c.tab.favIconUrl,
      idleMs: c.idleMs,
      thresholdMs: c.thresholdMs,
      source: c.source,
      inGrace: c.inGrace,
      graceEndsAt: c.graceEndsAt,
      action: c.action || "close",
      windowId: c.windowId,
    })),
    horizonMs,
  };
}

async function protectTab(tab, match = "url") {
  const list = await getProtected();
  const entry = makeProtectedEntry(tab, match);
  const { list: next, entry: saved, added } = addProtected(list, entry);
  await setProtected(next);
  return { protected: next, entry: saved, added };
}

async function unprotectTab(tab, id) {
  const list = await getProtected();
  const next = id
    ? removeProtected(list, id)
    : removeProtected(list, tab?.url || "");
  await setProtected(next);
  return next;
}

async function snoozeTab(tab, durationMs, mode = "reopen") {
  const until = Date.now() + durationMs;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: tab.url,
    title: tab.title || tab.url,
    until,
    mode,
    createdAt: Date.now(),
  };
  const list = await getSnoozed();
  list.unshift(entry);
  await setSnoozed(list.slice(0, 200));

  if (mode === "reopen" && tab.id != null) {
    try {
      // archive then close
      const settings = await getSettings();
      let archive = await getArchive();
      archive = pushArchive(archive, makeArchiveEntry(tab), settings.archiveCap || 500);
      await setArchive(archive);
      await chrome.tabs.remove(tab.id);
    } catch {
      // ignore
    }
  }

  try {
    chrome.alarms.create(`tabflow-snooze-${entry.id}`, { when: until });
  } catch {
    // periodic sweep will pick up
  }

  return entry;
}

async function processDueSnoozes() {
  const now = Date.now();
  let list = await getSnoozed();
  const due = list.filter((s) => s.until <= now && s.mode === "reopen");
  const keep = list.filter((s) => !(s.until <= now));
  for (const s of due) {
    try {
      await chrome.tabs.create({ url: s.url, active: false });
    } catch {
      // skip
    }
  }
  // soft snoozes expire by falling out of keep when until passed
  await setSnoozed(keep);
}

async function runCloseSweep({ force = false } = {}) {
  const all = await getAll();
  const tabs = await chrome.tabs.query({});
  const activity = await pruneActivity(tabs.map((t) => t.id));

  const candidates = evaluateCandidates({
    tabs,
    activity,
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
    profiles: all.profiles,
    domainRules: all.domainRules,
    snoozed: all.snoozed,
    pendingGrace: all.pendingGrace,
    skipGrace: force,
  });

  if (!candidates.length) {
    await setPendingGrace([]);
    return { closedCount: 0, closed: [], warned: 0 };
  }

  if (force || !all.settings.graceEnabled) {
    const hard = candidates.filter((c) => c.action !== "warn" || force);
    const toClose = force ? candidates : hard;
    const { closed, archive, stats } = await performClose(toClose, {
      archive: all.archive,
      stats: all.stats,
      settings: all.settings,
      closeTab: (id) => chrome.tabs.remove(id),
    });
    await setArchive(archive);
    await setStats(stats);
    await setPendingGrace([]);
    return { closedCount: closed.length, closed, warned: 0 };
  }

  const { toClose, toWarn } = splitGraceActions(candidates);

  // Update pending grace for warnings
  const existing = await getPendingGrace();
  const byId = new Map(existing.map((g) => [String(g.tabId), g]));
  const graceMs = Math.max(0, Number(all.settings.graceMs) || 60000);
  const now = Date.now();
  const nextGrace = [];

  for (const c of toWarn) {
    const prev = byId.get(String(c.tab.id));
    nextGrace.push(
      prev || {
        tabId: c.tab.id,
        url: c.tab.url,
        title: c.tab.title,
        markedAt: now,
        closeAfter: now + graceMs,
      }
    );
  }
  // Keep grace entries that are about to close (still in toClose with prior mark)
  for (const c of toClose) {
    const prev = byId.get(String(c.tab.id));
    if (prev) nextGrace.push(prev);
  }

  await setPendingGrace(nextGrace);

  let closed = [];
  if (toClose.length) {
    const result = await performClose(toClose, {
      archive: all.archive,
      stats: all.stats,
      settings: all.settings,
      closeTab: (id) => chrome.tabs.remove(id),
    });
    closed = result.closed;
    await setArchive(result.archive);
    await setStats(result.stats);
    // remove closed from grace
    const closedIds = new Set(toClose.map((c) => String(c.tab.id)));
    await setPendingGrace(nextGrace.filter((g) => !closedIds.has(String(g.tabId))));
  }

  return { closedCount: closed.length, closed, warned: toWarn.length };
}

async function refreshBadge() {
  const settings = await getSettings();
  if (!settings.enabled || settings.paused) {
    await chrome.action.setBadgeText({ text: settings.paused ? "II" : "" });
    await chrome.action.setBadgeBackgroundColor({
      color: settings.paused ? "#6b7280" : "#000000",
    });
    return;
  }

  const all = await getAll();
  const tabs = await chrome.tabs.query({});
  const candidates = evaluateCandidates({
    tabs,
    activity: all.activity,
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
    profiles: all.profiles,
    domainRules: all.domainRules,
    snoozed: all.snoozed,
    pendingGrace: all.pendingGrace,
  });

  const { toClose, toWarn } = splitGraceActions(candidates);
  const n = toClose.length + toWarn.length;
  if (!n) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  // warn-only uses amber; closing soon uses darker
  await chrome.action.setBadgeText({ text: String(Math.min(n, 99)) });
  await chrome.action.setBadgeBackgroundColor({
    color: toClose.length ? "#b45309" : "#d97706",
  });
}

ensureAlarm();
setupContextMenus();
