// ============================================================
// EstimationStation - Room Client
// ============================================================

let connection = null;
let myConnectionId = null;
let isObserver = false;
let selectedVote = null;
let skipVoteEnabled = false;
let currentEstimateValues = ['0','1','2','3','5','8','13','21','34','55','89','?','☕'];
let timerInterval = null;
let timerSeconds = 0;
let _esConsensusStreak = 0;
let _myVibe = null;
let _counterSpellOutlierId = null;
const VIBE_EMOJIS = ['🚀','😱','😴','🤔','💪','🤷'];
let _roundVoteOrder  = [];                // connectionIds in order votes were cast this round
let _roundFlipCounts = {};                // connectionId → number of vote changes this round
let _roundStartMs    = Date.now();        // reset on VotesReset, used for relative timestamps
let roomState = {
    participants: [],
    stories: [],
    votesRevealed: false,
    autoReveal: false,
    ghostModeEnabled: false,
    currentStoryId: null,
    estimateSet: 'fibonacci',
    history: []   // full session: { story, votes, stats, voteOrder, flipCounts }
};

// ============================================================
// SignalR Connection
// ============================================================
async function initSignalR() {
    connection = new signalR.HubConnectionBuilder()
        .withUrl('/pokerhub')
        .withAutomaticReconnect()
        .build();

    registerHandlers();

    try {
        await connection.start();
        myConnectionId = connection.connectionId;
        await connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, isObserver);
        if (typeof initVoiceRecognition === 'function') initVoiceRecognition();
    } catch (err) {
        console.error('SignalR connection failed:', err);
        setTimeout(initSignalR, 3000);
    }
}

