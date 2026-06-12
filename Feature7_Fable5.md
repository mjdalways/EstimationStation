# Feature 7 — Room Polish, Defaults & Performance (Implementation Spec)

> Authored by Claude (Fable 5), 2026-06-11, for implementation by Claude Sonnet 4.6 — every patch below is intended to be implementable cold, without the authoring conversation.
> Scope decisions confirmed by the project owner on 2026-06-11: E-interact should work on **all** interactable objects; 2D camera **auto-follows** the avatar when zoomed (Kumospace-style); lazy-load defers the **Three.js library + models + textures** (i.e. the whole `room-scene-3d.js` module graph); the gray-avatar bug is **diagnose-first** (root-cause candidates are listed in P1).

---

## How to use this document (instructions to the implementing AI)

1. **One patch per session/review cycle.** Implement exactly one patch from the Patch Plan, verify its acceptance criteria, then STOP for human review. Do not start the next patch unsolicited.
2. **Stay inside the patch boundary.** Each patch lists *Files* and *Do-NOT* constraints. If you believe an out-of-scope change is needed, note it in your summary instead of making it.
3. **Project conventions (mandatory):**
   - After every shipped patch, add a dated entry to the **What's New / About changelog** in `Views/Shared/_Layout.cshtml` (search for the existing changelog markup — newest entry goes on top) and mark the patch ✅ DONE in this file.
   - **Restart `dotnet run` after editing any `wwwroot/js` file** — `asp-append-version` serves immutable-cached assets; without a restart the browser keeps the old file.
   - Code style: vanilla JS, IIFE modules exposing one `window.*` global, `var`-style code in room-scene-3d.js — match the surrounding file. Comments explain *constraints and why*, not what the next line does.
   - **No new frameworks.** Bootstrap 5.3 is already loaded and is the only UI toolkit.
4. **Verification:** ASP.NET Core MVC — run with `dotnet run`, open a room at `/room/{name}?name=Tester` (two browser windows for multi-user tests). The 3D room is the Room Scene panel; room settings are in ⚙️ Setup Room (offcanvas) and the ⚙ Settings modal → 🏠 Room tab. Walk mode: click the 🚶 toolbar button in 3D view (or press T).
5. Line numbers were captured 2026-06-11 against the working tree and will drift — treat them as starting points, verify with search.

---

## 0. Current-state review (facts, verified 2026-06-11)

