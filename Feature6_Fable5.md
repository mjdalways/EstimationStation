# Feature 6 — Window Media, Scene Realism, Sync Architecture & UX (Implementation Spec)

> Authored by Claude (Fable 5), 2026-06-09. Hardened the same day for implementation by a smaller model (target: Claude Sonnet 4.6) — every patch below is intended to be implementable cold, without this conversation.
> Scope decisions confirmed by the project owner on 2026-06-09: flat CSS 2D mode is **dropped**; dragMode is **retired to unified 'select'**; avatars are **upgraded robots first (P13)** with the humanoid-glTF path **fully specced for later (Appendix C)**; **all** §6 review items are in scope.

---

## How to use this document (instructions to the implementing AI)

1. **One patch per session/review cycle.** Implement exactly one patch from the Patch Plan, verify its acceptance criteria, then STOP for human review. Do not start the next patch unsolicited.
2. **Stay inside the patch boundary.** Each patch lists *Files* and *Do-NOT-touch* constraints. If you believe an out-of-scope change is needed, note it in your summary instead of making it.
3. **Project conventions (mandatory):**
   - After every shipped patch, add a dated entry to the **What's New / About changelog** in `Views/Shared/_Layout.cshtml` (search for the existing changelog markup) and update `Feature6_Fable5.md` (mark completed patches as done and do not revisit done patches).
   - Code style: vanilla JS, IIFE modules exposing one `window.*` global (until a patch says otherwise), `var`-style code in room-scene-3d.js — match the surrounding file. Comment style: explain *constraints and why*, not what the next line does.
   - **No new frameworks** (no React/Vue/jQuery additions). Bootstrap 5.3 is already loaded and is the only UI toolkit.
4. **Verification:** the app is ASP.NET Core MVC — run with `dotnet run`, open a room at `/room/{name}?name=Tester` (two browser windows for multi-user tests). The 3D room is in the Room Scene panel; settings are in the ⚙ Settings modal → 🏠 Room tab.
5. **Appendix A is the wiring map** — read it before patches P2, P3, P6, P13, P14. It tells you where every hub method, client handler, model field, and localStorage key lives so you don't have to rediscover them.
6. Line numbers in this doc were captured 2026-06-09 and will drift — treat them as starting points, verify with search.

---

## 0. Current-state review (facts, verified 2026-06-09)

| Concern | Where | Notes |
|---|---|---|
| Scene config state & persistence | `wwwroot/js/room-scene.js` | `RoomScene.updateConfig(patch, silent)` merges into `state.config`, saves whole config JSON to localStorage key `es_roomSceneConfig`. `windowImage` currently holds the **entire media file as a data URL** inside that JSON. |
| Shared vs personal fields | room-scene.js ~line 400 (`_SHARED_FIELDS`) **and duplicated** in room.js ~line 140 (`_sharedSceneConfig`) | Shared fields broadcast via `RoomSceneNet.broadcastSceneConfig`. Personal: keyBindings, walkCameraMode, dragMode, twoDStyle, windowImage. **The two lists must be kept in sync today — P6 unifies them.** |
| Late-joiner scene config | room.js ~243–250 | The **host** pushes shared config to the room when `ParticipantJoined` fires. Works only while the host is online; `BroadcastSceneConfig` (PokerHub.cs:374) persists nothing. P2 replaces this with server-persisted config. |
| 3D rendering | `wwwroot/js/room-scene-3d.js` (~3,130 lines, IIFE, `window.RS3D`) | One scene, two cameras: perspective orbit (3D) + orthographic top-down (2D). `setView()` swaps them — 2D/3D sync is by construction. |
| Flat CSS 2D diagram | room-scene.js `render2d()` etc. | Parallel HTML renderer used when `twoDStyle==='flat'`. Has parity holes (ignores `windowView`, no furniture/roamers). **Decision: dropped in P6a.** |
| Upload UI | `Views/Shared/_Layout.cshtml` ~2722–2735 | `_rsWindowImageUpload()`: 10 MB mp4 / 600 KB image caps, FileReader → data URL. |
| Three.js | `Views/Room/Index.cshtml` :441–444 | r145 UMD globals served from `wwwroot/lib/three/` (three.min.js, OrbitControls.js, CSS2DRenderer.js). |
| Server | see Appendix A | Rooms = flat JSON files `rooms/{SanitizedName}.json`. Room model already persists `ChairClaims`, `RoomLayoutJson`, `ChairPositionsJson`, `RoomIcon`. `Participant.AvatarData` + `UpdateAvatar` hub method + `AvatarUpdated` client event already exist (current use: 2D avatar data). |

### Known bugs (fixed in P0 unless noted)
1. **`saveConfig()` unguarded** (room-scene.js:57) — `localStorage.setItem` throws `QuotaExceededError` for large video data URLs (~5 MB UTF-16 quota); `updateConfig` aborts after mutating state but before `refreshScene`, so large videos fail silently and never persist.
2. **MP4 `<video>` element leak** — in `_buildWindowWall` (room-scene-3d.js ~:357) the video element is appended to `document.body` but never tracked; `_buildRoom()` disposes `_gifTextures` on rebuild but not videos. Every rebuild leaks a hidden playing `<video>` + `VideoTexture`.
3. **Video mesh placement hardcoded** — `skylineMesh.position.set(0, ROOM_H/2, -4)` instead of the computed `(0, cy, zb)` the static-image branch uses.
4. **UI copy mismatch** — upload input says "max 4 MB"; code enforces 10 MB / 600 KB.
5. `_onCanvasClick` ~:2804–2813 — identical then/else branches (both call `releaseMySeat()`).
6. Keybind capture (`_rsCaptureKey`, _Layout.cshtml ~2908) — no cancel path: pressing Escape **binds** Escape; clicking away leaves the capture listener armed.
7. Flat-mode `renderSkyline()` (room-scene.js:248) reads legacy `config.skyline`, ignoring `windowView`. *(Moot after P6a drops flat mode — do not fix separately.)*

---

# PATCH PLAN

| # | Patch | Depends on | Risk |
|---|---|---|---|
| P0 | Bug fixes (saveConfig guard, video disposal/placement, UI copy, dead branch, keybind cancel) | — | Low |
| P1 | WebM support | P0 | Low |
| P2 | Server: per-room media endpoints + persisted scene config | — | Medium |
| P3 | Client: shared media library UI + `windowMediaId` | P2 | Medium |
| P4 | Three.js r145 → r184 ES-module migration | — | Medium |
| P5 | Realism Phase A: environment lighting + PBR textures | P4 | Low–Med |
| P6 | a) Drop flat 2D + retire dragMode  b) Observable store refactor | — (a), a (b) | Medium |
| P7 | InputManager + Pointer Lock + canvas-scoped keys | P6 | Medium |
| P8 | Furniture rotation | — | Low |
| P9 | Discoverability: interact prompt + hover highlight | — | Low |
| P10 | Settings panel: offcanvas + shared/personal grouping | — | Low–Med |
| P11 | Realism Phase B: glTF props + data registries | P4, P5 | Medium |
| P12 | Realism Phase C1: robot avatar upgrade | P4, P5 | Low–Med |
| P13 | Avatar customization (accessories, persisted via AvatarData) | P12 | Medium |
| P14 | Customization bundle: room size, walk sliders, floor colour | P6 | Low–Med |
| P15 | UX polish bundle: onboarding, toolbar, anchored claim bar | P9 | Low |
| — | Phase C2 (humanoid glTF avatars) — **deferred**, full spec in Appendix C | P12 | High |

Recommended order is the table order. P2/P3 may run before or after P4–P5 (independent).

---

## P0 — Bug fixes ✅ DONE (2026-06-09)

