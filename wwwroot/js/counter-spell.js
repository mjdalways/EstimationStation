var COUNTER_SPELL_KEY = 'es_counterSpellSettings';
var DEFAULT_COUNTER_SPELL = { enabled: true, duration: 4000 };

function getCounterSpellSettings() {
    try {
        var raw = localStorage.getItem(COUNTER_SPELL_KEY);
        return Object.assign({}, DEFAULT_COUNTER_SPELL, raw ? JSON.parse(raw) : {});
    } catch(e) { return Object.assign({}, DEFAULT_COUNTER_SPELL); }
}
function saveCounterSpellSettings(s) { localStorage.setItem(COUNTER_SPELL_KEY, JSON.stringify(s)); }

function populateCounterSpellSection() {
    var s = getCounterSpellSettings();
    var el = document.getElementById('cs-enabled');
    if (el) el.checked = s.enabled !== false;
    var dur = document.getElementById('cs-duration');
    if (dur) dur.value = Math.round((s.duration || 4000) / 1000);
}

function saveCounterSpellFromForm() {
    var el = document.getElementById('cs-enabled');
    var dur = document.getElementById('cs-duration');
    saveCounterSpellSettings({
        enabled: !!(el && el.checked),
        duration: (parseInt((dur ? dur.value : '') || '4', 10) || 4) * 1000
    });
}

function triggerChickenOverlay(outlierConnectionId) {
    var s = getCounterSpellSettings();
    var duration = s.duration || 4000;
    var badges = document.querySelectorAll('.participant-badge[data-connection-id]');
    badges.forEach(function(badge) {
        if (badge.dataset.connectionId !== outlierConnectionId) {
            badge.classList.add('chicken-overlay');
        }
    });
    setTimeout(function() {
        document.querySelectorAll('.participant-badge.chicken-overlay').forEach(function(b) {
            b.classList.remove('chicken-overlay');
        });
    }, duration);
}

function testCounterSpell() {
    // Show the counter-spell bar fixed above the modal
    var bar = document.getElementById('counterSpellBar');
    if (bar) {
        var orig = bar.style.cssText;
        bar.style.cssText = 'display:flex;position:fixed;bottom:80px;left:50%;'
            + 'transform:translateX(-50%);z-index:2000;'
            + 'background:var(--bg-secondary,#f8f9fa);'
            + 'border:2px solid #ffc107;border-radius:10px;'
            + 'padding:8px 16px;gap:12px;align-items:center;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.3);';
        bar.innerHTML = '<span style="font-size:0.85rem;">🪄 You\'re the outlier — retaliate! (TEST)</span>'
            + '<button class="btn btn-sm btn-warning" disabled>🐔 Cast Spell</button>';
        setTimeout(function () {
            bar.style.cssText = orig;
            bar.style.display = 'none';
            bar.innerHTML = '';
        }, 3500);
    }
    setTimeout(function () { triggerChickenOverlay('__none__'); }, 500);
}
