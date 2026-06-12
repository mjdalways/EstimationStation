// ============================================================
// Room Scene 3D — WebGL room (Three.js r0.184.0 ES modules)
// Phase 2: 5 chair types · table sizes · chair claiming · standing robots
// Phase 3: movable furniture (drag on floor, persistence)
// Phase 4: idle animations · AO shadows · vote-reveal arm-raise · camera fly-to
// Loaded as a module (see import map in Views/Room/Index.cshtml); exposes window.RS3D
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Back-compat: room-scene.js's _applyMode() guards 3D init on `window.THREE` (a holdover
// from the UMD-global era). Keep that check working without touching its caller.
window.THREE = THREE;

// ── Constants ──────────────────────────────────────────────
    var ROOM_W = 10, ROOM_D = 8, ROOM_H = 3.2;
    var SEAT_H = 0.47;
    var TBL_TOP = 0.76;
    var GRID = 0.5; // furniture snap grid

    var TABLE_SIZES = {
        small:  { RR: 1.05, RW: 2.3,  RD: 1.25 },
        medium: { RR: 1.55, RW: 3.2,  RD: 1.65 },
        large:  { RR: 2.15, RW: 4.5,  RD: 2.1  }
    };

    var ROOM_SIZES = {
        small:  { W: 8,  D: 6.5 },
        medium: { W: 10, D: 8   },
        wide:   { W: 14, D: 8   },
        large:  { W: 13, D: 10  }
    };
    // Refreshes the module-level ROOM_W/ROOM_D from _cfg.roomSize. Must run before
    // _buildRoom()/_buildTable() etc. so every consumer sees the new dimensions.
    function _applyRoomSize() {
        var sz = ROOM_SIZES[_cfg.roomSize] || ROOM_SIZES.wide;
        ROOM_W = sz.W; ROOM_D = sz.D;
    }

    var VOTE_EMI = { none: 0x444444, voted: 0xf59e0b, revealed: 0x22c55e, observer: 0x6c757d };

    var PAL = {
        'conference': { floor: 0xc9dae6, wall: 0xe0eaf3, ceil: 0xf0f5f9 },
        'war-room':   { floor: 0xbfb8ab, wall: 0xd0c9bc, ceil: 0xe4ddd3 },
        'cozy':       { floor: 0xd9c9bc, wall: 0xe8dad0, ceil: 0xf3ece5 },
        'skyline':    { floor: 0xbfd0dc, wall: 0xd0e2f0, ceil: 0xe8f3fb }
    };

    // ── State ──────────────────────────────────────────────────
    var _renderer = null, _labelRenderer = null;
    var _scene = null, _camera = null, _controls = null;
    var _animId = null, _container = null, _ro = null;
    var _robotMap = {}, _participants = [], _roomState = null;
    var _cfg = {}, _clock = 0, _lastTime = 0;
    var _winGroup = null;   // active parent for window-scene primitives (group-local coords)
    var _winAnims = [];     // animated window elements (clouds, stars, sea…) updated in _tick
    var _gifTextures = [];  // animated GIF window textures: { img, canvas, ctx, tex } — updated every tick
    var _videoTextures = []; // active <video> window textures: { video, tex } — disposed on rebuild
    var _wbBoard = null, _wbTex = null, _wbVer = -1;   // in-room whiteboard board mesh + live texture
    var _props = [];                 // interactive props: { mesh, action }
    var _storyScreenLabel = null;    // CSS2D label on the in-room story screen
    var _interactLabel = null;       // CSS2D "Press E to ..." prompt shown near the nearest interactable
    var _interactCheckT = 0;         // accumulator: re-check the nearest interactable ~5x/sec
    var _applyingRemote = false;  // true while applying a peer's furniture layout (suppresses re-broadcast)

    // First-person "walk" mode. When on, OrbitControls is disabled and the camera is a
    // first-person avatar: WASD/arrows move, Space jumps, C crouches, E interacts.
    // Spatial presence: free-roam avatars keyed by connectionId (rendered as moving robots).
    // NOTE: roamer positions are intentionally NOT mirrored into RoomSceneStore — they update
    // ~10x/sec and stay internal to RS3D to avoid flooding subscribers (see room-scene-store.js).
    var _roamers = {};      // cid -> { robot, ring, labelObj, x, z, yaw, tx, tz, tyaw, pose, headY }
    var _roamSend = 0;      // throttle accumulator for broadcasting my own position
    var _iAmRoaming = false;
    var _walkToActive = false;   // click-to-walk: gliding my avatar to a clicked floor point
    var _topSteerActive = false; // 2D mode: WASD/arrow steering is currently moving my avatar
    // P10: 2D top-down camera auto-follow (Kumospace-style). suspended=true while the user
    // has manually panned and my avatar hasn't moved since; lastX/lastZ track my avatar's
    // position between ticks so we can detect "they started moving again".
    var _topFollow = { suspended: false, lastX: null, lastZ: null };
    var _seatedArrowToastT = 0;  // throttle for the "press Space to stand" toast (P7 follow-up)
    var _clickWalkEnabled = true; // click-to-walk feature toggle (user can disable via button)
    var _emotes = [];            // floating emoji over avatars (spatial reactions)
    var _stillTime = 0;          // how long my avatar has been stationary (for walk-up-and-sit)
    var _miniCanvas = null, _miniCtx = null, _miniAccum = 0;   // overhead minimap
    var _perspCam = null, _orthoCam = null;   // 3D orbit cam + 2D top-down ortho cam
    var _view    = 'persp'; // 'persp' (3D) | 'top' (2D top-down) — both view the same scene
    var _walk    = null;    // null = orbit mode; else { yaw, pitch, vy, grounded, crouch, held }
    var _keys    = {};      // event.code -> bool (currently-held movement keys)
    var _toolbar = null;       // P15: vertical icon toolbar (top-right) housing the buttons below
    var _walkBtn = null;       // the on-canvas Orbit/Walk toggle button
    var _clickWalkBtn = null;  // the on-canvas click-to-walk enable/disable toggle
    var _furnHudBtn = null;    // the on-canvas "+" furniture quick-add HUD button
    var _furnHud = null;       // the furniture quick-add panel (shown on button click)
    var EYE_STAND = 1.60, EYE_CROUCH = 1.02, WALK_SPEED = 2.7, CROUCH_SPEED = 1.25;
    // Personal walk-feel overrides (P14) — fall back to the constants above when unset.
    function _walkSpeed()   { return (_cfg && _cfg.walkSpeed) || WALK_SPEED; }
    function _crouchSpeed() { return _walkSpeed() * (CROUCH_SPEED / WALK_SPEED); }
    function _lookSens()    { return (_cfg && _cfg.lookSensitivity != null) ? _cfg.lookSensitivity : 0.005; }
    function _invertY()     { return !!(_cfg && _cfg.invertY); }

    function _defaultKeyBinds() {
        return { forward:'ArrowUp', back:'ArrowDown', left:'ArrowLeft', right:'ArrowRight',
                 jump:'AltLeft', crouch:'ControlLeft', interact:'KeyE', walk:'KeyT' };
    }
    // Merge configured bindings over defaults.
    function _keyBinds() {
        return Object.assign(_defaultKeyBinds(), (_cfg && _cfg.keyBindings) || {});
    }

    // ── Camera views (orbit 3D / top-down 2D) ─────────────────
    // Size the orthographic frustum so the whole room fits regardless of aspect.
    function _setOrthoFrustum(w, h) {
        if (!_orthoCam || !w || !h) return;
        var aspect = w / h;
        var halfH = Math.max(ROOM_D / 2 + 0.6, (ROOM_W / 2 + 0.6) / aspect);
        _orthoCam.left = -halfH * aspect; _orthoCam.right = halfH * aspect;
        _orthoCam.top = halfH;            _orthoCam.bottom = -halfH;
        _orthoCam.updateProjectionMatrix();
    }

    // (Re)build OrbitControls for the active view. Top-down: pan + zoom, no rotate,
    // left-drag pans (so empty-space drag pans while furniture drag still moves items).
    function _applyControls() {
        if (!OrbitControls || !_renderer) return;
        if (_controls) { _controls.dispose(); _controls = null; }
        _controls = new OrbitControls(_camera, _renderer.domElement);
        _controls.enableDamping = true; _controls.dampingFactor = 0.09;
        if (_view === 'top') {
            _controls.target.set(0, 0, 0);
            _controls.enableRotate = false;
            _controls.screenSpacePanning = true;
            _controls.minZoom = 0.5; _controls.maxZoom = 4;
            if (THREE.MOUSE) _controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
            // P10: manual pan suspends camera auto-follow until my avatar moves again.
            _controls.addEventListener('start', function () { _topFollow.suspended = true; });
        } else {
            _controls.target.set(0, TBL_TOP, 0);
            _controls.minDistance = 1.5; _controls.maxDistance = 13;
            _controls.maxPolarAngle = Math.PI * 0.50;
            _controls.minPolarAngle = 0.18;
        }
        _controls.update();
    }

    // Public: switch between '3d'/'persp' (orbit) and '2d'/'top' (orthographic top-down).
    function setView(view) {
        var v = (view === '2d' || view === 'top') ? 'top' : 'persp';
        if (v === _view && _camera) return;
        if (_walk) _exitWalk();                 // first-person only makes sense in 3D
        _view = v;
        _camera = (v === 'top') ? _orthoCam : _perspCam;
        var W = (_container && _container.clientWidth)  || 400;
        var H = (_container && _container.clientHeight) || 300;
        if (v === 'top') _setOrthoFrustum(W, H);
        else { _perspCam.aspect = W / H; _perspCam.updateProjectionMatrix(); }
        _applyControls();
        // Distance-based fog washes out an overhead view — disable it in top-down.
        if (_scene) _scene.fog = (v === 'top') ? null : new THREE.FogExp2(_fogColor(), 0.042);
        // First-person walk + fly-to are 3D-only; hide just the walk button + its key-bind
        // hint, and the minimap (redundant overhead). Click-to-walk + furniture-add stay
        // available in top-down (P6) — the toolbar itself remains visible.
        var topHide = (v === 'top') ? 'none' : '';
        if (_walkBtn)      _walkBtn.style.display = topHide;
        if (_furnHud)      _furnHud.style.display = 'none'; // always hide panel on view switch
        var hint = document.getElementById('rs3d-walk-hint'); if (hint) hint.style.display = topHide;
        if (_miniCanvas) _miniCanvas.style.display = topHide;
        _flyTarget = null;
    }

    // Chair claiming
    var _chairObjects    = [];
    var _claimedChairs   = {};   // idx -> { name, color, cid }
    var _myChairIdx      = null;
    var _pendingChairIdx = null;
    var _raycaster       = null;
    // True once the server has delivered the authoritative claim map this session,
    // so 2D (which reads via getSeatingPlan) trusts _claimedChairs even when the
    // WebGL scene isn't mounted. Falls back to localStorage only when offline.
    var _claimsFromServer = false;
    // Per-chair position overrides (idx -> {x,z}) when a chair has been dragged from its
    // default ring slot. Shared across the room and synced like the furniture layout.
    var _chairPos  = {};
    var _myChairMoveTime = {}; // P9.6: idx -> performance.now() of my last drag/rotate, for the conflict toast
    // Décor position overrides (key -> {x,z[,rot]}) for the confetti/jukebox props,
    // whiteboard, and project screen when dragged from their default spots. Shared
    // across the room and synced like _chairPos. Keys: 'confetti', 'music', 'wb', 'screen'.
    var _decorPos = {};
    var _wbGroup = null;       // whiteboard wrapper group (P4: draggable along walls)
    var _screenGroup = null;   // project screen wrapper group (P4: draggable along walls)
    var _screenMesh = null;    // project screen plane mesh (pick target for hover/drag)
    var _tableGroup = null;    // main table wrapper group (P5: draggable on the floor; chairs follow)

    // ── P7.1 InputManager — single owner of the active pointer gesture ──────────
    // mode: 'idle' | 'chairDrag' | 'furnDrag' | 'decorDrag' | 'look'  (walk is an app mode,
    // not a gesture — 'look' is the drag-look gesture *inside* walk mode). ONLY Input.to()
    // touches _controls.enabled and pointer capture, so a gesture can never leak a
    // disabled orbit or a stuck capture. data carries the per-gesture payload:
    //   chairDrag: { idx, group, offsetX, offsetZ, pointerId, moved, startX, startY }
    //   furnDrag:  { item, offsetX, offsetZ, pointerId, moved }
    //   decorDrag: { kind:'prop'|'wall', key, group, offset, margin, offsetX, offsetZ,
    //                pointerId, moved, startX, startY }
    //   look:      { x, y }   (last pointer position)
    var Input = {
        mode: 'idle',
        data: null,
        suppressClick: false,   // swallow the click that ends a real drag / select press
        is: function (m) { return this.mode === m; },
        to: function (mode, data, ev) {
            if (this.mode === 'chairDrag' || this.mode === 'furnDrag' || this.mode === 'decorDrag') {
                try {
                    if (ev && _renderer && ev.pointerId !== undefined) _renderer.domElement.releasePointerCapture(ev.pointerId);
                } catch (e) {}
                if (_controls) _controls.enabled = true;
            }
            this.mode = mode || 'idle';
            this.data = (this.mode !== 'idle' && data) || null;
            if (this.mode === 'chairDrag' || this.mode === 'furnDrag' || this.mode === 'decorDrag') {
                if (_controls) _controls.enabled = false;
                try {
                    if (ev && _renderer && ev.pointerId !== undefined) _renderer.domElement.setPointerCapture(ev.pointerId);
                } catch (e) {}
            }
        }
    };

    // Phase 3: Furniture
    var _furnitureObjs         = [];   // { id, type, x, z, group, pickMesh }
    // P8: unified selection — { kind: 'furniture'|'chair'|'decor', id: <furnId|chairIdx|decorKey> } or null.
    var _sel                   = null;
    var _selRing               = null; // highlight ring under selected item
    var _selHandle             = null; // free-rotate drag handle (shown when rotation step = 'free')
    var _selBar                = null; // selected-item control overlay (delete / deselect)
    var _hoverCursor           = '';   // current canvas cursor

    // Phase 4: animations / camera
    var _flyTarget  = null;  // { startCam, endCam, startOrb, endOrb, t, dur }
    var _revealWas  = false; // previous votesRevealed state — detect transition

    function _threeReady() { return true; }

    // ── Init ──────────────────────────────────────────────────
    function init(containerEl, config) {
        if (!containerEl || !_threeReady()) return false;
        if (_renderer) dispose();

        _container = containerEl;
        _cfg = Object.assign({
            tableShape: 'round', tableSize: 'medium', preset: 'conference',
            whiteboard: true, plants: true, skyline: true, windowView: 'skyline',
            chairType: 'office', chairCount: 0
        }, config || {});
        _applyRoomSize();

        var W = _container.clientWidth  || 400;
        var H = _container.clientHeight || 300;

        _renderer = new THREE.WebGLRenderer({ antialias: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.shadowMap.enabled = true;
        // PCFSoftShadowMap is deprecated in r184 (falls back to PCFShadowMap with a console
        // warning per program compile) — use PCFShadowMap directly.
        _renderer.shadowMap.type    = THREE.PCFShadowMap;
        _renderer.outputColorSpace  = THREE.SRGBColorSpace;
        _renderer.toneMapping       = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;
        // Canvas-scoped keyboard focus for walk mode (P7): focusable, no focus ring.
        _renderer.domElement.tabIndex = 0;
        _renderer.domElement.style.outline = 'none';
        _container.appendChild(_renderer.domElement);

        if (CSS2DRenderer) {
            _labelRenderer = new CSS2DRenderer();
            _labelRenderer.setSize(W, H);
            var s = _labelRenderer.domElement.style;
            s.position = 'absolute'; s.top = '0'; s.left = '0';
            s.pointerEvents = 'none'; s.overflow = 'hidden';
            _container.appendChild(_labelRenderer.domElement);
        }

        _scene = new THREE.Scene();
        _scene.background = new THREE.Color(_fogColor());
        _scene.fog = new THREE.FogExp2(_fogColor(), 0.042);

        // Image-based lighting: gives every MeshStandardMaterial soft ambient/reflection
        // detail from a generic neutral room, instead of flat ambient-only shading.
        var pmrem = new THREE.PMREMGenerator(_renderer);
        _scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        // Perspective camera (3D orbit) + orthographic camera (2D top-down). Both look at
        // the SAME scene, so anything moved/claimed shows identically in either view.
        _perspCam = new THREE.PerspectiveCamera(48, W / H, 0.1, 30);
        _perspCam.position.set(0, 3.8, 5.8);
        // Top-down camera sits at y=20 looking straight down. near=17 clips everything
        // above y≈3 (the ceiling / hanging light), so we see the floor, table, chairs,
        // robots and furniture from above instead of the ceiling.
        _orthoCam = new THREE.OrthographicCamera(-5, 5, 5, -5, 17, 22);
        _orthoCam.up.set(0, 0, -1);                 // screen-up = world -z (back wall at top)
        _orthoCam.position.set(0, 20, 0);
        _orthoCam.lookAt(0, 0, 0);

        _view   = (_cfg.mode === '2d') ? 'top' : 'persp';
        _camera = (_view === 'top') ? _orthoCam : _perspCam;
        _setOrthoFrustum(W, H);
        _applyControls();
        if (_view === 'top') _scene.fog = null;   // no distance fog in overhead view

        _raycaster = new THREE.Raycaster();
        _loadClaims();
        _loadChairPositions();
        _loadDecorPositions();
        _loadClickWalkEnabled();
        _buildRoom();
        _buildTable();
        _buildLights();
        _buildFurniture(_loadFurniture());
        _setupInteraction();
        _createSelBar();
        _createWalkButton();
        _createMinimap();
        _showOnboarding();

        if (window.ResizeObserver) {
            _ro = new ResizeObserver(function (e) { var r = e[0].contentRect; resize(r.width, r.height); });
            _ro.observe(_container);
        }

        _lastTime = performance.now();
        _tick();
        return true;
    }

    // ── Helpers ────────────────────────────────────────────────
    function _tbl() { return TABLE_SIZES[_cfg.tableSize] || TABLE_SIZES.medium; }

    function _stdMat(col, rough) {
        return new THREE.MeshStandardMaterial({ color: col, roughness: rough !== undefined ? rough : 0.82, metalness: 0 });
    }

    // ── AQ4: room materials & lighting ────────────────────────
    var FLOOR_MATS = {
        wood:     { color: 0x8a5a32, rough: 0.60, tex: 'wood' },
        carpet:   { color: 0x556070, rough: 0.97, tex: 'carpet' },
        tile:     { color: 0xcfd6dd, rough: 0.25, metal: 0.10, tex: 'tile' },
        concrete: { color: 0x8d9095, rough: 0.90, tex: 'concrete' }
    };

    // Cached PBR texture loader for /textures/{name}/{color,normal,roughness}.jpg — shared
    // across rebuilds so swapping materials at runtime never re-fetches or re-uploads a
    // texture already on the GPU (avoids the leak a fresh TextureLoader per rebuild would
    // cause). Falls back to the material's flat colour while loading or on error.
    var _texCache = {};
    var _texLoader = null;
    function _loadTex(url, repeatX, repeatY) {
        var key = url + '@' + repeatX + 'x' + repeatY;
        if (_texCache[key]) return _texCache[key];
        if (!_texLoader) _texLoader = new THREE.TextureLoader();
        var tex = _texLoader.load(url, function () {
            if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);   // repaint once decoded
        });
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        _texCache[key] = tex;
        return tex;
    }
    // Apply a named PBR set (color/normal/roughness maps) from wwwroot/textures/{name}/ to
    // a MeshStandardMaterial. repeatX/repeatY tile the maps across the surface.
    function _applyMaterialMaps(mat, name, repeatX, repeatY) {
        var base = '/textures/' + name + '/';
        var map = _loadTex(base + 'color.jpg', repeatX, repeatY);
        map.colorSpace = THREE.SRGBColorSpace;   // colour map only — normal/roughness stay linear
        mat.map = map;
        mat.normalMap = _loadTex(base + 'normal.jpg', repeatX, repeatY);
        mat.roughnessMap = _loadTex(base + 'roughness.jpg', repeatX, repeatY);
        mat.needsUpdate = true;
    }

    function _floorMat(pal) {
        var override = (_cfg.floorColor && _cfg.floorColor !== 'preset') ? _cfg.floorColor : null;
        var m = FLOOR_MATS[_cfg.floorMaterial];
        if (!m) return _stdMat(override || pal.floor);   // 'preset' or unset → palette/override colour
        var mat = new THREE.MeshStandardMaterial({ color: override || m.color, roughness: m.rough, metalness: m.metal || 0 });
        if (m.tex) _applyMaterialMaps(mat, m.tex, 4, 3);  // colour map untouched — mat.color tints it
        return mat;
    }
    function _wallColor(pal) {
        return (_cfg.wallColor && _cfg.wallColor !== 'preset') ? _cfg.wallColor : pal.wall;
    }
    // Distance-fog/background colour: a darkened tint of the active wall colour, so the
    // "outside" void matches each preset's hue instead of a fixed dark navy.
    function _fogColor() {
        var pal = PAL[_cfg.preset] || PAL.conference;
        var c = new THREE.Color(_wallColor(pal));
        c.multiplyScalar(0.16);
        return c.getHex();
    }
    function _tableTopMat() {
        var mat;
        switch (_cfg.tableMaterial) {
            case 'glass':  return new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.5 });
            case 'marble':
                mat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.25, metalness: 0.10 });
                _applyMaterialMaps(mat, 'marble', 1.5, 1.5);
                return mat;
            default:       // wood
                mat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.58, metalness: 0.04 });
                _applyMaterialMaps(mat, 'wood', 1.5, 1.5);
                return mat;
        }
    }
    function _lightCfg() {
        // r155+ uses physically-based light units for SpotLight/PointLight (candela, not the
        // old arbitrary scale) — multiply prior intensities by Math.PI to match pre-migration
        // brightness. AmbientLight/DirectionalLight intensities are unaffected and unchanged.
        switch (_cfg.lighting) {
            case 'warm': return { amb:0xffe7c2, ambI:0.42, spot:0xffdca8, spotI:2.0*Math.PI, fill:0xffb060, fillI:0.25 };
            case 'cool': return { amb:0xdce9ff, ambI:0.42, spot:0xe8f0ff, spotI:2.0*Math.PI, fill:0x88aaff, fillI:0.40 };
            case 'neon': return { amb:0xff66ff, ambI:0.30, spot:0x66ffff, spotI:1.8*Math.PI, fill:0xff44aa, fillI:0.55 };
            default:     return { amb:0xffffff, ambI:0.40, spot:0xfff9ee, spotI:2.0*Math.PI, fill:0x88aaff, fillI:0.35 };
        }
    }

    // ── Room geometry ─────────────────────────────────────────
    function _buildRoom() {
        var pal = PAL[_cfg.preset] || PAL.conference;
        _winAnims = [];   // dropped meshes from any previous build are no longer animated
        // Dispose any live GIF textures from the previous build.
        _gifTextures.forEach(function(g){
            if (g.tex) g.tex.dispose();
            if (g.img && g.img.parentNode) g.img.parentNode.removeChild(g.img);
        });
        _gifTextures = [];
        // Dispose any live <video> window textures from the previous build — otherwise
        // each rebuild leaks a hidden playing <video> element + VideoTexture.
        _videoTextures.forEach(function(v){
            v.video.pause();
            v.video.removeAttribute('src');
            v.video.load();
            if (v.video.parentNode) v.video.parentNode.removeChild(v.video);
            v.tex.dispose();
        });
        _videoTextures = [];

        var wallCol = _wallColor(pal);

        // Re-tint the void/fog to match this preset (covers preset/wall-colour changes
        // applied via refreshScene, not just initial init()).
        _scene.background = new THREE.Color(_fogColor());
        if (_scene.fog) _scene.fog = new THREE.FogExp2(_fogColor(), 0.042);

        var floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), _floorMat(pal));
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; _scene.add(floor);

        var ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), _stdMat(pal.ceil, 0.95));
        ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM_H; _scene.add(ceil);

        var wallL = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), _stdMat(wallCol));
        wallL.rotation.y = Math.PI / 2; wallL.position.set(-ROOM_W / 2, ROOM_H / 2, 0); _scene.add(wallL);

        var wallR = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), _stdMat(wallCol));
        wallR.rotation.y = -Math.PI / 2; wallR.position.set(ROOM_W / 2, ROOM_H / 2, 0); _scene.add(wallR);

        var view = _windowView();
        if (view === 'none') {
            // Solid back wall, no outdoor view.
            var wallB = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), _stdMat(wallCol));
            wallB.position.set(0, ROOM_H / 2, -ROOM_D / 2); _scene.add(wallB);
        } else {
            _buildWindowWall(pal, view);
        }

        if (_cfg.whiteboard !== false) _buildWhiteboard();
        _buildProps();
        // NOTE: corner plants are now draggable FURNITURE items (see _defaultFurniture),
        // not static room decor — so they can be selected and moved. The old static
        // _buildPlant() decor was removed to avoid un-grabbable duplicates near the camera.
    }

    // Resolve the active window view, honouring the legacy `skyline` boolean.
    function _windowView() {
        if (_cfg.windowView) return _cfg.windowView;
        return (_cfg.skyline === false) ? 'none' : 'skyline';
    }


    // just slim frame strips around a big sheet of glass, so the view is visible and
    // the "space outside" matches the selected window view.
    function _buildWindowWall(pal, view) {
        var zWall = -ROOM_D / 2;
        var sill = 0.28, header = 0.26, jamb = 0.22;
        var OW = ROOM_W - jamb * 2;          // opening width
        var OH = ROOM_H - sill - header;     // opening height
        var cy = sill + OH / 2;              // opening centre Y

        var frameMat = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.45, metalness: 0.25 });
        var bottom = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, sill, 0.14), frameMat);
        bottom.position.set(0, sill / 2, zWall + 0.02); _scene.add(bottom);
        var topb = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, header, 0.14), frameMat);
        topb.position.set(0, ROOM_H - header / 2, zWall + 0.02); _scene.add(topb);
        var jL = new THREE.Mesh(new THREE.BoxGeometry(jamb, ROOM_H, 0.14), frameMat);
        jL.position.set(-ROOM_W / 2 + jamb / 2, ROOM_H / 2, zWall + 0.02); _scene.add(jL);
        var jR = new THREE.Mesh(new THREE.BoxGeometry(jamb, ROOM_H, 0.14), frameMat);
        jR.position.set(ROOM_W / 2 - jamb / 2, ROOM_H / 2, zWall + 0.02); _scene.add(jR);

        var V  = WINDOW_VIEWS[view] || WINDOW_VIEWS.skyline;
        var zb = zWall - 0.7;                // outdoor scene depth (set back for a sense of distance)
        var tod = _timeOfDay();
        if (view === 'custom' && (_cfg.windowMediaId || _cfg.windowImage)) {
            var _src, _mime;
            if (_cfg.windowMediaId) {
                var _room = (window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || '';
                _src = '/api/rooms/' + encodeURIComponent(_room) + '/window-media/' + _cfg.windowMediaId;
                _mime = _cfg.windowMediaMime || null;
            } else {
                _src = _cfg.windowImage;
                _mime = null;
            }
            // Custom media sits right behind the glass/mullions (unlike the sky
            // backdrop's zb, which is set back for depth) — at zb the image/video
            // plane is much smaller than the frame opening from an angle, so the
            // void behind the frame was visible around its edges.
            _buildCustomWindowMedia(_src, _mime, OW, OH, cy, zWall + 0.01);
        } else {
            // Large sky backdrop, wider/taller than the opening so the view reads as open sky.
            var sky = new THREE.Mesh(new THREE.PlaneGeometry(OW * 1.8, OH * 2.4),
                new THREE.MeshStandardMaterial({ color: V.sky, emissive: V.sky,
                    emissiveIntensity: (V.skyEmi || 0.4) * tod.emi, roughness: 1 }));
            sky.position.set(0, cy, zb - 0.5); _scene.add(sky);

            // Outdoor scene content authored for a native 3.0 × 1.72 window, scaled to fill
            // the full opening. Primitives are added to _winGroup in group-local coords.
            _winGroup = new THREE.Group();
            _winGroup.position.set(0, cy, zb);
            _winGroup.scale.set(OW / 3.0, OH / 1.72, 1);
            _scene.add(_winGroup);
            if (V.build) V.build();
            _winGroup = null;

            // Day/night tint overlay (skipped for views that set their own mood).
            if (tod.tintOpacity > 0 && view !== 'space' && view !== 'night') {
                var tint = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH),
                    new THREE.MeshBasicMaterial({ color: tod.tint, transparent: true, opacity: tod.tintOpacity }));
                tint.position.set(0, cy, zWall + 0.03); _scene.add(tint);
            }
        }

        // Window grid (mullions) sitting just inside the glass.
        var mm = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.35, metalness: 0.35 });
        [-OW / 3, 0, OW / 3].forEach(function (x) {
            var b = new THREE.Mesh(new THREE.BoxGeometry(0.05, OH, 0.05), mm);
            b.position.set(x, cy, zWall + 0.05); _scene.add(b);
        });
        var barH = new THREE.Mesh(new THREE.BoxGeometry(OW, 0.05, 0.05), mm);
        barH.position.set(0, cy, zWall + 0.05); _scene.add(barH);

        // Glass tint across the whole opening.
        var glass = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH),
            new THREE.MeshStandardMaterial({ color: V.glass || 0x8ac8ff, transparent: true, opacity: 0.10, roughness: 0 }));
        glass.position.set(0, cy, zWall + 0.04); _scene.add(glass);
    }

    // Renders the 🎨 custom window media (uploaded image or looping video) filling the
    // window opening. `mime` comes from the server media entry when available; falls back
    // to sniffing `src` (data URL or file extension) for legacy windowImage data URLs.
    function _buildCustomWindowMedia(src, mime, OW, OH, cy, zb) {
        var _isVideo = mime ? /^video\/(mp4|webm)$/.test(mime)
            : (/^data:video\/(mp4|webm)/.test(src) || /\.(mp4|webm)(\?|$)/i.test(src));
        if (_isVideo) {
            // 1. Setup the Video Element
            const video = document.createElement('video');
            video.src = src;
            video.crossOrigin = 'anonymous';    // Fixes CORS issues if loading from a server
            video.loop = true;
            video.muted = true;
            video.setAttribute('playsinline', '');
            video.style.display = 'none';

            // Force attachment to DOM (fixes Safari/iOS black screen)
            document.body.appendChild(video);

            // 2. Create the Texture
            const skylineTexture = new THREE.VideoTexture(video);
            skylineTexture.minFilter = THREE.LinearFilter;
            skylineTexture.magFilter = THREE.LinearFilter;

            // 3. Apply to Material
            const skylineMaterial = new THREE.MeshBasicMaterial({
                map: skylineTexture,
                side: THREE.DoubleSide
            });

            // 1. Create the Geometry (A flat plane to act as the screen)
            // The numbers (20, 10) are the Width and Height. Make it big enough to cover the window!
            const skylineGeometry = new THREE.PlaneGeometry(OW, OH);

            // 2. Combine the Geometry and the Material into a visible Mesh
            const skylineMesh = new THREE.Mesh(skylineGeometry, skylineMaterial);

            // 3. Position the Mesh behind the window — same spot the static-image
            // branch uses, so video and image fill the opening identically.
            skylineMesh.position.set(0, cy, zb);

            // Optional: If the video looks backwards, you can flip the plane around
            // skylineMesh.rotation.y = Math.PI;

            // 4. Add the Mesh to your scene (CRITICAL)
            _scene.add(skylineMesh);
            _videoTextures.push({ video: video, tex: skylineTexture });

            // 4. Wait for data BEFORE playing
            video.addEventListener('loadeddata', function () {
                video.play().catch(function (err) {
                    console.warn("Autoplay blocked:", err);
                });
            });

            video.addEventListener('playing', function () {
                // Force WebGL to grab the frame now that it's moving
                skylineTexture.needsUpdate = true;
            });

            video.addEventListener('error', function (err) {
                console.error("Error loading video:", video.error);
                if (window._showToastAD) window._showToastAD("This browser can't play this video format.", 'warning');
                else alert("This browser can't play this video format.");
            });
        } else {
            // 🎨 Static custom image fills the opening.
            var tex = new THREE.TextureLoader().load(src, function () {
                if (_renderer) _renderer.render(_scene, _camera);   // repaint once decoded
            });
            tex.colorSpace = THREE.SRGBColorSpace;
            var img = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH),
                new THREE.MeshBasicMaterial({ map: tex }));
            img.position.set(0, cy, zb); _scene.add(img);
        }
    }

    // Window-scene primitives. Coordinates are LOCAL to _winGroup, which is positioned
    // at the window centre and scaled to the opening. The native window is 3.0 wide
    // (x ∈ [−1.5, 1.5]) and 1.72 tall; GROUND g = −0.86 is the bottom edge. zRel layers
    // overlapping elements toward the viewer (+z) without z-fighting.
    function _winBox(x, y, w, h, color, emi, zRel) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.2 : emi }));
        m.position.set(x, y, zRel || 0);
        (_winGroup || _scene).add(m);
        return m;
    }
    function _winDisc(x, y, r, color, emi, zRel) {
        var m = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.6 : emi }));
        m.position.set(x, y, (zRel || 0) + 0.005);
        (_winGroup || _scene).add(m);
        return m;
    }
    function _winTri(x, y, w, h, color, emi, zRel) {
        var s = new THREE.Shape();
        s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
        var m = new THREE.Mesh(new THREE.ShapeGeometry(s),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.2 : emi }));
        m.position.set(x, y, zRel || 0);
        (_winGroup || _scene).add(m);
        return m;
    }

    // Soft cloud: a row of overlapping white discs, registered for horizontal drift.
    function _winCloud(x, y, scale, speed, phase) {
        var g = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.45, transparent: true, opacity: 0.92 });
        [[-0.22,0,0.16],[0,0.05,0.22],[0.24,0,0.17],[0.06,-0.05,0.19]].forEach(function (d) {
            var c = new THREE.Mesh(new THREE.CircleGeometry(d[2], 16), mat);
            c.position.set(d[0], d[1], 0); g.add(c);
        });
        g.scale.setScalar(scale || 1);
        g.position.set(x, y, 0.005);
        (_winGroup || _scene).add(g);
        _winRegister(g, { type: 'drift', amp: 0.9, speed: speed || 0.16, phase: phase || 0 });
        return g;
    }

    // Register an animated window element. baseX/baseY/baseRotZ/baseEmi captured now.
    function _winRegister(obj, p) {
        if (!obj) return obj;
        p.obj = obj;
        p.phase  = p.phase || 0;
        p.baseX  = obj.position.x;
        p.baseY  = obj.position.y;
        p.baseRot = obj.rotation.z;
        p.baseEmi = (obj.material && obj.material.emissiveIntensity != null) ? obj.material.emissiveIntensity : 0;
        _winAnims.push(p);
        return obj;
    }

    function _reducedMotion() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
        catch (e) { return false; }
    }

    // Deterministic pseudo-random in [0,1) — stable star/nebula layout across rebuilds.
    function _rand(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

    // Day/night tint for the window. 'auto' follows the local clock; day/dusk/night force it.
    // Returns { tint, tintOpacity, emi } — emi scales the sky brightness.
    function _timeOfDay() {
        var mode = _cfg.windowTimeOfDay || 'day';
        var h;
        if      (mode === 'day')   return { tint: 0x000000, tintOpacity: 0.0,  emi: 1.0 };
        else if (mode === 'dusk')  h = 19;
        else if (mode === 'night') h = 1;
        else                       h = new Date().getHours();   // auto
        if (h >= 7 && h < 17)  return { tint: 0x000000, tintOpacity: 0.0,  emi: 1.0 };   // day
        if (h >= 17 && h < 20) return { tint: 0xff7a3a, tintOpacity: 0.20, emi: 0.78 };  // dusk (warm)
        if (h >= 20 || h < 5)  return { tint: 0x0a1430, tintOpacity: 0.45, emi: 0.42 };  // night
        return { tint: 0x9ec0ff, tintOpacity: 0.12, emi: 0.85 };                          // dawn
    }

    // Window-view catalog. Each build() draws the scene behind the glass using the
    // group-local _win* helpers (signature: x, y, w/h/r, color, emi, zRel).
    var WINDOW_VIEWS = {
        'skyline': {
            sky: 0x9ec9e8, glass: 0x8ac8ff, skyEmi: 0.4,
            build: function () {
                var g = -0.86;
                [
                    {x:-1.20,w:0.35,h:0.55,c:0x2c3a50},{x:-0.70,w:0.30,h:0.80,c:0x1e2d42},
                    {x:-0.20,w:0.42,h:0.62,c:0x364a60},{x: 0.40,w:0.28,h:0.95,c:0x28394e},
                    {x: 0.90,w:0.38,h:0.50,c:0x3a4f68},{x: 1.30,w:0.25,h:0.70,c:0x243546}
                ].forEach(function (b) { _winBox(b.x, g + b.h / 2, b.w, b.h, b.c, 0.25, 0); });
                _winCloud(-0.9, 0.52, 1.0, 0.14, 0.0);   // drifting clouds
                _winCloud(0.6, 0.64, 0.7, 0.10, 1.6);
            }
        },
        'beach': {
            sky: 0xbfe6ff, glass: 0x9fd8ff, skyEmi: 0.5,
            build: function () {
                _winRegister(_winDisc(0.95, 0.42, 0.2, 0xfff2b0, 0.85, 0), { type:'twinkle', amp:0.30, speed:1.0 });  // sun glow
                _winRegister(_winBox(0, -0.55, 3.0, 0.62, 0x2a93c8, 0.3, 0), { type:'shimmer', amp:0.16, speed:1.5 }); // shimmering sea
                _winBox(0, -0.80, 3.0, 0.22, 0xe8d9a8, 0.25, 0.01);// sand
                _winRegister(_winTri(-0.6, -0.42, 0.18, 0.18, 0xffffff, 0.4, 0.02), { type:'drift', amp:0.55, speed:0.12 }); // sailboat
                _winCloud(0.3, 0.6, 0.7, 0.12, 0.6);
            }
        },
        'mountains': {
            sky: 0xcfe4f2, glass: 0xbcd6e8, skyEmi: 0.45,
            build: function () {
                var g = -0.86;
                _winTri(-0.75, g, 1.5, 1.05, 0x6b7d8c, 0.18, 0);          // back peak
                _winTri(-0.75, g + 0.78, 0.45, 0.30, 0xffffff, 0.3, 0.02); // snow cap
                _winTri(0.55, g, 1.7, 1.25, 0x5a6b78, 0.16, 0.01);         // front peak
                _winTri(0.55, g + 0.95, 0.5, 0.32, 0xffffff, 0.3, 0.03);
                _winBox(0, g + 0.07, 3.0, 0.14, 0x4a6b4f, 0.2, 0.02);      // tree line
                _winCloud(-0.4, 0.55, 0.8, 0.09, 0.4);   // slow high clouds
                _winCloud(0.85, 0.64, 0.6, 0.07, 1.9);
            }
        },
        'night': {
            sky: 0x0c1a33, glass: 0x16335c, skyEmi: 0.12,
            build: function () {
                var g = -0.86;
                _winDisc(-0.95, 0.45, 0.16, 0xf2f0d8, 0.7, 0);     // moon
                [[-0.4,0.55],[0.2,0.62],[0.7,0.4],[1.1,0.55],[-1.1,0.2],[0.4,0.3]].forEach(function (s, i) {
                    _winRegister(_winDisc(s[0], s[1], 0.018, 0xffffff, 0.9, 0),
                        { type:'twinkle', amp:0.6, speed:1.4 + (i % 3) * 0.6, phase: i * 1.7 });  // twinkling stars
                });
                [
                    {x:-0.9,w:0.4,h:0.7},{x:-0.3,w:0.34,h:0.95},
                    {x:0.35,w:0.46,h:0.78},{x:1.0,w:0.32,h:1.05}
                ].forEach(function (b) {
                    _winBox(b.x, g + b.h / 2, b.w, b.h, 0x070d1a, 0.05, 0.01);
                    for (var r = 0; r < 3; r++) for (var c = 0; c < 2; c++) {
                        if ((r + c + Math.round(b.x * 10)) % 2 === 0) continue;
                        var lit = _winBox(b.x - b.w / 4 + c * b.w / 2, g + 0.12 + r * (b.h / 3.5),
                            0.05, 0.05, 0xffd87a, 0.9, 0.02);
                        // A few windows flicker on/off like a living city.
                        if ((r + c) % 2 === 1) _winRegister(lit, { type:'twinkle', amp:0.8, speed:0.6 + r * 0.3, phase: b.x * 4 + c });
                    }
                });
            }
        },
        'forest': {
            sky: 0xcfe6d0, glass: 0xb9dcc0, skyEmi: 0.4,
            build: function () {
                var g = -0.86;
                _winBox(0, g + 0.1, 3.0, 0.2, 0x3f6b3a, 0.2, 0);   // ground
                [
                    {x:-1.1,h:0.7,c:0x2f5a2c},{x:-0.6,h:0.95,c:0x35632f},
                    {x:-0.1,h:0.8,c:0x2c5429},{x:0.45,h:1.05,c:0x386a32},
                    {x:0.95,h:0.75,c:0x2f5a2c},{x:1.3,h:0.9,c:0x356330}
                ].forEach(function (t) {
                    _winBox(t.x, g + 0.18, 0.06, 0.2, 0x6b4a2c, 0.1, 0);   // trunk
                    _winRegister(_winTri(t.x, g + 0.18, 0.5, t.h, t.c, 0.18, 0.01),
                        { type:'sway', amp:0.035, speed:0.8, phase: t.x });          // foliage sway in the breeze
                    _winRegister(_winTri(t.x, g + 0.18 + t.h * 0.45, 0.38, t.h * 0.6, t.c, 0.2, 0.02),
                        { type:'sway', amp:0.05, speed:0.9, phase: t.x + 1 });
                });
                _winCloud(0.3, 0.62, 0.7, 0.10, 0.5);
            }
        },
        'space': {
            sky: 0x05060f, glass: 0x223055, skyEmi: 0.05,
            build: function () {
                // Soft nebula clouds — large, faint, slowly drifting.
                [[-0.7,0.25,0x3b2a6b,0.95],[0.65,-0.05,0x244a6b,1.05],[0.05,0.5,0x5b2a5a,0.8]].forEach(function (n, i) {
                    var m = _winDisc(n[0], n[1], n[3], n[2], 0.16, 0);
                    m.material.transparent = true; m.material.opacity = 0.5;
                    _winRegister(m, { type:'drift', amp:0.22, speed:0.04 + i * 0.02, phase:i * 2 });
                });
                _winDisc(0.95, -0.45, 0.26, 0x7a6a4a, 0.22, 0.02);   // distant planet
                _winDisc(0.95, -0.45, 0.27, 0x000000, 0.0, 0.015);   // planet shadow rim (subtle)
                // Star field — deterministic layout, individually twinkling.
                for (var s = 0; s < 28; s++) {
                    var x = _rand(s) * 3 - 1.5, y = _rand(s + 99) * 1.66 - 0.83;
                    var st = _winDisc(x, y, 0.010 + _rand(s + 7) * 0.012, 0xffffff, 0.9, 0.03);
                    _winRegister(st, { type:'twinkle', amp:0.6, speed:0.9 + _rand(s + 3) * 2.2, phase:s * 1.3 });
                }
            }
        },
        'custom': {
            // Used when an uploaded image is set (handled in _buildWindowWall). The sky/glass
            // here are the fallback shown if 'custom' is selected without an image yet.
            sky: 0x2a2f3a, glass: 0xaecbff, skyEmi: 0.25,
            build: function () {
                _winBox(0, 0, 1.4, 0.5, 0x556070, 0.15, 0);   // placeholder frame
            }
        }
    };

    function _buildWhiteboard() {
        // Mounted on the LEFT wall (the back wall is now a full window). The board group
        // is rotated +90° about Y so its face points into the room (+x). The board surface
        // is textured with the live shared whiteboard, and clicking it opens it to draw.
        var g = new THREE.Group();
        var wbP = _decorPos.wb;
        g.rotation.y = (wbP && wbP.rot !== undefined) ? wbP.rot : Math.PI / 2;
        g.position.set(wbP ? wbP.x : (-ROOM_W / 2 + 0.06), 1.45, wbP ? wbP.z : -0.6);
        _wbGroup = g;

        if (_wbTex) { _wbTex.dispose(); }
        _wbTex = null; _wbVer = -1;
        var boardMat;
        if (window.Whiteboard && Whiteboard.getBoardCanvas) {
            try {
                _wbTex = new THREE.CanvasTexture(Whiteboard.getBoardCanvas());
                _wbTex.colorSpace = THREE.SRGBColorSpace;
                _wbVer = Whiteboard.getVersion();
                boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: _wbTex, roughness: 0.7 });
            } catch (e) { boardMat = null; }
        }
        if (!boardMat) boardMat = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.65 });

        var board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.04), boardMat);
        board.position.set(0, 0, 0.05); board.userData.isWhiteboard = true; g.add(board);
        _wbBoard = board;
        var fm = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.4, metalness: 0.6 });
        [0.57,-0.57].forEach(function(dy){
            var b=new THREE.Mesh(new THREE.BoxGeometry(1.86,0.055,0.05),fm);
            b.position.set(0,dy,0.07); g.add(b);
        });
        [-0.93,0.93].forEach(function(dx){
            var b=new THREE.Mesh(new THREE.BoxGeometry(0.055,1.1,0.05),fm);
            b.position.set(dx,0,0.07); g.add(b);
        });
        _scene.add(g);
    }

    // ── Interactive props + story screen ──────────────────────
    function _currentStoryTitle() {
        var rs = window.roomState;
        if (!rs || !rs.stories || !rs.stories.length) return 'No story selected';
        for (var i = 0; i < rs.stories.length; i++) if (rs.stories[i].id === rs.currentStoryId) return rs.stories[i].title || '(untitled)';
        return 'No story selected';
    }
    function _updateStoryScreen() {
        if (_storyScreenLabel) _storyScreenLabel.textContent = '📋 ' + _currentStoryTitle();
    }
    function _makeEmojiProp(emoji, color) {
        var g = new THREE.Group();
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.20, 0.5, 12),
            new THREE.MeshStandardMaterial({ color: 0x33384a, roughness: 0.6, metalness: 0.3 }));
        base.position.y = 0.25; g.add(base);
        var orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 }));
        orb.position.y = 0.62; g.add(orb);
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 8), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.5; g.add(pick);
        var labelObj = null;
        if (CSS2DObject) {
            var d = document.createElement('div');
            d.textContent = emoji; d.style.cssText = 'font-size:1.3rem;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));';
            labelObj = new CSS2DObject(d); labelObj.position.set(0, 0.98, 0); g.add(labelObj);
        }
        return { group: g, pick: pick, labelObj: labelObj };
    }

    // CSS2DObjects retired from props (re-built every _buildProps call) — the
    // renderer stops managing an object once it leaves the scene graph, so we
    // must remove its DOM element ourselves to avoid orphaned 🎉/🎵/screen labels.
    var _propLabelObjs = [];
    function _disposePropLabels() {
        _propLabelObjs.forEach(function (lo) {
            if (lo.parent) lo.parent.remove(lo);
            if (lo.element && lo.element.parentNode) lo.element.parentNode.removeChild(lo.element);
        });
        _propLabelObjs = [];
    }
    function _buildProps() {
        _disposePropLabels();
        _props = [];
        _storyScreenLabel = null;

        // Story screen — default on the RIGHT wall (faces into the room), draggable to
        // any wall (P4: _decorPos.screen overrides position + rotation).
        var sg = new THREE.Group();
        var scP = _decorPos.screen;
        sg.position.set(scP ? scP.x : (ROOM_W / 2 - 0.05), 1.6, scP ? scP.z : 0.6);
        sg.rotation.y = (scP && scP.rot !== undefined) ? scP.rot : -Math.PI / 2;
        _screenGroup = sg;
        var frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.45 }));
        sg.add(frame);
        var screen = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.94),
            new THREE.MeshStandardMaterial({ color: 0x0e2138, emissive: 0x12365e, emissiveIntensity: 0.5, roughness: 0.3 }));
        screen.position.z = 0.04; sg.add(screen);
        _screenMesh = screen;
        _scene.add(sg);
        if (CSS2DObject) {
            var d = document.createElement('div');
            d.className = 'rs3d-screen-label';
            d.style.cssText = 'color:#dcebff;color:#cfe3ff;font:600 13px sans-serif;text-align:center;width:160px;' +
                'text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.25;';
            _storyScreenLabel = d;
            var lo = new CSS2DObject(d);
            // Local offset (0,0,0.11): with the screen group's local +z always pointing
            // into the room (by construction of the wall-snap rotations below), this
            // floats the label just in front of the screen on whichever wall it's on.
            lo.position.set(0, 0, 0.11);
            sg.add(lo);
            _propLabelObjs.push(lo);
        }
        _updateStoryScreen();

        // Confetti + music props (clickable / E-interact, draggable anywhere on the floor).
        var conf = _makeEmojiProp('🎉', 0xff4fa3);
        var confP = _decorPos.confetti;
        conf.group.position.set(confP ? confP.x : (ROOM_W / 2 - 0.9), 0, confP ? confP.z : (-ROOM_D / 2 + 0.9));
        conf.group.rotation.y = (confP && confP.rot !== undefined) ? confP.rot : 0;
        _scene.add(conf.group);
        _props.push({ mesh: conf.pick, group: conf.group, action: 'confetti', key: 'confetti' });
        if (conf.labelObj) _propLabelObjs.push(conf.labelObj);

        var juke = _makeEmojiProp('🎵', 0x6b8cff);
        var jukeP = _decorPos.music;
        juke.group.position.set(jukeP ? jukeP.x : (-ROOM_W / 2 + 0.9), 0, jukeP ? jukeP.z : (ROOM_D / 2 - 0.9));
        juke.group.rotation.y = (jukeP && jukeP.rot !== undefined) ? jukeP.rot : 0;
        _scene.add(juke.group);
        _props.push({ mesh: juke.pick, group: juke.group, action: 'music', key: 'music' });
        if (juke.labelObj) _propLabelObjs.push(juke.labelObj);
    }
    function _propMeshes() { return _props.filter(function (p) { return p.mesh && p.action; }).map(function (p) { return p.mesh; }); }
    function _propForMesh(m) { for (var i = 0; i < _props.length; i++) if (_props[i].mesh === m) return _props[i]; return null; }
    function _runProp(action) {
        if (action === 'confetti') { if (window._rsRoomConfetti) _rsRoomConfetti(); }
        else if (action === 'music') { if (window._rsRoomSound) _rsRoomSound('fanfare'); }
    }
    // Short verb shown in the "Press E to ..." prompt (P9) for a given prop action.
    function _propLabel(action) {
        if (action === 'confetti') return 'set off confetti';
        if (action === 'music') return 'play music';
        return 'interact';
    }

    function _buildPlant(x, z) {
        var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.08,0.22,8),
            new THREE.MeshStandardMaterial({color:0xb85c30,roughness:0.9}));
        pot.position.set(x, 0.11, z);
        _scene.add(pot);
        var lm = new THREE.MeshStandardMaterial({color:0x2d7a3a,roughness:0.88});
        [[0,0.46,0],[0.12,0.37,0.09],[-0.09,0.39,-0.07]].forEach(function(o){
            var s=new THREE.Mesh(new THREE.SphereGeometry(0.13+Math.abs(o[0])*0.15,6,6),lm);
            s.position.set(x+o[0],0.22+o[1],z+o[2]); _scene.add(s);
        });
    }

    // Soft radial-gradient "contact shadow" canvas, generated once and cached — used to
    // ground the table without relying on (more expensive) extra shadow-casting lights.
    var _contactShadowTex = null;
    function _contactShadowTexture() {
        if (_contactShadowTex) return _contactShadowTex;
        var size = 256;
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        var ctx = canvas.getContext('2d');
        var grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        _contactShadowTex = new THREE.CanvasTexture(canvas);
        return _contactShadowTex;
    }
    function _buildContactShadow(t, group) {
        var w, d;
        if (_cfg.tableShape === 'rect') { w = t.RW * 1.35; d = t.RD * 1.5; }
        else { w = d = t.RR * 2.6; }
        var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
            map: _contactShadowTexture(), transparent: true, opacity: 0.35, depthWrite: false
        }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.005;
        group.add(mesh);
    }

    function _buildTable() {
        var t = _tbl();
        var off = _tableOffset();
        var g = new THREE.Group();
        g.position.set(off.x, 0, off.z);
        var tp = _decorPos.table;
        g.rotation.y = (tp && tp.rot !== undefined) ? tp.rot : 0;
        _tableGroup = g;
        _buildContactShadow(t, g);
        var mat = _tableTopMat();
        var lm  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.45, metalness: 0.75 });
        if (_cfg.tableShape === 'rect') {
            var top = new THREE.Mesh(new THREE.BoxGeometry(t.RW, 0.07, t.RD), mat);
            top.position.y = TBL_TOP; top.castShadow = true; g.add(top);
            [[-t.RW/2+0.12,-t.RD/2+0.12],[t.RW/2-0.12,-t.RD/2+0.12],
             [-t.RW/2+0.12, t.RD/2-0.12],[t.RW/2-0.12, t.RD/2-0.12]].forEach(function(p){
                var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,TBL_TOP,8),lm);
                leg.position.set(p[0],TBL_TOP/2,p[1]); g.add(leg);
            });
        } else {
            var top2 = new THREE.Mesh(new THREE.CylinderGeometry(t.RR,t.RR,0.07,36),mat);
            top2.position.y = TBL_TOP; top2.castShadow = true; g.add(top2);
            var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.19,TBL_TOP,8),lm);
            ped.position.y = TBL_TOP/2; g.add(ped);
        }
        _scene.add(g);
    }

    function _buildLights() {
        var L = _lightCfg();
        _scene.add(new THREE.AmbientLight(L.amb, L.ambI));
        var spot = new THREE.SpotLight(L.spot, L.spotI);
        spot.position.set(0,ROOM_H-0.05,0); spot.target.position.set(0,0,0);
        spot.angle=Math.PI/3.6; spot.penumbra=0.55; spot.castShadow=true;
        spot.shadow.mapSize.set(1024,1024); spot.shadow.camera.near=0.5; spot.shadow.camera.far=7;
        _scene.add(spot); _scene.add(spot.target);
        var fill = new THREE.DirectionalLight(L.fill, L.fillI);
        fill.position.set(0,2.5,-ROOM_D/2); _scene.add(fill);
        var shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.30,0.08,12,1,true),
            new THREE.MeshStandardMaterial({color:L.spot,side:THREE.BackSide,emissive:L.spot,emissiveIntensity:0.55}));
        shade.position.set(0,ROOM_H-0.01,0); _scene.add(shade);
    }

    // ── Phase 3: Furniture system ─────────────────────────────

    function _furnitureKey() {
        return 'es_rs3d_furniture_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default');
    }

    function _defaultFurniture() {
        return [
            { id: 1, type: 'plant',        x: -4.2, z:  2.8 },
            { id: 2, type: 'plant',        x:  4.2, z:  2.8 },
            { id: 3, type: 'coffee_table', x:  3.5, z: -1.5 },
            { id: 4, type: 'projector',    x:  2.5, z: -3.0 }
        ];
    }

    function _loadFurniture() {
        try {
            var saved = JSON.parse(localStorage.getItem(_furnitureKey()) || 'null');
            return saved || _defaultFurniture();
        } catch (e) { return _defaultFurniture(); }
    }

    function _saveFurniture() {
        var json, data;
        try {
            data = _furnitureObjs.map(function(f){ return { id:f.id, type:f.type, x:f.x, z:f.z, rot:f.rot || 0 }; });
            json = JSON.stringify(data);
            localStorage.setItem(_furnitureKey(), json);
        } catch (e) {}
        if (window.RoomSceneStore && data) RoomSceneStore.set({ furniture: data }, { source: _applyingRemote ? 'remote' : 'local', slice: 'furniture', fields: ['furniture'] });
        // Broadcast the new layout to the room (unless we're applying a peer's change).
        if (!_applyingRemote && json && window.RoomSceneNet && RoomSceneNet.setLayout) {
            RoomSceneNet.setLayout(json);
        }
    }

    // Apply a furniture layout received from a peer (or RoomState). Rebuilds the room
    // furniture without re-broadcasting. Works even before the 3D scene is mounted —
    // it caches to localStorage so the layout shows when 3D GL opens.
    function applyRemoteLayout(layoutJson) {
        var layout;
        try { layout = JSON.parse(layoutJson); } catch (e) { return; }
        if (!Array.isArray(layout)) return;
        if (window.RoomSceneStore) RoomSceneStore.set({ furniture: layout }, { source: 'remote', slice: 'furniture', fields: ['furniture'] });
        _applyingRemote = true;
        try {
            try { localStorage.setItem(_furnitureKey(), JSON.stringify(layout)); } catch (e) {}
            if (_scene) {
                _deselectAll();
                _buildFurniture(layout);
            }
        } finally {
            _applyingRemote = false;
        }
    }

    function _clearFurniture() {
        _furnitureObjs.forEach(function(f){ if (_scene && f.group) _scene.remove(f.group); });
        _furnitureObjs = [];
    }

    function _buildFurniture(layout) {
        _clearFurniture();
        var nextId = Date.now();
        layout.forEach(function(item){
            var res = _makeFurnitureMesh(item.type);
            if (!res) return;
            var id = item.id || nextId++;
            var rot = item.rot || 0;
            res.group.position.set(item.x, 0, item.z);
            res.group.rotation.y = rot;
            res.group.userData.furnitureId = id;
            res.pickMesh.userData.furnitureId = id;
            res.pickMesh.userData.isFurniture = true;
            _scene.add(res.group);
            _furnitureObjs.push({ id: id, type: item.type, x: item.x, z: item.z, rot: rot, group: res.group, pickMesh: res.pickMesh });
        });
    }

    function _makeFurnitureMesh(type) {
        switch (type) {
            case 'plant':         return _makeFurniturePlant();
            case 'coffee_table':  return _makeCoffeeTable();
            case 'projector':     return _makeProjectorScreen();
            case 'whiteboard':    return _makeStandingWhiteboard();
            case 'sofa':          return _makeSofa();
            case 'lamp':          return _makeFloorLamp();
            case 'bookshelf':     return _makeBookshelf();
            case 'monitor':       return _makeMonitor();
            case 'jukebox':       return _makeJukeboxFurniture();
            case 'bin':           return _makeWasteBin();
            default:              return null;
        }
    }

    function _makeFurniturePlant() {
        var g = new THREE.Group();
        var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.08,0.22,8),
            new THREE.MeshStandardMaterial({color:0xb85c30,roughness:0.9}));
        pot.position.y = 0.11; g.add(pot);
        var lm = new THREE.MeshStandardMaterial({color:0x2d7a3a,roughness:0.88});
        [[0,0.46,0],[0.12,0.37,0.09],[-0.09,0.39,-0.07]].forEach(function(o){
            var s=new THREE.Mesh(new THREE.SphereGeometry(0.13+Math.abs(o[0])*0.15,6,6),lm);
            s.position.set(o[0],0.22+o[1],o[2]); g.add(s);
        });
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.30,0.90,8),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.45; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeCoffeeTable() {
        var g = new THREE.Group();
        var top = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,0.04,16),
            new THREE.MeshStandardMaterial({color:0x5a3a20,roughness:0.6,metalness:0.05}));
        top.position.y = 0.50; g.add(top);
        var lm = new THREE.MeshStandardMaterial({color:0x3a2a10,roughness:0.65,metalness:0.3});
        for (var i = 0; i < 3; i++) {
            var a = i * (Math.PI * 2 / 3);
            var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.50,6),lm);
            leg.position.set(Math.cos(a)*0.28, 0.25, Math.sin(a)*0.28); g.add(leg);
        }
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.55,8),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.28; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeProjectorScreen() {
        var g = new THREE.Group();
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,1.80,6),
            new THREE.MeshStandardMaterial({color:0x888888,roughness:0.3,metalness:0.7}));
        pole.position.y = 0.90; g.add(pole);
        var screen = new THREE.Mesh(new THREE.BoxGeometry(1.20,0.75,0.025),
            new THREE.MeshStandardMaterial({color:0xf0f0ee,roughness:0.8}));
        screen.position.y = 1.55; g.add(screen);
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.20,0.04,8),
            new THREE.MeshStandardMaterial({color:0x444444,roughness:0.4,metalness:0.6}));
        base.position.y = 0.02; g.add(base);
        var pick = new THREE.Mesh(new THREE.BoxGeometry(1.20,1.95,0.40),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.96; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeStandingWhiteboard() {
        var g = new THREE.Group();
        var board = new THREE.Mesh(new THREE.BoxGeometry(1.20,0.80,0.03),
            new THREE.MeshStandardMaterial({color:0xf4f4ef,roughness:0.65}));
        board.position.y = 1.10; g.add(board);
        var fm = new THREE.MeshStandardMaterial({color:0x888888,roughness:0.4,metalness:0.6});
        var tb = new THREE.Mesh(new THREE.BoxGeometry(1.26,0.04,0.035),fm);
        tb.position.y = 1.52; g.add(tb);
        var bb = new THREE.Mesh(new THREE.BoxGeometry(1.26,0.04,0.035),fm);
        bb.position.y = 0.68; g.add(bb);
        [[-0.30,0.30],[0.30,0.30]].forEach(function(p){
            var leg=new THREE.Mesh(new THREE.BoxGeometry(0.03,1.30,0.03),fm);
            leg.position.set(p[0],0.65,p[1]); leg.rotation.x=-0.22; g.add(leg);
        });
        var pick = new THREE.Mesh(new THREE.BoxGeometry(1.30,1.60,0.60),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.90; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeSofa() {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.88 });
        // Seat cushion
        var seat = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.20, 0.55), sm);
        seat.position.set(0, 0.32, 0); g.add(seat);
        // Back rest
        var back = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.45, 0.12), sm);
        back.position.set(0, 0.61, -0.23); g.add(back);
        // Arms
        [[-0.55,0.08,0.45],[0.55,0.08,0.45]].forEach(function(p){
            var arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.55), sm);
            arm.position.set(p[0], p[1]+0.35, 0); g.add(arm);
        });
        // Legs (4)
        var lm = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.65 });
        [[-0.44,-0.24],[-0.44,0.24],[0.44,-0.24],[0.44,0.24]].forEach(function(p){
            var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.22,6), lm);
            leg.position.set(p[0], 0.11, p[1]); g.add(leg);
        });
        var pick = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.85, 0.65), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.set(0, 0.42, 0); g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeFloorLamp() {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.3, metalness: 0.7 });
        // Pole
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.60, 8), sm);
        pole.position.y = 0.80; g.add(pole);
        // Base
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.04, 10), sm);
        base.position.y = 0.02; g.add(base);
        // Shade
        var shadeMat = new THREE.MeshStandardMaterial({ color: 0xffe8c0, emissive: 0xffe090, emissiveIntensity: 0.35, roughness: 0.7 });
        var shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.26, 10, 1, true), shadeMat);
        shade.position.y = 1.62; g.add(shade);
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.70, 6), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.85; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeBookshelf() {
        var g = new THREE.Group();
        var wm = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.75 });
        // Body
        var body = new THREE.Mesh(new THREE.BoxGeometry(0.80, 1.40, 0.28), wm);
        body.position.y = 0.70; g.add(body);
        // Shelves
        for (var s = 0; s < 3; s++) {
            var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.26), wm);
            shelf.position.set(0, 0.30 + s * 0.40, 0); g.add(shelf);
        }
        // Books (colourful small boxes)
        var bookCols = [0xd63031, 0x0984e3, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xe17055];
        for (var b = 0; b < 6; b++) {
            var bk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.20),
                new THREE.MeshStandardMaterial({ color: bookCols[b], roughness: 0.8 }));
            bk.position.set(-0.28 + b * 0.11, 0.64, 0); g.add(bk);
        }
        var pick = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.42, 0.30), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.71; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeMonitor() {
        var g = new THREE.Group();
        var dm = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.4, metalness: 0.3 });
        // Screen bezel
        var bezel = new THREE.Mesh(new THREE.BoxGeometry(1.00, 0.62, 0.06), dm);
        bezel.position.y = 1.35; g.add(bezel);
        // Screen glow
        var scrMat = new THREE.MeshStandardMaterial({ color: 0x0d2a4a, emissive: 0x1a4a7a, emissiveIntensity: 0.6, roughness: 0.2 });
        var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.52), scrMat);
        scr.position.set(0, 1.35, 0.04); g.add(scr);
        // Stand neck
        var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), dm);
        neck.position.y = 0.88; g.add(neck);
        // Base
        var base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.28), dm);
        base.position.y = 0.70; g.add(base);
        var pick = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.00, 0.30), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 1.17; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeJukeboxFurniture() {
        // A standalone jukebox cabinet (different from the interactive prop — just decor furniture).
        var g = new THREE.Group();
        var bm = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.5, metalness: 0.2 });
        // Cabinet body
        var cab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.20, 0.38), bm);
        cab.position.y = 0.60; g.add(cab);
        // Dome top
        var dome = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.275, 0.24, 14),
            new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc800, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.4 }));
        dome.position.y = 1.32; g.add(dome);
        // Chrome strips
        var cm = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 0.9 });
        [0.22, -0.22].forEach(function(ox){
            var s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.02), cm);
            s.position.set(ox, 0.70, 0.20); g.add(s);
        });
        // Glow face
        var face = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.55),
            new THREE.MeshStandardMaterial({ color: 0xff6040, emissive: 0xff3010, emissiveIntensity: 0.4, roughness: 0.4 }));
        face.position.set(0, 0.70, 0.20); g.add(face);
        var pick = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.44, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.72; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    function _makeWasteBin() {
        var g = new THREE.Group();
        var bm = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.55, metalness: 0.4 });
        var body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.42, 10), bm);
        body.position.y = 0.21; g.add(body);
        var rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 18), bm);
        rim.position.y = 0.42; g.add(rim);
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.44, 8), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.22; g.add(pick);
        return { group: g, pickMesh: pick };
    }

    // Furniture drag helpers
    function _snapGrid(v) { return Math.round(v / GRID) * GRID; }
    function _clampRoom(x, z, margin) {
        var m = margin || 0.5;
        return {
            x: Math.max(-ROOM_W/2 + m, Math.min(ROOM_W/2 - m, x)),
            z: Math.max(-ROOM_D/2 + m, Math.min(ROOM_D/2 - m, z))
        };
    }

    // The main table's current offset from room-center (P5: _decorPos.table), or {0,0}.
    function _tableOffset() {
        var tp = _decorPos.table;
        return tp ? { x: tp.x, z: tp.z } : { x: 0, z: 0 };
    }
    // Margin that keeps the whole table + chair ring inside the room when dragging it.
    function _tableDragMargin() {
        var t = _tbl();
        var r = (_cfg.tableShape === 'round') ? t.RR : Math.max(t.RW, t.RD) / 2;
        return r + 0.72 + 0.4;
    }

    // Wall-snap a dragged floor point to the nearest of the room's three walls (left,
    // right, back — there's no front wall). `offset` is how far the item's group origin
    // sits off the wall surface; `margin` keeps it clear of the corners. Returns the new
    // group position + a rotation.y that faces the item into the room.
    function _wallSnap(x, z, offset, margin) {
        var distLeft = x + ROOM_W / 2;
        var distRight = ROOM_W / 2 - x;
        var distBack = z + ROOM_D / 2;
        var minD = Math.min(distLeft, distRight, distBack);
        if (minD === distLeft) {
            return { x: -ROOM_W / 2 + offset, z: Math.max(-ROOM_D/2 + margin, Math.min(ROOM_D/2 - margin, z)), rot: Math.PI / 2 };
        }
        if (minD === distRight) {
            return { x: ROOM_W / 2 - offset, z: Math.max(-ROOM_D/2 + margin, Math.min(ROOM_D/2 - margin, z)), rot: -Math.PI / 2 };
        }
        return { x: Math.max(-ROOM_W/2 + margin, Math.min(ROOM_W/2 - margin, x)), z: -ROOM_D / 2 + offset, rot: 0 };
    }

    function _floorIntersect(event) {
        if (!_raycaster || !_camera) return null;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);
        var floorPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
        var target = new THREE.Vector3();
        return _raycaster.ray.intersectPlane(floorPlane, target) ? target : null;
    }

    // Raycast furniture pick-meshes at a pointer event → returns the furniture obj or null.
    function _raycastFurnitureAt(event) {
        if (!_raycaster || !_camera || !_furnitureObjs.length) return null;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);
        var pickMeshes = _furnitureObjs.map(function(f){ return f.pickMesh; });
        var hits = _raycaster.intersectObjects(pickMeshes, false);
        if (!hits.length) return null;
        // The table can sit over furniture (e.g. a plant tucked underneath) — if the
        // table is the nearer hit, it occludes the furniture here. Matches
        // _raycastDecorAt's tie-break so hover and click/drag target the same object.
        if (_tableGroup) {
            var tHits = _raycaster.intersectObject(_tableGroup, true);
            if (tHits.length && tHits[0].distance <= hits[0].distance) return null;
        }
        var fid = hits[0].object.userData.furnitureId;
        for (var i = 0; i < _furnitureObjs.length; i++) {
            if (_furnitureObjs[i].id === fid) return _furnitureObjs[i];
        }
        return null;
    }

    // ── P1: avatar picking ─────────────────────────────────────
    // Robots (seated/standing/ghost + roamers) must own the raycast where they stand,
    // otherwise clicks pass through a person's body to the chair behind them.
    function _avatarPickList() {
        var list = [], my = _myCid();
        Object.keys(_robotMap).forEach(function (k) {
            var r = _robotMap[k];
            if (!r || !r.robot) return;                    // glow rings etc.
            var cid = null, name = null;
            if (k.indexOf('ghost_') === 0) {
                var gc = _claimedChairs[parseInt(k.slice(6), 10)];
                name = (gc && gc.name) || null;
            } else {
                cid = (k.indexOf('stand_') === 0) ? k.slice(6) : k;
                var p = _participantByCid(cid);
                name = p ? p.name : null;
            }
            list.push({ group: r.robot, cid: cid, name: name, mine: !!(cid && my && cid === my), seated: !!r.seated });
        });
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid];
            if (!r || !r.robot) return;
            var p = _participantByCid(cid);
            list.push({ group: r.robot, cid: cid, name: p ? p.name : null, mine: !!(my && cid === my), seated: false });
        });
        return list;
    }

    // Raycast the avatar list (recursive into robot groups). Assumes _raycaster is
    // already set from the camera. Returns the pick entry or null.
    function _raycastAvatarAt() {
        var list = _avatarPickList();
        if (!list.length) return null;
        var groups = list.map(function (a) { return a.group; });
        var hits = _raycaster.intersectObjects(groups, true);
        if (!hits.length) return null;
        var o = hits[0].object;
        while (o) {
            for (var i = 0; i < list.length; i++) if (list[i].group === o) return list[i];
            o = o.parent;
        }
        return null;
    }

    function _avatarTipY(av) { return (av.seated ? SEAT_H + 0.95 : ROBOT_HEAD_Y) + 0.30; }

    // ── P9.2: orbit-mode hover highlight + tooltip ─────────────
    // One hovered target at a time. Highlight = per-mesh material swap to a cached clone
    // with a soft blue emissive (clones cached on the mesh so shared GLB materials never
    // tint other instances). Tooltip = one reusable CSS2DObject.
    var _hover = { key: null, root: null, lastCheck: 0 };
    var _hoverTipObj = null;

    function _setGroupHighlight(root, on) {
        if (!root) return;
        
        var cssVal = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--card-selected').trim() : '';
        var match = cssVal.match(/#([0-9a-fA-F]{3,6})/);
        var hex = match ? match[0] : '#0d6efd';

        root.traverse(function (o) {
            if (!o.isMesh || !o.material || o.userData.glowRing) return;
            if (on) {
                if (!o.userData._hiMat) {
                    if (o.material.emissive === undefined) return;   // not emissive-capable
                    o.userData._baseMat = o.material;
                    var hm = o.material.clone();
                    
                    if (hm.color) {
                        hm.color = hm.color.clone();
                        hm.color.multiplyScalar(0.45); // Keep the dimming effect
                    }

                    hm.emissive = new THREE.Color(0x000000); // Remove the shine
                    o.userData._hiMat = hm;
                }
                o.material = o.userData._hiMat;

                if (!o.userData._outlineMesh) {
                    var edges = new THREE.EdgesGeometry(o.geometry, 15);
                    var line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: hex, depthTest: false, transparent: true }));
                    line.renderOrder = 999;
                    o.userData._outlineMesh = line;
                    o.add(line);
                } else {
                    o.userData._outlineMesh.material.color.set(hex);
                    o.userData._outlineMesh.visible = true;
                }
            } else {
                if (o.userData._baseMat) {
                    o.material = o.userData._baseMat;
                }
                if (o.userData._outlineMesh) {
                    o.userData._outlineMesh.visible = false;
                }
            }
        });
    }

    function _showHoverTip(text, x, y, z) {
        if (!CSS2DObject || !_scene) return;
        if (!_hoverTipObj) {
            var div = document.createElement('div');
            div.className = 'rs3d-hover-tip';
            div.style.cssText = 'background:rgba(20,24,40,0.86);color:#cdd6f4;border:1px solid rgba(120,140,210,0.35);' +
                'border-radius:6px;padding:2px 8px;font:600 0.70rem sans-serif;white-space:nowrap;pointer-events:none;';
            _hoverTipObj = new CSS2DObject(div);
            _scene.add(_hoverTipObj);
        }
        _hoverTipObj.element.textContent = text;
        _hoverTipObj.visible = true;
        _hoverTipObj.position.set(x, y, z);
    }

    function _clearHover() {
        if (_hover.root) _setGroupHighlight(_hover.root, false);
        _hover.key = null; _hover.root = null;
        if (_hoverTipObj) _hoverTipObj.visible = false;
        if (_hoverCursor) { _hoverCursor = ''; if (_renderer) _renderer.domElement.style.cursor = ''; }
    }

    function _disposeHoverTip() {
        _clearHover();
        if (_hoverTipObj) {
            if (_hoverTipObj.parent) _hoverTipObj.parent.remove(_hoverTipObj);
            if (_hoverTipObj.element && _hoverTipObj.element.parentNode) {
                _hoverTipObj.element.parentNode.removeChild(_hoverTipObj.element);
            }
            _hoverTipObj = null;
        }
    }

    // Throttled (~30 Hz) hover probe: furniture → chairs → whiteboard → props.
    function _updateHover(event) {
        if (_walk || !_raycaster || !_camera || !_renderer) return;
        // P9.7: Shift only forces orbit-drag (see _onPointerDown ~1761) — hover tips stay visible.
        var now = performance.now();
        if (now - _hover.lastCheck < 33) return;
        _hover.lastCheck = now;

        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);

        var key = null, root = null, tip = null, pos = null, cursor = '';

        // P1: avatars first — hovering a person shows who they are instead of the
        // sit/free tips for the chair hidden behind their body. Own seated robot =
        // stand-up affordance; own standing/roaming body is transparent to hover
        // (matches the click pass-through).
        var av = _raycastAvatarAt();
        if (av && !(av.mine && !av.seated)) {
            key = 'avatar_' + (av.cid || av.name || 'ghost');
            var apv = new THREE.Vector3(); av.group.getWorldPosition(apv);
            if (av.mine) {
                tip = 'Double-click to stand up'; cursor = 'pointer';
                pos = { x: apv.x, y: _avatarTipY(av), z: apv.z };
            } else if (av.name) {
                var rsv = _roomState || {};
                var pv = av.cid ? _participantByCid(av.cid) : null;
                tip = '🤖 ' + av.name + (rsv.votesRevealed && pv && pv.vote ? ' · ' + pv.vote : '');
                pos = { x: apv.x, y: _avatarTipY(av), z: apv.z };
            }
        }

        // Furniture (existing affordance, now with tooltip)
        var f = key ? null : _raycastFurnitureAt(event);
        if (f) {
            key = 'furn_' + f.id; root = f.group; cursor = 'move';
            tip = 'Drag to move • Click for options'; pos = { x: f.group.position.x, y: 1.05, z: f.group.position.z };
        }

        // Chairs (empty → sit; own → stand; other's → host can free)
        if (!key && _chairObjects.length) {
            var seatMeshes = _chairObjects.map(function (c) { return c.seatMesh; });
            var ch = _raycaster.intersectObjects(seatMeshes, false);
            if (ch.length) {
                var cObj = null;
                for (var i = 0; i < _chairObjects.length; i++) {
                    if (_chairObjects[i].seatMesh === ch[0].object) { cObj = _chairObjects[i]; break; }
                }
                if (cObj) {
                    var claim = _claimedChairs[cObj.idx];
                    if (!claim)                                tip = '🪑 Double-click to sit • Drag to move';
                    else if (claim.cid === _myCid())           tip = 'Double-click to stand up';
                    else if (_isHost())                        tip = '👑 Double-click to free this seat';
                    if (tip) {
                        key = 'chair_' + cObj.idx; root = cObj.group; cursor = 'pointer';
                        pos = { x: cObj.group.position.x, y: 1.15, z: cObj.group.position.z };
                    }
                }
            }
        }

        // Whiteboard
        if (!key && _wbBoard && _raycaster.intersectObject(_wbBoard, false).length) {
            key = 'wb'; root = _wbBoard; cursor = 'pointer';
            var wp = new THREE.Vector3(); _wbBoard.getWorldPosition(wp);
            tip = '📋 Double-click to open • Drag to move'; pos = { x: wp.x, y: wp.y + 0.75, z: wp.z };
        }

        // Project screen (drag along the walls; double-click opens the Stories panel)
        if (!key && _screenMesh && _raycaster.intersectObject(_screenMesh, false).length) {
            key = 'screen'; root = _screenGroup; cursor = 'pointer';
            var scp = new THREE.Vector3(); _screenMesh.getWorldPosition(scp);
            tip = '🖥️ Double-click to open Stories • Drag to move'; pos = { x: scp.x, y: scp.y + 0.6, z: scp.z };
        }

        // Interactive props (confetti / jukebox)
        if (!key) {
            var pm = _propMeshes();
            if (pm.length) {
                var ph = _raycaster.intersectObjects(pm, false);
                if (ph.length) {
                    var pr = _propForMesh(ph[0].object);
                    if (pr) {
                        key = 'prop_' + pr.action; root = pr.mesh; cursor = 'pointer';
                        var pp = new THREE.Vector3(); pr.mesh.getWorldPosition(pp);
                        tip = '✨ Double-click to use • Drag to move'; pos = { x: pp.x, y: pp.y + 0.55, z: pp.z };
                    }
                }
            }
        }

        // Main table (drag to move — chairs re-ring around it)
        if (!key && _tableGroup && _raycaster.intersectObject(_tableGroup, true).length) {
            key = 'table'; root = _tableGroup; cursor = 'move';
            var tp = _tableGroup.position;
            tip = '🪑 Drag to move'; pos = { x: tp.x, y: TBL_TOP + 0.15, z: tp.z };
        }

        if (key !== _hover.key) {
            if (_hover.root) _setGroupHighlight(_hover.root, false);
            _hover.key = key; _hover.root = root;
            if (root) _setGroupHighlight(root, true);
            if (key && tip) _showHoverTip(tip, pos.x, pos.y, pos.z);
            else if (_hoverTipObj) _hoverTipObj.visible = false;
        }
        if (cursor !== _hoverCursor) {
            _hoverCursor = cursor;
            _renderer.domElement.style.cursor = cursor;
        }
    }

    // ── Chair dragging (own + empty chairs) ──────────────────
    function _clickWalkKey() { return 'es_rs3d_ctw_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default'); }
    function _loadClickWalkEnabled() {
        try { var s = localStorage.getItem(_clickWalkKey()); if (s !== null) _clickWalkEnabled = (s === '1'); } catch (e) {}
    }
    function _saveClickWalkEnabled() {
        try { localStorage.setItem(_clickWalkKey(), _clickWalkEnabled ? '1' : '0'); } catch (e) {}
    }
    function _chairPosKey() { return 'es_rs3d_chairpos_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default'); }
    function _loadChairPositions() {
        try { var s = JSON.parse(localStorage.getItem(_chairPosKey()) || '{}'); if (s && typeof s === 'object') _chairPos = s; } catch (e) { _chairPos = {}; }
    }
    function _saveChairPositions(broadcast) {
        var json;
        try { json = JSON.stringify(_chairPos); localStorage.setItem(_chairPosKey(), json); } catch (e) {}
        if (window.RoomSceneStore) RoomSceneStore.set({ chairPos: _chairPos }, { source: broadcast === false ? 'remote' : 'local', slice: 'chairPos', fields: ['chairPos'] });
        if (broadcast !== false && json && window.RoomSceneNet && RoomSceneNet.setChairPositions) RoomSceneNet.setChairPositions(json);
    }
    // From the server (peer drag) / RoomState snapshot.
    function applyChairPositions(json) {
        var obj; try { obj = (typeof json === 'string') ? JSON.parse(json) : json; } catch (e) { return; }
        var incoming = (obj && typeof obj === 'object') ? obj : {};
        // P9.6: last-writer-wins — if a chair I moved/rotated in the last ~3s is now
        // different, a peer's update overwrote mine. Not blocked, just surfaced.
        var now = performance.now(), overwrote = false;
        Object.keys(_myChairMoveTime).forEach(function (idx) {
            if (now - _myChairMoveTime[idx] > 3000) { delete _myChairMoveTime[idx]; return; }
            var mine = _chairPos[idx], theirs = incoming[idx];
            if (JSON.stringify(mine) !== JSON.stringify(theirs)) overwrote = true;
        });
        if (overwrote && window._showToastAD) window._showToastAD('🪑 Someone else just moved a chair you positioned.', 'warning');
        _chairPos = incoming;
        try { localStorage.setItem(_chairPosKey(), JSON.stringify(_chairPos)); } catch (e) {}
        if (window.RoomSceneStore) RoomSceneStore.set({ chairPos: _chairPos }, { source: 'remote', slice: 'chairPos', fields: ['chairPos'] });
        if (_scene) _rebuildSeating();
    }

    // ── Décor (props/whiteboard/screen) position overrides ────
    function _decorPosKey() { return 'es_rs3d_decorpos_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default'); }
    function _loadDecorPositions() {
        try { var s = JSON.parse(localStorage.getItem(_decorPosKey()) || '{}'); if (s && typeof s === 'object') _decorPos = s; } catch (e) { _decorPos = {}; }
    }
    function _saveDecorPositions(broadcast) {
        var json;
        try { json = JSON.stringify(_decorPos); localStorage.setItem(_decorPosKey(), json); } catch (e) {}
        if (broadcast !== false && json && window.RoomSceneNet && RoomSceneNet.setDecorPositions) RoomSceneNet.setDecorPositions(json);
    }
    // From the server (peer drag) / RoomState snapshot.
    function applyDecorPositions(json) {
        var obj; try { obj = (typeof json === 'string') ? JSON.parse(json) : json; } catch (e) { return; }
        _decorPos = (obj && typeof obj === 'object') ? obj : {};
        try { localStorage.setItem(_decorPosKey(), JSON.stringify(_decorPos)); } catch (e) {}
        if (_scene) refreshScene();
    }
    // Draggable = empty chair, or the local user's own claimed chair.
    function _chairDraggable(idx) {
        var c = _claimedChairs[idx];
        if (!c) return true;
        return !!(c.cid && c.cid === _myCid());
    }
    function _raycastDraggableChairAt(event) {
        if (!_chairObjects.length || !_raycaster || !_camera) return null;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);
        var meshes = _chairObjects.filter(function (c) { return _chairDraggable(c.idx); }).map(function (c) { return c.seatMesh; });
        var hits = meshes.length ? _raycaster.intersectObjects(meshes, false) : [];
        if (!hits.length) return null;
        var hm = hits[0].object;
        for (var i = 0; i < _chairObjects.length; i++) if (_chairObjects[i].seatMesh === hm) return _chairObjects[i];
        return null;
    }
    function _beginChairDrag(chairObj, event) {
        var floorPt = _floorIntersect(event);
        if (!floorPt) return false;
        // NOTE: don't suppress the claim click yet — a no-move press should still claim an
        // empty chair. The chairDrag move handler sets Input.suppressClick once the drag
        // actually activates (pointer travels past the jitter threshold).
        Input.to('chairDrag', {
            idx: chairObj.idx, group: chairObj.group,
            offsetX: chairObj.group.position.x - floorPt.x,
            offsetZ: chairObj.group.position.z - floorPt.z,
            pointerId: event.pointerId, moved: false,
            startX: event.clientX, startY: event.clientY
        }, event);
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        return true;
    }

    function _beginDrag(found, event) {
        var floorPt = _floorIntersect(event);
        if (!floorPt) return false;
        // NOTE: don't suppress the click yet — a no-move press should still select the
        // item (showing its rotate/delete bar). The furnDrag move handler sets
        // Input.suppressClick once the drag actually activates (past the jitter threshold).
        Input.to('furnDrag', {
            item: found,
            offsetX: found.x - floorPt.x,
            offsetZ: found.z - floorPt.z,
            pointerId: event.pointerId,
            moved: false,
            startX: event.clientX, startY: event.clientY
        }, event);
        // Stop OrbitControls (canvas listener) from ever seeing this pointerdown.
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        return true;
    }

    // ── Décor dragging (props free-move; whiteboard/screen wall-snap) ─────────
    function _raycastDecorAt(event) {
        if (!_raycaster || !_camera) return null;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);
        if (_wbBoard && _wbGroup && _raycaster.intersectObject(_wbBoard, false).length) {
            return { kind: 'wall', key: 'wb', group: _wbGroup, offset: 0.06, margin: 1.0 };
        }
        if (_screenMesh && _screenGroup && _raycaster.intersectObject(_screenMesh, false).length) {
            return { kind: 'wall', key: 'screen', group: _screenGroup, offset: 0.05, margin: 1.0 };
        }
        var pm = _propMeshes();
        if (pm.length) {
            var ph = _raycaster.intersectObjects(pm, false);
            if (ph.length) {
                var pr = _propForMesh(ph[0].object);
                if (pr && pr.group) return { kind: 'prop', key: pr.key, group: pr.group };
            }
        }
        if (_tableGroup) {
            var tHits = _raycaster.intersectObject(_tableGroup, true);
            if (tHits.length) {
                // The table is large and can sit over furniture (e.g. a plant tucked
                // underneath) — only claim the table if it's the nearer hit, so the
                // furniture underneath remains draggable.
                var fMeshes = _furnitureObjs.map(function (f) { return f.pickMesh; });
                var fHits = fMeshes.length ? _raycaster.intersectObjects(fMeshes, false) : [];
                if (!fHits.length || tHits[0].distance <= fHits[0].distance) {
                    return { kind: 'table', key: 'table', group: _tableGroup, margin: _tableDragMargin() };
                }
                return null;
            }
        }
        return null;
    }

    function _beginDecorDrag(found, event) {
        var floorPt = _floorIntersect(event);
        if (!floorPt) return false;
        var data = {
            kind: found.kind, key: found.key, group: found.group,
            offset: found.offset, margin: found.margin,
            pointerId: event.pointerId, moved: false,
            startX: event.clientX, startY: event.clientY
        };
        if (found.kind === 'prop' || found.kind === 'table') {
            data.offsetX = found.group.position.x - floorPt.x;
            data.offsetZ = found.group.position.z - floorPt.z;
        }
        // NOTE: don't suppress the click yet — a no-move press should still let the
        // double-click arbiter (whiteboard open / prop trigger) fire normally.
        Input.to('decorDrag', data, event);
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        return true;
    }

    // ── Free-rotate handle (P8): drag the green ring's edge handle to rotate the
    // selected item continuously around its center. Only shown when the rotation
    // step picker is set to "Free".
    function _raycastSelHandleAt(event) {
        if (!_selHandle || !_selHandle.visible || !_raycaster || !_camera) return false;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);
        return _raycaster.intersectObject(_selHandle, false).length > 0;
    }
    function _beginRotateDrag(event) {
        var ref = _selRefs();
        if (!ref) return false;
        Input.to('rotateDrag', { pos: ref.pos, pointerId: event.pointerId }, event);
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        return true;
    }

    // Drag model: single-click selects; drag the selected item to move; clicking empty
    // space deselects. Shift+drag ALWAYS orbits (escape hatch when an item blocks the view).
    function _onPointerDown(event) {
        if (_walk) return;                          // walk mode: drag = look, handled elsewhere
        if (event.button !== undefined && event.button !== 0) return;
        if (event.shiftKey) return;                 // Shift → let OrbitControls orbit
        // Only treat presses on the WebGL canvas as scene interactions. Presses on DOM
        // overlays (claim bar buttons, selection bar, toolbar) must reach their own
        // handlers — raycasting "through" them steals the click via pointer capture.
        if (_renderer && event.target !== _renderer.domElement) return;
        _clearHover();   // a press starts an interaction — drop the hover affordance
        // P8: dragging the free-rotate handle on the selection ring takes precedence
        // over everything else (so it can be grabbed even over the selected item).
        if (_sel && _raycastSelHandleAt(event)) { _beginRotateDrag(event); return; }
        // Chair drag (own or empty chairs) takes precedence. A no-move press still lets the
        // click-to-claim fire; only actual movement commits a reposition.
        var dchair = _raycastDraggableChairAt(event);
        if (dchair) { _beginChairDrag(dchair, event); return; }
        // Décor (whiteboard / project screen / props) drag — also takes precedence over
        // furniture, and like chairs lets a no-move press fall through to its click action.
        var decor = _raycastDecorAt(event);
        if (decor) { _beginDecorDrag(decor, event); return; }
        if (_furnitureObjs.length) {
            var found = _raycastFurnitureAt(event);
            if (found) {
                _beginDrag(found, event);            // drag immediately; a no-move release selects
                return;
            }
        }
        // empty space → deselect (if needed) and orbit
        if (_sel) _deselectAll();
        // not consumed → OrbitControls orbits
    }

    function _onPointerMove(event) {
        if (_walk) return;
        if (Input.is('rotateDrag')) {
            var rd = Input.data;
            if (event.pointerId !== undefined && rd.pointerId !== undefined && event.pointerId !== rd.pointerId) return;
            var rfp = _floorIntersect(event); if (!rfp) return;
            var rot = Math.atan2(rfp.x - rd.pos.x, rfp.z - rd.pos.z);
            var ref = _selRefs();
            if (ref && ref.group) ref.group.rotation.y = rot;
            if (_selHandle) {
                var R = 0.6;
                _selHandle.position.set(rd.pos.x + R * Math.sin(rot), 0.12, rd.pos.z + R * Math.cos(rot));
            }
            rd.rot = rot;
            Input.suppressClick = true;
            event.stopPropagation();
            return;
        }
        if (Input.is('chairDrag')) {
            var cd = Input.data;
            if (event.pointerId !== undefined && cd.pointerId !== undefined && event.pointerId !== cd.pointerId) return;
            // Ignore sub-threshold jitter so a normal click still claims the chair
            // instead of committing a 1-pixel "reposition" and eating the click.
            if (!cd.moved &&
                Math.abs(event.clientX - cd.startX) < 5 &&
                Math.abs(event.clientY - cd.startY) < 5) return;
            var cfp = _floorIntersect(event); if (!cfp) return;
            var c = _clampRoom(cfp.x + cd.offsetX, cfp.z + cd.offsetZ);
            cd.group.position.x = c.x; cd.group.position.z = c.z;
            // Carry the seated robot + ring + label with my own chair.
            var claim = _claimedChairs[cd.idx];
            if (claim && claim.cid === _myCid() && _robotMap[claim.cid]) {
                var r = _robotMap[claim.cid];
                ['robot', 'ring', 'labelObj'].forEach(function (k) { if (r[k]) { r[k].position.x = c.x; r[k].position.z = c.z; } });
            }
            cd.moved = true; Input.suppressClick = true;
            event.stopPropagation();
            return;
        }
        if (Input.is('decorDrag')) {
            var dd = Input.data;
            if (event.pointerId !== undefined && dd.pointerId !== undefined && event.pointerId !== dd.pointerId) return;
            if (!dd.moved &&
                Math.abs(event.clientX - dd.startX) < 5 &&
                Math.abs(event.clientY - dd.startY) < 5) return;
            var dfp = _floorIntersect(event); if (!dfp) return;
            if (dd.kind === 'prop') {
                var dc = _clampRoom(dfp.x + dd.offsetX, dfp.z + dd.offsetZ);
                dd.group.position.x = dc.x; dd.group.position.z = dc.z;
            } else if (dd.kind === 'table') {
                var tc = _clampRoom(dfp.x + dd.offsetX, dfp.z + dd.offsetZ, dd.margin);
                dd.group.position.x = tc.x; dd.group.position.z = tc.z;
            } else {
                var snap = _wallSnap(dfp.x, dfp.z, dd.offset, dd.margin);
                dd.group.position.x = snap.x; dd.group.position.z = snap.z;
                dd.group.rotation.y = snap.rot;
            }
            dd.moved = true; Input.suppressClick = true;
            event.stopPropagation();
            return;
        }
        if (!Input.is('furnDrag')) {
            // P9.2 hover affordance: highlight + tooltip + cursor over interactive items.
            // Only for pointers over the canvas itself (not DOM overlays).
            if (event.target === (_renderer && _renderer.domElement)) _updateHover(event);
            return;
        }
        var fd = Input.data;
        if (fd.pointerId !== undefined && event.pointerId !== fd.pointerId) return;
        // Ignore sub-threshold jitter so a normal click still selects the item instead
        // of committing a 1-pixel "reposition" and eating the click.
        if (!fd.moved &&
            Math.abs(event.clientX - fd.startX) < 5 &&
            Math.abs(event.clientY - fd.startY) < 5) return;
        var floorPt = _floorIntersect(event);
        if (!floorPt) return;
        var clamped = _clampRoom(floorPt.x + fd.offsetX, floorPt.z + fd.offsetZ);
        var nx = _snapGrid(clamped.x);
        var nz = _snapGrid(clamped.z);
        fd.item.x = nx;
        fd.item.z = nz;
        fd.item.group.position.set(nx, 0, nz);
        _updateSelRing();
        fd.moved = true; Input.suppressClick = true;
        event.stopPropagation();
    }

    function _onPointerUp(event) {
        if (Input.is('rotateDrag')) {
            var rd = Input.data;
            if (event && rd.pointerId !== undefined && event.pointerId !== rd.pointerId) return;
            Input.to('idle', null, event);
            if (rd.rot !== undefined) {
                var ref = _selRefs();
                if (ref) ref.setRot(rd.rot);
            }
            _updateSelRing();
            Input.suppressClick = true;
            return;
        }
        if (Input.is('chairDrag')) {
            var cd = Input.data;
            if (event && cd.pointerId !== undefined && event.pointerId !== cd.pointerId) return;
            Input.to('idle', null, event);   // releases capture + re-enables orbit
            if (cd.moved) {
                _chairPos[cd.idx] = Object.assign({}, _chairPos[cd.idx], { x: cd.group.position.x, z: cd.group.position.z });
                _myChairMoveTime[cd.idx] = performance.now();
                _saveChairPositions(true);
                _rebuildSeating();
            } else {
                // P8: a no-move press selects the chair (rotate bar); the double-click
                // arbiter (in _onCanvasClick) still claims/releases it normally.
                _selectItem('chair', cd.idx);
            }
            return;
        }
        if (Input.is('decorDrag')) {
            var dd = Input.data;
            if (event && dd.pointerId !== undefined && event.pointerId !== dd.pointerId) return;
            Input.to('idle', null, event);
            if (dd.moved) {
                var pos = Object.assign({}, _decorPos[dd.key], { x: dd.group.position.x, z: dd.group.position.z });
                if (dd.kind === 'wall') pos.rot = dd.group.rotation.y;
                _decorPos[dd.key] = pos;
                _saveDecorPositions(true);
                // Table move: re-ring default chairs/avatars around the new spot. Hand-
                // dragged chairs (_chairPos) keep their absolute positions.
                if (dd.kind === 'table') _rebuildSeating();
            } else if (dd.kind === 'prop' || dd.kind === 'table') {
                // P8: a no-move press on a prop or the table selects it (rotate bar);
                // the double-click arbiter (prop trigger) still fires normally.
                _selectItem('decor', dd.key);
            }
            // no-move release: let the click fall through (whiteboard open / prop trigger
            // double-click arbiter, or absorbed screen click below).
            return;
        }
        if (!Input.is('furnDrag')) return;
        var fd = Input.data;
        if (event && fd.pointerId !== undefined && event.pointerId !== fd.pointerId) return;
        Input.to('idle', null, event);
        if (fd.moved) _saveFurniture();
        else { _selectItem('furniture', fd.item.id); Input.suppressClick = true; }   // no-move press = click → select (sel/rotate/delete bar)
    }

    function _onKeyDown(event) {
        var t = event.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        // Only handle keys when the 3D scene is the active mode (avoid stealing global shortcuts).
        if (!_renderer) return;
        var kb = _keyBinds();
        var code = event.code;

        // Walk-mode toggle works in either mode.
        if (code === kb.walk) { event.preventDefault(); event.stopImmediatePropagation(); _toggleWalk(); return; }

        if (_walk) {
            // In walk mode: block ALL other page handlers (prevents Space→reveal, Ctrl shortcuts, etc.)
            if (_isMoveCode(code, kb) || code === kb.jump || code === kb.crouch ||
                code === kb.interact || code === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation();
            }
            if (_isMoveCode(code, kb)) { _keys[code] = true; return; }
            if (code === kb.jump)    { if (_walk.grounded) { _walk.vy = 7.5; _walk.grounded = false; } return; }
            if (code === kb.crouch)  { _walk.crouch = true; return; }
            if (code === kb.interact){ _walkInteract(); return; }
            if (code === 'Escape')   {
                // First Esc while pointer-locked: let the browser release the lock and
                // fall back to drag-look, but stay in walk mode. Second Esc (already
                // unlocked) exits walk as before.
                if (_renderer && document.pointerLockElement === _renderer.domElement) return;
                _toggleWalk(); return;
            }
            // Any other key in walk mode: prevent bubbling to page shortcuts
            event.stopImmediatePropagation();
            return;
        }

        // 2D top-down: Space stands you up so you can steer (follow-up to P7).
        if (_view === 'top' && code === 'Space' && _myChairIdx !== null) {
            event.preventDefault(); event.stopImmediatePropagation();
            releaseMySeat();
            return;
        }

        // 2D top-down: WASD/arrows steer my avatar (P7). Captured even while seated so the
        // page doesn't scroll; while seated, show a toast pointing at Space instead of moving.
        if (_view === 'top' && _isMoveCode(code, kb)) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (_myChairIdx !== null) {
                var now = performance.now();
                if (now - _seatedArrowToastT > 2000) {
                    _seatedArrowToastT = now;
                    if (window._showToastAD) window._showToastAD('⌨️ Press Space to stand up first', 'info');
                }
                return;
            }
            _keys[code] = true;
            return;
        }

        // Orbit-mode selection shortcuts — apply to whatever is selected (P8: furniture,
        // chairs, props, or the table; Delete only applies to furniture).
        if (!_sel) return;
        if (event.key === 'Escape') { _deselectAll(); }
        else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); _deleteSelected(); }
        else if (event.code === 'KeyR') { event.preventDefault(); _rotateSelected(event.shiftKey ? -1 : 1); }
    }

    function _onKeyUp(event) {
        var kb = _keyBinds();
        if (_walk) {
            if (_isMoveCode(event.code, kb)) { _keys[event.code] = false; }
            if (event.code === kb.crouch)    { _walk.crouch = false; }
            return;
        }
        if (_view === 'top' && _isMoveCode(event.code, kb)) { _keys[event.code] = false; }
    }

    // True if this key.code is any movement key (configured binding).
    function _isMoveCode(code, kb) {
        return code === kb.forward || code === kb.back || code === kb.left || code === kb.right;
    }

    // ── First-person / third-person walk controller ───────────
    function _keyHint(code) {
        if (!code) return '?';
        var MAP = { Space:'Space', AltLeft:'Alt', AltRight:'Alt', ControlLeft:'Ctrl', ControlRight:'Ctrl',
                    ShiftLeft:'Shift', ShiftRight:'Shift', ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→' };
        return MAP[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
    }

    function _createWalkButton() {
        // P15: a single vertical icon toolbar (top-right) houses the walk / click-walk /
        // furniture buttons — same handlers as before, just grouped + restyled via CSS.
        var toolbar = document.createElement('div');
        toolbar.id = 'rs3d-toolbar';
        toolbar.className = 'rs3d-toolbar';
        var kb = _keyBinds();

        // Walk / Orbit toggle
        var b = document.createElement('button');
        b.id = 'rs3d-walk-btn'; b.type = 'button';
        b.className = 'rs3d-tool-btn';
        b.title = 'Walk around in first/third person (' + _keyHint(kb.walk) + ')';
        b.textContent = '🚶';
        b.onclick = _toggleWalk;
        if (_view === 'top') b.style.display = 'none';   // first-person walk is 3D-only (P6)
        toolbar.appendChild(b);
        _walkBtn = b;

        // Click-to-walk toggle
        var ctw = document.createElement('button');
        ctw.id = 'rs3d-ctw-btn'; ctw.type = 'button';
        ctw.className = 'rs3d-tool-btn' + (_clickWalkEnabled ? '' : ' off');
        ctw.title = _clickWalkEnabled ? 'Click-to-walk ON — click floor to move avatar' : 'Click-to-walk OFF — click won\'t move avatar';
        ctw.textContent = '🖱️';
        ctw.onclick = function() {
            _clickWalkEnabled = !_clickWalkEnabled;
            ctw.classList.toggle('off', !_clickWalkEnabled);
            ctw.title = _clickWalkEnabled ? 'Click-to-walk ON — click floor to move avatar' : 'Click-to-walk OFF — click won\'t move avatar';
            _saveClickWalkEnabled();
        };
        toolbar.appendChild(ctw);
        _clickWalkBtn = ctw;

        // Furniture quick-add toggle
        var fhb = document.createElement('button');
        fhb.id = 'rs3d-furn-btn'; fhb.type = 'button';
        fhb.className = 'rs3d-tool-btn';
        fhb.title = 'Add room furniture';
        fhb.textContent = '➕';
        fhb.onclick = function(e) { e.stopPropagation(); _toggleFurnHud(); };
        toolbar.appendChild(fhb);
        _furnHudBtn = fhb;

        _container.appendChild(toolbar);
        _toolbar = toolbar;

        // Small hint label under the toolbar so users know T enters walk mode.
        var hint = document.createElement('div');
        hint.id = 'rs3d-walk-hint';
        hint.style.cssText = 'position:absolute;top:116px;right:8px;z-index:12;font-size:0.60rem;' +
            'color:rgba(200,210,240,0.7);text-align:right;pointer-events:none;white-space:nowrap;';
        hint.textContent = 'Press ' + _keyHint(kb.walk) + ' to walk';
        if (_view === 'top') hint.style.display = 'none';
        _container.appendChild(hint);

        // Furniture quick-add panel (hidden by default), anchored under the toolbar.
        var fhud = document.createElement('div');
        fhud.id = 'rs3d-furn-hud';
        fhud.style.cssText = 'position:absolute;top:116px;right:8px;z-index:13;display:none;' +
            'background:rgba(20,24,40,0.94);color:#e8eaf6;border:1px solid rgba(120,140,210,0.4);' +
            'border-radius:8px;padding:6px 8px;backdrop-filter:blur(6px);';
        var FURN_ITEMS = [
            ['📋','whiteboard','Whiteboard'],['🪴','plant','Plant'],['🎵','jukebox','Jukebox'],
            ['💡','lamp','Floor lamp'],['🛋️','sofa','Sofa'],['📚','bookshelf','Bookshelf'],
            ['🖥️','monitor','Monitor'],['🗑️','bin','Bin'],
            ['☕','coffee_table','Coffee table'],['📽️','projector','Projector']
        ];
        fhud.innerHTML = '<div style="font-size:0.62rem;opacity:0.6;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;">Add to room</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:180px;">' +
            FURN_ITEMS.map(function(f){
                return '<button type="button" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);' +
                    'border-radius:5px;color:#e8eaf6;padding:4px 8px;cursor:pointer;font-size:0.75rem;" ' +
                    'title="Add ' + (f[2]||f[1]) + '" onclick="window.RS3D && RS3D.addFurniture(\'' + f[1] + '\')">' +
                    f[0] + ' ' + (f[2]||f[1]) + '</button>';
            }).join('') + '</div>' +
            '<div style="display:flex;gap:4px;margin-top:5px;">' +
            '<button type="button" style="background:transparent;border:1px solid rgba(200,100,100,0.5);color:#f88;' +
            'border-radius:5px;padding:2px 8px;cursor:pointer;font-size:0.70rem;" ' +
            'onclick="window.RS3D && RS3D.resetFurniture()">↺ Reset</button>' +
            '<button type="button" style="background:transparent;border:1px solid rgba(120,140,210,0.4);color:#aaa;' +
            'border-radius:5px;padding:2px 8px;cursor:pointer;font-size:0.70rem;" ' +
            'onclick="var h=document.getElementById(\'rs3d-furn-hud\');if(h)h.style.display=\'none\';">✕</button>' +
            '</div>';
        _container.appendChild(fhud);
        _furnHud = fhud;
    }

    function _toggleFurnHud() {
        if (!_furnHud) return;
        _furnHud.style.display = (_furnHud.style.display === 'none' ? 'block' : 'none');
    }

    // P15: one-time onboarding callouts (3D view only). Dismissed on first interaction
    // with the canvas, or via each chip's ✕. Persists via localStorage so it shows once.
    // P9.8: bumped to v2 so existing users see the updated onboarding once after the
    // P1-P8 interaction-model changes (single click selects, double-click interacts, drag).
    var ONBOARD_KEY = 'es_rs3d_onboarded_v2';
    function _showOnboarding() {
        if (!_container || _view === 'top') return;
        try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch (e) { return; }

        var chips = [];
        function addChip(text, arrowClass, posStyle) {
            var div = document.createElement('div');
            div.className = 'rs3d-callout ' + arrowClass;
            div.style.cssText = posStyle;
            div.appendChild(document.createTextNode(text));
            var x = document.createElement('button');
            x.type = 'button'; x.className = 'rs3d-callout-close'; x.textContent = '✕';
            x.onclick = dismiss;
            div.appendChild(x);
            _container.appendChild(div);
            chips.push(div);
        }
        function dismiss() {
            chips.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
            chips = [];
            try { localStorage.setItem(ONBOARD_KEY, '1'); } catch (e) {}
            _container.removeEventListener('pointerdown', dismiss);
        }

        addChip('🚶 Walk around the room', 'rs3d-callout-r', 'top:14px;right:46px;');
        addChip('🪑 Double-click a chair to sit down', 'rs3d-callout-d', 'left:50%;bottom:64px;transform:translateX(-50%);');
        addChip('➕ Add furniture here', 'rs3d-callout-r', 'top:96px;right:46px;');

        _container.addEventListener('pointerdown', dismiss, { once: true });
    }

    // Public wrapper (P10): lets the settings/offcanvas UI open the same in-canvas
    // furniture quick-add panel as the on-canvas "+ Furniture" button.
    function toggleFurniturePanel() {
        _toggleFurnHud();
    }

    function _showWalkHud() {
        var kb = _keyBinds();
        var thirdPerson = (_cfg && _cfg.walkCameraMode === 'third');
        var locked = !thirdPerson && _renderer && document.pointerLockElement === _renderer.domElement;
        var lookHint = locked ? 'move mouse to look · Esc unlocks, Esc again exits' : 'drag to look · Esc exit';
        var text = _keyHint(kb.forward) + _keyHint(kb.left) + _keyHint(kb.back) + _keyHint(kb.right) +
            ' move · ' + _keyHint(kb.jump) + ' jump · ' + _keyHint(kb.crouch) + ' crouch · ' +
            _keyHint(kb.interact) + ' interact · ' + lookHint +
            (thirdPerson ? ' · 3rd person' : ' · 1st person');
        var hud = document.getElementById('rs3d-walk-hud');
        if (hud) { hud.textContent = text; return; }
        hud = document.createElement('div');
        hud.id = 'rs3d-walk-hud';
        hud.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:12;' +
            'background:rgba(20,24,40,0.86);color:#cdd6f4;border:1px solid rgba(120,140,210,0.35);' +
            'border-radius:8px;padding:5px 12px;font-size:0.70rem;backdrop-filter:blur(6px);white-space:nowrap;';
        hud.textContent = text;
        _container.appendChild(hud);
    }
    function _hideWalkHud() {
        var hud = document.getElementById('rs3d-walk-hud');
        if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    }

    // ── Touch joystick + Gamepad input (walk mode only) ────────
    // Both are additive analog sources merged into _updateWalk's fwd/strafe; with neither
    // present the keyboard path is byte-for-byte the old behaviour.
    var _padMove   = null;   // {x,y} from gamepad left stick (-1..1, deadzoned)
    var _padPrev   = {};     // previous button states for edge triggers
    var _touchMove = null;   // {x,y} from the on-screen joystick
    var _touchUi   = null;   // overlay root (joystick + action buttons)

    function _isTouchDevice() { return ('ontouchstart' in window) || ((navigator.maxTouchPoints || 0) > 0); }

    function _pollGamepad(dt) {
        if (!_walk || !navigator.getGamepads) return;
        var pads, gp = null;
        try { pads = navigator.getGamepads(); } catch (e) { return; }
        for (var i = 0; i < pads.length; i++) { if (pads[i] && pads[i].connected) { gp = pads[i]; break; } }
        if (!gp) { _padMove = null; return; }
        function dz(v) { return Math.abs(v) < 0.18 ? 0 : v; }
        var mx = dz(gp.axes[0] || 0), my = dz(gp.axes[1] || 0);
        _padMove = (mx || my) ? { x: mx, y: my } : null;
        // Right stick look — same sign conventions as drag-look.
        var rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
        if (rx || ry) {
            var pitchSign = _invertY() ? 1 : -1;
            _walk.yaw  += rx * dt * 2.6;
            _walk.pitch = Math.max(-1.2, Math.min(1.2, _walk.pitch + pitchSign * ry * dt * 1.9));
        }
        function pr(b) { return !!(gp.buttons[b] && gp.buttons[b].pressed); }
        if (pr(0) && !_padPrev[0] && _walk.grounded) { _walk.vy = 7.5; _walk.grounded = false; }  // A → jump
        if (pr(1) !== !!_padPrev[1]) _walk.crouch = pr(1);                                        // B → crouch (hold)
        if (pr(2) && !_padPrev[2]) _walkInteract();                                               // X → interact
        var exitNow = pr(9) && !_padPrev[9];                                                      // Start → exit walk
        _padPrev = { 0: pr(0), 1: pr(1), 2: pr(2), 9: pr(9) };
        if (exitNow) { _padMove = null; _exitWalk(); }
    }

    function _showTouchControls() {
        if (_touchUi || !_container) return;
        var wrap = document.createElement('div');
        wrap.className = 'rs3d-touch-ui';
        wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;';
        // Joystick (bottom-left)
        var joy = document.createElement('div');
        joy.style.cssText = 'position:absolute;left:18px;bottom:18px;width:104px;height:104px;border-radius:50%;' +
            'background:rgba(40,48,70,0.35);border:2px solid rgba(130,150,210,0.5);pointer-events:auto;touch-action:none;';
        var knob = document.createElement('div');
        knob.style.cssText = 'position:absolute;left:32px;top:32px;width:40px;height:40px;border-radius:50%;' +
            'background:rgba(130,150,210,0.85);pointer-events:none;';
        joy.appendChild(knob);
        var joyId = null;
        function setKnob(dx, dy) { knob.style.left = (32 + dx * 32) + 'px'; knob.style.top = (32 + dy * 32) + 'px'; }
        function joyMove(e) {
            if (e.pointerId !== joyId) return;
            var r = joy.getBoundingClientRect();
            var dx = ((e.clientX - r.left) / r.width) * 2 - 1;
            var dy = ((e.clientY - r.top) / r.height) * 2 - 1;
            var len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
            _touchMove = { x: dx, y: dy };
            setKnob(dx, dy);
        }
        function joyEnd(e) { if (e.pointerId !== joyId) return; joyId = null; _touchMove = null; setKnob(0, 0); }
        joy.addEventListener('pointerdown', function (e) {
            joyId = e.pointerId;
            try { joy.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault(); e.stopPropagation();
            joyMove(e);
        });
        joy.addEventListener('pointermove', joyMove);
        joy.addEventListener('pointerup', joyEnd);
        joy.addEventListener('pointercancel', joyEnd);
        wrap.appendChild(joy);
        // Action buttons (bottom-right): jump, interact, exit
        function mkBtn(txt, right, bottom, fn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = txt;
            b.style.cssText = 'position:absolute;right:' + right + 'px;bottom:' + bottom + 'px;width:54px;height:54px;' +
                'border-radius:50%;border:2px solid rgba(130,150,210,0.55);background:rgba(40,48,70,0.55);color:#dde3f8;' +
                'font:700 0.85rem sans-serif;pointer-events:auto;touch-action:none;';
            b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
            wrap.appendChild(b);
        }
        var kb = _keyBinds();
        mkBtn('⤒', 86, 84, function () { if (_walk && _walk.grounded) { _walk.vy = 7.5; _walk.grounded = false; } });
        mkBtn(_keyHint(kb.interact), 24, 84, function () { if (_walk) _walkInteract(); });
        mkBtn('✕', 55, 18, function () { _exitWalk(); });
        _container.appendChild(wrap);
        _touchUi = wrap;
    }
    function _hideTouchControls() {
        _touchMove = null;
        if (_touchUi && _touchUi.parentNode) _touchUi.parentNode.removeChild(_touchUi);
        _touchUi = null;
    }

    // P15: brief centred toast shown each time walk mode is entered.
    function _showWalkToast() {
        if (!_container) return;
        var kb = _keyBinds();
        var moveKeys = _keyHint(kb.forward) + _keyHint(kb.left) + _keyHint(kb.back) + _keyHint(kb.right);
        var toast = document.createElement('div');
        toast.className = 'rs3d-walk-toast';
        toast.textContent = '🚶 Walk mode — ' + moveKeys + ' to move · drag/mouse to look · Esc to exit';
        _container.appendChild(toast);
        setTimeout(function () { toast.style.opacity = '0'; }, 1400);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2000);
    }

    // P9.4: pressing the walk key in 2D does nothing visible by itself — explain why.
    function _showWalk3DOnlyToast() {
        if (!_container) return;
        var toast = document.createElement('div');
        toast.className = 'rs3d-walk-toast';
        toast.textContent = '🚶 Walk mode is 3D-only — switch to 3D view first';
        _container.appendChild(toast);
        setTimeout(function () { toast.style.opacity = '0'; }, 1400);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2000);
    }

    function _toggleWalk() {
        if (_walk) { _exitWalk(); return; }
        if (_view === 'top') { _showWalk3DOnlyToast(); return; }
        _enterWalk();
    }

    function _enterWalk() {
        if (!_camera || _view === 'top') return;   // walk mode is 3D-only
        _clearHover();                             // hover affordance is orbit-only
        var dir = new THREE.Vector3();
        _camera.getWorldDirection(dir);
        var yaw = Math.atan2(dir.x, -dir.z);
        var m = 0.30;
        var px = Math.max(-ROOM_W/2+m, Math.min(ROOM_W/2-m, _camera.position.x));
        var pz = Math.max(-ROOM_D/2+m, Math.min(ROOM_D/2-m, _camera.position.z));
        // Push the start position out of the table if we're inside it.
        if (_walkCollidesAt(px, pz)) { pz = ROOM_D / 2 - 1.5; px = 0; }
        _walk = { yaw: yaw, pitch: -0.05, vy: 0, grounded: true, crouch: false, held: null,
                  wx: px, wz: pz, camY: EYE_STAND };
        _keys = {};
        _camera.position.set(px, EYE_STAND, pz);
        if (_controls) _controls.enabled = false;
        _flyTarget = null;
        var thirdPerson = (_cfg && _cfg.walkCameraMode === 'third');
        if (_walkBtn) {
            _walkBtn.textContent = '🎥';
            _walkBtn.title = (thirdPerson ? '3rd person' : '1st person') + ' — click to return to orbit';
            _walkBtn.classList.add('active');
        }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint) hint.style.display = 'none';
        if (_clickWalkBtn) _clickWalkBtn.style.display = 'none';
        if (_furnHudBtn)   _furnHudBtn.style.display = 'none';
        if (_furnHud)      _furnHud.style.display = 'none';
        _showWalkHud();
        _showWalkToast();
        if (_isTouchDevice()) _showTouchControls();
        // Become a roamer: tell everyone where I am, and spawn my own avatar locally.
        // Entering walk mode cancels any routed click-to-walk path — WASD owns movement now.
        _walkToActive = false;
        var _mr = _roamers[_myCid()]; if (_mr) _mr.path = null;
        _iAmRoaming = true; _roamSend = 1;
        var ryaw = _walkYawToRoamer(yaw);
        if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(px, pz, ryaw, 'walk');
        applyAvatarMove(_myCid(), px, pz, ryaw, 'walk');
        // P7: canvas-scoped keyboard focus (blur exits walk) + first-person mouse-look via Pointer Lock.
        if (_renderer) {
            _renderer.domElement.focus();
            if (!thirdPerson && _renderer.domElement.requestPointerLock) {
                try { _renderer.domElement.requestPointerLock(); } catch (e) {}
            }
        }
    }

    function _exitWalk() {
        if (_walk && _walk.held != null) { _saveFurniture(); }   // drop carried item where it is
        var px = _walk ? _walk.wx : (_camera ? _camera.position.x : 0);
        var pz = _walk ? _walk.wz : (_camera ? _camera.position.z : 0);
        var yaw = _walk ? _walk.yaw : 0;
        _walk = null; _keys = {};
        if (Input.is('look')) Input.to('idle');
        _padMove = null; _padPrev = {};
        _hideTouchControls();
        if (document.pointerLockElement && _renderer && document.pointerLockElement === _renderer.domElement) {
            try { document.exitPointerLock(); } catch (e) {}
        }
        _updateInteractLabel(null);
        if (_controls) { _controls.enabled = true; _controls.target.set(0, TBL_TOP, 0); _controls.update(); }
        if (_walkBtn) {
            _walkBtn.textContent = '🚶';
            _walkBtn.title = 'Walk around in first/third person (' + _keyHint(_keyBinds().walk) + ')';
            _walkBtn.classList.remove('active');
        }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint) hint.style.display = '';
        if (_clickWalkBtn) _clickWalkBtn.style.display = '';
        if (_furnHudBtn)   _furnHudBtn.style.display = '';
        _hideWalkHud();
        // Stay where I stopped, now idle (still a roamer so my avatar stays visible to all).
        if (_iAmRoaming) {
            var ryaw = _walkYawToRoamer(yaw);
            if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(px, pz, ryaw, 'idle');
            applyAvatarMove(_myCid(), px, pz, ryaw, 'idle');
        }
    }

    // Drag-to-look (active only in walk mode).
    function _onLookDown(e) { if (_walk) Input.to('look', { x: e.clientX, y: e.clientY }); }
    function _onLookMove(e) {
        if (!_walk || !Input.is('look')) return;
        var lk = Input.data;
        var dx = e.clientX - lk.x, dy = e.clientY - lk.y;
        lk.x = e.clientX; lk.y = e.clientY;
        var sens = _lookSens(), pitchSign = _invertY() ? 1 : -1;
        _walk.yaw  += dx * sens;
        _walk.pitch = Math.max(-1.2, Math.min(1.2, _walk.pitch + pitchSign * dy * sens));
    }
    function _onLookUp() { if (Input.is('look')) Input.to('idle'); }

    // Pointer Lock mouse-look (first-person walk only). Inert unless the canvas is
    // actually lock-owner — falls back silently to drag-look (_onLook*) otherwise.
    function _onPointerLockMove(e) {
        if (!_walk || !_renderer || document.pointerLockElement !== _renderer.domElement) return;
        var sens = _lookSens(), pitchSign = _invertY() ? 1 : -1;
        _walk.yaw  += (e.movementX || 0) * sens;
        _walk.pitch = Math.max(-1.2, Math.min(1.2, _walk.pitch + pitchSign * (e.movementY || 0) * sens));
    }
    function _onPointerLockChange() {
        if (_walk) _showWalkHud();   // refresh HUD text (locked vs. drag-look wording)
    }

    // Canvas-scoped keyboard focus (P7): losing focus to something outside the room
    // scene exits walk mode. Focus moving to our own on-canvas buttons (e.g. the
    // Walk toggle itself) is ignored so clicking them keeps working as before.
    function _onCanvasBlur(e) {
        if (!_walk) return;
        var rt = e && e.relatedTarget;
        if (rt && _container && _container.contains(rt)) return;
        _exitWalk();
    }

    function _furnById(id) {
        for (var i = 0; i < _furnitureObjs.length; i++) if (_furnitureObjs[i].id === id) return _furnitureObjs[i];
        return null;
    }

    // Returns true if placing the avatar at (nx, nz) would overlap a wall or the table.
    function _walkCollidesAt(nx, nz) {
        var m = 0.30;   // avatar body radius
        if (nx <= -ROOM_W/2 + m || nx >= ROOM_W/2 - m) return true;
        if (nz <= -ROOM_D/2 + m || nz >= ROOM_D/2 - m) return true;
        var t = _tbl();
        var off = _tableOffset();
        var tx = nx - off.x, tz = nz - off.z;
        if (_cfg.tableShape === 'round') {
            if (Math.hypot(tx, tz) < t.RR + 0.45) return true;
        } else {
            var tw = t.RW / 2 + 0.38, td = t.RD / 2 + 0.38;
            if (tx > -tw && tx < tw && tz > -td && tz < td) return true;
        }
        return false;
    }

    // _walk.yaw is camera convention (forward = (sin yaw, -cos yaw)); roamer/wire
    // yaw is front-follows-travel (atan2(dx,dz), robot front = local +Z). Both
    // conventions share sin and differ only by a pi rotation, so the same
    // function converts in either direction.
    function _walkYawToRoamer(yaw) { return Math.PI - yaw; }

    function _updateWalk(dt) {
        var kb = _keyBinds();
        var fwd = 0, strafe = 0;
        if (_keys[kb.forward])  fwd    += 1;
        if (_keys[kb.back])     fwd    -= 1;
        if (_keys[kb.right])    strafe += 1;
        if (_keys[kb.left])     strafe -= 1;
        // Analog sources (gamepad left stick / touch joystick). Stick-up = forward.
        if (_padMove)   { fwd -= _padMove.y;   strafe += _padMove.x; }
        if (_touchMove) { fwd -= _touchMove.y; strafe += _touchMove.x; }

        var speed = (_walk.crouch ? _crouchSpeed() : _walkSpeed()) * dt;
        var sy = Math.sin(_walk.yaw), cyw = Math.cos(_walk.yaw);
        var dx = sy * fwd + cyw * strafe;
        var dz = -cyw * fwd + sy * strafe;
        var len = Math.hypot(dx, dz);
        // Normalize only above unit length so analog inputs keep their gradation
        // (keyboard axes are ±1 so diagonal still normalizes exactly as before).
        if (len > 1) { dx /= len; dz /= len; }
        dx *= speed; dz *= speed;

        // Sliding collision: try full move, then each axis separately.
        var nx = _walk.wx + dx, nz = _walk.wz + dz;
        if (!_walkCollidesAt(nx, nz))          { _walk.wx = nx; _walk.wz = nz; }
        else if (!_walkCollidesAt(nx, _walk.wz)) { _walk.wx = nx; }
        else if (!_walkCollidesAt(_walk.wx, nz)) { _walk.wz = nz; }
        // else: fully blocked (corner) — don't move

        // Vertical physics (jump / crouch eye-height).
        var eye = _walk.crouch ? EYE_CROUCH : EYE_STAND;
        if (_walk.grounded) {
            _walk.camY += (eye - _walk.camY) * Math.min(1, dt * 12);
        } else {
            _walk.vy -= 18 * dt;
            _walk.camY += _walk.vy * dt;
            if (_walk.camY <= eye) { _walk.camY = eye; _walk.vy = 0; _walk.grounded = true; }
        }

        // Camera placement: first-person (camera = avatar eye) vs third-person (camera behind/above avatar).
        var thirdPerson = (_cfg && _cfg.walkCameraMode === 'third');
        if (thirdPerson) {
            var TD = 3.2, TH = 2.2;
            var camX = _walk.wx - Math.sin(_walk.yaw) * TD;
            var camZ = _walk.wz + Math.cos(_walk.yaw) * TD;
            _camera.position.set(camX, TH, camZ);
            _camera.lookAt(_walk.wx, 1.3, _walk.wz);
        } else {
            _camera.position.set(_walk.wx, _walk.camY, _walk.wz);
            var p = _walk.pitch;
            var lx = Math.sin(_walk.yaw) * Math.cos(p);
            var ly = Math.sin(p);
            var lz = -Math.cos(_walk.yaw) * Math.cos(p);
            _camera.lookAt(_camera.position.x + lx, _camera.position.y + ly, _camera.position.z + lz);
        }

        // Carry a held item ~1m in front, snapped to the grid.
        if (_walk.held != null) {
            var f = _furnById(_walk.held);
            if (f) {
                var hm = 0.30;
                var hx = _walk.wx + Math.sin(_walk.yaw) * 1.0;
                var hz = _walk.wz - Math.cos(_walk.yaw) * 1.0;
                hx = Math.max(-ROOM_W/2+hm, Math.min(ROOM_W/2-hm, hx));
                hz = Math.max(-ROOM_D/2+hm, Math.min(ROOM_D/2-hm, hz));
                f.x = _snapGrid(hx); f.z = _snapGrid(hz);
                if (f.group) f.group.position.set(f.x, 0, f.z);
            } else {
                _walk.held = null;
            }
        }

        // Drive self-avatar pose (visible in third-person; also seen by others via roamer).
        var myR = _roamers[_myCid()];
        if (myR && myR.robot) {
            var moving = (fwd !== 0 || strafe !== 0);
            if (_walk.crouch) {
                _poseRobotCrouch(myR.robot);
            } else if (!_walk.grounded) {
                _poseRobotJump(myR.robot);
            } else {
                myR.walkPhase = (myR.walkPhase || 0) + dt * (moving ? 4.2 : 0);
                _poseRobotWalk(myR.robot, myR.walkPhase, moving);
            }
        }

        // Broadcast avatar position so everyone sees me roam (throttled).
        _roamSend += dt;
        if (_roamSend >= 0.1) {
            _roamSend = 0;
            var ryaw = _walkYawToRoamer(_walk.yaw);
            if (window.RoomSceneNet && RoomSceneNet.avatarMove)
                RoomSceneNet.avatarMove(_walk.wx, _walk.wz, ryaw, 'walk');
            applyAvatarMove(_myCid(), _walk.wx, _walk.wz, ryaw, 'walk');
        }

        // Refresh the "Press E to ..." prompt a few times a second (P9).
        _interactCheckT += dt;
        if (_interactCheckT >= 0.2) {
            _interactCheckT = 0;
            _updateInteractLabel(_findInteractTarget());
        }
    }

    // Shared E-interact resolver (P3): horizontal distance + facing-bearing test,
    // so chairs/whiteboard/props/furniture respond identically in first- and
    // third-person — unlike a raycast, this doesn't care that third-person's ray
    // is horizontal at y=1.1 (chair seats sit at y≈0.47) or that first-person
    // pitch changes the ray's horizontal reach.
    // Returns { kind:'drop'|'whiteboard'|'prop'|'chair'|'furniture', ...payload } or null.
    function _resolveInteractable() {
        if (!_walk) return null;
        if (_walk.held != null) return { kind: 'drop' };

        var wx = _walk.wx, wz = _walk.wz, yaw = _walk.yaw;
        var candidates = [];

        if (_wbBoard) {
            var wbPos = new THREE.Vector3(); _wbBoard.getWorldPosition(wbPos);
            candidates.push({ kind: 'whiteboard', x: wbPos.x, z: wbPos.z, range: 2.2 });
        }
        _props.forEach(function (p) {
            if (!p.group) return;
            candidates.push({ kind: 'prop', x: p.group.position.x, z: p.group.position.z, range: 2.5, action: p.action });
        });
        _chairObjects.forEach(function (c) {
            candidates.push({ kind: 'chair', x: c.group.position.x, z: c.group.position.z, range: 1.9, idx: c.idx });
        });
        _furnitureObjs.forEach(function (f) {
            candidates.push({ kind: 'furniture', x: f.group.position.x, z: f.group.position.z, range: 2.0, id: f.id });
        });

        var best = null, bestDist = Infinity;
        candidates.forEach(function (c) {
            var dist = Math.hypot(c.x - wx, c.z - wz);
            if (dist > c.range) return;
            // Bearing uses the camera-yaw convention (forward = (sin yaw, -cos yaw)) —
            // same convention _walk.yaw uses regardless of the P2 roamer-yaw fix.
            var brg = Math.atan2(c.x - wx, -(c.z - wz));
            var d = brg - yaw;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d <= -Math.PI) d += 2 * Math.PI;
            if (Math.abs(d) >= 0.7) return;   // ~40° facing cone
            if (dist < bestDist) { bestDist = dist; best = c; }
        });
        return best;
    }

    // E key: drop a carried item, open the whiteboard, run a prop, sit/stand, or pick up furniture.
    function _walkInteract() {
        var r = _resolveInteractable();
        if (!r) return;
        switch (r.kind) {
            case 'drop':
                _saveFurniture(); _walk.held = null; return;
            case 'whiteboard':
                if (window.Whiteboard) Whiteboard.open(); return;
            case 'prop':
                _runProp(r.action); return;
            case 'chair':
                var claim = _claimedChairs[r.idx];
                if (claim && claim.cid === _myCid()) releaseMySeat();
                else if (!claim) { _pendingChairIdx = r.idx; _confirmClaim(); }   // direct claim, no bar
                return;
            case 'furniture':
                _walk.held = r.id; _deselectAll(); return;
        }
    }

    // Side-effect-free probe for the "Press E to ..." HUD prompt (P9) — mirrors
    // _walkInteract()'s resolution but performs no actions or state changes.
    function _findInteractTarget() {
        var r = _resolveInteractable();
        if (!r) return null;
        switch (r.kind) {
            case 'drop':       return { label: 'drop' };
            case 'whiteboard': return { label: 'open whiteboard' };
            case 'prop':       return { label: _propLabel(r.action) };
            case 'chair':
                var claim = _claimedChairs[r.idx];
                if (claim && claim.cid === _myCid()) return { label: 'stand up' };
                if (!claim) return { label: 'sit' };
                return null;
            case 'furniture':  return { label: 'pick up' };
        }
        return null;
    }

    // Show/hide/update the floating "Press E to ..." prompt near the avatar (P9).
    function _updateInteractLabel(target) {
        if (!_scene || !CSS2DObject) return;
        if (!target) {
            if (_interactLabel) _interactLabel.visible = false;
            return;
        }
        if (!_interactLabel) {
            var div = document.createElement('div');
            div.className = 'rs3d-interact-label';
            div.style.cssText = 'background:rgba(20,24,40,0.86);color:#cdd6f4;border:1px solid rgba(120,140,210,0.35);' +
                'border-radius:6px;padding:3px 9px;font:600 0.72rem sans-serif;white-space:nowrap;pointer-events:none;';
            _interactLabel = new CSS2DObject(div);
            _scene.add(_interactLabel);
        }
        var kb = _keyBinds();
        _interactLabel.element.textContent = _keyHint(kb.interact) + ' ' + target.label;
        _interactLabel.visible = true;
        var fx = _walk.wx + Math.sin(_walk.yaw) * 1.2;
        var fz = _walk.wz - Math.cos(_walk.yaw) * 1.2;
        _interactLabel.position.set(fx, 1.7, fz);
    }

    // Remove the interact-prompt CSS2DObject and its DOM element (called from
    // dispose() and refreshScene() to avoid orphaned label nodes).
    function _disposeInteractLabel() {
        if (_interactLabel) {
            if (_interactLabel.parent) _interactLabel.parent.remove(_interactLabel);
            if (_interactLabel.element && _interactLabel.element.parentNode) {
                _interactLabel.element.parentNode.removeChild(_interactLabel.element);
            }
            _interactLabel = null;
        }
        _interactCheckT = 0;
    }

    // ── Selection highlight + control bar (P8: furniture, chairs, props, table) ──
    function _selectedFurn() {
        if (!_sel || _sel.kind !== 'furniture') return null;
        for (var i = 0; i < _furnitureObjs.length; i++) {
            if (_furnitureObjs[i].id === _sel.id) return _furnitureObjs[i];
        }
        return null;
    }
    function _propGroupForKey(key) {
        for (var i = 0; i < _props.length; i++) if (_props[i].key === key) return _props[i].group;
        return null;
    }
    // Resolve the current selection to a uniform { group, pos, getRot, setRot, label,
    // canRotate } interface, or null if nothing is selected / it no longer exists
    // (e.g. furniture removed, chair count shrank).
    function _selRefs() {
        if (!_sel) return null;
        if (_sel.kind === 'furniture') {
            var f = _selectedFurn();
            if (!f) return null;
            var icons = { plant:'🌿', coffee_table:'☕', projector:'📽️', whiteboard:'📋' };
            return {
                group: f.group, pos: { x: f.x, z: f.z },
                getRot: function () { return f.rot || 0; },
                setRot: function (rot) { f.rot = rot; if (f.group) f.group.rotation.y = rot; _saveFurniture(); },
                label: (icons[f.type] || '📦') + ' ' + String(f.type).replace('_', ' '),
                canRotate: true
            };
        }
        if (_sel.kind === 'chair') {
            var idx = _sel.id, co = null;
            for (var i = 0; i < _chairObjects.length; i++) if (_chairObjects[i].idx === idx) { co = _chairObjects[i]; break; }
            if (!co) return null;
            return {
                group: co.group, pos: { x: co.group.position.x, z: co.group.position.z },
                getRot: function () { return co.group.rotation.y; },
                setRot: function (rot) {
                    _chairPos[idx] = Object.assign({ x: co.group.position.x, z: co.group.position.z }, _chairPos[idx], { rot: rot });
                    _myChairMoveTime[idx] = performance.now();
                    _saveChairPositions(true);
                    _rebuildSeating();
                },
                label: '🪑 chair',
                canRotate: true
            };
        }
        if (_sel.kind === 'decor') {
            var key = _sel.id;
            var group = (key === 'table') ? _tableGroup : _propGroupForKey(key);
            if (!group) return null;
            var dlabels = { confetti: '🎉 confetti', music: '🎵 jukebox', table: '🪑 table' };
            return {
                group: group, pos: { x: group.position.x, z: group.position.z },
                getRot: function () { return group.rotation.y; },
                setRot: function (rot) {
                    group.rotation.y = rot;
                    _decorPos[key] = Object.assign({ x: group.position.x, z: group.position.z }, _decorPos[key], { rot: rot });
                    _saveDecorPositions(true);
                },
                label: dlabels[key] || ('📦 ' + key),
                canRotate: true
            };
        }
        return null;
    }
    function _updateSelRing() {
        var ref = _selRefs();
        if (!ref) { _deselectAll(); return; }
        if (_selRing) _selRing.position.set(ref.pos.x, 0.02, ref.pos.z);
        if (_selHandle) {
            var visible = ref.canRotate && _rotStep() === 'free';
            _selHandle.visible = visible;
            if (visible) {
                var rot = ref.getRot(), R = 0.6;
                _selHandle.position.set(ref.pos.x + R * Math.sin(rot), 0.12, ref.pos.z + R * Math.cos(rot));
            }
        }
    }
    function _selectItem(kind, id) {
        _sel = { kind: kind, id: id };
        if (!_selRing && _scene) {
            _selRing = new THREE.Mesh(
                new THREE.TorusGeometry(0.45, 0.03, 8, 32),
                new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.0 })
            );
            _selRing.rotation.x = Math.PI / 2;
            _selRing.userData.selRing = true;
            _scene.add(_selRing);
        }
        if (!_selHandle && _scene) {
            _selHandle = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 16, 12),
                new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2 })
            );
            _selHandle.userData.selHandle = true;
            _scene.add(_selHandle);
        }
        if (_selRing) _selRing.visible = true;
        _updateSelRing();
        _showSelBar();
    }
    function _deselectAll() {
        _sel = null;
        if (_selRing) _selRing.visible = false;
        if (_selHandle) _selHandle.visible = false;
        if (_selBar) _selBar.style.display = 'none';
        _hoverCursor = ''; if (_renderer) _renderer.domElement.style.cursor = '';
    }
    function _deleteSelected() {
        if (!_sel || _sel.kind !== 'furniture') return;
        removeFurniture(_sel.id);
        _deselectAll();
    }
    // Rotate the selected item by the chosen step (dir: +1 = clockwise, -1 = counter-clockwise).
    function _rotateSelected(dir) {
        var ref = _selRefs();
        if (!ref || !ref.canRotate) return;
        var TWO_PI = Math.PI * 2;
        var rot = (ref.getRot() + dir * _rotStepRadians()) % TWO_PI;
        if (rot < 0) rot += TWO_PI;
        ref.setRot(rot);
        _updateSelRing();
    }
    function _resetSelection() {
        if (_selRing && _scene) { try { _scene.remove(_selRing); } catch (e) {} }
        if (_selHandle && _scene) { try { _scene.remove(_selHandle); } catch (e) {} }
        _selRing = null; _selHandle = null;
        _sel = null;
        if (_selBar) _selBar.style.display = 'none';
    }
    // Personal preference (not synced): rotation step used by ↺/↻ and R/Shift+R.
    function _rotStepKey() { return 'es_rs3d_rotstep'; }
    var _rotStepVal = null;
    function _rotStep() {
        if (_rotStepVal === null) {
            try { _rotStepVal = localStorage.getItem(_rotStepKey()) || '45'; } catch (e) { _rotStepVal = '45'; }
        }
        return _rotStepVal;
    }
    function _setRotStep(v) {
        _rotStepVal = v;
        try { localStorage.setItem(_rotStepKey(), v); } catch (e) {}
        _updateSelRing();
    }
    function _rotStepRadians() {
        var v = _rotStep();
        if (v === '15') return Math.PI / 12;
        if (v === '30') return Math.PI / 6;
        return Math.PI / 4;   // '45' (default) and 'free' (R/Shift+R fallback)
    }
    // Generic in-canvas confirm bar (replaces window.confirm for host actions / destructive
    // resets). Only one confirm can be pending at a time; showing a new one replaces it.
    var _confirmBar = null;
    function _createConfirmBar() {
        var bar = document.createElement('div');
        bar.id = 'rs3d-confirm-bar';
        bar.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);' +
            'background:rgba(20,24,40,0.96);color:#e8eaf6;padding:7px 14px;border-radius:8px;' +
            'display:none;z-index:14;font-size:0.80rem;gap:9px;align-items:center;' +
            'border:1px solid rgba(220,53,69,0.5);backdrop-filter:blur(6px);white-space:nowrap;';
        bar.innerHTML =
            '<span id="rs3d-confirm-msg"></span>' +
            '<button id="rs3d-confirm-yes" style="background:#dc3545;color:#fff;border:none;' +
            'border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:700;">✓</button>' +
            '<button id="rs3d-confirm-no" style="background:transparent;color:#aaa;' +
            'border:1px solid #555;border-radius:5px;padding:3px 10px;cursor:pointer;">✕</button>';
        _container.appendChild(bar);
        _confirmBar = bar;
    }
    function _showConfirmBar(message, onYes) {
        if (!_confirmBar) _createConfirmBar();
        _confirmBar.querySelector('#rs3d-confirm-msg').textContent = message;
        var yes = _confirmBar.querySelector('#rs3d-confirm-yes');
        var no  = _confirmBar.querySelector('#rs3d-confirm-no');
        function hide() { _confirmBar.style.display = 'none'; yes.onclick = null; no.onclick = null; }
        yes.onclick = function () { hide(); onYes(); };
        no.onclick  = hide;
        _confirmBar.style.display = 'flex';
    }
    function _createSelBar() {
        var bar = document.createElement('div');
        bar.id = 'rs3d-sel-bar';
        bar.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);' +
            'background:rgba(20,24,40,0.94);color:#e8eaf6;padding:7px 14px;border-radius:8px;' +
            'display:none;z-index:11;font-size:0.80rem;gap:9px;align-items:center;' +
            'border:1px solid rgba(34,197,94,0.4);backdrop-filter:blur(6px);white-space:nowrap;';
        bar.innerHTML =
            '<span id="rs3d-sel-name">Item selected</span>' +
            '<button id="rs3d-sel-rot" title="Rotate (R / Shift+R)" style="background:transparent;color:#e8eaf6;' +
            'border:1px solid #555;border-radius:5px;padding:3px 8px;cursor:pointer;">↻</button>' +
            '<select id="rs3d-sel-step" title="Rotation step" style="background:#1c2030;color:#e8eaf6;' +
            'border:1px solid #555;border-radius:5px;padding:3px 4px;cursor:pointer;">' +
            '<option value="45">45°</option><option value="30">30°</option>' +
            '<option value="15">15°</option><option value="free">Free</option></select>' +
            '<button id="rs3d-sel-del" style="background:#dc3545;color:#fff;border:none;' +
            'border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:700;">✕ Delete</button>' +
            '<button id="rs3d-sel-done" style="background:transparent;color:#aaa;' +
            'border:1px solid #555;border-radius:5px;padding:3px 8px;cursor:pointer;">Done</button>';
        _container.appendChild(bar);
        bar.querySelector('#rs3d-sel-rot').onclick  = function(){ _rotateSelected(1); };
        bar.querySelector('#rs3d-sel-step').onchange = function(){ _setRotStep(this.value); };
        bar.querySelector('#rs3d-sel-del').onclick  = _deleteSelected;
        bar.querySelector('#rs3d-sel-done').onclick = _deselectAll;
        _selBar = bar;
    }
    function _showSelBar() {
        if (!_selBar) return;
        var ref = _selRefs();
        if (!ref) { _deselectAll(); return; }
        var nameEl = _selBar.querySelector('#rs3d-sel-name');
        if (nameEl) nameEl.textContent = ref.label + ' — drag to move';
        var stepEl = _selBar.querySelector('#rs3d-sel-step');
        if (stepEl) stepEl.value = _rotStep();
        var delBtn = _selBar.querySelector('#rs3d-sel-del');
        if (delBtn) delBtn.style.display = (_sel.kind === 'furniture') ? '' : 'none';
        _selBar.style.display = 'flex';
    }

    // ── glTF model registry & async loader (Realism Phase B) ───
    // Catalog of chair/furniture types that have a real glTF model. Types with
    // model: null keep their hand-built primitive geometry indefinitely.
    var RS_CATALOG = {
        chairs: {
            office: { model: '/models/chairs/office.glb', scale: 1.0, rotY: 0 },
            gaming:  { model: null },
            beanbag: { model: null },
            // KayKit Furniture Bits (CC0) — .gltf with sibling .bin + texture in the same folder.
            stool:   { model: '/models/chairs/stool/chair_stool.gltf', scale: 1.0, rotY: 0 },
            throne:  { model: null }
        }
    };

    var _gltfLoader  = null;
    var _modelCache  = {}; // url -> Promise<THREE.Group> (template, loaded once & cloned per instance)

    function _loadModel(url) {
        if (_modelCache[url]) return _modelCache[url];
        if (!_gltfLoader) _gltfLoader = new GLTFLoader();
        _modelCache[url] = new Promise(function (resolve, reject) {
            _gltfLoader.load(url, function (gltf) {
                gltf.scene.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
                resolve(gltf.scene);
            }, undefined, function (err) {
                console.warn('[RS3D] model load failed:', url, err);
                reject(err);
            });
        });
        return _modelCache[url];
    }

    // Swaps a chair's primitive parts for a cloned glTF model once it's loaded, scaling
    // and grounding it to the chair group's origin. `seatMesh` is kept (invisible) as the
    // raycast/pick proxy for chair-claim and drag interactions.
    function _applyChairModel(group, seatMesh, entry) {
        if (!entry || !entry.model) return;
        _loadModel(entry.model).then(function (template) {
            if (group.parent !== _scene) return; // chair was rebuilt before the model arrived
            var model = template.clone();
            var box = new THREE.Box3().setFromObject(model);
            var center = box.getCenter(new THREE.Vector3());
            var scale = entry.scale || 1;
            model.scale.setScalar(scale);
            model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
            if (entry.rotY) model.rotation.y = entry.rotY;
            group.children.slice().forEach(function (child) {
                if (child === seatMesh) child.visible = false;
                else group.remove(child);
            });
            group.add(model);
        }).catch(function () { /* keep primitive on load failure */ });
    }

    // ── Chair types ───────────────────────────────────────────
    function _makeChairByType(type, unclaimed) {
        switch (type) {
            case 'gaming':  return _makeGamingChair(unclaimed);
            case 'beanbag': return _makeBeanBag(unclaimed);
            case 'stool':   return _makeStool(unclaimed);
            case 'throne':  return _makeThrone(unclaimed);
            default:        return _makeOfficeChair(unclaimed);
        }
    }

    function _chairColor(unclaimed) { return unclaimed ? 0x2a3050 : 0x1e1e2e; }

    function _makeOfficeChair(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: _chairColor(unclaimed), roughness: 0.72 });
        var lm = new THREE.MeshStandardMaterial({ color: 0x8888a0, roughness: 0.28, metalness: 0.85 });
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.055,0.44), sm);
        seat.position.y = SEAT_H; seat.castShadow = true; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.50,0.055), sm);
        back.position.set(0, SEAT_H+0.285, -0.20); back.castShadow = true; g.add(back);
        var col = new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.032,SEAT_H-0.04,6), lm);
        col.position.y = SEAT_H/2; g.add(col);
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.065,0.025,8), lm);
        hub.position.y = 0.012; g.add(hub);
        for (var i=0;i<5;i++){
            var a=(i/5)*Math.PI*2;
            var sp=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.022,0.044),lm);
            sp.rotation.y=a; sp.position.set(Math.cos(a)*0.10,0.011,Math.sin(a)*0.10); g.add(sp);
        }
        _applyChairModel(g, seat, RS_CATALOG.chairs.office);
        return { group: g, seatMesh: seat };
    }

    function _makeGamingChair(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x1a0a22 : 0x0d0d1e, roughness: 0.65 });
        var ac = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.5, metalness: 0.3 });
        var lm = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.07,0.46), sm);
        seat.position.y = SEAT_H; seat.castShadow = true; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.68,0.07), sm);
        back.position.set(0,SEAT_H+0.37,-0.19); back.castShadow = true; g.add(back);
        [-0.24,0.24].forEach(function(wx){
            var wing=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.30,0.1),ac);
            wing.position.set(wx,SEAT_H+0.45,-0.19); g.add(wing);
        });
        var strip=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.60,0.08),ac);
        strip.position.set(0,SEAT_H+0.37,-0.155); g.add(strip);
        [-0.24,0.24].forEach(function(ax){
            var arm=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.05,0.3),lm);
            arm.position.set(ax,SEAT_H+0.06,-0.04); g.add(arm);
        });
        var col2=new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.032,SEAT_H-0.04,6),lm);
        col2.position.y=SEAT_H/2; g.add(col2);
        var hub2=new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.065,0.025,8),lm);
        hub2.position.y=0.012; g.add(hub2);
        for(var i2=0;i2<5;i2++){
            var a2=(i2/5)*Math.PI*2;
            var sp2=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.022,0.044),lm);
            sp2.rotation.y=a2; sp2.position.set(Math.cos(a2)*0.10,0.011,Math.sin(a2)*0.10); g.add(sp2);
        }
        return { group: g, seatMesh: seat };
    }

    function _makeBeanBag(unclaimed) {
        var g = new THREE.Group();
        var mc = unclaimed ? 0x3d2060 : 0x5b2d8e;
        var sm = new THREE.MeshStandardMaterial({ color: mc, roughness: 0.85, metalness: 0 });
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.42,0.14,12), sm);
        base.position.y = 0.07; g.add(base);
        var body = new THREE.Mesh(new THREE.SphereGeometry(0.32,10,8), sm);
        body.scale.set(1,0.62,1);
        body.position.y = 0.14 + 0.32*0.62 - 0.04;
        body.castShadow = true;
        g.add(body);
        return { group: g, seatMesh: body };
    }

    function _makeStool(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x5a3a10 : 0x8a5a20, roughness: 0.75 });
        var lm = new THREE.MeshStandardMaterial({ color: 0x5a4020, roughness: 0.8, metalness: 0.1 });
        var seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.06,12), sm);
        seat.position.y = SEAT_H; seat.castShadow = true; g.add(seat);
        [[0.13,0.13],[-0.13,0.13],[0.13,-0.13],[-0.13,-0.13]].forEach(function(p){
            var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.025,SEAT_H-0.04,6),lm);
            leg.position.set(p[0],SEAT_H/2,p[1]);
            leg.rotation.z=(p[0]>0?-1:1)*0.08;
            leg.rotation.x=(p[1]>0?-1:1)*0.08;
            g.add(leg);
        });
        var ring=new THREE.Mesh(new THREE.TorusGeometry(0.17,0.015,6,16),lm);
        ring.position.y=SEAT_H*0.38; ring.rotation.x=Math.PI/2; g.add(ring);
        _applyChairModel(g, seat, RS_CATALOG.chairs.stool);
        return { group: g, seatMesh: seat };
    }

    function _makeThrone(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x3a1a5a : 0x5a1a9a, roughness: 0.6 });
        var gm = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.52,0.08,0.50), sm);
        seat.position.y = SEAT_H; seat.castShadow = true; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.50,0.82,0.07), sm);
        back.position.set(0,SEAT_H+0.43,-0.21); back.castShadow = true; g.add(back);
        var trim=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.06,0.09),gm);
        trim.position.set(0,SEAT_H+0.86,-0.21); g.add(trim);
        [-0.16,0,0.16].forEach(function(sx,si){
            var h=si===1?0.20:0.14;
            var sp=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.04,h,6),gm);
            sp.position.set(sx,SEAT_H+0.86+h/2,-0.21); g.add(sp);
            var tip=new THREE.Mesh(new THREE.SphereGeometry(0.03,5,5),gm);
            tip.position.set(sx,SEAT_H+0.86+h,-0.21); g.add(tip);
        });
        [-0.27,0.27].forEach(function(ax){
            var ar=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.06,0.36),gm);
            ar.position.set(ax,SEAT_H+0.10,-0.06); g.add(ar);
            var cap=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.04,0.09),gm);
            cap.position.set(ax,SEAT_H+0.14,0.10); g.add(cap);
        });
        [[-0.20,-0.20],[0.20,-0.20],[-0.20,0.18],[0.20,0.18]].forEach(function(p){
            var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.045,TBL_TOP*0.68,8),gm);
            leg.position.set(p[0],TBL_TOP*0.34,p[1]); g.add(leg);
        });
        return { group: g, seatMesh: seat };
    }

    // ── Robot: full jointed humanoid ─────────────────────────
    // Returns a Group with userData.joints for animation. Proportions match a 1.3m-tall
    // robot avatar with separate upper arm, forearm, thigh, shin, and foot segments.
    var ROBOT_HIP_Y   = 0.70;   // hip height when standing (world)
    var ROBOT_HEAD_Y  = 1.19;   // head centre (world) — used for labels + rings

    function _makeRobot(color, voteState, seated, scene3d) {
        scene3d = scene3d || { hat: 'none', eyes: 'round' };
        var root  = new THREE.Group();
        var base  = _colorHex(color);
        var dark  = _darken(base, 0.58);
        var eyeC  = voteState==='revealed' ? 0x22ff88 : voteState==='voted' ? 0xffcc00 : 0x00ddff;

        var jointDark = _darken(base, 0.40);
        var bm  = new THREE.MeshStandardMaterial({ color: base, roughness: 0.35, metalness: 0.55 });
        var lm  = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.22 });
        var em  = new THREE.MeshStandardMaterial({ color: eyeC, emissive: eyeC, emissiveIntensity: 1.4, roughness: 0.05 });
        var jm  = new THREE.MeshStandardMaterial({ color: jointDark, roughness: 0.6, metalness: 0.5 }); // joint balls (darker)
        var badgeM = new THREE.MeshStandardMaterial({ color: base, emissive: base, emissiveIntensity: 0.65, roughness: 0.3, metalness: 0.2 });

        // Helper: cylinder along local Y
        function cyl(rt, rb, h, seg, mat) {
            return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 7), mat);
        }
        function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
        function sph(r, mat) { return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat); }
        // Higher-res sphere for head-adjacent parts (eyes, antenna tip)
        function sphHi(r, mat) { return new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); }
        // Capsule along local Y — `h` is the overall length (incl. rounded caps), matching
        // the previous cylinder's `h` so joint pivots/positions stay unchanged.
        function cap(r, h, mat) {
            return new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(h - 2 * r, 0.001), 4, 8), mat);
        }

        var hipY = seated ? SEAT_H + 0.22 : ROBOT_HIP_Y;

        // ── Hips group (pivot for legs + spine) ──
        var hips = new THREE.Group(); hips.position.y = hipY; root.add(hips);

        // ── Spine / torso ──
        var torsoMesh = cap(0.145, 0.36, bm);
        torsoMesh.position.y = 0.18; torsoMesh.castShadow = true; hips.add(torsoMesh);

        // Chest badge — small emissive disc tinted with the participant colour
        var badge = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), badgeM);
        badge.position.set(0, 0.20, 0.148); hips.add(badge);

        // ── Neck + head ──
        var neck = new THREE.Group(); neck.position.y = 0.38; hips.add(neck);
        var headMesh = box(0.23, 0.22, 0.19, bm);
        headMesh.position.y = 0.11; headMesh.castShadow = true; neck.add(headMesh);
        // Eyes — 'visor' (P13) replaces the two round eyes with a single face-spanning visor
        if (scene3d.eyes === 'visor') {
            var visor = box(0.20, 0.05, 0.03, em);
            visor.position.set(0, 0.12, 0.095); neck.add(visor);
        } else {
            [-0.058, 0.058].forEach(function(ex) {
                var eye = sphHi(0.034, em); eye.position.set(ex, 0.12, 0.092); neck.add(eye);
            });
        }
        // Antenna
        var ant = cyl(0.008, 0.008, 0.12, 5, lm); ant.position.y = 0.29; neck.add(ant);
        var antTip = sphHi(0.022, em); antTip.position.y = 0.35; neck.add(antTip);

        // ── Hat / head accessory (P13) ──
        (function buildHat(type) {
            if (type === 'cap') {
                var capTop = box(0.21, 0.07, 0.19, lm);
                capTop.position.y = 0.255; neck.add(capTop);
                var brim = box(0.25, 0.02, 0.08, lm);
                brim.position.set(0, 0.225, 0.13); neck.add(brim);
            } else if (type === 'antennaBobble') {
                var stalk = cyl(0.006, 0.006, 0.10, 5, lm);
                stalk.position.set(0.07, 0.27, 0); neck.add(stalk);
                var bobble = sph(0.03, em);
                bobble.position.set(0.07, 0.33, 0); neck.add(bobble);
            } else if (type === 'crown') {
                var gm = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
                var band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 16), gm);
                band.rotation.x = Math.PI / 2; band.position.y = 0.225; neck.add(band);
                [-0.10, 0, 0.10].forEach(function(sx) {
                    var spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), gm);
                    spike.position.set(sx, 0.27, 0); neck.add(spike);
                });
            } else if (type === 'headphones') {
                var band2 = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 6, 16, Math.PI), jm);
                band2.position.y = 0.13; neck.add(band2);
                [-1, 1].forEach(function(side) {
                    var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), jm);
                    cup.rotation.z = Math.PI / 2; cup.position.set(side * 0.145, 0.12, 0); neck.add(cup);
                });
            }
        })(scene3d.hat);

        // ── Arms ──
        function buildArm(side) {
            var sg = new THREE.Group();
            sg.position.set(side * 0.185, 0.34, 0); hips.add(sg);
            // Upper arm
            var ua = cap(0.037, 0.26, lm); ua.position.y = -0.13; sg.add(ua);
            var jball = sph(0.044, jm); sg.add(jball);  // shoulder joint ball
            // Elbow pivot
            var eg = new THREE.Group(); eg.position.y = -0.26; sg.add(eg);
            var fa = cap(0.029, 0.22, lm); fa.position.y = -0.11; eg.add(fa);
            var ej = sph(0.038, jm); eg.add(ej); // elbow joint ball
            // Hand
            var hand = box(0.082, 0.065, 0.055, bm); hand.position.y = -0.25; eg.add(hand);
            return { shoulder: sg, elbow: eg };
        }
        var la = buildArm(-1), ra = buildArm(1);

        // ── Legs ──
        function buildLeg(side) {
            var hg = new THREE.Group(); hg.position.set(side * 0.09, 0, 0); hips.add(hg);
            // Thigh
            var thigh = cap(0.056, 0.36, lm); thigh.position.y = -0.18; hg.add(thigh);
            var hj = sph(0.060, jm); hg.add(hj); // hip joint ball
            // Knee pivot
            var kg = new THREE.Group(); kg.position.y = -0.36; hg.add(kg);
            var shin = cap(0.046, 0.28, lm); shin.position.y = -0.14; kg.add(shin);
            var kj = sph(0.052, jm); kg.add(kj); // knee joint ball
            // Ankle pivot
            var ag = new THREE.Group(); ag.position.y = -0.28; kg.add(ag);
            var foot = box(0.10, 0.065, 0.18, lm); foot.position.set(0, -0.032, 0.028); ag.add(foot);
            return { hip: hg, knee: kg, ankle: ag };
        }
        var ll = buildLeg(-1), rl = buildLeg(1);

        // AO shadow disc
        var aoDisk = new THREE.Mesh(
            new THREE.CircleGeometry(0.26, 12),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
        );
        aoDisk.rotation.x = -Math.PI / 2; aoDisk.position.y = 0.002; root.add(aoDisk);

        // Store joint refs for animation
        root.userData.joints = {
            hips: hips, neck: neck,
            lShoulder: la.shoulder, rShoulder: ra.shoulder,
            lElbow: la.elbow,       rElbow: ra.elbow,
            lHip: ll.hip, rHip: rl.hip,
            lKnee: ll.knee, rKnee: rl.knee,
            lAnkle: ll.ankle, rAnkle: rl.ankle,
            antTip: antTip, head: headMesh, hipY: hipY
        };

        // Apply initial pose
        if (seated) _poseRobotSeated(root);
        // standing = neutral pose (all rotations 0)
        return root;
    }

    // ── Robot pose helpers ────────────────────────────────────
    // Seated: thighs horizontal forward, shins hanging down, arms resting forward.
    function _poseRobotSeated(root) {
        var j = root.userData.joints; if (!j) return;
        // Robot front is +Z (eyes/badge at +z) and rotating −π/2 about X swings the
        // down-pointing thigh to +Z — negative = forward. The old +π/2 here folded the
        // legs out through the chair's backrest.
        j.lHip.rotation.x   = -Math.PI / 2;   // thigh forward over the seat
        j.rHip.rotation.x   = -Math.PI / 2;
        j.lKnee.rotation.x  =  Math.PI / 2;   // shin straight down (cancels hip)
        j.rKnee.rotation.x  =  Math.PI / 2;
        j.lShoulder.rotation.x = -0.9;         // arms resting forward
        j.rShoulder.rotation.x = -0.9;
        j.lElbow.rotation.x    =  0.35;
        j.rElbow.rotation.x    =  0.35;
    }

    // Walk cycle: swing legs and opposite arms based on a phase angle.
    // Also resets any Z-axis spread set by the jump pose so it doesn't linger.
    function _poseRobotWalk(root, phase, isWalking) {
        var j = root.userData.joints; if (!j) return;
        var s = isWalking ? Math.sin(phase) : 0;
        j.lHip.rotation.x   =  s * 0.42;
        j.rHip.rotation.x   = -s * 0.42;
        j.lHip.rotation.z   =  0;   // clear jump spread
        j.rHip.rotation.z   =  0;
        j.lKnee.rotation.x  = Math.max(0,  s) * 0.45;
        j.rKnee.rotation.x  = Math.max(0, -s) * 0.45;
        j.lShoulder.rotation.x = -s * 0.28;
        j.rShoulder.rotation.x =  s * 0.28;
        j.lShoulder.rotation.z =  0;   // clear jump spread
        j.rShoulder.rotation.z =  0;
        j.lElbow.rotation.x = Math.abs(s) * 0.15;
        j.rElbow.rotation.x = Math.abs(s) * 0.15;
        // Hip height: standing
        var hy = j.hipY !== undefined ? j.hipY : ROBOT_HIP_Y;
        j.hips.position.y = hy + (isWalking ? Math.abs(s) * 0.018 : 0);   // subtle bob
    }

    // Crouch pose: hips lower, knees bent, arms slightly raised.
    function _poseRobotCrouch(root) {
        var j = root.userData.joints; if (!j) return;
        j.hips.position.y  = (j.hipY !== undefined ? j.hipY : ROBOT_HIP_Y) - 0.20;
        // Same forward = negative-X convention as the seated pose: thighs flex forward
        // into the squat, knees bend the shins back under the body.
        j.lHip.rotation.x  = -0.65;
        j.rHip.rotation.x  = -0.65;
        j.lKnee.rotation.x =  1.10;
        j.rKnee.rotation.x =  1.10;
        j.lShoulder.rotation.x = -0.30;
        j.rShoulder.rotation.x = -0.30;
        j.lElbow.rotation.x    =  0.20;
        j.rElbow.rotation.x    =  0.20;
    }

    // Jump pose: dramatic air pose — hips raised, legs kick back hard, arms fly up+out.
    function _poseRobotJump(root) {
        var j = root.userData.joints; if (!j) return;
        var hy = j.hipY !== undefined ? j.hipY : ROBOT_HIP_Y;
        // Whole body lifts up
        j.hips.position.y = hy + 0.35;
        // Legs kick backward and spread (tuck under)
        j.lHip.rotation.x  = -0.72;
        j.rHip.rotation.x  = -0.72;
        j.lHip.rotation.z  =  0.18;  // legs spread outward
        j.rHip.rotation.z  = -0.18;
        j.lKnee.rotation.x =  0.90;  // knees bend sharply (tuck)
        j.rKnee.rotation.x =  0.90;
        // Arms fly upward and outward — triumphant leap
        j.lShoulder.rotation.x = -1.10;
        j.rShoulder.rotation.x = -1.10;
        j.lShoulder.rotation.z =  0.55;   // out to sides
        j.rShoulder.rotation.z = -0.55;
        j.lElbow.rotation.x    = -0.35;
        j.rElbow.rotation.x    = -0.35;
    }

    // Idle: gentle sway animation; call each tick with the global clock.
    function _animRobotIdle(root, clock, phase) {
        var j = root.userData.joints; if (!j) return;
        var s = Math.sin(clock * 0.65 + (phase || 0));
        // subtle torso sway
        j.hips.rotation.z = s * 0.018;
        // arm breathe
        var ab = Math.sin(clock * 0.55 + (phase || 0)) * 0.09;
        if (j.lShoulder.rotation.x === 0 || Math.abs(j.lShoulder.rotation.x) < 0.12) {
            j.lShoulder.rotation.x = ab;
            j.rShoulder.rotation.x = ab;
        }
        // antenna tip pulse handled separately in _tick via antTip.material
        // head gentle nod
        if (j.neck) j.neck.rotation.x = Math.sin(clock * 0.38 + (phase || 0)) * 0.03;
    }

    // Vote-reveal arm-raise: animate over 1.5s then reset (returns true when done).
    function _animArmRaise(root, t) {
        var j = root.userData.joints; if (!j) return true;
        var arc = t < 1.5 ? Math.max(0, Math.sin(t * Math.PI / 1.5)) : 0;
        j.lShoulder.rotation.x = -arc * 1.45;
        j.lElbow.rotation.x    =  arc * 0.40;
        return t >= 1.5;
    }

    // ── Seat / standing positions ─────────────────────────────
    function _seatPositions(count) {
        var t = _tbl(), positions = [], off = _tableOffset();
        if (_cfg.tableShape === 'rect') {
            var h1=Math.ceil(count/2), h2=count-h1;
            for(var i=0;i<h1;i++){
                var t2=h1>1?(i/(h1-1)-0.5):0;
                positions.push({x:t2*(t.RW*0.78),z:t.RD/2+0.72});
            }
            for(var j=0;j<h2;j++){
                var t3=h2>1?(j/(h2-1)-0.5):0;
                positions.push({x:t3*(t.RW*0.78),z:-(t.RD/2+0.72)});
            }
        } else {
            for(var k=0;k<count;k++){
                var a=-Math.PI/2+(Math.PI*2*k/count);
                positions.push({x:Math.cos(a)*(t.RR+0.72),z:Math.sin(a)*(t.RR+0.72)});
            }
        }
        // Default ring slots are relative to the table — shift by its current offset.
        // Hand-dragged chairs (_chairPos) are absolute and unaffected.
        positions.forEach(function(p){ p.x += off.x; p.z += off.z; });
        return positions;
    }

    function _standingPositions(count) {
        var positions = [];
        for (var i = 0; i < count; i++) {
            var t = count > 1 ? (i / (count - 1) - 0.5) : 0;
            positions.push({ x: t * 4.0, z: ROOM_D / 2 - 1.0 });
        }
        return positions;
    }

    function _chairTypeForIdx(idx) {
        var ct = _cfg.chairType || 'office';
        if (ct === 'random') {
            var types = ['office','gaming','beanbag','stool','throne'];
            return types[(idx * 7 + 3) % types.length];
        }
        return ct;
    }

    // Read the claim map: live in-memory state while the 3D scene is active
    // (so confirmed claims show instantly), otherwise the persisted store.
    function _readClaimsStore() {
        if (_renderer || _claimsFromServer) return _claimedChairs;
        try { var s = JSON.parse(localStorage.getItem(_roomKey()) || '{}'); return s.chairs || {}; }
        catch (e) { return {}; }
    }

    // After any change to the claim map, repaint 3D (if mounted) and 2D (always,
    // since it reads the same authoritative store).
    function _notifyClaimsChanged() {
        // Mirror into the shared store (source:'remote' — claim broadcasts to other
        // participants happen via the RoomSceneNet calls at the call sites, not via the store).
        if (window.RoomSceneStore) RoomSceneStore.set({ claims: _claimedChairs }, { source: 'remote', slice: 'claims', fields: ['claims'] });
        if (_scene) _rebuildSeating();
        if (window.RoomScene && RoomScene.render && (!_cfg || _cfg.mode !== '3d-gl')) RoomScene.render();
    }

    function _myCid() {
        return (window.ROOM_CONFIG && window.ROOM_CONFIG.connectionId) || null;
    }

    // Authoritative seating plan, shared by the 3D rebuild and the 2D / CSS-3D
    // renderer so both views place each claimed participant in the SAME chair
    // index. Mirrors the placement rules in _rebuildSeating():
    //   • chairs = max(participantCount, configured chairCount, 1), capped at 16
    //   • a chair is occupied only by the participant who CLAIMED that index
    //     (and who is currently present); all other chairs are empty
    //   • participants who haven't claimed a present chair STAND
    // Returns { chairs, seats: [{idx, participant|null, chairType, claimed}], standing }.
    function getSeatingPlan(participants, cfg) {
        participants = participants || [];
        cfg = cfg || _cfg || {};
        var count  = participants.length;
        var chairs = Math.min(Math.max(count, cfg.chairCount || count, 1), 16);

        var claims = _readClaimsStore();
        var byName = {}, byCid = {};
        participants.forEach(function (p) {
            byName[p.name || ''] = p;
            if (p.connectionId) byCid[p.connectionId] = p;
        });

        var seatedIds = {};
        var seats = [];
        for (var i = 0; i < chairs; i++) {
            var c = claims[i];
            var occupant = null;
            if (c) {
                if (c.cid && byCid.hasOwnProperty(c.cid))            occupant = byCid[c.cid];
                else if (c.name && byName.hasOwnProperty(c.name))    occupant = byName[c.name];
            }
            if (occupant) seatedIds[occupant.connectionId || occupant.name] = i;
            seats.push({ idx: i, participant: occupant, chairType: _chairTypeForIdx(i), claimed: !!occupant });
        }
        var standing = participants.filter(function (p) {
            return !seatedIds.hasOwnProperty(p.connectionId || p.name || '');
        });
        return { chairs: chairs, seats: seats, standing: standing };
    }

    // ── Participant sync ──────────────────────────────────────
    function _clearRobots() {
        // Remove chair groups first (they are tracked separately in _chairObjects, not in _robotMap).
        _chairObjects.forEach(function(c){
            if (c.group && _scene) _scene.remove(c.group);
        });
        // Remove robots, rings, labels and their DOM nodes.
        Object.keys(_robotMap).forEach(function(k){
            var r=_robotMap[k];
            ['robot','chair','ring','labelObj'].forEach(function(f){
                if(r[f]&&_scene) _scene.remove(r[f]);
            });
            if(r.label&&r.label.parentNode) r.label.parentNode.removeChild(r.label);
        });
        _robotMap = {};
        _chairObjects = [];
    }

    // ── Spatial presence: free-roam avatars ───────────────────
    function _voteState(p, rs) {
        if (!p) return 'none';
        if (p.isObserver) return 'observer';
        if (rs && rs.votesRevealed && p.vote) return 'revealed';
        if (p.hasVoted) return 'voted';
        return 'none';
    }
    function _participantByCid(cid) {
        for (var i = 0; i < _participants.length; i++) if (_participants[i].connectionId === cid) return _participants[i];
        return null;
    }
    // CID-first participant lookup with a self-by-name fallback: after a rejoin the
    // list can briefly hold only the stale same-name entry (old CID) — colour/name
    // are still correct on it, so prefer it to rendering an anonymous gray robot.
    function _participantForCid(cid) {
        var p = _participantByCid(cid);
        if (p) return p;
        if (cid && cid === _myCid()) {
            var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
            if (myName) { for (var i = 0; i < _participants.length; i++) if (_participants[i].name === myName) return _participants[i]; }
        }
        return null;
    }
    function _makeRoamer(cid) {
        var p = _participantForCid(cid);
        var rs = _roomState || {};
        var vs = _voteState(p, rs);
        var robot = _makeRobot(p ? _parseColor(p) : 0x888888, vs, false, _parseScene3d(p));
        _scene.add(robot);
        var headY = ROBOT_HEAD_Y;
        var rc = VOTE_EMI[vs] || VOTE_EMI.none;
        var ring = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.020, 8, 28),
            new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: 0.9 }));
        ring.rotation.x = Math.PI / 2; ring.visible = (vs !== 'none'); _scene.add(ring);
        var label = null, labelObj = null;
        if (p && CSS2DObject) { label = _makeLabel(p, rs, true); labelObj = new CSS2DObject(label); _scene.add(labelObj); }
        // wasGray: robot was created with no participant data → needs body rebuild in _refreshRoamers.
        return { robot: robot, ring: ring, label: label, labelObj: labelObj, headY: headY, wasGray: !p, ringStateVisible: (vs !== 'none') };
    }
    // Live position update for a roaming participant (local or remote).
    function applyAvatarMove(cid, x, z, yaw, pose) {
        if (!_scene || !cid) return;
        var r = _roamers[cid], isNew = false;
        if (!r) {
            r = _makeRoamer(cid); r.x = x; r.z = z; r.yaw = yaw || 0;
            r.robot.position.set(x, 0, z); r.robot.rotation.y = r.yaw;
            _roamers[cid] = r; isNew = true;
        }
        r.tx = x; r.tz = z; r.tyaw = (yaw || 0); r.pose = pose || 'idle';
        r.lastMove = _clock;
        if (isNew) _rebuildSeating();   // pull them out of their seat/standing slot
    }
    function clearRoamer(cid) {
        var r = _roamers[cid]; if (!r) return;
        if (_scene) { if (r.robot) _scene.remove(r.robot); if (r.ring) _scene.remove(r.ring); if (r.labelObj) _scene.remove(r.labelObj); }
        if (r.label && r.label.parentNode) r.label.parentNode.removeChild(r.label);
        delete _roamers[cid];
        // Keep _iAmRoaming in sync: if the local user's roamer is cleared for any reason
        // (server stop, seat-claim, eviction) they are no longer roaming.
        if (cid === _myCid()) _iAmRoaming = false;
        if (_scene) _rebuildSeating();
    }
    function applyAvatarStop(cid) { clearRoamer(cid); }

    // Where is my avatar right now? (roaming pos, else my claimed seat, else a default spot.)
    function _myStartPos() {
        var r = _roamers[_myCid()];
        if (r) return { x: r.x, z: r.z, yaw: r.yaw };
        if (_myChairIdx != null) {
            var chairs = Math.min(Math.max(_participants.length, _cfg.chairCount || _participants.length, 1), 16);
            var seats = _seatPositions(chairs);
            var pos = _chairPos[_myChairIdx] || seats[_myChairIdx] || { x: 0, z: ROOM_D / 2 - 1.2 };
            return { x: pos.x, z: pos.z, yaw: (pos.rot != null) ? pos.rot : Math.atan2(-pos.x, -pos.z) };
        }
        return { x: 0, z: ROOM_D / 2 - 1.2, yaw: 0 };
    }
    // ── Click-to-walk A* routing over the snap grid ───────────
    // Obstacles: walls + table (same test walk mode uses) plus furniture and interactive
    // props, so the routed glide no longer passes through the table or a sofa.
    function _routeBlockedAt(x, z) {
        if (_walkCollidesAt(x, z)) return true;
        for (var i = 0; i < _furnitureObjs.length; i++) {
            var f = _furnitureObjs[i];
            if (Math.hypot(f.group.position.x - x, f.group.position.z - z) < 0.55) return true;
        }
        for (var j = 0; j < _props.length; j++) {
            var p = _props[j]; if (!p.mesh) continue;
            var pw = new THREE.Vector3(); p.mesh.getWorldPosition(pw);
            if (Math.hypot(pw.x - x, pw.z - z) < 0.5) return true;
        }
        return false;
    }
    function _segmentClear(ax, az, bx, bz) {
        var d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / 0.15));
        for (var i = 1; i <= steps; i++) {
            var t = i / steps;
            if (_routeBlockedAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
        }
        return true;
    }
    // A* over GRID-sized cells (8-connected, no corner cutting, octile heuristic),
    // then string-pulled down to the few corner waypoints actually needed.
    function _findPath(sx, sz, gx, gz) {
        var cs = GRID, cols = Math.max(2, Math.round(ROOM_W / cs)), rows = Math.max(2, Math.round(ROOM_D / cs));
        function cx(i) { return -ROOM_W / 2 + (i + 0.5) * cs; }
        function cz(j) { return -ROOM_D / 2 + (j + 0.5) * cs; }
        function ci(x) { return Math.max(0, Math.min(cols - 1, Math.floor((x + ROOM_W / 2) / cs))); }
        function cj(z) { return Math.max(0, Math.min(rows - 1, Math.floor((z + ROOM_D / 2) / cs))); }
        var blocked = new Array(cols * rows);
        for (var j = 0; j < rows; j++) for (var i = 0; i < cols; i++) blocked[j * cols + i] = _routeBlockedAt(cx(i), cz(j));
        function nearestFree(i0, j0) {
            if (!blocked[j0 * cols + i0]) return [i0, j0];
            for (var rad = 1; rad < Math.max(cols, rows); rad++) {
                for (var dj = -rad; dj <= rad; dj++) for (var di = -rad; di <= rad; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
                    var ni = i0 + di, nj = j0 + dj;
                    if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
                    if (!blocked[nj * cols + ni]) return [ni, nj];
                }
            }
            return null;
        }
        var s = nearestFree(ci(sx), cj(sz)), g = nearestFree(ci(gx), cj(gz));
        if (!s || !g) return null;
        var open = [{ i: s[0], j: s[1], g: 0, f: 0, parent: null }];
        var bestG = {}; bestG[s[1] * cols + s[0]] = 0;
        var found = null;
        while (open.length) {
            var bi = 0;
            for (var oi = 1; oi < open.length; oi++) if (open[oi].f < open[bi].f) bi = oi;
            var cur = open.splice(bi, 1)[0];
            if (cur.i === g[0] && cur.j === g[1]) { found = cur; break; }
            for (var dj2 = -1; dj2 <= 1; dj2++) for (var di2 = -1; di2 <= 1; di2++) {
                if (!di2 && !dj2) continue;
                var ni2 = cur.i + di2, nj2 = cur.j + dj2;
                if (ni2 < 0 || nj2 < 0 || ni2 >= cols || nj2 >= rows) continue;
                if (blocked[nj2 * cols + ni2]) continue;
                if (di2 && dj2 && (blocked[cur.j * cols + ni2] || blocked[nj2 * cols + cur.i])) continue;
                var ng = cur.g + ((di2 && dj2) ? 1.4142 : 1);
                var keyN = nj2 * cols + ni2;
                if (bestG[keyN] !== undefined && bestG[keyN] <= ng) continue;
                bestG[keyN] = ng;
                var dx = Math.abs(ni2 - g[0]), dz = Math.abs(nj2 - g[1]);
                open.push({ i: ni2, j: nj2, g: ng, f: ng + (dx + dz) + (1.4142 - 2) * Math.min(dx, dz), parent: cur });
            }
        }
        if (!found) return null;
        var cells = [];
        for (var n = found; n; n = n.parent) cells.unshift({ x: cx(n.i), z: cz(n.j) });
        var path = [], a = { x: sx, z: sz }, idx = 0;
        while (idx < cells.length) {
            var far = idx;
            for (var k2 = cells.length - 1; k2 > idx; k2--) {
                if (_segmentClear(a.x, a.z, cells[k2].x, cells[k2].z)) { far = k2; break; }
            }
            a = cells[far]; path.push(a);
            idx = far + 1;
        }
        return path;
    }

    // Click-to-walk: route my avatar to a floor point along the A* path; each waypoint is
    // broadcast as it becomes the active target so peers walk the same route.
    function _startWalkTo(x, z) {
        if (!_scene) return;
        var m = 0.30;
        x = Math.max(-ROOM_W/2+m, Math.min(ROOM_W/2-m, x));
        z = Math.max(-ROOM_D/2+m, Math.min(ROOM_D/2-m, z));
        var start = _myStartPos();
        if (!_roamers[_myCid()]) applyAvatarMove(_myCid(), start.x, start.z, start.yaw, 'walk');
        var r = _roamers[_myCid()];
        if (!r) return;
        var path = _findPath(r.x, r.z, x, z) || [{ x: x, z: z }];
        // Finish on the exact click point when it's directly reachable from the last cell.
        var last = path[path.length - 1];
        if (!_routeBlockedAt(x, z) && _segmentClear(last.x, last.z, x, z)) path.push({ x: x, z: z });
        var first = path.shift() || { x: x, z: z };
        r.path = path;
        r.tx = first.x; r.tz = first.z;
        r.tyaw = Math.atan2(first.x - r.x, first.z - r.z);
        _iAmRoaming = true; _walkToActive = true;
        if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(first.x, first.z, r.tyaw, 'walk');
    }
    // Seed/clear roamers from a RoomState snapshot (late join / reconnect). Skips self.
    function _seedRoamersFromParticipants() {
        var my = _myCid();
        var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
        _participants.forEach(function (p) {
            if (!p.connectionId || p.connectionId === my) return;
            // A reload leaves a stale same-name entry (old CID, possibly pose='walk') on the
            // server until its disconnect is processed — never seed a phantom "me" from it.
            if (myName && p.name === myName) return;
            var roaming = (p.pose === 'walk' || p.pose === 'idle') && p.posX != null && p.posZ != null;
            if (roaming && !_roamers[p.connectionId]) applyAvatarMove(p.connectionId, p.posX, p.posZ, p.yaw || 0, p.pose);
            else if (!roaming && _roamers[p.connectionId]) clearRoamer(p.connectionId);
        });
    }
    // Refresh roamer colour/label when votes or names change.
    function _refreshRoamers() {
        var rs = _roomState || {};
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid], p = _participantForCid(cid);
            if (!r) return;

            // Roamer was created before the participant was in the list (wasGray = true).
            // Now that the participant is available, rebuild the robot body and label with the
            // correct colour so it stops being gray.
            if (r.wasGray && p && _scene) {
                if (r.robot) _scene.remove(r.robot);
                var vs2 = _voteState(p, rs);
                r.robot = _makeRobot(_parseColor(p), vs2, false, _parseScene3d(p));
                r.robot.position.set(r.x || 0, 0, r.z || 0);
                r.robot.rotation.y = r.yaw || 0;
                _scene.add(r.robot);
                // Build label now that we know who this is.
                if (!r.label && CSS2DObject) {
                    r.label = _makeLabel(p, rs, true);
                    r.labelObj = new CSS2DObject(r.label);
                    _scene.add(r.labelObj);
                }
                delete r.wasGray;
            }

            if (!p) return;
            var vs = _voteState(p, rs), rc = VOTE_EMI[vs] || VOTE_EMI.none;
            if (r.ring && r.ring.material) { r.ring.material.color.setHex(rc); r.ring.material.emissive.setHex(rc); }
            r.ringStateVisible = (vs !== 'none');
            if (r.label) r.label.textContent = (p.name || 'Guest') + (rs.votesRevealed && p.vote ? ' · ' + p.vote : '');
        });
    }
    function _updateRoamers(dt) {
        var k = Math.min(1, dt * 8), my = _myCid();
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid]; if (!r.robot) return;
            if (cid === my && _walkToActive && r.path) {
                // Routed click-to-walk: constant walking speed toward the active waypoint
                // (the proportional lerp below would crawl into corners between waypoints).
                var ddx = r.tx - r.x, ddz = r.tz - r.z, dd = Math.hypot(ddx, ddz);
                if (dd > 1e-4) {
                    var stepLen = Math.min(_walkSpeed() * dt, dd);
                    r.x += ddx / dd * stepLen; r.z += ddz / dd * stepLen;
                }
            } else {
                r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k;
            }
            var dy = r.tyaw - r.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
            r.yaw += dy * k;
            r.robot.position.set(r.x, 0, r.z); r.robot.rotation.y = r.yaw;
            if (r.ring) r.ring.position.set(r.x, r.headY, r.z);
            if (r.labelObj) r.labelObj.position.set(r.x, r.headY + 0.22, r.z);
            // Hide self-avatar in first-person (camera = avatar); show it in third-person.
            var inFirstPerson = _walk && (!_cfg || _cfg.walkCameraMode !== 'third');
            var vis = !(cid === my && inFirstPerson);
            r.robot.visible = vis; if (r.ring) r.ring.visible = vis && r.ringStateVisible; if (r.labelObj) r.labelObj.visible = vis;
            // Away-dim: fade the name tag of avatars idle for a while.
            if (r.label) r.label.style.opacity = ((_clock - (r.lastMove || 0)) > 45) ? '0.5' : '1';
        });
        // Click-to-walk: advance to the next routed waypoint, or settle to idle at the end.
        if (_walkToActive) {
            var me = _roamers[my];
            if (!me) { _walkToActive = false; }
            else if (Math.hypot(me.tx - me.x, me.tz - me.z) < 0.1) {
                if (me.path && me.path.length) {
                    var nxt = me.path.shift();
                    me.tx = nxt.x; me.tz = nxt.z;
                    me.tyaw = Math.atan2(nxt.x - me.x, nxt.z - me.z);
                    if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(nxt.x, nxt.z, me.tyaw, 'walk');
                } else {
                    _walkToActive = false;
                    me.path = null;
                    if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(me.tx, me.tz, me.tyaw, 'idle');
                }
            }
        }
    }

    // Kumospace-style WASD/arrow steering in the 2D top-down view (P7). Mirrors
    // _updateWalk's movement/collision/broadcast pattern, but moves a roamer entry
    // (no first-person camera) using screen-relative axes (ortho up = world -z).
    function _updateTopSteer(dt) {
        var my = _myCid();
        if (_myChairIdx !== null) {   // seated: must stand up before steering
            if (_topSteerActive) {
                _topSteerActive = false;
                var seated = _roamers[my];
                if (seated && window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(seated.tx, seated.tz, seated.tyaw, 'idle');
            }
            return;
        }
        var kb = _keyBinds();
        var fwd = 0, strafe = 0;
        if (_keys[kb.forward]) fwd    += 1;
        if (_keys[kb.back])    fwd    -= 1;
        if (_keys[kb.right])   strafe += 1;
        if (_keys[kb.left])    strafe -= 1;

        if (fwd === 0 && strafe === 0) {
            if (_topSteerActive) {
                _topSteerActive = false;
                var r0 = _roamers[my];
                if (r0 && window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(r0.tx, r0.tz, r0.tyaw, 'idle');
            }
            return;
        }

        // Steering takes over from any active click-to-walk path.
        _walkToActive = false;
        if (!_roamers[my]) {
            var start = _myStartPos();
            applyAvatarMove(my, start.x, start.z, start.yaw, 'walk');
        }
        var r = _roamers[my];
        if (!r || !r.robot) return;
        r.path = null;

        var dx = strafe, dz = -fwd;   // screen-relative: right = +x, up = -z
        var len = Math.hypot(dx, dz);
        if (len > 1) { dx /= len; dz /= len; }
        var speed = _walkSpeed() * dt;
        dx *= speed; dz *= speed;

        // Sliding collision: try full move, then each axis separately.
        var nx = r.x + dx, nz = r.z + dz;
        if (!_routeBlockedAt(nx, nz))        { r.x = nx; r.z = nz; }
        else if (!_routeBlockedAt(nx, r.z))  { r.x = nx; }
        else if (!_routeBlockedAt(r.x, nz))  { r.z = nz; }
        var c = _clampRoom(r.x, r.z, 0.30);
        r.x = c.x; r.z = c.z;
        r.yaw = Math.atan2(dx, dz);   // robot facing convention (matches _startWalkTo)
        // Keep targets in lockstep so _updateRoamers' lerp doesn't fight our direct move.
        r.tx = r.x; r.tz = r.z; r.tyaw = r.yaw;

        _iAmRoaming = true; _topSteerActive = true;

        // Broadcast my position so everyone sees me roam (throttled, ~10Hz).
        _roamSend += dt;
        if (_roamSend >= 0.1) {
            _roamSend = 0;
            if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(r.x, r.z, r.yaw, 'walk');
            r.lastMove = _clock;
        }
    }

    // P10: 2D top-down camera auto-follow (Kumospace-style). When zoomed in, gently keep my
    // avatar in frame; a manual pan suspends following until my avatar moves again.
    function _updateTopFollow(dt) {
        if (!_orthoCam || !_controls) return;
        if (_orthoCam.zoom <= 1.15) {
            _topFollow.suspended = false;
            _topFollow.lastX = null; _topFollow.lastZ = null;
            return;
        }
        var pos = _myStartPos();
        if (_topFollow.lastX !== null) {
            var moved = Math.hypot(pos.x - _topFollow.lastX, pos.z - _topFollow.lastZ);
            if (moved > 0.05) _topFollow.suspended = false;
        }
        _topFollow.lastX = pos.x; _topFollow.lastZ = pos.z;
        if (_topFollow.suspended) return;

        // Visible half-extent at the current zoom (frustum half-size / zoom).
        var visHalfW = _orthoCam.right / _orthoCam.zoom;
        var visHalfH = _orthoCam.top / _orthoCam.zoom;
        var maxX = Math.max(0, ROOM_W / 2 - visHalfW);
        var maxZ = Math.max(0, ROOM_D / 2 - visHalfH);
        var tx = Math.max(-maxX, Math.min(maxX, pos.x));
        var tz = Math.max(-maxZ, Math.min(maxZ, pos.z));

        var k = Math.min(1, dt * 4);
        _controls.target.x += (tx - _controls.target.x) * k;
        _controls.target.z += (tz - _controls.target.z) * k;
        _camera.position.x += (tx - _camera.position.x) * k;
        _camera.position.z += (tz - _camera.position.z) * k;
        _controls.update();
    }

    // ── Spatial emotes (floating reactions over avatars) ──────
    function _avatarHeadPos(cid) {
        var r = _roamers[cid]; if (r && r.robot) return { x: r.x, y: r.headY + 0.25, z: r.z };
        var s = _robotMap[cid]; if (s && s.robot) return { x: s.robot.position.x, y: SEAT_H + 0.95, z: s.robot.position.z };
        var st = _robotMap['stand_' + cid]; if (st && st.robot) return { x: st.robot.position.x, y: 1.35, z: st.robot.position.z };
        return null;
    }
    function showEmote(cid, emoji) {
        if (!_scene || !CSS2DObject || !emoji) return;
        var pos = _avatarHeadPos(cid); if (!pos) return;
        var div = document.createElement('div');
        div.className = 'rs3d-emote';
        div.textContent = emoji;
        div.style.cssText = 'font-size:1.7rem;pointer-events:none;will-change:opacity;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));';
        var obj = new CSS2DObject(div);
        obj.position.set(pos.x, pos.y, pos.z);
        _scene.add(obj);
        _emotes.push({ obj: obj, div: div, t: 0, dur: 1.6, baseY: pos.y });
    }
    // Click-to-walk auto-sit: when my avatar stops near an empty chair, sit automatically.
    // Disabled in first/third-person walk mode — in walk mode, sitting requires E key interact.
    function _tryAutoSit(dt) {
        if (_walk) { _stillTime = 0; return; }   // walk mode: E key only
        if (!_iAmRoaming) { _stillTime = 0; return; }
        var me = _roamers[_myCid()]; if (!me) { _stillTime = 0; return; }
        if (_walkToActive || _topSteerActive) { _stillTime = 0; return; }
        _stillTime += dt;
        if (_stillTime < 0.35) return;        // brief dwell so we don't sit while passing through
        var best = null, bestD = 0.5;
        for (var i = 0; i < _chairObjects.length; i++) {
            var c = _chairObjects[i];
            if (_claimedChairs[c.idx]) continue;   // only empty chairs
            var d = Math.hypot(c.group.position.x - me.x, c.group.position.z - me.z);
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best) { _stillTime = 0; _pendingChairIdx = best.idx; _confirmClaim(); }
    }

    // ── Minimap (overhead positions of everyone) ──────────────
    function _createMinimap() {
        var c = document.createElement('canvas');
        c.id = 'rs3d-minimap'; c.width = 140; c.height = 112;
        c.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:12;width:140px;height:112px;' +
            'background:rgba(18,22,34,0.78);border:1px solid rgba(120,140,210,0.4);border-radius:8px;';
        c.title = 'Room minimap';
        _container.appendChild(c);
        _miniCanvas = c; _miniCtx = c.getContext('2d');
    }
    function _participantPos(cid) {
        var r = _roamers[cid]; if (r) return { x: r.x, z: r.z };
        var s = _robotMap[cid]; if (s && s.robot) return { x: s.robot.position.x, z: s.robot.position.z };
        var st = _robotMap['stand_' + cid]; if (st && st.robot) return { x: st.robot.position.x, z: st.robot.position.z };
        return null;
    }
    function _drawMinimap() {
        if (!_miniCtx) return;
        var W = 140, H = 112, ctx = _miniCtx, my = _myCid();
        function mx(x) { return (x + ROOM_W / 2) / ROOM_W * W; }
        function mz(z) { return (z + ROOM_D / 2) / ROOM_D * H; }
        ctx.clearRect(0, 0, W, H);
        // table footprint
        ctx.fillStyle = 'rgba(150,110,70,0.45)';
        if (_cfg.tableShape === 'rect') {
            var t = _tbl(); ctx.fillRect(mx(-t.RW / 2), mz(-t.RD / 2), (t.RW / ROOM_W) * W, (t.RD / ROOM_D) * H);
        } else {
            ctx.beginPath(); ctx.arc(mx(0), mz(0), 13, 0, Math.PI * 2); ctx.fill();
        }
        // empty chairs (faint)
        ctx.fillStyle = 'rgba(120,150,255,0.5)';
        _chairObjects.forEach(function (c) {
            if (_claimedChairs[c.idx]) return;
            ctx.beginPath(); ctx.arc(mx(c.group.position.x), mz(c.group.position.z), 2, 0, Math.PI * 2); ctx.fill();
        });
        // people
        _participants.forEach(function (p) {
            var pos = _participantPos(p.connectionId); if (!pos) return;
            var col = '#' + ('000000' + (_parseColor(p) >>> 0).toString(16)).slice(-6);
            ctx.beginPath(); ctx.arc(mx(pos.x), mz(pos.z), 3.6, 0, Math.PI * 2);
            ctx.fillStyle = col; ctx.fill();
            if (p.connectionId === my) { ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke(); }
        });
    }

    function _updateEmotes(dt) {
        for (var i = _emotes.length - 1; i >= 0; i--) {
            var e = _emotes[i]; e.t += dt;
            e.obj.position.y = e.baseY + e.t * 0.55;
            e.div.style.opacity = Math.max(0, 1 - e.t / e.dur);
            if (e.t >= e.dur) {
                _scene.remove(e.obj);
                if (e.div.parentNode) e.div.parentNode.removeChild(e.div);
                _emotes.splice(i, 1);
            }
        }
    }

    function _rebuildSeating() {
        if (!_scene) return;
        // Belt-and-suspenders: if the local user has a claimed seat and is NOT actively walking,
        // remove any stale roamer keyed to their CID. This covers the case where _iAmRoaming
        // got cleared (or was never set) but a roamer mesh still lingers in _roamers —
        // without this, pRoaming would be truthy and the seated robot would never be drawn.
        if (_myChairIdx !== null && !_walk && !_iAmRoaming) {
            var _sc = _myCid();
            if (_sc && _roamers[_sc]) {
                var _sr = _roamers[_sc];
                if (_sr.robot)    _scene.remove(_sr.robot);
                if (_sr.ring)     _scene.remove(_sr.ring);
                if (_sr.labelObj) _scene.remove(_sr.labelObj);
                if (_sr.label && _sr.label.parentNode) _sr.label.parentNode.removeChild(_sr.label);
                delete _roamers[_sc];
            }
        }
        _clearRobots();
        var rs    = _roomState || {};
        var count = _participants.length;
        var chairs = Math.max(count, _cfg.chairCount || count, 1);
        chairs = Math.min(chairs, 16);

        var seats = _seatPositions(chairs);

        var byName = {}, byCid = {};
        _participants.forEach(function(p){
            byName[p.name || ''] = p;
            if (p.connectionId) byCid[p.connectionId] = p;
        });
        function _claimOccupant(c){
            if (!c) return null;
            if (c.cid && byCid.hasOwnProperty(c.cid))         return byCid[c.cid];
            if (c.name && byName.hasOwnProperty(c.name))      return byName[c.name];
            return null;
        }

        // seatedIds tracks which participants are drawn as seated (keyed by both CID and name).
        // Using both keys prevents any mismatch when the claim was stored under one identity
        // but _participants has the person under another (e.g. after a reconnect or CID change).
        var seatedIds = {};
        function _markSeated(occ, idx) {
            if (!occ) return;
            if (occ.connectionId) seatedIds[occ.connectionId] = idx;
            if (occ.name)        seatedIds[occ.name]         = idx;
        }
        Object.keys(_claimedChairs).forEach(function(idx){
            var occ = _claimOccupant(_claimedChairs[idx]);
            // A claimant who is roaming is drawn by the roam layer, not seated here.
            if (occ && !_roamers[occ.connectionId]) _markSeated(occ, parseInt(idx, 10));
        });

        // Place chairs + seated robots. A chair the user has dragged uses its custom
        // position from _chairPos; otherwise the default ring slot. Either way, the
        // chair faces the table's current location (P5: the table is draggable too).
        var tableOff = _tableOffset();
        for (var i = 0; i < chairs; i++) {
            var pos    = _chairPos[i] || seats[i];
            var angle  = (pos.rot != null) ? pos.rot : Math.atan2(-(pos.x - tableOff.x), -(pos.z - tableOff.z));
            var claim  = _claimedChairs[i];
            var isMyPending = (_pendingChairIdx === i);
            var unclaimed   = !claim && !isMyPending;

            var cType  = _chairTypeForIdx(i);
            var cRes   = _makeChairByType(cType, unclaimed && !isMyPending);
            var cGroup = cRes.group;
            cGroup.position.set(pos.x, 0, pos.z);
            cGroup.rotation.y = angle;
            _scene.add(cGroup);
            _chairObjects.push({ group: cGroup, seatMesh: cRes.seatMesh, idx: i });

            // Glow ring on unclaimed / pending chairs
            var glowCol = isMyPending ? 0x22c55e : (unclaimed ? 0x3366ff : null);
            if (glowCol !== null) {
                var glowRing = new THREE.Mesh(
                    new THREE.TorusGeometry(0.28, 0.025, 8, 28),
                    new THREE.MeshStandardMaterial({
                        color: glowCol, emissive: glowCol,
                        emissiveIntensity: unclaimed ? 0.8 : 1.5
                    })
                );
                glowRing.position.set(pos.x, SEAT_H - 0.01, pos.z);
                glowRing.rotation.x = Math.PI / 2;
                glowRing.userData.glowRing = true;
                _scene.add(glowRing);
                _robotMap['glowRing_' + i] = { robot: null, chair: null, ring: glowRing, label: null, labelObj: null };
            }

            if (!claim) continue;

            // Seated robot for claimed chair
            var p = _claimOccupant(claim);
            // Skip drawing seated robot if this participant is currently roaming.
            // Also covers the case where CID was null at enterWalk time (no roamer key, but _iAmRoaming=true).
            var pRoaming = p && (_roamers[p.connectionId] ||
                (_iAmRoaming && i === _myChairIdx));
            if (pRoaming) continue;
            // Belt-and-suspenders: skip if this participant is recorded against a DIFFERENT
            // chair (stale localStorage CID leaving two claims for the same person). seatedIds
            // is pre-populated for every claim above, so an index match means "this is their
            // chair — draw it", not a duplicate.
            if (p && p.connectionId && seatedIds.hasOwnProperty(p.connectionId) && seatedIds[p.connectionId] !== i) continue;
            if (p && p.name        && seatedIds.hasOwnProperty(p.name)         && seatedIds[p.name]         !== i) continue;
            if (!p) {
                var ghost = _makeRobot(claim.color || 0x444444, 'none', true);
                ghost.position.set(pos.x, 0, pos.z);
                ghost.rotation.y = angle;
                _scene.add(ghost);
                _robotMap['ghost_' + i] = { robot: ghost, chair: null, ring: null, label: null, labelObj: null, seated: true, phase: i * 0.9 };
                continue;
            }

            var vs = 'none';
            if (p.isObserver)                   vs = 'observer';
            else if (rs.votesRevealed && p.vote) vs = 'revealed';
            else if (p.hasVoted)                 vs = 'voted';

            var robot = _makeRobot(_parseColor(p), vs, true, _parseScene3d(p));
            robot.position.set(pos.x, 0, pos.z);
            robot.rotation.y = angle;
            _scene.add(robot);

            var headY = SEAT_H + 0.22 + 0.38 + 0.11;   // hips + neck_y + head_offset
            var rc    = VOTE_EMI[vs] || VOTE_EMI.none;
            var ring  = new THREE.Mesh(
                new THREE.TorusGeometry(0.175, 0.020, 8, 28),
                new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: 0.9 })
            );
            ring.position.set(pos.x, headY, pos.z);
            ring.rotation.x = Math.PI / 2;
            ring.visible = (vs !== 'none');
            _scene.add(ring);

            var label = _makeLabel(p, rs);
            var labelObj = null;
            if (CSS2DObject) {
                labelObj = new CSS2DObject(label);
                labelObj.position.set(pos.x, headY + 0.22, pos.z);
                _scene.add(labelObj);
            }
            _robotMap[p.connectionId || String(i)] = {
                robot: robot, chair: null, ring: ring,
                label: label, labelObj: labelObj,
                seated: true, phase: i * 0.9, armRaiseT: -1
            };
            // Keep seatedIds up to date using both identity forms so the unseated filter
            // cannot produce a duplicate standing robot for the same person.
            _markSeated(p, i);
        }

        // Standing robots (roamers are drawn by the roam layer, not here).
        // Guard: exclude any participant already drawn as seated (checked by both CID and name
        // to be resilient against CID/name mismatches that can arise on reconnect).
        var unseated = _participants.filter(function(p){
            if (_roamers[p.connectionId]) return false;
            if (seatedIds.hasOwnProperty(p.connectionId)) return false;
            if (p.name && seatedIds.hasOwnProperty(p.name)) return false;
            return true;
        });
        var standPos = _standingPositions(unseated.length);
        unseated.forEach(function(p, si){
            var pos = standPos[si];
            var vs = 'none';
            if (p.isObserver)                   vs = 'observer';
            else if (rs.votesRevealed && p.vote) vs = 'revealed';
            else if (p.hasVoted)                 vs = 'voted';

            var robot = _makeRobot(_parseColor(p), vs, false, _parseScene3d(p));
            robot.position.set(pos.x, 0, pos.z);
            robot.rotation.y = Math.atan2(-pos.x, -pos.z + 0.1);
            _scene.add(robot);

            var headY = ROBOT_HEAD_Y;
            var rc    = VOTE_EMI[vs] || VOTE_EMI.none;
            var ring  = new THREE.Mesh(
                new THREE.TorusGeometry(0.175, 0.020, 8, 28),
                new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: 0.9 })
            );
            ring.position.set(pos.x, headY, pos.z);
            ring.rotation.x = Math.PI / 2;
            ring.visible = (vs !== 'none');
            _scene.add(ring);

            var label = _makeLabel(p, rs, true);
            var labelObj = null;
            if (CSS2DObject) {
                labelObj = new CSS2DObject(label);
                labelObj.position.set(pos.x, headY + 0.22, pos.z);
                _scene.add(labelObj);
            }
            _robotMap['stand_' + (p.connectionId || si)] = {
                robot: robot, chair: null, ring: ring,
                label: label, labelObj: labelObj,
                seated: false, phase: si * 1.1, armRaiseT: -1,
                standingRobotPos: pos
            };
        });
    }

    // Phase 4: label with fly-to click
    function _makeLabel(p, rs, standing) {
        var label = document.createElement('div');
        label.className = 'rs3d-label' + (standing ? ' rs3d-label-standing' : '');
        label.textContent = (p.name||'Guest') + (rs.votesRevealed&&p.vote ? ' · '+p.vote : '');
        label.style.cursor = 'pointer';
        label.style.pointerEvents = 'auto';
        label.addEventListener('click', function(e) {
            e.stopPropagation();
            flyToParticipant(p.name);
        });
        return label;
    }

    // ── Phase 4: Camera fly-to ────────────────────────────────
    function flyToParticipant(name) {
        if (!_camera || !_controls) return;
        // Find robot world position
        var targetPos = null;
        Object.keys(_robotMap).forEach(function(k) {
            if (targetPos) return;
            var r = _robotMap[k];
            if (r.robot) {
                var pName = null;
                _participants.forEach(function(p){ if (!pName && (p.connectionId === k || ('stand_' + p.connectionId) === k)) pName = p.name; });
                if (pName === name) targetPos = r.robot.position;
            }
        });
        if (!targetPos) return;

        _flyTarget = {
            startCam: _camera.position.clone(),
            endCam: new THREE.Vector3(targetPos.x + 0, targetPos.y + 1.9, targetPos.z + 2.6),
            startOrb: _controls.target.clone(),
            endOrb: new THREE.Vector3(targetPos.x, targetPos.y + 0.7, targetPos.z),
            t: 0, dur: 1.2
        };
    }

    // ── Chair claiming ────────────────────────────────────────
    function _roomKey() {
        return 'es_rs3d_claims_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default');
    }

    function _loadClaims() {
        // The server is authoritative once it has delivered claims this session;
        // never let a stale localStorage snapshot clobber the live seating.
        if (_claimsFromServer) return;
        _claimedChairs = {};
        _myChairIdx    = null;
        try {
            var saved = JSON.parse(localStorage.getItem(_roomKey()) || '{}');
            _claimedChairs = saved.chairs || {};
            var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
            if (myName) {
                Object.keys(_claimedChairs).forEach(function(idx){
                    if (_claimedChairs[idx] && _claimedChairs[idx].name === myName) {
                        _myChairIdx = parseInt(idx, 10);
                    }
                });
            }
        } catch (e) {}
    }

    function _saveClaims() {
        try { localStorage.setItem(_roomKey(), JSON.stringify({ chairs: _claimedChairs })); } catch (e) {}
    }

    function _setupInteraction() {
        // Drag handlers live on the CONTAINER in capture phase so they run BEFORE
        // OrbitControls' own canvas pointerdown. (Listeners on the *same* element fire
        // in registration order regardless of the capture flag, and OrbitControls
        // registers first — so we must intercept from an ancestor's capture phase.)
        _container.addEventListener('pointerdown',   _onPointerDown, true);
        _container.addEventListener('pointermove',   _onPointerMove, true);
        _container.addEventListener('pointerup',     _onPointerUp,   true);
        _container.addEventListener('pointercancel', _onPointerUp,   true);
        // Chair-claim click stays on the canvas (bubble phase, after orbit settles).
        _renderer.domElement.addEventListener('click', _onCanvasClick);
        // P9.2: drop the hover highlight/tooltip when the pointer leaves the canvas.
        _renderer.domElement.addEventListener('pointerleave', _clearHover);
        // Walk-mode keys registered in CAPTURE phase so they fire before any bubble-phase
        // page handler (Space=reveal-votes, Ctrl shortcuts, etc.). stopImmediatePropagation
        // inside the handler then blocks those page handlers from ever seeing the key.
        document.addEventListener('keydown', _onKeyDown, true);
        document.addEventListener('keyup',   _onKeyUp,   true);
        // Drag-to-look in walk mode (bubble phase; only acts when _walk is active).
        _renderer.domElement.addEventListener('pointerdown', _onLookDown);
        window.addEventListener('pointermove', _onLookMove);
        window.addEventListener('pointerup',   _onLookUp);
        // Pointer Lock mouse-look + canvas-scoped focus (P7).
        document.addEventListener('mousemove', _onPointerLockMove);
        document.addEventListener('pointerlockchange', _onPointerLockChange);
        _renderer.domElement.addEventListener('blur', _onCanvasBlur);
    }

    // P3: manual double-click arbiter. Single click on an interactive target only
    // selects/highlights (the hover tooltip already shows the affordance); a SECOND
    // click on the SAME target within DBLCLICK_MS performs the action. Manual (not
    // native dblclick) so double-tap on touch works and there's no listener race.
    var _lastClickKey = null, _lastClickTime = 0;
    var DBLCLICK_MS = 350;
    function _armDoubleClick(key) {
        var now = performance.now();
        if (_lastClickKey === key && (now - _lastClickTime) < DBLCLICK_MS) {
            _lastClickKey = null; _lastClickTime = 0;
            return true;
        }
        _lastClickKey = key; _lastClickTime = now;
        return false;
    }

    // P3 follow-up: double-clicking the project screen opens the Stories panel —
    // the bottom sheet on mobile, or expands it if collapsed on desktop.
    function _openStoriesPanel() {
        var panel = document.getElementById('storiesPanel');
        if (!panel) return;
        if (window.innerWidth <= 991) {
            if (window._openStoriesSheet) window._openStoriesSheet();
            else panel.classList.add('mobile-visible');
            return;
        }
        if (panel.classList.contains('collapsed') && window.toggleStoriesPanel) window.toggleStoriesPanel();
    }

    function _onCanvasClick(event) {
        if (_walk) return;   // walk mode uses E-to-interact, not click-to-claim
        // If a furniture drag just finished, suppress chair pick
        if (Input.suppressClick) { Input.suppressClick = false; return; }
        if (!_raycaster || !_camera) return;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);

        // P1: a click on someone ELSE's robot body must not fall through to the chair
        // or floor behind it. Clicking your own seated robot acts like clicking your
        // own chair (double-click to stand up). Your own standing/roaming body never
        // blocks your clicks — the click passes through to whatever is behind it.
        var av = _raycastAvatarAt();
        if (av) {
            if (av.mine) {
                if (av.seated) {
                    if (_armDoubleClick('avatar_mine')) releaseMySeat();
                    return;
                }
                // own roamer/standing robot: fall through
            } else {
                if (av.name) {
                    var ap = new THREE.Vector3();
                    av.group.getWorldPosition(ap);
                    _showHoverTip('🤖 ' + av.name, ap.x, _avatarTipY(av), ap.z);
                }
                return;
            }
        }

        // Double-click the in-room whiteboard → open it to draw.
        if (_wbBoard && _raycaster.intersectObject(_wbBoard, false).length) {
            if (_armDoubleClick('wb') && window.Whiteboard) Whiteboard.open();
            return;
        }
        // Double-click an interactive prop (confetti / jukebox).
        var pm = _propMeshes();
        if (pm.length) {
            var ph = _raycaster.intersectObjects(pm, false);
            if (ph.length) {
                var pr = _propForMesh(ph[0].object);
                if (pr) { if (_armDoubleClick('prop_' + pr.action)) _runProp(pr.action); return; }
            }
        }
        // Project screen: double-click opens the Stories panel; main table has no
        // click action (drag-only) — absorb single clicks so they don't fall through
        // to floor click-to-walk.
        if (_screenMesh && _raycaster.intersectObject(_screenMesh, false).length) {
            if (_armDoubleClick('screen')) _openStoriesPanel();
            return;
        }
        if (_tableGroup && _raycaster.intersectObject(_tableGroup, true).length) return;
        if (!_chairObjects.length) return;

        // Double-click your own claimed chair to stand up (release seat).
        if (_myChairIdx !== null) {
            var myMesh = null;
            for (var mi = 0; mi < _chairObjects.length; mi++) {
                if (_chairObjects[mi].idx === _myChairIdx) { myMesh = _chairObjects[mi].seatMesh; break; }
            }
            if (myMesh) {
                var myHit = _raycaster.intersectObject(myMesh, false);
                if (myHit.length) {
                    if (_armDoubleClick('chair_mine')) releaseMySeat();
                    return;
                }
            }
        }

        var testMeshes = _chairObjects
            .filter(function(c){ return !_claimedChairs[c.idx]; })
            .map(function(c){ return c.seatMesh; });

        var hits = _raycaster.intersectObjects(testMeshes, false);
        if (hits.length > 0) {
            var hitMesh = hits[0].object;
            var chairObj = null;
            for (var i = 0; i < _chairObjects.length; i++) {
                if (_chairObjects[i].seatMesh === hitMesh) { chairObj = _chairObjects[i]; break; }
            }
            if (chairObj) {
                // Double-click an empty chair → sit directly (no confirm bar).
                if (_armDoubleClick('chair_' + chairObj.idx)) { _pendingChairIdx = chairObj.idx; _confirmClaim(); }
                return;
            }
        }

        // AQ2: host double-clicking an OCCUPIED chair (someone else's) can free it.
        if (_isHost()) {
            var occMeshes = _chairObjects
                .filter(function(c){ var cl=_claimedChairs[c.idx]; return cl && cl.cid !== _myCid(); })
                .map(function(c){ return c.seatMesh; });
            var oh = occMeshes.length ? _raycaster.intersectObjects(occMeshes, false) : [];
            if (oh.length) {
                var om = oh[0].object, oc = null;
                for (var j = 0; j < _chairObjects.length; j++) if (_chairObjects[j].seatMesh === om) { oc = _chairObjects[j]; break; }
                if (oc) { if (_armDoubleClick('chair_occ_' + oc.idx)) _hostFreeSeat(oc.idx); return; }
            }
        }
        // Click-to-walk: empty floor click → glide my avatar there (only when feature is enabled).
        // Floor clicks are not part of the double-click arbiter — they fire instantly.
        if (!_walk && _clickWalkEnabled) {
            var fp = _floorIntersect(event);
            if (fp) _startWalkTo(fp.x, fp.z);
        }
    }

    function _isHost() { return !!(window.roomState && window.roomState.isHost); }

    // Host frees an occupied seat (with a confirm). Reassignment = free, then the new
    // person claims it.
    function _hostFreeSeat(idx) {
        var claim = _claimedChairs[idx];
        var who = (claim && claim.name) ? claim.name : 'this person';
        _showConfirmBar('Free ' + who + "'s seat? They'll need to pick a chair again.", function () {
            if (window.RoomSceneNet && RoomSceneNet.hostFreeChair) RoomSceneNet.hostFreeChair(idx);
            else { applyRelease(idx); }
        });
    }

    function _colorToHex(c) {
        if (c === null || c === undefined) return null;
        if (typeof c === 'string') return c;
        return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6);
    }

    function _confirmClaim() {
        if (_pendingChairIdx === null) return;
        var idx     = _pendingChairIdx;
        var myName  = (window.ROOM_CONFIG && window.ROOM_CONFIG.playerName) || 'Guest';
        var myCid   = _myCid();
        var me = null;
        for (var i = 0; i < _participants.length; i++) {
            var p = _participants[i];
            if ((myCid && p.connectionId === myCid) || (!myCid && p.name === myName)) { me = p; break; }
        }
        var colorStr = me ? _colorToHex(_parseColor(me)) : null;

        // Online: let the server arbitrate (race-safe). The pending highlight stays
        // until ChairClaimed echoes back (applyClaim) or ChairClaimFailed fires.
        if (window.RoomSceneNet && RoomSceneNet.claimChair) {
            RoomSceneNet.claimChair(idx, colorStr);
            return;
        }

        // Offline fallback (preview / no socket): claim locally.
        if (_myChairIdx !== null && _myChairIdx !== idx) delete _claimedChairs[_myChairIdx];
        _claimedChairs[idx] = { name: myName, color: colorStr, cid: myCid };
        _myChairIdx = idx;
        _pendingChairIdx = null;
        _saveClaims();
        _notifyClaimsChanged();
    }

    // ── Server-driven claim sync (called by room.js SignalR handlers) ─────
    // Replace the whole claim map from a RoomState snapshot.
    function setClaimsFromServer(arr) {
        _claimsFromServer = true;
        _claimedChairs = {};
        _myChairIdx = null;
        var myCid = _myCid();
        (arr || []).forEach(function (c) {
            _claimedChairs[c.idx] = { name: c.name, color: c.color, cid: c.connectionId };
            if (myCid && c.connectionId === myCid) _myChairIdx = c.idx;
        });
        _notifyClaimsChanged();
    }

    // A peer (or me) successfully claimed a chair.
    function applyClaim(idx, name, color, cid) {
        // A connection holds at most one chair. Evict any stale claim by the same CID *or*
        // the same name — this covers localStorage entries from a previous session where the
        // CID has changed, which would otherwise leave the person seated in two chairs.
        Object.keys(_claimedChairs).forEach(function (k) {
            var c = _claimedChairs[k]; if (!c) return;
            var ki = parseInt(k, 10); if (ki === idx) return;
            var sameCid  = cid  && c.cid  === cid;
            var sameName = name && c.name === name;
            if (sameCid || sameName) {
                if (c.cid === _myCid() || c.name === (window.ROOM_CONFIG && window.ROOM_CONFIG.playerName)) {
                    _myChairIdx = null;
                }
                delete _claimedChairs[k];
            }
        });
        _claimedChairs[idx] = { name: name, color: color, cid: cid };
        if (cid && cid === _myCid()) {
            _myChairIdx = idx;
            if (_pendingChairIdx === idx) _pendingChairIdx = null;
            // I successfully sat → stop roaming + tell the server to clear my pose.
            if (_iAmRoaming) { _iAmRoaming = false; if (window.RoomSceneNet && RoomSceneNet.avatarStop) RoomSceneNet.avatarStop(); }
        }
        // Sitting down ends roaming — remove their free-roam avatar everywhere. Also clear
        // roamers keyed under a STALE CID of the same person (pre-reload entry still in
        // _participants), which would otherwise suppress their seated robot in _rebuildSeating.
        var clearedAny = false;
        Object.keys(_roamers).forEach(function (rcid) {
            if (rcid === cid) { clearRoamer(rcid); clearedAny = true; return; }
            var rp = _participantByCid(rcid);
            if (rp && name && rp.name === name) { clearRoamer(rcid); clearedAny = true; }
        });
        if (!clearedAny) _notifyClaimsChanged();
    }

    function applyRelease(idx) {
        var c = _claimedChairs[idx];
        delete _claimedChairs[idx];
        if (c && c.cid && c.cid === _myCid()) _myChairIdx = null;
        _notifyClaimsChanged();
    }

    // A participant left — free any seat they held (server also broadcasts ChairReleased,
    // but doing it here keeps the view instant and idempotent).
    function releaseByConnection(cid) {
        var changed = false;
        Object.keys(_claimedChairs).forEach(function (k) {
            if (_claimedChairs[k] && _claimedChairs[k].cid === cid) { delete _claimedChairs[k]; changed = true; }
        });
        if (changed) {
            if (cid === _myCid()) _myChairIdx = null;
            _notifyClaimsChanged();
        }
    }

    // I lost a race for a chair.
    function claimFailed(idx, winnerName) {
        if (_pendingChairIdx === idx) _pendingChairIdx = null;
        if (_scene) _rebuildSeating();
        var msg = '😅 ' + (winnerName || 'Someone') + ' grabbed that chair first! Pick another.';
        if (window._showToastAD) window._showToastAD(msg, 'warning');
        else if (window.console) console.log(msg);
    }

    // ── Colour utilities ──────────────────────────────────────
    function _colorHex(v){if(typeof v==='number')return v;var n=parseInt(String(v).replace('#',''),16);return isNaN(n)?0x4488cc:n;}
    function _darken(h,f){return(Math.round(((h>>16)&0xff)*f)<<16)|(Math.round(((h>>8)&0xff)*f)<<8)|Math.round((h&0xff)*f);}
    // P13: parses the "||s3d:hat=...,eyes=...,tint=..." suffix appended to AvatarData
    // (avatar.js's buildScene3dSuffix). Returns defaults if absent/unparseable.
    function _parseScene3d(p) {
        var out = { hat: 'none', eyes: 'round', tint: null };
        if (!p || !p.avatarData) return out;
        var s = String(p.avatarData);
        var idx = s.indexOf('||s3d:');
        if (idx < 0) return out;
        s.substring(idx + 6).split(',').forEach(function (kv) {
            var eq = kv.indexOf('=');
            if (eq < 0) return;
            var k = kv.substring(0, eq), v = kv.substring(eq + 1);
            if (k === 'hat') out.hat = v;
            else if (k === 'eyes') out.eyes = v;
            else if (k === 'tint' && /^[0-9a-fA-F]{6}$/.test(v)) out.tint = v;
        });
        return out;
    }
    function _parseColor(p){
        // P13: explicit 3D tint override takes precedence over the avatar's own colour.
        var s3d = _parseScene3d(p);
        if (s3d.tint) { var tn = parseInt(s3d.tint, 16); if (!isNaN(tn)) return tn; }
        // Legacy field (never set by server — kept for safety).
        if(p.avatarColor){var n=parseInt(String(p.avatarColor).replace('#',''),16);if(!isNaN(n))return n;}
        // avatarData format: "initials|#rrggbb"  or  "dicebear:bottts:seed|#rrggbb"
        if(p.avatarData){var m=String(p.avatarData).match(/\|#?([0-9a-fA-F]{6})(?:\b|$)/);if(m){var cn=parseInt(m[1],16);if(!isNaN(cn))return cn;}}
        // Fallback: deterministic colour from name hash.
        var hash=0,s=String(p.name||'?');
        for(var i=0;i<s.length;i++)hash=s.charCodeAt(i)+((hash<<5)-hash);
        return _hslToHex(Math.abs(hash%360)/360,0.55,0.48);
    }
    function _hslToHex(h,s,l){var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;return(Math.round(_hue(p,q,h+1/3)*255)<<16)|(Math.round(_hue(p,q,h)*255)<<8)|Math.round(_hue(p,q,h-1/3)*255);}
    function _hue(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}

    // ── Animation ─────────────────────────────────────────────
    function _tick() {
        _animId = requestAnimationFrame(_tick);
        var now = performance.now();
        var dt  = Math.min((now - _lastTime) * 0.001, 0.1); // cap at 100ms
        _clock += dt;
        _lastTime = now;

        // ── Robot animations (idle sway, walk cycle, arm-raise) ─
        Object.keys(_robotMap).forEach(function(k){
            var r = _robotMap[k];
            if (!r.robot) return;
            var j = r.robot.userData.joints;
            var phase = r.phase || 0;

            // Antenna tip pulse (emissive material on antTip)
            if (j && j.antTip && j.antTip.material)
                j.antTip.material.emissiveIntensity = 1.0 + 0.4 * Math.sin(_clock * 1.8 + phase);

            // Vote-reveal arm raise (seated robots) — takes priority over idle
            if (r.seated && r.armRaiseT !== undefined && r.armRaiseT >= 0) {
                r.armRaiseT += dt;
                _animArmRaise(r.robot, r.armRaiseT);
                if (r.armRaiseT >= 1.5) { r.armRaiseT = -1; _poseRobotSeated(r.robot); }
                return;
            }

            // Standing robots: idle sway
            if (!r.seated) {
                _animRobotIdle(r.robot, _clock, phase);
            }
        });

        // Detect vote-reveal transition → trigger arm raise anim
        var nowRevealed = !!(_roomState && _roomState.votesRevealed);
        if (nowRevealed && !_revealWas) {
            Object.keys(_robotMap).forEach(function(k){
                var r = _robotMap[k];
                if (r.seated && r.robot) r.armRaiseT = 0;
            });
        }
        _revealWas = nowRevealed;

        // Roamer walk animation driven by each roamer's movement state
        Object.keys(_roamers).forEach(function(cid) {
            var r = _roamers[cid]; if (!r || !r.robot) return;
            var j = r.robot.userData.joints;
            if (j && j.antTip && j.antTip.material)
                j.antTip.material.emissiveIntensity = 1.0 + 0.4 * Math.sin(_clock * 1.8 + (r.phase || 0));

            r.walkPhase = (r.walkPhase || 0) + dt * (r.pose === 'walk' ? 4.2 : 0);
            if (_walk && _walk.crouch && cid === _myCid()) {
                _poseRobotCrouch(r.robot);
            } else if (!_walk && cid === _myCid()) {
                // Local player not in walk mode but still a roamer (idle from click-to-walk)
                _poseRobotWalk(r.robot, r.walkPhase, r.pose === 'walk');
            } else {
                _poseRobotWalk(r.robot, r.walkPhase, r.pose === 'walk');
            }
        });

        // Glow ring pulse on unclaimed chairs
        _scene.children.forEach(function(obj){
            if (obj.userData && obj.userData.glowRing && obj.material) {
                obj.material.emissiveIntensity = 0.5 + 0.45 * Math.sin(_clock * 2.2);
            }
        });

        // Keep the in-room whiteboard surface in sync with the shared board.
        if (_wbTex && window.Whiteboard && Whiteboard.getVersion && Whiteboard.getVersion() !== _wbVer) {
            _wbVer = Whiteboard.getVersion();
            Whiteboard.getBoardCanvas();      // re-composite into the textured canvas
            _wbTex.needsUpdate = true;
        }

        // Animated window views (drifting clouds, twinkling stars, shimmering sea, swaying
        // trees). Skipped in top-down (window is edge-on) and when motion is disabled.
        if (_winAnims.length && _view !== 'top' && _cfg.windowAnimated !== false && !_reducedMotion()) {
            for (var wi = 0; wi < _winAnims.length; wi++) {
                var a = _winAnims[wi], o = a.obj;
                if (!o) continue;
                var s = Math.sin(_clock * a.speed + a.phase);
                if (a.type === 'drift')        o.position.x = a.baseX + s * a.amp;
                else if (a.type === 'bob')     o.position.y = a.baseY + s * a.amp;
                else if (a.type === 'sway')    o.rotation.z = a.baseRot + s * a.amp;
                else if (a.type === 'twinkle' && o.material) o.material.emissiveIntensity = a.baseEmi + a.amp * Math.abs(s);
                else if (a.type === 'shimmer' && o.material) o.material.emissiveIntensity = a.baseEmi + a.amp * (0.5 + 0.5 * s);
            }
        }

        // Animated GIF window textures — decoded-frames player (no DOM element needed).
        // Advances the frame index based on each frame's delay from the GIF header.
        if (_gifTextures.length) {
            for (var gi = 0; gi < _gifTextures.length; gi++) {
                var _g = _gifTextures[gi];
                if (!_g.frames || _g.frames.length < 2) continue; // 0 or 1 frame = static
                _g.frameTime += dt * 1000; // dt seconds → frameTime ms
                // Drain accumulated time — advances multiple frames if dt was large,
                // capped at one full loop to prevent infinite spin on 0-delay GIFs.
                var _maxAdv = _g.frames.length, _advanced = false;
                while (_maxAdv-- > 0) {
                    var _gfDelay = _g.frames[_g.frameIdx].delay;
                    if (_g.frameTime < _gfDelay) break;
                    _g.frameTime -= _gfDelay;
                    _g.frameIdx = (_g.frameIdx + 1) % _g.frames.length;
                    _advanced = true;
                }
                if (_advanced) {
                    var _gfFrame = _g.frames[_g.frameIdx];
                    _g.tmpCtx.putImageData(_gfFrame.imageData, 0, 0);
                    _g.ctx.clearRect(0, 0, _g.canvas.width, _g.canvas.height);
                    _g.ctx.drawImage(_g.tmpCanvas, 0, 0, _g.gifW, _g.gifH,
                                     0, 0, _g.canvas.width, _g.canvas.height);
                    _g.tex.needsUpdate = true;
                }
            }
        }

        if (_walk) {
            // First-person mode: our controller owns the camera; skip orbit/fly-to.
            _pollGamepad(dt);     // gamepad move/look/buttons feed _updateWalk via _padMove
            if (_walk) _updateWalk(dt);   // (gamepad Start may have exited walk just now)
        } else {
            // Phase 4: camera fly-to
            if (_flyTarget && _controls) {
                _flyTarget.t = Math.min(_flyTarget.t + dt / _flyTarget.dur, 1.0);
                var ease = 1 - Math.pow(1 - _flyTarget.t, 3);
                _camera.position.lerpVectors(_flyTarget.startCam, _flyTarget.endCam, ease);
                _controls.target.lerpVectors(_flyTarget.startOrb, _flyTarget.endOrb, ease);
                if (_flyTarget.t >= 1.0) _flyTarget = null;
            }
            if (_controls) _controls.update();
            if (_view === 'top') { _updateTopSteer(dt); _updateTopFollow(dt); }
        }
        _updateRoamers(dt);
        _tryAutoSit(dt);
        _updateEmotes(dt);
        _miniAccum += dt;
        if (_miniAccum >= 0.12) { _miniAccum = 0; _drawMinimap(); }
        _renderer.render(_scene, _camera);
        if (_labelRenderer) _labelRenderer.render(_scene, _camera);
    }

    // ── Resize / dispose ──────────────────────────────────────
    function resize(w, h) {
        if (!_renderer || !w || !h) return;
        if (_perspCam) { _perspCam.aspect = w / h; _perspCam.updateProjectionMatrix(); }
        _setOrthoFrustum(w, h);
        _renderer.setSize(w, h);
        if (_labelRenderer) _labelRenderer.setSize(w, h);
    }

    function dispose() {
        if (_ro)     { _ro.disconnect(); _ro = null; }
        if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
        _clearRobots();
        _clearFurniture();
        if (_container) {
            _container.removeEventListener('pointerdown',   _onPointerDown, true);
            _container.removeEventListener('pointermove',   _onPointerMove, true);
            _container.removeEventListener('pointerup',     _onPointerUp,   true);
            _container.removeEventListener('pointercancel', _onPointerUp,   true);
        }
        document.removeEventListener('keydown', _onKeyDown, true);
        document.removeEventListener('keyup',   _onKeyUp,   true);
        if (_renderer) _renderer.domElement.removeEventListener('pointerleave', _clearHover);
        window.removeEventListener('pointermove', _onLookMove);
        window.removeEventListener('pointerup',   _onLookUp);
        document.removeEventListener('mousemove', _onPointerLockMove);
        document.removeEventListener('pointerlockchange', _onPointerLockChange);
        if (document.pointerLockElement && _renderer && document.pointerLockElement === _renderer.domElement) {
            try { document.exitPointerLock(); } catch (e) {}
        }
        _hideWalkHud();
        _hideTouchControls();
        Input.to('idle'); Input.suppressClick = false;
        if (_toolbar && _toolbar.parentNode) { _toolbar.parentNode.removeChild(_toolbar); _toolbar = null; }
        _walkBtn = null; _clickWalkBtn = null; _furnHudBtn = null;
        if (_furnHud && _furnHud.parentNode) { _furnHud.parentNode.removeChild(_furnHud); _furnHud = null; }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
        if (_miniCanvas && _miniCanvas.parentNode) { _miniCanvas.parentNode.removeChild(_miniCanvas); _miniCanvas = null; _miniCtx = null; }
        // Clean up animated GIF textures (dispose Three.js texture + remove hidden <img> from DOM).
        _gifTextures.forEach(function(g){
            if (g.tex) g.tex.dispose();
            if (g.img && g.img.parentNode) g.img.parentNode.removeChild(g.img);
        });
        _gifTextures = [];
        _videoTextures.forEach(function(v){
            v.video.pause();
            v.video.removeAttribute('src');
            v.video.load();
            if (v.video.parentNode) v.video.parentNode.removeChild(v.video);
            v.tex.dispose();
        });
        _videoTextures = [];
        _walk = null; _keys = {};
        if (Input.is('look')) Input.to('idle');
        if (_scene && _scene.environment) { _scene.environment.dispose(); }
        if (_renderer) {
            var el = _renderer.domElement;
            el.removeEventListener('click', _onCanvasClick);
            el.removeEventListener('pointerdown', _onLookDown);
            el.removeEventListener('blur', _onCanvasBlur);
            if (el.parentNode) el.parentNode.removeChild(el);
            _renderer.dispose(); _renderer = null;
        }
        if (_labelRenderer) {
            if (_labelRenderer.domElement.parentNode) _labelRenderer.domElement.parentNode.removeChild(_labelRenderer.domElement);
            _labelRenderer = null;
        }
        if (_selBar && _selBar.parentNode) { _selBar.parentNode.removeChild(_selBar); _selBar = null; }
        _sel = null; _selRing = null; _selHandle = null;
        if (_controls) { _controls.dispose(); _controls = null; }
        if (_wbTex) { _wbTex.dispose(); _wbTex = null; }
        _wbBoard = null; _wbVer = -1;
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid];
            if (r.label && r.label.parentNode) r.label.parentNode.removeChild(r.label);
        });
        _roamers = {}; _iAmRoaming = false; _walkToActive = false; _topSteerActive = false;
        _emotes.forEach(function (e) { if (e.div && e.div.parentNode) e.div.parentNode.removeChild(e.div); });
        _emotes = [];
        _disposeInteractLabel();
        _disposeHoverTip();
        _scene = null; _camera = null; _perspCam = null; _orthoCam = null; _flyTarget = null;
    }

    // ── In-place scene refresh (preserves camera + renderer) ──
    function refreshScene(newConfig) {
        if (!_scene || !_renderer) return;
        // Merge new config
        if (newConfig) Object.assign(_cfg, newConfig);
        _applyRoomSize();
        // Save furniture layout, clamping into the (possibly smaller) new room bounds
        var savedFurniture = getFurnitureLayout();
        savedFurniture.forEach(function (f) {
            var c = _clampRoom(f.x, f.z);
            f.x = c.x; f.z = c.z;
        });
        // Clean up label DOM nodes attached to CSS2DObjects
        _clearRobots();
        _disposeInteractLabel();
        _disposePropLabels();
        _disposeHoverTip();
        // Remove everything from scene (lights, room geo, table, furniture)
        while (_scene.children.length > 0) { _scene.remove(_scene.children[0]); }
        _furnitureObjs = []; // groups already removed above
        _resetSelection();   // _selRing was just removed with the scene; clear stale refs
        // Rebuild scene content (camera / renderer / controls untouched)
        _buildRoom();
        _buildTable();
        _buildLights();
        _buildFurniture(savedFurniture.length ? savedFurniture : _loadFurniture());
        _rebuildSeating();
    }

    // ── Public API ────────────────────────────────────────────
    // Remove chair claims for people no longer in the participant list.
    // Keeps the current user's own claim (they may briefly be absent during reconnect).
    function _evictStaleClaims() {
        // When the server owns the claim map, it releases seats on leave/disconnect and
        // broadcasts ChairReleased — don't second-guess it with name-based local eviction.
        if (_claimsFromServer) return;
        var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
        var present = {};
        _participants.forEach(function(p) { if (p.name) present[p.name] = true; });
        var changed = false;
        Object.keys(_claimedChairs).forEach(function(idx) {
            var c = _claimedChairs[idx];
            if (!c || !c.name) return;
            if (c.name === myName) return;         // never evict own claim
            if (!present[c.name]) {
                delete _claimedChairs[idx];
                if (_myChairIdx === parseInt(idx, 10)) _myChairIdx = null;
                changed = true;
            }
        });
        if (changed) _saveClaims();
    }

    function syncParticipants(participants, roomState) {
        _participants = (participants || []).slice(0, 16);
        if (roomState !== undefined) _roomState = roomState || null;
        _evictStaleClaims();
        // Drop roamers for participants who have left.
        Object.keys(_roamers).forEach(function (cid) {
            if (!_participantForCid(cid)) clearRoamer(cid);
        });
        if (_scene) _seedRoamersFromParticipants();
        _refreshRoamers();
        _updateStoryScreen();
        _rebuildSeating();
    }
    function syncRoom(roomState) {
        _roomState = roomState || null;
        syncParticipants((roomState && roomState.participants) || _participants, roomState);
    }
    function releaseMySeat() {
        if (_myChairIdx === null) return;
        if (window.RoomSceneNet && RoomSceneNet.releaseChair) {
            RoomSceneNet.releaseChair();   // server echoes ChairReleased → applyRelease
            return;
        }
        delete _claimedChairs[_myChairIdx];
        _myChairIdx = null;
        _saveClaims();
        _notifyClaimsChanged();
    }

    // Phase 3: furniture public API
    function addFurniture(type) {
        if (!_scene) return;
        var res = _makeFurnitureMesh(type);
        if (!res) return;
        var id = Date.now();
        var x = _snapGrid((Math.random() - 0.5) * 3);
        var z = _snapGrid((Math.random() - 0.5) * 2);
        res.group.position.set(x, 0, z);
        res.group.userData.furnitureId = id;
        res.pickMesh.userData.furnitureId = id;
        res.pickMesh.userData.isFurniture = true;
        _scene.add(res.group);
        _furnitureObjs.push({ id: id, type: type, x: x, z: z, rot: 0, group: res.group, pickMesh: res.pickMesh });
        _saveFurniture();
    }

    function removeFurniture(id) {
        for (var i = 0; i < _furnitureObjs.length; i++) {
            if (_furnitureObjs[i].id === id) {
                if (_scene) _scene.remove(_furnitureObjs[i].group);
                _furnitureObjs.splice(i, 1);
                _saveFurniture();
                return;
            }
        }
    }

    function getFurnitureLayout() {
        return _furnitureObjs.map(function(f){ return { id:f.id, type:f.type, x:f.x, z:f.z }; });
    }

    function resetFurniture() {
        _showConfirmBar('Reset furniture layout for everyone?', function () {
            _deselectAll();   // selected id may no longer exist after reset
            _buildFurniture(_defaultFurniture());
            _saveFurniture();
        });
    }

    // P8: full room reset — furniture, chair/decor position overrides, and shared design
    // config back to defaults, for everyone. Confirmation is the caller's job (the Room
    // Designer button guards with a plain confirm()). Personal fields (keyBindings,
    // walkSpeed, walkCameraMode, lookSensitivity, invertY, mode) are untouched — the config
    // patch below only sets RoomSceneStore.SHARED_FIELDS.
    function resetRoom() {
        _deselectAll();   // selected id may no longer exist after reset
        _buildFurniture(_defaultFurniture());
        _saveFurniture();

        _chairPos = {};
        _saveChairPositions(true);

        _decorPos = {};
        _saveDecorPositions(true);

        if (window.RoomScene && RoomScene.updateConfig) {
            RoomScene.updateConfig({
                preset: 'skyline', tableShape: 'round', tableSize: 'medium',
                chairType: 'office', chairCount: 0,
                floorMaterial: 'preset', wallColor: 'preset', floorColor: 'preset',
                tableMaterial: 'wood', lighting: 'normal',
                windowView: 'skyline', windowAnimated: true, windowTimeOfDay: 'day',
                windowMediaId: null, windowMediaMime: null,
                whiteboard: true, plants: true, roomSize: 'wide'
            });
        } else {
            refreshScene();
        }
    }

    window.RS3D = {
        init: init, dispose: dispose, resize: resize,
        refreshScene: refreshScene,
        syncParticipants: syncParticipants, syncRoom: syncRoom,
        getSeatingPlan: getSeatingPlan,
        releaseMySeat: releaseMySeat,
        setClaimsFromServer: setClaimsFromServer,
        applyClaim: applyClaim, applyRelease: applyRelease,
        releaseByConnection: releaseByConnection, claimFailed: claimFailed,
        applyChairPositions: applyChairPositions,
        applyDecorPositions: applyDecorPositions,
        applyAvatarMove: applyAvatarMove, applyAvatarStop: applyAvatarStop, clearRoamer: clearRoamer,
        showEmote: showEmote,
        addFurniture: addFurniture, removeFurniture: removeFurniture,
        getFurnitureLayout: getFurnitureLayout, resetFurniture: resetFurniture,
        resetRoom: resetRoom,
        toggleFurniturePanel: toggleFurniturePanel,
        applyRemoteLayout: applyRemoteLayout,
        setView: setView,
        flyToParticipant: flyToParticipant,
        // Test/debug helpers (__ prefix — not part of the public contract). Used by
        // automated UI checks to find scene objects on screen and inspect input state.
        __debug: {
            input: function () { return { mode: Input.mode, suppress: Input.suppressClick, walk: !!_walk, walkTo: _walkToActive }; },
            worldToScreen: function (x, y, z) {
                if (!_camera || !_renderer) return null;
                var v = new THREE.Vector3(x, y || 0, z).project(_camera);
                var r = _renderer.domElement.getBoundingClientRect();
                return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
            },
            chairScreenXY: function (idx) {
                for (var i = 0; i < _chairObjects.length; i++) {
                    if (_chairObjects[i].idx === idx) {
                        var p = _chairObjects[i].group.position;
                        return RS3D.__debug.worldToScreen(p.x, SEAT_H, p.z);
                    }
                }
                return null;
            },
            roamer: function (cid) {
                var r = _roamers[cid || _myCid()];
                return r ? { x: r.x, z: r.z, tx: r.tx, tz: r.tz, path: (r.path || []).length } : null;
            },
            probePress: function (x, y) {
                var hit = _raycastDraggableChairAt({ clientX: x, clientY: y });
                return { chairIdx: hit ? hit.idx : null, cam: _camera === _perspCam ? 'persp' : 'ortho', view: _view };
            },
            stepTopFollow: function (dt) {
                _updateTopFollow(dt || 0.1);
                return RS3D.__debug.topFollow();
            },
            topFollow: function () {
                return {
                    suspended: _topFollow.suspended,
                    zoom: _orthoCam ? _orthoCam.zoom : null,
                    target: _controls ? { x: _controls.target.x, z: _controls.target.z } : null,
                    cam: _camera ? { x: _camera.position.x, z: _camera.position.z } : null,
                    me: _myStartPos()
                };
            }
        }
    };

    // Consume a RoomState snapshot that arrived over SignalR before this module finished
    // loading (room.js buffers it in window._rs3dPendingState when window.RS3D is absent).
    (function () {
        var pend = window._rs3dPendingState;
        if (!pend) return;
        delete window._rs3dPendingState;
        setClaimsFromServer(pend.chairClaims || []);
        if (pend.roomLayout) applyRemoteLayout(pend.roomLayout);
        if (pend.chairPositions) applyChairPositions(pend.chairPositions);
        if (pend.decorPositions) applyDecorPositions(pend.decorPositions);
    }());

    // Auto-activate only when RoomScene isn't present to orchestrate (defensive). On the
    // room page RoomScene loads first and drives init()/setView() for every mode, so this
    // is a no-op there — avoids double-initialising the WebGL scene.
    (function(){
        if (window.RoomScene) return;
        if (!_threeReady()) return;
        var stage = document.getElementById('roomSceneStage');
        if (stage) init(stage, { mode: '3d-gl' });
    }());
