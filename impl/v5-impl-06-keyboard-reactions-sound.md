FEATURE PLAN v5.0 — GROUPS P (KEYBOARD + REACTIONS) + Q (SOUND + NOTIFICATIONS)
Files: wwwroot/js/room.js, Hubs/PokerHub.cs, Views/Shared/_Layout.cshtml, wwwroot/css/site.css

KEY FACTS FROM CODE:
- Keyboard handler in room.js at line 1239. Current keys: Space/Enter=reveal, R=reset, F=fullscreen, N=new story, ?=settings, Digit0=coffee, Digit1-9=nth card click.
- castVote(val) at room.js:825. Reads selectedVote, calls connection.invoke('CastVote', selectedVote).
- estimateValues / card row: cards rendered as .poker-card elements; clicking them calls castVote(value).
- roomState.votesRevealed (bool), isObserver (bool), meIsGhost (bool from roomState.participants find).
- connection.on('VotesRevealed') at line 156.
- CastVibe hub method (line 271 in PokerHub.cs), broadcasts VibeUpdated with vibe counts.
- VIBE_EMOJIS in room.js:16: ['🚀','😱','😴','🤔','💪','🤷'].
- #vibeCheckPanel exists in Index.cshtml.

---

P1 — Keyboard Voting

FILE: wwwroot/js/room.js — keyboard handler at line 1239

EXTEND the existing keydown handler. After the existing Digit0-9 handling (which currently clicks nth card), also handle:
- Keys C and Q for special card values.
- Build a dynamic key→value map from the current estimate set.

CURRENT behavior (line 1239+): Digit1-9 clicks cards[digit-1], Digit0 clicks coffee card.

REPLACE with smarter mapping:
  // Inside keydown handler, after existing guards
  if (!roomState.votesRevealed && !isObserver && !isLocalUserGhost()) {
    var cards = document.querySelectorAll('.poker-card:not(.disabled)');
    var cardValues = Array.from(cards).map(c => c.dataset.value || c.textContent.trim());
    
    var key = e.code || e.key;
    var voteIdx = -1;
    
    if (key === 'Digit1') voteIdx = 0;
    else if (key === 'Digit2') voteIdx = 1;
    else if (key === 'Digit3') voteIdx = 2;
    else if (key === 'Digit4') voteIdx = 3;
    else if (key === 'Digit5') voteIdx = 4;
    else if (key === 'Digit6') voteIdx = 5;
    else if (key === 'Digit7') voteIdx = 6;
    else if (key === 'Digit8') voteIdx = 7;
    else if (key === 'Digit9') voteIdx = 8;
    else if (key === 'Digit0') voteIdx = 9;
    else if (key === 'Minus') voteIdx = cardValues.length - 1;
    else if (e.key === 'c' || e.key === 'C') {
      var coffeeIdx = cardValues.findIndex(v => v === '☕');
      if (coffeeIdx >= 0) voteIdx = coffeeIdx;
    }
    else if (e.key === 'q' || e.key === 'Q') {
      var qIdx = cardValues.findIndex(v => v === '?');
      if (qIdx >= 0) voteIdx = qIdx;
    }
    
    if (voteIdx >= 0 && voteIdx < cards.length) {
      e.preventDefault();
      cards[voteIdx].click();  // triggers existing click → castVote() flow
      return;
    }
  }

Make sure cards have data-value attribute set in the card rendering code. If not, add data-value="${val}" to each .poker-card element.

SHORTCUT LEGEND:
Add a collapsible legend below the card container in Index.cshtml or inject via JS after renderCards():
  function renderShortcutLegend() {
    var el = document.getElementById('kbd-legend');
    if (!el || localStorage.getItem('es_keyboardVoting') === '0') { if(el) el.style.display='none'; return; }
    var cards = document.querySelectorAll('.poker-card:not(.disabled)');
    var items = [];
    Array.from(cards).forEach(function(c, i) {
      var k = i === 0 ? '1' : i === 9 ? '0' : i === cards.length-1 ? '-' : String(i+1);
      if (i < 10 || i === cards.length-1) items.push('<kbd>' + k + '</kbd> ' + (c.dataset.value || c.textContent.trim()));
    });
    var vals = Array.from(cards).map(c => c.dataset.value || c.textContent.trim());
    if (vals.includes('☕')) items.push('<kbd>C</kbd> ☕');
    if (vals.includes('?')) items.push('<kbd>Q</kbd> ?');
    el.innerHTML = '<details class="text-muted small mt-1"><summary>⌨️ Keyboard shortcuts</summary><div class="d-flex flex-wrap gap-2 mt-1">' + items.join('') + '</div></details>';
    el.style.display = '';
  }
  window.renderShortcutLegend = renderShortcutLegend;
  // Call after renderCards()

