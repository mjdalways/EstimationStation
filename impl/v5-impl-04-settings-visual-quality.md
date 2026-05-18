FEATURE PLAN v5.0 — GROUPS W (VISUAL TAB) + Z (SETTINGS QUALITY) + N (SETTINGS ORG DEFERRED)
Files: Views/Shared/_Layout.cshtml, wwwroot/js/site.js, wwwroot/js/room.js, Hubs/PokerHub.cs

---

W1 — New "Visual" Settings Tab

FILE: Views/Shared/_Layout.cshtml

1. Add tab nav button after the Theme tab button (line 84):
   <button class="nav-link" id="tab-visual-btn" data-bs-toggle="tab" data-bs-target="#tab-visual" type="button">👁️ Visual</button>

2. Add tab pane after tab-theme pane:
   <div class="tab-pane fade" id="tab-visual" role="tabpanel">
     <!-- Contents: W2, W3, W4 items below -->
   </div>

3. Move Compact Participant Cards from Theme tab (lines 329-332):
   Cut the compact-mode-toggle section from tab-theme and paste into tab-visual.
   Check site.js applyCompactMode() (line 265) — it reads 'es_compactMode' and toggles .compact class on #participantsContainer. No change to JS needed.

4. Audit other immediate-apply settings for Visual tab candidacy:
   - Card font size slider (id=card-font-size-slider, _Layout ~line 324): applies immediately via CSS var. Move to Visual tab.
   - Any other settings that update DOM instantly on change (not on Save).
   Leave settings that require theme save in Theme tab.

---

W2 — Compact Participant Cards: Before/After Preview

FILE: Views/Shared/_Layout.cshtml — inside the new tab-visual pane (W1)

After the compact-mode-toggle checkbox, add a before/after preview:
  <div class="d-flex gap-3 mt-2" id="compact-preview-area">
    <div>
      <div class="text-muted small mb-1">Normal</div>
      <div class="participant-badge" style="pointer-events:none;min-width:80px;padding:0.6rem 0.9rem;">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:0.85rem;color:#fff;">A</div>
        <span style="font-size:0.8rem;">Alex</span>
        <span class="vote-hidden">✓</span>
      </div>
    </div>
    <div>
      <div class="text-muted small mb-1">Compact</div>
      <div id="compact-preview-right" class="participant-badge" style="pointer-events:none;min-width:56px;padding:0.3rem 0.5rem;">
        <div style="width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#fff;">A</div>
        <span style="font-size:0.7rem;">Alex</span>
        <span class="vote-hidden">✓</span>
      </div>
    </div>
  </div>

The right badge is a static mockup of compact sizing. No JS needed — it's always shown in compact dimensions to illustrate the toggle's effect.

FILE: wwwroot/js/site.js — applyCompactMode() at line 265

When compact toggle changes, also add a brief highlight animation to #participantsContainer to show the change was applied:
  document.getElementById('participantsContainer')?.classList.add('just-changed');
  setTimeout(() => document.getElementById('participantsContainer')?.classList.remove('just-changed'), 600);

In site.css: .just-changed { outline: 2px solid var(--accent); outline-offset: 4px; transition: outline 0.5s; }

---

W3 — Live Card + Participant Preview Area

FILE: Views/Shared/_Layout.cshtml — inside tab-visual pane, at top (before other controls)

