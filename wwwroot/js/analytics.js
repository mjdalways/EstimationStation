// ============================================================
// EstimationStation — Session Analytics
// ============================================================
var ANALYTICS_VELOCITY_KEY = 'es_velocityHistory';

function _getVelocityHistory() {
    try { return JSON.parse(localStorage.getItem(ANALYTICS_VELOCITY_KEY) || '[]'); } catch (e) { return []; }
}

function _saveVelocitySession(pts) {
    var h = _getVelocityHistory().slice(-19);
    h.push({ date: new Date().toLocaleDateString(), pts: pts });
    localStorage.setItem(ANALYTICS_VELOCITY_KEY, JSON.stringify(h));
}

function computeSessionStats() {
    var history = (typeof roomState !== 'undefined') ? roomState.history : [];
    var total = history.length;
    if (total === 0) return null;
    var consensus = history.filter(function (r) { return r.stats && r.stats.isConsensus; }).length;
    var maxStreak = 0, cur = 0;
    history.slice().reverse().forEach(function (r) {
        if (r.stats && r.stats.isConsensus) { cur++; maxStreak = Math.max(maxStreak, cur); }
        else { cur = 0; }
    });
    var totalPts = 0;
    history.forEach(function (r) {
        if (r.stats && r.stats.isConsensus && r.stats.average) totalPts += parseFloat(r.stats.average) || 0;
    });
    return { total: total, consensus: consensus, rate: Math.round(consensus / total * 100), maxStreak: maxStreak, totalPts: Math.round(totalPts) };
}

function saveVelocityForSession() {
    var s = computeSessionStats();
    if (s && s.total > 0) _saveVelocitySession(s.totalPts);
}

function saveSessionSummary() {
    if (typeof roomState === 'undefined') return;
    var completed = (roomState.stories || []).filter(function(s) { return s.isCompleted && s.finalEstimate; });
    var pts = completed.map(function(s) { return parseFloat(s.finalEstimate); })
                       .filter(function(v) { return !isNaN(v); })
                       .reduce(function(a, b) { return a + b; }, 0);
    if (pts === 0) return;
    var hist = _getVelocityHistory();
    hist.push({ date: new Date().toISOString().slice(0, 10), pts: pts, stories: completed.length });
    if (hist.length > 20) hist = hist.slice(-20);
    localStorage.setItem(ANALYTICS_VELOCITY_KEY, JSON.stringify(hist));
}

// ── Bingo squares ─────────────────────────────────────────────
var BINGO_SQUARES = [
    { id: 'inf',    label: 'Someone votes ∞',         check: function (h) { return Object.values(h.votes || {}).includes('∞'); } },
    { id: 'q',      label: 'Someone votes ?',          check: function (h) { return Object.values(h.votes || {}).includes('?'); } },
    { id: 'coffee', label: 'Coffee card played',       check: function (h) { return Object.values(h.votes || {}).includes('☕'); } },
    { id: 'cons',   label: 'First-try consensus',      check: function (h) { return h.stats && h.stats.isConsensus && !Object.values(h.flipCounts || {}).some(function (n) { return n > 0; }); } },
    { id: 'uni',    label: 'All different votes',      check: function (h) { var v = Object.values(h.votes || {}).filter(Boolean); return new Set(v).size === v.length && v.length > 2; } },
    { id: 'flip3',  label: 'Someone changed 3+ times', check: function (h) { return Object.values(h.flipCounts || {}).some(function (n) { return n >= 3; }); } },
    { id: 'range8', label: 'Vote range ≥ 8',           check: function (h) { return h.stats && h.stats.max !== null && h.stats.min !== null && (h.stats.max - h.stats.min) >= 8; } },
    { id: 'streak3',label: '3+ consensus streak',      check: function ()  { return typeof _esConsensusStreak !== 'undefined' && _esConsensusStreak >= 3; } },
    { id: 'solo',   label: 'Only 1 voter',             check: function (h) { return Object.values(h.votes || {}).filter(Boolean).length === 1; } }
];