Add <div id="kbd-legend"></div> in Index.cshtml below the poker cards container.
Add toggle in settings (Appearance or Visual tab):
  <div class="form-check form-switch">
    <input class="form-check-input" type="checkbox" id="keyboard-voting-toggle" checked
           onchange="localStorage.setItem('es_keyboardVoting',this.checked?'1':'0')">
    <label>Enable keyboard voting</label>
  </div>

---

P2 — Emoji Reactions (Extend Vibe Check)

FILE: Hubs/PokerHub.cs — add new hub method after CastVibe (line 271)

public async Task SendReaction(string emoji) {
    if (string.IsNullOrWhiteSpace(emoji) || emoji.Length > 8) return;
    var room = _roomService.GetRoom(Context.Items["RoomName"]?.ToString());
    if (room == null) return;
    var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
    string name = participant?.Name ?? "Unknown";
    await Clients.Group(room.Name).SendAsync("ReactionReceived", Context.ConnectionId, name, emoji);
}

FILE: wwwroot/js/room.js

1. Add client handler (near line 361 with other event handlers):
   connection.on('ReactionReceived', function(connectionId, senderName, emoji) {
     // Rate limit: track last received per sender
     var now = Date.now();
     _reactionTimestamps = _reactionTimestamps || {};
     if (_reactionTimestamps[connectionId] && now - _reactionTimestamps[connectionId] < 2000) return;
     _reactionTimestamps[connectionId] = now;
     _showFloatingReaction(connectionId, emoji);
   });

2. Add var _reactionTimestamps = {}; near module-level vars (~line 25).

3. Add _showFloatingReaction() function:
   function _showFloatingReaction(connectionId, emoji) {
     var badge = document.querySelector('.participant-badge[data-connection-id="' + connectionId + '"]');
     if (!badge) return;
     var el = document.createElement('div');
     el.className = 'floating-reaction';
     el.textContent = emoji;
     var rect = badge.getBoundingClientRect();
     el.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2) + 'px;top:' + rect.top + 'px;' +
       'font-size:2rem;pointer-events:none;z-index:9000;animation:reaction-float 1.8s ease-out forwards;';
     document.body.appendChild(el);
     el.addEventListener('animationend', () => el.remove());
   }

4. Add rate-limit on send side in the vibe/reaction panel onclick:
   function sendReaction(emoji) {
     var now = Date.now();
     if (window._lastReactionSent && now - window._lastReactionSent < 2000) return;
     window._lastReactionSent = now;
     connection.invoke('SendReaction', emoji).catch(console.error);
   }
   window.sendReaction = sendReaction;

FILE: wwwroot/css/site.css — add animation:
@keyframes reaction-float {
  0%   { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(-120px) scale(1.4); opacity: 0; }
}

FILE: Views/Shared/_Layout.cshtml or Index.cshtml — find #vibeCheckPanel

The existing vibe panel has VIBE_EMOJIS buttons. Extend or add a "Reactions" row below it:
  <div id="reactionsPanel" class="d-flex gap-2 flex-wrap mt-2">
    <!-- Rendered dynamically from es_reactions localStorage -->
  </div>
  <div class="text-muted small mt-1">React to the room (visible to all)</div>

In site.js or room.js, render the reaction palette:
  function renderReactionPanel() {
    var palette = JSON.parse(localStorage.getItem('es_reactions') || '["👍","❤️","😂","🔥","💯","🎉","🤔","😮"]');
    var panel = document.getElementById('reactionsPanel');
    if (!panel) return;
    panel.innerHTML = palette.map(e =>
      '<button class="btn btn-sm" onclick="sendReaction(\'' + e + '\')" title="React with ' + e + '">' + e + '</button>'
    ).join('');
  }

