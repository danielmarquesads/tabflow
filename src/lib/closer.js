import { isWhitelisted } from "./whitelist.js";
import { isProtectedUrl } from "./protected.js";
import { makeArchiveEntry, pushArchive } from "./archive.js";
import { todayKey } from "./constants.js";

const SKIP_PREFIXES = [
  "chrome://",
  "chrome-extension://",
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
 */
export function evaluateCandidates({
  tabs,
  activity,
  settings,
  whitelist,
  protected: protectedList = [],
  now = Date.now(),
}) {
  if (!settings.enabled || settings.paused) return [];
  if (!settings.thresholdMs || settings.thresholdMs <= 0) return [];

  const byWindow = groupByWindow(tabs);
  const candidates = [];

  for (const [windowId, windowTabs] of byWindow) {
    const minTabs = Math.max(1, Number(settings.minTabs) || 1);
    const closable = [];

    for (const tab of windowTabs) {
      if (!isEligibleTab(tab, settings, whitelist, protectedList, activity, now)) continue;
      closable.push(tab);
    }

    // Sort oldest idle first
    closable.sort((a, b) => lastActive(a, activity) - lastActive(b, activity));

    let remaining = windowTabs.length;
    for (const tab of closable) {
      if (remaining - 1 < minTabs) break;
      candidates.push({
        tab,
        windowId,
        idleMs: now - lastActive(tab, activity),
      });
      remaining -= 1;
    }
  }

  return candidates;
}

function isEligibleTab(tab, settings, whitelist, protectedList, activity, now) {
  if (tab.active) return false;
  if (tab.pinned && settings.protectPinned) return false;
  if (tab.audible && settings.protectAudio) return false;
  if (!isCloseableUrl(tab.url)) return false;
  if (isWhitelisted(tab.url, whitelist)) return false;
  if (isProtectedUrl(tab.url, protectedList)) return false;

  const last = lastActive(tab, activity);
  return now - last >= settings.thresholdMs;
}

function lastActive(tab, activity) {
  const fromMap = activity[String(tab.id)];
  if (typeof fromMap === "number") return fromMap;
  // Fallback: lastAccessed if available (Chrome), else treat as now (safe)
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

/**
 * Perform closes; returns { closed, archive, stats }
 */
export async function performClose(candidates, { archive, stats, settings, closeTab }) {
  let nextArchive = archive;
  let nextStats = {
    closedTotal: stats.closedTotal || 0,
    closedToday: stats.closedToday || 0,
    todayKey: stats.todayKey || todayKey(),
  };
  if (nextStats.todayKey !== todayKey()) {
    nextStats = { ...nextStats, closedToday: 0, todayKey: todayKey() };
  }

  const closed = [];
  for (const { tab } of candidates) {
    try {
      const entry = makeArchiveEntry(tab);
      await closeTab(tab.id);
      nextArchive = pushArchive(nextArchive, entry, settings.archiveCap || 500);
      nextStats.closedTotal += 1;
      nextStats.closedToday += 1;
      closed.push(entry);
    } catch {
      // Tab may already be gone; do not archive or count
    }
  }

  return { closed, archive: nextArchive, stats: nextStats };
}

export { lastActive };
