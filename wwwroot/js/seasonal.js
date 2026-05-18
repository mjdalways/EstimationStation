// ============================================================
// EstimationStation — Seasonal Ambient Animations
// Fires random on-screen animations based on real-world date.
// Call startSeasonalAmbience() on room init; stopSeasonalAmbience() on leave.
// ============================================================

var _seaTimer    = null;
var _seaActive   = false;
var _seaRafIds   = [];
var SEA_Z = 9980;

// ── Event lookup table ─────────────────────────────────────────────────────
// [key, m1, d1, m2, d2, priority, settingKey]
// m1=0 → variable date, resolved via _seaVariableDates()
// Priority: 1=specific 1–2 day, 2=holiday, 3=cultural, 4=long season (lower wins)
var SEA_EVENT_TABLE = [
    ['newyear',         1, 1,  1,10, 2, 'seasonalNewYear'],
    ['deepwinter',      1,11,  1,31, 4, 'seasonalDeepWinter'],
    ['mlkday',          0, 0,  0, 0, 2, 'seasonalMlkDay'],
    ['lunarnew',        0, 0,  0, 0, 2, 'seasonalLunarNew'],
    ['awards',          2, 1,  2,28, 3, 'seasonalAwards'],
    ['valentine',       2,12,  2,16, 2, 'seasonalValentine'],
    ['presidentsday',   0, 0,  0, 0, 2, 'seasonalPresidentsDay'],
    ['motheringsunday', 0, 0,  0, 0, 1, 'seasonalMotheringSunday'],
    ['pancakeday',      0, 0,  0, 0, 1, 'seasonalPancakeDay'],
    ['piday',           3,14,  3,14, 1, 'seasonalPiDay'],
    ['stpatricks',      3,15,  3,18, 2, 'seasonalStPatricks'],
    ['holi',            3, 1,  3,31, 3, 'seasonalHoli'],
    ['hanami',          3,20,  4,10, 2, 'seasonalHanami'],
    ['spring',          3, 1,  5,31, 4, 'seasonalSpring'],
    ['aprilfools',      4, 1,  4, 1, 1, 'seasonalAprilFools'],
    ['earthday',        4,22,  4,22, 1, 'seasonalEarthDay'],
    ['ramadan',         0, 0,  0, 0, 3, 'seasonalRamadan'],
    ['mayday',          5, 1,  5, 1, 2, 'seasonalMayDay'],
    ['mothersday',      0, 0,  0, 0, 2, 'seasonalMothersDay'],
    ['memorialday',     0, 0,  0, 0, 2, 'seasonalMemorialDay'],
    ['starwarsday',     5, 4,  5, 4, 1, 'seasonalStarWarsDay'],
    ['juneteenth',      6,19,  6,19, 1, 'seasonalJuneteenth'],
    ['pride',           6, 1,  6,30, 3, 'seasonalPride'],
    ['fathersday',      0, 0,  0, 0, 2, 'seasonalFathersDay'],
    ['oceanweek',       6, 8,  6,15, 2, 'seasonalOceanWeek'],
    ['solstice',        6,20,  6,22, 1, 'seasonalSolstice'],
    ['summer',          6, 1,  8,31, 4, 'seasonalSummer'],
    ['independence',    7, 4,  7, 4, 1, 'seasonalIndependence'],
    ['tanabata',        7, 7,  7, 7, 1, 'seasonalTanabata'],
    ['bastille',        7,14,  7,14, 1, 'seasonalBastille'],
    ['augbankholiday',  0, 0,  0, 0, 3, 'seasonalAugBankHoliday'],
    ['laborday',        0, 0,  0, 0, 2, 'seasonalLaborDay'],
    ['backtoschool',    9, 1,  9,10, 3, 'seasonalBackToSchool'],
    ['oktoberfest',     9,15, 10, 1, 3, 'seasonalOktoberfest'],
    ['midautumn',       0, 0,  0, 0, 2, 'seasonalMidAutumn'],
    ['spaceweek',      10, 4, 10,10, 2, 'seasonalSpaceWeek'],
    ['indigenousday',   0, 0,  0, 0, 2, 'seasonalIndigenousDay'],
    ['halloween',      10,20, 10,31, 2, 'seasonalHalloween'],
    ['autumn',          9, 1, 11,30, 4, 'seasonalAutumn'],
    ['dayofthedead',   11, 1, 11, 2, 2, 'seasonalDayOfDead'],
    ['bonfirenight',   11, 5, 11, 5, 2, 'seasonalBonfireNight'],
    ['diwali',          0, 0,  0, 0, 2, 'seasonalDiwali'],
    ['veteransday',    11,11, 11,11, 1, 'seasonalVeteransDay'],
    ['remembrance',    11,11, 11,11, 2, 'seasonalRemembrance'],
    ['thanksgiving',   11,20, 11,30, 3, 'seasonalThanksgiving'],
    ['christmas',      12, 1, 12,25, 2, 'seasonalChristmas'],
    ['boxingday',      12,26, 12,26, 2, 'seasonalBoxingDay'],
    ['wintersolstice', 12,21, 12,21, 1, 'seasonalWinterSolstice'],
    ['endofyear',      12,27, 12,30, 3, 'seasonalEndOfYear']
];

var LUNAR_DATES = {
    2024: { lunarNewYear: [2,10],  diwali: [11, 1], midAutumn: [ 9,17] },
    2025: { lunarNewYear: [1,29],  diwali: [10,20], midAutumn: [10, 6] },
    2026: { lunarNewYear: [2,17],  diwali: [11, 8], midAutumn: [ 9,25] }
};

var RAMADAN_DATES = { 2024: [3,11], 2025: [3,1], 2026: [2,18] };

function _seaEaster(y) {
    var a=y%19, b=Math.floor(y/100), c=y%100;
    var d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
    var h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4;
    var l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
    return [Math.floor((h+l-7*m+114)/31), ((h+l-7*m+114)%31)+1];
}

function _seaLastMonday(y, month) {
    var last = new Date(y, month, 0);
    return last.getDate() - ((last.getDay() + 6) % 7);
}

function _seaVariableDates(y) {
    var r = {}, lunar = LUNAR_DATES[y], ram = RAMADAN_DATES[y];
    var mkWin = function(m, d, before, after) {
        var s = new Date(y, m-1, d-before), e = new Date(y, m-1, d+after);
        return [s.getMonth()+1, s.getDate(), e.getMonth()+1, e.getDate()];
    };
    // Returns [month, day] of the Nth occurrence of weekday (0=Sun..6=Sat) in a 1-indexed month
    var nthWd = function(month, n, weekday) {
        var first = new Date(y, month-1, 1).getDay();
        return [month, 1 + ((weekday - first + 7) % 7) + (n-1)*7];
    };
    if (lunar) {
        r.lunarnew  = mkWin(lunar.lunarNewYear[0], lunar.lunarNewYear[1], 2, 2);
        r.diwali    = mkWin(lunar.diwali[0],       lunar.diwali[1],       1, 1);
        r.midautumn = mkWin(lunar.midAutumn[0],    lunar.midAutumn[1],    1, 1);
    }
    var ea = _seaEaster(y);
    var shrove = new Date(y, ea[0]-1, ea[1]-47);
    r.pancakeday     = [shrove.getMonth()+1, shrove.getDate(), shrove.getMonth()+1, shrove.getDate()];
    var ms = new Date(y, ea[0]-1, ea[1]-21);
    r.motheringsunday = [ms.getMonth()+1, ms.getDate(), ms.getMonth()+1, ms.getDate()];
    var bh = _seaLastMonday(y, 8);
    r.augbankholiday  = [8, bh, 8, bh];
    if (ram) {
        var re = new Date(y, ram[0]-1, ram[1]+29);
        r.ramadan = [ram[0], ram[1], re.getMonth()+1, re.getDate()];
    }
    // US federal holidays with variable dates
    var mlk  = nthWd(1, 3, 1); r.mlkday        = [mlk[0],  mlk[1],  mlk[0],  mlk[1]];
    var pres = nthWd(2, 3, 1); r.presidentsday = [pres[0], pres[1], pres[0], pres[1]];
    var mem  = _seaLastMonday(y, 5); r.memorialday = [5, mem, 5, mem];
    var lab  = nthWd(9, 1, 1); r.laborday      = [lab[0],  lab[1],  lab[0],  lab[1]];
    var ipd  = nthWd(10,2, 1); r.indigenousday = [ipd[0],  ipd[1],  ipd[0],  ipd[1]];
    // Family holidays
    var mday = nthWd(5, 2, 0); r.mothersday    = [mday[0], mday[1], mday[0], mday[1]];
    var fday = nthWd(6, 3, 0); r.fathersday    = [fday[0], fday[1], fday[0], fday[1]];
    return r;
}

function startSeasonalAmbience() {
    if (_seaActive) return;
    if (typeof _isMobile !== 'undefined' && _isMobile) {
        var _cs = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
        if (!_cs.mobileAnimations) return;
    }
    _seaActive = true;
    _seaScheduleNext(true);
}
var _seaTestIndex = 0;
var _seaTestIndices = {};
function testSeasonalAmbience() {
    var season = _seaGetSeason();
    if (!season) {
        var keys = Object.keys(SEA_ANIMS);
        season = keys[_seaTestIndex % keys.length];
        _seaTestIndex++;
    }
    testSpecificSeason(season);
}
function testSpecificSeason(key) {
    var list = SEA_ANIMS[key];
    if (!list || !list.length) return;
    if (_seaTestIndices[key] === undefined) _seaTestIndices[key] = 0;
    try { list[_seaTestIndices[key] % list.length](); } catch (e) {}
    _seaTestIndices[key]++;
}

function stopSeasonalAmbience() {
    _seaActive = false;
    if (_seaTimer) { clearTimeout(_seaTimer); _seaTimer = null; }
    _seaRafIds.forEach(function(id) { cancelAnimationFrame(id); });
    _seaRafIds = [];
}
function _seaScheduleNext(firstTime) {
    if (!_seaActive) return;
    var freq = {};
    try { freq = JSON.parse(localStorage.getItem('es_seaFreq') || '{}'); } catch(e) {}
    var min = firstTime ? 8000  : (freq.min || 22) * 1000;
    var max = firstTime ? 18000 : (freq.max || 55) * 1000;
    var delay = min + Math.random() * (max - min);
    _seaTimer = setTimeout(function() {
        _seaFire();
        _seaScheduleNext(false);
    }, delay);
}
function _seaFire() {
    var s = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
    if (!s.seasonalTheme) return;
    var season = _seaGetSeason();
    if (!season) return;
    var list = (SEA_ANIMS[season] || []).filter(function(fn) {
        return _seaGetAnimCfg(fn.name, season).enabled !== false;
    });
    if (!list.length) return;
    try { list[Math.floor(Math.random() * list.length)](); } catch (e) { }
}
function _seaGetSeason() {
    var now = new Date(), m = now.getMonth()+1, d = now.getDate(), y = now.getFullYear();
    var cs = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
    if (cs.seasonalTheme === false) return null;
    var varDates = _seaVariableDates(y);
    var candidates = [];
    for (var i = 0; i < SEA_EVENT_TABLE.length; i++) {
        var row = SEA_EVENT_TABLE[i];
        var key = row[0], m1 = row[1], d1 = row[2], m2 = row[3], d2 = row[4], pri = row[5], sk = row[6];
        if (cs[sk] === false) continue;
        var s, e;
        if (m1 === 0) {
            var vd = varDates[key]; if (!vd) continue;
            s = vd[0]*100+vd[1]; e = vd[2]*100+vd[3];
        } else { s = m1*100+d1; e = m2*100+d2; }
        var today = m*100+d;
        var inRange = (s <= e) ? (today >= s && today <= e) : (today >= s || today <= e);
        if (inRange) candidates.push({ key: key, pri: pri, dur: e >= s ? e-s : (1231-s)+e });
    }
    if (!candidates.length) return null;
    candidates.sort(function(a, b) { return a.pri !== b.pri ? a.pri - b.pri : a.dur - b.dur; });
    return candidates[0].key;
}

// AA1 — status bar showing active season
function _seaUpdateStatusBar() {
    var bar = document.getElementById('sea-status-bar');
    if (!bar) return;
    var season = _seaGetSeason();
    var label = season ? (SEA_ANIM_META[Object.keys(SEA_ANIMS[season] || {})[0]] || {}).name || season : null;
    if (!label && season) {
        var anims = SEA_ANIMS[season] || [];
        if (anims.length) { var meta = SEA_ANIM_META[anims[0].name]; label = meta ? meta.name.split(' ')[0] : season; }
    }
    // Get a friendly label from the row label in the DOM
    var chk = document.getElementById('cel-seasonal-' + season);
    if (chk) { var lbl = document.querySelector('label[for="cel-seasonal-' + season + '"]'); if (lbl) label = lbl.textContent.trim(); }
    bar.style.display = '';
    bar.textContent = season ? ('🌸 Active season: ' + (label || season)) : '📅 No active season today';
}

// AA2 — inject next occurrence dates into season rows
function _seaInjectNextDates() {
    var now = new Date(), y = now.getFullYear();
    var POINT_DATES = {
        piday:[3,14], aprilfools:[4,1], starwarsday:[5,4], earthday:[4,22], mayday:[5,1],
        juneteenth:[6,19], independence:[7,4], bastille:[7,14], halloween:[10,31],
        veteransday:[11,11], christmas:[12,25], boxingday:[12,26], newyear:[1,1],
        lunarnew:[1,22], diwali:[10,20], tanabata:[7,7], mlkday:[1,15], presidentsday:[2,17],
        motheringsunday:[3,10], mothersday:[5,11], memorialday:[5,26], fathersday:[6,15],
        laborday:[9,1], indigenousday:[10,13], remembrance:[11,11]
    };
    Object.keys(POINT_DATES).forEach(function(key) {
        var md = POINT_DATES[key];
        var el = document.getElementById('cel-seasonal-' + key);
        if (!el) return;
        var row = el.closest('.sea-row');
        if (!row) return;
        var next = new Date(y, md[0]-1, md[1]);
        if (next <= now) next = new Date(y+1, md[0]-1, md[1]);
        var span = row.querySelector('.sea-next-date');
        if (!span) { span = document.createElement('span'); span.className = 'sea-next-date text-muted small ms-1'; row.appendChild(span); }
        span.textContent = '(' + next.toLocaleDateString('en-GB', {day:'numeric',month:'short'}) + ')';
    });
}

// ── Generic element builders ───────────────────────────────

function _seaDiv(html, css) {
    var el = document.createElement('div');
    el.innerHTML = html;
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:' + SEA_Z + ';' + css;
    document.body.appendChild(el);
    return el;
}
function _seaRemove(el, ms) {
    setTimeout(function() { if (el && el.parentNode) el.parentNode.removeChild(el); }, ms);
}
// Center-screen popup — scale in then scale out
function _seaPopup(emoji, size, holdMs, extraCSS) {
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:' + (size||'6rem') + ';' + (extraCSS||''));
    var inner = document.createElement('div');
    inner.innerHTML = emoji;
    inner.style.animation = 'sea-popup-in 0.45s ease-out forwards';
    wrap.appendChild(inner);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.4s ease-in forwards';
        _seaRemove(wrap, 460);
    }, holdMs || 2200);
}
// motionStyle → CSS animation timing string (AA5)
function _motionStyleDur(ms) {
    return { wave: (0.3 + Math.random() * 0.25).toFixed(2) + 's ease-in-out infinite alternate',
             bounce: '0.55s ease infinite alternate', hop: '0.38s linear infinite alternate',
             spin: '0.7s linear infinite', 'slow-spin': '2s linear infinite',
             run: '0.18s linear infinite alternate', wobble: '0.5s ease-in-out infinite alternate',
             zigzag: '0.9s ease-in-out infinite alternate' }[ms] || '0.5s ease-in-out infinite';
}
// motionStyle → CSS animation name (wave maps to sea-wave-y)
function _motionStyleAnim(ms) { return ms === 'wave' ? 'sea-wave-y' : 'sea-' + ms; }

