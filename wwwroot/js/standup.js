// ============================================================
// Feature 11 / P5 — Standup (round robin)
// ------------------------------------------------------------
// A timed pass around the room: whose turn it is, a per-person timer, and the three notes
// everyone fills in beforehand (yesterday / today / blockers). The order and the current
// index live on the server so every screen agrees on whose turn it is — this module renders
// what StandupUpdated sends and never advances itself.
//
// Notes are deliberately public: they are read out loud anyway, and having them visible
// while somebody talks is the point. A blocker can be pushed straight onto the retro board.
// ============================================================
(function () {
    'use strict';

    var _root = null, _built = false;
    var _bodyEl = null, _startEl = null, _liveEl = null, _notesEl = null;
    var _orderSelect = null, _secondsInput = null;
    var _tickHandle = null;

    var _st = null;            // the StandupPayload, verbatim
    var _limits = { min: 15, max: 600 };
    var _noteDraftTimer = null;

    function _esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _me() { return (window.ROOM_CONFIG && ROOM_CONFIG.playerName) || ''; }
    function _isHost() { return !!(window.roomState && roomState.isHost); }

    function _secondsLeft() {
        if (!_st || !_st.active || !_st.turnStartedAtUtc) return null;
        var started = Date.parse(_st.turnStartedAtUtc);
        if (!isFinite(started)) return null;
        var elapsed = (Date.now() - started) / 1000;
        return Math.max(0, Math.round((_st.secondsPerPerson || 90) - elapsed));
    }

    function _mmss(s) {
        s = Math.max(0, Math.round(s || 0));
        var m = Math.floor(s / 60), r = s % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    // ---- rendering ---------------------------------------------------------------------

    function _renderStart() {
        if (!_startEl) return;
        var active = !!(_st && _st.active);
        _startEl.style.display = active ? 'none' : '';
        if (active) return;
        if (!_isHost()) {
            _startEl.innerHTML = '<div class="standup-idle">No standup running. The host can start one.</div>';
            return;
        }
        _startEl.innerHTML =
            '<div class="standup-idle">' +
            '<div style="font-weight:600;margin-bottom:8px;">Start a round robin</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;">' +
            '<select id="su-order" class="form-select form-select-sm" style="width:auto;">' +
            '<option value="seating">🪑 Seating order</option>' +
            '<option value="list">📋 Participant list</option>' +
            '<option value="shuffle">🔀 Shuffle</option>' +
            '</select>' +
            '<label style="font-size:0.82rem;">Seconds each ' +
            '<input id="su-seconds" type="number" class="form-control form-control-sm" style="width:88px;display:inline-block;" ' +
            'min="' + _limits.min + '" max="' + _limits.max + '" value="90"></label>' +
            '<button id="su-start" class="btn btn-sm btn-primary">▶️ Start</button>' +
            '</div></div>';
        _orderSelect = _startEl.querySelector('#su-order');
        _secondsInput = _startEl.querySelector('#su-seconds');
        _startEl.querySelector('#su-start').addEventListener('click', function () {
            var secs = parseInt(_secondsInput.value, 10);
            if (!isFinite(secs)) secs = 90;
            if (window.StandupNet) StandupNet.start(_orderSelect.value, secs);
        });
    }

    function _renderLive() {
        if (!_liveEl) return;
        var active = !!(_st && _st.active);
        _liveEl.style.display = active ? '' : 'none';
        if (!active) { _stopTick(); return; }

        var done = {}, skipped = {};
        (_st.done || []).forEach(function (n) { done[n] = true; });
        (_st.skipped || []).forEach(function (n) { skipped[n] = true; });

        var left = _secondsLeft();
        var over = left !== null && left <= 0;
        var current = _st.current || '';
        var note = (_st.notes || {})[current] || {};

        var html = '<div class="standup-now' + (over ? ' standup-now-over' : '') + '">' +
            '<div class="standup-now-label">Now speaking</div>' +
            '<div class="standup-now-name">' + _esc(current || '—') + '</div>' +
            '<div class="standup-now-timer">' + (left === null ? '' : _mmss(left)) + '</div>' +
            '</div>';

        html += '<div class="standup-now-notes">' +
            '<div><span class="standup-note-label">Yesterday</span><div>' + (_esc(note.yesterday) || '<span class="text-muted">—</span>') + '</div></div>' +
            '<div><span class="standup-note-label">Today</span><div>' + (_esc(note.today) || '<span class="text-muted">—</span>') + '</div></div>' +
            '<div><span class="standup-note-label">Blockers</span><div>' + (_esc(note.blockers) || '<span class="text-muted">—</span>') + '</div>' +
            (note.blockers ? '<button class="btn btn-sm btn-outline-danger mt-1" id="su-blocker">🔁 Send to retro</button>' : '') +
            '</div></div>';

        if (_isHost()) {
            html += '<div class="standup-controls">' +
                '<button class="btn btn-sm btn-outline-secondary" id="su-prev">⬅️ Back</button>' +
                '<button class="btn btn-sm btn-outline-warning" id="su-skip">⏭️ Skip</button>' +
                '<button class="btn btn-sm btn-primary" id="su-next">Next ➡️</button>' +
                '<button class="btn btn-sm btn-outline-danger" id="su-stop">⏹️ End</button>' +
                '</div>';
        }

        html += '<div class="standup-order">' + (_st.order || []).map(function (n, i) {
            var cls = 'standup-pip';
            if (i === _st.currentIndex) cls += ' standup-pip-current';
            else if (skipped[n]) cls += ' standup-pip-skipped';
            else if (done[n]) cls += ' standup-pip-done';
            return '<span class="' + cls + '" title="' + _esc(n) + '">' + _esc(n) + '</span>';
        }).join('') + '</div>';

        _liveEl.innerHTML = html;

        var b = _liveEl.querySelector('#su-blocker');
        if (b) b.addEventListener('click', function () {
            if (window.StandupNet) StandupNet.blockerToRetro(note.blockers);
            b.disabled = true;
            b.textContent = '✅ Added to retro';
        });
        function wire(id, fn) { var el = _liveEl.querySelector(id); if (el) el.addEventListener('click', fn); }
        wire('#su-prev', function () { StandupNet.advance(-1, false); });
        wire('#su-next', function () { StandupNet.advance(1, false); });
        wire('#su-skip', function () { StandupNet.advance(1, true); });
        wire('#su-stop', function () { StandupNet.stop(); });

        _startTick();
    }

    function _renderNotes() {
        if (!_notesEl) return;
        var mine = ((_st && _st.notes) || {})[_me()] || {};
        // Only rebuild the form when it isn't already there, so typing survives a broadcast.
        if (!_notesEl.querySelector('#su-y')) {
            _notesEl.innerHTML =
                '<h6 class="standup-section-title">Your update</h6>' +
                '<label class="standup-field"><span>Yesterday</span><textarea id="su-y" class="form-control form-control-sm" rows="2"></textarea></label>' +
                '<label class="standup-field"><span>Today</span><textarea id="su-t" class="form-control form-control-sm" rows="2"></textarea></label>' +
                '<label class="standup-field"><span>Blockers</span><textarea id="su-b" class="form-control form-control-sm" rows="2"></textarea></label>' +
                '<div class="standup-saved" id="su-saved"></div>';
            ['#su-y', '#su-t', '#su-b'].forEach(function (sel) {
                _notesEl.querySelector(sel).addEventListener('input', _queueNoteSave);
            });
            _notesEl.querySelector('#su-y').value = mine.yesterday || '';
            _notesEl.querySelector('#su-t').value = mine.today || '';
            _notesEl.querySelector('#su-b').value = mine.blockers || '';
        } else if (document.activeElement && _notesEl.contains(document.activeElement)) {
            // Mid-edit: leave the boxes alone.
            return;
        } else {
            _notesEl.querySelector('#su-y').value = mine.yesterday || '';
            _notesEl.querySelector('#su-t').value = mine.today || '';
            _notesEl.querySelector('#su-b').value = mine.blockers || '';
        }
    }

    // Debounced: a standup note is typed a sentence at a time and the server re-broadcasts
    // every save, so sending per keystroke would spam every screen in the room.
    function _queueNoteSave() {
        if (_noteDraftTimer) clearTimeout(_noteDraftTimer);
        var saved = _notesEl.querySelector('#su-saved');
        if (saved) saved.textContent = 'Saving…';
        _noteDraftTimer = setTimeout(function () {
            _noteDraftTimer = null;
            if (!window.StandupNet) return;
            StandupNet.setNote(
                _notesEl.querySelector('#su-y').value,
                _notesEl.querySelector('#su-t').value,
                _notesEl.querySelector('#su-b').value);
            if (saved) {
                saved.textContent = '✓ Saved';
                setTimeout(function () { if (saved.textContent === '✓ Saved') saved.textContent = ''; }, 2000);
            }
        }, 700);
    }

    function _render() {
        _renderStart();
        _renderLive();
        _renderNotes();
    }

    function _startTick() {
        if (_tickHandle) return;
        _tickHandle = setInterval(function () {
            if (!_root || _root.style.display !== 'flex' || !_st || !_st.active) { _stopTick(); return; }
            var el = _root.querySelector('.standup-now-timer');
            var wrap = _root.querySelector('.standup-now');
            var left = _secondsLeft();
            if (el && left !== null) el.textContent = _mmss(left);
            if (wrap) wrap.classList.toggle('standup-now-over', left !== null && left <= 0);
        }, 1000);
    }

    function _stopTick() {
        if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
    }

    // ---- shell -------------------------------------------------------------------------

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'standup-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.35);' +
            'width:min(94vw,560px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e5e7eb;';
        bar.innerHTML = '<div style="font-weight:700;flex:1;">🎤 Standup</div>' +
            '<button type="button" class="btn btn-sm btn-secondary" id="su-close">✕ Close</button>';
        panel.appendChild(bar);

        _bodyEl = document.createElement('div');
        _bodyEl.className = 'standup-body';
        _bodyEl.style.cssText = 'padding:14px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;';
        _startEl = document.createElement('div');
        _liveEl = document.createElement('div');
        _liveEl.style.display = 'none';
        _notesEl = document.createElement('div');
        _bodyEl.appendChild(_startEl);
        _bodyEl.appendChild(_liveEl);
        _bodyEl.appendChild(_notesEl);
        panel.appendChild(_bodyEl);

        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#su-close').addEventListener('click', close);
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { _stopTick(); if (_root) _root.style.display = 'none'; }

    // ---- incoming ----------------------------------------------------------------------

    function onUpdated(payload) {
        _st = payload || null;
        if (_root && _root.style.display === 'flex') _render();
        else if (_st && _st.active && _st.current === _me()) {
            // Your turn while the panel is closed is worth surfacing; the toast helper is
            // room.js's, so it is guarded rather than assumed.
            if (typeof window._showToastAD === 'function') window._showToastAD('🎤 Your turn to speak', 'info');
        }
    }

    function onFinished() {
        if (_st) _st.active = false;
        _stopTick();
        if (_root && _root.style.display === 'flex') _render();
    }

    function loadState(state) {
        state = state || {};
        _st = state.standup || null;
        if (state.standupLimits) _limits = state.standupLimits;
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Standup = {
        open: open, close: close, onUpdated: onUpdated, onFinished: onFinished, loadState: loadState
    };
}());
