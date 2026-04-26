// ============================================================
// Theme Management
// ============================================================
const BASE_THEMES = [
    'classic', 'dark', 'forest', 'ocean', 'retro',
    'floral', 'eighties', 'redyellow', 'blueyellow', 'myspace', 'geocities'
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
    geocities: 'GeoCities'
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

    if (typeof populateCelebrationTab === 'function') populateCelebrationTab();

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

document.addEventListener('DOMContentLoaded', loadTheme);

// ============================================================
// PWA Install
// ============================================================
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
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
    'story-active', 'story-completed', 'timer-color'
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
    'timer-color':         '#dc3545'
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