// Left → right cross-screen. motionStyle replaces waveIt boolean (backward compat: true → 'wave')
function _seaLR(emoji, topPct, size, dur, motionStyle, flipX) {
    dur = dur || 5;
    var ms = (motionStyle === true) ? 'wave' : (motionStyle === false || !motionStyle) ? 'none' : motionStyle;
    var posCSS = (topPct === null) ? 'bottom:65px;' : 'top:' + topPct + '%;';
    var wrap = _seaDiv('', posCSS + 'left:0;animation:sea-lr ' + dur + 's linear forwards;' + (ms !== 'none' ? '' : 'font-size:' + (size||'2.5rem') + ';'));
    if (ms !== 'none') {
        var inner = document.createElement('div');
        inner.style.cssText = 'font-size:' + (size||'2.5rem') + ';display:inline-block;' +
            'animation:' + _motionStyleAnim(ms) + ' ' + _motionStyleDur(ms) + ';' + (flipX ? 'transform:scaleX(-1);' : '');
        if (typeof emoji === 'string') inner.innerHTML = emoji;
        else inner.appendChild(emoji);
        wrap.appendChild(inner);
    } else {
        if (typeof emoji === 'string') {
            wrap.innerHTML = flipX ? '<span style="display:inline-block;transform:scaleX(-1);">' + emoji + '</span>' : emoji;
            wrap.style.fontSize = size || '2.5rem';
        } else { wrap.appendChild(emoji); }
    }
    _seaRemove(wrap, dur * 1000 + 300);
}
// Right → left cross-screen. motionStyle replaces waveIt boolean (backward compat: true → 'wave')
function _seaRL(emoji, topPct, size, dur, motionStyle, flipX) {
    dur = dur || 5;
    var ms = (motionStyle === true) ? 'wave' : (motionStyle === false || !motionStyle) ? 'none' : motionStyle;
    var posCSS = (topPct === null) ? 'bottom:65px;' : 'top:' + topPct + '%;';
    var wrap = _seaDiv('', posCSS + 'right:0;animation:sea-rl ' + dur + 's linear forwards;' + (ms !== 'none' ? '' : 'font-size:' + (size||'2.5rem') + ';'));
    if (ms !== 'none') {
        var inner = document.createElement('div');
        inner.style.cssText = 'font-size:' + (size||'2.5rem') + ';display:inline-block;' +
            'animation:' + _motionStyleAnim(ms) + ' ' + _motionStyleDur(ms) + ';' + (flipX ? 'transform:scaleX(-1);' : '');
        if (typeof emoji === 'string') inner.innerHTML = emoji;
        else inner.appendChild(emoji);
        wrap.appendChild(inner);
    } else {
        if (typeof emoji === 'string') {
            wrap.innerHTML = flipX ? '<span style="display:inline-block;transform:scaleX(-1);">' + emoji + '</span>' : emoji;
            wrap.style.fontSize = size || '2.5rem';
        } else { wrap.appendChild(emoji); }
    }
    _seaRemove(wrap, dur * 1000 + 300);
}
// Bottom-anchored corner slide-in popup
function _seaCorner(html, fontSize, side, holdMs) {
    var pos = (side === 'right') ? 'right:24px;' : 'left:24px;';
    var inAnim  = (side === 'right') ? 'sea-slide-in-r' : 'sea-slide-in-l';
    var outAnim = (side === 'right') ? 'sea-slide-out-r': 'sea-slide-out-l';
    var el = _seaDiv(html, 'bottom:80px;' + pos + 'font-size:' + (fontSize||'4rem') + ';animation:' + inAnim + ' 0.55s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = outAnim + ' 0.5s ease-in forwards';
        _seaRemove(el, 560);
    }, holdMs || 4000);
}
// Particles spawner (snowflakes, leaves, petals, rain…)
function _seaParticles(chars, count, animName, durRange, sizeRange, delaySpan) {
    for (var i = 0; i < count; i++) {
        (function(idx) {
            var left  = Math.random() * 100;
            var dur   = durRange[0] + Math.random() * (durRange[1] - durRange[0]);
            var size  = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
            var delay = Math.random() * (delaySpan || 2000);
            setTimeout(function() {
                var el = _seaDiv(chars[idx % chars.length],
                    'top:-35px;left:' + left + '%;font-size:' + size + 'rem;animation:' + animName + ' ' + dur + 's linear forwards;');
                _seaRemove(el, dur * 1000 + 200);
            }, delay);
        })(i);
    }
}

// ══════════════════════════════════════════════════════════
// PER-SEASON ANIMATION CONFIG
// ══════════════════════════════════════════════════════════

var _SEA_US_FLAG = '<img src="https://flagcdn.com/us.svg" width="1em" height="0.75em" alt="" style="vertical-align:middle;">';

