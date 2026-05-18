FEATURE PLAN v5.0 — GROUP T: BUG FIXES
Files: voice.js, celebration.js, seasonal.js, room.js, _Layout.cshtml

NOTE: Group E (Timer Audio) and O2 (Flip Gap Slider) were incorrectly re-opened as pending.
audio.js:98-242 has all timer audio functions fully implemented (getTimerAudioSettings, startTimerAudio, _playJeopardyTheme, _playJawsTheme, _playTickingClock, testTimerAudio, saveTimerAudioFromForm).
_Layout.cshtml:499 has the cel-flip-gap slider (100-1000ms, step 10) with cel-flip-gap-val display already wired.
Both are DONE. Revert the v5.0 priority table and Done table to remove E and restore O2 as Done.

---

T1 — Voice Recognition InvalidStateError + No Way to Stop

FILE: wwwroot/js/voice.js

PROBLEM: _voiceRecog.start() is called in startVoiceRecognition() (line 43-80) and again in the onend handler (line 70-74) without checking if recognition is already active. If the user changes the reveal phrase while listening, or if onend fires mid-restart, a second start() call throws InvalidStateError. There is no _voiceStarted flag — only _voiceActive.

FIX:
1. Add module-level var _voiceStarted = false; near line 4.
2. In startVoiceRecognition() (line 77), set _voiceStarted = false before calling _voiceRecog.start(). Add _voiceRecog.onstart = function() { _voiceStarted = true; }; in the listener block (near line 57).
3. In the onend handler (line 70), add guard: if (cs.enabled && _voiceActive && !_voiceStarted) { setTimeout(function() { if (_voiceActive && !_voiceStarted) _voiceRecog.start(); }, 300); }
4. In stopVoiceRecognition() (line 82), set _voiceStarted = false before calling _voiceRecog.stop(). Wrap stop() in try/catch to avoid errors if already stopped.
5. Add toggleVoiceRecognition() function:
   function toggleVoiceRecognition() {
     if (_voiceActive) stopVoiceRecognition();
     else startVoiceRecognition();
   }
   Assign window.toggleVoiceRecognition = toggleVoiceRecognition;

FILE: Views/Shared/_Layout.cshtml

6. Find the microphone badge/icon in the navbar (search for 'voice-mic-indicator' or mic emoji). Add onclick="toggleVoiceRecognition()" to it with title="Toggle voice recognition".
7. The existing _setMicIndicator(on) at voice.js:88-93 already updates element IDs 'voice-mic-indicator' and 'voice-mic-indicator-modal'. No change needed to the indicator logic.

---

T2 — "Unknown" in Session Awards for Logged-In User

FILE: wwwroot/js/room.js (and likely wwwroot/js/awards.js or analytics.js if they exist)

PROBLEM: Session awards show "Unknown" for the current user. The VoteCast handler (line 127) updates hasVoted on the participant object, and participant name comes from roomState.participants[x].name. The awards panel is populated via awards-modal-content (line 1574 in _Layout). The bug is that the local user's name may not be in roomState.participants at the time awards are rendered.

INVESTIGATION STEPS:
1. Find where session awards are rendered (search room.js for 'awards-modal-content' or 'renderAwards').
2. Check whether the local participant (matching connection.connectionId) has a name property set.
3. The RoomState handler (line 65) should set roomState.participants from server data. If the server sends the local participant's name correctly, but awards render before RoomState arrives, the name is empty.

FIX:
In the awards rendering function, if participant.name is falsy, fall back to:
  localStorage.getItem('es_playerName') || localStorage.getItem('es_displayName') || 'Player'
Also check: does the JoinRoom invoke (line 52) pass the correct playerName? It should read from #playerName input or stored name.

---

T3 — Ocean Week Shark/Fish Swim Wrong Direction by Default

FILE: wwwroot/js/seasonal.js

PROBLEM: _seaSharkSwim uses SEA_ANIM_META config. The shark and fish animations enter from the wrong side. _seaRunnerFn reads config.dir ('lr' or 'rl') from SEA_ANIM_META[animName]. The shark should be 'lr' (left-to-right) but is either 'rl' or its flipX is wrong, making it face left while going right.

FIND: SEA_ANIM_META entry for _seaSharkSwim (search 'seaSharkSwim' in seasonal.js). Also check _seaFishSchool.

FIX:
Set dir: 'lr' and flipX: false for _seaSharkSwim in SEA_ANIM_META. The shark image (emoji 🦈) naturally faces left, so to make it appear to swim right (lr direction), set flipX: true so the emoji is mirrored. Verify visually.

For _seaFishSchool, the agent report says it uses emoji '🐠🐟🐡' with lr direction which is likely correct. Verify.

Also fix label 'Autumn' → 'Fall/Autumn' in SEA_ANIM_META name fields for the autumn season entry (this is U4 but touching the same file):
Search: name: 'Autumn' in SEA_ANIM_META, change to name: 'Fall/Autumn'.
Also update the checkbox label in _Layout.cshtml:847 where the Autumn season is labeled.

---

T4 — Floor Is Lava Test Doesn't Toggle to Stop (Just Resets)

FILE: wwwroot/js/celebration.js

EXISTING CODE: _toggleLavaTest() at lines 307-316. _lavaTestActive flag at line 305. Button ID 'lava-test-btn' at _Layout.cshtml:489 calling _toggleLavaTest().

PROBLEM: The toggle logic may not correctly stop the lava. The _Layout.cshtml button calls _toggleLavaTest() and the function exists. The likely issue is that the stop path doesn't clear all lava state properly (floor banner, timers, CSS classes).

VERIFY: Check what _toggleLavaTest() does when _lavaTestActive is true (stop path). It should:
- Clear _lavaInterval (the countdown interval)
- Remove #lava-banner element from DOM
- Remove .lava-outlier and .floor-is-lava classes from all participant badges
- Remove body class if any lava class on body
- Set _lavaTestActive = false
- Change button label back to '🧪 Test'

If any of these are missing, add them. Also ensure _lavaInterval is the correct interval reference — if the lava function uses multiple timers (one for countdown, one for effect firing), all must be cleared.

---

T5 — Floor Is Lava Test Ignores Current Color/Countdown Settings

FILE: wwwroot/js/celebration.js (in or near _toggleLavaTest)

PROBLEM: The test launches lava with default or hardcoded values instead of reading current form values.

FIX:
At the start of the lava test (start path of _toggleLavaTest), before triggering, read:
  const color = document.getElementById('cel-lava-color')?.value || getCelebrationSettings().lavaColor || '#ff4500';
  const duration = parseInt(document.getElementById('cel-lava-duration')?.value) || getCelebrationSettings().lavaDuration || 30;

Pass these to the lava trigger function instead of reading from stored settings (which may not be saved yet if user hasn't clicked Save).

If the lava trigger function signature doesn't accept color/duration params, read directly from the DOM elements above before calling it.
