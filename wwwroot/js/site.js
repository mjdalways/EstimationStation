// ============================================================
// Theme Management
// ============================================================
const BASE_THEMES = [
    'classic', 'dark', 'forest', 'ocean', 'retro',
    'floral', 'eighties', 'redyellow', 'blueyellow', 'myspace', 'geocities', 'crt'
];

const BASE_THEME_LABELS = {
    classic: 'Classic',
    dark: 'Dark',
    forest: 'Forest',
    ocean: 'Ocean',
    retro: 'Retro',
    floral: 'Floral',
    eighties: '1980s',
    redyellow: 'Red & Yellow',
    blueyellow: 'Blue & Yellow',
    myspace: 'MySpace',
    geocities: 'GeoCities',
    crt: 'CRT'
};

const CUSTOM_THEMES_KEY = 'es_customThemes';
const LEGACY_CUSTOM_VARS_KEY = 'es_customThemeVars';

function isBaseTheme(theme) {
    return BASE_THEMES.includes(theme);
}

function closeCustomThemeModal() {
    _settingsSaved = true; // flag: this hide is intentional, don't revert
    const modalEl = document.getElementById('settingsModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;
    if (modalEl.contains(document.activeElement)) document.activeElement.blur();
    const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();
    setTimeout(() => { const f = document.getElementById('themeSelect'); if (f) f.focus(); }, 0);
}

function isCustomTheme(theme) {
    return typeof theme === 'string' && theme.startsWith('custom_');
}

function getCustomThemes() {
    return JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '{}');
}

function saveCustomThemes(themes) {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

function themeOptionExists(theme) {
    const sel = document.getElementById('themeSelect');
    if (!sel) return false;
    return Array.from(sel.options).some(o => o.value === theme);
}

function applyTheme(theme) {
    const themes = getCustomThemes();
    if (!isBaseTheme(theme) && !themes[theme]) theme = 'classic';

    document.getElementById('appBody').setAttribute('data-theme', isCustomTheme(theme) ? 'custom' : theme);

    if (isCustomTheme(theme) && themes[theme]?.vars) {
        injectCustomThemeStyle(themes[theme].vars);
    }

    localStorage.setItem('es_theme', theme);
    const sel = document.getElementById('themeSelect');
    if (sel) {
        sel.value = theme;
        if (sel.value !== theme) {
            sel.value = 'classic';
        }
    }

}

// ── Settings Modal ──────────────────────────────────────────
function openSettingsModal(tab) {
    const modalEl = document.getElementById('settingsModal');
    if (!modalEl) return;

    // Populate profile fields if available
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl && typeof ROOM_CONFIG !== 'undefined') {
        nameEl.value = ROOM_CONFIG.playerName || localStorage.getItem('es_playerName') || '';
    }
    const observerEl = document.getElementById('profile-observer-mode');
    if (observerEl && typeof isObserver !== 'undefined') {
        observerEl.checked = isObserver;
    }

    // Pre-populate theme tab from current theme
    populateThemeTab();
    applyCardFontSize();
    applyCompactMode();

    if (typeof populateCelebrationTab === 'function') populateCelebrationTab();
    if (typeof populateAudioTab === 'function') populateAudioTab();
    if (typeof populateAvatarTab === 'function') populateAvatarTab();
    if (typeof populateShameSection === 'function') populateShameSection();
    if (typeof populateBattleSection === 'function') populateBattleSection();
    if (typeof populateDiscussionSection === 'function') populateDiscussionSection();
    if (typeof populateVoiceSection === 'function') populateVoiceSection();
    if (typeof populateCounterSpellSection === 'function') populateCounterSpellSection();
    if (typeof _seaAddConfigButtons === 'function') _seaAddConfigButtons();
    populateJiraTab();
    applyCardBackDesign();

    _settingsSaved = false; // reset the save flag for this session

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    if (tab) {
        const btn = document.getElementById('tab-' + tab + '-btn');
        if (btn) btn.click();
    }
}

function populateThemeTab() {
    const currentTheme = localStorage.getItem('es_theme') || 'classic';
    const themes = getCustomThemes();

    renderCustomThemeOptions();
    populateCustomizationThemeSources();

    const themeId = isCustomTheme(currentTheme) && themes[currentTheme] ? currentTheme : null;

    document.getElementById('ct-theme-id').value = themeId || '';
    document.getElementById('ct-theme-name').value = themeId ? (themes[themeId]?.name || '') : (() => {
        // Suggest a name when starting from a base theme
        const sourceLabel = BASE_THEME_LABELS[currentTheme] || currentTheme;
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        return `${sourceLabel} - Customized - ${ts}`;
    })();

    const ctConfettiColors = document.getElementById('ct-confetti-colors');
    const savedColors = themeId ? themes[themeId]?.celebration?.confettiColors : [];
    const colorsCsv = (savedColors || []).join(',');
    if (ctConfettiColors) ctConfettiColors.value = colorsCsv;
    syncFieldToConfettiSwatches(colorsCsv);

    const baseSelect = document.getElementById('ct-base-theme');
    if (baseSelect) baseSelect.value = currentTheme;

    // Always load vars from the current active theme
    const vars = readThemeVars(currentTheme);
    setCustomizerFormValues(vars);
    updateThemePreview();

    // Show delete only for custom themes
    ['ct-delete-btn', 'ct-delete-btn-preview', 'ct-delete-btn-mobile'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('d-none', !themeId);
    });
    // Restore original theme when the modal closes without an explicit save
    const _settingsModalEl = document.getElementById('settingsModal');
    if (_settingsModalEl) {
        _settingsModalEl.addEventListener('hide.bs.modal', () => {
            if (!_settingsSaved) cancelCustomTheme();
            _settingsSaved = false;
        });
    }
}