// ============================================================
// Event Handlers
// ============================================================
function registerHandlers() {
    connection.on('RoomState', (state) => {
        roomState.participants = state.participants || [];
        roomState.stories = state.stories || [];
        roomState.votesRevealed = state.votesRevealed;
        roomState.autoReveal = state.autoReveal;
        roomState.ghostModeEnabled = state.ghostModeEnabled || false;
        roomState.currentStoryId = state.currentStoryId;
        roomState.estimateSet = state.estimateSet;
        currentEstimateValues = state.estimateValues || currentEstimateValues;

        document.getElementById('autoRevealCheck').checked = state.autoReveal;
        document.getElementById('estimateSetSelect').value = state.estimateSet || 'fibonacci';
        if (state.estimateSet === 'custom') {
            document.getElementById('customEstimatesDiv').style.display = 'block';
            if (state.customEstimates) document.getElementById('customEstimatesInput').value = state.customEstimates;
        }

        renderCards();
        renderParticipants();
        renderStories();
        updateCurrentStoryDisplay();
        _updateGhostToggleBtn();

        if (state.votesRevealed) {
            const votes = {};
            state.participants.forEach(p => { if (p.vote) votes[p.connectionId] = p.vote; });
            showStats(votes);
        }
    });

    connection.on('ParticipantJoined', (p) => {
        roomState.participants.push(p);
        renderParticipants();
        appendChat('System', `${p.name} joined the room`, null);
    });

    connection.on('ParticipantLeft', (connectionId, name) => {
        roomState.participants = roomState.participants.filter(p => p.connectionId !== connectionId);
        renderParticipants();
        appendChat('System', `${name} left the room`, null);
    });

    connection.on('NameUpdated', (connectionId, newName) => {
        const p = roomState.participants.find(p => p.connectionId === connectionId);
        if (p) {
            const oldName = p.name;
            p.name = newName;
            renderParticipants();
            if (connectionId === connection.connectionId) {
                document.getElementById('displayName').textContent = newName;
            }
            appendChat('System', `${oldName} changed name to ${newName}`, null);
        }
    });

    connection.on('VoteCast', (connectionId, hasVoted) => {
        const p = roomState.participants.find(p => p.connectionId === connectionId);
        if (p) {
            if (hasVoted) {
                if (p.hasVoted) {
                    // already voted — this is a flip
                    _roundFlipCounts[connectionId] = (_roundFlipCounts[connectionId] || 0) + 1;
                } else {
                    _roundVoteOrder.push(connectionId);
                }
            }
            p.hasVoted = hasVoted;
            renderParticipants();
        }
    });

    connection.on('VotesRevealed', (votes, stats) => {
        roomState.votesRevealed = true;
        const vibePanel = document.getElementById('vibeCheckPanel');
        if (vibePanel) vibePanel.style.display = 'none';
        roomState.participants.forEach(p => {
            if (votes[p.connectionId] !== undefined) p.vote = votes[p.connectionId];
        });
        document.getElementById('revealBtn').style.display = 'none';
        document.getElementById('hideBtn').style.display = 'block';
        renderParticipants();
        if (stats) { if (stats.isConsensus) { _esConsensusStreak++; } else { _esConsensusStreak = 0; } }
        showStats(votes, stats, true);
        if (stats && stats.isConsensus && _esConsensusStreak >= 3 && typeof triggerStreakCelebration === 'function') {
            triggerStreakCelebration(_esConsensusStreak);
            var _fThresh = (typeof getCelebrationSettings === 'function' ? getCelebrationSettings().finisherThreshold : 4) || 4;
            if (_esConsensusStreak >= _fThresh && typeof triggerFinisher === 'function') {
                setTimeout(function() { triggerFinisher(_esConsensusStreak); }, 700);
            }
        }
        var _ss = typeof getShameSettings === 'function' ? getShameSettings() : { enabled: true };
        if (_ss.enabled && typeof triggerShame === 'function') triggerShame(stats);
        if (typeof triggerBattle === 'function') triggerBattle(votes, stats);
        if (stats && !stats.isConsensus) {
            var _disc = typeof getDiscussionSettings === 'function' ? getDiscussionSettings() : {};
            if (_disc.enabled) {
                if (typeof triggerDiscussionTimer === 'function') triggerDiscussionTimer(stats.shameParticipantId || null);
            } else if (stats.shameParticipantId && typeof triggerFloorIsLava === 'function') {
                triggerFloorIsLava(stats.shameParticipantId);
            }
        }

        _counterSpellOutlierId = (stats && stats.shameParticipantId) || null;
        _renderCounterSpellButton(stats);

        // Record in history (no cap — keep full session)
        const storyTitle = roomState.currentStoryId
            ? (roomState.stories.find(s => s.id === roomState.currentStoryId)?.title || 'Unnamed')
            : 'Unnamed';
        roomState.history.unshift({
            story: storyTitle, votes, stats,
            voteOrder:  _roundVoteOrder.slice(),
            flipCounts: Object.assign({}, _roundFlipCounts)
        });
        renderVoteHistory();
    });

    connection.on('VotesHidden', () => {
        roomState.votesRevealed = false;
        document.getElementById('revealBtn').style.display = 'block';
        document.getElementById('hideBtn').style.display = 'none';
        document.getElementById('statsBar').style.display = 'none';
        renderParticipants();
    });

    connection.on('VotesReset', () => {
        roomState.votesRevealed = false;
        selectedVote = null;
        _counterSpellOutlierId = null;
        _roundVoteOrder  = [];
        _roundFlipCounts = {};
        _roundStartMs    = Date.now();
        _hideCounterSpellButton();
        if (typeof stopFloorIsLava === 'function') stopFloorIsLava();
        if (typeof stopDiscussionTimer === 'function') stopDiscussionTimer();
        roomState.participants.forEach(p => { p.vote = null; p.hasVoted = false; p.isGhost = false; });
        document.getElementById('revealBtn').style.display = 'block';
        document.getElementById('hideBtn').style.display = 'none';
        document.getElementById('statsBar').style.display = 'none';
        _myVibe = null;
        const vibePanel = document.getElementById('vibeCheckPanel');
        if (vibePanel) vibePanel.style.display = '';
        renderVibeDisplay({});
        renderCards();
        renderParticipants();
    });

    connection.on('GhostModeToggled', (enabled, togglerName) => {
        roomState.ghostModeEnabled = enabled;
        _showGhostInfoBar(enabled, togglerName);
        _updateGhostToggleBtn();
        renderCards();
    });

    connection.on('CounterSpellCast', (casterConnectionId, casterName) => {
        const p = roomState.participants.find(p => p.connectionId === casterConnectionId);
        if (p) p.counterUsed = true;
        _hideCounterSpellButton();
        if (typeof triggerChickenOverlay === 'function') triggerChickenOverlay(casterConnectionId);
        _showCounterSpellToast(casterName);
    });

    connection.on('StoryAdded', (story) => {
        roomState.stories.push(story);
        renderStories();
    });

    connection.on('StoryUpdated', (storyId, title) => {
        const s = roomState.stories.find(s => s.id === storyId);
        if (s) { s.title = title; renderStories(); updateCurrentStoryDisplay(); }
    });

    connection.on('CurrentStoryChanged', (storyId) => {
        roomState.currentStoryId = storyId;
        selectedVote = null;
        updateCurrentStoryDisplay();
        renderStories();
        renderCards();
    });

    connection.on('StoryDeleted', (storyId) => {
        roomState.stories = roomState.stories.filter(s => s.id !== storyId);
        if (roomState.currentStoryId === storyId) roomState.currentStoryId = null;
        renderStories();
        updateCurrentStoryDisplay();
    });

    connection.on('StoryCompleted', (storyId, estimate) => {
        const s = roomState.stories.find(s => s.id === storyId);
        if (s) { s.isCompleted = true; s.finalEstimate = estimate; renderStories(); }
    });

    connection.on('AutoRevealToggled', (enabled) => {
        roomState.autoReveal = enabled;
        document.getElementById('autoRevealCheck').checked = enabled;
    });

    connection.on('EstimateSetChanged', (setName, values) => {
        roomState.estimateSet = setName;
        currentEstimateValues = values;
        selectedVote = null;
        document.getElementById('estimateSetSelect').value = setName;
        document.getElementById('customEstimatesDiv').style.display = setName === 'custom' ? 'block' : 'none';
        renderCards();
    });

    connection.on('ChatReceived', (name, message, timestamp) => {
        appendChat(name, message, timestamp);
    });

    connection.on('TimerStarted', (seconds, startedBy) => {
        startLocalTimer(seconds);
        appendChat('System', `${startedBy} started a ${seconds}s timer`, null);
    });

    connection.on('TimerStopped', () => {
        stopLocalTimer();
    });

    connection.on('AvatarUpdated', (connectionId, avatarData) => {
        const p = roomState.participants.find(p => p.connectionId === connectionId);
        if (p) { p.avatarData = avatarData; renderParticipants(); }
    });

    connection.on('VibeUpdated', (counts) => { renderVibeDisplay(counts); });

    connection.onreconnected(() => {
        connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, isObserver);
    });
}

