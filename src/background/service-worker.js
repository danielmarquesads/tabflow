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
  getStats,
  exportBundle,
  importBundle,
  setWhitelist,
} from "../lib/storage.js";
import { evaluateCandidates, performClose } from "../lib/closer.js";
import { searchArchive, removeArchiveEntry } from "../lib/archive.js";
import { validateRule } from "../lib/whitelist.js";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await seedActivityForOpenTabs();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await seedActivityForOpenTabs();
  await refreshBadge();
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_CLOSE);
  if (!existing) {
    chrome.alarms.create(ALARM_CLOSE, { periodInMinutes: ALARM_PERIOD_MINUTES });
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
      return {
        ok: true,
        settings: all.settings,
        whitelist: all.whitelist,
        archive: all.archive,
        stats: all.stats,
        tabCount: tabs.length,
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

async function runCloseSweep() {
  const all = await getAll();
  const tabs = await chrome.tabs.query({});
  const activity = await pruneActivity(tabs.map((t) => t.id));
  const candidates = evaluateCandidates({
    tabs,
    activity,
    settings: all.settings,
    whitelist: all.whitelist,
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
  });

  const text = candidates.length > 0 ? String(Math.min(candidates.length, 99)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
}

// Keep SW alive-ish on first load
ensureAlarm();