function onThemeChange(theme) {
    if (theme === 'custom_new') {
        openCustomThemeModalSafely();
    } else {
        applyTheme(theme);
    }
}

function openCustomThemeModalSafely(themeId) {
    const navContent = document.getElementById('mainNavContent');
    if (navContent && navContent.classList.contains('show') && typeof bootstrap !== 'undefined') {
        navContent.addEventListener('hidden.bs.collapse', () => openSettingsModal('theme'), { once: true });
        bootstrap.Collapse.getOrCreateInstance(navContent).hide();
        return;
    }
    openSettingsModal('theme');
}

function renderCustomThemeOptions() {
    const group = document.getElementById('customThemeOptgroup');
    if (!group) return;

    group.innerHTML = '<option value="custom_new">➕ Create Custom…</option>';

    const themes = getCustomThemes();
    Object.entries(themes).forEach(([id, model]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `🖌️ ${model.name || 'Unnamed Theme'}`;
        group.appendChild(option);
    });


    const current = localStorage.getItem('es_theme') || 'classic';
    const sel = document.getElementById('themeSelect');
    if (sel) {
        sel.value = themeOptionExists(current) ? current : 'classic';
    }

    populateCustomizationThemeSources();
}

function populateCustomizationThemeSources() {
    const select = document.getElementById('ct-base-theme');
    if (!select) return;

    select.innerHTML = '';

    BASE_THEMES.forEach(theme => {
        const opt = document.createElement('option');
        opt.value = theme;
        opt.textContent = BASE_THEME_LABELS[theme] || theme;
        select.appendChild(opt);
    });

    const themes = getCustomThemes();
    Object.entries(themes).forEach(([id, model]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `Custom: ${model.name || id}`;
        select.appendChild(opt);
    });
}

function migrateLegacyCustomTheme() {
    const legacyVarsRaw = localStorage.getItem(LEGACY_CUSTOM_VARS_KEY);
    if (!legacyVarsRaw) return;

    try {
        const legacyVars = JSON.parse(legacyVarsRaw);
        const themes = getCustomThemes();
        if (!themes.custom_legacy) {
            themes.custom_legacy = { name: 'My Custom Theme', vars: legacyVars };
            saveCustomThemes(themes);
        }

        if (localStorage.getItem('es_theme') === 'custom') {
            localStorage.setItem('es_theme', 'custom_legacy');
        }
    } catch {
    }

    localStorage.removeItem(LEGACY_CUSTOM_VARS_KEY);
}

function loadTheme() {
    migrateLegacyCustomTheme();
    renderCustomThemeOptions();

    const saved = localStorage.getItem('es_theme') || 'classic';
    applyTheme(saved);
}

document.addEventListener('DOMContentLoaded', function() { loadTheme(); applyCardFontSize(); applyCompactMode(); });

function applyCompactMode() {
    var compact = localStorage.getItem('es_compactMode') === '1';
    var container = document.getElementById('participantsContainer');
    if (container) container.classList.toggle('compact', compact);
    var cb = document.getElementById('compact-mode-toggle');
    if (cb) cb.checked = compact;
}

function applyCardFontSize() {
    var v = parseFloat(localStorage.getItem('es_cardFontSize') || '1.25');
    document.documentElement.style.setProperty('--card-font-size', v + 'rem');
    var slider = document.getElementById('card-font-size-slider');
    if (slider) { slider.value = v; document.getElementById('card-font-size-label').textContent = v.toFixed(1); }
}

// ============================================================
// PWA Install
// ============================================================
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    _pwaInstallPrompt = e;
    const btn = document.getElementById('installAppBtn');
    if (btn) btn.classList.remove('d-none');
});

window.addEventListener('appinstalled', () => {
    _pwaInstallPrompt = null;
    const btn = document.getElementById('installAppBtn');
    if (btn) btn.classList.add('d-none');
});

function installApp() {
    if (!_pwaInstallPrompt) return;
    _pwaInstallPrompt.prompt();
    _pwaInstallPrompt.userChoice.then(result => {
        if (result.outcome === 'accepted') {
            const btn = document.getElementById('installAppBtn');
            if (btn) btn.classList.add('d-none');
        }
        _pwaInstallPrompt = null;
    });
}

