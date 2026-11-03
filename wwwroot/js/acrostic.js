// ============================================================
// In-room game #7 — shared collaborative Acrostic. One curated quote puzzle per
// room per UTC day, picked from the Data/AcrosticPuzzles.cs bank; every fill is
// broadcast live to the whole room (same live-collaboration model as Crossword).
// See Hubs/PokerHub.cs AcrosticFill/AcrosticNewGame/EnsureAcrosticPuzzle.
//
// Like every other in-room game, the room has no puzzle for the day until somebody sets it
// up: until then the server sends acrosticLayout = null and gameNeedsSetup.acrostic = true,
// and the overlay shows the shared settings form (see game-settings.js) instead of a grid.
// ============================================================
(function () {
    var _root = null, _built = false;
    var _gridEl = null, _cluesEl = null, _authorEl = null, _msgEl = null, _newGameBtn = null, _modeSelect = null;
    var _inputs = {};          // position (int, as string) -> <input>
    var _layout = null;        // { quoteLength, author, clues: [{index, clue, length, positions}] }
    var _cells = {};           // position -> letter (server-confirmed fill state)
    var _correct = {};         // position -> true|false
    var _puzzleId = null;
    var _active = null;        // position (number)
    var _order = [];           // editable positions in left-to-right grid order
    var _mode = 'coop';
    var _setupEl = null, _gameEls = [], _needsSetup = false;

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'acrostic-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(96vw,720px);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">📋 Acrostic</strong>' +
            '<select id="ac-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: one shared quote for the room. Competitive: everyone races their own copy.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="ac-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="ac-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#ac-new');
        _modeSelect = bar.querySelector('#ac-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.AcrosticNet && AcrosticNet.setMode) AcrosticNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        body.appendChild(_msgEl);

        // Shown instead of the quote until somebody sets today's puzzle up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _authorEl = document.createElement('div');
        _authorEl.style.cssText = 'font-size:0.78rem;color:#6b7280;';
        body.appendChild(_authorEl);

        _gridEl = document.createElement('div');
        _gridEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;line-height:1;';
        body.appendChild(_gridEl);

        var cluesWrap = document.createElement('div');
        cluesWrap.style.cssText = 'border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        cluesWrap.innerHTML = '<div style="font-weight:700;color:#374151;margin-bottom:4px;font-size:0.82rem;">Clues</div>';
        _cluesEl = document.createElement('div');
        _cluesEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;font-size:0.8rem;max-height:220px;overflow-y:auto;';
        cluesWrap.appendChild(_cluesEl);
        body.appendChild(cluesWrap);

        _gameEls = [_authorEl, _gridEl, cluesWrap];

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#ac-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.AcrosticNet && AcrosticNet.newGame) AcrosticNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function _advance(step) {
        if (_active == null) return;
        var idx = _order.indexOf(_active);
        if (idx < 0) return;
        var next = idx + step;
        if (next < 0 || next >= _order.length) return;
        _setActive(_order[next]);
    }

    function _setActive(pos) {
        _active = pos;
        var input = _inputs[pos];
        if (input) { input.focus(); try { input.select(); } catch (e) { } }
        _renderHighlight();
        _renderClueList();
    }

    function _onInput(pos, e) {
        var raw = (e.target.value || '').toUpperCase().replace(/[^A-Z]/g, '');
        var letter = raw.slice(-1);
        e.target.value = letter;
        if (window.AcrosticNet && AcrosticNet.fill) AcrosticNet.fill(pos, letter);
        if (letter) _advance(1);
    }

    function _onKeydown(pos, e) {
        if (e.key === 'Backspace') {
            e.preventDefault();
            var input = _inputs[pos];
            if (input && input.value) {
                input.value = '';
                if (window.AcrosticNet && AcrosticNet.fill) AcrosticNet.fill(pos, '');
            } else {
                _advance(-1);
                if (_active != null) {
                    var prev = _inputs[_active];
                    if (prev && prev.value) {
                        prev.value = '';
                        if (window.AcrosticNet && AcrosticNet.fill) AcrosticNet.fill(_active, '');
                    }
                }
            }
        } else if (e.key === 'ArrowLeft') { e.preventDefault(); _advance(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); _advance(1); }
    }

    function _clueForPos(pos) {
        if (!_layout || !_layout.clues) return null;
        for (var i = 0; i < _layout.clues.length; i++) {
            if (_layout.clues[i].positions.indexOf(pos) >= 0) return _layout.clues[i];
        }
        return null;
    }

    function _renderGrid() {
        if (!_gridEl || !_layout) return;
        _gridEl.innerHTML = '';
        _inputs = {}; _order = [];

        var letterPos = {};    // position -> true if editable letter cell
        (_layout.clues || []).forEach(function (clue) {
            (clue.positions || []).forEach(function (p) { letterPos[p] = true; });
        });

        for (var p = 0; p < _layout.quoteLength; p++) {
            if (!letterPos[p]) {
                var gap = document.createElement('div');
                gap.style.cssText = 'width:8px;';
                _gridEl.appendChild(gap);
                continue;
            }
            _order.push(p);
            var cell = document.createElement('div');
            cell.style.cssText = 'position:relative;';
            var input = document.createElement('input');
            input.maxLength = 1;
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.style.cssText = 'width:1.6rem;height:1.8rem;border:1px solid #9ca3af;border-radius:3px;text-align:center;' +
                'font-weight:700;font-size:1rem;text-transform:uppercase;color:#1a1a1b;caret-color:transparent;';
            (function (pos) {
                input.addEventListener('click', function () { _setActive(pos); });
                input.addEventListener('input', function (e) { _onInput(pos, e); });
                input.addEventListener('keydown', function (e) { _onKeydown(pos, e); });
            })(p);
            cell.appendChild(input);
            _gridEl.appendChild(cell);
            _inputs[p] = input;
        }
        _applyCellState();
        if (_active == null && _order.length) _active = _order[0];
        _renderHighlight();
        _renderClueList();
    }

    function _applyCellState() {
        Object.keys(_inputs).forEach(function (k) {
            var input = _inputs[k];
            var letter = _cells[k] || '';
            if (document.activeElement !== input) input.value = letter;
            var ok = _correct[k];
            input.style.background = ok === true ? '#d1f7d1' : '#fff';
            input.style.color = ok === true ? '#0a6b0a' : '#1a1a1b';
        });
    }

    function _renderHighlight() {
        var clue = _active != null ? _clueForPos(_active) : null;
        var wordPositions = {};
        if (clue) clue.positions.forEach(function (p) { wordPositions[p] = true; });
        Object.keys(_inputs).forEach(function (k) {
            var input = _inputs[k];
            var isActive = _active != null && Number(k) === _active;
            var inWord = wordPositions[k];
            input.style.background = isActive ? '#ffd54f' : (inWord ? '#cfe8ff' : (_correct[k] === true ? '#d1f7d1' : '#fff'));
        });
    }

    function _renderClueList() {
        if (!_cluesEl || !_layout) return;
        var activeClue = _active != null ? _clueForPos(_active) : null;
        _cluesEl.innerHTML = '';
        (_layout.clues || []).forEach(function (clue) {
            var item = document.createElement('div');
            var isActive = activeClue && activeClue.index === clue.index;
            item.style.cssText = 'cursor:pointer;padding:2px 4px;border-radius:4px;' + (isActive ? 'background:#cfe8ff;font-weight:600;' : '');
            item.textContent = (clue.index + 1) + '. ' + clue.clue + ' (' + clue.length + ')';
            item.addEventListener('click', function () { if (clue.positions && clue.positions.length) _setActive(clue.positions[0]); });
            _cluesEl.appendChild(item);
        });
    }

    // ── Public API ────────────────────────────────────────────
    // Either the setup form or the puzzle, never both. Reshuffle/mode are host-only, and are
    // meaningless before there is a puzzle to reshuffle.
    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) {
            _modeSelect.style.display = isHost ? '' : 'none';
            _modeSelect.value = _mode;
        }
        if (_setupEl) {
            _setupEl.style.display = _needsSetup ? 'flex' : 'none';
            if (window.GameSettings) GameSettings.toggle(_gameEls, _needsSetup);
            if (_needsSetup) {
                if (_msgEl) _msgEl.textContent = '';
                if (window.GameSettings) GameSettings.render('acrostic', _setupEl);
                return;
            }
        }
        _renderGrid();
    }

    function open() {
        _build();
        _render();
        _root.style.display = 'flex';
    }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onCellFilled(position, letter, correct) {
        if (letter) { _cells[position] = letter; _correct[position] = correct; }
        else { delete _cells[position]; delete _correct[position]; }
        if (_root && _root.style.display === 'flex') _applyCellState();
    }

    function onSolved() {
        if (_msgEl) _msgEl.textContent = _mode === 'competitive' ? '🎉 You solved it!' : '🎉 Solved by the room!';
    }

    function onReset(puzzleId, layout) {
        _needsSetup = false;
        _cells = {}; _correct = {}; _active = null;
        if (puzzleId) _puzzleId = puzzleId;
        if (layout) { _layout = layout; if (_authorEl) _authorEl.textContent = '— ' + (layout.author || ''); }
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the AcrosticReset that follows carries the quote.
    function onConfigured(settings) {
        _needsSetup = false;
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'coop';
        if (_root && _modeSelect && _root.style.display === 'flex') _modeSelect.value = _mode;
    }

    // state: { acrosticPuzzleId, acrosticMode, acrosticLayout: {quoteLength,author,clues},
    //          acrosticCells: {pos:letter}, acrosticCorrect: {pos:bool}, myAcrostic: {cells, correct, solved} }
    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.acrostic);
        var newPuzzle = state.acrosticPuzzleId !== _puzzleId;
        _puzzleId = state.acrosticPuzzleId || null;
        _mode = state.acrosticMode || 'coop';
        _layout = state.acrosticLayout || null;
        if (_mode === 'competitive') {
            var mine = state.myAcrostic || null;
            _cells = Object.assign({}, mine ? mine.cells : {});
            _correct = Object.assign({}, mine ? mine.correct : {});
        } else {
            _cells = Object.assign({}, state.acrosticCells || {});
            _correct = Object.assign({}, state.acrosticCorrect || {});
        }
        if (_authorEl) _authorEl.textContent = _layout ? ('— ' + (_layout.author || '')) : '';
        if (newPuzzle) _active = null;
        if (_msgEl && newPuzzle) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Acrostic = {
        open: open, close: close, onCellFilled: onCellFilled, onSolved: onSolved, onReset: onReset,
        onConfigured: onConfigured, onModeChanged: onModeChanged, loadState: loadState
    };
}());
