FEATURE PLAN v5.0 — GROUPS C (SPRINT DASHBOARD) + F (ROOM PIN UI)
Files: wwwroot/js/room.js, wwwroot/js/site.js, Views/Shared/_Layout.cshtml, Views/Home/Index.cshtml, wwwroot/css/site.css

KEY FACTS:
- roomState.stories: array of {id, title, jiraKey, jiraUrl, issueType, description, notes, isCompleted, finalEstimate}
- roomState.history: array of {story, votes, stats, voteOrder, flipCounts}; appended in VotesRevealed handler at room.js:205
- Stats from VotesRevealed: likely {average, min, max, mode, count} — verify actual shape in VotesRevealed handler
- renderStories() at room.js:500 — story list is rendered here
- JoinRoom invoke at room.js:52: connection.invoke('JoinRoom', roomName, playerName, isObserver, pin)
- Error handler at room.js:387: handles 'PIN_REQUIRED' error
- RoomPinSet handler at room.js:398: shows/hides PIN badge
- SetRoomPin hub method at PokerHub.cs:236
- Index.cshtml: lobby-container with createRoomName (line 43) and joinRoomName (line 49) inputs

---

GROUP C — SPRINT DASHBOARD

C1 — Running Points Total Chip

FILE: wwwroot/js/room.js — renderStories() at line 500

