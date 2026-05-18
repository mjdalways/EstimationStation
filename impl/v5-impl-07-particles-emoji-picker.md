FEATURE PLAN v5.0 — GROUPS O5 (PARTICLE SHAPES) + O6 (EMOJI PICKER)
Files: wwwroot/js/celebration.js, Views/Shared/_Layout.cshtml, wwwroot/js/site.js

KEY FACTS:
- Card reveal particles: celebration.js previewParticlesAt(el) at lines 907-920. Reads #cel-reveal-particle-type select.
- confetti() call in celebration.js uses canvas-confetti library. Shape options: confetti.shapeFromPath(), confetti.shapeFromText(), built-ins: 'circle','square','star'.
- DEFAULT_CELEBRATION at line 26: revealParticleType:'star' (line 107), revealParticleCount:8 (line 108).
- _Layout.cshtml Celebrations tab: cel-reveal-particle-type select at line 548 (options: "star","circle","square"). cel-reveal-particle-count input at line 554.
- Confetti emoji particles: cel-confetti-emojis input at line 626 (hidden unless confetti type = 'emoji').

---

O5 — Card Reveal Particle Shapes + Custom Emoji

FILE: Views/Shared/_Layout.cshtml — Celebrations tab, near cel-reveal-particle-type (line 541-556)

CURRENT: Simple select with 3 options (star, circle, square).

REPLACE the select with a grid of toggle buttons + custom emoji input:

  <div class="mb-2">
    <label class="small fw-bold">Reveal Particle Shapes</label>
    <div class="d-flex flex-wrap gap-1 mt-1" id="reveal-particle-shapes">
      <!-- Preset shape buttons, each with data-shape attribute -->
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="star" title="Star">★</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="circle" title="Circle">●</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="square" title="Square">■</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:♠" title="Spade">♠</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:♥" title="Heart">♥</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:♦" title="Diamond">♦</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:♣" title="Club">♣</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:👑" title="Crown">👑</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:⚡" title="Lightning">⚡</button>
      <button type="button" class="btn btn-sm btn-outline-secondary particle-shape-btn" data-shape="emoji:✨" title="Sparkle">✨</button>
    </div>
    <div class="input-group input-group-sm mt-1" style="max-width:280px;">
      <input type="text" id="reveal-particle-custom" class="form-control" placeholder="Custom emoji (e.g. 🎉🎊)">
      <button class="btn btn-outline-secondary" type="button" onclick="addCustomParticleEmoji()">+ Add</button>
    </div>
    <div class="text-muted small mt-1">Selected: <span id="reveal-particle-selected-label">star</span></div>
    <button class="btn btn-xs btn-outline-secondary mt-1" onclick="testRevealParticles()">🧪 Test Burst</button>
  </div>

Keep cel-reveal-particle-count input as-is. Remove the old cel-reveal-particle-type select (it was at line 548) or hide it.

FILE: wwwroot/js/site.js (or celebration.js) — add particle shape management

var _selectedParticleShapes = [];  // array of shape identifiers (e.g. 'star', 'emoji:♠', 'emoji:🎉')

// Load selected shapes from settings
function _loadParticleShapes() {
  var cs = getCelebrationSettings();
  // Extend DEFAULT_CELEBRATION to support array of shapes: revealParticleShapes: ['star']
  _selectedParticleShapes = cs.revealParticleShapes || [cs.revealParticleType || 'star'];
  _renderParticleShapeButtons();
}

function _renderParticleShapeButtons() {
  document.querySelectorAll('.particle-shape-btn').forEach(function(btn) {
    var shape = btn.dataset.shape;
    btn.classList.toggle('btn-primary', _selectedParticleShapes.includes(shape));
    btn.classList.toggle('btn-outline-secondary', !_selectedParticleShapes.includes(shape));
  });
  document.getElementById('reveal-particle-selected-label').textContent = _selectedParticleShapes.join(', ') || 'none';
}

