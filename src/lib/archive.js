import { hostnameOf } from "./constants.js";

export function makeArchiveEntry(tab) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: tab.title || tab.url || "Untitled",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    closedAt: Date.now(),
    domain: hostnameOf(tab.url || ""),
  };
}

export function pushArchive(archive, entry, cap = 500) {
  const limit = Math.max(1, Number(cap) || 500);
  const next = [entry, ...(Array.isArray(archive) ? archive : [])];
  return next.slice(0, limit);
}

export function searchArchive(archive, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return archive;
  return archive.filter(
    (e) =>
      (e.title || "").toLowerCase().includes(q) ||
      (e.url || "").toLowerCase().includes(q) ||
      (e.domain || "").toLowerCase().includes(q)
  );
}

export function removeArchiveEntry(archive, id) {
  return archive.filter((e) => e.id !== id);
}

/** Group archive entries by domain (newest first within group). */
export function groupArchiveByDomain(archive) {
  const map = new Map();
  for (const e of archive || []) {
    const key = e.domain || hostnameOf(e.url) || "other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.entries()]
    .map(([domain, entries]) => ({
      domain,
      entries,
      count: entries.length,
      latest: Math.max(...entries.map((x) => x.closedAt || 0)),
    }))
    .sort((a, b) => b.latest - a.latest);
}

export function parseUrlList(text) {
  const lines = String(text || "").split(/[\r\n]+/);
  const urls = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // OneTab-ish: url | title  or plain url
    const part = trimmed.split("|")[0].trim().split(/\s+/)[0];
    let url = part;
    if (!/^https?:\/\//i.test(url) && /^[\w.-]+\.[a-z]{2,}/i.test(url)) {
      url = `https://${url}`;
    }
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        urls.push({
          url: u.href,
          title: trimmed.includes("|") ? trimmed.split("|").slice(1).join("|").trim() : u.hostname,
        });
      }
    } catch {
      // skip
    }
  }
  return urls;
}
