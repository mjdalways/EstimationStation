// ============================================================
// Master Sound Toggle
// ============================================================
var ES_ALL_SOUNDS_OFF_KEY = 'es_allSoundsOff';

function getAllSoundsOff() {
    return localStorage.getItem(ES_ALL_SOUNDS_OFF_KEY) === '1';
}

function saveAllSoundsOff(off) {
    localStorage.setItem(ES_ALL_SOUNDS_OFF_KEY, off ? '1' : '0');
    var el = document.getElementById('audio-all-off');
    if (el) el.checked = !!off;
    if (off) {
        stopTimerAudio();
        stopAmbient();
    } else {
        applyAmbientFromSettings();
    }
}

function populateAudioTab() {
    var el = document.getElementById('audio-all-off');
    if (el) el.checked = getAllSoundsOff();
    if (typeof populateAmbientTab === 'function') populateAmbientTab();
    if (typeof populateTimerAudioSection === 'function') populateTimerAudioSection();
    if (typeof populateSoundReceiveSection === 'function') populateSoundReceiveSection();
    if (typeof renderCustomSoundSlots === 'function') renderCustomSoundSlots();
    // Q1 & Q2
    var vtEl = document.getElementById('vote-tick-enabled');
    if (vtEl) vtEl.checked = localStorage.getItem('es_voteTick') === '1';
    var dnEl = document.getElementById('desktop-notify-enabled');
    if (dnEl) dnEl.checked = localStorage.getItem('es_desktopNotify') === '1';
}

// ============================================================
// EstimationStation — Ambient Audio
// ============================================================
var AMBIENT_SETTINGS_KEY = 'es_ambientAudio';
var _ambientAudio = null;

var AMBIENT_SOURCES = {
    lofi:  { label: '🎵 Lo-Fi', url: '/audio/lofi.mp3' },
    rain:  { label: '🌧️ Rain',  url: '/audio/rain.mp3' },
    cafe:  { label: '☕ Café',  url: '/audio/cafe.mp3' }
};

function getAmbientSettings() {
    try { return Object.assign({ source: 'none', volume: 0.3 }, JSON.parse(localStorage.getItem(AMBIENT_SETTINGS_KEY) || '{}')); }
    catch (e) { return { source: 'none', volume: 0.3 }; }
}

function saveAmbientSettings(s) {
    localStorage.setItem(AMBIENT_SETTINGS_KEY, JSON.stringify(s));
}

function startAmbient(source, volume) {
    stopAmbient();
    if (getAllSoundsOff()) return;
    if (!source || source === 'none') return;
    var info = AMBIENT_SOURCES[source];
    if (!info || !info.url) return;
    _ambientAudio = new Audio(info.url);
    _ambientAudio.loop = true;
    _ambientAudio.volume = Math.max(0, Math.min(1, volume || 0.3));
    _ambientAudio.play().catch(function () {});
}

function stopAmbient() {
    if (_ambientAudio) { _ambientAudio.pause(); _ambientAudio = null; }
}

function applyAmbientFromSettings() {
    var s = getAmbientSettings();
    startAmbient(s.source, s.volume);
}

function populateAmbientTab() {
    var s = getAmbientSettings();
    var sel = document.getElementById('ambient-source');
    if (sel) sel.value = s.source || 'none';
    var vol = document.getElementById('ambient-volume');
    if (vol) vol.value = s.volume || 0.3;
    var volLbl = document.getElementById('ambient-vol-label');
    if (volLbl) volLbl.textContent = Math.round((s.volume || 0.3) * 100) + '%';
}

function saveAmbientFromForm() {
    var source = (document.getElementById('ambient-source') || {}).value || 'none';
    var volume = parseFloat((document.getElementById('ambient-volume') || {}).value || '0.3');
    saveAmbientSettings({ source: source, volume: volume });
    startAmbient(source, volume);
}

// ============================================================
// Timer Audio
// ============================================================
var ES_TIMER_AUDIO_KEY = 'es_timerAudio';
var _timerAudioInstance = null;
var _timerAudioCtx = null;
var _timerAudioScheduled = [];

function getTimerAudioSettings() {
    try { return Object.assign({ theme: 'jeopardy', triggerAt: 10, customLabel: '', customBase64: '' },
        JSON.parse(localStorage.getItem(ES_TIMER_AUDIO_KEY) || '{}')); }
    catch (e) { return { theme: 'jeopardy', triggerAt: 10, customLabel: '', customBase64: '' }; }
}
function saveTimerAudioSettings(s) { localStorage.setItem(ES_TIMER_AUDIO_KEY, JSON.stringify(s)); }

