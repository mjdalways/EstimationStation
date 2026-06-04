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
    if (typeof _seaUpdateStatusBar === 'function') _seaUpdateStatusBar();
    if (typeof _seaInjectNextDates === 'function') _seaInjectNextDates();
    var freqData = JSON.parse(localStorage.getItem('es_seaFreq') || '{}');
    var freqMin = document.getElementById('seaFreqMin'); if (freqMin) freqMin.value = freqData.min || 22;
    var freqMax = document.getElementById('seaFreqMax'); if (freqMax) freqMax.value = freqData.max || 55;
    populateJiraTab();
    applyCardBackDesign();
    applyVoteCardBackDesign();
    if (typeof _epAutoAttach === 'function') _epAutoAttach();
    if (typeof _populateRoomOtherSettings === 'function') _populateRoomOtherSettings();
    _updateSoundDefaultLabel();
    var ct = document.getElementById('show-confidence-toggle');
    if (ct) ct.checked = localStorage.getItem('es_showConfidence') !== '0';
    // X1/X2: voting animation toggles
    var fovEl = document.getElementById('flip-on-vote-toggle');
    if (fovEl) fovEl.checked = localStorage.getItem('es_flipOnVote') !== '0';
    var cvhEl = document.getElementById('change-vote-hint-toggle');
    if (cvhEl) cvhEl.checked = localStorage.getItem('es_changeVoteHint') !== '0';
    // AK4: flip speed slider
    var fdEl = document.getElementById('flipDurationSlider');
    if (fdEl) {
        var fd = _getFlipDuration();
        fdEl.value = fd;
        var fdLbl = document.getElementById('flipDurationVal');
        if (fdLbl) fdLbl.textContent = (fd / 1000).toFixed(2) + 's';
    }

    _settingsSaved = false; // reset the save flag for this session

    // AF9 / AH3: Start live preview tick so clock preview animates while modal is open
    if (window._clockPreviewInterval) clearInterval(window._clockPreviewInterval);
    window._clockPreviewInterval = setInterval(function() {
        var prev = document.getElementById('tc-clock-preview');
        if (!prev) return;
        if (typeof _acRenderClock === 'function') _acRenderClock(prev);
        else _acRenderClockBasic(prev);
    }, 1000);
    // Stop ticking when modal closes (re-registered each open)
    modalEl.addEventListener('hidden.bs.modal', function() {
        clearInterval(window._clockPreviewInterval);
        window._clockPreviewInterval = null;
    }, { once: true });

    // AF11: Make modal draggable (one-time setup per modal instance)
    if (!modalEl._dragInit) {
        _initDraggableModal(modalEl);
        modalEl._dragInit = true;
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    if (tab) {
        const btn = document.getElementById('tab-' + tab + '-btn');
        if (btn) btn.click();
    }
}

// AF11: Draggable settings modal
function _initDraggableModal(modalEl) {
    var dialog = modalEl.querySelector('.modal-dialog');
    var header = modalEl.querySelector('.modal-header');
    if (!header || !dialog) return;
    header.style.cursor = 'move';
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('button')) return; // don't drag when clicking close/buttons
        var rect = dialog.getBoundingClientRect();
        dialog.classList.add('was-dragged');
        dialog.style.position = 'fixed';
        dialog.style.left = rect.left + 'px';
        dialog.style.top  = rect.top  + 'px';
        dialog.style.width = rect.width + 'px';
        dialog.style.margin = '0';
        var startX = e.clientX - rect.left;
        var startY = e.clientY - rect.top;
        function onMove(ev) {
            var newLeft = Math.max(0, Math.min(ev.clientX - startX, window.innerWidth  - rect.width));
            var newTop  = Math.max(0, Math.min(ev.clientY - startY, window.innerHeight - 60));
            dialog.style.left = newLeft + 'px';
            dialog.style.top  = newTop  + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',  onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',  onUp);
        e.preventDefault();
    });
    // Reset position on close so next open centers normally
    modalEl.addEventListener('hidden.bs.modal', function resetDrag() {
        dialog.classList.remove('was-dragged');
        dialog.style.position = '';
        dialog.style.left  = '';
        dialog.style.top   = '';
        dialog.style.width = '';
        dialog.style.margin = '';
    });
}

