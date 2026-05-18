// O6 — Reusable Emoji Picker
// Attach to any input via: <input data-picker-target ...>
// Or call: openEmojiPicker(inputId, triggerElement)

var _EP_CATS = {
    'Recent':     [],
    'Smileys':    ['😀','😂','😊','😍','🥰','😎','🤔','😮','😢','😡','🥳','😴','🤩','😜','🤗',
                   '😅','😏','🙄','😶','🤣','😇','🥴','🤯','🤠','😬','🥺','🤧','😤','😫','😩','🙃','🤫','🤭','😛'],
    'Symbols':    ['❤️','⭐','✨','🔥','💯','✅','❌','⚡','🎉','🎊','🏆','🎯','💎','🎲','🎮','💥','🌟','🚀',
                   '💫','⚠️','♻️','🔔','💬','💭','🔗','📌','🔒','🔓','🌐','⏳','⌛','💤','🎵','🎶','🔊','📣'],
    'Cards':      ['♠','♥','♦','♣','🃏','🀄','🎴'],
    'Shapes':     ['★','●','■','▲','◆','✚','✦','✧','⬛','⬜','🔴','🔵','🟢','🟡','🟠','🟣',
                   '🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','⚫','⚪'],
    'Nature':     ['🌸','🌺','🌻','🍀','🌈','❄️','🌊','⛅','🌙','☀️','🍁','🌿','🌵','🌴',
                   '🌷','🌞','🌝','🌛','☃️','🌪️','🌀','☔','💧','🔥','🌤️','🌦️','🌱','🌾','🍃'],
    'Animals':    ['🦈','🐠','🐙','🦁','🦊','🐺','🦋','🐸','🐧','🦄','🐉','🦅','🐬','🐼',
                   '🐶','🐱','🐭','🐰','🐻','🐨','🐯','🐮','🐷','🐵','🦆','🐦','🦉','🐛','🐝','🦎','🐢'],
    'Objects':    ['👑','💡','🔑','⚔️','🛡️','🚀','💻','📱','🎵','🎸','🎩','🎪','🔮','⏰',
                   '📚','✏️','🔭','🧪','💊','🧲','🪄','🎭','🎬','🖼️','🛠️','⚙️','🧩','🪀'],
    'Food':       ['🍕','🍔','🌮','🍜','🍣','🍩','🍪','🎂','🍦','🍫','🍰','🥗','🍇','🍓',
                   '🥑','🧁','🍷','🍺','🧃','🥤','🍎','🍋','🧀','🥐','🍞','🥩','🍳','🥞','🫖','☕'],
    'Travel':     ['✈️','🚂','🚗','⛵','🏠','🏰','🗼','🌍','🏖️','⛰️','🌃','🌉','🎡','🚀',
                   '🚁','⛽','🚦','🗺️','🧭','🏕️','🏝️','🌋','🗽','🗿','🏯'],
    'Activities': ['⚽','🏀','🎯','🎸','🎮','🎲','🎪','🏆','🥇','🎭','🎨','🎬','🎤','🎳','🧩',
                   '🏋️','🤸','🏊','🎿','🛹','🎻','🥊','🏇','🤺','🎣','⛸️'],
    'Flags':      ['🏁','🚩','🏳️','🏴','🎌','🏴‍☠️'],
};
var _epRecent = [];
var _epTargetInput = null;
var _epActiveCat = 'Smileys';

function _epLoadRecent() {
    try { _epRecent = JSON.parse(localStorage.getItem('es_emojiRecent') || '[]'); } catch(e) { _epRecent = []; }
    _EP_CATS['Recent'] = _epRecent;
}

function _epAddRecent(emoji) {
    _epLoadRecent();
    _epRecent = [emoji, ..._epRecent.filter(function(e) { return e !== emoji; })].slice(0, 16);
    _EP_CATS['Recent'] = _epRecent;
    localStorage.setItem('es_emojiRecent', JSON.stringify(_epRecent));
}

