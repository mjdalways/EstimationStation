# AM — Fully-Customizable Event System

> **Priority:** 3
> **Effort:** Hard
> **Files:** `wwwroot/js/seasonal.js`, `Views/Shared/_Layout.cshtml`, `wwwroot/js/site.js`
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)
> **Approach (confirmed):** extend the existing system, do **not** rewrite from scratch.

---

## Vision (from user)

A fully user-customizable **Event** system (the renamed "Seasons" tab — see [AN](./FEATURE-PLAN-6.0-AN.md)):

1. **No "custom" type.** Drop the special-cased `custom` notion. What makes an event/animation
   custom is simply the **function/action name** it points at — every event references a named
   action, built-in or user-defined, uniformly.
2. **Add new events.** Users can create new events (name, active date range / trigger, set of
   animations).
3. **Add / remove / change animations.** Per event, add animations, remove them, or edit their
   parameters (action name, emoji, direction, size, speed, intensity, flag, …).
4. **Save / load.** Persist the whole configuration (already partly covered by Export/Import JSON);
   extend to cover user-created events + animations.
5. **Reset to default.** Restore the shipped defaults at any time.
6. **Override, don't delete, defaults.** Built-in/static events & animations are never destroyed.
   Instead users can **disable/override** them; a reset re-enables the originals.

---

## Current architecture (what we build on)

- `SEA_ANIM_META` — map of animation fn-name → meta (type: runner/particles/popup, emoji, dir, size,
  dur, flag, enabled, …).
- `_seaGetAnimCfg(fnName, seasonKey)` — merges meta defaults with localStorage overrides.
- Seasons defined as keys with date ranges + lists of animation fn-names; per-animation ⚙️ config,
  per-animation enable/disable, Export/Import JSON, frequency sliders already exist.

So "events" ≈ today's seasons/holidays, and "animations" ≈ today's `SEA_ANIM_META` entries. The gap
is: there's no UI/data path to **create** events or animations, only to toggle/tweak the built-ins.

---

## Proposed data model (extend, layered over built-ins)

```
es_eventConfig = {
  events: {
    <eventKey>: {
      name, icon, dateRange|trigger,
      builtin: true|false,
      disabled: true|false,            // override-not-delete for builtins
      animations: [ <animId>, ... ]    // ordering + membership (overrides builtin list)
    }, ...
  },
  animations: {
    <animId>: {
      name, action,                    // action = function/action name (built-in or registered)
      builtin: true|false,
      disabled: true|false,
      params: { emoji, dir, size, dur, flagCode, count, ... }
    }, ...
  }
}
```

- **Effective config = built-in defaults deep-merged with `es_eventConfig`.** Builtins always exist
  in the merge base; a user entry with the same key overrides/extends, `disabled:true` hides it,
  and **Reset** clears `es_eventConfig` so only builtins remain.