// ── Z1: Settings Search ─────────────────────────────────────
function filterSettings(query) {
    var q = (query || '').trim().toLowerCase();
    var resultEl = document.getElementById('settings-search-results');
    if (!resultEl) return;

    var tabs = [
        { id: 'tab-theme',       btn: 'tab-theme-btn',       label: '🎨 Theme' },
        { id: 'tab-visual',      btn: 'tab-visual-btn',      label: '👁️ Visual' },
        { id: 'tab-celebration', btn: 'tab-celebration-btn', label: '🎉 Events' },
        { id: 'tab-audio',       btn: 'tab-audio-btn',       label: '🔊 Audio' },
        { id: 'tab-seasons',     btn: 'tab-seasons-btn',     label: '🗓️ Seasons' },
        { id: 'tab-profile',     btn: 'tab-profile-btn',     label: '👤 Profile' },
        { id: 'tab-jira',        btn: 'tab-jira-btn',        label: '🔗 Jira' },
        { id: 'tab-other',       btn: 'tab-other-btn',       label: '⚙️ Other' },
        { id: 'tab-about',       btn: 'tab-about-btn',       label: 'ℹ️ About' },
    ];

    // Remove any existing highlights from all tabs
    tabs.forEach(function(t) {
        var el = document.getElementById(t.id);
        if (el) _removeSearchHighlights(el);
    });

    if (!q) { resultEl.innerHTML = ''; return; }

    var matches = tabs.filter(function(t) {
        var el = document.getElementById(t.id);
        return el && el.textContent.toLowerCase().indexOf(q) !== -1;
    });
    if (!matches.length) {
        resultEl.innerHTML = '<span class="text-muted">No matches</span>';
        return;
    }
    resultEl.innerHTML = matches.map(function(t) {
        return '<a href="#" class="badge bg-secondary text-decoration-none me-1" onclick="event.preventDefault();document.getElementById(\'' + t.btn + '\').click()">' + t.label + '</a>';
    }).join('');

    // Highlight matching text in matching tabs
    matches.forEach(function(t) {
        var el = document.getElementById(t.id);
        if (el) _applySearchHighlights(el, q);
    });

    if (matches.length === 1) {
        var btn = document.getElementById(matches[0].btn);
        if (btn) btn.click();
    }
}

function _removeSearchHighlights(el) {
    el.querySelectorAll('mark.search-highlight').forEach(function(m) {
        var p = m.parentNode;
        if (p) { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); }
    });
}

function _applySearchHighlights(el, q) {
    var SKIP = {INPUT:1, SELECT:1, TEXTAREA:1, BUTTON:1, SCRIPT:1, STYLE:1, OPTION:1, MARK:1};
    function walk(node) {
        if (node.nodeType === 3) {
            var text = node.textContent;
            var idx = text.toLowerCase().indexOf(q);
            if (idx === -1) return;
            var frag = document.createDocumentFragment();
            if (idx > 0) frag.appendChild(document.createTextNode(text.substring(0, idx)));
            var mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = text.substring(idx, idx + q.length);
            frag.appendChild(mark);
            var rest = text.substring(idx + q.length);
            if (rest) frag.appendChild(document.createTextNode(rest));
            node.parentNode.replaceChild(frag, node);
        } else if (node.nodeType === 1 && !SKIP[node.tagName]) {
            Array.from(node.childNodes).forEach(walk);
        }
    }
    Array.from(el.childNodes).forEach(walk);
}

// ── Z2: Per-tab bulk controls ───────────────────────────────
function tabAllOn(tabId) {
    var pane = document.getElementById(tabId);
    if (!pane) return;
    pane.querySelectorAll('input[type="checkbox"]').forEach(function(cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); });
}
function tabAllOff(tabId) {
    var pane = document.getElementById(tabId);
    if (!pane) return;
    pane.querySelectorAll('input[type="checkbox"]').forEach(function(cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); });
}
function tabResetDefaults(tabId) {
    if (!confirm('Reset this tab to defaults?')) return;
    var keysToRemove = {
        'tab-visual':      ['es_cardFontSize','es_compactMode','es_showConfidence'],
        'tab-audio':       ['es_audioAllOff','es_timerAudio','es_ambientAudio','es_soundReceive','es_voiceSettings'],
        'tab-seasons':     Object.keys(localStorage).filter(function(k) { return k.startsWith('sea_') || k.startsWith('cel-seasonal') || k === 'es_seaFreq'; }),
        'tab-celebration': Object.keys(localStorage).filter(function(k) { return k.startsWith('es_celebration') || k.startsWith('cel-') && !k.startsWith('cel-seasonal'); }),
    };
    var keys = keysToRemove[tabId] || [];
    keys.forEach(function(k) { localStorage.removeItem(k); });
    openSettingsModal(tabId.replace('tab-', ''));
}