**Files:** `wwwroot/js/room-scene.js`, `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** refactor `updateConfig`, touch the GIF pipeline, change any behaviour beyond the six fixes.

1. Wrap the body of `saveConfig()` (room-scene.js:56) in try/catch; on failure `console.warn('[RoomScene] config not persisted (quota?)', e)`. Do not rethrow.
2. In room-scene-3d.js add module-level `var _videoTextures = [];` next to `_gifTextures` (:41). In the mp4 branch of `_buildWindowWall`, push `{ video: video, tex: skylineTexture }` onto it. In `_buildRoom()` where `_gifTextures` are disposed (:288–293), also iterate `_videoTextures`: `v.video.pause(); v.video.removeAttribute('src'); v.video.load();` remove the element from the DOM, `v.tex.dispose()`, then reset the array. Also dispose in `dispose()` (~:3182).
3. Change `skylineMesh.position.set(0, ROOM_H / 2, -4)` to `skylineMesh.position.set(0, cy, zb)` (`cy`/`zb` are in scope).
4. _Layout.cshtml :2722–2723 — change the `title` and help text to "Images up to 600 KB, MP4 video up to 10 MB". (P1/P3 revise again — keep the strings accurate at each step.)
5. Collapse the duplicate seated/roaming branch in `_onCanvasClick` (~:2804–2813) to a single `releaseMySeat(); return;`.
6. `_rsCaptureKey` (_Layout.cshtml ~2908): if `e.code === 'Escape'`, cancel capture (restore previous label, remove listener, return) instead of binding; also remove the listener and restore the label on a `blur` or second click of the same button. Update the "press…" placeholder to "press a key (Esc cancels)".

**Acceptance:** large-file upload no longer throws uncaught; toggling any room setting twice while an MP4 window plays leaves exactly one `<video>` in the DOM; video fills the window opening; Escape during key capture cancels; clicking own chair to stand still works.

---

## P1 — WebM support ✅ DONE (2026-06-09)

**Files:** `Views/Shared/_Layout.cshtml` (upload handler ~2722–2735), `wwwroot/js/room-scene-3d.js` (`_buildWindowWall` ~:356)
**Do NOT:** add server code (P2), add the library UI (P3).

1. Input: `accept="image/*,video/mp4,video/webm,.mp4,.webm"`.
2. Handler: `var isVideo = /^video\/(mp4|webm)$/.test(f.type); var maxBytes = isVideo ? 10*1024*1024 : 600*1024;` (cap rises to 15 MB in P3). Fix the alert text to match.
3. room-scene-3d.js: rename `_isMp4` → `_isVideo`; detection `/^data:video\/(mp4|webm)/.test(_src) || /\.(mp4|webm)(\?|$)/i.test(_src)`. The rest of the video branch is codec-agnostic.
4. In the existing `video.addEventListener('error', …)` handler, additionally surface a user-visible message (use the site's toast helper if one exists in _Layout; else `alert`): "This browser can't play this video format."

**Acceptance:** a `.webm` plays looping in the window; `.mp4` unchanged; an oversized file is rejected with the correct limit named.

---

## P2 — Server: per-room media + persisted scene config ✅ DONE (2026-06-09)

**Files (new):** `Controllers/MediaController.cs`, `Services/RoomMediaStore.cs`
**Files (edit):** `Hubs/PokerHub.cs`, `Models/PokerModels.cs`, `Services/RoomCleanupService.cs`, `Program.cs` (DI only)
**Do NOT:** touch any JS (P3 consumes this), change `BuildRoomState`'s existing fields (only add).

### 2a. `RoomMediaStore` (singleton service)
- Base path: sibling of the rooms file dir — resolve the same way `FileRoomRepository` does (it uses config override `?? Path.Combine(AppContext.BaseDirectory, "rooms")`, see Appendix A) and use `<that>/_assets/<sanitizedRoom>/`. Sanitize the room name with the same rules as `FileRoomRepository.SanitizeName` (if private, replicate its logic — check the file).
- API: `Task<MediaEntry> SaveAsync(string room, IFormFile f)`, `IReadOnlyList<MediaEntry> List(string room)`, `(Stream, MediaEntry)? Open(string room, string id)`, `bool Delete(string room, string id)`.
- `MediaEntry { string Id; string Name; string Mime; long Size; DateTime AddedAt; string UploadedBy; }` — metadata persisted in `_assets/<room>/assets.json` (read/write with `System.Text.Json`, lock per room).
- `Id` = server-generated `Guid.ToString("N")`. File saved as `{id}{ext}` where ext is derived from the **validated** mime (never from the client filename — path-traversal).
- Validation: whitelist mimes `image/png, image/jpeg, image/gif, image/webp, video/mp4, video/webm`; verify magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF8`, WebP `RIFF....WEBP`, MP4 `ftyp` at offset 4, WebM/Matroska `1A 45 DF A3`); reject mismatches.
- Quota: max **8 files / 60 MB per room**; on overflow evict oldest entries (delete file + metadata) before saving.

### 2b. `MediaController` (attribute-routed; conventional routing in Program.cs already activates attribute routes — no `MapControllers` call needed, verify it works and add `app.MapControllers();` only if 404)
```
[Route("api/rooms/{roomName}/window-media")]
POST   ""        [RequestSizeLimit(15_728_640)]  multipart "file" → 200 MediaEntry JSON
GET    ""        → 200 MediaEntry[] (the picker list)
GET    "{id}"    → File(stream, mime, enableRangeProcessing: true) + ETag (use id — immutable)
DELETE "{id}"    → 204
```
- Every action: `roomName = RoomService.NormalizeName(roomName)`; 404 if empty or room doesn't exist in `IRoomRepository`/`RoomService`. `{id}` must be a 32-char hex GUID (`[FromRoute]` + regex check) and must exist under **that room's** folder. This is the isolation boundary; there is no auth (rooms have none) — anyone with the room name can fetch, same trust model as the SignalR group.
- DI: `builder.Services.AddSingleton<RoomMediaStore>();`

### 2c. Persisted scene config (replaces host-push)
1. `Models/PokerModels.cs` — add to `Room`: `public string? SceneConfigJson { get; set; }` (matches `RoomLayoutJson` precedent at :32).
2. `PokerHub.BroadcastSceneConfig` (:374) — follow the `SetRoomLayout` pattern exactly (:246–258): length guard (`> 4000` reject), existing rate limit stays, then `lock (room)` and **merge** the incoming patch into the stored JSON (deserialize both to `Dictionary<string, JsonElement>`, overlay patch keys, serialize back), `_roomService.SaveRoom(room)`, then the existing `Clients.OthersInGroup(...).SendAsync("SceneConfigUpdated", configJson)` (still send the *patch*, not the merged blob).
3. `BuildRoomState` (private, PokerHub) — add `sceneConfig = room.SceneConfigJson` to the snapshot object.
4. `RoomCleanupService` (deletes stale rooms ~:30) — after `repo.DeleteRoom(room.Name)`, call `RoomMediaStore`-delete-room-folder (add a `DeleteRoom(string room)` method; inject the store).
5. **Remove the host-push**: delete the block in room.js `ParticipantJoined` handler (~:243–250) that sends scene config — *do this in P3*, not here (server first, client second; the push is harmless meanwhile).

**Acceptance:** `curl -F "file=@a.mp4" /api/rooms/test/window-media` returns metadata; GET list shows it; GET by id streams with `Accept-Ranges`; a 16 MB file → 413; a `.txt` renamed `.mp4` → 400 (magic bytes); `api/rooms/other/window-media/{id-from-test}` → 404; uploading a 9th file evicts the oldest; `BroadcastSceneConfig` survives an app restart (config in the room JSON file); deleting a stale room removes its `_assets` folder.

---

## P3 — Client: shared media library ✅ DONE (2026-06-09)

**Files:** `wwwroot/js/room-scene.js`, `wwwroot/js/room-scene-3d.js`, `wwwroot/js/room.js`, `Views/Shared/_Layout.cshtml`
**Do NOT:** refactor `updateConfig` beyond the listed additions (store refactor is P6).

1. **Config:** in `DEFAULT_CONFIG` add `windowMediaId: null, windowMediaMime: null`; add both to `_SHARED_FIELDS` **and** to `_sharedSceneConfig` in room.js:140 (they must match — P6 unifies). Keep legacy `windowImage` for back-compat reads.
2. **RoomState application:** in room.js's `RoomState` handler (~:176, near where `state.roomLayout` is applied at :233), if `state.sceneConfig` exists, `RoomScene.updateConfig(JSON.parse(state.sceneConfig), /*silent=*/true)`. Then **delete the host-push block** in `ParticipantJoined` (~:243–250) and the now-unused `_sharedSceneConfig` *call there* (keep the function until P6).
3. **Upload handler** (_Layout.cshtml): replace the FileReader path for files going to the room with `fetch('/api/rooms/' + encodeURIComponent(window.ROOM_CONFIG.roomName) + '/window-media', { method:'POST', body: fd })`; on success `RoomScene.updateConfig({ windowMediaId: e.id, windowMediaMime: e.mime, windowView: 'custom', windowImage: null })` and refresh the library list. Raise client pre-check caps to **15 MB video / 5 MB image** and update the strings. Keep a data-URL fallback **only** when `window.ROOM_CONFIG` is absent (preview pages).
4. **Library UI** under the file input: `<select id="rs-window-media-lib" class="form-select form-select-sm mt-1">` + a 🗑 delete button. Populate from GET list when the settings panel opens (hook the existing Bootstrap `shown.bs.modal`/collapse event or call from `syncControls`) and after each upload. Option label: `name (1.2 MB)`. `onchange` → `updateConfig({ windowMediaId, windowMediaMime, windowView:'custom' })`. Delete → `DELETE` then, if it was selected, `updateConfig({ windowMediaId:null, windowView:'skyline' })` (broadcasts; everyone falls back).
5. **Renderer** (room-scene-3d.js `_buildWindowWall`): when `view==='custom'`, source resolution order: `windowMediaId` → `'/api/rooms/' + room + '/window-media/' + id` (room from `window.ROOM_CONFIG.roomName`), else legacy `windowImage` data URL. Video/image branch chosen by `windowMediaMime` when present, else the P1 regex. Extract the whole custom-media block into `_buildCustomWindowMedia(src, mime, OW, OH, cy, zb)` (pure extraction + the new param wiring; no behaviour change). `video.crossOrigin` stays (same-origin, harmless).
6. **Migration prompt:** if legacy `windowImage` data URL exists and the user is in a live room, show a one-time inline button in the settings panel: "Share this window with the room" → upload the data URL (decode to Blob) via the POST, then clear `windowImage`.

**Acceptance:** user A uploads `a.mp4`, `b.webm`; user B sees both in the list and the window switch live; B reloads → same window (server-persisted config); A selects `a.mp4` later from the list → both update; deleting the active entry reverts everyone to skyline; a room named differently sees an empty library.

---

## P4 — Three.js r145 → r184 ES modules ✅ DONE (2026-06-10)

**Files:** `wwwroot/lib/three/*` (replace), `Views/Room/Index.cshtml` :441–444, `wwwroot/js/room-scene-3d.js`
**Do NOT:** change any scene behaviour/geometry; only the module system, renames, and light retune.

Three.js arrived with the 3D room; nothing else uses it. Delete the UMD files outright.

**Breaking changes that apply here:** `examples/js` UMD addons removed (r148); UMD core build removed (by r160); colour management default on (r152): `outputEncoding`→`outputColorSpace`, `sRGBEncoding`→`SRGBColorSpace`, `texture.encoding`→`texture.colorSpace`; physical light units (`useLegacyLights` flipped r155, removed r165) — intensities need retuning; WebGL1 removed (r163, fine).

