# AK — UX Polish Backlog

> **Priority:** 2  
> **Effort:** Medium  
> **Files:** Various (see each item)  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

Items deferred from Groups AE and AH that did not fit in those batches.

---

## AK1 — Controls Panel Draggable / Collapsible

Make the Reveal / Reset / etc. controls panel either:
- **(a)** draggable like a floating widget, or
- **(b)** collapsible with a ▸ arrow toggle like the chat panel

Persist collapsed/position state to `localStorage`.

**Files:** `Views/Room/Index.cshtml`, `wwwroot/js/room.js`, `wwwroot/css/site.css`

---

## AK2 — Stories Panel Drag Handle Cursor

Story list items are draggable for reordering but show no visual cue.

- Add a ⠿ drag handle element to the left of each story item
- `cursor: grab` on hover / `cursor: grabbing` during drag

**Files:** `Views/Room/Index.cshtml` or `wwwroot/css/site.css`

---

## AK3 — Normal/Compact Preview in View Settings

Add small live thumbnails to the View settings tab showing how Normal vs Compact participant card layout looks before toggling.

- Two side-by-side mini badge mockups, switching to reflect the current toggle state

**Files:** `Views/Shared/_Layout.cshtml`

---

## AK4 — Flip Speed Setting

Add a speed slider for the card flip animation when a vote is cast (and reuse for AJ animations when built).

- Stored in `es_flipDuration` (ms, range 200–1000, default 600)
- Applied as `animation-duration` on the `card-flipping` CSS class via a CSS custom property

**Files:** `wwwroot/js/room.js`, `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`

---

## AK5 — Gradient Card Backgrounds

Allow gradient stops in the card background colour fields:
- Either a gradient builder UI (two colour pickers + direction selector)
- Or a raw CSS value input

Applies to both vote card background (`--card-bg`) and selected card background (`--card-selected`) in the custom theme editor.

**Files:** `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`, `wwwroot/js/room.js`

---

## AK6 — Count-Up Timer Style Settings

Add `es_timerStyle` localStorage key: `{ color, fontSize, fontFamily }`.

- UI sub-section in Settings → Other near clock settings: colour picker, font size input, font family select
- Timer text in `#stc-timer` applies styles inline from saved settings

**Files:** `wwwroot/js/room.js` (`_acTick`, `saveTimerClockSettings`, `_populateRoomOtherSettings`), `Views/Shared/_Layout.cshtml`

---

## Verification

- [ ] Controls panel can be collapsed/dragged; state persists on reload
- [ ] Story list items show ⠿ drag handle with grab cursor
- [ ] View settings tab shows Normal/Compact mini previews that reflect toggle state
- [ ] Flip speed slider changes the card flip animation duration
- [ ] Card backgrounds accept gradient CSS values and render correctly
- [ ] Timer style (colour, size, font) saves and applies in the story bar
- [ ] `dotnet build` → 0 errors