Add a live preview section at the top of the Visual tab:
  <div class="settings-live-preview p-3 mb-3" style="background:var(--bg3);border-radius:10px;border:1px solid var(--border);">
    <div class="text-muted small mb-2">Live Preview</div>
    <div class="d-flex gap-3 align-items-flex-start">
      <!-- Participant badge preview -->
      <div>
        <div class="text-muted small mb-1">Participant</div>
        <div class="participant-badge voted" id="live-preview-badge" style="pointer-events:none;">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;">A</div>
          <span class="participant-name" style="font-size:var(--card-font-size,0.8rem);">Alex</span>
          <span class="vote-hidden">✓</span>
        </div>
      </div>
      <!-- Voting card preview -->
      <div>
        <div class="text-muted small mb-1">Vote Card</div>
        <div class="poker-card" id="live-preview-vote-card" style="pointer-events:none;">5</div>
      </div>
      <!-- Revealed badge preview -->
      <div>
        <div class="text-muted small mb-1">Revealed</div>
        <div class="participant-badge voted revealing" id="live-preview-revealed" style="pointer-events:none;">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;">A</div>
          <span class="participant-name" style="font-size:var(--card-font-size,0.8rem);">Alex</span>
          <span class="participant-vote">5</span>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-secondary align-self-end" onclick="testCardBackFlip()">▶ Test Flip</button>
    </div>
  </div>

The live-preview-badge inherits all applied CSS classes (card-back-*, compact via its container, etc.) automatically since it uses the same class names as real badges.

The live-preview-badge is outside #participantsContainer so compact mode CSS (.compact on #participantsContainer) won't affect it. For the compact preview, rely on W2's dedicated preview area.

---

W4 — "How Confident Are You?" Popup Toggle

FILE: wwwroot/js/room.js — VoteCast handler at line 127-145

CURRENT: #confidenceSelector is shown whenever the local user hasVoted (line 142):
  if (connectionId === connection.connectionId) {
    const sel = document.getElementById('confidenceSelector');
    if (sel) sel.style.display = hasVoted ? 'block' : 'none';
  }

CHANGE:
Wrap in setting check:
  if (connectionId === connection.connectionId) {
    const showConf = localStorage.getItem('es_showConfidence') !== '0';
    const sel = document.getElementById('confidenceSelector');
    if (sel) sel.style.display = (hasVoted && showConf) ? 'block' : 'none';
  }

FILE: Views/Shared/_Layout.cshtml — tab-visual pane

Add toggle:
  <div class="form-check form-switch mt-3">
    <input class="form-check-input" type="checkbox" id="show-confidence-toggle" checked
           onchange="localStorage.setItem('es_showConfidence', this.checked ? '1' : '0')">
    <label class="form-check-label" for="show-confidence-toggle">Show "How confident are you?" prompt after voting</label>
  </div>

In openSettingsModal() in site.js (~line 81), populate:
  var ct = document.getElementById('show-confidence-toggle');
  if (ct) ct.checked = localStorage.getItem('es_showConfidence') !== '0';

---

Z1 — Settings Search

FILE: Views/Shared/_Layout.cshtml — inside #settingsModal, above the tab nav (before line 82)

Add search input:
  <div class="px-3 pt-2 pb-1" id="settings-search-bar">
    <input type="text" id="settings-search-input" class="form-control form-control-sm" placeholder="🔍 Search settings..."
           oninput="filterSettings(this.value)" autocomplete="off">
  </div>

FILE: wwwroot/js/site.js (add near openSettingsModal, ~line 81)

function filterSettings(query) {
  var q = query.toLowerCase().trim();
  if (!q) {
    // Clear filter — show all, restore to active tab
    document.querySelectorAll('.tab-pane .form-check, .tab-pane .mb-3, .tab-pane section').forEach(el => el.style.display = '');
    return;
  }
  // Search all setting labels within all tabs
  var tabs = document.querySelectorAll('.tab-pane');
  tabs.forEach(function(pane) {
    var labels = pane.querySelectorAll('label, h6, .settings-section-header span');
    var hasMatch = false;
    labels.forEach(function(label) {
      var match = label.textContent.toLowerCase().includes(q);
      var row = label.closest('.form-check') || label.closest('.mb-3') || label.closest('section') || label.parentElement;
      if (row) row.style.display = match ? '' : 'none';
      if (match) hasMatch = true;
    });
    // Auto-switch to tab with matches
    if (hasMatch) {
      var tabBtnId = pane.id.replace('tab-','tab-') + '-btn';
      var btn = document.getElementById(tabBtnId);
      if (btn && !btn.classList.contains('active')) btn.click();
    }
  });
}