// ============================================================
// UI Rendering
// ============================================================
function renderCards() {
    const container = document.getElementById('cardContainer');
    container.innerHTML = '';
    const meIsGhost = roomState.participants.some(p => p.connectionId === connection?.connectionId && p.isGhost);
    const cantVote = isObserver || meIsGhost;
    const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
    values.forEach(val => {
        const card = document.createElement('div');
        card.className = 'poker-card' + (selectedVote === val ? ' selected' : '') + (cantVote ? ' disabled' : '');
        card.setAttribute('data-value', val);
        card.textContent = val;
        card.title = meIsGhost ? '👻 Ghosts cannot vote' : `Vote: ${val}`;
        if (!cantVote) {
            card.onclick = () => castVote(val);
        }
        container.appendChild(card);
    });
}

function renderParticipants() {
    const container = document.getElementById('participantsContainer');
    container.innerHTML = '';
    roomState.participants.forEach(p => {
        const isMe = p.connectionId === connection.connectionId;
        const div = document.createElement('div');
        div.className = 'participant-badge' +
            (p.hasVoted ? ' voted' : '') +
            (p.isObserver ? ' observer' : '') +
            (p.isGhost ? ' ghost' : '') +
            (isMe ? ' me' : '');
        div.dataset.connectionId = p.connectionId;

        let voteDisplay = '';
        if (p.isGhost) {
            voteDisplay = '<span class="vote-waiting">👻</span>';
        } else if (p.isObserver) {
            voteDisplay = '<span class="vote-waiting">👁️</span>';
        } else if (roomState.votesRevealed && p.vote) {
            voteDisplay = `<span class="participant-vote">${escHtml(p.vote)}</span>`;
        } else if (p.hasVoted) {
            voteDisplay = '<span class="vote-hidden">✓</span>';
        } else {
            voteDisplay = '<span class="vote-waiting">?</span>';
        }

        div.innerHTML = `
            <span class="participant-name" title="${escHtml(p.name)}">${escHtml(p.name)}${isMe ? ' (you)' : ''}</span>
            ${voteDisplay}
        `;

        if (typeof renderAvatar === 'function') {
            const avatarEl = renderAvatar(p.avatarData, p.name, 32);
            if (p.isObserver)      avatarEl.classList.add('av-observer');
            else if (p.hasVoted)   avatarEl.classList.add('av-voted');
            else                   avatarEl.classList.add('av-not-voted');
            if (isMe)              avatarEl.classList.add('av-me');
            div.prepend(avatarEl);
        }

        container.appendChild(div);
    });
}

