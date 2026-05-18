FEATURE PLAN v5.0 — GROUP AA: SEASONS POLISH
Files: wwwroot/js/seasonal.js, Views/Shared/_Layout.cshtml, wwwroot/css/site.css

SEASONAL.JS KEY FACTS:
- SEA_ANIMS: maps season keys → array of animation functions (line ~1612+)
- SEA_ANIM_META: maps _seaAnimFunctionName → {name, type, enabled, dir, emoji, size, dur, wave, flipX, chars, count, etc.} (lines 293-554)
- _seaFire(): line 172 — gets current season, filters enabled anims, picks random one
- _seaScheduleNext(): line 162 — first delay 8000-18000ms, subsequent 22000-55000ms
- _seaGetAnimCfg(animName, season): line 556 — merges SEA_ANIM_META[animName] with localStorage sea_cfg_${season}
- _seaGetSeason(): returns current season key based on date
- testSpecificSeason(key): line 148 — cycles animations for that season key
- _seaRunnerFn(fnName, seasonKey, baseTop, topRange): line 580 — calls _seaLR() or _seaRL() based on config.dir
- _seaLR(emoji, topPct, size, dur, motionStyle, flipX): line 232 — left-to-right runner div (motionStyle replaces waveIt boolean; 'wave' = old waveIt:true)
- _seaRL(emoji, topPct, size, dur, motionStyle, flipX): line 246 — right-to-left runner div
- Ocean week key: 'oceanweek' (line 1641), animations: [_seaSharkFin, _seaFishSchool, _seaOceanParticles] (_seaSharkSwim is a wrapper calling _seaSharkFin — replace it)
- Star Wars key: 'starwarsday' (line 1639), animations: [_seaSaberCross, _seaGalaxyParticles, _seaMayTheFourth, _seaSpaceshipFly]
- Season enable/disable stored: sea_cfg_${seasonKey} in localStorage
- Season checkbox IDs: cel-seasonal-{seasonKey} (e.g. cel-seasonal-autumn, cel-seasonal-oceanweek)

---

AA1 — Seasons Tab: Show Active Season + Override Preview

FILE: Views/Shared/_Layout.cshtml — inside tab-seasons (line 827), add before the master toggle row

  <div id="sea-status-bar" class="alert alert-secondary p-2 mb-2 small" style="display:none;">
    <div id="sea-status-current"></div>
    <div id="sea-status-override" class="text-muted"></div>
  </div>

FILE: wwwroot/js/seasonal.js — add new function (after _seaGetSeason)

function _seaUpdateStatusBar() {
  var bar = document.getElementById('sea-status-bar');
  if (!bar) return;
  var currentSeason = _seaGetSeason();           // season with current enabled checkboxes
  var allSeason = _seaGetSeasonIgnoreEnabled();  // season if all were enabled
  bar.style.display = '';
  document.getElementById('sea-status-current').textContent =
    currentSeason ? '🌸 Active season: ' + (SEA_ANIM_META[Object.keys(SEA_ANIMS[currentSeason] || {})[0]]?.displayLabel || currentSeason) : '📅 No active season';
  if (allSeason && allSeason !== currentSeason) {
    document.getElementById('sea-status-override').textContent =
      'If all seasons were enabled: ' + allSeason + ' (overriding current selection)';
  } else {
    document.getElementById('sea-status-override').textContent = '';
  }
}

function _seaGetSeasonIgnoreEnabled() {
  // Like _seaGetSeason() but ignores the enabled checkbox — uses date only
  // Copy the date-matching logic from _seaGetSeason() without the enabled check
  // Return the season key that would match today's date
}

Call _seaUpdateStatusBar() when:
1. The Seasons tab is opened (add to openSettingsModal when tab='seasons')
2. Any season checkbox changes (add oninput/onchange listener on all cel-seasonal-* checkboxes in tab-seasons)

---

AA2 — Show Next Occurrence Date Next to Season Date Range

FILE: Views/Shared/_Layout.cshtml — seasons tab static HTML rows (lines 842-911)

Each season row currently shows: [checkbox] [label] [date range text]
Add a span after the date range for narrow-window seasons:

For point dates and narrow windows (≤7 days), calculate the next occurrence in JS and inject the date.

FILE: wwwroot/js/seasonal.js — add after tab init