// Toggle a shape on/off
document.addEventListener('click', function(e) {
  if (!e.target.classList.contains('particle-shape-btn')) return;
  var shape = e.target.dataset.shape;
  var idx = _selectedParticleShapes.indexOf(shape);
  if (idx >= 0) _selectedParticleShapes.splice(idx, 1);
  else _selectedParticleShapes.push(shape);
  _renderParticleShapeButtons();
  // Save to celebration settings
  var cs = getCelebrationSettings();
  cs.revealParticleShapes = _selectedParticleShapes.slice();
  saveCelebrationSettings(cs);
});

function addCustomParticleEmoji() {
  var input = document.getElementById('reveal-particle-custom');
  var val = input.value.trim();
  if (!val) return;
  // Split into individual emoji characters and add each
  Array.from(val).forEach(function(ch) {
    var shape = 'emoji:' + ch;
    if (!_selectedParticleShapes.includes(shape)) _selectedParticleShapes.push(shape);
    // Also add a visible button for it
    var container = document.getElementById('reveal-particle-shapes');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-primary particle-shape-btn';
    btn.dataset.shape = shape;
    btn.textContent = ch;
    container.appendChild(btn);
  });
  input.value = '';
  _renderParticleShapeButtons();
  var cs = getCelebrationSettings();
  cs.revealParticleShapes = _selectedParticleShapes.slice();
  saveCelebrationSettings(cs);
}
window.addCustomParticleEmoji = addCustomParticleEmoji;

FILE: wwwroot/js/celebration.js — _liveParticleShape() (used in previewParticlesAt, line ~910) and card reveal burst

CURRENT: reads #cel-reveal-particle-type value to get a single shape string.

CHANGE _liveParticleShape() to return an array of confetti shape objects:
function _liveParticleShape() {
  var cs = getCelebrationSettings();
  var shapes = cs.revealParticleShapes || [cs.revealParticleType || 'star'];
  // Map each to a confetti shape
  return shapes.map(function(s) {
    if (s.startsWith('emoji:')) {
      return confetti.shapeFromText({ text: s.slice(6), scalar: 2 });
    }
    return s; // 'star', 'circle', 'square' are built-in confetti shapes
  });
}

In _sequentialReveal() where it calls the confetti/particle burst per card:
  confetti({ shapes: _liveParticleShape(), ... });  // pass shapes array instead of single shape

---

O6 — Reusable Emoji/Shape/Unicode Picker

FILE: wwwroot/js/site.js or new file wwwroot/js/emoji-picker.js

Create a lightweight picker that can attach to any text input via data-picker-target attribute.

PICKER HTML (injected once into document.body):
  var _PICKER_HTML = '<div id="_emoji_picker" class="dropdown-menu show p-2" style="display:none;position:fixed;z-index:10000;width:320px;max-height:380px;overflow:hidden;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.4);">' +
    '<div class="d-flex gap-1 mb-2 flex-wrap" id="_ep_cats"></div>' +
    '<input type="text" id="_ep_search" class="form-control form-control-sm mb-2" placeholder="Search emoji...">' +
    '<div id="_ep_grid" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-height:280px;overflow-y:auto;"></div>' +
    '</div>';

EMOJI CATEGORIES (embed minimal data inline or load lazily):
  var _EP_CATS = {
    'Smileys': ['😀','😂','😊','😍','🥰','😎','🤔','😮','😢','😡','🥳','😴'],
    'Symbols': ['❤️','⭐','✨','🔥','💯','✅','❌','⚡','🎉','🎊','🏆','🎯','💎','🎲','🎮'],
    'Cards': ['♠','♥','♦','♣','🃏','🀄'],
    'Shapes': ['★','●','■','▲','◆','✚','✦','✧','⬛','⬜','🔴','🔵','🟢','🟡'],
    'Nature': ['🌸','🌺','🌻','🍀','🌈','❄️','🌊','⛅','🌙','☀️'],
    'Animals': ['🦈','🐠','🐙','🦁','🦊','🐺','🦋','🐸','🐧','🦄'],
    'Objects': ['👑','💡','🔑','⚔️','🛡️','🚀','💻','📱','🎵','🎸'],
  };