// ============================================================
// Settings Test Previews
// All test functions render floating overlays above the modal.
// No room DOM elements are touched — works from any page.
// ============================================================
function _testOverlay(html, ms) {
    var existing = document.getElementById('_es_test_preview');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = '_es_test_preview';
    el.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2100;'
        + 'background:var(--card-bg,#fff);border:1px solid var(--panel-border,#dee2e6);'
        + 'border-radius:10px;padding:12px 20px;box-shadow:0 4px 20px rgba(0,0,0,0.25);'
        + 'min-width:260px;max-width:440px;text-align:center;pointer-events:none;font-size:0.92rem;';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, ms || 3500);
    return el;
}

function testHotCold() {
    _testOverlay(
        '🔥 <span style="font-weight:700;color:#ff6b35;">ON FIRE</span>'
        + ' <span style="font-size:0.75rem;opacity:0.6;">(last 3 rounds consistent)</span>',
        3000
    );
}

function testVoteDist() {
    var fakeCounts = { '1': 2, '3': 1, '8': 3 };
    var total = 6;
    var bars = Object.keys(fakeCounts).map(function(v) {
        return '<div style="flex:' + fakeCounts[v] + ';display:flex;align-items:center;justify-content:center;'
            + 'font-size:0.75rem;font-weight:700;color:#fff;background:hsl('
            + (parseInt(v) * 22) + ',65%,45%);min-width:28px;padding:4px 0;" title="' + v + ': ' + fakeCounts[v] + ' votes">' + v + '</div>';
    });
    _testOverlay(
        '<div style="font-size:0.8rem;color:var(--text-secondary,#6c757d);margin-bottom:6px;">Vote spread preview</div>'
        + '<div style="display:flex;gap:3px;height:32px;border-radius:5px;overflow:hidden;">' + bars.join('') + '</div>',
        3500
    );
}

function testSpeedBadges() {
    _testOverlay(
        '<div style="font-size:0.75rem;color:var(--text-secondary,#6c757d);margin-bottom:8px;">Speed badges preview</div>'
        + '<div style="display:flex;gap:10px;justify-content:center;">'
        + '<div style="padding:8px 12px;border:1px solid #dee2e6;border-radius:8px;position:relative;font-size:0.85rem;">'
        + '👤 Alice<span style="position:absolute;top:-7px;right:-7px;font-size:0.8rem;background:#fff176;border-radius:50%;padding:1px 4px;box-shadow:0 1px 3px rgba(0,0,0,0.2);">⚡</span></div>'
        + '<div style="padding:8px 12px;border:1px solid #dee2e6;border-radius:8px;font-size:0.85rem;">👤 Bob</div>'
        + '<div style="padding:8px 12px;border:1px solid #dee2e6;border-radius:8px;position:relative;font-size:0.85rem;">'
        + '👤 Carol<span style="position:absolute;top:-7px;right:-7px;font-size:0.8rem;background:#e0e0e0;border-radius:50%;padding:1px 4px;box-shadow:0 1px 3px rgba(0,0,0,0.2);">🐢</span></div>'
        + '</div>',
        3000
    );
}

function testSlotMachine() {
    var cs = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
    var speeds = { fast: 500, normal: 800, dramatic: 1300 };
    var slotMs = speeds[cs.suspenseSpeed || 'normal'] || 800;
    var vals = ['3', '5', '8'];
    var overlay = _testOverlay(
        '<div style="font-size:0.75rem;color:var(--text-secondary,#6c757d);margin-bottom:8px;">Slot machine preview</div>'
        + '<div style="display:flex;gap:12px;justify-content:center;">'
        + vals.map(function(v) {
            return '<div class="participant-badge voted" data-testbadge="1" '
                + 'style="padding:12px 16px;font-size:1.1rem;border:2px solid #dee2e6;border-radius:8px;background:var(--card-bg,#fff);">'
                + '<span class="vote-hidden" style="font-weight:700;">' + v + '</span></div>';
        }).join('') + '</div>',
        vals.length * 380 + slotMs + 1500
    );
    overlay.style.pointerEvents = 'none';
    var badges = Array.from(overlay.querySelectorAll('[data-testbadge]'));
    badges.forEach(function(badge, i) {
        var val = vals[i];
        setTimeout(function() {
            badge.classList.add('poker-flip');
            if (typeof _slotMachineReveal === 'function') {
                _slotMachineReveal(badge, val, slotMs, function() { badge.classList.remove('poker-flip'); });
            } else {
                var span = badge.querySelector('.vote-hidden, .participant-vote');
                var pool = ['1','2','3','5','8','13','21'];
                var idx = 0;
                var t = setInterval(function() { if (span) span.textContent = pool[idx++ % pool.length]; }, 80);
                setTimeout(function() {
                    clearInterval(t);
                    if (span) { span.textContent = val; span.className = 'participant-vote'; }
                    badge.classList.remove('poker-flip');
                }, slotMs);
            }
        }, i * 380);
    });
}

// ============================================================
// Decider Wheel (global — modal is in _Layout, works from any page)
// ============================================================
var _deciderSpinning = false;
var _deciderParticipants = null; // set by testDecider() to inject fake participants

