// ============================================================
// EstimationStation — Hall of Fame
// Computes leaderboard stats + crown awards from roomState.history.
// Requires: roomState (room.js global), bootstrap (layout).
// ============================================================

// ── Data helpers ─────────────────────────────────────────────

function _hofParseVote(v) {
    if (!v) return NaN;
    var s = String(v).replace('½', '.5');
    return parseFloat(s);
}

function _hofEsc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _hofN(count, word) {
    return count + ' ' + word + (count !== 1 ? 's' : '');
}

// ── Core computation ─────────────────────────────────────────

function computeHallOfFame() {
    var history = (typeof roomState !== 'undefined') ? roomState.history : [];
    if (!history || history.length < 2) return null;

    // pStats keyed by connectionId
    var pStats = {};

    function getP(cid, name) {
        if (!pStats[cid]) {
            pStats[cid] = {
                name:        name || 'Unknown',
                rounds:      0,
                consensus:   0,   // voted with majority
                wolf:        0,   // was the outlier
                aboveAvg:    0,   // voted above average
                belowAvg:    0,   // voted below average
                firstVotes:  0,   // was first to vote
                lastVotes:   0,   // was last to vote
                flips:       0    // vote changes across all rounds
            };
        }
        return pStats[cid];
    }

    history.forEach(function(round) {
        var votes      = round.votes      || {};
        var stats      = round.stats      || {};
        var voteOrder  = round.voteOrder  || [];
        var flipCounts = round.flipCounts || {};
        var avg = typeof stats.average === 'number' ? stats.average : null;

        // Majority vote for this round
        var voteCounts = {};
        Object.values(votes).filter(Boolean).forEach(function(v) {
            voteCounts[v] = (voteCounts[v] || 0) + 1;
        });
        var majorityVote = null, majorityCount = 0;
        Object.entries(voteCounts).forEach(function(kv) {
            if (kv[1] > majorityCount) { majorityCount = kv[1]; majorityVote = kv[0]; }
        });

        // Only count participants who actually voted this round
        var voterIds = Object.keys(votes).filter(function(cid) { return votes[cid]; });
        if (voterIds.length === 0) return;

        var firstId = voteOrder.length > 0 ? voteOrder[0]                          : null;
        var lastId  = voteOrder.length > 0 ? voteOrder[voteOrder.length - 1]       : null;

        voterIds.forEach(function(cid) {
            var vote = votes[cid];
            // Look up name from current participants; fall back to previous entry
            var participant = (typeof roomState !== 'undefined' && roomState.participants)
                ? roomState.participants.find(function(px) { return px.connectionId === cid; })
                : null;
            var name = participant ? participant.name : (pStats[cid] ? pStats[cid].name : 'Unknown');
            var ps = getP(cid, name);

            ps.rounds++;
            if (majorityVote && vote === majorityVote) ps.consensus++;
            if (cid === stats.shameParticipantId)      ps.wolf++;
            if (cid === firstId)                       ps.firstVotes++;
            if (cid === lastId)                        ps.lastVotes++;
            ps.flips += (flipCounts[cid] || 0);

            var numVote = _hofParseVote(vote);
            if (!isNaN(numVote) && avg !== null) {
                if (numVote > avg + 0.01) ps.aboveAvg++;
                else if (numVote < avg - 0.01) ps.belowAvg++;
            }
        });
    });

    var participants = Object.values(pStats).filter(function(p) { return p.rounds >= 1; });
    if (participants.length < 2) return null;

    return {
        participants: participants,
        rounds:       history.length
    };
}

// ── Crown awards (best in each category) ─────────────────────

function _hofCrowns(participants) {
    function best(fn) {
        var winner = null, top = -1;
        participants.forEach(function(p) {
            var v = fn(p);
            if (v > top) { top = v; winner = p; }
        });
        return (winner && top > 0) ? { p: winner, val: top } : null;
    }

    var crowns = [];

    var anchor = best(function(p) { return p.consensus; });
    if (anchor) crowns.push({ icon: '🎯', title: 'Consensus King',
        name: anchor.p.name, desc: 'Voted with the majority ' + _hofN(anchor.val, 'time') });

    var wolf = best(function(p) { return p.wolf; });
    if (wolf) crowns.push({ icon: '🐺', title: 'Lone Wolf',
        name: wolf.p.name, desc: 'Dared to think differently ' + _hofN(wolf.val, 'time') });

    var dreamer = best(function(p) { return p.aboveAvg; });
    if (dreamer) crowns.push({ icon: '🚀', title: 'The Dreamer',
        name: dreamer.p.name, desc: 'Aimed higher than average ' + _hofN(dreamer.val, 'time') });

    var pragma = best(function(p) { return p.belowAvg; });
    if (pragma) crowns.push({ icon: '🔧', title: 'The Pragmatist',
        name: pragma.p.name, desc: 'Kept it grounded ' + _hofN(pragma.val, 'time') });

    var speedy = best(function(p) { return p.firstVotes; });
    if (speedy) crowns.push({ icon: '⚡', title: 'Speed Demon',
        name: speedy.p.name, desc: 'First to vote ' + _hofN(speedy.val, 'time') });

    var tortoise = best(function(p) { return p.lastVotes; });
    if (tortoise) crowns.push({ icon: '🐢', title: 'Last Stand',
        name: tortoise.p.name, desc: 'Last to vote ' + _hofN(tortoise.val, 'time') });

    var flipper = best(function(p) { return p.flips; });
    if (flipper) crowns.push({ icon: '🔄', title: 'Flip Artist',
        name: flipper.p.name, desc: 'Changed their mind ' + _hofN(flipper.val, 'time') });

    return crowns;
}

