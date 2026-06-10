// ── 3D avatar customization (P13) ────────────────────────────
// Stored as a "||s3d:hat=...,eyes=...,tint=..." suffix appended to avatarData.
// All 2D parsing below strips this suffix first, so existing avatar rendering
// (initials/dicebear/robohash/unavatar/upload) is completely unaffected by it.
var SCENE3D_MARKER = '||s3d:';
var AVATAR3D_SETTINGS_KEY = 'es_avatar3dSettings';
var DEFAULT_AVATAR3D_SETTINGS = { hat: 'none', eyes: 'round', useTeamColor: true, tint: '#5b8dee' };

function getAvatar3dSettings() {
    try {
        var raw = localStorage.getItem(AVATAR3D_SETTINGS_KEY);
        return Object.assign({}, DEFAULT_AVATAR3D_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) { return Object.assign({}, DEFAULT_AVATAR3D_SETTINGS); }
}

function saveAvatar3dSettings(s) { localStorage.setItem(AVATAR3D_SETTINGS_KEY, JSON.stringify(s)); }

function _stripScene3dSuffix(avatarData) {
    if (!avatarData) return avatarData;
    var idx = avatarData.indexOf(SCENE3D_MARKER);
    return idx >= 0 ? avatarData.substring(0, idx) : avatarData;
}

function buildScene3dSuffix(s) {
    if (!s) return '';
    var parts = [];
    if (s.hat && s.hat !== 'none') parts.push('hat=' + s.hat);
    if (s.eyes && s.eyes !== 'round') parts.push('eyes=' + s.eyes);
    if (!s.useTeamColor && s.tint) parts.push('tint=' + s.tint.replace('#', ''));
    return parts.length ? (SCENE3D_MARKER + parts.join(',')) : '';
}

// ── URL generation ───────────────────────────────────────────

function avatarDataToUrl(avatarData, size) {
    size = size || 64;
    avatarData = _stripScene3dSuffix(avatarData);
    if (!avatarData) return null;
    var parts = avatarData.split(':');
    var provider = parts[0];
    var p1 = parts[1] || '';
    var p2 = parts.slice(2).join(':');
    if (provider === 'dicebear') {
        var pipeIdx = p2.indexOf('|');
        var dbSeed  = pipeIdx >= 0 ? p2.substring(0, pipeIdx) : p2;
        var dbBg    = pipeIdx >= 0 ? p2.substring(pipeIdx + 1) : '';
        var dbUrl   = 'https://api.dicebear.com/9.x/' + encodeURIComponent(p1) + '/svg?seed=' + encodeURIComponent(dbSeed) + '&size=' + size;
        if (dbBg) dbUrl += '&backgroundColor[]=' + encodeURIComponent(dbBg);
        return dbUrl;
    }
    if (provider === 'robohash') {
        // AI5: strip |bg:RRGGBB suffix before building URL (applied as CSS bg in renderAvatar)
        var bgIdx = p2.indexOf('|bg:');
        var rSeed = bgIdx >= 0 ? p2.substring(0, bgIdx) : p2;
        return 'https://robohash.org/' + encodeURIComponent(rSeed) + '?set=set' + (p1 || '1') + '&size=' + size + 'x' + size;
    }
    if (provider === 'unavatar') {
        // AI5: strip |bg:RRGGBB suffix
        var bgIdx2 = p2.indexOf('|bg:');
        var uHandle = bgIdx2 >= 0 ? p2.substring(0, bgIdx2) : p2;
        var svc = p1;
        if (svc && uHandle) return 'https://unavatar.io/' + encodeURIComponent(svc) + '/' + encodeURIComponent(uHandle);
        return 'https://unavatar.io/' + encodeURIComponent(svc || uHandle);
    }
    return null;
}

// ── Rendering ────────────────────────────────────────────────

function renderAvatar(avatarData, name, size) {
    size = size || 48;
    avatarData = _stripScene3dSuffix(avatarData);
    var wrapper = document.createElement('div');
    wrapper.className = 'avatar-wrapper';
    wrapper.style.setProperty('--av-size', size + 'px');

    // AI5: extract |bg:RRGGBB wrapper background for image-based sources
    if (avatarData && avatarData.indexOf('|bg:') >= 0) {
        var bgHex = avatarData.split('|bg:')[1];
        if (bgHex) { wrapper.style.background = '#' + bgHex; wrapper.style.borderRadius = '50%'; }
    }

    var url = avatarDataToUrl(avatarData, size);
    if (url) {
        var img = document.createElement('img');
        img.className = 'av-image';
        img.src = url;
        img.alt = name || '';
        img.onerror = function() {
            wrapper.innerHTML = '';
            var fb = document.createElement('div');
            fb.className = 'av-initials';
            fb.style.background = colorFromName(name);
            fb.textContent = getInitials(name);
            wrapper.appendChild(fb);
        };
        wrapper.appendChild(img);
        return wrapper;
    }

    // AI5: initials with optional |RRGGBB color suffix
    if (!avatarData || avatarData === 'initials' || avatarData.startsWith('initials')) {
        var bgCol = (avatarData && avatarData.indexOf('|') >= 0)
            ? '#' + avatarData.split('|')[1]
            : colorFromName(name);
        var el = document.createElement('div');
        el.className = 'av-initials';
        el.style.background = bgCol;
        el.textContent = getInitials(name);
        wrapper.appendChild(el);
    } else if (avatarData.startsWith('data:')) {
        var imgEl = document.createElement('img');
        imgEl.className = 'av-image';
        imgEl.src = avatarData;
        imgEl.alt = name || '';
        wrapper.appendChild(imgEl);
    } else {
        var el2 = document.createElement('div');
        el2.className = 'av-initials';
        el2.style.background = colorFromName(name);
        el2.textContent = getInitials(name);
        wrapper.appendChild(el2);
    }

    return wrapper;
}

function getInitials(name) {
    var parts = (name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromName(name) {
    var hash = 0;
    var str = name || '';
    for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 'hsl(' + (Math.abs(hash) % 360) + ', 55%, 45%)';
}

// ── Provider constants ───────────────────────────────────────

var DICEBEAR_STYLES = [
    { id: 'adventurer', label: '🧝 Adventurer' },
    { id: 'bottts',     label: '🤖 Bottts' },
    { id: 'croodles',   label: '✏️ Croodles' },
    { id: 'fun-emoji',  label: '😄 Fun Emoji' },
    { id: 'open-peeps', label: '🧍 Open Peeps' },
    { id: 'pixel-art',  label: '🎮 Pixel Art' },
    { id: 'thumbs',     label: '👍 Thumbs' },
    { id: 'micah',      label: '🖼️ Micah' }
];

var ROBOHASH_SETS = [
    { id: '1', label: '🤖 Robots' },
    { id: '2', label: '👾 Monsters' }
    // Sets 3 (Robot Heads), 4 (Cats), 5 (Humans) disabled — return blank images for many seeds
];

// ── Avatar settings ──────────────────────────────────────────

var AVATAR_SETTINGS_KEY = 'es_avatarSettings';
var DEFAULT_AVATAR_SETTINGS = {
    source: 'initials',
    seed: '',
    dicebearStyle: 'bottts',
    dicebearBgColor: '',
    robohashSet: '1',
    unavatarService: 'github',
    unavatarHandle: '',
    uploadDataUri: null
};

function getAvatarSettings() {
    try {
        var raw = localStorage.getItem(AVATAR_SETTINGS_KEY);
        var s = Object.assign({}, DEFAULT_AVATAR_SETTINGS, raw ? JSON.parse(raw) : {});
        // Migrate away from unreliable RoboHash sets 3/4/5
        if (s.source === 'robohash' && ['3','4','5'].indexOf(s.robohashSet) !== -1) {
            s.robohashSet = '1';
        }
        return s;
    } catch (e) {
        return Object.assign({}, DEFAULT_AVATAR_SETTINGS);
    }
}

function saveAvatarSettings(s) {
    localStorage.setItem(AVATAR_SETTINGS_KEY, JSON.stringify(s));
}

function buildAvatarData(s) {
    var defaultName = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || '');
    var seed = (s && s.seed) || defaultName;
    var bg = s && s.avatarBgColor ? s.avatarBgColor : '';
    if (!s || s.source === 'initials') {
        // AI5: encode bg color so other participants render the chosen circle color
        return bg ? 'initials|' + bg : null;
    }
    if (s.source === 'dicebear') {
        var dbBase = 'dicebear:' + (s.dicebearStyle || 'bottts') + ':' + seed;
        var dbBg = s.dicebearBgColor || bg;
        return dbBg ? dbBase + '|' + dbBg : dbBase;
    }
    if (s.source === 'robohash') {
        var rBase = 'robohash:' + (s.robohashSet || '1') + ':' + seed;
        return bg ? rBase + '|bg:' + bg : rBase;
    }
    if (s.source === 'unavatar') {
        var uBase = 'unavatar:' + (s.unavatarService || 'github') + ':' + (s.unavatarHandle || '');
        return bg ? uBase + '|bg:' + bg : uBase;
    }
    if (s.source === 'upload') return s.uploadDataUri || null;
    return null;
}

// ── Form helpers ─────────────────────────────────────────────

function _getFormSource() {
    var el = document.querySelector('input[name="avatar-source"]:checked');
    return el ? el.value : 'initials';
}

function _buildAvatarDataFromForm() {
    var source = _getFormSource();
    var defaultName = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || '');
    var seedEl = document.getElementById('avatar-seed');
    var seed = (seedEl ? seedEl.value.trim() : '') || defaultName;
    // AI5: read shared bg color for all sources
    var bgEnableEl = document.getElementById('avatar-bg-enable');
    var bgColorEl  = document.getElementById('avatar-bg-color');
    var bg = (bgEnableEl && bgEnableEl.checked && bgColorEl) ? bgColorEl.value.replace('#', '') : '';
    if (source === 'initials') {
        return bg ? 'initials|' + bg : null;
    }
    if (source === 'dicebear') {
        var activeStyleEl = document.querySelector('#avatar-dicebear-grid .avatar-style-option.selected');
        var dbBase = 'dicebear:' + (activeStyleEl ? activeStyleEl.dataset.styleId : 'bottts') + ':' + seed;
        return bg ? dbBase + '|' + bg : dbBase;
    }
    if (source === 'robohash') {
        var activeSetEl = document.querySelector('#avatar-robohash-grid .avatar-style-option.selected');
        var rBase = 'robohash:' + (activeSetEl ? activeSetEl.dataset.setId : '1') + ':' + seed;
        return bg ? rBase + '|bg:' + bg : rBase;
    }
    if (source === 'unavatar') {
        var svcEl = document.getElementById('avatar-unavatar-service');
        var handleEl = document.getElementById('avatar-unavatar-handle');
        var uBase = 'unavatar:' + (svcEl ? svcEl.value : 'github') + ':' + (handleEl ? handleEl.value.trim() : '');
        return bg ? uBase + '|bg:' + bg : uBase;
    }
    if (source === 'upload') {
        return getAvatarSettings().uploadDataUri || null;
    }
    return null;
}

// ── Style grid renderers ─────────────────────────────────────

function renderDiceBearGrid(selectedStyle) {
    var grid = document.getElementById('avatar-dicebear-grid');
    if (!grid) return;
    grid.innerHTML = '';
    DICEBEAR_STYLES.forEach(function(s) {
        var cell = document.createElement('div');
        cell.className = 'avatar-style-option' + (s.id === selectedStyle ? ' selected' : '');
        cell.dataset.styleId = s.id;
        var url = avatarDataToUrl('dicebear:' + s.id + ':preview', 40);
        cell.innerHTML = '<img src="' + url + '" width="40" height="40" style="border-radius:50%;display:block;margin:0 auto 2px;" alt="' + s.id + '"><div style="font-size:0.65rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + s.label + '</div>';
        cell.onclick = function() { selectDiceBearStyle(s.id); };
        grid.appendChild(cell);
    });
}

function renderRoboHashGrid(selectedSet) {
    var grid = document.getElementById('avatar-robohash-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ROBOHASH_SETS.forEach(function(s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm avatar-style-option ' + (s.id === selectedSet ? 'btn-primary selected' : 'btn-outline-secondary');
        btn.dataset.setId = s.id;
        btn.textContent = s.label;
        btn.onclick = function() { selectRobohashSet(s.id); };
        grid.appendChild(btn);
    });
}