var SEA_ANIM_META = {
    // HALLOWEEN
    _seaGhostJumpscare:   { name:'Ghost Jumpscare',    type:'custom',    enabled:true },
    _seaBatSwarm:         { name:'Bat Swarm',           type:'custom',    enabled:true },
    _seaWitchFly:         { name:'Witch Fly',           type:'runner',    emoji:'🧙‍♀️',   dir:'rl', size:'3.5rem', dur:5.5, wave:true,  flipX:false, enabled:true },
    _seaSpiderDrop:       { name:'Spider Drop',         type:'custom',    enabled:true },
    _seaPumpkinRoll:      { name:'Pumpkin Roll',        type:'runner',    emoji:'🎃',   dir:'lr', size:'2.5rem', dur:4.5, motionStyle:'spin',   bottomAnchor:true,  flipX:false, enabled:true },
    _seaSkullFloat:       { name:'Skull Float',         type:'custom',    enabled:true },
    _seaCauldronBubble:   { name:'Cauldron Bubble',     type:'custom',    enabled:true },
    _seaLightningFlash:   { name:'Lightning Flash',     type:'custom',    enabled:true },
    _seaBlackCatRun:      { name:'Black Cat Run',       type:'runner',    emoji:'🐈‍⬛', dir:'lr', size:'2.8rem', dur:3.2, motionStyle:'run',    bottomAnchor:true,  flipX:false, enabled:true },
    _seaHandFromGrave:    { name:'Hand From Grave',     type:'custom',    enabled:true },
    _seaSkeletonDance:    { name:'Skeleton Dance',      type:'popup',     emoji:'💀', size:'7rem', holdMs:2800, enabled:true },
    _seaFlyingEye:        { name:'Flying Eye',          type:'runner',    emoji:'👁️',    dir:'lr', size:'4rem',   dur:4,   wave:true,  flipX:false, enabled:true },
    // CHRISTMAS
    _seaSantaSleigh:      { name:'Santa Sleigh',        type:'runner',    emoji:'🦌🦌🦌🛷🎅', dir:'rl', size:'2.5rem', dur:8,   motionStyle:'wobble', flipX:false, enabled:true },
    _seaSnowfall:         { name:'Snowfall',            type:'particles', chars:['❄','❅','❆','✦'],      count:22, anim:'sea-snowfall',   durRange:[5,9],   sizeRange:[0.7,1.8], delaySpan:2500, enabled:true },
    _seaElfRun:           { name:'Elf Run',             type:'runner',    emoji:'🧝',   dir:'lr', size:'2.8rem', dur:3,   motionStyle:'run',    bottomAnchor:true,  flipX:false, enabled:true },
    _seaPresentBounce:    { name:'Present Bounce',      type:'runner',    emoji:'🎁',   dir:'lr', size:'2.5rem', dur:4.5, motionStyle:'bounce', bottomAnchor:true,  flipX:false, enabled:true },
    _seaSnowmanWave:      { name:'Snowman Wave',        type:'corner',    emoji:'⛄',  side:'random', size:'5rem',   holdMs:4200, wave:true,  enabled:true },
    _seaShootingStar:     { name:'Shooting Star',       type:'runner',    emoji:'⭐',   dir:'rl', size:'2rem',   dur:2.2, motionStyle:'none',   flipX:false, enabled:true },
    _seaSnowflakeSpin:    { name:'Snowflake Spin',      type:'custom',    enabled:true },
    _seaReindeerFly:      { name:'Reindeer Fly',        type:'runner',    emoji:'🦌🦌🦌', dir:'lr', size:'2.8rem', dur:5.5, wave:true,  flipX:false, enabled:true },
    _seaChristmasTree:    { name:'Christmas Tree',      type:'corner',    emoji:'🎄',  side:'random', size:'5.5rem', holdMs:4500, wave:true,  enabled:true },
    _seaChristmasBells:   { name:'Christmas Bells',     type:'popup',     emoji:'🔔', size:'6rem',   holdMs:2500, enabled:true },
    _seaGiftDropFromSky:  { name:'Gift Drop',           type:'custom',    enabled:true },
    // NEW YEAR
    _seaChampagnePop:     { name:'Champagne Pop',       type:'custom',    enabled:true },
    _seaNewYearBanner:    { name:'New Year Banner',     type:'custom',    enabled:true },
    _seaSparkler:         { name:'Sparkler',            type:'custom',    enabled:true },
    _seaTopHatFloat:      { name:'Top Hat Float',       type:'custom',    enabled:true },
    _seaPartyPopper:      { name:'Party Popper',        type:'popup',     emoji:'🎉', size:'7rem',   holdMs:1600, enabled:true },
    _seaGlitterBall:      { name:'Glitter Ball',        type:'custom',    enabled:true },
    _seaCountdownClock:   { name:'Countdown Clock',     type:'custom',    enabled:true },
    _seaStreamers:        { name:'Streamers',           type:'particles', chars:['🔴','🟡','🔵','🟢','🟣','🟠'], count:14, anim:'sea-streamer',   durRange:[2,4],   sizeRange:[0.8,1.5], delaySpan:2000, enabled:true },
    _seaToastClink:       { name:'Toast Clink',         type:'popup',     emoji:'🥂', size:'7rem',   holdMs:2400, enabled:true },
    _seaFireworksEmoji:   { name:'Fireworks Emoji',     type:'custom',    enabled:true },
    // VALENTINE
    _seaHeartsRise:       { name:'Hearts Rise',         type:'custom',    enabled:true },
    _seaCupidFly:         { name:'Cupid Fly',           type:'runner',    emoji:'💘',   dir:'lr', size:'4rem',   dur:4,   wave:true,  flipX:false, enabled:true },
    _seaRoseBlooms:       { name:'Rose Blooms',         type:'corner',    emoji:'🌹',  side:'random', size:'5rem',   holdMs:4000, wave:true,  enabled:true },
    _seaLoveLetter:       { name:'Love Letter',         type:'popup',     emoji:'💌', size:'7rem',   holdMs:2400, enabled:true },
    _seaArrowShoot:       { name:'Arrow Shoot',         type:'runner',    emoji:'💘',   dir:'lr', size:'3.5rem', dur:2.2, wave:false, flipX:false, enabled:true },
    _seaHeartBurst:       { name:'Heart Burst',         type:'custom',    enabled:true },
    _seaTeddyBear:        { name:'Teddy Bear',          type:'corner',    emoji:'🧸',  side:'random', size:'5rem',   holdMs:4200, wave:true,  enabled:true },
    _seaPinkBubbles:      { name:'Pink Bubbles',        type:'particles', chars:['🩷','💕','💗','💖'],           count:10, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1.2,2.5], delaySpan:2500, enabled:true },
    _seaChocolateBox:     { name:'Chocolate Box',       type:'popup',     emoji:'🍫', size:'6rem',   holdMs:2200, enabled:true },
    _seaKissMark:         { name:'Kiss Mark',           type:'popup',     emoji:'💋', size:'8rem',   holdMs:2000, enabled:true },
    // SPRING
    _seaButterflyFloat:   { name:'Butterfly Float',     type:'runner',    emoji:'🦋',   dir:'lr', size:'3rem',   dur:7.5, wave:true,  flipX:false, enabled:true },
    _seaFlowerGrow:       { name:'Flower Grow',         type:'custom',    enabled:true },
    _seaCherryBlossom:    { name:'Cherry Blossom',      type:'particles', chars:['🌸','🌸','🌺','🌼'],          count:16, anim:'sea-petal-fall', durRange:[4,7],   sizeRange:[0.7,1.6], delaySpan:3000, enabled:true },
    _seaRainbow:          { name:'Rainbow',             type:'popup',     emoji:'🌈', size:'9rem',   holdMs:3500, enabled:true },
    _seaBeeWobble:        { name:'Bee Wobble',          type:'custom',    enabled:true },
    _seaChickHatch:       { name:'Chick Hatch',         type:'custom',    enabled:true },
    _seaBunnyHop:         { name:'Bunny Hop',           type:'runner',    emoji:'🐇',     dir:'rl', size:'3rem',   dur:4.2, motionStyle:'hop',    bottomAnchor:true, enabled:true },
    _seaAprilShowers:     { name:'April Showers',       type:'particles', chars:['💧','💧','🌧'],                count:22, anim:'sea-rain',       durRange:[1.4,2.5],sizeRange:[0.5,1],   delaySpan:2200, enabled:true },
    _seaSunPeek:          { name:'Sun Peek',            type:'custom',    enabled:true },
    // SUMMER
    _seaSummerSun:        { name:'Summer Sun',          type:'custom',    enabled:true },
    _seaBeachBallBounce:  { name:'Beach Ball Bounce',   type:'runner',    emoji:'🏐',     dir:'lr', size:'3rem',   dur:4.8, motionStyle:'bounce', bottomAnchor:true, enabled:true },
    _seaWaveWash:         { name:'Wave Wash',           type:'custom',    enabled:true },
    _seaSunglassesSlide:  { name:'Sunglasses Slide',    type:'runner',    emoji:'😎',     dir:'lr', size:'9rem',   dur:1.8, motionStyle:'none',              enabled:true },
    _seaFireflies:        { name:'Fireflies',           type:'custom',    enabled:true },
    _seaWatermelonRoll:   { name:'Watermelon Roll',     type:'runner',    emoji:'🍉',     dir:'rl', size:'3rem',   dur:4.2, motionStyle:'spin',   bottomAnchor:true, enabled:true },
    _seaIceCreamDrip:     { name:'Ice Cream Drip',      type:'custom',    enabled:true },
    _seaSharkFin:         { name:'Shark Fin',           type:'runner',    emoji:'🦈',   dir:'lr', size:'3.5rem', dur:5.5, wave:false, flipX:true,  enabled:true },
    _seaHeatWave:         { name:'Heat Wave',           type:'custom',    enabled:true },
    _seaIceCreamTruck:    { name:'Ice Cream Truck',     type:'runner',    emoji:'🚐🍦',  dir:'rl', size:'2.5rem', dur:5.5, motionStyle:'wobble', bottomAnchor:true, enabled:true },
    // AUTUMN
    _seaLeavesSwirl:      { name:'Leaves Swirl',        type:'particles', chars:['🍁','🍂','🍃','🍁'],          count:14, anim:'sea-leaf-fall',  durRange:[4,7],   sizeRange:[0.9,2],   delaySpan:2500, enabled:true },
    _seaOwlBlink:         { name:'Owl Blink',           type:'corner',    emoji:'🦉',  side:'random', size:'5rem',   holdMs:5000, wave:true,  enabled:true },
    _seaFoxRun:           { name:'Fox Run',             type:'runner',    emoji:'🦊',     dir:'lr', size:'3rem',   dur:3.8, motionStyle:'run',    bottomAnchor:true, enabled:true },
    _seaAcornDrop:        { name:'Acorn Drop',          type:'custom',    enabled:true },
    _seaFogRoll:          { name:'Fog Roll',            type:'custom',    enabled:true },
    _seaMushroomGrow:     { name:'Mushroom Grow',       type:'corner',    emoji:'🍄',  side:'random', size:'5rem',   holdMs:4000, wave:true,  enabled:true },
    _seaHarvestMoon:      { name:'Harvest Moon',        type:'custom',    enabled:true },
    _seaScarecrow:        { name:'Scarecrow',           type:'corner',    emoji:'🪬',  side:'random', size:'5rem',   holdMs:4000, wave:true,  enabled:true },
    _seaCiderMug:         { name:'Cider Mug',           type:'custom',    enabled:true },
    _seaSpiderWebCorner:  { name:'Spider Web',          type:'corner',    emoji:'🕸️', side:'random', size:'5.5rem', holdMs:4000, wave:false, enabled:true },
    // THANKSGIVING
    _seaTurkeyRun:        { name:'Turkey Run',          type:'runner',    emoji:'🦃',     dir:'rl', size:'3rem',   dur:3.5, motionStyle:'run',    bottomAnchor:true, enabled:true },
    _seaPieCooling:       { name:'Pie Cooling',         type:'custom',    enabled:true },
    _seaCornucopia:       { name:'Cornucopia',          type:'corner',    emoji:'🌽🍎🥕🍊', side:'random', size:'2.5rem', holdMs:4000, wave:false, enabled:true },
    _seaThanksgivingLeaves:{ name:'Thanksgiving Leaves',type:'custom',    enabled:true },
    _seaPilgrimHatFloat:  { name:'Pilgrim Hat Float',   type:'custom',    enabled:true },
    _seaHarvestWagon:     { name:'Harvest Wagon',       type:'runner',    emoji:'🌾🌾🌾', dir:'lr', size:'2rem',   dur:5.5, motionStyle:'wobble', bottomAnchor:true, enabled:true },
    _seaAppleRoll:        { name:'Apple Roll',          type:'runner',    emoji:'🍎',     dir:'rl', size:'3rem',   dur:4.0, motionStyle:'spin',   bottomAnchor:true, enabled:true },
    _seaCornStalk:        { name:'Corn Stalk',          type:'corner',    emoji:'🌽',  side:'random', size:'5.5rem', holdMs:4200, wave:true,  enabled:true },
    _seaFeastTable:       { name:'Feast Table',         type:'custom',    enabled:true },
    _seaHayBale:          { name:'Hay Bale',            type:'runner',    emoji:'🌾',     dir:'lr', size:'3rem',   dur:5.0, motionStyle:'wobble', bottomAnchor:true, enabled:true },
    // DEEP WINTER
    _seaDeepWinterSnow:   { name:'Deep Winter Snow',    type:'custom',    enabled:true },
    _seaFrostCreep:       { name:'Frost Creep',         type:'corner',    emoji:'🧊',  side:'random', size:'5rem',   holdMs:4200, wave:false, enabled:true },
    _seaBlizzard:         { name:'Blizzard',            type:'particles', chars:['❄','❅','❆','✦'],      count:30, anim:'sea-snowfall',   durRange:[4,8],   sizeRange:[0.5,1.5], delaySpan:1200, enabled:true },
    // LUNAR NEW YEAR
    _seaDragonFly:        { name:'Dragon Fly',          type:'runner',    emoji:'🐉🧧', dir:'lr', size:'3rem',   dur:6,   wave:true,  flipX:false, enabled:true },
    _seaLanternRise:      { name:'Lantern Rise',        type:'particles', chars:['🏮'],                         count:8,  anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1.5,2.5], delaySpan:2000, enabled:true },
    _seaRedEnvelopes:     { name:'Red Envelopes',       type:'particles', chars:['🧧','🎊','🧧'],               count:12, anim:'sea-petal-fall', durRange:[3,6],   sizeRange:[0.8,1.8], delaySpan:2500, enabled:true },
    _seaFirecracker:      { name:'Firecracker',         type:'popup',     emoji:'🎆', size:'7rem',   holdMs:1800, enabled:true },
    // AWARDS
    _seaTrophyPopup:      { name:'Trophy Popup',        type:'popup',     emoji:'🏆', size:'8rem',   holdMs:2500, enabled:true },
    _seaStarWalk:         { name:'Star Walk',           type:'runner',    emoji:'⭐🎬', dir:'lr', size:'2.8rem', dur:5,   wave:false, flipX:false, enabled:true },
    _seaGoldParticles:    { name:'Gold Particles',      type:'particles', chars:['🏆','⭐','🌟'],               count:12, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.6], delaySpan:2000, enabled:true },
    // PANCAKE DAY
    _seaPancakeStack:     { name:'Pancake Stack',       type:'popup',     emoji:'🥞', size:'8rem',   holdMs:2400, enabled:true },
    _seaLemonSlice:       { name:'Lemon Slice',         type:'corner',    emoji:'🍋',  side:'random', size:'5rem',   holdMs:3500, wave:false, enabled:true },
    _seaPancakeToss:      { name:'Pancake Toss',        type:'particles', chars:['🥞','🍋','🧈'],               count:10, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    // PI DAY
    _seaPiSymbol:         { name:'Pi Symbol',           type:'popup',     emoji:'π',  size:'10rem',  holdMs:3000, enabled:true },
    _seaPieRoll:          { name:'Pie Roll',            type:'runner',    emoji:'🥧',     dir:'lr', size:'3rem',   dur:4.5, motionStyle:'spin',   bottomAnchor:true, enabled:true },
    _seaMathParticles:    { name:'Math Particles',      type:'particles', chars:['π','∞','Σ','√'],              count:14, anim:'sea-snowfall',   durRange:[4,7],   sizeRange:[0.9,1.8], delaySpan:2000, enabled:true },
    // ST PATRICK'S
    _seaShamrockShower:   { name:'Shamrock Shower',     type:'particles', chars:['🍀','☘️','🍀'],               count:18, anim:'sea-petal-fall', durRange:[3,6],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    _seaRainbowArc:       { name:'Rainbow Arc',         type:'popup',     emoji:'🌈', size:'9rem',   holdMs:3500, enabled:true },
    _seaGoldPot:          { name:'Gold Pot',            type:'corner',    emoji:'🍺',  side:'random', size:'5rem',   holdMs:4000, wave:true,  enabled:true },
    // HOLI
    _seaColorBurst:       { name:'Color Burst',         type:'particles', chars:['🎨','💥','🌈','✨'],           count:20, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2.2],   delaySpan:1500, enabled:true },
    _seaHoliSplash:       { name:'Holi Splash',         type:'popup',     emoji:'🎨', size:'8rem',   holdMs:1800, enabled:true },
    _seaColorRain:        { name:'Color Rain',          type:'particles', chars:['🔴','🟡','🟢','🔵','🟣','🟠'], count:24, anim:'sea-snowfall',   durRange:[3,6],   sizeRange:[0.7,1.5], delaySpan:1500, enabled:true },
    // HANAMI
    _seaHanamiBlossoms:   { name:'Hanami Blossoms',     type:'custom',    enabled:true },
    _seaPetalDrift:       { name:'Petal Drift',         type:'particles', chars:['🌸','🌺','🌼','🌷'],          count:20, anim:'sea-petal-fall', durRange:[5,9],   sizeRange:[0.6,1.4], delaySpan:3000, enabled:true },
    _seaBlossomTree:      { name:'Blossom Tree',        type:'corner',    emoji:'🌸',  side:'random', size:'6rem',   holdMs:4500, wave:true,  enabled:true },
    // APRIL FOOLS
    _seaGlitchEffect:     { name:'Glitch Effect',       type:'custom',    enabled:true },
    _seaFakeAlert:        { name:'Fake Alert',          type:'popup',     emoji:'⚠️', size:'8rem',   holdMs:1600, enabled:true },
    _seaJokerCard:        { name:'Joker Card',          type:'runner',    emoji:'🃏',   dir:'lr', size:'4rem',   dur:3,   wave:false, flipX:false, enabled:true },
    // EARTH DAY
    _seaEarthSpin:        { name:'Earth Spin',          type:'popup',     emoji:'🌍', size:'9rem',   holdMs:3000, enabled:true },
    _seaLeafRain:         { name:'Leaf Rain',           type:'particles', chars:['🌱','🍃','♻️','🌿'],          count:16, anim:'sea-petal-fall', durRange:[4,7],   sizeRange:[0.8,1.6], delaySpan:2500, enabled:true },
    _seaRecycleFloat:     { name:'Recycle Float',       type:'runner',    emoji:'♻️',   dir:'lr', size:'3.5rem', dur:5,   wave:false, flipX:false, enabled:true },
    // RAMADAN
    _seaCrescentMoon:     { name:'Crescent Moon',       type:'popup',     emoji:'🌙', size:'9rem',   holdMs:3000, enabled:true },
    _seaStarAndMoon:      { name:'Star And Moon',       type:'particles', chars:['🌙','⭐','✨'],               count:14, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    _seaLampFloat:        { name:'Lamp Float',          type:'runner',    emoji:'🪔',   dir:'lr', size:'3.5rem', dur:5,   wave:true,  flipX:false, enabled:true },
    // MAY DAY
    _seaFlowerShower:     { name:'Flower Shower',       type:'particles', chars:['🌺','🌸','💐','🌼'],          count:18, anim:'sea-petal-fall', durRange:[4,7],   sizeRange:[0.7,1.6], delaySpan:2000, enabled:true },
    _seaRibbonDance:      { name:'Ribbon Dance',        type:'runner',    emoji:'🎀',   dir:'lr', size:'3.5rem', dur:5,   wave:true,  flipX:false, enabled:true },
    _seaMayPopup:         { name:'May Popup',           type:'popup',     emoji:'🌺', size:'8rem',   holdMs:2200, enabled:true },
    // STAR WARS DAY
    _seaStarWarsCrawl:    { name:'Star Wars Crawl',     type:'custom',    enabled:true },
    _seaSaberCross:       { name:'Saber Cross',         type:'runner',    emoji:'⚔️',   dir:'lr', size:'4.5rem', dur:2.5, wave:false, flipX:false, enabled:true },
    _seaGalaxyParticles:  { name:'Galaxy Particles',    type:'particles', chars:['⭐','✨','🌟'],               count:20, anim:'sea-snowfall',   durRange:[4,7],   sizeRange:[0.6,1.4], delaySpan:1500, enabled:true },
    _seaMayTheFourth:     { name:'May The Fourth',      type:'popup',     emoji:'May the 4th', size:'3rem', holdMs:2800, enabled:true },
    _seaSpaceshipFly:     { name:'Spaceship Fly',       type:'runner',    emoji:'🚀',   dir:'lr', size:'3.5rem', dur:3.5, wave:false, flipX:false, enabled:true },
    // PRIDE
    _seaRainbowParticles: { name:'Rainbow Particles',   type:'particles', chars:['❤️','🧡','💛','💚','💙','💜'], count:20, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1,2.2],   delaySpan:1500, enabled:true },
    _seaRainbowFlag:      { name:'Rainbow Flag',        type:'runner',    emoji:'🌈',   dir:'lr', size:'4.5rem', dur:5,   wave:true,  flipX:false, enabled:true },
    _seaPrideHearts:      { name:'Pride Hearts',        type:'particles', chars:['💖','❤️','🌈'],               count:16, anim:'sea-petal-fall', durRange:[4,7],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    // MLK DAY
    _seaMlkMarch:         { name:'MLK March',           type:'runner',    emoji:'✊🕊️', dir:'lr', size:'3rem',   dur:4.5, wave:true,  flipX:false, enabled:true },
    _seaMlkDoves:         { name:'MLK Doves',           type:'particles', chars:['🕊️','✊','🌟','✨'],           count:16, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    _seaMlkPopup:         { name:'MLK Popup',           type:'popup',     emoji:'✊', size:'8rem',   holdMs:2200, enabled:true },
    // PRESIDENTS' DAY
    _seaPresParade:       { name:'Presidents Parade',   type:'runner',    emoji:'🎩' + _SEA_US_FLAG, dir:'lr', size:'3rem',   dur:5,   wave:true,  flipX:false, enabled:true },
    _seaPresStars:        { name:'Presidents Stars',    type:'particles', chars:['⭐','🌟','✨',_SEA_US_FLAG],  count:18, anim:'sea-snowfall',   durRange:[3,6],   sizeRange:[0.6,1.4], delaySpan:1500, enabled:true },
    _seaPresPopup:        { name:'Presidents Popup',    type:'popup',     emoji:'🏛️', size:'8rem',   holdMs:2400, enabled:true },
    // MOTHERING SUNDAY
    _seaMotheringFlowers: { name:'Mothering Flowers',   type:'particles', chars:['💐','🌸','🌼','🌺','💛'],     count:18, anim:'sea-petal-fall', durRange:[3,5],   sizeRange:[0.8,1.6], delaySpan:2500, enabled:true },
    _seaMotheringLove:    { name:'Mothering Love',      type:'particles', chars:['💛','💕','❤️','🌸'],           count:16, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    _seaMotheringPop:     { name:'Mothering Popup',     type:'popup',     emoji:'💐', size:'8rem',   holdMs:2400, enabled:true },
    // MOTHER'S DAY US
    _seaMomFlowers:       { name:'Mom Flowers',         type:'particles', chars:['🌸','🌺','🌷','💐','💕'],     count:18, anim:'sea-petal-fall', durRange:[3,5],   sizeRange:[0.8,1.6], delaySpan:2500, enabled:true },
    _seaMomHeart:         { name:'Mom Heart',           type:'particles', chars:['❤️','💕','💖','🌸'],           count:16, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    _seaMomPopup:         { name:'Mom Popup',           type:'popup',     emoji:'💐', size:'8rem',   holdMs:2400, enabled:true },
    // MEMORIAL DAY
    _seaMemPoppies:       { name:'Memorial Poppies',    type:'particles', chars:['🌺','🎖️','⭐',_SEA_US_FLAG],  count:16, anim:'sea-petal-fall', durRange:[3,5],   sizeRange:[0.8,1.6], delaySpan:2000, enabled:true },
    _seaMemFlag:          { name:'Memorial Flag',       type:'runner',    emoji:_SEA_US_FLAG,  dir:'lr', size:'3.5rem', dur:4,   wave:false, flipX:false, enabled:true },
    _seaMemPopup:         { name:'Memorial Popup',      type:'popup',     emoji:'🎖️', size:'8rem',   holdMs:2200, enabled:true },
    // JUNETEENTH
    _seaJuneteenthParade: { name:'Juneteenth Parade',   type:'runner',    emoji:'🕊️✊', dir:'lr', size:'3rem',   dur:4.5, wave:true,  flipX:false, enabled:true },
    _seaJuneteenthBurst:  { name:'Juneteenth Burst',    type:'particles', chars:['✊','🕊️','⭐','🎉','🌟'],      count:20, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    _seaJuneteenthPop:    { name:'Juneteenth Popup',    type:'popup',     emoji:'🗽', size:'8rem',   holdMs:2200, enabled:true },
    // FATHER'S DAY
    _seaDadParade:        { name:'Dad Parade',          type:'runner',    emoji:'👔⚽', dir:'lr', size:'3rem',   dur:5,   wave:true,  flipX:false, enabled:true },
    _seaDadBalloons:      { name:'Dad Balloons',        type:'particles', chars:['🎈','⭐','🎉','🏆'],           count:14, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    _seaDadPopup:         { name:'Dad Popup',           type:'popup',     emoji:'🎩', size:'8rem',   holdMs:2200, enabled:true },
    // OCEAN WEEK
    _seaSharkSwim:        { name:'Shark Swim',          type:'custom',    enabled:true },
    _seaFishSchool:       { name:'Fish School',         type:'runner',    emoji:'🐠🐟🐡',dir:'lr', size:'2.5rem', dur:6,   wave:true,  flipX:false, enabled:true },
    _seaOceanParticles:   { name:'Ocean Particles',     type:'particles', chars:['🐠','🌊','🐙','🦑'],           count:14, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    // SOLSTICE
    _seaBigSun:           { name:'Big Sun',             type:'popup',     emoji:'☀️', size:'11rem',  holdMs:3500, enabled:true },
    _seaSunRays:          { name:'Sun Rays',            type:'particles', chars:['✨','🌟','⭐'],               count:18, anim:'sea-snowfall',   durRange:[3,6],   sizeRange:[0.6,1.4], delaySpan:1000, enabled:true },
    _seaSolsticeGlow:     { name:'Solstice Glow',       type:'custom',    enabled:true },
    // INDEPENDENCE DAY
    _seaFlagParade:       { name:'Flag Parade',         type:'runner',    emoji:_SEA_US_FLAG + '🎆', dir:'lr', size:'3rem',   dur:5,   wave:true,  flipX:false, enabled:true },
    _seaFireworks4th:     { name:'Fireworks',           type:'particles', chars:['★','✦','⭐'],                 count:22, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.9,1.9], delaySpan:1500, enabled:true },
    _seaEagleSoar:        { name:'Eagle Soar',          type:'runner',    emoji:'🦅',   dir:'lr', size:'3.5rem', dur:4,   wave:false, flipX:false, enabled:true },
    _seaFlagPop:          { name:'Flag Popup',          type:'popup',     emoji:_SEA_US_FLAG, size:'8rem',   holdMs:2200, enabled:true },
    _seaTeapotRun:        { name:'Teapot Run',          type:'runner',    emoji:'🫖☕', dir:'lr', size:'3rem',   dur:4.5, wave:true,  flipX:false, enabled:true },
    _seaTeacupParticles:  { name:'Teacup Particles',    type:'particles', chars:['🍵','☕','🫖'],               count:12, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:1500, enabled:true },
    _seaTeaPopup:         { name:'Tea Popup',           type:'popup',     emoji:'☕', size:'8rem',   holdMs:2200, enabled:true },
    // TANABATA
    _seaBambooWish:       { name:'Bamboo Wish',         type:'corner',    emoji:'🎋',  side:'random', size:'5rem',   holdMs:4500, wave:true,  enabled:true },
    _seaShootingStarT:    { name:'Shooting Star',       type:'runner',    emoji:'🌠',   dir:'lr', size:'3.5rem', dur:2.5, wave:false, flipX:false, enabled:true },
    _seaTanabataStars:    { name:'Tanabata Stars',      type:'particles', chars:['⭐','🌟','✨','🌠'],           count:16, anim:'sea-snowfall',   durRange:[3,6],   sizeRange:[0.6,1.4], delaySpan:2000, enabled:true },
    // BASTILLE DAY
    _seaTricolorParticles:{ name:'Tricolor Particles',  type:'particles', chars:['🔵','⚪','🔴'],               count:20, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.9,1.8], delaySpan:1500, enabled:true },
    _seaFireworksBastille:{ name:'Bastille Fireworks',  type:'runner',    emoji:'🎆',   dir:'lr', size:'3.5rem', dur:4,   wave:false, flipX:false, enabled:true },
    _seaEiffelTower:      { name:'Eiffel Tower',        type:'popup',     emoji:'🗼', size:'7rem',   holdMs:2800, enabled:true },
    // AUG BANK HOLIDAY
    _seaWeatherMix:       { name:'Weather Mix',         type:'particles', chars:['🌧️','☀️','🌈','⛅'],           count:14, anim:'sea-snowfall',   durRange:[4,7],   sizeRange:[0.8,1.6], delaySpan:2000, enabled:true },
    _seaBaggage:          { name:'Baggage',             type:'corner',    emoji:'🧳',  side:'random', size:'5rem',   holdMs:3800, wave:true,  enabled:true },
    _seaHolidayPop:       { name:'Holiday Popup',       type:'popup',     emoji:'🏖️', size:'7rem',   holdMs:2400, enabled:true },
    // LABOR DAY
    _seaLaborParade:      { name:'Labor Parade',        type:'runner',    emoji:'👷🔨', dir:'lr', size:'3rem',   dur:5,   wave:true,  flipX:false, enabled:true },
    _seaLaborTools:       { name:'Labor Tools',         type:'particles', chars:['🔧','⚙️','🔨','🛠️'],           count:14, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[1,2],     delaySpan:1500, enabled:true },
    _seaLaborPopup:       { name:'Labor Popup',         type:'popup',     emoji:'💪', size:'8rem',   holdMs:2200, enabled:true },
    // BACK TO SCHOOL
    _seaPencilRun:        { name:'Pencil Run',          type:'runner',    emoji:'✏️',   dir:'lr', size:'3.5rem', dur:4,   wave:true,  flipX:false, enabled:true },
    _seaBookFall:         { name:'Book Fall',           type:'particles', chars:['📚','✏️','📐','📝'],           count:14, anim:'sea-petal-fall', durRange:[3,6],   sizeRange:[0.8,1.6], delaySpan:2000, enabled:true },
    _seaBackpackPop:      { name:'Backpack Popup',      type:'popup',     emoji:'🎒', size:'7rem',   holdMs:2400, enabled:true },
    // OKTOBERFEST
    _seaBeerParade:       { name:'Beer Parade',         type:'runner',    emoji:'🍺🥨', dir:'lr', size:'3rem',   dur:5.5, wave:true,  flipX:false, enabled:true },
    _seaMusicNotes:       { name:'Music Notes',         type:'particles', chars:['🎶','🎵','🎶'],               count:12, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1,2],     delaySpan:2000, enabled:true },
    _seaBeerMugPop:       { name:'Beer Mug Popup',      type:'popup',     emoji:'🍺', size:'8rem',   holdMs:2400, enabled:true },
    // MID-AUTUMN
    _seaMooncakeParticles:{ name:'Mooncake Particles',  type:'particles', chars:['🥮','🌕','🐰'],               count:12, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1.2,2.2], delaySpan:2500, enabled:true },
    _seaLanternFloat:     { name:'Lantern Float',       type:'runner',    emoji:'🏮',   dir:'lr', size:'3.5rem', dur:5,   wave:true,  flipX:false, enabled:true },
    _seaFullMoonMidAut:   { name:'Full Moon',           type:'custom',    enabled:true },
    // SPACE WEEK
    _seaRocketLaunch:     { name:'Rocket Launch',       type:'runner',    emoji:'🚀',   dir:'lr', size:'3.5rem', dur:3.5, wave:false, flipX:false, enabled:true },
    _seaSpaceParticles:   { name:'Space Particles',     type:'particles', chars:['⭐','🌙','✨','🛸'],           count:18, anim:'sea-snowfall',   durRange:[4,7],   sizeRange:[0.6,1.4], delaySpan:1500, enabled:true },
    _seaAstronautPop:     { name:'Astronaut Popup',     type:'popup',     emoji:'👩‍🚀', size:'8rem',   holdMs:2600, enabled:true },
    // INDIGENOUS PEOPLES' DAY
    _seaIndigenousFeathers:{ name:'Indigenous Feathers',type:'particles', chars:['🪶','🌿','🌎','⭐','🌺'],      count:16, anim:'sea-petal-fall', durRange:[3,6],   sizeRange:[0.7,1.6], delaySpan:2500, enabled:true },
    _seaIndigenousEagle:  { name:'Indigenous Eagle',    type:'runner',    emoji:'🦅',   dir:'lr', size:'4rem',   dur:4,   wave:false, flipX:false, enabled:true },
    _seaIndigenousPop:    { name:'Indigenous Popup',    type:'popup',     emoji:'🌎', size:'8rem',   holdMs:2400, enabled:true },
    // DAY OF THE DEAD
    _seaSkullFlowers:     { name:'Skull Flowers',       type:'particles', chars:['💀','🌸','🌺','🕯️'],          count:16, anim:'sea-petal-fall', durRange:[4,7],   sizeRange:[0.7,1.6], delaySpan:2500, enabled:true },
    _seaCandleFlight:     { name:'Candle Flight',       type:'runner',    emoji:'🕯️',   dir:'lr', size:'3rem',   dur:5,   wave:true,  flipX:false, enabled:true },
    _seaDayDeadPop:       { name:'Day of Dead Popup',   type:'popup',     emoji:'💀', size:'7rem',   holdMs:2400, enabled:true },
    // VETERANS DAY
    _seaVetFlag:          { name:'Vet Flag',            type:'runner',    emoji:_SEA_US_FLAG + '🎖️', dir:'lr', size:'3rem',   dur:4.5, wave:true,  flipX:false, enabled:true },
    _seaVetMedals:        { name:'Vet Medals',          type:'particles', chars:['🎖️','⭐','🌟',_SEA_US_FLAG],  count:16, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    _seaVetPopup:         { name:'Vet Popup',           type:'popup',     emoji:'🎖️', size:'8rem',   holdMs:2200, enabled:true },
    // BONFIRE NIGHT
    _seaBonfireFireworks: { name:'Bonfire Fireworks',   type:'runner',    emoji:'🎆',   dir:'lr', size:'4rem',   dur:3.5, wave:false, flipX:false, enabled:true },
    _seaSparkleParticles: { name:'Sparkle Particles',   type:'particles', chars:['✨','🔥','⭐','💥'],           count:20, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.8], delaySpan:1200, enabled:true },
    _seaBonfireExplosion: { name:'Bonfire Explosion',   type:'popup',     emoji:'💥', size:'8rem',   holdMs:1400, enabled:true },
    // DIWALI
    _seaDiwaLamps:        { name:'Diwali Lamps',        type:'particles', chars:['🪔','✨','🌟'],               count:16, anim:'sea-float-up',   durRange:[3,5],   sizeRange:[1,2.2],   delaySpan:2000, enabled:true },
    _seaDiwaFireworks:    { name:'Diwali Fireworks',    type:'runner',    emoji:'🎆',   dir:'lr', size:'3.5rem', dur:4,   wave:false, flipX:false, enabled:true },
    _seaDiwaGlow:         { name:'Diwali Glow',         type:'popup',     emoji:'🪔', size:'9rem',   holdMs:3000, enabled:true },
    // REMEMBRANCE DAY
    _seaRembPoppyFall:    { name:'Poppy Fall',          type:'particles', chars:['🌺'],                         count:14, anim:'sea-petal-fall', durRange:[6,10],  sizeRange:[0.7,1.4], delaySpan:3500, enabled:true },
    _seaRembPoppyPopup:   { name:'Poppy Popup',         type:'popup',     emoji:'🌺', size:'7rem',   holdMs:3500, enabled:true },
    _seaDoveFlight:       { name:'Dove Flight',         type:'runner',    emoji:'🕊️',   dir:'lr', size:'3.5rem', dur:6,   wave:true,  flipX:false, enabled:true },
    // BOXING DAY
    _seaGiftRun:          { name:'Gift Run',            type:'runner',    emoji:'🎁',   dir:'lr', size:'3.5rem', dur:4,   wave:true,  flipX:false, enabled:true },
    _seaShoppingBag:      { name:'Shopping Bag',        type:'particles', chars:['🎁','🛍️','🎀'],               count:14, anim:'sea-petal-fall', durRange:[3,6],   sizeRange:[0.8,1.8], delaySpan:2000, enabled:true },
    _seaBoxingPopup:      { name:'Boxing Day Popup',    type:'popup',     emoji:'🎁', size:'8rem',   holdMs:2400, enabled:true },
    // WINTER SOLSTICE
    _seaWinterSnowfall:   { name:'Winter Snowfall',     type:'custom',    enabled:true },
    _seaNightSky:         { name:'Night Sky',           type:'popup',     emoji:'🌌', size:'9rem',   holdMs:3200, enabled:true },
    _seaSolsticeSnowman:  { name:'Solstice Snowman',    type:'corner',    emoji:'☃️',  side:'random', size:'5rem',   holdMs:4000, wave:true,  enabled:true },
    // END OF YEAR
    _seaEndCountdown:     { name:'End Countdown',       type:'popup',     emoji:'⏰', size:'9rem',   holdMs:2800, enabled:true },
    _seaEndParticles:     { name:'End Particles',       type:'particles', chars:['🎉','⌛','⏰','🎆'],           count:16, anim:'sea-float-up',   durRange:[2,4],   sizeRange:[0.8,1.8], delaySpan:1500, enabled:true },
    _seaYearReview:       { name:'Year Review',         type:'runner',    emoji:'📅',   dir:'lr', size:'4rem',   dur:4.5, wave:false, flipX:false, enabled:true }
};

function _seaGetAnimCfg(fnName, seasonKey) {
    var meta = SEA_ANIM_META[fnName] || {};
    var overrides = {};
    try {
        var raw = localStorage.getItem('sea_cfg_' + seasonKey);
        if (raw) { var obj = JSON.parse(raw); overrides = obj[fnName] || {}; }
    } catch(e) {}
    return Object.assign({}, meta, overrides);
}
function _seaGetSeasonMults(seasonKey) {
    return {
        speed:     parseFloat(localStorage.getItem('sea_spd_' + seasonKey)) || 1.0,
        intensity: parseFloat(localStorage.getItem('sea_int_' + seasonKey)) || 1.0
    };
}
function _seaSaveSeasonCfg(seasonKey, overridesObj) {
    localStorage.setItem('sea_cfg_' + seasonKey, JSON.stringify(overridesObj));
}
function _seaResetSeasonCfg(seasonKey) {
    localStorage.removeItem('sea_cfg_' + seasonKey);
    localStorage.removeItem('sea_spd_' + seasonKey);
    localStorage.removeItem('sea_int_' + seasonKey);
}

function _seaRunnerFn(fnName, seasonKey, baseTop, topRange) {
    var c = _seaGetAnimCfg(fnName, seasonKey);
    if (c.enabled === false) return;
    var m = _seaGetSeasonMults(seasonKey);
    var top = c.bottomAnchor ? null : ((baseTop || 10) + Math.random() * (topRange || 30));
    var dur = (c.dur || 5) * m.speed;
    var ms = c.motionStyle || (c.wave !== false ? 'wave' : 'none');
    if (c.dir === 'rl') _seaRL(c.emoji, top, c.size, dur, ms, c.flipX);
    else _seaLR(c.emoji, top, c.size, dur, ms, c.flipX);
}
function _seaParticlesFn(fnName, seasonKey) {
    var c = _seaGetAnimCfg(fnName, seasonKey);
    if (c.enabled === false) return;
    var m = _seaGetSeasonMults(seasonKey);
    var count = Math.max(1, Math.round((c.count || 12) * m.intensity));
    var dr = c.durRange || [2, 4];
    var chars = c.chars;
    if (fnName === '_seaFireworks4th' && chars && chars.length === 3 && chars[0] === '★') {
        chars = ['<span style="color:#cc0000;">★</span>', '<span style="color:#ffffff;text-shadow:0 0 2px #aaa;">★</span>',
                 '<span style="color:#002868;">★</span>', '<span style="color:#cc0000;">✦</span>', '<span style="color:#002868;">✦</span>'];
    }
    _seaParticles(chars, count, c.anim || 'sea-float-up', [dr[0] * m.speed, dr[1] * m.speed], c.sizeRange || [1, 2], c.delaySpan || 2000);
}
function _seaPopupFn(fnName, seasonKey) {
    var c = _seaGetAnimCfg(fnName, seasonKey);
    if (c.enabled === false) return;
    _seaPopup(c.emoji, c.size, c.holdMs);
}
function _seaCornerFn(fnName, seasonKey) {
    var c = _seaGetAnimCfg(fnName, seasonKey);
    if (c.enabled === false) return;
    var side = c.side === 'random' ? (Math.random() > 0.5 ? 'left' : 'right') : (c.side || 'left');
    var html = c.wave !== false ? '<div style="animation:sea-wobble 0.9s ease-in-out infinite;display:inline-block;">' + c.emoji + '</div>' : c.emoji;
    _seaCorner(html, c.size || '5rem', side, c.holdMs || 4000);
}

// ══════════════════════════════════════════════════════════
// HALLOWEEN (October)
// ══════════════════════════════════════════════════════════

function _seaGhostJumpscare() {
    if (_seaGetAnimCfg('_seaGhostJumpscare', 'halloween').enabled === false) return;
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:10rem;');
    var inner = document.createElement('div');
    inner.textContent = '👻';
    inner.style.animation = 'sea-popup-in 0.38s ease-out forwards';
    wrap.appendChild(inner);
    setTimeout(function() { wrap.style.animation = 'sea-wobble 0.08s ease-in-out 6'; }, 600);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.5s ease-in forwards';
        _seaRemove(wrap, 560);
    }, 1600);
}

function _seaBatSwarm() {
    if (_seaGetAnimCfg('_seaBatSwarm', 'halloween').enabled === false) return;
    var count = 6 + Math.floor(Math.random() * 4);
    for (var i = 0; i < count; i++) {
        (function(idx) {
            var topPct = 4 + Math.random() * 38;
            var dur    = 4.5 + Math.random() * 3;
            var size   = 1.4 + Math.random() * 1.2;
            var goRight = Math.random() > 0.5;
            setTimeout(function() {
                goRight ? _seaLR('🦇', topPct, size + 'rem', dur, true)
                        : _seaRL('🦇', topPct, size + 'rem', dur, true);
            }, idx * 220);
        })(i);
    }
}
function _seaWitchFly()      { _seaRunnerFn('_seaWitchFly',      'halloween',  5, 20); }

function _seaSpiderDrop() {
    if (_seaGetAnimCfg('_seaSpiderDrop', 'halloween').enabled === false) return;
    var left = 15 + Math.random() * 70;
    var container = _seaDiv('',
        'top:0;left:' + left + '%;display:flex;flex-direction:column;align-items:center;' +
        'animation:sea-spider-drop 2.8s ease-out forwards;');
    var thread = document.createElement('div');
    thread.style.cssText = 'width:2px;height:130px;background:rgba(160,160,160,0.55);margin:0 auto;';
    var spider = document.createElement('div');
    spider.textContent = '🕷️';
    spider.style.cssText = 'font-size:2.8rem;animation:sea-wobble 0.25s ease-in-out infinite;';
    container.appendChild(thread);
    container.appendChild(spider);
    setTimeout(function() {
        container.style.animation = 'sea-spider-up 1.4s ease-in forwards';
        _seaRemove(container, 1500);
    }, 3500);
}

function _seaPumpkinRoll() {
    if (_seaGetAnimCfg('_seaPumpkinRoll', 'halloween').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 4.5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🎃';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-spin 1.2s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4800);
}

function _seaSkullFloat() {
    if (_seaGetAnimCfg('_seaSkullFloat', 'halloween').enabled === false) return;
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('💀', 'bottom:-50px;left:' + left + '%;font-size:3.5rem;animation:sea-float-up 4.5s ease-in forwards;');
    _seaRemove(el, 4800);
}

function _seaCauldronBubble() {
    if (_seaGetAnimCfg('_seaCauldronBubble', 'halloween').enabled === false) return;
    var el = _seaDiv(
        '<div style="font-size:5rem;animation:sea-cauldron-bubble 0.5s ease-in-out infinite;">🫕</div>',
        'bottom:20px;left:50%;transform:translateX(-50%);animation:sea-slide-up-in 0.5s ease-out forwards;');
    var bTimer = setInterval(function() {
        var bLeft = 40 + Math.random() * 20;
        var b = _seaDiv('🫧', 'bottom:' + (80 + Math.random() * 50) + 'px;left:' + bLeft + '%;' +
            'font-size:' + (0.7 + Math.random() * 0.7) + 'rem;animation:sea-float-up 1.5s ease-in forwards;opacity:0.75;');
        _seaRemove(b, 1700);
    }, 350);
    setTimeout(function() {
        clearInterval(bTimer);
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaLightningFlash() {
    if (_seaGetAnimCfg('_seaLightningFlash', 'halloween').enabled === false) return;
    var overlay = _seaDiv('', 'top:0;left:0;width:100%;height:100%;background:#fff;opacity:0;animation:sea-lightning 0.85s ease-in-out forwards;z-index:9988;');
    _seaRemove(overlay, 900);
}

function _seaBlackCatRun() {
    if (_seaGetAnimCfg('_seaBlackCatRun', 'halloween').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:68px;left:0;animation:sea-lr 3.2s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🐈‍⬛';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.18s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3500);
}

function _seaHandFromGrave() {
    if (_seaGetAnimCfg('_seaHandFromGrave', 'halloween').enabled === false) return;
    var left = 20 + Math.random() * 60;
    var el = _seaDiv('🫴', 'bottom:0;left:' + left + '%;font-size:4rem;animation:sea-hand-rise 3.5s ease-out forwards;');
    _seaRemove(el, 3700);
}

function _seaSkeletonDance()  { _seaPopupFn('_seaSkeletonDance',  'halloween'); }
function _seaFlyingEye()      { _seaRunnerFn('_seaFlyingEye',      'halloween', 20, 40); }

// ══════════════════════════════════════════════════════════
// CHRISTMAS (Dec–Jan 5)
// ══════════════════════════════════════════════════════════

function _seaSantaSleigh() {
    if (_seaGetAnimCfg('_seaSantaSleigh', 'christmas').enabled === false) return;
    var wrap = _seaDiv('', 'top:5%;right:0;animation:sea-rl 8s linear forwards;white-space:nowrap;letter-spacing:3px;');
    var inner = document.createElement('div');
    inner.textContent = '🦌🦌🦌🛷🎅';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-wave-y 0.7s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 8300);
}

function _seaSnowfall()        { _seaParticlesFn('_seaSnowfall',        'christmas'); }

function _seaElfRun() {
    if (_seaGetAnimCfg('_seaElfRun', 'christmas').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 3s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🧝';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.14s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3300);
}

function _seaPresentBounce() {
    if (_seaGetAnimCfg('_seaPresentBounce', 'christmas').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:0;left:0;animation:sea-lr 4.5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🎁';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-bounce 0.55s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4800);
}

function _seaSnowmanWave()     { _seaCornerFn('_seaSnowmanWave',     'christmas'); }

function _seaShootingStar() {
    if (_seaGetAnimCfg('_seaShootingStar', 'christmas').enabled === false) return;
    var top = 5 + Math.random() * 30;
    var el = _seaDiv('⭐', 'top:' + top + '%;right:0;font-size:2.2rem;animation:sea-rl 2.2s ease-in forwards;filter:drop-shadow(0 0 10px #ffffaa);');
    _seaRemove(el, 2500);
}

function _seaSnowflakeSpin() {
    if (_seaGetAnimCfg('_seaSnowflakeSpin', 'christmas').enabled === false) return;
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:9rem;opacity:0.75;');
    var inner = document.createElement('div');
    inner.textContent = '❄️';
    inner.style.animation = 'sea-popup-in 0.5s ease-out forwards';
    wrap.appendChild(inner);
    setTimeout(function() { inner.style.animation = 'sea-slow-spin 2.5s linear infinite'; }, 550);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.6s ease-in forwards';
        _seaRemove(wrap, 700);
    }, 3800);
}

function _seaReindeerFly()     { _seaRunnerFn('_seaReindeerFly',     'christmas',  10, 15); }
function _seaChristmasTree()   { _seaCornerFn('_seaChristmasTree',   'christmas'); }
function _seaChristmasBells()  { _seaPopupFn('_seaChristmasBells',   'christmas'); }

function _seaGiftDropFromSky() {
    if (_seaGetAnimCfg('_seaGiftDropFromSky', 'christmas').enabled === false) return;
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎁', 'top:-50px;left:' + left + '%;font-size:3rem;animation:sea-acorn-drop 2.5s ease-in forwards;');
    _seaRemove(el, 2800);
}

// ══════════════════════════════════════════════════════════
// NEW YEAR (Jan 1–10)
// ══════════════════════════════════════════════════════════

function _seaChampagnePop() {
    if (_seaGetAnimCfg('_seaChampagnePop', 'newyear').enabled === false) return;
    var el = _seaDiv(
        '<div style="font-size:5rem;animation:sea-wobble 0.3s ease-in-out 4;">🍾</div>',
        'bottom:80px;left:50%;transform:translateX(-50%);animation:sea-slide-up-in 0.4s ease-out forwards;');
    setTimeout(function() {
        for (var i = 0; i < 12; i++) {
            (function(idx) {
                setTimeout(function() {
                    var b = _seaDiv('🫧', 'bottom:' + (110 + Math.random() * 70) + 'px;left:' + (44 + Math.random() * 12) + '%;' +
                        'font-size:' + (0.7 + Math.random() * 0.8) + 'rem;animation:sea-float-up 2s ease-in forwards;opacity:0.8;');
                    _seaRemove(b, 2200);
                }, idx * 130);
            })(i);
        }
    }, 350);
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4200);
}

function _seaNewYearBanner() {
    if (_seaGetAnimCfg('_seaNewYearBanner', 'newyear').enabled === false) return;
    var el = _seaDiv('🎊 Happy New Year! 🎊',
        'top:80px;left:50%;transform:translateX(-50%) translateY(-120px);' +
        'font-size:2rem;font-weight:900;color:#ffd700;white-space:nowrap;text-align:center;' +
        'text-shadow:0 0 20px #ffd700,0 2px 4px rgba(0,0,0,0.6);' +
        'background:rgba(0,0,0,0.75);border-radius:14px;padding:12px 28px;' +
        'animation:sea-banner-drop 0.6s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-banner-lift 0.55s ease-in forwards';
        _seaRemove(el, 650);
    }, 4000);
}

function _seaSparkler() {
    if (_seaGetAnimCfg('_seaSparkler', 'newyear').enabled === false) return;
    var side = Math.random() > 0.5 ? 'right:30px;' : 'left:30px;';
    var el = _seaDiv('✨', 'bottom:100px;' + side + 'font-size:5.5rem;animation:sea-sparkler 0.6s ease-in-out infinite;');
    setTimeout(function() {
        el.style.animation = 'sea-fade-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4000);
}

function _seaTopHatFloat() {
    if (_seaGetAnimCfg('_seaTopHatFloat', 'newyear').enabled === false) return;
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎩', 'bottom:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-float-bounce 4s ease-in-out forwards;');
    _seaRemove(el, 4300);
}

function _seaPartyPopper()   { _seaPopupFn('_seaPartyPopper',   'newyear'); }

function _seaGlitterBall() {
    if (_seaGetAnimCfg('_seaGlitterBall', 'newyear').enabled === false) return;
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:6.5rem;');
    var inner = document.createElement('div');
    inner.textContent = '🪩';
    inner.style.animation = 'sea-popup-in 0.4s ease-out forwards';
    wrap.appendChild(inner);
    setTimeout(function() { inner.style.animation = 'sea-slow-spin 1.5s linear infinite'; }, 450);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.4s ease-in forwards';
        _seaRemove(wrap, 460);
    }, 4000);
}

function _seaCountdownClock() {
    if (_seaGetAnimCfg('_seaCountdownClock', 'newyear').enabled === false) return;
    var clocks = ['🕛','🕐','🕑','🕒','🕓','🕔','🕕'];
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:9rem;');
    var inner = document.createElement('div');
    inner.textContent = clocks[0];
    inner.style.animation = 'sea-popup-in 0.4s ease-out forwards';
    wrap.appendChild(inner);
    var idx = 0;
    var ci = setInterval(function() { idx++; if (idx < clocks.length) inner.textContent = clocks[idx]; }, 500);
    setTimeout(function() {
        clearInterval(ci);
        inner.style.animation = 'sea-popup-out 0.4s ease-in forwards';
        _seaRemove(wrap, 460);
    }, 4000);
}

function _seaStreamers()     { _seaParticlesFn('_seaStreamers',   'newyear'); }
function _seaToastClink()    { _seaPopupFn('_seaToastClink',      'newyear'); }

function _seaFireworksEmoji() {
    if (_seaGetAnimCfg('_seaFireworksEmoji', 'newyear').enabled === false) return;
    var spots = [[20,20],[50,15],[80,25],[30,50],[70,40]];
    spots.forEach(function(pos, i) {
        setTimeout(function() {
            var el = _seaDiv('🎆', 'top:' + pos[1] + '%;left:' + pos[0] + '%;font-size:' + (3 + Math.random() * 2) + 'rem;animation:sea-popup-in 0.4s ease-out forwards;');
            setTimeout(function() { el.style.animation = 'sea-popup-out 0.5s ease-in forwards'; _seaRemove(el, 560); }, 1000);
        }, i * 300);
    });
}

// ══════════════════════════════════════════════════════════
// VALENTINE'S (Feb 12–16)
// ══════════════════════════════════════════════════════════

function _seaHeartsRise() {
    if (_seaGetAnimCfg('_seaHeartsRise', 'valentine').enabled === false) return;
    var hearts = ['❤️','💕','💖','💗','💝','💘','🩷','💞'];
    for (var i = 0; i < 10; i++) {
        (function(idx) {
            setTimeout(function() {
                var left = 5 + Math.random() * 90;
                var size = 1.4 + Math.random() * 1.6;
                var dur  = 3 + Math.random() * 2.5;
                var el = _seaDiv(hearts[idx % hearts.length],
                    'bottom:-40px;left:' + left + '%;font-size:' + size + 'rem;animation:sea-float-up ' + dur + 's ease-in forwards;');
                _seaRemove(el, dur * 1000 + 200);
            }, idx * 220);
        })(i);
    }
}

function _seaCupidFly()       { _seaRunnerFn('_seaCupidFly',       'valentine', 10, 30); }
function _seaRoseBlooms()     { _seaCornerFn('_seaRoseBlooms',     'valentine'); }
function _seaLoveLetter()     { _seaPopupFn('_seaLoveLetter',      'valentine'); }
function _seaArrowShoot()     { _seaRunnerFn('_seaArrowShoot',     'valentine', 15, 50); }

function _seaHeartBurst() {
    if (_seaGetAnimCfg('_seaHeartBurst', 'valentine').enabled === false) return;
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:12rem;');
    var inner = document.createElement('div');
    inner.textContent = '❤️';
    inner.style.animation = 'sea-heart-burst 1.3s ease-out forwards';
    wrap.appendChild(inner);
    _seaRemove(wrap, 1500);
}

function _seaTeddyBear()      { _seaCornerFn('_seaTeddyBear',      'valentine'); }
function _seaPinkBubbles()    { _seaParticlesFn('_seaPinkBubbles',  'valentine'); }
function _seaChocolateBox()   { _seaPopupFn('_seaChocolateBox',    'valentine'); }
function _seaKissMark()       { _seaPopupFn('_seaKissMark',        'valentine'); }

// ══════════════════════════════════════════════════════════
// SPRING (March–May)
// ══════════════════════════════════════════════════════════

function _seaButterflyFloat()  { _seaRunnerFn('_seaButterflyFloat',  'spring', 10, 40); }

function _seaFlowerGrow() {
    if (_seaGetAnimCfg('_seaFlowerGrow', 'spring').enabled === false) return;
    var flowers = ['🌸','🌻','🌺','🌼','🌷'];
    var el = _seaDiv(flowers[Math.floor(Math.random() * flowers.length)],
        'bottom:20px;left:' + (20 + Math.random() * 60) + '%;font-size:0.6rem;transform-origin:bottom center;animation:sea-flower-grow 1.6s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-fade-out 1s ease-in forwards';
        _seaRemove(el, 1100);
    }, 4200);
}

function _seaCherryBlossom()   { _seaParticlesFn('_seaCherryBlossom',  'spring'); }
function _seaRainbow()         { _seaPopupFn('_seaRainbow',            'spring'); }

function _seaBeeWobble() {
    if (_seaGetAnimCfg('_seaBeeWobble', 'spring').enabled === false) return;
    var el = document.createElement('div');
    el.textContent = '🐝';
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:' + SEA_Z + ';font-size:2.8rem;';
    document.body.appendChild(el);
    var x  = 80 + Math.random() * (window.innerWidth - 160);
    var y  = 80 + Math.random() * (window.innerHeight - 160);
    var vx = (Math.random() - 0.5) * 3.5;
    var vy = (Math.random() - 0.5) * 3;
    var end = Date.now() + 5000;
    function tick() {
        if (Date.now() > end) { if (el.parentNode) el.parentNode.removeChild(el); return; }
        var t = Date.now();
        x += vx + Math.sin(t * 0.003) * 2.5;
        y += vy + Math.cos(t * 0.0045) * 2;
        if (x < 20 || x > window.innerWidth - 40)  vx *= -1;
        if (y < 20 || y > window.innerHeight - 40)  vy *= -1;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        var id = requestAnimationFrame(tick);
        _seaRafIds.push(id);
    }
    requestAnimationFrame(tick);
}

function _seaChickHatch() {
    if (_seaGetAnimCfg('_seaChickHatch', 'spring').enabled === false) return;
    var el = _seaDiv('<div id="_sea_egg_inner" style="font-size:4.5rem;animation:sea-wobble 0.22s ease-in-out 6;">🥚</div>',
        'bottom:50px;left:50%;transform:translateX(-50%);animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        var inner = document.getElementById('_sea_egg_inner');
        if (inner) { inner.textContent = '🐣'; inner.style.animation = 'sea-wobble 0.4s ease-in-out 3'; }
    }, 1400);
    setTimeout(function() {
        var inner = document.getElementById('_sea_egg_inner');
        if (inner) { inner.textContent = '🐥'; inner.style.animation = 'sea-popup-in 0.4s ease-out forwards'; }
    }, 2400);
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaBunnyHop() {
    if (_seaGetAnimCfg('_seaBunnyHop', 'spring').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 4.2s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🐇';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-hop 0.38s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4500);
}

function _seaAprilShowers()    { _seaParticlesFn('_seaAprilShowers',   'spring'); }

function _seaSunPeek() {
    if (_seaGetAnimCfg('_seaSunPeek', 'spring').enabled === false) return;
    var corner  = Math.random() > 0.5 ? 'top:-60px;right:-60px;transform-origin:top right;' : 'top:-60px;left:-60px;transform-origin:top left;';
    var el = _seaDiv('<div style="font-size:9rem;animation:sea-slow-spin 4s linear infinite;">☀️</div>',
        corner + 'animation:sea-sun-in 1s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-sun-out 0.8s ease-in forwards';
        _seaRemove(el, 900);
    }, 4000);
}

// ══════════════════════════════════════════════════════════
// SUMMER (June–August)
// ══════════════════════════════════════════════════════════

function _seaSummerSun() {
    if (_seaGetAnimCfg('_seaSummerSun', 'summer').enabled === false) return;
    _seaSunPeek();
}

function _seaBeachBallBounce() {
    if (_seaGetAnimCfg('_seaBeachBallBounce', 'summer').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:0;left:0;animation:sea-lr 4.8s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🏐';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-bounce 0.5s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5100);
}

function _seaWaveWash() {
    if (_seaGetAnimCfg('_seaWaveWash', 'summer').enabled === false) return;
    var el = _seaDiv('', 'bottom:0;left:0;width:200%;font-size:3rem;letter-spacing:8px;animation:sea-wave-wash 3.5s ease-in-out forwards;');
    var waves = '';
    for (var i = 0; i < 25; i++) waves += '🌊';
    el.textContent = waves;
    _seaRemove(el, 3800);
}

function _seaSunglassesSlide() {
    if (_seaGetAnimCfg('_seaSunglassesSlide', 'summer').enabled === false) return;
    var el = _seaDiv('😎', 'top:50%;left:0;transform:translateY(-50%);font-size:9rem;animation:sea-lr 1.8s ease-out forwards;');
    _seaRemove(el, 3500);
}

function _seaFireflies() {
    if (_seaGetAnimCfg('_seaFireflies', 'summer').enabled === false) return;
    for (var i = 0; i < 9; i++) {
        (function(idx) {
            var el = document.createElement('div');
            el.textContent = '✨';
            el.style.cssText = 'position:fixed;pointer-events:none;z-index:' + SEA_Z + ';font-size:1.1rem;';
            document.body.appendChild(el);
            var x = Math.random() * window.innerWidth;
            var y = Math.random() * window.innerHeight;
            var phase = Math.random() * Math.PI * 2;
            var end = Date.now() + 5000 + idx * 400;
            function tick() {
                if (Date.now() > end) { if (el.parentNode) el.parentNode.removeChild(el); return; }
                var t = Date.now();
                x += Math.sin(t * 0.0012 + phase) * 1.8;
                y += Math.cos(t * 0.0016 + phase) * 1.5;
                if (x < 10 || x > window.innerWidth - 20)  { x = Math.random() * window.innerWidth; }
                if (y < 10 || y > window.innerHeight - 20)  { y = Math.random() * window.innerHeight; }
                el.style.left = x + 'px';
                el.style.top  = y + 'px';
                el.style.opacity = (0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 0.006 + phase))).toFixed(2);
                var id = requestAnimationFrame(tick);
                _seaRafIds.push(id);
            }
            setTimeout(function() { requestAnimationFrame(tick); }, idx * 350);
        })(i);
    }
}

function _seaWatermelonRoll() {
    if (_seaGetAnimCfg('_seaWatermelonRoll', 'summer').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 4.2s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🍉';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-spin 0.7s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4500);
}

function _seaIceCreamDrip() {
    if (_seaGetAnimCfg('_seaIceCreamDrip', 'summer').enabled === false) return;
    var left = 20 + Math.random() * 60;
    var el = _seaDiv('🍦', 'top:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-acorn-drop 3s ease-in forwards;');
    _seaRemove(el, 3300);
}

function _seaSharkFin()        { _seaRunnerFn('_seaSharkFin', 'summer', 85, 8); }

function _seaHeatWave() {
    if (_seaGetAnimCfg('_seaHeatWave', 'summer').enabled === false) return;
    var el = _seaDiv('', 'top:0;left:0;width:100%;height:100%;z-index:9975;' +
        'background:linear-gradient(transparent 35%,rgba(255,160,0,0.09) 50%,transparent 65%);' +
        'animation:sea-heat-wave 1.8s ease-in-out 4 forwards;');
    _seaRemove(el, 7500);
}

function _seaIceCreamTruck() {
    if (_seaGetAnimCfg('_seaIceCreamTruck', 'summer').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 5.5s linear forwards;white-space:nowrap;');
    var inner = document.createElement('div');
    inner.textContent = '🚐🍦';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-wobble 0.4s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5800);
}

// ══════════════════════════════════════════════════════════
// AUTUMN / September
// ══════════════════════════════════════════════════════════

function _seaLeavesSwirl()     { _seaParticlesFn('_seaLeavesSwirl',     'autumn'); }
function _seaOwlBlink()        { _seaCornerFn('_seaOwlBlink',          'autumn'); }

function _seaFoxRun() {
    if (_seaGetAnimCfg('_seaFoxRun', 'autumn').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 3.8s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🦊';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.2s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4100);
}

function _seaAcornDrop() {
    if (_seaGetAnimCfg('_seaAcornDrop', 'autumn').enabled === false) return;
    for (var i = 0; i < 5; i++) {
        (function(idx) {
            setTimeout(function() {
                var left = 10 + Math.random() * 80;
                var el = _seaDiv('🌰', 'top:-30px;left:' + left + '%;font-size:' + (1 + Math.random() * 0.8) + 'rem;animation:sea-acorn-drop ' + (1.5 + Math.random() * 0.8) + 's ease-in forwards;');
                _seaRemove(el, 2500);
            }, idx * 350);
        })(i);
    }
}

function _seaFogRoll() {
    if (_seaGetAnimCfg('_seaFogRoll', 'autumn').enabled === false) return;
    var el = _seaDiv('', 'bottom:0;left:0;width:200%;height:28%;' +
        'background:linear-gradient(to top,rgba(160,160,160,0.32) 0%,transparent 100%);' +
        'animation:sea-fog-roll 6.5s ease-in-out forwards;');
    _seaRemove(el, 6800);
}

function _seaMushroomGrow()    { _seaCornerFn('_seaMushroomGrow',    'autumn'); }

function _seaHarvestMoon() {
    if (_seaGetAnimCfg('_seaHarvestMoon', 'autumn').enabled === false) return;
    var side = Math.random() > 0.5 ? 'right:80px;' : 'left:80px;';
    var el = _seaDiv('🌕', 'top:-80px;' + side + 'font-size:5.5rem;animation:sea-moon-rise 3.5s ease-out forwards;filter:drop-shadow(0 0 18px rgba(255,210,90,0.7));');
    setTimeout(function() {
        el.style.animation = 'sea-moon-fade 2s ease-in forwards';
        _seaRemove(el, 2200);
    }, 5500);
}

function _seaScarecrow()       { _seaCornerFn('_seaScarecrow',       'autumn'); }

function _seaCiderMug() {
    if (_seaGetAnimCfg('_seaCiderMug', 'autumn').enabled === false) return;
    var el = _seaDiv(
        '<div style="font-size:4.5rem;animation:sea-wobble 2s ease-in-out infinite;">☕</div>' +
        '<div style="font-size:1.3rem;position:absolute;bottom:80%;left:35%;animation:sea-float-up 1.3s ease-in infinite;opacity:0.5;">💨</div>',
        'bottom:20px;left:' + (20 + Math.random() * 60) + '%;animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaSpiderWebCorner() { _seaCornerFn('_seaSpiderWebCorner', 'autumn'); }

// ══════════════════════════════════════════════════════════
// THANKSGIVING (Nov 20+)
// ══════════════════════════════════════════════════════════

function _seaTurkeyRun() {
    if (_seaGetAnimCfg('_seaTurkeyRun', 'thanksgiving').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 3.5s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🦃';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-run 0.16s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3800);
}

function _seaPieCooling() {
    if (_seaGetAnimCfg('_seaPieCooling', 'thanksgiving').enabled === false) return;
    var el = _seaDiv(
        '<div style="font-size:4.5rem;">🥧</div>' +
        '<div style="font-size:1.2rem;position:absolute;bottom:80%;left:28%;animation:sea-float-up 1.4s ease-in 0.2s infinite;opacity:0.55;">💨</div>',
        'bottom:20px;left:50%;transform:translateX(-50%);animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaCornucopia()      { _seaCornerFn('_seaCornucopia',      'thanksgiving'); }

function _seaThanksgivingLeaves() {
    if (_seaGetAnimCfg('_seaThanksgivingLeaves', 'thanksgiving').enabled === false) return;
    _seaLeavesSwirl();
}

function _seaPilgrimHatFloat() {
    if (_seaGetAnimCfg('_seaPilgrimHatFloat', 'thanksgiving').enabled === false) return;
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎩', 'bottom:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-float-bounce 4.5s ease-in-out forwards;');
    _seaRemove(el, 4800);
}

function _seaHarvestWagon() {
    if (_seaGetAnimCfg('_seaHarvestWagon', 'thanksgiving').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 5.5s linear forwards;white-space:nowrap;');
    var inner = document.createElement('div');
    inner.textContent = '🌾🌾🌾';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-wobble 0.5s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5800);
}

function _seaAppleRoll() {
    if (_seaGetAnimCfg('_seaAppleRoll', 'thanksgiving').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 4s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🍎';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-spin 0.65s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4300);
}

function _seaCornStalk()       { _seaCornerFn('_seaCornStalk',       'thanksgiving'); }

function _seaFeastTable() {
    if (_seaGetAnimCfg('_seaFeastTable', 'thanksgiving').enabled === false) return;
    var el = _seaDiv('🍽️🍗🥧🌽🍎',
        'bottom:20px;left:50%;transform:translateX(-50%);font-size:2.2rem;white-space:nowrap;letter-spacing:6px;' +
        'animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 5000);
}

function _seaHayBale() {
    if (_seaGetAnimCfg('_seaHayBale', 'thanksgiving').enabled === false) return;
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🌾';
    inner.style.cssText = 'font-size:3.5rem;display:inline-block;animation:sea-wobble 1s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5300);
}

// ══════════════════════════════════════════════════════════
// DEEP WINTER (Jan 11–31)
// ══════════════════════════════════════════════════════════
function _seaDeepWinterSnow() {
    if (_seaGetAnimCfg('_seaDeepWinterSnow', 'deepwinter').enabled === false) return;
    _seaSnowfall();
}
function _seaFrostCreep()       { _seaCornerFn('_seaFrostCreep',    'deepwinter'); }
function _seaBlizzard()         { _seaParticlesFn('_seaBlizzard',   'deepwinter'); }

// ══════════════════════════════════════════════════════════
// LUNAR NEW YEAR
// ══════════════════════════════════════════════════════════
function _seaDragonFly()        { _seaRunnerFn('_seaDragonFly',     'lunarnew',  15, 20); }
function _seaLanternRise()      { _seaParticlesFn('_seaLanternRise','lunarnew'); }
function _seaRedEnvelopes()     { _seaParticlesFn('_seaRedEnvelopes','lunarnew'); }
function _seaFirecracker()      { _seaPopupFn('_seaFirecracker',    'lunarnew'); }

// ══════════════════════════════════════════════════════════
// AWARDS SEASON (Feb)
// ══════════════════════════════════════════════════════════
function _seaTrophyPopup()      { _seaPopupFn('_seaTrophyPopup',    'awards'); }
function _seaStarWalk()         { _seaRunnerFn('_seaStarWalk',      'awards',    20, 40); }
function _seaGoldParticles()    { _seaParticlesFn('_seaGoldParticles','awards'); }

// ══════════════════════════════════════════════════════════
// PANCAKE DAY
// ══════════════════════════════════════════════════════════
function _seaPancakeStack()     { _seaPopupFn('_seaPancakeStack',   'pancakeday'); }
function _seaLemonSlice()       { _seaCornerFn('_seaLemonSlice',    'pancakeday'); }
function _seaPancakeToss()      { _seaParticlesFn('_seaPancakeToss','pancakeday'); }

// ══════════════════════════════════════════════════════════
// PI DAY (Mar 14)
// ══════════════════════════════════════════════════════════
function _seaPiSymbol()         { _seaPopupFn('_seaPiSymbol',       'piday'); }
function _seaPieRoll() {
    if (_seaGetAnimCfg('_seaPieRoll', 'piday').enabled === false) return;
    var w = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 4.5s linear forwards;');
    var n = document.createElement('div');
    n.textContent = '🥧'; n.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-spin 1s linear infinite;';
    w.appendChild(n); _seaRemove(w, 4800);
}
function _seaMathParticles()    { _seaParticlesFn('_seaMathParticles','piday'); }

// ══════════════════════════════════════════════════════════
// ST PATRICK'S (Mar 15–18)
// ══════════════════════════════════════════════════════════
function _seaShamrockShower()   { _seaParticlesFn('_seaShamrockShower','stpatricks'); }
function _seaRainbowArc()       { _seaPopupFn('_seaRainbowArc',     'stpatricks'); }
function _seaGoldPot()          { _seaCornerFn('_seaGoldPot',       'stpatricks'); }

// ══════════════════════════════════════════════════════════
// HOLI (March)
// ══════════════════════════════════════════════════════════
function _seaColorBurst()       { _seaParticlesFn('_seaColorBurst', 'holi'); }
function _seaHoliSplash()       { _seaPopupFn('_seaHoliSplash',     'holi'); }
function _seaColorRain()        { _seaParticlesFn('_seaColorRain',  'holi'); }

// ══════════════════════════════════════════════════════════
// HANAMI (Mar 20–Apr 10)
// ══════════════════════════════════════════════════════════
function _seaHanamiBlossoms() {
    if (_seaGetAnimCfg('_seaHanamiBlossoms', 'hanami').enabled === false) return;
    _seaCherryBlossom();
}
function _seaPetalDrift()       { _seaParticlesFn('_seaPetalDrift', 'hanami'); }
function _seaBlossomTree()      { _seaCornerFn('_seaBlossomTree',   'hanami'); }

// ══════════════════════════════════════════════════════════
// APRIL FOOLS (Apr 1)
// ══════════════════════════════════════════════════════════
function _seaGlitchEffect() {
    if (_seaGetAnimCfg('_seaGlitchEffect', 'aprilfools').enabled === false) return;
    var o = _seaDiv('', 'top:0;left:0;width:100%;height:100%;z-index:9988;pointer-events:none;animation:sea-lightning 0.6s ease-in-out 3;filter:hue-rotate(180deg);opacity:0.15;');
    _seaRemove(o, 2000);
}
function _seaFakeAlert()        { _seaPopupFn('_seaFakeAlert',       'aprilfools'); }
function _seaJokerCard()        { _seaRunnerFn('_seaJokerCard',      'aprilfools', 30, 30); }

// ══════════════════════════════════════════════════════════
// EARTH DAY (Apr 22)
// ══════════════════════════════════════════════════════════
function _seaEarthSpin()        { _seaPopupFn('_seaEarthSpin',       'earthday'); }
function _seaLeafRain()         { _seaParticlesFn('_seaLeafRain',    'earthday'); }
function _seaRecycleFloat()     { _seaRunnerFn('_seaRecycleFloat',   'earthday',  20, 40); }

// ══════════════════════════════════════════════════════════
// RAMADAN / EID
// ══════════════════════════════════════════════════════════
function _seaCrescentMoon()     { _seaPopupFn('_seaCrescentMoon',    'ramadan'); }
function _seaStarAndMoon()      { _seaParticlesFn('_seaStarAndMoon', 'ramadan'); }
function _seaLampFloat()        { _seaRunnerFn('_seaLampFloat',      'ramadan',   25, 30); }

// ══════════════════════════════════════════════════════════
// MAY DAY (May 1)
// ══════════════════════════════════════════════════════════
function _seaFlowerShower()     { _seaParticlesFn('_seaFlowerShower','mayday'); }
function _seaRibbonDance()      { _seaRunnerFn('_seaRibbonDance',   'mayday',    20, 40); }
function _seaMayPopup()         { _seaPopupFn('_seaMayPopup',        'mayday'); }

// ══════════════════════════════════════════════════════════
// STAR WARS DAY (May 4)
// ══════════════════════════════════════════════════════════
function _seaStarWarsCrawl() {
    if (_seaGetAnimCfg('_seaStarWarsCrawl', 'starwarsday').enabled === false) return;
    var wrap = _seaDiv('', 'inset:0;display:flex;align-items:flex-end;justify-content:center;pointer-events:none;overflow:hidden;perspective:300px;');
    wrap.style.zIndex = '9000';
    var inner = document.createElement('div');
    inner.className = 'sw-crawl-inner';
    inner.innerHTML = '<div class="sw-crawl-text">A long time ago, in an office far, far away&hellip;<br><br><b>IT IS A PERIOD OF ESTIMATION.</b><br><br>Planning sessions, spreading across the sprint, have begun to strike back against vague requirements&hellip;</div>';
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    _seaRemove(wrap, 8000);
}

function _seaSaberCross()       { _seaRunnerFn('_seaSaberCross',     'starwarsday', 40, 20); }
function _seaGalaxyParticles()  { _seaParticlesFn('_seaGalaxyParticles','starwarsday'); }
function _seaMayTheFourth()     { _seaPopupFn('_seaMayTheFourth',    'starwarsday'); }
function _seaSpaceshipFly()     { _seaRunnerFn('_seaSpaceshipFly',   'starwarsday', 10, 20); }

// ══════════════════════════════════════════════════════════
// PRIDE (June)
// ══════════════════════════════════════════════════════════
function _seaRainbowParticles() { _seaParticlesFn('_seaRainbowParticles','pride'); }
function _seaRainbowFlag()      { _seaRunnerFn('_seaRainbowFlag',    'pride',     15, 30); }
function _seaPrideHearts()      { _seaParticlesFn('_seaPrideHearts', 'pride'); }

// ══════════════════════════════════════════════════════════
// MLK DAY (3rd Mon in Jan)
// ══════════════════════════════════════════════════════════
function _seaMlkMarch()         { _seaRunnerFn('_seaMlkMarch',       'mlkday',    20, 20); }
function _seaMlkDoves()         { _seaParticlesFn('_seaMlkDoves',    'mlkday'); }
function _seaMlkPopup()         { _seaPopupFn('_seaMlkPopup',        'mlkday'); }

// ══════════════════════════════════════════════════════════
// PRESIDENTS' DAY (3rd Mon in Feb)
// ══════════════════════════════════════════════════════════
function _seaPresParade()       { _seaRunnerFn('_seaPresParade',     'presidentsday', 20, 30); }
function _seaPresStars()        { _seaParticlesFn('_seaPresStars',   'presidentsday'); }
function _seaPresPopup()        { _seaPopupFn('_seaPresPopup',       'presidentsday'); }

// ══════════════════════════════════════════════════════════
// MOTHERING SUNDAY UK (Easter −21 days)
// ══════════════════════════════════════════════════════════
function _seaMotheringFlowers() { _seaParticlesFn('_seaMotheringFlowers','motheringsunday'); }
function _seaMotheringLove()    { _seaParticlesFn('_seaMotheringLove',  'motheringsunday'); }
function _seaMotheringPop()     { _seaPopupFn('_seaMotheringPop',        'motheringsunday'); }

// ══════════════════════════════════════════════════════════
// MOTHER'S DAY US (2nd Sun in May)
// ══════════════════════════════════════════════════════════
function _seaMomFlowers()       { _seaParticlesFn('_seaMomFlowers',  'mothersday'); }
function _seaMomHeart()         { _seaParticlesFn('_seaMomHeart',    'mothersday'); }
function _seaMomPopup()         { _seaPopupFn('_seaMomPopup',        'mothersday'); }

// ══════════════════════════════════════════════════════════
// MEMORIAL DAY US (last Mon in May)
// ══════════════════════════════════════════════════════════
function _seaMemPoppies()       { _seaParticlesFn('_seaMemPoppies',  'memorialday'); }
function _seaMemFlag()          { _seaRunnerFn('_seaMemFlag',        'memorialday', 15, 20); }
function _seaMemPopup()         { _seaPopupFn('_seaMemPopup',        'memorialday'); }

// ══════════════════════════════════════════════════════════
// JUNETEENTH (Jun 19)
// ══════════════════════════════════════════════════════════
function _seaJuneteenthParade() { _seaRunnerFn('_seaJuneteenthParade','juneteenth', 20, 20); }
function _seaJuneteenthBurst()  { _seaParticlesFn('_seaJuneteenthBurst','juneteenth'); }
function _seaJuneteenthPop()    { _seaPopupFn('_seaJuneteenthPop',   'juneteenth'); }

// ══════════════════════════════════════════════════════════
// FATHER'S DAY US (3rd Sun in Jun)
// ══════════════════════════════════════════════════════════
function _seaDadParade()        { _seaRunnerFn('_seaDadParade',      'fathersday', 20, 30); }
function _seaDadBalloons()      { _seaParticlesFn('_seaDadBalloons', 'fathersday'); }
function _seaDadPopup()         { _seaPopupFn('_seaDadPopup',        'fathersday'); }

// ══════════════════════════════════════════════════════════
// OCEAN WEEK (Jun 8–15)
// ══════════════════════════════════════════════════════════
function _seaSharkSwim() {
    if (_seaGetAnimCfg('_seaSharkSwim', 'oceanweek').enabled === false) return;
    _seaSharkFin();
}
function _seaFishSchool()       { _seaRunnerFn('_seaFishSchool',     'oceanweek', 60, 20); }
function _seaOceanParticles()   { _seaParticlesFn('_seaOceanParticles','oceanweek'); }

// ══════════════════════════════════════════════════════════
// SUMMER SOLSTICE (Jun 20–22)
// ══════════════════════════════════════════════════════════
function _seaBigSun()           { _seaPopupFn('_seaBigSun',          'solstice'); }
function _seaSunRays()          { _seaParticlesFn('_seaSunRays',     'solstice'); }
function _seaSolsticeGlow() {
    if (_seaGetAnimCfg('_seaSolsticeGlow', 'solstice').enabled === false) return;
    _seaSummerSun();
}

// ══════════════════════════════════════════════════════════
// INDEPENDENCE DAY (Jul 4) — USA + British tea joke
// ══════════════════════════════════════════════════════════
function _seaFlagParade()       { _seaRunnerFn('_seaFlagParade',     'independence', 20, 30); }
function _seaFireworks4th()     { _seaParticlesFn('_seaFireworks4th','independence'); }
function _seaEagleSoar()        { _seaRunnerFn('_seaEagleSoar',      'independence', 15, 20); }
function _seaFlagPop()          { _seaPopupFn('_seaFlagPop',         'independence'); }
function _seaTeapotRun()        { _seaRunnerFn('_seaTeapotRun',      'independence', 30, 20); }
function _seaTeacupParticles()  { _seaParticlesFn('_seaTeacupParticles','independence'); }
function _seaTeaPopup()         { _seaPopupFn('_seaTeaPopup',        'independence'); }

// ══════════════════════════════════════════════════════════
// TANABATA (Jul 7)
// ══════════════════════════════════════════════════════════
function _seaBambooWish()       { _seaCornerFn('_seaBambooWish',     'tanabata'); }
function _seaShootingStarT()    { _seaRunnerFn('_seaShootingStarT',  'tanabata',  10, 20); }
function _seaTanabataStars()    { _seaParticlesFn('_seaTanabataStars','tanabata'); }

// ══════════════════════════════════════════════════════════
// BASTILLE DAY (Jul 14)
// ══════════════════════════════════════════════════════════
function _seaTricolorParticles(){ _seaParticlesFn('_seaTricolorParticles','bastille'); }
function _seaFireworksBastille(){ _seaRunnerFn('_seaFireworksBastille','bastille',  15, 30); }
function _seaEiffelTower()      { _seaPopupFn('_seaEiffelTower',     'bastille'); }

// ══════════════════════════════════════════════════════════
// AUG BANK HOLIDAY
// ══════════════════════════════════════════════════════════
function _seaWeatherMix()       { _seaParticlesFn('_seaWeatherMix',  'augbankholiday'); }
function _seaBaggage()          { _seaCornerFn('_seaBaggage',        'augbankholiday'); }
function _seaHolidayPop()       { _seaPopupFn('_seaHolidayPop',      'augbankholiday'); }

// ══════════════════════════════════════════════════════════
// LABOR DAY US (1st Mon in Sep)
// ══════════════════════════════════════════════════════════
function _seaLaborParade()      { _seaRunnerFn('_seaLaborParade',    'laborday',  20, 30); }
function _seaLaborTools()       { _seaParticlesFn('_seaLaborTools',  'laborday'); }
function _seaLaborPopup()       { _seaPopupFn('_seaLaborPopup',      'laborday'); }

// ══════════════════════════════════════════════════════════
// BACK TO SCHOOL (Sep 1–10)
// ══════════════════════════════════════════════════════════
function _seaPencilRun()        { _seaRunnerFn('_seaPencilRun',      'backtoschool', 30, 30); }
function _seaBookFall()         { _seaParticlesFn('_seaBookFall',    'backtoschool'); }
function _seaBackpackPop()      { _seaPopupFn('_seaBackpackPop',     'backtoschool'); }

// ══════════════════════════════════════════════════════════
// OKTOBERFEST (Sep 15–Oct 1)
// ══════════════════════════════════════════════════════════
function _seaBeerParade()       { _seaRunnerFn('_seaBeerParade',     'oktoberfest', 30, 30); }
function _seaMusicNotes()       { _seaParticlesFn('_seaMusicNotes',  'oktoberfest'); }
function _seaBeerMugPop()       { _seaPopupFn('_seaBeerMugPop',      'oktoberfest'); }

// ══════════════════════════════════════════════════════════
// MID-AUTUMN
// ══════════════════════════════════════════════════════════
function _seaMooncakeParticles(){ _seaParticlesFn('_seaMooncakeParticles','midautumn'); }
function _seaLanternFloat()     { _seaRunnerFn('_seaLanternFloat',   'midautumn', 20, 30); }
function _seaFullMoonMidAut() {
    if (_seaGetAnimCfg('_seaFullMoonMidAut', 'midautumn').enabled === false) return;
    _seaHarvestMoon();
}

// ══════════════════════════════════════════════════════════
// SPACE WEEK (Oct 4–10)
// ══════════════════════════════════════════════════════════
function _seaRocketLaunch()     { _seaRunnerFn('_seaRocketLaunch',   'spaceweek',  5, 15); }
function _seaSpaceParticles()   { _seaParticlesFn('_seaSpaceParticles','spaceweek'); }
function _seaAstronautPop()     { _seaPopupFn('_seaAstronautPop',    'spaceweek'); }

// ══════════════════════════════════════════════════════════
// INDIGENOUS PEOPLES' DAY (2nd Mon in Oct)
// ══════════════════════════════════════════════════════════
function _seaIndigenousFeathers() { _seaParticlesFn('_seaIndigenousFeathers','indigenousday'); }
function _seaIndigenousEagle()    { _seaRunnerFn('_seaIndigenousEagle','indigenousday', 10, 20); }
function _seaIndigenousPop()      { _seaPopupFn('_seaIndigenousPop', 'indigenousday'); }

// ══════════════════════════════════════════════════════════
// DAY OF THE DEAD (Nov 1–2)
// ══════════════════════════════════════════════════════════
function _seaSkullFlowers()     { _seaParticlesFn('_seaSkullFlowers','dayofthedead'); }
function _seaCandleFlight()     { _seaRunnerFn('_seaCandleFlight',   'dayofthedead', 30, 30); }
function _seaDayDeadPop()       { _seaPopupFn('_seaDayDeadPop',      'dayofthedead'); }

// ══════════════════════════════════════════════════════════
// VETERANS DAY US (Nov 11) — priority 1 beats Remembrance Day
// ══════════════════════════════════════════════════════════
function _seaVetFlag()          { _seaRunnerFn('_seaVetFlag',        'veteransday', 20, 20); }
function _seaVetMedals()        { _seaParticlesFn('_seaVetMedals',   'veteransday'); }
function _seaVetPopup()         { _seaPopupFn('_seaVetPopup',        'veteransday'); }

// ══════════════════════════════════════════════════════════
// BONFIRE NIGHT (Nov 5)
// ══════════════════════════════════════════════════════════
function _seaBonfireFireworks() { _seaRunnerFn('_seaBonfireFireworks','bonfirenight', 10, 20); }
function _seaSparkleParticles() { _seaParticlesFn('_seaSparkleParticles','bonfirenight'); }
function _seaBonfireExplosion() { _seaPopupFn('_seaBonfireExplosion','bonfirenight'); }

// ══════════════════════════════════════════════════════════
// DIWALI
// ══════════════════════════════════════════════════════════
function _seaDiwaLamps()        { _seaParticlesFn('_seaDiwaLamps',   'diwali'); }
function _seaDiwaFireworks()    { _seaRunnerFn('_seaDiwaFireworks',  'diwali',    10, 25); }
function _seaDiwaGlow()         { _seaPopupFn('_seaDiwaGlow',        'diwali'); }

// ══════════════════════════════════════════════════════════
// REMEMBRANCE DAY (Nov 11)
// ══════════════════════════════════════════════════════════
function _seaRembPoppyFall()    { _seaParticlesFn('_seaRembPoppyFall','remembrance'); }
function _seaRembPoppyPopup()   { _seaPopupFn('_seaRembPoppyPopup', 'remembrance'); }
function _seaDoveFlight()       { _seaRunnerFn('_seaDoveFlight',     'remembrance', 20, 30); }

// ══════════════════════════════════════════════════════════
// BOXING DAY (Dec 26)
// ══════════════════════════════════════════════════════════
function _seaGiftRun()          { _seaRunnerFn('_seaGiftRun',        'boxingday',  30, 30); }
function _seaShoppingBag()      { _seaParticlesFn('_seaShoppingBag', 'boxingday'); }
function _seaBoxingPopup()      { _seaPopupFn('_seaBoxingPopup',     'boxingday'); }

// ══════════════════════════════════════════════════════════
// WINTER SOLSTICE (Dec 21)
// ══════════════════════════════════════════════════════════
function _seaWinterSnowfall() {
    if (_seaGetAnimCfg('_seaWinterSnowfall', 'wintersolstice').enabled === false) return;
    _seaSnowfall();
}
function _seaNightSky()         { _seaPopupFn('_seaNightSky',        'wintersolstice'); }
function _seaSolsticeSnowman()  { _seaCornerFn('_seaSolsticeSnowman','wintersolstice'); }

// ══════════════════════════════════════════════════════════
// END OF YEAR (Dec 27–30)
// ══════════════════════════════════════════════════════════
function _seaEndCountdown()     { _seaPopupFn('_seaEndCountdown',    'endofyear'); }
function _seaEndParticles()     { _seaParticlesFn('_seaEndParticles','endofyear'); }
function _seaYearReview()       { _seaRunnerFn('_seaYearReview',     'endofyear',  20, 40); }

// ══════════════════════════════════════════════════════════
// Animation registry — at least 10 per season
// ══════════════════════════════════════════════════════════
var SEA_ANIMS = {
    halloween:      [_seaGhostJumpscare, _seaBatSwarm, _seaWitchFly, _seaSpiderDrop, _seaPumpkinRoll,
                     _seaSkullFloat, _seaCauldronBubble, _seaLightningFlash, _seaBlackCatRun,
                     _seaHandFromGrave, _seaSkeletonDance, _seaFlyingEye],
    christmas:      [_seaSantaSleigh, _seaSnowfall, _seaElfRun, _seaPresentBounce, _seaSnowmanWave,
                     _seaShootingStar, _seaSnowflakeSpin, _seaReindeerFly, _seaChristmasTree,
                     _seaChristmasBells, _seaGiftDropFromSky],
    newyear:        [_seaChampagnePop, _seaNewYearBanner, _seaSparkler, _seaTopHatFloat, _seaPartyPopper,
                     _seaGlitterBall, _seaCountdownClock, _seaStreamers, _seaToastClink, _seaFireworksEmoji],
    valentine:      [_seaHeartsRise, _seaCupidFly, _seaRoseBlooms, _seaLoveLetter, _seaArrowShoot,
                     _seaHeartBurst, _seaTeddyBear, _seaPinkBubbles, _seaChocolateBox, _seaKissMark],
    spring:         [_seaButterflyFloat, _seaFlowerGrow, _seaCherryBlossom, _seaRainbow, _seaBeeWobble,
                     _seaChickHatch, _seaBunnyHop, _seaAprilShowers, _seaSunPeek, _seaHeartsRise],
    summer:         [_seaSummerSun, _seaBeachBallBounce, _seaWaveWash, _seaSunglassesSlide, _seaFireflies,
                     _seaWatermelonRoll, _seaIceCreamDrip, _seaSharkFin, _seaHeatWave, _seaIceCreamTruck],
    autumn:         [_seaLeavesSwirl, _seaOwlBlink, _seaFoxRun, _seaAcornDrop, _seaFogRoll,
                     _seaMushroomGrow, _seaHarvestMoon, _seaScarecrow, _seaCiderMug, _seaSpiderWebCorner,
                     _seaBatSwarm],
    thanksgiving:   [_seaTurkeyRun, _seaPieCooling, _seaCornucopia, _seaThanksgivingLeaves, _seaPilgrimHatFloat,
                     _seaHarvestWagon, _seaAppleRoll, _seaCornStalk, _seaFeastTable, _seaHayBale],
    deepwinter:     [_seaDeepWinterSnow, _seaFrostCreep, _seaBlizzard, _seaSnowflakeSpin],
    lunarnew:       [_seaDragonFly, _seaLanternRise, _seaRedEnvelopes, _seaFirecracker],
    awards:         [_seaTrophyPopup, _seaStarWalk, _seaGoldParticles],
    pancakeday:     [_seaPancakeStack, _seaLemonSlice, _seaPancakeToss],
    piday:          [_seaPiSymbol, _seaPieRoll, _seaMathParticles],
    stpatricks:     [_seaShamrockShower, _seaRainbowArc, _seaGoldPot],
    holi:           [_seaColorBurst, _seaHoliSplash, _seaColorRain],
    hanami:         [_seaHanamiBlossoms, _seaPetalDrift, _seaBlossomTree],
    aprilfools:     [_seaGlitchEffect, _seaFakeAlert, _seaJokerCard],
    earthday:       [_seaEarthSpin, _seaLeafRain, _seaRecycleFloat],
    ramadan:        [_seaCrescentMoon, _seaStarAndMoon, _seaLampFloat],
    mayday:         [_seaFlowerShower, _seaRibbonDance, _seaMayPopup],
    starwarsday:    [_seaStarWarsCrawl, _seaSaberCross, _seaGalaxyParticles, _seaMayTheFourth, _seaSpaceshipFly],
    pride:          [_seaRainbowParticles, _seaRainbowFlag, _seaPrideHearts],
    oceanweek:      [_seaSharkFin, _seaFishSchool, _seaOceanParticles],
    solstice:       [_seaBigSun, _seaSunRays, _seaSolsticeGlow],
    mlkday:         [_seaMlkMarch, _seaMlkDoves, _seaMlkPopup],
    presidentsday:  [_seaPresParade, _seaPresStars, _seaPresPopup],
    motheringsunday:[_seaMotheringFlowers, _seaMotheringLove, _seaMotheringPop],
    mothersday:     [_seaMomFlowers, _seaMomHeart, _seaMomPopup],
    memorialday:    [_seaMemPoppies, _seaMemFlag, _seaMemPopup],
    juneteenth:     [_seaJuneteenthParade, _seaJuneteenthBurst, _seaJuneteenthPop],
    fathersday:     [_seaDadParade, _seaDadBalloons, _seaDadPopup],
    laborday:       [_seaLaborParade, _seaLaborTools, _seaLaborPopup],
    indigenousday:  [_seaIndigenousFeathers, _seaIndigenousEagle, _seaIndigenousPop],
    veteransday:    [_seaVetFlag, _seaVetMedals, _seaVetPopup],
    independence:   [_seaFlagParade, _seaFireworks4th, _seaEagleSoar, _seaFlagPop, _seaTeapotRun, _seaTeacupParticles, _seaTeaPopup],
    tanabata:       [_seaBambooWish, _seaShootingStarT, _seaTanabataStars],
    bastille:       [_seaTricolorParticles, _seaFireworksBastille, _seaEiffelTower],
    augbankholiday: [_seaWeatherMix, _seaBaggage, _seaHolidayPop],
    backtoschool:   [_seaPencilRun, _seaBookFall, _seaBackpackPop],
    oktoberfest:    [_seaBeerParade, _seaMusicNotes, _seaBeerMugPop],
    midautumn:      [_seaMooncakeParticles, _seaLanternFloat, _seaFullMoonMidAut],
    spaceweek:      [_seaRocketLaunch, _seaSpaceParticles, _seaAstronautPop],
    dayofthedead:   [_seaSkullFlowers, _seaCandleFlight, _seaDayDeadPop],
    bonfirenight:   [_seaBonfireFireworks, _seaSparkleParticles, _seaBonfireExplosion],
    diwali:         [_seaDiwaLamps, _seaDiwaFireworks, _seaDiwaGlow],
    remembrance:    [_seaRembPoppyFall, _seaRembPoppyPopup, _seaDoveFlight],
    boxingday:      [_seaGiftRun, _seaShoppingBag, _seaBoxingPopup],
    wintersolstice: [_seaWinterSnowfall, _seaNightSky, _seaSolsticeSnowman],
    endofyear:      [_seaEndCountdown, _seaEndParticles, _seaYearReview]
};

// ══════════════════════════════════════════════════════════
// PER-SEASON CONFIG MODAL
// ══════════════════════════════════════════════════════════

var _seaConfigSeasonKey = null;

function openSeasonConfig(seasonKey, label) {
    _seaConfigSeasonKey = seasonKey;
    var animKeys = (SEA_ANIMS[seasonKey] || []).map(function(fn) { return fn.name; });
    var mults = _seaGetSeasonMults(seasonKey);

    var html = '<div class="mb-3 d-flex gap-3 flex-wrap align-items-center">'
        + '<label class="d-flex align-items-center gap-2 small">⚡ Speed <input type="range" id="seaCfgSpeed" min="0.3" max="2.5" step="0.1" value="' + mults.speed + '" style="width:90px"> <span id="seaCfgSpeedVal">' + mults.speed + 'x</span></label>'
        + '<label class="d-flex align-items-center gap-2 small">✨ Intensity <input type="range" id="seaCfgIntensity" min="0.2" max="2.5" step="0.1" value="' + mults.intensity + '" style="width:90px"> <span id="seaCfgIntensityVal">' + mults.intensity + 'x</span></label>'
        + '</div><hr class="my-2">';

    animKeys.forEach(function(fnName) {
        var c = _seaGetAnimCfg(fnName, seasonKey);
        html += _seaBuildAnimRow(fnName, c);
    });

    document.getElementById('seaConfigModalLabel').textContent = '⚙️ ' + label;
    document.getElementById('seaConfigModalBody').innerHTML = html;

    document.getElementById('seaCfgSpeed').oninput = function() { document.getElementById('seaCfgSpeedVal').textContent = (+this.value).toFixed(1) + 'x'; };
    document.getElementById('seaCfgIntensity').oninput = function() { document.getElementById('seaCfgIntensityVal').textContent = (+this.value).toFixed(1) + 'x'; };

    bootstrap.Modal.getOrCreateInstance(document.getElementById('seaConfigModal')).show();
    setTimeout(function() { if (typeof _epAutoAttach === 'function') _epAutoAttach(); }, 100);
}

function _seaBuildAnimRow(fnName, c) {
    var safe = fnName.replace(/[^a-zA-Z0-9]/g, '_');
    var row = '<div class="sea-cfg-row mb-2 p-2 border rounded"><div class="d-flex align-items-center gap-2 mb-1">'
        + '<input type="checkbox" id="scfg_en_' + safe + '"' + (c.enabled !== false ? ' checked' : '') + '>'
        + '<strong class="small">' + (c.name || fnName) + '</strong>'
        + '<span class="badge bg-secondary ms-auto" style="font-size:0.65rem;">' + (c.type || 'custom') + '</span>'
        + '</div>';
    if (c.type === 'runner') {
        var ms = c.motionStyle || (c.wave === true ? 'wave' : (c.wave === false ? 'none' : 'wave'));
        var msOpts = ['none','wave','bounce','hop','spin','run','wobble','zigzag'].map(function(o) {
            return '<option value="' + o + '"' + (ms === o ? ' selected' : '') + '>' + o + '</option>';
        }).join('');
        row += '<div class="d-flex flex-wrap gap-2 align-items-center" style="font-size:0.78rem;">'
            + 'Emoji <input type="text" id="scfg_emoji_' + safe + '" data-picker-target="scfg_emoji_' + safe + '" value="' + (c.emoji || '') + '" style="width:90px;font-size:0.85rem;" class="form-control form-control-sm d-inline-block">'
            + ' Dir <select id="scfg_dir_' + safe + '" class="form-select form-select-sm d-inline-block" style="width:70px"><option value="lr"' + (c.dir === 'lr' ? ' selected' : '') + '>LR</option><option value="rl"' + (c.dir === 'rl' ? ' selected' : '') + '>RL</option></select>'
            + ' Size <input type="text" id="scfg_size_' + safe + '" value="' + (c.size || '3rem') + '" style="width:65px" class="form-control form-control-sm d-inline-block">'
            + ' Dur <input type="number" id="scfg_dur_' + safe + '" value="' + (c.dur || 5) + '" min="0.5" max="20" step="0.5" style="width:60px" class="form-control form-control-sm d-inline-block">s'
            + ' <label class="small"><input type="checkbox" id="scfg_flipx_' + safe + '"' + (c.flipX ? ' checked' : '') + '> Flip</label>'
            + ' Motion <select id="scfg_ms_' + safe + '" class="form-select form-select-sm d-inline-block" style="width:90px">' + msOpts + '</select>'
            + ' <button type="button" class="btn btn-outline-secondary btn-sm" onclick="testSeasonAnim(\'' + fnName + '\')">🧪</button>'
            + '</div>';
    } else if (c.type === 'particles') {
        row += '<div class="d-flex flex-wrap gap-2 align-items-center" style="font-size:0.78rem;">'
            + 'Chars <input type="text" id="scfg_chars_' + safe + '" value="' + ((c.chars || []).join(', ')) + '" style="width:180px" class="form-control form-control-sm d-inline-block" placeholder="emoji, emoji, ...">'
            + ' Count <input type="number" id="scfg_count_' + safe + '" value="' + (c.count || 15) + '" min="1" max="100" style="width:60px" class="form-control form-control-sm d-inline-block">'
            + '</div>';
    } else if (c.type === 'popup') {
        row += '<div class="d-flex flex-wrap gap-2 align-items-center" style="font-size:0.78rem;">'
            + 'Emoji <input type="text" id="scfg_emoji_' + safe + '" data-picker-target="scfg_emoji_' + safe + '" value="' + (c.emoji || '') + '" style="width:90px" class="form-control form-control-sm d-inline-block">'
            + ' Size <input type="text" id="scfg_size_' + safe + '" value="' + (c.size || '7rem') + '" style="width:65px" class="form-control form-control-sm d-inline-block">'
            + '</div>';
    } else if (c.type === 'corner') {
        row += '<div class="d-flex flex-wrap gap-2 align-items-center" style="font-size:0.78rem;">'
            + 'Emoji <input type="text" id="scfg_emoji_' + safe + '" data-picker-target="scfg_emoji_' + safe + '" value="' + (c.emoji || '') + '" style="width:90px" class="form-control form-control-sm d-inline-block">'
            + ' Side <select id="scfg_side_' + safe + '" class="form-select form-select-sm d-inline-block" style="width:90px">'
            + '<option value="left"' + (c.side === 'left' ? ' selected' : '') + '>Left</option>'
            + '<option value="right"' + (c.side === 'right' ? ' selected' : '') + '>Right</option>'
            + '<option value="random"' + (!c.side || c.side === 'random' ? ' selected' : '') + '>Random</option></select>'
            + '</div>';
    } else {
        row += '<div class="small text-muted">Complex animation — only enable/disable available.</div>';
    }
    return row + '</div>';
}

function testSeasonAnim(fnName) {
    var fn = window[fnName];
    if (typeof fn === 'function') fn();
}

function saveSeasonConfig() {
    var key = _seaConfigSeasonKey;
    var animKeys = (SEA_ANIMS[key] || []).map(function(fn) { return fn.name; });
    var overrides = {};
    animKeys.forEach(function(fnName) {
        var safe = fnName.replace(/[^a-zA-Z0-9]/g, '_');
        var meta = SEA_ANIM_META[fnName] || {};
        var enEl = document.getElementById('scfg_en_' + safe);
        var o = { enabled: enEl ? !!enEl.checked : true };
        if (meta.type === 'runner') {
            o.emoji = document.getElementById('scfg_emoji_' + safe).value;
            o.dir   = document.getElementById('scfg_dir_' + safe).value;
            o.size  = document.getElementById('scfg_size_' + safe).value;
            o.dur   = parseFloat(document.getElementById('scfg_dur_' + safe).value) || meta.dur;
            o.flipX = document.getElementById('scfg_flipx_' + safe).checked;
            var msEl = document.getElementById('scfg_ms_' + safe);
            o.motionStyle = msEl ? msEl.value : (meta.motionStyle || 'wave');
        } else if (meta.type === 'particles') {
            o.chars = document.getElementById('scfg_chars_' + safe).value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            o.count = parseInt(document.getElementById('scfg_count_' + safe).value) || meta.count;
        } else if (meta.type === 'popup') {
            o.emoji = document.getElementById('scfg_emoji_' + safe).value;
            o.size  = document.getElementById('scfg_size_' + safe).value;
        } else if (meta.type === 'corner') {
            o.emoji = document.getElementById('scfg_emoji_' + safe).value;
            o.side  = document.getElementById('scfg_side_' + safe).value;
        }
        overrides[fnName] = o;
    });
    localStorage.setItem('sea_spd_' + key, document.getElementById('seaCfgSpeed').value);
    localStorage.setItem('sea_int_' + key, document.getElementById('seaCfgIntensity').value);
    _seaSaveSeasonCfg(key, overrides);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('seaConfigModal')).hide();
}

function resetSeasonConfig() {
    _seaResetSeasonCfg(_seaConfigSeasonKey);
    var label = document.getElementById('seaConfigModalLabel').textContent.replace('⚙️ ', '');
    openSeasonConfig(_seaConfigSeasonKey, label);
}

function saveSeaFreq() {
    var minEl = document.getElementById('seaFreqMin');
    var maxEl = document.getElementById('seaFreqMax');
    if (!minEl || !maxEl) return;
    var min = parseInt(minEl.value) || 22;
    var max = parseInt(maxEl.value) || 55;
    if (max < min) max = min;
    localStorage.setItem('es_seaFreq', JSON.stringify({ min: min, max: max }));
}

function exportSeasonalConfig() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('sea_') || k.startsWith('cel-seasonal') || k === 'es_seaFreq' || k === 'es_customSeasons')) {
            data[k] = localStorage.getItem(k);
        }
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'es-seasons-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function importSeasonalConfig() {
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
                Object.keys(data).forEach(function(k) {
                    localStorage.setItem(k, data[k]);
                });
                if (typeof _seaInjectCustomSeasons === 'function') _seaInjectCustomSeasons();
                alert('Seasonal config imported! Reload the page to see all changes.');
            } catch(ex) {
                alert('Import failed: invalid JSON file.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function _seaAddConfigButtons() {
    document.querySelectorAll('.sea-row').forEach(function(row) {
        if (row.querySelector('.sea-cfg-btn')) return;
        var check = row.querySelector('.sea-check');
        if (!check) return;
        var key = check.id.replace('cel-seasonal-', '');
        if (!SEA_ANIMS[key]) return;
        var label = (row.querySelector('label') || {}).textContent || key;
        var btn = document.createElement('button');
        btn.className = 'sea-cfg-btn btn btn-outline-secondary';
        btn.style.cssText = 'font-size:0.65rem;padding:1px 5px;line-height:1.5;';
        btn.textContent = '⚙️';
        btn.title = 'Configure individual animations';
        btn.type = 'button';
        btn.onclick = function(e) { e.stopPropagation(); openSeasonConfig(key, label); };
        row.appendChild(btn);
    });
}
