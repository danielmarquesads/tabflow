export function makeArchiveEntry(tab) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: tab.title || tab.url || "Untitled",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    closedAt: Date.now(),
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
      (e.url || "").toLowerCase().includes(q)
  );
}

export function removeArchiveEntry(archive, id) {
  return archive.filter((e) => e.id !== id);
}