function renderStories() {
    const list = document.getElementById('storiesList');
    list.innerHTML = '';
    roomState.stories.forEach(s => {
        const div = document.createElement('div');
        div.className = 'story-item' +
            (s.id === roomState.currentStoryId ? ' active' : '') +
            (s.isCompleted ? ' completed' : '');

        div.innerHTML = `
            <span class="story-item-title" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
            ${s.isCompleted ? `<span class="story-item-estimate">${escHtml(s.finalEstimate || '')}</span>` : ''}
            <div class="story-item-actions">
                ${!s.isCompleted ? `<button class="btn btn-xs btn-sm btn-outline-primary py-0 px-1" style="font-size:0.7rem;" onclick="setCurrentStory('${s.id}')">▶</button>` : ''}
                <button class="btn btn-xs btn-sm btn-outline-danger py-0 px-1" style="font-size:0.7rem;" onclick="deleteStory('${s.id}')">✕</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateCurrentStoryDisplay() {
    const el = document.getElementById('currentStoryDisplay');
    if (roomState.currentStoryId) {
        const story = roomState.stories.find(s => s.id === roomState.currentStoryId);
        el.textContent = story ? story.title : 'No story selected';
    } else {
        el.textContent = 'No story selected';
    }
}

function showStats(votes, stats, fresh = false) {
    const bar = document.getElementById('statsBar');
    bar.style.display = 'flex';

    if (stats) {
        document.getElementById('statAverage').textContent = stats.average !== null ? stats.average : '-';
        document.getElementById('statMin').textContent = stats.min !== null ? stats.min : '-';
        document.getElementById('statMax').textContent = stats.max !== null ? stats.max : '-';
        const badge = document.getElementById('consensusBadge');
        badge.style.display = stats.isConsensus ? 'inline-block' : 'none';
        if (fresh && stats.isConsensus && typeof triggerCelebration === 'function') {
            triggerCelebration();
        }
    } else {
        // Calculate locally if no stats provided
        const numericVotes = Object.values(votes)
            .filter(v => v && !isNaN(parseFloat(v.replace('½', '0.5'))))
            .map(v => parseFloat(v.replace('½', '0.5')));
        if (numericVotes.length > 0) {
            const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
            const min = Math.min(...numericVotes);
            const max = Math.max(...numericVotes);
            const isConsensus = new Set(numericVotes).size === 1;
            document.getElementById('statAverage').textContent = Math.round(avg * 10) / 10;
            document.getElementById('statMin').textContent = min;
            document.getElementById('statMax').textContent = max;
            document.getElementById('consensusBadge').style.display = isConsensus ? 'inline-block' : 'none';
            if (fresh && isConsensus && typeof triggerCelebration === 'function') {
                triggerCelebration();
            }
        }
    }
}

function appendChat(author, message, timestamp) {
    const container = document.getElementById('chatMessages');
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const div = document.createElement('div');
    div.className = 'chat-message';
    const isSystem = author === 'System';
    div.innerHTML = `
        ${!isSystem ? `<span class="chat-author">${escHtml(author)}:</span>` : ''}
        <span class="chat-text" style="${isSystem ? 'background:none;color:var(--text-secondary);font-style:italic;font-size:0.8rem;' : ''}">${escHtml(message)}</span>
        ${timeStr ? `<span class="chat-time">${timeStr}</span>` : ''}
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ============================================================
// Hub Actions
// ============================================================
async function castVote(val) {
    if (isObserver) return;
    const meIsGhost = roomState.participants.some(p => p.connectionId === connection?.connectionId && p.isGhost);
    if (meIsGhost) return;
    const wasSelected = selectedVote === val;
    selectedVote = wasSelected ? null : val;
    renderCards();

    try {
        if (selectedVote !== null) {
            await connection.invoke('CastVote', selectedVote);
        } else {
            // Unselect: reset vote for this user only
            await connection.invoke('CastVote', null);
        }
    } catch(e) { console.error(e); }
}

async function revealVotes() {
    try { await connection.invoke('RevealVotes'); } catch(e) { console.error(e); }
}

async function toggleGhostMode() {
    try { await connection.invoke('ToggleGhostMode', !roomState.ghostModeEnabled); } catch(e) { console.error(e); }
}

function _updateGhostToggleBtn() {
    var btn = document.getElementById('ghostToggleBtn');
    if (!btn) return;
    if (roomState.ghostModeEnabled) {
        btn.textContent = '👻 Ghost: On';
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-secondary');
    } else {
        btn.textContent = '👻 Ghost: Off';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-outline-secondary');
    }
}

function _showGhostInfoBar(enabled, name) {
    var existing = document.getElementById('ghost-info-bar');
    if (existing) existing.remove();
    var bar = document.createElement('div');
    bar.id = 'ghost-info-bar';
    bar.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);' +
        'background:#6c757d;color:#fff;padding:6px 20px;border-radius:20px;font-size:0.85rem;' +
        'font-weight:600;z-index:9990;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    bar.textContent = '👻 Ghost mode ' + (enabled ? 'enabled' : 'disabled') + ' by ' + name;
    document.body.appendChild(bar);
    setTimeout(function() { if (bar.parentNode) bar.remove(); }, 4000);
}

function _renderCounterSpellButton(stats) {
    var bar = document.getElementById('counterSpellBar');
    if (!bar) return;
    var cs = typeof getCounterSpellSettings === 'function' ? getCounterSpellSettings() : {};
    if (!cs.enabled) { bar.style.display = 'none'; return; }
    if (!stats || !stats.shameParticipantId) { bar.style.display = 'none'; return; }
    var myId = connection && connection.connectionId;
    if (stats.shameParticipantId !== myId) { bar.style.display = 'none'; return; }
    var me = roomState.participants.find(p => p.connectionId === myId);
    if (me && me.counterUsed) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span style="font-size:0.85rem;">🪄 You\'re the outlier — retaliate!</span>' +
        '<button class="btn btn-sm btn-warning" onclick="castCounterSpell()">🐔 Cast Spell</button>';
}

function _hideCounterSpellButton() {
    var bar = document.getElementById('counterSpellBar');
    if (bar) bar.style.display = 'none';
}

function _showCounterSpellToast(casterName) {
    var existing = document.getElementById('counter-spell-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'counter-spell-toast';
    toast.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);' +
        'background:#ffc107;color:#000;padding:8px 24px;border-radius:20px;font-size:0.9rem;' +
        'font-weight:700;z-index:9995;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,0.25);';
    toast.textContent = '🪄 ' + casterName + ' cast a Counter-Spell! 🐔';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
}

async function castCounterSpell() {
    try { await connection.invoke('CastCounterSpell'); } catch(e) { console.error(e); }
}

async function hideVotes() {
    try { await connection.invoke('HideVotes'); } catch(e) { console.error(e); }
}

async function resetVotes() {
    // Only confirm if votes haven't been revealed yet AND at least one person has voted
    const anyVoteCast = roomState.participants.some(p => p.hasVoted);
    if (!roomState.votesRevealed && anyVoteCast) {
        if (!confirm('Are you sure? This will reset all votes for everyone.')) return;
    }
    try { await connection.invoke('ResetVotes'); } catch(e) { console.error(e); }
}

async function addStory() {
    const input = document.getElementById('newStoryInput');
    const title = input.value.trim();
    if (!title) return;
    try {
        await connection.invoke('AddStory', title);
        input.value = '';
    } catch(e) { console.error(e); }
}

async function setCurrentStory(storyId) {
    try { await connection.invoke('SetCurrentStory', storyId); } catch(e) { console.error(e); }
}

async function deleteStory(storyId) {
    if (!confirm('Delete this story?')) return;
    try { await connection.invoke('DeleteStory', storyId); } catch(e) { console.error(e); }
}

async function toggleAutoReveal(enabled) {
    try { await connection.invoke('ToggleAutoReveal', enabled); } catch(e) { console.error(e); }
}

async function toggleObserver(enabled) {
    isObserver = enabled;
    selectedVote = null;
    renderCards();
    // Re-join as observer/participant
    try {
        await connection.invoke('LeaveRoom');
        await connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, enabled);
    } catch(e) { console.error(e); }
}

async function changeEstimateSet(setName) {
    const customDiv = document.getElementById('customEstimatesDiv');
    if (setName === 'custom') {
        customDiv.style.display = 'block';
        return;
    }
    if (!confirm('Are you sure? Changing the estimate set will reset all votes for everyone.')) {
        // Revert the dropdown to the currently active estimate set
        document.getElementById('estimateSetSelect').value = roomState.estimateSet || 'fibonacci';
        return;
    }
    customDiv.style.display = 'none';
    try { await connection.invoke('SetEstimateSet', setName, null); } catch(e) { console.error(e); }
}

async function applyCustomEstimates() {
    const val = document.getElementById('customEstimatesInput').value.trim();
    if (!val) return;
    try { await connection.invoke('SetEstimateSet', 'custom', val); } catch(e) { console.error(e); }
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    try {
        await connection.invoke('SendChat', msg);
        input.value = '';
    } catch(e) { console.error(e); }
}

async function startTimer(seconds) {
    try { await connection.invoke('StartTimer', seconds); } catch(e) { console.error(e); }
}

async function stopTimer() {
    try { await connection.invoke('StopTimer'); } catch(e) { console.error(e); }
    stopLocalTimer();
}

async function leaveRoom() {
    if (typeof stopSeasonalAmbience === 'function') stopSeasonalAmbience();
    try { await connection.invoke('LeaveRoom'); } catch(e) { }
    window.location.href = '/';
}

async function promptRename() {
    const newName = prompt('Enter new name:', ROOM_CONFIG.playerName);
    if (newName && newName.trim()) {
        ROOM_CONFIG.playerName = newName.trim();
        localStorage.setItem('es_playerName', ROOM_CONFIG.playerName);
        try { await connection.invoke('UpdateName', ROOM_CONFIG.playerName); } catch(e) { console.error(e); }
    }
}

// ============================================================
// Timer
// ============================================================
function startLocalTimer(seconds) {
    stopLocalTimer();
    timerSeconds = seconds;
    const display = document.getElementById('timerDisplay');
    const value = document.getElementById('timerValue');
    display.style.display = 'inline-flex';
    value.textContent = timerSeconds;

    timerInterval = setInterval(() => {
        timerSeconds--;
        value.textContent = timerSeconds;
        if (timerSeconds <= 0) {
            stopLocalTimer();
            value.textContent = '⏰';
        }
    }, 1000);
}

function stopLocalTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    document.getElementById('timerDisplay').style.display = 'none';
}

