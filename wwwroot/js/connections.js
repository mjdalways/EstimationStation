// ============================================================
// In-room game #9 — Connections. A grid of words hides N categories; find them a group at a
// time, with a budget of wrong guesses. One puzzle per room per UTC day.
//
// Same private/coop split as Jumble: in competitive mode the result of a guess comes back to
// the caller alone (so nobody can read a neighbour's screen for free) and finishers feed the
// daily leaderboard; in coop the whole room shares one board and every result is broadcast.
// The category memberships never leave the server until they're solved or the game is over —
// see Hubs/PokerHub.cs ConnectionsStatePayload / ConnectionsSubmit.
// ============================================================
(function () {
    'use strict';

    var _root = null, _built = false;
    var _gridEl = null, _msgEl = null, _solvedEl = null, _mistakesEl = null,
        _statusEl = null, _statusWrap = null, _newGameBtn = null, _modeSelect = null,
        _submitBtn = null, _shuffleBtn = null, _clearBtn = null, _actionsEl = null;
    var _setupEl = null, _gameEls = [], _needsSetup = false;

    var _words = [];           // the full grid, as sent
    var _order = [];           // display order (shuffle only reorders this)
    var _selected = [];        // currently-selected words
    var _solvedGroups = [];    // [{ name, difficulty, words }]
    var _mistakes = 0;
    var _mistakesAllowed = 4;
    var _perCategory = 4;
    var _completed = false, _failed = false;
    var _mode = 'competitive';
    var _puzzleId = null;
    var _statuses = {};        // name -> { name, mistakes }
    var _pending = false;

    // Difficulty 0..3, easiest first — the familiar yellow/green/blue/purple ladder.
    var DIFF_COLOURS = ['#f9df6d', '#a0c35a', '#b0c4ef', '#ba81c5'];

    function _esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _solvedWordSet() {
        var set = {};
        _solvedGroups.forEach(function (g) {
            (g.words || []).forEach(function (w) { set[String(w).toUpperCase()] = true; });
        });
        return set;
    }

    function _reflowOrder() {
        // Solved words leave the grid entirely (they're drawn as banded rows above it), so
        // the order list only ever holds what's still in play.
        var solved = _solvedWordSet();
        var kept = _order.filter(function (w) { return !solved[String(w).toUpperCase()]; });
        var known = {};
        kept.forEach(function (w) { known[w] = true; });
        _words.forEach(function (w) {
            if (!known[w] && !solved[String(w).toUpperCase()]) { kept.push(w); known[w] = true; }
        });
        _order = kept;
        _selected = _selected.filter(function (w) { return known[w]; });
    }

    function _shuffle() {
        for (var i = _order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = _order[i]; _order[i] = _order[j]; _order[j] = t;
        }
        _renderGrid();
    }

    function _toggle(word) {
        if (_completed || _failed || _pending) return;
        var i = _selected.indexOf(word);
        if (i >= 0) _selected.splice(i, 1);
        else if (_selected.length < _perCategory) _selected.push(word);
        _renderGrid();
        _renderActions();
    }

    function _submit() {
        if (_pending || _selected.length !== _perCategory) return;
        _pending = true;
        _renderActions();
        if (window.ConnectionsNet && ConnectionsNet.submit) ConnectionsNet.submit(_selected.slice());
        // The server always answers (correct or not); this is only a guard against the
        // double-click, so it self-clears if a reply never arrives.
        setTimeout(function () { if (_pending) { _pending = false; _renderActions(); } }, 4000);
    }

    // ---- rendering ---------------------------------------------------------------------

    function _renderSolved() {
        if (!_solvedEl) return;
        var groups = _solvedGroups.slice().sort(function (a, b) { return (a.difficulty || 0) - (b.difficulty || 0); });
        _solvedEl.innerHTML = groups.map(function (g) {
            var bg = DIFF_COLOURS[Math.max(0, Math.min(3, g.difficulty || 0))];
            return '<div class="cx-band" style="background:' + bg + ';">' +
                '<div class="cx-band-name">' + _esc(g.name) + '</div>' +
                '<div class="cx-band-words">' + _esc((g.words || []).join(', ')) + '</div>' +
                '</div>';
        }).join('');
        _solvedEl.style.display = groups.length ? 'flex' : 'none';
    }

    function _renderGrid() {
        if (!_gridEl) return;
        _gridEl.innerHTML = '';
        // Keep the grid the puzzle's own width rather than assuming 4 — the category count
        // and words-per-category are both room settings.
        _gridEl.style.gridTemplateColumns = 'repeat(' + Math.max(2, _perCategory) + ', minmax(0,1fr))';
        _order.forEach(function (w) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cx-word' + (_selected.indexOf(w) >= 0 ? ' cx-word-sel' : '');
            btn.textContent = w;
            btn.disabled = _completed || _failed;
            btn.addEventListener('click', function () { _toggle(w); });
            _gridEl.appendChild(btn);
        });
    }

    function _renderActions() {
        if (_submitBtn) {
            _submitBtn.disabled = _pending || _completed || _failed || _selected.length !== _perCategory;
            _submitBtn.textContent = _pending ? 'Checking…' : ('Submit (' + _selected.length + '/' + _perCategory + ')');
        }
        if (_clearBtn) _clearBtn.disabled = _selected.length === 0;
        if (_shuffleBtn) _shuffleBtn.disabled = _completed || _failed;
        if (_actionsEl) _actionsEl.style.display = (_completed || _failed) ? 'none' : '';
        if (_mistakesEl) {
            var left = Math.max(0, _mistakesAllowed - _mistakes);
            _mistakesEl.innerHTML = 'Mistakes remaining: ' +
                new Array(left + 1).join('<span class="cx-life">●</span>') +
                new Array(Math.max(0, _mistakes) + 1).join('<span class="cx-life cx-life-gone">○</span>');
        }
    }

    function _renderStatuses() {
        if (!_statusEl) return;
        var names = Object.keys(_statuses);
        _statusEl.innerHTML = names.length
            ? names.map(function (n) {
                var s = _statuses[n];
                return '<div>' + _esc(n) + ' — ' + (s.mistakes || 0) + ' mistake' + (s.mistakes === 1 ? '' : 's') + '</div>';
            }).join('')
            : '<div style="color:#9ca3af;">Nobody has finished yet.</div>';
    }

    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) { _modeSelect.style.display = isHost ? '' : 'none'; _modeSelect.value = _mode; }
        if (_setupEl) {
            _setupEl.style.display = _needsSetup ? 'flex' : 'none';
            if (window.GameSettings) GameSettings.toggle(_gameEls, _needsSetup);
            if (_needsSetup) {
                if (_msgEl) _msgEl.textContent = '';
                if (window.GameSettings) GameSettings.render('connections', _setupEl);
                return;
            }
        }
        _reflowOrder();
        _renderSolved();
        _renderGrid();
        _renderActions();
        if (_statusWrap) _statusWrap.style.display = _mode === 'coop' ? 'none' : '';
        _renderStatuses();
        if (_msgEl && (_completed || _failed)) {
            _msgEl.textContent = _completed
                ? '🎉 Solved with ' + _mistakes + ' mistake' + (_mistakes === 1 ? '' : 's') + '!'
                : '💀 Out of guesses — the full solution is above.';
        }
    }

    // ---- shell -------------------------------------------------------------------------

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'connections-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,540px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🔗 Connections</strong>' +
            '<select id="cx-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: everyone shares one board. Competitive: everyone plays privately, feeds the leaderboard.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="cx-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="cx-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#cx-new');
        _modeSelect = bar.querySelector('#cx-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.ConnectionsNet && ConnectionsNet.setMode) ConnectionsNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;text-align:center;';
        body.appendChild(_msgEl);

        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _solvedEl = document.createElement('div');
        _solvedEl.className = 'cx-bands';
        _solvedEl.style.cssText = 'display:none;flex-direction:column;gap:6px;';
        body.appendChild(_solvedEl);

        _gridEl = document.createElement('div');
        _gridEl.className = 'cx-grid';
        _gridEl.style.cssText = 'display:grid;gap:6px;';
        body.appendChild(_gridEl);

        _mistakesEl = document.createElement('div');
        _mistakesEl.style.cssText = 'text-align:center;font-size:0.82rem;color:#4b5563;';
        body.appendChild(_mistakesEl);

        _actionsEl = document.createElement('div');
        _actionsEl.style.cssText = 'display:flex;gap:8px;justify-content:center;';
        _shuffleBtn = document.createElement('button');
        _shuffleBtn.type = 'button';
        _shuffleBtn.className = 'btn btn-sm btn-outline-secondary';
        _shuffleBtn.textContent = '🔀 Shuffle';
        _shuffleBtn.addEventListener('click', _shuffle);
        _clearBtn = document.createElement('button');
        _clearBtn.type = 'button';
        _clearBtn.className = 'btn btn-sm btn-outline-secondary';
        _clearBtn.textContent = 'Deselect';
        _clearBtn.addEventListener('click', function () { _selected = []; _renderGrid(); _renderActions(); });
        _submitBtn = document.createElement('button');
        _submitBtn.type = 'button';
        _submitBtn.className = 'btn btn-sm btn-primary';
        _submitBtn.addEventListener('click', _submit);
        _actionsEl.appendChild(_shuffleBtn);
        _actionsEl.appendChild(_clearBtn);
        _actionsEl.appendChild(_submitBtn);
        body.appendChild(_actionsEl);

        _statusWrap = document.createElement('div');
        _statusWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        _statusWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Finished today</div>';
        _statusEl = document.createElement('div');
        _statusEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:0.8rem;';
        _statusWrap.appendChild(_statusEl);
        body.appendChild(_statusWrap);

        _gameEls = [_solvedEl, _gridEl, _mistakesEl, _actionsEl, _statusWrap];

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#cx-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.ConnectionsNet && ConnectionsNet.newGame) ConnectionsNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // ---- incoming ----------------------------------------------------------------------

    // payload: { correct, oneAway, mistakes, category, difficulty, words, completed, failed, revealed }
    // In coop this is a group broadcast, so `name` may be somebody else; the board is shared
    // either way, which is exactly why the state below is applied regardless of who guessed.
    function onResult(name, payload) {
        if (!payload) return;
        var mine = _mode === 'coop' || !window.roomState || name === undefined || name === null ||
            name === (window.ROOM_CONFIG && ROOM_CONFIG.playerName);
        _pending = false;
        _mistakes = payload.mistakes || 0;

        if (payload.correct && payload.category) {
            _solvedGroups.push({ name: payload.category, difficulty: payload.difficulty || 0, words: payload.words || [] });
            _selected = [];
            if (_msgEl) _msgEl.textContent = (mine ? '' : _esc(name) + ' found ') + payload.category;
        } else if (!payload.correct) {
            if (mine && _msgEl) _msgEl.textContent = payload.oneAway ? '😬 One away…' : '❌ Not a group.';
        }

        if (payload.completed) _completed = true;
        if (payload.failed) _failed = true;
        if (payload.revealed) {
            // A finish or a bust hands back the whole solution — replace rather than append
            // so a busted board shows the categories the player never found.
            _solvedGroups = payload.revealed.map(function (c) {
                return { name: c.name, difficulty: c.difficulty, words: c.words || [] };
            });
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    function onStatusUpdate(status) {
        if (!status || !status.name) return;
        _statuses[status.name] = { name: status.name, mistakes: status.mistakes };
        if (_root && _root.style.display === 'flex') _renderStatuses();
    }

    function onReset(puzzleId, words, mistakesAllowed) {
        _needsSetup = false;
        _puzzleId = puzzleId || null;
        _words = (words || []).slice();
        _order = _words.slice();
        _selected = [];
        _solvedGroups = [];
        _mistakes = 0;
        _mistakesAllowed = mistakesAllowed || _mistakesAllowed;
        _completed = false;
        _failed = false;
        _pending = false;
        _statuses = {};
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'competitive';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the ConnectionsReset that follows carries the grid.
    function onConfigured(settings) {
        _needsSetup = false;
        if (_root && _root.style.display === 'flex') _render();
    }

    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.connections);
        _puzzleId = state.connectionsPuzzleId || null;
        _mode = state.connectionsMode || 'competitive';
        _words = (state.connectionsWords || []).slice();
        _order = _words.slice();
        _mistakesAllowed = state.connectionsMistakesAllowed || 4;
        _perCategory = state.connectionsWordsPerCategory || 4;

        var src = _mode === 'coop' ? state.connectionsShared : state.myConnections;
        _mistakes = (src && src.mistakes) || 0;
        _completed = !!(src && src.completed);
        _failed = !!(src && src.failed);
        _solvedGroups = ((src && src.revealed) || []).map(function (c) {
            return { name: c.name, difficulty: c.difficulty, words: c.words || [] };
        });
        _selected = [];
        _pending = false;

        _statuses = {};
        (state.connectionsStatuses || []).forEach(function (s) {
            _statuses[s.name] = { name: s.name, mistakes: s.mistakes };
        });
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Connections = {
        open: open, close: close, onResult: onResult, onStatusUpdate: onStatusUpdate,
        onReset: onReset, onModeChanged: onModeChanged, onConfigured: onConfigured,
        loadState: loadState
    };
}());
