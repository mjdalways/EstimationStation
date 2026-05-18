FEATURE PLAN v5.0 — GROUPS X (CARD FLIP UX) + Y (CARD BACK REDESIGN)
Files: wwwroot/js/room.js, wwwroot/js/site.js, wwwroot/css/site.css, Views/Shared/_Layout.cshtml

NOTE: O2 (flip gap slider) is already done — cel-flip-gap slider exists at _Layout.cshtml:499 (100-1000ms, step 10) with cel-flip-gap-val display. Y5 below should add live preview on change, not build the slider.

---

X1 — Flip Animation When User Votes (Card Turns Over to Card Back)

FILE: wwwroot/js/room.js — connection.on('VoteCast') at line 127

CURRENT: When VoteCast fires, participant.hasVoted is updated and renderParticipants() is called. No animation occurs.

CHANGE:
1. After updating hasVoted = true for the relevant participant (before or after renderParticipants()), add the voted-flip class to the participant badge:
   const badge = document.querySelector('.participant-badge[data-connection-id="' + connectionId + '"]');
   if (badge && hasVoted) badge.classList.add('voted-flip');

2. In site.css, add the voted-flip animation:
   .participant-badge.voted-flip {
     animation: badge-vote-flip 0.45s ease-in-out forwards;
   }
   @keyframes badge-vote-flip {
     0%   { transform: rotateY(0deg); }
     49%  { transform: rotateY(90deg); }
     50%  { transform: rotateY(90deg); }
     100% { transform: rotateY(0deg); }
   }
   After animation, the badge shows the voted state (card back design via .voted class).
   The animation fires once; the .voted class (already applied by renderParticipants) handles the persistent card-back display.

3. Remove voted-flip class after animation (prevent re-triggering on re-render):
   badge.addEventListener('animationend', function() { badge.classList.remove('voted-flip'); }, { once: true });

4. Add toggle in settings (Visual tab when created, or Appearance tab for now):
   Checkbox id="flip-on-vote-toggle", localStorage key 'es_flipOnVote', default true.
   Wrap step 1-3 in: if (localStorage.getItem('es_flipOnVote') !== '0') { ... }

---

X2 — Click Card Back to Change Vote (Flip + Re-vote + Flip Back)

FILE: wwwroot/js/room.js — renderParticipants() at line 428

CURRENT: Badge HTML for local user's voted state shows vote-hidden span (checkmark). No click handler.

CHANGE:
1. In renderParticipants(), for the local user (isMe) when hasVoted and !votesRevealed:
   Add onclick="changeVote()" to the badge (or a hover overlay within the badge).
   Add title="Click to change your vote"
   Add CSS class: .participant-badge.me.voted.can-change-vote (for hover styling).

2. Add changeVote() function in room.js:
   function changeVote() {
     if (!roomState || roomState.votesRevealed) return;
     // Reset vote UI
     selectedVote = null;
     renderCards();
     // Update local state
     var me = roomState.participants.find(p => p.connectionId === connection.connectionId);
     if (me) { me.hasVoted = false; me.vote = null; }
     renderParticipants();
     // Invoke hub
     connection.invoke('CastVote', null).catch(console.error);
     // Optional: scroll to vote cards
     document.querySelector('.poker-cards-container')?.scrollIntoView({ behavior: 'smooth' });
   }
   window.changeVote = changeVote;

3. In site.css, add hover state for the change-vote affordance:
   .participant-badge.me.voted:not(.revealing) {
     cursor: pointer;
   }
   .participant-badge.me.voted:not(.revealing):hover::after {
     content: '↩ Change';
     position: absolute; bottom: 2px; left: 0; right: 0;
     font-size: 0.6rem; color: var(--accent); text-align: center;
     background: rgba(0,0,0,0.5); border-radius: 0 0 var(--border-radius) var(--border-radius);
   }
   .participant-badge { position: relative; }  /* ensure ::after works */

4. Add toggle: checkbox id="click-change-vote-toggle", localStorage key 'es_clickChangeVote', default true.
   Wrap changeVote() binding in: if (localStorage.getItem('es_clickChangeVote') !== '0') { ... }

---

Y1 — Separate Vote Card Back from Participant Card Back

FILE: wwwroot/js/site.js — getCardBackDesign() at line 1023, setCardBackDesign() at line 1027, applyCardBackDesign() at line 1032

CURRENT: es_cardBack key controls both participant badges (.participant-badge.voted class) and potentially voting cards.

CHANGE:
1. Add two localStorage keys:
   'es_participantCardBack' — card back for participant badges when voted
   'es_voteCardBack' — card back for voting cards in the card picker row