function _seaInjectNextDates() {
  var now = new Date();
  var year = now.getFullYear();
  // Map of season key → [month (1-based), day] or null for wide ranges
  var POINT_DATES = {
    'piday':        [3, 14],
    'aprilfools':   [4, 1],
    'starwarsday':  [5, 4],
    'earthday':     [4, 22],
    'mayday':       [5, 1],
    'juneteenth':   [6, 19],
    'independence': [7, 4],
    'bastille':     [7, 14],
    'halloween':    [10, 31],
    'veteransday':  [11, 11],
    'christmas':    [12, 25],
    'boxingday':    [12, 26],
    'newyear':      [1, 1],
    // etc. — add all point-date seasons
  };
  Object.entries(POINT_DATES).forEach(function([key, md]) {
    var el = document.querySelector('[id="cel-seasonal-' + key + '"]');
    if (!el) return;
    var row = el.closest('div') || el.parentElement;
    var nextDate = new Date(year, md[0]-1, md[1]);
    if (nextDate < now) nextDate = new Date(year+1, md[0]-1, md[1]);
    var label = nextDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    var span = row.querySelector('.sea-next-date') || document.createElement('span');
    span.className = 'sea-next-date text-muted small ms-2';
    span.textContent = '(next: ' + label + ')';
    if (!row.querySelector('.sea-next-date')) row.appendChild(span);
  });
}
Call _seaInjectNextDates() when the Seasons tab is opened.

---

AA3 — Star Wars Day: Iconic Scrolling Crawl Text

FILE: wwwroot/js/seasonal.js — add new animation function to register in SEA_ANIMS['starwarsday']

function _seaStarWarsCrawl() {
  var existing = document.getElementById('_sw_crawl_wrap');
  if (existing) return;
  var wrap = document.createElement('div');
  wrap.id = '_sw_crawl_wrap';
  wrap.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:100vh;perspective:300px;overflow:hidden;pointer-events:none;z-index:9500;';
  var text = document.createElement('div');
  text.style.cssText = 'position:absolute;bottom:-50%;left:10%;right:10%;transform:rotateX(25deg);transform-origin:bottom center;animation:sw-crawl 18s linear forwards;color:#ffe81f;font-family:serif;font-size:1.1rem;line-height:1.8;text-align:center;';
  text.innerHTML = '<p style="font-size:1.5em;font-weight:bold;">A long time ago in a sprint far, far away...</p>' +
    '<p>The team gathered to estimate their stories. Points were cast. Debates were had. The force of consensus was strong today.</p>' +
    '<p>May your velocity be swift and your bugs be few. May the 4th be with you... always.</p>';
  wrap.appendChild(text);
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 19000);
}

FILE: wwwroot/css/site.css — add keyframe:
@keyframes sw-crawl {
  0%   { transform: rotateX(25deg) translateY(0); opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: rotateX(25deg) translateY(-200%); opacity: 0; }
}

Add _seaStarWarsCrawl to SEA_ANIMS['starwarsday'] array (line 1639).
Add entry in SEA_ANIM_META: _seaStarWarsCrawl: { name: 'Star Wars Crawl', type: 'custom', enabled: true }

Add toggle in the star wars season row (in _Layout.cshtml or via per-season config panel if seaConfigModal exists).

---

AA4 — Season Image Import for Character Sprites

FILE: Views/Shared/_Layout.cshtml — per-season configuration modal or section

When a season row's ⚙️ button is clicked, the seaConfigModal (line 1600) opens. Add an image import section to that modal:
  <div class="mb-2">
    <label class="small">Custom runner image (replaces emoji):</label>
    <input type="file" id="sea-custom-img-input" accept="image/*" onchange="handleSeaImageUpload(this)">
    <div id="sea-custom-img-preview" style="height:40px;width:40px;background-size:contain;background-repeat:no-repeat;background-position:center;"></div>
    <button onclick="clearSeaImage()">Clear</button>
  </div>

FILE: wwwroot/js/seasonal.js — add image upload handler

var _currentSeaConfigKey = null; // set when opening seaConfigModal

