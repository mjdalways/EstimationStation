// Theme Management
const THEMES = ['classic', 'dark', 'forest', 'ocean', 'retro'];

function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'classic';
    document.getElementById('appBody').setAttribute('data-theme', theme);
    localStorage.setItem('es_theme', theme);

    // Update active state on all theme buttons
    document.querySelectorAll('.theme-btn, .theme-btn-sm').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

function loadTheme() {
    const saved = localStorage.getItem('es_theme') || 'classic';
    applyTheme(saved);
}

// Attach theme button handlers
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    document.querySelectorAll('.theme-btn, .theme-btn-sm').forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
});
