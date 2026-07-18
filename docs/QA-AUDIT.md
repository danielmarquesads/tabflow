# TabFlow QA Audit

**Date:** 2026-07-18  
**Version audited:** 1.2.0 (+ language selector fix)  
**Method:** static audit script, pure-logic unit tests, code review.  
**Not included:** live click-through in Chrome/Firefox UI (requires human or browser automation with unpacked load).

## Executive summary

| Area | Status | Notes |
|------|--------|--------|
| Core close logic | **PASS** | Unit + audit smoke |
| Keep forever / protect | **PASS** | Logic covered |
| Grace period | **PASS** | warn → close path covered |
| Domain thresholds | **PASS** | policy module |
| Profiles | **PASS** (code) | Wired; needs UI smoke |
| Snooze | **PASS** (code) | SW + alarms; needs UI smoke |
| Archive groups / reopen | **PASS** (code) | |
| Import URLs | **PASS** | parser unit-tested |
| Keyboard commands | **PASS** (manifest) | OS-dependent |
| i18n keys | **PASS** | 132 used keys present in `en` |
| Language **selector** | **PASS** (after fix) | Settings → Language |
| Multi-browser Chrome/Edge | **LIKELY PASS** | Standard MV3 `chrome.*` |
| Multi-browser Firefox | **LIKELY PASS** | gecko id + `chrome.*` alias; temporary load for dev |
| Live tab auto-close | **NOT RUNTIME-VERIFIED** | User should Reload + 1–2 min threshold test |

## How language works

1. **Default:** browser UI language (`chrome.i18n`) maps to `_locales/*`.
2. **Override:** Settings → **Language** (`uiLocale`) loads `_locales/<code>/messages.json` via `fetch` + re-applies UI strings.
3. Changing browser language alone is enough if Language = **Auto**.

There is **no** separate language menu in the Chrome toolbar; it is inside the extension Settings page.

## Multi-browser

| Browser | Support | How to load |
|---------|---------|-------------|
| Chrome | Primary | Load unpacked → repo root |
| Edge | Same as Chrome | `edge://extensions` load unpacked |
| Firefox 115+ | Intended | `about:debugging` → temporary add-on → `manifest.json` |

Notes:
- Code uses `chrome.*` APIs (Firefox provides a compatible `chrome` namespace on modern versions).
- Firefox permanent install needs AMO signing; temporary load is for QA.
- `browser_specific_settings.gecko.id` is set.

## Feature checklist (logic)

| Feature | Implemented | Automated test |
|---------|-------------|----------------|
| Auto-close idle | Yes | Yes |
| Smart activity | Yes | Code review |
| Pause | Yes | Code review |
| Whitelist | Yes | Yes |
| Keep forever | Yes | Yes |
| Grace | Yes | Yes |
| Profiles + schedule | Yes | Partial |
| Domain rules | Yes | Yes |
| Snooze reopen | Yes | Code review |
| Stats week/MB | Yes | Yes (performClose) |
| Import paste | Yes | Yes |
| Archive domain + reopen | Yes | Yes |
| Simulate +1h | Yes | Yes (horizon) |
| Sync settings | Yes | Code review |
| Export/import JSON | Yes | Code review |
| Shortcuts | Manifest | Manual |
| 19 locales | Yes | Key audit |
| Language picker | Yes | Static audit |

## How to verify close in practice (2 min)

1. Reload extension on `C:\Users\Daniel\Documents\tabs-rapid`
2. Popup: threshold **1** + **minutes** → Save  
3. Open 4 tabs; stay on a 5th (active never closes)  
4. Wait ~1 min → badge / “Closing soon” / Archive  
5. Or click **Close eligible now**

## Commands

```bash
npm test
node scripts/audit.mjs
```

## Residual risks

1. Service worker sleep: alarms re-wake every 1 min (by design).  
2. Firefox temporary add-on resets on restart.  
3. `storage.sync` quota may trim large protected/whitelist lists.  
4. Google Fonts in popup need network (fallback system fonts exist in CSS stack after Plex).  
5. No end-to-end Playwright against real Chrome extension APIs in CI yet.
