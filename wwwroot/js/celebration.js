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
    streakEnabled:           true,
    lavaEnabled:             true,
    lavaDuration:            30,
    lavaColor:               '#ff4500',
    seasonalTheme:           true,
    seasonalHalloween:       true,
    seasonalChristmas:       true,
    seasonalNewYear:         true,
    seasonalValentine:       true,
    seasonalSpring:          true,
    seasonalSummer:          true,
    seasonalAutumn:          true,
    seasonalThanksgiving:    true,
    seasonalDeepWinter:      true,
    seasonalLunarNew:        true,
    seasonalAwards:          true,
    seasonalPancakeDay:      true,
    seasonalPiDay:           true,
    seasonalStPatricks:      true,
    seasonalHoli:            true,
    seasonalHanami:          true,
    seasonalAprilFools:      true,
    seasonalEarthDay:        true,
    seasonalRamadan:         true,
    seasonalMayDay:          true,
    seasonalStarWarsDay:     true,
    seasonalPride:           true,
    seasonalOceanWeek:       true,
    seasonalSolstice:        true,
    seasonalIndependence:    true,
    seasonalTanabata:        true,
    seasonalBastille:        true,
    seasonalAugBankHoliday:  true,
    seasonalBackToSchool:    true,
    seasonalOktoberfest:     true,
    seasonalMidAutumn:       true,
    seasonalSpaceWeek:       true,
    seasonalDayOfDead:       true,
    seasonalBonfireNight:    true,
    seasonalDiwali:          true,
    seasonalRemembrance:     true,
    seasonalBoxingDay:       true,
    seasonalWinterSolstice:  true,
    seasonalEndOfYear:       true,
    seasonalMlkDay:          true,
    seasonalPresidentsDay:   true,
    seasonalMemorialDay:     true,
    seasonalJuneteenth:      true,
    seasonalLaborDay:        true,
    seasonalIndigenousDay:   true,
    seasonalVeteransDay:     true,
    seasonalMothersDay:      true,
    seasonalFathersDay:      true,
    seasonalMotheringSunday: true,
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
    balloonDuration:         6000,
    finisherEnabled:         true,
    finisherThreshold:       4,
    pokerReveal:             true,
    revealSpeedBadges:       true,
    revealHotCold:           true,
    revealVoteDist:          true,
    revealParticles:         true,
    revealParticleType:      'star',
    revealParticleCount:     8,
    suspenseReveal:          true,
    suspenseSpeed:           'normal',
    suspenseOrdering:        true,
    consensusSupernova:      true,
    mobileAnimations:        false
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
// Seasonal theme override — returns partial settings object or null
// ============================================================
const SEA_CONFETTI_OVERRIDES = {
    halloween:      { colors: ['#ff6600','#ff4500','#222222','#8b0000','#ffd700'], emojis: ['🎃','👻','🕷️','🦇','🕸️'] },
    christmas:      { colors: ['#cc0000','#006600','#ffffff','#ffd700','#cc0000'], emojis: ['🎄','⛄','❄️','🎁','🦌'] },
    newyear:        { colors: ['#ffd700','#c0c0c0','#ff6b6b','#4fc3f7','#ffffff'], emojis: ['🎆','🎉','✨','🥂','🎊'] },
    valentine:      { colors: ['#ff1493','#ff69b4','#c71585','#ff4040','#ffffff'], emojis: ['❤️','💘','💝','🌹','💞'] },
    spring:         { colors: ['#66bb6a','#aed581','#f06292','#ffb74d','#4fc3f7'], emojis: ['🌸','🌼','🦋','🌷','🐝'] },
    summer:         { colors: ['#ffd54f','#ff7043','#29b6f6','#66bb6a','#ffffff'], emojis: ['☀️','🌊','🏖️','🍦','🌻'] },
    autumn:         { colors: ['#e65100','#bf360c','#ffd54f','#8d6e63','#d7ccc8'], emojis: ['🍁','🍂','🌾','🎑','🦉'] },
    thanksgiving:   { colors: ['#e65100','#d32f2f','#ffa000','#5d4037','#ffcc02'], emojis: ['🦃','🍂','🌽','🥧','🍁'] },
    deepwinter:     { colors: ['#b3d9f2','#a8d8f0','#ffffff','#e8f4f8','#cce7f5'], emojis: ['❄️','⛄','🌨️','🧊','🌊'] },
    lunarnew:       { colors: ['#ff0000','#ffd700','#ff4500','#cc0000','#ff6600'], emojis: ['🧧','🐉','🏮','🎊','🎆'] },
    awards:         { colors: ['#ffd700','#c0c0c0','#cd7f32','#f0e68c','#fff8dc'], emojis: ['🏆','⭐','🎬','🎭','🌟'] },
    pancakeday:     { colors: ['#d4a017','#f5deb3','#ffd700','#ffe4b5','#daa520'], emojis: ['🥞','🍋','🧈','🍯','🥛'] },
    piday:          { colors: ['#4169e1','#1e90ff','#87ceeb','#6495ed','#b0c4de'], emojis: ['🥧','π','∞','🔢','📐'] },
    stpatricks:     { colors: ['#006400','#228b22','#32cd32','#ffd700','#ffffff'], emojis: ['🍀','🌈','🍺','☘️','🎩'] },
    holi:           { colors: ['#ff69b4','#ff4500','#ffd700','#9400d3','#00ced1'], emojis: ['🎨','💥','🌈','🎊','🎉'] },
    hanami:         { colors: ['#ffb7c5','#ff69b4','#ffc0cb','#ff1493','#ffffff'], emojis: ['🌸','🌺','🌼','🌷','🍃'] },
    aprilfools:     { colors: ['#ff4500','#ffd700','#9400d3','#ff1493','#00ced1'], emojis: ['🃏','😜','🎭','⚠️','🤡'] },
    earthday:       { colors: ['#228b22','#32cd32','#006400','#4169e1','#87ceeb'], emojis: ['🌍','🌱','♻️','🌿','💚'] },
    ramadan:        { colors: ['#004080','#c0a000','#006080','#ffd700','#ffffff'], emojis: ['🌙','⭐','🪔','✨','🕌'] },
    mayday:         { colors: ['#ff69b4','#ff1493','#dc143c','#ff6347','#ff4500'], emojis: ['🌺','🌸','🎀','🌹','💐'] },
    starwarsday:    { colors: ['#000000','#ffffaa','#4169e1','#006400','#ff0000'], emojis: ['⚔️','⭐','🚀','🌌','🤖'] },
    pride:          { colors: ['#ff0000','#ff7f00','#ffff00','#00cd00','#0000ff'], emojis: ['🌈','❤️','🧡','💛','💚'] },
    oceanweek:      { colors: ['#0077b6','#0096c7','#00b4d8','#48cae4','#90e0ef'], emojis: ['🐠','🌊','🐙','🦈','🐬'] },
    solstice:       { colors: ['#ffd700','#ff8c00','#ffffe0','#fffff0','#fff8dc'], emojis: ['☀️','✨','🌟','🌞','💛'] },
    mlkday:         { colors: ['#cc0000','#ffffff','#0000cc','#8b0000','#1c4587'], emojis: ['✊','🕊️','🌟','⭐','🙏'] },
    presidentsday:  { colors: ['#cc0000','#ffffff','#0000cc','#b8860b','#ffd700'], emojis: ['🎩','🌟','⭐','🏛️','🌟'] },
    motheringsunday:{ colors: ['#ff69b4','#ffd700','#98fb98','#ffb6c1','#ffffff'], emojis: ['💐','🌸','🌼','💛','❤️'] },
    mothersday:     { colors: ['#ff69b4','#ff1493','#ffb6c1','#dc143c','#ff6347'], emojis: ['🌸','💐','💕','🌷','❤️'] },
    memorialday:    { colors: ['#cc0000','#ffffff','#0000cc','#8b0000','#002868'], emojis: ['🌺','🎖️','⭐','🕊️','🕊️'] },
    juneteenth:     { colors: ['#cc0000','#000000','#ffffff','#228b22','#ffd700'], emojis: ['✊','🕊️','⭐','🗽','🎉'] },
    fathersday:     { colors: ['#4169e1','#1e90ff','#0000cd','#ffd700','#87ceeb'], emojis: ['🎈','👔','⭐','🏆','🎉'] },
    laborday:       { colors: ['#cc0000','#ffffff','#0000cc','#ffd700','#ff6347'], emojis: ['🔧','⚙️','💪','🛠️','🔨'] },
    indigenousday:  { colors: ['#8b4513','#228b22','#ffd700','#dc143c','#ffffff'], emojis: ['🪶','🌿','🌎','🦅','⭐'] },
    veteransday:    { colors: ['#cc0000','#ffffff','#0000cc','#b8860b','#ffd700'], emojis: ['🎖️','⭐','🌟','🕊️','🌟'] },
    independence:   { colors: ['#cc0000','#ffffff','#0000cc','#ff0000','#002868'], emojis: ['🎇','🎆','🎇','⭐','🦅'] },
    tanabata:       { colors: ['#191970','#4169e1','#87ceeb','#ffd700','#ffffff'], emojis: ['🎋','🌠','⭐','🌟','🎐'] },
    bastille:       { colors: ['#002395','#ffffff','#ed2939','#0055a4','#ef4135'], emojis: ['🔵','⚪','🔴','🎆','🗼'] },
    augbankholiday: { colors: ['#87ceeb','#d3d3d3','#90ee90','#ffd700','#ff6347'], emojis: ['🌧️','☀️','🧳','🍺','🌈'] },
    backtoschool:   { colors: ['#ffd700','#ff4500','#4169e1','#228b22','#ff69b4'], emojis: ['✏️','📚','📐','🎒','📝'] },
    oktoberfest:    { colors: ['#006400','#ffffff','#0000ff','#ffd700','#ff0000'], emojis: ['🍺','🥨','🎶','🎠','🎪'] },
    midautumn:      { colors: ['#ffd700','#ff8c00','#ff4500','#b8860b','#daa520'], emojis: ['🌕','🥮','🐰','🏮','🌙'] },
    spaceweek:      { colors: ['#000033','#191970','#4169e1','#ffd700','#ffffff'], emojis: ['🚀','⭐','🌙','👩‍🚀','🛸'] },
    dayofthedead:   { colors: ['#9400d3','#ff69b4','#ff4500','#ffd700','#ffffff'], emojis: ['💀','🌸','🕯️','🌺','🎭'] },
    bonfirenight:   { colors: ['#ff4500','#ff8c00','#ffd700','#ff0000','#000000'], emojis: ['🎆','🔥','✨','💥','🌟'] },
    diwali:         { colors: ['#ffd700','#ff4500','#ff8c00','#dc143c','#ffffff'], emojis: ['🪔','✨','🎆','🌟','🎊'] },
    remembrance:    { colors: ['#cc0000','#800000','#ff0000','#000000','#ffffff'], emojis: ['🌺','🕊️','💔','🎖️','🌹'] },
    boxingday:      { colors: ['#cc0000','#006600','#ffd700','#ffffff','#ff69b4'], emojis: ['🎁','🛍️','🎀','🎊','🎉'] },
    wintersolstice: { colors: ['#191970','#000033','#4169e1','#ffffff','#e8f4f8'], emojis: ['❄️','🌌','☃️','🌙','⭐'] },
    endofyear:      { colors: ['#ffd700','#ff4500','#ff69b4','#4169e1','#ffffff'], emojis: ['⏰','🎉','⌛','🎆','🎊'] }
};

