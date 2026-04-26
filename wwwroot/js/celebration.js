// ============================================================
// EstimationStation - Celebration Module
// Triggered on consensus; supports confetti, fireworks, balloons.
// Each effect is independently togglable and fully configurable
// via the Celebration Settings modal.  Settings persisted to
// localStorage under CELEBRATION_SETTINGS_KEY.
// ============================================================

const CELEBRATION_SETTINGS_KEY = 'es_celebrationSettings';

// Per-theme confetti color presets (used when "use theme colors" is on)
const THEME_CONFETTI_PRESETS = {
    classic:    { colors: ['#0d6efd','#198754','#ffc107','#dc3545','#6f42c1','#ffffff'] },
    dark:       { colors: ['#7c3aed','#059669','#d97706','#f87171','#c4b5fd','#60a5fa'] },
    forest:     { colors: ['#2d6a4f','#52b788','#95d5b2','#b7e4c7','#40916c','#74c69d'] },
    ocean:      { colors: ['#0077b6','#0096c7','#00b4d8','#48cae4','#90e0ef','#caf0f8'] },
    retro:      { colors: ['#ff6b35','#f7c59f','#004e89','#1a936f','#c62a2a','#efefd0'] },
    floral:     { colors: ['#f72585','#b5179e','#7209b7','#4cc9f0','#f4a261','#e9c46a'] },
    eighties:   { colors: ['#ff00ff','#00ffff','#ffff00','#ff4444','#00ff00','#ff8800'] },
    redyellow:  { colors: ['#dc3545','#ffc107','#ff6b35','#ff8500','#ffffff','#ff0000'] },
    blueyellow: { colors: ['#0d6efd','#ffc107','#0dcaf0','#ffffff','#6ea8fe','#ffe08a'] },
    myspace:    { colors: ['#003399','#cc0000','#ff99ff','#ffcc00','#ffffff','#0066cc'] },
    geocities:  { colors: ['#ff00ff','#00ff00','#0000ff','#ffff00','#ff8000','#00ffff'] }
};

const DEFAULT_CELEBRATION = {
    enableConfetti:          true,
    enableFireworks:         true,
    enableBalloons:          true,
    confettiDuration:        4000,
    confettiParticleCount:   150,
    confettiSpread:          70,
    confettiUseThemeColors:  true,
    confettiColors:          ['#ff0000','#00cc00','#0000ff','#ffcc00','#ff00ff'],
    confettiType:            'default',
    confettiEmojis:          ['🎉','🎊','✨','🎈'],
    fireworksDuration:       5000,
    fireworksIntensity:      30,
    fireworksParticles:      50,
    fireworksExplosion:      5,
    fireworksRocketsPoint:   50,
    fireworksHueMin:         0,
    fireworksHueMax:         360,
    balloonCount:            10,
    balloonDuration:         6000
};

function getCelebrationSettings() {
    try {
        const raw = localStorage.getItem(CELEBRATION_SETTINGS_KEY);
        return raw ? { ...DEFAULT_CELEBRATION, ...JSON.parse(raw) } : { ...DEFAULT_CELEBRATION };
    } catch {
        return { ...DEFAULT_CELEBRATION };
    }
}

function saveCelebrationSettings(settings) {
    localStorage.setItem(CELEBRATION_SETTINGS_KEY, JSON.stringify(settings));
}

// ============================================================
// Main entry point — called from room.js on fresh consensus
// ============================================================
function triggerCelebration() {
    const s = getCelebrationSettings();
    if (s.enableConfetti)  triggerConfetti(s);
    if (s.enableFireworks) triggerFireworks(s);
    if (s.enableBalloons)  triggerBalloons(s);
}

function stopCelebration() {
    stopFireworks();
    stopBalloons();
}

// ============================================================
// Confetti (canvas-confetti)
// ============================================================
function _resolveConfettiColors(s) {
    if (!s.confettiUseThemeColors) return s.confettiColors;

    const theme = localStorage.getItem('es_theme') || 'classic';

    // Custom theme: check saved celebration colors
    if (typeof isCustomTheme === 'function' && isCustomTheme(theme) &&
        typeof getCustomThemes === 'function') {
        const themes = getCustomThemes();
        const cols = themes[theme]?.celebration?.confettiColors;
        if (Array.isArray(cols) && cols.length) return cols;
    }

    return THEME_CONFETTI_PRESETS[theme]?.colors ?? THEME_CONFETTI_PRESETS.classic.colors;
}

