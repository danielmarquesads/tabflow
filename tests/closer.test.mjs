import assert from "node:assert/strict";
import { evaluateCandidates, isCloseableUrl } from "../src/lib/closer.js";
import { isWhitelisted } from "../src/lib/whitelist.js";
import { pushArchive, searchArchive } from "../src/lib/archive.js";
import { thresholdToMs } from "../src/lib/constants.js";

// threshold
assert.equal(thresholdToMs(1, "hours"), 3600000);
assert.equal(thresholdToMs(30, "minutes"), 1800000);
assert.equal(thresholdToMs(0, "hours"), 0);

// urls
assert.equal(isCloseableUrl("https://example.com"), true);
assert.equal(isCloseableUrl("chrome://settings"), false);

// whitelist
assert.equal(
  isWhitelisted("https://app.slack.com/client", [{ pattern: "slack.com", mode: "subdomain" }]),
  true
);
assert.equal(
  isWhitelisted("https://evil.com", [{ pattern: "slack.com", mode: "subdomain" }]),
  false
);
assert.equal(
  isWhitelisted("https://mail.google.com/inbox", [{ pattern: "*.google.com", mode: "wildcard" }]),
  true
);

// archive
const a = pushArchive([], { id: "1", title: "A", url: "https://a.com", closedAt: 1 }, 2);
const b = pushArchive(a, { id: "2", title: "B", url: "https://b.com", closedAt: 2 }, 2);
assert.equal(b.length, 2);
assert.equal(searchArchive(b, "b.com").length, 1);

// closer: active never closed
const now = 1_000_000;
const settings = {
  enabled: true,
  paused: false,
  thresholdMs: 60_000,
  protectPinned: true,
  protectAudio: true,
  minTabs: 1,
};
const tabs = [
  { id: 1, windowId: 1, active: true, pinned: false, audible: false, url: "https://a.com", title: "A" },
  { id: 2, windowId: 1, active: false, pinned: false, audible: false, url: "https://b.com", title: "B" },
  { id: 3, windowId: 1, active: false, pinned: true, audible: false, url: "https://c.com", title: "C" },
];
const activity = { 1: now, 2: now - 120_000, 3: now - 120_000 };
const cands = evaluateCandidates({ tabs, activity, settings, whitelist: [], now });
assert.equal(cands.length, 1);
assert.equal(cands[0].tab.id, 2);

// paused
assert.equal(
  evaluateCandidates({
    tabs,
    activity,
    settings: { ...settings, paused: true },
    whitelist: [],
    now,
  }).length,
  0
);

// min tabs floor
const floor = evaluateCandidates({
  tabs,
  activity,
  settings: { ...settings, minTabs: 3 },
  whitelist: [],
  now,
});
assert.equal(floor.length, 0);

// performClose archives only after successful close
import { performClose } from "../src/lib/closer.js";

let closedIds = [];
const resultOk = await performClose(
  [{ tab: { id: 9, title: "X", url: "https://x.test", favIconUrl: "" } }],
  {
    archive: [],
    stats: { closedTotal: 0, closedToday: 0, todayKey: "2099-01-01" },
    settings: { archiveCap: 10 },
    closeTab: async (id) => {
      closedIds.push(id);
    },
  }
);
assert.equal(resultOk.closed.length, 1);
assert.equal(resultOk.archive.length, 1);
assert.equal(closedIds[0], 9);

const resultFail = await performClose(
  [{ tab: { id: 10, title: "Y", url: "https://y.test", favIconUrl: "" } }],
  {
    archive: [],
    stats: { closedTotal: 0, closedToday: 0, todayKey: "2099-01-01" },
    settings: { archiveCap: 10 },
    closeTab: async () => {
      throw new Error("gone");
    },
  }
);
assert.equal(resultFail.closed.length, 0);
assert.equal(resultFail.archive.length, 0);

console.log("All tests passed");
