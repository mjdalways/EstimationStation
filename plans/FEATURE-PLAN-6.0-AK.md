# AK — UX Polish Backlog

> **Priority:** 2  
> **Effort:** Medium  
> **Files:** Various (see each item)  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

Items deferred from Groups AE and AH that did not fit in those batches.

---

## AK1 — Controls Panel Draggable / Collapsible ✅ Done (v6 / 2026-06-04)

Make the Reveal / Reset / etc. controls panel either:
- **(a)** draggable like a floating widget, or
- **(b)** collapsible with a ▸ arrow toggle like the chat panel

Persist collapsed/position state to `localStorage`.

**Files:** `Views/Room/Index.cshtml`, `wwwroot/js/room.js`, `wwwroot/css/site.css`

**Implemented (option b):** clickable `.controls-collapse-header` at the top of the panel; `toggleControlsPanel()`/`_setControlsCollapsed()` in room.js add `.collapsed` to the panel and `.controls-collapsed` to `#roomLayout` (which narrows the grid's `--controls-width` to 40px and hides the control groups); chevron ⟩/⟨ reflects state; persisted in `es_controlsPanelCollapsed` and restored on load. Header is desktop-only (`d-none d-md-flex`).

---

## AK2 — Stories Panel Drag Handle Cursor ✅ Done (v6 / 2026-06-04)

> Originally blocked — no drag-reorder existed. Full drag-to-reorder was built as part of this item.

Story list items are draggable for reordering but show no visual cue.

- Add a ⠿ drag handle element to the left of each story item
- `cursor: grab` on hover / `cursor: grabbing` during drag

**Files:** `Views/Room/Index.cshtml` or `wwwroot/css/site.css`

---

## AK3 — Normal/Compact Preview in View Settings ✅ Done (v6 / 2026-06-04)

Add small live thumbnails to the View settings tab showing how Normal vs Compact participant card layout looks before toggling.

- Two side-by-side mini badge mockups, switching to reflect the current toggle state

**Files:** `Views/Shared/_Layout.cshtml`

**Implemented:** the existing side-by-side Normal/Compact mockups now carry `#cmp-preview-normal`/`#cmp-preview-compact` ids; `applyCompactMode()` (site.js) toggles an `.active` highlight + "✓ active" marker on the matching cell, updating live with the switch. New `.cmp-mode-cell`/`.cmp-active-badge` styles in site.css.

---

## AK4 — Flip Speed Setting ✅ Done (v6 / 2026-06-04)

Add a speed slider for the card flip animation when a vote is cast (and reuse for AJ animations when built).

- Stored in `es_flipDuration` (ms, range 200–1000, default 600)
- Applied as `animation-duration` on the `card-flipping` CSS class via a CSS custom property

**Files:** `wwwroot/js/room.js`, `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`

**Implemented:** `--flip-duration` CSS var on `.card-flipping`; `_getFlipDuration`/`_applyFlipDuration`/`setFlipDuration` in `site.js` (applied on DOMContentLoaded); slider in Visual → Vote Picker Card Style; flip-removal timeouts in `room.js` and `_previewFlipVoteCard` now derive from the saved duration.

---

## AK5 — Gradient Card Backgrounds ✅ Done (v6 / 2026-06-04)

Allow gradient stops in the card background colour fields:
- Either a gradient builder UI (two colour pickers + direction selector)
- Or a raw CSS value input

Applies to both vote card background (`--card-bg`) and selected card background (`--card-selected`) in the custom theme editor.

**Files:** `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`, `wwwroot/js/site.js`

**Implemented (gradient builder option):** per-field "gradient" toggle + two colour pickers + direction select (diagonal / horizontal / vertical / radial) for `card-bg` and `card-selected` in Theme → Cards. `_ctResolveValue`/`_ctGradValue`/`_ctParseGradient`/`_ctApplyCardFieldValue` in site.js compose & round-trip the gradient string; `updateThemePreview` and `saveCustomTheme` use the resolved value, stored in `vars['card-bg']`/`vars['card-selected']`. CSS card declarations switched from `background-color` to `background` (`.poker-card`, `.poker-card.selected`, `.story-item`, `.participant-badge`) so gradient values render; solid colours still work.

---

## AK6 — Count-Up Timer Style Settings ✅ Done (v6 / 2026-06-04)

Add `es_timerStyle` localStorage key: `{ color, fontSize, fontFamily }`.

- UI sub-section in Settings → Other near clock settings: colour picker, font size input, font family select
- Timer text in `#stc-timer` applies styles inline from saved settings

**Files:** `wwwroot/js/room.js` (`_acTick`, `saveTimerClockSettings`, `_populateRoomOtherSettings`), `Views/Shared/_Layout.cshtml`

**Implemented:** `_getTimerStyle`/`_applyTimerStyle`/`saveTimerStyleSettings` in `site.js`; `_acTick` applies the style to `#stc-timer`; `_populateRoomOtherSettings` populates the controls + live preview; UI block (Color / Size / Font + preview) under the "Show count-up timer" switch in Settings → Other.

---

## Verification

- [ ] Controls panel can be collapsed/dragged; state persists on reload
- [ ] Story list items show ⠿ drag handle with grab cursor
- [ ] View settings tab shows Normal/Compact mini previews that reflect toggle state
- [ ] Flip speed slider changes the card flip animation duration
- [ ] Card backgrounds accept gradient CSS values and render correctly
- [ ] Timer style (colour, size, font) saves and applies in the story bar
- [ ] `dotnet build` → 0 errors
