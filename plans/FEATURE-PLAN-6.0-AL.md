# AL — Local Flag Pack + Country Dropdown (no CDN) ✅ Done (v6 / 2026-06-04)

> **Priority:** 2 — Done
> **Effort:** Medium
> **Files:** `wwwroot/lib/flags/` (new), `wwwroot/js/seasonal.js`, `Views/Shared/_Layout.cshtml`
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

---

## Problem

AE11a's flag support (`flagUrl`) currently points at `flagcdn.com` and exposes a free-text **Flag URL**
input. The user wants:
1. **No CDN** — flags served from our own app.
2. **All flags bundled** (~250 ISO 3166-1 countries).
3. The free-text URL replaced by a **country dropdown** users pick from.

---

## Plan

1. **Vendor the flag SVGs.** Add the open-source [`flag-icons`](https://github.com/lipis/flag-icons)
   pack (MIT) under `wwwroot/lib/flags/` — the `flags/4x3/*.svg` set (one SVG per ISO 3166-1
   alpha-2 code). No build step; served statically.
   - Decision (confirmed): bundle the **full ~250-country set**.
2. **Country manifest.** A small JS array of `{ code, name }` for the dropdown (alpha-2 + display
   name), derived once from the pack. Lives in seasonal.js (or a generated `flags.js`).
3. **Resolve flag path.** `_seaFlagHtml(cfg)` builds `<img src="/lib/flags/4x3/<code>.svg">` from a
   `cfg.flagCode` (alpha-2), replacing the old `cfg.flagUrl`. Default `flagCode: 'us'`.
4. **Migrate `flagUrl` → `flagCode`.** Meta entries switch to `flagCode`; `_seaGetAnimCfg` /
   localStorage overrides read `flagCode`. Back-compat: if an old saved config still has `flagUrl`,
   map a `flagcdn.com/xx.svg` URL to code `xx`; otherwise ignore.
5. **UI.** Replace the **Flag URL** `<input type="url">` with a searchable `<select>` of countries
   (populated from the manifest) wherever an animation's meta declares a flag. Selecting a country
   stores its code.

---

## Open questions / notes

- Pack size: full 4x3 SVG set is a few MB on disk; acceptable for static serving.
- A `<select>` of 250 entries is fine; consider a type-to-filter later if needed.
- License: include flag-icons' MIT `LICENSE` in `wwwroot/lib/flags/`.

---

## Implemented

- Vendored `flag-icons@7.5.0` 4x3 set → `wwwroot/lib/flags/4x3/*.svg` (271 SVGs, ~2.4MB) + `LICENSE` (MIT).
- Generated `wwwroot/js/flags.js` → `FLAG_COUNTRIES` manifest (271 `{code,name}`, sorted by name), loaded before seasonal.js.
- `_seaFlagHtml`/`_seaFlagCode` resolve a `flagCode` to `/lib/flags/4x3/<code>.svg`; back-compat maps an old `flagcdn.com/xx.svg` `flagUrl` → code `xx`.
- All 8 flag meta entries migrated `flagUrl:'…us.svg'` → `flagCode:'us'`.
- UI: `flagSelectInput` renders a country `<select>` (from `FLAG_COUNTRIES`) per flag animation; live-test + save read/write `flagCode`.

## Verification (done)

- [x] No requests to `flagcdn.com` (or any CDN); `us.svg`/`gb.svg`/`flags.js` serve `200` locally
- [x] Flag dropdown lists 271 countries; selecting GB renders the GB flag and saves
- [x] US-flag animations still default to the US flag
- [x] Old saved `flagUrl` config migrates (e.g. `…/ca.svg` → `ca`) without crashing
- [x] `dotnet build` → 0 errors
