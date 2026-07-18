import {
  DEFAULT_SETTINGS,
  DEFAULT_PROFILES,
  STORAGE_KEYS,
  todayKey,
  weekKey,
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
    profiles:
      Array.isArray(data.profiles) && data.profiles.length
        ? data.profiles
        : DEFAULT_PROFILES,
    domainRules: Array.isArray(data.domainRules) ? data.domainRules : [],
    snoozed: Array.isArray(data.snoozed) ? data.snoozed : [],
    pendingGrace: Array.isArray(data.pendingGrace) ? data.pendingGrace : [],
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
  // clear grace for this tab
  const grace = await getPendingGrace();
  const next = grace.filter((g) => String(g.tabId) !== String(tabId));
  if (next.length !== grace.length) await setPendingGrace(next);
  return ts;
}

export async function clearActivity(tabId) {
  const activity = await getActivity();
  delete activity[String(tabId)];
  await setActivity(activity);
  const grace = await getPendingGrace();
  await setPendingGrace(grace.filter((g) => String(g.tabId) !== String(tabId)));
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

  const grace = await getPendingGrace();
  const gNext = grace.filter((g) => live.has(String(g.tabId)));
  if (gNext.length !== grace.length) await setPendingGrace(gNext);

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

export async function getProfiles() {
  const { profiles } = await chrome.storage.local.get(STORAGE_KEYS.profiles);
  return Array.isArray(profiles) && profiles.length ? profiles : DEFAULT_PROFILES;
}

export async function setProfiles(profiles) {
  await chrome.storage.local.set({ [STORAGE_KEYS.profiles]: profiles });
  scheduleSyncMirror();
}

export async function getDomainRules() {
  const { domainRules } = await chrome.storage.local.get(STORAGE_KEYS.domainRules);
  return Array.isArray(domainRules) ? domainRules : [];
}

export async function setDomainRules(domainRules) {
  await chrome.storage.local.set({ [STORAGE_KEYS.domainRules]: domainRules });
  scheduleSyncMirror();
}

export async function getSnoozed() {
  const { snoozed } = await chrome.storage.local.get(STORAGE_KEYS.snoozed);
  return Array.isArray(snoozed) ? snoozed : [];
}

export async function setSnoozed(snoozed) {
  await chrome.storage.local.set({ [STORAGE_KEYS.snoozed]: snoozed });
}

export async function getPendingGrace() {
  const { pendingGrace } = await chrome.storage.local.get(STORAGE_KEYS.pendingGrace);
  return Array.isArray(pendingGrace) ? pendingGrace : [];
}

export async function setPendingGrace(pendingGrace) {
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingGrace]: pendingGrace });
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
    closedWeek: 0,
    estMbSaved: 0,
    todayKey: todayKey(),
    weekKey: weekKey(),
  };
  if (!stats || typeof stats !== "object") return base;
  const s = {
    closedTotal: Number(stats.closedTotal) || 0,
    closedToday: Number(stats.closedToday) || 0,
    closedWeek: Number(stats.closedWeek) || 0,
    estMbSaved: Number(stats.estMbSaved) || 0,
    todayKey: stats.todayKey || todayKey(),
    weekKey: stats.weekKey || weekKey(),
  };
  if (s.todayKey !== todayKey()) {
    s.closedToday = 0;
    s.todayKey = todayKey();
  }
  if (s.weekKey !== weekKey()) {
    s.closedWeek = 0;
    s.weekKey = weekKey();
  }
  return s;
}

export async function exportBundle() {
  const all = await getAll();
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: all.settings,
    whitelist: all.whitelist,
    protected: all.protected,
    profiles: all.profiles,
    domainRules: all.domainRules,
    archive: all.archive,
    stats: all.stats,
    snoozed: all.snoozed,
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
  if (Array.isArray(bundle.profiles)) patch.profiles = bundle.profiles;
  if (Array.isArray(bundle.domainRules)) patch.domainRules = bundle.domainRules;
  if (Array.isArray(bundle.archive)) patch.archive = bundle.archive;
  if (Array.isArray(bundle.snoozed)) patch.snoozed = bundle.snoozed;
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

export async function mirrorToSync() {
  const settings = await getSettings();
  if (settings.autoSync === false) return { ok: false, skipped: true };

  const all = await getAll();
  const payload = {
    tf_v: 3,
    tf_settings: all.settings,
    tf_whitelist: all.whitelist,
    tf_protected: all.protected,
    tf_profiles: all.profiles,
    tf_domainRules: all.domainRules,
    tf_updatedAt: Date.now(),
  };

  let json = JSON.stringify(payload);
  if (json.length > 90000) {
    payload.tf_protected = (payload.tf_protected || []).slice(0, 60);
    payload.tf_whitelist = (payload.tf_whitelist || []).slice(0, 60);
    payload.tf_domainRules = (payload.tf_domainRules || []).slice(0, 40);
  }

  await chrome.storage.sync.set(payload);
  return { ok: true };
}

export async function hydrateFromSyncIfNeeded() {
  try {
    const local = await getAll();
    const hasLocalConfig =
      (local.whitelist && local.whitelist.length > 0) ||
      (local.protected && local.protected.length > 0) ||
      (local.domainRules && local.domainRules.length > 0) ||
      (local.settings && local.settings.thresholdMs > 0);

    const sync = await chrome.storage.sync.get([
      "tf_v",
      "tf_settings",
      "tf_whitelist",
      "tf_protected",
      "tf_profiles",
      "tf_domainRules",
    ]);

    if (!sync.tf_v && !sync.tf_settings) return { restored: false };

    if (hasLocalConfig) {
      return { restored: false, merged: true };
    }

    const patch = {};
    if (sync.tf_settings) patch.settings = { ...DEFAULT_SETTINGS, ...sync.tf_settings };
    if (Array.isArray(sync.tf_whitelist)) patch.whitelist = sync.tf_whitelist;
    if (Array.isArray(sync.tf_protected)) patch.protected = sync.tf_protected;
    if (Array.isArray(sync.tf_profiles)) patch.profiles = sync.tf_profiles;
    if (Array.isArray(sync.tf_domainRules)) patch.domainRules = sync.tf_domainRules;
    if (Object.keys(patch).length) {
      await chrome.storage.local.set(patch);
      return { restored: true };
    }
  } catch {
    // sync unavailable
  }
  return { restored: false };
}
