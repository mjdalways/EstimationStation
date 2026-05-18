FEATURE PLAN v5.0 — GROUP AC (TIMER & CLOCK)
Files: wwwroot/js/room.js, wwwroot/js/site.js, wwwroot/css/site.css, Views/Shared/_Layout.cshtml

KEY FACTS:
- roomState.currentStoryId at room.js:31 — null when no story active
- connection.on('RoomState', state) at room.js:65 — initial load; state.currentStoryId tells us if a story is already active on join
- connection.on('CurrentStoryChanged', storyId) at room.js:295 — fires each time story changes; storyId is null when cleared
- connection.on('TimerStarted', seconds, startedBy) at room.js:338 — existing countdown timer (separate from count-up; don't collide)
- Other tab: Views/Shared/_Layout.cshtml:1456, id="tab-other"; ends at line 1513
- openSettingsModal() in site.js — call _loadClockSettings() here when Other tab initialises
- saveCelebrationSettingsFromForm() pattern in site.js — follow same pattern for clock settings
- Intl.DateTimeFormat supports IANA timezone strings natively in all modern browsers
- Intl.supportedValuesOf('timeZone') available in Chrome 99+/Firefox 86+/Safari 15.4+ — use with try/catch fallback to a curated list

---

GROUP AC — TIMER & CLOCK

---

AC1 — Count-Up Timer

FILE: wwwroot/js/room.js — add timer state vars near top (after roomState definition)

  var _countUpInterval = null;
  var _countUpSeconds = 0;

Add helper functions:

  function _startCountUp() {
    _countUpSeconds = 0;
    clearInterval(_countUpInterval);
    _renderCountUp();
    var cs = _getClockSettings();
    if (!cs.showTimer) return;
    _countUpInterval = setInterval(function() {
      _countUpSeconds++;
      _renderCountUp();
    }, 1000);
  }

  function _stopCountUp() {
    clearInterval(_countUpInterval);
    _countUpInterval = null;
  }

  function _renderCountUp() {
    var el = document.getElementById('room-timer-display');
    if (!el) return;
    var cs = _getClockSettings();
    if (!cs.showTimer) { el.style.display = 'none'; return; }
    var m = Math.floor(_countUpSeconds / 60);
    var s = _countUpSeconds % 60;
    el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    el.style.display = 'inline-block';
  }

HOOK INTO HANDLERS in room.js:

  connection.on('CurrentStoryChanged', (storyId) => {
    roomState.currentStoryId = storyId;
    // ... existing code ...
    if (storyId) _startCountUp(); else _stopCountUp();
  });

  connection.on('RoomState', (state) => {
    // ... existing code ...
    if (state.currentStoryId) _startCountUp();
  });

FILE: Views/Shared/_Layout.cshtml — inside the room page, near currentStoryDisplay element
(search for id="currentStoryDisplay" around line 602 in room.js to find its matching HTML; add widget nearby)

  <div id="room-clock-widget" class="room-clock-widget d-flex align-items-center gap-3 mt-1 mb-1">
    <span id="room-timer-display" class="room-timer" style="display:none;" title="Time on current story"></span>
    <span id="room-clock-display" class="room-clock" style="display:none;" title="Current time"></span>
    <div id="room-analog-clock" style="display:none;" title="Current time"></div>
  </div>

FILE: wwwroot/css/site.css

  .room-clock-widget { font-variant-numeric: tabular-nums; }
  .room-timer { font-family: monospace; font-size: 0.95rem; color: var(--accent); opacity: 0.85; }
  .room-clock  { font-size: 0.95rem; color: var(--text); opacity: 0.8; }
  #room-analog-clock svg { display: block; }

---

AC2 — Live Clock with Timezone Support

FILE: wwwroot/js/room.js — add clock state vars and functions

  var _clockInterval = null;

  function _startClock() {
    clearInterval(_clockInterval);
    _renderClock();
    var cs = _getClockSettings();
    if (!cs.showClock) return;
    _clockInterval = setInterval(_renderClock, 1000);
  }

  function _renderClock() {
    var cs = _getClockSettings();
    if (!cs.showClock) {
      document.getElementById('room-clock-display').style.display = 'none';
      document.getElementById('room-analog-clock').style.display = 'none';
      return;
    }
    var tz = cs.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    var now = new Date();
    if (cs.clockMode === 'analog') {
      document.getElementById('room-clock-display').style.display = 'none';
      _renderAnalogClock(now, tz, cs);
    } else {
      document.getElementById('room-analog-clock').style.display = 'none';
      var fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: tz, timeZoneName: 'short'
      });
      var el = document.getElementById('room-clock-display');
      el.textContent = fmt.format(now);
      el.style.display = 'inline-block';
      el.style.fontFamily = cs.clockFont || 'monospace';
      el.style.fontSize   = (cs.clockSize || 14) + 'px';
      el.style.color      = cs.clockColor || '';
    }
  }