function _deciderNames() {
    var participants = _deciderParticipants
        || (window.roomState && window.roomState.participants)
        || [];
    return participants.filter(function(p) { return !p.isObserver && !p.isGhost; })
                       .map(function(p) { return p.name; });
}

function openDecider() {
    _drawDeciderWheel();
    document.getElementById('deciderResult').textContent = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deciderModal')).show();
}

function _drawDeciderWheel(highlightIdx) {
    var canvas = document.getElementById('deciderCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var names = _deciderNames();
    if (names.length === 0) {
        ctx.clearRect(0, 0, 280, 280);
        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No participants', 140, 145);
        return;
    }
    var arc = (2 * Math.PI) / names.length;
    var colors = ['#0d6efd','#198754','#ffc107','#dc3545','#6f42c1','#0dcaf0','#fd7e14','#20c997'];
    var cx = 140, cy = 140, r = 130;
    ctx.clearRect(0, 0, 280, 280);
    names.forEach(function(name, i) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, i * arc - Math.PI / 2, (i + 1) * arc - Math.PI / 2);
        ctx.fillStyle = i === highlightIdx ? '#ffd700' : colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * arc + arc / 2 - Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.min(14, Math.floor(110 / names.length) + 6) + 'px sans-serif';
        ctx.fillText(name.substring(0, 12), r - 8, 5);
        ctx.restore();
    });
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy - r + 4); ctx.lineTo(cx - 8, cy - r + 18); ctx.lineTo(cx + 8, cy - r + 18);
    ctx.fillStyle = '#333'; ctx.fill();
}

function spinDecider() {
    if (_deciderSpinning) return;
    var names = _deciderNames();
    if (names.length === 0) return;
    _deciderSpinning = true;
    document.getElementById('deciderResult').textContent = '...';
    var winner = Math.floor(Math.random() * names.length);
    var totalFrames = 60;
    var frame = 0;
    function _escHtml(str) {
        if (!str) return '';
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function tick() {
        var progress = frame / totalFrames;
        _drawDeciderWheel(frame < totalFrames ? undefined : winner);
        frame++;
        if (frame <= totalFrames) {
            setTimeout(tick, 16 + progress * 24);
        } else {
            _deciderSpinning = false;
            document.getElementById('deciderResult').innerHTML =
                '🎯 <strong>' + _escHtml(names[winner]) + '</strong> goes first!';
        }
    }
    tick();
}

function testDecider() {
    _deciderParticipants = [
        { name: 'Alice',   isObserver: false, isGhost: false },
        { name: 'Bob',     isObserver: false, isGhost: false },
        { name: 'Charlie', isObserver: false, isGhost: false },
        { name: 'Diana',   isObserver: false, isGhost: false },
        { name: 'Evan',    isObserver: false, isGhost: false }
    ];
    openDecider();
    var modal = document.getElementById('deciderModal');
    if (modal) {
        modal.addEventListener('hidden.bs.modal', function cleanup() {
            _deciderParticipants = null;
            modal.removeEventListener('hidden.bs.modal', cleanup);
        });
    }
}

// ============================================================
// Custom Theme Builder
// ============================================================
const CUSTOM_COLOR_FIELDS = [
    'bg-primary', 'bg-secondary', 'text-primary', 'text-secondary', 'accent', 'accent-hover',
    'card-bg', 'card-hover', 'card-selected', 'card-selected-text', 'card-border', 'card-border-width', 'card-voted',
    'btn-primary', 'btn-reveal', 'btn-reset',
    'font-family', 'heading-font', 'border-radius', 'shadow',
    'navbar-bg', 'navbar-text',
    'panel-bg', 'panel-border',
    'stats-bg', 'chat-bg', 'chat-bubble',
    'story-active', 'story-completed', 'timer-color',
    'lava-color-primary', 'lava-color-secondary', 'shame-color'
];

const CUSTOM_DEFAULTS = {
    'bg-primary':          '#f8f9fa',
    'bg-secondary':        '#ffffff',
    'text-primary':        '#212529',
    'text-secondary':      '#6c757d',
    'accent':              '#0d6efd',
    'accent-hover':        '#0b5ed7',
    'card-bg':             '#ffffff',
    'card-hover':          '#e7f1ff',
    'card-selected':       '#0d6efd',
    'card-selected-text':  '#ffffff',
    'card-border':         '#dee2e6',
    'card-border-width':   '1.5',
    'card-voted':          '#198754',
    'btn-primary':         '#0d6efd',
    'btn-reveal':          '#198754',
    'btn-reset':           '#ffc107',
    'font-family':         'system-ui, sans-serif',
    'heading-font':        "'Segoe UI', system-ui, sans-serif",
    'border-radius':       '8',
    'shadow':              '0 2px 8px rgba(0,0,0,0.1)',
    'navbar-bg':           '#343a40',
    'navbar-text':         '#ffffff',
    'panel-bg':            '#ffffff',
    'panel-border':        '#dee2e6',
    'stats-bg':            '#e7f1ff',
    'chat-bg':             '#f8f9fa',
    'chat-bubble':         '#e9ecef',
    'story-active':        '#cfe2ff',
    'story-completed':     '#d1e7dd',
    'timer-color':         '#dc3545',
    'lava-color-primary':  '#ff4500',
    'lava-color-secondary':'#ff6b00',
    'shame-color':         '#dc3545'
};

function setCustomizerFormValues(vars) {
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) {
            if (f === 'border-radius') {
                el.value = parseInt(vars[f] || CUSTOM_DEFAULTS[f], 10);
                document.getElementById('ct-radius-label').textContent = el.value;
            } else if (f === 'font-family' || f === 'heading-font') {
                el.value = vars[f] || CUSTOM_DEFAULTS[f];
                if (f === 'font-family') updateCustomFontPreview(el.value);
            } else {
                el.value = vars[f] || CUSTOM_DEFAULTS[f];
            }
        }
    });
}

