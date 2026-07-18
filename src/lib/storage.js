import { DEFAULT_SETTINGS, STORAGE_KEYS, todayKey } from "./constants.js";

export async function getAll() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    activity: data.activity || {},
    archive: Array.isArray(data.archive) ? data.archive : [],
    stats: normalizeStats(data.stats),
    whitelist: Array.isArray(data.whitelist) ? data.whitelist : [],
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

/** Drop activity keys for tabs that no longer exist. */
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
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: all.settings,
    whitelist: all.whitelist,
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
  if (Array.isArray(bundle.archive)) patch.archive = bundle.archive;
  if (bundle.stats) patch.stats = normalizeStats(bundle.stats);
  await chrome.storage.local.set(patch);
  return getAll();
}