After building the story list HTML, add a total chip below the list:
  function _renderPointsTotal() {
    var total = 0; var hasAny = false;
    roomState.stories.filter(s => s.isCompleted).forEach(function(s) {
      var n = parseFloat(s.finalEstimate);
      if (!isNaN(n)) { total += n; hasAny = true; }
    });
    var el = document.getElementById('sprint-points-total');
    if (!el) return;
    if (hasAny) {
      el.textContent = '🎯 ' + total + ' pts committed';
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  }

Call _renderPointsTotal() at end of renderStories().

FILE: Views/Shared/_Layout.cshtml (or Index.cshtml) — below the stories list container

  <div id="sprint-points-total" class="badge bg-secondary mt-2" style="display:none;font-size:0.85rem;"></div>

FILE: wwwroot/css/site.css
  #sprint-points-total { display: block; margin: 4px 0 8px; }

---

C2 — Current Session Sparkline (SVG)

FILE: wwwroot/js/room.js — add _renderSessionSparkline() function

function _renderSessionSparkline() {
  var el = document.getElementById('session-sparkline');
  if (!el) return;
  var estimates = roomState.stories
    .filter(s => s.isCompleted && !isNaN(parseFloat(s.finalEstimate)))
    .map(s => parseFloat(s.finalEstimate));
  if (estimates.length < 2) { el.style.display = 'none'; return; }
  el.style.display = '';
  var W = el.clientWidth || 200; var H = 40;
  var min = Math.min(...estimates); var max = Math.max(...estimates);
  var range = max - min || 1;
  var pts = estimates.map(function(v, i) {
    var x = (i / (estimates.length - 1)) * W;
    var y = H - ((v - min) / range) * (H - 6) - 3;
    return x + ',' + y;
  }).join(' ');
  el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    estimates.map(function(v, i) {
      var x = (i / (estimates.length - 1)) * W;
      var y = H - ((v - min) / range) * (H - 6) - 3;
      return '<circle cx="' + x + '" cy="' + y + '" r="3" fill="var(--accent)"><title>' + v + '</title></circle>';
    }).join('') +
    '</svg>';
}

Call _renderSessionSparkline() after renderStories() and after VotesRevealed.

FILE: Views/Shared/_Layout.cshtml — below sprint-points-total, inside stories panel

  <div id="session-sparkline" class="mt-1 mb-2 px-1" style="display:none;" title="Estimate trend this session"></div>

---

C3 — Historical Data Persistence

FILE: wwwroot/js/room.js — VotesRevealed handler at line 156

After votes are revealed and history is updated, also append to localStorage:
  _appendEstimationHistory();

Add function:
  function _appendEstimationHistory() {
    var completedStories = roomState.stories.filter(s => s.isCompleted && s.finalEstimate);
    if (!completedStories.length) return;
    var history = JSON.parse(localStorage.getItem('es_estimationHistory') || '[]');
    // Check if we already have an entry for this session (use roomName as key)
    var roomName = window.ROOM_CONFIG?.roomName || document.title.split(' | ')[0] || 'Room';
    var today = new Date().toISOString().slice(0, 10);
    var existing = history.find(h => h.roomName === roomName && h.date === today);
    var entry = {
      date: today,
      roomName: roomName,
      stories: completedStories.map(s => ({ title: s.title, estimate: s.finalEstimate }))
    };
    if (existing) {
      history[history.indexOf(existing)] = entry;
    } else {
      history.unshift(entry);
      if (history.length > 20) history.pop();
    }
    localStorage.setItem('es_estimationHistory', JSON.stringify(history));
  }

---

C4 — Historical Trend Chart in Settings

FILE: Views/Shared/_Layout.cshtml — About tab (tab-about, line 1117)

Add a section at the bottom of the About tab:
  <h6 class="mt-3">📈 Estimation History</h6>
  <div id="history-sparkline-container" style="max-width:400px;">
    <svg id="history-sparkline" width="100%" height="60"></svg>
    <div id="history-sparkline-empty" class="text-muted small">Complete 2+ sessions to see trend.</div>
  </div>

FILE: wwwroot/js/site.js — add to openSettingsModal() when about tab is shown

function _renderHistorySparkline() {
  var data = JSON.parse(localStorage.getItem('es_estimationHistory') || '[]');
  var empty = document.getElementById('history-sparkline-empty');
  var svg = document.getElementById('history-sparkline');
  if (!svg) return;
  // Compute avg estimate per session
  var points = data.filter(s => s.stories.length).map(function(s) {
    var nums = s.stories.map(t => parseFloat(t.estimate)).filter(n => !isNaN(n));
    return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
  }).filter(p => p !== null);
  if (points.length < 2) {
    if (empty) empty.style.display = '';
    svg.innerHTML = ''; return;
  }
  if (empty) empty.style.display = 'none';
  var W = svg.clientWidth || 380; var H = 60;
  var min = Math.min(...points); var max = Math.max(...points); var range = max-min||1;
  var pts = points.map(function(v,i) {
    var x = (i/(points.length-1))*W;
    var y = H - ((v-min)/range)*(H-8)-4;
    return x+','+y;
  }).join(' ');
  svg.innerHTML = '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
    points.map(function(v,i) {
      var x=(i/(points.length-1))*W, y=H-((v-min)/range)*(H-8)-4;
      return '<circle cx="'+x+'" cy="'+y+'" r="4" fill="var(--accent2)"><title>Avg: '+v.toFixed(1)+'</title></circle>';
    }).join('');
}

Call _renderHistorySparkline() when settings modal opens on about tab.

---

GROUP F — ROOM PIN UI

F1 — PIN Input on Create Room Form

FILE: Views/Home/Index.cshtml — inside createPanel (line 42-46)

Add optional PIN field below createRoomName:
  <div class="mb-2 mt-2">
    <label class="form-label small text-muted">Room PIN (optional, 4 digits)</label>
    <input type="password" id="createRoomPin" class="form-control" maxlength="4"
           pattern="[0-9]{4}" inputmode="numeric" placeholder="Leave blank for no PIN"
           autocomplete="off">
  </div>

---

F2 — Send PIN on Room Creation

FILE: Views/Home/Index.cshtml — createRoom() function (or wherever room creation is invoked)

Find the function that calls connection.invoke('JoinRoom', ...) or connection.invoke('CreateRoom', ...).
Include the PIN: connection.invoke('JoinRoom', roomName, playerName, false, pin || null).
Where pin = document.getElementById('createRoomPin')?.value || null.

If there is a separate CreateRoom flow vs JoinRoom, check the backend — PokerHub.cs JoinRoom (line 29) creates the room if it doesn't exist, so PIN can be passed on first join:
  var pin = document.getElementById('createRoomPin')?.value?.trim() || null;
  connection.invoke('JoinRoom', roomName, playerName, isObserver, pin);

Then call SetRoomPin if pin was provided:
  if (pin) connection.invoke('SetRoomPin', pin);

---

F3 — PIN Prompt Dialog When Joining a PIN-Protected Room

FILE: wwwroot/js/room.js — Error handler at line 387

CURRENT: Handles 'PIN_REQUIRED' error.
CHANGE: Instead of just showing a generic error, show a PIN prompt dialog:
  connection.on('Error', function(message) {
    if (message === 'PIN_REQUIRED' || message.includes('PIN')) {
      _showPinPrompt();
      return;
    }
    // existing error handling
  });

Add _showPinPrompt():
  function _showPinPrompt() {
    // Remove any existing prompt
    document.getElementById('_pin_prompt')?.remove();
    var html = '<div class="modal fade show" id="_pin_prompt" style="display:block;background:rgba(0,0,0,0.6);z-index:2000;" tabindex="-1">' +
      '<div class="modal-dialog modal-sm modal-dialog-centered">' +
      '<div class="modal-content"><div class="modal-header"><h5 class="modal-title">🔒 Room PIN Required</h5></div>' +
      '<div class="modal-body">' +
      '<label class="form-label">Enter the 4-digit PIN for this room:</label>' +
      '<input type="password" id="_pin_input" class="form-control" maxlength="4" inputmode="numeric" autocomplete="off" autofocus>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="document.getElementById(\'_pin_prompt\').remove()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="_submitPin()">Join</button>' +
      '</div></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => document.getElementById('_pin_input')?.focus(), 100);
    document.getElementById('_pin_input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') _submitPin();
    });
  }

  function _submitPin() {
    var pin = document.getElementById('_pin_input')?.value?.trim();
    document.getElementById('_pin_prompt')?.remove();
    if (!pin) return;
    // Retry JoinRoom with PIN
    var roomName = window.ROOM_CONFIG?.roomName || new URLSearchParams(location.search).get('room');
    var playerName = localStorage.getItem('es_playerName') || 'Player';
    var isObserver = roomState?.isObserver || false;
    connection.invoke('JoinRoom', roomName, playerName, isObserver, pin).catch(function(err) {
      alert('Could not join: ' + err.message);
    });
  }
  window._submitPin = _submitPin;

---

F4 — PIN Badge in Room Header

FILE: wwwroot/js/room.js — RoomPinSet handler at line 398 (handler: shows/hides PIN badge)

CURRENT: RoomPinSet handler exists. Verify it shows a 🔒 badge in the room header.
If the badge element is missing from the HTML, add to _Layout.cshtml navbar or room header area:
  <span id="room-pin-badge" class="badge bg-warning text-dark ms-2" style="display:none;" title="This room is PIN protected">🔒 PIN</span>

In the RoomPinSet handler:
  connection.on('RoomPinSet', function(hasPin) {
    var badge = document.getElementById('room-pin-badge');
    if (badge) badge.style.display = hasPin ? 'inline-block' : 'none';
  });
