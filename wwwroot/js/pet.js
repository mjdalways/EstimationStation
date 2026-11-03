// ============================================================
// Feature 11 / P8 — the team pet
// ------------------------------------------------------------
// Lives at PAGE level, not room level: it's registered from _Layout.cshtml alongside
// seasonal.js so the sprite can sit outside the room's DOM entirely, be dragged anywhere on
// screen, and animate without a room re-render ever interrupting it. Its *data* is still
// owned by the room (the hub sends PetUpdated), so this module only ever draws what it's
// told and posts three things back: adopt, rename, enable.
//
// Everything here is 2D inline SVG — no sprite sheets, no canvas, no library. That's the
// point of the 2D choice: shapes are addressable, so a mood, an accessory and a reaction are
// each a CSS class on an element rather than another animation frame to author.
//
// Three hard rules, because a mascot must never get in the way of the actual tool:
//   1. It is `pointer-events:none` except for the sprite itself.
//   2. It hides itself whenever a z-2000 overlay or a Bootstrap modal is up.
//   3. It respects prefers-reduced-motion and document.hidden. It is silent by design —
//      there is no pet sound to mute.
// ============================================================
(function () {
    'use strict';

    var Z = 1900;
    var POS_KEY = 'es_petCorner';
    var HIDE_KEY = 'es_petHidden';

    var _host = null, _spriteEl = null, _bubbleEl = null, _cardEl = null;
    var _pet = null;
    var _enabled = false;
    var _hiddenByViewer = false;
    var _built = false;
    var _bubbleTimer = null;
    var _reactTimer = null;
    var _obscuredPoll = null;
    var _drag = null;

    function _esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _reducedMotion() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { return false; }
    }

    function _isHost() { return !!(window.roomState && roomState.isHost); }

    // ---- the sprite ---------------------------------------------------------------------
    // One SVG per species, all drawn on the same 100×100 grid with the same named parts, so
    // the mood classes and the accessory layer below work identically whichever one is on.

    function _bodySvg(species) {
        switch (species) {
            case 'cat':
                return '<path class="pet-body" d="M28 46 L20 26 L36 36 Q50 32 64 36 L80 26 L72 46 Q84 62 72 76 Q50 88 28 76 Q16 62 28 46Z"/>' +
                       '<path class="pet-ear" d="M24 30 L30 42 L36 34Z"/><path class="pet-ear" d="M76 30 L70 42 L64 34Z"/>';
            case 'dragon':
                return '<path class="pet-body" d="M26 52 Q22 30 42 30 Q50 20 58 30 Q78 30 74 52 Q84 66 70 78 Q50 88 30 78 Q16 66 26 52Z"/>' +
                       '<path class="pet-wing" d="M20 50 Q4 40 10 62 Q16 66 24 60Z"/>' +
                       '<path class="pet-wing" d="M80 50 Q96 40 90 62 Q84 66 76 60Z"/>' +
                       '<path class="pet-horn" d="M40 30 L38 18 L46 28Z"/><path class="pet-horn" d="M60 30 L62 18 L54 28Z"/>';
            case 'owl':
                return '<path class="pet-body" d="M28 44 Q28 22 50 22 Q72 22 72 44 Q80 64 66 78 Q50 86 34 78 Q20 64 28 44Z"/>' +
                       '<path class="pet-ear" d="M30 28 L26 16 L40 24Z"/><path class="pet-ear" d="M70 28 L74 16 L60 24Z"/>' +
                       '<path class="pet-beak" d="M50 52 L44 60 L56 60Z"/>';
            case 'axolotl':
                return '<path class="pet-body" d="M28 48 Q28 28 50 28 Q72 28 72 48 Q80 66 64 78 Q50 84 36 78 Q20 66 28 48Z"/>' +
                       '<path class="pet-frill" d="M26 40 Q10 30 12 44 Q18 48 26 46Z"/>' +
                       '<path class="pet-frill" d="M26 52 Q8 50 14 62 Q20 62 26 58Z"/>' +
                       '<path class="pet-frill" d="M74 40 Q90 30 88 44 Q82 48 74 46Z"/>' +
                       '<path class="pet-frill" d="M74 52 Q92 50 86 62 Q80 62 74 58Z"/>';
            case 'robot':
                return '<rect class="pet-body" x="26" y="30" width="48" height="48" rx="10"/>' +
                       '<rect class="pet-ear" x="18" y="44" width="8" height="18" rx="3"/>' +
                       '<rect class="pet-ear" x="74" y="44" width="8" height="18" rx="3"/>' +
                       '<path class="pet-horn" d="M49 30 L49 18"/><circle class="pet-horn-tip" cx="50" cy="16" r="4"/>';
            default: // blob
                return '<path class="pet-body" d="M24 56 Q24 28 50 28 Q76 28 76 56 Q82 76 62 82 Q50 86 38 82 Q18 76 24 56Z"/>';
        }
    }

    function _accessorySvg(list) {
        var has = {};
        (list || []).forEach(function (a) { has[a] = true; });
        var out = '';
        if (has.cape) out += '<path class="pet-acc pet-cape" d="M30 46 Q18 70 26 86 Q50 92 74 86 Q82 70 70 46 Q50 56 30 46Z"/>';
        if (has.scarf) out += '<path class="pet-acc pet-scarf" d="M32 64 Q50 72 68 64 L68 72 Q50 80 32 72Z"/>' +
                              '<path class="pet-acc pet-scarf" d="M62 70 L72 86 L64 88 L58 74Z"/>';
        if (has.glasses) out += '<circle class="pet-acc pet-glass" cx="40" cy="50" r="9"/>' +
                                '<circle class="pet-acc pet-glass" cx="60" cy="50" r="9"/>' +
                                '<path class="pet-acc pet-glass-bridge" d="M49 50 L51 50"/>';
        if (has.hat) out += '<path class="pet-acc pet-hat" d="M28 30 L72 30 L64 12 L36 12Z"/><rect class="pet-acc pet-hat-brim" x="22" y="28" width="56" height="6" rx="3"/>';
        if (has.crown) out += '<path class="pet-acc pet-crown" d="M32 24 L38 12 L44 20 L50 8 L56 20 L62 12 L68 24Z"/>';
        return out;
    }

    function _spriteSvg() {
        var species = (_pet && _pet.species) || 'blob';
        return '<svg viewBox="0 0 100 100" class="pet-svg" aria-hidden="true">' +
            '<ellipse class="pet-shadow" cx="50" cy="90" rx="26" ry="5"/>' +
            '<g class="pet-rig">' +
                _bodySvg(species) +
                '<g class="pet-face">' +
                    '<circle class="pet-eye pet-eye-l" cx="40" cy="50" r="5"/>' +
                    '<circle class="pet-eye pet-eye-r" cx="60" cy="50" r="5"/>' +
                    '<path class="pet-mouth" d="M42 64 Q50 70 58 64"/>' +
                '</g>' +
                _accessorySvg(_pet && _pet.accessories) +
            '</g>' +
            '</svg>';
    }

    // ---- placement ----------------------------------------------------------------------

    function _loadCorner() {
        try {
            var raw = localStorage.getItem(POS_KEY);
            if (!raw) return { x: null, y: null };
            var p = JSON.parse(raw);
            return { x: typeof p.x === 'number' ? p.x : null, y: typeof p.y === 'number' ? p.y : null };
        } catch (e) { return { x: null, y: null }; }
    }

    function _saveCorner(x, y) {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y })); } catch (e) {}
    }

    function _applyCorner() {
        if (!_host) return;
        var p = _loadCorner();
        var w = 96, h = 96;
        var maxX = Math.max(0, window.innerWidth - w - 8);
        var maxY = Math.max(0, window.innerHeight - h - 8);
        var x = p.x === null ? maxX : Math.min(maxX, Math.max(8, p.x));
        var y = p.y === null ? maxY - 40 : Math.min(maxY, Math.max(8, p.y));
        _host.style.left = x + 'px';
        _host.style.top = y + 'px';
    }

    // ---- visibility ---------------------------------------------------------------------

    // The pet must never sit on top of a dialog. Rather than enumerate every overlay by id,
    // this asks the DOM what is actually visible above it — new overlays are covered for free.
    function _obscured() {
        if (document.querySelector('.modal.show')) return true;
        var ids = ['#retro-overlay', '#standup-overlay', '#recap-overlay', '#connections-overlay',
                   '#jumble-overlay', '#wordle-overlay', '#crossword-overlay', '#hangman-overlay',
                   '#wordsearch-overlay', '#spellingbee-overlay', '#acrostic-overlay', '#leaderboard-overlay'];
        for (var i = 0; i < ids.length; i++) {
            var el = document.querySelector(ids[i]);
            if (el && el.style.display && el.style.display !== 'none') return true;
        }
        return false;
    }

    function _shouldShow() {
        return _enabled && !!_pet && !_hiddenByViewer && !_obscured();
    }

    function _applyVisibility() {
        if (!_host) return;
        var show = _shouldShow();
        _host.style.display = show ? 'block' : 'none';
        // Idle animation is pure decoration; it stops whenever nobody is looking.
        var idle = show && !document.hidden && !_reducedMotion();
        _host.classList.toggle('pet-idle', idle);
    }

    // ---- build --------------------------------------------------------------------------

    function _build() {
        if (_built) return;
        _built = true;

        try { _hiddenByViewer = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) {}

        _host = document.createElement('div');
        _host.id = 'team-pet';
        _host.style.cssText = 'position:fixed;z-index:' + Z + ';width:96px;height:96px;display:none;' +
            'pointer-events:none;user-select:none;touch-action:none;';

        _spriteEl = document.createElement('div');
        _spriteEl.className = 'pet-sprite';
        // The sprite is the ONLY thing in here that takes pointer events.
        _spriteEl.style.cssText = 'width:96px;height:96px;pointer-events:auto;cursor:grab;';
        _host.appendChild(_spriteEl);

        _bubbleEl = document.createElement('div');
        _bubbleEl.className = 'pet-bubble';
        _bubbleEl.style.display = 'none';
        _host.appendChild(_bubbleEl);

        document.body.appendChild(_host);

        _cardEl = document.createElement('div');
        _cardEl.id = 'team-pet-card';
        _cardEl.className = 'pet-card';
        _cardEl.style.cssText = 'position:fixed;z-index:' + (Z + 1) + ';display:none;';
        document.body.appendChild(_cardEl);

        _wireDrag();
        _spriteEl.addEventListener('click', function (e) {
            if (_drag && _drag.moved) return;   // a drag shouldn't also open the card
            e.stopPropagation();
            _toggleCard();
        });
        document.addEventListener('pointerdown', function (e) {
            if (_cardEl.style.display !== 'none' && !_cardEl.contains(e.target) && e.target !== _spriteEl
                && !_spriteEl.contains(e.target)) _hideCard();
        });

        window.addEventListener('resize', _applyCorner);
        document.addEventListener('visibilitychange', _applyVisibility);
        // Overlays open and close without telling anyone, so visibility is polled — cheaply,
        // and only while the pet is switched on.
        _obscuredPoll = setInterval(_applyVisibility, 600);

        _applyCorner();
    }

    function _wireDrag() {
        _spriteEl.addEventListener('pointerdown', function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            var rect = _host.getBoundingClientRect();
            _drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
            _spriteEl.style.cursor = 'grabbing';
            try { _spriteEl.setPointerCapture(e.pointerId); } catch (err) {}
        });
        _spriteEl.addEventListener('pointermove', function (e) {
            if (!_drag) return;
            var x = e.clientX - _drag.dx, y = e.clientY - _drag.dy;
            if (Math.abs(x - _host.offsetLeft) > 2 || Math.abs(y - _host.offsetTop) > 2) _drag.moved = true;
            _host.style.left = Math.min(window.innerWidth - 96, Math.max(0, x)) + 'px';
            _host.style.top = Math.min(window.innerHeight - 96, Math.max(0, y)) + 'px';
            _hideCard();
        });
        function endDrag(e) {
            if (!_drag) return;
            _spriteEl.style.cursor = 'grab';
            if (_drag.moved) _saveCorner(_host.offsetLeft, _host.offsetTop);
            var wasMoved = _drag.moved;
            try { _spriteEl.releasePointerCapture(e.pointerId); } catch (err) {}
            // Cleared on the next tick so the click handler can still see `moved`.
            setTimeout(function () { _drag = null; }, 0);
            if (!wasMoved) return;
        }
        _spriteEl.addEventListener('pointerup', endDrag);
        _spriteEl.addEventListener('pointercancel', endDrag);
    }

    // ---- render -------------------------------------------------------------------------

    function _render() {
        if (!_built) _build();
        if (!_pet) { _applyVisibility(); return; }
        _spriteEl.innerHTML = _spriteSvg();
        _spriteEl.className = 'pet-sprite pet-species-' + _esc(_pet.species || 'blob') +
            ' pet-mood-' + _esc(_pet.mood || 'content');
        _spriteEl.title = (_pet.name || 'The team pet') + ' — level ' + (_pet.level || 1) + ', ' + (_pet.mood || 'content');
        _applyVisibility();
        if (_cardEl.style.display !== 'none') _renderCard();
    }

    function _say(text, ms) {
        if (!_bubbleEl || !text) return;
        _bubbleEl.textContent = text;
        _bubbleEl.style.display = 'block';
        if (_bubbleTimer) clearTimeout(_bubbleTimer);
        _bubbleTimer = setTimeout(function () { _bubbleEl.style.display = 'none'; }, ms || 3500);
    }

    // ---- detail card --------------------------------------------------------------------

    var MOOD_TEXT = {
        thriving: 'Thriving — the team has been busy and the actions are moving.',
        happy: 'Happy.',
        content: 'Content.',
        restless: 'Restless — some retro actions are getting old.',
        sulking: 'Sulking — actions have aged across a few retros, or it has been very quiet.'
    };

    function _renderCard() {
        if (!_pet) { _cardEl.innerHTML = ''; return; }
        var pct = _pet.xpPerLevel ? Math.round(100 * (_pet.xpIntoLevel || 0) / _pet.xpPerLevel) : 0;
        var acc = (_pet.accessories || []);
        var html =
            '<div class="pet-card-head">' +
                '<strong>' + _esc(_pet.name || 'Team pet') + '</strong>' +
                '<span class="pet-card-lvl">Lv ' + (_pet.level || 1) + '</span>' +
                '<button class="pet-card-x" id="pet-card-close" title="Close">✕</button>' +
            '</div>' +
            '<div class="pet-card-mood">' + _esc(MOOD_TEXT[_pet.mood] || _pet.mood || '') + '</div>' +
            '<div class="pet-xp"><div class="pet-xp-fill" style="width:' + pct + '%;"></div></div>' +
            '<div class="pet-card-xp-text">' + (_pet.xpIntoLevel || 0) + ' / ' + (_pet.xpPerLevel || 0) + ' XP</div>' +
            (acc.length ? '<div class="pet-card-acc">Unlocked: ' + _esc(acc.join(', ')) + '</div>' : '') +
            '<div class="pet-card-log">' + ((_pet.log || []).length
                ? (_pet.log || []).slice(0, 8).map(function (e) {
                    return '<div class="pet-log-row"><span class="pet-log-delta' + (e.delta < 0 ? ' pet-log-neg' : '') + '">' +
                        (e.delta > 0 ? '+' : '') + e.delta + '</span><span>' + _esc(e.note || e.kind) + '</span></div>';
                }).join('')
                : '<div class="pet-log-row">Nothing yet.</div>') + '</div>' +
            '<div class="pet-card-foot">' +
                (_isHost() ? '<button class="btn btn-sm btn-outline-secondary" id="pet-rename">✏️ Rename</button>' : '') +
                '<button class="btn btn-sm btn-outline-secondary" id="pet-hide" title="Hides it for you only, on this device">🙈 Hide for me</button>' +
            '</div>';
        _cardEl.innerHTML = html;

        var c = _cardEl.querySelector('#pet-card-close');
        if (c) c.addEventListener('click', _hideCard);
        var r = _cardEl.querySelector('#pet-rename');
        if (r) r.addEventListener('click', function () {
            var name = prompt('Name the pet', _pet.name || '');
            if (name && name.trim() && window.PetNet) PetNet.rename(name.trim());
        });
        var h = _cardEl.querySelector('#pet-hide');
        if (h) h.addEventListener('click', function () {
            _hiddenByViewer = true;
            try { localStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
            _hideCard();
            _applyVisibility();
        });
    }

    function _toggleCard() {
        if (_cardEl.style.display === 'none') {
            _renderCard();
            _cardEl.style.display = 'block';
            var r = _host.getBoundingClientRect();
            var w = 260;
            var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
            _cardEl.style.left = left + 'px';
            _cardEl.style.width = w + 'px';
            // Above if there's no room below, which there usually isn't in the resting corner.
            var below = window.innerHeight - r.bottom;
            if (below > 240) { _cardEl.style.top = (r.bottom + 8) + 'px'; _cardEl.style.bottom = 'auto'; }
            else { _cardEl.style.bottom = (window.innerHeight - r.top + 8) + 'px'; _cardEl.style.top = 'auto'; }
        } else {
            _hideCard();
        }
    }

    function _hideCard() { if (_cardEl) _cardEl.style.display = 'none'; }

    // ---- reactions ----------------------------------------------------------------------

    var REACTIONS = {
        consensus: { cls: 'pet-react-cheer', say: '🎯 Nailed it!' },
        vote: { cls: 'pet-react-bounce', say: null },
        reveal: { cls: 'pet-react-bounce', say: null },
        retro: { cls: 'pet-react-cheer', say: '🔁 Good retro.' },
        prediction: { cls: 'pet-react-spin', say: '🔮 Called it!' },
        action: { cls: 'pet-react-cheer', say: '✅ Action done.' },
        levelup: { cls: 'pet-react-spin', say: '⭐ Level up!' },
        sad: { cls: 'pet-react-wilt', say: null }
    };

    // Called from room.js at interesting moments. Cosmetic only — it never sends anything.
    function react(kind) {
        if (!_shouldShow()) return;
        var r = REACTIONS[kind] || REACTIONS.vote;
        if (!_reducedMotion()) {
            _spriteEl.classList.remove('pet-react-cheer', 'pet-react-bounce', 'pet-react-spin', 'pet-react-wilt');
            // Force a reflow so the same class re-triggers its animation back-to-back.
            void _spriteEl.offsetWidth;
            _spriteEl.classList.add(r.cls);
            if (_reactTimer) clearTimeout(_reactTimer);
            _reactTimer = setTimeout(function () { _spriteEl.classList.remove(r.cls); }, 1400);
        }
        if (r.say) _say(r.say);
    }

    // ---- adoption -----------------------------------------------------------------------

    var SPECIES = ['blob', 'cat', 'dragon', 'owl', 'axolotl', 'robot'];
    var SPECIES_EMOJI = { blob: '🫧', cat: '🐱', dragon: '🐉', owl: '🦉', axolotl: '🦎', robot: '🤖' };

    // Only shown on request (the room settings toggle), and only to the host — nobody should
    // get an adoption dialog thrown at them for joining a room.
    function openAdopt() {
        if (typeof window._f11Modal !== 'function') return;
        var body = '<div class="pet-adopt-grid">' + SPECIES.map(function (s, i) {
            return '<label class="pet-adopt-opt"><input type="radio" name="pet-species" value="' + s + '"' +
                (i === 0 ? ' checked' : '') + '><span>' + (SPECIES_EMOJI[s] || '') + ' ' + s + '</span></label>';
        }).join('') + '</div>' +
        '<label class="f11-field"><span>Name</span><input id="pet-adopt-name" class="form-control form-control-sm" maxlength="24" placeholder="Sprintacus"></label>';

        var host = window._f11Modal('Adopt a team pet', body, [
            {
                label: 'Adopt', cls: 'btn-primary', onClick: function (m) {
                    var sel = m.querySelector('input[name="pet-species"]:checked');
                    var name = m.querySelector('#pet-adopt-name').value.trim();
                    if (!name) return false;
                    if (window.PetNet) PetNet.adopt(sel ? sel.value : 'blob', name);
                }
            }
        ]);
        return host;
    }

    // ---- incoming -----------------------------------------------------------------------

    function onUpdated(pet, note) {
        var prevLevel = _pet ? _pet.level : null;
        _pet = pet || null;
        _render();
        if (_pet && prevLevel !== null && _pet.level > prevLevel) react('levelup');
        else if (note) _say(note);
    }

    function onEnabledUpdated(enabled, pet) {
        _enabled = !!enabled;
        if (pet !== undefined) _pet = pet || null;
        if (_enabled) _build();
        _render();
        var cb = document.getElementById('petEnabledCheck');
        if (cb) cb.checked = _enabled;
        // Switching it on in a room that has never had a pet is the natural moment to ask.
        if (_enabled && !_pet && _isHost()) openAdopt();
    }

    function setEnabled(enabled) {
        if (window.PetNet) PetNet.setEnabled(!!enabled);
    }

    function loadState(state) {
        state = state || {};
        _enabled = state.petEnabled === true;
        _pet = state.pet || null;
        if (_enabled) _build();
        if (_built) _render();
        var cb = document.getElementById('petEnabledCheck');
        if (cb) cb.checked = _enabled;
    }

    window.Pet = {
        loadState: loadState, onUpdated: onUpdated, onEnabledUpdated: onEnabledUpdated,
        react: react, setEnabled: setEnabled, openAdopt: openAdopt,
        show: function () {
            _hiddenByViewer = false;
            try { localStorage.removeItem('es_petHidden'); } catch (e) {}
            _applyVisibility();
        }
    };
}());
