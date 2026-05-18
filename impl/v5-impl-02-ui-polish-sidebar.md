FEATURE PLAN v5.0 — GROUPS U (UI POLISH) + V (SIDEBAR RESIZE)
Files: Views/Shared/_Layout.cshtml, Views/Home/Index.cshtml, wwwroot/js/room.js, wwwroot/css/site.css

---

U1 — Hover Text on All Icons and Buttons

FILE: Views/Shared/_Layout.cshtml, Views/Home/Index.cshtml

Add title="" attributes to every interactive element that currently lacks one.
Known missing (all in _Layout.cshtml):
- Navbar settings button (line 56): add title="Settings"
- Navbar install app button (line 57, id=installAppBtn): add title="Add to Home Screen"
- All icon-only buttons in the room controls area (search for btn-outline and icon-only patterns)
- Change Name button: search for UpdateName or changeName onclick, add title="Change display name"
- Leave Room button: search for LeaveRoom onclick (line 993 in room.js invokes it), find the button in _Layout, add title="Leave room"
- Microphone badge/icon: add title="Toggle voice recognition (click to start/stop)"
- Avatar display in navbar: add title="Change avatar"
- Ghost mode button: add title="Toggle ghost/observer mode"
- Copy room link button: add title="Copy room link"

FILE: wwwroot/js/room.js — renderStories() line 500:
Story row buttons (lines 535-536):
- Play button (▶): add title="Set as current story"
- Delete button (✕): add title="Delete story"
- Notes button (📝, line 534): add title="Add/edit notes"

INDEX.cshtml:
- Settings gear on lobby header (line 9): already has title="Settings" per agent — verify.
- Any other clickable elements without titles.

---

U2 — Story Notes Display Below Story Name (Not Far Right)

FILE: wwwroot/js/room.js — renderStories() at line ~500

CURRENT STRUCTURE (lines 528-541): The story row has a notes button on the far right alongside play/delete. The notes preview (story-notes-preview div) appears inline in the row, pushing buttons left.

TARGET STRUCTURE: Two-column row — left column holds [story title + notes preview stacked vertically], right column holds [play, delete, notes buttons].

CHANGE renderStories() HTML template:
Replace the current single-div row with a flex row:
  <div class="story-row d-flex align-items-start gap-2">
    <div class="story-text flex-grow-1 min-w-0">
      <span class="story-title">${title}</span>
      ${hasNote ? '<div class="story-notes-preview text-muted small">' + notes.substring(0,80) + (notes.length>80?'…':'') + '</div>' : ''}
    </div>
    <div class="story-actions d-flex gap-1 flex-shrink-0">
      [play button][delete button][notes button]
    </div>
  </div>
  <div class="story-notes-area" id="noteArea_${s.id}" style="display:none;">
    <textarea ...>...</textarea>
  </div>

In site.css, add:
  .story-text { overflow: hidden; }
  .story-title { display: block; }
  .story-notes-preview { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }

---

U3 — Override/Accept Button Clarity

FILE: Views/Shared/_Layout.cshtml — find the Accept/Override button (search 'acceptEstimate' or 'Override')

CURRENT: Button likely reads "Accept" or "Override & Accept".
CHANGE:
1. Default label (when no override typed): "✅ Accept & Add to Story"
2. Add oninput handler to the estimate override input field. When user types a value different from consensus, update button label to "✅ Override to [value] & Add to Story".
3. Add title attribute: "Sets the final estimate for this story and marks it complete"

JS (inline or in room.js near acceptEstimate() invocation):
  const overrideInput = document.getElementById('ESTIMATE_INPUT_ID');  // find the actual ID
  const acceptBtn = document.getElementById('ACCEPT_BTN_ID');           // find actual ID
  overrideInput.addEventListener('input', function() {
    const v = this.value.trim();
    acceptBtn.textContent = v ? '✅ Override to ' + v + ' & Add to Story' : '✅ Accept & Add to Story';
  });

Search _Layout.cshtml for 'completeStory' or 'acceptEstimate' onclick to find the exact IDs.

---

U4 — Label Renames

FILE: Views/Shared/_Layout.cshtml

1. "Card Backs" → "Participant Card Backs":
   Search for 'Card Back' or 'Card Backs' in _Layout (the section header in Theme tab around line 397-414). Change section heading. Also update cardBackSelect label.

2. "Autumn" → "Fall/Autumn":
   Line 847: Find checkbox label for cel-seasonal-autumn. Change text to "Fall/Autumn".
   Also in seasonal.js SEA_ANIM_META (or wherever 'Autumn' appears as a display name), change to 'Fall/Autumn'.

3. Voice Activate Reveal → move to Audio tab:
   Current location: Other tab (tab-other) at lines 1458-1491.
   Target: Audio tab (tab-audio) around line 921+.
   Cut the Voice-Activated Reveal section HTML (lines 1458-1491) and paste it into the Audio tab after the Timer Audio section (after line 983).
   Keep the rest of the Other tab intact.

