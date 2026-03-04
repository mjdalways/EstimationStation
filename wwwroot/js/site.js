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
    const modalEl = document.getElementById('customThemeModal');
    if (!modalEl || typeof bootstrap === 'undefined') return;

    if (modalEl.contains(document.activeElement)) {
        document.activeElement.blur();
    }

    const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    setTimeout(() => {
        const focusTarget = document.getElementById('themeSelect');
        if (focusTarget) focusTarget.focus();
    }, 0);
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

function applyTheme(theme) {
    const themes = getCustomThemes();
    if (!isBaseTheme(theme) && !themes[theme]) theme = 'classic';

    document.getElementById('appBody').setAttribute('data-theme', isCustomTheme(theme) ? 'custom' : theme);

    if (isCustomTheme(theme) && themes[theme]?.vars) {
        injectCustomThemeStyle(themes[theme].vars);
    }

    localStorage.setItem('es_theme', theme);
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = theme;

    const editBtn = document.getElementById('editCustomThemeBtn');
    if (editBtn) editBtn.classList.toggle('d-none', !isCustomTheme(theme));
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
        navContent.addEventListener('hidden.bs.collapse', () => openCustomThemeModal(themeId), { once: true });
        bootstrap.Collapse.getOrCreateInstance(navContent).hide();
        return;
    }

    openCustomThemeModal(themeId);
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
    'bg-primary', 'bg-secondary', 'text-primary', 'accent',
    'navbar-bg', 'navbar-text', 'card-selected', 'card-selected-text'
];

const CUSTOM_DEFAULTS = {
    'bg-primary':          '#f8f9fa',
    'bg-secondary':        '#ffffff',
    'text-primary':        '#212529',
    'accent':              '#0d6efd',
    'navbar-bg':           '#343a40',
    'navbar-text':         '#ffffff',
    'card-selected':       '#0d6efd',
    'card-selected-text':  '#ffffff',
    'font-family':         'system-ui, sans-serif',
    'border-radius':       '8'
};

function setCustomizerFormValues(vars) {
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) el.value = vars[f] || CUSTOM_DEFAULTS[f];
    });

    const fontEl = document.getElementById('ct-font-family');
    if (fontEl) {
        fontEl.value = vars['font-family'] || CUSTOM_DEFAULTS['font-family'];
        updateCustomFontPreview(fontEl.value);
    }

    const radEl = document.getElementById('ct-border-radius');
    if (radEl) {
        radEl.value = parseInt(vars['border-radius'], 10) || 8;
        document.getElementById('ct-radius-label').textContent = radEl.value;
    }
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
    const vars = {
        'bg-primary': styles.getPropertyValue('--bg-primary').trim() || CUSTOM_DEFAULTS['bg-primary'],
        'bg-secondary': styles.getPropertyValue('--bg-secondary').trim() || CUSTOM_DEFAULTS['bg-secondary'],
        'text-primary': styles.getPropertyValue('--text-primary').trim() || CUSTOM_DEFAULTS['text-primary'],
        'accent': styles.getPropertyValue('--accent').trim() || CUSTOM_DEFAULTS['accent'],
        'navbar-bg': styles.getPropertyValue('--navbar-bg').trim() || CUSTOM_DEFAULTS['navbar-bg'],
        'navbar-text': styles.getPropertyValue('--navbar-text').trim() || CUSTOM_DEFAULTS['navbar-text'],
        'card-selected': styles.getPropertyValue('--card-selected').trim() || CUSTOM_DEFAULTS['card-selected'],
        'card-selected-text': styles.getPropertyValue('--card-selected-text').trim() || CUSTOM_DEFAULTS['card-selected-text'],
        'font-family': styles.getPropertyValue('--font-family').trim() || CUSTOM_DEFAULTS['font-family'],
        'border-radius': (styles.getPropertyValue('--border-radius').trim() || CUSTOM_DEFAULTS['border-radius']).replace('px', '')
    };

    document.body.removeChild(probe);
    return vars;
}

function loadThemePresetForCustomization() {
    const select = document.getElementById('ct-base-theme');
    if (!select || !select.value) return;
    const vars = readThemeVars(select.value);
    setCustomizerFormValues(vars);
}

