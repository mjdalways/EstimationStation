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

    // Chair claiming
    var _chairObjects    = [];
    var _claimedChairs   = {};
    var _myChairIdx      = null;
    var _pendingChairIdx = null;
    var _claimBar        = null;
    var _raycaster       = null;

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

        _camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 30);
        _camera.position.set(0, 3.8, 5.8);

        if (THREE.OrbitControls) {
            _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
            _controls.target.set(0, TBL_TOP, 0);
            _controls.enableDamping = true; _controls.dampingFactor = 0.09;
            _controls.minDistance = 1.5;    _controls.maxDistance   = 13;
            _controls.maxPolarAngle = Math.PI * 0.50;
            _controls.minPolarAngle = 0.18;
            _controls.update();
        }

        _raycaster = new THREE.Raycaster();
        _loadClaims();
        _buildRoom();
        _buildTable();
        _buildLights();
        _buildFurniture(_loadFurniture());
        _setupInteraction();
        _createClaimBar();
        _createSelBar();

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

    // ── Room geometry ─────────────────────────────────────────
    function _buildRoom() {
        var pal = PAL[_cfg.preset] || PAL.conference;

        var floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), _stdMat(pal.floor));
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; _scene.add(floor);

        var ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), _stdMat(pal.ceil, 0.95));
        ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM_H; _scene.add(ceil);

        var wallB = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), _stdMat(pal.wall));
        wallB.position.set(0, ROOM_H / 2, -ROOM_D / 2); _scene.add(wallB);

        var wallL = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), _stdMat(pal.wall));
        wallL.rotation.y = Math.PI / 2; wallL.position.set(-ROOM_W / 2, ROOM_H / 2, 0); _scene.add(wallL);

        var wallR = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), _stdMat(pal.wall));
        wallR.rotation.y = -Math.PI / 2; wallR.position.set(ROOM_W / 2, ROOM_H / 2, 0); _scene.add(wallR);

        _buildWindow();
        if (_cfg.whiteboard !== false) _buildWhiteboard();
        // NOTE: corner plants are now draggable FURNITURE items (see _defaultFurniture),
        // not static room decor — so they can be selected and moved. The old static
        // _buildPlant() decor was removed to avoid un-grabbable duplicates near the camera.
    }

    // Resolve the active window view, honouring the legacy `skyline` boolean.
    function _windowView() {
        if (_cfg.windowView) return _cfg.windowView;
        return (_cfg.skyline === false) ? 'none' : 'skyline';
    }

    function _buildWindow() {
        var z = -ROOM_D / 2;
        var cy = ROOM_H - 1.15;          // window vertical centre
        var view = _windowView();

        // Outer frame (always present)
        var frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 0.08),
            new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.55 }));
        frame.position.set(0, cy, z + 0.04); _scene.add(frame);

        if (view === 'none') {
            // Bare glass, no scene behind it.
            var g0 = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.72),
                new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.22, roughness: 0 }));
            g0.position.set(0, cy, z + 0.09); _scene.add(g0);
            return;
        }

        var V = WINDOW_VIEWS[view] || WINDOW_VIEWS.skyline;
        var zb = z - 0.06;               // depth for scene elements (behind glass)

        // Sky backing plane (fills the window opening)
        var sky = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.72),
            new THREE.MeshStandardMaterial({ color: V.sky, emissive: V.sky, emissiveIntensity: V.skyEmi || 0.35, roughness: 1 }));
        sky.position.set(0, cy, zb - 0.02); _scene.add(sky);

        // Per-view scene content
        if (V.build) V.build(cy, zb);

        // Glass overlay (subtle tint over the scene)
        var glass = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.72),
            new THREE.MeshStandardMaterial({ color: V.glass || 0x8ac8ff, transparent: true, opacity: 0.14, roughness: 0 }));
        glass.position.set(0, cy, z + 0.09); _scene.add(glass);

        // Mullions (cross bars) for a windowy feel
        var mm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5 });
        var barV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.72, 0.04), mm);
        barV.position.set(0, cy, z + 0.1); _scene.add(barV);
        var barH = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.05, 0.04), mm);
        barH.position.set(0, cy, z + 0.1); _scene.add(barH);
    }

    // Helper: add a coloured box to the window scene relative to window centre.
    function _winBox(x, y, w, h, color, zb, cy, emi) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.2 : emi }));
        m.position.set(x, cy + y, zb);
        _scene.add(m);
        return m;
    }
    function _winDisc(x, y, r, color, zb, cy, emi) {
        var m = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.6 : emi }));
        m.position.set(x, cy + y, zb + 0.005);
        _scene.add(m);
        return m;
    }
    function _winTri(x, y, w, h, color, zb, cy, emi) {
        var s = new THREE.Shape();
        s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
        var m = new THREE.Mesh(new THREE.ShapeGeometry(s),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emi == null ? 0.2 : emi }));
        m.position.set(x, cy + y, zb);
        _scene.add(m);
        return m;
    }

    // Window-view catalog. Each entry: sky colour + a build(cy, zb) that draws
    // the scene behind the glass using the _win* helpers. GROUND is the bottom
    // edge of the window opening (y offset −0.86 from centre).
    var WINDOW_VIEWS = {
        'skyline': {
            sky: 0x9ec9e8, glass: 0x8ac8ff, skyEmi: 0.4,
            build: function (cy, zb) {
                var g = -0.86;
                [
                    {x:-1.20,w:0.35,h:0.55,c:0x2c3a50},{x:-0.70,w:0.30,h:0.80,c:0x1e2d42},
                    {x:-0.20,w:0.42,h:0.62,c:0x364a60},{x: 0.40,w:0.28,h:0.95,c:0x28394e},
                    {x: 0.90,w:0.38,h:0.50,c:0x3a4f68},{x: 1.30,w:0.25,h:0.70,c:0x243546}
                ].forEach(function (b) { _winBox(b.x, g + b.h / 2, b.w, b.h, b.c, zb, cy, 0.25); });
            }
        },
        'beach': {
            sky: 0xbfe6ff, glass: 0x9fd8ff, skyEmi: 0.5,
            build: function (cy, zb) {
                _winDisc(0.95, 0.42, 0.2, 0xfff2b0, zb, cy, 0.85);      // sun
                _winBox(0, -0.55, 3.0, 0.62, 0x2a93c8, zb, cy, 0.3);    // sea
                _winBox(0, -0.80, 3.0, 0.22, 0xe8d9a8, zb, cy, 0.25);   // sand
                // distant sailboat
                _winTri(-0.6, -0.42, 0.18, 0.18, 0xffffff, zb + 0.01, cy, 0.4);
            }
        },
        'mountains': {
            sky: 0xcfe4f2, glass: 0xbcd6e8, skyEmi: 0.45,
            build: function (cy, zb) {
                var g = -0.86;
                _winTri(-0.75, g, 1.5, 1.05, 0x6b7d8c, zb, cy, 0.18);   // back peak
                _winTri(-0.75, g + 0.78, 0.45, 0.30, 0xffffff, zb + 0.01, cy, 0.3); // snow cap
                _winTri(0.55, g, 1.7, 1.25, 0x5a6b78, zb, cy, 0.16);    // front peak
                _winTri(0.55, g + 0.95, 0.5, 0.32, 0xffffff, zb + 0.01, cy, 0.3);
                _winBox(0, g + 0.07, 3.0, 0.14, 0x4a6b4f, zb + 0.005, cy, 0.2); // tree line
            }
        },
        'night': {
            sky: 0x0c1a33, glass: 0x16335c, skyEmi: 0.12,
            build: function (cy, zb) {
                var g = -0.86;
                _winDisc(-0.95, 0.45, 0.16, 0xf2f0d8, zb, cy, 0.7);     // moon
                // stars
                [[-0.4,0.55],[0.2,0.62],[0.7,0.4],[1.1,0.55],[-1.1,0.2],[0.4,0.3]].forEach(function (s) {
                    _winDisc(s[0], s[1], 0.018, 0xffffff, zb, cy, 0.9);
                });
                // dark building silhouettes with lit windows
                [
                    {x:-0.9,w:0.4,h:0.7},{x:-0.3,w:0.34,h:0.95},
                    {x:0.35,w:0.46,h:0.78},{x:1.0,w:0.32,h:1.05}
                ].forEach(function (b) {
                    _winBox(b.x, g + b.h / 2, b.w, b.h, 0x070d1a, zb, cy, 0.05);
                    for (var r = 0; r < 3; r++) for (var c = 0; c < 2; c++) {
                        if ((r + c + Math.round(b.x * 10)) % 2 === 0) continue;
                        _winBox(b.x - b.w / 4 + c * b.w / 2, g + 0.12 + r * (b.h / 3.5),
                            0.05, 0.05, 0xffd87a, zb + 0.01, cy, 0.9);
                    }
                });
            }
        },
        'forest': {
            sky: 0xcfe6d0, glass: 0xb9dcc0, skyEmi: 0.4,
            build: function (cy, zb) {
                var g = -0.86;
                _winBox(0, g + 0.1, 3.0, 0.2, 0x3f6b3a, zb, cy, 0.2);   // ground
                [
                    {x:-1.1,h:0.7,c:0x2f5a2c},{x:-0.6,h:0.95,c:0x35632f},
                    {x:-0.1,h:0.8,c:0x2c5429},{x:0.45,h:1.05,c:0x386a32},
                    {x:0.95,h:0.75,c:0x2f5a2c},{x:1.3,h:0.9,c:0x356330}
                ].forEach(function (t) {
                    _winBox(t.x, g + 0.18, 0.06, 0.2, 0x6b4a2c, zb - 0.005, cy, 0.1); // trunk
                    _winTri(t.x, g + 0.18, 0.5, t.h, t.c, zb, cy, 0.18);              // foliage
                    _winTri(t.x, g + 0.18 + t.h * 0.45, 0.38, t.h * 0.6, t.c, zb + 0.005, cy, 0.2);
                });
            }
        }
    };

    function _buildWhiteboard() {
        var z = -ROOM_D / 2;
        var board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.04),
            new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.65 }));
        board.position.set(-2.6, 1.45, z + 0.05); _scene.add(board);
        var fm = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.4, metalness: 0.6 });
        [0.57,-0.57].forEach(function(dy){
            var b=new THREE.Mesh(new THREE.BoxGeometry(1.86,0.055,0.05),fm);
            b.position.set(-2.6,1.45+dy,z+0.07); _scene.add(b);
        });
        [-0.93,0.93].forEach(function(dx){
            var b=new THREE.Mesh(new THREE.BoxGeometry(0.055,1.1,0.05),fm);
            b.position.set(-2.6+dx,1.45,z+0.07); _scene.add(b);
        });
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
        var mat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.58, metalness: 0.04 });
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
        _scene.add(new THREE.AmbientLight(0xffffff, 0.40));
        var spot = new THREE.SpotLight(0xfff9ee, 2.0);
        spot.position.set(0,ROOM_H-0.05,0); spot.target.position.set(0,0,0);
        spot.angle=Math.PI/3.6; spot.penumbra=0.55; spot.castShadow=true;
        spot.shadow.mapSize.set(1024,1024); spot.shadow.camera.near=0.5; spot.shadow.camera.far=7;
        _scene.add(spot); _scene.add(spot.target);
        var fill = new THREE.DirectionalLight(0x88aaff,0.35);
        fill.position.set(0,2.5,-ROOM_D/2); _scene.add(fill);
        var shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.30,0.08,12,1,true),
            new THREE.MeshStandardMaterial({color:0xfff9ee,side:THREE.BackSide,emissive:0xfff9ee,emissiveIntensity:0.55}));
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
        try {
            var data = _furnitureObjs.map(function(f){ return { id:f.id, type:f.type, x:f.x, z:f.z }; });
            localStorage.setItem(_furnitureKey(), JSON.stringify(data));
        } catch (e) {}
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
        if (event.button !== undefined && event.button !== 0) return;
        if (event.shiftKey) return;                 // Shift → let OrbitControls orbit
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
        if (!_furnitureDrag) return;
        if (event && _furnitureDrag.pointerId !== undefined && event.pointerId !== _furnitureDrag.pointerId) return;
        if (_furnitureDrag.moved) _saveFurniture();
        try { if (event) _renderer.domElement.releasePointerCapture(event.pointerId); } catch (e) {}
        _furnitureDrag = null;
        if (_controls) _controls.enabled = true;
    }

    function _onDblClick(event) {
        if ((_cfg.dragMode || 'select') !== 'doubleselect') return;
        var found = _raycastFurnitureAt(event);
        if (found) { _selectFurniture(found.id); event.stopPropagation(); }
        else       { _deselectFurniture(); }
    }

    function _onKeyDown(event) {
        if (_selectedFurnId === null) return;
        var t = event.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (event.key === 'Escape') { _deselectFurniture(); }
        else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); _deleteSelected(); }
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

    // ── Robot (seated + standing) ─────────────────────────────
    function _makeRobot(color, voteState, seated) {
        var g     = new THREE.Group();
        var base  = _colorHex(color);
        var dark  = _darken(base, 0.62);
        var eyeC  = voteState==='revealed' ? 0x22ff88 : voteState==='voted' ? 0xffcc00 : 0x00ddff;

        var bm = new THREE.MeshStandardMaterial({ color: base, roughness: 0.48, metalness: 0.32 });
        var lm = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.58, metalness: 0.22 });
        var em = new THREE.MeshStandardMaterial({ color: eyeC, emissive: eyeC, emissiveIntensity: 1.4, roughness: 0.05 });

        var BY = seated ? (SEAT_H + 0.225) : 0.55;

        // [0] Torso
        var torso = new THREE.Mesh(new THREE.BoxGeometry(0.29,0.36,0.20),bm);
        torso.position.y = BY; torso.castShadow = true; g.add(torso);
        // [1] Head — stored base Y for idle anim
        var head = new THREE.Mesh(new THREE.BoxGeometry(0.23,0.22,0.19),bm);
        head.position.set(0, BY+0.30, 0);
        head.userData.baseY = BY + 0.30;
        g.add(head);
        // [2,3] Eyes
        [-0.058,0.058].forEach(function(ex){
            var eye=new THREE.Mesh(new THREE.SphereGeometry(0.034,7,7),em);
            eye.position.set(ex,BY+0.31,0.092); g.add(eye);
        });
        // [4] Antenna
        var ant=new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.12,5),lm);
        ant.position.set(0,BY+0.47,0); g.add(ant);
        // [5] Antenna tip (pulsing)
        var tip=new THREE.Mesh(new THREE.SphereGeometry(0.022,5,5),em);
        tip.position.set(0,BY+0.53,0); g.add(tip);

        if (seated) {
            // Arms resting on table [6,7]
            [-0.205,0.205].forEach(function(ax){
                var arm=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.085,0.30),lm);
                arm.position.set(ax,BY-0.02,0.19);
                arm.userData.baseY = BY - 0.02;
                arm.userData.baseZ = 0.19;
                arm.userData.isArm = true;
                g.add(arm);
            });
            // Thighs [8,9]
            [-0.085,0.085].forEach(function(lx){
                var th=new THREE.Mesh(new THREE.BoxGeometry(0.11,0.085,0.38),lm);
                th.position.set(lx,SEAT_H-0.012,0.145); g.add(th);
            });
            // Shins [10,11]
            [-0.085,0.085].forEach(function(lx){
                var sh=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.32,0.09),lm);
                sh.position.set(lx,SEAT_H-0.185,0.325); g.add(sh);
            });
        } else {
            // Arms hanging [6,7] — used for idle sway
            [-0.19,0.19].forEach(function(ax){
                var arm=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.32,6),lm);
                arm.position.set(ax,BY-0.17,0);
                arm.userData.isArm = true;
                arm.userData.standingSide = ax < 0 ? -1 : 1;
                g.add(arm);
            });
            // Legs straight [8,9]
            [-0.085,0.085].forEach(function(lx){
                var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.42,6),lm);
                leg.position.set(lx,0.21,0); g.add(leg);
            });
        }

        // AO shadow disc on floor (Phase 4)
        var aoDisk = new THREE.Mesh(
            new THREE.CircleGeometry(0.24, 12),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
        );
        aoDisk.rotation.x = -Math.PI / 2;
        aoDisk.position.y = 0.002;
        g.add(aoDisk);

        return g;
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
        if (_renderer) return _claimedChairs;
        try { var s = JSON.parse(localStorage.getItem(_roomKey()) || '{}'); return s.chairs || {}; }
        catch (e) { return {}; }
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
        var byName = {};
        participants.forEach(function (p) { byName[p.name || ''] = p; });

        var seatedNames = {};
        var seats = [];
        for (var i = 0; i < chairs; i++) {
            var c = claims[i];
            var occupant = (c && c.name && byName.hasOwnProperty(c.name)) ? byName[c.name] : null;
            if (occupant) seatedNames[c.name] = i;
            seats.push({ idx: i, participant: occupant, chairType: _chairTypeForIdx(i), claimed: !!occupant });
        }
        var standing = participants.filter(function (p) { return !seatedNames.hasOwnProperty(p.name || ''); });
        return { chairs: chairs, seats: seats, standing: standing };
    }

    // ── Participant sync ──────────────────────────────────────
    function _clearRobots() {
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

    function _rebuildSeating() {
        if (!_scene) return;
        _clearRobots();
        var rs    = _roomState || {};
        var count = _participants.length;
        var chairs = Math.max(count, _cfg.chairCount || count, 1);
        chairs = Math.min(chairs, 16);

        var seats = _seatPositions(chairs);

        var byName = {};
        _participants.forEach(function(p){ byName[p.name || ''] = p; });

        var seatedNames = {};
        Object.keys(_claimedChairs).forEach(function(idx){
            var c = _claimedChairs[idx];
            if (c && c.name) seatedNames[c.name] = parseInt(idx, 10);
        });

        // Place chairs + seated robots
        for (var i = 0; i < chairs; i++) {
            var pos    = seats[i];
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
            var p = byName[claim.name];
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

            var headY = SEAT_H + 0.225 + 0.30 + 0.24;
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

        // Standing robots
        var unseated = _participants.filter(function(p){
            return !seatedNames.hasOwnProperty(p.name || '');
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

            var headY = 0.55 + 0.30 + 0.18;
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
        // Esc / Delete on the selected furniture item.
        document.addEventListener('keydown', _onKeyDown);
    }

    function _onCanvasClick(event) {
        // If a furniture drag just finished, suppress chair pick
        if (_suppressNextChairClick) { _suppressNextChairClick = false; return; }
        if (!_chairObjects.length || !_raycaster) return;
        var rect = _renderer.domElement.getBoundingClientRect();
        var mx = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        var my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        _raycaster.setFromCamera(new THREE.Vector2(mx, my), _camera);

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
        if (_pendingChairIdx !== null) _cancelClaim();
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

    function _confirmClaim() {
        if (_pendingChairIdx === null) return;
        var myName  = (window.ROOM_CONFIG && window.ROOM_CONFIG.playerName) || 'Guest';
        var me = null;
        for (var i = 0; i < _participants.length; i++) { if (_participants[i].name === myName) { me = _participants[i]; break; } }
        var myColor = me ? _parseColor(me) : null;
        if (_myChairIdx !== null && _myChairIdx !== _pendingChairIdx) delete _claimedChairs[_myChairIdx];
        _claimedChairs[_pendingChairIdx] = { name: myName, color: myColor };
        _myChairIdx = _pendingChairIdx;
        _pendingChairIdx = null;
        _saveClaims();
        if (_claimBar) _claimBar.style.display = 'none';
        _rebuildSeating();
    }

    function _cancelClaim() {
        _pendingChairIdx = null;
        if (_claimBar) _claimBar.style.display = 'none';
        _rebuildSeating();
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

        // ── Phase 4: idle robot animations ───────────────────
        Object.keys(_robotMap).forEach(function(k, idx){
            var r = _robotMap[k];
            if (!r.robot) return;
            var phase = r.phase || 0;

            // Antenna tip pulse
            var tip = r.robot.children[5];
            if (tip && tip.material) tip.material.emissiveIntensity = 1.0 + 0.4 * Math.sin(_clock * 1.8 + phase);

            // Head bob (gentle, different period per robot)
            var head = r.robot.children[1];
            if (head) {
                var base = head.userData.baseY || 0;
                head.position.y = base + Math.sin(_clock * 0.72 + phase) * 0.009;
            }

            // Arm sway (standing robots only)
            if (!r.seated) {
                var arm0 = r.robot.children[6];
                var arm1 = r.robot.children[7];
                if (arm0 && arm0.userData.isArm) arm0.rotation.z =  Math.sin(_clock * 0.55 + phase) * 0.12;
                if (arm1 && arm1.userData.isArm) arm1.rotation.z = -Math.sin(_clock * 0.55 + phase) * 0.12;
            }

            // Vote-reveal arm raise (seated robots, Phase 4)
            if (r.seated && r.armRaiseT !== undefined && r.armRaiseT >= 0 && r.armRaiseT < 1.5) {
                r.armRaiseT += dt;
                var arc = Math.max(0, Math.sin(r.armRaiseT * Math.PI / 1.5));
                var arm6 = r.robot.children[6];
                if (arm6 && arm6.userData.isArm) {
                    arm6.position.y = (arm6.userData.baseY || 0) + arc * 0.28;
                    arm6.position.z = (arm6.userData.baseZ || 0) - arc * 0.18;
                    arm6.rotation.x = -arc * 0.5;
                }
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

        // Glow ring pulse on unclaimed chairs
        _scene.children.forEach(function(obj){
            if (obj.userData && obj.userData.glowRing && obj.material) {
                obj.material.emissiveIntensity = 0.5 + 0.45 * Math.sin(_clock * 2.2);
            }
        });

        // Phase 4: camera fly-to
        if (_flyTarget && _controls) {
            _flyTarget.t = Math.min(_flyTarget.t + dt / _flyTarget.dur, 1.0);
            var ease = 1 - Math.pow(1 - _flyTarget.t, 3);
            _camera.position.lerpVectors(_flyTarget.startCam, _flyTarget.endCam, ease);
            _controls.target.lerpVectors(_flyTarget.startOrb, _flyTarget.endOrb, ease);
            if (_flyTarget.t >= 1.0) _flyTarget = null;
        }

        if (_controls) _controls.update();
        _renderer.render(_scene, _camera);
        if (_labelRenderer) _labelRenderer.render(_scene, _camera);
    }

    // ── Resize / dispose ──────────────────────────────────────
    function resize(w, h) {
        if (!_renderer || !w || !h) return;
        _camera.aspect = w / h;
        _camera.updateProjectionMatrix();
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
        document.removeEventListener('keydown', _onKeyDown);
        if (_renderer) {
            var el = _renderer.domElement;
            el.removeEventListener('click', _onCanvasClick);
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
        _scene = null; _camera = null; _flyTarget = null;
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
        _rebuildSeating();
    }
    function syncRoom(roomState) {
        _roomState = roomState || null;
        syncParticipants((roomState && roomState.participants) || _participants, roomState);
    }
    function releaseMySeat() {
        if (_myChairIdx !== null) {
            delete _claimedChairs[_myChairIdx];
            _myChairIdx = null;
            _saveClaims();
            _rebuildSeating();
        }
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
        addFurniture: addFurniture, removeFurniture: removeFurniture,
        getFurnitureLayout: getFurnitureLayout, resetFurniture: resetFurniture,
        flyToParticipant: flyToParticipant
    };

    // Auto-activate if saved mode is 3d-gl
    (function(){
        if (!_threeReady()) return;
        var cfg = window.RoomScene && window.RoomScene.getConfig();
        if (cfg && cfg.mode === '3d-gl') {
            var stage = document.getElementById('roomSceneStage');
            if (stage) { stage.innerHTML = ''; init(stage, cfg); }
        }
    }());

}());
