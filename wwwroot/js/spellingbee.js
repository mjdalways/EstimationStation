// ============================================================
// In-room game #5 — private/competitive Spelling Bee. One letter set per room
// per UTC day; found words stay private to the finder (same private-guess
// model as Wordle), only score/word-count is broadcast. See
// Hubs/PokerHub.cs SpellingBeeSubmit/SpellingBeeNewGame/EnsureSpellingBeePuzzle.
//
// How many letters are in the hive, the shortest accepted word and the pangram bonus are all
// per-room settings, picked by whoever sets the game up for the day (see game-settings.js).
// ============================================================
(function () {
    var _root = null, _built = false;
    var _hiveEl = null, _currentEl = null, _foundEl = null, _statusEl = null, _statusWrap = null, _msgEl = null, _newGameBtn = null, _scoreEl = null, _modeSelect = null;
    var _letters = '';          // center first
    var _current = '';
    var _foundWords = [];
    var _foundBy = {};          // word -> foundByName (coop only)
    var _score = 0;
    var _wordCount = 0;
    var _statuses = {};         // name -> { name, score, wordCount }
    var _puzzleId = null;
    var _pending = false;
    var _mode = 'competitive';
    var _setupEl = null, _gameEls = [], _needsSetup = false;
    var _minWordLength = 4;    // mirrors the room's setting; the server is the real arbiter

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'spellingbee-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,460px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🐝 Spelling Bee</strong>' +
            '<select id="sb-mode" class="form-select form-select-sm" style="display:none;width:auto;font-size:0.78rem;" title="Coop: everyone shares one found-word list. Competitive: everyone races privately, feeds the leaderboard.">' +
            '<option value="coop">🤝 Coop</option><option value="competitive">🏁 Competitive</option></select>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="sb-new" class="btn btn-sm btn-outline-primary" style="display:none;" title="Reshuffle the puzzle for everyone in the room">🎲 New puzzle</button>' +
            '<button id="sb-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);
        _newGameBtn = bar.querySelector('#sb-new');
        _modeSelect = bar.querySelector('#sb-mode');
        _modeSelect.addEventListener('change', function () {
            if (window.SpellingBeeNet && SpellingBeeNet.setMode) SpellingBeeNet.setMode(_modeSelect.value);
        });

        var body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow-y:auto;';

        _msgEl = document.createElement('div');
        _msgEl.style.cssText = 'min-height:1.2em;font-weight:600;font-size:0.85rem;color:#374151;';
        body.appendChild(_msgEl);

        // Shown instead of the hive until somebody sets today's puzzle up for the room.
        _setupEl = document.createElement('div');
        _setupEl.style.cssText = 'display:none;';
        body.appendChild(_setupEl);

        _scoreEl = document.createElement('div');
        _scoreEl.style.cssText = 'font-size:0.85rem;color:#374151;font-weight:600;';
        body.appendChild(_scoreEl);

        _currentEl = document.createElement('div');
        _currentEl.style.cssText = 'font-size:1.3rem;font-weight:700;letter-spacing:2px;min-height:1.6em;text-transform:uppercase;color:#1a1a1b;';
        body.appendChild(_currentEl);

        _hiveEl = document.createElement('div');
        _hiveEl.style.cssText = 'position:relative;width:220px;height:220px;';
        body.appendChild(_hiveEl);

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;';
        var delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.className = 'btn btn-sm btn-outline-secondary'; delBtn.textContent = '⌫ Delete';
        delBtn.addEventListener('click', function () { _current = _current.slice(0, -1); _render(); });
        var subBtn = document.createElement('button');
        subBtn.type = 'button'; subBtn.className = 'btn btn-sm btn-primary'; subBtn.textContent = 'Enter';
        subBtn.addEventListener('click', _submit);
        actions.appendChild(delBtn); actions.appendChild(subBtn);
        body.appendChild(actions);

        var foundWrap = document.createElement('div');
        foundWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        foundWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Words you found</div>';
        _foundEl = document.createElement('div');
        _foundEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;font-size:0.8rem;max-height:80px;overflow-y:auto;';
        foundWrap.appendChild(_foundEl);
        body.appendChild(foundWrap);

        _statusWrap = document.createElement('div');
        _statusWrap.style.cssText = 'width:100%;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;';
        _statusWrap.innerHTML = '<div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:4px;">Who\'s playing</div>';
        _statusEl = document.createElement('div');
        _statusEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:0.8rem;';
        _statusWrap.appendChild(_statusEl);
        body.appendChild(_statusWrap);

        _gameEls = [_scoreEl, _currentEl, _hiveEl, actions, foundWrap, _statusWrap];

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#sb-close').addEventListener('click', close);
        _newGameBtn.addEventListener('click', function () {
            if (window.SpellingBeeNet && SpellingBeeNet.newGame) SpellingBeeNet.newGame();
        });
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });

        document.addEventListener('keydown', _onPhysicalKey);
    }

    function _onPhysicalKey(e) {
        if (!_root || _root.style.display !== 'flex') return;
        var tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.key === 'Enter') _submit();
        else if (e.key === 'Backspace') { _current = _current.slice(0, -1); _render(); }
        else if (/^[a-zA-Z]$/.test(e.key) && _letters.indexOf(e.key.toUpperCase()) >= 0) { _current += e.key.toUpperCase(); _render(); }
    }

    function _flash(text) {
        if (_msgEl) { _msgEl.textContent = text; setTimeout(function () { if (_msgEl && _msgEl.textContent === text) _msgEl.textContent = ''; }, 1500); }
    }

    function _submit() {
        if (_pending || _current.length < _minWordLength) {
            if (_current.length > 0 && _current.length < _minWordLength) _flash('Too short');
            return;
        }
        _pending = true;
        if (window.SpellingBeeNet && SpellingBeeNet.submit) SpellingBeeNet.submit(_current);
    }

    // The hive is the required centre letter plus however many outer letters the room chose
    // (5-9 total), spaced evenly around it. The 7-letter case reproduces the original fixed
    // layout exactly: first outer cell straight up, the rest clockwise from there.
    function _renderHive() {
        if (!_hiveEl) return;
        _hiveEl.innerHTML = '';
        var count = _letters ? _letters.length : 0;
        if (count < 2) return;
        var box = 220, hexSize = 64, radius = 78;
        var centre = box / 2 - hexSize / 2;
        var positions = [{ x: centre, y: centre }];
        for (var j = 1; j < count; j++) {
            var angle = -Math.PI / 2 + (j - 1) * (2 * Math.PI / (count - 1));
            positions.push({
                x: Math.round(centre + radius * Math.cos(angle)),
                y: Math.round(centre + radius * Math.sin(angle))
            });
        }
        for (var i = 0; i < count; i++) {
            var letter = _letters[i];
            var isCenter = i === 0;
            var hex = document.createElement('button');
            hex.type = 'button';
            hex.textContent = letter;
            hex.style.cssText = 'position:absolute;left:' + positions[i].x + 'px;top:' + positions[i].y + 'px;' +
                'width:64px;height:64px;border:none;border-radius:10px;font-weight:700;font-size:1.3rem;cursor:pointer;' +
                'background:' + (isCenter ? '#f7da21' : '#e6e6e6') + ';color:#1a1a1b;';
            hex.addEventListener('click', function (l) { return function () { _current += l; _render(); }; }(letter));
            _hiveEl.appendChild(hex);
        }
    }

    function _renderStatuses() {
        if (!_statusEl) return;
        _statusEl.innerHTML = '';
        var names = Object.keys(_statuses);
        if (!names.length) { _statusEl.innerHTML = '<span style="color:#9ca3af;">Nobody has started yet</span>'; return; }
        names.sort(function (a, b) { return (_statuses[b].score || 0) - (_statuses[a].score || 0); });
        names.forEach(function (name) {
            var s = _statuses[name];
            var row = document.createElement('div');
            row.textContent = '🐝 ' + name + ' — ' + s.score + ' pts (' + s.wordCount + ' words)';
            _statusEl.appendChild(row);
        });
    }

    function _render() {
        var isHost = !!(window.roomState && window.roomState.isHost) && !_needsSetup;
        if (_newGameBtn) _newGameBtn.style.display = isHost ? '' : 'none';
        if (_modeSelect) { _modeSelect.style.display = isHost ? '' : 'none'; _modeSelect.value = _mode; }
        if (_setupEl) {
            _setupEl.style.display = _needsSetup ? 'flex' : 'none';
            // '' rather than a concrete display so each element keeps its own rule.
            if (window.GameSettings) GameSettings.toggle(_gameEls, _needsSetup);
            if (_needsSetup) {
                if (_msgEl) _msgEl.textContent = '';
                if (window.GameSettings) GameSettings.render('spellingbee', _setupEl);
                return;
            }
        }
        _currentEl.textContent = _current;
        _renderHive();
        _scoreEl.textContent = _mode === 'coop' ? ('Room score: ' + _score + ' (' + _wordCount + ' words)') : ('Your score: ' + _score);
        _foundEl.innerHTML = '';
        if (!_foundWords.length) {
            _foundEl.innerHTML = '<span style="color:#9ca3af;">None yet</span>';
        } else {
            _foundWords.slice().sort().forEach(function (w) {
                var chip = document.createElement('span');
                chip.style.cssText = 'background:#f3f4f6;border-radius:4px;padding:2px 6px;';
                chip.textContent = w + (_mode === 'coop' && _foundBy[w] ? (' — ' + _foundBy[w]) : '');
                _foundEl.appendChild(chip);
            });
        }
        if (_statusWrap) _statusWrap.style.display = _mode === 'coop' ? 'none' : '';
        _renderStatuses();
    }

    // ── Public API ────────────────────────────────────────────
    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onSubmitResult(valid, word, scoreGain, isPangram, alreadyFound) {
        _pending = false;
        if (valid) {
            _foundWords.push(word);
            _score += scoreGain;
            _wordCount = _foundWords.length;
            if (_mode === 'coop') _foundBy[word] = 'You';
            _current = '';
            _flash(isPangram ? '🌟 Pangram! +' + scoreGain : '+' + scoreGain);
        } else if (alreadyFound) {
            _flash('Already found');
        } else {
            _flash('Not a valid word');
        }
        if (_root && _root.style.display === 'flex') _render();
    }

    // Coop only: broadcast to everyone except the finder when someone else finds a word.
    function onSharedFound(word, scoreGain, isPangram, foundByName, totalScore, wordCount) {
        if (_foundWords.indexOf(word) >= 0) return;
        _foundWords.push(word);
        _foundBy[word] = foundByName;
        _score = totalScore;
        _wordCount = wordCount;
        if (_root && _root.style.display === 'flex') _render();
    }

    function onStatusUpdate(update) {
        if (!update || !update.name) return;
        _statuses[update.name] = { name: update.name, score: update.score, wordCount: update.wordCount };
        if (_root && _root.style.display === 'flex') _renderStatuses();
    }

    function onReset(puzzleId, letters) {
        _needsSetup = false;
        _syncMinWordLength();
        _puzzleId = puzzleId;
        _letters = letters || '';
        _current = ''; _foundWords = []; _foundBy = {}; _score = 0; _wordCount = 0; _statuses = {}; _pending = false;
        if (_msgEl) _msgEl.textContent = '';
        if (_root && _root.style.display === 'flex') _render();
    }

    // Today's settings just got locked in; the SpellingBeeReset that follows carries the hive.
    function onConfigured(settings) {
        _needsSetup = false;
        if (settings && settings.minWordLength) _minWordLength = settings.minWordLength;
        _current = ''; _foundWords = []; _foundBy = {}; _score = 0; _wordCount = 0; _statuses = {};
        if (_root && _root.style.display === 'flex') _render();
    }

    function onModeChanged(mode) {
        _mode = mode || 'competitive';
        if (_root && _root.style.display === 'flex') _render();
    }

    // state: { spellingBeePuzzleId, spellingBeeMode, spellingBeeLetters, mySpellingBee: {foundWords,score}|null,
    //          spellingBeeStatuses, spellingBeeSharedFound, spellingBeeSharedScore }
    function _syncMinWordLength() {
        var s = window.GameSettings && GameSettings.settings('spellingbee');
        if (s && s.minWordLength) _minWordLength = s.minWordLength;
    }

    function loadState(state) {
        state = state || {};
        _needsSetup = !!(state.gameNeedsSetup && state.gameNeedsSetup.spellingbee);
        _syncMinWordLength();
        _puzzleId = state.spellingBeePuzzleId || null;
        _mode = state.spellingBeeMode || 'competitive';
        _letters = state.spellingBeeLetters || '';
        _current = ''; _pending = false;
        _foundBy = {};
        if (_mode === 'coop') {
            _foundWords = (state.spellingBeeSharedFound || []).slice();
            _score = state.spellingBeeSharedScore || 0;
            _wordCount = _foundWords.length;
        } else {
            var mine = state.mySpellingBee;
            _foundWords = (mine && mine.foundWords) || [];
            _score = (mine && mine.score) || 0;
            _wordCount = _foundWords.length;
        }
        _statuses = {};
        (state.spellingBeeStatuses || []).forEach(function (s) {
            _statuses[s.name] = { name: s.name, score: s.score, wordCount: s.wordCount };
        });
        if (_root && _root.style.display === 'flex') _render();
    }

    window.SpellingBee = {
        open: open, close: close, onSubmitResult: onSubmitResult, onSharedFound: onSharedFound,
        onStatusUpdate: onStatusUpdate, onReset: onReset, onConfigured: onConfigured,
        onModeChanged: onModeChanged, loadState: loadState
    };
}());
