# AN — Terminology Rename: Events → Fun, Seasons → Events ✅ Done (v6 / 2026-06-04)

> **Priority:** 1 — Done
> **Effort:** Small
> **Files:** `Views/Shared/_Layout.cshtml`, `wwwroot/js/site.js`
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

---

## Goal

Rename two settings tabs (visible labels only — **keep element ids stable** to avoid churn):

| Today (label) | Element id | New label |
|---|---|---|
| 🎉 Events | `tab-celebration` | 🎉 **Fun** |
| 🗓️ Seasons | `tab-seasons` | 🗓️ **Events** |

The "Fun" tab keeps holding celebration animations (confetti, fireworks, reveal particles,
floor-is-lava, etc.). The "Events" tab keeps holding time-based effects, now framed as Events =
Seasons + Holidays. The internal "🌿 Seasons" sub-heading and "Seasonal Theme" master toggle stay
(seasons remain a sub-category of Events).

---

## Scope (user-facing UI only — NOT changelog history or element ids)

- `_Layout.cshtml:133` tab button label `Events` → `Fun`
- `_Layout.cshtml:139` tab button label `Seasons` → `Events`
- `_Layout.cshtml:447` theme-editor section header `🎉 Events` (celebration colours) → `🎉 Fun`
- `site.js:218` settings-search tab map label `🎉 Events` → `🎉 Fun`
- `site.js:220` settings-search tab map label `🗓️ Seasons` → `🗓️ Events`
- Light comment touch-ups for maintainability (`_Layout.cshtml:96`, `444`, `1116`).

**Do not** rewrite historical What's New / changelog entries (they record what shipped under the
old names), and **do not** change `id="tab-celebration"` / `id="tab-seasons"`, the
`tabResetDefaults('tab-...')` / `tabAllOn('tab-...')` calls, or localStorage keys.

---

## Verification

- [ ] Settings tabs read **Fun** and **Events**
- [ ] Settings search highlights the right tab with the new labels
- [ ] Theme editor's celebration colour section reads **Fun**
- [ ] `dotnet build` → 0 errors
