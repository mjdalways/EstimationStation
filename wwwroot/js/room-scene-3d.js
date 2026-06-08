// ============================================================
// Room Scene 3D — WebGL room (Three.js r145 UMD globals)
// Phase 2: 5 chair types · table sizes · chair claiming · standing robots
// Phase 3: movable furniture (drag on floor, persistence)
// Phase 4: idle animations · AO shadows · vote-reveal arm-raise · camera fly-to
// Loaded as plain script after three.min.js, OrbitControls.js, CSS2DRenderer.js
// Exposes window.RS3D
// ============================================================
(function () {
    'use strict';

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
    var _wbBoard = null, _wbTex = null, _wbVer = -1;   // in-room whiteboard board mesh + live texture
    var _props = [];                 // interactive props: { mesh, action }
    var _storyScreenLabel = null;    // CSS2D label on the in-room story screen
    var _applyingRemote = false;  // true while applying a peer's furniture layout (suppresses re-broadcast)

    // First-person "walk" mode. When on, OrbitControls is disabled and the camera is a
    // first-person avatar: WASD/arrows move, Space jumps, C crouches, E interacts.
    // Spatial presence: free-roam avatars keyed by connectionId (rendered as moving robots).
    var _roamers = {};      // cid -> { robot, ring, labelObj, x, z, yaw, tx, tz, tyaw, pose, headY }
    var _roamSend = 0;      // throttle accumulator for broadcasting my own position
    var _iAmRoaming = false;
    var _walkToActive = false;   // click-to-walk: gliding my avatar to a clicked floor point
    var _clickWalkEnabled = true; // click-to-walk feature toggle (user can disable via button)
    var _emotes = [];            // floating emoji over avatars (spatial reactions)
    var _stillTime = 0;          // how long my avatar has been stationary (for walk-up-and-sit)
    var _miniCanvas = null, _miniCtx = null, _miniAccum = 0;   // overhead minimap
    var _perspCam = null, _orthoCam = null;   // 3D orbit cam + 2D top-down ortho cam
    var _view    = 'persp'; // 'persp' (3D) | 'top' (2D top-down) — both view the same scene
    var _walk    = null;    // null = orbit mode; else { yaw, pitch, vy, grounded, crouch, held }
    var _keys    = {};      // event.code -> bool (currently-held movement keys)
    var _walkBtn = null;       // the on-canvas Orbit/Walk toggle button
    var _clickWalkBtn = null;  // the on-canvas click-to-walk enable/disable toggle
    var _furnHudBtn = null;    // the on-canvas "+" furniture quick-add HUD button
    var _furnHud = null;       // the furniture quick-add panel (shown on button click)
    var _look    = null;    // active drag-look: { x, y } last pointer
    var EYE_STAND = 1.60, EYE_CROUCH = 1.02, WALK_SPEED = 2.7, CROUCH_SPEED = 1.25;

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
        if (!THREE.OrbitControls || !_renderer) return;
        if (_controls) { _controls.dispose(); _controls = null; }
        _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
        _controls.enableDamping = true; _controls.dampingFactor = 0.09;
        if (_view === 'top') {
            _controls.target.set(0, 0, 0);
            _controls.enableRotate = false;
            _controls.screenSpacePanning = true;
            _controls.minZoom = 0.5; _controls.maxZoom = 4;
            if (THREE.MOUSE) _controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
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
        if (_scene) _scene.fog = (v === 'top') ? null : new THREE.FogExp2(0x18202c, 0.042);
        // Walk + fly-to are 3D-only; hide the walk button + minimap in top-down (redundant).
        var topHide = (v === 'top') ? 'none' : '';
        if (_walkBtn)      _walkBtn.style.display = topHide;
        if (_clickWalkBtn) _clickWalkBtn.style.display = topHide;
        if (_furnHudBtn)   _furnHudBtn.style.display = topHide;
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
    var _claimBar        = null;
    var _raycaster       = null;
    // True once the server has delivered the authoritative claim map this session,
    // so 2D (which reads via getSeatingPlan) trusts _claimedChairs even when the
    // WebGL scene isn't mounted. Falls back to localStorage only when offline.
    var _claimsFromServer = false;
    // Per-chair position overrides (idx -> {x,z}) when a chair has been dragged from its
    // default ring slot. Shared across the room and synced like the furniture layout.
    var _chairPos  = {};
    var _chairDrag = null;   // active chair drag { idx, group, offsetX, offsetZ, pointerId, moved }

    // Phase 3: Furniture
    var _furnitureObjs         = [];   // { id, type, x, z, group, pickMesh }
    var _furnitureDrag         = null; // active drag state
    var _suppressNextChairClick = false;
    var _selectedFurnId        = null; // currently selected furniture id (select modes)
    var _selRing               = null; // highlight ring under selected item
    var _selBar                = null; // selected-item control overlay (delete / deselect)
    var _hoverCursor           = '';   // current canvas cursor

    // Phase 4: animations / camera
    var _flyTarget  = null;  // { startCam, endCam, startOrb, endOrb, t, dur }
    var _revealWas  = false; // previous votesRevealed state — detect transition

    function _threeReady() { return !!(window.THREE && THREE.WebGLRenderer); }

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

        var W = _container.clientWidth  || 400;
        var H = _container.clientHeight || 300;

        _renderer = new THREE.WebGLRenderer({ antialias: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.shadowMap.enabled = true;
        _renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        _renderer.outputEncoding    = THREE.sRGBEncoding;
        _renderer.toneMapping       = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;
        _container.appendChild(_renderer.domElement);

        if (THREE.CSS2DRenderer) {
            _labelRenderer = new THREE.CSS2DRenderer();
            _labelRenderer.setSize(W, H);
            var s = _labelRenderer.domElement.style;
            s.position = 'absolute'; s.top = '0'; s.left = '0';
            s.pointerEvents = 'none'; s.overflow = 'hidden';
            _container.appendChild(_labelRenderer.domElement);
        }

        _scene = new THREE.Scene();
        _scene.background = new THREE.Color(0x18202c);
        _scene.fog = new THREE.FogExp2(0x18202c, 0.042);

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
        _buildRoom();
        _buildTable();
        _buildLights();
        _buildFurniture(_loadFurniture());
        _setupInteraction();
        _createClaimBar();
        _createSelBar();
        _createWalkButton();
        _createMinimap();

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
        wood:     { color: 0x8a5a32, rough: 0.60 },
        carpet:   { color: 0x556070, rough: 0.97 },
        tile:     { color: 0xcfd6dd, rough: 0.25, metal: 0.10 },
        concrete: { color: 0x8d9095, rough: 0.90 }
    };
    function _floorMat(pal) {
        var m = FLOOR_MATS[_cfg.floorMaterial];
        if (!m) return _stdMat(pal.floor);          // 'preset' or unset → palette colour
        return new THREE.MeshStandardMaterial({ color: m.color, roughness: m.rough, metalness: m.metal || 0 });
    }
    function _wallColor(pal) {
        return (_cfg.wallColor && _cfg.wallColor !== 'preset') ? _cfg.wallColor : pal.wall;
    }
    function _tableTopMat() {
        switch (_cfg.tableMaterial) {
            case 'glass':  return new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.5 });
            case 'marble': return new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.25, metalness: 0.10 });
            default:       return new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.58, metalness: 0.04 }); // wood
        }
    }
    function _lightCfg() {
        switch (_cfg.lighting) {
            case 'warm': return { amb:0xffe7c2, ambI:0.42, spot:0xffdca8, spotI:2.0, fill:0xffb060, fillI:0.25 };
            case 'cool': return { amb:0xdce9ff, ambI:0.42, spot:0xe8f0ff, spotI:2.0, fill:0x88aaff, fillI:0.40 };
            case 'neon': return { amb:0xff66ff, ambI:0.30, spot:0x66ffff, spotI:1.8, fill:0xff44aa, fillI:0.55 };
            default:     return { amb:0xffffff, ambI:0.40, spot:0xfff9ee, spotI:2.0, fill:0x88aaff, fillI:0.35 };
        }
    }

    // ── Room geometry ─────────────────────────────────────────
    function _buildRoom() {
        var pal = PAL[_cfg.preset] || PAL.conference;
        _winAnims = [];   // dropped meshes from any previous build are no longer animated

        var wallCol = _wallColor(pal);

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

    // The back wall IS a floor-to-ceiling window spanning its full width. The outdoor
    // scene lives BEHIND the wall plane (more negative z); the old bug was an opaque
    // wallB plane in front of it that hid everything. Here there's no opaque centre —
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

        if (view === 'custom' && _cfg.windowImage) {
            // 🎨 Custom view: the uploaded image (or GIF first frame) fills the opening.
            var tex = new THREE.TextureLoader().load(_cfg.windowImage, function () {
                if (_renderer) _renderer.render(_scene, _camera);   // repaint once the image decodes
            });
            if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
            var img = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH),
                new THREE.MeshBasicMaterial({ map: tex }));
            img.position.set(0, cy, zb); _scene.add(img);
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
        g.rotation.y = Math.PI / 2;
        g.position.set(-ROOM_W / 2 + 0.06, 1.45, -0.6);

        if (_wbTex) { _wbTex.dispose(); }
        _wbTex = null; _wbVer = -1;
        var boardMat;
        if (window.Whiteboard && Whiteboard.getBoardCanvas) {
            try {
                _wbTex = new THREE.CanvasTexture(Whiteboard.getBoardCanvas());
                if (THREE.sRGBEncoding) _wbTex.encoding = THREE.sRGBEncoding;
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
        if (THREE.CSS2DObject) {
            var d = document.createElement('div');
            d.textContent = emoji; d.style.cssText = 'font-size:1.3rem;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));';
            var lo = new THREE.CSS2DObject(d); lo.position.set(0, 0.98, 0); g.add(lo);
        }
        return { group: g, pick: pick };
    }
    function _buildProps() {
        _props = [];
        _storyScreenLabel = null;

        // Story screen on the RIGHT wall (faces into the room).
        var sg = new THREE.Group();
        sg.position.set(ROOM_W / 2 - 0.05, 1.6, 0.6); sg.rotation.y = -Math.PI / 2;
        var frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.45 }));
        sg.add(frame);
        var screen = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.94),
            new THREE.MeshStandardMaterial({ color: 0x0e2138, emissive: 0x12365e, emissiveIntensity: 0.5, roughness: 0.3 }));
        screen.position.z = 0.04; sg.add(screen);
        _scene.add(sg);
        if (THREE.CSS2DObject) {
            var d = document.createElement('div');
            d.className = 'rs3d-screen-label';
            d.style.cssText = 'color:#dcebff;color:#cfe3ff;font:600 13px sans-serif;text-align:center;width:160px;' +
                'text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.25;';
            _storyScreenLabel = d;
            var lo = new THREE.CSS2DObject(d);
            lo.position.set(ROOM_W / 2 - 0.16, 1.6, 0.6);
            _scene.add(lo);
        }
        _updateStoryScreen();

        // Confetti + music props (clickable / E-interact).
        var conf = _makeEmojiProp('🎉', 0xff4fa3);
        conf.group.position.set(ROOM_W / 2 - 0.9, 0, -ROOM_D / 2 + 0.9);
        _scene.add(conf.group);
        _props.push({ mesh: conf.pick, action: 'confetti' });

        var juke = _makeEmojiProp('🎵', 0x6b8cff);
        juke.group.position.set(-ROOM_W / 2 + 0.9, 0, ROOM_D / 2 - 0.9);
        _scene.add(juke.group);
        _props.push({ mesh: juke.pick, action: 'music' });
    }
    function _propMeshes() { return _props.filter(function (p) { return p.mesh && p.action; }).map(function (p) { return p.mesh; }); }
    function _propForMesh(m) { for (var i = 0; i < _props.length; i++) if (_props[i].mesh === m) return _props[i]; return null; }
    function _runProp(action) {
        if (action === 'confetti') { if (window._rsRoomConfetti) _rsRoomConfetti(); }
        else if (action === 'music') { if (window._rsRoomSound) _rsRoomSound('fanfare'); }
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

    function _buildTable() {
        var t = _tbl();
        var mat = _tableTopMat();
        var lm  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.45, metalness: 0.75 });
        if (_cfg.tableShape === 'rect') {
            var top = new THREE.Mesh(new THREE.BoxGeometry(t.RW, 0.07, t.RD), mat);
            top.position.y = TBL_TOP; top.castShadow = true; _scene.add(top);
            [[-t.RW/2+0.12,-t.RD/2+0.12],[t.RW/2-0.12,-t.RD/2+0.12],
             [-t.RW/2+0.12, t.RD/2-0.12],[t.RW/2-0.12, t.RD/2-0.12]].forEach(function(p){
                var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,TBL_TOP,8),lm);
                leg.position.set(p[0],TBL_TOP/2,p[1]); _scene.add(leg);
            });
        } else {
            var top2 = new THREE.Mesh(new THREE.CylinderGeometry(t.RR,t.RR,0.07,36),mat);
            top2.position.y = TBL_TOP; top2.castShadow = true; _scene.add(top2);
            var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.19,TBL_TOP,8),lm);
            ped.position.y = TBL_TOP/2; _scene.add(ped);
        }
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
        var json;
        try {
            var data = _furnitureObjs.map(function(f){ return { id:f.id, type:f.type, x:f.x, z:f.z }; });
            json = JSON.stringify(data);
            localStorage.setItem(_furnitureKey(), json);
        } catch (e) {}
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
        _applyingRemote = true;
        try {
            try { localStorage.setItem(_furnitureKey(), JSON.stringify(layout)); } catch (e) {}
            if (_scene) {
                _deselectFurniture();
                _selectedFurnId = null;
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
            res.group.position.set(item.x, 0, item.z);
            res.group.userData.furnitureId = id;
            res.pickMesh.userData.furnitureId = id;
            res.pickMesh.userData.isFurniture = true;
            _scene.add(res.group);
            _furnitureObjs.push({ id: id, type: item.type, x: item.x, z: item.z, group: res.group, pickMesh: res.pickMesh });
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
        var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.28,0.12,8),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.06; g.add(pick);
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
        var pick = new THREE.Mesh(new THREE.BoxGeometry(0.40,1.80,0.40),
            new THREE.MeshBasicMaterial({visible:false}));
        pick.position.y = 0.90; g.add(pick);
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
        pick.position.y = 0.95; g.add(pick);
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
        var pick = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.30, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.65; g.add(pick);
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
    function _clampRoom(x, z) {
        return {
            x: Math.max(-ROOM_W/2 + 0.5, Math.min(ROOM_W/2 - 0.5, x)),
            z: Math.max(-ROOM_D/2 + 0.5, Math.min(ROOM_D/2 - 0.5, z))
        };
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
        var fid = hits[0].object.userData.furnitureId;
        for (var i = 0; i < _furnitureObjs.length; i++) {
            if (_furnitureObjs[i].id === fid) return _furnitureObjs[i];
        }
        return null;
    }

    // ── Chair dragging (own + empty chairs) ──────────────────
    function _chairPosKey() { return 'es_rs3d_chairpos_' + ((window.ROOM_CONFIG && window.ROOM_CONFIG.roomName) || 'default'); }
    function _loadChairPositions() {
        try { var s = JSON.parse(localStorage.getItem(_chairPosKey()) || '{}'); if (s && typeof s === 'object') _chairPos = s; } catch (e) { _chairPos = {}; }
    }
    function _saveChairPositions(broadcast) {
        var json;
        try { json = JSON.stringify(_chairPos); localStorage.setItem(_chairPosKey(), json); } catch (e) {}
        if (broadcast !== false && json && window.RoomSceneNet && RoomSceneNet.setChairPositions) RoomSceneNet.setChairPositions(json);
    }
    // From the server (peer drag) / RoomState snapshot.
    function applyChairPositions(json) {
        var obj; try { obj = (typeof json === 'string') ? JSON.parse(json) : json; } catch (e) { return; }
        _chairPos = (obj && typeof obj === 'object') ? obj : {};
        try { localStorage.setItem(_chairPosKey(), JSON.stringify(_chairPos)); } catch (e) {}
        if (_scene) _rebuildSeating();
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
        _chairDrag = {
            idx: chairObj.idx, group: chairObj.group,
            offsetX: chairObj.group.position.x - floorPt.x,
            offsetZ: chairObj.group.position.z - floorPt.z,
            pointerId: event.pointerId, moved: false
        };
        // NOTE: don't suppress the claim click yet — a no-move press should still claim an
        // empty chair. _onPointerMove sets _suppressNextChairClick once a drag actually starts.
        if (_controls) _controls.enabled = false;
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        try { _renderer.domElement.setPointerCapture(event.pointerId); } catch (e) {}
        return true;
    }

    function _beginDrag(found, event) {
        var floorPt = _floorIntersect(event);
        if (!floorPt) return false;
        _furnitureDrag = {
            item: found,
            offsetX: found.x - floorPt.x,
            offsetZ: found.z - floorPt.z,
            pointerId: event.pointerId,
            moved: false
        };
        _suppressNextChairClick = true;
        if (_controls) _controls.enabled = false;
        // Stop OrbitControls (canvas listener) from ever seeing this pointerdown,
        // and capture the pointer so moves/up keep coming to us.
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        try { _renderer.domElement.setPointerCapture(event.pointerId); } catch (e) {}
        return true;
    }

    // Three drag models, chosen by _cfg.dragMode:
    //   'direct'       — drag an item to move it; empty/Shift+drag orbits.
    //   'select'       — single-click selects; drag the selected item to move; empty deselects+orbits.
    //   'doubleselect' — double-click selects; drag the selected item to move; otherwise orbit.
    // Shift+drag ALWAYS orbits in every mode (escape hatch when an item blocks the view).
    function _onPointerDown(event) {
        if (_walk) return;                          // walk mode: drag = look, handled elsewhere
        if (event.button !== undefined && event.button !== 0) return;
        if (event.shiftKey) return;                 // Shift → let OrbitControls orbit
        // Chair drag (own or empty chairs) takes precedence. A no-move press still lets the
        // click-to-claim fire; only actual movement commits a reposition.
        var dchair = _raycastDraggableChairAt(event);
        if (dchair) { _beginChairDrag(dchair, event); return; }
        if (!_furnitureObjs.length) return;
        var mode  = _cfg.dragMode || 'select';
        var found = _raycastFurnitureAt(event);

        if (mode === 'direct') {
            if (found) _beginDrag(found, event);    // miss → fall through to orbit
            return;
        }

        // select / doubleselect
        if (found && found.id === _selectedFurnId) {
            _beginDrag(found, event);               // drag the already-selected item
            return;
        }
        if (mode === 'select' && found) {
            _selectFurniture(found.id);             // first click selects (no move, no orbit)
            _suppressNextChairClick = true;
            event.stopPropagation();
            if (event.preventDefault) event.preventDefault();
            return;
        }
        // doubleselect + unselected item, OR empty space → deselect (if needed) and orbit
        if (!found && _selectedFurnId !== null) _deselectFurniture();
        // not consumed → OrbitControls orbits
    }

    function _onPointerMove(event) {
        if (_walk) return;
        if (_chairDrag) {
            if (event.pointerId !== undefined && _chairDrag.pointerId !== undefined && event.pointerId !== _chairDrag.pointerId) return;
            var cfp = _floorIntersect(event); if (!cfp) return;
            var c = _clampRoom(cfp.x + _chairDrag.offsetX, cfp.z + _chairDrag.offsetZ);
            _chairDrag.group.position.x = c.x; _chairDrag.group.position.z = c.z;
            // Carry the seated robot + ring + label with my own chair.
            var claim = _claimedChairs[_chairDrag.idx];
            if (claim && claim.cid === _myCid() && _robotMap[claim.cid]) {
                var r = _robotMap[claim.cid];
                ['robot', 'ring', 'labelObj'].forEach(function (k) { if (r[k]) { r[k].position.x = c.x; r[k].position.z = c.z; } });
            }
            _chairDrag.moved = true; _suppressNextChairClick = true;
            event.stopPropagation();
            return;
        }
        if (!_furnitureDrag) {
            // Hover affordance: "move" cursor over a draggable item (skip while Shift-orbiting)
            if (_furnitureObjs.length && !event.shiftKey) {
                var over = _raycastFurnitureAt(event);
                var want = over ? 'move' : '';
                if (want !== _hoverCursor) {
                    _hoverCursor = want;
                    if (_renderer) _renderer.domElement.style.cursor = want;
                }
            }
            return;
        }
        if (_furnitureDrag.pointerId !== undefined && event.pointerId !== _furnitureDrag.pointerId) return;
        var floorPt = _floorIntersect(event);
        if (!floorPt) return;
        var clamped = _clampRoom(floorPt.x + _furnitureDrag.offsetX, floorPt.z + _furnitureDrag.offsetZ);
        var nx = _snapGrid(clamped.x);
        var nz = _snapGrid(clamped.z);
        if (nx !== _furnitureDrag.item.x || nz !== _furnitureDrag.item.z) _furnitureDrag.moved = true;
        _furnitureDrag.item.x = nx;
        _furnitureDrag.item.z = nz;
        _furnitureDrag.item.group.position.set(nx, 0, nz);
        _updateSelRing();
        event.stopPropagation();
    }

    function _onPointerUp(event) {
        if (_chairDrag) {
            if (event && _chairDrag.pointerId !== undefined && event.pointerId !== _chairDrag.pointerId) return;
            var cd = _chairDrag; _chairDrag = null;
            try { if (event) _renderer.domElement.releasePointerCapture(event.pointerId); } catch (e) {}
            if (_controls) _controls.enabled = true;
            if (cd.moved) {
                _chairPos[cd.idx] = { x: cd.group.position.x, z: cd.group.position.z };
                _saveChairPositions(true);
                _rebuildSeating();
            }
            return;
        }
        if (!_furnitureDrag) return;
        if (event && _furnitureDrag.pointerId !== undefined && event.pointerId !== _furnitureDrag.pointerId) return;
        if (_furnitureDrag.moved) _saveFurniture();
        try { if (event) _renderer.domElement.releasePointerCapture(event.pointerId); } catch (e) {}
        _furnitureDrag = null;
        if (_controls) _controls.enabled = true;
    }

    function _onDblClick(event) {
        if (_walk) return;
        if ((_cfg.dragMode || 'select') !== 'doubleselect') return;
        var found = _raycastFurnitureAt(event);
        if (found) { _selectFurniture(found.id); event.stopPropagation(); }
        else       { _deselectFurniture(); }
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
            if (code === 'Escape')   { _toggleWalk(); return; }
            // Any other key in walk mode: prevent bubbling to page shortcuts
            event.stopImmediatePropagation();
            return;
        }

        // Orbit-mode furniture shortcuts (unchanged).
        if (_selectedFurnId === null) return;
        if (event.key === 'Escape') { _deselectFurniture(); }
        else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); _deleteSelected(); }
    }

    function _onKeyUp(event) {
        if (!_walk) return;
        var kb = _keyBinds();
        if (_isMoveCode(event.code, kb)) { _keys[event.code] = false; }
        if (event.code === kb.crouch)    { _walk.crouch = false; }
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
        var BTN_BASE = 'position:absolute;z-index:12;background:rgba(20,24,40,0.9);color:#e8eaf6;' +
            'border:1px solid rgba(120,140,210,0.4);border-radius:7px;padding:4px 9px;cursor:pointer;' +
            'font-size:0.74rem;backdrop-filter:blur(6px);';

        // Walk / Orbit toggle (top-right)
        var b = document.createElement('button');
        b.id = 'rs3d-walk-btn'; b.type = 'button';
        b.style.cssText = BTN_BASE + 'top:8px;right:8px;';
        var kb = _keyBinds();
        b.title = 'Walk around in first/third person (' + _keyHint(kb.walk) + ')';
        b.textContent = '🚶 Walk';
        b.onclick = _toggleWalk;

        // Small hint label under the Walk button so users know T enters walk mode.
        var hint = document.createElement('div');
        hint.id = 'rs3d-walk-hint';
        hint.style.cssText = 'position:absolute;top:34px;right:8px;z-index:12;font-size:0.60rem;' +
            'color:rgba(200,210,240,0.7);text-align:right;pointer-events:none;white-space:nowrap;';
        hint.textContent = 'Press ' + _keyHint(kb.walk) + ' to walk';

        if (_view === 'top') { b.style.display = 'none'; hint.style.display = 'none'; }
        _container.appendChild(b);
        _container.appendChild(hint);
        _walkBtn = b;

        // Click-to-walk toggle (below walk button)
        var ctw = document.createElement('button');
        ctw.id = 'rs3d-ctw-btn'; ctw.type = 'button';
        ctw.style.cssText = BTN_BASE + 'top:50px;right:8px;';
        ctw.title = 'Toggle click-to-walk (click floor to glide your avatar there)';
        ctw.textContent = '🖱️ Click-walk';
        ctw.onclick = function() {
            _clickWalkEnabled = !_clickWalkEnabled;
            ctw.style.background = _clickWalkEnabled ? 'rgba(20,24,40,0.9)' : 'rgba(80,20,20,0.88)';
            ctw.title = _clickWalkEnabled ? 'Click-to-walk ON — click floor to move avatar' : 'Click-to-walk OFF — click won\'t move avatar';
        };
        if (_view === 'top') ctw.style.display = 'none';
        _container.appendChild(ctw);
        _clickWalkBtn = ctw;

        // Furniture quick-add button "+" (bottom-right corner)
        var fhb = document.createElement('button');
        fhb.id = 'rs3d-furn-btn'; fhb.type = 'button';
        fhb.style.cssText = BTN_BASE + 'bottom:8px;right:8px;padding:4px 10px;font-size:0.80rem;';
        fhb.title = 'Add room furniture';
        fhb.textContent = '+ Furniture';
        fhb.onclick = function(e) { e.stopPropagation(); _toggleFurnHud(); };
        _container.appendChild(fhb);
        _furnHudBtn = fhb;

        // Furniture quick-add panel (hidden by default)
        var fhud = document.createElement('div');
        fhud.id = 'rs3d-furn-hud';
        fhud.style.cssText = 'position:absolute;bottom:36px;right:8px;z-index:13;display:none;' +
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

    function _showWalkHud() {
        if (document.getElementById('rs3d-walk-hud')) return;
        var kb = _keyBinds();
        var thirdPerson = (_cfg && _cfg.walkCameraMode === 'third');
        var hud = document.createElement('div');
        hud.id = 'rs3d-walk-hud';
        hud.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:12;' +
            'background:rgba(20,24,40,0.86);color:#cdd6f4;border:1px solid rgba(120,140,210,0.35);' +
            'border-radius:8px;padding:5px 12px;font-size:0.70rem;backdrop-filter:blur(6px);white-space:nowrap;';
        hud.textContent = _keyHint(kb.forward) + _keyHint(kb.left) + _keyHint(kb.back) + _keyHint(kb.right) +
            ' move · ' + _keyHint(kb.jump) + ' jump · ' + _keyHint(kb.crouch) + ' crouch · ' +
            _keyHint(kb.interact) + ' interact · drag to look · Esc exit' +
            (thirdPerson ? ' · 3rd person' : ' · 1st person');
        _container.appendChild(hud);
    }
    function _hideWalkHud() {
        var hud = document.getElementById('rs3d-walk-hud');
        if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    }

    function _toggleWalk() { if (_walk) _exitWalk(); else _enterWalk(); }

    function _enterWalk() {
        if (!_camera || _view === 'top') return;   // walk mode is 3D-only
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
            _walkBtn.textContent = thirdPerson ? '🎥 3rd · Orbit' : '🎥 1st · Orbit';
            _walkBtn.style.background = 'rgba(34,197,94,0.85)';
        }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint) hint.style.display = 'none';
        if (_clickWalkBtn) _clickWalkBtn.style.display = 'none';
        if (_furnHudBtn)   _furnHudBtn.style.display = 'none';
        if (_furnHud)      _furnHud.style.display = 'none';
        _showWalkHud();
        // Become a roamer: tell everyone where I am, and spawn my own avatar locally.
        _iAmRoaming = true; _roamSend = 1;
        if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(px, pz, yaw, 'walk');
        applyAvatarMove(_myCid(), px, pz, yaw, 'walk');
    }

    function _exitWalk() {
        if (_walk && _walk.held != null) { _saveFurniture(); }   // drop carried item where it is
        var px = _walk ? _walk.wx : (_camera ? _camera.position.x : 0);
        var pz = _walk ? _walk.wz : (_camera ? _camera.position.z : 0);
        var yaw = _walk ? _walk.yaw : 0;
        _walk = null; _keys = {}; _look = null;
        if (_controls) { _controls.enabled = true; _controls.target.set(0, TBL_TOP, 0); _controls.update(); }
        if (_walkBtn) { _walkBtn.textContent = '🚶 Walk'; _walkBtn.style.background = 'rgba(20,24,40,0.9)'; }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint) hint.style.display = '';
        if (_clickWalkBtn) _clickWalkBtn.style.display = '';
        if (_furnHudBtn)   _furnHudBtn.style.display = '';
        _hideWalkHud();
        // Stay where I stopped, now idle (still a roamer so my avatar stays visible to all).
        if (_iAmRoaming) {
            if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(px, pz, yaw, 'idle');
            applyAvatarMove(_myCid(), px, pz, yaw, 'idle');
        }
    }

    // Drag-to-look (active only in walk mode).
    function _onLookDown(e) { if (_walk) _look = { x: e.clientX, y: e.clientY }; }
    function _onLookMove(e) {
        if (!_walk || !_look) return;
        var dx = e.clientX - _look.x, dy = e.clientY - _look.y;
        _look.x = e.clientX; _look.y = e.clientY;
        _walk.yaw  += dx * 0.005;
        _walk.pitch = Math.max(-1.2, Math.min(1.2, _walk.pitch - dy * 0.005));
    }
    function _onLookUp() { _look = null; }

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
        if (_cfg.tableShape === 'round') {
            if (Math.hypot(nx, nz) < t.RR + 0.45) return true;
        } else {
            var tw = t.RW / 2 + 0.38, td = t.RD / 2 + 0.38;
            if (nx > -tw && nx < tw && nz > -td && nz < td) return true;
        }
        return false;
    }

    function _updateWalk(dt) {
        var kb = _keyBinds();
        var fwd = 0, strafe = 0;
        if (_keys[kb.forward])  fwd    += 1;
        if (_keys[kb.back])     fwd    -= 1;
        if (_keys[kb.right])    strafe += 1;
        if (_keys[kb.left])     strafe -= 1;

        var speed = (_walk.crouch ? CROUCH_SPEED : WALK_SPEED) * dt;
        var sy = Math.sin(_walk.yaw), cyw = Math.cos(_walk.yaw);
        var dx = sy * fwd + cyw * strafe;
        var dz = -cyw * fwd + sy * strafe;
        var len = Math.hypot(dx, dz);
        if (len > 0) { dx = dx / len * speed; dz = dz / len * speed; }

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
            if (window.RoomSceneNet && RoomSceneNet.avatarMove)
                RoomSceneNet.avatarMove(_walk.wx, _walk.wz, _walk.yaw, 'walk');
            applyAvatarMove(_myCid(), _walk.wx, _walk.wz, _walk.yaw, 'walk');
        }
    }

    // E key: drop a carried item, or sit/stand at the chair ahead, or pick up furniture.
    // Each interaction type uses its own proximity-limited ray to avoid cross-room false triggers.
    function _walkInteract() {
        if (_walk.held != null) { _saveFurniture(); _walk.held = null; return; }
        if (!_raycaster || !_camera) return;
        // In third-person mode use avatar position + yaw for the ray (not camera position behind avatar).
        var thirdPerson = (_cfg && _cfg.walkCameraMode === 'third');
        var rayOrigin, dir;
        if (thirdPerson) {
            rayOrigin = new THREE.Vector3(_walk.wx, 1.1, _walk.wz);
            dir = new THREE.Vector3(Math.sin(_walk.yaw), 0, -Math.cos(_walk.yaw)).normalize();
        } else {
            rayOrigin = _camera.position.clone();
            dir = new THREE.Vector3(); _camera.getWorldDirection(dir);
        }
        _raycaster.set(rayOrigin, dir);

        // ── Whiteboard (left wall) — only interact when within 2 m of the board ──
        if (_wbBoard) {
            var wbPos = new THREE.Vector3();
            _wbBoard.getWorldPosition(wbPos);
            var wbDist = Math.hypot(_walk.wx - wbPos.x, _walk.wz - wbPos.z);
            if (wbDist < 2.2) {
                _raycaster.far = 2.2;
                if (_raycaster.intersectObject(_wbBoard, true).length) {
                    _raycaster.far = Infinity;
                    if (window.Whiteboard) Whiteboard.open();
                    return;
                }
            }
        }

        // ── Props (confetti / jukebox) — short range ──
        var pms = _propMeshes();
        if (pms.length) {
            _raycaster.far = 2.5;
            var phit = _raycaster.intersectObjects(pms, true);
            if (phit.length) {
                var hit = phit[0].object, prp = null;
                while (hit && !prp) { prp = _propForMesh(hit); hit = hit.parent; }
                if (prp) { _runProp(prp.action); _raycaster.far = Infinity; return; }
            }
        }

        // ── Chairs — must be adjacent ──
        var chairMeshes = _chairObjects.map(function (c) { return c.seatMesh; });
        _raycaster.far = 1.9;
        var ch = chairMeshes.length ? _raycaster.intersectObjects(chairMeshes, true) : [];
        if (ch.length) {
            var hitMesh = ch[0].object, chairObj = null;
            for (var i = 0; i < _chairObjects.length; i++) {
                if (_chairObjects[i].seatMesh === hitMesh) { chairObj = _chairObjects[i]; break; }
            }
            if (chairObj) {
                var idx = chairObj.idx, claim = _claimedChairs[idx];
                if (claim && claim.cid === _myCid()) { releaseMySeat(); }
                else if (!claim) { _pendingChairIdx = idx; _confirmClaim(); }   // direct claim, no bar
                _raycaster.far = Infinity;
                return;
            }
        }
        var pickMeshes = _furnitureObjs.map(function (f) { return f.pickMesh; });
        var fr = pickMeshes.length ? _raycaster.intersectObjects(pickMeshes, true) : [];
        if (fr.length) {
            var id = fr[0].object.userData.furnitureId;
            if (id != null) { _walk.held = id; _deselectFurniture(); }
        }
        _raycaster.far = Infinity;
    }

    // ── Selection highlight + control bar ─────────────────────
    function _selectedFurn() {
        for (var i = 0; i < _furnitureObjs.length; i++) {
            if (_furnitureObjs[i].id === _selectedFurnId) return _furnitureObjs[i];
        }
        return null;
    }
    function _updateSelRing() {
        var f = _selectedFurn();
        if (f && _selRing) _selRing.position.set(f.x, 0.02, f.z);
    }
    function _selectFurniture(id) {
        _selectedFurnId = id;
        if (!_selRing && _scene) {
            _selRing = new THREE.Mesh(
                new THREE.TorusGeometry(0.45, 0.03, 8, 32),
                new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.0 })
            );
            _selRing.rotation.x = Math.PI / 2;
            _selRing.userData.selRing = true;
            _scene.add(_selRing);
        }
        if (_selRing) _selRing.visible = true;
        _updateSelRing();
        _showSelBar();
    }
    function _deselectFurniture() {
        _selectedFurnId = null;
        if (_selRing) _selRing.visible = false;
        if (_selBar) _selBar.style.display = 'none';
        _hoverCursor = ''; if (_renderer) _renderer.domElement.style.cursor = '';
    }
    function _deleteSelected() {
        if (_selectedFurnId === null) return;
        removeFurniture(_selectedFurnId);
        _deselectFurniture();
    }
    function _resetSelection() {
        if (_selRing && _scene) { try { _scene.remove(_selRing); } catch (e) {} }
        _selRing = null;
        _selectedFurnId = null;
        if (_selBar) _selBar.style.display = 'none';
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
            '<button id="rs3d-sel-del" style="background:#dc3545;color:#fff;border:none;' +
            'border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:700;">✕ Delete</button>' +
            '<button id="rs3d-sel-done" style="background:transparent;color:#aaa;' +
            'border:1px solid #555;border-radius:5px;padding:3px 8px;cursor:pointer;">Done</button>';
        _container.appendChild(bar);
        bar.querySelector('#rs3d-sel-del').onclick  = _deleteSelected;
        bar.querySelector('#rs3d-sel-done').onclick = _deselectFurniture;
        _selBar = bar;
    }
    function _showSelBar() {
        if (!_selBar) return;
        var f = _selectedFurn();
        var nameEl = _selBar.querySelector('#rs3d-sel-name');
        if (nameEl && f) {
            var icons = { plant:'🌿', coffee_table:'☕', projector:'📽️', whiteboard:'📋' };
            nameEl.textContent = (icons[f.type] || '📦') + ' ' + String(f.type).replace('_',' ') + ' — drag to move';
        }
        _selBar.style.display = 'flex';
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
        seat.position.y = SEAT_H; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.50,0.055), sm);
        back.position.set(0, SEAT_H+0.285, -0.20); g.add(back);
        var col = new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.032,SEAT_H-0.04,6), lm);
        col.position.y = SEAT_H/2; g.add(col);
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.065,0.025,8), lm);
        hub.position.y = 0.012; g.add(hub);
        for (var i=0;i<5;i++){
            var a=(i/5)*Math.PI*2;
            var sp=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.022,0.044),lm);
            sp.rotation.y=a; sp.position.set(Math.cos(a)*0.10,0.011,Math.sin(a)*0.10); g.add(sp);
        }
        return { group: g, seatMesh: seat };
    }

    function _makeGamingChair(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x1a0a22 : 0x0d0d1e, roughness: 0.65 });
        var ac = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.5, metalness: 0.3 });
        var lm = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.07,0.46), sm);
        seat.position.y = SEAT_H; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.68,0.07), sm);
        back.position.set(0,SEAT_H+0.37,-0.19); g.add(back);
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
        g.add(body);
        return { group: g, seatMesh: body };
    }

    function _makeStool(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x5a3a10 : 0x8a5a20, roughness: 0.75 });
        var lm = new THREE.MeshStandardMaterial({ color: 0x5a4020, roughness: 0.8, metalness: 0.1 });
        var seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.06,12), sm);
        seat.position.y = SEAT_H; g.add(seat);
        [[0.13,0.13],[-0.13,0.13],[0.13,-0.13],[-0.13,-0.13]].forEach(function(p){
            var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.025,SEAT_H-0.04,6),lm);
            leg.position.set(p[0],SEAT_H/2,p[1]);
            leg.rotation.z=(p[0]>0?-1:1)*0.08;
            leg.rotation.x=(p[1]>0?-1:1)*0.08;
            g.add(leg);
        });
        var ring=new THREE.Mesh(new THREE.TorusGeometry(0.17,0.015,6,16),lm);
        ring.position.y=SEAT_H*0.38; ring.rotation.x=Math.PI/2; g.add(ring);
        return { group: g, seatMesh: seat };
    }

    function _makeThrone(unclaimed) {
        var g = new THREE.Group();
        var sm = new THREE.MeshStandardMaterial({ color: unclaimed ? 0x3a1a5a : 0x5a1a9a, roughness: 0.6 });
        var gm = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.52,0.08,0.50), sm);
        seat.position.y = SEAT_H; g.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.50,0.82,0.07), sm);
        back.position.set(0,SEAT_H+0.43,-0.21); g.add(back);
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

    function _makeRobot(color, voteState, seated) {
        var root  = new THREE.Group();
        var base  = _colorHex(color);
        var dark  = _darken(base, 0.58);
        var eyeC  = voteState==='revealed' ? 0x22ff88 : voteState==='voted' ? 0xffcc00 : 0x00ddff;

        var bm  = new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, metalness: 0.32 });
        var lm  = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.22 });
        var em  = new THREE.MeshStandardMaterial({ color: eyeC, emissive: eyeC, emissiveIntensity: 1.4, roughness: 0.05 });
        var jm  = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.7,  metalness: 0.4 }); // joint balls

        // Helper: cylinder along local Y
        function cyl(rt, rb, h, seg, mat) {
            return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 7), mat);
        }
        function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
        function sph(r, mat) { return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat); }

        var hipY = seated ? SEAT_H + 0.22 : ROBOT_HIP_Y;

        // ── Hips group (pivot for legs + spine) ──
        var hips = new THREE.Group(); hips.position.y = hipY; root.add(hips);

        // ── Spine / torso ──
        var torsoMesh = box(0.29, 0.36, 0.20, bm);
        torsoMesh.position.y = 0.18; torsoMesh.castShadow = true; hips.add(torsoMesh);

        // ── Neck + head ──
        var neck = new THREE.Group(); neck.position.y = 0.38; hips.add(neck);
        var headMesh = box(0.23, 0.22, 0.19, bm);
        headMesh.position.y = 0.11; neck.add(headMesh);
        // Eyes
        [-0.058, 0.058].forEach(function(ex) {
            var eye = sph(0.034, em); eye.position.set(ex, 0.12, 0.092); neck.add(eye);
        });
        // Antenna
        var ant = cyl(0.008, 0.008, 0.12, 5, lm); ant.position.y = 0.29; neck.add(ant);
        var antTip = sph(0.022, em); antTip.position.y = 0.35; neck.add(antTip);

        // ── Arms ──
        function buildArm(side) {
            var sg = new THREE.Group();
            sg.position.set(side * 0.185, 0.34, 0); hips.add(sg);
            // Upper arm
            var ua = cyl(0.040, 0.034, 0.26, 7, lm); ua.position.y = -0.13; sg.add(ua);
            var jball = sph(0.044, jm); sg.add(jball);  // shoulder joint ball
            // Elbow pivot
            var eg = new THREE.Group(); eg.position.y = -0.26; sg.add(eg);
            var fa = cyl(0.032, 0.026, 0.22, 7, lm); fa.position.y = -0.11; eg.add(fa);
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
            var thigh = cyl(0.060, 0.052, 0.36, 7, lm); thigh.position.y = -0.18; hg.add(thigh);
            var hj = sph(0.060, jm); hg.add(hj); // hip joint ball
            // Knee pivot
            var kg = new THREE.Group(); kg.position.y = -0.36; hg.add(kg);
            var shin = cyl(0.050, 0.042, 0.28, 7, lm); shin.position.y = -0.14; kg.add(shin);
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
        j.lHip.rotation.x   =  Math.PI / 2;   // thigh forward
        j.rHip.rotation.x   =  Math.PI / 2;
        j.lKnee.rotation.x  = -Math.PI / 2;   // shin straight down
        j.rKnee.rotation.x  = -Math.PI / 2;
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
        j.lHip.rotation.x  =  0.65;
        j.rHip.rotation.x  =  0.65;
        j.lKnee.rotation.x = -1.10;
        j.rKnee.rotation.x = -1.10;
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
        var t = _tbl(), positions = [];
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
    function _makeRoamer(cid) {
        var p = _participantByCid(cid);
        // Fallback: local user before CID is in participant list → match by player name so we get their real colour.
        if (!p && cid && cid === _myCid()) {
            var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
            if (myName) { for (var _i = 0; _i < _participants.length; _i++) { if (_participants[_i].name === myName) { p = _participants[_i]; break; } } }
        }
        var rs = _roomState || {};
        var vs = _voteState(p, rs);
        var robot = _makeRobot(p ? _parseColor(p) : 0x888888, vs, false);
        _scene.add(robot);
        var headY = ROBOT_HEAD_Y;
        var rc = VOTE_EMI[vs] || VOTE_EMI.none;
        var ring = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.020, 8, 28),
            new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: 0.9 }));
        ring.rotation.x = Math.PI / 2; _scene.add(ring);
        var label = null, labelObj = null;
        if (p && THREE.CSS2DObject) { label = _makeLabel(p, rs, true); labelObj = new THREE.CSS2DObject(label); _scene.add(labelObj); }
        return { robot: robot, ring: ring, label: label, labelObj: labelObj, headY: headY };
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
            return { x: pos.x, z: pos.z, yaw: Math.atan2(-pos.x, -pos.z) };
        }
        return { x: 0, z: ROOM_D / 2 - 1.2, yaw: 0 };
    }
    // Click-to-walk: glide my avatar to a floor point and broadcast it (others lerp too).
    function _startWalkTo(x, z) {
        if (!_scene) return;
        var m = 0.30;
        x = Math.max(-ROOM_W/2+m, Math.min(ROOM_W/2-m, x));
        z = Math.max(-ROOM_D/2+m, Math.min(ROOM_D/2-m, z));
        var start = _myStartPos();
        var yaw = Math.atan2(x - start.x, z - start.z);   // face travel direction
        if (!_roamers[_myCid()]) applyAvatarMove(_myCid(), start.x, start.z, start.yaw, 'walk');
        var r = _roamers[_myCid()];
        if (!r) return;
        r.tx = x; r.tz = z; r.tyaw = yaw;
        _iAmRoaming = true; _walkToActive = true;
        if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(x, z, yaw, 'walk');
    }
    // Seed/clear roamers from a RoomState snapshot (late join / reconnect). Skips self.
    function _seedRoamersFromParticipants() {
        var my = _myCid();
        _participants.forEach(function (p) {
            if (!p.connectionId || p.connectionId === my) return;
            var roaming = (p.pose === 'walk' || p.pose === 'idle') && p.posX != null && p.posZ != null;
            if (roaming && !_roamers[p.connectionId]) applyAvatarMove(p.connectionId, p.posX, p.posZ, p.yaw || 0, p.pose);
            else if (!roaming && _roamers[p.connectionId]) clearRoamer(p.connectionId);
        });
    }
    // Refresh roamer colour/label when votes or names change.
    function _refreshRoamers() {
        var rs = _roomState || {};
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid], p = _participantByCid(cid);
            if (!r || !p) return;
            var vs = _voteState(p, rs), rc = VOTE_EMI[vs] || VOTE_EMI.none;
            if (r.ring && r.ring.material) { r.ring.material.color.setHex(rc); r.ring.material.emissive.setHex(rc); }
            if (r.label) r.label.textContent = (p.name || 'Guest') + (rs.votesRevealed && p.vote ? ' · ' + p.vote : '');
        });
    }
    function _updateRoamers(dt) {
        var k = Math.min(1, dt * 8), my = _myCid();
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid]; if (!r.robot) return;
            r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k;
            var dy = r.tyaw - r.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
            r.yaw += dy * k;
            r.robot.position.set(r.x, 0, r.z); r.robot.rotation.y = r.yaw;
            if (r.ring) r.ring.position.set(r.x, r.headY, r.z);
            if (r.labelObj) r.labelObj.position.set(r.x, r.headY + 0.22, r.z);
            // Hide self-avatar in first-person (camera = avatar); show it in third-person.
            var inFirstPerson = _walk && (!_cfg || _cfg.walkCameraMode !== 'third');
            var vis = !(cid === my && inFirstPerson);
            r.robot.visible = vis; if (r.ring) r.ring.visible = vis; if (r.labelObj) r.labelObj.visible = vis;
            // Away-dim: fade the name tag of avatars idle for a while.
            if (r.label) r.label.style.opacity = ((_clock - (r.lastMove || 0)) > 45) ? '0.5' : '1';
        });
        // Click-to-walk: when I reach the target, settle to idle (one broadcast).
        if (_walkToActive) {
            var me = _roamers[my];
            if (!me) { _walkToActive = false; }
            else if (Math.hypot(me.tx - me.x, me.tz - me.z) < 0.06) {
                _walkToActive = false;
                if (window.RoomSceneNet && RoomSceneNet.avatarMove) RoomSceneNet.avatarMove(me.tx, me.tz, me.tyaw, 'idle');
            }
        }
    }

    // ── Spatial emotes (floating reactions over avatars) ──────
    function _avatarHeadPos(cid) {
        var r = _roamers[cid]; if (r && r.robot) return { x: r.x, y: r.headY + 0.25, z: r.z };
        var s = _robotMap[cid]; if (s && s.robot) return { x: s.robot.position.x, y: SEAT_H + 0.95, z: s.robot.position.z };
        var st = _robotMap['stand_' + cid]; if (st && st.robot) return { x: st.robot.position.x, y: 1.35, z: st.robot.position.z };
        return null;
    }
    function showEmote(cid, emoji) {
        if (!_scene || !THREE.CSS2DObject || !emoji) return;
        var pos = _avatarHeadPos(cid); if (!pos) return;
        var div = document.createElement('div');
        div.className = 'rs3d-emote';
        div.textContent = emoji;
        div.style.cssText = 'font-size:1.7rem;pointer-events:none;will-change:opacity;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));';
        var obj = new THREE.CSS2DObject(div);
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
        var moving = _walk
            ? (_keys[_keyBinds().forward] || _keys[_keyBinds().back] || _keys[_keyBinds().left] || _keys[_keyBinds().right] ||
               _keys['ArrowUp'] || _keys['ArrowDown'] || _keys['ArrowLeft'] || _keys['ArrowRight'])
            : _walkToActive;
        if (moving) { _stillTime = 0; return; }
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

        var seatedIds = {};
        Object.keys(_claimedChairs).forEach(function(idx){
            var occ = _claimOccupant(_claimedChairs[idx]);
            // A claimant who is roaming is drawn by the roam layer, not seated here.
            if (occ && !_roamers[occ.connectionId]) seatedIds[occ.connectionId || occ.name] = parseInt(idx, 10);
        });

        // Place chairs + seated robots. A chair the user has dragged uses its custom
        // position from _chairPos; otherwise the default ring slot.
        for (var i = 0; i < chairs; i++) {
            var pos    = _chairPos[i] || seats[i];
            var angle  = Math.atan2(-pos.x, -pos.z);
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

            var robot = _makeRobot(_parseColor(p), vs, true);
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
            _scene.add(ring);

            var label = _makeLabel(p, rs);
            var labelObj = null;
            if (THREE.CSS2DObject) {
                labelObj = new THREE.CSS2DObject(label);
                labelObj.position.set(pos.x, headY + 0.22, pos.z);
                _scene.add(labelObj);
            }
            _robotMap[p.connectionId || String(i)] = {
                robot: robot, chair: null, ring: ring,
                label: label, labelObj: labelObj,
                seated: true, phase: i * 0.9, armRaiseT: -1
            };
        }

        // Standing robots (roamers are drawn by the roam layer, not here)
        var unseated = _participants.filter(function(p){
            if (_roamers[p.connectionId]) return false;
            return !seatedIds.hasOwnProperty(p.connectionId || p.name || '');
        });
        var standPos = _standingPositions(unseated.length);
        unseated.forEach(function(p, si){
            var pos = standPos[si];
            var vs = 'none';
            if (p.isObserver)                   vs = 'observer';
            else if (rs.votesRevealed && p.vote) vs = 'revealed';
            else if (p.hasVoted)                 vs = 'voted';

            var robot = _makeRobot(_parseColor(p), vs, false);
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
            _scene.add(ring);

            var label = _makeLabel(p, rs, true);
            var labelObj = null;
            if (THREE.CSS2DObject) {
                labelObj = new THREE.CSS2DObject(label);
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
        _container.addEventListener('dblclick',      _onDblClick,    true);
        // Chair-claim click stays on the canvas (bubble phase, after orbit settles).
        _renderer.domElement.addEventListener('click', _onCanvasClick);
        // Walk-mode keys registered in CAPTURE phase so they fire before any bubble-phase
        // page handler (Space=reveal-votes, Ctrl shortcuts, etc.). stopImmediatePropagation
        // inside the handler then blocks those page handlers from ever seeing the key.
        document.addEventListener('keydown', _onKeyDown, true);
        document.addEventListener('keyup',   _onKeyUp,   true);
        // Drag-to-look in walk mode (bubble phase; only acts when _walk is active).
        _renderer.domElement.addEventListener('pointerdown', _onLookDown);
        window.addEventListener('pointermove', _onLookMove);
        window.addEventListener('pointerup',   _onLookUp);
    }

    function _onCanvasClick(event) {
        if (_walk) return;   // walk mode uses E-to-interact, not click-to-claim
        // If a furniture drag just finished, suppress chair pick
        if (_suppressNextChairClick) { _suppressNextChairClick = false; return; }
        if (!_raycaster || !_camera) return;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);

        // Click the in-room whiteboard → open it to draw.
        if (_wbBoard && _raycaster.intersectObject(_wbBoard, false).length) {
            if (window.Whiteboard) Whiteboard.open();
            return;
        }
        // Click an interactive prop (confetti / jukebox).
        var pm = _propMeshes();
        if (pm.length) {
            var ph = _raycaster.intersectObjects(pm, false);
            if (ph.length) { var pr = _propForMesh(ph[0].object); if (pr) { _runProp(pr.action); return; } }
        }
        if (!_chairObjects.length) return;

        // Allow clicking your own claimed chair to stand up (release seat).
        if (_myChairIdx !== null) {
            var myMesh = null;
            for (var mi = 0; mi < _chairObjects.length; mi++) {
                if (_chairObjects[mi].idx === _myChairIdx) { myMesh = _chairObjects[mi].seatMesh; break; }
            }
            if (myMesh) {
                var myHit = _raycaster.intersectObject(myMesh, false);
                if (myHit.length) {
                    // Confirm stand-up only when seated (not already roaming).
                    if (!_iAmRoaming) {
                        releaseMySeat();
                    } else {
                        // Already roaming — just release the seat claim so they can pick another.
                        releaseMySeat();
                    }
                    return;
                }
            }
        }

        var testMeshes = _chairObjects
            .filter(function(c){ return !_claimedChairs[c.idx] || (_pendingChairIdx === c.idx); })
            .map(function(c){ return c.seatMesh; });

        var hits = _raycaster.intersectObjects(testMeshes, false);
        if (hits.length > 0) {
            var hitMesh = hits[0].object;
            var chairObj = null;
            for (var i = 0; i < _chairObjects.length; i++) {
                if (_chairObjects[i].seatMesh === hitMesh) { chairObj = _chairObjects[i]; break; }
            }
            if (chairObj) { _pendChair(chairObj.idx); return; }
        }

        // AQ2: host clicking an OCCUPIED chair (someone else's) can free it.
        if (_isHost()) {
            var occMeshes = _chairObjects
                .filter(function(c){ var cl=_claimedChairs[c.idx]; return cl && cl.cid !== _myCid(); })
                .map(function(c){ return c.seatMesh; });
            var oh = occMeshes.length ? _raycaster.intersectObjects(occMeshes, false) : [];
            if (oh.length) {
                var om = oh[0].object, oc = null;
                for (var j = 0; j < _chairObjects.length; j++) if (_chairObjects[j].seatMesh === om) { oc = _chairObjects[j]; break; }
                if (oc) { _hostFreeSeat(oc.idx); return; }
            }
        }
        if (_pendingChairIdx !== null) { _cancelClaim(); return; }
        // Click-to-walk: empty floor click → glide my avatar there (only when feature is enabled).
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
        if (!window.confirm('Free ' + who + "'s seat? They'll need to pick a chair again.")) return;
        if (window.RoomSceneNet && RoomSceneNet.hostFreeChair) RoomSceneNet.hostFreeChair(idx);
        else { applyRelease(idx); }
    }

    function _pendChair(idx) {
        _pendingChairIdx = idx;
        _rebuildSeating();
        _showClaimBar(idx);
    }

    function _showClaimBar(idx) {
        if (!_claimBar) return;
        var nameEl = _claimBar.querySelector('#rs3d-claim-name');
        if (nameEl) {
            var icons = { office:'🪑', gaming:'🎮', beanbag:'🛋️', stool:'🪵', throne:'👑' };
            var ct = _chairTypeForIdx(idx);
            nameEl.textContent = (icons[ct]||'🪑') + ' Chair ' + (idx+1) + ' selected';
        }
        _claimBar.style.display = 'flex';
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
        if (_claimBar) _claimBar.style.display = 'none';
        _notifyClaimsChanged();
    }

    function _cancelClaim() {
        _pendingChairIdx = null;
        if (_claimBar) _claimBar.style.display = 'none';
        _rebuildSeating();
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
        // A connection holds at most one chair — drop any stale seat it had.
        Object.keys(_claimedChairs).forEach(function (k) {
            if (_claimedChairs[k] && _claimedChairs[k].cid === cid && parseInt(k, 10) !== idx) {
                if (_claimedChairs[k].cid === _myCid()) _myChairIdx = null;
                delete _claimedChairs[k];
            }
        });
        _claimedChairs[idx] = { name: name, color: color, cid: cid };
        if (cid && cid === _myCid()) {
            _myChairIdx = idx;
            if (_pendingChairIdx === idx) _pendingChairIdx = null;
            if (_claimBar) _claimBar.style.display = 'none';
            // I successfully sat → stop roaming + tell the server to clear my pose.
            if (_iAmRoaming) { _iAmRoaming = false; if (window.RoomSceneNet && RoomSceneNet.avatarStop) RoomSceneNet.avatarStop(); }
        }
        // Sitting down ends roaming — remove their free-roam avatar everywhere.
        if (_roamers[cid]) clearRoamer(cid);
        else _notifyClaimsChanged();
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
        if (_pendingChairIdx === idx) {
            _pendingChairIdx = null;
            if (_claimBar) _claimBar.style.display = 'none';
        }
        if (_scene) _rebuildSeating();
        var msg = '😅 ' + (winnerName || 'Someone') + ' grabbed that chair first! Pick another.';
        if (window._showToastAD) window._showToastAD(msg, 'warning');
        else if (window.console) console.log(msg);
    }

    function _createClaimBar() {
        var bar = document.createElement('div');
        bar.id = 'rs3d-claim-bar';
        bar.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);' +
            'background:rgba(20,24,40,0.94);color:#e8eaf6;padding:7px 14px;border-radius:8px;' +
            'display:none;z-index:10;font-size:0.80rem;gap:9px;align-items:center;' +
            'border:1px solid rgba(100,120,200,0.35);backdrop-filter:blur(6px);white-space:nowrap;';
        bar.innerHTML =
            '<span id="rs3d-claim-name">Chair selected</span>' +
            '<button id="rs3d-claim-ok" style="background:#22c55e;color:#fff;border:none;' +
            'border-radius:5px;padding:3px 11px;cursor:pointer;font-weight:700;">✅ Sit Here</button>' +
            '<button id="rs3d-claim-cancel" style="background:transparent;color:#aaa;' +
            'border:1px solid #555;border-radius:5px;padding:3px 8px;cursor:pointer;">✕</button>';
        _container.appendChild(bar);
        bar.querySelector('#rs3d-claim-ok').onclick     = _confirmClaim;
        bar.querySelector('#rs3d-claim-cancel').onclick = _cancelClaim;
        _claimBar = bar;
    }

    // ── Colour utilities ──────────────────────────────────────
    function _colorHex(v){if(typeof v==='number')return v;var n=parseInt(String(v).replace('#',''),16);return isNaN(n)?0x4488cc:n;}
    function _darken(h,f){return(Math.round(((h>>16)&0xff)*f)<<16)|(Math.round(((h>>8)&0xff)*f)<<8)|Math.round((h&0xff)*f);}
    function _parseColor(p){
        if(p.avatarColor){var n=parseInt(String(p.avatarColor).replace('#',''),16);if(!isNaN(n))return n;}
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

        if (_walk) {
            // First-person mode: our controller owns the camera; skip orbit/fly-to.
            _updateWalk(dt);
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
            _container.removeEventListener('dblclick',      _onDblClick,    true);
        }
        document.removeEventListener('keydown', _onKeyDown, true);
        document.removeEventListener('keyup',   _onKeyUp,   true);
        window.removeEventListener('pointermove', _onLookMove);
        window.removeEventListener('pointerup',   _onLookUp);
        _hideWalkHud();
        if (_walkBtn && _walkBtn.parentNode) { _walkBtn.parentNode.removeChild(_walkBtn); _walkBtn = null; }
        if (_clickWalkBtn && _clickWalkBtn.parentNode) { _clickWalkBtn.parentNode.removeChild(_clickWalkBtn); _clickWalkBtn = null; }
        if (_furnHudBtn && _furnHudBtn.parentNode) { _furnHudBtn.parentNode.removeChild(_furnHudBtn); _furnHudBtn = null; }
        if (_furnHud && _furnHud.parentNode) { _furnHud.parentNode.removeChild(_furnHud); _furnHud = null; }
        var hint = document.getElementById('rs3d-walk-hint'); if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
        if (_miniCanvas && _miniCanvas.parentNode) { _miniCanvas.parentNode.removeChild(_miniCanvas); _miniCanvas = null; _miniCtx = null; }
        _walk = null; _keys = {}; _look = null;
        if (_renderer) {
            var el = _renderer.domElement;
            el.removeEventListener('click', _onCanvasClick);
            el.removeEventListener('pointerdown', _onLookDown);
            if (el.parentNode) el.parentNode.removeChild(el);
            _renderer.dispose(); _renderer = null;
        }
        if (_labelRenderer) {
            if (_labelRenderer.domElement.parentNode) _labelRenderer.domElement.parentNode.removeChild(_labelRenderer.domElement);
            _labelRenderer = null;
        }
        if (_claimBar && _claimBar.parentNode) { _claimBar.parentNode.removeChild(_claimBar); _claimBar = null; }
        if (_selBar && _selBar.parentNode) { _selBar.parentNode.removeChild(_selBar); _selBar = null; }
        _selectedFurnId = null; _selRing = null;
        if (_controls) { _controls.dispose(); _controls = null; }
        if (_wbTex) { _wbTex.dispose(); _wbTex = null; }
        _wbBoard = null; _wbVer = -1;
        Object.keys(_roamers).forEach(function (cid) {
            var r = _roamers[cid];
            if (r.label && r.label.parentNode) r.label.parentNode.removeChild(r.label);
        });
        _roamers = {}; _iAmRoaming = false; _walkToActive = false;
        _emotes.forEach(function (e) { if (e.div && e.div.parentNode) e.div.parentNode.removeChild(e.div); });
        _emotes = [];
        _scene = null; _camera = null; _perspCam = null; _orthoCam = null; _flyTarget = null;
    }

    // ── In-place scene refresh (preserves camera + renderer) ──
    function refreshScene(newConfig) {
        if (!_scene || !_renderer) return;
        // Merge new config
        if (newConfig) Object.assign(_cfg, newConfig);
        // Save furniture layout
        var savedFurniture = getFurnitureLayout();
        // Clean up label DOM nodes attached to CSS2DObjects
        _clearRobots();
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
            if (!_participantByCid(cid)) clearRoamer(cid);
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
        _furnitureObjs.push({ id: id, type: type, x: x, z: z, group: res.group, pickMesh: res.pickMesh });
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
        _deselectFurniture();   // selected id may no longer exist after reset
        _selectedFurnId = null;
        _buildFurniture(_defaultFurniture());
        _saveFurniture();
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
        applyAvatarMove: applyAvatarMove, applyAvatarStop: applyAvatarStop, clearRoamer: clearRoamer,
        showEmote: showEmote,
        addFurniture: addFurniture, removeFurniture: removeFurniture,
        getFurnitureLayout: getFurnitureLayout, resetFurniture: resetFurniture,
        applyRemoteLayout: applyRemoteLayout,
        setView: setView,
        flyToParticipant: flyToParticipant
    };

    // Auto-activate only when RoomScene isn't present to orchestrate (defensive). On the
    // room page RoomScene loads first and drives init()/setView() for every mode, so this
    // is a no-op there — avoids double-initialising the WebGL scene.
    (function(){
        if (window.RoomScene) return;
        if (!_threeReady()) return;
        var stage = document.getElementById('roomSceneStage');
        if (stage) init(stage, { mode: '3d-gl' });
    }());

}());
