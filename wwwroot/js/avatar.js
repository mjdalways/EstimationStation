// ── URL generation ───────────────────────────────────────────

function avatarDataToUrl(avatarData, size) {
    size = size || 64;
    if (!avatarData) return null;
    var parts = avatarData.split(':');
    var provider = parts[0];
    var p1 = parts[1] || '';
    var p2 = parts.slice(2).join(':');
    if (provider === 'dicebear') {
        return 'https://api.dicebear.com/9.x/' + encodeURIComponent(p1) + '/svg?seed=' + encodeURIComponent(p2) + '&size=' + size;
    }
    if (provider === 'robohash') {
        return 'https://robohash.org/' + encodeURIComponent(p2) + '?set=set' + (p1 || '1') + '&size=' + size + 'x' + size;
    }
    if (provider === 'unavatar') {
        var svc = p1, handle = p2;
        if (svc && handle) return 'https://unavatar.io/' + encodeURIComponent(svc) + '/' + encodeURIComponent(handle);
        return 'https://unavatar.io/' + encodeURIComponent(svc || handle);
    }
    return null;
}

// ── Rendering ────────────────────────────────────────────────

function renderAvatar(avatarData, name, size) {
    size = size || 48;
    var wrapper = document.createElement('div');
    wrapper.className = 'avatar-wrapper';
    wrapper.style.setProperty('--av-size', size + 'px');

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

    if (!avatarData || avatarData === 'initials') {
        var el = document.createElement('div');
        el.className = 'av-initials';
        el.style.background = colorFromName(name);
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
    { id: '2', label: '👾 Monsters' },
    { id: '3', label: '🤖 Robot Heads' },
    { id: '4', label: '🐱 Cats' },
    { id: '5', label: '🧑 Humans' }
];

// ── Avatar settings ──────────────────────────────────────────

var AVATAR_SETTINGS_KEY = 'es_avatarSettings';
var DEFAULT_AVATAR_SETTINGS = {
    source: 'initials',
    seed: '',
    dicebearStyle: 'bottts',
    robohashSet: '1',
    unavatarService: 'github',
    unavatarHandle: ''
};

function getAvatarSettings() {
    try {
        var raw = localStorage.getItem(AVATAR_SETTINGS_KEY);
        return Object.assign({}, DEFAULT_AVATAR_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) {
        return Object.assign({}, DEFAULT_AVATAR_SETTINGS);
    }
}

function saveAvatarSettings(s) {
    localStorage.setItem(AVATAR_SETTINGS_KEY, JSON.stringify(s));
}

function buildAvatarData(s) {
    if (!s || s.source === 'initials') return null;
    var defaultName = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || '');
    var seed = s.seed || defaultName;
    if (s.source === 'dicebear') return 'dicebear:' + (s.dicebearStyle  || 'bottts') + ':' + seed;
    if (s.source === 'robohash') return 'robohash:' + (s.robohashSet    || '1')       + ':' + seed;
    if (s.source === 'unavatar') return 'unavatar:' + (s.unavatarService || 'github')  + ':' + (s.unavatarHandle || '');
    return null;
}

// ── Form helpers ─────────────────────────────────────────────

function _getFormSource() {
    var el = document.querySelector('input[name="avatar-source"]:checked');
    return el ? el.value : 'initials';
}

function _buildAvatarDataFromForm() {
    var source = _getFormSource();
    if (source === 'initials') return null;
    var defaultName = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || '');
    var seedEl = document.getElementById('avatar-seed');
    var seed = (seedEl ? seedEl.value.trim() : '') || defaultName;
    if (source === 'dicebear') {
        var activeStyleEl = document.querySelector('#avatar-dicebear-grid .avatar-style-option.selected');
        return 'dicebear:' + (activeStyleEl ? activeStyleEl.dataset.styleId : 'bottts') + ':' + seed;
    }
    if (source === 'robohash') {
        var activeSetEl = document.querySelector('#avatar-robohash-grid .avatar-style-option.selected');
        return 'robohash:' + (activeSetEl ? activeSetEl.dataset.setId : '1') + ':' + seed;
    }
    if (source === 'unavatar') {
        var svcEl = document.getElementById('avatar-unavatar-service');
        var handleEl = document.getElementById('avatar-unavatar-handle');
        return 'unavatar:' + (svcEl ? svcEl.value : 'github') + ':' + (handleEl ? handleEl.value.trim() : '');
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
        'avatar-unavatar-panel': source === 'unavatar'
    };
    Object.keys(panels).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = panels[id] ? '' : 'none';
    });
    var seedWrap = document.getElementById('avatar-seed-wrap');
    if (seedWrap) seedWrap.style.display = source !== 'unavatar' ? '' : 'none';
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

    var svcEl = document.getElementById('avatar-unavatar-service');
    if (svcEl) svcEl.value = s.unavatarService || 'github';
    var handleEl = document.getElementById('avatar-unavatar-handle');
    if (handleEl) handleEl.value = s.unavatarHandle || '';

    onAvatarSourceChange();
}

function updateAvatarPreview() {
    var wrap = document.getElementById('avatar-preview-wrap');
    if (!wrap) return;
    var avatarData = _buildAvatarDataFromForm();
    var name = (typeof ROOM_CONFIG !== 'undefined' ? ROOM_CONFIG.playerName : '') || (localStorage.getItem('es_playerName') || 'Me');
    wrap.innerHTML = '';
    wrap.appendChild(renderAvatar(avatarData, name, 64));
}

function saveAvatarFromForm() {
    var source = _getFormSource();
    var seedEl = document.getElementById('avatar-seed');
    var s = Object.assign({}, getAvatarSettings(), { source: source, seed: seedEl ? seedEl.value.trim() : '' });

    if (source === 'dicebear') {
        var activeStyleEl = document.querySelector('#avatar-dicebear-grid .avatar-style-option.selected');
        s.dicebearStyle = activeStyleEl ? activeStyleEl.dataset.styleId : 'bottts';
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
    var avatarData = buildAvatarData(s);
    if (typeof connection !== 'undefined' && connection) {
        connection.invoke('UpdateAvatar', avatarData).catch(function(e) { console.error(e); });
    }
    updateAvatarPreview();
}

function resetAvatarSettings() {
    saveAvatarSettings(Object.assign({}, DEFAULT_AVATAR_SETTINGS));
    populateAvatarTab();
    if (typeof connection !== 'undefined' && connection) {
        connection.invoke('UpdateAvatar', null).catch(function(e) { console.error(e); });
    }
}