function normalizePrimaryFont(fontFamily) {
    if (!fontFamily) return '';
    return fontFamily
        .split(',')[0]
        .replace(/['"]/g, '')
        .trim()
        .toLowerCase();
}

function findBestFontOptionValue(selectEl, targetFont) {
    if (!selectEl) return CUSTOM_DEFAULTS['font-family'];

    const exact = Array.from(selectEl.options).find(o => o.value === targetFont);
    if (exact) return exact.value;

    const targetPrimary = normalizePrimaryFont(targetFont);
    const primaryMatch = Array.from(selectEl.options).find(o => normalizePrimaryFont(o.value) === targetPrimary);
    if (primaryMatch) return primaryMatch.value;

    return CUSTOM_DEFAULTS['font-family'];
}

function readThemeVars(themeId) {
    const themes = getCustomThemes();
    if (isCustomTheme(themeId) && themes[themeId]?.vars) {
        return { ...themes[themeId].vars };
    }

    const probe = document.createElement('div');
    probe.setAttribute('data-theme', themeId);
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);

    const styles = getComputedStyle(probe);
    const vars = {};
    CUSTOM_COLOR_FIELDS.forEach(f => {
        let v = styles.getPropertyValue('--' + f).trim();
        if (!v) v = CUSTOM_DEFAULTS[f];
        if (f === 'border-radius' || f === 'card-border-width') v = v.replace('px', '');
        vars[f] = v;
    });

    document.body.removeChild(probe);
    return vars;
}

function loadThemePresetForCustomization() {
    const select = document.getElementById('ct-base-theme');
    if (!select || !select.value) return;
    const sourceId = select.value;
    const vars = readThemeVars(sourceId);
    setCustomizerFormValues(vars);
    updateThemePreview();

    // Auto-generate a name based on the source theme + timestamp
    const nameEl = document.getElementById('ct-theme-name');
    if (nameEl && !nameEl.value.trim()) {
        const sourceLabel = BASE_THEME_LABELS[sourceId]
            || (getCustomThemes()[sourceId]?.name)
            || sourceId;
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        nameEl.value = `${sourceLabel} - Customized - ${ts}`;
    }

    // Clear theme id so saving creates a new theme rather than overwriting
    const idEl = document.getElementById('ct-theme-id');
    if (idEl) idEl.value = '';
}

function updateCustomFontPreview(fontFamily) {
    const preview = document.getElementById('ct-font-preview');
    if (!preview) return;
    preview.style.fontFamily = fontFamily || CUSTOM_DEFAULTS['font-family'];
}

// ── Confetti swatch helpers ───────────────────────────────────
/** Read swatches → write comma list to hidden field. */
function syncConfettiSwatchesToField() {
    const swatches = document.querySelectorAll('.ct-confetti-swatch');
    const colors = Array.from(swatches).map(s => s.value);
    const field = document.getElementById('ct-confetti-colors');
    if (field) field.value = colors.join(',');
}

/** Write a comma-separated color list → populate swatches. */
function syncFieldToConfettiSwatches(colorsCsv) {
    const colors = (colorsCsv || '').split(',').map(c => c.trim()).filter(c => c.startsWith('#'));
    const swatches = document.querySelectorAll('.ct-confetti-swatch');
    swatches.forEach((s, i) => {
        if (colors[i]) s.value = colors[i];
    });
    syncConfettiSwatchesToField();
}

// ── Accordion toggle ──────────────────────────────────────────
function ctToggleSection(sectionId, headerEl) {
    const body = document.getElementById(sectionId);
    if (!body) return;
    const isCollapsed = body.style.display === 'none';
    body.style.display = isCollapsed ? '' : 'none';
    if (headerEl) headerEl.classList.toggle('collapsed', !isCollapsed);
}

// ── Live preview ──────────────────────────────────────────────
function updateThemePreview() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };

    const bgPrimary     = g('ct-bg-primary')   || '#f8f9fa';
    const bgSecondary   = g('ct-bg-secondary')  || '#ffffff';
    const textPrimary   = g('ct-text-primary')  || '#212529';
    const accent        = g('ct-accent')        || '#0d6efd';
    const navbarBg      = g('ct-navbar-bg')     || '#343a40';
    const navbarText    = g('ct-navbar-text')   || '#ffffff';
    const cardBg        = g('ct-card-bg')       || bgSecondary;
    const cardBorder    = g('ct-card-border')   || '#dee2e6';
    const cardSelected  = g('ct-card-selected') || accent;
    const cardSelText   = g('ct-card-selected-text') || '#ffffff';
    const cardVoted     = g('ct-card-voted')    || '#198754';
    const btnReveal     = g('ct-btn-reveal')    || '#198754';
    const btnReset      = g('ct-btn-reset')     || '#ffc107';
    const chatBg        = g('ct-chat-bg')       || bgPrimary;
    const chatBubble    = g('ct-chat-bubble')   || '#e9ecef';
    const storyActive   = g('ct-story-active')  || '#cfe2ff';
    const storyDone     = g('ct-story-completed') || '#d1e7dd';
    const borderWidthEl = document.getElementById('ct-card-border-width');
    const bw            = (borderWidthEl ? borderWidthEl.value : '1.5') + 'px';
    const fontEl        = document.getElementById('ct-font-family');
    const font          = fontEl ? fontEl.value : 'system-ui, sans-serif';
    const radEl         = document.getElementById('ct-border-radius');
    const rad           = (radEl ? radEl.value : '8') + 'px';

    const set = (id, styles) => {
        const el = document.getElementById(id);
        if (!el) return;
        Object.assign(el.style, styles);
    };

    // Apply font across preview
    const preview = document.getElementById('ct-live-preview');
    if (preview) preview.style.fontFamily = font;

    set('pv-navbar',       { backgroundColor: navbarBg, color: navbarText });
    set('pv-brand',        { color: navbarText });
    set('pv-body',         { backgroundColor: bgPrimary });
    set('pv-card-normal',  { backgroundColor: cardBg, border: `${bw} solid ${cardBorder}`, borderRadius: rad, color: textPrimary });
    set('pv-card-selected',{ backgroundColor: cardSelected, border: `${bw} solid ${cardSelected}`, borderRadius: rad, color: cardSelText });
    set('pv-badge-default',{ backgroundColor: cardBg, border: `${bw} solid ${cardBorder}`, borderRadius: rad, color: textPrimary });
    set('pv-badge-voted',  { backgroundColor: cardBg, border: `${bw} solid ${cardVoted}`, borderRadius: rad, color: textPrimary });
    set('pv-badge-me',     { backgroundColor: cardBg, border: `${bw} solid ${accent}`, borderRadius: rad, color: textPrimary });
    set('pv-btn-reveal',   { backgroundColor: btnReveal, color: '#fff', borderRadius: rad });
    set('pv-btn-reset',    { backgroundColor: btnReset, color: '#212529', borderRadius: rad });
    set('pv-chat',         { backgroundColor: chatBg });
    set('pv-chat-author',  { color: accent });
    set('pv-chat-bubble',  { backgroundColor: chatBubble, borderRadius: rad, color: textPrimary });
    set('pv-story-active', { backgroundColor: storyActive, color: textPrimary, border: `1px solid ${accent}` });
    set('pv-story-done',   { backgroundColor: storyDone, color: textPrimary });
}

