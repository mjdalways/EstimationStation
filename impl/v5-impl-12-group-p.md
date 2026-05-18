# v5 Group P — Keyboard Voting + Emoji Reactions

**Date:** 2026-05-17  
**Items:** P1, P2  
**Files changed:** 6

---

## P1 — Keyboard Voting: extra keys + shortcut legend

### Root cause
Digit keys 1–9 and Digit0→☕ already worked, but there was no legend in the UI, no C/Q/Minus aliases, and no way to disable the shortcuts.

### Files
- `wwwroot/js/room.js`
- `Views/Room/Index.cshtml`
- `Views/Shared/_Layout.cshtml` (Other tab)
- `wwwroot/css/site.css`
- `wwwroot/js/site.js` (openSettingsModal hook)

### Changes

**room.js — variables at top:**
```javascript
let _kbShortcutsEnabled = true;
```

**room.js — keydown handler updated:**
- Wrapped all digit/special key handling in `if (_kbShortcutsEnabled && !e.ctrlKey && !e.altKey)`
- Added `KeyC` → `_selectCardByValue('☕')`
- Added `KeyQ` → `_selectCardByValue('?')`
- Added `Minus` → `_selectCardByValue('🚫')`
- Arrow/comma/period navigation unchanged (always active)

**room.js — new helpers:**
```javascript
function _selectCardByValue(val) { ... }       // finds val in current card set
function _updateKeyboardLegend() { ... }       // renders kbd chips below card row
function loadKbSettings() { ... }              // reads es_kbShortcuts, syncs toggle
function toggleKbShortcuts(enabled) { ... }    // saves setting, refreshes legend
function _populateRoomOtherSettings() { ... }  // called by openSettingsModal
```

**room.js — renderCards():**
Added `_updateKeyboardLegend();` call at end.

**room.js — init block:**
Added `loadKbSettings();` after `initVibePanel();`.

**Views/Room/Index.cshtml:**
```html
<div id="keyboard-legend" class="keyboard-legend" style="display:none;"></div>
```
Added inside `.voting-section` after `#cardContainer`.

**_Layout.cshtml — Other tab:**
Added "Keyboard Shortcuts" collapsible section with:
- Toggle checkbox `#kb-shortcuts-toggle`
- Inline cheatsheet for all shortcuts

**site.js — openSettingsModal:**
```javascript
if (typeof _populateRoomOtherSettings === 'function') _populateRoomOtherSettings();
```

**site.css:**
```css
.keyboard-legend { ... }    /* container */
.keyboard-legend kbd { ... } /* styled key chips */
```

---

## P2 — Emoji Reactions

### Root cause
No reaction mechanism existed. The plan called for a float-up emoji broadcast from the sender's participant badge.

### Files
- `Hubs/PokerHub.cs`
- `wwwroot/js/room.js`
- `Views/Room/Index.cshtml`
- `Views/Shared/_Layout.cshtml` (Other tab)
- `wwwroot/css/site.css`

### Changes

**PokerHub.cs — new method:**
```csharp
public async Task SendReaction(string emoji)
{
    if (string.IsNullOrWhiteSpace(emoji) || emoji.Length > 10) return;
    var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
    if (roomName == null) return;
    await Clients.Group(roomName).SendAsync("ReceiveReaction", Context.ConnectionId, emoji);
}
```
No server-side state — pure relay. Length guard prevents abuse.

**room.js — variables at top:**
```javascript
const REACTION_DEFAULT_PALETTE = ['👍','👏','🎉','😂','❤️','🔥','😮','💡'];
let _reactionPalette = [...REACTION_DEFAULT_PALETTE];
let _reactionEnabled = true;
let _reactionLastMs = 0;
const REACTION_RATE_LIMIT_MS = 2000;
```

**room.js — registerHandlers():**
```javascript
connection.on('ReceiveReaction', (senderCid, emoji) => {
    _reactionFloatFromBadge(senderCid, emoji);
});
```

**room.js — new functions:**
```javascript
loadReactionSettings()     // reads es_reactionEnabled + es_reactionPalette
saveReactionSettings()     // writes settings, calls initReactionPanel()
initReactionPanel()        // builds .reaction-btn buttons in #reactionPanel
castReaction(emoji)        // rate-limit check → connection.invoke('SendReaction', emoji)
_reactionFloatFromBadge(senderCid, emoji)
    // finds badge by [data-connection-id], creates .reaction-float div at badge position
```

**room.js — init block:**
Added `loadReactionSettings();` after `initVibePanel();`.

**Views/Room/Index.cshtml:**
```html
<div id="reactionPanel" class="reaction-panel" style="display:none;"></div>
```
Added inside `.voting-section` after keyboard legend.

**_Layout.cshtml — Other tab:**
Added "Emoji Reactions" collapsible section with:
- Toggle checkbox `#reaction-enabled-toggle`
- Text input `#reaction-palette-input` with `data-picker-target` (emoji picker auto-attaches)
- Description note

**site.css:**
```css
.reaction-panel { ... }    /* flex row container */
.reaction-btn { ... }      /* individual emoji button */
@keyframes reaction-float  /* float-up animation */
.reaction-float { ... }    /* fixed-positioned floating emoji */
```

---

## Summary

| Item | What was added | Key localStorage keys |
|------|---------------|----------------------|
| P1 | Keyboard legend below cards, C/Q/Minus aliases, toggle | `es_kbShortcuts` |
| P2 | Reaction bar + float animation, configurable palette, rate-limit | `es_reactionEnabled`, `es_reactionPalette` |

Server changes: `PokerHub.cs` gained `SendReaction` (1 method, ~8 lines, no state).
