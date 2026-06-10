// ============================================================
// Room Scene Store — single shared-state container for the room scene.
// Plain pub/sub, no framework dependency: { getState(), set(), subscribe(), select() }.
//
// State shape: { config, claims, chairPos, furniture, participants, roomState }
//
// Network rule (stated once here): a set() with meta.source === 'local' is a change
// this client originated — a subscriber MAY broadcast it to other participants.
// meta.source === 'remote' means the change came from another participant or the
// server's snapshot — it must NEVER be re-broadcast. meta.source === 'init' is the
// initial seed on page load (no save/broadcast/refresh side effects).
//
// Roamer (free-roam avatar) positions are intentionally NOT part of this store — they
// update ~10x/sec and stay internal to RS3D to avoid flooding subscribers.
//
// claims / chairPos / furniture currently mirror RS3D's internal state (kept in sync
// at RS3D's existing mutation funnels) so other modules have a single place to read
// them; RS3D's own broadcast calls (claimChair/setChairPositions/setLayout, etc.) are
// unchanged and remain the source of truth for network sync of those slices.
// ============================================================
(function () {
    'use strict';

    // Room-level config fields broadcast to all participants. Single source of truth —
    // room-scene.js and room.js both read this instead of keeping their own copies.
    var SHARED_FIELDS = ['preset','tableShape','tableSize','chairType','chairCount',
        'floorMaterial','wallColor','tableMaterial','lighting',
        'windowView','windowAnimated','windowTimeOfDay','whiteboard','plants',
        'windowMediaId','windowMediaMime','roomSize','floorColor'];

    var _state = {
        config: {},
        claims: {},
        chairPos: {},
        furniture: [],
        participants: [],
        roomState: null
    };
    var _subscribers = [];

    function getState() {
        return _state;
    }

    function set(partial, meta) {
        _state = Object.assign({}, _state, partial || {});
        var m = Object.assign({ source: 'local', fields: [] }, meta || {});
        _subscribers.forEach(function (fn) {
            try { fn(_state, m); } catch (e) { console.error('[RoomSceneStore] subscriber error:', e); }
        });
    }

    function subscribe(fn) {
        _subscribers.push(fn);
        return function unsubscribe() {
            var i = _subscribers.indexOf(fn);
            if (i !== -1) _subscribers.splice(i, 1);
        };
    }

    function select(fn) {
        return fn(_state);
    }

    window.RoomSceneStore = {
        SHARED_FIELDS: SHARED_FIELDS,
        getState: getState,
        set: set,
        subscribe: subscribe,
        select: select
    };
})();