function handleSeaImageUpload(input) {
  var file = input.files[0]; if (!file) return;
  if (file.size > 150 * 1024) { alert('Image must be under 150KB'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var cfg = JSON.parse(localStorage.getItem('sea_cfg_' + _currentSeaConfigKey) || '{}');
    cfg.customImg = e.target.result;
    localStorage.setItem('sea_cfg_' + _currentSeaConfigKey, JSON.stringify(cfg));
    document.getElementById('sea-custom-img-preview').style.backgroundImage = 'url(' + e.target.result + ')';
  };
  reader.readAsDataURL(file);
}

In _seaLR() and _seaRL() (lines 232, 246), check for customImg in the config:
If customImg exists, create an <img> element instead of a text span for the emoji content:
  var inner = cfg.customImg
    ? '<img src="' + cfg.customImg + '" style="height:' + size + ';width:auto;display:block;">'
    : emoji;
Then use inner as the content of the runner div.

---

AA5 — Promote Runner-Variant Custom Animations to Configurable

BACKGROUND:
- _seaSharkSwim is literally a one-line wrapper calling _seaSharkFin(). _seaSharkFin IS type:'runner'.
- ~20 other custom animations also call _seaLR/_seaRL internally with a secondary CSS animation.
- The seaConfigModal's _seaBuildAnimRow() already shows full runner controls (emoji, dir, flipX, size, dur).
- Plan: promote these to type:'runner' with a new `motionStyle` field, update _seaLR/_seaRL, update runner controls UI.

STEP 1 — Fix shark: update SEA_ANIMS['oceanweek']

Replace _seaSharkSwim with _seaSharkFin in the SEA_ANIMS['oceanweek'] array (line 1641).
Delete or leave _seaSharkSwim function — it's now unreachable.

Fix T3 in SEA_ANIM_META for _seaSharkFin:
  _seaSharkFin: { name:'Shark Fin', type:'runner', emoji:'🦈', dir:'lr', flipX:true,
                  size:'3.5rem', dur:5.5, motionStyle:'none', enabled:true }
(🦈 faces left natively; flipX:true mirrors it to face right, swimming right)

STEP 2 — Update _seaLR and _seaRL signatures (line 232, 246)

Change signature: (emoji, topPct, size, dur, motionStyle, flipX)
  - motionStyle replaces the waveIt boolean
  - Backward compat: if motionStyle === true (old callers), treat as 'wave'

Inside _seaLR/_seaRL, replace the waveIt block with:
  var ms = (motionStyle === true) ? 'wave' : (motionStyle || 'none');
  if (ms !== 'none') {
    var inner = document.createElement('div');
    inner.style.cssText = 'display:inline-block;font-size:' + (ms === 'wave' ? '' : size + ';') +
      'animation:sea-' + ms + ' ' + _motionStyleDur(ms) + ' infinite;';
    inner.textContent = emoji;
    wrap.appendChild(inner);
  } else {
    wrap.style.fontSize = size;
    wrap.textContent = emoji;
  }

Helper _motionStyleDur(ms):
  { wave:'0.4s ease-in-out alternate', bounce:'0.55s ease', hop:'0.38s linear alternate',
    spin:'0.7s linear', 'slow-spin':'2s linear', run:'0.18s linear alternate',
    wobble:'0.5s ease-in-out alternate', zigzag:'0.9s ease-in-out alternate' }[ms] || '0.5s'

Also handle bottomAnchor field: if c.bottomAnchor is true (new META field), position element at
bottom:65px instead of top:topPct%. Update _seaRunnerFn to check c.bottomAnchor and set bottomPx.

STEP 3 — Promote ~20 custom animations in SEA_ANIM_META

Change type:'custom' → type:'runner' and add motionStyle + bottomAnchor:

Running characters (bottomAnchor:true, motionStyle:'run'):
  _seaBlackCatRun: emoji:'🐈‍⬛', dir:'lr', size:'2.8rem', dur:3.2, motionStyle:'run', bottomAnchor:true
  _seaElfRun:      emoji:'🧝', dir:'lr', size:'2.8rem', dur:3, motionStyle:'run', bottomAnchor:true
  _seaFoxRun:      emoji:'🦊', dir:'lr', size:'2.8rem', dur:3.8, motionStyle:'run', bottomAnchor:true
  _seaTurkeyRun:   emoji:'🦃', dir:'rl', size:'2.8rem', dur:3.5, motionStyle:'run', bottomAnchor:true
  _seaBunnyHop:    emoji:'🐇', dir:'rl', size:'2.8rem', dur:4.2, motionStyle:'hop', bottomAnchor:true

Spinning objects (bottomAnchor:true, motionStyle:'spin'):
  _seaPumpkinRoll:    emoji:'🎃', dir:'lr', size:'2.5rem', dur:4.5, motionStyle:'spin', bottomAnchor:true
  _seaPieRoll:        emoji:'🥧', dir:'lr', size:'2.5rem', dur:4.5, motionStyle:'spin', bottomAnchor:true
  _seaWatermelonRoll: emoji:'🍉', dir:'rl', size:'2.5rem', dur:4.2, motionStyle:'spin', bottomAnchor:true
  _seaAppleRoll:      emoji:'🍎', dir:'rl', size:'2.5rem', dur:4, motionStyle:'spin', bottomAnchor:true

Bouncing objects (bottomAnchor:true, motionStyle:'bounce'):
  _seaPresentBounce:  emoji:'🎁', dir:'lr', size:'2.5rem', dur:4.5, motionStyle:'bounce', bottomAnchor:true
  _seaBeachBallBounce:emoji:'🏐', dir:'lr', size:'2.5rem', dur:4.8, motionStyle:'bounce', bottomAnchor:true

Wobbling (motionStyle:'wobble'):
  _seaSantaSleigh:    emoji:'🦌🦌🦌🛷🎅', dir:'rl', size:'2.5rem', dur:8, motionStyle:'wobble'
  _seaHarvestWagon:   emoji:'🌾🌾🌾', dir:'lr', size:'2.5rem', dur:5.5, motionStyle:'wobble', bottomAnchor:true
  _seaHayBale:        emoji:'🌾', dir:'lr', size:'2.5rem', dur:5, motionStyle:'wobble', bottomAnchor:true
  _seaIceCreamTruck:  emoji:'🚐🍦', dir:'rl', size:'2.5rem', dur:5.5, motionStyle:'wobble', bottomAnchor:true

Other directional runners (motionStyle:'none'):
  _seaShootingStar:   emoji:'⭐', dir:'rl', size:'2rem', dur:2.2, motionStyle:'none'
  _seaSunglassesSlide:emoji:'😎', dir:'lr', size:'4rem', dur:1.8, motionStyle:'none'

Note: _seaBatSwarm (multi-instance spawner) and _seaSantaSleigh (emoji sequence) stay as-is in function body
but promote to type:'runner' in META so the config UI shows runner controls.

Update each function body: replace hardcoded _seaLR/_seaRL call with _seaRunnerFn(fnName, seasonKey, topPct, topRange).
For bottomAnchor functions: _seaRunnerFn reads c.bottomAnchor and positions at bottom:65px if true.

STEP 4 — Update _seaRunnerFn (line 580)

Add bottomAnchor support:
  function _seaRunnerFn(fnName, seasonKey, baseTop, topRange) {
    var c = _seaGetAnimCfg(fnName, seasonKey);
    var m = _seaGetSeasonMultipliers(seasonKey);
    var top = c.bottomAnchor ? null : (baseTop + Math.random() * (topRange || 30));
    var dur = (c.dur || 5) * (m.speed || 1);
    var ms = c.motionStyle || 'none';
    if (c.dir === 'rl') _seaRL(c.customImg ? _seaImgEl(c) : (c.emoji || '⭐'), top, c.size || '2.5rem', dur, ms, c.flipX, c.bottomAnchor);
    else                _seaLR(c.customImg ? _seaImgEl(c) : (c.emoji || '⭐'), top, c.size || '2.5rem', dur, ms, c.flipX, c.bottomAnchor);
  }

  function _seaImgEl(c) {
    // Returns an img element to use instead of emoji text
    var img = document.createElement('img');
    img.src = c.customImg;
    img.style.cssText = 'height:' + (c.size || '2.5rem') + ';width:auto;display:block;';
    if (c.flipX) img.style.transform = 'scaleX(-1)';
    return img;
  }

Update _seaLR/_seaRL to accept img element or string for first param:
  var content = typeof emoji === 'string' ? emoji : null; // emoji can be DOM element
  if (typeof emoji !== 'string') { wrap.appendChild(emoji); }
  else { /* existing text logic */ }

STEP 5 — Update _seaBuildAnimRow runner case (line 1700)

Replace wave toggle checkbox with a motionStyle dropdown:
  '<select class="form-select form-select-sm csb-motion" onchange="saveSeasonConfig()">' +
  ['none','wave','bounce','hop','spin','run','wobble','zigzag'].map(function(ms) {
    return '<option value="' + ms + '"' + (c.motionStyle===ms?' selected':'') + '>' + ms + '</option>';
  }).join('') + '</select>'

Add image upload field to runner rows:
  '<div class="mt-1">' +
  '<label class="small">Custom image (overrides emoji):</label>' +
  '<input type="file" class="form-control form-control-sm" accept="image/*" onchange="_seaAnimImgUpload(this,\''+fnName+'\',\''+seasonKey+'\')">' +
  (c.customImg ? '<img src="'+c.customImg+'" style="height:2rem;"> <button onclick="_seaAnimImgClear(\''+fnName+'\',\''+seasonKey+'\')">✕</button>' : '') +
  '</div>'

Add upload/clear handlers:
  function _seaAnimImgUpload(input, fnName, seasonKey) {
    var file = input.files[0]; if (!file || file.size > 200*1024) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var cfg = JSON.parse(localStorage.getItem('sea_cfg_' + seasonKey) || '{}');
      if (!cfg[fnName]) cfg[fnName] = {};
      cfg[fnName].customImg = e.target.result;
      localStorage.setItem('sea_cfg_' + seasonKey, JSON.stringify(cfg));
    };
    reader.readAsDataURL(file);
  }
  function _seaAnimImgClear(fnName, seasonKey) {
    var cfg = JSON.parse(localStorage.getItem('sea_cfg_' + seasonKey) || '{}');
    if (cfg[fnName]) delete cfg[fnName].customImg;
    localStorage.setItem('sea_cfg_' + seasonKey, JSON.stringify(cfg));
    openSeasonConfig(seasonKey);  // re-render the modal
  }
  window._seaAnimImgUpload = _seaAnimImgUpload;
  window._seaAnimImgClear = _seaAnimImgClear;