| Concern | Where | Notes |
|---|---|---|
| CSS2D label visibility | `wwwroot/lib/three/CSS2DRenderer.js:232` | `renderObject` sets `element.style.display = visible ? '' : 'none'` **every frame** from `object.visible`. Hiding a label by mutating `element.style.display` directly (as `_updateInteractLabel(null)` does) is overridden on the next frame. Conversely, a CSS2DObject removed from the scene graph is **no longer visited** — its DOM element stays orphaned in the overlay at its last screen position. |
| "Press E" prompt | room-scene-3d.js `_updateInteractLabel` (~:2721), refreshed only from `_updateWalk` (~:2574), hidden in `_exitWalk` (~:2404) via `element.style.display='none'` | Walk-mode-only feature (P9 of Feature 6). The hide is overridden per the row above → label sticks forever (also visible in 2D and after the target object moves). |
| Interactive props (🎉/🎵) | `_buildProps()` (~:874), emoji is a CSS2DObject child of the prop group (`_makeEmojiProp` ~:867–871) | `refreshScene` (~:4787) strips scene children but never removes these CSS2D DOM nodes → every room-settings change leaves an orphaned 🎉/🎵/screen-label div behind ("two celebration icons"). `dispose()` (~:4762) clears the whole label-renderer DOM, so full dispose is safe — only `refreshScene` leaks. |
| E-interact targeting | `_walkInteract` (~:2583) and `_findInteractTarget` (~:2654) — duplicated proximity-limited raycasts | Third-person ray origin is `(wx, 1.1, wz)` **horizontal**; first-person uses camera direction (includes pitch). Chair `seatMesh` is a thin box at y≈0.47 (`_makeOfficeChair` ~:3045) → the horizontal third-person ray can never hit a chair; ranges (`far` 1.9–2.5) also fail for first-person looking down (ray length grows with pitch). |
| Roamer yaw convention | `applyAvatarMove`/`_updateRoamers` set `robot.rotation.y = yaw` (~:3773); robot model front = **local +Z** (seated/standing robots use `atan2(-x,-z)`-style angles to face the table, ~:4084, ~:4133); 2D click-to-walk computes `tyaw = atan2(dx, dz)` (~:3706) — consistent with front=+Z | Walk mode moves with forward = `(sin yaw, −cos yaw)` (`_updateWalk` ~:2491) and broadcasts that camera-convention yaw **unconverted** (`RoomSceneNet.avatarMove(_walk.wx,_walk.wz,_walk.yaw,…)` ~:2569) → the robot front points opposite to travel, i.e. at the third-person camera. The conversion is `θ_roamer = π − yaw_camera` (sin preserved, cos negated). |
| Roamer colour | `_makeRoamer` (~:3545): participant by CID, **self-only name fallback**; no participant → body colour literal `0x888888` + `wasGray:true`. `_refreshRoamers` (~:3734) rebuilds a wasGray body **only** when `_participantByCid(cid)` succeeds — it has **no name fallback**. `syncParticipants` (~:4843) drops any roamer whose CID isn't in `_participants`. | `_parseColor` (~:4543) never returns gray for a real participant (name-hash fallback) — a gray robot always means "participant lookup returned null". `ROOM_CONFIG.connectionId` is set once in room.js (~:151) when SignalR starts. |
| Vote-status rings ("halos") | `_makeRoamer` (~:3558), seated (~:4089), standing (~:4138); colours `VOTE_EMI` (~:42): none=0x444444 (dim gray), voted=amber, revealed=green, observer=gray-blue. Unclaimed chairs get a blue glow ring (~:4039). Selection ring `_selRing` (~:2836). | The gray "none" ring floats at head height on every robot and conveys nothing — this is the unexplained "3D halo" on avatars. The blue chair ring and the selection ring are intentional affordances. |
| Plant pick mesh | `_makeFurniturePlant` (~:1115): foliage spheres up to y≈0.8, but invisible `pickMesh` is a cylinder r=0.28 **h=0.12 at y=0.06** (base only) | Hover/drag/E only respond at the pot base — "can't pick the top of the plant". Other furniture pick meshes are full-height (coffee_table h=0.55, projector h=1.8, …). |
| Room Scene panel visibility | Widget system in room.js: registry (~:4354, id `roomScenePanel`), persisted in localStorage `es_widgetLayout` (`hidden:true` honoured in `_wgtRestore` ~:4406), `_widgetClose`/`_widgetShow` (~:3775/:3792) | Panel is visible by default; first-run users get the full 3D scene immediately. |
| Three.js loading | `Views/Room/Index.cshtml` :454–465 — inline importmap + eager `<script type="module" src="~/js/room-scene-3d.js" asp-append-version>` | The module graph (three.module.js ~1.2 MB, OrbitControls, CSS2DRenderer, RoomEnvironment, GLTFLoader → glb models/textures) loads on every room page, even when the panel is hidden. `room-scene.js _applyMode` (~:210) gates on `window.RS3D && window.THREE`, else shows a "Loading room…" placeholder — so deferral slots in cleanly. |
| Room size | `ROOM_SIZES` (room-scene-3d.js ~:30): small 8×6.5, medium 10×8, large 13×10; `_applyRoomSize()` ~:37; default `roomSize:'medium'` (room-scene.js :30); UI select `rs-room-size` (_Layout.cshtml ~:3071); `roomSize` is a SHARED field (room-scene-store.js :29) | Customization already shipped (Feature 6 P14) — Feature 7 only adds a **wide** option and changes the default. |
| 2D top-down camera | `setView('top')` (~:142) swaps to `_orthoCam`; OrbitControls pan on left-drag, zoom 0.5–4 (~:130) | No follow behaviour: when zoomed in, walking off-frame loses your avatar. |
| Reset affordances | `RS3D.resetFurniture()` (~:4899, button in furniture HUD ~:2142) resets furniture only | No single "reset the whole room" (config + furniture + chair/decor/table positions). |
| Furniture/layout sync | `_saveFurniture` → localStorage + `RoomSceneNet.broadcastFurnitureLayout`; `_chairPos`/`_decorPos` synced similarly; shared config via `RoomSceneStore.SHARED_FIELDS` + `RoomSceneNet.broadcastSceneConfig` (room-scene.js ~:261–287, server-persisted per Feature 6 P2) | Reuse these channels for P8 (reset) and P9 (wide default) — no new hub methods needed unless noted. |

---

# PATCH PLAN