function populateTimerAudioSection() {
    var s = getTimerAudioSettings();
    var themeEl = document.getElementById('timer-audio-theme');
    if (themeEl) themeEl.value = s.theme;
    var trigEl = document.getElementById('timer-audio-trigger');
    var trigVal = document.getElementById('timer-audio-trigger-val');
    if (trigEl) { trigEl.value = s.triggerAt; if (trigVal) trigVal.textContent = s.triggerAt + 's'; }
    var labelEl = document.getElementById('timer-audio-custom-label');
    if (labelEl) labelEl.textContent = s.customLabel || 'No file chosen';
    _timerAudioToggleCustom(s.theme);
}

function saveTimerAudioFromForm() {
    var s = getTimerAudioSettings();
    var themeEl = document.getElementById('timer-audio-theme');
    if (themeEl) s.theme = themeEl.value;
    var trigEl = document.getElementById('timer-audio-trigger');
    if (trigEl) s.triggerAt = parseInt(trigEl.value) || 10;
    saveTimerAudioSettings(s);
}

function _timerAudioToggleCustom(theme) {
    var wrap = document.getElementById('timer-audio-custom-wrap');
    if (wrap) wrap.style.display = theme === 'custom' ? '' : 'none';
}

function handleTimerAudioUpload(input) {
    var file = input.files[0];
    if (!file) return;
    if (file.size > 800000) { alert('File too large (max 800 KB)'); input.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function (e) {
        var tmpAudio = new Audio(e.target.result);
        tmpAudio.addEventListener('loadedmetadata', function () {
            if (tmpAudio.duration > 10) { alert('Audio too long (max 10 seconds)'); input.value = ''; return; }
            var s = getTimerAudioSettings();
            s.customBase64 = e.target.result;
            s.customLabel = file.name;
            saveTimerAudioSettings(s);
            var lbl = document.getElementById('timer-audio-custom-label');
            if (lbl) lbl.textContent = file.name;
        });
    };
    reader.readAsDataURL(file);
}

function startTimerAudio(secondsRemaining) {
    stopTimerAudio();
    if (getAllSoundsOff()) return;
    var s = getTimerAudioSettings();
    if (s.theme === 'silent') return;
    if (s.theme === 'custom' && s.customBase64) {
        _timerAudioInstance = new Audio(s.customBase64);
        _timerAudioInstance.loop = true;
        _timerAudioInstance.play().catch(function () {});
        return;
    }
    try {
        _timerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (s.theme === 'ticking')   _playTickingClock(secondsRemaining);
        else if (s.theme === 'jaws') _playJawsTheme(secondsRemaining);
        else                         _playJeopardyTheme();
    } catch (e) { /* Web Audio not supported */ }
}

function stopTimerAudio() {
    if (_timerAudioInstance) { _timerAudioInstance.pause(); _timerAudioInstance = null; }
    _timerAudioScheduled.forEach(function (n) { try { n.stop(); } catch (e) {} });
    _timerAudioScheduled = [];
    if (_timerAudioCtx) { try { _timerAudioCtx.close(); } catch (e) {} _timerAudioCtx = null; }
}

function _playJeopardyTheme() {
    var ctx = _timerAudioCtx;
    var beat = 0.5; // 120 BPM
    var notes = [261.6, 261.6, 261.6, 196.0, 329.6, 261.6, 196.0, 329.6,
                 261.6, 261.6, 261.6, 196.0, 329.6, 261.6, 196.0, 329.6];
    var t = ctx.currentTime + 0.05;
    notes.forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, t + i * beat);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * beat + beat * 0.85);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t + i * beat);
        osc.stop(t + i * beat + beat);
        _timerAudioScheduled.push(osc);
    });
}

function _playJawsTheme(totalSeconds) {
    var ctx = _timerAudioCtx;
    var freqs = [82.4, 87.3];
    var beats = Math.min(totalSeconds * 2, 40);
    var t = ctx.currentTime + 0.05;
    for (var i = 0; i < beats; i++) {
        var interval = Math.max(0.08, 0.5 - (i / beats) * 0.42);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[i % 2];
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + interval * 0.9);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + interval);
        _timerAudioScheduled.push(osc);
        t += interval;
    }
}

function _playTickingClock(totalSeconds) {
    var ctx = _timerAudioCtx;
    var t = ctx.currentTime + 0.05;
    for (var i = 0; i < totalSeconds; i++) {
        var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var j = 0; j < data.length; j++) {
            data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.008));
        }
        var src = ctx.createBufferSource();
        var gain = ctx.createGain();
        var filt = ctx.createBiquadFilter();
        filt.type = 'bandpass'; filt.frequency.value = 1800; filt.Q.value = 2;
        src.buffer = buf;
        gain.gain.value = 0.4;
        src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
        src.start(t + i);
        _timerAudioScheduled.push(src);
    }
}

function testTimerAudio() {
    startTimerAudio(10);
    setTimeout(stopTimerAudio, 4000);
}
