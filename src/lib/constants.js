export const ALARM_CLOSE = "tabflow-close-sweep";
export const ALARM_PERIOD_MINUTES = 1;

export const STORAGE_KEYS = {
  settings: "settings",
  activity: "activity",
  archive: "archive",
  stats: "stats",
  whitelist: "whitelist",
  protected: "protected",
};

/** Keys mirrored to chrome.storage.sync for reinstall / multi-device recovery */
export const SYNC_MIRROR_KEYS = ["settings", "whitelist", "protected"];

export const DEFAULT_SETTINGS = {
  enabled: false,
  paused: false,
  thresholdMs: 0,
  thresholdValue: 1,
  thresholdUnit: "hours",
  protectPinned: true,
  protectAudio: true,
  minTabs: 3,
  archiveCap: 500,
  showPageButton: false,
  autoSync: true,
};

export const UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  months: 30 * 24 * 60 * 60 * 1000,
};

export const WHITELIST_MODES = ["exact", "subdomain", "wildcard"];

export function thresholdToMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mult = UNIT_MS[unit] ?? UNIT_MS.hours;
  return Math.floor(n * mult);
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