function injectCustomThemeStyle(vars) {
    let s = document.getElementById('customThemeStyle');
    if (!s) {
        s = document.createElement('style');
        s.id = 'customThemeStyle';
        document.head.appendChild(s);
    }
    let css = '[data-theme="custom"]{';
    CUSTOM_COLOR_FIELDS.forEach(f => {
        let v = vars[f] || CUSTOM_DEFAULTS[f];
        if (f === 'border-radius') v = v + 'px';
        if (f === 'card-border-width') v = v + 'px';
        css += `--${f}:${v};`;
    });
    css += '}';
    s.textContent = css;
}

function openCustomThemeModal(themeId) {
    const themes = getCustomThemes();
    const currentThemeForNew = localStorage.getItem('es_theme') || 'classic';
    const theme = themeId && themes[themeId]
        ? themes[themeId]
        : { name: '', vars: readThemeVars(currentThemeForNew) };

    document.getElementById('ct-theme-id').value = themeId || '';
    document.getElementById('ct-theme-name').value = theme.name || '';

    const ctConfettiColors = document.getElementById('ct-confetti-colors');
    if (ctConfettiColors) {
        const csv = (theme.celebration?.confettiColors || []).join(',');
        ctConfettiColors.value = csv;
        syncFieldToConfettiSwatches(csv);
    }

    const current = localStorage.getItem('es_theme') || 'classic';
    const sel = document.getElementById('themeSelect');
    if (sel) {
        sel.value = themeOptionExists(current) ? current : 'classic';
    }

    populateCustomizationThemeSources();
    const baseSelect = document.getElementById('ct-base-theme');
    if (baseSelect) baseSelect.value = (themeId && (isBaseTheme(themeId) || isCustomTheme(themeId))) ? themeId : (localStorage.getItem('es_theme') || 'classic');

    setCustomizerFormValues(theme.vars || {});
    updateThemePreview();

    // openCustomThemeModal is now handled via openSettingsModal/populateThemeTab
}