function _buildConfettiOptions(s, colors) {
    const opts = {
        particleCount: Math.max(5, Math.floor(s.confettiParticleCount / 6)),
        spread:        s.confettiSpread,
        colors
    };

    if (typeof confetti === 'undefined') return opts;

    switch (s.confettiType) {
        case 'stars':
            opts.shapes = ['star'];
            opts.scalar = 1.2;
            break;
        case 'snow':
            opts.colors  = ['#ffffff','#e8e8e8','#d0d0d0'];
            opts.shapes  = ['circle'];
            opts.gravity = 0.4;
            opts.drift   = 1;
            opts.scalar  = 0.7;
            break;
        case 'hearts':
            if (typeof confetti.shapeFromText === 'function') {
                opts.shapes = ['❤️','💛','💚','💙','💜']
                    .map(t => confetti.shapeFromText({ text: t, scalar: 2 }));
                opts.scalar = 2;
                opts.colors = ['#ff69b4','#ff0000','#ffb6c1'];
            }
            break;
        case 'emoji':
            if (typeof confetti.shapeFromText === 'function') {
                const emojis = s.confettiEmojis?.length ? s.confettiEmojis : DEFAULT_CELEBRATION.confettiEmojis;
                opts.shapes  = emojis.map(t => confetti.shapeFromText({ text: t, scalar: 2 }));
                opts.scalar  = 2;
                opts.colors  = ['#ffffff'];
            }
            break;
        case 'christmasHoliday':
            if (typeof confetti.shapeFromText === 'function') {
                opts.shapes = ['🎄','⭐','🎁','❄️']
                    .map(t => confetti.shapeFromText({ text: t, scalar: 2 }));
                opts.scalar = 2;
            }
            opts.colors = ['#cc0000','#008000','#ffd700','#ffffff'];
            break;
        case 'halloweenHoliday':
            if (typeof confetti.shapeFromText === 'function') {
                opts.shapes = ['🎃','👻','🕷️','🦇']
                    .map(t => confetti.shapeFromText({ text: t, scalar: 2 }));
                opts.scalar = 2;
            }
            opts.colors = ['#ff6600','#000000','#800080','#cccccc'];
            break;
        case 'valentineHoliday':
            if (typeof confetti.shapeFromText === 'function') {
                opts.shapes = ['❤️','💕','💝','🌹']
                    .map(t => confetti.shapeFromText({ text: t, scalar: 2 }));
                opts.scalar = 2;
            }
            opts.colors = ['#ff69b4','#ff1493','#ff0000','#ffb6c1'];
            break;
        default: // 'default'
            break;
    }

    return opts;
}

function triggerConfetti(s) {
    if (typeof confetti === 'undefined') return;

    const colors = _resolveConfettiColors(s);
    const end    = Date.now() + s.confettiDuration;

    function burst() {
        if (Date.now() >= end) return;
        const opts = _buildConfettiOptions(s, colors);
        confetti({ ...opts, origin: { x: Math.random() * 0.8 + 0.1, y: Math.random() * 0.3 + 0.1 } });
        setTimeout(burst, 350);
    }

    // Initial side bursts for immediate visual impact
    confetti({ ..._buildConfettiOptions(s, colors), angle: 60,  spread: 55, origin: { x: 0, y: 0.65 } });
    confetti({ ..._buildConfettiOptions(s, colors), angle: 120, spread: 55, origin: { x: 1, y: 0.65 } });
    setTimeout(burst, 200);
}

// ============================================================
// Fireworks (fireworks-js)
// ============================================================
let _fireworksInstance = null;
let _fireworksStopTimeout = null;

function _getFireworksConstructor() {
    const fw = window.Fireworks;
    if (!fw) return null;
    if (typeof fw === 'function')                          return fw;
    if (fw.Fireworks && typeof fw.Fireworks === 'function') return fw.Fireworks;
    if (fw.default   && typeof fw.default   === 'function') return fw.default;
    return null;
}