// ── Z3: Global settings controls ───────────────────────────
function settingsAllOff() {
    var muteEl = document.getElementById('audio-all-off');
    if (muteEl) { muteEl.checked = true; muteEl.dispatchEvent(new Event('change')); }
    ['cel-enable-confetti','cel-enable-fireworks','cel-enable-balloons','cel-streak-enabled','cel-lava-enabled','cel-discussion-enabled','cel-shame-enabled','cel-counterspell-enabled','cel-battle-enabled','cel-seasonal-theme'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.checked = false; el.dispatchEvent(new Event('change')); }
    });
}
function settingsAllOn() {
    var muteEl = document.getElementById('audio-all-off');
    if (muteEl) { muteEl.checked = false; muteEl.dispatchEvent(new Event('change')); }
    ['cel-enable-confetti','cel-enable-fireworks','cel-enable-balloons','cel-streak-enabled','cel-lava-enabled','cel-seasonal-theme'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
    });
}
function settingsResetAll() {
    if (!confirm('Reset ALL settings to factory defaults? This cannot be undone.')) return;
    var keepKeys = ['es_playerName','es_playerEmoji','es_playerAvatar','es_soundAsked'];
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && keepKeys.indexOf(k) === -1) toRemove.push(k);
    }
    toRemove.forEach(function(k) { localStorage.removeItem(k); });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal')).hide();
    setTimeout(function() { openSettingsModal(); }, 300);
}
function exportAllSettings() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) data[k] = localStorage.getItem(k);
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'es-settings-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
}
function importAllSettings() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var data = JSON.parse(ev.target.result);
                Object.keys(data).forEach(function(k) { localStorage.setItem(k, data[k]); });
                bootstrap.Modal.getOrCreateInstance(document.getElementById('settingsModal')).hide();
                setTimeout(function() { openSettingsModal(); }, 300);
            } catch(ex) { alert('Import failed: invalid JSON file.'); }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ── N5: Sound confirmation choice handler ───────────────────
function _applySoundChoice(choice) {
    if (choice === 'none') {
        localStorage.setItem('audio-all-off', 'true');
        var el = document.getElementById('audio-all-off'); if (el) el.checked = true;
    } else if (choice === 'local') {
        localStorage.setItem('es_soundReceive', JSON.stringify({ receiveEnabled: false, showSubtitle: false }));
    } else if (choice === 'broadcast') {
        localStorage.setItem('es_soundReceive', JSON.stringify({ receiveEnabled: true, showSubtitle: true }));
        localStorage.setItem('audio-all-off', 'false');
    }
    // 'all' = keep current settings unchanged
}

function confirmSoundChoice(choice) {
    var modalEl = document.getElementById('soundConfirmModal');
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    var alwaysEl = document.getElementById('sound-choice-always');
    if (alwaysEl && alwaysEl.checked) {
        localStorage.setItem('es_soundDefaultChoice', choice);
        _updateSoundDefaultLabel();
    }
    _applySoundChoice(choice);
}

function _updateSoundDefaultLabel() {
    var choice = localStorage.getItem('es_soundDefaultChoice');
    var toggle = document.getElementById('sound-default-enable');
    var select = document.getElementById('sound-default-select');
    var hint   = document.getElementById('sound-default-off-hint');
    var hasDefault = !!choice;
    if (toggle) toggle.checked = hasDefault;
    if (select) {
        select.style.display = hasDefault ? '' : 'none';
        if (hasDefault && choice) select.value = choice;
    }
    if (hint) hint.style.display = hasDefault ? 'none' : '';
}
window._updateSoundDefaultLabel = _updateSoundDefaultLabel;

