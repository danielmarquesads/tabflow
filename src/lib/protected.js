/**
 * Permanent "keep open" list — TabFlow never auto-closes matching tabs.
 * match: "url" (full URL without hash) | "origin" (entire origin)
 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return (url || "").split("#")[0];
  }
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function isProtectedUrl(url, protectedList) {
  if (!url || !Array.isArray(protectedList) || protectedList.length === 0) return false;
  const normalized = normalizeUrl(url);
  const origin = originOf(url);

  for (const item of protectedList) {
    if (!item?.url) continue;
    const match = item.match || "url";
    if (match === "origin") {
      const itemOrigin = originOf(item.url) || item.url;
      if (origin && origin === itemOrigin) return true;
    } else {
      if (normalizeUrl(item.url) === normalized) return true;
    }
  }
  return false;
}

export function findProtectedEntry(url, protectedList) {
  if (!url || !Array.isArray(protectedList)) return null;
  const normalized = normalizeUrl(url);
  const origin = originOf(url);
  return (
    protectedList.find((item) => {
      if (!item?.url) return false;
      if ((item.match || "url") === "origin") {
        return origin && origin === (originOf(item.url) || item.url);
      }
      return normalizeUrl(item.url) === normalized;
    }) || null
  );
}

export function makeProtectedEntry(tab, match = "url") {
  const url = normalizeUrl(tab.url || "");
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    title: tab.title || url,
    match: match === "origin" ? "origin" : "url",
    savedAt: Date.now(),
  };
}

export function addProtected(list, entry) {
  const next = Array.isArray(list) ? [...list] : [];
  const exists = findProtectedEntry(entry.url, next);
  if (exists) return { list: next, entry: exists, added: false };
  next.unshift(entry);
  return { list: next, entry, added: true };
}

export function removeProtected(list, idOrUrl) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((item) => {
    if (item.id === idOrUrl) return false;
    if (normalizeUrl(item.url) === normalizeUrl(idOrUrl)) return false;
    return true;
  });
}