STEP 6 — Add sea-zigzag CSS keyframe (wwwroot/css/site.css)

@keyframes sea-zigzag {
  0%   { transform: translateY(0px); }
  25%  { transform: translateY(-24px); }
  75%  { transform: translateY(24px); }
  100% { transform: translateY(0px); }
}
(Apply to inner element at ~0.9s ease-in-out infinite — creates diagonal bobbing path while traversing screen)

---

AA10 — Add Animation to Existing Season + JSON Export/Import

PART A — Add animation to existing season (inside seaConfigModal)

FILE: wwwroot/js/seasonal.js — extend openSeasonConfig() / saveSeasonConfig()

Below the animation list in seaConfigModal, add:
  '<hr><button class="btn btn-sm btn-outline-primary" onclick="seaAddAnimToSeason(\''+seasonKey+'\')">➕ Add custom animation</button>' +
  '<div id="sea-extra-anims-' + seasonKey + '"></div>'

function seaAddAnimToSeason(seasonKey) {
  var cfg = JSON.parse(localStorage.getItem('sea_cfg_' + seasonKey) || '{}');
  if (!cfg.customAnims) cfg.customAnims = [];
  // Same form fields as AA9 custom builder, one row
  // On save: cfg.customAnims.push({ type, emoji, dir, dur, size, motionStyle });
  // localStorage.setItem('sea_cfg_' + seasonKey, JSON.stringify(cfg));
  // _seaInjectSeasonCustomAnims(seasonKey); // inject into SEA_ANIMS[seasonKey]
}

