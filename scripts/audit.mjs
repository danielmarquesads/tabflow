/**
 * Static QA audit for TabFlow.
 * Run: node scripts/audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const issues = [];
const notes = [];

function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}
function exists(p) {
  return fs.existsSync(path.join(root, p));
}

// --- Manifest ---
const manifest = JSON.parse(read("manifest.json"));
if (manifest.manifest_version !== 3) issues.push("Manifest is not MV3");
if (!manifest.default_locale) issues.push("Missing default_locale");
if (!manifest.background?.service_worker) issues.push("Missing service_worker");
if (!manifest.commands) issues.push("Missing keyboard commands");
if (!manifest.browser_specific_settings?.gecko) {
  issues.push("Missing Firefox gecko id");
} else {
  notes.push(`Firefox gecko id: ${manifest.browser_specific_settings.gecko.id}`);
}
for (const perm of ["tabs", "storage", "alarms", "contextMenus"]) {
  if (!manifest.permissions?.includes(perm)) issues.push(`Missing permission: ${perm}`);
}

// --- Locales ---
const locales = fs.readdirSync(path.join(root, "_locales")).filter((d) =>
  fs.statSync(path.join(root, "_locales", d)).isDirectory()
);
if (locales.length < 15) issues.push(`Only ${locales.length} locales (expected 15+)`);
const en = JSON.parse(read("_locales/en/messages.json"));
const enKeys = new Set(Object.keys(en));
const pt = JSON.parse(read("_locales/pt_BR/messages.json"));
if (Object.keys(pt).length < Object.keys(en).length * 0.9) {
  issues.push("pt_BR locale looks incomplete vs en");
}

// Collect used i18n keys
const used = new Set();
const files = [
  "src/popup/popup.html",
  "src/popup/popup.js",
  "src/options/options.html",
  "src/options/options.js",
  "src/background/service-worker.js",
  "manifest.json",
];
for (const f of files) {
  if (!exists(f)) {
    issues.push(`Missing file ${f}`);
    continue;
  }
  const t = read(f);
  for (const m of t.matchAll(/data-i18n(?:-title|-placeholder|-aria|-html|-doc-title)?="([^"]+)"/g)) {
    used.add(m[1]);
  }
  for (const m of t.matchAll(/\bt\(\s*["']([^"']+)["']/g)) used.add(m[1]);
  for (const m of t.matchAll(/getMessage\(\s*["']([^"']+)["']/g)) used.add(m[1]);
  for (const m of t.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
}
const missing = [...used].filter((k) => !enKeys.has(k)).sort();
if (missing.length) issues.push(`i18n keys used but missing in en: ${missing.join(", ")}`);
else notes.push(`i18n: ${used.size} keys referenced, all present in en`);

// --- SW message cases vs UI ---
const sw = read("src/background/service-worker.js");
const cases = new Set([...sw.matchAll(/case\s+["']([A-Z_]+)["']/g)].map((m) => m[1]));
const uiTypes = new Set();
for (const f of ["src/popup/popup.js", "src/options/options.js"]) {
  const t = read(f);
  for (const m of t.matchAll(/type:\s*["']([A-Z_]+)["']/g)) uiTypes.add(m[1]);
}
const uiMissingInSw = [...uiTypes].filter((t) => !cases.has(t));
if (uiMissingInSw.length) {
  issues.push(`UI sends messages not handled by SW: ${uiMissingInSw.join(", ")}`);
} else {
  notes.push(`Message bus: ${uiTypes.size} UI types all handled by SW`);
}

// --- Feature file presence ---
const featureFiles = {
  closer: "src/lib/closer.js",
  policy: "src/lib/policy.js",
  protected: "src/lib/protected.js",
  archive: "src/lib/archive.js",
  storage: "src/lib/storage.js",
  whitelist: "src/lib/whitelist.js",
};
for (const [name, f] of Object.entries(featureFiles)) {
  if (!exists(f)) issues.push(`Missing core module: ${name}`);
}

// --- Logic smoke (import pure modules) ---
const { evaluateCandidates, splitGraceActions } = await import(
  pathToFileURL(path.join(root, "src/lib/closer.js")).href
);
const { effectiveThresholdMs } = await import(
  pathToFileURL(path.join(root, "src/lib/policy.js")).href
);
const { parseUrlList, groupArchiveByDomain } = await import(
  pathToFileURL(path.join(root, "src/lib/archive.js")).href
);
const { isProtectedUrl, makeProtectedEntry, addProtected } = await import(
  pathToFileURL(path.join(root, "src/lib/protected.js")).href
);

const now = Date.now();
const tabs = [
  { id: 1, windowId: 1, active: true, url: "https://a.com", title: "A" },
  { id: 2, windowId: 1, active: false, url: "https://b.com", title: "B", pinned: false, audible: false },
];
const activity = { 1: now, 2: now - 120000 };
const settings = {
  enabled: true,
  paused: false,
  thresholdMs: 60000,
  thresholdValue: 1,
  thresholdUnit: "minutes",
  protectPinned: true,
  protectAudio: true,
  minTabs: 1,
  graceEnabled: true,
  graceMs: 30000,
};
let c = evaluateCandidates({
  tabs,
  activity,
  settings,
  whitelist: [],
  protected: [],
  now,
});
if (c.length !== 1 || c[0].action !== "warn") {
  issues.push("Grace warn path failed audit smoke");
} else notes.push("Grace warn path OK");

c = evaluateCandidates({
  tabs,
  activity,
  settings,
  whitelist: [],
  protected: [],
  pendingGrace: [{ tabId: 2, closeAfter: now - 1 }],
  now,
});
const split = splitGraceActions(c);
if (split.toClose.length !== 1) issues.push("Grace close path failed");
else notes.push("Grace close path OK");

const prot = addProtected([], makeProtectedEntry({ url: "https://b.com/", title: "B" })).list;
c = evaluateCandidates({
  tabs,
  activity,
  settings: { ...settings, graceEnabled: false },
  whitelist: [],
  protected: prot,
  now,
  skipGrace: true,
});
if (c.length !== 0) issues.push("Protected tab still closeable");
else notes.push("Protected keep-forever OK");

const eff = effectiveThresholdMs(
  "https://youtube.com/watch",
  { thresholdMs: 3600000, activeProfileId: "default" },
  [{ id: "default", thresholdValue: 1, thresholdUnit: "hours" }],
  [{ pattern: "youtube.com", mode: "subdomain", thresholdValue: 20, thresholdUnit: "minutes" }]
);
if (eff.source !== "domain" || eff.ms !== 20 * 60000) {
  issues.push("Domain threshold resolution failed");
} else notes.push("Domain thresholds OK");

const urls = parseUrlList("https://x.com\nyoutube.com | Vid");
if (urls.length !== 2) issues.push("parseUrlList failed");
else notes.push("URL import parser OK");

const groups = groupArchiveByDomain([
  { domain: "a.com", url: "https://a.com/1", closedAt: 2 },
  { domain: "a.com", url: "https://a.com/2", closedAt: 3 },
]);
if (groups[0]?.count !== 2) issues.push("groupArchiveByDomain failed");
else notes.push("Archive domain groups OK");

// Language selector presence
const optHtml = read("src/options/options.html");
if (!optHtml.includes('id="uiLocale"')) {
  issues.push("No in-extension language selector UI (#uiLocale)");
} else {
  notes.push("In-extension language selector present (uiLocale)");
}
const i18nSrc = read("src/shared/i18n.js");
if (!i18nSrc.includes("loadLocale")) {
  issues.push("i18n loadLocale missing");
} else {
  notes.push("Locale override loader (loadLocale) present");
}

// Multi-browser notes
notes.push("APIs use chrome.* (supported on Chrome/Edge; Firefox aliases chrome.* on modern builds)");
if (!exists("src/lib/browser.js")) {
  notes.push("No browser polyfill helper yet (optional hardening)");
}

// Report
console.log("=== TabFlow QA Audit ===");
console.log(`Version: ${manifest.version}`);
console.log(`Locales: ${locales.length} (${locales.join(", ")})`);
console.log("\nNOTES:");
for (const n of notes) console.log("  ·", n);
console.log("\nISSUES:");
if (!issues.length) console.log("  (none critical from static/smoke audit)");
else for (const i of issues) console.log("  ✗", i);
console.log("\nSUMMARY:", issues.length ? `FAIL (${issues.length} issues)` : "PASS (static + logic smoke)");
process.exit(issues.length ? 1 : 0);

function pathToFileURL(p) {
  let s = path.resolve(p).replace(/\\/g, "/");
  if (!s.startsWith("/")) s = "/" + s; // windows
  return { href: "file://" + s };
}