| # | Patch | User items | Depends on | Risk |
|---|---|---|---|---|
| P0 | CSS2D lifecycle fixes: sticky "E pick up" + duplicate 🎉/🎵/screen labels | 9, 5 | — | Low |
| P1 | Gray robot on walk after recognized re-entry (diagnose, then fix lookup fallbacks) | 1 | — | Low–Med |
| P2 | Third-person: robot faces away from camera; strafe reads correctly | 2 | — | Low |
| P3 | E-interact reliability: distance+bearing targeting for chairs, whiteboard, props, furniture | 6 | P0 | Medium |
| P4 | Plant (and audit other furniture) pick-mesh coverage | 4 | — | Low |
| P5 | Vote-ring "halo" cleanup: hide the meaningless gray ring | 3 | — | Low |
| P6 | Room Scene hidden by default for first-time users | 7 | — | Low |
| P7 | Lazy-load Three.js + 3D module when the scene is hidden | 8 | P6 | Medium |
| P8 | Reset Room button (config + furniture + positions, synced) | 10 | — | Low–Med |
| P9 | Room size: add **wide** option, make it the default | 11 | — | Low |
| P10 | 2D top-down camera auto-follow when zoomed (Kumospace-style) | 12 | — | Medium |

Recommended order is the table order. P2/P4/P5/P9 are independent quick wins and may be reordered freely; P7 must follow P6.

---

## P0 — CSS2D lifecycle fixes (sticky "E pick up", duplicate 🎉) ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** touch CSS2DRenderer.js (vendored lib), change when/where the interact prompt *logically* shows (that's P3), refactor `_buildProps` beyond the cleanup.

Background: CSS2DRenderer re-derives `element.style.display` from `object.visible` every frame (CSS2DRenderer.js:232), and stops managing an element entirely once its object leaves the scene graph — the element is left orphaned in the overlay DOM.

1. **Sticky prompt** — in `_updateInteractLabel` (~:2721): hide by setting `_interactLabel.visible = false` (and `visible = true` when showing); remove both `element.style.display` writes. The existing `_exitWalk` → `_updateInteractLabel(null)` call then actually hides it.
2. **Belt-and-braces** — in `setView` (~:142), after the `if (_walk) _exitWalk();` line nothing more is needed (exitWalk now hides it), but verify by switching 3D→2D mid-walk with a prompt showing.
3. **Duplicate prop emojis** — track prop CSS2D objects: in `_makeEmojiProp` return the label object too (`{ group, pick, labelObj }`), and keep a module-level `_propLabelObjs = []` pushed in `_buildProps` (include the story-screen label object). Add `_disposePropLabels()` that, for each tracked CSS2DObject, removes it from its parent and removes `element` from `element.parentNode`, then resets the array. Call it at the top of `_buildProps()` (covers every rebuild path) — `dispose()` already nukes the whole overlay DOM (~:4762) so it needs no change, but calling `_disposePropLabels()` from `refreshScene` (next to `_disposeInteractLabel()` ~:4800) is harmless and explicit.
4. Audit for the same orphan pattern: whiteboard/decor have no CSS2D children today; roamer labels are cleaned in `clearRoamer`/`_clearRobots`; emotes are cleaned (~:3959). No further action expected — note anything you find.

**Acceptance:**
- Enter walk, face a furniture item until "E pick up" shows, exit walk (T or click 🎥) → prompt gone. Switch to 2D → no prompt. Re-enter walk → prompt re-appears when facing a target.
- Change any room setting (e.g. lighting) 3× while in 3D → exactly **one** 🎉, one 🎵, one story-screen label in the scene (inspect: `document.querySelectorAll` count on the overlay, or visually).
- What's New entry added.

---

## P1 — Gray robot on walk after recognized re-entry ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`, possibly `wwwroot/js/room.js` (reconnect CID refresh)
**Do NOT:** change server-side join logic (PokerHub.cs), change claim resolution (`getSeatingPlan`), alter `_parseColor`.

Symptom: choosing a room then Walk sometimes spawns a **gray** robot instead of the user's colour — typically when the server already recognised the user as present/seated from a previous session.

A gray body can only come from `_makeRoamer` with `p == null` (literal `0x888888`, ~:3554) that is never repaired, because the repair path `_refreshRoamers` (~:3734) requires `_participantByCid(cid)` to succeed and has **no name fallback** (unlike `_makeRoamer` ~:3548).