Extend _seaInjectCustomSeasons() to also scan sea_cfg_* keys for customAnims arrays:
  Object.keys(localStorage).filter(k => k.startsWith('sea_cfg_')).forEach(function(k) {
    var seasonKey = k.replace('sea_cfg_', '');
    var cfg = JSON.parse(localStorage.getItem(k) || '{}');
    if (cfg.customAnims && cfg.customAnims.length) {
      cfg.customAnims.forEach(function(a) {
        var fn = function() {
          a.dir === 'rl' ? _seaRL(a.emoji, 40, a.size||'2.5rem', a.dur||5, a.motionStyle||'none', false)
                         : _seaLR(a.emoji, 40, a.size||'2.5rem', a.dur||5, a.motionStyle||'none', false);
        };
        if (!SEA_ANIMS[seasonKey]) SEA_ANIMS[seasonKey] = [];
        SEA_ANIMS[seasonKey].push(fn);
      });
    }
  });

PART B — Export / Import all seasonal config

FILE: wwwroot/js/seasonal.js

function exportSeasonalConfig() {
  var data = {};
  // Collect all sea_cfg_* and es_customSeasons from localStorage
  Object.keys(localStorage).filter(k => k.startsWith('sea_cfg_') || k === 'es_customSeasons' || k === 'es_seaFreq')
    .forEach(k => { data[k] = localStorage.getItem(k); });
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'es-seasons-export.json'; a.click(); URL.revokeObjectURL(a.href);
}
window.exportSeasonalConfig = exportSeasonalConfig;

function importSeasonalConfig() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = function(e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        Object.entries(data).forEach(function([k, v]) {
          // Only allow sea_cfg_* and known keys for safety
          if (k.startsWith('sea_cfg_') || k === 'es_customSeasons' || k === 'es_seaFreq') {
            localStorage.setItem(k, v);
          }
        });
        _seaInjectCustomSeasons();
        alert('Season config imported. Reload page to apply all changes.');
      } catch(e) { alert('Invalid JSON file'); }
    };
    reader.readAsText(file);
  };
  input.click();
}
window.importSeasonalConfig = importSeasonalConfig;

FILE: Views/Shared/_Layout.cshtml — Seasons tab header (near master toggle, line ~827)

Add export/import buttons in a small row:
  <div class="d-flex gap-2 mb-2">
    <button class="btn btn-sm btn-outline-secondary" onclick="exportSeasonalConfig()" title="Download all season customizations as JSON">⬇️ Export Config</button>
    <button class="btn btn-sm btn-outline-secondary" onclick="importSeasonalConfig()" title="Restore from JSON file">⬆️ Import Config</button>
  </div>