function editCurrentCustomTheme() {
    openSettingsModal('theme');
}

function saveCustomTheme() {
    const name = (document.getElementById('ct-theme-name').value || '').trim() || 'My Custom Theme';
    let themeId = document.getElementById('ct-theme-id').value;
    if (!themeId) themeId = `custom_${Date.now()}`;

    const vars = {};
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) vars[f] = el.value;
    });

    const themes = getCustomThemes();
    const ctConfettiColorsEl = document.getElementById('ct-confetti-colors');
    const confettiColors = ctConfettiColorsEl
        ? ctConfettiColorsEl.value.split(',').map(c => c.trim()).filter(c => c.startsWith('#'))
        : [];
    themes[themeId] = { name, vars, celebration: { confettiColors } };
    saveCustomThemes(themes);
    renderCustomThemeOptions();

    closeCustomThemeModal();
    applyTheme(themeId);
}

// ── Profile Tab ───────────────────────────────────────────────
function saveProfileName() {
    const nameEl = document.getElementById('profile-display-name');
    if (!nameEl) return;
    const newName = nameEl.value.trim();
    if (!newName) return;
    // Delegate to room.js handler if available, else just store locally
    if (typeof promptRename === 'function') {
        ROOM_CONFIG.playerName = newName;
        localStorage.setItem('es_playerName', newName);
        if (typeof connection !== 'undefined' && connection) {
            connection.invoke('UpdateName', newName).catch(e => console.error(e));
        }
        const disp = document.getElementById('displayName');
        if (disp) disp.textContent = newName;
    } else {
        localStorage.setItem('es_playerName', newName);
    }
}

function onProfileObserverChange(enabled) {
    if (typeof toggleObserver === 'function') {
        toggleObserver(enabled);
        const obs = document.getElementById('observerCheck');
        if (obs) obs.checked = enabled;
    }
}

function deleteCustomTheme() {
    const themeId = document.getElementById('ct-theme-id').value;
    if (!themeId) return;
    if (!confirm('Delete this custom theme?')) return;

    const themes = getCustomThemes();
    delete themes[themeId];
    saveCustomThemes(themes);
    renderCustomThemeOptions();

    closeCustomThemeModal();
    applyTheme('classic');
}

