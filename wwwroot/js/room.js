// ============================================================
// EstimationStation - Room Client
// ============================================================

let connection = null;
let myConnectionId = null;
let isObserver = false;
let selectedVote = null;
let currentEstimateValues = ['0','1','2','3','5','8','13','21','34','55','89','?','☕'];
let timerInterval = null;
let timerSeconds = 0;
let roomState = {
    participants: [],
    stories: [],
    votesRevealed: false,
    autoReveal: false,
    currentStoryId: null,
    estimateSet: 'fibonacci'
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
        if (p) { p.hasVoted = hasVoted; renderParticipants(); }
    });

    connection.on('VotesRevealed', (votes, stats) => {
        roomState.votesRevealed = true;
        roomState.participants.forEach(p => {
            if (votes[p.connectionId] !== undefined) p.vote = votes[p.connectionId];
        });
        document.getElementById('revealBtn').style.display = 'none';
        document.getElementById('hideBtn').style.display = 'block';
        renderParticipants();
        showStats(votes, stats);
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
        roomState.participants.forEach(p => { p.vote = null; p.hasVoted = false; });
        document.getElementById('revealBtn').style.display = 'block';
        document.getElementById('hideBtn').style.display = 'none';
        document.getElementById('statsBar').style.display = 'none';
        renderCards();
        renderParticipants();
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
    currentEstimateValues.forEach(val => {
        const card = document.createElement('div');
        card.className = 'poker-card' + (selectedVote === val ? ' selected' : '') + (isObserver ? ' disabled' : '');
        card.setAttribute('data-value', val);
        card.textContent = val;
        card.title = `Vote: ${val}`;
        if (!isObserver) {
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
            (isMe ? ' me' : '');

        let voteDisplay = '';
        if (p.isObserver) {
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

function showStats(votes, stats) {
    const bar = document.getElementById('statsBar');
    bar.style.display = 'flex';

    if (stats) {
        document.getElementById('statAverage').textContent = stats.average !== null ? stats.average : '-';
        document.getElementById('statMin').textContent = stats.min !== null ? stats.min : '-';
        document.getElementById('statMax').textContent = stats.max !== null ? stats.max : '-';
        const badge = document.getElementById('consensusBadge');
        badge.style.display = stats.isConsensus ? 'inline-block' : 'none';
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
    selectedVote = val === selectedVote ? null : val;
    renderCards();

    if (selectedVote !== null) {
        try { await connection.invoke('CastVote', selectedVote); } catch(e) { console.error(e); }
    }
}

async function revealVotes() {
    try { await connection.invoke('RevealVotes'); } catch(e) { console.error(e); }
}

async function hideVotes() {
    try { await connection.invoke('HideVotes'); } catch(e) { console.error(e); }
}

async function resetVotes() {
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
// Keyboard Shortcuts
// ============================================================
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space' && !roomState.votesRevealed) { e.preventDefault(); revealVotes(); }
    if (e.code === 'KeyR' && !e.ctrlKey) resetVotes();
});

document.getElementById('newStoryInput').addEventListener('keypress', e => { if (e.key === 'Enter') addStory(); });
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

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
// Init
// ============================================================
const isMobile = window.innerWidth < 992;
document.getElementById('roomLayout').style.paddingBottom = isMobile ? '56px' : '48px';
initSignalR();
