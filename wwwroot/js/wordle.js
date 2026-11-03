// ============================================================
// Shared per-room daily Wordle. One puzzle per room per UTC day, guesses stay
// private to the guesser (scored server-side), only solved/failed/attempts is
// broadcast to the room so nobody gets spoiled. See Hubs/PokerHub.cs WordleGuess.
//
// The first participant to open Wordle for the room on a given UTC day picks
// the length mode (Fixed/UpTo), length, and max guesses for that day via the
// shared setup form (game-settings.js); the choice is locked in for everyone
// else in the room until the next UTC day (see Hubs/PokerHub.cs GameConfigure).
// ============================================================
(function () {
    var ROWS = 6, COLS = 5;
    var LETTER_COLOR = { green: '#6aaa64', yellow: '#c9b458', gray: '#787c7f' };

    var _root = null, _built = false;
    var _gridEl = null, _kbEl = null, _statusEl = null, _statusWrap = null, _msgEl = null, _newGameBtn = null;
    var _setupEl = null, _gameEl = null;
    var _guesses = [];         // committed rows: [{ word, feedback: [green|yellow|gray x5] }]
    var _current = '';         // in-progress row, not yet submitted/scored
    var _solved = false, _failed = false;
    var _puzzleId = null;
    var _statuses = {};        // name -> { name, solved, failed, attempts, maxGuesses }
    var _pending = false;      // guess submitted, awaiting server feedback

    var _needsSetup = false;
    var _maxGuesses = 6;

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'wordle-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,480px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🔤 Wordle</strong>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="wordle-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="wordle-copy" class="btn btn-sm btn-outline-secondary">📋 Copy result</button>' +
            '<button id="wordle-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#wordle-new');

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        body.appendChild(_msgEl);

        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;flex-direction:column;gap:12px;width:100%;max-width:360px;font-size:0.85rem;';
        body.appendChild(_setupEl);

        _gameEl = document.createElement('div');
        _gameEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;';
        body.appendChild(_gameEl);

        _gridEl = document.createElement('div');
        _gridEl.style.cssText = 'display:grid;grid-template-rows:repeat(' + ROWS + ',1fr);gap:5px;width:100%;max-width:340px;';
        _gameEl.appendChild(_gridEl);

        _kbEl = document.createElement('div');
        _kbEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;width:100%;';
        _gameEl.appendChild(_kbEl);

        _statusWrap = document.createElement('div');
        _statusWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        _statusWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Who\'s playing</div>';
        _statusEl = document.createElement('div');
        _statusEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:0.8rem;';
        _statusWrap.appendChild(_statusEl);
        _gameEl.appendChild(_statusWrap);

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#wordle-close').addEventListener('click', close);
        bar.querySelector('#wordle-copy').addEventListener('click', _copyResult);
        _newGameBtn.addEventListener('click', function () {
            if (window.WordleNet && WordleNet.newGame) WordleNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });

        _buildKeyboard();
        document.addEventListener('keydown', _onPhysicalKey);
    }

    function _buildKeyboard() {
        var rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ENTER,ZXCVBNM,BACKSPACE'];
        _kbEl.innerHTML = '';
        rows.forEach(function (rowSpec) {
            var keys = rowSpec.indexOf(',') >= 0 ? rowSpec.split(',').reduce(function (acc, part) {
                if (part === 'ENTER' || part === 'BACKSPACE') acc.push(part);
                else acc = acc.concat(part.split(''));
                return acc;
            }, []) : rowSpec.split('');
            var rowEl = document.createElement('div');
            rowEl.style.cssText = 'display:flex;gap:4px;justify-content:center;';
            keys.forEach(function (k) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('data-key', k);
                var wide = (k === 'ENTER' || k === 'BACKSPACE');
                btn.textContent = k === 'BACKSPACE' ? '⌫' : (k === 'ENTER' ? 'Enter' : k);
                btn.style.cssText = 'border:none;border-radius:4px;background:#d3d6da;color:#1a1a1b;' +
                    'font-weight:600;font-size:0.78rem;padding:0;height:42px;cursor:pointer;' +
                    'flex:' + (wide ? '1.5 1 0' : '1 1 0') + ';min-width:0;';
                btn.addEventListener('click', function () { _handleKey(k); });
                rowEl.appendChild(btn);
            });
            _kbEl.appendChild(rowEl);
        });
    }

    function _onPhysicalKey(e) {
        if (!_root || _root.style.display !== 'flex' || _needsSetup) return;
        var tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.key === 'Enter') _handleKey('ENTER');
        else if (e.key === 'Backspace') _handleKey('BACKSPACE');
        else if (/^[a-zA-Z]$/.test(e.key)) _handleKey(e.key.toUpperCase());
    }

    function _handleKey(k) {
        if (_needsSetup || _solved || _failed || _pending || _guesses.length >= ROWS) return;
        if (k === 'BACKSPACE') {
            _current = _current.slice(0, -1);
        } else if (k === 'ENTER') {
            if (_current.length !== COLS) { _flash('Not enough letters'); return; }
            _pending = true;
            if (window.WordleNet && WordleNet.guess) WordleNet.guess(_current);
        } else if (/^[A-Z]$/.test(k) && _current.length < COLS) {
            _current += k;
        }
        _render();
    }

    function _persistentMessage() {
        if (_solved) return '🎉 Solved!';
        if (_failed) return '💀 Out of guesses';
        return '';
    }

    function _flash(text) {
        if (_msgEl) { _msgEl.textContent = text; setTimeout(function () { if (_msgEl && _msgEl.textContent === text) _msgEl.textContent = _persistentMessage(); }, 1500); }
    }

    // ── Setup form ────────────────────────────────────────────
    // Wordle used to hand-roll this; it now renders through the shared game-settings.js form
    // that every other game uses, driven by roomState.gameLimits.wordle / gameSettings.wordle.
    function _renderSetup() {
        if (_setupEl && window.GameSettings) GameSettings.render('wordle', _setupEl);
    }

    function _render() {
        if (_newGameBtn) _newGameBtn.style.display = (!_needsSetup && window.roomState && window.roomState.isHost) ? '' : 'none';

        if (_needsSetup) {
            if (_msgEl) _msgEl.textContent = '';
            _setupEl.style.display = 'flex';
            _gameEl.style.display = 'none';
            _renderSetup();
            return;
        }
        _setupEl.style.display = 'none';
        _gameEl.style.display = 'flex';

        if (!_gridEl) return;
        _gridEl.innerHTML = '';
        _gridEl.style.gridTemplateRows = 'repeat(' + ROWS + ',1fr)';
        for (var r = 0; r < ROWS; r++) {
            var rowEl = document.createElement('div');
            rowEl.style.cssText = 'display:grid;grid-template-columns:repeat(' + COLS + ',1fr);gap:5px;';
            var word, feedback;
            if (r < _guesses.length) { word = _guesses[r].word; feedback = _guesses[r].feedback; }
            else if (r === _guesses.length && !_pending) { word = _current; feedback = null; }
            else { word = ''; feedback = null; }
            for (var c = 0; c < COLS; c++) {
                var ch = word ? word[c] : '';
                var color = feedback ? feedback[c] : null;
                var cell = document.createElement('div');
                var bg = color ? LETTER_COLOR[color] : '#fff';
                var border = color ? bg : (ch ? '#878a8c' : '#d3d6da');
                cell.style.cssText = 'aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;' +
                    'border:2px solid ' + border + ';background:' + bg + ';color:' + (color ? '#fff' : '#1a1a1b') + ';' +
                    'font-weight:700;font-size:1.4rem;text-transform:uppercase;';
                cell.textContent = ch || '';
                rowEl.appendChild(cell);
            }
            _gridEl.appendChild(rowEl);
        }
        _renderKeyboard();
        _renderStatuses();
        if (_msgEl && !_msgEl.textContent) _msgEl.textContent = _persistentMessage();
    }

    function _renderKeyboard() {
        if (!_kbEl) return;
        var best = {}; // letter -> best status seen
        var rank = { gray: 1, yellow: 2, green: 3 };
        _guesses.forEach(function (g) {
            for (var i = 0; i < g.word.length; i++) {
                var l = g.word[i], s = g.feedback[i];
                if (!best[l] || rank[s] > rank[best[l]]) best[l] = s;
            }
        });
        _kbEl.querySelectorAll('button[data-key]').forEach(function (btn) {
            var k = btn.getAttribute('data-key');
            if (k === 'ENTER' || k === 'BACKSPACE') return;
            var s = best[k];
            btn.style.background = s ? LETTER_COLOR[s] : '#d3d6da';
            btn.style.color = s ? '#fff' : '#1a1a1b';
        });
    }

    function _renderStatuses() {
        if (!_statusEl) return;
        _statusEl.innerHTML = '';
        var names = Object.keys(_statuses);
        if (!names.length) { _statusEl.innerHTML = '<span style="color:#9ca3af;">Nobody has started yet</span>'; return; }
        names.forEach(function (id) {
            var s = _statuses[id];
            if (!s || !s.name) return;
            var row = document.createElement('div');
            var icon = s.solved ? '🟩' : (s.failed ? '⬛' : '⏳');
            var max = s.maxGuesses || _maxGuesses;
            row.textContent = icon + ' ' + s.name + (s.solved || s.failed ? ' — ' + s.attempts + '/' + max : '');
            _statusEl.appendChild(row);
        });
    }

    function _copyResult() {
        var lines = _guesses.map(function (g) {
            return g.feedback.map(function (s) { return s === 'green' ? '🟩' : (s === 'yellow' ? '🟨' : '⬛'); }).join('');
        });
        var header = 'Wordle ' + (_puzzleId || '') + ' ' + (_solved ? _guesses.length : 'X') + '/' + _maxGuesses;
        var text = header + '\n' + lines.join('\n');
        var done = function () { _flash('Copied!'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done);
        } else {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            done();
        }
    }

    // ── Public API ────────────────────────────────────────────
    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onGuessResult(word, feedback, solved, failed, attempts, maxGuesses) {
        _pending = false;
        _guesses.push({ word: word, feedback: feedback });
        _solved = !!solved; _failed = !!failed;
        if (maxGuesses) { _maxGuesses = maxGuesses; ROWS = maxGuesses; }
        _current = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Dictionary rejection — the guess isn't a real word, so no attempt was consumed. Flash a
    // message and leave the in-progress row as-is so the player can fix a letter and resubmit.
    function onGuessRejected(guess) {
        _pending = false;
        _flash('Not in word list');
        if (_root && _root.style.display === 'flex') _render();
    }

    function onStatusUpdate(update) {
        if (!update || !update.name) return;
        _statuses[update.name] = { name: update.name, solved: update.solved, failed: update.failed, attempts: update.attempts, maxGuesses: update.maxGuesses };
        if (_root && _root.style.display === 'flex') _renderStatuses();
    }

    // The first participant of the day just locked in today's settings — everyone (including
    // the configurer, via Clients.Group) gets this and switches from the setup form to the grid.
    // settings: { lengthMode: 0|1, length, maxGuesses }. The word's actual length arrives a
    // moment later on WordleReset, since under "Up to" it isn't the configured length.
    function onConfigured(settings) {
        settings = settings || {};
        if (settings.maxGuesses) { _maxGuesses = settings.maxGuesses; ROWS = settings.maxGuesses; }
        if (settings.length) COLS = settings.length;
        // Server keys the day's puzzle by UTC date, so this matches without another round-trip.
        _puzzleId = new Date().toISOString().slice(0, 10);
        _needsSetup = false;
        _guesses = []; _current = ''; _solved = false; _failed = false; _pending = false; _statuses = {};
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    function onReset(wordLength) {
        _guesses = []; _current = ''; _solved = false; _failed = false; _pending = false; _statuses = {};
        if (wordLength) COLS = wordLength;
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // state: { wordlePuzzleId, wordleNeedsSetup, wordleLengthMode, wordleLength, wordleMaxGuesses,
    //          wordleAllowedLengths, wordleWordLength, myWordle: {solved,failed,guesses} | null,
    //          wordleStatuses: [...] }
    function loadState(state) {
        state = state || {};
        _puzzleId = state.wordlePuzzleId || null;
        _needsSetup = !!state.wordleNeedsSetup;
        _maxGuesses = state.wordleMaxGuesses || 6;
        ROWS = _maxGuesses;
        COLS = state.wordleWordLength || state.wordleLength || 5;
        var mine = state.myWordle;
        _guesses = (mine && mine.guesses) || [];
        _solved = !!(mine && mine.solved);
        _failed = !!(mine && mine.failed);
        _current = ''; _pending = false;
        _statuses = {};
        (state.wordleStatuses || []).forEach(function (s) {
            _statuses[s.name] = { name: s.name, solved: s.solved, failed: s.failed, attempts: s.attempts, maxGuesses: s.maxGuesses };
        });
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Wordle = {
        open: open, close: close, onGuessResult: onGuessResult, onGuessRejected: onGuessRejected,
        onStatusUpdate: onStatusUpdate, onConfigured: onConfigured, onReset: onReset, loadState: loadState
    };
}());