Call _startClock() at the end of the connection.start() success block in room.js (after initial setup).

---

AC3 — Enable/Disable in Settings

FILE: Views/Shared/_Layout.cshtml — inside tab-other div, add new section before closing </div><!-- end tab-other -->

  <!-- Timer & Clock -->
  <div class="d-flex align-items-center border-bottom pb-1 mb-2 mt-3">
    <h6 class="text-muted mb-0 me-auto">⏱️ Timer &amp; Clock</h6>
  </div>
  <div class="form-check form-switch mb-2">
    <input class="form-check-input" type="checkbox" id="clock-show-timer" onchange="saveClockSettingsFromForm()">
    <label class="form-check-label small" for="clock-show-timer">Show count-up timer (resets each story)</label>
  </div>
  <div class="form-check form-switch mb-2">
    <input class="form-check-input" type="checkbox" id="clock-show-clock" onchange="saveClockSettingsFromForm()">
    <label class="form-check-label small" for="clock-show-clock">Show clock</label>
  </div>

  <!-- Clock options — shown only when clock is enabled -->
  <div id="clock-options-wrap">
    <div class="d-flex align-items-center gap-2 mb-2">
      <label class="form-label mb-0 small" for="clock-timezone">Timezone</label>
      <select class="form-select form-select-sm" id="clock-timezone" style="max-width:220px;" onchange="saveClockSettingsFromForm()">
        <!-- populated by JS -->
      </select>
    </div>
    <div class="d-flex align-items-center gap-2 mb-2">
      <label class="form-label mb-0 small" for="clock-mode">Display mode</label>
      <select class="form-select form-select-sm" id="clock-mode" style="max-width:140px;" onchange="saveClockSettingsFromForm(); _toggleClockModeOptions()">
        <option value="digital">Digital</option>
        <option value="analog">Analog</option>
      </select>
    </div>

    <!-- Digital options -->
    <div id="clock-digital-options">
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" for="clock-font">Font</label>
        <select class="form-select form-select-sm" id="clock-font" style="max-width:160px;" onchange="saveClockSettingsFromForm()">
          <option value="monospace">Monospace</option>
          <option value="sans-serif">System</option>
          <option value="serif">Serif</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="'Orbitron', sans-serif">Orbitron (digital)</option>
        </select>
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" for="clock-size">Size</label>
        <input type="range" class="form-range" id="clock-size" min="10" max="32" step="1" style="max-width:120px;" oninput="saveClockSettingsFromForm()">
        <span id="clock-size-label" class="small text-muted">14px</span>
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" for="clock-color">Color</label>
        <input type="color" id="clock-color" style="width:36px;height:28px;border:none;padding:0;background:none;cursor:pointer;" onchange="saveClockSettingsFromForm()">
      </div>
    </div>

    <!-- Analog options -->
    <div id="clock-analog-options" style="display:none;">
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" for="clock-face">Face style</label>
        <select class="form-select form-select-sm" id="clock-face" style="max-width:140px;" onchange="saveClockSettingsFromForm()">
          <option value="minimal">Minimal</option>
          <option value="classic">Classic</option>
          <option value="filled">Filled</option>
        </select>
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" style="min-width:80px;">Hour hand</label>
        <input type="color" id="clock-hour-color" style="width:36px;height:28px;border:none;padding:0;background:none;cursor:pointer;" onchange="saveClockSettingsFromForm()">
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" style="min-width:80px;">Minute hand</label>
        <input type="color" id="clock-min-color" style="width:36px;height:28px;border:none;padding:0;background:none;cursor:pointer;" onchange="saveClockSettingsFromForm()">
      </div>
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="form-label mb-0 small" style="min-width:80px;">Second hand</label>
        <input type="color" id="clock-sec-color" style="width:36px;height:28px;border:none;padding:0;background:none;cursor:pointer;" onchange="saveClockSettingsFromForm()">
      </div>
      <div class="form-check form-check-sm mb-2">
        <input class="form-check-input" type="checkbox" id="clock-ticks" onchange="saveClockSettingsFromForm()">
        <label class="form-check-label small" for="clock-ticks">Show tick marks</label>
      </div>
      <!-- Live preview -->
      <div id="clock-analog-preview" class="mt-1 mb-2"></div>
    </div>
  </div>

