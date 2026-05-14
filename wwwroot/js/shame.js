// Outlier spotlight: highlights the lone voter when a majority agrees on a different value.
var _shameToastTimer = null;

function triggerShame(stats) {
    if (!stats || !stats.shameParticipantId) return;

    var card = document.querySelector('[data-connection-id="' + stats.shameParticipantId + '"]');
    if (!card) return;

    card.classList.add('shame-spotlight');
    setTimeout(function () {
        card.classList.add('shame-shake');
        card.addEventListener('animationend', function () {
            card.classList.remove('shame-shake');
        }, { once: true });
    }, 350);

    _showShameToast(stats.shameParticipantName || 'Someone');
}

function _showShameToast(name) {
    var existing = document.getElementById('shame-toast');
    if (existing) existing.remove();
    if (_shameToastTimer) { clearTimeout(_shameToastTimer); _shameToastTimer = null; }

    var toast = document.createElement('div');
    toast.id = 'shame-toast';
    toast.className = 'shame-toast';
    toast.textContent = '🎯 ' + name + ' went rogue!';
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            toast.classList.add('shame-toast-visible');
        });
    });

    _shameToastTimer = setTimeout(function () {
        var t = document.getElementById('shame-toast');
        if (t) {
            t.classList.remove('shame-toast-visible');
            setTimeout(function () { if (t.parentNode) t.remove(); }, 300);
        }
    }, 3500);
}