function _getSeasonalOverride() {
    if (typeof _seaGetSeason !== 'function') return null;
    const season = _seaGetSeason();
    if (!season) return null;
    return SEA_CONFETTI_OVERRIDES[season] || null;
}

// ============================================================
// Main entry point — called from room.js on fresh consensus
// ============================================================
function triggerCelebration() {
    const s = getCelebrationSettings();
    if (typeof _isMobile !== 'undefined' && _isMobile && !s.mobileAnimations) return;
    let effective = s;
    if (s.seasonalTheme) {
        const override = _getSeasonalOverride();
        if (override) {
            effective = Object.assign({}, s, {
                confettiColors: override.colors,
                confettiEmojis: override.emojis,
                confettiUseThemeColors: false
            });
        }
    }
    if (effective.enableConfetti)  triggerConfetti(effective);
    if (effective.enableFireworks) triggerFireworks(effective);
    if (effective.enableBalloons)  triggerBalloons(effective);
}

// ============================================================
// Streak celebration — called from room.js when streak >= 3
// ============================================================
function triggerStreakCelebration(streak) {
    const s = getCelebrationSettings();
    if (!s.streakEnabled) return;
    _showStreakToast(streak);
    if (typeof confetti !== 'undefined') {
        const boost = Math.min(streak * 35, 250);
        confetti({ particleCount: boost, spread: 110, startVelocity: 45, origin: { x: 0.5, y: 0.35 },
                   colors: ['#ffd700','#ff6b6b','#00ff88','#00cfff','#ff69b4','#ffffff'] });
    }
    if (streak >= 5 && s.enableFireworks) {
        const FW = _getFireworksConstructor();
        if (FW) {
            const c = document.createElement('div');
            c.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9992;pointer-events:none;';
            document.body.appendChild(c);
            const fw = new FW(c, { particles: 90, intensity: 55, explosion: 9,
                                    hue: { min: 0, max: 360 }, delay: { min: 10, max: 20 } });
            fw.start();
            setTimeout(function() { try { fw.stop(); } catch(e) {} c.remove(); }, 2800);
        }
    }
}

