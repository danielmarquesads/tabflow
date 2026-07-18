# TabFlow

**Auto-close inactive Chrome tabs. Recover them from a local archive. 100% free and open source.**

TabFlow is a Chrome MV3 extension for tab overload: set an inactivity threshold, protect what matters, and restore closed tabs from a searchable **local** archive. No accounts, no paywall, no cloud.

## Features

| Feature | Notes |
|--------|--------|
| Auto-close inactive tabs | Minutes / hours / days / months |
| Smart activity | Keyboard, click, scroll, touch, focus |
| Pause / resume | One toggle, settings kept |
| Whitelist | Exact · subdomain · wildcard |
| Protect pinned | Optional |
| Protect audio | Optional |
| Local archive | Search + restore, configurable cap |
| On-page archive button | Optional FAB |
| Dry-run preview | See what would close |
| Min tabs floor | Never strip a window below N |
| Stats | Closed today / total |
| Export / import | JSON backup (survives uninstall) |
| No account · no cloud | `chrome.storage.local` only |

## Data persistence (important)

| Scenario | Settings / archive kept? |
|----------|---------------------------|
| Close Chrome and reopen | **Yes** |
| Restart PC | **Yes** |
| Disable extension temporarily | **Yes** |
| Update extension (same install) | **Yes** |
| **Remove / uninstall extension** | **No** — Chrome wipes `chrome.storage.local` |
| Reinstall after uninstall | **Empty** unless you **Import** a backup |

TabFlow does **not** sync to the cloud. History is local to this browser profile. Use **Settings → Data → Export backup** before uninstalling if you care about the archive.

## Install (developer / unpacked)

1. Clone this repo
2. Optional: `npm run icons` (icons already committed under `icons/`)
3. Open Chrome → `chrome://extensions`
4. Enable **Developer mode**
5. **Load unpacked** → select this repository folder
6. Open the popup → set a threshold → **Save** (auto-close turns on)

## Use

1. Set inactivity threshold (e.g. `2` + `hours`)
2. Leave **Auto-close** on; use **Paused** during deep research
3. Add whitelist rules in Settings for tools you never want closed
4. Restore from **Archive** if something important was closed
5. Use **Would close now** as a dry-run before trusting a short timer
6. Export a JSON backup when you reinstall or switch machines

## Privacy

See [PRIVACY.md](./PRIVACY.md). Summary: no telemetry, no backend, data stays on device until you uninstall or clear site/extension data.

## Develop

```bash
npm test      # pure logic tests
npm run icons # regenerate PNG icons
```

```
manifest.json
src/
  background/service-worker.js
  content/activity.js · fab.js
  lib/          # closer, whitelist, archive, storage
  popup/ · options/ · shared/
icons/
tests/
```

## License

MIT — see [LICENSE](./LICENSE).
