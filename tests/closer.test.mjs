import assert from "node:assert/strict";
import {
  evaluateCandidates,
  isCloseableUrl,
  performClose,
  splitGraceActions,
} from "../src/lib/closer.js";
import { isWhitelisted } from "../src/lib/whitelist.js";
import {
  pushArchive,
  searchArchive,
  groupArchiveByDomain,
  parseUrlList,
} from "../src/lib/archive.js";
import { thresholdToMs } from "../src/lib/constants.js";
import {
  addProtected,
  isProtectedUrl,
  makeProtectedEntry,
} from "../src/lib/protected.js";
import { effectiveThresholdMs } from "../src/lib/policy.js";

assert.equal(thresholdToMs(1, "hours"), 3600000);
assert.equal(isCloseableUrl("https://example.com"), true);
assert.equal(isCloseableUrl("chrome://settings"), false);
assert.equal(isCloseableUrl("moz-extension://x"), false);

assert.equal(
  isWhitelisted("https://app.slack.com/x", [{ pattern: "slack.com", mode: "subdomain" }]),
  true
);

const now = 1_000_000;
const settings = {
  enabled: true,
  paused: false,
  thresholdMs: 60_000,
  thresholdValue: 1,
  thresholdUnit: "minutes",
  protectPinned: true,
  protectAudio: true,
  minTabs: 1,
  graceEnabled: false,
  graceMs: 30_000,
};
const tabs = [
  {
    id: 1,
    windowId: 1,
    active: true,
    pinned: false,
    audible: false,
    url: "https://a.com",
    title: "A",
  },
  {
    id: 2,
    windowId: 1,
    active: false,
    pinned: false,
    audible: false,
    url: "https://b.com",
    title: "B",
  },
];
const activity = { 1: now, 2: now - 120_000 };

const cands = evaluateCandidates({
  tabs,
  activity,
  settings,
  whitelist: [],
  protected: [],
  profiles: [],
  domainRules: [],
  now,
  skipGrace: true,
});
assert.equal(cands.length, 1);
assert.equal(cands[0].tab.id, 2);

// protected
const prot = addProtected([], makeProtectedEntry({ url: "https://b.com/", title: "B" })).list;
assert.equal(isProtectedUrl("https://b.com/", prot), true);
assert.equal(
  evaluateCandidates({
    tabs,
    activity,
    settings,
    whitelist: [],
    protected: prot,
    now,
    skipGrace: true,
  }).length,
  0
);

// domain rule shorter threshold
const domainRules = [
  {
    id: "1",
    pattern: "b.com",
    mode: "subdomain",
    thresholdValue: 1,
    thresholdUnit: "minutes",
  },
];
const eff = effectiveThresholdMs(
  "https://b.com/x",
  { thresholdMs: 3600000, thresholdValue: 1, thresholdUnit: "hours", activeProfileId: "default" },
  [{ id: "default", thresholdValue: 2, thresholdUnit: "hours" }],
  domainRules,
  new Date(now)
);
assert.equal(eff.source, "domain");
assert.equal(eff.ms, 60000);

// grace warn vs close
const graceSettings = { ...settings, graceEnabled: true, graceMs: 30_000 };
const warned = evaluateCandidates({
  tabs,
  activity,
  settings: graceSettings,
  whitelist: [],
  protected: [],
  pendingGrace: [],
  now,
});
assert.equal(warned[0].action, "warn");
const { toWarn, toClose } = splitGraceActions(warned);
assert.equal(toWarn.length, 1);
assert.equal(toClose.length, 0);

const closing = evaluateCandidates({
  tabs,
  activity,
  settings: graceSettings,
  whitelist: [],
  protected: [],
  pendingGrace: [{ tabId: 2, closeAfter: now - 1, url: "https://b.com" }],
  now,
});
assert.equal(closing[0].action, "close");

// simulate horizon
const sim = evaluateCandidates({
  tabs: [
    ...tabs,
    {
      id: 3,
      windowId: 1,
      active: false,
      pinned: false,
      audible: false,
      url: "https://c.com",
      title: "C",
    },
  ],
  activity: { ...activity, 3: now - 30_000 },
  settings: { ...settings, thresholdMs: 60_000 },
  whitelist: [],
  protected: [],
  now,
  horizonMs: 60_000,
  skipGrace: true,
});
assert.ok(sim.some((c) => c.tab.id === 3));

// archive helpers
const urls = parseUrlList("https://a.com\nb.com | Title\nnot a url");
assert.equal(urls.length, 2);
assert.ok(urls[1].url.startsWith("https://"));

const arch = [
  { id: "1", url: "https://a.com/1", domain: "a.com", closedAt: 2 },
  { id: "2", url: "https://a.com/2", domain: "a.com", closedAt: 3 },
  { id: "3", url: "https://b.com", domain: "b.com", closedAt: 1 },
];
const groups = groupArchiveByDomain(arch);
assert.equal(groups.length, 2);
assert.equal(groups[0].domain, "a.com");

const a = pushArchive([], { id: "1", title: "A", url: "https://a.com", closedAt: 1 }, 2);
assert.equal(searchArchive(a, "a.com").length, 1);

let closedIds = [];
const resultOk = await performClose(
  [{ tab: { id: 9, title: "X", url: "https://x.test", favIconUrl: "" } }],
  {
    archive: [],
    stats: { closedTotal: 0, closedToday: 0, closedWeek: 0, estMbSaved: 0 },
    settings: { archiveCap: 10, estMbPerTab: 50 },
    closeTab: async (id) => {
      closedIds.push(id);
    },
  }
);
assert.equal(resultOk.closed.length, 1);
assert.equal(resultOk.stats.closedWeek, 1);
assert.equal(resultOk.stats.estMbSaved, 50);

const resultFail = await performClose(
  [{ tab: { id: 10, title: "Y", url: "https://y.test", favIconUrl: "" } }],
  {
    archive: [],
    stats: {},
    settings: { archiveCap: 10 },
    closeTab: async () => {
      throw new Error("gone");
    },
  }
);
assert.equal(resultFail.closed.length, 0);

console.log("All tests passed");
