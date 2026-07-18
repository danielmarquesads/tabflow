# TabFlow

**Auto-close inactive browser tabs. Keep what matters. Recover the rest.**  
100% **free** · **open source (MIT)** · no accounts · no paywall · no cloud backend of our own.

Works on **Chrome**, **Edge**, and **Firefox** (MV3).

## Features (all free)

| # | Feature | Notes |
|---|---------|--------|
| 1 | **Profiles** | Balanced / Deep work / Research + optional hour schedule |
| 2 | **Grace period** | Warn before close; keep from the popup |
| 3 | **Archive by domain** | Group + **reopen session** |
| 4 | **Multi-browser** | Chrome, Edge, Firefox (same codebase) |
| 5 | **Snooze** | Close now, reopen in 1h (popup / context / shortcut) |
| 6 | **Stats** | Today, week, estimated MB saved |
| 7 | **Import URLs** | Paste OneTab-style or plain URL lists |
| 8 | **Domain thresholds** | e.g. YouTube 20m, GitHub 8h |
| 9 | **Keyboard shortcuts** | Pause, keep, snooze, archive |
| 10 | **Simulate +1h** | Dry-run what would close if idle continues |
| + | Keep forever, whitelist, smart activity, Chrome Sync backup of config | |

## Install

### Chrome / Edge

1. Clone this repo  
2. `chrome://extensions` or `edge://extensions` → Developer mode  
3. **Load unpacked** → this folder  

### Firefox

1. `about:debugging#/runtime/this-firefox`  
2. **Load Temporary Add-on** → select `manifest.json`  
3. For permanent install, sign via AMO (gecko id is set in the manifest)

### First use

Popup → set threshold → **Save** → auto-close on.  
Mark important tabs with **Keep this tab open**.

## Shortcuts (customizable)

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+P` | Toggle pause |
| `Alt+Shift+K` | Keep current tab |
| `Alt+Shift+S` | Snooze 1 hour |
| `Alt+Shift+A` | Open archive |

Chrome: `chrome://extensions/shortcuts`

## Persistence

| Data | Local | Chrome Sync (optional) |
|------|-------|-------------------------|
| Settings, profiles, domain rules, whitelist, kept tabs | Yes | Yes if Auto-sync on |
| Archive of closed tabs | Yes | No (export JSON) |
| Snooze queue / grace | Yes | No |

Uninstall wipes local storage; Sync can restore config when signed into the browser.

## Develop

```bash
npm test
npm run locales
npm run icons
```

## License

MIT — see [LICENSE](./LICENSE).  
Privacy: [PRIVACY.md](./PRIVACY.md).
