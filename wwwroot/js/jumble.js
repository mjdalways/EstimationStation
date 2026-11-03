// ============================================================
// In-room game #6 — private/competitive Jumble. A handful of scrambled small words feed
// a final answer, one set per room per UTC day. Small-word guesses stay private
// (same private-guess model as Wordle/Spelling Bee); the final-answer solve is
// broadcast (attempts/elapsed only, no spoilers). See Hubs/PokerHub.cs
// JumbleGuessWord/JumbleGuessFinal/JumbleNewGame/EnsureJumblePuzzle.
//
// How many words there are (which is also the final answer's length) and their length range
// are per-room settings, picked by whoever sets the game up for the day (see game-settings.js).
// Everything below sizes itself off _scrambled.length rather than assuming 4.
// ============================================================
(function () {
    var _root = null, _built = false;
    var _tilesEl = null, _finalInput = null, _finalBtn = null, _statusEl = null, _statusWrap = null, _msgEl = null, _newGameBtn = null, _modeSelect = null;
    var _scrambled = [];
    var _markedIndex = [];
    var _solved = [];
    var _solvedWords = [];
    var _finalSolved = false;
    var _attempts = 0;
    var _statuses = {};        // name -> { name, attempts, elapsedSeconds }
    var _puzzleId = null;
    var _tileInputs = [], _tilePending = [];
    var _finalPending = false;
    var _mode = 'competitive';
    var _setupEl = null, _gameEls = [], _needsSetup = false;

    // Per-word arrays arrive from the server (and from rooms saved before the word count was
    // configurable) at whatever length they were stored with, so they get padded/trimmed to
    // the current puzzle's word count before anything indexes them.
    function _sized(arr, fill) {
        var n = _scrambled.length;
        var out = (arr || []).slice(0, n);
        while (out.length < n) out.push(fill);
        return out;
    }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'jumble-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,460px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🎲 Jumble</strong>' +
            '<select id="jm-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: everyone shares one puzzle. Competitive: everyone races privately, feeds the leaderboard.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="jm-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="jm-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#jm-new');
        _modeSelect = bar.querySelector('#jm-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.JumbleNet && JumbleNet.setMode) JumbleNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;text-align:center;';
        body.appendChild(_msgEl);

        // Shown instead of the tiles until somebody sets today's puzzle up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _tilesEl = document.createElement('div');
        _tilesEl.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
        body.appendChild(_tilesEl);

        var finalWrap = document.createElement('div');
        finalWrap.style.cssText = 'border-top:1px solid #e5e7eb;padding-top:10px;margin-top:4px;display:flex;flex-direction:column;gap:6px;align-items:center;';
        var finalLabel = document.createElement('div');
        finalLabel.style.cssText = 'font-size:0.8rem;font-weight:700;color:#374151;';
        finalLabel.textContent = 'Final answer — use the circled letters';
        finalWrap.appendChild(finalLabel);

        var finalRow = document.createElement('div');
        finalRow.style.cssText = 'display:flex;gap:6px;';
        _finalInput = document.createElement('input');
        _finalInput.type = 'text';
        _finalInput.autocomplete = 'off';
        _finalInput.spellcheck = false;
        _finalInput.style.cssText = 'width:140px;padding:6px 8px;text-align:center;text-transform:uppercase;' +
            'font-weight:700;letter-spacing:2px;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;';
        _finalInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') _submitFinal(); });
        _finalBtn = document.createElement('button');
        _finalBtn.type = 'button';
        _finalBtn.className = 'btn btn-sm btn-primary';
        _finalBtn.textContent = 'Solve';
        _finalBtn.addEventListener('click', _submitFinal);
        finalRow.appendChild(_finalInput); finalRow.appendChild(_finalBtn);
        finalWrap.appendChild(finalRow);
        body.appendChild(finalWrap);

        _statusWrap = document.createElement('div');
        _statusWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        _statusWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Finished today</div>';
        _statusEl = document.createElement('div');
        _statusEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:0.8rem;';
        _statusWrap.appendChild(_statusEl);
        body.appendChild(_statusWrap);

        _gameEls = [_tilesEl, finalWrap, _statusWrap];

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#jm-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.JumbleNet && JumbleNet.newGame) JumbleNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function _submitTile(i) {
        if (_solved[i] || _tilePending[i]) return;
        var input = _tileInputs[i];
        var guess = (input.value || '').trim().toUpperCase();
        if (!guess) return;
        _tilePending[i] = true;
        if (window.JumbleNet && JumbleNet.guessWord) JumbleNet.guessWord(i, guess);
    }

    function _submitFinal() {
        if (_finalSolved) return;
        var guess = (_finalInput.value || '').trim().toUpperCase();
        if (!guess) return;
        _finalPending = true;
        if (window.JumbleNet && JumbleNet.guessFinal) JumbleNet.guessFinal(guess);
    }

    function _renderTiles() {
        if (!_tilesEl) return;
        // The final answer has one letter per scrambled word, so its box sizes with the count.
        if (_finalInput) _finalInput.style.width = Math.max(110, 26 * _scrambled.length + 30) + 'px';
        _tilesEl.innerHTML = '';
        _tileInputs = [];
        for (var i = 0; i < _scrambled.length; i++) {
            (function (idx) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;';

                var scramble = document.createElement('div');
                scramble.style.cssText = 'display:flex;gap:3px;font-family:monospace;font-weight:700;' +
                    'font-size:1rem;letter-spacing:2px;min-width:110px;';
                var word = _solved[idx] && _solvedWords[idx] ? _solvedWords[idx] : (_scrambled[idx] || '');
                word.split('').forEach(function (ch, ci) {
                    var isMarked = _solved[idx] && ci === _markedIndex[idx];
                    var box = document.createElement('span');
                    box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
                        'width:1.4rem;height:1.6rem;border-radius:4px;' +
                        (isMarked
                            ? 'background:#f7da21;color:#1a1a1b;border:2px solid #d4a600;'
                            : (_solved[idx] ? 'background:#a7f3d0;color:#065f46;' : 'background:#e5e7eb;color:#1a1a1b;'));
                    box.textContent = ch;
                    scramble.appendChild(box);
                });
                row.appendChild(scramble);

                if (_solved[idx]) {
                    var doneTag = document.createElement('span');
                    doneTag.style.cssText = 'color:#059669;font-weight:600;font-size:0.8rem;';
                    doneTag.textContent = '✓ solved';
                    row.appendChild(doneTag);
                } else {
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.autocomplete = 'off';
                    input.spellcheck = false;
                    input.placeholder = 'unscramble';
                    input.style.cssText = 'flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;' +
                        'text-transform:uppercase;font-size:0.9rem;';
                    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') _submitTile(idx); });
                    row.appendChild(input);
                    _tileInputs[idx] = input;

                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-sm btn-outline-primary';
                    btn.textContent = 'Check';
                    btn.addEventListener('click', function () { _submitTile(idx); });
                    row.appendChild(btn);
                }

                _tilesEl.appendChild(row);
            })(i);
        }
    }

    function _renderStatuses() {
        if (!_statusEl) return;
        _statusEl.innerHTML = '';
        var names = Object.keys(_statuses);
        if (!names.length) { _statusEl.innerHTML = '<span style="color:#9ca3af;">Nobody has finished yet</span>'; return; }
        names.sort(function (a, b) { return (_statuses[a].attempts || 0) - (_statuses[b].attempts || 0); });
        names.forEach(function (name) {
            var s = _statuses[name];
            var row = document.createElement('div');
            row.textContent = '🏁 ' + name + ' — ' + s.attempts + ' attempt' + (s.attempts === 1 ? '' : 's');
            _statusEl.appendChild(row);
        });
    }

    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) { _modeSelect.style.display = isHost ? '' : 'none'; _modeSelect.value = _mode; }
        if (_setupEl) {
            _setupEl.style.display = _needsSetup ? 'flex' : 'none';
            // '' rather than a concrete display so each section keeps its own rule.
            if (window.GameSettings) GameSettings.toggle(_gameEls, _needsSetup);
            if (_needsSetup) {
                if (_msgEl) _msgEl.textContent = '';
                if (window.GameSettings) GameSettings.render('jumble', _setupEl);
                return;
            }
        }
        _renderTiles();
        if (_statusWrap) _statusWrap.style.display = _mode === 'coop' ? 'none' : '';
        _renderStatuses();
        if (_finalInput) {
            _finalInput.disabled = _finalSolved;
            _finalBtn.disabled = _finalSolved;
        }
        if (_msgEl) _msgEl.textContent = _finalSolved ? ('🎉 Solved in ' + _attempts + ' attempt' + (_attempts === 1 ? '' : 's') + '!') : '';
    }

    // ── Public API ────────────────────────────────────────────
    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js). In coop mode this broadcasts to the whole
    // group, so `wasMine` guards against clearing another player's in-progress input.
    function onWordGuessResult(index, correct, word, markedIndex) {
        var wasMine = _tilePending[index];
        _tilePending[index] = false;
        if (correct) {
            _solved[index] = true;
            _solvedWords[index] = word;
            _markedIndex[index] = markedIndex;
        } else if (wasMine && _tileInputs[index]) {
            _tileInputs[index].value = '';
            _tileInputs[index].placeholder = 'try again';
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    function onFinalGuessResult(correct) {
        var wasMine = _finalPending;
        _finalPending = false;
        if (correct) {
            _finalSolved = true;
        } else if (wasMine && _finalInput) {
            _finalInput.value = '';
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    function onStatusUpdate(update) {
        if (!update || !update.name) return;
        _statuses[update.name] = { name: update.name, attempts: update.attempts, elapsedSeconds: update.elapsedSeconds };
        if (_root && _root.style.display === 'flex') _renderStatuses();
    }

    function onReset(scrambled, markedIndex) {
        _needsSetup = false;
        _scrambled = scrambled || [];
        _markedIndex = _sized(markedIndex, 0);
        _solved = _sized([], false);
        _solvedWords = _sized([], null);
        _finalSolved = false;
        _attempts = 0;
        _statuses = {};
        _tilePending = _sized([], false);
        _finalPending = false;
        if (_finalInput) _finalInput.value = '';
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the JumbleReset that follows carries the words.
    function onConfigured(settings) {
        _needsSetup = false;
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'competitive';
        if (_root && _root.style.display === 'flex') _render();
    }

    // state: { jumblePuzzleId, jumbleMode, jumbleScrambled, jumbleMarkedIndex,
    //          myJumble: {wordsSolved,solvedWords,finalSolved,attempts}|null, jumbleStatuses, jumbleShared }
    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.jumble);
        _puzzleId = state.jumblePuzzleId || null;
        _mode = state.jumbleMode || 'competitive';
        _scrambled = state.jumbleScrambled || [];
        _markedIndex = _sized(state.jumbleMarkedIndex, 0);
        var src = _mode === 'coop' ? state.jumbleShared : state.myJumble;
        _solved = _sized(src && src.wordsSolved, false);
        _solvedWords = _sized(src && src.solvedWords, null);
        _finalSolved = !!(src && src.finalSolved);
        _attempts = (src && src.attempts) || 0;
        _tilePending = _sized([], false);
        _finalPending = false;
        _statuses = {};
        (state.jumbleStatuses || []).forEach(function (s) {
            _statuses[s.name] = { name: s.name, attempts: s.attempts };
        });
        if (_finalInput) _finalInput.value = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    window.Jumble = {
        open: open, close: close, onWordGuessResult: onWordGuessResult, onFinalGuessResult: onFinalGuessResult,
        onStatusUpdate: onStatusUpdate, onReset: onReset, onConfigured: onConfigured,
        onModeChanged: onModeChanged, loadState: loadState
    };
}());
