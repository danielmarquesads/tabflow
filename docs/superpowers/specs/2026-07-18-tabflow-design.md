# TabFlow Design Spec (2026-07-18)

## Goal
Ship a Chrome MV3 extension equivalent to Tabsence features, revised as fully free open source with local-only privacy, power-user controls, and polished tool UI.

## Stack
Vanilla MV3: service worker, content scripts, popup, options page, `chrome.storage.local`.

## Modules
| Module | Responsibility |
|--------|----------------|
| `settings` | Defaults, get/set, validate |
| `activity` | Last-active timestamps per tabId |
| `whitelist` | exact / subdomain / wildcard match |
| `archive` | ring buffer of closed tabs, search, restore |
| `closer` | eligibility + close loop (alarm) |
| `stats` | closed counts |
| `popup` | primary control surface |
| `options` | full configuration |
| `content/activity` | input signals → background |
| `content/fab` | optional on-page archive button |

## Close eligibility (all must pass)
1. Auto-close enabled and not paused
2. Threshold configured (> 0)
3. Tab not active in its window
4. Idle time ≥ threshold
5. Not pinned if protectPinned
6. Not audible if protectAudio
7. Not matched by whitelist
8. Closing would keep window tab count ≥ minTabs
9. URL is http(s) or file (skip chrome://, extension pages)

## Data
```json
{
  "settings": {
    "enabled": false,
    "paused": false,
    "thresholdMs": 0,
    "protectPinned": true,
    "protectAudio": true,
    "minTabs": 3,
    "archiveCap": 500,
    "showPageButton": false,
    "thresholdUnit": "hours",
    "thresholdValue": 1
  },
  "activity": { "tabId": timestamp },
  "archive": [{ "id", "title", "url", "favIconUrl", "closedAt" }],
  "stats": { "closedTotal": 0, "closedToday": 0, "todayKey": "YYYY-MM-DD" },
  "whitelist": [{ "id", "pattern", "mode" }]
}
```

## Permissions
`tabs`, `storage`, `alarms`, `scripting` + host permissions for activity content scripts on http(s).

## Out of scope
Cloud sync, accounts, monetization.
