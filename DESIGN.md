# TabFlow Design

## Design read
Product utility UI for power users under dim ambient light: graphite console + honey amber status. Restrained color strategy; density high for popup width ~380px.

## Palette (OKLCH)
```css
--bg: oklch(0.13 0 0);
--surface: oklch(0.17 0 0);
--surface-2: oklch(0.21 0 0);
--ink: oklch(0.96 0 0);
--muted: oklch(0.68 0 0);
--primary: oklch(0.74 0.16 65);
--primary-ink: oklch(0.18 0.02 65);
--accent: oklch(0.72 0.11 210);
--danger: oklch(0.65 0.18 25);
--line: oklch(0.28 0 0);
--ok: oklch(0.72 0.14 145);
```

## Type
- UI: "IBM Plex Sans" + system fallbacks (tool clarity, not Inter)
- Mono numbers: "IBM Plex Mono" + system mono
- Loaded via Google Fonts in extension pages (network optional; fallbacks always)

## Shape
- Radius 8px controls, 10px panels
- 1px hairline borders, no nested cards, no glassmorphism
- Accent used for status/live only; primary for CTAs

## Motion
- 160–220ms ease-out on toggles and list updates
- Honor prefers-reduced-motion

## Surfaces
- Popup: status + threshold + pause + quick links to archive/preview
- Options: full settings, whitelist, archive, stats, import/export
