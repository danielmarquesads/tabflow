import { isWhitelisted } from "./whitelist.js";
import { isProtectedUrl } from "./protected.js";
import { makeArchiveEntry, pushArchive } from "./archive.js";
import { todayKey, weekKey } from "./constants.js";
import {
  effectiveThresholdMs,
  isSnoozedOpen,
} from "./policy.js";

const SKIP_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "moz-extension://",
  "edge://",
  "about:",
  "devtools://",
  "chrome-search://",
  "chrome-untrusted://",
];

export function isCloseableUrl(url) {
  if (!url) return false;
  return !SKIP_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * Build list of tabs that would be closed under current policy.
 * @param {object} opts
 * @param {number} [opts.horizonMs] - simulate future: treat "now" as now+horizon for threshold only
 * @param {boolean} [opts.skipGrace] - if true, ignore grace (for simulation / force)
 */
export function evaluateCandidates({
  tabs,
  activity,
  settings,
  whitelist,
  protected: protectedList = [],
  profiles = [],
  domainRules = [],
  snoozed = [],
  pendingGrace = [],
  now = Date.now(),
  horizonMs = 0,
  skipGrace = false,
}) {
  if (!settings.enabled || settings.paused) return [];

  const byWindow = groupByWindow(tabs);
  const candidates = [];
  const evalNow = now + (horizonMs || 0);

  for (const [windowId, windowTabs] of byWindow) {
    const minTabs = Math.max(1, Number(settings.minTabs) || 1);
    const closable = [];

    for (const tab of windowTabs) {
      const meta = tabMeta(tab, {
        settings,
        whitelist,
        protectedList,
        profiles,
        domainRules,
        snoozed,
        activity,
        now: evalNow,
        realNow: now,
      });
      if (!meta.eligible) continue;
      closable.push({ tab, ...meta });
    }

    closable.sort((a, b) => a.last - b.last);

    let remaining = windowTabs.length;
    for (const item of closable) {
      if (remaining - 1 < minTabs) break;
      candidates.push({
        tab: item.tab,
        windowId,
        idleMs: evalNow - item.last,
        thresholdMs: item.thresholdMs,
        source: item.source,
        inGrace: false,
        graceEndsAt: null,
      });
      remaining -= 1;
    }
  }

  if (!settings.graceEnabled || skipGrace || horizonMs > 0) {
    return candidates;
  }

  // Grace: first pass only marks; close when past grace window
  const graceMs = Math.max(0, Number(settings.graceMs) || 0);
  if (graceMs <= 0) return candidates;

  const pendingByTab = new Map(
    (pendingGrace || []).map((g) => [String(g.tabId), g])
  );

  return candidates.map((c) => {
    const g = pendingByTab.get(String(c.tab.id));
    if (!g) {
      return { ...c, inGrace: true, graceEndsAt: now + graceMs, action: "warn" };
    }
    if (now >= g.closeAfter) {
      return { ...c, inGrace: false, graceEndsAt: g.closeAfter, action: "close" };
    }
    return {
      ...c,
      inGrace: true,
      graceEndsAt: g.closeAfter,
      action: "warn",
    };
  });
}

function tabMeta(
  tab,
  { settings, whitelist, protectedList, profiles, domainRules, snoozed, activity, now, realNow }
) {
  if (tab.active) return { eligible: false };
  if (tab.pinned && settings.protectPinned) return { eligible: false };
  if (tab.audible && settings.protectAudio) return { eligible: false };
  if (!isCloseableUrl(tab.url)) return { eligible: false };
  if (isWhitelisted(tab.url, whitelist)) return { eligible: false };
  if (isProtectedUrl(tab.url, protectedList)) return { eligible: false };
  if (isSnoozedOpen(tab.url, snoozed, realNow || now)) return { eligible: false };

  const { ms: thresholdMs, source } = effectiveThresholdMs(
    tab.url,
    settings,
    profiles,
    domainRules,
    new Date(realNow || now)
  );
  if (!thresholdMs || thresholdMs <= 0) return { eligible: false };

  const last = lastActive(tab, activity);
  if (now - last < thresholdMs) return { eligible: false };

  return { eligible: true, last, thresholdMs, source };
}

/**
 * Pure helper: which candidates are hard closes vs grace warnings.
 */
export function splitGraceActions(candidates) {
  const toClose = [];
  const toWarn = [];
  for (const c of candidates) {
    if (c.action === "warn") toWarn.push(c);
    else toClose.push(c);
  }
  return { toClose, toWarn };
}

function lastActive(tab, activity) {
  const fromMap = activity[String(tab.id)];
  if (typeof fromMap === "number") return fromMap;
  if (typeof tab.lastAccessed === "number" && tab.lastAccessed > 0) {
    return tab.lastAccessed;
  }
  return Date.now();
}

function groupByWindow(tabs) {
  const map = new Map();
  for (const tab of tabs) {
    const list = map.get(tab.windowId) || [];
    list.push(tab);
    map.set(tab.windowId, list);
  }
  return map;
}

export async function performClose(candidates, { archive, stats, settings, closeTab }) {
  let nextArchive = archive;
  let nextStats = normalizeCloseStats(stats, settings);

  const closed = [];
  for (const { tab } of candidates) {
    try {
      const entry = makeArchiveEntry(tab);
      await closeTab(tab.id);
      nextArchive = pushArchive(nextArchive, entry, settings.archiveCap || 500);
      nextStats = bumpStats(nextStats, settings);
      closed.push(entry);
    } catch {
      // gone
    }
  }

  return { closed, archive: nextArchive, stats: nextStats };
}

function normalizeCloseStats(stats, settings) {
  const base = {
    closedTotal: 0,
    closedToday: 0,
    closedWeek: 0,
    estMbSaved: 0,
    todayKey: todayKey(),
    weekKey: weekKey(),
  };
  const s = { ...base, ...(stats || {}) };
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

function bumpStats(stats, settings) {
  const mb = Number(settings.estMbPerTab) || 50;
  return {
    ...stats,
    closedTotal: (stats.closedTotal || 0) + 1,
    closedToday: (stats.closedToday || 0) + 1,
    closedWeek: (stats.closedWeek || 0) + 1,
    estMbSaved: Math.round(((stats.estMbSaved || 0) + mb) * 10) / 10,
  };
}

export { lastActive };
