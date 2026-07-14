# Feature 8 — Kumospace Movement & Seating Consistency (Implementation Spec)

> Authored by Claude (Fable 5), 2026-07-08, from a full review of the sit/stand/walk/interact
> state machine in `wwwroot/js/room-scene-3d.js`. Policy decisions confirmed by the project
> owner on 2026-07-08: **release seat on move** (any movement stands you up and frees the
> chair); **auto-stand on movement keys** while seated in 2D; **walk-then-sit** on
> double-clicking an empty chair; walk mode (T) **starts at my avatar**, not the camera.

---

## How to use this document (instructions to the implementing AI)

1. **One patch per session/review cycle.** Implement exactly one patch, verify its acceptance
   criteria, then STOP for human review. Do not start the next patch unsolicited.
2. **Stay inside the patch boundary.** Changes are Kumospace/room-scene functionality only.
3. **Project conventions (mandatory):**
   - After every shipped patch, add a dated entry to the **What's New** changelog in
     `Views/Shared/_Layout.cshtml` (newest on top, `M/D/YYYY (N)` counter continues) and mark
     the patch ✅ DONE in this file.
   - **Restart `dotnet run` after editing any `wwwroot/js` file** — `asp-append-version`
     serves immutable-cached assets.

---

## Review findings (2026-07-08)

| # | Finding | Severity |
|---|---------|----------|
| F1 | E-sit in walk mode never exits walk mode; `_updateWalk` keeps broadcasting `pose:'walk'` every 100 ms, which recreates the local roamer after `applyClaim` cleared it and overwrites the server's cleared pose. User ends up with a claimed chair, a first-person camera still walking, and (after exiting walk) a stuck roamer walking-in-place for everyone incl. late joiners. | High |
| F2 | When click-to-walk completes (`_updateRoamers`) or 2D arrow-steer stops (`_updateTopSteer`), `'idle'` is sent **only to the server** — the local roamer's `pose` stays `'walk'`, so your own avatar marches in place forever after stopping. | High |
| F3 | Seat-claim policy incoherent: 3D walk / click-to-walk keep your claim while roaming (chair looks taken, auto-sit skips it, E on it says "stand up" and releases instead of re-seating), but 2D arrows demand Space-first release. Within 2D, floor-click works while seated but arrows don't. | High (UX) |
| F4 | Standing up teleports the avatar: `releaseMySeat` spawns no roamer, so you jump to the "standing row" at the front wall; the first arrow key then re-teleports you to the room-default spot (`_myStartPos` fallback). | Med (UX) |
| F5 | `_enterWalk` spawns your avatar at the (clamped) orbit-camera position — a visible teleport for everyone, and it ignores where your avatar actually is. | Med (UX) |
| F6 | Double-clicking an empty chair teleports you into it; walking near one glides + auto-sits. Two different metaphors for the same action. | Low (UX) |
| F7 | Collision parity: walk mode (`_walkCollidesAt`) ignores furniture/props, while 2D steer & click-to-walk (`_routeBlockedAt`) collide with them — you can walk through a sofa in 3D but not in 2D. | Low |
| F8 | Auto-sit radius is 0.5 m — if a stand-up spot were placed closer than that to the freed chair you'd instantly re-sit (constraint on P2, not a live bug today). | Note |

## Patch Plan

| Patch | Fixes | Risk |
|-------|-------|------|
| P1 | F1 + F2 — pose hygiene on stop; E-sit exits walk mode | Low |
| P2 | F3 + F4 (+F8 constraint) — release-on-move policy; stand-beside-chair; auto-stand on arrows | Medium |
| P3 | F5 — walk mode starts at my avatar | Low |
| P4 | F6 — double-click empty chair walks there, then sits | Medium |
| P5 | F7 — walk-mode collision includes furniture/props | Low |

---