function selectDiceBearStyle(styleId) {
    document.querySelectorAll('#avatar-dicebear-grid .avatar-style-option').forEach(function(el) {
        el.classList.toggle('selected', el.dataset.styleId === styleId);
    });
    updateAvatarPreview();
}

function selectRobohashSet(setId) {
    document.querySelectorAll('#avatar-robohash-grid .avatar-style-option').forEach(function(el) {
        el.classList.remove('btn-primary', 'selected');
        el.classList.add('btn-outline-secondary');
    });
    var active = document.querySelector('#avatar-robohash-grid [data-set-id="' + setId + '"]');
    if (active) {
        active.classList.remove('btn-outline-secondary');
        active.classList.add('btn-primary', 'selected');
    }
    updateAvatarPreview();
}

// ── Tab lifecycle ────────────────────────────────────────────

function onAvatarSourceChange() {
    var source = _getFormSource();
    var panels = {
        'avatar-dicebear-panel': source === 'dicebear',
        'avatar-robohash-panel': source === 'robohash',
        'avatar-unavatar-panel': source === 'unavatar',
        'avatar-upload-panel':   source === 'upload'
    };
    Object.keys(panels).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = panels[id] ? '' : 'none';
    });
    var seedWrap = document.getElementById('avatar-seed-wrap');
    if (seedWrap) seedWrap.style.display = (source === 'unavatar' || source === 'upload') ? 'none' : '';
    updateAvatarPreview();
}

