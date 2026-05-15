// ============================================================
// EstimationStation - Session Awards
// Computes personality-type awards from roomState.history.
// Requires: roomState (room.js global), bootstrap (layout).
// ============================================================

function computeSessionAwards() {
    var history = (typeof roomState !== 'undefined') ? roomState.history : [];
    if (!history || history.length < 2) return null;

    // Build per-participant stats across all recorded rounds
    var pStats = {}; // connectionId -> { name, anchor, wolf, aboveAvg, belowAvg, rounds }

    history.forEach(function(round) {
        var votes = round.votes || {};
        var stats = round.stats  || {};
        var avg   = typeof stats.average === 'number' ? stats.average : null;

        // Compute the most-common vote for this round independently of server majorityValue
        var voteCounts = {};
        Object.values(votes).filter(Boolean).forEach(function(v) {
            voteCounts[v] = (voteCounts[v] || 0) + 1;
        });
        var majorityVote = null, majorityCount = 0;
        Object.entries(voteCounts).forEach(function(kv) {
            if (kv[1] > majorityCount) { majorityCount = kv[1]; majorityVote = kv[0]; }
        });

        Object.entries(votes).forEach(function(kv) {
            var cid = kv[0], vote = kv[1];
            if (!vote) return;
            if (!pStats[cid]) {
                var p = (typeof roomState !== 'undefined' && roomState.participants)
                    ? roomState.participants.find(function(px) { return px.connectionId === cid; })
                    : null;
                pStats[cid] = {
                    name: p ? p.name : 'Unknown',
                    anchor: 0, wolf: 0, aboveAvg: 0, belowAvg: 0, rounds: 0
                };
            }
            var ps = pStats[cid];
            ps.rounds++;
            if (majorityVote && vote === majorityVote) ps.anchor++;
            if (cid === stats.shameParticipantId)       ps.wolf++;
            var numVote = parseFloat(vote.replace('½', '0.5'));
            if (!isNaN(numVote) && avg !== null) {
                if (numVote > avg + 0.01) ps.aboveAvg++;
                else if (numVote < avg - 0.01) ps.belowAvg++;
            }
        });
    });

    var participants = Object.values(pStats).filter(function(p) { return p.rounds >= 2; });
    if (participants.length < 2) return null;

    function best(fn) {
        return participants.reduce(function(a, b) { return fn(a) >= fn(b) ? a : b; });
    }

    var awards = [];

    var anchor = best(function(p) { return p.anchor; });
    if (anchor.anchor > 0) {
        awards.push({ icon: '🎯', title: 'The Anchor', name: anchor.name,
            desc: 'Voted with the majority ' + _n(anchor.anchor, 'time') });
    }

    var wolf = best(function(p) { return p.wolf; });
    if (wolf.wolf > 0) {
        awards.push({ icon: '🐺', title: 'The Lone Wolf', name: wolf.name,
            desc: 'Dared to think differently ' + _n(wolf.wolf, 'time') });
    }

    var dreamer = best(function(p) { return p.aboveAvg; });
    if (dreamer.aboveAvg > 0) {
        awards.push({ icon: '🚀', title: 'The Dreamer', name: dreamer.name,
            desc: 'Aimed higher than average ' + _n(dreamer.aboveAvg, 'time') });
    }

    var pragma = best(function(p) { return p.belowAvg; });
    if (pragma.belowAvg > 0) {
        awards.push({ icon: '🔧', title: 'The Pragmatist', name: pragma.name,
            desc: 'Kept it grounded ' + _n(pragma.belowAvg, 'time') });
    }

    return awards.length > 0 ? awards : null;
}

function showSessionAwards() {
    var awards  = computeSessionAwards();
    var content = document.getElementById('awards-modal-content');
    if (!content) return;

    _ensureAwardKeyframe();

    if (!awards) {
        content.innerHTML =
            '<p class="text-muted text-center py-4">Not enough data yet.<br>' +
            'Play at least 2 rounds with 2+ voters to see awards.</p>';
    } else {
        content.innerHTML = '';
        var roundsLabel = document.createElement('p');
        roundsLabel.className = 'text-muted small mb-3';
        roundsLabel.textContent = 'Based on ' + (typeof roomState !== 'undefined' ? roomState.history.length : '?') + ' rounds this session.';
        content.appendChild(roundsLabel);

        awards.forEach(function(award, i) {
            var card = document.createElement('div');
            card.style.cssText =
                'display:flex;align-items:center;gap:16px;padding:14px 18px;' +
                'background:var(--bg-secondary,#f8f9fa);' +
                'border:1.5px solid var(--panel-border,#dee2e6);' +
                'border-radius:12px;margin-bottom:10px;' +
                'animation:award-pop 0.4s ease both;animation-delay:' + (i * 0.09) + 's;opacity:0;';
            card.innerHTML =
                '<div style="font-size:2.6rem;flex-shrink:0;line-height:1;">' + award.icon + '</div>' +
                '<div>' +
                    '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;' +
                         'letter-spacing:.09em;opacity:0.5;margin-bottom:2px;">' + _escA(award.title) + '</div>' +
                    '<div style="font-size:1.1rem;font-weight:700;">' + _escA(award.name) + '</div>' +
                    '<div style="font-size:0.82rem;opacity:0.6;margin-top:2px;">' + _escA(award.desc) + '</div>' +
                '</div>';
            content.appendChild(card);
        });
    }

    var el = document.getElementById('awardsModal');
    if (!el) return;
    var modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.show();
}

function _n(count, word) {
    return count + ' ' + word + (count !== 1 ? 's' : '');
}

function _escA(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _ensureAwardKeyframe() {
    if (document.getElementById('award-pop-style')) return;
    var style = document.createElement('style');
    style.id = 'award-pop-style';
    style.textContent =
        '@keyframes award-pop {' +
        '  from { opacity:0; transform:translateY(10px) scale(0.97); }' +
        '  to   { opacity:1; transform:none; }' +
        '}';
    document.head.appendChild(style);
}
