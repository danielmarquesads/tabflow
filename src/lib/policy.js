import { thresholdToMs, hostnameOf } from "./constants.js";
import { isWhitelisted } from "./whitelist.js";

/**
 * Resolve which profile is active (manual or schedule by hour).
 */
export function resolveActiveProfile(settings, profiles, now = new Date()) {
  const list = Array.isArray(profiles) && profiles.length ? profiles : [];
  let id = settings.activeProfileId || "default";

  if (settings.scheduleEnabled && settings.schedule && typeof settings.schedule === "object") {
    const hour = now.getHours();
    const scheduled = settings.schedule[String(hour)] || settings.schedule[hour];
    if (scheduled) id = scheduled;
  }

  return list.find((p) => p.id === id) || list[0] || null;
}

/**
 * Effective idle threshold for a tab URL (domain rule wins over profile/settings).
 */
export function effectiveThresholdMs(url, settings, profiles, domainRules, now = new Date()) {
  const rules = Array.isArray(domainRules) ? domainRules : [];
  const host = hostnameOf(url);

  for (const rule of rules) {
    if (!rule?.pattern) continue;
    const ms = thresholdToMs(rule.thresholdValue, rule.thresholdUnit || "hours");
    if (ms <= 0) continue;
    if (matchDomainRule(host, url, rule)) return { ms, source: "domain", rule };
  }

  const profile = resolveActiveProfile(settings, profiles, now);
  if (profile) {
    const ms = thresholdToMs(profile.thresholdValue, profile.thresholdUnit);
    if (ms > 0) return { ms, source: "profile", profile };
  }

  const ms =
    settings.thresholdMs > 0
      ? settings.thresholdMs
      : thresholdToMs(settings.thresholdValue, settings.thresholdUnit);
  return { ms, source: "settings" };
}

function matchDomainRule(host, url, rule) {
  const pattern = (rule.pattern || "").trim().toLowerCase();
  if (!pattern || !host) return false;
  const mode = rule.mode || "subdomain";
  const h = host.toLowerCase();

  if (mode === "exact") {
    try {
      const p = pattern.includes("://") ? new URL(pattern) : new URL(`https://${pattern}`);
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") === p.hostname.replace(/^www\./, "") &&
        (u.pathname.replace(/\/+$/, "") || "/") === (p.pathname.replace(/\/+$/, "") || "/");
    } catch {
      return h === pattern.replace(/^www\./, "");
    }
  }
  if (mode === "wildcard") {
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "$",
      "i"
    );
    return re.test(h) || re.test(url);
  }
  // subdomain
  const domain = pattern.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}

export function isSnoozedOpen(url, snoozed, now = Date.now()) {
  if (!url || !Array.isArray(snoozed)) return false;
  return snoozed.some((s) => {
    if (!s?.until || s.until <= now) return false;
    if (s.mode === "reopen") return false; // closed already
    return urlsLooselyEqual(s.url, url);
  });
}

export function urlsLooselyEqual(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    ua.hash = "";
    ub.hash = "";
    return ua.href === ub.href;
  } catch {
    return a === b;
  }
}

export { isWhitelisted };