---

AA6 — Test Button Per Season Individual Animation

FILE: Views/Shared/_Layout.cshtml — seasons tab, per-season ⚙️ config panel / seaConfigModal (line 1600)

In the seaConfigModal (or the per-season expanded area if it renders inline), list all animations for the current season. Each animation row should have a 🧪 Test button:

  <div class="d-flex justify-content-between align-items-center mb-2">
    <span>[animation display name from SEA_ANIM_META]</span>
    <div class="d-flex gap-1">
      <input type="checkbox" id="anim-enabled-[name]" [checked if enabled]>
      <button class="btn btn-xs btn-outline-secondary" onclick="testSeasonAnim('[fnName]','[seasonKey]')">🧪</button>
    </div>
  </div>

FILE: wwwroot/js/seasonal.js — add function

function testSeasonAnim(fnName, seasonKey) {
  var fn = window[fnName] || eval(fnName);  // avoid eval: use a lookup table instead
  if (typeof fn === 'function') fn();
}

Better: maintain a lookup object at module level:
var _SEA_FN_MAP = {
  '_seaSharkSwim': _seaSharkSwim,
  '_seaFishSchool': _seaFishSchool,
  // ... all animation functions
};
function testSeasonAnim(fnName) {
  if (_SEA_FN_MAP[fnName]) _SEA_FN_MAP[fnName]();
}
window.testSeasonAnim = testSeasonAnim;

The seaConfigModal is already opened when clicking ⚙️ on a season row (seaConfigModal at _Layout:1600). Populate the animation list in the modal using SEA_ANIMS[seasonKey] and SEA_ANIM_META.

---

AA7 — O6 Emoji Picker Extended to Season Customizations (Depends on O6)

Implement after Group O6 (emoji picker component) is built.
Once picker exists, attach data-picker-target to:
- Seasonal runner emoji input in seaConfigModal
- Particle chars input in seaConfigModal
- Corner decoration emoji input in seaConfigModal
- Custom season builder emoji fields (AA9)

---

AA8 — Seasonal Frequency Sliders

FILE: Views/Shared/_Layout.cshtml — seasons tab (line 827), add after the master toggle area and before the season list

  <div class="mb-3">
    <label class="small fw-bold">Animation frequency:</label>
    <div class="row g-2 mt-1">
      <div class="col-6">
        <label class="form-label small">Min delay (s) <span id="sea-freq-min-val">22</span>s</label>
        <input type="range" class="form-range" id="sea-freq-min" min="5" max="60" step="1" value="22"
               oninput="document.getElementById('sea-freq-min-val').textContent=this.value;saveSeaFreq();">
      </div>
      <div class="col-6">
        <label class="form-label small">Max delay (s) <span id="sea-freq-max-val">55</span>s</label>
        <input type="range" class="form-range" id="sea-freq-max" min="15" max="120" step="1" value="55"
               oninput="document.getElementById('sea-freq-max-val').textContent=this.value;saveSeaFreq();">
      </div>
    </div>
  </div>

FILE: wwwroot/js/seasonal.js

Add to module init (near line 162):
function saveSeaFreq() {
  var min = parseInt(document.getElementById('sea-freq-min')?.value || 22);
  var max = parseInt(document.getElementById('sea-freq-max')?.value || 55);
  localStorage.setItem('es_seaFreq', JSON.stringify({ min: min, max: max }));
}

In _seaScheduleNext() at line 162, replace hardcoded 22000 and 55000:
  var freq = JSON.parse(localStorage.getItem('es_seaFreq') || '{"min":22,"max":55}');
  var delay = firstTime
    ? (8000 + Math.random() * 10000)
    : (freq.min * 1000 + Math.random() * (freq.max - freq.min) * 1000);

On tab open, populate sliders from localStorage:
  var freq = JSON.parse(localStorage.getItem('es_seaFreq') || '{"min":22,"max":55}');
  var minEl = document.getElementById('sea-freq-min');
  if (minEl) { minEl.value = freq.min; document.getElementById('sea-freq-min-val').textContent = freq.min; }
  var maxEl = document.getElementById('sea-freq-max');
  if (maxEl) { maxEl.value = freq.max; document.getElementById('sea-freq-max-val').textContent = freq.max; }

---

AA9 — Custom Seasonal Theme Builder