function triggerFireworks(s) {
    stopFireworks();

    const FW = _getFireworksConstructor();
    if (!FW) return;

    const container = document.createElement('div');
    container.id = 'fireworks-container';
    container.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'z-index:9990;pointer-events:none;';
    document.body.appendChild(container);

    _fireworksInstance = new FW(container, {
        autoresize:  true,
        opacity:     0.5,
        acceleration: 1.05,
        friction:    0.97,
        gravity:     1.5,
        particles:   s.fireworksParticles,
        traceLength: 3,
        traceSpeed:  10,
        explosion:   s.fireworksExplosion,
        intensity:   s.fireworksIntensity,
        flickering:  50,
        lineStyle:   'round',
        hue:         { min: s.fireworksHueMin, max: s.fireworksHueMax },
        delay:       { min: 15, max: 30 },
        rocketsPoint: { min: s.fireworksRocketsPoint, max: s.fireworksRocketsPoint },
        lineWidth:   { explosion: { min: 1, max: 3 }, trace: { min: 1, max: 2 } },
        brightness:  { min: 50, max: 80 },
        decay:       { min: 0.015, max: 0.03 },
        mouse:       { click: false, move: false, max: 1 }
    });

    _fireworksInstance.start();
    _fireworksStopTimeout = setTimeout(stopFireworks, s.fireworksDuration);
}

function stopFireworks() {
    if (_fireworksStopTimeout) { clearTimeout(_fireworksStopTimeout); _fireworksStopTimeout = null; }
    if (_fireworksInstance)    { _fireworksInstance.stop(); _fireworksInstance = null; }
    const el = document.getElementById('fireworks-container');
    if (el) el.remove();
}

// ============================================================
// Balloons (pure CSS — no images)
// ============================================================
let _balloonContainer = null;
let _balloonStopTimeout = null;

const BALLOON_PALETTE = [
    '#ff6b6b','#ffa07a','#ffd700','#98fb98','#87ceeb',
    '#dda0dd','#ff69b4','#40e0d0','#ff8c00','#7b68ee'
];

function triggerBalloons(s) {
    stopBalloons();

    const container = document.createElement('div');
    container.id = 'balloon-container';
    container.style.cssText =
        'position:fixed;bottom:0;left:0;width:100%;height:100%;' +
        'z-index:9989;pointer-events:none;overflow:hidden;';
    document.body.appendChild(container);
    _balloonContainer = container;

    const count    = Math.max(1, s.balloonCount);
    const stagger  = Math.min(600, (s.balloonDuration * 0.4) / count);

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            if (_balloonContainer) {
                _createBalloon(_balloonContainer, BALLOON_PALETTE[i % BALLOON_PALETTE.length]);
            }
        }, i * stagger);
    }

    _balloonStopTimeout = setTimeout(stopBalloons, s.balloonDuration + 5000);
}

function _createBalloon(container, color) {
    const size     = 44 + Math.random() * 28;          // 44–72 px
    const left     = 5  + Math.random() * 90;          // 5–95 %
    const riseDur  = (4  + Math.random() * 4).toFixed(1); // 4–8 s
    const swayDur  = (riseDur * 0.45).toFixed(1);
    const swayDir  = Math.random() > 0.5 ? 'balloon-sway-left' : 'balloon-sway-right';
    const lighter  = _lightenHex(color, 55);
    const strLen   = Math.round(size * 0.75);

    // Outer wrapper handles the rise; inner balloon handles the sway
    const riser = document.createElement('div');
    riser.className = 'balloon-riser';
    riser.style.cssText =
        `left:${left}%;` +
        `animation:balloon-rise ${riseDur}s ease-in forwards;`;

    const body = document.createElement('div');
    body.className = `celebration-balloon ${swayDir}`;
    body.style.cssText =
        `width:${size}px;` +
        `height:${(size * 1.18).toFixed(0)}px;` +
        `background:radial-gradient(circle at 35% 32%, ${lighter}, ${color});` +
        `animation:${swayDir} ${swayDur}s ease-in-out infinite;`;

    const knot = document.createElement('div');
    knot.className = 'balloon-knot';
    knot.style.background = color;
    knot.style.width  = '7px';
    knot.style.height = '7px';

    const str = document.createElement('div');
    str.className = 'balloon-string';
    str.style.cssText =
        `height:${strLen}px;` +
        `background:${color}99;`;

    riser.appendChild(body);
    riser.appendChild(knot);
    riser.appendChild(str);
    container.appendChild(riser);

    riser.addEventListener('animationend', () => riser.remove(), { once: true });
}