// ============================================================
// The Finisher — full-screen overlay after N consecutive consensus
// ============================================================
var _FINISHER_TITLES = [
    ['SYNCHRONIZED ANNIHILATION', 'TEAM HIVEMIND', 'PERFECT HARMONY'],
    ['ABSOLUTE CONSENSUS', 'MIND MELD ACHIEVED', 'ONE BRAIN, ALL GLORY'],
    ['UNSTOPPABLE FORCE', 'BEYOND HUMAN COMPREHENSION', 'GODLIKE SYNC']
];

function _finisherTitle(streak) {
    var tier = streak <= 4 ? 0 : streak <= 6 ? 1 : 2;
    var pool = _FINISHER_TITLES[tier];
    return pool[Math.floor(Math.random() * pool.length)];
}

function _ensureFinisherStyles() {
    if (document.getElementById('finisher-anim-style')) return;
    var s = document.createElement('style');
    s.id = 'finisher-anim-style';
    s.textContent =
        '@keyframes finisher-in { from { opacity:0; transform:scale(1.06); } to { opacity:1; transform:none; } }' +
        '@keyframes finisher-content { from { opacity:0; transform:translateY(18px) scale(0.95); } to { opacity:1; transform:none; } }';
    document.head.appendChild(s);
}

function triggerFinisher(streak) {
    var s = getCelebrationSettings();
    if (!s.finisherEnabled) return;
    _ensureFinisherStyles();
    var existing = document.getElementById('finisher-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'finisher-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;display:flex;align-items:center;'
        + 'justify-content:center;background:rgba(0,0,0,0.82);backdrop-filter:blur(4px);'
        + 'cursor:pointer;animation:finisher-in 0.4s cubic-bezier(0.175,0.885,0.32,1.275) both;';
    var title = _finisherTitle(streak);
    overlay.innerHTML = '<div style="text-align:center;animation:finisher-content 0.5s 0.15s both;padding:0 24px;">'
        + '<div style="font-size:clamp(1.2rem,4vw,2.2rem);font-weight:900;letter-spacing:.06em;color:#fff;'
        + 'text-shadow:0 0 40px rgba(255,200,0,0.9),0 2px 8px rgba(0,0,0,0.8);margin-bottom:16px;'
        + 'text-transform:uppercase;">' + title + '</div>'
        + '<div style="font-size:clamp(3rem,12vw,7rem);line-height:1;margin-bottom:12px;">💥</div>'
        + '<div style="font-size:clamp(0.9rem,2.5vw,1.3rem);color:rgba(255,220,100,0.9);font-weight:700;'
        + 'letter-spacing:.12em;text-transform:uppercase;">' + streak + ' IN A ROW</div>'
        + '<div style="margin-top:24px;font-size:0.75rem;color:rgba(255,255,255,0.35);'
        + 'letter-spacing:.08em;">CLICK TO DISMISS</div>'
        + '</div>';
    overlay.onclick = function() { overlay.remove(); };
    document.body.appendChild(overlay);
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 4000);
}