PICKER FUNCTIONS:
function _epInit() {
  if (document.getElementById('_emoji_picker')) return;
  document.body.insertAdjacentHTML('beforeend', _PICKER_HTML);
  // Build category tabs
  var cats = document.getElementById('_ep_cats');
  Object.keys(_EP_CATS).forEach(function(cat) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-xs btn-outline-secondary';
    btn.textContent = cat;
    btn.onclick = function() { _epShowCat(cat); };
    cats.appendChild(btn);
  });
  // Search handler
  document.getElementById('_ep_search').addEventListener('input', function() {
    var q = this.value.toLowerCase();
    _epShowSearch(q);
  });
  // Close on outside click
  document.addEventListener('mousedown', function(e) {
    var picker = document.getElementById('_emoji_picker');
    if (picker && !picker.contains(e.target) && !e.target.dataset.pickerTarget) {
      picker.style.display = 'none';
    }
  });
  _epShowCat(Object.keys(_EP_CATS)[0]);
}

var _epTargetInput = null;
function openEmojiPicker(targetInputId, triggerEl) {
  _epInit();
  _epTargetInput = document.getElementById(targetInputId);
  var picker = document.getElementById('_emoji_picker');
  var rect = triggerEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  picker.style.display = '';
  document.getElementById('_ep_search').value = '';
  _epShowCat(Object.keys(_EP_CATS)[0]);
}
window.openEmojiPicker = openEmojiPicker;

function _epShowCat(cat) {
  _epRenderGrid(_EP_CATS[cat] || []);
}

function _epShowSearch(q) {
  if (!q) { _epShowCat(Object.keys(_EP_CATS)[0]); return; }
  var all = [].concat(...Object.values(_EP_CATS));
  _epRenderGrid(all);  // simple: show all and filter by display
}

function _epRenderGrid(items) {
  var grid = document.getElementById('_ep_grid');
  grid.innerHTML = items.map(function(e) {
    return '<button type="button" class="btn btn-sm p-1" style="font-size:1.3rem;line-height:1;" onclick="_epSelect(\'' + e + '\')" title="' + e + '">' + e + '</button>';
  }).join('');
}

function _epSelect(emoji) {
  if (!_epTargetInput) return;
  var cur = _epTargetInput.value;
  _epTargetInput.value = cur + emoji;
  _epTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
  // Close picker
  document.getElementById('_emoji_picker').style.display = 'none';
}

ATTACH TO INPUTS VIA DATA ATTRIBUTE:
Auto-attach picker buttons to any input with data-picker-target attribute:
  function _epAutoAttach() {
    document.querySelectorAll('[data-picker-target]').forEach(function(input) {
      if (input._epAttached) return;
      input._epAttached = true;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline-secondary ms-1';
      btn.textContent = '🔍';
      btn.title = 'Pick emoji';
      btn.setAttribute('data-picker-target', input.id);
      btn.onclick = function(e) { e.stopPropagation(); openEmojiPicker(input.id, btn); };
      input.parentNode.insertBefore(btn, input.nextSibling);
    });
  }

Call _epAutoAttach() on DOMContentLoaded and after settings modal opens.

TO USE: add data-picker-target to any emoji input:
  <input type="text" id="cel-confetti-emojis" data-picker-target ...>
  <input type="text" id="reveal-particle-custom" data-picker-target ...>
  <input type="text" id="reactions-palette-input" data-picker-target ...>
  (and season emoji inputs once AA is built)

RECENTLY USED:
  var _epRecent = JSON.parse(localStorage.getItem('es_emojiRecent') || '[]');
  function _epAddRecent(emoji) {
    _epRecent = [emoji, ..._epRecent.filter(e => e !== emoji)].slice(0, 16);
    localStorage.setItem('es_emojiRecent', JSON.stringify(_epRecent));
  }
  Call _epAddRecent(emoji) inside _epSelect().
  Add a 'Recent' category tab that shows _epRecent when clicked.
