export const ALARM_CLOSE = "tabflow-close-sweep";
export const ALARM_SNOOZE = "tabflow-snooze-reopen";
export const ALARM_PERIOD_MINUTES = 1;

export const STORAGE_KEYS = {
  settings: "settings",
  activity: "activity",
  archive: "archive",
  stats: "stats",
  whitelist: "whitelist",
  protected: "protected",
  profiles: "profiles",
  domainRules: "domainRules",
  snoozed: "snoozed",
  pendingGrace: "pendingGrace",
};

export const SYNC_MIRROR_KEYS = [
  "settings",
  "whitelist",
  "protected",
  "profiles",
  "domainRules",
];

export const DEFAULT_PROFILES = [
  {
    id: "default",
    name: "Balanced",
    thresholdValue: 1,
    thresholdUnit: "hours",
  },
  {
    id: "deep",
    name: "Deep work",
    thresholdValue: 30,
    thresholdUnit: "minutes",
  },
  {
    id: "research",
    name: "Research",
    thresholdValue: 6,
    thresholdUnit: "hours",
  },
];

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
  graceEnabled: true,
  graceMs: 60 * 1000,
  activeProfileId: "default",
  scheduleEnabled: false,
  /** hour 0-23 -> profileId (applied when scheduleEnabled) */
  schedule: {
    // 9-17 work/balanced, evening research-ish defaults empty = use active
  },
  estMbPerTab: 50,
  /** "auto" = browser UI language; else locale folder name e.g. pt_BR */
  uiLocale: "auto",
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

/** ISO week key YYYY-Www */
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
