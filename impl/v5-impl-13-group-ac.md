# v5 Group AC — Session Timer & Clock

**Date:** 2026-05-18  
**Items:** AC1, AC2, AC3, AC4  
**Files changed:** 3

---

## Context

The AC group was previously half-built: rendering functions (`_acTick`, `_acRenderClock`, `_acUpdateAnalogHands`, `_acAnalogSvgTemplate`) and settings HTML existed but were never wired up. `saveTimerClockSettings()` and `_tcToggleMode()` were undefined, `acStartStoryTimer()` was never called, no persistent tick interval existed, CSS was missing.

---

## AC1 — Count-Up Timer

### Root cause
`acStartStoryTimer()` was defined but never called from the `CurrentStoryChanged` SignalR handler.

### Fix — `wwwroot/js/room.js`

**`CurrentStoryChanged` handler** — added one line:
```javascript
connection.on('CurrentStoryChanged', (storyId) => {
    roomState.currentStoryId = storyId;
    selectedVote = null;
    updateCurrentStoryDisplay();
    renderStories();
    renderCards();
    acStartStoryTimer(storyId);  // AC1: start per-story timer
});
```

**`acStartStoryTimer` simplified** — removed its own `setInterval`/`clearInterval` (now delegated to the persistent interval from AC2):
```javascript
function acStartStoryTimer(storyId) {
    if (storyId && storyId === _acLastStoryId) return;
    _acLastStoryId = storyId || null;
    _acTimerStart = storyId ? Date.now() : null;
    _acTick();  // immediate refresh; persistent interval handles subsequent ticks
}
```

Also removed the `_acTimerInterval` variable (no longer needed).

---

## AC2 — Live Clock with Timezone Support

### Root cause
No persistent interval existed to tick the clock when no story was active. The old code only ticked during a story via `_acTimerInterval`.

### Fix — `wwwroot/js/room.js`

**`loadTimerClockSettings()`** — new function:
```javascript
function loadTimerClockSettings() {
    setInterval(_acTick, 1000);
    _acTick(); // initial render
}
```

Called from the init block after `loadReactionSettings()`:
```javascript
loadTimerClockSettings();
```

The one persistent interval drives both timer and clock via `_acTick()`, which reads `es_showTimer` and `es_showClock` to decide what to render.

---

## AC3 — Enable/Disable in Settings

### Root cause
`saveTimerClockSettings()` and `_tcToggleMode()` were called from form `onchange` attributes but not defined anywhere.

### Fix — `wwwroot/js/room.js`

**`saveTimerClockSettings()`:**
```javascript
function saveTimerClockSettings() {
    // reads all Other tab timer/clock form fields
    // persists: es_showTimer, es_showClock, es_clockTimezone, es_clockStyle (JSON)
    // calls _acTick() to apply immediately
}
window.saveTimerClockSettings = saveTimerClockSettings;
```

**`_tcToggleMode(mode)`:**
```javascript
function _tcToggleMode(mode) {
    var digital = document.getElementById('tc-digital-opts');
    var analog  = document.getElementById('tc-analog-opts');
    if (digital) digital.style.display = (mode === 'digital') ? '' : 'none';
    if (analog)  analog.style.display  = (mode === 'analog')  ? '' : 'none';
}
window._tcToggleMode = _tcToggleMode;
```

---

## AC4 — Clock Display Customization

### Root cause
Settings form fields were not populated when the modal opened; no form-to-localStorage bridge existed.

### Fix — `wwwroot/js/room.js`

**`_populateRoomOtherSettings()`** — extended (already existed for P1/P2) to also populate timer/clock fields:
- Reads `es_showTimer`, `es_showClock`, `es_clockTimezone`, `es_clockStyle` from localStorage
- Sets checkbox states, timezone select, mode radio, and all color/size pickers
- Calls `_tcToggleMode(mode)` to show the correct options panel

### Fix — `wwwroot/css/site.css`

Added before `.keyboard-legend`:
```css
/* AC — Session Timer & Clock bar */
.session-tc-bar {
    display: flex; align-items: center; gap: 8px; padding: 2px 8px; margin-top: 4px;
    font-size: 0.78rem; color: var(--text-secondary, #6c757d);
    background: var(--bg2, #f8f9fa); border: 1px solid var(--panel-border, #dee2e6);
    border-radius: 6px; user-select: none;
}
.stc-segment { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
.stc-sep { opacity: 0.4; font-size: 0.7rem; }
.ac-analog { display: inline-block; vertical-align: middle; color: var(--text, #212529); }
```

---

## Summary

| Sub-item | What was fixed | Key |
|----------|---------------|-----|
| AC1 | `acStartStoryTimer` wired to `CurrentStoryChanged` | — |
| AC2 | Persistent `setInterval(_acTick, 1000)` via `loadTimerClockSettings()` | `es_showTimer`, `es_showClock` |
| AC3 | `saveTimerClockSettings()` + `_tcToggleMode()` defined and exposed | `es_clockStyle`, `es_clockTimezone` |
| AC4 | Form population in `_populateRoomOtherSettings()`; CSS added | `es_clockStyle` JSON |

No server changes. No HTML changes (bar markup already existed in `Views/Room/Index.cshtml`; settings HTML already existed in `_Layout.cshtml`).