**Diagnose first** (keep the instrumentation local, remove before finishing): log in `_makeRoamer` when `p` is null (`cid`, `_myCid()`, `ROOM_CONFIG.playerName`, `_participants.map(p=>[p.name,p.connectionId])`) and in `_refreshRoamers` when a `wasGray` entry fails lookup. Reproduce: join a room, claim a chair, close the tab, reopen the same room URL with the same name, click Walk promptly (before/after the RoomState snapshot). Candidate causes, most likely first:
- (a) Roamer created while `_participants` is empty or holds only the **stale same-name entry with the old CID**; the wasGray repair then never fires because the *new* CID lookup keeps failing or because `_participantByCid` is the only path tried.
- (b) After a SignalR auto-reconnect, `connection.connectionId` changes but `ROOM_CONFIG.connectionId` (set once in room.js ~:151) goes stale → self-detection (`cid === _myCid()`) fails everywhere.

**Fix** (covers both):
1. Extract a helper next to `_participantByCid` (~:3541):
   ```js
   // CID-first participant lookup with a self-by-name fallback: after a rejoin the
   // list can briefly hold only the stale same-name entry (old CID) — colour/name
   // are still correct on it, so prefer it to rendering an anonymous gray robot.
   function _participantForCid(cid) { … CID match, else if (cid === _myCid()) name match … }
   ```
2. Use it in `_makeRoamer` (replacing the inline fallback), in `_refreshRoamers` (both the `wasGray` repair and the colour/label refresh), and in the stale-roamer eviction in `syncParticipants` (~:4844) so a self roamer isn't dropped while only the stale entry exists.
3. In room.js, refresh `ROOM_CONFIG.connectionId` in the SignalR `onreconnected` handler (search `onreconnected`; if the existing handler re-joins the room, set the CID there before the join call).
4. Remove the diagnostic logging.

**Acceptance:**
- Repro flow above → walk robot has the user's colour (both promptly-clicked and after-snapshot cases), in own browser **and** in a second browser.
- Second browser joins late while user A is mid-walk → A's roamer renders coloured for B (possibly after one repair tick, never permanently gray).
- What's New entry added.

---

## P2 — Third-person: robot faces away from camera, strafes correctly ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** change the robot model, the seated/standing facing math, the 2D click-to-walk yaw computation, or the wire format consumed by *other* clients beyond making it consistent.

Background (see §0 "Roamer yaw convention"): robot front = local **+Z**; roamer/wire yaw convention is `atan2(dx,dz)` (front follows travel). Walk mode's camera yaw has forward `(sin yaw, −cos yaw)` and is broadcast raw → front points at the camera. Conversion: `yawRoamer = Math.PI − yawCamera`.

1. Add a one-liner helper near `_updateWalk`: `function _walkYawToRoamer(yaw) { return Math.PI - yaw; }` with a comment stating the two conventions.
2. Apply it at every walk→roamer boundary — the `RoomSceneNet.avatarMove(...)` **and** paired local `applyAvatarMove(...)` calls in: `_enterWalk` (~:2381–2382), the throttled broadcast in `_updateWalk` (~:2568–2570), and `_exitWalk` (~:2417–2418). Do **not** touch `_walk.yaw` itself (camera math, interact rays, carried-item placement all rely on the camera convention).
3. The walk-cycle pose (`_poseRobotWalk`) is direction-agnostic — no change. Strafing (A/D) keeps yaw constant, so with the facing fixed the robot correctly side-steps while facing forward.
4. Check the **minimap** and any other consumer of my roamer yaw (search `_roamers[_myCid()]` and `.yaw`) for places assuming the old value; `_myStartPos` (~:3592) returns roamer yaw and feeds `_enterWalk`'s initial camera yaw — if walk is re-entered, convert back (`yawCamera = Math.PI − yawRoamer`) wherever roamer yaw seeds camera yaw. Verify there are no others.

**Acceptance:**
- Third-person walk forward (W/↑): robot's back is to the camera; A/D side-step with the body still facing forward; S walks backward toward the camera (front still away).
- Second browser: the walking robot faces its direction of travel (no moonwalking) both during WASD walk and 2D click-to-walk.
- Exit walk + re-enter: camera looks where the avatar faces (no 180° flip).
- What's New entry added.

---

## P3 — E-interact reliability (chairs, whiteboard, props, furniture) ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** make E work outside walk mode (out of scope; the prompt is a walk-mode HUD by design), change double-click interactions, change interaction *effects* (sit/stand/open/run/pickup logic stays).