function onSoundDefaultEnableChange() {
    var toggle = document.getElementById('sound-default-enable');
    var select = document.getElementById('sound-default-select');
    var hint   = document.getElementById('sound-default-off-hint');
    if (toggle && toggle.checked) {
        var choice = (select && select.value) || 'all';
        localStorage.setItem('es_soundDefaultChoice', choice);
        if (select) select.style.display = '';
        if (hint) hint.style.display = 'none';
    } else {
        localStorage.removeItem('es_soundDefaultChoice');
        if (select) select.style.display = 'none';
        if (hint) hint.style.display = '';
    }
}
window.onSoundDefaultEnableChange = onSoundDefaultEnableChange;

function onSoundDefaultSelectChange() {
    var select = document.getElementById('sound-default-select');
    if (select) localStorage.setItem('es_soundDefaultChoice', select.value);
}
window.onSoundDefaultSelectChange = onSoundDefaultSelectChange;

function clearSoundDefault() {
    localStorage.removeItem('es_soundDefaultChoice');
    _updateSoundDefaultLabel();
}
window.clearSoundDefault = clearSoundDefault;

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
    // Update settings live-preview container (shares CSS rules with #participantsContainer)
    var previewContainer = document.getElementById('preview-participants-container');
    if (previewContainer) previewContainer.classList.toggle('compact', compact);
    // AK3: highlight the active mode in the Normal/Compact mini previews
    var normalCell = document.getElementById('cmp-preview-normal');
    if (normalCell) normalCell.classList.toggle('active', !compact);
    var compactCell = document.getElementById('cmp-preview-compact');
    if (compactCell) compactCell.classList.toggle('active', compact);
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
    // AK5: route card-bg / card-selected through the gradient-aware applier (overrides the loop above)
    _ctApplyCardFieldValue('card-bg', vars['card-bg']);
    _ctApplyCardFieldValue('card-selected', vars['card-selected']);
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

function _previewFlip() {
    const back = document.getElementById('card-back-preview');
    if (!back) return;
    back.classList.add('flip-preview');
    setTimeout(function() { back.classList.remove('flip-preview'); }, 700);
}

// ── AK4: Flip speed ──────────────────────────────────────────
// es_flipDuration is the card-flip animation length in ms (200–1000, default 600).
function _getFlipDuration() {
    var v = parseInt(localStorage.getItem('es_flipDuration'), 10);
    return (isNaN(v) || v < 200 || v > 1000) ? 600 : v;
}
function _applyFlipDuration() {
    document.documentElement.style.setProperty('--flip-duration', _getFlipDuration() + 'ms');
}
function setFlipDuration(ms) {
    ms = parseInt(ms, 10);
    if (isNaN(ms)) ms = 600;
    ms = Math.min(1000, Math.max(200, ms));
    localStorage.setItem('es_flipDuration', ms);
    _applyFlipDuration();
    var lbl = document.getElementById('flipDurationVal');
    if (lbl) lbl.textContent = (ms / 1000).toFixed(2) + 's';
}
document.addEventListener('DOMContentLoaded', _applyFlipDuration);

function _previewFlipVoteCard() {
    const card = document.getElementById('vote-card-preview');
    if (!card) return;
    card.classList.add('card-flipping');
    setTimeout(function() { card.classList.remove('card-flipping'); }, _getFlipDuration() + 100);
}