function exportCustomTheme() {
    const name = (document.getElementById('ct-theme-name').value || 'custom-theme').trim();
    const vars = {};
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) vars[f] = el.value;
    });

    const ctConfettiColorsEl = document.getElementById('ct-confetti-colors');
    const confettiColors = ctConfettiColorsEl
        ? ctConfettiColorsEl.value.split(',').map(c => c.trim()).filter(c => c.startsWith('#'))
        : [];

    const blob = new Blob([JSON.stringify({ name, vars, celebration: { confettiColors } }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'custom-theme'}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importCustomTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!data || !data.vars) {
                    alert('Invalid theme file.');
                    return;
                }

                document.getElementById('ct-theme-id').value = '';
                document.getElementById('ct-theme-name').value = data.name || 'Imported Theme';

                CUSTOM_COLOR_FIELDS.forEach(f => {
                    const el = document.getElementById('ct-' + f);
                    if (el && data.vars[f]) el.value = data.vars[f];
                });

                if (data.vars['font-family']) {
                    document.getElementById('ct-font-family').value = data.vars['font-family'];
                    updateCustomFontPreview(data.vars['font-family']);
                }

                if (data.vars['border-radius']) {
                    const radius = parseInt(data.vars['border-radius'], 10) || 8;
                    document.getElementById('ct-border-radius').value = radius;
                    document.getElementById('ct-radius-label').textContent = radius;
                }

                const deleteBtn = document.getElementById('ct-delete-btn');
                if (deleteBtn) deleteBtn.classList.add('d-none');

                const ctConfettiColorsEl = document.getElementById('ct-confetti-colors');
                if (ctConfettiColorsEl && data.celebration?.confettiColors) {
                    ctConfettiColorsEl.value = data.celebration.confettiColors.join(',');
                    syncFieldToConfettiSwatches(ctConfettiColorsEl.value);
                }
            } catch {
                alert('Could not read that theme file.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/** Revert dropdown and re-apply the persisted theme to undo any live preview changes. */
function cancelCustomTheme() {
    const prev = localStorage.getItem('es_theme') || 'classic';
    applyTheme(prev);
}

// openCelebrationSettings now just opens the Settings modal on the Celebration tab
function openCelebrationSettings() {
    const s = getCelebrationSettings();

    _celSet('cel-enable-confetti',   'checked', s.enableConfetti);
    _celSet('cel-enable-fireworks',  'checked', s.enableFireworks);
    _celSet('cel-enable-balloons',   'checked', s.enableBalloons);

    _celSet('cel-confetti-type',     'value',   s.confettiType);
    _celSet('cel-confetti-duration', 'value',   s.confettiDuration);
    _celSetRange('cel-confetti-particles', 'cel-particles-val',  s.confettiParticleCount);
    _celSetRange('cel-confetti-spread',    'cel-spread-val',     s.confettiSpread, '°');
    _celSet('cel-confetti-use-theme','checked', s.confettiUseThemeColors);
    _celSet('cel-confetti-colors',   'value',   (s.confettiColors || []).join(','));
    _celSet('cel-confetti-emojis',   'value',   (s.confettiEmojis || []).join(','));

    _celSetRange('cel-fireworks-intensity',  'cel-intensity-val',    s.fireworksIntensity);
    _celSetRange('cel-fireworks-particles',  'cel-fw-particles-val', s.fireworksParticles);
    _celSetRange('cel-fireworks-explosion',  'cel-explosion-val',    s.fireworksExplosion);
    _celSetRange('cel-fireworks-rockets',    'cel-rockets-val',      s.fireworksRocketsPoint, '%');
    _celSet('cel-fireworks-duration',        'value',                s.fireworksDuration);
    _celSet('cel-fireworks-hue-min',         'value',                s.fireworksHueMin);
    _celSet('cel-fireworks-hue-max',         'value',                s.fireworksHueMax);

    _celSetRange('cel-balloon-count',    'cel-balloon-count-val', s.balloonCount);
    _celSet('cel-balloon-duration',      'value',                 s.balloonDuration);

    _updateCustomColorsVisibility(!s.confettiUseThemeColors);
    _updateEmojiVisibility(s.confettiType === 'emoji');

    openSettingsModal('celebration');
}

// ── Jira settings (localStorage only) ──────────────────────
var ES_JIRA_KEY = 'es_jiraSettings';

function getJiraSettings() {
    try { return JSON.parse(localStorage.getItem(ES_JIRA_KEY) || '{}'); } catch { return {}; }
}

function populateJiraTab() {
    var s = getJiraSettings();
    var d = document.getElementById('jiraDomain');
    var e = document.getElementById('jiraEmail');
    var t = document.getElementById('jiraToken');
    var j = document.getElementById('jiraJql');
    if (d) d.value = s.domain || '';
    if (e) e.value = s.email || '';
    if (t) t.value = s.token || '';
    if (j) j.value = s.jql || '';
    var f = document.getElementById('jiraFieldId');
    if (f) f.value = s.fieldId || 'customfield_10016';
}

function saveJiraSettings() {
    var domain   = (document.getElementById('jiraDomain')?.value  || '').trim();
    var email    = (document.getElementById('jiraEmail')?.value   || '').trim();
    var token    = (document.getElementById('jiraToken')?.value   || '').trim();
    var jql      = (document.getElementById('jiraJql')?.value     || '').trim();
    var fieldId  = (document.getElementById('jiraFieldId')?.value || '').trim() || 'customfield_10016';
    localStorage.setItem(ES_JIRA_KEY, JSON.stringify({ domain, email, token, jql, fieldId }));
    var status = document.getElementById('jiraSettingsStatus');
    if (status) {
        status.textContent = '✅ Saved';
        setTimeout(function() { status.textContent = ''; }, 2000);
    }
}

function clearJiraSettings() {
    localStorage.removeItem(ES_JIRA_KEY);
    ['jiraDomain','jiraEmail','jiraToken','jiraJql'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
    var status = document.getElementById('jiraSettingsStatus');
    if (status) status.textContent = '🗑️ Cleared';
    setTimeout(function() { if (status) status.textContent = ''; }, 2000);
}

// ── Card Back Design ──────────────────────────────────────────
var ES_CARD_BACK_KEY = 'es_cardBack';
var _cardBackClasses = ['card-back-baize','card-back-space','card-back-retro','card-back-seasonal'];
var _seasonClasses   = ['season-winter','season-spring','season-summer','season-autumn'];

function getCardBackDesign() {
    return localStorage.getItem(ES_CARD_BACK_KEY) || 'default';
}

function setCardBackDesign(design) {
    localStorage.setItem(ES_CARD_BACK_KEY, design);
    applyCardBackDesign();
}

function applyCardBackDesign() {
    _cardBackClasses.forEach(function(c) { document.body.classList.remove(c); });
    var design = getCardBackDesign();
    if (design && design !== 'default') {
        document.body.classList.add('card-back-' + design);
    }
    if (design === 'seasonal') {
        _seasonClasses.forEach(function(c) { document.body.classList.remove(c); });
        var m = new Date().getMonth();
        var season = (m <= 1 || m === 11) ? 'season-winter'
                   : m <= 4              ? 'season-spring'
                   : m <= 7              ? 'season-summer'
                   :                       'season-autumn';
        document.body.classList.add(season);
    }
    var sel = document.getElementById('cardBackSelect');
    if (sel) sel.value = design;
}

document.addEventListener('DOMContentLoaded', applyCardBackDesign);

