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
        windowView: 'skyline',// skyline | beach | mountains | night | forest | none (3D GL window scene)
        dragMode: 'select'    // select | doubleselect | direct (3D GL furniture move model)
    };

    var state = {
        root: null,
        stage: null,
        config: loadConfig(),
        participants: [],
        roomState: null
    };

    function loadConfig() {
        try {
            return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
        } catch (e) {
            return Object.assign({}, DEFAULT_CONFIG);
        }
    }

    function saveConfig() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
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

    // p may be null → render an empty (unclaimed) chair of the slot's type.
    function renderSeat(p, i, count, mode) {
        var chairCls = ' rs-seat-chair-' + chairTypeFor2d(i);
        var style = seatPosStyle(i, count, mode);
        if (!p) {
            return '<div class="rs-seat rs-seat-empty' + chairCls + '" style="' + style + '" title="Empty seat — unclaimed">'
                + '<div class="rs-chair"></div>'
                + '<div class="rs-seat-plus">+</div>'
                + '</div>';
        }
        var isHost = state.roomState && p.connectionId === state.roomState.hostConnectionId;
        var cls = 'rs-seat' + chairCls + (p.hasVoted ? ' voted' : '') + (p.isObserver ? ' observer' : '') + (p.isGhost ? ' ghost' : '') + (isHost ? ' host' : '');
        return '<div class="' + cls + '" style="' + style + '" title="' + esc(p.name) + '">'
            + '<div class="rs-chair"></div>'
            + '<div class="rs-avatar">' + esc(participantInitial(p.name)) + '</div>'
            + '<div class="rs-name">' + esc(p.name || 'Guest') + '</div>'
            + '<div class="rs-vote">' + esc(voteLabel(p)) + '</div>'
            + '</div>';
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
        return '<div class="rs-whiteboard">'
            + '<div class="rs-whiteboard-title">Whiteboard</div>'
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

    function render3d() {
        var shape = state.config.tableShape === 'rect' ? 'rect' : 'round';
        var plan = seatPlan();
        return '<div class="rs-room rs-room-3d rs-preset-' + esc(state.config.preset) + '">'
            + '<div class="rs-scene3d">'
            + '<div class="rs-back-wall">'
            + renderSkyline()
            + renderWhiteboard()
            + '</div>'
            + '<div class="rs-floor">'
            + renderPlants()
            + '<div class="rs-table3d rs-table-' + shape + '"><span></span></div>'
            + '<div class="rs-seat-ring">'
            + renderSeatRing(plan, '3d')
            + '</div>'
            + '</div>'
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
        if (dragMode)   dragMode.value         = state.config.dragMode   || 'select';
    }

    function render() {
        if (!state.stage) return;
        // 3d-gl mode: WebGL canvas managed by room-scene-3d.js — don't overwrite it
        if (state.config.mode === '3d-gl') {
            state.root.classList.remove('room-scene-3d-active');
            syncControls();
            return;
        }
        state.root.classList.toggle('room-scene-3d-active', state.config.mode === '3d');
        state.stage.innerHTML = state.config.mode === '3d' ? render3d() : render2d();
        syncControls();
    }

    function init(rootId) {
        state.root = document.getElementById(rootId || 'roomScenePanel');
        state.stage = document.getElementById('roomSceneStage');
        if (!state.root || !state.stage) return;
        render();
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

    function setMode(mode) {
        var prev = state.config.mode;
        state.config.mode = (mode === '3d' || mode === '3d-gl') ? mode : '2d';
        saveConfig();

        if (mode === '3d-gl') {
            // Tear down any CSS content and hand stage to RS3D
            state.stage.innerHTML = '';
            if (!window.RS3D) {
                _showGlError('room-scene-3d.js not loaded');
            } else if (!window.THREE) {
                _showGlError('Three.js not loaded — check browser console');
            } else {
                try {
                    var ok = RS3D.init(state.stage, state.config);
                    if (ok === false) {
                        _showGlError('WebGL not available in this browser');
                    } else {
                        RS3D.syncParticipants(state.participants, state.roomState);
                    }
                } catch (e) {
                    console.error('[RS3D] init error:', e);
                    _showGlError(e.message || 'Unknown error — see console');
                }
            }
        } else if (prev === '3d-gl' && window.RS3D) {
            // Leaving WebGL mode — dispose renderer
            RS3D.dispose();
        }
        render();
    }

    function updateConfig(patch) {
        state.config = Object.assign({}, state.config, patch || {});
        saveConfig();
        // In 3d-gl mode, refresh the scene geometry in-place (preserves camera position)
        if (state.config.mode === '3d-gl' && window.RS3D) {
            try {
                RS3D.refreshScene(state.config);
                RS3D.syncParticipants(state.participants, state.roomState);
            } catch (e) {
                console.error('[RS3D] refreshScene error:', e);
                _showGlError(e.message || 'Scene refresh error — see console');
            }
            syncControls();
            return;
        }
        render();
    }

    function syncParticipants(participants) {
        state.participants = (participants || []).slice(0, 16);
        if (state.config.mode === '3d-gl' && window.RS3D) {
            RS3D.syncParticipants(state.participants, state.roomState);
            return;
        }
        render();
    }

    function syncRoom(roomState) {
        state.roomState = roomState || null;
        if (state.config.mode === '3d-gl' && window.RS3D) {
            RS3D.syncRoom(state.roomState);
            return;
        }
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