Background: `_walkInteract` (~:2583) and `_findInteractTarget` (~:2654) duplicate proximity-limited **raycasts**. Chairs are un-hittable in third person (horizontal ray at y=1.1 vs seat at y≈0.47) and ranges misbehave with first-person pitch. Replace ray hits with a **horizontal distance + facing-bearing** test so all interactables respond identically in both camera modes.

1. Write one shared resolver, e.g. `_resolveInteractable()`, returning `{ kind:'drop'|'whiteboard'|'prop'|'chair'|'furniture', label, …payload }` or null:
   - If `_walk.held != null` → `{ kind:'drop', label:'drop' }`.
   - Candidate set: whiteboard (`_wbBoard` world pos, range 2.2 — skip if `_cfg.whiteboard === false`), props (`_props` group world pos, range 2.5), chairs (`_chairObjects` group pos, range 1.9; payload = idx + claim state exactly as today), furniture (`_furnitureObjs` group pos, range 2.0; payload = id).
   - For each candidate compute horizontal distance from `(_walk.wx,_walk.wz)` and bearing error vs `_walk.yaw`: `var brg = Math.atan2(tx - _walk.wx, -(tz - _walk.wz));` then normalize `brg - _walk.yaw` into (−π, π] and require `|Δ| < 0.7` (~40°). **Note the bearing formula uses the camera-yaw convention** (forward = `(sin yaw, −cos yaw)`) — write a unit-style comment, this is the same convention `_walk.yaw` uses regardless of P2.
   - Pick the candidate with the smallest distance (no kind priority needed once bearing gates it; keep ties stable).
2. `_findInteractTarget` becomes: resolve → map to the existing labels ('open whiteboard', `_propLabel(action)`, 'sit'/'stand up', 'pick up').
3. `_walkInteract` becomes: resolve → dispatch to the existing actions (Whiteboard.open / `_runProp` / claim-release logic / `_walk.held = id; _deselectAll()`).
4. Delete the now-dead per-type raycast blocks from both functions (the raycaster stays — canvas click/hover still use it).

**Acceptance:**
- Third person: walk up to an empty chair → "E sit" prompt appears and E sits; at your own chair → "E stand up" works; near the whiteboard facing it → "E open whiteboard" opens it; props and furniture as before. Repeat all in first person (including looking slightly up/down).
- Facing **away** from an adjacent object → no prompt, E does nothing.
- Prompt label still tracks the rebound interact key (`_keyHint(kb.interact)`).
- What's New entry added.

---

## P4 — Plant pick-mesh coverage (and furniture audit) ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** change visual geometry, change drag/selection behaviour.

1. `_makeFurniturePlant` (~:1115): replace the base-only pick cylinder (r 0.28, h 0.12, y 0.06) with one covering pot + foliage: `CylinderGeometry(0.30, 0.30, 0.90, 8)` at `position.y = 0.45`.
2. Audit every `_makeFurniture*`/`_make*` factory returning a `pickMesh` (~:1099–1230) for the same defect (pick volume far smaller than visible bounds); fix any found the same way. Expected fine: coffee_table, projector, sofa, lamp, bookshelf, monitor, jukebox, bin — verify rather than assume.
3. Note: prop pick cylinders (`_makeEmojiProp`, h 1.0) already cover their geometry.

**Acceptance:** hovering the plant's **leaves** shows the drag/options hover tip; drag from the leaves works; E "pick up" works aimed at the foliage. `dotnet run` + visual spot-check of each audited furniture type still hover/drag correctly.

---

## P5 — Halo cleanup: hide the meaningless gray vote ring ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** remove the rings for voted/revealed/observer states, touch the blue unclaimed-chair glow ring or the selection ring (both are intentional affordances).

Background: every robot (seated/standing/roaming) gets a head-height torus tinted by vote state (`VOTE_EMI` ~:42). State `none` renders a dim gray ring that users read as an unexplained "halo".