CUSTOMIZABLE PALETTE in settings (Appearance tab):
  <div class="mb-2">
    <label class="small">Reaction Palette (up to 8 emojis, comma separated)</label>
    <input type="text" id="reactions-palette-input" class="form-control form-control-sm" value="👍,❤️,😂,🔥,💯,🎉,🤔,😮"
           onchange="localStorage.setItem('es_reactions',JSON.stringify(this.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,8)));renderReactionPanel();">
  </div>

---

Q1 — Vote Cast Sound (Tick)

FILE: wwwroot/js/room.js — castVote() at line 825

Before (or after) the connection.invoke call, play a subtle tick:
  if (localStorage.getItem('es_voteCastSound') === '1') _playVoteTick();

Add _playVoteTick() function:
  function _playVoteTick() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.08);
      osc.onended = () => ctx.close();
    } catch(e) {}
  }

FILE: Views/Shared/_Layout.cshtml — Audio tab, add after existing sound controls

  <div class="form-check form-switch mt-2">
    <input class="form-check-input" type="checkbox" id="vote-cast-sound-toggle"
           onchange="localStorage.setItem('es_voteCastSound',this.checked?'1':'0');if(this.checked)_playVoteTick()">
    <label class="form-check-label" for="vote-cast-sound-toggle">Play sound when casting vote</label>
  </div>

The checkbox also acts as a test: enabling it plays the tick once (via the onchange handler).

In openSettingsModal() populate:
  var vcs = document.getElementById('vote-cast-sound-toggle');
  if (vcs) vcs.checked = localStorage.getItem('es_voteCastSound') === '1';

_playVoteTick must be assigned to window:
  window._playVoteTick = _playVoteTick;

---

Q2 — Desktop Notification on Vote Reveal

FILE: wwwroot/js/room.js — connection.on('VotesRevealed') at line 156

After the existing reveal handler runs, add notification:
  if (localStorage.getItem('es_revealNotification') === '1' && document.visibilityState !== 'visible') {
    var avg = stats?.average ?? '?';
    var mn = stats?.min ?? '?'; var mx = stats?.max ?? '?';
    var story = roomState.stories.find(s => s.id === roomState.currentStoryId);
    var storyTitle = story?.title || 'story';
    _sendRevealNotification(storyTitle, avg, mn, mx);
  }

Add function:
  function _sendRevealNotification(title, avg, min, max) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    new Notification('📊 Votes revealed!', {
      body: title + '\nAvg: ' + avg + '  Range: ' + min + '–' + max,
      icon: '/favicon.ico'
    });
  }
  window._sendRevealNotification = _sendRevealNotification;

FILE: Views/Shared/_Layout.cshtml — Audio tab

Add notification toggle:
  <div id="reveal-notification-wrap" class="form-check form-switch mt-2">
    <input class="form-check-input" type="checkbox" id="reveal-notification-toggle"
           onchange="onRevealNotificationToggle(this.checked)">
    <label class="form-check-label" for="reveal-notification-toggle">Browser notification when votes revealed (when tab is not visible)</label>
    <div id="reveal-notification-denied" class="text-danger small" style="display:none;">Notifications denied. Check browser permissions.</div>
  </div>

Hide toggle entirely if Notification API is unsupported:
  if (typeof Notification === 'undefined') document.getElementById('reveal-notification-wrap').style.display = 'none';

FILE: wwwroot/js/site.js or room.js — add handler

function onRevealNotificationToggle(enabled) {
  if (!enabled) { localStorage.setItem('es_revealNotification','0'); return; }
  if (typeof Notification === 'undefined') return;
  Notification.requestPermission().then(function(perm) {
    if (perm === 'granted') {
      localStorage.setItem('es_revealNotification','1');
    } else {
      localStorage.setItem('es_revealNotification','0');
      document.getElementById('reveal-notification-toggle').checked = false;
      document.getElementById('reveal-notification-denied').style.display = '';
    }
  });
}
window.onRevealNotificationToggle = onRevealNotificationToggle;

In openSettingsModal() populate:
  var rnt = document.getElementById('reveal-notification-toggle');
  if (rnt) rnt.checked = localStorage.getItem('es_revealNotification') === '1';
  var rnd = document.getElementById('reveal-notification-denied');
  if (rnd) rnd.style.display = (typeof Notification !== 'undefined' && Notification.permission === 'denied') ? '' : 'none';
