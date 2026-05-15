// ============================================================
// EstimationStation — Seasonal Ambient Animations
// Fires random on-screen animations based on real-world date.
// Call startSeasonalAmbience() on room init; stopSeasonalAmbience() on leave.
// ============================================================

var _seaTimer    = null;
var _seaActive   = false;
var _seaRafIds   = [];
var SEA_Z = 9980;

function startSeasonalAmbience() {
    if (_seaActive) return;
    _seaActive = true;
    _seaScheduleNext(true);
}
function stopSeasonalAmbience() {
    _seaActive = false;
    if (_seaTimer) { clearTimeout(_seaTimer); _seaTimer = null; }
    _seaRafIds.forEach(function(id) { cancelAnimationFrame(id); });
    _seaRafIds = [];
}
function _seaScheduleNext(firstTime) {
    if (!_seaActive) return;
    var min = firstTime ? 8000 : 22000;
    var max = firstTime ? 18000 : 55000;
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
    var list = SEA_ANIMS[season];
    if (!list || !list.length) return;
    try { list[Math.floor(Math.random() * list.length)](); } catch (e) { }
}
function _seaGetSeason() {
    var m = new Date().getMonth() + 1, d = new Date().getDate();
    if (m === 10)                         return 'halloween';
    if (m === 12 || (m === 1 && d <= 5))  return 'christmas';
    if (m === 1  && d <= 10)              return 'newyear';
    if (m === 2  && d >= 12 && d <= 16)   return 'valentine';
    if (m >= 3   && m <= 5)               return 'spring';
    if (m >= 6   && m <= 8)               return 'summer';
    if (m === 9)                          return 'autumn';
    if (m === 11 && d >= 20)              return 'thanksgiving';
    return null;
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
    inner.textContent = emoji;
    inner.style.animation = 'sea-popup-in 0.45s ease-out forwards';
    wrap.appendChild(inner);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.4s ease-in forwards';
        _seaRemove(wrap, 460);
    }, holdMs || 2200);
}
// Left → right cross-screen with optional inner wave
function _seaLR(emoji, topPct, size, dur, waveIt) {
    dur = dur || 5;
    var wrap = _seaDiv('', 'top:' + topPct + '%;left:0;animation:sea-lr ' + dur + 's linear forwards;' + (waveIt ? '' : 'font-size:' + (size||'2.5rem') + ';'));
    if (waveIt) {
        var inner = document.createElement('div');
        inner.textContent = emoji;
        inner.style.cssText = 'font-size:' + (size||'2.5rem') + ';display:inline-block;animation:sea-wave-y ' + (0.3 + Math.random() * 0.25) + 's ease-in-out infinite alternate;';
        wrap.appendChild(inner);
    } else { wrap.innerHTML = emoji; }
    _seaRemove(wrap, dur * 1000 + 300);
}
// Right → left cross-screen with optional wave
function _seaRL(emoji, topPct, size, dur, waveIt) {
    dur = dur || 5;
    var wrap = _seaDiv('', 'top:' + topPct + '%;right:0;animation:sea-rl ' + dur + 's linear forwards;' + (waveIt ? '' : 'font-size:' + (size||'2.5rem') + ';'));
    if (waveIt) {
        var inner = document.createElement('div');
        inner.textContent = emoji;
        inner.style.cssText = 'font-size:' + (size||'2.5rem') + ';display:inline-block;animation:sea-wave-y ' + (0.3 + Math.random() * 0.25) + 's ease-in-out infinite alternate;';
        wrap.appendChild(inner);
    } else { wrap.innerHTML = emoji; }
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
// HALLOWEEN (October)
// ══════════════════════════════════════════════════════════

function _seaGhostJumpscare() {
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:10rem;');
    var inner = document.createElement('div');
    inner.textContent = '👻';
    inner.style.animation = 'sea-popup-in 0.38s ease-out forwards';
    wrap.appendChild(inner);
    // Shake briefly
    setTimeout(function() {
        wrap.style.animation = 'sea-wobble 0.08s ease-in-out 6';
    }, 600);
    setTimeout(function() {
        inner.style.animation = 'sea-popup-out 0.5s ease-in forwards';
        _seaRemove(wrap, 560);
    }, 1600);
}

function _seaBatSwarm() {
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

function _seaWitchFly() {
    var top = 5 + Math.random() * 20;
    _seaRL('🧙‍♀️', top, '3.5rem', 5.5, true);
}

function _seaSpiderDrop() {
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
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 4.5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🎃';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-spin 1.2s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4800);
}

function _seaSkullFloat() {
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('💀', 'bottom:-50px;left:' + left + '%;font-size:3.5rem;animation:sea-float-up 4.5s ease-in forwards;');
    _seaRemove(el, 4800);
}

function _seaCauldronBubble() {
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
    var overlay = _seaDiv('', 'top:0;left:0;width:100%;height:100%;background:#fff;opacity:0;animation:sea-lightning 0.85s ease-in-out forwards;z-index:9988;');
    _seaRemove(overlay, 900);
}

function _seaBlackCatRun() {
    var wrap = _seaDiv('', 'bottom:68px;left:0;animation:sea-lr 3.2s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🐈‍⬛';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.18s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3500);
}

function _seaHandFromGrave() {
    var left = 20 + Math.random() * 60;
    var el = _seaDiv('🫴', 'bottom:0;left:' + left + '%;font-size:4rem;animation:sea-hand-rise 3.5s ease-out forwards;');
    _seaRemove(el, 3700);
}

function _seaSkeletonDance() {
    _seaPopup('💀', '7rem', 2800);
}

function _seaFlyingEye() {
    _seaLR('👁️', 20 + Math.random() * 40, '4rem', 4, true);
}

// ══════════════════════════════════════════════════════════
// CHRISTMAS (Dec–Jan 5)
// ══════════════════════════════════════════════════════════

function _seaSantaSleigh() {
    var wrap = _seaDiv('', 'top:5%;right:0;animation:sea-rl 8s linear forwards;white-space:nowrap;letter-spacing:3px;');
    var inner = document.createElement('div');
    inner.textContent = '🦌🦌🦌🛷🎅';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-wave-y 0.7s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 8300);
}

function _seaSnowfall() {
    _seaParticles(['❄','❅','❆','✦'], 22, 'sea-snowfall', [5, 9], [0.7, 1.8], 2500);
}

function _seaElfRun() {
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 3s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🧝';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.14s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3300);
}

function _seaPresentBounce() {
    var wrap = _seaDiv('', 'bottom:0;left:0;animation:sea-lr 4.5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🎁';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-bounce 0.55s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4800);
}

function _seaSnowmanWave() {
    _seaCorner('<div style="animation:sea-wobble 0.8s ease-in-out infinite;">⛄</div>', '5rem', Math.random() > 0.5 ? 'left' : 'right', 4200);
}

function _seaShootingStar() {
    var top = 5 + Math.random() * 30;
    var el = _seaDiv('⭐', 'top:' + top + '%;right:0;font-size:2.2rem;animation:sea-rl 2.2s ease-in forwards;filter:drop-shadow(0 0 10px #ffffaa);');
    _seaRemove(el, 2500);
}

function _seaSnowflakeSpin() {
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

function _seaReindeerFly() {
    _seaLR('🦌🦌🦌', 10 + Math.random() * 15, '2.8rem', 5.5, true);
}

function _seaChristmasTree() {
    _seaCorner('<div style="animation:sea-tree-glow 0.55s ease-in-out infinite alternate;">🎄</div>', '5.5rem', Math.random() > 0.5 ? 'left' : 'right', 4500);
}

function _seaChristmasBells() {
    _seaPopup('🔔', '6rem', 2500);
}

function _seaGiftDropFromSky() {
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎁', 'top:-50px;left:' + left + '%;font-size:3rem;animation:sea-acorn-drop 2.5s ease-in forwards;');
    _seaRemove(el, 2800);
}

// ══════════════════════════════════════════════════════════
// NEW YEAR (Jan 1–10)
// ══════════════════════════════════════════════════════════

function _seaChampagnePop() {
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
    var side = Math.random() > 0.5 ? 'right:30px;' : 'left:30px;';
    var el = _seaDiv('✨', 'bottom:100px;' + side + 'font-size:5.5rem;animation:sea-sparkler 0.6s ease-in-out infinite;');
    setTimeout(function() {
        el.style.animation = 'sea-fade-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4000);
}

function _seaTopHatFloat() {
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎩', 'bottom:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-float-bounce 4s ease-in-out forwards;');
    _seaRemove(el, 4300);
}

function _seaPartyPopper() {
    _seaPopup('🎉', '7rem', 1600);
}

function _seaGlitterBall() {
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
    var clocks = ['🕛','🕐','🕑','🕒','🕓','🕔','🕕'];
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:9rem;');
    var inner = document.createElement('div');
    inner.textContent = clocks[0];
    inner.style.animation = 'sea-popup-in 0.4s ease-out forwards';
    wrap.appendChild(inner);
    var idx = 0;
    var ci = setInterval(function() {
        idx++;
        if (idx < clocks.length) inner.textContent = clocks[idx];
    }, 500);
    setTimeout(function() {
        clearInterval(ci);
        inner.style.animation = 'sea-popup-out 0.4s ease-in forwards';
        _seaRemove(wrap, 460);
    }, 4000);
}

function _seaStreamers() {
    _seaParticles(['🔴','🟡','🔵','🟢','🟣','🟠'], 14, 'sea-streamer', [2, 4], [0.8, 1.5], 2000);
}

function _seaToastClink() {
    _seaPopup('🥂', '7rem', 2400);
}

function _seaFireworksEmoji() {
    var spots = [[20,20],[50,15],[80,25],[30,50],[70,40]];
    spots.forEach(function(pos, i) {
        setTimeout(function() {
            var el = _seaDiv('🎆', 'top:' + pos[1] + '%;left:' + pos[0] + '%;font-size:' + (3 + Math.random() * 2) + 'rem;animation:sea-popup-in 0.4s ease-out forwards;');
            setTimeout(function() {
                el.style.animation = 'sea-popup-out 0.5s ease-in forwards';
                _seaRemove(el, 560);
            }, 1000);
        }, i * 300);
    });
}

// ══════════════════════════════════════════════════════════
// VALENTINE'S (Feb 12–16)
// ══════════════════════════════════════════════════════════

function _seaHeartsRise() {
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

function _seaCupidFly() {
    _seaLR('💘', 10 + Math.random() * 30, '4rem', 4, true);
}

function _seaRoseBlooms() {
    var side = Math.random() > 0.5 ? 'left' : 'right';
    _seaCorner('<div style="animation:sea-flower-grow 1.5s ease-out forwards;display:inline-block;">🌹</div>', '', side, 4000);
}

function _seaLoveLetter() {
    _seaPopup('💌', '7rem', 2400);
}

function _seaArrowShoot() {
    _seaLR('💘', 15 + Math.random() * 50, '3.5rem', 2.2);
}

function _seaHeartBurst() {
    var wrap = _seaDiv('', 'top:50%;left:50%;transform:translate(-50%,-50%);font-size:12rem;');
    var inner = document.createElement('div');
    inner.textContent = '❤️';
    inner.style.animation = 'sea-heart-burst 1.3s ease-out forwards';
    wrap.appendChild(inner);
    _seaRemove(wrap, 1500);
}

function _seaTeddyBear() {
    _seaCorner('<div style="animation:sea-wobble 0.6s ease-in-out infinite;">🧸</div>', '5rem', Math.random() > 0.5 ? 'left' : 'right', 4200);
}

function _seaPinkBubbles() {
    _seaParticles(['🩷','💕','💗','💖'], 10, 'sea-float-up', [3, 5], [1.2, 2.5], 2500);
}

function _seaChocolateBox() {
    _seaPopup('🍫', '6rem', 2200);
}

function _seaKissMark() {
    _seaPopup('💋', '8rem', 2000);
}

// ══════════════════════════════════════════════════════════
// SPRING (March–May)
// ══════════════════════════════════════════════════════════

function _seaButterflyFloat() {
    _seaLR('🦋', 10 + Math.random() * 40, '3rem', 6 + Math.random() * 3, true);
}

function _seaFlowerGrow() {
    var flowers = ['🌸','🌻','🌺','🌼','🌷'];
    var el = _seaDiv(flowers[Math.floor(Math.random() * flowers.length)],
        'bottom:20px;left:' + (20 + Math.random() * 60) + '%;font-size:0.6rem;transform-origin:bottom center;animation:sea-flower-grow 1.6s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-fade-out 1s ease-in forwards';
        _seaRemove(el, 1100);
    }, 4200);
}

function _seaCherryBlossom() {
    _seaParticles(['🌸','🌸','🌺','🌼'], 16, 'sea-petal-fall', [4, 7], [0.7, 1.6], 3000);
}

function _seaRainbow() {
    _seaPopup('🌈', '9rem', 3500);
}

function _seaBeeWobble() {
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
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 4.2s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🐇';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-hop 0.38s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4500);
}

function _seaAprilShowers() {
    _seaParticles(['💧','💧','🌧'], 22, 'sea-rain', [1.4, 2.5], [0.5, 1], 2200);
}

function _seaSunPeek() {
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

function _seaSummerSun() { _seaSunPeek(); }

function _seaBeachBallBounce() {
    var wrap = _seaDiv('', 'bottom:0;left:0;animation:sea-lr 4.8s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🏐';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-bounce 0.5s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5100);
}

function _seaWaveWash() {
    var el = _seaDiv('', 'bottom:0;left:0;width:200%;font-size:3rem;letter-spacing:8px;animation:sea-wave-wash 3.5s ease-in-out forwards;');
    var waves = '';
    for (var i = 0; i < 25; i++) waves += '🌊';
    el.textContent = waves;
    _seaRemove(el, 3800);
}

function _seaSunglassesSlide() {
    var el = _seaDiv('😎', 'top:50%;left:0;transform:translateY(-50%);font-size:9rem;animation:sea-lr 1.8s ease-out forwards;');
    _seaRemove(el, 3500);
}

function _seaFireflies() {
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
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 4.2s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🍉';
    inner.style.cssText = 'font-size:3rem;display:inline-block;animation:sea-spin 0.7s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4500);
}

function _seaIceCreamDrip() {
    var left = 20 + Math.random() * 60;
    var el = _seaDiv('🍦', 'top:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-acorn-drop 3s ease-in forwards;');
    _seaRemove(el, 3300);
}

function _seaSharkFin() {
    _seaLR('🦈', 85 + Math.random() * 8, '3.5rem', 5.5);
}

function _seaHeatWave() {
    var el = _seaDiv('', 'top:0;left:0;width:100%;height:100%;z-index:9975;' +
        'background:linear-gradient(transparent 35%,rgba(255,160,0,0.09) 50%,transparent 65%);' +
        'animation:sea-heat-wave 1.8s ease-in-out 4 forwards;');
    _seaRemove(el, 7500);
}

function _seaIceCreamTruck() {
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

function _seaLeavesSwirl() {
    _seaParticles(['🍁','🍂','🍃','🍁'], 14, 'sea-leaf-fall', [4, 7], [0.9, 2], 2500);
}

function _seaOwlBlink() {
    _seaCorner('<div style="animation:sea-owl-look 1.2s ease-in-out 3;">🦉</div>', '5rem', Math.random() > 0.5 ? 'left' : 'right', 5000);
}

function _seaFoxRun() {
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 3.8s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🦊';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-run 0.2s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4100);
}

function _seaAcornDrop() {
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
    var el = _seaDiv('', 'bottom:0;left:0;width:200%;height:28%;' +
        'background:linear-gradient(to top,rgba(160,160,160,0.32) 0%,transparent 100%);' +
        'animation:sea-fog-roll 6.5s ease-in-out forwards;');
    _seaRemove(el, 6800);
}

function _seaMushroomGrow() {
    var side = Math.random() > 0.5 ? 'left' : 'right';
    _seaCorner('<div style="animation:sea-flower-grow 1.5s ease-out forwards;display:inline-block;">🍄</div>', '', side, 4000);
}

function _seaHarvestMoon() {
    var side = Math.random() > 0.5 ? 'right:80px;' : 'left:80px;';
    var el = _seaDiv('🌕', 'top:-80px;' + side + 'font-size:5.5rem;animation:sea-moon-rise 3.5s ease-out forwards;filter:drop-shadow(0 0 18px rgba(255,210,90,0.7));');
    setTimeout(function() {
        el.style.animation = 'sea-moon-fade 2s ease-in forwards';
        _seaRemove(el, 2200);
    }, 5500);
}

function _seaScarecrow() {
    _seaCorner('<div style="animation:sea-wobble 1.2s ease-in-out infinite;">🪬</div>', '5rem', Math.random() > 0.5 ? 'left' : 'right', 4000);
}

function _seaCiderMug() {
    var el = _seaDiv(
        '<div style="font-size:4.5rem;animation:sea-wobble 2s ease-in-out infinite;">☕</div>' +
        '<div style="font-size:1.3rem;position:absolute;bottom:80%;left:35%;animation:sea-float-up 1.3s ease-in infinite;opacity:0.5;">💨</div>',
        'bottom:20px;left:' + (20 + Math.random() * 60) + '%;animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaSpiderWebCorner() {
    _seaCorner('🕸️', '5.5rem', Math.random() > 0.5 ? 'left' : 'right', 4000);
}

// ══════════════════════════════════════════════════════════
// THANKSGIVING (Nov 20+)
// ══════════════════════════════════════════════════════════

function _seaTurkeyRun() {
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 3.5s ease-in-out forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🦃';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-run 0.16s ease-in-out infinite alternate;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 3800);
}

function _seaPieCooling() {
    var el = _seaDiv(
        '<div style="font-size:4.5rem;">🥧</div>' +
        '<div style="font-size:1.2rem;position:absolute;bottom:80%;left:28%;animation:sea-float-up 1.4s ease-in 0.2s infinite;opacity:0.55;">💨</div>',
        'bottom:20px;left:50%;transform:translateX(-50%);animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 4500);
}

function _seaCornucopia() {
    _seaCorner('🌽🍎🥕🍊', '2.5rem', Math.random() > 0.5 ? 'left' : 'right', 4000);
}

function _seaThanksgivingLeaves() {
    _seaLeavesSwirl();
}

function _seaPilgrimHatFloat() {
    var left = 10 + Math.random() * 80;
    var el = _seaDiv('🎩', 'bottom:-60px;left:' + left + '%;font-size:4.5rem;animation:sea-float-bounce 4.5s ease-in-out forwards;');
    _seaRemove(el, 4800);
}

function _seaHarvestWagon() {
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 5.5s linear forwards;white-space:nowrap;');
    var inner = document.createElement('div');
    inner.textContent = '🌾🌾🌾';
    inner.style.cssText = 'font-size:2.5rem;display:inline-block;animation:sea-wobble 0.5s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5800);
}

function _seaAppleRoll() {
    var wrap = _seaDiv('', 'bottom:65px;right:0;animation:sea-rl 4s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🍎';
    inner.style.cssText = 'font-size:2.8rem;display:inline-block;animation:sea-spin 0.65s linear infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 4300);
}

function _seaCornStalk() {
    _seaCorner('<div style="animation:sea-wobble 1.5s ease-in-out infinite;">🌽</div>', '5.5rem', Math.random() > 0.5 ? 'left' : 'right', 4200);
}

function _seaFeastTable() {
    var el = _seaDiv('🍽️🍗🥧🌽🍎',
        'bottom:20px;left:50%;transform:translateX(-50%);font-size:2.2rem;white-space:nowrap;letter-spacing:6px;' +
        'animation:sea-slide-up-in 0.5s ease-out forwards;');
    setTimeout(function() {
        el.style.animation = 'sea-slide-up-out 0.5s ease-in forwards';
        _seaRemove(el, 600);
    }, 5000);
}

function _seaHayBale() {
    var wrap = _seaDiv('', 'bottom:65px;left:0;animation:sea-lr 5s linear forwards;');
    var inner = document.createElement('div');
    inner.textContent = '🌾';
    inner.style.cssText = 'font-size:3.5rem;display:inline-block;animation:sea-wobble 1s ease-in-out infinite;';
    wrap.appendChild(inner);
    _seaRemove(wrap, 5300);
}

// ══════════════════════════════════════════════════════════
// Animation registry — at least 10 per season
// ══════════════════════════════════════════════════════════
var SEA_ANIMS = {
    halloween:    [_seaGhostJumpscare, _seaBatSwarm, _seaWitchFly, _seaSpiderDrop, _seaPumpkinRoll,
                   _seaSkullFloat, _seaCauldronBubble, _seaLightningFlash, _seaBlackCatRun,
                   _seaHandFromGrave, _seaSkeletonDance, _seaFlyingEye],
    christmas:    [_seaSantaSleigh, _seaSnowfall, _seaElfRun, _seaPresentBounce, _seaSnowmanWave,
                   _seaShootingStar, _seaSnowflakeSpin, _seaReindeerFly, _seaChristmasTree,
                   _seaChristmasBells, _seaGiftDropFromSky],
    newyear:      [_seaChampagnePop, _seaNewYearBanner, _seaSparkler, _seaTopHatFloat, _seaPartyPopper,
                   _seaGlitterBall, _seaCountdownClock, _seaStreamers, _seaToastClink, _seaFireworksEmoji],
    valentine:    [_seaHeartsRise, _seaCupidFly, _seaRoseBlooms, _seaLoveLetter, _seaArrowShoot,
                   _seaHeartBurst, _seaTeddyBear, _seaPinkBubbles, _seaChocolateBox, _seaKissMark],
    spring:       [_seaButterflyFloat, _seaFlowerGrow, _seaCherryBlossom, _seaRainbow, _seaBeeWobble,
                   _seaChickHatch, _seaBunnyHop, _seaAprilShowers, _seaSunPeek, _seaHeartsRise],
    summer:       [_seaSummerSun, _seaBeachBallBounce, _seaWaveWash, _seaSunglassesSlide, _seaFireflies,
                   _seaWatermelonRoll, _seaIceCreamDrip, _seaSharkFin, _seaHeatWave, _seaIceCreamTruck],
    autumn:       [_seaLeavesSwirl, _seaOwlBlink, _seaFoxRun, _seaAcornDrop, _seaFogRoll,
                   _seaMushroomGrow, _seaHarvestMoon, _seaScarecrow, _seaCiderMug, _seaSpiderWebCorner,
                   _seaBatSwarm],
    thanksgiving: [_seaTurkeyRun, _seaPieCooling, _seaCornucopia, _seaThanksgivingLeaves, _seaPilgrimHatFloat,
                   _seaHarvestWagon, _seaAppleRoll, _seaCornStalk, _seaFeastTable, _seaHayBale]
};