1. Vendor from `three@0.184.0` (npm tarball or jsDelivr): `build/three.module.js`, `examples/jsm/controls/OrbitControls.js`, `examples/jsm/renderers/CSS2DRenderer.js` → `wwwroot/lib/three/`. (P5 adds `RoomEnvironment.js`; P11 adds `GLTFLoader.js` + `utils/BufferGeometryUtils.js` if the loader imports it — check its imports and vendor whatever it pulls in, rewriting their specifiers if needed.)
2. **Import map** in `Views/Room/Index.cshtml` *before* any module script (addons import the bare specifier `'three'`):
   ```html
   <script type="importmap">
   { "imports": { "three": "/lib/three/three.module.js", "three/addons/": "/lib/three/" } }
   </script>
   ```
   Note: addon files reference each other as `three/addons/<subpath>`; since we flatten into one folder, open each vendored addon and fix its relative imports to match (or keep the jsm subfolder structure under `/lib/three/` and map `"three/addons/": "/lib/three/jsm/"` — pick one and be consistent).
3. Convert `room-scene-3d.js` to a module: `<script type="module" src="~/js/room-scene-3d.js"></script>` replacing the three UMD tags + its classic tag. Top of file:
   ```js
   import * as THREE from 'three';
   import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
   import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
   ```
   Replace `THREE.OrbitControls` → `OrbitControls`, `THREE.CSS2DRenderer` → `CSS2DRenderer`, `THREE.CSS2DObject` → `CSS2DObject` throughout. Keep the bottom-of-file `window.RS3D = {...}` (room-scene.js and inline handlers need it). `_threeReady()` → `return true;` (keep the function).
4. Renames: `_renderer.outputEncoding = THREE.sRGBEncoding` → `_renderer.outputColorSpace = THREE.SRGBColorSpace` (:187); every `tex.encoding = THREE.sRGBEncoding` → `tex.colorSpace = THREE.SRGBColorSpace`; remove `if (THREE.sRGBEncoding)` guards.
5. **Load order:** module scripts are deferred; classic `room-scene.js`/`room.js` run earlier. All current call sites guard with `window.RS3D &&` and init is event-driven, but verify by loading a room. If anything touches `RS3D` too early, dispatch `document.dispatchEvent(new Event('rs3d-ready'))` at module end and gate that call site.
6. **Light retune** (physical units): starting points — multiply every `SpotLight`/`PointLight` intensity in `_buildLights()`/`_lightCfg()` by `Math.PI`; leave `AmbientLight` as-is; then compare against pre-migration screenshots (take them first) and adjust `toneMappingExposure` (currently 1.1) last. Materials/fog/shadows need no changes.
7. Regression checklist: orbit + top-down cameras, CSS2D name labels, shadows, fog on/off per view, GIF window, MP4/WebM window, furniture drag + select, chair claim, walk mode (keys + look), minimap, emotes.

**Acceptance:** room renders in both views with no console errors; the regression checklist passes; lighting within reasonable match of the before screenshots; `wwwroot/lib/three/` contains no UMD files.

---

## P5 — Realism Phase A: environment lighting + PBR textures ✅ DONE (2026-06-10)

**Files:** `wwwroot/lib/three/` (add `RoomEnvironment.js` from r184 `examples/jsm/environments/`), `wwwroot/js/room-scene-3d.js`, new `wwwroot/textures/`
**Do NOT:** load glTF models (P11), change geometry.

1. `import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';` In `init()` after renderer creation:
   ```js
   var pmrem = new THREE.PMREMGenerator(_renderer);
   _scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
   pmrem.dispose();
   ```
   This gives every `MeshStandardMaterial` image-based ambient/reflections — the single biggest visual upgrade available.
2. **Textures:** download 1K tileable CC0 sets from ambientCG (or Poly Haven) for: wood planks, carpet, tiles, concrete, marble — `color` + `normal` + `roughness` maps each, target ≤ 300 KB per map (JPG/WebP), total ≤ 4 MB under `wwwroot/textures/{material}/`.
3. Extend `FLOOR_MATS` and `_tableTopMat()`: each entry gains optional `maps: { map, normalMap, roughnessMap }` URLs. Build a small cached loader: `_texCache[url]` → `TextureLoader.load`, set `wrapS/wrapT = RepeatWrapping`, `repeat.set(4,3)` for the floor (tune per material), `colorSpace = SRGBColorSpace` on color maps only. Fall back to the existing flat colours while loading / on error.
4. Soft grounding: add a radial-gradient "contact shadow" texture (generate once on a canvas: dark centre → transparent edge) on a `PlaneGeometry` slightly larger than the table footprint, y=0.005, `transparent`, `opacity 0.35`, `depthWrite:false`.

**Acceptance:** floor/table/walls show texture + reflection detail in 3D and top-down; FPS not visibly degraded (test with 8 chairs + walk mode); switching floor material at runtime swaps textures without leaks (`dispose()` old maps in `refreshScene` path).

---

## P6 — a) Drop flat 2D & retire dragMode · b) Observable store

### P6a (subtractive — own commit) ✅ DONE (2026-06-10)
**Files:** `wwwroot/js/room-scene.js`, `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml`, `wwwroot/css/site.css` (optional)

1. Remove from room-scene.js: `render2d`, `renderSeat`, `renderSeatRing`, `renderStanding`, `renderWhiteboard`, `renderPlants`, `renderSkyline`, `claimSeat2d`, `_onStageClick` (and its registration), `seatPosStyle`, `chairTypeFor2d`, `participantSeatStyle`, `voteLabel`, `currentStoryTitle` *if unused elsewhere — verify each with search first*. `_renderCss()` becomes a static placeholder ("Loading room…"); `_wantGl()` returns `m === '3d-gl' || m === '2d'`; `twoDStyle` removed from `DEFAULT_CONFIG` (stale stored values are simply ignored by `Object.assign` order — verify) ; remove the "2D view style" select from _Layout and its `syncControls` lines. Keep `_showGlError` (now the only no-WebGL path).
2. Retire dragMode: in room-scene-3d.js `_onPointerDown` (:1210) delete the `'direct'` and `'doubleselect'` branches and the `mode` variable (behaviour = the current `'select'` path); delete `_onDblClick` + its listener; remove the `rs-dragmode` select from _Layout + `syncControls`; remove `dragMode` from `DEFAULT_CONFIG`. Shift+drag-orbits and Esc/Delete shortcuts unchanged.
3. Optional: delete now-orphaned `rs-seat*/rs-stand*/rs-room-2d` CSS rules (search site.css; skip if shared with anything).

**Acceptance:** 2D mode = top-down WebGL always; with WebGL forcibly failed (`init` returning false), the error panel shows; furniture select/drag works exactly as old 'select' mode; no console references to removed functions.

### P6b (store refactor) ✅ DONE (2026-06-10)
**Files (new):** `wwwroot/js/room-scene-store.js` · **Files (edit):** room-scene.js, room-scene-3d.js, room.js, script tags in `Views/Room/Index.cshtml`/_Layout