function triggerCardBurst(originX, originY) {
    if (typeof confetti === 'undefined') return;
    confetti({
        particleCount: 18, spread: 55, startVelocity: 28, decay: 0.88,
        origin: { x: originX, y: originY },
        colors: ['#ffd700','#ff6b6b','#00ff88','#ffffff','#00cfff']
    });
}

// ============================================================
// Floor is Lava — called from room.js on non-consensus reveal
// ============================================================
var _lavaInterval = null;

function triggerFloorIsLava(connectionId, seconds) {
    var s = getCelebrationSettings();
    if (!s.lavaEnabled) return;
    stopFloorIsLava();

    var dur = s.lavaDuration || seconds || 30;
    var col = s.lavaColor || '#ff4500';
    document.documentElement.style.setProperty('--lava-color-primary', col);
    document.documentElement.style.setProperty('--lava-color-secondary', _lightenHex(col, 36));

    var card = document.querySelector('[data-connection-id="' + connectionId + '"]');
    if (card) card.classList.add('lava-outlier');

    var banner = document.createElement('div');
    banner.id = 'lava-banner';
    banner.innerHTML = '🌋 Floor is Lava! Outlier has <span id="lava-countdown">' + dur + '</span>s to reconsider…';
    Object.assign(banner.style, {
        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        background: 'linear-gradient(135deg,' + col + ',' + _lightenHex(col, 36) + ')',
        color: '#fff', padding: '8px 20px', borderRadius: '20px',
        fontWeight: '700', fontSize: '0.9rem', zIndex: '9990',
        boxShadow: '0 4px 16px rgba(255,69,0,0.5)',
        pointerEvents: 'none', whiteSpace: 'nowrap'
    });
    document.body.appendChild(banner);

    var remaining = dur;
    _lavaInterval = setInterval(function() {
        remaining--;
        var el = document.getElementById('lava-countdown');
        if (el) el.textContent = remaining;
        if (remaining <= 0) {
            stopFloorIsLava();
            if (typeof confetti !== 'undefined') {
                confetti({ particleCount: 70, spread: 85, startVelocity: 42, origin: { x: 0.5, y: 0.6 },
                           colors: ['#ff4500','#ff6b00','#ffd700','#ff0000','#ff8c00'] });
            }
        }
    }, 1000);
}

function stopFloorIsLava() {
    if (_lavaInterval) { clearInterval(_lavaInterval); _lavaInterval = null; }
    var banner = document.getElementById('lava-banner');
    if (banner) banner.remove();
    document.querySelectorAll('.lava-outlier').forEach(function(el) { el.classList.remove('lava-outlier'); });
}