// ============================================================
// Stories Panel Toggle
// ============================================================
function toggleStoriesPanel() {
    const panel = document.getElementById('storiesPanel');
    const btn = document.getElementById('storiesToggleBtn');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'flex' : 'none';
    btn.style.display = isHidden ? 'none' : 'block';
}

// ============================================================
// Chat Toggle
// ============================================================
function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const body = document.getElementById('chatBody');
    const icon = document.getElementById('chatToggleIcon');
    const isExpanded = panel.classList.toggle('expanded');
    body.style.display = isExpanded ? 'flex' : 'none';
    icon.textContent = isExpanded ? '▲' : '▼';

    const isMobile = window.innerWidth < 992;
    const basePad = isMobile ? '56px' : '48px';
    document.getElementById('roomLayout').style.paddingBottom = isExpanded ? '280px' : basePad;

    // Highlight chat button on mobile
    const chatBtn = document.getElementById('mobileChatBtn');
    if (chatBtn) chatBtn.classList.toggle('active', isExpanded);
}

// ============================================================
// Export CSV
// ============================================================
function exportCSV() {
    const rows = [['Story', 'Final Estimate', 'Completed']];
    roomState.stories.forEach(s => {
        rows.push([`"${s.title.replace(/"/g, '""')}"`, s.finalEstimate || '', s.isCompleted ? 'Yes' : 'No']);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ROOM_CONFIG.roomName}-estimates.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// Vote History
// ============================================================
function renderVoteHistory() {
    const section = document.getElementById('voteHistorySection');
    const list = document.getElementById('voteHistoryList');
    if (!section || !list) return;

    if (roomState.history.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';

    const awardsBtn = document.getElementById('awards-trigger-btn');
    if (awardsBtn) awardsBtn.style.display = roomState.history.length >= 2 ? '' : 'none';

    list.innerHTML = '';
    roomState.history.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'vote-history-entry';
        const avg = entry.stats?.average ?? '-';
        const min = entry.stats?.min ?? '-';
        const max = entry.stats?.max ?? '-';
        const consensus = entry.stats?.isConsensus ? ' 🎉' : '';
        div.innerHTML = `
            <span class="vote-history-story" title="${escHtml(entry.story)}">${escHtml(entry.story)}</span>
            <span class="vote-history-stats">
                <span title="Average">avg: <strong>${avg}</strong></span>
                <span title="Min/Max">${min}–${max}</span>
                ${consensus ? `<span>${consensus}</span>` : ''}
            </span>`;
        list.appendChild(div);
    });
}

function toggleVoteHistory() {
    const list = document.getElementById('voteHistoryList');
    const chevron = document.getElementById('voteHistoryChevron');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.textContent = isHidden ? '▴' : '▾';
}

// ============================================================
// Story Import
// ============================================================
async function importStories() {
    const input = document.getElementById('importStoriesInput');
    if (!input) return;
    const lines = input.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    for (const line of lines) {
        try { await connection.invoke('AddStory', line); } catch(e) { console.error(e); }
    }
    input.value = '';
    const details = input.closest('details');
    if (details) details.removeAttribute('open');
}

// ============================================================
// Skip Vote Toggle
// ============================================================
function toggleSkipVoteCard(enabled) {
    skipVoteEnabled = enabled;
    renderCards();
}

// ============================================================
// Keyboard Shortcuts
// ============================================================
document.addEventListener('keydown', (e) => {
    // Don't fire shortcuts when typing or when any modal is open
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (document.querySelector('.modal.show')) return;

    if (e.code === 'Space' && !roomState.votesRevealed) { e.preventDefault(); revealVotes(); }
    if (e.code === 'KeyR' && !e.ctrlKey) resetVotes();
    // 1–9: select nth card by position
    const numMatch = e.code.match(/^Digit([1-9])$/);
    if (numMatch && !e.ctrlKey && !e.altKey) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
        if (idx < values.length) castVote(values[idx]);
    }
});

