import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  SYNC_MIRROR_KEYS,
  todayKey,
} from "./constants.js";

let syncTimer = null;

export async function getAll() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    activity: data.activity || {},
    archive: Array.isArray(data.archive) ? data.archive : [],
    stats: normalizeStats(data.stats),
    whitelist: Array.isArray(data.whitelist) ? data.whitelist : [],
    protected: Array.isArray(data.protected) ? data.protected : [],
  };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  scheduleSyncMirror();
  return next;
}

export async function getActivity() {
  const { activity } = await chrome.storage.local.get(STORAGE_KEYS.activity);
  return activity || {};
}

export async function setActivity(activity) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activity]: activity });
}

export async function touchActivity(tabId, ts = Date.now()) {
  const activity = await getActivity();
  activity[String(tabId)] = ts;
  await setActivity(activity);
  return ts;
}

export async function clearActivity(tabId) {
  const activity = await getActivity();
  delete activity[String(tabId)];
  await setActivity(activity);
}

export async function pruneActivity(liveTabIds) {
  const activity = await getActivity();
  const live = new Set((liveTabIds || []).map(String));
  let changed = false;
  for (const key of Object.keys(activity)) {
    if (!live.has(key)) {
      delete activity[key];
      changed = true;
    }
  }
  if (changed) await setActivity(activity);
  return activity;
}

export async function getArchive() {
  const { archive } = await chrome.storage.local.get(STORAGE_KEYS.archive);
  return Array.isArray(archive) ? archive : [];
}

export async function setArchive(archive) {
  await chrome.storage.local.set({ [STORAGE_KEYS.archive]: archive });
}

export async function getWhitelist() {
  const { whitelist } = await chrome.storage.local.get(STORAGE_KEYS.whitelist);
  return Array.isArray(whitelist) ? whitelist : [];
}

export async function setWhitelist(whitelist) {
  await chrome.storage.local.set({ [STORAGE_KEYS.whitelist]: whitelist });
  scheduleSyncMirror();
}

export async function getProtected() {
  const { protected: list } = await chrome.storage.local.get(STORAGE_KEYS.protected);
  return Array.isArray(list) ? list : [];
}

export async function setProtected(list) {
  await chrome.storage.local.set({ [STORAGE_KEYS.protected]: list });
  scheduleSyncMirror();
}

export async function getStats() {
  const { stats } = await chrome.storage.local.get(STORAGE_KEYS.stats);
  return normalizeStats(stats);
}

export async function setStats(stats) {
  await chrome.storage.local.set({ [STORAGE_KEYS.stats]: normalizeStats(stats) });
}

function normalizeStats(stats) {
  const base = {
    closedTotal: 0,
    closedToday: 0,
    todayKey: todayKey(),
  };
  if (!stats || typeof stats !== "object") return base;
  const key = todayKey();
  if (stats.todayKey !== key) {
    return {
      closedTotal: Number(stats.closedTotal) || 0,
      closedToday: 0,
      todayKey: key,
    };
  }
  return {
    closedTotal: Number(stats.closedTotal) || 0,
    closedToday: Number(stats.closedToday) || 0,
    todayKey: key,
  };
}

export async function exportBundle() {
  const all = await getAll();
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
    archive: all.archive,
    stats: all.stats,
  };
}

export async function importBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Invalid import file");
  }
  const patch = {};
  if (bundle.settings) patch.settings = { ...DEFAULT_SETTINGS, ...bundle.settings };
  if (Array.isArray(bundle.whitelist)) patch.whitelist = bundle.whitelist;
  if (Array.isArray(bundle.protected)) patch.protected = bundle.protected;
  if (Array.isArray(bundle.archive)) patch.archive = bundle.archive;
  if (bundle.stats) patch.stats = normalizeStats(bundle.stats);
  await chrome.storage.local.set(patch);
  scheduleSyncMirror();
  return getAll();
}

function scheduleSyncMirror() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    mirrorToSync().catch(() => {});
  }, 400);
}

/** Push durable config to Chrome sync (survives reinstall when signed into Chrome). */
export async function mirrorToSync() {
  const settings = await getSettings();
  if (settings.autoSync === false) return { ok: false, skipped: true };

  const all = await getAll();
  const payload = {
    tf_v: 2,
    tf_settings: all.settings,
    tf_whitelist: all.whitelist,
    tf_protected: all.protected,
    tf_updatedAt: Date.now(),
  };

  // Keep under sync quota (~100KB); trim protected/whitelist if needed
  let json = JSON.stringify(payload);
  if (json.length > 90000) {
    payload.tf_protected = (payload.tf_protected || []).slice(0, 80);
    payload.tf_whitelist = (payload.tf_whitelist || []).slice(0, 80);
    json = JSON.stringify(payload);
  }
  if (json.length > 100000) {
    payload.tf_protected = (payload.tf_protected || []).slice(0, 30);
    payload.tf_whitelist = (payload.tf_whitelist || []).slice(0, 30);
  }

  await chrome.storage.sync.set(payload);
  return { ok: true };
}

/** On install: if local is empty-ish, hydrate from sync. */
export async function hydrateFromSyncIfNeeded() {
  try {
    const local = await getAll();
    const hasLocalConfig =
      (local.whitelist && local.whitelist.length > 0) ||
      (local.protected && local.protected.length > 0) ||
      (local.settings && local.settings.thresholdMs > 0);

    const sync = await chrome.storage.sync.get([
      "tf_v",
      "tf_settings",
      "tf_whitelist",
      "tf_protected",
    ]);

    if (!sync.tf_v && !sync.tf_settings) return { restored: false };

    if (hasLocalConfig) {
      // Still merge protected URLs missing locally
      const remoteProtected = Array.isArray(sync.tf_protected) ? sync.tf_protected : [];
      if (remoteProtected.length) {
        const map = new Map(local.protected.map((p) => [p.url + "|" + (p.match || "url"), p]));
        let changed = false;
        for (const p of remoteProtected) {
          const key = (p.url || "") + "|" + (p.match || "url");
          if (!map.has(key)) {
            map.set(key, p);
            changed = true;
          }
        }
        if (changed) await setProtected([...map.values()]);
      }
      return { restored: false, merged: true };
    }

    const patch = {};
    if (sync.tf_settings) patch.settings = { ...DEFAULT_SETTINGS, ...sync.tf_settings };
    if (Array.isArray(sync.tf_whitelist)) patch.whitelist = sync.tf_whitelist;
    if (Array.isArray(sync.tf_protected)) patch.protected = sync.tf_protected;
    if (Object.keys(patch).length) {
      await chrome.storage.local.set(patch);
      return { restored: true };
    }
  } catch {
    // sync may be unavailable
  }
  return { restored: false };
}

export { SYNC_MIRROR_KEYS };
