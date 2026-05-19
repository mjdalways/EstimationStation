# AE11a — Generic Flag Image Support in Seasonal Animations

> **Priority:** 1 — Next up  
> **Effort:** Small–Medium  
> **Files:** `wwwroot/js/seasonal.js`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

---

## Problem

Seven seasonal animations across four US holidays embed the US flag as a raw `<img>` HTML string
(`_SEA_US_FLAG = '<img src="https://flagcdn.com/us.svg" …>'`) concatenated directly into the
`emoji` or `chars` fields of `SEA_ANIM_META`. The emoji config UI renders those fields in a plain
`<input type="text">`, so users see raw escaped HTML — and any save-back corrupts or loses the flag.
There is also no way to swap the flag for another country's flag.

---

## Affected Animations

| Function | Holiday | Flag usage |
|---|---|---|
| `_seaPresParade` | Presidents Day | `emoji: '🎩' + _SEA_US_FLAG` |
| `_seaPresStars` | Presidents Day | `chars` array includes `_SEA_US_FLAG` as a particle |
| `_seaMemPoppies` | Memorial Day | `chars` array includes `_SEA_US_FLAG` as a particle |
| `_seaMemFlag` | Memorial Day | `emoji: _SEA_US_FLAG` (flag only) |
| `_seaFlagParade` | Independence Day | `emoji: _SEA_US_FLAG + '🎆'` (flag first) |
| `_seaFlagPop` | Independence Day | `emoji: _SEA_US_FLAG` (flag only) |
| `_seaVetFlag` | Veterans Day | `emoji: _SEA_US_FLAG + '🎖️'` (flag first) |
| `_seaVetMedals` | Veterans Day | `chars` array includes `_SEA_US_FLAG` as a particle |

---

## Solution — `flagUrl` + `flagFirst` meta fields

Two new optional fields are added to `SEA_ANIM_META` entries:

| Field | Type | Purpose |
|---|---|---|
| `flagUrl` | `string` (URL) | Image URL for the flag; user-overridable per animation via settings UI |
| `flagFirst` | `boolean` | `true` = flag renders before emoji content; default `false` (flag after emoji) |

A `_seaFlagHtml(cfg)` helper constructs the `<img>` tag from `cfg.flagUrl` at runtime.
`_seaRunnerFn`, `_seaParticlesFn`, and `_seaPopupFn` are updated to assemble their content from
the separate `emoji` and `flagUrl` fields. `_seaGetAnimCfg` already merges meta defaults with
localStorage overrides — no changes needed there.

The settings UI gains a **Flag URL** text input (type="url") for any animation whose meta defines
`flagUrl`. Users can type any `flagcdn.com` (or other) URL to change which flag is shown.

---

## Future extensibility

- Any new seasonal animation for a national holiday can simply add `flagUrl: 'https://flagcdn.com/XX.svg'` (ISO 3166-1 alpha-2 country code) to its meta entry — no code changes needed.
- UK flags (`flagcdn.com/gb.svg`), Canadian flags (`flagcdn.com/ca.svg`), etc. all work with the same infrastructure.
- The `flagFirst` field controls whether the flag leads or follows the emoji — sufficient for all existing and anticipated layouts.

---

## Verification

- [ ] All 8 affected animations show a **Flag URL** input in their config panel
- [ ] Default URL is `https://flagcdn.com/us.svg`; test animation renders the US flag correctly
- [ ] Changing URL to `https://flagcdn.com/gb.svg` → animation shows UK flag; save persists
- [ ] `_seaPresParade`: 🎩 appears **before** the flag in the runner
- [ ] `_seaFlagParade` / `_seaVetFlag`: flag appears **before** the emoji (flagFirst:true)
- [ ] `_seaMemFlag` / `_seaFlagPop`: emoji field is empty; only the flag renders
- [ ] Particles animations (`_seaPresStars`, `_seaMemPoppies`, `_seaVetMedals`): flag appears as one of the falling particle types alongside the emoji chars
- [ ] Non-flag animations show no Flag URL input
- [ ] `dotnet build` → 0 errors