function _lightenHex(hex, amount) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (n >> 16)        + amount);
    const g = Math.min(255, ((n >> 8) & 0xff) + amount);
    const b = Math.min(255, (n & 0xff)        + amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function stopBalloons() {
    if (_balloonStopTimeout) { clearTimeout(_balloonStopTimeout); _balloonStopTimeout = null; }
    if (_balloonContainer)   { _balloonContainer.remove(); _balloonContainer = null; }
    const el = document.getElementById('balloon-container');
    if (el) el.remove();
}

// ============================================================
// Settings Modal UI
// ============================================================

/** Opens the Celebration Settings modal and populates all fields. */
function populateCelebrationTab() {
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
}

/** Reads the modal form and persists settings. */
function saveCelebrationSettingsFromForm() {
    const s = {
        enableConfetti:         _celGet('cel-enable-confetti',  'checked'),
        enableFireworks:        _celGet('cel-enable-fireworks', 'checked'),
        enableBalloons:         _celGet('cel-enable-balloons',  'checked'),
        confettiType:           _celGet('cel-confetti-type',    'value'),
        confettiDuration:       _celGetInt('cel-confetti-duration',   DEFAULT_CELEBRATION.confettiDuration),
        confettiParticleCount:  _celGetInt('cel-confetti-particles',  DEFAULT_CELEBRATION.confettiParticleCount),
        confettiSpread:         _celGetInt('cel-confetti-spread',     DEFAULT_CELEBRATION.confettiSpread),
        confettiUseThemeColors: _celGet('cel-confetti-use-theme','checked'),
        confettiColors:         (_celGet('cel-confetti-colors','value') || '').split(',').map(c => c.trim()).filter(Boolean),
        confettiEmojis:         (_celGet('cel-confetti-emojis','value') || '').split(',').map(e => e.trim()).filter(Boolean),
        fireworksDuration:      _celGetInt('cel-fireworks-duration',  DEFAULT_CELEBRATION.fireworksDuration),
        fireworksIntensity:     _celGetInt('cel-fireworks-intensity', DEFAULT_CELEBRATION.fireworksIntensity),
        fireworksParticles:     _celGetInt('cel-fireworks-particles', DEFAULT_CELEBRATION.fireworksParticles),
        fireworksExplosion:     _celGetInt('cel-fireworks-explosion', DEFAULT_CELEBRATION.fireworksExplosion),
        fireworksRocketsPoint:  _celGetInt('cel-fireworks-rockets',   DEFAULT_CELEBRATION.fireworksRocketsPoint),
        fireworksHueMin:        _celGetInt('cel-fireworks-hue-min',   DEFAULT_CELEBRATION.fireworksHueMin),
        fireworksHueMax:        _celGetInt('cel-fireworks-hue-max',   DEFAULT_CELEBRATION.fireworksHueMax),
        balloonCount:           _celGetInt('cel-balloon-count',       DEFAULT_CELEBRATION.balloonCount),
        balloonDuration:        _celGetInt('cel-balloon-duration',    DEFAULT_CELEBRATION.balloonDuration)
    };
    saveCelebrationSettings(s);
    const modal = bootstrap.Modal.getInstance(document.getElementById('celebrationSettingsModal'));
    if (modal) modal.hide();
}

/** Saves settings then fires a test celebration (hides modal first). */
let _testCelebrationPending = false;
function testCelebration() {
    //saveCelebrationSettingsFromForm();
    stopCelebration();
    triggerCelebration();
}

// When the settings modal is opened (by user OR re-opened after test), clear the pending flag
// so a manual close during the wait period doesn't re-fire a stale celebration.
document.addEventListener('DOMContentLoaded', () => {
    const modalEl = document.getElementById('settingsModal');
    if (!modalEl) return;
    modalEl.addEventListener('show.bs.modal', () => {
        _testCelebrationPending = false;
        if (typeof _settingsSaved !== 'undefined') _settingsSaved = false;
    });
});

/** Resets to defaults and refreshes the form. */
function resetCelebrationSettings() {
    saveCelebrationSettings({ ...DEFAULT_CELEBRATION });
    openCelebrationSettings();
}

function _updateCustomColorsVisibility(show) {
    const el = document.getElementById('cel-custom-colors-group');
    if (el) el.style.display = show ? '' : 'none';
}

function _updateEmojiVisibility(show) {
    const el = document.getElementById('cel-emoji-group');
    if (el) el.style.display = show ? '' : 'none';
}

// Helper setters/getters
function _celSet(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el[prop] = value;
}
function _celGet(id, prop) {
    const el = document.getElementById(id);
    return el ? el[prop] : undefined;
}
function _celGetInt(id, fallback) {
    return parseInt(_celGet(id, 'value'), 10) || fallback;
}
function _celSetRange(rangeId, labelId, value, suffix) {
    const el = document.getElementById(rangeId);
    if (el) el.value = value;
    const lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = value + (suffix || '');
}