FILE: wwwroot/css/site.css

  #clock-options-wrap { padding-left: 4px; }

---

AC4 — Clock Settings JS (site.js)

FILE: wwwroot/js/site.js — add clock settings functions

DEFAULT shape:
  var _DEFAULT_CLOCK = {
    showTimer: true,
    showClock: true,
    timezone: '',          // '' = browser default
    clockMode: 'digital',  // 'digital' | 'analog'
    clockFont: 'monospace',
    clockSize: 14,
    clockColor: '',        // '' = CSS default
    faceStyle: 'minimal',
    hourColor: '#ffffff',
    minColor: '#cccccc',
    secColor: '#e05050',
    showTicks: true
  };

  function _getClockSettings() {
    try { return Object.assign({}, _DEFAULT_CLOCK, JSON.parse(localStorage.getItem('es_clockStyle') || '{}')); }
    catch(e) { return Object.assign({}, _DEFAULT_CLOCK); }
  }

  function _saveClockSettings(cs) {
    localStorage.setItem('es_clockStyle', JSON.stringify(cs));
  }

  function saveClockSettingsFromForm() {
    var cs = _getClockSettings();
    cs.showTimer  = document.getElementById('clock-show-timer')?.checked ?? cs.showTimer;
    cs.showClock  = document.getElementById('clock-show-clock')?.checked ?? cs.showClock;
    cs.timezone   = document.getElementById('clock-timezone')?.value || '';
    cs.clockMode  = document.getElementById('clock-mode')?.value || 'digital';
    cs.clockFont  = document.getElementById('clock-font')?.value || 'monospace';
    cs.clockSize  = parseInt(document.getElementById('clock-size')?.value || 14);
    cs.clockColor = document.getElementById('clock-color')?.value || '';
    cs.faceStyle  = document.getElementById('clock-face')?.value || 'minimal';
    cs.hourColor  = document.getElementById('clock-hour-color')?.value || '#ffffff';
    cs.minColor   = document.getElementById('clock-min-color')?.value || '#cccccc';
    cs.secColor   = document.getElementById('clock-sec-color')?.value || '#e05050';
    cs.showTicks  = document.getElementById('clock-ticks')?.checked ?? true;
    _saveClockSettings(cs);
    // Update live UI immediately
    if (typeof _renderClock === 'function') _renderClock();
    if (typeof _renderCountUp === 'function') _renderCountUp();
    document.getElementById('clock-size-label').textContent = cs.clockSize + 'px';
    _toggleClockModeOptions();
    _renderAnalogClockPreview();
  }
  window.saveClockSettingsFromForm = saveClockSettingsFromForm;

  function _loadClockSettings() {
    var cs = _getClockSettings();
    _setChecked('clock-show-timer', cs.showTimer);
    _setChecked('clock-show-clock', cs.showClock);
    _populateTimezoneSelect(cs.timezone);
    _setVal('clock-mode',       cs.clockMode);
    _setVal('clock-font',       cs.clockFont);
    _setVal('clock-size',       cs.clockSize);
    _setVal('clock-color',      cs.clockColor || '#ffffff');
    _setVal('clock-face',       cs.faceStyle);
    _setVal('clock-hour-color', cs.hourColor);
    _setVal('clock-min-color',  cs.minColor);
    _setVal('clock-sec-color',  cs.secColor);
    _setChecked('clock-ticks',  cs.showTicks);
    var sizeLabel = document.getElementById('clock-size-label');
    if (sizeLabel) sizeLabel.textContent = cs.clockSize + 'px';
    _toggleClockModeOptions();
    _renderAnalogClockPreview();
  }

  // Helpers (reuse or add if not present)
  function _setChecked(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
  function _setVal(id, val)     { var el = document.getElementById(id); if (el) el.value = val; }

  function _toggleClockModeOptions() {
    var mode = document.getElementById('clock-mode')?.value;
    var dOpts = document.getElementById('clock-digital-options');
    var aOpts = document.getElementById('clock-analog-options');
    if (dOpts) dOpts.style.display = mode === 'digital' ? '' : 'none';
    if (aOpts) aOpts.style.display = mode === 'analog'  ? '' : 'none';
  }
  window._toggleClockModeOptions = _toggleClockModeOptions;

  function _populateTimezoneSelect(current) {
    var sel = document.getElementById('clock-timezone');
    if (!sel) return;
    if (sel.options.length > 1) { sel.value = current || ''; return; } // already populated
    var zones;
    try { zones = Intl.supportedValuesOf('timeZone'); }
    catch(e) {
      zones = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
               'America/Toronto','America/Sao_Paulo','Europe/London','Europe/Paris',
               'Europe/Berlin','Europe/Moscow','Asia/Dubai','Asia/Kolkata','Asia/Singapore',
               'Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];
    }
    sel.innerHTML = '<option value="">Browser default</option>' +
      zones.map(function(z) { return '<option value="'+z+'"'+(z===current?' selected':'')+'>'+z+'</option>'; }).join('');
    sel.value = current || '';
  }

Call _loadClockSettings() inside openSettingsModal() when the Other tab is activated, or unconditionally after other settings are loaded.

---

AC4b — Analog Clock Rendering (room.js + site.js)

FILE: wwwroot/js/room.js — add _renderAnalogClock function

  function _renderAnalogClock(now, tz, cs) {
    var container = document.getElementById('room-analog-clock');
    if (!container) return;
    var size = 60;
    var cx = size / 2, cy = size / 2, r = cx - 2;
    // Get local hour/min/sec in the selected timezone
    var parts = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false, timeZone: tz
    }).formatToParts(now);
    var get = function(t) { return parseInt((parts.find(p => p.type === t) || {value:'0'}).value); };
    var h = get('hour') % 12, m = get('minute'), s = get('second');
    var hAngle = (h + m/60) / 12 * 360 - 90;
    var mAngle = (m + s/60) / 60 * 360 - 90;
    var sAngle = s / 60 * 360 - 90;
    var toXY = function(angle, len) {
      var rad = angle * Math.PI / 180;
      return { x: cx + Math.cos(rad)*len, y: cy + Math.sin(rad)*len };
    };
    var faceStyle = cs.faceStyle || 'minimal';
    var faceFill  = faceStyle === 'filled' ? 'rgba(255,255,255,0.08)' : 'none';
    var faceStroke= faceStyle === 'minimal' ? 'none' : (cs.hourColor || '#fff');
    var ticks = '';
    if (cs.showTicks) {
      for (var i = 0; i < 12; i++) {
        var a = i / 12 * 360 - 90; var rad = a * Math.PI / 180;
        var x1 = cx + Math.cos(rad)*(r-1), y1 = cy + Math.sin(rad)*(r-1);
        var x2 = cx + Math.cos(rad)*(r-4), y2 = cy + Math.sin(rad)*(r-4);
        ticks += '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+(cs.hourColor||'#fff')+'" stroke-width="1.2" stroke-opacity="0.5"/>';
      }
    }
    var hPt = toXY(hAngle, r*0.5), mPt = toXY(mAngle, r*0.72), sPt = toXY(sAngle, r*0.85);
    container.innerHTML =
      '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+faceFill+'" stroke="'+faceStroke+'" stroke-width="1"/>' +
      ticks +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+hPt.x+'" y2="'+hPt.y+'" stroke="'+(cs.hourColor||'#fff')+'" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+mPt.x+'" y2="'+mPt.y+'" stroke="'+(cs.minColor||'#ccc')+'" stroke-width="1.8" stroke-linecap="round"/>' +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+sPt.x+'" y2="'+sPt.y+'" stroke="'+(cs.secColor||'#e05050')+'" stroke-width="1" stroke-linecap="round"/>' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="2" fill="'+(cs.secColor||'#e05050')+'"/>' +
      '</svg>';
    container.style.display = 'inline-block';
  }

