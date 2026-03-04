// Theme Management
const THEMES = ['classic', 'dark', 'forest', 'ocean', 'retro'];

function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'classic';
    document.getElementById('appBody').setAttribute('data-theme', theme);
    localStorage.setItem('es_theme', theme);

    // Sync dropdown value if present
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = theme;
}

function loadTheme() {
    const saved = localStorage.getItem('es_theme') || 'classic';
    applyTheme(saved);
}

document.addEventListener('DOMContentLoaded', loadTheme);
