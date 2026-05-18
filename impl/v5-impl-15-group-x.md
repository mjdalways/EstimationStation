# v5 Group X — Card Flip & Voting UX

**Date:** 2026-05-18  
**Items:** X1, X2  
**Files changed:** 4

---

## X1 — Flip Animation When a User Votes

### Root cause
When a participant cast their vote the badge re-rendered with `vote-hidden ✓` but no animation — the state change was invisible.

### Changes

**`wwwroot/js/room.js` — `VoteCast` handler:**

Refactored the `hasVoted && !wasVoted` block to do a single badge lookup shared between X1 and the existing `triggerCardBurst`:

```javascript
if (hasVoted && !wasVoted) {
    const badge = document.querySelector('[data-connection-id="' + connectionId + '"]');
    if (badge) {
        // X1: flip animation
        if (localStorage.getItem('es_flipOnVote') !== '0') {
            badge.classList.add('poker-flip');
            setTimeout(() => badge.classList.remove('poker-flip'), 500);
        }
        // card burst
        if (typeof triggerCardBurst === 'function') {
            const r = badge.getBoundingClientRect();
            triggerCardBurst(...);
        }
    }
}
```

Reuses existing `@keyframes poker-flip` (0.48 s) — no new CSS needed.

**`Views/Shared/_Layout.cshtml` — Visual tab, new "Voting Animations" section:**
- Toggle `#flip-on-vote-toggle` (`es_flipOnVote`, default on)

**`wwwroot/js/site.js` — `openSettingsModal()`:**
```javascript
var fovEl = document.getElementById('flip-on-vote-toggle');
if (fovEl) fovEl.checked = localStorage.getItem('es_flipOnVote') !== '0';
```

---

## X2 — Change Vote Hint on Hover

### Root cause
After voting, there was no visual affordance telling the local user they could hover their badge and select a new vote.

### Changes

**`wwwroot/js/room.js` — init block:**
```javascript
if (localStorage.getItem('es_changeVoteHint') !== '0') document.body.classList.add('show-change-hint');
```

**`wwwroot/css/site.css`:**
```css
.show-change-hint .participant-badge.voted.me { cursor: pointer; }
.show-change-hint .participant-badge.voted.me:not(.chicken-overlay):hover::after {
    content: '↩ Change';
    position: absolute; inset: 0; border-radius: inherit;
    background: rgba(0,0,0,0.45); color: #fff;
    font-size: 0.62rem; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 2;
}
```

The `.show-change-hint` body class acts as a CSS feature flag — no need to read localStorage in CSS.

**`Views/Shared/_Layout.cshtml` — Visual tab, Voting Animations section:**
- Toggle `#change-vote-hint-toggle` (`es_changeVoteHint`, default on)
- `onchange`: saves key + toggles `document.body.classList`

**`wwwroot/js/site.js` — `openSettingsModal()`:**
```javascript
var cvhEl = document.getElementById('change-vote-hint-toggle');
if (cvhEl) cvhEl.checked = localStorage.getItem('es_changeVoteHint') !== '0';
```

---

## Summary

| Item | Trigger | Mechanism | Key |
|------|---------|-----------|-----|
| X1 | `VoteCast` (first vote of round) | `poker-flip` CSS class on badge for 500 ms | `es_flipOnVote` |
| X2 | CSS hover on `.voted.me` | `show-change-hint` body class → `::after` overlay | `es_changeVoteHint` |

No server changes. Re-voting already works via the existing vote cards row.
