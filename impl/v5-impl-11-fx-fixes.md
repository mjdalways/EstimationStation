# v5 Group FX — Bug Fixes & UX Polish

**Date:** 2026-05-17  
**Fixes:** 17  
**Files changed:** 7

---

## FX1 — Season next-occurrence dates: variable seasons + smart suppression

**Root cause:** `_seaInjectNextDates()` only handled fixed-date seasons (numeric month/day) and always injected even when the date matched the already-displayed range text.

**File:** `wwwroot/js/seasonal.js` → `_seaInjectNextDates()`

**Change:**
- Rewrote function to include lookup tables for variable seasons:
  - `LNY` (Lunar New Year): per-year Date objects for 2025–2030
  - `DIWAL` (Diwali): per-year lookup
  - `RAMA` (Ramadan): per-year approximate start
  - nth-weekday helper `nthWd(yr, mo, wd, nth)` — negative `nth` = last
  - Easter via Anonymous Gregorian algorithm
  - Memorial Day (last Monday of May), Labour Day (first Monday of Sep), Mother's Day (2nd Sun May), Father's Day (3rd Sun Jun), Mothering Sunday (4th Sun Lent ≈ March)
- `injectDate(key, nextDate)` formats date as `DD Mon` or `DD Mon YYYY` (if year ≠ current), and only appends `(next: …)` if that string doesn't already appear in the row's displayed text.

---

## FX2 — Promote remaining custom animations + test buttons everywhere

**Root cause:** ~15 animations had `type:'custom'` but only needed a fixed emoji/size; alias wrappers duplicated logic; test buttons only rendered for `type:'runner'`.

**File:** `wwwroot/js/seasonal.js` → `SEA_ANIM_META`, `_seaBuildAnimRow()`

**Change:**
- Promoted to `type:'popup'`: `_seaGhostJumpscare`, `_seaSkullFloat`, `_seaHandFromGrave`, `_seaSnowflakeSpin`, `_seaGiftDropFromSky`, `_seaTopHatFloat`, `_seaFireworksEmoji`, `_seaIceCreamDrip`, `_seaAcornDrop`, `_seaPilgrimHatFloat`
- Promoted to `type:'corner'`: `_seaSunPeek`, `_seaHarvestMoon`
- New `type:'alias'`: `_seaDeepWinterSnow → _seaSnowfall`, `_seaHanamiBlossoms → _seaCherryBlossom`, `_seaThanksgivingLeaves → _seaLeavesSwirl`, `_seaSummerSun → _seaSunPeek`, `_seaSharkSwim → _seaSharkFin`, `_seaWinterSnowfall → _seaSnowfall`
- Function bodies for promoted types updated to read `cfg.emoji`, `cfg.size`, `cfg.side` from `_seaGetAnimCfg()`
- `_seaBuildAnimRow()`: shared `testBtn` variable used in every type branch (runner, popup, corner, particles, custom, alias)

---

## FX3 — Visual tab preview cards use real `.poker-card` HTML

**Root cause:** Preview divs used ad-hoc styling and didn't pick up CSS variables set by theme/colour changes.

**File:** `Views/Shared/_Layout.cshtml` → Visual tab preview section

**Change:** Replaced placeholder divs with `<div class="poker-card">5</div>` and `<div class="poker-card selected">5</div>`. Preview now reflects live theme/colour changes identically to real vote cards.

---

## FX4 — Events tab section headers collapse correctly + accent styling

**Root cause:** Section headers used inconsistent `data-bs-target` / `id` pairings; no special styling beyond the existing gray.

**Files:** `Views/Shared/_Layout.cshtml`, `wwwroot/css/site.css`

**Change:** Audited all Events tab collapse targets; styling updated via FX8 (shared `.settings-section-header` rule).

---

## FX5 — Card Backs moved to Visual tab; front/back preview + flip test

**Root cause:** Card Backs was buried in the Theme tab, away from the other Visual settings.

**File:** `Views/Shared/_Layout.cshtml`

**Change:**
- Removed Card Backs block from Theme tab (left comment placeholder)
- Added at bottom of Visual tab with a preview row: `<div class="poker-card selected">5</div>` ⇌ `<div id="card-back-preview" class="participant-badge voted">?</div>`
- 🔄 Flip button calls `_previewFlip()` which adds/removes `.flip-preview` CSS class (keyframe animation)

**File:** `wwwroot/js/site.js`

**Change:** Added `_previewFlip()` function.

**File:** `wwwroot/css/site.css`

**Change:** Added `@keyframes flip-preview` and `.flip-preview` class.

---

## FX6 — Settings search: highlight matched text

**Root cause:** `filterSettings()` only showed tab-match badge chips; no in-content highlighting.

**File:** `wwwroot/js/site.js` → `filterSettings()`

