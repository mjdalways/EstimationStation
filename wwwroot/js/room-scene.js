// ============================================================
// Room Scene Widget
// Standalone 2D / CSS-3D visual room renderer used by the widget system.
// ============================================================
(function() {
    'use strict';

    var STORAGE_KEY = 'es_roomSceneConfig';
    var DEFAULT_CONFIG = {
        mode: '2d',
        preset: 'skyline',
        tableShape: 'round',
        whiteboard: true,
        plants: true,
        skyline: true,
        chairCount: 0,        // 0 = match participant count
        tableSize: 'medium',  // small | medium | large
        chairType: 'office',  // office | gaming | beanbag | stool | throne | random
        windowView: 'skyline',// skyline | beach | mountains | night | forest | space | custom | none
        windowAnimated: true, // animate the window scene (clouds drift, stars twinkle, sea shimmers)
        windowTimeOfDay: 'day', // day | dusk | night | auto — tints daylight scenes (auto follows local clock)
        windowImage: null,    // legacy data URL for the 🎨 custom window view (back-compat reads only)
        windowMediaId: null,  // server-stored room media id for the 🎨 custom window view
        windowMediaMime: null, // MIME type of the server-stored window media
        floorMaterial: 'preset', // preset | wood | carpet | tile | concrete
        wallColor: 'preset',  // 'preset' or a #hex
        floorColor: 'preset', // 'preset' or a #hex (tints the floor material)
        tableMaterial: 'wood',// wood | glass | marble
        lighting: 'normal',   // normal | warm | cool | neon
        roomSize: 'wide',     // small | medium | wide | large — overall room footprint
        walkCameraMode: 'first', // first = first-person | third = third-person follow camera
        // Walk feel (personal — not shared with the room)
        walkSpeed: 2.7,       // m/s, 1.5–4.5
        lookSensitivity: 0.005, // mouse-look radians per pixel, 0.002–0.012
        invertY: false,       // invert vertical mouse-look
        // Walk controls (3D). Values are KeyboardEvent.code strings.
        // Defaults use arrow keys + Ctrl/Alt so they don't conflict with page shortcuts (Space=reveal, C=chat, etc.)
        keyBindings: { forward:'ArrowUp', back:'ArrowDown', left:'ArrowLeft', right:'ArrowRight',
                       jump:'AltLeft', crouch:'ControlLeft', interact:'KeyE', walk:'KeyT', camToggle:'KeyV' }
    };

    var state = {
        root: null,
        stage: null,
        config: loadConfig(),
        participants: [],
        roomState: null
    };
    var _glActive = false;   // true while the WebGL renderer (RS3D) owns the stage
    var _rs3dLoading = false; // true while the lazy 3D module graph is being fetched (P7)

    function loadConfig() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            var cfg = Object.assign({}, DEFAULT_CONFIG, saved);
            // keyBindings is a nested object — the shallow Object.assign above replaces it
            // wholesale with whatever was saved, so a binding added after a user's config
            // was last saved (e.g. camToggle) would otherwise resolve to undefined and show
            // as unbound in the rebind UI. Fill in any missing action from the current
            // defaults instead.
            cfg.keyBindings = Object.assign({}, DEFAULT_CONFIG.keyBindings, saved.keyBindings || {});
            // Migrate the retired CSS-3D mode onto the WebGL room.
            if (cfg.mode === '3d') cfg.mode = '3d-gl';
            return cfg;
        } catch (e) {
            return Object.assign({}, DEFAULT_CONFIG);
        }
    }

    function saveConfig() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
        } catch (e) {
            console.warn('[RoomScene] config not persisted (quota?)', e);
        }
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function participantInitial(name) {
        var clean = String(name || '?').trim();
        return clean ? clean.charAt(0).toUpperCase() : '?';
    }

    // Resolve how many chairs to draw and who sits / stands.
    // Parity with 3D GL: defer to RS3D.getSeatingPlan so a participant who
    // claimed a chair appears in the SAME seat index in 2D and 3D, and anyone
    // who hasn't claimed stands. Falls back to a simple sequential fill only
    // when the 3D engine module isn't loaded.
    function seatPlan() {
        var people = state.participants || [];
        if (window.RS3D && RS3D.getSeatingPlan) {
            var plan = RS3D.getSeatingPlan(people, state.config);
            return {
                total: plan.chairs,
                slots: plan.seats.map(function (s) { return s.participant || null; }),
                standing: plan.standing
            };
        }
        var cc = parseInt(state.config.chairCount, 10) || 0;
        var total = Math.max(0, Math.min(cc > 0 ? cc : people.length, 16));
        var slots = [];
        for (var i = 0; i < total; i++) slots.push(people[i] || null);
        return { total: total, slots: slots, standing: people.slice(total) };
    }

    // Is this participant the local user? (connectionId-first, name fallback.)
    function _isMe(p) {
        if (!p) return false;
        var myCid = window.ROOM_CONFIG && window.ROOM_CONFIG.connectionId;
        var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
        return (myCid && p.connectionId === myCid) || (!myCid && p.name === myName);
    }

    function syncControls() {
        var modeButtons = document.querySelectorAll('[data-rs-mode]');
        modeButtons.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-rs-mode') === state.config.mode);
        });
        var preset     = document.getElementById('rs-preset');
        var tableShape = document.getElementById('rs-table-shape');
        var whiteboard = document.getElementById('rs-whiteboard');
        var plants     = document.getElementById('rs-plants');
        var skyline    = document.getElementById('rs-skyline');
        var tableSize  = document.getElementById('rs-table-size');
        var chairCount = document.getElementById('rs-chair-count');
        var chairType  = document.getElementById('rs-chair-type');
        var windowView = document.getElementById('rs-window-view');
        var windowAnim = document.getElementById('rs-window-anim');
        var windowTime = document.getElementById('rs-window-time');
        var floorMat   = document.getElementById('rs-floor-mat');
        var tableMat   = document.getElementById('rs-table-mat');
        var wallColor  = document.getElementById('rs-wall-color');
        var floorColor = document.getElementById('rs-floor-color');
        var lighting   = document.getElementById('rs-lighting');
        var roomSize   = document.getElementById('rs-room-size');
        var walkSpeed  = document.getElementById('rs-walk-speed');
        var lookSens   = document.getElementById('rs-look-sensitivity');
        var invertY    = document.getElementById('rs-invert-y');
        if (preset)     preset.value          = state.config.preset;
        if (tableShape) tableShape.value      = state.config.tableShape;
        if (whiteboard) whiteboard.checked    = !!state.config.whiteboard;
        if (plants)     plants.checked        = !!state.config.plants;
        if (skyline)    skyline.checked       = !!state.config.skyline;
        if (tableSize)  tableSize.value       = state.config.tableSize  || 'medium';
        if (chairCount) chairCount.value      = state.config.chairCount || '';
        if (chairType)  chairType.value       = state.config.chairType  || 'office';
        if (windowView) windowView.value      = state.config.windowView || 'skyline';
        if (windowAnim) windowAnim.checked     = state.config.windowAnimated !== false;
        if (windowTime) windowTime.value       = state.config.windowTimeOfDay || 'day';
        if (floorMat)   floorMat.value         = state.config.floorMaterial || 'preset';
        if (tableMat)   tableMat.value         = state.config.tableMaterial || 'wood';
        if (wallColor)  wallColor.value        = (state.config.wallColor && state.config.wallColor !== 'preset') ? state.config.wallColor : '#cfd3da';
        if (floorColor) floorColor.value       = (state.config.floorColor && state.config.floorColor !== 'preset') ? state.config.floorColor : '#cfd3da';
        if (lighting)   lighting.value         = state.config.lighting || 'normal';
        if (roomSize)   roomSize.value         = state.config.roomSize || 'wide';
        if (walkSpeed)  walkSpeed.value        = state.config.walkSpeed != null ? state.config.walkSpeed : 2.7;
        if (lookSens)   lookSens.value         = state.config.lookSensitivity != null ? state.config.lookSensitivity : 0.005;
        if (invertY)    invertY.checked        = !!state.config.invertY;
    }

    // Public re-render hook (also called by RS3D after claim changes). When WebGL owns the
    // stage, RS3D already repainted — just keep the controls in sync; otherwise redraw CSS.
    function render() {
        if (!state.stage) return;
        if (_glActive) { syncControls(); return; }
        _renderCss();
        syncControls();
    }

    function init(rootId) {
        state.root = document.getElementById(rootId || 'roomScenePanel');
        state.stage = document.getElementById('roomSceneStage');
        if (!state.root || !state.stage) return;
        RoomSceneStore.set({ config: state.config }, { source: 'init', slice: 'config', fields: [] });
        _applyMode();
    }

    function _showGlError(msg) {
        state.stage.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
            'flex-direction:column;gap:8px;color:#dc3545;font-size:0.82rem;padding:16px;text-align:center;">' +
            '<span style="font-size:1.8rem;">⚠️</span>' +
            '<strong>3D GL unavailable</strong>' +
            '<span>' + String(msg).replace(/</g,'&lt;') + '</span>' +
            '<button onclick="RoomScene.setMode(\'2d\')" style="margin-top:4px;padding:3px 12px;' +
            'border:1px solid #ccc;border-radius:5px;cursor:pointer;background:#fff;">Switch to 2D</button>' +
            '</div>';
    }

    // The WebGL renderer is always wanted: 2D is the top-down view of the same room,
    // 3D is the orbit/walk view. Returns false only if mode is somehow unset.
    function _wantGl() {
        var m = state.config.mode;
        return m === '3d-gl' || m === '2d';
    }

    // Static placeholder shown only while RS3D hasn't taken over the stage yet
    // (e.g. before the module script has finished loading).
    function _renderCss() {
        // SignalR state can arrive before DOMContentLoaded/init() — nothing to paint yet,
        // and throwing here would abort the caller's whole RoomState handler.
        if (!state.root || !state.stage) return;
        state.root.classList.remove('room-scene-3d-active');
        state.stage.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a93a6;font-size:0.85rem;">Loading room…</div>';
    }

    // Single orchestrator: pick the WebGL view (top-down for 2D, orbit for 3D) or the
    // CSS placeholder, initialising / disposing RS3D as needed.
    function _applyMode() {
        if (!state.stage) return;
        var view = (state.config.mode === '2d') ? 'top' : 'persp';
        if (_wantGl() && window.RS3D && window.THREE) {
            if (!_glActive) {
                state.stage.innerHTML = '';
                var ok;
                try { ok = RS3D.init(state.stage, state.config); }
                catch (e) {
                    console.error('[RS3D] init error:', e);
                    _showGlError(e.message || 'init error'); return;
                }
                if (ok === false) {
                    _showGlError('WebGL not available in this browser'); return;
                }
                _glActive = true;
                RS3D.syncParticipants(state.participants, state.roomState);
            }
            if (RS3D.setView) RS3D.setView(view);
            syncControls();
        } else if (_wantGl()) {
            // RS3D module graph not loaded yet (P7 lazy-load). Fetch it only once the panel
            // is actually visible — a hidden panel (P6 default, or user-hidden) stays on the
            // CSS placeholder and costs nothing.
            var panelEl = state.root || document.getElementById('roomScenePanel');
            var panelHidden = panelEl && panelEl.style.display === 'none';
            if (!panelHidden && !_rs3dLoading && window._rs3dEnsure) {
                _rs3dLoading = true;
                window._rs3dEnsure().then(function () {
                    _rs3dLoading = false;
                    _applyMode();
                }, function (e) {
                    _rs3dLoading = false;
                    console.error('[RS3D] lazy load failed:', e);
                    _showGlError('Failed to load 3D module');
                });
            }
            _renderCss();
            syncControls();
        } else {
            if (_glActive && window.RS3D) { RS3D.dispose(); _glActive = false; }
            _renderCss();
            syncControls();
        }
    }

    function setMode(mode) {
        // Only two modes: '2d' (top-down or flat) and '3d-gl' (orbit room). Legacy '3d' → 3D.
        if (mode === '3d') mode = '3d-gl';
        state.config.mode = (mode === '3d-gl') ? '3d-gl' : '2d';
        saveConfig();
        _applyMode();
        // Mirror into the store with source:'init' — keeps RoomSceneStore.getState().config
        // accurate for other readers without re-triggering save/broadcast/refresh above.
        RoomSceneStore.set({ config: state.config }, { source: 'init', slice: 'config', fields: [] });
    }

    // silent=true: received from another participant — apply locally but don't echo back.
    function updateConfig(patch, silent) {
        state.config = Object.assign({}, state.config, patch || {});
        RoomSceneStore.set({ config: state.config }, {
            source: silent ? 'remote' : 'local',
            slice: 'config',
            fields: Object.keys(patch || {})
        });
    }

    // Config-slice subscriber: persists, broadcasts shared fields (local only),
    // and re-renders. Initial seed (source:'init') is a no-op per the store's
    // documented network rule.
    RoomSceneStore.subscribe(function(s, meta) {
        if (meta.slice !== 'config' || meta.source === 'init') return;
        saveConfig();
        if (meta.source === 'local' && window.RoomSceneNet && RoomSceneNet.broadcastSceneConfig) {
            var toShare = {};
            RoomSceneStore.SHARED_FIELDS.forEach(function(k){ if (meta.fields.indexOf(k) !== -1) toShare[k] = state.config[k]; });
            if (Object.keys(toShare).length > 0) {
                try { RoomSceneNet.broadcastSceneConfig(JSON.stringify(toShare)); } catch(e) {}
            }
        }
        var wantGl = _wantGl();
        if (wantGl === _glActive) {
            // Renderer unchanged — just apply the new config to whatever is showing.
            if (_glActive && window.RS3D) {
                try {
                    RS3D.refreshScene(state.config);
                    RS3D.syncParticipants(state.participants, state.roomState);
                    if (RS3D.setView) RS3D.setView(state.config.mode === '2d' ? 'top' : 'persp');
                } catch (e) { console.error('[RS3D] refreshScene error:', e); }
                syncControls();
            } else {
                _renderCss(); syncControls();
            }
        } else {
            _applyMode();   // the patch flipped which renderer should be active
        }
    });

    function syncParticipants(participants) {
        // C6 (documented, not fixed): the scene has 16 chair/standing slots, so beyond that
        // participants are silently dropped from the 3D/2D view with no "+N more" indicator.
        // They're still fully present in the participant list panel and can vote normally.
        state.participants = (participants || []).slice(0, 16);
        if (_glActive && window.RS3D) { RS3D.syncParticipants(state.participants, state.roomState); return; }
        _renderCss();
    }

    function syncRoom(roomState) {
        state.roomState = roomState || null;
        if (_glActive && window.RS3D) { RS3D.syncRoom(state.roomState); return; }
        syncParticipants((roomState && roomState.participants) || state.participants || []);
    }

    window.RoomScene = {
        init: init,
        setMode: setMode,
        updateConfig: updateConfig,
        syncParticipants: syncParticipants,
        syncRoom: syncRoom,
        render: render,
        syncControls: syncControls,
        ensureStarted: _applyMode, // re-run mode selection (used when a hidden panel is shown — P7)
        getConfig: function() { return Object.assign({}, state.config); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init('roomScenePanel'); });
    } else {
        init('roomScenePanel');
    }
})();
