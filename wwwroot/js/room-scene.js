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
        windowImage: null,    // data URL for the 🎨 custom window view
        floorMaterial: 'preset', // preset | wood | carpet | tile | concrete
        wallColor: 'preset',  // 'preset' or a #hex
        tableMaterial: 'wood',// wood | glass | marble
        lighting: 'normal',   // normal | warm | cool | neon
        twoDStyle: 'topdown', // topdown = overhead orthographic view of the real 3D scene; flat = CSS diagram
        dragMode: 'select',   // select | doubleselect | direct (3D GL furniture move model)
        walkCameraMode: 'first', // first = first-person | third = third-person follow camera
        // Walk controls (3D). Values are KeyboardEvent.code strings.
        // Defaults use arrow keys + Ctrl/Alt so they don't conflict with page shortcuts (Space=reveal, C=chat, etc.)
        keyBindings: { forward:'ArrowUp', back:'ArrowDown', left:'ArrowLeft', right:'ArrowRight',
                       jump:'AltLeft', crouch:'ControlLeft', interact:'KeyE', walk:'KeyT' }
    };

    var state = {
        root: null,
        stage: null,
        config: loadConfig(),
        participants: [],
        roomState: null
    };
    var _glActive = false;   // true while the WebGL renderer (RS3D) owns the stage

    function loadConfig() {
        try {
            var cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
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

    function currentStoryTitle() {
        var rs = state.roomState || window.roomState || {};
        var id = rs.currentStoryId;
        var stories = rs.stories || [];
        var story = stories.find(function(s) { return s.id === id; });
        return story ? story.title : 'No story selected';
    }

    function participantInitial(name) {
        var clean = String(name || '?').trim();
        return clean ? clean.charAt(0).toUpperCase() : '?';
    }

    function participantSeatStyle(i, count, radiusX, radiusY, centerX, centerY) {
        var angle = -Math.PI / 2 + (Math.PI * 2 * i / Math.max(count, 1));
        var x = centerX + Math.cos(angle) * radiusX;
        var y = centerY + Math.sin(angle) * radiusY;
        return 'left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%;';
    }

    function voteLabel(p) {
        if (p.isGhost) return 'Ghost';
        if (p.isObserver) return 'Observer';
        if (state.roomState && state.roomState.votesRevealed && p.vote) return p.vote;
        if (p.hasVoted) return 'Ready';
        return '...';
    }

    function chairTypeFor2d(i) {
        var ct = state.config.chairType || 'office';
        if (ct === 'random') {
            var types = ['office','gaming','beanbag','stool','throne'];
            return types[(i * 7 + 3) % types.length];
        }
        return ct;
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

    function seatPosStyle(i, count, mode) {
        return mode === '3d'
            ? 'transform: rotateY(' + (i * (360 / Math.max(count, 1))).toFixed(2) + 'deg) translateZ(145px);'
            : participantSeatStyle(i, count, 36, 31, 50, 52);
    }

    // Is this participant the local user? (connectionId-first, name fallback.)
    function _isMe(p) {
        if (!p) return false;
        var myCid = window.ROOM_CONFIG && window.ROOM_CONFIG.connectionId;
        var myName = window.ROOM_CONFIG && window.ROOM_CONFIG.playerName;
        return (myCid && p.connectionId === myCid) || (!myCid && p.name === myName);
    }

    // p may be null → render an empty (unclaimed) chair of the slot's type.
    // Every seat carries data-seat-idx so the delegated click handler can claim it.
    function renderSeat(p, i, count, mode) {
        var chairCls = ' rs-seat-chair-' + chairTypeFor2d(i);
        var style = seatPosStyle(i, count, mode);
        if (!p) {
            return '<div class="rs-seat rs-seat-empty rs-seat-claimable' + chairCls + '" data-seat-idx="' + i + '" style="' + style + '" title="Click to sit here">'
                + '<div class="rs-chair"></div>'
                + '<div class="rs-seat-plus">+</div>'
                + '</div>';
        }
        var isHost = state.roomState && p.connectionId === state.roomState.hostConnectionId;
        var mine = _isMe(p);
        var cls = 'rs-seat' + chairCls + (p.hasVoted ? ' voted' : '') + (p.isObserver ? ' observer' : '') + (p.isGhost ? ' ghost' : '') + (isHost ? ' host' : '') + (mine ? ' rs-seat-mine' : '');
        return '<div class="' + cls + '" data-seat-idx="' + i + '" style="' + style + '" title="' + esc(p.name) + (mine ? ' — click to stand up' : '') + '">'
            + '<div class="rs-chair"></div>'
            + '<div class="rs-avatar">' + esc(participantInitial(p.name)) + '</div>'
            + '<div class="rs-name">' + esc(p.name || 'Guest') + '</div>'
            + '<div class="rs-vote">' + esc(voteLabel(p)) + '</div>'
            + '</div>';
    }

    // 2D chair claiming — parity with 3D. Click an empty chair to claim it (server
    // arbitrates the race), or click your own chair to stand up. Goes through the
    // same RoomSceneNet path as 3D, so 2D and 3D stay in lockstep.
    function claimSeat2d(idx) {
        var plan = seatPlan();
        var occupant = plan.slots[idx] || null;
        if (occupant) {
            if (_isMe(occupant)) {
                if (window.RS3D && RS3D.releaseMySeat) RS3D.releaseMySeat();
            } else if (window.roomState && window.roomState.isHost) {
                // AQ2: host can free someone else's seat.
                if (window.confirm('Free ' + (occupant.name || 'this person') + "'s seat?")) {
                    if (window.RoomSceneNet && RoomSceneNet.hostFreeChair) RoomSceneNet.hostFreeChair(idx);
                }
            }
            return;
        }
        if (window.RoomSceneNet && RoomSceneNet.claimChair) {
            RoomSceneNet.claimChair(idx, null);   // server echo → RS3D.applyClaim → re-render
        } else if (window.RS3D && RS3D.applyClaim) {
            // Offline fallback (no socket): claim locally.
            var myCid = window.ROOM_CONFIG && window.ROOM_CONFIG.connectionId;
            var myName = (window.ROOM_CONFIG && window.ROOM_CONFIG.playerName) || 'Guest';
            RS3D.applyClaim(idx, myName, null, myCid);
        }
    }

    function _onStageClick(e) {
        if (state.config.mode === '3d-gl') return;   // 3D handles its own picking
        if (!e.target.closest) return;
        // Click the flat-diagram whiteboard → open the shared whiteboard.
        if (e.target.closest('.rs-whiteboard-clickable')) {
            if (window.Whiteboard && Whiteboard.open) Whiteboard.open();
            return;
        }
        var seat = e.target.closest('.rs-seat');
        if (!seat || !state.stage.contains(seat)) return;
        var idx = parseInt(seat.getAttribute('data-seat-idx'), 10);
        if (!isNaN(idx)) claimSeat2d(idx);
    }

    // Render the chair ring: each slot is the participant who claimed that
    // chair index (or null for an empty / unclaimed chair).
    function renderSeatRing(plan, mode) {
        var html = '';
        for (var i = 0; i < plan.total; i++) {
            html += renderSeat(plan.slots[i] || null, i, plan.total, mode);
        }
        return html;
    }

    // Overflow participants (more people than chairs) shown standing along the
    // front edge — mirrors the 3D GL "standing robots near the wall" behaviour.
    function renderStanding(list) {
        if (!list || !list.length) return '';
        var items = list.map(function(p) {
            var isHost = state.roomState && p.connectionId === state.roomState.hostConnectionId;
            var cls = 'rs-stand' + (p.hasVoted ? ' voted' : '') + (p.isObserver ? ' observer' : '') + (p.isGhost ? ' ghost' : '') + (isHost ? ' host' : '');
            return '<div class="' + cls + '" title="' + esc(p.name) + ' (standing)">'
                + '<div class="rs-avatar">' + esc(participantInitial(p.name)) + '</div>'
                + '<div class="rs-name">' + esc(p.name || 'Guest') + '</div>'
                + '<div class="rs-vote">' + esc(voteLabel(p)) + '</div>'
                + '</div>';
        }).join('');
        return '<div class="rs-standing" title="Standing — no free chair">' + items + '</div>';
    }

    function renderWhiteboard() {
        if (!state.config.whiteboard) return '';
        var title = currentStoryTitle();
        return '<div class="rs-whiteboard rs-whiteboard-clickable" title="Click to open the shared whiteboard" style="cursor:pointer;">'
            + '<div class="rs-whiteboard-title">Whiteboard ✏️</div>'
            + '<div class="rs-whiteboard-story">' + esc(title) + '</div>'
            + '<div class="rs-whiteboard-line"></div>'
            + '<div class="rs-whiteboard-line short"></div>'
            + '</div>';
    }

    function renderPlants() {
        if (!state.config.plants) return '';
        return '<div class="rs-plant rs-plant-a"><span></span></div>'
            + '<div class="rs-plant rs-plant-b"><span></span></div>';
    }

    function renderSkyline() {
        if (!state.config.skyline) return '';
        return '<div class="rs-window"><div class="rs-skyline"><i></i><i></i><i></i><i></i><i></i></div></div>';
    }

    function render2d() {
        var people = state.participants || [];
        var shape = state.config.tableShape === 'rect' ? 'rect' : 'round';
        var plan = seatPlan();
        return '<div class="rs-room rs-room-2d rs-preset-' + esc(state.config.preset) + '">'
            + renderSkyline()
            + renderWhiteboard()
            + renderPlants()
            + '<div class="rs-rug"></div>'
            + '<div class="rs-table rs-table-' + shape + '"><span>' + esc(people.length) + '</span></div>'
            + '<div class="rs-seats">'
            + renderSeatRing(plan, '2d')
            + '</div>'
            + renderStanding(plan.standing)
            + '</div>';
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
        var lighting   = document.getElementById('rs-lighting');
        var twoDStyle  = document.getElementById('rs-2d-style');
        var dragMode   = document.getElementById('rs-dragmode');
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
        if (lighting)   lighting.value         = state.config.lighting || 'normal';
        if (twoDStyle)  twoDStyle.value        = state.config.twoDStyle  || 'topdown';
        if (dragMode)   dragMode.value         = state.config.dragMode   || 'select';
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
        // Delegated click for 2D chair claiming in the CSS diagram (the stage element
        // persists across re-renders). Top-down WebGL handles its own picking.
        if (!state.stage._rsClaimBound) {
            state.stage.addEventListener('click', _onStageClick);
            state.stage._rsClaimBound = true;
        }
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

    // Whether the WebGL renderer should be active for the current config.
    // 3D always uses it; 2D uses it too unless the user picked the flat CSS diagram.
    function _wantGl() {
        var m = state.config.mode;
        if (m === '3d-gl') return true;
        if (m === '2d' && (state.config.twoDStyle || 'topdown') !== 'flat') return true;
        return false;
    }

    function _renderCss() {
        state.root.classList.remove('room-scene-3d-active');
        state.stage.innerHTML = render2d();
    }

    // Single orchestrator: pick the WebGL view (top-down for 2D, orbit for 3D) or the
    // CSS diagram, initialising / disposing RS3D as needed.
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
                    if (state.config.mode === '2d') { _renderCss(); syncControls(); return; }
                    _showGlError(e.message || 'init error'); return;
                }
                if (ok === false) {
                    if (state.config.mode === '2d') { _renderCss(); syncControls(); return; }
                    _showGlError('WebGL not available in this browser'); return;
                }
                _glActive = true;
                RS3D.syncParticipants(state.participants, state.roomState);
            }
            if (RS3D.setView) RS3D.setView(view);
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
    }

    // Shared (room-level) config fields broadcast to all participants.
    // Personal fields (keyBindings, walkCameraMode, dragMode, twoDStyle, windowImage) are excluded.
    var _SHARED_FIELDS = ['preset','tableShape','tableSize','chairType','chairCount',
        'floorMaterial','wallColor','tableMaterial','lighting',
        'windowView','windowAnimated','windowTimeOfDay','whiteboard','plants'];

    // silent=true: received from another participant — apply locally but don't echo back.
    function updateConfig(patch, silent) {
        state.config = Object.assign({}, state.config, patch || {});
        saveConfig();
        // Broadcast shared fields to other participants unless this is an incoming update.
        if (!silent && window.RoomSceneNet && RoomSceneNet.broadcastSceneConfig) {
            var toShare = {};
            _SHARED_FIELDS.forEach(function(k){ if (patch && patch.hasOwnProperty(k)) toShare[k] = patch[k]; });
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
    }

    function syncParticipants(participants) {
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
        getConfig: function() { return Object.assign({}, state.config); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init('roomScenePanel'); });
    } else {
        init('roomScenePanel');
    }
})();
