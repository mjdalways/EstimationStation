# J — Mobile Experience

> **Priority:** Deferred  
> **Effort:** Medium-Hard  
> **Files:** `wwwroot/css/site.css`, `wwwroot/js/room.js`, `Views/Shared/_Layout.cshtml`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

> ⏸ **Status:** Deferred alongside Group AE (widget system) and Group K (persistence).

---

## J1 — Stories Bottom Sheet

On mobile (`innerWidth < 600`), stories panel slides up as a bottom sheet.

- Swipe down or tap overlay to dismiss
- Bottom sheet has a drag handle at the top
- Replaces the current sidebar stories panel on narrow screens

---

## J2 — Vote Card Tap Targets

- Minimum 52 px touch target on all vote cards
- 4-per-row grid on narrow screens (≤ 375 px)

---

## J3 — Lite Mode

Automatically suppress confetti, fireworks, slot machine on `innerWidth < 600`.

- Opt-in toggle in Settings → Visual: "Lite mode on mobile"
- Stored in `es_liteMode` (boolean)

---

## J4 — Input Modes

Add `inputmode` attributes on all text inputs for correct on-screen keyboard type.

Examples:
- `inputmode="numeric"` on vote value inputs
- `inputmode="url"` on URL inputs
- `inputmode="email"` on email inputs

---

## Test Breakpoints

- iPhone SE: 375 px
- Pixel 7: 412 px

---

## Verification

- [ ] Stories bottom sheet opens and closes on mobile
- [ ] Vote cards have at least 52 px touch target on small screens
- [ ] Lite mode suppresses heavy animations on narrow screens
- [ ] All text inputs show appropriate keyboard on mobile
- [ ] Desktop layout unaffected
- [ ] `dotnet build` → 0 errors