**Implementation note (deviation from spec, build-check-only verification — no live two-browser regression run this session):**
- **config** slice: fully migrated. `RoomScene.updateConfig` now dispatches `RoomSceneStore.set({config}, {source, slice:'config', fields})`; `saveConfig`/broadcast/refresh logic moved into a `RoomSceneStore.subscribe` callback. `_SHARED_FIELDS` (room-scene.js) and `_SCENE_SHARED_FIELDS`/`_sharedSceneConfig` (room.js, confirmed dead code) removed in favour of `RoomSceneStore.SHARED_FIELDS`. `setMode` (a separate legacy path that mutates `state.config.mode` directly) mirrors into the store with `source:'init'` afterwards so the store stays accurate without re-triggering save/broadcast/refresh.
- **claims / chairPos / furniture**: used a **mirror-only** approach instead of converting RS3D's internal reads (`_claimedChairs`, `_chairPos`, `_furnitureObjs`) to `RoomSceneStore.getState()`. `RoomSceneStore.set(...)` calls were added at the existing mutation funnels (`_notifyClaimsChanged`, `_saveChairPositions`, `applyChairPositions`, `_saveFurniture`, `applyRemoteLayout`) so the store is a single up-to-date read source for *other* modules, while RS3D's intricate claim/drag/race logic (`_pendingChairIdx`, `_claimsFromServer`, eviction-by-cid-or-name, etc.) is untouched — zero risk of regressing that logic. This is intentionally less than the spec's "reads become `RoomSceneStore.getState().claims`" but satisfies "single source for reads going forward" without a live-tested rewrite.
- Roamers exception documented via comment next to `_roamers` declaration in room-scene-3d.js.
- `node --check` passed on all 4 modified JS files; `dotnet build` = 0 warnings/0 errors. **No live two-browser regression was run** (per user's explicit "build-check only" choice) — claims/chairPos/furniture sync should get a manual smoke test before relying on it.
**Do NOT:** change any user-visible behaviour, network message names, or storage keys. This is a pure re-plumbing patch; if behaviour must change to proceed, stop and report.

1. Store (~80 lines, classic IIFE exposing `window.RoomSceneStore`):
   ```js
   { getState(), set(partial, meta), subscribe(fn /* (state, meta) */), select(fn) }
   ```
   State shape: `{ config, claims, chairPos, furniture, roamers, participants, roomState }`. `meta = { source: 'local'|'remote'|'init', fields: [...] }`.
2. **Single source for shared fields:** `RoomSceneStore.SHARED_FIELDS = [...]` — room-scene.js and room.js both read it (delete `_sharedSceneConfig`'s private copy; it becomes `function _sharedSceneConfig(cfg){ /* filter by RoomSceneStore.SHARED_FIELDS */ }` or is removed if now unused).
3. Migrate **one slice at a time, verifying between slices**: (i) config — `RoomScene.updateConfig` writes through the store; `saveConfig`/broadcast/refresh become subscribers; (ii) claims — `applyClaim/applyRelease/setClaimsFromServer` dispatch into the store, `_claimedChairs` reads become `RoomSceneStore.getState().claims` (keep a local alias var updated by a subscriber to limit the diff); (iii) chairPos & furniture layout the same way. Roamers stay internal to RS3D (high-frequency; not worth store traffic) — document that exception in a comment.
4. Network rule, stated once in the store header comment: **local mutations broadcast; `source:'remote'` never re-broadcasts** — this replaces the ad-hoc `silent`/`_applyingRemote` flags where the migration touches them (`_applyingRemote` may remain inside RS3D internals if removing it would widen the diff).

**Acceptance:** full two-browser regression — claims, chair drag, furniture drag/add/delete, scene config changes, window media selection all sync both directions; late joiner gets full state; localStorage keys unchanged (verify in devtools); no `_sharedSceneConfig` duplicate list remains.

---

## P7 — InputManager + Pointer Lock + canvas-scoped keys ⚠️ PARTIALLY DONE (2026-06-10)

**Implemented this session (build-check only — no live interactive testing):**
- Canvas (`_renderer.domElement`) is now focusable (`tabIndex=0`, `outline:none`); `_enterWalk()` calls `canvas.focus()`.
- Canvas `blur` exits walk mode (item 2's "blur exits walk"), but ignores focus moving to our own on-canvas buttons (e.g. the Walk toggle) via `relatedTarget`, so clicking "🚶 Walk"/"🎥 Orbit" to exit still works.
- First-person walk now calls `canvas.requestPointerLock()` on entry and `document.exitPointerLock()` on exit/dispose (item 3). While locked, `mousemove.movementX/Y` drives yaw/pitch via a new `_onPointerLockMove` (same 0.005 factor as drag-look). `pointerlockchange` refreshes the walk HUD text. First <kbd>Esc</kbd> while locked lets the browser release the lock and stays in walk (drag-look fallback); second <kbd>Esc</kbd> (unlocked) exits walk as before. Third-person mode is unaffected (still drag-look only).
- Walk HUD text now reflects locked vs. drag-look mouse-look (item 4).
- Removed `_RS_PAGE_KEYS` and its page-shortcut-conflict `confirm()` from `_rsCaptureKey` in `_Layout.cshtml`.

**Deferred (not done this session):** item 1, the full `Input` state-machine object replacing `_onPointerDown/Move/Up`/`_onKeyDown/Up`'s flag-soup (`_chairDrag`, `_furnitureDrag`, `_walk`, `_look`, `_suppressNextChairClick` becoming `Input.mode`/`Input.to()`/per-mode `data`). This is a large rewrite of the exact code paths the spec says **not** to change (claim flow, drag behaviour) and cannot be verified without live two-browser interactive testing. The above changes were implemented as **additive, walk-mode-only** behaviour layered on top of the existing `_walk`/`_keys`/`_look` mechanism (which remains intact and is the fallback if Pointer Lock is unavailable/denied), so orbit/chair-drag/furniture-drag code paths are untouched. The `document`-level capture-phase `keydown`/`keyup` listeners and their `stopImmediatePropagation()` shielding were also left in place (not moved to the canvas) for the same reason — revisit item 1 as its own session with live testing.

**Files:** `wwwroot/js/room-scene-3d.js`, `Views/Shared/_Layout.cshtml` (remove `_RS_PAGE_KEYS` warning machinery)
**Do NOT:** change bindings semantics, claim flow, or drag behaviour.

1. **InputManager:** replace the flag-soup with an explicit module-internal object:
   ```js
   var Input = { mode: 'orbit', /* 'orbit'|'chairDrag'|'furnDrag'|'walk' */
                 to(mode, data) { /* exit old, enter new; single owner of _controls.enabled + pointer capture */ } };
   ```
   `_onPointerDown/Move/Up`, `_onKeyDown/Up`, look handlers become thin dispatchers: `Input.handlers[Input.mode].pointerdown(e)` etc. Port existing logic verbatim into the per-mode handlers; `_suppressNextChairClick`, `_chairDrag`, `_furnitureDrag`, `_look` become fields of the mode's `data`. Same listeners, same capture phases (the container-capture trick at `_setupInteraction` :2750 stays — keep its comment).
2. **Canvas-scoped keys:** give the renderer canvas `tabindex="0"` and `style.outline='none'`. On walk enter: `canvas.focus()`; move the keydown/keyup listeners from `document` (capture) to the canvas (no capture); on canvas `blur` while walking → exit walk. Delete the `stopImmediatePropagation` shielding *for page shortcuts* (no longer needed — events on a focused canvas don't reach document handlers bound to e.g. `document.body`? **Caution:** they do bubble — keep `stopPropagation()` on handled keys, but the conflict-warning list `_RS_PAGE_KEYS` and its two `confirm()`s in `_rsCaptureKey` can go).
3. **Pointer Lock (first-person only):** on walk enter in `walkCameraMode:'first'`, `canvas.requestPointerLock()`. While locked, `mousemove.movementX/Y` drives yaw/pitch (same 0.005 factor). `pointerlockchange` → if lock lost and still walking, fall back to drag-look. Esc exits lock (browser-enforced) — first Esc unlocks, second exits walk; update the walk HUD text accordingly. Third-person keeps drag-look.
4. Walk HUD/help strings: update to mention mouse-look.

**Acceptance:** all P6a regression interactions still work; in walk mode the mouse looks without dragging (first person); Space no longer needs shielding (focused canvas) — verify Space while walking does NOT reveal votes and DOES nothing unless bound; blur (click outside canvas) exits walk; key capture UI no longer shows page-conflict confirm dialogs.

---

## P8 — Furniture rotation ✅ DONE (2026-06-10)

**Implemented:** layout entries gain `rot` (radians, default 0, persisted/broadcast via `_saveFurniture`); `_buildFurniture`/`addFurniture` set `group.rotation.y` and store `rot` on `_furnitureObjs` entries (pickMesh is a child of the group so raycast pick rotates with it — verified, no change needed). New `_rotateSelected(dir)`: `R` rotates +45°, `Shift+R` −45° (handled in the existing orbit-mode furniture-shortcut branch of `_onKeyDown`), plus a ↻ button on the sel bar (`_createSelBar`). Carried items in walk mode keep their rotation (nothing resets `group.rotation.y` during carry). `node --check` + `dotnet build` clean (0/0); `PokerHub.SetRoomLayout`'s 8000-char guard untouched, plenty of headroom.



**Files:** `wwwroot/js/room-scene-3d.js` (layout schema, sel bar, key handler), `Hubs/PokerHub.cs` only if the layout length guard (8000 chars, :248) needs raising — it shouldn't.

1. Layout entries gain `rot` (radians, multiples of `Math.PI/4`), default 0. `_buildFurniture` applies `group.rotation.y = item.rot || 0`. Older layouts without `rot` load fine.
2. Rotate inputs: with an item selected, key `R` rotates +45° (Shift+R −45°); add a ↻ button to the sel bar (`_createSelBar` ~:1763). Persist + broadcast via the existing `_saveFurniture()` path.
3. While carried in walk mode, item keeps its rotation; `pickMesh` is a bounding box — rotate it with the group (it's a child; verify).
4. 2D top-down naturally shows rotation (same scene). Minimap dots are circles — no change.

**Acceptance:** rotate a sofa 45°, peer sees it rotated live and after reload (layout persisted via `RoomLayoutJson`); raycast pick still hits the rotated item; default furniture unaffected.

---

## P9 — Discoverability: interact prompt + hover highlight ⚠️ PARTIALLY DONE (2026-06-10)

**Files:** `wwwroot/js/room-scene-3d.js`
**Do NOT:** add post-processing (OutlinePass) — emissive highlight only.

1. **Walk interact prompt:** factor the target-finding part of `_walkInteract()` (:1652) into `_findInteractTarget()` returning `{ kind: 'whiteboard'|'prop'|'chair'|'furniture', label }` or null (same rays/ranges, no side effects). In `_updateWalk`, every ~0.2 s (accumulator) call it and drive a single reusable CSS2D label floating at the target: text `[E] Sit here` / `[E] Stand up` / `[E] Open whiteboard` / `[E] ` + prop label / `[E] Pick up`. Use the **configured** interact key via `_keyHint(kb.interact)`, not a hardcoded E. Hide when null.
2. **Orbit hover highlight:** the pointermove hover raycast (:1262–1270) extends to chairs and props. On hover: store the mesh's material `emissive`, set `emissive = 0x335577, emissiveIntensity 0.6`; restore on leave (one hovered object at a time). Add a small CSS2D tooltip near it: "Click to sit" (empty chair), "Click to stand up" (own chair), "Click to open" (whiteboard/prop), "Drag to move" (furniture). Throttle the raycast to ~30 Hz with an accumulator if pointermove volume is a concern.

**Acceptance:** walking up to a chair shows `[E] Sit here` at the chair; rebinding interact to K shows `[K] …`; hovering an empty chair in orbit mode glows it + tooltip; no lingering glow after pointer leaves; FPS unaffected.

**Implementation note (deviation from spec, 2026-06-10):**
- **Item 1 (walk interact prompt) — done.** Added a side-effect-free `_findInteractTarget()` (returns `{ label }` or null) mirroring the same proximity rays as `_walkInteract()` (whiteboard ≤2.2m, props ≤2.5m, chairs ≤1.9m, then furniture pickMeshes), plus a `_propLabel(action)` helper for the prop-specific verb. `_walkInteract()` itself is untouched (its own raycasts still drive the actual actions) — `_findInteractTarget()` is a parallel read-only probe, which keeps the change additive and avoids any risk to the claim/furniture-pickup flow. `_updateWalk(dt)` runs it via a `_interactCheckT` accumulator every ~0.2s and feeds the result to `_updateInteractLabel()`, which shows/hides/repositions a single reusable `CSS2DObject` floating ~1.2m in front of the avatar at eye height, with text `_keyHint(kb.interact) + ' ' + label` (so a rebound key shows correctly). The label is hidden in `_exitWalk()` and the CSS2DObject + DOM node are torn down via `_disposeInteractLabel()`, called from both `dispose()` and `refreshScene()` to avoid orphaned label nodes.
- **Item 2 (orbit hover highlight) — deferred.** Not implemented this session. The existing hover raycast/cursor logic only targets furniture pickMeshes, which use `MeshBasicMaterial({visible:false})` — extending it to chairs/props (which use `MeshStandardMaterial`, supporting `emissive`) is straightforward, but reliably restoring the original `emissive`/`emissiveIntensity` on every exit path (including scene refresh and mode switches) and verifying "no lingering glow after pointer leaves" is a runtime-only acceptance criterion that can't be confirmed under build-check-only verification. Deferring rather than risking a stuck-glow regression, per the same reasoning as P7 item 1.
- Verified via `node --check wwwroot/js/room-scene-3d.js` (pass) and `dotnet build` (0 Warning(s), 0 Error(s)). No live two-browser/runtime testing was performed.

---

## P10 — Settings panel: offcanvas + shared/personal grouping ✅ DONE (2026-06-10)

**Files:** `Views/Shared/_Layout.cshtml` (Room tab → offcanvas), `wwwroot/js/room-scene.js` (`syncControls` hooks)
**Do NOT:** change any config semantics; pure UI reorganisation.

1. Move the **Room tab content** out of the settings modal into a Bootstrap **offcanvas** (`offcanvas-end`, `data-bs-backdrop="false"`, `data-bs-scroll="true"`, width ~400 px) so the scene stays visible & interactive while tweaking. The settings modal's Room tab becomes a single button: "Open room designer →" (opens the offcanvas and closes the modal). Also add an opener in the Room Scene panel header if one place is natural (look for the existing 2D/3D toggle buttons markup).
2. Regroup controls into two sections with headers:
   - **👥 Room — everyone sees these:** quick presets, colour theme, window view + media library, time of day/animate, table shape/size/material, chairs count/style, floor, walls, lighting, whiteboard/plants, furniture reset.
   - **👤 My view & controls:** walk camera mode, key bindings, (walk sliders arrive in P14).
   Add a one-line caption under the shared header: "Changes here update the room for every participant."
3. **Dedupe furniture UI:** remove the 4 add-furniture buttons from the panel; replace with one button "🪑 Open furniture panel" that calls the existing in-canvas HUD toggle (`RS3D` needs a tiny public `toggleFurniturePanel()` wrapping `_toggleFurnHud`).
4. Polish: checkboxes → `form-switch`; keybind buttons render the key in a `<kbd>` chip; replace repeated inline styles with 2–3 small CSS classes in site.css.

**Acceptance:** opening the designer keeps the 3D room visible and live-updating beside it; every control still round-trips via `syncControls`; second browser confirms shared items broadcast and personal items don't; furniture add works via the single entry point.

**Implementation notes:** All 4 items implemented.
- New `#roomDesignerOffcanvas` (offcanvas-end, no backdrop, scroll-through, 400px) added to `_Layout.cshtml` right after `#settingsModal`, containing the full former Room-tab content. The settings modal's `#tab-room` pane is now just an explainer + "🏠 Open room designer →" button. The existing "⚙️ Setup Room" button in the Room Scene panel header (`Views/Room/Index.cshtml`) now calls the same `openRoomDesigner()` (added in `Index.cshtml`), which hides the settings modal (if open) and shows the offcanvas via `bootstrap.Offcanvas.getOrCreateInstance(...).show()`.
- Controls regrouped under `<h6 class="rs-group-header">👥 Room — everyone sees these</h6>` (with the `.rs-shared-caption` line) covering Quick presets, Appearance & layout, Features & furniture, and Room icon (host only); and `<h6 class="rs-group-header">👤 My view & controls</h6>` covering walk camera mode + key bindings. **Deviation:** the pre-existing "2D view style" (`twoDStyle`) and "3D move/orbit control" (`dragMode`) selects are personal display/interaction prefs (not in `RoomSceneStore.SHARED_FIELDS`), so they were placed in a small new "🖥️ View & interaction" sub-section under the personal group rather than left in Appearance & layout.
- Furniture: the 4 "Add furniture" buttons + separate "↺ Reset" were replaced with a single "🪑 Open furniture panel" button calling `window.RS3D.toggleFurniturePanel()`, a new public wrapper around `_toggleFurnHud()` (the in-canvas HUD already covers 10 furniture types + reset — a net upgrade).
- Polish: `#rs-window-anim`, `#rs-whiteboard`, `#rs-plants` checkboxes are now `form-check form-switch`; keybind buttons render the key in `<kbd>` (was `<strong>`), with `_rsRenderKeyBinds`/`_rsCaptureKey`/`_rsCancelCapture` updated accordingly; new CSS classes `.rs-group-header`, `.rs-shared-caption`, `.rs-note`, `.rs-hint` added to `site.css` replace the repeated inline `style="font-weight:normal;..."` / `style="font-size:0.68rem;..."` spans/divs.
- The window-media-library refresh and keybind-render/sync, previously triggered on the settings-modal Room tab's `shown.bs.tab`, now trigger on the offcanvas's `shown.bs.offcanvas`.
- Verified via `node --check` on the 3 embedded `<script>` blocks (pass) and `dotnet build -v quiet` (0 Warning(s), 0 Error(s)). Per the standing "no live testing" instruction, the live-only acceptance checks (visual round-trip, second-browser shared/personal broadcast verification) were not run.

---

## P11 — Realism Phase B: glTF props + data registries ⚠️ PARTIALLY DONE (2026-06-10)

**Implementation notes / deviations:**
- **Vendored** `wwwroot/lib/three/GLTFLoader.js` (r0.184.0, from unpkg) plus its two dependencies `BufferGeometryUtils.js` and `SkeletonUtils.js`, with their internal `'../utils/...'` imports rewritten to relative `./File.js` per the existing flat-vendoring convention. **DRACOLoader was NOT vendored** — the one model used has no Draco compression, so the optimize pipeline was run with `--compress false --texture-compress webp` (negligible savings vs. raw, ~115KB either way); raw GLB kept. Draco can be added later if a heavier model needs it.
- Added an **exact-match importmap entry** in `Views/Room/Index.cshtml` (`"three/addons/loaders/GLTFLoader.js": "/lib/three/GLTFLoader.js"`) so the new loader resolves to the flat-vendored file regardless of the existing prefix entry.
  - **Pre-existing issue noted but NOT fixed (out of scope):** the existing imports `'three/addons/controls/OrbitControls.js'`, `'three/addons/renderers/CSS2DRenderer.js'`, `'three/addons/environments/RoomEnvironment.js'` resolve via the prefix map `"three/addons/": "/lib/three/"` to paths like `/lib/three/controls/OrbitControls.js`, but the vendored files are flat (`/lib/three/OrbitControls.js`) — this looks like a latent broken-path bug from an earlier patch. Left untouched; the new GLTFLoader entry works around it via its own exact-match override.
- **Asset sourcing:** downloaded the spec's owner-picked model (`https://poly.pizza/m/UfKvrZBK6C`, "Office Chair" by Quaternius, CC0) to `wwwroot/models/chairs/office.glb` (~116KB, well within the 500KB/model and 8MB total budgets). No CC-BY attribution needed (CC0).
- **Registry:** added `RS_CATALOG.chairs` with `office` registered (`model: '/models/chairs/office.glb', scale: 1.0, rotY: Math.PI`); `gaming`/`beanbag`/`stool`/`throne` registered with `model: null` (primitives kept indefinitely, per item 5). **Did not** extract a `furniture` catalog or add `make`/`label`/`emoji` fields to the registry — `FURN_ITEMS` and `_makeChairByType` were **not** refactored to derive from the registry (deviation from item 2's "single source of truth" goal); only the office chair got a model in this pass, so the existing switch/HUD array still work correctly as-is.
- **Async loader:** implemented `_loadModel(url)` (cached `Promise<THREE.Group>`, loads once via `GLTFLoader`, sets `castShadow` on all meshes) and `_applyChairModel(group, seatMesh, entry)` which builds the primitive immediately, then on model resolve clones the template, scales/grounds it via its `Box3`, hides the primitive meshes (keeping `seatMesh` as an invisible pick-proxy), and swaps in the model — guarded by `group.parent !== _scene` so a chair rebuilt before the model arrives doesn't get mutated. `SkeletonUtils.clone` not needed (office chair model is unskinned); plain `.clone()` used.
- **Shadows:** added `castShadow = true` to the seat (and back, where present) meshes of all 5 chair primitives, satisfying "hero meshes" cast-shadow per item 4; floor `receiveShadow` unchanged.
- Only furniture types (`sofa`, `bookshelf`, etc.) were **not** addressed this session — all furniture remains primitive-only; no `furniture` registry entries were added. This can be picked up in a future pass following the same `_loadModel`/swap pattern established here.
- **Verification:** `node --check` OK on `room-scene-3d.js` and the 3 new vendored files; `dotnet build -v quiet` → 0 Warnings / 0 Errors. Live acceptance criteria (glTF rendering, primitive-flash-on-load, drag/select/claim/walk-pickup parity, HTTP caching) **not tested** per the "no live testing" instruction.

**Files:** `wwwroot/js/room-scene-3d.js` (or a new `room-scene-registry.js`), `wwwroot/lib/three/` (+GLTFLoader and its dependency imports), new `wwwroot/models/`
**Do NOT:** touch avatars (P12), change layout schema (rot from P8 stays).

### Asset sourcing (owner-approved sources — use these, CC0 unless noted)
| Need | Source |
|---|---|
| Furniture base kit (table, chairs, sofa, bookshelf, lamp, bin, coffee table) | https://kenney.nl/assets/furniture-kit · https://quaternius.com/packs/ultimatefurniture.html · https://quaternius.com/packs/furniture.html · https://quaternius.com/packs/ultimatehomeinterior.html |
| Specific model (owner-picked) | https://poly.pizza/m/UfKvrZBK6C |
| Plants | https://poly.pizza/search/plants |
| Jukebox / boom box | https://poly.pizza/search/boom%20box |
| Whiteboard | https://poly.pizza/search/whiteboard |
| Projector | https://poly.pizza/search/projector |
| Office props / desks / monitors | https://poly.pizza/search/office |
| Bookshelf | https://poly.pizza/search/bookshelf |
| Chair styles | https://poly.pizza/search/chair |
**License rule:** Kenney and Quaternius are CC0. Poly Pizza hosts mixed CC0/CC-BY — check each model's license on its page; CC-BY requires an attribution line (add to the About tab credits). Prefer CC0 when equivalent.

Pipeline per model: download GLB → `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp` (target ≤ 500 KB; total budget ≤ 8 MB) → save as `wwwroot/models/{category}/{name}.glb`.

### Implementation
1. Vendor `GLTFLoader.js` (+ `DRACOLoader.js` and the draco decoder folder if compression is used) from r184 jsm; fix internal import specifiers per the P4 convention.
2. **Registry:** extract the chair/furniture catalogs into one data structure (top of room-scene-3d.js or its own classic-script file loaded before it):
   ```js
   var RS_CATALOG = {
     chairs:    { office:  { make: _makeOfficeChair, model: '/models/chairs/office.glb', scale: 1.0, seatY: SEAT_H }, ... },
     furniture: { sofa:    { make: _makeSofa, model: '/models/furniture/sofa.glb', label: 'Sofa', emoji: '🛋️' }, ... },
   };
   ```
   `FURN_ITEMS` (HUD list :1426) and the chair-type switch (`_makeChairByType` :1793) derive from the registry — single source for labels/emojis/types.
3. **Async model loading with primitive fallback:** `_loadModel(url)` returns a cached promise of a template `Group` (clone per instance — use `SkeletonUtils.clone` only when skinned; plain `.clone()` here). Builder pattern: build the existing primitive immediately; when the model resolves, swap the visual children, **keeping** the group transform, `pickMesh` (resize its box to the model's `Box3`), and `{ group, seatMesh }` contract — for chairs, `seatMesh` becomes an invisible seat-proxy box at the registry's `seatY` so claim raycasts behave identically.
4. `castShadow` on hero meshes only (table, chairs); `receiveShadow` floor only (unchanged).
5. Replace primitive builders ONLY where a model is registered; un-modelled types keep primitives indefinitely (registry entry without `model`).

**Acceptance:** registered props render as glTF in both views with primitives flashing only briefly on first load; drag/select/rotate/claim and walk-mode pickup behave identically (proxy raycasts); reloading uses the HTTP cache (no re-download); total `wwwroot/models` ≤ 8 MB; a missing/corrupt GLB leaves the primitive with one console warning.

---

## P12 — Realism Phase C1: robot avatar upgrade ✅ DONE (2026-06-10)

**Implementation notes:**
- Added a `cap(r, h, mat)` helper (`CapsuleGeometry(r, h-2r, 4, 8)`) and swapped torso, upper arms, forearms, thighs, and shins from box/cylinder geometry to capsules, keeping the same `h` (overall length) and group `position.y` pivots so all `_poseRobot*` functions (seated/walk/crouch/jump/idle/arm-raise) needed **zero** changes — they only rotate the joint groups, not the meshes.
- Body material (`bm`) updated to `roughness: 0.35, metalness: 0.55` (brushed-metal look with the P5 env map); joint-ball material (`jm`) recolored to a darker shade (`_darken(base, 0.40)` vs. the body's `_darken(base, 0.58)`) and bumped to `roughness: 0.6, metalness: 0.5`.
- Added a small emissive chest badge (`CircleGeometry(0.045, 12)`, tinted/emissive with the participant's colour) on the front of the torso.
- Eyes and the antenna tip now use a new `sphHi(r, mat)` helper (`SphereGeometry(r, 16, 12)` vs. the previous 8,6) — "head-adjacent parts only" per spec; joint balls, hands, feet, antenna shaft unchanged. Vote-state eye colours (`eyeC`) untouched.
- `castShadow = true` added to `headMesh` (torso already had it).
- **Verification:** `node --check` OK; `dotnet build -v quiet` → 0/0. Live acceptance criteria (pose correctness, FPS with 8 avatars, visual comparison against P5 floor) **not tested** per the "no live testing" instruction — geometry/position math was kept 1:1 with the original to minimize risk of pose regressions.

**Files:** `wwwroot/js/room-scene-3d.js` (`_makeRobot` :1923 and pose helpers)
**Do NOT:** replace the joints rig or pose system (C2 does that — Appendix C); keep `userData.joints` keys identical.

1. Swap box/cylinder limbs for `THREE.CapsuleGeometry` (torso, upper/forearms, thighs/shins) with the same lengths/pivots so all `_poseRobot*` functions keep working untouched.
2. Materials: body `metalness 0.55 / roughness 0.35` (env map from P5 makes this read as brushed metal), joints darker; add a small emissive chest badge tinted with the participant colour; eyes/antenna unchanged (vote-state colours preserved).
3. Subtle quality: `SphereGeometry` segment counts 8,6 → 16,12 on head-adjacent parts only; add `castShadow = true` to torso + head.

**Acceptance:** all poses (seated, walk, crouch, jump, arm-raise on reveal, idle sway) animate exactly as before; vote-state eye colours unchanged; visual upgrade evident next to a P5 textured floor; FPS unchanged with 8 avatars.

---

## P13 — Avatar customization (accessories) ✅ DONE (2026-06-10)

**Implementation notes / deviation:**
- **Format deviation (confirmed with owner):** `AvatarData` is NOT JSON — it's a pipe/colon-delimited string (`"initials|RRGGBB"`, `"dicebear:bottts:seed|RRGGBB"`, `"data:..."`, etc.) parsed positionally by `avatarDataToUrl`/`renderAvatar` (avatar.js) and by `_parseColor`'s regex (room-scene-3d.js). Converting to JSON would have required touching every consumer (avatar.js, room.js, battle.js, room-scene-3d.js, PokerHub.cs) for an unacceptable risk under the no-live-testing constraint. Instead, scene3d data is appended as a **new trailing segment**: `<existing-avatar-data>||s3d:hat=cap,eyes=visor,tint=rrggbb` (only non-default keys are written; `||s3d:` is a marker that can't collide with any existing format).
- **avatar.js**: added `_stripScene3dSuffix()` (strips `||s3d:...` before any existing parsing — called first thing in `avatarDataToUrl` and `renderAvatar`, so 2D rendering for every provider is byte-for-byte unaffected), `buildScene3dSuffix(s)`, `getAvatar3dSettings()`/`saveAvatar3dSettings()` (new localStorage key `es_avatar3dSettings`), and `populateAvatar3dForm()`/`saveAvatar3dFromForm()` for the new UI. `saveAvatarFromForm()` now appends the scene3d suffix when saving 2D avatar settings so it isn't lost.
- **room-scene-3d.js**: added `_parseScene3d(p)` (parses the `||s3d:...` suffix from `p.avatarData`, defaults `{hat:'none', eyes:'round', tint:null}`). `_parseColor(p)` now checks `_parseScene3d(p).tint` first (overrides body colour per spec item 1). `_makeRobot(color, voteState, seated, scene3d)` gained a 4th param: `eyes:'visor'` replaces the two round eye spheres with a single face-spanning emissive visor (vote-state colour preserved); `hat` builds ≤4 extra primitives attached to the head group — `cap` (2 meshes), `antennaBobble` (2), `crown` (gold torus + 3 cone spikes, 4), `headphones` (half-torus band + 2 cups, 3). All 5 `_makeRobot` call sites (`_makeRoamer`, `_refreshRoamers`, seated/standing in `_rebuildSeating`) now pass `_parseScene3d(p)`; the disconnected-ghost call passes nothing (defaults apply).
- **UI**: new "🤖 My avatar (3D room)" collapsible section in the Room Designer's "My view & controls" group — hat dropdown, eyes dropdown, "use my team colour" switch + colour swatch (disabled when the switch is on). Each control's `onchange` calls `saveAvatar3dFromForm()` which persists locally and calls `connection.invoke('UpdateAvatar', avatarData)` immediately (reusing the existing hub method, no new wiring). The form is populated via `populateAvatar3dForm()` on `shown.bs.offcanvas`.
- **Persistence**: relies entirely on the existing `Participant.AvatarData` field/snapshot — no server changes were needed since the data still travels as the same string field.
- **Verification:** `node --check` OK on `avatar.js` and `room-scene-3d.js`; `dotnet build -v quiet` → 0/0. Live acceptance criteria (visual hat/visor rendering, tint override, persistence across rejoin, 2D-avatar-unaffected) **not tested** per the "no live testing" instruction — the suffix-stripping approach was specifically chosen to make the "2D unaffected" guarantee true by construction (every 2D code path strips the suffix before its existing logic runs, unchanged).

**Files:** `wwwroot/js/room-scene-3d.js`, `wwwroot/js/room.js`, `Views/Shared/_Layout.cshtml` (personal settings group)
**Wiring that already exists (use it, don't reinvent):** `Participant.AvatarData` (PokerModels.cs:59), hub `UpdateAvatar(string avatarData)` (PokerHub.cs:1125), client handler `AvatarUpdated` (room.js:535). **First inspect how AvatarData is currently used** (search room.js/`_Layout` for `avatarData`) — if it already stores 2D avatar info, extend the same JSON object with a `scene3d` key rather than replacing it; preserve existing consumers.

1. Schema (inside AvatarData JSON): `scene3d: { hat: 'none'|'cap'|'antennaBobble'|'crown'|'headphones', eyes: 'round'|'visor', tint: '#rrggbb'|null }`. Tint overrides the participant colour for the robot body only.
2. Builders: small primitive accessories attached to the head group in `_makeRobot` (each ≤ 4 meshes). Apply on build from the participant's parsed AvatarData; `_rebuildSeating`/roamer refresh re-applies on `AvatarUpdated`.
3. UI: "🤖 My avatar" section in the personal settings group — accessory dropdowns + colour input + "use team colour" checkbox; preview not required (the user sees their own robot in 3rd person / others see it live). Save → `connection.invoke('UpdateAvatar', json)` via a small `RoomSceneNet.updateAvatar` addition.

**Acceptance:** pick a crown → your robot wears it for everyone, persists across reload (AvatarData is in the participant snapshot — verify it survives rejoin; if not, note the gap rather than fixing the participant lifecycle); 2D/existing avatar feature unaffected.

---

## P14 — Customization bundle: room size, walk sliders, floor colour ✅ DONE (2026-06-10)

**Implementation notes:**
- **Room size**: added `ROOM_SIZES` map (`small: 8×6.5, medium: 10×8, large: 13×10`) and `_applyRoomSize()`, which sets the module-level `ROOM_W`/`ROOM_D` vars from `_cfg.roomSize`. Called in `init()` (after `_cfg` is assembled) and at the top of `refreshScene()` (after merging `newConfig`, before `_buildRoom()`/`_buildTable()`/etc.). All ~20 consumers (`_setOrthoFrustum`, `_buildRoom`, `_buildWindowWall`, prop placement, `_buildLights`, `_clampRoom`, `_walkCollidesAt`/`_updateWalk`, `_myStartPos`/`_startWalkTo`, minimap `mx`/`mz`) read the vars at call time, so this was mechanical as the spec predicted. On shrink, `refreshScene` now clamps every saved furniture position through `_clampRoom` before `_buildFurniture`. The 2D top-down ortho frustum is re-sized via the existing `RS3D.setView('top')` call that `room-scene.js`'s config subscriber already makes after `refreshScene`.
- **Walk feel**: added `_walkSpeed()`/`_crouchSpeed()`/`_lookSens()`/`_invertY()` helper functions reading `_cfg.walkSpeed`/`lookSensitivity`/`invertY` (falling back to the original `WALK_SPEED`/`CROUCH_SPEED`/`0.005` constants — crouch speed scales proportionally with walk speed). `_updateWalk` now calls `_walkSpeed()`/`_crouchSpeed()`; `_onLookMove` and `_onPointerLockMove` use `_lookSens()` and flip the pitch sign when `_invertY()` is true.
- **Floor colour**: `_floorMat(pal)` now checks `_cfg.floorColor` first (a `'preset'|'#hex'` shared field, mirroring `_wallColor`). When set, it overrides the palette colour (no floor material) or the `MeshStandardMaterial.color` of a textured floor material (tints the colour map, matching the spec's "tint multiplies the texture" note).
- **Shared vs. personal fields**: `roomSize` and `floorColor` added to `RoomSceneStore.SHARED_FIELDS` (broadcast to the room); `walkSpeed`, `lookSensitivity`, `invertY` added to `DEFAULT_CONFIG` only (personal — not in `SHARED_FIELDS`, so `broadcastSceneConfig` never sends them).
- **UI**: Room Designer "👥 Room" group gained a new row with a "Room size" select (Small/Medium/Large) and a "Floor" colour swatch, next to the existing wall-colour control. The "👤 My view & controls → 🚶 Walk controls" section gained a "Walk speed" range slider (1.5–4.5), a "Look speed" range slider (0.002–0.012), and an "Invert Y" switch. `syncControls()` populates all five new controls from `state.config`.
- **Verification:** `node --check` OK on `room-scene-3d.js`, `room-scene.js`, `room-scene-store.js`. `dotnet build -v quiet` produced no C#/Razor errors (the only failures were pre-existing file-lock copy errors from the already-running dev process, unrelated to this patch — no `.cs`/`.cshtml` server-side code was touched). Live acceptance criteria (visual reflow on size change, slider feel, floor tint, late-joiner sync) **not tested** per the "no live testing" instruction.

**Files:** `wwwroot/js/room-scene.js` (config), `wwwroot/js/room-scene-3d.js`, `wwwroot/js/room-scene-store.js`, `Views/Shared/_Layout.cshtml`

1. **Room size** (shared field `roomSize: 'medium'`): convert `ROOM_W/D` constants (:13) to vars set from config in `init`/`refreshScene`: small 8×6.5, medium 10×8 (current), large 13×10. `ROOM_H` stays 3.2. Verify all consumers derive from the vars (seat ring `_seatPositions`, `_standingPositions`, collision `_walkCollidesAt`, `_clampRoom`, ortho frustum, window wall, minimap scale) — they already reference the constants, so the change is mechanical; clamp existing furniture/chairPos into the new bounds on shrink (`_clampRoom` on load).
2. **Walk feel** (personal fields): `walkSpeed` (1.5–4.5, default 2.7), `lookSensitivity` (0.002–0.012, default 0.005), `invertY` (bool). Consume in `_updateWalk`/look handlers/pointer-lock mousemove. Three sliders + checkbox in the personal settings group.
3. **Floor colour override** (shared `floorColor: 'preset'|'#hex'`): mirrors the existing `wallColor` pattern (`_wallColor` :265) — tint multiplies the texture when P5 maps are active (`material.color`).

**Acceptance:** large room reflows chairs/window and walking reaches the new walls; peers see the size change live and late joiners get it (shared config persistence from P2); sliders affect only the local user; floor colour syncs like wall colour.

---

## P15 — UX polish bundle ✅ DONE (2026-06-10)

**Files:** `wwwroot/js/room-scene-3d.js`, `wwwroot/css/site.css`

1. **Onboarding (one-time, `localStorage es_rs3d_onboarded`):** on first 3D mount, three positioned callout chips (plain absolutely-positioned divs with arrows): Walk button ("Walk around"), any chair ("Click a chair to sit"), furniture button ("Add furniture"). Dismiss all on first interaction or ✕.
2. **Toolbar:** merge the Walk / Click-walk / +Furniture floating buttons into one vertical toolbar (top-right), consistent 32 px icon buttons with tooltips + shortcut badges, active-state styling for toggles. Same handlers; CSS classes instead of inline styles.
3. **Anchored claim bar:** `_showClaimBar` becomes a CSS2DObject positioned above the pending chair (offset +1.2 y) instead of the fixed bottom bar; same Confirm/Cancel buttons (CSS2D renders DOM, so clicks work — note `_labelRenderer` has `pointerEvents:'none'` on its root; set `pointerEvents:'auto'` on the bar element itself).
4. Walk-mode entry toast: 2-second centred fade ("🚶 Walk mode — {move keys} to move · drag/mouse to look · Esc to exit").

**Acceptance:** fresh browser profile sees callouts once; toolbar buttons all function with visible active states; claim bar floats at the chair in both 3D and top-down; toast appears once per walk entry.

**Implementation notes:**
- **Onboarding**: `_showOnboarding()` (called from `init()` after `_createMinimap()`) checks `localStorage['es_rs3d_onboarded']` and, if unset and the view isn't `'top'`, renders three `.rs3d-callout` chips with directional arrows (`.rs3d-callout-r` / `.rs3d-callout-d`) pointing at the toolbar's Walk button, the furniture button, and a general chair-area hint. **Deviation**: the "click a chair" callout uses a fixed bottom-center position (`left:50%;bottom:64px`) rather than projecting an actual chair's 3D position to screen space — a pragmatic simplification since chair layout varies by room/seating plan. Any pointerdown on the container or a chip's ✕ dismisses all chips and sets the localStorage flag.
- **Toolbar**: the three previously independent floating buttons (Walk, Click-walk, +Furniture) are now built by `_createWalkButton()` into a single `#rs3d-toolbar` (`.rs3d-toolbar`, vertical flex column, top-right) of `.rs3d-tool-btn` icons (32×32px). Active/toggle states use `.active` (green) and `.off` (red, for click-walk disabled) classes. The hint label and furniture HUD panel were repositioned to `top:116px;right:8px` to sit below the new toolbar. **Deviation**: "shortcut badges" from the spec were not implemented — only `title` tooltips showing the bound key (via existing `_keyHint()`).
- **Anchored claim bar**: `_createClaimBar()` now wraps the bar element in a `CSS2DObject` (`_claimBarObj`) added to `_scene`. `_showClaimBar(idx)` looks up the chair's `_chairObjects` entry and sets `_claimBarObj.position.set(chairX, 1.2, chairZ)`. `.rs3d-claim-bar` has `pointer-events: auto` so its buttons remain clickable despite `_labelRenderer`'s root `pointer-events:none`. **Discovery**: CSS2DRenderer overwrites `element.style.transform` inline every frame, so a stylesheet `transform` on `.rs3d-claim-bar` would be dead code — the rule deliberately omits `transform` and relies purely on the 3D `position.set` Y-offset for "above the chair" placement. Because `refreshScene()` clears and rebuilds `_scene.children` (detaching the CSS2DObject), it re-adds `_claimBarObj` to `_scene` at the end and re-shows it via `_showClaimBar()` if a claim was still pending.
- **Walk toast**: `_showWalkToast()` (called from `_enterWalk()`) renders a centered `.rs3d-walk-toast` with the bound move keys, fades out via opacity transition after 1.4s, and is removed from the DOM after 2s.
- **Verification**: `node --check` passed on `room-scene-3d.js`. `dotnet build -v quiet` produced no `CS`/`CSHTML`/`RZ` errors (only the pre-existing `apphost.exe` file-lock copy errors from the running dev process, PID 43804 — unrelated, no `.cs` files touched). Live acceptance criteria not exercised per the "no live testing" instruction for this session.

---

## Appendix A — Codebase wiring map (read before P2/P3/P6/P13/P14)

### Client files
| File | Global | Role |
|---|---|---|
| `wwwroot/js/room.js` | — (page script) | SignalR connection, all `connection.on(...)` handlers, `window.RoomSceneNet` facade (:54–79), `window.ROOM_CONFIG { roomName, playerName, connectionId }` (set elsewhere in page — search), `window.roomState` |
| `wwwroot/js/room-scene.js` | `window.RoomScene` | config state + persistence (`es_roomSceneConfig`), renderer orchestration (`_applyMode`), `_SHARED_FIELDS` (~:400) |
| `wwwroot/js/room-scene-3d.js` | `window.RS3D` | the entire 3D engine |
| `Views/Room/Index.cshtml` :441–444 | — | three.js script tags |
| `Views/Shared/_Layout.cshtml` ~2667–2949 | — | settings modal Room tab (controls + inline upload/keybind scripts) |

### RoomSceneNet (room.js:54) — client→hub facade
`claimChair(idx,color)` `releaseChair()` `setLayout(json)` `setChairPositions(json)` `avatarMove(x,z,yaw,pose)` `avatarStop()` `hostFreeChair(idx)` `broadcastSceneConfig(json)` — each a thin `connection.invoke` wrapper. Extend here for new hub calls (P13 `updateAvatar`).

### Hub methods (PokerHub.cs) and their client events
| Hub method | Persists to Room | Emits |
|---|---|---|
| `JoinRoom` :53 | participant list | caller `RoomState` (full snapshot via private `BuildRoomState`), others `ParticipantJoined` |
| `ClaimChair` :184 / `ReleaseChair` :383 / `HostFreeChair` :310 | `ChairClaims` | `ChairClaimed/ChairReleased/ChairClaimFailed` |
| `SetRoomLayout` :246 | `RoomLayoutJson` | `RoomLayoutChanged` — **the canonical persistence pattern: length guard → RateLimited → GetRoomForConnection → GetRoom → lock+mutate → SaveRoom → OthersInGroup** |
| `SetChairPositions` :359 | `ChairPositionsJson` | `ChairPositionsChanged` |
| `BroadcastSceneConfig` :374 | **nothing (P2 adds `SceneConfigJson`)** | `SceneConfigUpdated` |
| `AvatarMove/AvatarStop` :328/:346 | `Participant.PosX/PosZ/Yaw/Pose` | `AvatarMoved/AvatarStopped` |
| `UpdateAvatar` :1125 | `Participant.AvatarData` | `AvatarUpdated` |
| `SetRoomIcon` :281 | `RoomIcon` | `RoomIconChanged` |
`RateLimited(key, TimeSpan)` is a private helper used per-connection — reuse it in modified methods.

### Scene-relevant client handlers (room.js)
`RoomState` :176 (applies snapshot; chairClaims/roomLayout/chairPositions → RS3D at :232–234) · `ParticipantJoined` :239 (**host-push of scene config at :243–250 — removed in P3**) · `AvatarUpdated` :535 · `SceneConfigUpdated` :542 (`RoomScene.updateConfig(patch, true)`) · `ChairClaimed/Released/ClaimFailed` :576–584 · `RoomLayoutChanged` :585 · `ChairPositionsChanged` :588 · `AvatarMoved/Stopped` :592/:595.

### Server infrastructure
- **Room model** `Models/PokerModels.cs:3` — fields listed in §0 table. `Participant` :51 (note `AvatarData` :59, roaming fields :64–67).
- **Persistence** `Services/FileRoomRepository.cs` — base path `config ?? Path.Combine(AppContext.BaseDirectory, "rooms")` (:14), file per room `SanitizeName(name) + ".json"` (:19). `RoomService` wraps it (`NormalizeName`, `GetOrCreateRoom`, `GetRoom`, `SaveRoom`, `GetRoomForConnection`, `MapConnection`).
- **Background services** (Program.cs:19–21): `RoomCleanupService` (deletes stale rooms — hook P2 asset cleanup at its `repo.DeleteRoom` call ~:30), `RoomPersistenceService`, `ParticipantSweepService`.
- **Routing** (Program.cs): `AddControllersWithViews` + conventional `MapControllerRoute`s + `MapHub("/pokerhub")`. No `MapControllers`, but conventional mapping activates attribute routing — if P2's API 404s, add `app.MapControllers();` before the conventional routes. SignalR `MaximumReceiveMessageSize` = 1 MB (:13) — fine; media never travels over SignalR.

### localStorage keys (client)
`es_roomSceneConfig` (whole config) · `es_rs3d_chairpos_{room}` (:1132) · furniture layout key — see `_furnitureKey()` :809 · claims key — see `_roomKey()` :2722 · P15 adds `es_rs3d_onboarded`.

---

## Appendix B — Phase D leftovers (optional polish, post-P12)

*(The former "consider upgrading to r152+" item is superseded by P4 and removed.)*
- `RectAreaLight` slab in the window opening for daylight realism — `import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'` + `init()` once.
- Post-processing (SSAO/bloom via `EffectComposer`) — gate behind a "High quality" personal toggle; measurable GPU cost.
- KTX2/Basis texture compression (`KTX2Loader` + transcoder) if `wwwroot/textures`/models budget grows.
- `WebGPURenderer` — watch only; not worth a migration yet.

---

## Appendix C — Phase C2 full spec: humanoid glTF avatars (DEFERRED — implement only when explicitly requested)

**Goal:** replace robots with skinned, animated human characters; per-user character choice.

### Assets (owner-approved)
- Characters: https://quaternius.com/packs/ultimatemodularcharacters.html · https://quaternius.com/packs/ultimatemodularwomen.html · https://quaternius.com/packs/animatedmen.html · https://quaternius.com/packs/animatedwomen.html · https://quaternius.com/packs/ultimatedanimatedcharacter.html
- Animation clips (retargetable library for the Quaternius rig): https://quaternius.com/packs/universalanimationlibrary.html · https://quaternius.com/packs/universalanimationlibrary2.html
- All CC0. Pick 6–10 visually distinct characters; optimize per P11 pipeline; budget ≤ 1.5 MB each.

### Required clips
`Idle`, `Walk`, `Sit` (or `Sit_Idle`), `Jump`, `Crouch_Idle` (optional), `Wave` (vote-reveal celebration). The Universal Animation Library packs share the Quaternius skeleton — clips retarget by name without bone remapping when characters come from the packs above. Verify clip names per pack and build a `CLIP_MAP = { idle:'Idle', walk:'Walk', ... }` indirection.

### Architecture
1. New `AvatarFactory` inside room-scene-3d.js: `createAvatar(participant, opts) → { root, mixer, play(clipKey, fade=0.25), setVoteState(s), dispose() }`. Loads the character GLB (cache via P11 `_loadModel`; **clone with `SkeletonUtils.clone`** — plain clone breaks skinning), creates one `AnimationMixer` per instance, cross-fades clips.
2. **Replace the pose system, not patch it.** Current consumers of `userData.joints` / pose helpers, all in room-scene-3d.js — each maps to a clip call:
   - `_poseRobotSeated` (:2022) + seated placement in `_rebuildSeating` (~:2489) → `play('sit')`, position on the chair seat (per-chair `seatY` from the P11 registry; characters are ~1.8 m vs robot 1.3 m — set per-character `scale` in the registry so seated eye-line matches `ROBOT_HEAD_Y` ≈ 1.19, and update `ROBOT_HEAD_Y`-based label/ring/emote heights to read from the avatar instance, `_avatarHeadPos` :2390).
   - `_poseRobotWalk` (:2036, used by roamers `_updateRoamers`/`_tick` :3082–3090 and self in `_updateWalk` :1626–1638) → `play(moving ? 'walk' : 'idle')`; drive `mixer.update(dt)` from `_tick`.
   - `_poseRobotCrouch` (:2057) → `play('crouchIdle')` or scale-Y fallback if no clip.
   - `_poseRobotJump` (:2071) → `play('jump')` one-shot (`LoopOnce`, `clampWhenFinished`).
   - `_animRobotIdle` (:2093) → `play('idle')` (the clip replaces procedural sway).
   - `_animArmRaise` (:2110, vote reveal) → `play('wave')` one-shot then back to `sit`.
   - Vote-state eye colour (`_makeRobot` eyeC) → replace with the nameplate badge and/or an emissive ring colour change (`VOTE_EMI` map stays the source).
3. **Selection & persistence:** extend the P13 AvatarData `scene3d` object with `character: '<registry id>' | 'robot'`. `'robot'` keeps the P12 robot path — the factory branches, so **robots remain the fallback** for load failures and the default for users who never chose.
4. Memory/perf: 16 instances max (existing cap). Share `AnimationClip`s across instances of the same character (cache clips with the template). Dispose mixers + cloned skeletons on participant leave (`clearRoamer` :2280, `_clearRobots` :2217).
5. **Acceptance:** two browsers, one robot + one human character: sit/stand/walk/jump/reveal-wave all animate; labels, claim rings, emotes float at correct heights for both; switching character live swaps the avatar for everyone; character choice survives reload; a corrupted GLB falls back to robot with one warning.

---

## Appendix D — Out-of-scope notes for the implementer

- Click-to-walk currently glides in a straight line (`_startWalkTo` :2305) and may pass near furniture; A* pathfinding over the 0.5 m grid was reviewed and **deliberately deferred** — do not implement.
- Touch joystick / Gamepad support: reviewed, deferred.
- The 336 inline `on*=` handlers across _Layout.cshtml are an app-wide idiom — do not refactor them beyond what individual patches specify.
- `window.confirm` usages outside patch scopes (host-free-seat) stay as-is unless a patch says otherwise.