2. Modify applyCardBackDesign() (site.js:1032):
   function applyCardBackDesign() {
     var pb = localStorage.getItem('es_participantCardBack') || localStorage.getItem('es_cardBack') || 'default';
     var vb = localStorage.getItem('es_voteCardBack') || 'default';
     // Apply participant card back (existing logic, unchanged class names)
     document.body.classList.remove('card-back-baize','card-back-space','card-back-retro','card-back-seasonal');
     if (pb !== 'default') document.body.classList.add('card-back-' + pb);
     // Apply vote card back via CSS variable or separate body class
     document.body.setAttribute('data-vote-back', vb);
   }

3. In site.css, scope existing .card-back-* rules to participant badges only (they target .participant-badge.voted which is already specific). Add new rules for voting cards:
   body[data-vote-back="baize"] .poker-card { background: #2e8b57; }  /* etc. per style */
   Keep them simple for MVP; full styling in Y2.

4. In _Layout.cshtml (Appearance tab, sec-card-back around line 397-414):
   Add a second selector below cardBackSelect:
   <label>Vote Card Back Style</label>
   <select id="voteCardBackSelect" onchange="localStorage.setItem('es_voteCardBack',this.value);applyCardBackDesign();">
     <option value="default">Default</option>
     <option value="baize">Baize Green Felt</option>
     <option value="space">Deep Space</option>
     <option value="retro">Retro Diamonds</option>
     <option value="seasonal">Seasonal</option>
   </select>
   Populate on modal open in site.js openSettingsModal() by adding:
   var vbSel = document.getElementById('voteCardBackSelect');
   if (vbSel) vbSel.value = localStorage.getItem('es_voteCardBack') || 'default';

---

Y2 — More Card Back Styles: Gradients, Patterns

FILE: wwwroot/css/site.css (after existing card-back-seasonal around line 1560)

Add new CSS card back classes. These apply to .participant-badge.voted (and to .poker-card via data-vote-back if Y1 is implemented):

.card-back-gradient .participant-badge.voted {
  background: linear-gradient(var(--cb-gradient-dir, 135deg), var(--cb-color1, #667eea), var(--cb-color2, #764ba2));
}
.card-back-solid .participant-badge.voted {
  background: var(--cb-solid-color, #3b4cca);
}
.card-back-checkerboard .participant-badge.voted {
  background-image: repeating-conic-gradient(#888 0% 25%, #555 0% 50%);
  background-size: 14px 14px;
}
.card-back-stripes .participant-badge.voted {
  background: repeating-linear-gradient(45deg, #444, #444 5px, #222 5px, #222 10px);
}
.card-back-dots .participant-badge.voted {
  background-color: #1a1a2e;
  background-image: radial-gradient(circle, #5b8dee 1px, transparent 1px);
  background-size: 10px 10px;
}

FILE: Views/Shared/_Layout.cshtml — cardBackSelect (line 405)

Add new options:
  <option value="gradient">Gradient</option>
  <option value="solid">Solid Color</option>
  <option value="checkerboard">Checkerboard</option>
  <option value="stripes">Diagonal Stripes</option>
  <option value="dots">Dots</option>

For gradient and solid styles, show color pickers when selected:
  <div id="cb-gradient-wrap" style="display:none;">
    <input type="color" id="cb-color1" value="#667eea"> <input type="color" id="cb-color2" value="#764ba2">
    <select id="cb-gradient-dir">
      <option value="135deg">Diagonal ↘</option><option value="90deg">Top → Bottom</option>
      <option value="180deg">Left → Right</option>
    </select>
  </div>
  <div id="cb-solid-wrap" style="display:none;">
    <input type="color" id="cb-solid-color" value="#3b4cca">
  </div>

On cardBackSelect change, show/hide the appropriate sub-controls and set CSS variables on document.documentElement.

FILE: wwwroot/js/site.js — applyCardBackDesign() or near line 1032

On selecting gradient/solid, also apply CSS vars:
  document.documentElement.style.setProperty('--cb-color1', colorPicker1.value);
  document.documentElement.style.setProperty('--cb-color2', colorPicker2.value);
  document.documentElement.style.setProperty('--cb-gradient-dir', dirSelect.value);

Save all values to localStorage under 'es_cardBackConfig' as JSON.

---

Y3 — Import Image File as Card Back

FILE: Views/Shared/_Layout.cshtml — cardBackSelect section (line 397-414)

Add new option:
  <option value="custom-image">Custom Image</option>

Add upload input (shown when custom-image selected):
  <div id="cb-image-wrap" style="display:none;">
    <input type="file" id="cb-image-upload" accept="image/*" onchange="handleCardBackImageUpload(this)">
    <div id="cb-image-preview" style="width:48px;height:68px;background-size:cover;background-position:center;border-radius:6px;"></div>
    <button onclick="clearCardBackImage()">Clear</button>
  </div>

FILE: wwwroot/js/site.js (near applyCardBackDesign ~line 1032)

function handleCardBackImageUpload(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 200 * 1024) { alert('Image must be under 200KB'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    localStorage.setItem('es_cardBackCustomImage', e.target.result);
    applyCardBackDesign();
    // Show preview
    document.getElementById('cb-image-preview').style.backgroundImage = 'url(' + e.target.result + ')';
  };
  reader.readAsDataURL(file);
}
function clearCardBackImage() {
  localStorage.removeItem('es_cardBackCustomImage');
  document.getElementById('cb-image-upload').value = '';
  document.getElementById('cb-image-preview').style.backgroundImage = '';
  applyCardBackDesign();
}

In applyCardBackDesign() add branch for 'custom-image':
  if (pb === 'custom-image') {
    var img = localStorage.getItem('es_cardBackCustomImage');
    if (img) {
      // inject style for .participant-badge.voted background-image
      var s = document.getElementById('_cb_img_style') || document.createElement('style');
      s.id = '_cb_img_style';
      s.textContent = '.participant-badge.voted { background-image: url("' + img + '") !important; background-size: cover; background-position: center; }';
      if (!document.getElementById('_cb_img_style')) document.head.appendChild(s);
    }
  } else {
    var s = document.getElementById('_cb_img_style');
    if (s) s.textContent = '';
  }

---

Y4 — Card Back + Front Live Preview with Test Flip Button

FILE: Views/Shared/_Layout.cshtml — Appearance tab (tab-theme), after cardBackSelect section

Add a preview area below the card back selectors:
  <div class="d-flex gap-3 align-items-center mt-2" id="card-back-preview-area">
    <div>
      <div class="text-muted small mb-1">Card Front</div>
      <div class="poker-card" id="preview-card-front" style="pointer-events:none;">5</div>
    </div>
    <div>
      <div class="text-muted small mb-1">Card Back</div>
      <div class="participant-badge voted" id="preview-card-back" style="pointer-events:none;min-width:64px;height:90px;">
        <span class="vote-hidden">✓</span>
      </div>
    </div>
    <button class="btn btn-sm btn-outline-secondary" onclick="testCardBackFlip()">▶ Test Flip</button>
  </div>

FILE: wwwroot/js/site.js (near applyCardBackDesign)

function testCardBackFlip() {
  var front = document.getElementById('preview-card-front');
  var back = document.getElementById('preview-card-back');
  if (!front || !back) return;
  // Flip back → front
  back.classList.add('poker-flip');
  back.addEventListener('animationend', function() {
    back.classList.remove('poker-flip');
    // Show front briefly, then flip back
    front.classList.add('poker-flip');
    front.addEventListener('animationend', function() {
      front.classList.remove('poker-flip');
    }, { once: true });
  }, { once: true });
}

The preview-card-back div inherits .participant-badge.voted styles including the active card back class from the body, so it automatically reflects the current design.

Call applyCardBackDesign() or a refresh function whenever cardBackSelect changes to update the preview.

---

Y5 — Flip Speed: Live Preview on Change (Slider Already Exists)

NOTE: The cel-flip-gap slider at _Layout.cshtml:499 already exists. This task adds visual feedback only.

FILE: Views/Shared/_Layout.cshtml — near cel-flip-gap section (around line 499)

1. Improve the label: change current label text (search for its label element) to:
   "Reveal Flip Speed <small class='text-muted'>(delay between each card flip)</small>"

2. Add contextual note below the slider (add after the slider/value display):
   <div id="flip-gap-note" class="text-muted small mt-1"></div>

FILE: wwwroot/js/site.js or inline in _Layout

Wire the cel-flip-gap slider to update the preview and contextual note:
  var fgSlider = document.getElementById('cel-flip-gap');
  var fgNote = document.getElementById('flip-gap-note');
  if (fgSlider) {
    fgSlider.addEventListener('input', function() {
      var ms = parseInt(this.value);
      document.getElementById('cel-flip-gap-val').textContent = ms + ' ms';
      if (fgNote) {
        if (ms < 200) fgNote.textContent = 'Fast — all cards flip nearly simultaneously';
        else if (ms > 700) fgNote.textContent = 'Slow — dramatic one-by-one reveal';
        else fgNote.textContent = '';
      }
      // Trigger mini demo flip in card-back-preview-area if visible
      if (document.getElementById('card-back-preview-area')) testCardBackFlip();
    });
  }

This connects the existing slider to the new preview from Y4, giving immediate visual confirmation.