FILE: wwwroot/js/site.js — add preview function (calls same logic on the 80px preview div)

  function _renderAnalogClockPreview() {
    var cs = _getClockSettings();
    var container = document.getElementById('clock-analog-preview');
    if (!container || cs.clockMode !== 'analog') return;
    // Temporarily set size to 80 for preview
    var now = new Date();
    var tz = cs.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Inline a mini version of _renderAnalogClock
    var size = 80;
    var cx = size/2, cy = size/2, r = cx - 3;
    var parts = new Intl.DateTimeFormat('en-GB', {
      hour:'numeric', minute:'numeric', second:'numeric', hour12:false, timeZone:tz
    }).formatToParts(now);
    var get = function(t) { return parseInt((parts.find(p=>p.type===t)||{value:'0'}).value); };
    var h = get('hour')%12, m = get('minute'), s = get('second');
    var hA = (h+m/60)/12*360-90, mA = (m+s/60)/60*360-90, sA = s/60*360-90;
    var toXY = function(a,l){ var rad=a*Math.PI/180; return {x:cx+Math.cos(rad)*l, y:cy+Math.sin(rad)*l}; };
    var hPt=toXY(hA,r*0.5), mPt=toXY(mA,r*0.72), sPt=toXY(sA,r*0.85);
    var faceStyle=cs.faceStyle||'minimal';
    var faceFill=faceStyle==='filled'?'rgba(255,255,255,0.08)':'none';
    var faceStroke=faceStyle==='minimal'?'none':(cs.hourColor||'#fff');
    var ticks='';
    if (cs.showTicks) {
      for(var i=0;i<12;i++){
        var a=i/12*360-90, rad=a*Math.PI/180;
        var x1=cx+Math.cos(rad)*(r-1), y1=cy+Math.sin(rad)*(r-1);
        var x2=cx+Math.cos(rad)*(r-5), y2=cy+Math.sin(rad)*(r-5);
        ticks+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+(cs.hourColor||'#fff')+'" stroke-width="1.5" stroke-opacity="0.5"/>';
      }
    }
    container.innerHTML='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+faceFill+'" stroke="'+faceStroke+'" stroke-width="1.5"/>' +
      ticks +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+hPt.x+'" y2="'+hPt.y+'" stroke="'+(cs.hourColor||'#fff')+'" stroke-width="3" stroke-linecap="round"/>' +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+mPt.x+'" y2="'+mPt.y+'" stroke="'+(cs.minColor||'#ccc')+'" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="'+cx+'" y1="'+cy+'" x2="'+sPt.x+'" y2="'+sPt.y+'" stroke="'+(cs.secColor||'#e05050')+'" stroke-width="1.2" stroke-linecap="round"/>' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="2.5" fill="'+(cs.secColor||'#e05050')+'"/>' +
      '</svg>';
  }
  window._renderAnalogClockPreview = _renderAnalogClockPreview;

Note: the analog preview in settings updates live as color pickers/dropdowns change because saveClockSettingsFromForm() calls _renderAnalogClockPreview() on every change.

---

WIRING CHECKLIST

1. room.js: _startCountUp() / _stopCountUp() wired to CurrentStoryChanged and RoomState handlers
2. room.js: _startClock() called after connection.start() resolves
3. room.js: _getClockSettings() reads from localStorage (copy the same _getClockSettings defined in site.js, or expose it via window._getClockSettings)
4. site.js: _loadClockSettings() called in openSettingsModal() (add after existing settings loads)
5. _Layout.cshtml: room-clock-widget HTML placed near currentStoryDisplay (search for id="currentStoryDisplay" in the Razor view or _Layout — confirm exact location)
6. _Layout.cshtml: Timer & Clock section added inside tab-other before closing tag
7. site.css: .room-clock-widget, .room-timer, .room-clock, #room-analog-clock styles added

SHARED ACCESS PATTERN (avoid duplication):
Expose on window from site.js:
  window._getClockSettings = _getClockSettings;
  window._renderAnalogClockPreview = _renderAnalogClockPreview;
room.js calls window._getClockSettings() so both files share a single definition.
