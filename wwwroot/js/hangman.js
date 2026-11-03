// ============================================================
// In-room game #3 — shared collaborative Hangman. One word per room per UTC
// day; every letter guess is broadcast live to the whole room (same
// live-collaboration model as Crossword), because a wrong guess costs the
// whole room a life. See Hubs/PokerHub.cs HangmanGuessLetter/HangmanNewGame/
// EnsureHangmanPuzzle.
//
// Word length range, how many wrong guesses you get, and whether a clue is shown are all
// per-room settings, picked by whoever sets the game up for the day (see game-settings.js).
// ============================================================
(function () {
    var _root = null, _built = false;
    var _wordEl = null, _clueEl = null, _kbEl = null, _gallowsEl = null, _msgEl = null, _newGameBtn = null, _historyEl = null, _modeSelect = null;
    var _setupEl = null, _gameEl = null, _needsSetup = false;
    var _masked = '', _clue = null, _guessedLetters = [], _wrongCount = 0, _maxWrong = 6, _guessedBy = {};
    var _puzzleId = null;
    var _solved = false, _failed = false;
    var _mode = 'coop';

    // Seven fixed frames, but the room can allow anywhere from 3 to 12 wrong guesses, so the
    // frames are spread across whatever the limit is rather than indexed by wrong count. The
    // last frame is reserved for actually being out of guesses.
    var STAGES = ['', '😵', '😵💧', '😵💧💧', '😨💧💧', '😰💧💧💧', '💀'];

    function _stageFor(wrong, maxWrong) {
        if (maxWrong <= 0) return STAGES[0];
        if (wrong >= maxWrong) return STAGES[STAGES.length - 1];
        var last = STAGES.length - 1;
        var idx = Math.min(last - 1, Math.round(wrong / maxWrong * last));
        return STAGES[Math.max(0, idx)];
    }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'hangman-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,480px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🎪 Hangman</strong>' +
            '<select id="hm-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: one shared word for the room. Competitive: everyone races their own word.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="hm-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="hm-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#hm-new');
        _modeSelect = bar.querySelector('#hm-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.HangmanNet && HangmanNet.setMode) HangmanNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        body.appendChild(_msgEl);

        // Shown instead of the board until somebody sets today's word up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _gameEl = document.createElement('div');
        _gameEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;';
        body.appendChild(_gameEl);

        _gallowsEl = document.createElement('div');
        _gallowsEl.style.cssText = 'font-size:2.4rem;min-height:2.6rem;';
        _gameEl.appendChild(_gallowsEl);

        _clueEl = document.createElement('div');
        _clueEl.style.cssText = 'font-size:0.82rem;color:#6b7280;font-style:italic;text-align:center;min-height:1.1em;';
        _gameEl.appendChild(_clueEl);

        _wordEl = document.createElement('div');
        _wordEl.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;font-weight:700;' +
            'font-size:1.6rem;letter-spacing:2px;font-family:monospace;';
        _gameEl.appendChild(_wordEl);

        _kbEl = document.createElement('div');
        _kbEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;width:100%;max-width:400px;';
        _gameEl.appendChild(_kbEl);

        var histWrap = document.createElement('div');
        histWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        histWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Who guessed what</div>';
        _historyEl = document.createElement('div');
        _historyEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:0.78rem;max-height:120px;overflow-y:auto;';
        histWrap.appendChild(_historyEl);
        _gameEl.appendChild(histWrap);

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#hm-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.HangmanNet && HangmanNet.newGame) HangmanNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });

        _buildKeyboard();
    }

    function _buildKeyboard() {
        var rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
        _kbEl.innerHTML = '';
        rows.forEach(function (rowSpec) {
            var rowEl = document.createElement('div');
            rowEl.style.cssText = 'display:flex;gap:4px;justify-content:center;';
            rowSpec.split('').forEach(function (k) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('data-key', k);
                btn.textContent = k;
                btn.style.cssText = 'border:none;border-radius:4px;background:#d3d6da;color:#1a1a1b;' +
                    'font-weight:600;font-size:0.78rem;padding:0;height:38px;flex:1 1 0;min-width:0;cursor:pointer;';
                btn.addEventListener('click', function () { _guess(k); });
                rowEl.appendChild(btn);
            });
            _kbEl.appendChild(rowEl);
        });
    }

    function _guess(letter) {
        if (_solved || _failed || _guessedLetters.indexOf(letter) >= 0) return;
        if (window.HangmanNet && HangmanNet.guessLetter) HangmanNet.guessLetter(letter);
    }

    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) {
            _modeSelect.style.display = isHost ? '' : 'none';
            if (document.activeElement !== _modeSelect) _modeSelect.value = _mode;
        }
        if (!_setupEl || !_gameEl) return;
        if (_needsSetup) {
            if (_msgEl) _msgEl.textContent = '';
            _setupEl.style.display = 'block';
            _gameEl.style.display = 'none';
            if (window.GameSettings) GameSettings.render('hangman', _setupEl);
            return;
        }
        _setupEl.style.display = 'none';
        _gameEl.style.display = 'flex';
        if (!_wordEl) return;

        _gallowsEl.textContent = _stageFor(_wrongCount, _maxWrong);
        _clueEl.textContent = _clue ? ('Clue: ' + _clue) : '';

        _wordEl.innerHTML = '';
        _masked.split('').forEach(function (ch) {
            var box = document.createElement('span');
            box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
                'width:1.6rem;height:2rem;border-bottom:3px solid #374151;';
            box.textContent = ch === '_' ? '' : ch;
            _wordEl.appendChild(box);
        });

        _kbEl.querySelectorAll('button[data-key]').forEach(function (btn) {
            var k = btn.getAttribute('data-key');
            var used = _guessedLetters.indexOf(k) >= 0;
            var wasCorrect = used && _masked.indexOf(k) >= 0;
            btn.disabled = used || _solved || _failed;
            btn.style.background = used ? (wasCorrect ? '#6aaa64' : '#787c7f') : '#d3d6da';
            btn.style.color = used ? '#fff' : '#1a1a1b';
        });

        if (_mode === 'competitive') {
            _historyEl.parentElement.style.display = _guessedLetters.length ? '' : 'none';
            _historyEl.innerHTML = '';
            _guessedLetters.forEach(function (letter) {
                var row = document.createElement('div');
                var wasCorrect = _masked.indexOf(letter) >= 0;
                row.textContent = (wasCorrect ? '✅ ' : '❌ ') + letter;
                _historyEl.appendChild(row);
            });
        } else {
            _historyEl.parentElement.style.display = '';
            _historyEl.innerHTML = '';
            var names = Object.keys(_guessedBy);
            if (!names.length) {
                _historyEl.innerHTML = '<span style="color:#9ca3af;">Nobody has guessed yet</span>';
            } else {
                names.forEach(function (letter) {
                    var row = document.createElement('div');
                    var wasCorrect = _masked.indexOf(letter) >= 0;
                    row.textContent = (wasCorrect ? '✅ ' : '❌ ') + letter + ' — ' + _guessedBy[letter];
                    _historyEl.appendChild(row);
                });
            }
        }

        if (_msgEl) {
            var solvedMsg = _mode === 'competitive' ? '🎉 You solved it!' : '🎉 Solved by the room!';
            _msgEl.textContent = _solved ? solvedMsg : (_failed ? '💀 Out of guesses' : '');
        }
    }

    // ── Public API ────────────────────────────────────────────
    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onLetterGuessed(letter, correct, wrongCount, solved, failed, guesserName, masked) {
        if (_guessedLetters.indexOf(letter) < 0) _guessedLetters.push(letter);
        _guessedBy[letter] = guesserName;
        _wrongCount = wrongCount;
        _solved = !!solved; _failed = !!failed;
        if (masked) _masked = masked;
        if (_root && _root.style.display === 'flex') _render();
    }

    // puzzleId/clue/maxWrong come from HangmanNewGame's broadcast.
    function onReset(wordLength, clue, maxWrong) {
        _needsSetup = false;
        _masked = new Array(wordLength + 1).join('_');
        _clue = clue || null;
        if (maxWrong) _maxWrong = maxWrong;
        _guessedLetters = []; _guessedBy = {}; _wrongCount = 0; _solved = false; _failed = false;
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the HangmanReset that follows carries the actual
    // word length, clue and wrong-guess limit.
    function onConfigured(settings) {
        _needsSetup = false;
        if (settings && settings.maxWrong) _maxWrong = settings.maxWrong;
        _guessedLetters = []; _guessedBy = {}; _wrongCount = 0; _solved = false; _failed = false;
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'coop';
        if (_root && _root.style.display === 'flex') _render();
    }

    // state: { hangmanPuzzleId, hangmanMode, hangmanMasked, hangmanClue, hangmanGuessedLetters,
    //          hangmanWrongCount, hangmanMaxWrong, hangmanGuessedBy, myHangman }
    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.hangman);
        _puzzleId = state.hangmanPuzzleId || null;
        _mode = state.hangmanMode || 'coop';
        _clue = state.hangmanClue || null;
        _maxWrong = state.hangmanMaxWrong || 6;

        if (_mode === 'competitive') {
            var mine = state.myHangman || null;
            _masked = mine ? mine.masked : new Array((state.hangmanMasked || '').length + 1).join('_');
            _guessedLetters = mine ? (mine.guessedLetters || []).slice() : [];
            _wrongCount = mine ? mine.wrongCount : 0;
            _guessedBy = {};
            _solved = !!(mine && mine.solved);
            _failed = !!(mine && mine.failed);
        } else {
            _masked = state.hangmanMasked || '';
            _guessedLetters = (state.hangmanGuessedLetters || []).slice();
            _wrongCount = state.hangmanWrongCount || 0;
            _guessedBy = Object.assign({}, state.hangmanGuessedBy || {});
            _solved = _masked.length > 0 && _masked.indexOf('_') < 0;
            _failed = !_solved && _wrongCount >= _maxWrong;
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Hangman = {
        open: open, close: close, onLetterGuessed: onLetterGuessed, onReset: onReset,
        onConfigured: onConfigured, onModeChanged: onModeChanged, loadState: loadState
    };
}());