function _renderVelocitySparkline(history) {
    var max = Math.max.apply(null, history.map(function (h) { return h.pts; })) || 1;
    var bars = history.map(function (h) {
        var pct = Math.round(h.pts / max * 100);
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">'
            + '<div style="flex:1;width:100%;display:flex;align-items:flex-end;">'
            + '<div style="width:100%;height:' + pct + '%;background:#0d6efd;border-radius:2px 2px 0 0;min-height:2px;" title="' + h.date + ': ' + h.pts + ' pts"></div>'
            + '</div><div style="font-size:0.55rem;color:#999;">' + h.pts + '</div></div>';
    });
    return '<h6 class="fw-semibold small mb-1">📈 Velocity (last ' + history.length + ' sessions)</h6>'
        + '<div style="display:flex;height:60px;gap:2px;align-items:stretch;margin-bottom:12px;">' + bars.join('') + '</div>';
}

function _renderBingoCard() {
    var history = (typeof roomState !== 'undefined') ? roomState.history : [];
    var hit = {};
    BINGO_SQUARES.forEach(function (sq) {
        hit[sq.id] = history.some(function (h) { try { return sq.check(h); } catch (e) { return false; } });
    });
    var cells = BINGO_SQUARES.map(function (sq) {
        var done = hit[sq.id];
        return '<div style="padding:6px;border:1px solid var(--panel-border,#dee2e6);border-radius:4px;font-size:0.72rem;text-align:center;'
            + 'background:' + (done ? 'rgba(25,135,84,0.15)' : '') + ';color:' + (done ? '#198754' : 'inherit') + ';">'
            + (done ? '✅ ' : '') + sq.label + '</div>';
    });
    return '<h6 class="fw-semibold small mb-2">🎰 Session Bingo</h6>'
        + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">' + cells.join('') + '</div>';
}

function showAnalyticsModal() {
    var s = computeSessionStats();
    var content = document.getElementById('analytics-modal-content');
    if (!content) return;

    if (!s || s.total === 0) {
        content.innerHTML = '<p class="text-muted text-center py-4">No rounds yet this session.</p>';
    } else {
        var vel = _getVelocityHistory();
        content.innerHTML =
            '<div class="row text-center mb-3">'
            + '<div class="col-3"><div class="fs-3 fw-bold">' + s.total + '</div><div class="small text-muted">Rounds</div></div>'
            + '<div class="col-3"><div class="fs-3 fw-bold">' + s.rate + '%</div><div class="small text-muted">Consensus</div></div>'
            + '<div class="col-3"><div class="fs-3 fw-bold">' + s.maxStreak + '</div><div class="small text-muted">Best Streak</div></div>'
            + '<div class="col-3"><div class="fs-3 fw-bold">' + s.totalPts + '</div><div class="small text-muted">Est. Points</div></div>'
            + '</div>'
            + (vel.length > 1 ? _renderVelocitySparkline(vel) : '')
            + _renderBingoCard();
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('analyticsModal')).show();
}

function testAnalytics() {
    var prev = (typeof roomState !== 'undefined') ? roomState.history.slice() : [];
    if (typeof roomState !== 'undefined') {
        roomState.history = [
            { stats: { isConsensus: true,  average: 5,  min: 5,  max: 5,  votes: { a:'5', b:'5', c:'5' } },  flipCounts: {} },
            { stats: { isConsensus: true,  average: 8,  min: 8,  max: 8,  votes: { a:'8', b:'8', c:'8' } },  flipCounts: { a: 1 } },
            { stats: { isConsensus: false, average: 7,  min: 3,  max: 13, votes: { a:'3', b:'8', c:'13' }, shameParticipantId: 'c' }, flipCounts: {} },
            { stats: { isConsensus: true,  average: 3,  min: 3,  max: 3,  votes: { a:'3', b:'3', c:'3' } },  flipCounts: {} },
            { stats: { isConsensus: false, average: 9,  min: 5,  max: 13, votes: { a:'5', b:'8', c:'13', d:'?' }, shameParticipantId: 'c' }, flipCounts: { b: 3 } }
        ];
    }
    showAnalyticsModal();
    if (typeof roomState !== 'undefined') {
        setTimeout(function() { roomState.history = prev; }, 100);
    }
}