// ── Rendering ─────────────────────────────────────────────────

function _hofEnsureKeyframe() {
    if (document.getElementById('hof-anim-style')) return;
    var s = document.createElement('style');
    s.id = 'hof-anim-style';
    s.textContent =
        '@keyframes hof-pop { from { opacity:0; transform:translateY(10px) scale(0.97); } to { opacity:1; transform:none; } }';
    document.head.appendChild(s);
}

function _hofRenderLeaderboard(participants) {
    // Sort by consensus desc, then name
    var sorted = participants.slice().sort(function(a, b) {
        return b.consensus - a.consensus || a.name.localeCompare(b.name);
    });

    var html = '<div style="overflow-x:auto;margin-top:4px;">'
        + '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">'
        + '<thead><tr style="border-bottom:2px solid var(--panel-border,#dee2e6);">'
        + '<th style="padding:6px 8px;text-align:left;font-weight:700;">Player</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Rounds participated">Rnds</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Voted with majority">🎯</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Was the outlier">🐺</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Voted above average">🚀</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Voted below average">🔧</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="First to vote">⚡</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Last to vote">🐢</th>'
        + '<th style="padding:6px 4px;text-align:center;" title="Vote flips">🔄</th>'
        + '</tr></thead><tbody>';

    sorted.forEach(function(p, i) {
        var bg = i % 2 === 0 ? '' : 'background:rgba(128,128,128,0.04);';
        html += '<tr style="' + bg + 'border-bottom:1px solid var(--panel-border,#dee2e6);">'
            + '<td style="padding:6px 8px;font-weight:600;">' + _hofEsc(p.name) + '</td>'
            + '<td style="padding:6px 4px;text-align:center;color:var(--text-secondary,#6c757d);">' + p.rounds + '</td>'
            + _hofCell(p.consensus, p.rounds)
            + _hofCell(p.wolf, p.rounds)
            + _hofCell(p.aboveAvg, p.rounds)
            + _hofCell(p.belowAvg, p.rounds)
            + _hofCell(p.firstVotes, p.rounds)
            + _hofCell(p.lastVotes, p.rounds)
            + _hofCell(p.flips, p.rounds, true)
            + '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

function _hofCell(val, rounds, isFlip) {
    if (val === 0) {
        return '<td style="padding:6px 4px;text-align:center;color:var(--text-secondary,#6c757d);">—</td>';
    }
    var pct = isFlip ? '' : ' <span style="font-size:0.72rem;opacity:0.55;">(' + Math.round(val / rounds * 100) + '%)</span>';
    return '<td style="padding:6px 4px;text-align:center;font-weight:600;">' + val + pct + '</td>';
}

function _hofRenderCrowns(crowns) {
    var html = '';
    crowns.forEach(function(c, i) {
        html += '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;'
            + 'background:var(--bg-secondary,#f8f9fa);border:1.5px solid var(--panel-border,#dee2e6);'
            + 'border-radius:10px;margin-bottom:8px;'
            + 'animation:hof-pop 0.35s ease both;animation-delay:' + (i * 0.06) + 's;opacity:0;">'
            + '<div style="font-size:2rem;flex-shrink:0;line-height:1;">' + c.icon + '</div>'
            + '<div>'
            + '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;'
            + 'letter-spacing:.09em;opacity:0.5;margin-bottom:1px;">' + _hofEsc(c.title) + '</div>'
            + '<div style="font-size:1rem;font-weight:700;">' + _hofEsc(c.name) + '</div>'
            + '<div style="font-size:0.8rem;opacity:0.6;">' + _hofEsc(c.desc) + '</div>'
            + '</div></div>';
    });
    return html;
}

// ── Public entry point ────────────────────────────────────────

function showSessionAwards() {
    var content = document.getElementById('awards-modal-content');
    if (!content) return;

    _hofEnsureKeyframe();

    var data = computeHallOfFame();

    if (!data) {
        content.innerHTML =
            '<p class="text-muted text-center py-4">Not enough data yet.<br>'
            + 'Play at least 2 rounds with 2+ voters to unlock the Hall of Fame.</p>';
    } else {
        var crowns = _hofCrowns(data.participants);
        var html = '<p style="font-size:0.8rem;opacity:0.55;margin-bottom:12px;">'
            + 'Based on ' + data.rounds + ' round' + (data.rounds !== 1 ? 's' : '') + ' this session.</p>';

        // Leaderboard table
        html += '<h6 style="font-weight:700;font-size:0.85rem;margin-bottom:6px;">📊 Leaderboard</h6>';
        html += _hofRenderLeaderboard(data.participants);

        // Crown awards
        if (crowns.length > 0) {
            html += '<h6 style="font-weight:700;font-size:0.85rem;margin:16px 0 8px;">🏅 Awards</h6>';
            html += _hofRenderCrowns(crowns);
        }

        content.innerHTML = html;
    }

    var el = document.getElementById('awardsModal');
    if (!el) return;
    bootstrap.Modal.getOrCreateInstance(el).show();
}
