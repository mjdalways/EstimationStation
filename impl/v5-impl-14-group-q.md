# v5 Group Q — Sound & Notifications

**Date:** 2026-05-18  
**Items:** Q1, Q2  
**Files changed:** 3

---

## Q1 — Vote Cast Tick

### Root cause
No audio feedback existed when casting a vote.

### Changes

**`wwwroot/js/room.js` — `castVote()`:**
```javascript
if (selectedVote !== null) _qPlayVoteTick();  // Q1
```

**`wwwroot/js/room.js` — new function `_qPlayVoteTick()`:**
```javascript
function _qPlayVoteTick() {
    if (getAllSoundsOff && getAllSoundsOff()) return;
    if (localStorage.getItem('es_voteTick') !== '1') return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.09);
        osc.onended = function() { ctx.close(); };
    } catch(e) {}
}
```

Guards: master mute (`getAllSoundsOff()`), localStorage key `es_voteTick` must be `'1'`.

**`wwwroot/js/audio.js` — `populateAudioTab()`:**
```javascript
var vtEl = document.getElementById('vote-tick-enabled');
if (vtEl) vtEl.checked = localStorage.getItem('es_voteTick') === '1';
```

**`Views/Shared/_Layout.cshtml` — Audio tab, new section before `</div><!-- end tab-audio -->`:**
- Collapsible "🖱️ Vote Interaction" section
- Toggle `#vote-tick-enabled` — `onchange` saves `es_voteTick`

---

## Q2 — Desktop Notification on Reveal

### Root cause
No mechanism to alert a user in another tab when votes were revealed.

### Changes

**`wwwroot/js/room.js` — `VotesRevealed` handler, last line:**
```javascript
_qTryDesktopNotify(stats);  // Q2
```

**`wwwroot/js/room.js` — new functions:**
```javascript
async function _qRequestNotifyPermission(enabled) {
    if (!enabled) return;
    if (!('Notification' in window)) { alert('Your browser does not support desktop notifications.'); return; }
    if (Notification.permission !== 'granted') {
        var result = await Notification.requestPermission();
        if (result !== 'granted') {
            var el = document.getElementById('desktop-notify-enabled');
            if (el) { el.checked = false; localStorage.setItem('es_desktopNotify', '0'); }
        }
    }
}
window._qRequestNotifyPermission = _qRequestNotifyPermission;

function _qTryDesktopNotify(stats) {
    if (localStorage.getItem('es_desktopNotify') !== '1') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    var msg = (stats && stats.isConsensus) ? '🎉 Consensus!' : 'Votes revealed';
    if (stats && stats.average != null) msg += ' · Avg: ' + stats.average;
    new Notification('EstimationStation', { body: msg, icon: '/favicon.ico', tag: 'es-reveal' });
}
```

**`wwwroot/js/audio.js` — `populateAudioTab()`:**
```javascript
var dnEl = document.getElementById('desktop-notify-enabled');
if (dnEl) dnEl.checked = localStorage.getItem('es_desktopNotify') === '1';
```

**`Views/Shared/_Layout.cshtml` — Audio tab, new section:**
- Collapsible "🔔 Desktop Notifications" section
- Toggle `#desktop-notify-enabled` — `onchange` saves key + calls `_qRequestNotifyPermission(this.checked)`
- `tag: 'es-reveal'` deduplicates rapid reveal notifications

---

## Summary

| Item | Trigger | Guard | Key |
|------|---------|-------|-----|
| Q1 | `castVote()` when non-null | master mute + `es_voteTick === '1'` | `es_voteTick` |
| Q2 | `VotesRevealed` handler | `document.hidden` + Notification permission + `es_desktopNotify === '1'` | `es_desktopNotify` |

No server changes. No CSS changes.