function populateAvatarTab() {
    var s = getAvatarSettings();

    var seedEl = document.getElementById('avatar-seed');
    if (seedEl) seedEl.value = s.seed || '';

    var srcEl = document.querySelector('input[name="avatar-source"][value="' + (s.source || 'initials') + '"]');
    if (srcEl) srcEl.checked = true;

    renderDiceBearGrid(s.dicebearStyle || 'bottts');
    renderRoboHashGrid(s.robohashSet || '1');

    // AH11: shared bg color control (replaces dicebear-only controls)
    var bgEnableEl = document.getElementById('avatar-bg-enable');
    var bgColorEl  = document.getElementById('avatar-bg-color');
    // Migrate legacy dicebearBgColor → avatarBgColor on first load
    var storedBg = s.avatarBgColor || s.dicebearBgColor || '';
    if (bgEnableEl) bgEnableEl.checked = !!storedBg;
    if (bgColorEl)  bgColorEl.value = storedBg ? '#' + storedBg : '#6366f1';

    var svcEl = document.getElementById('avatar-unavatar-service');
    if (svcEl) svcEl.value = s.unavatarService || 'github';
    var handleEl = document.getElementById('avatar-unavatar-handle');
    if (handleEl) handleEl.value = s.unavatarHandle || '';

    onAvatarSourceChange();
}