function _showStreakToast(streak) {
    var existing = document.getElementById('es-streak-toast');
    if (existing) existing.remove();
    var labels = { 3: '🔥 TRIPLE CONSENSUS!', 4: '⚡ FOUR IN A ROW!', 5: '💎 GODLIKE CONSENSUS!',
                   6: '🚀 SIX IN A ROW!' };
    var label = labels[streak] || (streak + '🔥 IN A ROW!');
    var sub = streak >= 5 ? 'Your team is a well-oiled machine!' : 'Keep the momentum going!';
    var toast = document.createElement('div');
    toast.id = 'es-streak-toast';
    toast.innerHTML =
        '<div style="font-size:2.4rem;font-weight:900;letter-spacing:-1px;text-shadow:0 2px 12px rgba(0,0,0,0.6);">' + label + '</div>' +
        '<div style="font-size:1rem;margin-top:8px;opacity:0.85;">' + streak + ' consensus votes in a row 🎯</div>' +
        '<div style="font-size:0.88rem;margin-top:4px;opacity:0.7;">' + sub + '</div>';
    Object.assign(toast.style, {
        position:    'fixed',
        top:         '50%',
        left:        '50%',
        transform:   'translate(-50%, -50%) scale(0)',
        background:  'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border:      '2px solid #ffd700',
        borderRadius:'18px',
        padding:     '30px 44px',
        color:       '#ffd700',
        textAlign:   'center',
        zIndex:      '9995',
        boxShadow:   '0 8px 48px rgba(255,215,0,0.4), 0 0 0 4px rgba(255,215,0,0.12)',
        pointerEvents:'none',
        transition:  'transform 0.38s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(function() {
        requestAnimationFrame(function() { toast.style.transform = 'translate(-50%, -50%) scale(1)'; });
    });
    setTimeout(function() {
        toast.style.opacity  = '0';
        toast.style.transform = 'translate(-50%, -50%) scale(0.88)';
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 380);
    }, 2500);
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
    _celSet('cel-streak-enabled',      'checked', s.streakEnabled !== false);
    _celSet('cel-finisher-enabled',    'checked', s.finisherEnabled !== false);
    _celSet('cel-finisher-threshold',  'value',   s.finisherThreshold || DEFAULT_CELEBRATION.finisherThreshold);
    _celSet('cel-lava-enabled',        'checked', s.lavaEnabled !== false);
    _celSet('cel-lava-duration',     'value',   s.lavaDuration || DEFAULT_CELEBRATION.lavaDuration);
    _celSet('cel-lava-color',        'value',   s.lavaColor    || DEFAULT_CELEBRATION.lavaColor);
    var lavaSub = document.getElementById('cel-lava-sub');
    if (lavaSub) lavaSub.style.display = s.lavaEnabled !== false ? '' : 'none';
    _celSet('cel-poker-reveal',        'checked', s.pokerReveal        !== false);
    _celSet('cel-suspense-reveal',     'checked', s.suspenseReveal     !== false);
    _celSet('cel-suspense-speed',      'value',   s.suspenseSpeed      || 'normal');
    _celSet('cel-suspense-ordering',   'checked', s.suspenseOrdering   !== false);
    _celSet('cel-consensus-supernova', 'checked', s.consensusSupernova !== false);
    _celSet('cel-mobile-animations',   'checked', s.mobileAnimations   === true);
    _celSet('cel-speed-badges',        'checked', s.revealSpeedBadges  !== false);
    _celSet('cel-hot-cold',            'checked', s.revealHotCold      !== false);
    _celSet('cel-vote-dist',           'checked', s.revealVoteDist     !== false);
    _celSet('cel-reveal-particles',     'checked', s.revealParticles    !== false);
    _celSet('cel-reveal-particle-type', 'value',   s.revealParticleType || 'star');
    _celSet('cel-reveal-particle-count','value',   s.revealParticleCount || 8);
    var revPartSub = document.getElementById('cel-reveal-particles-sub');
    if (revPartSub) revPartSub.style.display = s.revealParticles !== false ? '' : 'none';

    _celSet('cel-seasonal-theme',    'checked', s.seasonalTheme !== false);
    _celSet('cel-seasonal-halloween',    'checked', s.seasonalHalloween    !== false);
    _celSet('cel-seasonal-christmas',    'checked', s.seasonalChristmas    !== false);
    _celSet('cel-seasonal-newyear',      'checked', s.seasonalNewYear      !== false);
    _celSet('cel-seasonal-valentine',    'checked', s.seasonalValentine    !== false);
    _celSet('cel-seasonal-spring',       'checked', s.seasonalSpring       !== false);
    _celSet('cel-seasonal-summer',       'checked', s.seasonalSummer       !== false);
    _celSet('cel-seasonal-autumn',       'checked', s.seasonalAutumn       !== false);
    _celSet('cel-seasonal-thanksgiving',  'checked', s.seasonalThanksgiving  !== false);
    _celSet('cel-seasonal-deepwinter',    'checked', s.seasonalDeepWinter    !== false);
    _celSet('cel-seasonal-lunarnew',      'checked', s.seasonalLunarNew      !== false);
    _celSet('cel-seasonal-awards',        'checked', s.seasonalAwards        !== false);
    _celSet('cel-seasonal-pancakeday',    'checked', s.seasonalPancakeDay    !== false);
    _celSet('cel-seasonal-piday',         'checked', s.seasonalPiDay         !== false);
    _celSet('cel-seasonal-stpatricks',    'checked', s.seasonalStPatricks    !== false);
    _celSet('cel-seasonal-holi',          'checked', s.seasonalHoli          !== false);
    _celSet('cel-seasonal-hanami',        'checked', s.seasonalHanami        !== false);
    _celSet('cel-seasonal-aprilfools',    'checked', s.seasonalAprilFools    !== false);
    _celSet('cel-seasonal-earthday',      'checked', s.seasonalEarthDay      !== false);
    _celSet('cel-seasonal-ramadan',       'checked', s.seasonalRamadan       !== false);
    _celSet('cel-seasonal-mayday',        'checked', s.seasonalMayDay        !== false);
    _celSet('cel-seasonal-starwarsday',   'checked', s.seasonalStarWarsDay   !== false);
    _celSet('cel-seasonal-pride',         'checked', s.seasonalPride         !== false);
    _celSet('cel-seasonal-oceanweek',     'checked', s.seasonalOceanWeek     !== false);
    _celSet('cel-seasonal-solstice',      'checked', s.seasonalSolstice      !== false);
    _celSet('cel-seasonal-independence',  'checked', s.seasonalIndependence  !== false);
    _celSet('cel-seasonal-tanabata',      'checked', s.seasonalTanabata      !== false);
    _celSet('cel-seasonal-bastille',      'checked', s.seasonalBastille      !== false);
    _celSet('cel-seasonal-augbankholiday','checked', s.seasonalAugBankHoliday!== false);
    _celSet('cel-seasonal-backtoschool',  'checked', s.seasonalBackToSchool  !== false);
    _celSet('cel-seasonal-oktoberfest',   'checked', s.seasonalOktoberfest   !== false);
    _celSet('cel-seasonal-midautumn',     'checked', s.seasonalMidAutumn     !== false);
    _celSet('cel-seasonal-spaceweek',     'checked', s.seasonalSpaceWeek     !== false);
    _celSet('cel-seasonal-dayofthedead',  'checked', s.seasonalDayOfDead     !== false);
    _celSet('cel-seasonal-bonfirenight',  'checked', s.seasonalBonfireNight  !== false);
    _celSet('cel-seasonal-diwali',        'checked', s.seasonalDiwali        !== false);
    _celSet('cel-seasonal-remembrance',   'checked', s.seasonalRemembrance   !== false);
    _celSet('cel-seasonal-boxingday',     'checked', s.seasonalBoxingDay     !== false);
    _celSet('cel-seasonal-wintersolstice','checked', s.seasonalWinterSolstice!== false);
    _celSet('cel-seasonal-endofyear',     'checked', s.seasonalEndOfYear     !== false);
    _celSet('cel-seasonal-mlkday',        'checked', s.seasonalMlkDay        !== false);
    _celSet('cel-seasonal-presidentsday', 'checked', s.seasonalPresidentsDay !== false);
    _celSet('cel-seasonal-memorialday',   'checked', s.seasonalMemorialDay   !== false);
    _celSet('cel-seasonal-juneteenth',    'checked', s.seasonalJuneteenth    !== false);
    _celSet('cel-seasonal-laborday',      'checked', s.seasonalLaborDay      !== false);
    _celSet('cel-seasonal-indigenousday', 'checked', s.seasonalIndigenousDay !== false);
    _celSet('cel-seasonal-veteransday',   'checked', s.seasonalVeteransDay   !== false);
    _celSet('cel-seasonal-mothersday',    'checked', s.seasonalMothersDay    !== false);
    _celSet('cel-seasonal-fathersday',    'checked', s.seasonalFathersDay    !== false);
    _celSet('cel-seasonal-motheringsunday','checked',s.seasonalMotheringSunday!== false);

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
        streakEnabled:          _celGet('cel-streak-enabled',       'checked') !== false,
        finisherEnabled:        _celGet('cel-finisher-enabled',    'checked') !== false,
        finisherThreshold:      _celGetInt('cel-finisher-threshold', DEFAULT_CELEBRATION.finisherThreshold),
        lavaEnabled:            _celGet('cel-lava-enabled',         'checked') !== false,
        lavaDuration:           _celGetInt('cel-lava-duration', DEFAULT_CELEBRATION.lavaDuration),
        pokerReveal:            _celGet('cel-poker-reveal',        'checked') !== false,
        suspenseReveal:         _celGet('cel-suspense-reveal',     'checked') !== false,
        suspenseSpeed:          _celGet('cel-suspense-speed',      'value')   || 'normal',
        suspenseOrdering:       _celGet('cel-suspense-ordering',   'checked') !== false,
        consensusSupernova:     _celGet('cel-consensus-supernova', 'checked') !== false,
        mobileAnimations:       _celGet('cel-mobile-animations',  'checked') === true,
        revealSpeedBadges:      _celGet('cel-speed-badges',   'checked') !== false,
        revealHotCold:          _celGet('cel-hot-cold',        'checked') !== false,
        revealVoteDist:         _celGet('cel-vote-dist',        'checked') !== false,
        revealParticles:        _celGet('cel-reveal-particles', 'checked') !== false,
        revealParticleType:     _celGet('cel-reveal-particle-type', 'value') || 'star',
        revealParticleCount:    _celGetInt('cel-reveal-particle-count', 8),
        lavaColor:              _celGet('cel-lava-color', 'value') || DEFAULT_CELEBRATION.lavaColor,
        seasonalTheme:          _celGet('cel-seasonal-theme',    'checked') !== false,
        seasonalHalloween:      _celGet('cel-seasonal-halloween',    'checked') !== false,
        seasonalChristmas:      _celGet('cel-seasonal-christmas',    'checked') !== false,
        seasonalNewYear:        _celGet('cel-seasonal-newyear',      'checked') !== false,
        seasonalValentine:      _celGet('cel-seasonal-valentine',    'checked') !== false,
        seasonalSpring:         _celGet('cel-seasonal-spring',       'checked') !== false,
        seasonalSummer:         _celGet('cel-seasonal-summer',       'checked') !== false,
        seasonalAutumn:         _celGet('cel-seasonal-autumn',       'checked') !== false,
        seasonalThanksgiving:    _celGet('cel-seasonal-thanksgiving',  'checked') !== false,
        seasonalDeepWinter:      _celGet('cel-seasonal-deepwinter',    'checked') !== false,
        seasonalLunarNew:        _celGet('cel-seasonal-lunarnew',      'checked') !== false,
        seasonalAwards:          _celGet('cel-seasonal-awards',        'checked') !== false,
        seasonalPancakeDay:      _celGet('cel-seasonal-pancakeday',    'checked') !== false,
        seasonalPiDay:           _celGet('cel-seasonal-piday',         'checked') !== false,
        seasonalStPatricks:      _celGet('cel-seasonal-stpatricks',    'checked') !== false,
        seasonalHoli:            _celGet('cel-seasonal-holi',          'checked') !== false,
        seasonalHanami:          _celGet('cel-seasonal-hanami',        'checked') !== false,
        seasonalAprilFools:      _celGet('cel-seasonal-aprilfools',    'checked') !== false,
        seasonalEarthDay:        _celGet('cel-seasonal-earthday',      'checked') !== false,
        seasonalRamadan:         _celGet('cel-seasonal-ramadan',       'checked') !== false,
        seasonalMayDay:          _celGet('cel-seasonal-mayday',        'checked') !== false,
        seasonalStarWarsDay:     _celGet('cel-seasonal-starwarsday',   'checked') !== false,
        seasonalPride:           _celGet('cel-seasonal-pride',         'checked') !== false,
        seasonalOceanWeek:       _celGet('cel-seasonal-oceanweek',     'checked') !== false,
        seasonalSolstice:        _celGet('cel-seasonal-solstice',      'checked') !== false,
        seasonalIndependence:    _celGet('cel-seasonal-independence',  'checked') !== false,
        seasonalTanabata:        _celGet('cel-seasonal-tanabata',      'checked') !== false,
        seasonalBastille:        _celGet('cel-seasonal-bastille',      'checked') !== false,
        seasonalAugBankHoliday:  _celGet('cel-seasonal-augbankholiday','checked') !== false,
        seasonalBackToSchool:    _celGet('cel-seasonal-backtoschool',  'checked') !== false,
        seasonalOktoberfest:     _celGet('cel-seasonal-oktoberfest',   'checked') !== false,
        seasonalMidAutumn:       _celGet('cel-seasonal-midautumn',     'checked') !== false,
        seasonalSpaceWeek:       _celGet('cel-seasonal-spaceweek',     'checked') !== false,
        seasonalDayOfDead:       _celGet('cel-seasonal-dayofthedead',  'checked') !== false,
        seasonalBonfireNight:    _celGet('cel-seasonal-bonfirenight',  'checked') !== false,
        seasonalDiwali:          _celGet('cel-seasonal-diwali',        'checked') !== false,
        seasonalRemembrance:     _celGet('cel-seasonal-remembrance',   'checked') !== false,
        seasonalBoxingDay:       _celGet('cel-seasonal-boxingday',     'checked') !== false,
        seasonalWinterSolstice:  _celGet('cel-seasonal-wintersolstice','checked') !== false,
        seasonalEndOfYear:       _celGet('cel-seasonal-endofyear',     'checked') !== false,
        seasonalMlkDay:          _celGet('cel-seasonal-mlkday',        'checked') !== false,
        seasonalPresidentsDay:   _celGet('cel-seasonal-presidentsday', 'checked') !== false,
        seasonalMemorialDay:     _celGet('cel-seasonal-memorialday',   'checked') !== false,
        seasonalJuneteenth:      _celGet('cel-seasonal-juneteenth',    'checked') !== false,
        seasonalLaborDay:        _celGet('cel-seasonal-laborday',      'checked') !== false,
        seasonalIndigenousDay:   _celGet('cel-seasonal-indigenousday', 'checked') !== false,
        seasonalVeteransDay:     _celGet('cel-seasonal-veteransday',   'checked') !== false,
        seasonalMothersDay:      _celGet('cel-seasonal-mothersday',    'checked') !== false,
        seasonalFathersDay:      _celGet('cel-seasonal-fathersday',    'checked') !== false,
        seasonalMotheringSunday: _celGet('cel-seasonal-motheringsunday','checked') !== false,
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
    stopCelebration();
    triggerCelebration();
}

