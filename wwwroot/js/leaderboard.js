// ============================================================
// Shared leaderboard modal — one overall toolbar button, reused for every game.
// Placement-based scoring (3/2/1/0.5), never raw score/time. "Today" badges
// (gold/silver/bronze per game + a crown for the overall daily leader) ride on
// every RoomState; Weekly/Monthly/All-time are fetched on demand via
// Hubs/PokerHub.cs GetLeaderboard(game, range) -> LeaderboardResult(game, range, ranked).
//
// Visual style: podium (crowns + gradient blocks for the top 3) above a ranked
// list, casino-leaderboard style. Only {name, points} is real data — there's no
// avatar image or last-activity timestamp in the model, so those aren't faked.
// ============================================================
(function () {
    var GAMES = [
        { id: 'overall', label: '🏆 Overall', emoji: '🏆' },
        { id: 'wordle', label: 'Wordle', emoji: '🟩' },
        { id: 'crossword', label: 'Crossword', emoji: '🧩' },
        { id: 'hangman', label: 'Hangman', emoji: '👤' },
        { id: 'wordsearch', label: 'Word Search', emoji: '🔍' },
        { id: 'spellingbee', label: 'Spelling Bee', emoji: '🐝' },
        { id: 'jumble', label: 'Jumble', emoji: '🎲' },
        { id: 'acrostic', label: 'Acrostic', emoji: '📋' }
    ];
    var RANGES = [
        { id: 'daily', label: 'Daily' },
        { id: 'weekly', label: 'Weekly' },
        { id: 'monthly', label: 'Monthly' },
        { id: 'alltime', label: 'All-time' }
    ];
    var BADGE_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉', crown: '👑' };
    var AVATAR_PALETTE = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
    var PODIUM_CROWN = ['👑', '🥈', '🥉'];

    var _root = null, _built = false;
    var _gameSel = null, _rangeBar = null, _podiumEl = null, _listEl = null, _todayEl = null;
    var _game = 'overall', _range = 'daily';
    var _dailyBadges = {};     // name -> [badge tokens]
    var _dailySummary = {};    // game -> [{name, points}]

    function _initials(name) {
        var s = (name || '?').trim();
        if (!s) return '?';
        var parts = s.split(/\s+/);
        if (parts.length === 1) return s.slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function _colorForName(name) {
        var s = String(name || '');
        var h = 0;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
    }

    function _avatar(name, sizeClass) {
        var el = document.createElement('div');
        el.className = 'lb-avatar' + (sizeClass ? ' ' + sizeClass : '');
        el.style.background = _colorForName(name);
        el.textContent = _initials(name);
        el.title = name || '';
        return el;
    }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'leaderboard-overlay';
        _root.className = 'lb-overlay';

        var panel = document.createElement('div');
        panel.className = 'lb-panel';

        var bar = document.createElement('div');
        bar.className = 'lb-header';
        bar.innerHTML = '<strong>🏆 Leaderboard</strong><button id="lb-close" class="lb-close-btn" title="Close">✕</button>';
        panel.appendChild(bar);

        var body = document.createElement('div');
        body.className = 'lb-body';

        var controls = document.createElement('div');
        controls.className = 'lb-controls';

        _gameSel = document.createElement('select');
        _gameSel.className = 'lb-game-select';
        GAMES.forEach(function (g) {
            var opt = document.createElement('option');
            opt.value = g.id; opt.textContent = g.label;
            _gameSel.appendChild(opt);
        });
        _gameSel.addEventListener('change', function () { _game = _gameSel.value; _fetch(); });
        controls.appendChild(_gameSel);

        _rangeBar = document.createElement('div');
        _rangeBar.className = 'lb-range-bar';
        RANGES.forEach(function (r) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lb-range-pill';
            btn.textContent = r.label;
            btn.dataset.range = r.id;
            btn.addEventListener('click', function () { _range = r.id; _fetch(); _renderRangeBar(); });
            _rangeBar.appendChild(btn);
        });
        controls.appendChild(_rangeBar);
        body.appendChild(controls);

        _podiumEl = document.createElement('div');
        _podiumEl.className = 'lb-podium';
        body.appendChild(_podiumEl);

        _listEl = document.createElement('div');
        _listEl.className = 'lb-list';
        body.appendChild(_listEl);

        var todayWrap = document.createElement('details');
        todayWrap.className = 'lb-badges-section';
        var summary = document.createElement('summary');
        summary.textContent = "Today's badges";
        todayWrap.appendChild(summary);
        _todayEl = document.createElement('div');
        _todayEl.className = 'lb-badges-list';
        todayWrap.appendChild(_todayEl);
        body.appendChild(todayWrap);

        panel.appendChild(body);
        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#lb-close').addEventListener('click', close);
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function _renderRangeBar() {
        if (!_rangeBar) return;
        Array.prototype.forEach.call(_rangeBar.children, function (btn) {
            btn.classList.toggle('active', btn.dataset.range === _range);
        });
    }

    function _fetch() {
        if (_podiumEl) _podiumEl.innerHTML = '';
        if (_listEl) _listEl.innerHTML = '<div class="lb-empty">Loading…</div>';
        if (window.LeaderboardNet && LeaderboardNet.get) LeaderboardNet.get(_game, _range);
    }

    function _podiumBlock(row, rank) {
        var col = document.createElement('div');
        col.className = 'lb-podium-col lb-podium-col--' + rank;

        var crownWrap = document.createElement('div');
        crownWrap.className = 'lb-crown-wrap';
        if (rank === 1) {
            var glow = document.createElement('div');
            glow.className = 'lb-crown-glow';
            crownWrap.appendChild(glow);
        }
        var crown = document.createElement('span');
        crown.className = 'lb-crown';
        crown.textContent = PODIUM_CROWN[rank - 1];
        crownWrap.appendChild(crown);
        col.appendChild(crownWrap);

        col.appendChild(_avatar(row.name, 'lb-avatar--podium'));

        var name = document.createElement('div');
        name.className = 'lb-podium-name';
        name.textContent = row.name;
        col.appendChild(name);

        var pts = document.createElement('div');
        pts.className = 'lb-points-badge';
        pts.textContent = '⭐ ' + row.points;
        col.appendChild(pts);

        var block = document.createElement('div');
        block.className = 'lb-block';
        block.textContent = rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
        col.appendChild(block);

        return col;
    }

    function _renderPodium(ranked) {
        if (!_podiumEl) return;
        _podiumEl.innerHTML = '';
        if (!ranked || !ranked.length) { _podiumEl.style.display = 'none'; return; }
        _podiumEl.style.display = 'flex';
        var top3 = ranked.slice(0, 3);
        var order = [2, 1, 3]; // visual order: 2nd, 1st, 3rd
        order.forEach(function (rank) {
            var row = top3[rank - 1];
            if (row) _podiumEl.appendChild(_podiumBlock(row, rank));
            else _podiumEl.appendChild(document.createElement('div')).className = 'lb-podium-col lb-podium-col--empty';
        });
    }

    function _renderList(game, range, ranked) {
        if (!_listEl || game !== _game || range !== _range) return;
        _renderPodium(ranked);
        _listEl.innerHTML = '';
        if (!ranked || !ranked.length) {
            _listEl.innerHTML = '<div class="lb-empty">No results yet</div>';
            return;
        }
        var rest = ranked.slice(3);
        if (!rest.length) return;

        var head = document.createElement('div');
        head.className = 'lb-list-head';
        head.innerHTML = '<span>Place</span><span>User</span><span class="lb-col-points">Points</span>';
        _listEl.appendChild(head);

        rest.forEach(function (row, i) {
            var place = i + 4;
            var item = document.createElement('div');
            item.className = 'lb-row';

            var placeEl = document.createElement('span');
            placeEl.className = 'lb-place';
            placeEl.innerHTML = '🏅 ' + place;
            item.appendChild(placeEl);

            var userEl = document.createElement('span');
            userEl.className = 'lb-user';
            userEl.appendChild(_avatar(row.name, 'lb-avatar--row'));
            var nameSpan = document.createElement('span');
            nameSpan.textContent = row.name;
            userEl.appendChild(nameSpan);
            item.appendChild(userEl);

            var ptsEl = document.createElement('span');
            ptsEl.className = 'lb-col-points';
            ptsEl.textContent = row.points;
            item.appendChild(ptsEl);

            _listEl.appendChild(item);
        });
    }

    function _renderToday() {
        if (!_todayEl) return;
        _todayEl.innerHTML = '';
        var names = Object.keys(_dailyBadges);
        if (!names.length) { _todayEl.innerHTML = '<div class="lb-empty">Nobody has scored yet today</div>'; return; }
        names.forEach(function (name) {
            var badges = _dailyBadges[name] || [];
            var icons = badges.map(function (b) {
                var kind = b.split('-')[0];
                return BADGE_ICON[kind] || '';
            }).join(' ');
            var row = document.createElement('div');
            row.className = 'lb-badges-row';
            row.textContent = icons + ' ' + name;
            _todayEl.appendChild(row);
        });
    }

    // ── Public API ────────────────────────────────────────────
    function open(forGame) {
        _build();
        _game = forGame || 'overall';
        _range = 'daily';
        if (_gameSel) _gameSel.value = _game;
        _renderRangeBar();
        _renderToday();
        _root.classList.add('open');
        _fetch();
    }
    function close() { if (_root) _root.classList.remove('open'); }

    // Incoming from SignalR (wired in room.js)
    function onResult(game, range, ranked) { _renderList(game, range, ranked); }

    function onBadgesUpdate(badges) {
        _dailyBadges = badges || {};
        if (_root && _root.classList.contains('open')) _renderToday();
    }

    // state: { dailyBadges: {name:[badge]}, dailySummary: {game:[{name,points}]} }
    function loadState(state) {
        state = state || {};
        _dailyBadges = state.dailyBadges || {};
        _dailySummary = state.dailySummary || {};
        if (_root && _root.classList.contains('open')) _renderToday();
    }

    window.Leaderboard = {
        open: open, close: close, onResult: onResult, onBadgesUpdate: onBadgesUpdate, loadState: loadState
    };
}());