function updateAvatarPreview() {
    var wrap = document.getElementById('avatar-preview-wrap');
    if (!wrap) return;
    // AI5: _buildAvatarDataFromForm now includes bg color in the data string;
    // renderAvatar applies it directly — no manual CSS override needed here
    var avatarData = _buildAvatarDataFromForm();
    var name = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || 'Me');
    wrap.innerHTML = '';
    wrap.appendChild(renderAvatar(avatarData, name, 64));
}

function saveAvatarFromForm() {
    var source = _getFormSource();
    var seedEl = document.getElementById('avatar-seed');
    var s = Object.assign({}, getAvatarSettings(), { source: source, seed: seedEl ? seedEl.value.trim() : '' });

    // AH11: save shared bg color for all sources
    var bgEnableEl = document.getElementById('avatar-bg-enable');
    var bgColorEl  = document.getElementById('avatar-bg-color');
    s.avatarBgColor = (bgEnableEl && bgEnableEl.checked && bgColorEl) ? bgColorEl.value.replace('#', '') : '';
    // Keep legacy dicebearBgColor in sync for backward compat
    if (source === 'dicebear') {
        var activeStyleEl = document.querySelector('#avatar-dicebear-grid .avatar-style-option.selected');
        s.dicebearStyle = activeStyleEl ? activeStyleEl.dataset.styleId : 'bottts';
        s.dicebearBgColor = s.avatarBgColor;
    }
    if (source === 'robohash') {
        var activeSetEl = document.querySelector('#avatar-robohash-grid .avatar-style-option.selected');
        s.robohashSet = activeSetEl ? activeSetEl.dataset.setId : '1';
    }
    if (source === 'unavatar') {
        var svcEl = document.getElementById('avatar-unavatar-service');
        var handleEl = document.getElementById('avatar-unavatar-handle');
        s.unavatarService = svcEl ? svcEl.value : 'github';
        s.unavatarHandle = handleEl ? handleEl.value.trim() : '';
    }

    saveAvatarSettings(s);
    var avatarData = (buildAvatarData(s) || '') + buildScene3dSuffix(getAvatar3dSettings());
    if (typeof connection !== 'undefined' && connection) {
        connection.invoke('UpdateAvatar', avatarData || null).catch(function(e) { console.error(e); });
    }
    updateAvatarPreview();
}