function updateCustomFontPreview(fontFamily) {
    const preview = document.getElementById('ct-font-preview');
    if (!preview) return;
    preview.style.fontFamily = fontFamily || CUSTOM_DEFAULTS['font-family'];
}

function injectCustomThemeStyle(vars) {
    let s = document.getElementById('customThemeStyle');
    if (!s) {
        s = document.createElement('style');
        s.id = 'customThemeStyle';
        document.head.appendChild(s);
    }
    const a = vars['accent'];
    const r = vars['border-radius'];
    s.textContent =
        `[data-theme="custom"]{` +
        `--bg-primary:${vars['bg-primary']};` +
        `--bg-secondary:${vars['bg-secondary']};` +
        `--text-primary:${vars['text-primary']};` +
        `--text-secondary:${vars['text-primary']}99;` +
        `--accent:${a};` +
        `--accent-hover:${a};` +
        `--card-bg:${vars['bg-secondary']};` +
        `--card-hover:${a}22;` +
        `--card-selected:${vars['card-selected']};` +
        `--card-selected-text:${vars['card-selected-text']};` +
        `--card-border:${vars['text-primary']}44;` +
        `--card-voted:#198754;` +
        `--btn-primary:${a};` +
        `--btn-reveal:#198754;` +
        `--btn-reset:#ffc107;` +
        `--font-family:${vars['font-family']};` +
        `--heading-font:${vars['font-family']};` +
        `--border-radius:${r}px;` +
        `--shadow:0 2px 8px rgba(0,0,0,0.1);` +
        `--navbar-bg:${vars['navbar-bg']};` +
        `--navbar-text:${vars['navbar-text']};` +
        `--panel-bg:${vars['bg-secondary']};` +
        `--panel-border:${vars['text-primary']}33;` +
        `--stats-bg:${a}22;` +
        `--chat-bg:${vars['bg-primary']};` +
        `--chat-bubble:${vars['bg-secondary']};` +
        `--story-active:${a}22;` +
        `--story-completed:#d1e7dd;` +
        `--timer-color:#dc3545;}`;
}

function openCustomThemeModal(themeId) {
    const themes = getCustomThemes();
    const theme = themeId && themes[themeId]
        ? themes[themeId]
        : { name: '', vars: { ...CUSTOM_DEFAULTS } };

    document.getElementById('ct-theme-id').value = themeId || '';
    document.getElementById('ct-theme-name').value = theme.name || '';

    populateCustomizationThemeSources();
    const baseSelect = document.getElementById('ct-base-theme');
    if (baseSelect) baseSelect.value = (themeId && (isBaseTheme(themeId) || isCustomTheme(themeId))) ? themeId : (localStorage.getItem('es_theme') || 'classic');

    setCustomizerFormValues(theme.vars);

    const deleteBtn = document.getElementById('ct-delete-btn');
    if (deleteBtn) deleteBtn.classList.toggle('d-none', !themeId);

    new bootstrap.Modal(document.getElementById('customThemeModal')).show();
}

function editCurrentCustomTheme() {
    const current = localStorage.getItem('es_theme') || '';
    if (isCustomTheme(current)) {
        openCustomThemeModalSafely(current);
    } else {
        openCustomThemeModalSafely();
    }
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
    vars['font-family'] = document.getElementById('ct-font-family').value;
    vars['border-radius'] = document.getElementById('ct-border-radius').value;

    const themes = getCustomThemes();
    themes[themeId] = { name, vars };
    saveCustomThemes(themes);
    renderCustomThemeOptions();

    closeCustomThemeModal();
    applyTheme(themeId);
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
    vars['font-family'] = document.getElementById('ct-font-family').value;
    vars['border-radius'] = document.getElementById('ct-border-radius').value;

    const blob = new Blob([JSON.stringify({ name, vars }, null, 2)], { type: 'application/json' });
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
            } catch {
                alert('Could not read that theme file.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/** Revert dropdown to the previously saved theme when user cancels. */
function cancelCustomTheme() {
    const prev = localStorage.getItem('es_theme') || 'classic';
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = prev;
}
