// Outlier spotlight: highlights the lone voter when a majority agrees on a different value.
var _shameToastTimer = null;

// ── Settings ─────────────────────────────────────────────────

var SHAME_SETTINGS_KEY = 'es_shameSettings';
var DEFAULT_SHAME_SETTINGS = { enabled: true, color: '#dc3545', message: 'went rogue!' };

function getShameSettings() {
    try {
        var raw = localStorage.getItem(SHAME_SETTINGS_KEY);
        return Object.assign({}, DEFAULT_SHAME_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) { return Object.assign({}, DEFAULT_SHAME_SETTINGS); }
}

function saveShameSettings(s) {
    localStorage.setItem(SHAME_SETTINGS_KEY, JSON.stringify(s));
}

// ── Form helpers (called from _Layout.cshtml) ────────────────

function populateShameSection() {
    var s = getShameSettings();
    var enabledEl = document.getElementById('shame-enabled');
    if (enabledEl) enabledEl.checked = s.enabled !== false;
    var colorEl = document.getElementById('shame-color');
    if (colorEl) colorEl.value = s.color || '#dc3545';
    var msgEl = document.getElementById('shame-message');
    if (msgEl) msgEl.value = s.message || '';
    updateShameOptionsVisibility();
}

function updateShameOptionsVisibility() {
    var enabledEl = document.getElementById('shame-enabled');
    var wrap = document.getElementById('shame-options-wrap');
    if (wrap) wrap.style.display = (enabledEl && enabledEl.checked) ? '' : 'none';
}

function saveShameFromForm() {
    var enabledEl = document.getElementById('shame-enabled');
    var colorEl = document.getElementById('shame-color');
    var msgEl = document.getElementById('shame-message');
    saveShameSettings({
        enabled: !!(enabledEl && enabledEl.checked),
        color: (colorEl ? colorEl.value : '') || '#dc3545',
        message: (msgEl ? msgEl.value.trim() : '') || 'went rogue!'
    });
    updateShameOptionsVisibility();
}

// ── Trigger ──────────────────────────────────────────────────

function triggerShame(stats) {
    if (!stats || !stats.shameParticipantId) return;
    var s = getShameSettings();
    if (!s.enabled) return;

    var color = s.color || '#dc3545';

    var card = document.querySelector('[data-connection-id="' + stats.shameParticipantId + '"]');
    if (!card) return;

    card.classList.add('shame-spotlight');
    card.style.boxShadow = '0 0 0 3px ' + color + ', 0 0 18px ' + color + '80';

    setTimeout(function () {
        card.classList.add('shame-shake');
        card.addEventListener('animationend', function () {
            card.classList.remove('shame-shake');
        }, { once: true });
    }, 350);

    _showShameToast(stats.shameParticipantName || 'Someone', color, s.message || 'went rogue!');
}

function _showShameToast(name, color, message) {
    var existing = document.getElementById('shame-toast');
    if (existing) existing.remove();
    if (_shameToastTimer) { clearTimeout(_shameToastTimer); _shameToastTimer = null; }

    var toast = document.createElement('div');
    toast.id = 'shame-toast';
    toast.className = 'shame-toast';
    toast.textContent = '🎯 ' + name + ' ' + message;
    toast.style.background = color;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            toast.classList.add('shame-toast-visible');
        });
    });

    _shameToastTimer = setTimeout(function () {
        var t = document.getElementById('shame-toast');
        if (t) {
            t.classList.remove('shame-toast-visible');
            setTimeout(function () { if (t.parentNode) t.remove(); }, 300);
        }
    }, 3500);
}