function testConfetti()  { triggerConfetti(getCelebrationSettings()); }
function testFireworks() { stopFireworks(); triggerFireworks(getCelebrationSettings()); }
function testBalloons()  { stopBalloons();  triggerBalloons(getCelebrationSettings()); }
function testStreak()    { triggerStreakCelebration(5); }

function previewParticlesAt(el) {
    if (typeof confetti === 'undefined') return;
    var s = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
    var r = el.getBoundingClientRect();
    confetti({
        particleCount: s.revealParticleCount || 8,
        spread: 50,
        startVelocity: 18,
        decay: 0.88,
        origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
        shapes: [s.revealParticleType || 'star'],
        colors: ['#ffd700', '#ff6b6b', '#00ff88', '#ffffff', '#00cfff']
    });
}

function testRevealParticles() {
    var s = getCelebrationSettings();
    if (typeof confetti === 'undefined') return;
    confetti({
        particleCount: s.revealParticleCount || 8,
        spread: 50,
        startVelocity: 18,
        decay: 0.88,
        origin: { x: 0.5, y: 0.5 },
        shapes: [s.revealParticleType || 'star'],
        colors: ['#ffd700', '#ff6b6b', '#00ff88', '#ffffff', '#00cfff']
    });
}

function testPokerReveal() {
    var badges = document.querySelectorAll('.participant-badge[data-connection-id]');
    if (!badges.length) {
        var demo = document.createElement('div');
        demo.className = 'participant-badge voted';
        demo.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
            + 'z-index:2000;font-size:2rem;padding:20px 32px;';
        demo.innerHTML = '<span class="participant-vote">8</span>';
        document.body.appendChild(demo);
        setTimeout(function() { demo.classList.add('poker-flip'); }, 100);
        setTimeout(function() { demo.remove(); }, 1500);
        return;
    }
    badges.forEach(function(badge, i) {
        setTimeout(function() {
            badge.classList.add('poker-flip');
            setTimeout(function() { badge.classList.remove('poker-flip'); }, 450);
        }, i * 380);
    });
}

