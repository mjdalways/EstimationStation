// ============================================================
// Feature 11 / P1 — Session recap
// ------------------------------------------------------------
// Everything here is derived from `roomState.sessionRounds`, the server's durable record of
// every reveal (see PokerHub.SessionRoundPayload). That's deliberate: the numbers a recap
// quotes have to be the same for the person who watched every round and the person who
// joined ten minutes ago, so nothing is computed from this tab's live event stream.
//
// Export is client-side only — a Blob download built from the same rounds — so there is no
// new server endpoint and no copy of the session leaving the room.
// ============================================================
(function () {
    'use strict';

    var _root = null;
    var _bodyEl = null;

    function _esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _rounds() {
        return (window.roomState && roomState.sessionRounds) || [];
    }

    // Only rounds whose votes are actual numbers can feed averages/spreads. '?' and '☕' are
    // real answers in this app, so they're counted as participation but never as a value.
    function _num(v) {
        if (v === undefined || v === null) return null;
        var n = parseFloat(String(v).trim());
        return isFinite(n) ? n : null;
    }

    function _fmt(n, dp) {
        if (n === null || n === undefined || !isFinite(n)) return '—';
        var r = Math.round(n * Math.pow(10, dp || 0)) / Math.pow(10, dp || 0);
        return String(r);
    }

    function _mmss(secs) {
        secs = Math.max(0, Math.round(secs || 0));
        var m = Math.floor(secs / 60), s = secs % 60;
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }

    // ---- the numbers -------------------------------------------------------------------

    function _compute() {
        var rounds = _rounds();
        var byStory = {};       // storyId -> [rounds], in order
        var order = [];

        rounds.forEach(function (r) {
            var key = r.storyId || ('round:' + r.id);
            if (!byStory[key]) { byStory[key] = []; order.push(key); }
            byStory[key].push(r);
        });

        var stats = {
            rounds: rounds.length,
            stories: order.length,
            estimated: 0,
            totalPoints: 0,
            unanimous: 0,
            roundsToConsensusSum: 0,
            roundsToConsensusN: 0,
            longestDebate: null,   // { title, seconds }
            biggestSpread: null,   // { title, spread, min, max }
            totalSeconds: 0,
            people: {},            // name -> { votes, rounds, sum, n }
            stories: []            // per-story summary rows, in first-seen order
        };

        order.forEach(function (key) {
            var list = byStory[key];
            var last = list[list.length - 1];
            var title = last.storyTitle || 'Untitled';
            var seconds = 0, spread = null, spreadMin = null, spreadMax = null;

            list.forEach(function (r) {
                seconds += r.discussionSeconds || 0;
                var vals = [];
                Object.keys(r.votes || {}).forEach(function (name) {
                    var p = stats.people[name] || (stats.people[name] = { votes: 0, rounds: 0, sum: 0, n: 0 });
                    p.votes++; p.rounds++;
                    var n = _num(r.votes[name]);
                    if (n !== null) { p.sum += n; p.n++; vals.push(n); }
                });
                if (vals.length > 1) {
                    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
                    if (spread === null || (hi - lo) > spread) { spread = hi - lo; spreadMin = lo; spreadMax = hi; }
                }
            });

            stats.totalSeconds += seconds;
            if (stats.longestDebate === null || seconds > stats.longestDebate.seconds)
                stats.longestDebate = { title: title, seconds: seconds };
            if (spread !== null && (stats.biggestSpread === null || spread > stats.biggestSpread.spread))
                stats.biggestSpread = { title: title, spread: spread, min: spreadMin, max: spreadMax };

            var final = last.finalEstimate || null;
            var finalNum = _num(final);
            if (final) {
                stats.estimated++;
                if (finalNum !== null) stats.totalPoints += finalNum;
                // "Rounds to consensus" only means something for a story that reached one.
                stats.roundsToConsensusSum += list.length;
                stats.roundsToConsensusN++;
            }
            if (list.some(function (r) { return r.wasUnanimous; })) stats.unanimous++;

            stats.stories.push({
                title: title,
                jiraKey: last.jiraKey || '',
                rounds: list.length,
                final: final,
                unanimous: list.some(function (r) { return r.wasUnanimous; }),
                seconds: seconds,
                spread: spread,
                voters: Object.keys(last.votes || {}).length,
                proxies: (last.proxyVoters || []).length
            });
        });

        stats.avgRoundsToConsensus = stats.roundsToConsensusN
            ? stats.roundsToConsensusSum / stats.roundsToConsensusN : null;
        return stats;
    }

    // ---- rendering ---------------------------------------------------------------------

    function _statCard(value, label, sub) {
        return '<div class="recap-stat">' +
            '<div class="recap-stat-value">' + _esc(value) + '</div>' +
            '<div class="recap-stat-label">' + _esc(label) + '</div>' +
            (sub ? '<div class="recap-stat-sub">' + _esc(sub) + '</div>' : '') +
            '</div>';
    }

    function _render() {
        if (!_bodyEl) return;
        var s = _compute();

        if (s.rounds === 0) {
            _bodyEl.innerHTML = '<div class="recap-empty">No rounds have been revealed in this room yet. ' +
                'Estimate a story and the recap fills itself in.</div>';
            return;
        }

        var html = '<div class="recap-stats">' +
            _statCard(s.stories, 'Stories discussed', s.estimated + ' estimated') +
            _statCard(_fmt(s.totalPoints, 1), 'Points estimated') +
            _statCard(s.unanimous, 'Unanimous', s.stories ? Math.round(100 * s.unanimous / s.stories) + '% of stories' : '') +
            _statCard(_fmt(s.avgRoundsToConsensus, 2), 'Avg rounds to consensus') +
            _statCard(_mmss(s.totalSeconds), 'Time in discussion') +
            _statCard(s.rounds, 'Reveals') +
            '</div>';

        html += '<div class="recap-highlights">';
        if (s.longestDebate) {
            html += '<div class="recap-highlight"><span class="recap-highlight-icon">🗣️</span>' +
                '<div><div class="recap-highlight-label">Longest debate</div>' +
                '<div class="recap-highlight-body">' + _esc(s.longestDebate.title) +
                ' <span class="text-muted">(' + _mmss(s.longestDebate.seconds) + ')</span></div></div></div>';
        }
        if (s.biggestSpread) {
            html += '<div class="recap-highlight"><span class="recap-highlight-icon">📏</span>' +
                '<div><div class="recap-highlight-label">Biggest spread</div>' +
                '<div class="recap-highlight-body">' + _esc(s.biggestSpread.title) +
                ' <span class="text-muted">(' + _fmt(s.biggestSpread.min, 1) + ' → ' + _fmt(s.biggestSpread.max, 1) + ')</span>' +
                '</div></div></div>';
        }
        html += '</div>';

        // Participation podium — same three-step shape the leaderboard uses, ranked by how
        // many rounds someone actually voted in rather than by any notion of accuracy.
        var people = Object.keys(s.people).map(function (name) {
            var p = s.people[name];
            return { name: name, rounds: p.rounds, avg: p.n ? p.sum / p.n : null };
        }).sort(function (a, b) { return b.rounds - a.rounds || a.name.localeCompare(b.name); });

        if (people.length) {
            html += '<h6 class="recap-section-title">Participation</h6>';
            var medals = ['🥇', '🥈', '🥉'];
            html += '<div class="recap-people">';
            people.forEach(function (p, i) {
                html += '<div class="recap-person' + (i < 3 ? ' recap-person-top' : '') + '">' +
                    '<span class="recap-person-rank">' + (i < 3 ? medals[i] : (i + 1) + '.') + '</span>' +
                    '<span class="recap-person-name">' + _esc(p.name) + '</span>' +
                    '<span class="recap-person-meta">' + p.rounds + ' round' + (p.rounds === 1 ? '' : 's') +
                    (p.avg !== null ? ' · avg ' + _fmt(p.avg, 1) : '') + '</span>' +
                    '</div>';
            });
            html += '</div>';
        }

        html += '<h6 class="recap-section-title">Stories</h6>' +
            '<div class="recap-table-wrap"><table class="recap-table"><thead><tr>' +
            '<th>Story</th><th>Rounds</th><th>Final</th><th>Spread</th><th>Time</th>' +
            '</tr></thead><tbody>';
        s.stories.forEach(function (r) {
            html += '<tr>' +
                '<td>' + (r.jiraKey ? '<span class="recap-key">' + _esc(r.jiraKey) + '</span> ' : '') +
                _esc(r.title) + (r.unanimous ? ' <span title="Unanimous at least once">🎯</span>' : '') +
                (r.proxies ? ' <span title="' + r.proxies + ' pre-cast vote(s)">📮</span>' : '') + '</td>' +
                '<td>' + r.rounds + '</td>' +
                '<td>' + (r.final ? _esc(r.final) : '<span class="text-muted">—</span>') + '</td>' +
                '<td>' + (r.spread === null ? '<span class="text-muted">—</span>' : _fmt(r.spread, 1)) + '</td>' +
                '<td>' + _mmss(r.seconds) + '</td>' +
                '</tr>';
        });
        html += '</tbody></table></div>';

        _bodyEl.innerHTML = html;
    }

    // ---- export ------------------------------------------------------------------------

    function _roomName() {
        return (window.ROOM_CONFIG && ROOM_CONFIG.roomName) || 'session';
    }

    function _download(filename, text, mime) {
        try {
            var blob = new Blob([text], { type: mime + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) {
            console.error('Recap export failed', e);
            alert('Could not generate the download in this browser.');
        }
    }

    function _stamp() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            '_' + p(d.getHours()) + p(d.getMinutes());
    }

    function exportMarkdown() {
        var s = _compute();
        var lines = [];
        lines.push('# Session recap — ' + _roomName());
        lines.push('');
        lines.push('_Generated ' + new Date().toLocaleString() + '_');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('| --- | --- |');
        lines.push('| Stories discussed | ' + s.stories.length + ' |');
        lines.push('| Stories estimated | ' + s.estimated + ' |');
        lines.push('| Points estimated | ' + _fmt(s.totalPoints, 1) + ' |');
        lines.push('| Unanimous | ' + s.unanimous + ' |');
        lines.push('| Avg rounds to consensus | ' + _fmt(s.avgRoundsToConsensus, 2) + ' |');
        lines.push('| Reveals | ' + s.rounds + ' |');
        lines.push('| Time in discussion | ' + _mmss(s.totalSeconds) + ' |');
        if (s.longestDebate) lines.push('| Longest debate | ' + s.longestDebate.title + ' (' + _mmss(s.longestDebate.seconds) + ') |');
        if (s.biggestSpread) lines.push('| Biggest spread | ' + s.biggestSpread.title + ' (' + _fmt(s.biggestSpread.min, 1) + '–' + _fmt(s.biggestSpread.max, 1) + ') |');
        lines.push('');
        lines.push('## Stories');
        lines.push('');
        lines.push('| Story | Key | Rounds | Final | Spread | Time |');
        lines.push('| --- | --- | --- | --- | --- | --- |');
        s.stories.forEach(function (r) {
            lines.push('| ' + String(r.title).replace(/\|/g, '\\|') + ' | ' + (r.jiraKey || '') + ' | ' +
                r.rounds + ' | ' + (r.final || '') + ' | ' + (r.spread === null ? '' : _fmt(r.spread, 1)) +
                ' | ' + _mmss(r.seconds) + ' |');
        });
        lines.push('');
        lines.push('## Participation');
        lines.push('');
        Object.keys(s.people).sort(function (a, b) { return s.people[b].rounds - s.people[a].rounds; })
            .forEach(function (name) {
                var p = s.people[name];
                lines.push('- **' + name + '** — ' + p.rounds + ' round' + (p.rounds === 1 ? '' : 's') +
                    (p.n ? ', avg ' + _fmt(p.sum / p.n, 1) : ''));
            });
        lines.push('');
        _download('recap_' + _roomName() + '_' + _stamp() + '.md', lines.join('\n'), 'text/markdown');
    }

    function _csvCell(v) {
        var s = String(v === undefined || v === null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    // One row per *round*, not per story: the round record is the finest grain the server
    // keeps, and anything coarser can be pivoted back out of it in a spreadsheet.
    function exportCsv() {
        var rows = [['Round', 'RevealedAtUtc', 'StoryTitle', 'JiraKey', 'Voter', 'Vote',
                     'Confidence', 'WasProxy', 'FinalEstimate', 'Unanimous', 'DiscussionSeconds']];
        _rounds().forEach(function (r) {
            var proxies = {};
            (r.proxyVoters || []).forEach(function (n) { proxies[n] = true; });
            var names = Object.keys(r.votes || {});
            if (!names.length) names = [''];
            names.forEach(function (name) {
                rows.push([
                    r.roundNumber || '', r.revealedAtUtc || '', r.storyTitle || '', r.jiraKey || '',
                    name, name ? (r.votes[name] || '') : '',
                    (r.confidences && r.confidences[name]) || '',
                    proxies[name] ? 'yes' : '',
                    r.finalEstimate || '', r.wasUnanimous ? 'yes' : '', r.discussionSeconds || 0
                ]);
            });
        });
        var csv = rows.map(function (row) { return row.map(_csvCell).join(','); }).join('\r\n');
        _download('recap_' + _roomName() + '_' + _stamp() + '.csv', csv, 'text/csv');
    }

    // ---- shell -------------------------------------------------------------------------

    function _build() {
        if (_root) return;
        _root = document.createElement('div');
        _root.id = 'recap-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'align-items:center;justify-content:center;background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.35);' +
            'width:min(96vw,860px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e5e7eb;';
        bar.innerHTML = '<div style="font-weight:700;font-size:1.05rem;flex:1;">📊 Session recap</div>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="recap-md">⬇️ Markdown</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="recap-csv">⬇️ CSV</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="recap-close">✕</button>';
        panel.appendChild(bar);

        _bodyEl = document.createElement('div');
        _bodyEl.className = 'recap-body';
        _bodyEl.style.cssText = 'padding:16px;overflow-y:auto;';
        panel.appendChild(_bodyEl);

        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#recap-close').addEventListener('click', close);
        bar.querySelector('#recap-md').addEventListener('click', exportMarkdown);
        bar.querySelector('#recap-csv').addEventListener('click', exportCsv);
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function open() {
        _build();
        _render();
        _root.style.display = 'flex';
    }

    function close() {
        if (_root) _root.style.display = 'none';
    }

    // Called whenever a new round lands, so an open recap stays live during the session.
    function refresh() {
        if (_root && _root.style.display === 'flex') _render();
    }

    function loadState(state) {
        refresh();
    }

    window.SessionRecap = {
        open: open, close: close, refresh: refresh, loadState: loadState,
        exportMarkdown: exportMarkdown, exportCsv: exportCsv
    };
}());