## P1 — Movement-stop pose hygiene + E-sit exits walk mode ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml` (What's New)
**Do NOT:** change the seat-claim policy (that's P2), touch broadcast throttling or the server hub.

1. `_updateRoamers` click-to-walk completion branch (`_walkToActive`, path exhausted): in
   addition to the `RoomSceneNet.avatarMove(..., 'idle')` server send, call
   `applyAvatarMove(my, me.tx, me.tz, me.tyaw, 'idle')` so the local pose flips to idle.
2. `_updateTopSteer`: both stop paths (seated early-return with `_topSteerActive`, and the
   no-keys-held path) get the same local `applyAvatarMove(..., 'idle')` alongside the
   existing server send.
3. `_walkInteract` `case 'chair'`, sit branch (`!claim`): call `_exitWalk()` **before**
   `_pendingChairIdx = r.idx; _confirmClaim();`. Exiting first stops the 100 ms `'walk'`
   broadcasts so the subsequent `applyClaim` → `clearRoamer` + `AvatarStop` sticks.

**Acceptance:**
- 2D: click floor → avatar glides, and on arrival the leg animation **stops** (was: marches in place). Arrow-steer then release keys → same.
- 3D walk mode: walk to an empty chair, press E → walk mode exits (orbit camera, toolbar restored), you are seated; a second browser sees you seated, not a walking ghost; a late joiner does not see a stuck roamer.
- What's New entry added; this patch marked ✅ DONE here.

---

## P2 — "Release on move" seat policy + stand beside your chair ✅ DONE

> Implementation notes (2026-07-08): `_standUpFromChair()` also clears `_myChairIdx`
> optimistically after `releaseMySeat()` so per-tick callers don't re-trigger while the
> ChairReleased echo is in flight. Known minor: when seated + click-to-walk, the
> stand-up 'idle' broadcast can rate-limit-drop the immediately following 'walk'
> broadcast (hub 40 ms limit) — peers may see the glide start a waypoint late.

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** change the server hub (ReleaseChair/ClaimChair already suffice), alter auto-sit thresholds.

1. New helper `_standUpFromChair()` (no-op when `_myChairIdx === null`):
   - Compute the chair's world position (same `_chairPos[idx] || _seatPositions()` lookup as
     `_myStartPos`), pick a free spot **≥ 0.8 m** from the chair centre (try the direction away
     from the table first, then ± 45°/90°/135°/180°, testing with `_routeBlockedAt`;
     F8: must stay > 0.5 m so auto-sit can't instantly re-seat).
   - Spawn my roamer there: `applyAvatarMove(_myCid(), x, z, yawFacingTable, 'idle')` locally
     + `RoomSceneNet.avatarMove(...)`; set `_iAmRoaming = true`; then `releaseMySeat()`.
2. Route every "I start moving" entry point through it when seated: `_enterWalk` (spawn walk
   at the stand-up spot), `_startWalkTo` (start the route from it), `_updateTopSteer` (begin
   steering from it). Also use it for the explicit stand-ups (Space in 2D, double-click own
   chair/robot, E on own chair) so standing never teleports to the standing row.
3. 2D arrows while seated: remove the "Press Space to stand up first" toast/guard in
   `_onKeyDown` — movement keys now auto-stand (Space keeps working as explicit stand-up).
4. Sanity-check the now-unreachable "own claimed chair while roaming" branches (E label
   'stand up', double-click own chair while roaming) still behave harmlessly.

**Acceptance:** stand up via Space/double-click/E → avatar appears standing beside the chair
in 2D, 3D, and a second browser (no standing-row teleport, no instant auto-re-sit); the freed
chair glows claimable for others; arrows while seated in 2D stand you up and move immediately;
entering walk mode or click-to-walking while seated frees your chair. What's New entry added.

---

## P3 — Walk mode starts at my avatar ✅ DONE

> Implementation notes (2026-07-08): went one step further than `_myStartPos()` — the
> unseated/non-roaming case starts at my standing-row robot (`_robotMap['stand_'+cid]
> .standingRobotPos`) rather than the room-default spot, since that's where everyone
> currently sees my avatar. Camera position remains only as the no-avatar fallback,
> and the `_walkCollidesAt` push-out now runs AFTER start-spot selection (covers a
> table dragged onto an idle roamer).

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** change walk controls/camera behaviour once walking.

1. `_enterWalk`: replace the camera-position spawn with `_myStartPos()` (roamer position, else
   stand-up spot beside my chair via P2's helper, else room default). Convert the returned
   roamer yaw to camera yaw with `_walkYawToRoamer` (self-inverse) so you face the way your
   avatar was facing. Keep the `_walkCollidesAt` push-out fallback.

**Acceptance:** roaming somewhere then pressing T → first-person starts exactly there (second
browser sees no jump); seated then T → starts beside your chair (chair freed per P2); no
regression entering walk from a fresh join. What's New entry added.

---

## P4 — Double-click an empty chair: walk there, then sit ✅ DONE

> Implementation notes (2026-07-08): the walk aims at the chair position itself, not a
> point 0.45 m in front of it — the offset point sits inside the table's collision
> margin (chair ring is 0.72 m from the table edge, margin is 0.45 m), so A* would
> reroute it anyway; aiming at the chair lands the exact-point path segment on the
> spot the seated robot occupies. Also: sitting is instant when already within 0.9 m
> of the chair; a stale-claimed chair behaves like an empty one (matches the
> double-click filter); `applyClaim` for a foreign claim also clears a stale pending
> glow (pre-existing quirk).

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** change walk-mode E-sit (already proximity-gated), break claim race handling.

1. In `_onCanvasClick`'s empty-chair double-click branch: instead of claiming immediately, set
   `_pendingChairIdx = idx` (green pending glow) and `_startWalkTo()` a point ~0.45 m in front
   of the chair; remember the target idx (e.g. `_walkToSitIdx`).
2. On click-to-walk completion with `_walkToSitIdx` set (and chair still unclaimed):
   `_confirmClaim()` it. If it was claimed meanwhile (`ChairClaimed` by someone else, or
   `claimFailed`), clear `_walkToSitIdx` + pending glow and just stop there. Any new movement
   input also cancels `_walkToSitIdx`.
3. When the click-to-walk toggle is OFF, keep today's instant sit (double-click still claims
   directly — movement was explicitly disabled).

**Acceptance:** double-click a far empty chair in 2D and 3D orbit → avatar routes around
obstacles, sits on arrival; target chair shows pending glow during the walk; losing the race
mid-walk leaves you standing near the chair with a toast; click-to-walk OFF → instant sit as
before. What's New entry added.

---

## P5 — Collision parity: walk mode collides with furniture/props ✅ DONE

> Implementation notes (2026-07-08): inverted the plan's structure — the furniture/prop
> circles moved INTO `_walkCollidesAt` (with the held-item exemption and a reused
> scratch Vector3 for prop world positions) and `_routeBlockedAt` now just delegates,
> so walk mode and A* routing share one obstacle set by construction. Added a
> stuck-inside escape to both `_updateWalk` and `_updateTopSteer`: if the CURRENT
> position already overlaps an obstacle (furniture dragged onto a standing avatar),
> movement is allowed (room-bounds clamped) so the avatar can walk back out.

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** change the A* routing obstacles (already correct), slow down `_updateWalk` (it runs per frame — keep the checks cheap circle tests).

1. `_walkCollidesAt(nx, nz)`: after the wall/table tests, apply the same circle tests
   `_routeBlockedAt` uses for `_furnitureObjs` (r≈0.55) and `_props` (r≈0.5) — but **skip the
   item currently held** (`_walk && _walk.held === f.id`), otherwise carrying furniture jams
   movement.

**Acceptance:** in 3D walk mode you slide around a sofa/bookshelf instead of clipping through;
picking up and carrying furniture still moves freely; 2D steer behaviour unchanged.
What's New entry added.