**Change:**
- Added `_applySearchHighlights(el, q)`: walks text nodes recursively, skips `INPUT/SELECT/TEXTAREA/BUTTON/SCRIPT/STYLE`, wraps matches in `<mark class="search-highlight">`
- Added `_removeSearchHighlights(el)`: unwraps all `<mark class="search-highlight">` elements, normalises text nodes
- `filterSettings()` calls remove on all tabs before re-applying to matching tabs

**File:** `wwwroot/css/site.css`

**Change:**
```css
mark.search-highlight { background: #fff176; color: inherit; border-radius: 2px; padding: 0 1px; }
[data-theme="dark"] mark.search-highlight,
[data-theme="forest"] mark.search-highlight { background: #b8860b; color: #fff; }
```

---

## FX7 — Search input moved into global controls bar

**Root cause:** Search had its own row between the tab nav and tab content, wasting vertical space and visually disconnected from the action buttons.

**File:** `Views/Shared/_Layout.cshtml`

**Change:**
- Removed standalone `#settings-search-wrap` div
- Added `<div class="input-group input-group-sm">🔍 <input id="settings-search"></div>` inside `#settings-global-bar`
- Global bar already uses `d-flex align-items-center gap-2`; search group gets `ms-1` and a fixed `width:175px`

---

## FX8 — Collapsible section headers: accent colour + better styling

**Root cause:** `.settings-section-header` had minimal styling — no accent colour, no visual separation from content.

**File:** `wwwroot/css/site.css`

**Change:**
```css
.settings-section-header {
  cursor: pointer; padding: 0.45rem 0.75rem;
  background: color-mix(in srgb, var(--accent,#5b8dee) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent,#5b8dee) 25%, transparent);
  border-radius: 6px; margin: 10px 0 4px; display: flex; align-items: center;
  font-weight: 700; font-size: 0.82rem; color: var(--accent, #5b8dee); user-select: none;
}
.settings-section-header:hover { background: color-mix(in srgb, var(--accent,#5b8dee) 18%, transparent); }
```

Chevron character `▾` already present in HTML text; `.collapsed` state reduces opacity to 0.75 as a subtle indicator.

---

## FX9 — Story note icons pushed too far right

**Root cause:** `.story-text` had no `min-width:0` so it expanded to fit note preview text, pushing action buttons off-screen in flex containers.

**File:** `wwwroot/css/site.css`

**Change:**
```css
.story-text { overflow: hidden; min-width: 0; flex: 1 1 0; }
.story-row-main { overflow: hidden; }
.story-item-actions { display: flex; gap: 0.25rem; flex-shrink: 0; margin-left: auto; align-self: flex-start; }
```

---

## FX10 — Sidebar at minimum width keeps icons visible

**Root cause:** Sidebar drag IIFE clamped to 180 px minimum, but on page load or persistence restore, narrower values could appear. Below ~120 px icon labels disappeared with no fallback.

**Files:** `wwwroot/js/room.js` (drag IIFE), `wwwroot/css/site.css`

**Change (room.js):**
- `MIN_W = 80`, `NARROW_THRESHOLD = 160`
- `applyWidth(w)` toggles `narrow` class on `.stories-panel` when `w < NARROW_THRESHOLD`

**Change (site.css):**
```css
.stories-panel { min-width: 80px; }
.stories-panel.narrow .story-title-text { display: none; }
.stories-panel.narrow .btn-label-text { display: none; }
.stories-panel.narrow .story-item-estimate { display: none; }
```

---

## FX11 — Star Wars crawl: configurable text + colour

**Root cause:** Crawl text was hardcoded in `_seaStarWarsCrawl()`; colour was hardcoded in seasonal.css.

**Files:** `wwwroot/js/seasonal.js`, `wwwroot/css/seasonal.css`

**Change (seasonal.js):**
- `_seaStarWarsCrawl` META gains `crawlText` (multi-line string) and `crawlColor` ('#ffe81f') fields
- `_seaBuildAnimRow()` detects `fnName === '_seaStarWarsCrawl'` and injects a `<textarea>` + `<input type="color">` for these fields
- `saveSeasonConfig()` reads `scfg_crawlText_*` and `scfg_crawlColor_*` elements into the saved object
- `_seaStarWarsCrawl()` function reads `cfg.crawlText` and `cfg.crawlColor` from `_seaGetAnimCfg()`

**Change (seasonal.css):** Removed `color: #ffe81f` and `text-shadow` from `.sw-crawl-text` — colour now set inline.

---

## FX12 — Emoji picker: new categories + expanded lists

**Root cause:** Original picker had 7 categories with ~15 emojis each; missing common emoji like food, travel, sports.

**File:** `wwwroot/js/emoji-picker.js` → `_EP_CATS`

**Change:**
- Expanded: Smileys +19, Symbols +18, Shapes +10, Nature +15, Animals +17, Objects +14
- New categories: **Food** (30 emojis), **Travel** (25), **Activities** (26), **Flags** (6)

---

## FX13 — AA1 status bar not appearing (Bootstrap `d-none` bug)