- An **action registry**: `{ name -> fn }` of the runner/particle/popup executors. User animations
  pick an action by name from this registry (this is the "function/action name is what makes it
  custom" requirement).

---

## Suggested incremental milestones (each its own small patch)

1. **AM1** — Introduce the action registry + refactor existing animations to resolve their executor
   by `action` name (no behaviour change). ✅ **Done (v6 / 2026-06-04)**
   - ✅ **AM1a (infra + reference slice, done):** `SEA_ACTIONS` registry, `_seaRegisterAction`,
     `_seaActionFor` (resolves `meta.action || meta.type`), and `_seaInvokeAction` dispatcher (single
     execution chokepoint; falls back to the animation's own global fn for not-yet-registered
     bespoke "custom" animations so behaviour is unchanged). Generic executors runner/particles/
     popup/corner registered. **presidentsday** (`_seaPresParade`/`_seaPresStars`/`_seaPresPopup`)
     converted as the reference pattern and verified (registry-routed firing identical to before).
   - ✅ **AM1b (done):** PowerShell regex converted all 156 generic call-sites (40 runners + 116
     others) to `_seaInvokeAction`. Verified via grep — only executor definitions and registrations
     remain using the direct names.
   - ✅ **AM1c (done):** 53 bespoke animations registered under their own action names via an IIFE
     after all function definitions. Each `type:'custom'` meta entry gains `action:'_seaFnName'`
     so `_seaActionFor` resolves through the registry (not returning the string `'custom'`).
     `_seaInvokeAction` fallback retained for safety. Registry total: **57 actions** (4 generic
     + 53 bespoke). Verified: generic/bespoke/fallback all fire correctly in browser.
2. **AM2** — Effective-config merge layer (`es_eventConfig` over builtins) with `disabled` override
   + Reset-to-default; wire existing toggles through it. ✅ **Done (v6 / 2026-06-04)**
   - `_seaGetEventConfig`/`_seaSaveEventConfig`/`_seaResetEventConfig` storage helpers.
   - `_seaIsEventDisabled(key)` / `_seaIsAnimDisabled(fnName)` per-layer disabled checks.
   - `_seaGetEffectiveAnims(eventKey)` — built-ins filtered by animation-level disabled flag (user additions appended in AM3).
   - `_seaGetEffectiveAnimMeta(fnName)` — built-in meta merged with `es_eventConfig.animations[fn].params`.
   - `_seaGetAnimCfg` now flows through `_seaGetEffectiveAnimMeta` so user param overrides apply.
   - `_seaFire`, `_seaGetSeason`, `openSeasonConfig`, `saveSeasonConfig` all wired to respect event/animation disabled flags.
   - Verified: disable animation → removed from effective list; disable event → `_seaGetSeason` skips it; reset → full built-in list restored; param override flows through `_seaGetAnimCfg`.
3. **AM3** — UI: edit an animation's `action` + params; add/remove animations within an event. ✅ **Done (v6 / 2026-06-04)**
   - Each animation row gains an **Action** picker (all 57 registered action names).
   - Built-in rows have a **🚫 Disable** button (persisted; reset restores).
   - User-added rows have an **✕ Remove** button + editable name field + "custom" badge.
   - **+ Add animation** button at the bottom of each event config panel.
   - `_seaDisableBuiltinAnim`, `_seaRemoveUserAnim`, `_seaAddAnimToEvent` functions.
   - `saveSeasonConfig` persists action override to `es_eventConfig` for built-ins; saves name/action/enabled for user-added.
   - `_seaGetEffectiveAnims` appends user-added animations (from `es_eventConfig`) after built-ins.
   - `_seaGetEffectiveAnimMeta` and `_seaActionFor` handle user-added animations with no `SEA_ANIM_META` entry.
   - Verified in browser: action picker (57 options), disable/re-enable/add/remove all work correctly.
4. **AM4** — UI: add/rename/remove (disable) events. ✅ **Done (v6 / 2026-06-04)**
   - `#sea-user-events` container injected into Events tab; populated by `_seaRenderUserEvents`.
   - Each built-in `.sea-row` gets a **🚫 Disable** button (persists to `es_eventConfig`; re-enable shown in the user panel).
   - **+ Add event** button creates a user event with a name + M1/D1/M2/D2 date-range fields; registered immediately in `SEA_ANIMS` and `SEA_EVENT_TABLE`.
   - User event rows have **💾 Save**, **⚙️** (open animation config), **✕ Remove** buttons.
   - `_seaAddEvent`, `_seaSaveUserEvent`, `_seaRemoveUserEvent`, `_seaReEnableEvent`, `_seaApplyUserEventsTables` functions.
   - `_seaApplyUserEventsTables` called on page load to restore persisted user events.
   - `es_eventConfig` included in Export/Import so user events round-trip across browsers.
   - Verified: add/remove/disable/re-enable all work; user event appears in `SEA_ANIMS` and `SEA_EVENT_TABLE`.
5. **AM5** — Save/Load whole config (extend Export/Import) + final polish.

(Confirm milestone breakdown before starting AM1.)

---

## Verification (high level)

- [ ] No `custom`-type special-casing remains; everything resolves via action name
- [ ] Can add a new event and a new animation, see them run, persist across reload
- [ ] Disabling a built-in hides it but Reset brings it back (never destroyed)
- [ ] Save/Load round-trips the full config
- [ ] `dotnet build` → 0 errors