FILE: Views/Shared/_Layout.cshtml — seasons tab, add at very bottom before closing </div>

  <hr>
  <h6 class="mt-2">Custom Seasons</h6>
  <button class="btn btn-sm btn-outline-primary mb-2" onclick="openCustomSeasonBuilder()">➕ Create Custom Season</button>
  <div id="custom-seasons-list"></div>

  <!-- Custom Season Builder Modal -->
  <div class="modal fade" id="customSeasonModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Custom Season</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="mb-2">
            <label>Season Name</label>
            <input type="text" id="csb-name" class="form-control" placeholder="My Custom Season">
          </div>
          <div class="row g-2 mb-2">
            <div class="col-6">
              <label>Start (MM/DD)</label>
              <input type="text" id="csb-start" class="form-control" placeholder="12/24" maxlength="5">
            </div>
            <div class="col-6">
              <label>End (MM/DD)</label>
              <input type="text" id="csb-end" class="form-control" placeholder="12/26" maxlength="5">
            </div>
          </div>
          <label>Animations (up to 5):</label>
          <div id="csb-anims-list"></div>
          <button class="btn btn-sm btn-outline-secondary mt-1" onclick="csbAddAnim()" id="csb-add-anim">+ Add Animation</button>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button class="btn btn-primary" onclick="saveCustomSeason()">Save Season</button>
        </div>
      </div>
    </div>
  </div>

FILE: wwwroot/js/seasonal.js — add custom season builder functions

var _csbEditIndex = -1; // -1 = new, else index in es_customSeasons

function openCustomSeasonBuilder(editIndex) {
  _csbEditIndex = editIndex ?? -1;
  var seasons = JSON.parse(localStorage.getItem('es_customSeasons') || '[]');
  var s = _csbEditIndex >= 0 ? seasons[_csbEditIndex] : null;
  document.getElementById('csb-name').value = s ? s.name : '';
  document.getElementById('csb-start').value = s ? s.start : '';
  document.getElementById('csb-end').value = s ? s.end : '';
  document.getElementById('csb-anims-list').innerHTML = '';
  (s ? s.anims : []).forEach(a => csbAddAnim(a));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('customSeasonModal')).show();
}

function csbAddAnim(existing) {
  var list = document.getElementById('csb-anims-list');
  if (list.children.length >= 5) return;
  var idx = list.children.length;
  var types = ['runner','particles','popup','corner'];
  var div = document.createElement('div');
  div.className = 'border rounded p-2 mb-2';
  div.innerHTML =
    '<div class="d-flex gap-2 mb-1">' +
    '<select class="form-select form-select-sm csb-type" onchange="csbTypeChange(this)">' +
    types.map(t => '<option value="' + t + '"' + (existing?.type===t?' selected':'') + '>' + t + '</option>').join('') +
    '</select>' +
    '<input type="text" class="form-control form-control-sm csb-emoji" placeholder="Emoji" value="' + (existing?.emoji||'') + '" style="width:80px;">' +
    '<button class="btn btn-xs btn-outline-danger" onclick="this.closest(\'.border\').remove()">✕</button>' +
    '</div>' +
    '<div class="csb-params"></div>';
  list.appendChild(div);
  csbTypeChange(div.querySelector('.csb-type'));
}

function csbTypeChange(sel) {
  var div = sel.closest('.border');
  var params = div.querySelector('.csb-params');
  var type = sel.value;
  if (type === 'runner') {
    params.innerHTML = '<div class="row g-1"><div class="col"><select class="form-select form-select-sm csb-dir"><option value="lr">L→R</option><option value="rl">R→L</option></select></div>' +
      '<div class="col"><input type="number" class="form-control form-control-sm csb-dur" placeholder="Dur(s)" value="5" min="1" max="20"></div>' +
      '<div class="col"><input type="text" class="form-control form-control-sm csb-size" placeholder="Size" value="2.5rem"></div>' +
      '<div class="col-auto"><div class="form-check mt-1"><input class="form-check-input csb-wave" type="checkbox" checked><label class="small">Wave</label></div></div></div>';
  } else if (type === 'particles') {
    params.innerHTML = '<input type="text" class="form-control form-control-sm csb-chars" placeholder="Emojis (comma separated)" value="🎉,🎊">' +
      '<input type="number" class="form-control form-control-sm mt-1 csb-count" placeholder="Count" value="15" min="1" max="50">';
  } else if (type === 'popup' || type === 'corner') {
    params.innerHTML = '<div class="row g-1"><div class="col"><input type="text" class="form-control form-control-sm csb-size" placeholder="Size" value="3rem"></div>' +
      '<div class="col"><input type="number" class="form-control form-control-sm csb-hold" placeholder="Hold(ms)" value="2500"></div></div>';
  }
}

