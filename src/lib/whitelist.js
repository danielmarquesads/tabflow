/**
 * Match a tab URL against whitelist rules.
 * modes: exact | subdomain | wildcard
 */
export function isWhitelisted(url, rules) {
  if (!url || !Array.isArray(rules) || rules.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  for (const rule of rules) {
    if (!rule?.pattern) continue;
    const mode = rule.mode || "subdomain";
    if (mode === "exact" && matchExact(parsed, rule.pattern)) return true;
    if (mode === "subdomain" && matchSubdomain(parsed, rule.pattern)) return true;
    if (mode === "wildcard" && matchWildcard(url, parsed, rule.pattern)) return true;
  }
  return false;
}

function matchExact(parsed, pattern) {
  try {
    const p = pattern.includes("://") ? new URL(pattern) : new URL(`https://${pattern}`);
    return (
      parsed.origin === p.origin &&
      normalizePath(parsed.pathname) === normalizePath(p.pathname)
    );
  } catch {
    return parsed.href === pattern || `${parsed.host}${parsed.pathname}` === pattern;
  }
}

function matchSubdomain(parsed, pattern) {
  const host = stripWww(parsed.hostname.toLowerCase());
  let domain = pattern.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").split("/")[0];
  domain = stripWww(domain);
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function matchWildcard(fullUrl, parsed, pattern) {
  const raw = pattern.trim();
  if (!raw) return false;
  // Support host-only patterns like *.google.com and full URL globs
  const candidates = [fullUrl, parsed.href, parsed.hostname, `${parsed.hostname}${parsed.pathname}`];
  const re = globToRegExp(raw);
  return candidates.some((c) => re.test(c));
}

function globToRegExp(glob) {
  let g = glob.trim();
  if (!g.includes("://") && g.includes("*") && !g.startsWith("*")) {
    // treat as hostname glob
  }
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizePath(path) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

function stripWww(host) {
  return host.replace(/^www\./, "");
}

export function validateRule(pattern, mode) {
  if (!pattern || typeof pattern !== "string" || !pattern.trim()) {
    return "Pattern is required";
  }
  if (!["exact", "subdomain", "wildcard"].includes(mode)) {
    return "Invalid mode";
  }
  return null;
}
