// ============================================================
// In-room game #4 — shared collaborative Word Search. One NxN grid per room per
// UTC day; every found word is broadcast live to the whole room (same
// live-collaboration model as Crossword) since anyone can find any word. See
// Hubs/PokerHub.cs WordSearchSubmit/WordSearchNewGame/EnsureWordSearchPuzzle.
//
// Grid size, how many words are hidden, their length range and whether diagonal/backwards
// placement is allowed are all per-room settings, picked by whoever sets the game up for the
// day (see game-settings.js).
// ============================================================
(function () {
    // Grid size is per-room and per-day; it's always however many rows the server sent, never
    // a fixed 12.
    var SIZE = 12;

    var _root = null, _built = false;
    var _gridEl = null, _wordsEl = null, _msgEl = null, _newGameBtn = null, _modeSelect = null;
    var _setupEl = null, _gamePanes = [], _needsSetup = false;
    var _cells = [];           // [row][col] -> <div>
    var _gridRows = [];        // string[SIZE]
    var _words = [];           // string[]
    var _found = {};           // word -> { foundBy, coords: [sr,sc,er,ec] }
    var _puzzleId = null;
    var _mode = 'coop';

    var _dragging = false, _dragStart = null, _dragCur = null;

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'wordsearch-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(96vw,680px);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🔍 Word Search</strong>' +
            '<select id="ws-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: one shared grid for the room. Competitive: everyone races their own found-word list on the same grid.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="ws-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="ws-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#ws-new');
        _modeSelect = bar.querySelector('#ws-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.WordSearchNet && WordSearchNet.setMode) WordSearchNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;padding:14px;overflow-y:auto;align-items:flex-start;justify-content:center;';

        // Shown instead of the grid until somebody sets today's puzzle up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;flex:1 1 100%;';
        body.appendChild(_setupEl);

        var left = document.createElement('div');
        left.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        left.appendChild(_msgEl);

        _gridEl = document.createElement('div');
        _gridEl.style.cssText = 'display:grid;grid-template-columns:repeat(' + SIZE + ',1fr);gap:1px;' +
            'width:min(84vw,420px);aspect-ratio:1/1;background:#1a1a1b;border:2px solid #1a1a1b;user-select:none;';
        left.appendChild(_gridEl);
        body.appendChild(left);

        var right = document.createElement('div');
        right.style.cssText = 'min-width:160px;font-size:0.82rem;';
        right.innerHTML = '<div style="font-weight:700;color:#374151;margin-bottom:6px;">Words to find</div>';
        _wordsEl = document.createElement('div');
        _wordsEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
        right.appendChild(_wordsEl);
        body.appendChild(right);
        _gamePanes = [left, right];

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#ws-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.WordSearchNet && WordSearchNet.newGame) WordSearchNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });

        document.addEventListener('pointerup', _onPointerUp);
    }

    function _key(r, c) { return r + ',' + c; }

    function _cellsBetween(a, b) {
        var dr = b.row - a.row, dc = b.col - a.col;
        var steps = Math.max(Math.abs(dr), Math.abs(dc));
        if (steps === 0) return [a];
        // Only accept straight lines (horizontal/vertical/diagonal).
        if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
        var sr = dr === 0 ? 0 : dr / Math.abs(dr);
        var sc = dc === 0 ? 0 : dc / Math.abs(dc);
        var out = [];
        for (var i = 0; i <= steps; i++) out.push({ row: a.row + sr * i, col: a.col + sc * i });
        return out;
    }

    function _renderGrid() {
        if (!_gridEl) return;
        SIZE = _gridRows.length || SIZE;
        _gridEl.style.gridTemplateColumns = 'repeat(' + SIZE + ',1fr)';
        // The grid keeps a fixed on-screen width whatever N is, so the letters shrink with it.
        var fontRem = Math.max(0.42, Math.round((0.85 * 12 / SIZE) * 100) / 100);
        _gridEl.innerHTML = '';
        _cells = [];
        for (var r = 0; r < SIZE; r++) {
            _cells.push([]);
            for (var c = 0; c < SIZE; c++) {
                var cell = document.createElement('div');
                cell.style.cssText = 'position:relative;background:#fff;display:flex;align-items:center;justify-content:center;' +
                    'font-weight:700;font-size:' + fontRem + 'rem;color:#1a1a1b;cursor:pointer;aspect-ratio:1/1;';
                cell.textContent = (_gridRows[r] || '')[c] || '';
                (function (rr, cc) {
                    cell.addEventListener('pointerdown', function (e) { e.preventDefault(); _dragging = true; _dragStart = { row: rr, col: cc }; _dragCur = _dragStart; _renderSelection(); });
                    cell.addEventListener('pointerenter', function () { if (_dragging) { _dragCur = { row: rr, col: cc }; _renderSelection(); } });
                })(r, c);
                _gridEl.appendChild(cell);
                _cells[r].push(cell);
            }
        }
        _applyFoundHighlight();
    }

    function _renderSelection() {
        _applyFoundHighlight();
        if (!_dragging || !_dragStart || !_dragCur) return;
        var path = _cellsBetween(_dragStart, _dragCur);
        if (!path) return;
        path.forEach(function (rc) {
            var cell = _cells[rc.row] && _cells[rc.row][rc.col];
            if (cell) cell.style.background = '#ffd54f';
        });
    }

    function _applyFoundHighlight() {
        for (var r = 0; r < SIZE; r++) {
            for (var c = 0; c < SIZE; c++) {
                if (_cells[r] && _cells[r][c]) _cells[r][c].style.background = '#fff';
            }
        }
        Object.keys(_found).forEach(function (word) {
            var f = _found[word];
            if (!f || !f.coords) return;
            var path = _cellsBetween({ row: f.coords[0], col: f.coords[1] }, { row: f.coords[2], col: f.coords[3] });
            if (!path) return;
            path.forEach(function (rc) {
                var cell = _cells[rc.row] && _cells[rc.row][rc.col];
                if (cell) cell.style.background = '#a7f3d0';
            });
        });
    }

    function _onPointerUp() {
        if (!_dragging) return;
        _dragging = false;
        var start = _dragStart, cur = _dragCur;
        _dragStart = null; _dragCur = null;
        if (!start || !cur) { _applyFoundHighlight(); return; }
        var path = _cellsBetween(start, cur);
        _applyFoundHighlight();
        if (!path || path.length < 2) return;
        var word = path.map(function (rc) { return (_gridRows[rc.row] || '')[rc.col] || ''; }).join('');
        var reversed = word.split('').reverse().join('');
        var candidate = _words.indexOf(word) >= 0 ? word : (_words.indexOf(reversed) >= 0 ? reversed : null);
        if (!candidate || _found[candidate]) return;
        if (window.WordSearchNet && WordSearchNet.submit) {
            WordSearchNet.submit(candidate, start.row, start.col, cur.row, cur.col);
        }
    }

    function _renderWordList() {
        if (!_wordsEl) return;
        _wordsEl.innerHTML = '';
        _words.forEach(function (word) {
            var f = _found[word];
            var item = document.createElement('div');
            item.style.cssText = f ? 'text-decoration:line-through;color:#9ca3af;' : 'color:#1a1a1b;';
            item.textContent = word + (f && _mode !== 'competitive' ? (' — ' + f.foundBy) : '');
            _wordsEl.appendChild(item);
        });
    }

    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) {
            _modeSelect.style.display = isHost ? '' : 'none';
            _modeSelect.value = _mode;
        }
        if (_setupEl) {
            _setupEl.style.display = _needsSetup ? 'block' : 'none';
            // '' rather than a concrete display, so each pane falls back to whatever its own
            // rule says (the grid column is flex, the word list is block).
            if (window.GameSettings) GameSettings.toggle(_gamePanes, _needsSetup);
            if (_needsSetup) {
                if (_msgEl) _msgEl.textContent = '';
                if (window.GameSettings) GameSettings.render('wordsearch', _setupEl);
                return;
            }
        }
        _renderGrid();
        _renderWordList();
        var allFound = _words.length > 0 && _words.every(function (w) { return _found[w]; });
        if (_msgEl) _msgEl.textContent = allFound ? (_mode === 'competitive' ? '🎉 You found them all!' : '🎉 All words found!') : '';
    }

    // ── Public API ────────────────────────────────────────────
    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; _dragging = false; }

    // Incoming from SignalR (wired in room.js)
    function onWordFound(word, startRow, startCol, endRow, endCol, foundByName) {
        _found[word] = { foundBy: foundByName, coords: [startRow, startCol, endRow, endCol] };
        if (_root && _root.style.display === 'flex') _render();
    }

    function onReset(puzzleId, gridRows, words) {
        _needsSetup = false;
        _puzzleId = puzzleId;
        _gridRows = gridRows || [];
        _words = words || [];
        _found = {};
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the WordSearchReset that follows carries the grid.
    function onConfigured(settings) {
        _needsSetup = false;
        _found = {};
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'coop';
        if (_root && _root.style.display === 'flex') _render();
    }

    // state: { wordSearchPuzzleId, wordSearchMode, wordSearchGridRows, wordSearchWords,
    //          wordSearchFound: {word:{foundBy,coords}}, myWordSearch: {found: [word,...]} }
    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.wordsearch);
        _puzzleId = state.wordSearchPuzzleId || null;
        _mode = state.wordSearchMode || 'coop';
        _gridRows = state.wordSearchGridRows || [];
        _words = state.wordSearchWords || [];
        if (_mode === 'competitive') {
            _found = {};
            var mine = state.myWordSearch || null;
            (mine ? mine.found || [] : []).forEach(function (word) { _found[word] = { foundBy: 'You', coords: null }; });
        } else {
            _found = Object.assign({}, state.wordSearchFound || {});
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    window.WordSearch = {
        open: open, close: close, onWordFound: onWordFound, onReset: onReset,
        onConfigured: onConfigured, onModeChanged: onModeChanged, loadState: loadState
    };
}());