---

U5 — Events and Card Backs: Style Consistency + Collapsible

FILE: Views/Shared/_Layout.cshtml

CONTEXT: The Events (tab-celebration) sections and Card Backs section (in tab-theme ~line 397) currently use plain headings. Other sections use a styled card/panel approach.

CHANGES:
1. Wrap each major section in Events tab in a collapsible Bootstrap collapse group:
   Pattern for each section (e.g., Floor Is Lava, Confetti, Fireworks, etc.):
   <div class="settings-section-header" data-bs-toggle="collapse" data-bs-target="#sec-SECTIONNAME" aria-expanded="false">
     <span>🌋 Floor is Lava</span><span class="ms-auto">▾</span>
   </div>
   <div class="collapse" id="sec-SECTIONNAME">
     [existing section content]
   </div>
   Default first section open: add 'show' class to its collapse div.

2. Apply same collapsible pattern to Card Backs section (sec-card-back around line 403).

3. Add CSS in site.css (or inline in _Layout) for the header:
   .settings-section-header { cursor:pointer; padding:8px 12px; background:var(--bg3); border-radius:8px; margin:10px 0 4px; display:flex; align-items:center; font-weight:600; font-size:0.9rem; user-select:none; }
   .settings-section-header:hover { background:var(--bg2); }

4. Persist open/closed state per section:
   On collapse show/hide Bootstrap events, save to localStorage:
   document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(btn => {
     const target = btn.dataset.bsTarget;
     btn.addEventListener('click', () => {
       const isOpen = document.querySelector(target).classList.contains('show');
       localStorage.setItem('es_settingsOpen_' + target.replace('#',''), isOpen ? '0' : '1');
     });
   });
   On settings modal open (in openSettingsModal() in site.js ~line 81), restore states.

---

V1 — Draggable Sidebar Resize

FILE: Views/Shared/_Layout.cshtml + wwwroot/css/site.css + wwwroot/js/room.js

CURRENT: .stories-panel has fixed width from CSS grid (260px column, line 327). No resize handle exists.

IMPLEMENTATION:
1. In _Layout.cshtml, add a resize handle div immediately after the stories-panel opening tag:
   <div id="sidebar-resize-handle" aria-hidden="true"></div>

2. In site.css:
   #sidebar-resize-handle {
     position: absolute; right: 0; top: 0; width: 5px; height: 100%;
     cursor: ew-resize; z-index: 10;
     background: transparent;
   }
   #sidebar-resize-handle:hover { background: rgba(91,141,238,0.3); }
   .stories-panel { position: relative; }  /* needed for absolute handle */

   Find the CSS grid rule that sets the stories panel column width (search for '260px' or 'grid-template-columns' around line 327). Change from fixed to a CSS variable:
   grid-template-columns: var(--sidebar-width, 260px) 1fr;

3. In room.js (add near the sidebar mobile functions around line 690), add resize logic:
   (function() {
     var handle = document.getElementById('sidebar-resize-handle');
     if (!handle) return;
     var dragging = false, startX, startW;
     var panel = document.querySelector('.stories-panel');
     var MIN_W = 180; var MAX_W = Math.floor(window.innerWidth * 0.4);
     handle.addEventListener('mousedown', function(e) {
       dragging = true; startX = e.clientX; startW = panel.offsetWidth;
       document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
     });
     document.addEventListener('mousemove', function(e) {
       if (!dragging) return;
       var w = Math.max(MIN_W, Math.min(MAX_W, startW + (e.clientX - startX)));
       document.documentElement.style.setProperty('--sidebar-width', w + 'px');
     });
     document.addEventListener('mouseup', function() {
       if (!dragging) return;
       dragging = false;
       document.body.style.cursor = '';
       document.body.style.userSelect = '';
       var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
       localStorage.setItem('es_sidebarWidth', w);
     });
     // Restore on load:
     var saved = parseInt(localStorage.getItem('es_sidebarWidth'));
     if (saved >= MIN_W) document.documentElement.style.setProperty('--sidebar-width', saved + 'px');
   })();

MIN_W should be at least the width of the widest action button. 180px is a safe minimum. Adjust after visual test.

---

V2 — Full-Text Hover When Sidebar Is Narrow

FILE: wwwroot/js/room.js — renderStories() line ~500

After rendering each story row, add dynamic title detection:
After building story list HTML and inserting into DOM, run:
  document.querySelectorAll('.story-title, .story-actions button').forEach(function(el) {
    if (el.scrollWidth > el.offsetWidth) {
      el.title = el.textContent.trim();
    }
  });

This runs after each renderStories() call. For buttons that already have title attributes (from U1), skip or don't overwrite.

Also wrap story-title spans to handle overflow:
In site.css: .story-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
