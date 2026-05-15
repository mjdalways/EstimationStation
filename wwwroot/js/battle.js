// ════════════════════════════════════════════════════════════════
// battle.js — Avatar Battle Arena
// ════════════════════════════════════════════════════════════════

// ── Settings ───────────────────────────────────────────────────
var BATTLE_SETTINGS_KEY = 'es_battleSettings';
var DEFAULT_BATTLE_SETTINGS = {
    enabled: true,
    speed: 'normal',
    trigger: 'outlier',
    outcome: 'majority',  // majority | random | higher | lower | chaos
    rounds: 2,            // 1 | 2 | 3
    dismissDelay: 3400    // ms (real-world, not speed-scaled)
};

function getBattleSettings() {
    try {
        var raw = localStorage.getItem(BATTLE_SETTINGS_KEY);
        return Object.assign({}, DEFAULT_BATTLE_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) { return Object.assign({}, DEFAULT_BATTLE_SETTINGS); }
}
function saveBattleSettings(s) { localStorage.setItem(BATTLE_SETTINGS_KEY, JSON.stringify(s)); }

function populateBattleSection() {
    var s = getBattleSettings();
    var enabledEl = document.getElementById('battle-enabled');
    if (enabledEl) enabledEl.checked = !!s.enabled;
    document.querySelectorAll('[data-battle-speed]').forEach(function(btn) {
        var active = btn.dataset.battleSpeed === (s.speed || 'normal');
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-secondary', !active);
    });
    document.querySelectorAll('[data-battle-rounds]').forEach(function(btn) {
        var active = String(btn.dataset.battleRounds) === String(s.rounds || 2);
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-secondary', !active);
    });
    var triggerEl = document.getElementById('battle-trigger');
    if (triggerEl) triggerEl.value = s.trigger || 'outlier';
    var outcomeEl = document.getElementById('battle-outcome');
    if (outcomeEl) outcomeEl.value = s.outcome || 'majority';
    var dismissEl = document.getElementById('battle-dismiss');
    if (dismissEl) {
        dismissEl.value = Math.round((s.dismissDelay || 3400) / 1000);
        var valEl = document.getElementById('battle-dismiss-val');
        if (valEl) valEl.textContent = dismissEl.value + 's';
    }
    _baUpdateOptionsVisibility();
}

function _baUpdateOptionsVisibility() {
    var s = getBattleSettings();
    var wrap = document.getElementById('battle-options-wrap');
    if (wrap) wrap.style.display = s.enabled ? '' : 'none';
}

function saveBattleFromForm() {
    var s = Object.assign({}, getBattleSettings());
    var enabledEl = document.getElementById('battle-enabled');
    if (enabledEl) s.enabled = enabledEl.checked;
    var triggerEl = document.getElementById('battle-trigger');
    if (triggerEl) s.trigger = triggerEl.value;
    var outcomeEl = document.getElementById('battle-outcome');
    if (outcomeEl) s.outcome = outcomeEl.value;
    var dismissEl = document.getElementById('battle-dismiss');
    if (dismissEl) s.dismissDelay = parseInt(dismissEl.value, 10) * 1000;
    saveBattleSettings(s);
    _baUpdateOptionsVisibility();
}

function setBattleRounds(n) {
    var s = getBattleSettings();
    s.rounds = parseInt(n, 10);
    saveBattleSettings(s);
    document.querySelectorAll('[data-battle-rounds]').forEach(function(btn) {
        var active = String(btn.dataset.battleRounds) === String(n);
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-secondary', !active);
    });
}

function setBattleSpeed(speed) {
    var s = getBattleSettings();
    s.speed = speed;
    saveBattleSettings(s);
    document.querySelectorAll('[data-battle-speed]').forEach(function(btn) {
        var active = btn.dataset.battleSpeed === speed;
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-secondary', !active);
    });
}

// ── Timing ─────────────────────────────────────────────────────
var _BA_SPEED_MULT = { slow: 2.2, normal: 1.0, fast: 0.35 };

function _baDelay(ms) {
    var mult = _BA_SPEED_MULT[getBattleSettings().speed] || 1.0;
    return new Promise(function(resolve) { setTimeout(resolve, ms * mult); });
}
function _baDelayRaw(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ── Weapon registry ─────────────────────────────────────────────
// SVGs are drawn centered at (0,0), pointing upward (negative y = toward tip).
var _BA_WEAPONS = [
    {
        id: 'mug', label: 'Coffee Mug', minVote: -99,
        svg: '<rect x="-9" y="-18" width="18" height="16" rx="3" fill="#fff" stroke="#ccc" stroke-width="1"/>' +
             '<path d="M9,-15 Q18,-15 18,-10 Q18,-5 9,-5" fill="none" stroke="#bbb" stroke-width="2.5" stroke-linecap="round"/>' +
             '<rect x="-7" y="-15" width="14" height="5" rx="1" fill="#5D3317"/>' +
             '<path d="M-5,-19 Q-3,-26 -5,-32" stroke="rgba(210,210,210,0.7)" stroke-width="1.5" stroke-linecap="round" fill="none"/>' +
             '<path d="M0,-19 Q2,-26 0,-32" stroke="rgba(210,210,210,0.7)" stroke-width="1.5" stroke-linecap="round" fill="none"/>' +
             '<path d="M5,-19 Q7,-26 5,-32" stroke="rgba(210,210,210,0.7)" stroke-width="1.5" stroke-linecap="round" fill="none"/>'
    },
    {
        id: 'dagger', label: 'Dagger', minVote: 0,
        svg: '<path d="M-3.5,5 L-3.5,-22 L0,-30 L3.5,-22 L3.5,5 Z" fill="#c8c8c8" stroke="#888" stroke-width="0.5"/>' +
             '<rect x="-7" y="2" width="14" height="5" rx="2" fill="#DAA520" stroke="#b8860b" stroke-width="0.5"/>' +
             '<rect x="-4.5" y="7" width="9" height="12" rx="2.5" fill="#7B3F00"/>'
    },
    {
        id: 'shortsword', label: 'Short Sword', minVote: 2,
        svg: '<path d="M-3,6 L-3,-30 L0,-40 L3,-30 L3,6 Z" fill="#d2d2d2" stroke="#999" stroke-width="0.5"/>' +
             '<line x1="-3" y1="-14" x2="3" y2="-14" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>' +
             '<rect x="-10" y="2" width="20" height="5" rx="2.5" fill="#DAA520" stroke="#b8860b" stroke-width="0.5"/>' +
             '<rect x="-4" y="7" width="8" height="13" rx="2.5" fill="#5D2E0C"/>'
    },
    {
        id: 'sword', label: 'Broadsword', minVote: 4,
        svg: '<path d="M-4,7 L-4,-36 L0,-48 L4,-36 L4,7 Z" fill="#dcdcdc" stroke="#aaa" stroke-width="0.5"/>' +
             '<path d="M-4,-32 L-15,-24 L-14,-20 L-4,-28 Z" fill="#c0c0c0" stroke="#999" stroke-width="0.3"/>' +
             '<path d="M4,-32 L15,-24 L14,-20 L4,-28 Z" fill="#c0c0c0" stroke="#999" stroke-width="0.3"/>' +
             '<line x1="-4" y1="-18" x2="4" y2="-18" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>' +
             '<rect x="-13" y="3" width="26" height="5.5" rx="3" fill="#B8860B" stroke="#996000" stroke-width="0.5"/>' +
             '<rect x="-5" y="9" width="10" height="15" rx="3" fill="#4A1E00"/>'
    },
    {
        id: 'axe', label: 'Battle Axe', minVote: 6,
        svg: '<rect x="-3.5" y="-44" width="7" height="52" rx="3.5" fill="#6B3A0B" stroke="#4a2800" stroke-width="0.5"/>' +
             '<path d="M0,-36 L-22,-20 L-19,-10 L0,-19 Z" fill="#8a8a8a" stroke="#666" stroke-width="0.5"/>' +
             '<path d="M0,-36 L16,-12 L14,-5 L0,-19 Z" fill="#aaa" stroke="#888" stroke-width="0.5"/>' +
             '<circle cx="0" cy="-36" r="3.5" fill="#888" stroke="#666" stroke-width="0.5"/>'
    },
    {
        id: 'hammer', label: 'Warhammer', minVote: 10,
        svg: '<rect x="-3.5" y="-46" width="7" height="55" rx="3.5" fill="#2E1503" stroke="#1a0b00" stroke-width="0.5"/>' +
             '<rect x="-15" y="-47" width="30" height="18" rx="4" fill="#555" stroke="#333" stroke-width="0.5"/>' +
             '<rect x="-17" y="-43" width="34" height="9" rx="2.5" fill="#777"/>' +
             '<rect x="-17" y="-35" width="34" height="3" rx="1.5" fill="#999"/>' +
             '<rect x="-6" y="-47" width="12" height="3" rx="1.5" fill="#888"/>'
    },
    {
        id: 'trident', label: 'Trident', minVote: 16,
        svg: '<rect x="-3" y="-44" width="6" height="52" rx="3" fill="#8B7355" stroke="#6a5030" stroke-width="0.5"/>' +
             '<line x1="-10" y1="-28" x2="-10" y2="-48" stroke="#b8c0d8" stroke-width="4.5" stroke-linecap="round"/>' +
             '<line x1="0" y1="-22" x2="0" y2="-50" stroke="#ccd0e8" stroke-width="4.5" stroke-linecap="round"/>' +
             '<line x1="10" y1="-28" x2="10" y2="-48" stroke="#b8c0d8" stroke-width="4.5" stroke-linecap="round"/>' +
             '<line x1="-10" y1="-28" x2="10" y2="-28" stroke="#b0b8d0" stroke-width="2.5"/>'
    },
    {
        id: 'cannon', label: 'Dev Cannon', minVote: 30,
        svg: '<rect x="-4.5" y="-46" width="9" height="52" rx="4.5" fill="#e74c3c" stroke="#c0392b" stroke-width="0.5"/>' +
             '<path d="M-4.5,-46 L0,-58 L4.5,-46 Z" fill="#c0392b"/>' +
             '<rect x="-8" y="-16" width="16" height="4.5" rx="1.5" fill="#c0392b"/>' +
             '<path d="M-4.5,-12 L-12,-3 L-4.5,-7 Z" fill="#c0392b"/>' +
             '<path d="M4.5,-12 L12,-3 L4.5,-7 Z" fill="#c0392b"/>' +
             '<circle cx="0" cy="-53" r="5" fill="#f39c12" stroke="#e67e22" stroke-width="0.5"/>'
    },
    {
        id: 'gauntlet', label: 'Infinity Gauntlet', minVote: 50,
        svg: '<rect x="-9" y="-14" width="18" height="22" rx="5" fill="#DAA520" stroke="#b8860b" stroke-width="0.5"/>' +
             '<rect x="-11" y="-32" width="22" height="20" rx="4" fill="#FFD700" stroke="#DAA520" stroke-width="0.5"/>' +
             '<circle cx="-5" cy="-26" r="4.5" fill="#E74C3C" stroke="#c0392b" stroke-width="0.5"/>' +
             '<circle cx="5" cy="-26" r="4.5" fill="#2E86AB" stroke="#1a6e94" stroke-width="0.5"/>' +
             '<circle cx="0" cy="-36" r="4.5" fill="#1DB954" stroke="#18a047" stroke-width="0.5"/>' +
             '<circle cx="-9" cy="-32" r="3.5" fill="#9B59B6" stroke="#7d3f98" stroke-width="0.5"/>' +
             '<circle cx="9" cy="-32" r="3.5" fill="#F39C12" stroke="#d68910" stroke-width="0.5"/>'
    },
    {
        id: 'question', label: 'Mystery Weapon', minVote: -100,
        svg: '<text x="0" y="-8" text-anchor="middle" font-size="32" fill="#fff" font-weight="900" ' +
             'stroke="rgba(0,0,0,0.6)" stroke-width="2" paint-order="stroke" font-family="sans-serif">?</text>' +
             '<rect x="-5.5" y="3" width="11" height="9" rx="2.5" fill="#fff" opacity="0.85"/>'
    }
];

function _baGetWeapon(voteStr) {
    if (!voteStr || voteStr === '?' || voteStr === '∞') {
        return _BA_WEAPONS.find(function(w) { return w.id === 'question'; });
    }
    if (voteStr === '½' || voteStr === '0.5' || voteStr === '☕') {
        return _BA_WEAPONS.find(function(w) { return w.id === 'mug'; });
    }
    var num = parseFloat(voteStr);
    if (isNaN(num)) return _BA_WEAPONS.find(function(w) { return w.id === 'dagger'; });
    var best = _BA_WEAPONS.find(function(w) { return w.id === 'dagger'; });
    for (var i = 0; i < _BA_WEAPONS.length; i++) {
        if (_BA_WEAPONS[i].minVote >= 0 && num >= _BA_WEAPONS[i].minVote) {
            best = _BA_WEAPONS[i];
        }
    }
    return best;
}

// ── Fighter color palettes ──────────────────────────────────────
var _BA_PALETTES = [
    { torso: '#1d4ed8', pants: '#1e3a8a', boot: '#172554', skin: '#f5c5a3' },
    { torso: '#15803d', pants: '#14532d', boot: '#052e16', skin: '#f5c5a3' },
    { torso: '#7e22ce', pants: '#581c87', boot: '#3b0764', skin: '#fcd5b0' },
    { torso: '#b91c1c', pants: '#7f1d1d', boot: '#450a0a', skin: '#f5c5a3' },
    { torso: '#b45309', pants: '#78350f', boot: '#451a03', skin: '#fcd5b0' },
    { torso: '#0e7490', pants: '#164e63', boot: '#083344', skin: '#f5c5a3' },
    { torso: '#be185d', pants: '#831843', boot: '#500724', skin: '#fcd5b0' },
    { torso: '#374151', pants: '#1f2937', boot: '#111827', skin: '#f5c5a3' },
];

// ── Fighter SVG builder ─────────────────────────────────────────
var _baSvgUid = 0;

function _baBuildFighterSVG(participant, weapon, paletteIndex) {
    var uid = 'bf' + (++_baSvgUid);
    var pal = _BA_PALETTES[(paletteIndex || 0) % _BA_PALETTES.length];
    var avatarUrl = typeof avatarDataToUrl === 'function' ? avatarDataToUrl(participant.avatarData, 56) : null;
    var initials = typeof getInitials === 'function'
        ? getInitials(participant.name)
        : (participant.name || '?').slice(0, 2).toUpperCase();
    var headColor = typeof colorFromName === 'function' ? colorFromName(participant.name) : '#374151';

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 200');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '200');
    svg.setAttribute('class', 'bf-svg');

    svg.innerHTML =
        // Ground shadow
        '<ellipse cx="50" cy="193" rx="27" ry="7" fill="rgba(0,0,0,0.22)"/>' +

        // ── Legs (drawn first, behind torso) ──
        '<g class="bf-leg-l">' +
          '<line x1="42" y1="116" x2="29" y2="170" stroke="' + pal.pants + '" stroke-width="13" stroke-linecap="round"/>' +
          '<ellipse cx="26" cy="172" rx="13" ry="7.5" fill="' + pal.boot + '"/>' +
        '</g>' +
        '<g class="bf-leg-r">' +
          '<line x1="58" y1="116" x2="71" y2="170" stroke="' + pal.pants + '" stroke-width="13" stroke-linecap="round"/>' +
          '<ellipse cx="74" cy="172" rx="13" ry="7.5" fill="' + pal.boot + '"/>' +
        '</g>' +

        // ── Torso ──
        '<g class="bf-torso">' +
          '<rect x="27" y="56" width="46" height="62" rx="9" fill="' + pal.torso + '"/>' +
          // Belt
          '<rect x="27" y="110" width="46" height="8" rx="2.5" fill="rgba(0,0,0,0.35)"/>' +
          // Belt buckle
          '<rect x="45" y="111" width="10" height="6" rx="1.5" fill="rgba(255,215,0,0.45)"/>' +
          // Chest highlight
          '<rect x="38" y="63" width="24" height="3.5" rx="1.5" fill="rgba(255,255,255,0.22)"/>' +
        '</g>' +

        // ── Left arm (shield / passive) ──
        '<g class="bf-arm-l">' +
          '<line x1="30" y1="62" x2="11" y2="102" stroke="' + pal.skin + '" stroke-width="11" stroke-linecap="round"/>' +
          '<circle cx="10" cy="103" r="7.5" fill="' + pal.skin + '"/>' +
        '</g>' +

        // ── Right arm (weapon arm) ──
        '<g class="bf-arm-r">' +
          '<line x1="70" y1="62" x2="89" y2="86" stroke="' + pal.skin + '" stroke-width="11" stroke-linecap="round"/>' +
          '<circle cx="90" cy="87" r="7.5" fill="' + pal.skin + '"/>' +
          // Weapon attached to fist
          '<g class="bf-weapon" transform="translate(90,80) rotate(-12)">' +
            (weapon ? weapon.svg : '') +
          '</g>' +
        '</g>' +

        // ── Head ──
        '<defs>' +
          '<clipPath id="hc-' + uid + '"><circle cx="50" cy="30" r="24"/></clipPath>' +
        '</defs>' +
        // Head fill (initials background — shown when no avatar)
        '<circle id="hfill-' + uid + '" cx="50" cy="30" r="24" fill="' + headColor + '"' +
          (avatarUrl ? ' style="display:none"' : '') + '/>' +
        '<text id="htext-' + uid + '" x="50" y="38" text-anchor="middle" font-size="15" font-weight="700" ' +
          'fill="white" font-family="sans-serif"' + (avatarUrl ? ' style="display:none"' : '') + '>' + initials + '</text>' +
        // Avatar image
        '<image id="himg-' + uid + '" href="' + (avatarUrl || '') + '" x="26" y="6" width="48" height="48" ' +
          'clip-path="url(#hc-' + uid + ')" preserveAspectRatio="xMidYMid slice"' +
          (!avatarUrl ? ' style="display:none"' : '') + '/>' +
        // Head ring
        '<circle cx="50" cy="30" r="24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>' +
        // Weapon name label (small, below feet)
        '<text x="50" y="199" text-anchor="middle" font-size="6" fill="rgba(255,215,0,0.65)" font-family="sans-serif">' +
          (weapon ? weapon.label : '') +
        '</text>';

    // Fallback if avatar image fails to load
    if (avatarUrl) {
        var imgEl = svg.querySelector('#himg-' + uid);
        if (imgEl) {
            imgEl.addEventListener('error', function() {
                var fillEl = svg.querySelector('#hfill-' + uid);
                var textEl = svg.querySelector('#htext-' + uid);
                imgEl.style.display = 'none';
                if (fillEl) fillEl.removeAttribute('style');
                if (textEl) textEl.removeAttribute('style');
            });
        }
    }

    return svg;
}

// ── Arena DOM helpers ───────────────────────────────────────────

function _baShow() {
    var arena = document.getElementById('battle-arena');
    if (!arena) return;
    arena.style.display = 'flex';
    // Double rAF ensures CSS transition fires after display:flex
    requestAnimationFrame(function() {
        requestAnimationFrame(function() { arena.classList.add('ba-visible'); });
    });
}

function _baHide() {
    var arena = document.getElementById('battle-arena');
    if (!arena) return;
    arena.classList.remove('ba-visible');
    setTimeout(function() {
        arena.style.display = 'none';
        // Reset state
        _baSetState('left', '');
        _baSetState('right', '');
        var lEl = document.getElementById('ba-fighter-left');
        var rEl = document.getElementById('ba-fighter-right');
        if (lEl) lEl.classList.remove('ba-entered');
        if (rEl) rEl.classList.remove('ba-entered');
        var vsEl = document.getElementById('ba-vs-screen');
        if (vsEl) vsEl.classList.remove('ba-vs-visible');
        var bannerEl = document.getElementById('ba-winner-banner');
        if (bannerEl) bannerEl.classList.remove('ba-banner-visible');
        var annEl = document.getElementById('ba-ann-text');
        if (annEl) annEl.classList.remove('ba-ann-visible', 'ba-ann-hide');
    }, 460);
}

function _baSetState(side, state) {
    var el = document.getElementById('ba-fighter-' + side);
    if (!el) return;
    el.classList.remove('ba-state-idle', 'ba-state-attack', 'ba-state-hurt', 'ba-state-victory', 'ba-state-defeat');
    if (state) el.classList.add('ba-state-' + state);
}

function _baSetHP(side, pct) {
    var bar = document.getElementById('ba-hp-' + side);
    if (!bar) return;
    pct = Math.max(0, Math.min(100, pct));
    bar.style.width = pct + '%';
    bar.classList.toggle('ba-hp-low', pct <= 25);
}

function _baSetFighterInfo(side, name, vote) {
    var nameEl = document.getElementById('ba-name-' + side);
    var voteEl = document.getElementById('ba-vote-' + side);
    if (nameEl) nameEl.textContent = name || '';
    if (voteEl) voteEl.textContent = (vote !== null && vote !== undefined) ? vote : '';
}

function _baShowHit(side, damage) {
    var stage = document.getElementById('ba-stage');
    var fighterEl = document.getElementById('ba-fighter-' + side);
    if (!stage || !fighterEl) return;

    var sRect = stage.getBoundingClientRect();
    var fRect = fighterEl.getBoundingClientRect();
    var cx = fRect.left - sRect.left + fRect.width / 2;
    var cy = fRect.top  - sRect.top  + fRect.height * 0.4;

    // Damage number
    var num = document.createElement('div');
    num.className = 'ba-damage-num';
    num.textContent = '-' + Math.round(damage);
    num.style.left = cx + 'px';
    num.style.top  = cy + 'px';
    stage.appendChild(num);
    setTimeout(function() { if (num.parentNode) num.parentNode.removeChild(num); }, 900);

    // Star burst
    var burst = document.createElement('div');
    burst.className = 'ba-hit-effect ba-hit-star';
    burst.style.left = cx + 'px';
    burst.style.top  = cy + 'px';
    burst.innerHTML = _baBurstSvg();
    stage.appendChild(burst);
    setTimeout(function() { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 450);
}

function _baBurstSvg() {
    var rays = 10;
    var lines = '';
    var colors = ['#ff6b35', '#ffd700', '#ff4757', '#fff'];
    for (var i = 0; i < rays; i++) {
        var ang = (i / rays) * 2 * Math.PI;
        var len = 10 + Math.floor(Math.random() * 14);
        var x2 = (Math.cos(ang) * len).toFixed(1);
        var y2 = (Math.sin(ang) * len).toFixed(1);
        var col = colors[i % colors.length];
        lines += '<line x1="0" y1="0" x2="' + x2 + '" y2="' + y2 +
                 '" stroke="' + col + '" stroke-width="3" stroke-linecap="round"/>';
    }
    return '<svg width="64" height="64" viewBox="-32 -32 64 64">' + lines + '</svg>';
}

function _baShowAnnounce(text, color) {
    var el = document.getElementById('ba-ann-text');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '#fff';
    el.style.textShadow = '0 0 24px ' + (color || '#fff');
    el.classList.remove('ba-ann-hide');
    requestAnimationFrame(function() { el.classList.add('ba-ann-visible'); });
}

function _baHideAnnounce() {
    var el = document.getElementById('ba-ann-text');
    if (!el) return;
    el.classList.remove('ba-ann-visible');
    el.classList.add('ba-ann-hide');
}

function _baShowVS() {
    var el = document.getElementById('ba-vs-screen');
    if (el) el.classList.add('ba-vs-visible');
}
function _baHideVS() {
    var el = document.getElementById('ba-vs-screen');
    if (el) el.classList.remove('ba-vs-visible');
}

function _baShowWinner(name) {
    var banner = document.getElementById('ba-winner-banner');
    if (!banner) return;
    var nameEl = document.getElementById('ba-winner-name');
    if (nameEl) nameEl.textContent = name;
    banner.classList.add('ba-banner-visible');
}

function _baParseVote(v) {
    if (!v) return 0;
    if (v === '½' || v === '0.5') return 0.5;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

// ── Fight sequence (async) ──────────────────────────────────────
var _baActive = false;
var _baSkipped = false;

async function _baRunSequence(leftData, rightData, leftPalIdx, rightPalIdx) {
    _baActive = true;
    _baSkipped = false;

    var leftWeapon  = _baGetWeapon(leftData.vote);
    var rightWeapon = _baGetWeapon(rightData.vote);

    // HUD info
    _baSetFighterInfo('left',  leftData.name,  leftData.vote);
    _baSetFighterInfo('right', rightData.name, rightData.vote);
    _baSetHP('left', 100);
    _baSetHP('right', 100);

    // Build fighters
    var leftEl  = document.getElementById('ba-fighter-left');
    var rightEl = document.getElementById('ba-fighter-right');
    if (!leftEl || !rightEl) { _baActive = false; return; }
    leftEl.innerHTML  = '';
    rightEl.innerHTML = '';
    leftEl.classList.remove('ba-entered');
    rightEl.classList.remove('ba-entered');
    leftEl.appendChild(_baBuildFighterSVG(leftData,  leftWeapon,  leftPalIdx  || 0));
    rightEl.appendChild(_baBuildFighterSVG(rightData, rightWeapon, rightPalIdx || 1));

    // Show arena
    _baShow();
    await _baDelay(500);
    if (_baSkipped) { _baFinish(); return; }

    // Phase 1 — Entry
    leftEl.classList.add('ba-entered');
    await _baDelay(380);
    rightEl.classList.add('ba-entered');
    await _baDelay(720);
    if (_baSkipped) { _baFinish(); return; }

    _baSetState('left',  'idle');
    _baSetState('right', 'idle');
    await _baDelay(350);

    // Phase 2 — VS screen
    _baShowAnnounce('VS', '#ff6b35');
    _baShowVS();
    await _baDelay(1100);
    _baHideAnnounce();
    _baHideVS();
    await _baDelay(380);
    if (_baSkipped) { _baFinish(); return; }

    // Resolve winner from outcome setting
    var s = getBattleSettings();
    var outcome = s.outcome || 'majority';
    var rightWins;
    if (outcome === 'random') {
        rightWins = Math.random() < 0.5;
    } else if (outcome === 'higher') {
        rightWins = _baParseVote(rightData.vote) >= _baParseVote(leftData.vote);
    } else if (outcome === 'lower') {
        rightWins = _baParseVote(rightData.vote) <= _baParseVote(leftData.vote);
    } else if (outcome === 'chaos') {
        rightWins = false; // left (outlier / lower vote) always wins
    } else {
        rightWins = !!rightData.isMajority; // majority (default)
    }

    // Exchange rounds — damage spread evenly so HP stays > 0 until final blow
    var numExchanges = s.rounds >= 3 ? 2 : (s.rounds <= 1 ? 0 : 1);
    var leftHP = 100, rightHP = 100;
    // Per-exchange damage: loser takes more than winner; total leaves ~30 HP for loser at final blow
    var loseDmg = numExchanges > 0 ? Math.floor(55 / numExchanges) : 0;
    var winDmg  = numExchanges > 0 ? Math.floor(25 / numExchanges) : 0;

    for (var r = 0; r < numExchanges; r++) {
        if (r > 0) {
            _baShowAnnounce('ROUND ' + (r + 1) + '!', '#ff6b35');
            await _baDelay(600);
            _baHideAnnounce();
            await _baDelay(200);
            if (_baSkipped) { _baFinish(); return; }
        }

        // Left attacks right
        _baSetState('left', 'attack');
        await _baDelay(280);
        var dmgToRight = rightWins ? winDmg : loseDmg;
        _baShowHit('right', dmgToRight);
        _baSetState('right', 'hurt');
        rightHP -= dmgToRight;
        _baSetHP('right', rightHP);
        await _baDelay(620);
        if (_baSkipped) { _baFinish(); return; }
        _baSetState('left',  'idle');
        _baSetState('right', 'idle');
        await _baDelay(480);

        // Right attacks left
        _baSetState('right', 'attack');
        await _baDelay(280);
        var dmgToLeft = rightWins ? loseDmg : winDmg;
        _baShowHit('left', dmgToLeft);
        _baSetState('left', 'hurt');
        leftHP -= dmgToLeft;
        _baSetHP('left', leftHP);
        await _baDelay(620);
        if (_baSkipped) { _baFinish(); return; }
        _baSetState('right', 'idle');
        _baSetState('left',  'idle');
        await _baDelay(480);
    }

    // Phase 3 — Final blow
    _baShowAnnounce('FINAL BLOW!', '#ffd700');
    await _baDelay(750);
    _baHideAnnounce();
    await _baDelay(280);
    if (_baSkipped) { _baFinish(); return; }

    var winSide  = rightWins ? 'right' : 'left';
    var loseSide = rightWins ? 'left'  : 'right';
    var winData  = rightWins ? rightData : leftData;

    _baSetState(winSide, 'attack');
    await _baDelay(320);
    var finalDmg = rightWins ? leftHP : rightHP;
    _baShowHit(loseSide, finalDmg);
    _baSetState(loseSide, 'defeat');
    if (rightWins) { leftHP  = 0; _baSetHP('left',  0); }
    else           { rightHP = 0; _baSetHP('right', 0); }
    await _baDelay(480);
    if (_baSkipped) { _baFinish(); return; }
    _baSetState(winSide, 'victory');

    // Phase 4 — Victory
    await _baDelay(580);
    _baShowAnnounce(winData.name + ' WINS!', '#ffd700');
    _baShowWinner(winData.name);

    // Auto-dismiss — raw (not speed-scaled) so the setting feels predictable
    await _baDelayRaw(s.dismissDelay || 3400);
    _baHide();
    _baActive = false;
}

function _baFinish() {
    _baHide();
    _baActive = false;
}

// ── Main entry point ────────────────────────────────────────────
function triggerBattle(votes, stats) {
    var settings = getBattleSettings();
    if (!settings.enabled) return;
    if (_baActive) return;
    if (settings.trigger === 'outlier' && !stats.shameParticipantId) return;
    if (typeof roomState === 'undefined') return;

    // Collect voters: non-observers who cast a vote
    var voters = roomState.participants.filter(function(p) {
        return !p.isObserver && p.vote && votes[p.connectionId] !== undefined;
    });
    if (voters.length < 2) return;

    var leftData, rightData;

    if (stats.shameParticipantId) {
        // Outlier (shame participant) vs. a majority voter
        var outlierP = voters.find(function(p) { return p.connectionId === stats.shameParticipantId; });
        var majorityP = voters.find(function(p) {
            return p.connectionId !== stats.shameParticipantId && p.vote == stats.majorityValue;
        }) || voters.find(function(p) { return p.connectionId !== stats.shameParticipantId; });

        if (!outlierP || !majorityP) return;

        leftData  = { name: outlierP.name,   vote: outlierP.vote,   avatarData: outlierP.avatarData,   isMajority: false };
        rightData = { name: majorityP.name,   vote: majorityP.vote,  avatarData: majorityP.avatarData,  isMajority: true  };
    } else {
        // No outlier: pit lowest vs highest vote
        var sorted = voters.slice().sort(function(a, b) {
            return _baParseVote(a.vote) - _baParseVote(b.vote);
        });
        var minP = sorted[0];
        var maxP = sorted[sorted.length - 1];
        if (minP.connectionId === maxP.connectionId) return;

        // Closer to average wins
        var avg = stats.average || 0;
        var minCloser = Math.abs(_baParseVote(minP.vote) - avg) <= Math.abs(_baParseVote(maxP.vote) - avg);
        leftData  = { name: minP.name, vote: minP.vote, avatarData: minP.avatarData, isMajority: minCloser  };
        rightData = { name: maxP.name, vote: maxP.vote, avatarData: maxP.avatarData, isMajority: !minCloser };
    }

    // Assign palette indices based on participant order (avoid same color)
    var leftIdx  = voters.findIndex(function(p) { return p.name === leftData.name; });
    var rightIdx = voters.findIndex(function(p) { return p.name === rightData.name; });
    leftIdx  = ((leftIdx  < 0 ? 0 : leftIdx))  % _BA_PALETTES.length;
    rightIdx = ((rightIdx < 0 ? 2 : rightIdx)) % _BA_PALETTES.length;
    if (leftIdx === rightIdx) rightIdx = (rightIdx + 1) % _BA_PALETTES.length;

    _baRunSequence(leftData, rightData, leftIdx, rightIdx);
}

function skipBattle() {
    if (!_baActive) return;
    _baSkipped = true;
    _baFinish();
}