function _epInit() {
    if (document.getElementById('_emoji_picker')) return;
    var html = '<div id="_emoji_picker" style="display:none;position:fixed;z-index:10000;width:320px;max-height:380px;background:var(--bg2,#fff);border:1px solid var(--border,#dee2e6);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.25);overflow:hidden;padding:8px;">' +
        '<div class="d-flex gap-1 mb-2 flex-wrap" id="_ep_cats" style="font-size:0.72rem;"></div>' +
        '<input type="text" id="_ep_search" class="form-control form-control-sm mb-2" placeholder="🔍 Search...">' +
        '<div id="_ep_grid" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-height:260px;overflow-y:auto;"></div>' +
        '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    var catsEl = document.getElementById('_ep_cats');
    Object.keys(_EP_CATS).forEach(function(cat) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-xs btn-outline-secondary py-0 px-1';
        btn.style.fontSize = '0.7rem';
        btn.textContent = cat;
        btn.dataset.epCat = cat;
        btn.onclick = function() {
            document.getElementById('_ep_search').value = '';
            _epActiveCat = cat;
            _epShowCat(cat);
            catsEl.querySelectorAll('[data-ep-cat]').forEach(function(b) { b.classList.toggle('btn-primary', b.dataset.epCat === cat); b.classList.toggle('btn-outline-secondary', b.dataset.epCat !== cat); });
        };
        catsEl.appendChild(btn);
    });

    document.getElementById('_ep_search').addEventListener('input', function() {
        var q = this.value.trim().toLowerCase();
        if (!q) { _epShowCat(_epActiveCat); return; }
        var all = [];
        Object.keys(_EP_CATS).forEach(function(cat) { if (cat !== 'Recent') all = all.concat(_EP_CATS[cat]); });
        _epRenderGrid(all.filter(function(e) { return e.toLowerCase().includes(q); }));
    });

    document.addEventListener('mousedown', function(e) {
        var picker = document.getElementById('_emoji_picker');
        if (!picker || picker.style.display === 'none') return;
        if (!picker.contains(e.target) && !e.target.closest('[data-ep-trigger]')) {
            picker.style.display = 'none';
        }
    });
}

function _epShowCat(cat) {
    _epLoadRecent();
    var items = _EP_CATS[cat] || [];
    var catsEl = document.getElementById('_ep_cats');
    if (catsEl) catsEl.querySelectorAll('[data-ep-cat]').forEach(function(b) { b.classList.toggle('btn-primary', b.dataset.epCat === cat); b.classList.toggle('btn-outline-secondary', b.dataset.epCat !== cat); });
    _epRenderGrid(items);
}

function _epRenderGrid(items) {
    var grid = document.getElementById('_ep_grid');
    if (!grid) return;
    if (!items.length) { grid.innerHTML = '<span class="text-muted small p-2">No results</span>'; return; }
    grid.innerHTML = items.map(function(e) {
        var safe = e.replace(/'/g, '&#39;');
        return '<button type="button" class="btn btn-sm p-0" style="font-size:1.25rem;line-height:1.6;border:none;background:none;" onclick="_epSelect(\'' + safe + '\')" title="' + safe + '">' + e + '</button>';
    }).join('');
}

function _epSelect(emoji) {
    if (_epTargetInput) {
        _epTargetInput.value = _epTargetInput.value + emoji;
        _epTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    _epAddRecent(emoji);
    document.getElementById('_emoji_picker').style.display = 'none';
}
window._epSelect = _epSelect;

function openEmojiPicker(targetInputId, triggerEl) {
    _epInit();
    _epLoadRecent();
    _epTargetInput = document.getElementById(targetInputId);
    var picker = document.getElementById('_emoji_picker');
    var rect = triggerEl.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = rect.left;
    // Keep within viewport
    if (left + 320 > window.innerWidth) left = window.innerWidth - 328;
    if (top + 380 > window.innerHeight) top = rect.top - 384;
    picker.style.top = top + 'px';
    picker.style.left = left + 'px';
    picker.style.display = '';
    document.getElementById('_ep_search').value = '';
    _epActiveCat = _epRecent.length ? 'Recent' : 'Smileys';
    _epShowCat(_epActiveCat);
}
window.openEmojiPicker = openEmojiPicker;

function _epAutoAttach() {
    document.querySelectorAll('[data-picker-target]').forEach(function(input) {
        if (input._epAttached) return;
        input._epAttached = true;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-secondary';
        btn.title = 'Pick emoji';
        btn.textContent = '😊';
        btn.setAttribute('data-ep-trigger', '1');
        btn.onclick = function(e) { e.stopPropagation(); openEmojiPicker(input.id, btn); };
        // Insert after input if inside input-group, else after input
        var ig = input.closest('.input-group');
        if (ig) ig.appendChild(btn);
        else input.parentNode.insertBefore(btn, input.nextSibling);
    });
}
window._epAutoAttach = _epAutoAttach;

document.addEventListener('DOMContentLoaded', _epAutoAttach);
