// ============================================================
// Theme Management
// ============================================================
const THEMES = [
    'classic', 'dark', 'forest', 'ocean', 'retro',
    'floral', 'eighties', 'redyellow', 'blueyellow', 'myspace', 'geocities',
    'custom'
];

function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'classic';
    document.getElementById('appBody').setAttribute('data-theme', theme);
    localStorage.setItem('es_theme', theme);
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = theme;
}

/** Called by the dropdown's onchange; opens the builder when "custom" is chosen. */
function onThemeChange(theme) {
    if (theme === 'custom') {
        openCustomThemeModal();
    } else {
        applyTheme(theme);
    }
}

function loadTheme() {
    const saved = localStorage.getItem('es_theme') || 'classic';
    if (saved === 'custom') {
        const vars = JSON.parse(localStorage.getItem('es_customThemeVars') || 'null');
        if (vars) {
            injectCustomThemeStyle(vars);
            applyTheme('custom');
        } else {
            applyTheme('classic');
        }
    } else {
        applyTheme(saved);
    }
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

function openCustomThemeModal() {
    const parsed = JSON.parse(localStorage.getItem('es_customThemeVars') || 'null');
    const saved = parsed !== null ? parsed : { ...CUSTOM_DEFAULTS };
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) el.value = saved[f] || CUSTOM_DEFAULTS[f];
    });
    const fontEl = document.getElementById('ct-font-family');
    if (fontEl) fontEl.value = saved['font-family'] || CUSTOM_DEFAULTS['font-family'];
    const radEl = document.getElementById('ct-border-radius');
    if (radEl) {
        radEl.value = parseInt(saved['border-radius'], 10) || 8;
        document.getElementById('ct-radius-label').textContent = radEl.value;
    }
    new bootstrap.Modal(document.getElementById('customThemeModal')).show();
}

function saveCustomTheme() {
    const vars = {};
    CUSTOM_COLOR_FIELDS.forEach(f => {
        const el = document.getElementById('ct-' + f);
        if (el) vars[f] = el.value;
    });
    vars['font-family'] = document.getElementById('ct-font-family').value;
    vars['border-radius'] = document.getElementById('ct-border-radius').value;
    localStorage.setItem('es_customThemeVars', JSON.stringify(vars));
    injectCustomThemeStyle(vars);
    bootstrap.Modal.getInstance(document.getElementById('customThemeModal')).hide();
    applyTheme('custom');
}

/** Revert dropdown to the previously saved theme when user cancels. */
function cancelCustomTheme() {
    const prev = localStorage.getItem('es_theme') || 'classic';
    if (prev !== 'custom') {
        const sel = document.getElementById('themeSelect');
        if (sel) sel.value = prev;
    }
}
