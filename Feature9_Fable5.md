# Feature 9 — Room-Scene Interaction & Resilience Fixes (Implementation Spec)

> Authored by Claude (Fable 5), 2026-07-13, from a live three-browser user test of the
> current build (Edge tabs "Bob"/"Carol"/"Dave" in room `fabletest`, driving the real UI
> and logging outgoing `RoomSceneNet` traffic). Feature 8 (P1–P5) itself verified
> correctly — pose hygiene, release-on-move, walk-starts-at-avatar, and collision all
> pass. The bugs below are what remains between "the mechanics work" and "a new user can
> actually use the room".

---

## How to use this document (instructions to the implementing developer/AI)

1. **One patch per session/review cycle.** Implement exactly one patch, verify its
   acceptance criteria, then STOP for human review. Do not start the next patch
   unsolicited.
2. **Patches are ordered by user impact.** Do them in order (P1 first) unless told
   otherwise. P1 and P2 both unblock "sitting down"; everything else is independent.
3. **Project conventions (mandatory):**
   - After every shipped patch, add a dated entry to the **What's New** changelog in
     `Views/Shared/_Layout.cshtml` (newest on top, `M/D/YYYY (N)` counter continues) and
     mark the patch ✅ DONE in this file.
   - **Restart `dotnet run` after editing any `wwwroot/js` file** — `asp-append-version`
     serves immutable-cached assets, so a stale bundle will silently hide your change.
4. **Line numbers** refer to the 2026-07-13 state of `wwwroot/js/room-scene-3d.js`
   (5,230 lines) and `wwwroot/js/room.js` (4,477 lines). They will drift as patches land —
   the function names are the real anchors.
5. **Multi-browser verification is not optional.** Every acceptance section says "second
   browser"; use two real browser windows/tabs joined to the same room (Appendix A has
   the exact tooling recipe used to find these bugs).

---

## Findings from the 2026-07-13 test (what each patch fixes)

| # | Finding | Severity | Patch |
|---|---------|----------|-------|
| F1 | After the first successful sit, double-clicking a chair never sits again — the furniture-move layer wins and the user is left with a "chair — drag to move" toolbar. In 3D it fails from every distance; in 2D an adjacent chair fails and a distant one sits *while also* opening the move toolbar (conflicting dual action). Net effect: **no reliable way to sit**. | High | P1 (+P10) |
| F2 | Walk-mode `E` never sits either, even standing right beside a free chair — the chair candidate requires a ±40° facing cone that users can't discover, and no "Press E" prompt appeared in the test. With F1 this closes off every sit path in 3D. | High | P2 |
| F3 | When the server bounced mid-session, every open tab kept a normal-looking but dead UI: no banner, vote clicks silently did nothing (`ClaimChair failed … not in the 'Connected' State` only in the console), SignalR retried 4× (default policy), gave up, and the stale roster stayed on screen indefinitely. | High | P3 |
| F4 | Holding a movement key **into** an obstacle (e.g. straight into the table edge) broadcasts `pose:'walk'` at a frozen position ~10×/second — every other browser renders that user marching in place. Separately, standing perfectly still in walk mode also broadcasts `walk` at ~9–10 msg/s (measured). | Medium | P4 |
| F5 | Exiting walk mode near a wall/corner leaves the orbit camera buried inside geometry — the whole scene renders black (only CSS2D nameplates visible) and orbit-dragging does not recover. The 3rd-person walk camera also backs into walls (screen goes dark). Recovery (2D↔3D toggle) is undiscoverable. | Medium | P5 |
| F6 | In 2D top-down mode no avatar **bodies** render at all — every participant (including yourself) is a floating name chip over empty floor. Chairs/furniture render fine. Feature 8's own P1 acceptance references visible leg animation in 2D. | Medium | P6 |
| F7 | Walk mode exits on events the user didn't ask for (a plain non-drag click / focus loss) with zero feedback, contradicting the on-screen "Esc to exit" hint. Also `Escape` failed to close the selection toolbar in the test even though `_onKeyDown` line 2094 handles it. | Low-Med | P7 |
| F8 | `Error loading video: MediaError` fires at room-scene-3d.js:626 on **every** page load of a default room (no custom media configured), plus a user-facing toast path exists that would show "This browser can't play this video format." for a room the user never customised. | Low | P8 |
| F9 | Polish cluster: outlier "battle" overlay lingers on WINNER! on every other participant's screen until each person dismisses it; standing-row avatars transiently occupy different spots in different browsers after a claim; host's first-join shows two stacked modals (sound prefs + settings lock) at once. | Low | P9 |

Non-bugs confirmed during the same test (do **not** "fix" these): click-to-walk A*
routing, stand-beside-chair spawn, walk-exit idle broadcast, late-joiner seated state,
wall slide collision, the whole vote/reveal/battle/accept flow, keyboard voting,
Fibonacci deck shortcuts.

---

