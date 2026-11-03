// ============================================================
// In-room game #2 — shared collaborative Crossword. One NxN puzzle per room per
// UTC day (grid size picked by whoever sets the game up that day — see
// game-settings.js), but unlike Wordle every fill is broadcast
// live to the whole room (same live-collaboration model as the Whiteboard) since
// this is meant to be solved together, not privately. See Hubs/PokerHub.cs
// CrosswordFill/CrosswordNewGame/EnsureCrosswordPuzzle.
// ============================================================
(function () {
    // Grid size is per-room and per-day; it arrives with every layout payload (layout.size) and
    // this tracks whatever the current puzzle actually is rather than assuming 5.
    var SIZE = 5;

    var _root = null, _built = false;
    var _gridEl = null, _acrossEl = null, _downEl = null, _msgEl = null, _newGameBtn = null, _modeSelect = null;
    var _setupEl = null, _gameEl = null, _needsSetup = false;
    var _inputs = {};          // "row,col" -> <input>
    var _numberAt = {};        // "row,col" -> clue number (label shown in the cell corner)
    var _wordsAt = {};         // "row,col" -> { A: entry|null, D: entry|null } (which word(s) cross this cell)
    var _black = {};           // "row,col" -> true
    var _layout = null;        // { size, black, across, down }
    var _cells = {};           // "row,col" -> letter (server-confirmed fill state)
    var _correct = {};         // "row,col" -> true|false|undefined (server-confirmed correctness)
    var _puzzleId = null;
    var _direction = 'A';      // 'A' | 'D' — current typing direction
    var _active = null;        // { row, col } — currently focused cell
    var _mode = 'coop';

    function _key(r, c) { return r + ',' + c; }

    // Letter size for the current grid size: the 5x5 grid's 1.15rem, scaled by 5/SIZE and
    // floored so the biggest grids stay legible.
    function _cellFontRem() { return Math.max(0.6, Math.round((1.15 * 5 / Math.max(SIZE, 1)) * 100) / 100); }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'crossword-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,640px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🧩 Crossword</strong>' +
            '<select id="cw-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: one shared grid for the room. Competitive: everyone races their own grid.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="cw-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="cw-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#cw-new');
        _modeSelect = bar.querySelector('#cw-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.CrosswordNet && CrosswordNet.setMode) CrosswordNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        body.appendChild(_msgEl);

        // Shown instead of the board until somebody sets today's puzzle up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _gameEl = document.createElement('div');
        _gameEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;';
        body.appendChild(_gameEl);

        _gridEl = document.createElement('div');
        _gridEl.style.cssText = 'display:grid;grid-template-columns:repeat(' + SIZE + ',1fr);gap:2px;' +
            'width:min(80vw,340px);aspect-ratio:1/1;background:#1a1a1b;border:2px solid #1a1a1b;';
        _gameEl.appendChild(_gridEl);

        var clues = document.createElement('div');
        clues.style.cssText = 'display:flex;gap:20px;width:100%;font-size:0.82rem;flex-wrap:wrap;';
        var acrossWrap = document.createElement('div');
        acrossWrap.style.cssText = 'flex:1 1 200px;min-width:180px;';
        acrossWrap.innerHTML = '<div style="font-weight:700;color:#374151;margin-bottom:4px;">Across</div>';
        _acrossEl = document.createElement('div');
        _acrossEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        acrossWrap.appendChild(_acrossEl);
        var downWrap = document.createElement('div');
        downWrap.style.cssText = 'flex:1 1 200px;min-width:180px;';
        downWrap.innerHTML = '<div style="font-weight:700;color:#374151;margin-bottom:4px;">Down</div>';
        _downEl = document.createElement('div');
        _downEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        downWrap.appendChild(_downEl);
        clues.appendChild(acrossWrap); clues.appendChild(downWrap);
        _gameEl.appendChild(clues);

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#cw-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.CrosswordNet && CrosswordNet.newGame) CrosswordNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    // Word that starts at (row,col) in the given direction, if any — used to know how far a
    // typed run extends when auto-advancing.
    function _entryAt(row, col, dir) {
        var w = _wordsAt[_key(row, col)];
        return w ? w[dir] : null;
    }

    // The active word: whichever word (across/down) in the current typing direction contains
    // the active cell — found by walking backward from the active cell to a word start.
    function _activeWord() {
        if (!_active) return null;
        var r = _active.row, c = _active.col;
        if (_direction === 'A') { while (c > 0 && !_black[_key(r, c - 1)]) c--; }
        else { while (r > 0 && !_black[_key(r - 1, c)]) r--; }
        return _entryAt(r, c, _direction);
    }

    function _setActive(row, col, dir) {
        var k = _key(row, col);
        if (_black[k]) return;
        if (dir) {
            _direction = dir;
        } else if (_active && _active.row === row && _active.col === col) {
            // Clicking the already-active cell toggles direction, if the other direction exists here.
            var other = _direction === 'A' ? 'D' : 'A';
            if (_wordsAt[k] && _wordsAt[k][other]) _direction = other;
        } else if (!(_wordsAt[k] && _wordsAt[k][_direction])) {
            // Current direction doesn't run through this cell — switch to whichever does.
            if (_wordsAt[k] && _wordsAt[k].A) _direction = 'A';
            else if (_wordsAt[k] && _wordsAt[k].D) _direction = 'D';
        }
        _active = { row: row, col: col };
        var input = _inputs[k];
        if (input) { input.focus(); try { input.select(); } catch (e) {} }
        _renderHighlight();
        _renderClueList();
    }

    function _advance(step) {
        if (!_active) return;
        var r = _active.row, c = _active.col;
        while (true) {
            if (_direction === 'A') c += step; else r += step;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
            if (!_black[_key(r, c)]) { _setActive(r, c, _direction); return; }
        }
    }

    function _moveArrow(dr, dc) {
        if (!_active) return;
        var r = _active.row + dr, c = _active.col + dc;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || _black[_key(r, c)]) return;
        var dir = dr !== 0 ? 'D' : 'A';
        _setActive(r, c, dir);
    }

    function _onInput(row, col, e) {
        var raw = (e.target.value || '').toUpperCase().replace(/[^A-Z]/g, '');
        var letter = raw.slice(-1);
        e.target.value = letter;
        if (window.CrosswordNet && CrosswordNet.fill) CrosswordNet.fill(row, col, letter);
        if (letter) _advance(1);
    }

    function _onKeydown(row, col, e) {
        if (e.key === 'Backspace') {
            e.preventDefault();
            var input = _inputs[_key(row, col)];
            if (input && input.value) {
                input.value = '';
                if (window.CrosswordNet && CrosswordNet.fill) CrosswordNet.fill(row, col, '');
            } else {
                _advance(-1);
                var prev = _active && _inputs[_key(_active.row, _active.col)];
                if (prev && prev.value) {
                    prev.value = '';
                    if (window.CrosswordNet && CrosswordNet.fill) CrosswordNet.fill(_active.row, _active.col, '');
                }
            }
        } else if (e.key === 'ArrowLeft') { e.preventDefault(); _moveArrow(0, -1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); _moveArrow(0, 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _moveArrow(-1, 0); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); _moveArrow(1, 0); }
    }

    function _renderGrid() {
        if (!_setupEl || !_gameEl) return;
        if (_needsSetup) {
            _setupEl.style.display = 'block';
            _gameEl.style.display = 'none';
            if (window.GameSettings) GameSettings.render('crossword', _setupEl);
            return;
        }
        _setupEl.style.display = 'none';
        _gameEl.style.display = 'flex';

        if (!_gridEl || !_layout) return;
        SIZE = _layout.size || SIZE;
        _gridEl.style.gridTemplateColumns = 'repeat(' + SIZE + ',1fr)';
        _gridEl.innerHTML = '';
        _inputs = {}; _numberAt = {}; _wordsAt = {}; _black = {};

        (_layout.black || []).forEach(function (rc) { _black[_key(rc[0], rc[1])] = true; });
        (_layout.across || []).concat(_layout.down || []).forEach(function (entry) {
            var k = _key(entry.row, entry.col);
            _numberAt[k] = entry.number;
        });
        (_layout.across || []).forEach(function (entry) {
            var w = _wordsAt[_key(entry.row, entry.col)] || (_wordsAt[_key(entry.row, entry.col)] = {});
            w.A = entry;
        });
        (_layout.down || []).forEach(function (entry) {
            var w = _wordsAt[_key(entry.row, entry.col)] || (_wordsAt[_key(entry.row, entry.col)] = {});
            w.D = entry;
        });

        for (var r = 0; r < SIZE; r++) {
            for (var c = 0; c < SIZE; c++) {
                var k = _key(r, c);
                var cell = document.createElement('div');
                cell.style.cssText = 'position:relative;background:#1a1a1b;';
                if (_black[k]) {
                    cell.style.background = '#1a1a1b';
                    _gridEl.appendChild(cell);
                    continue;
                }
                cell.style.background = '#fff';
                if (_numberAt[k]) {
                    var num = document.createElement('span');
                    num.textContent = _numberAt[k];
                    num.style.cssText = 'position:absolute;top:1px;left:2px;font-size:0.55rem;font-weight:700;color:#4b5563;pointer-events:none;';
                    cell.appendChild(num);
                }
                var input = document.createElement('input');
                input.maxLength = 1;
                input.autocomplete = 'off';
                input.spellcheck = false;
                // The grid keeps a fixed on-screen width whatever N is, so the letters have to
                // shrink with it or a 9x9 overflows its cells.
                input.style.cssText = 'width:100%;height:100%;border:none;background:transparent;text-align:center;' +
                    'font-weight:700;font-size:' + _cellFontRem() + 'rem;text-transform:uppercase;color:#1a1a1b;caret-color:transparent;';
                (function (rr, cc) {
                    // Click alone (not focus too) drives direction/highlight logic — a real
                    // click always focuses the input as a side effect, so a separate focus
                    // listener would double-fire _setActive on every click (once via focus,
                    // once via click), and also re-fire it when _setActive's own programmatic
                    // input.focus() runs during auto-advance, corrupting the toggle logic.
                    input.addEventListener('click', function () { _setActive(rr, cc); });
                    input.addEventListener('input', function (e) { _onInput(rr, cc, e); });
                    input.addEventListener('keydown', function (e) { _onKeydown(rr, cc, e); });
                })(r, c);
                cell.appendChild(input);
                _gridEl.appendChild(cell);
                _inputs[k] = input;
            }
        }
        _applyCellState();
        if (!_active) {
            if (_layout.across && _layout.across.length) { _direction = 'A'; _active = { row: _layout.across[0].row, col: _layout.across[0].col }; }
            else if (_layout.down && _layout.down.length) { _direction = 'D'; _active = { row: _layout.down[0].row, col: _layout.down[0].col }; }
        }
        _renderHighlight();
        _renderClueList();
    }

    function _applyCellState() {
        Object.keys(_inputs).forEach(function (k) {
            var input = _inputs[k];
            var letter = _cells[k] || '';
            if (document.activeElement !== input) input.value = letter;
            var ok = _correct[k];
            input.style.background = ok === true ? '#d1f7d1' : (letter ? '#fff' : '#fff');
            input.style.color = ok === true ? '#0a6b0a' : '#1a1a1b';
        });
    }

    function _renderHighlight() {
        if (!_gridEl) return;
        var activeWord = _activeWord();
        var wordCells = {};
        if (activeWord) {
            for (var i = 0; i < activeWord.length; i++) {
                var rc = _direction === 'A' ? [activeWord.row, activeWord.col + i] : [activeWord.row + i, activeWord.col];
                wordCells[_key(rc[0], rc[1])] = true;
            }
        }
        Object.keys(_inputs).forEach(function (k) {
            var input = _inputs[k];
            var isActive = _active && k === _key(_active.row, _active.col);
            var inWord = wordCells[k];
            input.parentElement.style.background = isActive ? '#ffd54f' : (inWord ? '#cfe8ff' : '#fff');
        });
    }

    function _renderClueList() {
        if (!_acrossEl || !_downEl || !_layout) return;
        var activeWord = _activeWord();
        function build(container, entries, dir) {
            container.innerHTML = '';
            (entries || []).forEach(function (entry) {
                var item = document.createElement('div');
                var isActive = activeWord && activeWord === entry;
                item.style.cssText = 'cursor:pointer;padding:2px 4px;border-radius:4px;' + (isActive ? 'background:#cfe8ff;font-weight:600;' : '');
                item.textContent = entry.number + '. ' + entry.clue;
                item.addEventListener('click', function () { _setActive(entry.row, entry.col, dir); });
                container.appendChild(item);
            });
        }
        build(_acrossEl, _layout.across, 'A');
        build(_downEl, _layout.down, 'D');
    }

    // ── Public API ────────────────────────────────────────────
    function open() {
        _build();
        _renderGrid();
        _root.style.display = 'flex';
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) {
            _modeSelect.style.display = isHost ? '' : 'none';
            _modeSelect.value = _mode;
        }
    }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onCellFilled(row, col, letter, correct) {
        var k = _key(row, col);
        if (letter) { _cells[k] = letter; _correct[k] = correct; }
        else { delete _cells[k]; delete _correct[k]; }
        if (_root && _root.style.display === 'flex') _applyCellState();
    }

    function onSolved() {
        if (_msgEl) _msgEl.textContent = _mode === 'competitive' ? '🎉 You solved it!' : '🎉 Solved by the room!';
    }

    // puzzleId/layout come from CrosswordNewGame's broadcast — the new puzzle can have a
    // different grid shape and clue text, so already-open clients need these applied here
    // rather than just clearing cells, or they'd keep showing the old puzzle's clues.
    function onReset(puzzleId, layout) {
        _needsSetup = false;
        _cells = {}; _correct = {}; _active = null;
        if (puzzleId) _puzzleId = puzzleId;
        if (layout) _layout = layout;
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _renderGrid();
    }

    // Somebody locked in today's grid size — the CrosswordReset that follows carries the
    // actual layout, so this just flips out of the setup panel.
    function onConfigured(settings) {
        _needsSetup = false;
        _cells = {}; _correct = {}; _active = null;
        if (_root && _root.style.display === 'flex') _renderGrid();
    }

    function onModeChanged(mode) {
        _mode = mode || 'coop';
        if (_root && _modeSelect && _root.style.display === 'flex') _modeSelect.value = _mode;
    }

    // state: { crosswordPuzzleId, crosswordMode, crosswordLayout: {size,black,across,down},
    //          crosswordCells: {"r,c":letter}, myCrossword: {cells, correct, solved} }
    function loadState(state) {
        state = state || {};
        var newPuzzle = state.crosswordPuzzleId !== _puzzleId;
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.crossword);
        _puzzleId = state.crosswordPuzzleId || null;
        _mode = state.crosswordMode || 'coop';
        _layout = state.crosswordLayout || null;
        if (_mode === 'competitive') {
            var mine = state.myCrossword || null;
            _cells = Object.assign({}, mine ? mine.cells : {});
            _correct = Object.assign({}, mine ? mine.correct : {});
        } else {
            _cells = Object.assign({}, state.crosswordCells || {});
            _correct = Object.assign({}, state.crosswordCorrect || {});
        }
        if (newPuzzle) _active = null;
        if (_msgEl && newPuzzle) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _renderGrid();
    }

    window.Crossword = {
        open: open, close: close, onCellFilled: onCellFilled, onSolved: onSolved, onReset: onReset,
        onConfigured: onConfigured, onModeChanged: onModeChanged, loadState: loadState
    };
}());