// ── 3D avatar customization (P13) — hat/eyes/tint for the room robot ──

function populateAvatar3dForm() {
    var s = getAvatar3dSettings();
    var hatEl  = document.getElementById('rs-avatar-hat');
    var eyesEl = document.getElementById('rs-avatar-eyes');
    var tintEl = document.getElementById('rs-avatar-tint');
    var teamEl = document.getElementById('rs-avatar-team-color');
    if (hatEl)  hatEl.value  = s.hat;
    if (eyesEl) eyesEl.value = s.eyes;
    if (teamEl) teamEl.checked = !!s.useTeamColor;
    if (tintEl) { tintEl.value = s.tint || '#5b8dee'; tintEl.disabled = !!s.useTeamColor; }
}

function saveAvatar3dFromForm() {
    var hatEl  = document.getElementById('rs-avatar-hat');
    var eyesEl = document.getElementById('rs-avatar-eyes');
    var tintEl = document.getElementById('rs-avatar-tint');
    var teamEl = document.getElementById('rs-avatar-team-color');
    var s3d = {
        hat: hatEl ? hatEl.value : 'none',
        eyes: eyesEl ? eyesEl.value : 'round',
        useTeamColor: teamEl ? teamEl.checked : true,
        tint: tintEl ? tintEl.value : '#5b8dee'
    };
    saveAvatar3dSettings(s3d);
    if (tintEl) tintEl.disabled = s3d.useTeamColor;
    var avatarData = (buildAvatarData(getAvatarSettings()) || '') + buildScene3dSuffix(s3d);
    if (typeof connection !== 'undefined' && connection) {
        connection.invoke('UpdateAvatar', avatarData || null).catch(function(e) { console.error(e); });
    }
}

function onAvatarFileChange(input) {
    var errEl = document.getElementById('avatar-upload-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
            var canvas = document.getElementById('avatar-upload-canvas');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            var size = Math.min(img.width, img.height);
            var sx = (img.width  - size) / 2;
            var sy = (img.height - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
            var quality = 0.82;
            var dataUri;
            do {
                dataUri = canvas.toDataURL('image/jpeg', quality);
                quality -= 0.1;
            } while (dataUri.length > 65536 && quality > 0.2);
            if (dataUri.length > 65536) {
                if (errEl) { errEl.textContent = 'Image too large after compression. Try a different photo.'; errEl.style.display = ''; }
                return;
            }
            var s = getAvatarSettings();
            s.uploadDataUri = dataUri;
            saveAvatarSettings(s);
            updateAvatarPreview();
        };
        img.onerror = function() {
            if (errEl) { errEl.textContent = 'Could not read image file.'; errEl.style.display = ''; }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

var _RAND_ADJ  = ['swift','brave','fuzzy','cosmic','sneaky','jolly','grumpy','epic','silent','mighty'];
var _RAND_NOUN = ['otter','ninja','comet','panda','ferret','wizard','cactus','goblin','robot','mango'];
function randomizeAvatarSeed() {
    var seed = _RAND_ADJ[Math.floor(Math.random() * _RAND_ADJ.length)]
             + '-' + _RAND_NOUN[Math.floor(Math.random() * _RAND_NOUN.length)]
             + '-' + (Math.floor(Math.random() * 90) + 10);
    var el = document.getElementById('avatar-seed');
    if (el) el.value = seed;
    updateAvatarPreview();
}

function resetAvatarSettings() {
    saveAvatarSettings(Object.assign({}, DEFAULT_AVATAR_SETTINGS));
    populateAvatarTab();
    if (typeof connection !== 'undefined' && connection) {
        connection.invoke('UpdateAvatar', null).catch(function(e) { console.error(e); });
    }
}