function testFloorIsLava() {
    var badge = document.querySelector('[data-connection-id]');
    var fakeId = badge ? (badge.dataset.connectionId || '__test__') : '__test__';
    if (!badge) {
        badge = document.createElement('div');
        badge.dataset.connectionId = '__test__';
        badge.style.cssText = 'position:fixed;bottom:200px;left:50%;transform:translateX(-50%);' +
            'padding:8px 18px;border:2px solid #dee2e6;border-radius:8px;background:#fff;' +
            'z-index:9989;pointer-events:none;font-weight:700;';
        badge.textContent = '🧪 Test Participant';
        document.body.appendChild(badge);
        setTimeout(function() { badge.remove(); }, 36000);
    }
    triggerFloorIsLava(fakeId);
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

function _seaSelectAll(checked) {
    document.querySelectorAll('.sea-check').forEach(function(el) { el.checked = checked; });
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

// ============================================================
// Consensus Supernova
// ============================================================
function triggerConsensusSupernova() {
    var existing = document.getElementById('consensusSupernova');
    if (existing) existing.remove();

    // Triple confetti burst
    if (typeof confetti !== 'undefined') {
        confetti({ particleCount: 180, spread: 120, startVelocity: 50, origin: { x: 0.5, y: 0.6 } });
        setTimeout(function() {
            confetti({ particleCount: 100, spread: 160, startVelocity: 35, angle: 60,  origin: { x: 0, y: 0.6 } });
            confetti({ particleCount: 100, spread: 160, startVelocity: 35, angle: 120, origin: { x: 1, y: 0.6 } });
        }, 250);
    }

    var el = document.createElement('div');
    el.id = 'consensusSupernova';
    el.innerHTML = '<div class="supernova-text">✨ CONSENSUS ✨</div>';
    document.body.appendChild(el);

    _playSupernovaSound();

    setTimeout(function() {
        var txt = el.querySelector('.supernova-text');
        if (txt) txt.classList.add('supernova-fade-out');
        setTimeout(function() { el.remove(); }, 500);
    }, 2200);
}

function testConsensusSupernova() { triggerConsensusSupernova(); }

function _playSupernovaSound() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
        notes.forEach(function(freq, i) {
            var osc  = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            var t = ctx.currentTime + i * 0.13;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
            osc.start(t);
            osc.stop(t + 0.7);
        });
    } catch(e) {}
}

