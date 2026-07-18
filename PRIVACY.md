# TabFlow Privacy Policy

**Last updated:** 2026-07-18

TabFlow is a free, open-source Chrome extension. It does **not** operate a backend, collect analytics, or require an account.

## Data stored on your device

TabFlow uses Chrome’s `chrome.storage.local` API to store:

| Data | Purpose |
|------|---------|
| Settings | Threshold, pause, protections, archive cap, FAB toggle, auto-sync |
| Whitelist rules | Domains/URLs you protect from auto-close |
| Kept tabs | URLs you marked to never auto-close |
| Archive | Title, URL, favicon URL, close timestamp of tabs TabFlow closed |
| Stats | Counts of tabs closed (today / total) |
| Activity map | Last-activity timestamps per open tab id (ephemeral, not exported) |

Nothing is uploaded to TabFlow servers (there are none). With **Auto-sync** enabled, settings, whitelist, and kept tabs are also written to Chrome’s built-in Sync storage (Google account) so they can restore after reinstall. The close **archive** stays local only.

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Read tab URL/title/state; close idle tabs; restore from archive |
| `storage` | Persist settings, whitelist, archive, stats locally |
| `alarms` | Periodic idle checks while Chrome is running |
| Host access (`http`/`https`) | Content script detects real user activity (keyboard, click, scroll, touch); optional on-page archive button |

## What happens when you uninstall

Chrome **deletes** extension local storage when the extension is removed. Archive and settings do **not** survive uninstall unless you previously used **Export backup** (Settings → Data) and re-import after reinstall.

## Updates

Updating the extension (same extension id) keeps local storage. Reinstall after uninstall does not restore it automatically.

## Contact

Open an issue on the project GitHub repository for privacy questions.
