# Load TabFlow on Zen / Firefox

Zen (and some Firefox builds) **disable extension service workers**.  
Error you may see:

> `background.service_worker is currently disabled. Add background.scripts.`

## Fix (already in repo v1.2.1)

- `manifest.json` includes **both** `service_worker` (Chrome/Edge) and `scripts` (Zen/Firefox).
- `manifest.firefox.json` is Firefox/Zen-only (`scripts` only) if the dual manifest still fails.

## Install on Zen (temporary)

1. Open Zen
2. Address bar: `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…**
4. Choose **one** of:
   - `C:\Users\Daniel\Documents\tabs-rapid\manifest.json` (preferred after 1.2.1)
   - or `C:\Users\Daniel\Documents\tabs-rapid\manifest.firefox.json` if dual still errors
5. Extension appears as temporary (gone after full Zen quit until reloaded)

## Note about DevTools version warning

> Connected browser is more recent than your Zen…

That warning is about remote debugging mismatch. It does **not** block temporary add-on install. You can ignore it for loading TabFlow, or update Zen when available.

## After load

Popup → threshold **1 minute** → Save → test idle tabs or **Close eligible now**.