document.getElementById('newStoryInput').addEventListener('keypress', e => { if (e.key === 'Enter') addStory(); });
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
initVibePanel();
if (typeof startSeasonalAmbience === 'function') startSeasonalAmbience();

// ============================================================
// Helpers
// ============================================================
function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
// Vibe Check
// ============================================================
function initVibePanel() {
    const container = document.getElementById('vibeButtons');
    if (!container) return;
    VIBE_EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'vibe-btn';
        btn.dataset.vibe = emoji;
        btn.title = emoji;
        btn.textContent = emoji;
        btn.onclick = () => castVibeLocal(emoji);
        container.appendChild(btn);
    });
}

function castVibeLocal(emoji) {
    _myVibe = emoji;
    document.querySelectorAll('.vibe-btn').forEach(b =>
        b.classList.toggle('vibe-selected', b.dataset.vibe === emoji));
    connection.invoke('CastVibe', emoji).catch(e => console.error(e));
}

function renderVibeDisplay(counts) {
    // Update count badges on each button
    document.querySelectorAll('.vibe-btn').forEach(btn => {
        const c = counts[btn.dataset.vibe] || 0;
        let badge = btn.querySelector('.vibe-count');
        if (!badge) { badge = document.createElement('span'); badge.className = 'vibe-count'; btn.appendChild(badge); }
        badge.textContent = c > 0 ? c : '';
    });
    // Summary line
    const summary = document.getElementById('vibeSummary');
    if (!summary) return;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) { summary.textContent = ''; return; }
    summary.textContent = total + ' teammate' + (total !== 1 ? 's' : '') + ' checked in';
}

// ============================================================
// Init
// ============================================================
const isMobile = window.innerWidth < 992;
document.getElementById('roomLayout').style.paddingBottom = isMobile ? '56px' : '48px';
initSignalR();
