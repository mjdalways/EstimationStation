var VOICE_KEY = 'es_voiceSettings';
var DEFAULT_VOICE = { enabled: false, phrase: 'reveal', lang: 'en-US' };
var _voiceRecog = null;
var _voiceActive = false;

function getVoiceSettings() {
    try {
        var raw = localStorage.getItem(VOICE_KEY);
        return Object.assign({}, DEFAULT_VOICE, raw ? JSON.parse(raw) : {});
    } catch(e) { return Object.assign({}, DEFAULT_VOICE); }
}
function saveVoiceSettings(s) { localStorage.setItem(VOICE_KEY, JSON.stringify(s)); }

function populateVoiceSection() {
    var s = getVoiceSettings();
    var el = document.getElementById('voice-enabled');
    if (el) el.checked = s.enabled !== false;
    var phrase = document.getElementById('voice-phrase');
    if (phrase) phrase.value = s.phrase || 'reveal';
    var lang = document.getElementById('voice-lang');
    if (lang) lang.value = s.lang || 'en-US';
    updateVoiceVisibility();
}
function updateVoiceVisibility() {
    var el = document.getElementById('voice-enabled');
    var wrap = document.getElementById('voice-options-wrap');
    if (wrap) wrap.style.display = (el && el.checked) ? '' : 'none';
}
function saveVoiceFromForm() {
    var el = document.getElementById('voice-enabled');
    var phrase = document.getElementById('voice-phrase');
    var lang = document.getElementById('voice-lang');
    var s = {
        enabled: !!(el && el.checked),
        phrase: (phrase ? phrase.value.trim().toLowerCase() : '') || 'reveal',
        lang: (lang ? lang.value : '') || 'en-US'
    };
    saveVoiceSettings(s);
    updateVoiceVisibility();
    if (s.enabled) { startVoiceRecognition(); } else { stopVoiceRecognition(); }
}

function startVoiceRecognition() {
    stopVoiceRecognition();
    // Only activate in a room context (revealVotes is defined there)
    if (typeof revealVotes !== 'function') return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('Speech recognition not supported'); return; }
    var s = getVoiceSettings();
    if (!s.enabled) return;

    _voiceRecog = new SR();
    _voiceRecog.continuous = true;
    _voiceRecog.interimResults = false;
    _voiceRecog.lang = s.lang || 'en-US';

    _voiceRecog.onresult = function(e) {
        var phrase = (s.phrase || 'reveal').toLowerCase();
        for (var i = e.resultIndex; i < e.results.length; i++) {
            var transcript = e.results[i][0].transcript.toLowerCase().trim();
            if (transcript.indexOf(phrase) !== -1) {
                _voiceFlash();
                if (typeof revealVotes === 'function') revealVotes();
            }
        }
    };
    _voiceRecog.onerror = function(e) {
        if (e.error !== 'no-speech') console.warn('Voice error:', e.error);
    };
    _voiceRecog.onend = function() {
        var cs = getVoiceSettings();
        if (cs.enabled && _voiceActive) {
            setTimeout(function() { if (_voiceActive) _voiceRecog.start(); }, 300);
        }
    };

    _voiceActive = true;
    _voiceRecog.start();
    _setMicIndicator(true);
}

function stopVoiceRecognition() {
    _voiceActive = false;
    if (_voiceRecog) { try { _voiceRecog.stop(); } catch(e) {} _voiceRecog = null; }
    _setMicIndicator(false);
}

function _setMicIndicator(on) {
    ['voice-mic-indicator', 'voice-mic-indicator-modal'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = on ? '' : 'none';
    });
}

function _voiceFlash() {
    ['voice-mic-indicator', 'voice-mic-indicator-modal'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add('voice-flash');
        setTimeout(function() { el.classList.remove('voice-flash'); }, 600);
    });
}

function testVoiceRecognition() {
    _voiceFlash();
    if (typeof revealVotes === 'function') revealVotes();
}

function initVoiceRecognition() {
    var s = getVoiceSettings();
    if (s.enabled) startVoiceRecognition();
}
