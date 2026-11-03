// ============================================================
// Shared "first participant of the day sets it up" settings form for every in-room game.
//
// All seven games (Wordle, Crossword, Hangman, Word Search, Spelling Bee, Jumble, Acrostic)
// use the same mechanic Wordle has always used: until somebody configures the game for the
// current UTC day, the room has no puzzle for it, and whoever opens it first picks the
// settings — which are then locked in for everyone in the room until the next UTC day.
//
// Rather than seven near-identical setup forms, each game's module hands its overlay body a
// container and calls GameSettings.render(game, container). The field list lives in SPECS
// below; the *values* (current settings) and the *bounds* (min/max, allowed choices) both
// arrive from the server on every room-state push as roomState.gameSettings / gameLimits, so
// there is exactly one source of truth for the ranges — see PokerHub.GameSettingsPayload and
// PokerHub.GameLimitsPayload. Everything here is advisory: the server re-clamps whatever we
// send through each generator's Options.Normalized().
//
// Settings travel as a flat { key: int } map in both directions (booleans as 0/1) so one hub
// method, one form and one payload shape serve all seven games.
// ============================================================
(function () {
    // range: names a { min, max } object under roomState.gameLimits[game].
    // choices: names an int array under the same, rendered as a dropdown.
    // pairs: [minKey, maxKey] entries whose values are kept ordered before submitting.
    var SPECS = {
        wordle: {
            title: 'Wordle',
            fields: [
                {
                    key: 'lengthMode', label: 'Length mode', type: 'options', options: [
                        { value: 0, label: 'Fixed', help: 'every word is exactly the chosen length' },
                        { value: 1, label: 'Up to', help: 'each day’s word length is randomly picked from the shortest available length up to the chosen one' }
                    ],
                    note: 'Note: "Up to 5" is the same as "Fixed 5" — no word shorter than 5 letters is available.'
                },
                { key: 'length', label: 'Length', type: 'choice', choices: 'allowedLengths', suffix: ' letters' },
                { key: 'maxGuesses', label: 'Max guesses', type: 'number', range: 'maxGuesses' }
            ]
        },
        crossword: {
            title: 'Crossword',
            fields: [
                { key: 'size', label: 'Grid size', type: 'number', range: 'size', suffix: ' × N', help: 'Bigger grids have more (and shorter) words.' }
            ]
        },
        hangman: {
            title: 'Hangman',
            fields: [
                { key: 'maxWrong', label: 'Wrong guesses allowed', type: 'number', range: 'maxWrong' },
                { key: 'minLength', label: 'Shortest word', type: 'number', range: 'wordLength', suffix: ' letters' },
                { key: 'maxLength', label: 'Longest word', type: 'number', range: 'wordLength', suffix: ' letters' },
                { key: 'showClue', label: 'Show a clue with the word', type: 'bool' }
            ],
            pairs: [['minLength', 'maxLength']]
        },
        wordsearch: {
            title: 'Word Search',
            fields: [
                { key: 'size', label: 'Grid size', type: 'number', range: 'size', suffix: ' × N' },
                { key: 'wordCount', label: 'Words to hide', type: 'number', range: 'wordCount', help: 'Fewer may fit if the grid is small.' },
                { key: 'minLength', label: 'Shortest word', type: 'number', range: 'wordLength', suffix: ' letters' },
                { key: 'maxLength', label: 'Longest word', type: 'number', range: 'wordLength', suffix: ' letters' },
                { key: 'allowDiagonal', label: 'Allow diagonal placement', type: 'bool' },
                { key: 'allowReverse', label: 'Allow backwards placement', type: 'bool' }
            ],
            pairs: [['minLength', 'maxLength']]
        },
        spellingbee: {
            title: 'Spelling Bee',
            fields: [
                { key: 'letterCount', label: 'Letters in the hive', type: 'number', range: 'letterCount', help: 'One is always the required centre letter.' },
                { key: 'minWordLength', label: 'Shortest accepted word', type: 'number', range: 'minWordLength', suffix: ' letters' },
                { key: 'pangramBonus', label: 'Pangram bonus', type: 'number', range: 'pangramBonus', suffix: ' points' }
            ]
        },
        jumble: {
            title: 'Jumble',
            fields: [
                { key: 'wordCount', label: 'Scrambled words', type: 'number', range: 'wordCount', help: 'Also the length of the final answer — each word contributes one circled letter.' },
                { key: 'minLength', label: 'Shortest word', type: 'number', range: 'wordLength', suffix: ' letters' },
                { key: 'maxLength', label: 'Longest word', type: 'number', range: 'wordLength', suffix: ' letters' }
            ],
            pairs: [['minLength', 'maxLength']]
        },
        acrostic: {
            title: 'Acrostic',
            fields: [
                { key: 'maxQuoteLength', label: 'Longest quote', type: 'number', range: 'maxQuoteLength', suffix: ' characters', zeroLabel: 'no limit', help: 'Set to 0 for no limit. Shorter quotes make for a quicker puzzle.' }
            ]
        },
        connections: {
            title: 'Connections',
            fields: [
                { key: 'categoryCount', label: 'Groups to find', type: 'number', range: 'categoryCount' },
                { key: 'wordsPerCategory', label: 'Words per group', type: 'number', range: 'wordsPerCategory', help: 'Groups × words is the size of the grid — 4 × 4 is the familiar shape.' },
                { key: 'mistakesAllowed', label: 'Mistakes allowed', type: 'number', range: 'mistakesAllowed' },
                {
                    key: 'difficulty', label: 'Difficulty', type: 'options', options: [
                        { value: 0, label: 'Kind', help: 'the groups come from unrelated families, so few words look at home in more than one' },
                        { value: 1, label: 'Normal', help: 'a mix, the way the puzzle is usually played' },
                        { value: 2, label: 'Cruel', help: 'groups deliberately share a surface reading — expect several near-miss guesses' }
                    ]
                }
            ]
        }
    };

    function _state() { return window.roomState || {}; }
    function limits(game) { var l = _state().gameLimits; return (l && l[game]) || {}; }
    function settings(game) { var s = _state().gameSettings; return (s && s[game]) || {}; }
    function needsSetup(game) { var n = _state().gameNeedsSetup; return !!(n && n[game]); }

    function _range(game, name) {
        var r = limits(game)[name];
        return (r && typeof r.min === 'number') ? r : { min: 0, max: 999 };
    }

    // Writes the freshly-locked-in settings back into the cached room state so a re-render (or
    // another game's form) sees them without waiting for the next full room-state push.
    function applyConfigured(game, values) {
        var st = window.roomState;
        if (!st) return;
        if (st.gameNeedsSetup) st.gameNeedsSetup[game] = false;
        if (st.gameSettings && values) st.gameSettings[game] = values;
    }

    // Builds the setup form for `game` into `container`. Returns nothing; the Start button
    // submits through GameSettingsNet.configure and the server answers with GameConfigured +
    // the game's own *Reset event, which is what actually switches the UI over to the puzzle.
    // Shows/hides a game's panes around the setup form. Not just `display = ''`: these panels
    // set their layout inline (display:flex in a cssText), so clearing the property would drop
    // that and leave them as plain blocks. The value each element was built with is remembered
    // the first time it is hidden and put back verbatim.
    function toggle(els, hidden) {
        (els || []).forEach(function (el) {
            if (!el) return;
            if (el.__gsDisplay === undefined) el.__gsDisplay = el.style.display || '';
            el.style.display = hidden ? 'none' : el.__gsDisplay;
        });
    }

    function render(game, container) {
        var spec = SPECS[game];
        if (!spec || !container) return;
        var current = settings(game);
        var inputs = {};

        container.innerHTML = '';
        container.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:100%;max-width:380px;font-size:0.85rem;';

        var intro = document.createElement('div');
        intro.style.cssText = 'color:#374151;';
        intro.textContent = 'Nobody has set up today’s ' + spec.title + ' for this room yet. Choose the settings below — ' +
            'they’ll be locked in for everyone in the room for the rest of the day.';
        container.appendChild(intro);

        spec.fields.forEach(function (f) {
            var value = typeof current[f.key] === 'number' ? current[f.key] : 0;

            if (f.type === 'options') {
                var wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
                var name = 'gs-' + game + '-' + f.key;
                f.options.forEach(function (o) {
                    var lbl = document.createElement('label');
                    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
                    var radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = name;
                    radio.value = String(o.value);
                    radio.checked = value === o.value;
                    var text = document.createElement('span');
                    text.innerHTML = '<strong></strong>';
                    text.querySelector('strong').textContent = o.label;
                    if (o.help) text.appendChild(document.createTextNode(' — ' + o.help));
                    lbl.appendChild(radio); lbl.appendChild(text);
                    wrap.appendChild(lbl);
                });
                if (f.note) {
                    var note = document.createElement('div');
                    note.style.cssText = 'color:#9ca3af;font-size:0.75rem;margin-left:22px;';
                    note.textContent = f.note;
                    wrap.appendChild(note);
                }
                inputs[f.key] = function () {
                    var picked = wrap.querySelector('input[name="' + name + '"]:checked');
                    return picked ? parseInt(picked.value, 10) : 0;
                };
                container.appendChild(wrap);
                return;
            }

            if (f.type === 'bool') {
                var boolWrap = document.createElement('label');
                boolWrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
                var check = document.createElement('input');
                check.type = 'checkbox';
                check.checked = value !== 0;
                var boolText = document.createElement('span');
                boolText.textContent = f.label;
                boolWrap.appendChild(check); boolWrap.appendChild(boolText);
                inputs[f.key] = function () { return check.checked ? 1 : 0; };
                container.appendChild(boolWrap);
                return;
            }

            var row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
            var line = document.createElement('div');
            line.style.cssText = 'display:flex;align-items:center;gap:8px;';
            var label = document.createElement('label');
            label.textContent = f.label + ':';
            label.style.cssText = 'font-weight:600;flex:1 1 auto;';
            line.appendChild(label);

            if (f.type === 'choice') {
                var choices = limits(game)[f.choices] || [];
                if (!choices.length) choices = [value || 0];
                var select = document.createElement('select');
                select.className = 'form-select form-select-sm';
                select.style.cssText = 'width:auto;';
                choices.forEach(function (v) {
                    var opt = document.createElement('option');
                    opt.value = String(v);
                    opt.textContent = v + (f.suffix || '');
                    if (v === value) opt.selected = true;
                    select.appendChild(opt);
                });
                line.appendChild(select);
                inputs[f.key] = function () { return parseInt(select.value, 10) || 0; };
            } else {
                var r = _range(game, f.range);
                var num = document.createElement('input');
                num.type = 'number';
                num.className = 'form-control form-control-sm';
                num.style.cssText = 'width:6rem;';
                num.min = String(r.min);
                num.max = String(r.max);
                num.value = String(Math.min(Math.max(value, r.min), r.max));
                line.appendChild(num);
                var hint = document.createElement('span');
                hint.style.cssText = 'color:#9ca3af;font-size:0.75rem;';
                hint.textContent = r.min + '–' + r.max + (f.zeroLabel ? ' (' + r.min + ' = ' + f.zeroLabel + ')' : '');
                line.appendChild(hint);
                inputs[f.key] = function () {
                    var v = parseInt(num.value, 10);
                    if (isNaN(v)) v = r.min;
                    return Math.min(Math.max(v, r.min), r.max);
                };
            }

            row.appendChild(line);
            if (f.help) {
                var help = document.createElement('div');
                help.style.cssText = 'color:#9ca3af;font-size:0.75rem;';
                help.textContent = f.help;
                row.appendChild(help);
            }
            container.appendChild(row);
        });

        var startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'btn btn-sm btn-primary';
        startBtn.style.cssText = 'align-self:flex-start;';
        startBtn.textContent = 'Start today’s game';
        startBtn.addEventListener('click', function () {
            var values = {};
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k](); });
            // Keep min/max pairs ordered locally so the form never submits something the server
            // would silently reorder underneath the player.
            (spec.pairs || []).forEach(function (pair) {
                if (values[pair[1]] < values[pair[0]]) values[pair[1]] = values[pair[0]];
            });
            startBtn.disabled = true;
            if (window.GameSettingsNet && GameSettingsNet.configure) GameSettingsNet.configure(game, values);
        });
        container.appendChild(startBtn);
    }

    window.GameSettings = {
        render: render,
        toggle: toggle,
        needsSetup: needsSetup,
        settings: settings,
        limits: limits,
        applyConfigured: applyConfigured
    };
}());