Add a clear (✕) button that appears when search has text:
  In the oninput handler, toggle visibility of a clear button and call filterSettings('') when clicked.

Add to CSS: #settings-search-bar { border-bottom: 1px solid var(--border); }

---

Z2 — Bulk Controls Per Settings Tab

FILE: Views/Shared/_Layout.cshtml — add at top of each applicable tab pane (Celebrations, Audio, Seasons, Visual)

For each tab, add a small control row immediately inside the tab-pane div:
  <div class="d-flex gap-2 mb-3 pb-2" style="border-bottom:1px solid var(--border);">
    <button class="btn btn-xs btn-outline-secondary" onclick="tabBulkAll(this,'on')">All On</button>
    <button class="btn btn-xs btn-outline-secondary" onclick="tabBulkAll(this,'off')">All Off</button>
    <button class="btn btn-xs btn-outline-danger" onclick="tabBulkReset(this)">↩ Reset Tab</button>
  </div>

FILE: wwwroot/js/site.js

function tabBulkAll(btn, state) {
  var pane = btn.closest('.tab-pane');
  pane.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
    cb.checked = (state === 'on');
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function tabBulkReset(btn) {
  if (!confirm('Reset all settings in this tab to defaults?')) return;
  var pane = btn.closest('.tab-pane');
  var tabId = pane.id;
  // Each tab needs a reset function. Call tab-specific reset:
  var resetFns = {
    'tab-celebration': resetCelebrationDefaults,
    'tab-audio': resetAudioDefaults,
    'tab-seasons': resetSeasonDefaults,
    'tab-visual': resetVisualDefaults,
  };
  if (resetFns[tabId]) resetFns[tabId]();
}

Create resetCelebrationDefaults(), resetAudioDefaults(), resetSeasonDefaults(), resetVisualDefaults() functions that:
- Clear relevant localStorage keys for that tab
- Call the populate function for that tab (e.g., populateCelebrationTab(), populateAudioTab())

---

Z3 — Global Settings Controls (Export / Import / All Off / All On / Reset All)

FILE: Views/Shared/_Layout.cshtml — at top of #settingsModal modal-body, before settings-search-bar (Z1)

  <div class="d-flex gap-2 px-3 pt-2 pb-2 flex-wrap" id="settings-global-bar" style="border-bottom:1px solid var(--border);background:var(--bg3);">
    <button class="btn btn-xs btn-outline-secondary" onclick="globalSettingsAllOff()">🔇 All Off</button>
    <button class="btn btn-xs btn-outline-secondary" onclick="globalSettingsAllOn()">✨ All On</button>
    <button class="btn btn-xs btn-outline-danger" onclick="globalSettingsReset()">↩ Reset All</button>
    <button class="btn btn-xs btn-outline-info" onclick="exportSettings()">📤 Export</button>
    <label class="btn btn-xs btn-outline-info mb-0">📥 Import<input type="file" accept=".json" style="display:none" onchange="importSettings(this)"></label>
  </div>

FILE: wwwroot/js/site.js

function globalSettingsAllOff() {
  // Disable all checkbox toggles across all tabs
  document.querySelectorAll('#settingsModal input[type="checkbox"]').forEach(cb => {
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function globalSettingsAllOn() {
  document.querySelectorAll('#settingsModal input[type="checkbox"]').forEach(cb => {
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function globalSettingsReset() {
  if (!confirm('Reset ALL settings to factory defaults? This cannot be undone.')) return;
  // Clear all es_* keys from localStorage
  Object.keys(localStorage).filter(k => k.startsWith('es_') || k.startsWith('sea_')).forEach(k => localStorage.removeItem(k));
  location.reload();
}
function exportSettings() {
  var data = {};
  Object.keys(localStorage).filter(k => k.startsWith('es_') || k.startsWith('sea_')).forEach(k => data[k] = localStorage.getItem(k));
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'estimationstation-settings-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
}
function importSettings(input) {
  var file = input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      Object.entries(data).forEach(([k,v]) => { if (k.startsWith('es_') || k.startsWith('sea_')) localStorage.setItem(k,v); });
      location.reload();
    } catch(err) { alert('Invalid settings file.'); }
  };
  reader.readAsText(file);
}

---

N3 — Reveal Majority First: Move to Room-Level Global Setting (DEFERRED)

FILE: Hubs/PokerHub.cs — add after ToggleAutoReveal (line 400)

public async Task ToggleRevealOrdering(bool enabled) {
    var room = _roomService.GetRoom(Context.Items["RoomName"]?.ToString());
    if (room == null) return;
    room.RevealMajorityFirst = enabled;
    await Clients.Group(room.Name).SendAsync("RevealOrderingChanged", enabled);
}

Add RevealMajorityFirst bool property to the Room model.

FILE: wwwroot/js/room.js

Add handler: connection.on('RevealOrderingChanged', function(enabled) { roomState.revealMajorityFirst = enabled; });
In _sequentialReveal() (line 1381), replace reading from localStorage with roomState.revealMajorityFirst.
Remove the localStorage-based checkbox from Events tab; move the control to the room controls panel (near auto-reveal checkbox in the main room UI).

---

N4 — Collapsible Sections Within Settings Tabs

Covered partially by U5 (which adds collapsible sections to Events/Celebrations tab and Card Backs).
Apply same pattern to remaining tabs:
- Audio tab: group into Broadcast, Local Sounds, Timer sections
- Seasons tab: group into Seasons, Major Holidays, USA Federal, Family, British, Global & Cultural, Niche sections (these sections already exist as headings in _Layout:827-911)

For seasons specifically: wrap each section heading and its rows in a collapse group.
First section (Seasons) open by default; all others closed.
Persist state via localStorage 'es_settingsOpen_' keys (as per U5 pattern).

---

N5 — Sound Confirmation on Room Join

FILE: wwwroot/js/room.js — after connection.start() succeeds (find the .then() or await after connection.start(), around the JoinRoom invoke area ~line 52)

After a successful JoinRoom connection, add:
  function _checkSoundDialog() {
    if (sessionStorage.getItem('es_soundAsked')) return;
    var cs = getCelebrationSettings();
    var as = typeof getAmbientSettings === 'function' ? getAmbientSettings() : {};
    var hasSounds = cs.lavaEnabled || (as && as.source && as.source !== 'none') || !getAllSoundsOff?.();
    if (!hasSounds) return;
    sessionStorage.setItem('es_soundAsked', '1');
    // Show a Bootstrap toast or small modal
    var html = '<div class="toast show position-fixed bottom-0 end-0 m-3" id="sound-ask-toast" style="z-index:2000;min-width:280px;">' +
      '<div class="toast-body"><b>🔊 Sounds are configured.</b><br>Choose your preference:<br><br>' +
      '<div class="d-flex flex-wrap gap-2">' +
      '<button class="btn btn-sm btn-primary" onclick="_setSoundMode(\'all\')">All sounds</button>' +
      '<button class="btn btn-sm btn-outline-secondary" onclick="_setSoundMode(\'local\')">Local only</button>' +
      '<button class="btn btn-sm btn-outline-secondary" onclick="_setSoundMode(\'broadcast\')">Broadcast only</button>' +
      '<button class="btn btn-sm btn-outline-danger" onclick="_setSoundMode(\'none\')">No sounds</button>' +
      '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }
  function _setSoundMode(mode) {
    document.getElementById('sound-ask-toast')?.remove();
    if (mode === 'none') { if (typeof saveAllSoundsOff === 'function') saveAllSoundsOff(true); }
    else if (mode === 'all') { if (typeof saveAllSoundsOff === 'function') saveAllSoundsOff(false); }
    // 'local' and 'broadcast' modes would need additional settings keys — implement if needed
  }

Call _checkSoundDialog() after the RoomState handler runs the first time (add a flag: _soundDialogShown).