**Root cause:** Bootstrap's `d-none` uses `display:none !important`. `bar.style.display = ''` cannot override `!important`, so the bar never appeared.

**File:** `wwwroot/js/seasonal.js` → `_seaUpdateStatusBar()`

**Change:**
```javascript
// Before:
bar.style.display = '';

// After:
if (season) {
    bar.classList.remove('d-none');
    bar.textContent = '🌸 Active season: ' + (label || season);
} else {
    bar.classList.add('d-none');
    bar.textContent = '';
}
```

---

## FX14 — Card navigation: arrow keys + comma/period

**Root cause:** Only number keys (0–9) navigated cards; arrow keys and keyboard shortcuts were unhandled.

**File:** `wwwroot/js/room.js` → keydown handler

**Change:**
- Added `ArrowLeft` / `,` → `_navigateCard(-1)`
- Added `ArrowRight` / `.` → `_navigateCard(1)`

```javascript
function _navigateCard(dir) {
    const isObsMode = isObserver || roomState.participants.some(
        p => p.connectionId === connection?.connectionId && p.isGhost);
    if (isObsMode) return;
    const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
    const idx = selectedVote != null ? values.indexOf(selectedVote) : -1;
    const next = Math.max(0, Math.min(values.length - 1, idx + dir));
    castVote(values[next]);
}
```

---

## FX15 — Sidebar resize handle: visual drag hint

**Root cause:** 5 px transparent handle gave no visual affordance for dragging.

**File:** `wwwroot/css/site.css`

**Change:**
```css
#sidebar-resize-handle { width: 8px; display: flex; align-items: center; justify-content: center; }
#sidebar-resize-handle::after { content: '⋮'; font-size: 14px; color: var(--panel-border,#dee2e6); opacity: 0.4; }
#sidebar-resize-handle:hover { background: rgba(91,141,238,0.12); }
#sidebar-resize-handle:hover::after { opacity: 1; color: var(--accent,#5b8dee); }
```

---

## FX16 — Vibe check: toggle deselect + Clear button

**Root cause:** Once a vibe was cast there was no way to deselect it; no clear affordance.

**File:** `wwwroot/js/room.js` → `castVibeLocal()`, `initVibePanel()`

**Change:**
- `castVibeLocal(emoji)`: if `_myVibe === emoji`, clears selection, broadcasts `CastVibe('')`, hides clear button
- `initVibePanel()`: appends `<button id="vibeClearBtn" class="btn btn-xs btn-outline-secondary d-none">✕</button>` to vibe container; `onclick` calls `castVibeLocal(_myVibe)`
- Clear button shown/hidden based on whether `_myVibe` is set; also hidden on vote/session reset

---

## FX17 — Test buttons missing for non-runner animation types

**Root cause:** `_seaBuildAnimRow()` only rendered `testBtn` HTML in the `type:'runner'` branch.

**File:** `wwwroot/js/seasonal.js` → `_seaBuildAnimRow()`

**Change:** Extracted shared `testBtn` string and used it in every type branch (covered by FX2 above; listed separately for tracking).

---

## Summary Table

| # | Fix | File(s) | Function(s) |
|---|-----|---------|-------------|
| FX1 | Variable season next-dates | seasonal.js | `_seaInjectNextDates` |
| FX2 | Promote animations + test buttons everywhere | seasonal.js | `SEA_ANIM_META`, `_seaBuildAnimRow` |
| FX3 | Visual tab preview uses `.poker-card` | _Layout.cshtml | Visual tab HTML |
| FX4 | Events tab collapse + accent headers | _Layout.cshtml, site.css | Section headers |
| FX5 | Card Backs → Visual tab + flip test | _Layout.cshtml, site.js, site.css | `_previewFlip` |
| FX6 | Search text highlighting | site.js, site.css | `filterSettings`, `_applySearchHighlights` |
| FX7 | Search into global bar | _Layout.cshtml | Global bar HTML |
| FX8 | Section header accent styling | site.css | `.settings-section-header` |
| FX9 | Story note icons pinned right | site.css | `.story-text`, `.story-item-actions` |
| FX10 | Sidebar narrow mode | room.js, site.css | drag IIFE, `.narrow` |
| FX11 | Star Wars crawl configurable | seasonal.js, seasonal.css | `_seaStarWarsCrawl`, META |
| FX12 | Emoji picker expanded | emoji-picker.js | `_EP_CATS` |
| FX13 | Status bar d-none bug | seasonal.js | `_seaUpdateStatusBar` |
| FX14 | Arrow/comma/period card navigation | room.js | `_navigateCard` |
| FX15 | Resize handle ⋮ grip | site.css | `#sidebar-resize-handle` |
| FX16 | Vibe deselect + clear button | room.js | `castVibeLocal`, `initVibePanel` |
| FX17 | Test buttons all types | seasonal.js | `_seaBuildAnimRow` |
