# AE — Widget Panel System

> **Priority:** Deferred (with J and K)  
> **Effort:** Hard  
> **Files:** `wwwroot/js/room.js`, `wwwroot/css/site.css`, `Views/Room/Index.cshtml`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

> ⏸ **Status:** Deferred. AE1–AE9 shipped in v5. Remaining items (AE10 widget system, AE11 pending bugs) deferred alongside Group J and Group K.

---

## AE10 — Widget Panel System

> **Desktop only** — No drag/reorder on mobile (`innerWidth < 768`). Mobile layout unchanged.

- **AE10a — Draggable widgets:** Clock, Timer, Vibe Check, Keyboard Legend, Vote Cards, Participant Cards — each a moveable panel on desktop
- **AE10b — Drag-to-reorder:** drag panels to any position; layout persisted to `es_widgetLayout` localStorage
- **AE10c — Panel registry:** N widget slots; each knows its default position, content component, and visibility state
- **AE10d — Close/show toggles:** each widget has × close; restored via settings or right-click widget bar
- **AE10e — Mobile detection:** `window.innerWidth < 768` disables drag; panels revert to stacked layout

Implement with vanilla JS HTML5 Drag API; z-index management for bring-to-front.

---

## AE11 — Remaining Pending Bugs

> **AE11a** is the highest priority item — see [AE11a detail plan](./FEATURE-PLAN-6.0-AE11a.md).

| Item | Description | File |
|------|-------------|------|
| [AE11a](./FEATURE-PLAN-6.0-AE11a.md) | Memorial flag image support — `imageUrl` field type for `SEA_ANIM_META` | `seasonal.js` |
| AE11b | Count-up timer placeholder when no story is active — "no story active" tooltip or hint | `room.js` |
| AE11c | Clock checkbox layout — investigate visual clash when analog SVG renders in story bar | `_Layout.cshtml`, `site.css` |
| AE11d | Extended clock settings (font, 12h/24h, number style, bg colour) — moved to [Group AI](./FEATURE-PLAN-6.0-AI.md) | — |
| AE11e | Timer style settings — moved to [Group AK6](./FEATURE-PLAN-6.0-AK.md#ak6----count-up-timer-style-settings) | — |

---

## Verification (AE10)

- [ ] Panels drag freely on desktop; snapping/bounds clamped to viewport
- [ ] Widget positions persist across page reload via `es_widgetLayout`
- [ ] Close × on widget hides it; re-enable from settings restores to last position
- [ ] On mobile (`< 768 px`), drag is disabled and panels revert to stacked layout
- [ ] `dotnet build` → 0 errors