// ── AK5: Card gradient builders (card-bg / card-selected) ─────
function _ctGradValue(f) {
    var dir = (document.getElementById('ct-' + f + '-grad-dir') || {}).value || '135deg';
    var c1  = (document.getElementById('ct-' + f + '-grad-1')   || {}).value || '#ffffff';
    var c2  = (document.getElementById('ct-' + f + '-grad-2')   || {}).value || '#000000';
    if (dir === 'circle') return 'radial-gradient(circle, ' + c1 + ', ' + c2 + ')';
    return 'linear-gradient(' + dir + ', ' + c1 + ', ' + c2 + ')';
}
// Effective value for a card field: gradient string when its toggle is on, else the solid color.
function _ctResolveValue(f) {
    var on = document.getElementById('ct-' + f + '-grad-on');
    if (on && on.checked) return _ctGradValue(f);
    var el = document.getElementById('ct-' + f);
    return el ? el.value : (CUSTOM_DEFAULTS[f] || '');
}
// Parse a two-stop linear/radial gradient (the only shapes the builder produces) back into parts.
function _ctParseGradient(val) {
    val = val || '';
    var lin = /linear-gradient\(\s*([^,]+),\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/.exec(val);
    if (lin) return { dir: lin[1].trim(), c1: lin[2], c2: lin[3] };
    var rad = /radial-gradient\([^,]*,\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/.exec(val);
    if (rad) return { dir: 'circle', c1: rad[1], c2: rad[2] };
    return null;
}
function _ctToggleGradUI(f) {
    var on = document.getElementById('ct-' + f + '-grad-on');
    var opts = document.getElementById('ct-' + f + '-grad-opts');
    if (opts) opts.style.display = (on && on.checked) ? 'flex' : 'none';
    updateThemePreview();
}
// Apply a saved card field value to the form: detect gradient → populate builder, else solid picker.
function _ctApplyCardFieldValue(f, val) {
    val = val || CUSTOM_DEFAULTS[f];
    var g = _ctParseGradient(val);
    var on = document.getElementById('ct-' + f + '-grad-on');
    var colEl = document.getElementById('ct-' + f);
    if (g) {
        if (on) on.checked = true;
        var d = document.getElementById('ct-' + f + '-grad-dir'); if (d) d.value = g.dir;
        var s1 = document.getElementById('ct-' + f + '-grad-1'); if (s1) s1.value = g.c1;
        var s2 = document.getElementById('ct-' + f + '-grad-2'); if (s2) s2.value = g.c2;
        if (colEl) colEl.value = CUSTOM_DEFAULTS[f]; // keep the (hidden) color picker valid
    } else {
        if (on) on.checked = false;
        if (colEl) colEl.value = val;
    }
    _ctToggleGradUI(f);
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
    const cardBg        = _ctResolveValue('card-bg')       || bgSecondary;  // AK5: gradient-aware
    const cardBorder    = g('ct-card-border')   || '#dee2e6';
    const cardSelected  = _ctResolveValue('card-selected') || accent;        // AK5: gradient-aware
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
    if (preview) {
        preview.style.fontFamily = font;
        // AH12/AI6: real .poker-card and .participant-badge specimens use CSS vars —
        // set them on the preview container so they cascade to all descendant elements
        const sp = (v, val) => preview.style.setProperty(v, val);
        sp('--card-bg',           cardBg);
        sp('--card-border',       cardBorder);
        sp('--panel-border',      cardBorder);
        sp('--card-selected',     cardSelected);
        sp('--card-selected-text',cardSelText);
        sp('--card-voted',        cardVoted);
        sp('--card-hover',        cardBg);
        sp('--accent',            accent);
        sp('--bg-primary',        bgPrimary);
        sp('--bg-secondary',      bgSecondary);
        sp('--bg2',               bgSecondary);
        sp('--text-primary',      textPrimary);
        sp('--text-secondary',    textPrimary);
        sp('--card-border-width', bw);
        sp('--border-radius',     rad);
    }

    set('pv-navbar',       { backgroundColor: navbarBg, color: navbarText });
    set('pv-brand',        { color: navbarText });
    set('pv-body',         { backgroundColor: bgPrimary });
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
    // AK5: card-bg / card-selected may carry a gradient string instead of the solid color
    ['card-bg', 'card-selected'].forEach(f => { vars[f] = _ctResolveValue(f); });

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
// Y1: renamed key with migration from legacy 'es_cardBack'
var ES_CARD_BACK_KEY = 'es_participantCardBack';
var _cardBackClasses = ['card-back-baize','card-back-space','card-back-retro','card-back-seasonal',
                        'card-back-solid','card-back-gradient','card-back-checker','card-back-stripes','card-back-customimage'];
var _seasonClasses   = ['season-winter','season-spring','season-summer','season-autumn'];

function getCardBackDesign() {
    // Y1: migrate legacy key
    var val = localStorage.getItem(ES_CARD_BACK_KEY);
    if (!val) {
        var legacy = localStorage.getItem('es_cardBack');
        if (legacy) { localStorage.setItem(ES_CARD_BACK_KEY, legacy); val = legacy; }
    }
    return val || 'default';
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
    // Y2: restore CSS vars for dynamic designs
    if (design === 'solid') {
        var solidColor = localStorage.getItem('es_cbSolidColor') || '#1a1a2e';
        document.documentElement.style.setProperty('--cb-solid', solidColor);
        var scInp = document.getElementById('cb-solid-color');
        if (scInp) scInp.value = solidColor;
    }
    if (design === 'gradient') {
        try {
            var grad = JSON.parse(localStorage.getItem('es_cbGrad') || '{}');
            if (grad.a) { document.documentElement.style.setProperty('--cb-grad-a', grad.a); var gai = document.getElementById('cb-grad-a'); if (gai) gai.value = grad.a; }
            if (grad.b) { document.documentElement.style.setProperty('--cb-grad-b', grad.b); var gbi = document.getElementById('cb-grad-b'); if (gbi) gbi.value = grad.b; }
            if (grad.dir) { document.documentElement.style.setProperty('--cb-grad-dir', grad.dir); var gdi = document.getElementById('cb-grad-dir'); if (gdi) gdi.value = grad.dir; }
        } catch(e) {}
    }
    if (design === 'customimage') {
        var imgData = localStorage.getItem('es_cardBackCustomImage');
        if (imgData) document.documentElement.style.setProperty('--cb-custom-img', 'url("' + imgData + '")');
        else document.documentElement.style.removeProperty('--cb-custom-img');
    }
    _cbUpdateSubOpts(design);
    var sel = document.getElementById('cardBackSelect');
    if (sel) sel.value = design;
}

// Y2: Show/hide sub-option panels based on selected design
function _cbUpdateSubOpts(design) {
    var panels = { solid: 'cb-solid-opts', gradient: 'cb-gradient-opts', customimage: 'cb-image-opts' };
    Object.keys(panels).forEach(function(key) {
        var el = document.getElementById(panels[key]);
        if (el) el.style.setProperty('display', key === design ? '' : 'none', 'important');
    });
}

// Y2: Solid color picker handler
function setCbSolidColor(color) {
    localStorage.setItem('es_cbSolidColor', color);
    document.documentElement.style.setProperty('--cb-solid', color);
}

// Y2: Gradient apply handler
function applyCbGradient() {
    var a   = (document.getElementById('cb-grad-a')   || {}).value || '#1a1a2e';
    var b   = (document.getElementById('cb-grad-b')   || {}).value || '#16213e';
    var dir = (document.getElementById('cb-grad-dir') || {}).value || '135deg';
    localStorage.setItem('es_cbGrad', JSON.stringify({ a: a, b: b, dir: dir }));
    document.documentElement.style.setProperty('--cb-grad-a', a);
    document.documentElement.style.setProperty('--cb-grad-b', b);
    document.documentElement.style.setProperty('--cb-grad-dir', dir);
}

// Y3: Custom image upload handler (200 KB cap)
function handleCardBackImage(inp) {
    var file = inp && inp.files && inp.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) { alert('Image must be under 200 KB.'); inp.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
        var data = ev.target.result;
        localStorage.setItem('es_cardBackCustomImage', data);
        document.documentElement.style.setProperty('--cb-custom-img', 'url("' + data + '")');
        setCardBackDesign('customimage');
    };
    reader.readAsDataURL(file);
}

// Y3: Clear custom image and revert to default
function clearCardBackImage() {
    localStorage.removeItem('es_cardBackCustomImage');
    document.documentElement.style.removeProperty('--cb-custom-img');
    setCardBackDesign('default');
    var inp = document.getElementById('cb-image-file');
    if (inp) inp.value = '';
}

// ── Y1: Vote Picker Card Back ─────────────────────────────────
var ES_VOTE_CARD_BACK_KEY = 'es_voteCardBack';
var _voteBackClasses = ['vote-back-baize','vote-back-space','vote-back-retro','vote-back-seasonal',
                        'vote-back-checker','vote-back-stripes','vote-back-solid'];

function getVoteCardBackDesign() {
    return localStorage.getItem(ES_VOTE_CARD_BACK_KEY) || 'default';
}

function setVoteCardBackDesign(design) {
    localStorage.setItem(ES_VOTE_CARD_BACK_KEY, design);
    applyVoteCardBackDesign();
}

function applyVoteCardBackDesign() {
    _voteBackClasses.forEach(function(c) { document.body.classList.remove(c); });
    var design = getVoteCardBackDesign();
    if (design && design !== 'default') {
        document.body.classList.add('vote-back-' + design);
    }
    if (design === 'solid') {
        var solidColor = localStorage.getItem('es_vcbSolidColor') || '#6366f1';
        document.documentElement.style.setProperty('--vcb-solid', solidColor);
        var scInp = document.getElementById('vcb-solid-color');
        if (scInp) scInp.value = solidColor;
    }
    _vcbUpdateSubOpts(design);
    var sel = document.getElementById('voteCardBackSelect');
    if (sel) sel.value = design;
}

function _vcbUpdateSubOpts(design) {
    var el = document.getElementById('vcb-solid-opts');
    if (el) el.style.setProperty('display', design === 'solid' ? '' : 'none', 'important');
}

function setVcbSolidColor(color) {
    localStorage.setItem('es_vcbSolidColor', color);
    document.documentElement.style.setProperty('--vcb-solid', color);
}

document.addEventListener('DOMContentLoaded', applyCardBackDesign);
document.addEventListener('DOMContentLoaded', applyVoteCardBackDesign);

// ============================================================
// AG1 — Timer/Clock Settings (moved from room.js so they work on all pages)
// ============================================================
function saveTimerClockSettings() {
    var showTimerEl  = document.getElementById('tc-show-timer');
    var showClockEl  = document.getElementById('tc-show-clock');
    var tzEl         = document.getElementById('tc-timezone');
    var modeEl       = document.querySelector('input[name="tc-mode"]:checked');
    var colorEl      = document.getElementById('tc-color');
    var fsEl         = document.getElementById('tc-font-size');
    var faceEl       = document.getElementById('tc-face');
    var hourEl       = document.getElementById('tc-hour-color');
    var minEl        = document.getElementById('tc-min-color');
    var secEl        = document.getElementById('tc-sec-color');
    var analogSizeEl = document.getElementById('tc-analog-size');

    if (showTimerEl) localStorage.setItem('es_showTimer', showTimerEl.checked ? '1' : '0');
    if (showClockEl) localStorage.setItem('es_showClock', showClockEl.checked ? '1' : '0');
    if (tzEl)        localStorage.setItem('es_clockTimezone', tzEl.value);
    // AH9: Clear per-segment session-hide when user explicitly re-enables
    if (showTimerEl && showTimerEl.checked) sessionStorage.removeItem('es_hideTimer');
    if (showClockEl && showClockEl.checked) sessionStorage.removeItem('es_hideClock');
    // AG3: delegate room-internal timer-start logic to room.js hook (no-op on non-room pages)
    if (typeof _acOnTimerEnabled === 'function') _acOnTimerEnabled(showTimerEl);

    var styleData = {
        mode:       modeEl       ? modeEl.value                      : 'digital',
        color:      colorEl      ? colorEl.value                     : '#6c757d',
        fontSize:   fsEl         ? parseInt(fsEl.value, 10)          : 13,
        face:       faceEl       ? faceEl.value                      : 'minimal',
        hourColor:  hourEl       ? hourEl.value                      : '#212529',
        minColor:   minEl        ? minEl.value                       : '#495057',
        secColor:   secEl        ? secEl.value                       : '#dc3545',
        analogSize: analogSizeEl ? (parseInt(analogSizeEl.value, 10) || 52) : 52
    };
    localStorage.setItem('es_clockStyle', JSON.stringify(styleData));
    if (typeof _acTick === 'function') _acTick();
    var prev = document.getElementById('tc-clock-preview');
    if (prev) {
        if (typeof _acRenderClock === 'function') _acRenderClock(prev);
        else _acRenderClockBasic(prev);
    }
}
window.saveTimerClockSettings = saveTimerClockSettings;

// ── AK6: Count-up timer style ────────────────────────────────
// es_timerStyle = { color, fontSize, fontFamily } applied to the #stc-timer text.
function _getTimerStyle() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem('es_timerStyle') || '{}'); } catch(e) {}
    return d;
}
function _applyTimerStyle(el, styleData) {
    if (!el) return;
    var d = styleData || _getTimerStyle();
    el.style.color = d.color || '';
    el.style.fontSize = d.fontSize ? d.fontSize + 'px' : '';
    el.style.fontFamily = d.fontFamily || '';
}
function saveTimerStyleSettings() {
    var c = document.getElementById('tc-timer-color');
    var s = document.getElementById('tc-timer-size');
    var f = document.getElementById('tc-timer-font');
    var styleData = {
        color:      c ? c.value : '#6c757d',
        fontSize:   s ? (parseInt(s.value, 10) || 13) : 13,
        fontFamily: f ? f.value : ''
    };
    localStorage.setItem('es_timerStyle', JSON.stringify(styleData));
    if (typeof _acTick === 'function') _acTick();
    _applyTimerStyle(document.getElementById('tc-timer-preview'), styleData);
}
window.saveTimerStyleSettings = saveTimerStyleSettings;
window._getTimerStyle = _getTimerStyle;
window._applyTimerStyle = _applyTimerStyle;