1. Wherever a vote ring is created/updated, set `ring.visible = (vs !== 'none')`: roamers (`_makeRoamer` ~:3558 — note `vs` is computed there), seated (~:4089), standing (~:4138), and the refresh paths `_refreshRoamers` (~:3752 — also update visibility when the state changes) and the equivalent seated/standing refresh (search `VOTE_EMI` for all update sites; `_rebuildSeating` recreates rings so creation-time visibility may suffice there — verify).
2. `_updateRoamers` (~:3779) overwrites `ring.visible` for first-person self-hiding — combine: `r.ring.visible = vis && r.ringStateVisible` (store the state-visibility on the roamer entry when it's computed) or recompute from the participant there; pick the simpler that doesn't query participants per-frame.

**Acceptance:** un-voted robots show **no** head ring; casting a vote shows the amber ring (both browsers); reveal turns rings green; observer keeps its ring; in third-person walk your own ring behaviour is unchanged apart from the none-state. Unclaimed chairs keep the blue floor ring.

---

## P6 — Room Scene hidden by default for first-time users ✅ DONE

**Files:** `wwwroot/js/room.js`
**Do NOT:** change the widget system's persistence shape, hide the panel for any user who has ever interacted with the scene or arranged widgets.

1. In `_wgtRestore` (~:4397, after `var all = _wgtGetLayout();`), seed a first-run default: if `all['roomScenePanel']` is `undefined` **and** `localStorage.getItem('es_roomSceneConfig') === null` (user has never touched the scene → safe to treat as first-run), call `_wgtSaveState('roomScenePanel', { hidden: true })` and refresh `all`. Existing users keep current behaviour through either signal.
2. The mobile guard (~:4405) skips hidden-restore on <768px — keep the seed consistent with that (the seed may still be written; the restore loop just won't apply it on mobile. That's acceptable: mobile shows home layout).
3. Discoverability: hidden panels are restorable from the widgets section of the Settings modal (`_wgtRenderSettingsPanel`). Additionally show a **one-time hint** so the feature isn't invisible: when the seed fires, render a small dismissible chip near `wgt-zone-C-top` or above the voting section — text like "🏠 Room Scene is available — enable it in ⚙ Settings → panels" with an inline "Show now" button calling `_widgetShow('roomScenePanel')`. Persist dismissal in the same seed flow (the seed only fires once by construction, so the chip naturally appears once).

**Acceptance:**
- Fresh profile (clear site localStorage): join a room → no Room Scene panel; hint chip visible; "Show now" reveals the panel at home position; reload → panel stays visible (state persisted).
- Existing profile (has `es_roomSceneConfig` or a widget layout): behaviour unchanged.
- What's New entry added.

---

## P7 — Lazy-load Three.js + 3D module when the scene is hidden ✅ DONE

**Files:** `Views/Room/Index.cshtml`, `wwwroot/js/room-scene.js`, `wwwroot/js/room.js` (show-hook)
**Do NOT:** convert room-scene-3d.js away from ES modules, vendor-split three.js, touch the importmap mappings (the inline importmap costs no network fetch and must stay so the deferred module resolves).

Background: the eager `<script type="module" src="~/js/room-scene-3d.js">` (Index.cshtml ~:465) pulls the whole 3D graph (three.module.js, addons, then models/textures at init) on every room load. `room-scene.js _applyMode` (~:210) already tolerates `window.RS3D` being absent.

1. **Index.cshtml:** replace the eager module tag with a same-position loader that preserves cache-busting:
   ```html
   <script>
       // Lazy 3D: the module graph (three.js + addons + models) only loads when the
       // Room Scene panel is actually shown. asp-append-version is captured here
       // because dynamic import() bypasses TagHelpers.
       window._rs3dEnsure = (function () {
           var p = null;
           return function () {
               return p || (p = import('@Url.Content("~/js/room-scene-3d.js")?v=…'));
           };
       })();
   </script>
   ```
   For the version query: use the same mechanism the project uses elsewhere, simplest is `asp-append-version` on a `<link rel="modulepreload">`-style hidden element or compute via `IFileVersionProvider` — if that fights you, an acceptable fallback is a manual cache-bust constant bumped on change (note it in the patch summary). Keep the importmap `<!script>` opt-out block exactly as is.
2. **room-scene.js:** `_applyMode` — when `_wantGl()` is true, the panel stage exists, **and the panel is not widget-hidden**, call `window._rs3dEnsure().then(function(){ _applyMode(); })` when `window.RS3D` is missing (guard against loops: only re-call after the import resolves; on import failure `_showGlError`). Determine widget-hidden via `document.getElementById('roomScenePanel')` having `display:none` or by reading `es_widgetLayout` — prefer the DOM check (single source of truth after P6).
3. **room.js:** in `_widgetShow` (~:3792), after un-hiding, if `srcId === 'roomScenePanel'` and `window.RoomScene` exists, trigger a re-apply (call `RoomScene.render()` — and expose/init path: simplest is `RoomScene.init('roomScenePanel')`-safe re-entry or a new small `RoomScene.ensureStarted()`; pick the minimal hook that gets `_applyMode` to run and lazy-load to fire).
4. Late participant data: SignalR state can arrive before the module loads — `room-scene.js` already buffers `state.participants`/`state.roomState` and pushes them on `RS3D.init` (`_applyMode` → `RS3D.syncParticipants`), so no extra buffering needed; verify.

**Acceptance:**
- Fresh profile (panel hidden by P6): DevTools Network on room load shows **no** request for `room-scene-3d.js`, `three.module.js`, or any `/lib/three/`, `/models/`, `/textures/` asset.
- Reveal the panel (Settings → panels → Show, or the P6 chip) → module graph loads once, scene initialises, participants/claims appear correctly (compare with a second browser).
- Profile with the panel visible: scene works as before (loads on page load via `_applyMode`).
- 2D/3D toggle, walk mode, whiteboard all functional after lazy init.
- What's New entry added.

---

## P8 — Reset Room button ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js` (new `resetRoom()` + export), `Views/Shared/_Layout.cshtml` (button in Room Designer offcanvas, near the furniture panel button ~:3095)
**Do NOT:** add new hub methods (reuse existing broadcast channels), reset **personal** fields (keyBindings, walkSpeed, walkCameraMode, lookSensitivity, invertY, mode), touch chair claims (people stay seated).

1. Implement `RS3D.resetRoom()`:
   - `resetFurniture()` (exists ~:4899 — already rebuilds + broadcasts).
   - Clear position overrides: `_chairPos = {}`, `_decorPos = {}`, and the table offset (find via `_tableOffset()` usages — reset whatever backs it), then persist + broadcast each through the same paths their drag handlers use (search for the save/broadcast calls in the chair/decor/table drag-end code, e.g. `_saveChairPos`-equivalents near :1621/:1651).
   - Reset **shared** config fields to defaults: take `RoomSceneStore.SHARED_FIELDS` (room-scene-store.js :29), build a patch from `DEFAULT_CONFIG` values (room-scene.js :9 — replicate the literals or expose a getter; do not import private state), and call `RoomScene.updateConfig(patch)` (non-silent → persists, broadcasts, refreshes — room-scene.js ~:261).
2. Button in the Room Designer offcanvas: `↺ Reset room to defaults` with `confirm('Reset the room layout and design for everyone?')` guard, calling `window.RS3D ? RS3D.resetRoom() : RoomScene.updateConfig({…})` — if RS3D isn't loaded (P7 hidden case) the designer isn't reachable anyway; a plain `window.RS3D && RS3D.resetRoom()` is fine.
3. Anyone may reset (consistent with other 👥 shared room settings; settings-lock already gates the designer where applicable — do not add a separate host check).

**Acceptance:**
- Drag the table, some chairs, the whiteboard, a prop; add furniture; change wall colour + window view. Click Reset → defaults restored locally **and** in a second browser; both stay correct after reload (server-persisted config/layout).
- Seated participants remain seated (in default ring positions).
- What's New entry added.

---

## P9 — Room size: add **wide**, make it the default ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`, `wwwroot/js/room-scene.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** resize existing rooms that have an explicitly saved/shared `roomSize`, change `ROOM_H`, rescale furniture.

1. `ROOM_SIZES` (~:30): add `wide: { W: 14, D: 8 }` (panel aspect is wide; same depth as medium so default furniture/props stay in bounds).
2. `_applyRoomSize` fallback (~:38): change `|| ROOM_SIZES.medium` → `|| ROOM_SIZES.wide` (keeps unknown values sane).
3. room-scene.js `DEFAULT_CONFIG.roomSize` :30 → `'wide'`; `syncControls` fallback `state.config.roomSize || 'medium'` (:155) → `'wide'`.
4. _Layout.cshtml `rs-room-size` select (~:3071): add `<option value="wide">Wide (default)</option>` between medium and large (order: small, medium, wide, large).
5. `roomSize` is shared — late joiners receive the room's value over the wire (Feature 6 P2 server-persisted config); only genuinely-new rooms/users land on wide. Default furniture coordinates (`_defaultFurniture` ~:1028, props at ±`ROOM_W/2−0.9`) derive from `ROOM_W/ROOM_D` at build time — verify nothing hardcodes 10×8.

**Acceptance:** fresh profile → room renders 14×8 (visibly wider than deep, fills the panel better); Settings shows "Wide (default)" selected; a room whose config says `medium` still renders 10×8 for everyone; resizing live re-clamps furniture (existing refreshScene behaviour). What's New entry added.

---

## P10 — 2D top-down camera follows the avatar when zoomed ✅ DONE

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** change ortho zoom limits, break manual panning, follow anything in 3D/orbit mode.

Behaviour (Kumospace-style): in 2D top-down, when zoomed in past ~1.15 and my avatar exists (roaming, click-to-walk gliding, or seated), gently keep the avatar in frame; manual pan temporarily overrides until the avatar moves again.

1. State: `var _topFollow = { suspended: false };`. Suspend on user pan: OrbitControls fires `start`/`change` on drag — hook the controls `'start'` event (or `_onLookDown`-equivalent pointer path for the top view) when `_view==='top'` to set `suspended = true`. Clear suspension whenever my avatar's position changes by more than ~0.05 in a tick (they started moving again).
2. In `_tick`, when `_view === 'top' && _camera === _orthoCam && _orthoCam.zoom > 1.15 && !_topFollow.suspended`: find my position (`_roamers[_myCid()]` x/z, else my claimed chair via `_chairPos[_myChairIdx]`/seat positions — reuse `_myStartPos()` ~:3592). Lerp **both** `_controls.target` x/z and the camera x/z toward it by `Math.min(1, dt*4)`, preserving the camera's y and the target's y, then `_controls.update()`. Clamp the target inside `±(ROOM_W/2)`/`±(ROOM_D/2)` minus the visible half-extent so the view doesn't pan past the walls (visible half-extent = frustum half-size / zoom — see `_setOrthoFrustum` ~:150 for the frustum variables).
3. When zoom ≤ 1.15 the whole room fits — do nothing (also reset `suspended = false` there so the next zoom-in starts following).

**Acceptance:**
- 2D view, zoom in (mouse wheel), arrow-key steer (P7 top-steer) across the room → the viewport glides to keep the avatar in frame; click-to-walk likewise.
- Drag-pan while zoomed → view stays where the user put it; steer again → follow resumes.
- Zoomed out fully → no camera drift. 3D mode unaffected. Two-browser: remote movement does **not** drag my viewport (only my own avatar is followed).
- What's New entry added.

---

## Appendix A — wiring quick-reference (verified 2026-06-11)

- **Module:** `wwwroot/js/room-scene-3d.js` (~4,976 lines, ES module, exposes `window.RS3D`). Orchestrator: `wwwroot/js/room-scene.js` (`window.RoomScene`); store: `room-scene-store.js` (`RoomSceneStore`, `SHARED_FIELDS` at :29); network shims: `RoomSceneNet.*` in `room.js` (search `RoomSceneNet =`).
- **Walk mode:** `_enterWalk`/`_exitWalk`/`_updateWalk`/`_walkInteract` (room-scene-3d.js ~:2346–2650). `_walk.yaw` is **camera convention** (forward = `(sin yaw, −cos yaw)`); roamer/wire yaw is **front-follows-travel** (`atan2(dx,dz)`, robot front = local +Z).
- **Roamers:** `_makeRoamer`/`applyAvatarMove`/`clearRoamer`/`_refreshRoamers`/`_updateRoamers` (~:3545–3800). Keyed by SignalR connectionId; `ROOM_CONFIG.connectionId` set in room.js ~:151.
- **Widget system:** room.js ~:3228–4422; layout in localStorage `es_widgetLayout`; `_widgetClose`/`_widgetShow`; registry incl. `roomScenePanel` at ~:4359.
- **Scene config:** defaults room-scene.js :9–40 (`es_roomSceneConfig`); shared fields broadcast + server-persisted (Feature 6 P2); personal fields stay local.
- **CSS2D:** vendored `wwwroot/lib/three/CSS2DRenderer.js`; renderer-managed `display` at :232; orphaned elements persist after `scene.remove` — always `element.parentNode.removeChild(element)` when retiring a CSS2DObject.
- **Three.js loading:** Index.cshtml :454–465 (importmap with `<!script>` TagHelper opt-out + module script).
- **What's New:** `Views/Shared/_Layout.cshtml` — search `What's New` / the changelog `<p class="mb-2"><strong>` blocks; prepend the newest dated entry.
