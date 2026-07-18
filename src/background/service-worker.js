import {
  ALARM_CLOSE,
  ALARM_PERIOD_MINUTES,
  thresholdToMs,
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
  exportBundle,
  importBundle,
  setWhitelist,
  hydrateFromSyncIfNeeded,
  mirrorToSync,
} from "../lib/storage.js";
import { evaluateCandidates, performClose } from "../lib/closer.js";
import { searchArchive, removeArchiveEntry } from "../lib/archive.js";
import { validateRule } from "../lib/whitelist.js";
import {
  addProtected,
  findProtectedEntry,
  makeProtectedEntry,
  removeProtected,
} from "../lib/protected.js";

const CONTEXT_KEEP = "tabflow-keep-tab";
const CONTEXT_UNKEEP = "tabflow-unkeep-tab";

chrome.runtime.onInstalled.addListener(async () => {
  await hydrateFromSyncIfNeeded();
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
});

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
  } catch {
    // contextMenus permission missing or unavailable
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
  if (alarm.name !== ALARM_CLOSE) return;
  await runCloseSweep();
  await refreshBadge();
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
  if (info.menuItemId === CONTEXT_KEEP) {
    await protectTab(tab, "url");
  } else if (info.menuItemId === CONTEXT_UNKEEP) {
    await unprotectTab(tab);
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
      const activeProtected = active?.url
        ? !!findProtectedEntry(active.url, all.protected)
        : false;
      return {
        ok: true,
        settings: all.settings,
        whitelist: all.whitelist,
        protected: all.protected,
        archive: all.archive,
        stats: all.stats,
        tabCount: tabs.length,
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
      const settings = await setSettings(patch);
      await ensureAlarm();
      await refreshBadge();
      return { ok: true, settings };
    }

    case "PREVIEW": {
      const all = await getAll();
      const tabs = await chrome.tabs.query({});
      const candidates = evaluateCandidates({
        tabs,
        activity: all.activity,
        settings: all.settings,
        whitelist: all.whitelist,
        protected: all.protected,
      });
      return {
        ok: true,
        candidates: candidates.map(({ tab, idleMs }) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          idleMs,
          windowId: tab.windowId,
        })),
      };
    }

    case "RUN_SWEEP": {
      const result = await runCloseSweep();
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
      if (!tab?.url && !message.id) return { ok: false, error: "No tab" };
      const list = await unprotectTab(tab, message.id);
      await refreshBadge();
      return { ok: true, protected: list };
    }

    case "LIST_PROTECTED": {
      return { ok: true, protected: await getProtected() };
    }

    case "SEARCH_ARCHIVE": {
      const archive = await getArchive();
      return { ok: true, archive: searchArchive(archive, message.query || "") };
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

    case "DELETE_ARCHIVE": {
      const archive = await getArchive();
      await setArchive(removeArchiveEntry(archive, message.id));
      return { ok: true };
    }

    case "CLEAR_ARCHIVE": {
      await setArchive([]);
      return { ok: true };
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
      const rule = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        pattern,
        mode,
      };
      list.push(rule);
      await setWhitelist(list);
      return { ok: true, whitelist: list };
    }

    case "REMOVE_WHITELIST": {
      const list = (await getWhitelist()).filter((r) => r.id !== message.id);
      await setWhitelist(list);
      return { ok: true, whitelist: list };
    }

    case "EXPORT": {
      const bundle = await exportBundle();
      return { ok: true, bundle };
    }

    case "IMPORT": {
      await importBundle(message.bundle);
      await refreshBadge();
      return { ok: true };
    }

    case "SYNC_NOW": {
      const r = await mirrorToSync();
      return { ok: true, ...r };
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

async function runCloseSweep() {
  const all = await getAll();
  const tabs = await chrome.tabs.query({});
  const activity = await pruneActivity(tabs.map((t) => t.id));
  const candidates = evaluateCandidates({
    tabs,
    activity,
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
  });

  if (candidates.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const { closed, archive, stats } = await performClose(candidates, {
    archive: all.archive,
    stats: all.stats,
    settings: all.settings,
    closeTab: (id) => chrome.tabs.remove(id),
  });

  await setArchive(archive);
  await setStats(stats);

  return { closedCount: closed.length, closed };
}

async function refreshBadge() {
  const settings = await getSettings();
  if (!settings.enabled || settings.paused || !settings.thresholdMs) {
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
  });

  const text = candidates.length > 0 ? String(Math.min(candidates.length, 99)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
}

ensureAlarm();
setupContextMenus();
