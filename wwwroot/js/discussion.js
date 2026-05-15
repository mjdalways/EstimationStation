// Discussion Timer: coffee warmup phase before Floor is Lava on non-consensus reveals.
var DISCUSSION_KEY = 'es_discussionSettings';
var DEFAULT_DISCUSSION = { enabled: false, duration: 120 };
var _discTimer = null;
var _discEl = null;

function getDiscussionSettings() {
    try {
        var raw = localStorage.getItem(DISCUSSION_KEY);
        return Object.assign({}, DEFAULT_DISCUSSION, raw ? JSON.parse(raw) : {});
    } catch(e) { return Object.assign({}, DEFAULT_DISCUSSION); }
}
function saveDiscussionSettings(s) { localStorage.setItem(DISCUSSION_KEY, JSON.stringify(s)); }

function populateDiscussionSection() {
    var s = getDiscussionSettings();
    var el = document.getElementById('disc-enabled');
    if (el) el.checked = s.enabled !== false;
    var dur = document.getElementById('disc-duration');
    if (dur) dur.value = s.duration || 120;
    updateDiscussionVisibility();
}
function updateDiscussionVisibility() {
    var el = document.getElementById('disc-enabled');
    var wrap = document.getElementById('disc-options-wrap');
    if (wrap) wrap.style.display = (el && el.checked) ? '' : 'none';
}
function saveDiscussionFromForm() {
    var el = document.getElementById('disc-enabled');
    var dur = document.getElementById('disc-duration');
    saveDiscussionSettings({
        enabled: !!(el && el.checked),
        duration: parseInt((dur ? dur.value : '') || '120', 10) || 120
    });
    updateDiscussionVisibility();
}

function triggerDiscussionTimer(shameParticipantId) {
    var s = getDiscussionSettings();
    stopDiscussionTimer();
    var remaining = s.duration || 120;

    _discEl = document.createElement('div');
    _discEl.id = 'disc-banner';
    _discEl.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:linear-gradient(135deg,#6f4e37,#c0874f);color:#fff;font-weight:700;' +
        'font-size:0.9rem;padding:8px 22px;border-radius:20px;z-index:9970;pointer-events:none;' +
        'white-space:nowrap;box-shadow:0 2px 12px rgba(111,78,55,0.5);';
    _discEl.innerHTML = '☕ Discussion time: <span id="disc-countdown">' + _discFmtTime(remaining) + '</span>';
    document.body.appendChild(_discEl);

    _discTimer = setInterval(function() {
        remaining--;
        var cd = document.getElementById('disc-countdown');
        if (cd) cd.textContent = _discFmtTime(remaining);
        if (remaining <= 0) {
            stopDiscussionTimer();
            if (shameParticipantId && typeof triggerFloorIsLava === 'function') {
                triggerFloorIsLava(shameParticipantId);
            }
        }
    }, 1000);
}

function stopDiscussionTimer() {
    if (_discTimer) { clearInterval(_discTimer); _discTimer = null; }
    var el = document.getElementById('disc-banner');
    if (el) el.remove();
    _discEl = null;
}

function _discFmtTime(s) {
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}

function testDiscussionTimer() {
    triggerDiscussionTimer(null);
}