## P1 — Make sitting reliable: chair clicks must win over selection & avatar hits ✅ DONE 2026-07-13

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml` (What's New)
**Functions:** `_onCanvasClick` (4486), `_onPointerUp` chair branch (1995–2009),
`_armDoubleClick` (4463), `_selectItem` (2892), `_sitOrWalkToChair` (3816)

### Mechanism (read this before coding)

Two independent layers respond to a chair click today:

1. **Pointer layer** (`_onPointerDown` 1863 → `_onPointerUp` 1982): every no-move press
   on a chair calls `_selectItem('chair', idx)` (line 2007) — that opens the green ring +
   "chair — drag to move" bar *on the first click of every double-click*.
2. **Click layer** (`_onCanvasClick` 4486): a manual double-click arbiter
   (`_armDoubleClick`, 350 ms window) turns the second click into
   `_sitOrWalkToChair(idx)` — **but only if the click survives to line 4557**. Several
   earlier branches `return` and eat the click. The prime suspect from the test: the
   **foreign-avatar branch (4500–4516)** — if the ray grazes *any other participant's
   robot* on its way to the chair, the function returns after showing a "🤖 name" tip.
   Standing-row robots cluster right beside the front chairs, so in a populated room most
   chair clicks from a normal 3D camera angle pass through someone's robot. The 2D
   top-down camera looks straight down (robots don't screen chairs), which is exactly why
   distant-chair double-clicks still worked in 2D but not 3D during the test.

### Step 0 — confirm the eater (30 min, throwaway logging)

Add one `console.log` to every consuming branch of `_onCanvasClick` (avatar 4514,
whiteboard 4520, prop 4529, screen 4536, table 4539, chair-mine 4551, host-occupied 4585)
plus one at the chair-hit success (4571). Reproduce: two users; user A stands beside a
free chair; user B double-clicks that chair from a normal orbit angle. Record which
branch fires. Keep the logs until acceptance passes, then delete them. If the eater turns
out to be a branch other than the avatar one, fix that branch with the same "chair wins"
rule below and note it in this file.

**Step 0 finding (2026-07-13):** in this room's default layout, the front chairs sit close
enough to the table that `_tableGroup`'s recursive raycast hit (line ~4578) ate the click
*before* it ever reached the chair-hit block — no avatar involved. Applied the same
chair-wins rule there: `if (_tableGroup && !chairHits.length && _raycaster.intersectObject(...))`
only lets the table absorb the click when there's no unclaimed-chair hit underneath it.

### Implementation

1. **Chair wins over foreign avatars.** In `_onCanvasClick`, perform the unclaimed-chair
   raycast (the `testMeshes` block, 4557–4561) **before** the avatar block, or pass the
   chair hits into it. New rule for the foreign-avatar branch: only consume the click
   (`return`) when there is **no unclaimed-chair hit**, or the avatar hit is closer to the
   camera by more than 0.6 world units than the nearest chair hit. Otherwise fall through
   so the chair arbiter runs. Keep the hover tip call — showing "🤖 Alice" while the click
   still reaches the chair is fine.
2. **Kill the dual action (sit + move-toolbar).** In `_onPointerUp`'s chair no-move branch
   (2007), don't select immediately. Defer it:
   ```js
   // was: _selectItem('chair', cd.idx);
   _deferChairSelect(cd.idx);
   ```
   with, next to `_armDoubleClick`:
   ```js
   var _chairSelTimer = null;
   function _deferChairSelect(idx) {
       clearTimeout(_chairSelTimer);
       _chairSelTimer = setTimeout(function () {
           // Only select if the double-click arbiter did NOT consume a second click
           // meanwhile (sitting/standing cancels the pending select, see step 3).
           _selectItem('chair', idx);
       }, DBLCLICK_MS + 30);
   }
   function _cancelChairSelect() { clearTimeout(_chairSelTimer); _chairSelTimer = null; }
   ```
   Single click still selects (after a 380 ms pause — imperceptible for a deliberate
   "grab the chair" action); a completed double-click never flashes the toolbar.
3. Call `_cancelChairSelect()` at the top of `_sitOrWalkToChair` (3816), in
   `_standUpFromChair` (3701), and in `_deselectAll` (2915).
4. **Same deferral for the table/decor/furniture no-move selects** (lines 2026 and 2037)
   is NOT required — only chairs have a competing double-click action. Leave them.
5. While `_walkToSitIdx` is pending (walking over to sit, P4 of Feature 8), a stray
   single-click on the target chair must not open the toolbar either — `_cancelWalkToSit`
   (3807) should also `_cancelChairSelect()`.

**Do NOT:** change `DBLCLICK_MS`, the pending-glow logic, `_confirmClaim`, the server
hub, or the host double-click-to-free flow (4577–4587). Do not remove the foreign-avatar
tooltip behaviour for clicks that hit only a robot.

> **P10 interplay (approved 2026-07-13):** P10 later gates all layout editing behind an
> explicit Edit-layout mode and **removes** this patch's `_deferChairSelect` machinery
> (its step 6). Implement the deferral here anyway — P1 ships first and fixes the live
> bug on its own; keep the deferral logic small and self-contained so P10 can delete it
> cleanly. P1's step 1 (chair-wins-over-avatar) is permanent and untouched by P10.

### Acceptance
- Two browsers, three users, several standing avatars crowding the front chairs. From a
  default orbit angle, double-click a free chair **behind another user's robot**: you walk
  over (or sit instantly if близко) and claim it. Repeat 10×, both 2D and 3D, near and
  far — 10/10 sits, zero "chair — drag to move" toolbars during double-clicks.
- Single slow click on a chair still opens the move/rotate toolbar after ~0.4 s; drag
  still repositions; Done closes it.
- Second browser sees each sit normally (seated robot, freed standing row).
- What's New entry added; this patch marked ✅ DONE here.

---

## P2 — Walk-mode `E` must sit you on the chair you're standing at ✅ DONE 2026-07-13

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Functions:** `_resolveInteractable` (2694), `_findInteractTarget` (2761),
`_updateInteractLabel` (2779), `_walkInteract` (2733)

### Mechanism

`_resolveInteractable` requires every candidate — chairs included — to sit inside a ±0.7
rad (~40°) cone around `_walk.yaw` (line 2726) at ≤1.9 m (line 2710). Users sidle up
*next to* chairs; the chair ends up out-of-cone, `E` resolves to `null`, and no prompt
ever teaches them to face it. In the live test `E` never produced a claim from any of
three positions beside/facing chairs, and the "Press E" label never appeared.

### Implementation

1. In `_resolveInteractable`, special-case chairs: an **unclaimed** chair within **1.2 m**
   qualifies regardless of facing; keep the cone rule for chairs between 1.2–1.9 m and for
   every other kind (whiteboard/prop/furniture, which are aim-at things). Implement by
   tagging chair candidates `nearOk: true` when `dist <= 1.2` and skipping the bearing
   check for those.
2. Prefer the nearest qualifying chair over other kinds at equal distance (chairs are the
   most common intent). Sorting by `dist` already does this in practice — just confirm.
3. Verify the prompt pipeline actually renders in third-person: `_updateWalk` calls
   `_updateInteractLabel(_findInteractTarget())` every 0.2 s (2681–2685). With step 1 the
   label should now show `E sit` whenever you stop beside a free chair. If it still
   doesn't render, check that `CSS2DObject` is non-null at that point and that the label
   isn't spawning behind the 3rd-person camera (`fx/fz` are avatar-forward — fine).
4. `_walkInteract`'s chair case already exits walk mode before claiming (2747–2751,
   Feature 8 P1) — do not touch it.

**Do NOT:** widen ranges for props/furniture, change `_exitWalk`, or auto-sit on plain
proximity (auto-sit already exists for click-to-walk arrivals; `E` is the deliberate
action).

### Acceptance
- Walk mode, approach a free chair from behind/side, stop within ~1 m *without turning to
  face it*: floating `E sit` prompt appears; pressing `E` exits walk and seats you; second
  browser sees you seated, no walking ghost (F1 regression check).
- `E` on your own claimed chair while roaming beside it still says/does "stand up".
- Whiteboard/prop `E` behaviour unchanged (still requires roughly facing them).
- What's New + ✅ DONE.

---

## P3 — Connection loss must be visible, and reconnect must not give up ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

**Files:** `wwwroot/js/room.js` (primary), `wwwroot/css/…` (one banner style),
`Views/Shared/_Layout.cshtml` (What's New)
**Functions/lines:** `initSignalR` (141–155), `onreconnected` (622–627), plus a new
`onreconnecting`/`onclose` pair

### Mechanism

`new signalR.HubConnectionBuilder().withUrl('/pokerhub').withAutomaticReconnect()` (line
142–145) uses the default retry schedule **[0 s, 2 s, 10 s, 30 s] and then closes
permanently**. Nothing subscribes to `onreconnecting` or `onclose`, so the UI shows
nothing at any stage. `onreconnected` (622) correctly re-invokes `JoinRoom` — the missing
pieces are policy + surfacing. Verified in test: after a server bounce >40 s, all tabs
became permanent zombies with normal-looking UI.

### Implementation

1. **Retry forever with backoff.** Replace `.withAutomaticReconnect()` with:
   ```js
   .withAutomaticReconnect({
       nextRetryDelayInMilliseconds: function (ctx) {
           // 0s, 2s, 5s, 10s, then every 15s forever (never return null = never give up)
           var steps = [0, 2000, 5000, 10000];
           return ctx.previousRetryCount < steps.length ? steps[ctx.previousRetryCount] : 15000;
       }
   })
   ```
2. **Connection banner.** Add a fixed top-of-page banner element (create it from JS so no
   view change is needed; id `conn-banner`), three states:
   - `onreconnecting(err)` → show amber: `⚠ Connection lost — reconnecting…` and set
     `document.body.classList.add('conn-lost')`.
   - `onreconnected` → after the existing `JoinRoom` invoke resolves, show green
     `✓ Reconnected` for 3 s then hide; remove `conn-lost`.
   - `onclose` → red persistent: `✖ Disconnected — <button reload>Reload</button>`
     (with retry-forever this only fires if `connection.stop()` is called or the retry
     callback ever returns null, but wire it anyway).
   Also show the amber state immediately if the **initial** `connection.start()` throws
   (wrap 149–155's catch), retrying `start()` on a 5 s timer until it succeeds.
3. **Fail loudly, not silently.** Every user-triggered `connection.invoke`/`send` path
   (vote cast, reveal, chair claim/release, avatarMove wrapper, chat) should no-op with a
   single toast `Not connected — action not sent` when
   `connection.state !== signalR.HubConnectionState.Connected`. Do it centrally: wrap the
   invoke helpers in `room.js` (`RoomSceneNet.claimChair` etc. all funnel through
   `connection.invoke` — add one guard function `_ifConnected(fn)` rather than 20 copies).
   The scene already handles claim failure echoes; this guard prevents the console-only
   `ClaimChair failed … not in the 'Connected' State` observed in the test.
4. **State resync note:** rooms are in-memory server-side. After a server restart,
   `onreconnected`'s `JoinRoom` recreates an **empty** room — votes/stories from before
   the bounce are gone by design. Show one toast after a reconnect that followed
   `onclose`-level downtime: `Room state was reset by the server`. (Detect: RoomState
   snapshot arrives with 1 participant where you previously had >1 — keep it simple, a
   heuristic toast is fine.)

**Do NOT:** touch `Hubs/PokerHub.cs` (JoinRoom already rebuilds state), add reload loops,
or auto-reload the page (users may be mid-typing; the Reload button is enough).

### Acceptance
- Start a 2-user room, kill `dotnet` (Ctrl+C), wait 60 s: **both** tabs show the amber
  banner within ~5 s of the kill and keep retrying (network tab shows /pokerhub/negotiate
  attempts every ≤15 s). Vote clicks during the outage produce the "Not connected" toast,
  not silence.
- Restart the server: within ≤15 s both tabs flash `✓ Reconnected`, roster shows both
  users again, voting works. No manual reload needed.
- What's New + ✅ DONE.

---

## P4 — Stop broadcasting `walk` when nothing moves (blocked-input + idle spam) ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Functions:** `_updateTopSteer` (3962, axis fallback 4008–4013, broadcast 4020–4026),
`_updateWalk` (2579, broadcast 2670–2678)

### Mechanism (two variants of one bug)

- **Blocked steering (2D + walk):** `_updateTopSteer`'s slide logic tries the X axis with
  `nx = r.x + dx`; pressing straight into the table means `dx === 0`, so
  `_routeBlockedAt(nx, r.z)` tests the **current** position, "succeeds", assigns
  `r.x = nx` (a no-op), and execution reaches the 10 Hz `RoomSceneNet.avatarMove(...,
  'walk')` — frozen coordinates, walk pose, forever. Logged live: `walk@-0.72,0.8` ×8/s
  while pinned against the table. `_updateWalk`'s slide (2604–2611) has the same
  degenerate-axis shape.
- **Idle walk-mode spam:** `_updateWalk` broadcasts unconditionally every 0.1 s (2671–
  2678) even when `fwd === 0 && strafe === 0` — measured 9.3 msg/s from a user standing
  still, and peers render the `walk` pose as marching in place.

### Implementation

1. In `_updateTopSteer`, make the axis fallbacks real moves only:
   ```js
   else if (dx !== 0 && !_routeBlockedAt(nx, r.z)) { r.x = nx; }
   else if (dz !== 0 && !_routeBlockedAt(r.x, nz)) { r.z = nz; }
   ```
   Then compute `var moved = (r.x !== px0 || r.z !== pz0);` (capture `px0/pz0` before the
   slide). When `!moved`: set `r.pose = 'idle'`, and if the previous tick was moving send
   **one** `avatarMove(..., 'idle')` (reuse the `_topSteerActive` stop path shape at
   3971–3980); skip the 10 Hz walk broadcast entirely while pinned.
2. Same guard in `_updateWalk`: capture pre-slide `wx/wz`; broadcast at 2670 only when
   `(|Δx|+|Δz|) > 0.001` **or** yaw changed > ~2° **or** pose changed since the last
   *sent* values — plus a 1 s keepalive resend so late packet loss self-heals. Track the
   last-sent tuple in `_walk` (`lastSentX/Z/Yaw/Pose/T`). When idle-in-place, the local
   third-person pose should call `_poseRobotWalk(robot, phase, false)` — it already does
   (2665–2667, `moving` flag) — confirm peers get `'idle'` **once** by sending
   `avatarMove(wx, wz, ryaw, 'idle')` when movement stops (mirror of the enter-walk
   broadcast at 2457).
3. Do the arithmetic with an epsilon, not `!==`, for float drift (`Math.abs(...) > 1e-4`).

**Do NOT:** change the 0.1 s cadence cap for genuinely-moving broadcasts, the hub's 40 ms
rate limit, or `applyAvatarMove`.

### Acceptance
- Browser A holds ↑ into the table edge for 5 s: browser B sees A standing **idle**
  against the table (no marching); a network log (Appendix A hook) shows ≤2 messages for
  the whole 5 s (one idle + ≤1 keepalive), not ~50.
- Browser A enters walk mode and stands still 10 s: ≤ ~10 total messages (1 Hz keepalive),
  B sees idle stance. Actually walking still streams smoothly at up to 10 Hz.
- 2D arrow steer across open floor then release: unchanged smooth glide + final idle
  (Feature 8 P1 regression check).
- What's New + ✅ DONE.

---

## P5 — Cameras must never end up inside geometry ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Functions:** `_enterWalk` (2405), `_exitWalk` (2468, controls reset 2481), third-person
placement in `_updateWalk` (2624–2630)

### Mechanism

`_exitWalk` re-enables OrbitControls and resets `_controls.target` to the table (2481)
but leaves `_camera.position` wherever walking put it — eye height at the avatar's last
spot. Exit in a corner and the perspective camera sits inside the wall: black frame, and
orbit-drag rotates *around the table target from inside the wall*, still black. The
third-person follow camera (2626–2630: fixed 3.2 m behind the avatar, no clamping) backs
into walls the same way.

### Implementation

1. **Save/restore the orbit pose.** In `_enterWalk`, before overwriting the camera:
   ```js
   _preWalkCam = { pos: _camera.position.clone(), target: _controls ? _controls.target.clone() : null };
   ```
   In `_exitWalk`, after re-enabling controls: if `_preWalkCam` exists, restore both and
   `_controls.update()`. This returns the user to the exact framing they had before
   pressing T — predictable and always valid (it was valid when saved).
2. **Fallback clamp** (covers exit paths where `_preWalkCam` is null — e.g. scene rebuilt
   mid-walk): position the camera at
   `target + normalize(exitPos − target) * 6` with `y = 4`, then clamp x/z to
   `±(ROOM_W/2 − 0.6)` / `±(ROOM_D/2 − 0.6)`.
3. **Third-person wall clamp.** In `_updateWalk`'s third-person branch, clamp `camX/camZ`
   to the same inset room bounds before `_camera.position.set`, and lerp the camera's
   actual distance toward the clamped point so it glides rather than pops:
   ```js
   camX = Math.max(-ROOM_W/2 + 0.35, Math.min(ROOM_W/2 - 0.35, camX));
   camZ = Math.max(-ROOM_D/2 + 0.35, Math.min(ROOM_D/2 - 0.35, camZ));
   ```
   (A full occlusion raycast against furniture is out of scope — walls are what go black.)

**Do NOT:** add camera-collision physics, change `_applyControls`, or alter first-person
placement.

### Acceptance
- Walk into every corner of the room, press Esc in each: normal orbit view every time
  (the pre-walk framing), zero black frames.
- In third person, back the avatar flush against each wall: the camera slides down/along
  the wall but the frame never goes fully dark.
- Enter walk → orbit around with T toggles repeatedly: no drift in restored framing.
- What's New + ✅ DONE.

---

## P6 — 2D top-down must render avatar bodies (currently name chips over bare floor) ✅ DONE 2026-07-13 — root-caused and fixed via live diagnosis

First pass (frustumCulled=false) was a guess made without live testing and turned out to be
wrong. Root-caused afterward with a real two-browser session + temporary `__debug` hooks
(raw WebGL `readPixels` against the canvas, bypassing screenshot/compositor uncertainty):
robots **do** render in top-down view — layers, near/far clipping, visibility flags, and
scene membership were all fine — but at true world scale they cover only ~1-2 pixels of the
whole-room orthographic buffer, i.e. visually indistinguishable from the floor. Chairs read
fine at that size because of their shape/contrast; the humanoid model doesn't.

Fix: `TOP_VIEW_ROBOT_SCALE = 3.2` applied via `_applyViewScale()` at every robot-creation
site (roamer, seated, standing, ghost) and re-applied to all existing robots in `setView()`
so toggling 2D/3D rescales robots built under the other view. Ring/label positions are
unaffected by the scale (top-down ortho projection ignores world-Y for screen placement).
Verified: robot bodies now clearly visible under both participants' name chips in 2D, and
3D view is unaffected (scale resets to 1x). The exploratory debug hooks were removed after
confirming the fix; kept `RS3D.__debug.robotMap()` as a small permanent addition consistent
with the existing debug helpers.

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Functions/lines:** ortho camera creation (301–304: `OrthographicCamera(-5, 5, 5, -5,
17, 22)` at y=20, i.e. a visible world-Y slab of **[−2, +3]**), `_setOrthoFrustum`
(115–122), standing-robot builder (~4310–4358), roamer/seated robot builders, `setView`
(149–171)

### Mechanism — to be pinned down first (the test could not, from outside the code)

Confirmed live: in `_view === 'top'`, chairs/table/furniture render; **no robot mesh
renders for any participant** (standing, roaming, or seated), while their CSS2D labels
float at the correct spots. Robots are added to `_scene` unconditionally (4332), and the
near/far slab [−2, 3] comfortably contains a ~1.4 m robot, so the cause is not obvious
from reading. Diagnose before fixing:

1. Join a room in 2D with 2 users. In DevTools on one tab run:
   ```js
   // paste in console — inspects the module state via a temporary global you add for
   // the diagnosis (expose window.__rs3dDebug = { scene: _scene, robotMap: _robotMap,
   // cam: _camera } inside init during this patch, remove before shipping)
   Object.entries(__rs3dDebug.robotMap).map(([k, r]) => ({
       k, hasRobot: !!r.robot, visible: r.robot?.visible,
       pos: r.robot?.position.toArray(), inScene: r.robot?.parent === __rs3dDebug.scene
   }))
   ```
2. If robots are present+visible+positioned: check material/frustum culling —
   `r.robot.traverse(o => o.frustumCulled = false)` as a probe; check whether the ortho
   camera's **layers** differ from the perspective camera's (robots may be on a layer the
   ortho cam doesn't test); check `robot.visible` toggling in the render loop (search the
   loop at ~4890–4930 for any `_view === 'top'` branch touching robots).
3. If robots are absent from `_robotMap` in 2D: `_rebuildSeating`/standing-row builder is
   being skipped on the 2D init path (`_cfg.mode === '2d'`, line 306) — find the call
   that only happens for `persp` init and make it unconditional.

### Implementation (after diagnosis)

Fix the identified cause so all three robot kinds (seated at chairs, standing row,
roamers) render in top-down. If the root cause is the shared-scene assumption breaking
(e.g. layers), prefer the smallest change: put robots on the default layer / enable the
layer on `_orthoCam`. Add a regression guard: after `setView('top')`, assert in dev
builds (`console.assert`) that at least one robot mesh is `visible && parent === _scene`
when participants exist.

**Do NOT:** build a separate 2D sprite system, change label rendering, or alter
`_setOrthoFrustum` unless the diagnosis names it.

### Acceptance
- 2D mode, three users (one seated, one standing, one mid-glide): all three show robot
  bodies under/behind their name chips, in both browsers; the glide shows the walk
  animation (Feature 8 P1's original 2D acceptance finally observable).
- Toggling 2D↔3D repeatedly never loses a robot.
- What's New + ✅ DONE.

---

## P7 — Walk-mode exits and toolbar dismissal must be predictable ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Functions:** `_onCanvasBlur` (2527), `_exitWalk` (2468), `_onKeyDown` selection block
(2093–2096), `_deselectAll` (2915)

### Mechanism

- `_onCanvasBlur` exits walk whenever canvas focus moves outside `_container` — that
  includes clicking any page UI (vote card, chat). In the live test a click-shaped input
  on the canvas also ended walk mode with **no feedback**, directly contradicting the HUD
  ("Esc to exit"). The exit itself is by design (P7 of an earlier feature); the silence is
  the bug.
- `Escape` with an open selection toolbar did nothing in the test, despite line 2094
  handling it. `_onKeyDown` is registered on `document` in **capture** phase (4445), so
  another capture-phase Escape handler running earlier (check `room.js` — modal/panel
  Escape handling) or an early `return` above (2044 `if (!_renderer) return;` — fine;
  2049 walk-toggle; 2051 `_walk` block) may be swallowing it. Note the block at 2093:
  `if (!_sel) return;` — confirm `_sel` is actually set when the bar is visible (it is,
  via `_selectItem`), then hunt the competing listener.

### Implementation

1. In `_exitWalk`, accept a `reason` argument (`'esc' | 'blur' | 'toggle' | 'sit'`).
   For `'blur'` (and any non-explicit reason) show a 2 s toast: `Left walk mode` (reuse
   `_showToastAD`-style scene toast used elsewhere in this file). Explicit exits (Esc,
   T/toggle, E-sit) stay silent.
2. Update the walk HUD hint text to match reality: `Esc exit · click outside to exit`.
3. Escape/deselect: instrument with a one-line log, press Escape with the bar open, and
   fix the winner-takes-all ordering — either register the scene's keydown earlier, or
   (simpler, robust) also close the selection from a `keydown` listener attached directly
   to `document` in bubble phase checking `_sel && e.key === 'Escape' &&` no modal open.
   Also make clicking the selection bar's Done always work regardless of toolbar
   reposition (it does — `onclick` on the button, 3016 — just re-verify after P1's
   deferral changes).

**Do NOT:** remove the blur-exit behaviour, change pointer-lock Esc semantics (2061–2066,
two-stage by design), or make Escape leave the room/close panels as a side effect.

### Acceptance
- In walk mode, click a vote card: walk exits AND the `Left walk mode` toast shows.
- Esc with pointer lock: first Esc releases look-lock (stays walking), second exits — as
  documented in the HUD.
- Open the chair toolbar, press Escape: toolbar closes, every time, in 2D and 3D.
- What's New + ✅ DONE.

---

## P8 — Kill the phantom `Error loading video: MediaError` on default rooms ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

Note: current code already gated video construction behind `view === 'custom' &&
(windowMediaId || windowImage)`, so a truly fresh room shouldn't hit this at all — the live
test's room likely had a stale/leftover `windowMediaId` from earlier manual testing. Implemented
the full hardening anyway (canPlayType probe + graceful image fallback, warn-not-error, toast
only on an active user pick via the new `_rsJustConfiguredWindowMedia` flag) since it closes the
gap regardless of which scenario caused it.

**Files:** `wwwroot/js/room-scene-3d.js` (window-media loader around 560–641)
**Function:** the window/skyline media branch whose error handler is at 626–630

### Mechanism

Every page load of an out-of-the-box room logs `Error loading video: MediaError` from
line 627 — so a `<video>` element is constructed and pointed at a source even when the
room has no custom window media (or the stored media entry is stale/unsupported). There
is also a user-facing toast ("This browser can't play this video format.") that default
users should never see.

### Implementation

1. Read the loader entry (search `_rsUploadWindowMedia` / the `src` selection above 560)
   and establish what `src` is on a default room. Guard construction:
   - No configured media → build the static/procedural window only; never create the
     `<video>`.
   - Configured media → check `video.canPlayType(mimeFromExtension(src))` first; on
     `''`, log **one** `console.warn` (not error) and fall back to the static-image
     branch (632–640) without toasting.
2. In the error handler itself (626), downgrade to `console.warn`, include `src`, and
   only toast when the user *just* configured this media in this session (pass a flag
   from the upload/select flow) — not on passive loads.
3. Verify the media library flow (`_rsWindowMediaSelect`) still surfaces a real failure
   toast when the user actively picks an unplayable file.

**Do NOT:** remove the video feature, autoplay handling (615–619), or the texture wiring.

### Acceptance
- Fresh room, default scene: console shows **zero** errors on load (the only prior error
  was this one).
- Configuring a valid mp4 window still plays; picking a bogus file warns once with the
  filename and falls back to the static image; no toast on passive page loads.
- What's New + ✅ DONE.

---

## P9 — Polish cluster (three small, independent fixes — still one review cycle) ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

Notes:
- **Battle overlay auto-dismiss**: already correctly implemented in the current code
  (`_baRunSequence` calls `_baDelayRaw(s.dismissDelay || 3400)` then `_baHide()` for every
  client independently, since `VotesRevealed` broadcasts to everyone and each client runs its
  own local sequence). No change made — left as-is.
- **Standing-row sync**: added a stable sort (by `connectionId`, falling back to `name`) before
  assigning standing slots in `_rebuildSeating()`. Both `applyClaim`/`clearRoamer` and
  `applyRelease` already call `_rebuildSeating()` on every client, so this was the one real gap.
- **Host modal stack**: sequenced via a small state machine (`_seqSoundDone`/`_seqHostReady`/
  `_seqMaybeShowHost`) in `room.js` — sound-prefs modal first, host-lock chooser only after it
  resolves (shown+dismissed via `hidden.bs.modal`, or skipped because no modal was needed).

**Files:** `wwwroot/js/room.js`, `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`

1. **Battle overlay lingers for spectators.** The vote-battle modal (search `BATTLE` /
   battle overlay markup in `room.js`) stays on `WINNER!` on every non-initiating
   participant's screen until each manually skips. Auto-dismiss for everyone 4 s after
   the winner state renders (`setTimeout` guarded so a user who already closed it isn't
   re-shown), keep the Skip button as the fast path.
   *Acceptance:* A reveals with an outlier; B and C watch the battle end and the overlay
   removes itself on all three screens without clicks.
2. **Standing-row spots differ across browsers transiently.** After a claim, the claimer's
   client re-flows standing positions while other clients don't (observed: Alice appeared
   front-centre on one screen, left wall on another until the next join re-flowed both).
   Standing spots come from the standing-row builder (~4310): ensure the position
   assignment derives **only** from `(ordered unclaimed participant list, room geometry)`
   — sort by a stable key every client shares (join order / connectionId), and rebuild the
   row on **every** claim/release event on **all** clients (`applyClaim`/`applyRelease` →
   `_rebuildSeating()` — verify both paths call it; the test suggests the non-claimer path
   skips or orders differently).
   *Acceptance:* with 3 users standing, one sits: within a second, the remaining standers
   occupy identical spots in every browser (compare screenshots), no avatar "hops" later
   when someone else joins.
3. **Host first-join modal stack.** On room creation the host gets the sound-preferences
   modal and the host settings-lock modal simultaneously (stacked backdrops). Sequence
   them: show sound prefs first; on its dismissal, show the host-lock chooser (search
   `soundConfirmModal` and the host-lock modal in `room.js`; chain via the Bootstrap
   `hidden.bs.modal` event instead of showing both).
   *Acceptance:* create a room fresh (clear localStorage): exactly one modal at a time,
   in that order; both choices persist as today.

**Do NOT:** redesign the battle feature, change seat-claim protocol, or alter what either
modal saves.

What's New (one combined entry is fine) + ✅ DONE.

---

## P10 — Gate all layout editing behind an explicit "Edit layout" mode ✅ DONE 2026-07-13 (unverified — implemented without live testing per instruction)

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Room/Index.cshtml` (one hook),
`Views/Shared/_Layout.cshtml` (What's New)
**Functions/lines:** `_onPointerDown` (1863), `_onPointerUp` (1982), `_onCanvasClick`
(4486), `_updateHover` (1559; furniture tip 1593–1597, chair tip 1610), scene toolbar
creation (~2110–2210; `_furnHudBtn` assigned 2164, `_furnHud` 2207), `_enterWalk` (2405),
`setView` (149), `_walkInteract` furniture case (2754), "Setup Room" button
(`Views/Room/Index.cshtml:115` → `openRoomDesigner()` at 429, which opens the
`roomDesignerOffcanvas`)

> Prerequisite: P1 must already be merged (this patch deletes P1's deferral, step 6).
> Line numbers above are pre-P1 anchors — re-locate by function name after P1 lands.

### Why

Today every plain click on any chair/furniture/prop/table begins a drag or selects it
for editing — that is the root enabler of the F1 bug class and of accidental room
rearrangement by users who only wanted to sit or look around. After this patch,
**viewing/sitting is the default mode** (clicks never edit anything) and **editing is an
explicit mode** you toggle on, matching how the Whiteboard and Walk features are already
modal.

### Behaviour contract (agree with this table before coding)

| Action | Edit mode OFF (default) | Edit mode ON |
|---|---|---|
| Single-click chair/furniture/table/prop | nothing (hover tip only) | select immediately (ring + toolbar) |
| Drag chair/furniture/table/decor | orbits/pans the camera | moves the item (today's drag) |
| Double-click empty chair | walk-then-sit / instant sit (P1/P4 behaviour) | **disabled** |
| Double-click own chair / robot | stand up | **disabled** |
| Floor click (click-to-walk ON) | glide to point | **disabled** (you're arranging, not walking) |
| Prop double-click (confetti/jukebox), whiteboard, project screen | work as today | **disabled** |
| Host double-click occupied chair to free it | works as today | disabled (leave edit mode first) |
| `E` in walk mode (sit / pick up furniture) | unchanged | n/a (entering walk exits edit mode) |
| ➕ quick-add furniture HUD | hidden | visible (as today) |
| R / Shift+R / Delete / rotate handle / sel toolbar | n/a (nothing selectable) | as today |

The one deliberate behaviour KEPT outside edit mode is walk-mode `E` furniture pickup —
it requires facing + proximity + a key press, so it is not an accidental-grab vector.

### Implementation

1. **State + API.** Module-level `var _editMode = false;` plus:
   ```js
   function _setEditMode(on) {
       on = !!on;
       if (on === _editMode) return;
       _editMode = on;
       if (!on) _deselectAll();
       if (on && _walk) _exitWalk('toggle');       // mutually exclusive with walk mode
       _updateEditModeUi();                        // button active state, HUD chip, ➕ visibility
   }
   ```
   Expose `setLayoutEdit: _setEditMode` on the same public object that already exposes
   `setView` (the export the 2D/3D toggle buttons call — follow that call chain from
   `room-scene.js`), so the view layer can hook it.
2. **Toolbar toggle.** Add a `✏️` button to the on-canvas toolbar stack (create it next
   to `_furnHudBtn`, ~2160; title `Edit room layout — move chairs & furniture`). Clicking
   toggles `_setEditMode(!_editMode)`; active state styled like `_walkBtn.classList
   .add('active')` (2441). Visible in both 2D and 3D (`setView`'s `topHide` logic at
   165–169 must NOT hide it). The existing ➕ `_furnHudBtn` becomes visible **only in
   edit mode** (`_updateEditModeUi` sets its `display`); if a future call path shows the
   quick-add HUD while edit mode is off, `_setEditMode(true)` first.
3. **Mode chip.** While ON, show a small fixed chip inside the canvas (same styling
   family as the walk HUD): `✏️ Editing layout — drag to move · Esc to finish`. Remove on
   OFF. This is the discoverability piece — without it users won't know why sitting is
   paused.
4. **Gate the pointer layer.** At the top of `_onPointerDown` (after the `_walk` check,
   1864): `if (!_editMode) { if (_sel) _deselectAll(); return; }` — with one exception
   carved out BEFORE the return: **none**. (Chair claims don't run through pointerdown;
   they live in `_onCanvasClick`. OrbitControls receives the event because we simply
   don't consume it.) `_onPointerMove`'s drag branches and `_onPointerUp`'s select
   branches are then unreachable when OFF — add `if (!_editMode) return;` guards at their
   tops anyway (defence against future listeners reordering).
5. **Gate the click layer.** At the top of `_onCanvasClick` (after the `_walk` guard,
   4487): `if (_editMode) return;` — in edit mode clicks belong to selection/drag only,
   so sit/stand/prop/screen/host-free/click-to-walk are all paused (per the contract
   table). Outside edit mode the function runs exactly as post-P1.
6. **Delete P1's deferral.** Remove `_deferChairSelect`/`_cancelChairSelect` and restore
   the direct `_selectItem('chair', cd.idx)` in `_onPointerUp` (it is now reachable only
   in edit mode, where immediate selection is correct). Remove the `_cancelChairSelect()`
   calls added by P1 steps 3/5.
7. **Hover affordances follow the mode** (`_updateHover`):
   - OFF: furniture/table/decor → no tip, default cursor (they are scenery now). Chair
     tips lose the drag hint: `🪑 Double-click to sit` / `Double-click to stand up` /
     host-free tip unchanged (1610–1612). Avatar tips unchanged.
   - ON: current behaviour (`Drag to move • Click for options`, `move` cursor), and chair
     tip becomes `Drag to move • Click for options`.
8. **Escape ladder.** In `_onKeyDown`'s orbit section: Esc with a selection → deselect
   (P7 already guarantees this works); Esc with edit mode ON and no selection →
   `_setEditMode(false)`. Keep this ordering.
9. **Room Designer hook.** In `Views/Room/Index.cshtml`, after the offcanvas exists, wire
   Bootstrap events so opening the designer implies editing:
   ```js
   const rd = document.getElementById('roomDesignerOffcanvas');
   rd?.addEventListener('shown.bs.offcanvas',  () => RoomScene?.setLayoutEdit?.(true));
   rd?.addEventListener('hidden.bs.offcanvas', () => RoomScene?.setLayoutEdit?.(false));
   ```
   (Use the actual exported name found in step 1. Manual ✏️ toggling stays independent —
   closing the designer always ends edit mode, which is acceptable.)
10. **Lifecycle.** `_editMode` starts `false` on every load (deliberately not persisted —
    the whole point is that nobody edits by accident). `_enterWalk` forces it off (step
    1). `dispose()`/`refreshScene()` (~4940–4995) must reset `_editMode = false` and
    remove the chip + ✏️ button with the other toolbar teardown (4943–4944).
11. **Sync note (no code):** incoming layout changes from OTHER users
    (`setChairPositions`/`setDecorPositions`/furniture events) apply regardless of my
    local mode — unchanged.

**Do NOT:** gate walk-mode `E` pickup, gate incoming sync, persist the mode, make it
host-only (today everyone may arrange; permission changes are a separate product
decision), or touch the Room Designer offcanvas contents.

### Acceptance
- Fresh load (mode off): single-click and click-drag on every chair, the table, a plant,
  and the whiteboard **never** selects or moves anything — drags orbit the camera; hover
  shows sit/stand tips but no move affordances; double-click sit and click-to-walk work
  exactly as post-P1; 10× double-click sit still 10/10 (P1 regression).
- Toggle ✏️ ON: chip appears; single-click selects immediately with toolbar; drags move
  chairs/furniture/table; a second browser (mode OFF) sees every move live; double-click
  on a chair does NOT sit and confetti/jukebox do NOT fire; floor clicks don't move the
  avatar.
- Esc: deselects first, second Esc exits edit mode (chip + ➕ disappear, sitting works
  again immediately).
- Pressing T in edit mode enters walk cleanly with edit mode off on return; opening
  "Setup Room" (designer offcanvas) turns edit mode on, closing it turns it off.
- Works identically in 2D and 3D; `refreshScene` (theme/layout change) doesn't leave a
  stale chip or stuck mode.
- What's New entry added; this patch marked ✅ DONE here.

---

## Appendix A — How this was tested (repeatable recipe)

- **Two+ real browser tabs** on `http://localhost:5288/room/<room>?name=<user>` are full
  multi-user sessions (one SignalR connection per tab). Only the foreground tab renders
  (background tabs freeze `requestAnimationFrame` but keep receiving state).
- **Log outgoing scene traffic** (paste in DevTools console per tab):
  ```js
  (() => {
    window.__moves = [];
    for (const k of ['avatarMove', 'claimChair', 'releaseChair']) {
      const orig = RoomSceneNet[k];
      RoomSceneNet[k] = (...a) => { __moves.push({ t: Date.now(), k, a }); return orig.apply(RoomSceneNet, a); };
    }
  })();
  // …do a thing, then:
  __moves.map(m => m.k + '@' + m.a.join(','))
  ```
- **Hold a movement key programmatically** (CDP/manual taps are too short):
  ```js
  const hold = (key, ms) => new Promise(res => {
    const o = { key, code: key, bubbles: true };
    document.dispatchEvent(new KeyboardEvent('keydown', o));
    setTimeout(() => { document.dispatchEvent(new KeyboardEvent('keyup', o)); res(); }, ms);
  });
  await hold('ArrowUp', 2000);
  ```
- **Server-bounce drill for P3:** `Ctrl+C` the `dotnet run`, watch both tabs for 60 s,
  restart, watch for recovery. Console filter: `signalr|Connected|negotiate`.
- Expected message rates: moving avatar ≈ 10 msg/s; stationary (post-P4) ≤ 1 msg/s.

## Appendix B — Verified-working baseline (regression watchlist)

Re-check after each patch (5 minutes): create/join, double-click far chair → walk+sit
(P4/F8), floor click while seated → stand-beside + glide + idle (F8 P1/P2), T → walk from
avatar (F8 P3), story add → vote ×3 → reveal → battle → accept → sprint total, late
joiner sees seated users correctly, `Export CSV`, theme switch.