function saveCustomSeason() {
  var name = document.getElementById('csb-name').value.trim();
  var start = document.getElementById('csb-start').value.trim();
  var end = document.getElementById('csb-end').value.trim();
  if (!name || !start) { alert('Name and start date required'); return; }
  var anims = [];
  document.querySelectorAll('#csb-anims-list .border').forEach(function(div) {
    var type = div.querySelector('.csb-type').value;
    var emoji = div.querySelector('.csb-emoji').value;
    var anim = { type: type, emoji: emoji };
    if (type === 'runner') {
      anim.dir = div.querySelector('.csb-dir')?.value || 'lr';
      anim.dur = parseFloat(div.querySelector('.csb-dur')?.value || 5);
      anim.size = div.querySelector('.csb-size')?.value || '2.5rem';
      anim.wave = div.querySelector('.csb-wave')?.checked ?? true;
    } else if (type === 'particles') {
      anim.chars = (div.querySelector('.csb-chars')?.value || '🎉').split(',').map(s => s.trim());
      anim.count = parseInt(div.querySelector('.csb-count')?.value || 15);
    } else {
      anim.size = div.querySelector('.csb-size')?.value || '3rem';
      anim.hold = parseInt(div.querySelector('.csb-hold')?.value || 2500);
    }
    anims.push(anim);
  });
  var seasons = JSON.parse(localStorage.getItem('es_customSeasons') || '[]');
  var season = { name: name, start: start, end: end, anims: anims, key: 'custom_' + name.replace(/\s+/g,'_').toLowerCase() };
  if (_csbEditIndex >= 0) seasons[_csbEditIndex] = season;
  else seasons.push(season);
  localStorage.setItem('es_customSeasons', JSON.stringify(seasons));
  _seaInjectCustomSeasons();
  bootstrap.Modal.getInstance(document.getElementById('customSeasonModal')).hide();
  renderCustomSeasonsList();
}

function _seaInjectCustomSeasons() {
  var customs = JSON.parse(localStorage.getItem('es_customSeasons') || '[]');
  customs.forEach(function(s) {
    SEA_ANIMS[s.key] = s.anims.map(function(a, i) {
      return function() {
        if (a.type === 'runner') {
          a.dir === 'rl' ? _seaRL(a.emoji, 40, a.size, a.dur, a.wave, false)
                         : _seaLR(a.emoji, 40, a.size, a.dur, a.wave, false);
        } else if (a.type === 'particles') {
          // call particle function with a.chars, a.count
        } else if (a.type === 'popup') {
          _seaPopup && _seaPopup(a.emoji, a.size, a.hold);
        }
      };
    });
    // Register date range for _seaGetSeason() to pick up
    _SEA_DATE_RANGES = _SEA_DATE_RANGES || {};
    _SEA_DATE_RANGES[s.key] = { start: s.start, end: s.end };
  });
}

Call _seaInjectCustomSeasons() on page load (in startSeasonalAmbience or initialization).

function renderCustomSeasonsList() {
  var seasons = JSON.parse(localStorage.getItem('es_customSeasons') || '[]');
  var list = document.getElementById('custom-seasons-list');
  if (!list) return;
  list.innerHTML = seasons.map((s, i) =>
    '<div class="d-flex justify-content-between align-items-center mb-1 p-2 bg-body-secondary rounded">' +
    '<span>' + s.name + ' (' + s.start + '–' + s.end + ')</span>' +
    '<div class="d-flex gap-1">' +
    '<button class="btn btn-xs btn-outline-secondary" onclick="testSpecificSeason(\'' + s.key + '\')">🧪</button>' +
    '<button class="btn btn-xs btn-outline-primary" onclick="openCustomSeasonBuilder(' + i + ')">✏️</button>' +
    '<button class="btn btn-xs btn-outline-danger" onclick="deleteCustomSeason(' + i + ')">🗑</button>' +
    '</div></div>'
  ).join('');
}

function deleteCustomSeason(idx) {
  if (!confirm('Delete this custom season?')) return;
  var s = JSON.parse(localStorage.getItem('es_customSeasons') || '[]');
  s.splice(idx, 1);
  localStorage.setItem('es_customSeasons', JSON.stringify(s));
  _seaInjectCustomSeasons();
  renderCustomSeasonsList();
}

window.openCustomSeasonBuilder = openCustomSeasonBuilder;
window.saveCustomSeason = saveCustomSeason;
window.deleteCustomSeason = deleteCustomSeason;
window.csbAddAnim = csbAddAnim;
window.csbTypeChange = csbTypeChange;

Call renderCustomSeasonsList() and _seaInjectCustomSeasons() on page load and when Seasons tab is opened.