// AG2 — Clock mode toggle (moved from room.js so it works on all pages)
function _tcToggleMode(mode) {
    var digital = document.getElementById('tc-digital-opts');
    var analog  = document.getElementById('tc-analog-opts');
    if (digital) digital.style.display = (mode === 'digital') ? '' : 'none';
    if (analog)  analog.style.display  = (mode === 'analog')  ? '' : 'none';
}
window._tcToggleMode = _tcToggleMode;

// AG4 — Reaction palette live preview
function _renderReactionPreview() {
    var input = document.getElementById('reaction-palette-input');
    var row   = document.getElementById('reaction-preview-row');
    if (!input || !row) return;
    var emojis = input.value.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    row.innerHTML = emojis.length
        ? emojis.map(function(e) {
            return '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:1.1rem;line-height:1.6;pointer-events:none;">' + e + '</button>';
          }).join('')
        : '<span class="text-muted small">No emojis configured — using defaults</span>';
}
window._renderReactionPreview = _renderReactionPreview;

// AH3 — Minimal digital-only clock renderer for pages where room.js is not loaded.
// Used as fallback in the settings modal clock preview when _acRenderClock is unavailable.
function _acRenderClockBasic(el) {
    if (!el) return;
    var styleData = {};
    try { styleData = JSON.parse(localStorage.getItem('es_clockStyle') || '{}'); } catch(e) {}
    var mode = styleData.mode || 'digital';
    var tz   = localStorage.getItem('es_clockTimezone') || '';

    if (mode === 'analog') {
        // AI1: render analog SVG inline — no room.js dependency, pure math + SVG template
        var svgTpl = '<svg class="ac-analog" width="52" height="52" viewBox="0 0 100 100">'
            + '<circle class="ac-face" cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>'
            + '<line class="ac-hour" x1="50" y1="50" x2="50" y2="28" stroke="#212529" stroke-width="5" stroke-linecap="round"/>'
            + '<line class="ac-min"  x1="50" y1="50" x2="50" y2="16" stroke="#495057" stroke-width="3" stroke-linecap="round"/>'
            + '<line class="ac-sec"  x1="50" y1="55" x2="50" y2="12" stroke="#dc3545" stroke-width="1.5" stroke-linecap="round"/>'
            + '<circle cx="50" cy="50" r="2.5" fill="currentColor"/>'
            + '</svg>';
        el.innerHTML = svgTpl;
        var tzDate;
        try { tzDate = tz ? new Date(new Date().toLocaleString('en-US', { timeZone: tz })) : new Date(); }
        catch(e) { tzDate = new Date(); }
        var s2 = tzDate.getSeconds(), m2 = tzDate.getMinutes(), h2 = tzDate.getHours() % 12;
        var svg = el.querySelector('.ac-analog');
        if (svg) {
            var setRot = function(cls, deg) {
                var ln = svg.querySelector(cls); if (ln) ln.setAttribute('transform', 'rotate(' + deg + ',50,50)');
            };
            setRot('.ac-hour', h2 * 30 + m2 * 0.5);
            setRot('.ac-min',  m2 * 6  + s2 * 0.1);
            setRot('.ac-sec',  s2 * 6);
        }
        return;
    }

    var color  = styleData.color || '#6c757d';
    var fs     = (styleData.fontSize || 13) + 'px';
    var h24    = styleData.h24 !== false; // default 24h
    var now    = new Date();
    var opts   = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !h24 };
    if (tz) opts.timeZone = tz;
    var timeStr = '';
    try { timeStr = now.toLocaleTimeString([], opts); } catch(e) { timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !h24 }); }
    el.innerHTML = '<span style="color:' + color + ';font-size:' + fs + ';font-family:monospace;white-space:nowrap;">🕐 ' + timeStr + '</span>';
}
window._acRenderClockBasic = _acRenderClockBasic;

