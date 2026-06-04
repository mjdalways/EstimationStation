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
// P1 — Keyboard Shortcuts
let _kbShortcutsEnabled = true;
// P2 — Emoji Reactions
const REACTION_DEFAULT_PALETTE = ['👍','👏','🎉','😂','❤️','🔥','😮','💡'];
let _reactionPalette = [...REACTION_DEFAULT_PALETTE];
let _reactionEnabled = true;
let _reactionLastMs = 0;
const REACTION_RATE_LIMIT_MS = 800;
let _roundVoteOrder  = [];                // connectionIds in order votes were cast this round
let _roundFlipCounts = {};                // connectionId → number of vote changes this round
let _pendingRoomName = null;              // PIN: used when re-joining after PIN_REQUIRED
let _pendingUserName = null;
let _pinJoinPending = false;              // PIN: true while the join-required prompt is open; if it's dismissed without joining, go home
var _isMobile = window.innerWidth <= 600;
window.addEventListener('resize', function() { _isMobile = window.innerWidth <= 600; });
let _pendingIsObserver = false;
let _roundStartMs    = Date.now();        // reset on VotesReset, used for relative timestamps
let roomState = {
    participants: [],
    stories: [],
    votesRevealed: false,
    autoReveal: false,
    ghostModeEnabled: false,
    revealMajorityFirst: true,  // N3: room-level; overridden by RoomState on join
    currentStoryId: null,
    estimateSet: 'fibonacci',
    history: [],   // full session: { story, votes, stats, voteOrder, flipCounts }
    // AD1 — Host tracking
    isHost: false,
    hostConnectionId: null,
    // AD2 — Settings lock mode: none | ask | hostonly | hidden
    settingsLockMode: 'none'
};
window.roomState = roomState;

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
        const _savedPin = sessionStorage.getItem('es_roomPin_' + ROOM_CONFIG.roomName) || null;
        await connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, isObserver, _savedPin);
        if (typeof initVoiceRecognition === 'function') initVoiceRecognition();
        _promptSoundPreferenceOnce();
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
        roomState.revealMajorityFirst = state.revealMajorityFirst !== false; // N3: default true
        roomState.currentStoryId = state.currentStoryId;
        roomState.estimateSet = state.estimateSet;
        roomState.hasPin = state.hasPin === true;
        currentEstimateValues = state.estimateValues || currentEstimateValues;
        // AD1 — host fields
        roomState.isHost = state.isHost === true;
        roomState.hostConnectionId = state.hostConnectionId || null;
        roomState.settingsLockMode = state.settingsLockMode || 'none';
        roomState.leaveRequestTimeoutSeconds = state.leaveRequestTimeoutSeconds || 60;
        _syncLeaveTimeoutSelect();

        document.getElementById('autoRevealCheck').checked = state.autoReveal;
        var rmfChk = document.getElementById('revealMajorityCheck');
        if (rmfChk) rmfChk.checked = state.revealMajorityFirst !== false;
        document.getElementById('estimateSetSelect').value = state.estimateSet || 'fibonacci';
        if (state.estimateSet === 'custom') {
            document.getElementById('customEstimatesDiv').style.display = 'block';
            if (state.customEstimates) document.getElementById('customEstimatesInput').value = state.customEstimates;
        }

        // Sync PIN badge
        const _pinBadge = document.getElementById('pinBadge');
        if (_pinBadge) _pinBadge.style.display = state.hasPin ? '' : 'none';
        const _pinBtn = document.getElementById('pinBtn');
        if (_pinBtn) _pinBtn.classList.toggle('btn-warning', !!state.hasPin);

        renderCards();
        renderParticipants();
        renderStories();
        updateCurrentStoryDisplay();
        _updateGhostToggleBtn();
        _updateSprintDashboard();
        // AD1 — Apply host/lock UI after render
        _applyHostLockUI();
        // AD5 — Show setup prompt if host just created a fresh room (sole participant)
        if (state.isHost && state.participants && state.participants.length === 1) {
            setTimeout(_showHostSetupPrompt, 800);
        }

        if (state.votesRevealed) {
            const votes = {};
            state.participants.forEach(p => { if (p.vote) votes[p.connectionId] = p.vote; });
            showStats(votes);
        }

        // AC1: Start timer for any story already active when user joins/reconnects
        acStartStoryTimer(state.currentStoryId || null);
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
            const wasVoted = p.hasVoted;
            if (hasVoted) {
                if (p.hasVoted) {
                    // already voted — this is a change
                    _roundFlipCounts[connectionId] = (_roundFlipCounts[connectionId] || 0) + 1;
                } else {
                    _roundVoteOrder.push(connectionId);
                }
            }
            p.hasVoted = hasVoted;
            renderParticipants();
            if (connectionId === connection.connectionId) {
                const showConf = localStorage.getItem('es_showConfidence') !== '0';
                const sel = document.getElementById('confidenceSelector');
                if (sel) sel.style.display = (hasVoted && showConf) ? 'block' : 'none';
            }
            if (hasVoted && !wasVoted) {
                const badge = document.querySelector('[data-connection-id="' + connectionId + '"]');
                if (badge) {
                    // X1: flip animation when badge transitions to voted state
                    if (localStorage.getItem('es_flipOnVote') !== '0') {
                        badge.classList.add('poker-flip');
                        setTimeout(() => badge.classList.remove('poker-flip'), 500);
                    }
                    // card burst particle effect
                    if (typeof triggerCardBurst === 'function') {
                        const r = badge.getBoundingClientRect();
                        triggerCardBurst((r.left + r.width / 2) / window.innerWidth,
                                        (r.top  + r.height / 2) / window.innerHeight);
                    }
                }
            }
        }
    });

    connection.on('VotesRevealed', (votes, stats) => {
        roomState.votesRevealed = true;
        if (typeof stopTimerAudio === 'function') stopTimerAudio();
        const vibePanel = document.getElementById('vibeCheckPanel');
        if (vibePanel) vibePanel.style.display = 'none';
        const confSel = document.getElementById('confidenceSelector');
        if (confSel) confSel.style.display = 'none';
        roomState.participants.forEach(p => {
            if (votes[p.connectionId] !== undefined) p.vote = votes[p.connectionId];
        });
        document.getElementById('revealBtn').style.display = 'none';
        document.getElementById('hideBtn').style.display = 'block';
        const _revealContainer = document.getElementById('participantsContainer');
        const _usePokerReveal = typeof getCelebrationSettings === 'function' && getCelebrationSettings().pokerReveal !== false;
        if (_usePokerReveal) {
            _sequentialReveal(votes, stats);
        } else {
            if (_revealContainer) _revealContainer.classList.add('revealing');
            renderParticipants();
            setTimeout(() => { if (_revealContainer) _revealContainer.classList.remove('revealing'); }, 600);
        }
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
        if (typeof saveVelocityForSession === 'function') saveVelocityForSession();
        _qTryDesktopNotify(stats);  // Q2
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
        roomState.participants.forEach(p => { p.vote = null; p.hasVoted = false; p.isGhost = false; p.confidence = null; });
        const confSel = document.getElementById('confidenceSelector');
        if (confSel) { confSel.style.display = 'none'; _updateConfidenceUI(0); }
        document.getElementById('revealBtn').style.display = 'block';
        document.getElementById('hideBtn').style.display = 'none';
        document.getElementById('statsBar').style.display = 'none';
        _myVibe = null;
        localStorage.removeItem('es_hideVibeCheck'); // reset vibe hide on new round
        const vibePanel = document.getElementById('vibeCheckPanel');
        if (vibePanel) vibePanel.style.display = '';
        const vibeClearBtn = document.getElementById('vibeClearBtn');
        if (vibeClearBtn) vibeClearBtn.classList.add('d-none');
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

    connection.on('StoriesImported', (stories) => {
        stories.forEach(s => roomState.stories.push(s));
        renderStories();
        const status = document.getElementById('jiraImportStatus');
        if (status) {
            status.textContent = `✅ Imported ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}`;
            setTimeout(() => { status.textContent = ''; }, 3000);
        }
    });

    connection.on('JiraWriteResult', (jiraKey, success, error) => {
        var iconEl = document.getElementById('jira-wb-' + jiraKey);
        if (iconEl) {
            iconEl.textContent = success ? '✅' : '❌';
            iconEl.title = success ? 'Written to Jira' : ('Write failed: ' + (error || 'unknown'));
            setTimeout(function() { if (iconEl) iconEl.textContent = ''; }, 8000);
        }
    });

    connection.on('StoryUpdated', (storyId, title) => {
        const s = roomState.stories.find(s => s.id === storyId);
        if (s) { s.title = title; renderStories(); updateCurrentStoryDisplay(); }
    });

    connection.on('StoryNotesUpdated', (storyId, notes) => {
        const s = roomState.stories.find(s => s.id === storyId);
        if (s) { s.notes = notes; renderStories(); _updateCurrentStoryNote(); }
    });

    connection.on('CurrentStoryChanged', (storyId) => {
        roomState.currentStoryId = storyId;
        selectedVote = null;
        updateCurrentStoryDisplay();
        renderStories();
        renderCards();
        acStartStoryTimer(storyId);  // AC1: start per-story timer
    });

    connection.on('StoryDeleted', (storyId) => {
        roomState.stories = roomState.stories.filter(s => s.id !== storyId);
        if (roomState.currentStoryId === storyId) roomState.currentStoryId = null;
        renderStories();
        updateCurrentStoryDisplay();
    });

    // AK2: server broadcasts the new story order to all clients
    connection.on('StoriesReordered', (orderedIds) => {
        const lookup = Object.fromEntries(roomState.stories.map(s => [s.id, s]));
        const reordered = orderedIds.filter(id => lookup[id]).map(id => lookup[id]);
        roomState.stories.forEach(s => { if (!orderedIds.includes(s.id)) reordered.push(s); });
        roomState.stories = reordered;
        renderStories();
    });

    connection.on('StoryCompleted', (storyId, estimate) => {
        const s = roomState.stories.find(s => s.id === storyId);
        if (s) { s.isCompleted = true; s.finalEstimate = estimate; renderStories(); }
        _updateSprintDashboard();
        // If all stories are now complete, save this session's velocity
        const allDone = roomState.stories.length > 0
            && roomState.stories.every(function(st) { return st.isCompleted; });
        if (allDone && typeof saveSessionSummary === 'function') saveSessionSummary();
    });

    connection.on('AutoRevealToggled', (enabled) => {
        roomState.autoReveal = enabled;
        document.getElementById('autoRevealCheck').checked = enabled;
    });

    // N3: room-level reveal ordering
    connection.on('RevealOrderingToggled', (enabled) => {
        roomState.revealMajorityFirst = enabled;
        var rmfChk = document.getElementById('revealMajorityCheck');
        if (rmfChk) rmfChk.checked = enabled;
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
        // Start audio immediately if timer is at or below trigger point
        if (typeof getTimerAudioSettings === 'function') {
            const _ta = getTimerAudioSettings();
            if (seconds <= (_ta.triggerAt || 10) && typeof startTimerAudio === 'function') {
                startTimerAudio(seconds);
            }
        }
    });

    connection.on('TimerStopped', () => {
        stopLocalTimer();
        if (typeof stopTimerAudio === 'function') stopTimerAudio();
    });

    connection.on('AvatarUpdated', (connectionId, avatarData) => {
        const p = roomState.participants.find(p => p.connectionId === connectionId);
        if (p) { p.avatarData = avatarData; renderParticipants(); }
    });

    connection.on('VibeUpdated', (counts) => { renderVibeDisplay(counts); });
    connection.on('ReceiveReaction', (senderCid, emoji) => { _reactionFloatFromBadge(senderCid, emoji); });
    connection.on('SoundTriggered', (soundId, senderName) => {
        const sr = _getSoundReceiveSettings();
        if (sr.receive !== false) {
            _playSoundLocal(soundId);
        } else if (sr.subtitle !== false) {
            _showSoundSubtitle(soundId, senderName || 'Someone');
        }
    });
    connection.on('CustomSoundTriggered', (base64Data, senderName, label) => {
        const sr = _getSoundReceiveSettings();
        if (sr.receive !== false) {
            try { new Audio(base64Data).play().catch(() => {}); } catch(e) {}
        } else if (sr.subtitle !== false) {
            _showSoundSubtitle('custom:' + (label || 'Custom'), senderName || 'Someone');
        }
    });
    connection.on('ConfidenceCast', (connectionId, level) => {
        const p = roomState.participants.find(p => p.connectionId === connectionId);
        if (p) { p.confidence = level; renderParticipants(); }
    });

    connection.onreconnected(() => {
        const _rPin = sessionStorage.getItem('es_roomPin_' + ROOM_CONFIG.roomName) || null;
        connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, isObserver, _rPin);
    });

    connection.on('Error', (msg) => {
        if (msg === 'PIN_REQUIRED') {
            _pendingRoomName = ROOM_CONFIG.roomName;
            _pendingUserName = ROOM_CONFIG.playerName;
            _pendingIsObserver = isObserver;
            openPinModal(true);
            return;
        }
        console.error('Server error:', msg);
    });

    connection.on('RoomPinSet', (hasPin) => {
        roomState.hasPin = !!hasPin;
        const badge = document.getElementById('pinBadge');
        if (badge) badge.style.display = hasPin ? '' : 'none';
        const btn = document.getElementById('pinBtn');
        if (btn) btn.classList.toggle('btn-warning', hasPin);
    });

    // AD1 — Host transferred
    connection.on('HostChanged', (newHostId) => {
        roomState.hostConnectionId = newHostId;
        roomState.isHost = (newHostId === myConnectionId);
        _applyHostLockUI();
        if (roomState.isHost) _showToastAD('👑 You are now the room host', 'info');
    });

    // AD2 — Settings lock mode changed
    connection.on('SettingsLockChanged', (mode) => {
        roomState.settingsLockMode = mode;
        var sel = document.getElementById('settingsLockSelect');
        if (sel) sel.value = mode;
        _applyHostLockUI();
    });

    // AD3 — Host receives a setting-change request from a non-host
    connection.on('SettingChangeRequested', (requestId, requesterName, settingKey, valueJson) => {
        var labelMap = { autoReveal:'Auto Reveal', ghostMode:'Ghost Mode', revealMajorityFirst:'Reveal Ordering', estimateSet:'Estimate Set' };
        var label = labelMap[settingKey] || settingKey;
        _showHostApprovalToast(requestId, requesterName, label);
    });

    // AD3 — Requester receives result of their request
    connection.on('SettingChangeResolved', (requestId, approved, settingKey) => {
        _showToastAD(approved ? '✅ Setting change approved by host' : '❌ Setting change denied by host', approved ? 'success' : 'danger');
    });

    // AD5 — Private message received
    connection.on('PrivateMessageReceived', (senderName, message, timestamp) => {
        _showPrivateMessageToast(senderName, message);
    });

    // AD6 — Private emoji reaction received
    connection.on('PrivateReactionReceived', (senderName, emoji) => {
        _reactionFloatFromBadge(null, emoji, senderName);
    });

    // Remove-user flow
    connection.on('LeaveRequested', (requestId, requesterName, timeoutSeconds) => {
        _showLeaveRequestDialog(requestId, requesterName, timeoutSeconds);
    });
    connection.on('LeaveRequestSent', (targetName) => {
        _showToastAD('🚪 Asked ' + targetName + ' if they\'re still here', 'info');
    });
    connection.on('LeaveDeclined', (targetName) => {
        _showToastAD('✋ ' + targetName + ' is staying', 'info');
    });
    connection.on('LeaveRequestExpired', () => { _closeLeaveRequestDialog(); });
    connection.on('LeaveTimeoutChanged', (seconds) => {
        roomState.leaveRequestTimeoutSeconds = seconds;
        _syncLeaveTimeoutSelect();
    });
    connection.on('RemovedFromRoom', (reason) => { _handleRemovedFromRoom(reason); });
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
    values.forEach((val, idx) => {
        const card = document.createElement('div');
        card.className = 'poker-card' + (selectedVote === val ? ' selected' : '') + (cantVote ? ' disabled' : '');
        card.setAttribute('data-value', val);
        card.textContent = val;
        // AK: include keyboard shortcut in hover tooltip
        let shortcutHint = '';
        if (!cantVote) {
            if (idx < 9)         shortcutHint = ` — press ${idx + 1}`;
            else if (val === '☕') shortcutHint = ' — press C or 0';
            else if (val === '?') shortcutHint = ' — press Q';
            else if (val === '🚫') shortcutHint = ' — press −';
        }
        card.title = meIsGhost ? '👻 Ghosts cannot vote' : `Vote: ${val}${shortcutHint}`;
        if (!cantVote) {
            card.onclick = () => castVote(val);
        }
        container.appendChild(card);
    });
    _updateKeyboardLegend();
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
        if (_esConsensusStreak >= 3) div.classList.add('streak-active');
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

        // AD1 — Host crown
        if (p.connectionId === roomState.hostConnectionId) {
            div.classList.add('is-host');
        }

        // AD6 — Right-click context menu
        div.addEventListener('contextmenu', function(e) {
            _showParticipantContextMenu(e, p.connectionId, p.name);
        });

        container.appendChild(div);

        if (roomState.votesRevealed && _roundVoteOrder.length > 0
                && (typeof getCelebrationSettings !== 'function' || getCelebrationSettings().revealSpeedBadges !== false)) {
            const firstId = _roundVoteOrder[0];
            const lastId  = _roundVoteOrder[_roundVoteOrder.length - 1];
            if (p.connectionId === firstId) {
                const speedBadge = document.createElement('span');
                speedBadge.className = 'speed-badge speed-first';
                speedBadge.textContent = '⚡';
                speedBadge.title = 'First to vote';
                div.appendChild(speedBadge);
            } else if (p.connectionId === lastId && _roundVoteOrder.length > 1) {
                const speedBadge = document.createElement('span');
                speedBadge.className = 'speed-badge speed-last';
                speedBadge.textContent = '🐢';
                speedBadge.title = 'Last to vote';
                div.appendChild(speedBadge);
            }
        }

        if (roomState.votesRevealed && p.confidence) {
            const confEl = document.createElement('span');
            confEl.className = 'confidence-stars';
            confEl.title = 'Confidence: ' + p.confidence + '/5';
            confEl.textContent = '★'.repeat(p.confidence) + '☆'.repeat(5 - p.confidence);
            div.appendChild(confEl);
        }
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

        const _typeMap = {
            'Story':    { color: '#0052cc', bg: '#deebff' }, 'Bug':  { color: '#bf2600', bg: '#ffebe6' },
            'Task':     { color: '#344563', bg: '#ebecf0' }, 'Spike':{ color: '#5243aa', bg: '#eae6ff' },
            'Sub-task': { color: '#0052cc', bg: '#e3fcef' }, 'Epic': { color: '#6554c0', bg: '#eae6ff' }
        };
        const _ti = s.issueType && _typeMap[s.issueType];
        const typeChip = s.issueType
            ? `<span class="jira-type-chip" style="background:${_ti ? _ti.bg : '#ebecf0'};color:${_ti ? _ti.color : '#344563'};">${escHtml(s.issueType)}</span>`
            : '';
        const jiraBadge = s.jiraKey
            ? `${typeChip}<a class="jira-key-badge" href="${escHtml(s.jiraUrl || '#')}" target="_blank" rel="noopener"
                  title="Open in Jira">${escHtml(s.jiraKey)} ↗</a><span id="jira-wb-${escHtml(s.jiraKey)}" class="jira-wb-icon" title="Write estimate to Jira"></span>`
            : '';
        const _descTooltip = s.description
            ? ` title="${escHtml(s.description.substring(0, 200).replace(/\n/g, ' '))}"`
            : '';
        const displayTitle = s.jiraKey
            ? escHtml(s.title.replace(`[${s.jiraKey}] `, ''))
            : escHtml(s.title);
        const hasNote = s.notes && s.notes.trim().length > 0;
        const noteBtnClass = hasNote ? 'btn-warning' : 'btn-outline-secondary';
        // AK2: drag handle + draggable
        div.draggable = true;
        div.dataset.storyId = s.id;
        div.innerHTML = `
            <div class="story-row-main d-flex align-items-start gap-1">
                <span class="story-drag-handle" title="Drag to reorder">⠿</span>
                <div class="story-text flex-grow-1 min-w-0">
                    <span class="story-item-title"${_descTooltip || ` title="${escHtml(s.title)}"`}>${jiraBadge}${displayTitle}</span>
                    ${s.isCompleted ? `<span class="story-item-estimate">${escHtml(s.finalEstimate || '')}</span>` : ''}
                    ${hasNote ? `<div class="story-notes-preview text-muted small">${escHtml(s.notes.substring(0, 80))}${s.notes.length > 80 ? '…' : ''}</div>` : ''}
                </div>
                <div class="story-item-actions flex-shrink-0">
                    <button class="btn btn-xs btn-sm ${noteBtnClass} story-note-btn py-0 px-1" style="font-size:0.7rem;" onclick="_toggleStoryNote('${s.id}')" title="${hasNote ? 'Edit note' : 'Add note'}">📝</button>
                    ${!s.isCompleted ? `<button class="btn btn-xs btn-sm btn-outline-primary py-0 px-1" style="font-size:0.7rem;" onclick="setCurrentStory('${s.id}')" title="Set as current story">▶</button>` : ''}
                    <button class="btn btn-xs btn-sm btn-outline-danger py-0 px-1" style="font-size:0.7rem;" onclick="deleteStory('${s.id}')" title="Delete story">✕</button>
                </div>
            </div>
            <div class="story-notes-area" id="noteArea_${s.id}" style="display:none;">
                <textarea class="form-control form-control-sm" rows="3" placeholder="Add notes for this story…" onblur="updateStoryNotes('${s.id}', this.value)">${escHtml(s.notes || '')}</textarea>
            </div>
        `;
        // AK2: drag events
        div.addEventListener('dragstart', _storyDragStart);
        div.addEventListener('dragover',  _storyDragOver);
        div.addEventListener('drop',      _storyDrop);
        div.addEventListener('dragend',   _storyDragEnd);
        list.appendChild(div);
    });
    _updateSprintDashboard();
    // V2: set title when text overflows (narrow sidebar)
    list.querySelectorAll('.story-item-title').forEach(function(el) {
        if (el.scrollWidth > el.offsetWidth && !el.title) el.title = el.textContent.trim();
    });
}

// AK2: drag-and-drop reorder helpers
var _dragSrcId = null;
function _storyDragStart(e) {
    _dragSrcId = this.dataset.storyId;
    this.classList.add('story-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragSrcId);
}
function _storyDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var over = this;
    document.querySelectorAll('.story-item').forEach(function(el) { el.classList.remove('story-drop-target'); });
    if (over.dataset.storyId !== _dragSrcId) over.classList.add('story-drop-target');
}
function _storyDrop(e) {
    e.preventDefault();
    var targetId = this.dataset.storyId;
    if (!_dragSrcId || _dragSrcId === targetId) return;
    // Reorder in local roomState immediately for snappy feel
    var stories = roomState.stories;
    var srcIdx = stories.findIndex(function(s){ return s.id === _dragSrcId; });
    var tgtIdx = stories.findIndex(function(s){ return s.id === targetId; });
    if (srcIdx < 0 || tgtIdx < 0) return;
    var moved = stories.splice(srcIdx, 1)[0];
    stories.splice(tgtIdx, 0, moved);
    renderStories();
    // Broadcast the new order to all participants
    var orderedIds = stories.map(function(s){ return s.id; });
    connection.invoke('ReorderStories', orderedIds).catch(function(err){ console.error('ReorderStories failed', err); });
}
function _storyDragEnd() {
    document.querySelectorAll('.story-item').forEach(function(el) {
        el.classList.remove('story-dragging', 'story-drop-target');
    });
    _dragSrcId = null;
}

function _updateSprintDashboard() {
    var dash = document.getElementById('sprintDashboard');
    if (!dash) return;
    var completed = (roomState.stories || []).filter(function(s) { return s.isCompleted && s.finalEstimate; });
    var numeric = completed.map(function(s) { return parseFloat(s.finalEstimate); }).filter(function(v) { return !isNaN(v); });
    dash.style.display = completed.length > 0 ? '' : 'none';

    var totalEl = document.getElementById('sprintTotal');
    if (totalEl) totalEl.textContent = numeric.reduce(function(a,b){return a+b;}, 0) + ' pts';

    var spark = document.getElementById('sprintSparkline');
    if (spark) {
        if (numeric.length >= 2) {
            var max = Math.max.apply(null, numeric);
            var w = spark.offsetWidth || 160;
            var h = 28;
            var step = w / Math.max(numeric.length - 1, 1);
            var pts = numeric.map(function(v,i) {
                return (i * step).toFixed(1) + ',' + (h - 2 - (max > 0 ? (v / max) * (h - 6) : 0)).toFixed(1);
            }).join(' ');
            var dots = numeric.map(function(v,i) {
                var cx = (i * step).toFixed(1);
                var cy = (h - 2 - (max > 0 ? (v / max) * (h - 6) : 0)).toFixed(1);
                return '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="var(--accent,#0d6efd)"/>';
            }).join('');
            spark.innerHTML = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
                + '<polyline points="' + pts + '" fill="none" stroke="var(--accent,#0d6efd)" stroke-width="1.8"/>'
                + dots + '</svg>';
        } else {
            spark.innerHTML = '';
        }
    }

    var hist = typeof _getVelocityHistory === 'function' ? _getVelocityHistory() : [];
    var velWrap = document.getElementById('sprintVelocityWrap');
    var velChart = document.getElementById('sprintVelocityChart');
    if (velWrap && velChart && hist.length >= 2) {
        velWrap.style.display = '';
        var max2 = Math.max.apply(null, hist.map(function(entry){return entry.pts;}));
        var w2 = velChart.offsetWidth || 160;
        var h2 = 22;
        var step2 = w2 / Math.max(hist.length - 1, 1);
        var pts2 = hist.map(function(entry, i) {
            return (i * step2).toFixed(1) + ',' + (h2 - 2 - (max2 > 0 ? (entry.pts / max2) * (h2 - 4) : 0)).toFixed(1);
        }).join(' ');
        velChart.innerHTML = '<svg width="100%" height="' + h2 + '" viewBox="0 0 ' + w2 + ' ' + h2 + '" preserveAspectRatio="none">'
            + '<polyline points="' + pts2 + '" fill="none" stroke="var(--text-secondary,#888)" stroke-width="1.4" stroke-dasharray="3,2"/>'
            + '</svg>';
    } else if (velWrap) {
        velWrap.style.display = 'none';
    }
}

function updateCurrentStoryDisplay() {
    const el = document.getElementById('currentStoryDisplay');
    if (roomState.currentStoryId) {
        const story = roomState.stories.find(s => s.id === roomState.currentStoryId);
        el.textContent = story ? story.title : 'No story selected';
        if (story) {
            const prefix = story.jiraKey ? story.jiraKey + ' — ' : '';
            const title = (story.title || '').replace(/^\[.*?\]\s*/, '').substring(0, 45);
            document.title = prefix + title + ' | EstimationStation';
        }
    } else {
        el.textContent = 'No story selected';
        document.title = 'EstimationStation';
    }
    _updateCurrentStoryNote();
}

function _updateCurrentStoryNote() {
    const banner = document.getElementById('currentStoryNote');
    if (!banner) return;
    if (roomState.currentStoryId) {
        const story = roomState.stories.find(s => s.id === roomState.currentStoryId);
        if (story && story.notes && story.notes.trim()) {
            banner.textContent = '📝 ' + story.notes.trim();
            banner.style.display = '';
            return;
        }
    }
    banner.style.display = 'none';
}

function _toggleStoryNote(storyId) {
    const area = document.getElementById('noteArea_' + storyId);
    if (!area) return;
    const isOpen = area.style.display !== 'none';
    area.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
        const ta = area.querySelector('textarea');
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
}

function updateStoryNotes(storyId, notes) {
    const story = (roomState.stories || []).find(s => s.id === storyId);
    if (story) story.notes = notes;
    if (connection && connection.state === 'Connected') {
        connection.invoke('UpdateStoryNotes', storyId, notes || null).catch(console.error);
    }
}

function _updateAcceptBtnLabel(val) {
    var btn = document.getElementById('acceptEstimateBtn');
    var valSpan = document.getElementById('acceptEstimateValue');
    if (!btn) return;
    var v = (val || '').trim();
    btn.childNodes[0].textContent = v ? '✅ Override to ' + v + ' & Add to Story ' : '✅ Accept & Add to Story ';
    if (valSpan) valSpan.textContent = '';
}
window._updateAcceptBtnLabel = _updateAcceptBtnLabel;

async function acceptEstimate() {
    if (!roomState.currentStoryId) return;
    var overrideInput = document.getElementById('acceptEstimateInput');
    var override = overrideInput ? overrideInput.value.trim() : '';
    var avgEl = document.getElementById('statAverage');
    var estimate = override || (avgEl ? avgEl.textContent : '') || '';
    if (!estimate || estimate === '-') return;

    try {
        await connection.invoke('CompleteStory', roomState.currentStoryId, estimate);
    } catch(e) { console.error(e); return; }

    // Attempt Jira write-back if this story has a jiraKey
    const story = (roomState.stories || []).find(s => s.id === roomState.currentStoryId);
    if (story && story.jiraKey) {
        var jiraS = typeof getJiraSettings === 'function' ? getJiraSettings() : {};
        if (jiraS.domain && jiraS.email && jiraS.token) {
            connection.invoke('WriteJiraEstimate',
                jiraS.domain, jiraS.email, jiraS.token,
                story.jiraKey, estimate,
                jiraS.fieldId || 'customfield_10016'
            ).catch(console.error);
        }
    }
}

function togglePresentationMode() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function() {});
        document.body.classList.add('presentation-mode');
    } else {
        document.exitFullscreen().catch(function() {});
        document.body.classList.remove('presentation-mode');
    }
}
document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement) document.body.classList.remove('presentation-mode');
});

function _openStoriesSheet() {
    var panel = document.getElementById('storiesPanel');
    var backdrop = document.getElementById('storiesPanelBackdrop');
    if (panel) panel.classList.add('mobile-visible');
    if (backdrop) backdrop.classList.add('visible');
}
function _closeStoriesSheet() {
    var panel = document.getElementById('storiesPanel');
    var backdrop = document.getElementById('storiesPanelBackdrop');
    if (panel) panel.classList.remove('mobile-visible');
    if (backdrop) backdrop.classList.remove('visible');
}

(function() {
    var backdrop = document.getElementById('storiesPanelBackdrop');
    if (backdrop) backdrop.addEventListener('click', _closeStoriesSheet);
})();

(function() {
    var jiraDetails = document.getElementById('jiraImportDetails');
    if (jiraDetails) {
        jiraDetails.addEventListener('toggle', function() {
            if (jiraDetails.open) {
                var saved = typeof getJiraSettings === 'function' ? getJiraSettings() : {};
                var jqlEl = document.getElementById('jiraImportJql');
                if (jqlEl && !jqlEl.value && saved.jql) jqlEl.value = saved.jql;
            }
        });
    }
})();

function showStats(votes, stats, fresh = false) {
    const bar = document.getElementById('statsBar');
    bar.style.display = 'flex';

    // Populate accept button value
    const acceptVal = document.getElementById('acceptEstimateValue');
    const acceptInput = document.getElementById('acceptEstimateInput');
    if (acceptVal && stats && stats.average !== null) {
        acceptVal.textContent = '(' + stats.average + ')';
    } else if (acceptVal) {
        acceptVal.textContent = '';
    }
    if (acceptInput) acceptInput.value = '';

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
    _renderVoteDistribution(votes);
    _renderHotColdMeter();
}

function _renderVoteDistribution(votes) {
    const el = document.getElementById('voteDistBar');
    if (!el) return;
    if (typeof getCelebrationSettings === 'function' && getCelebrationSettings().revealVoteDist === false) { el.style.display = 'none'; return; }
    const counts = {};
    Object.values(votes).filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) { el.style.display = 'none'; return; }
    const sorted = Object.entries(counts).sort((a, b) => (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0));
    const colors = ['#0d6efd','#198754','#ffc107','#dc3545','#6f42c1','#0dcaf0','#fd7e14'];
    const bars = sorted.map((kv, i) => {
        const pct = Math.round(kv[1] / total * 100);
        return '<div style="flex:' + kv[1] + ';background:' + colors[i % colors.length]
             + ';display:flex;align-items:center;justify-content:center;'
             + 'font-size:0.72rem;color:#fff;font-weight:700;min-width:24px;padding:0 4px;'
             + 'border-radius:3px;transition:flex 0.4s ease;" title="' + escHtml(kv[0]) + ': ' + kv[1]
             + ' vote' + (kv[1] !== 1 ? 's' : '') + '">'
             + escHtml(kv[0]) + '</div>';
    });
    el.innerHTML = '<div style="font-size:0.7rem;color:var(--text-secondary,#6c757d);margin-bottom:3px;">Vote spread</div>'
        + '<div style="display:flex;gap:3px;height:26px;border-radius:5px;overflow:hidden;">' + bars.join('') + '</div>';
    el.style.display = '';
}

function _renderHotColdMeter() {
    const el = document.getElementById('hotColdMeter');
    if (!el) return;
    if (typeof getCelebrationSettings === 'function' && getCelebrationSettings().revealHotCold === false) { el.style.display = 'none'; return; }
    if (roomState.history.length < 2) { el.style.display = 'none'; return; }
    const last = roomState.history.slice(0, Math.min(3, roomState.history.length));
    const consensusCount = last.filter(r => r.stats && r.stats.isConsensus).length;
    let icon, label, color;
    if (consensusCount === last.length)  { icon = '🔥'; label = 'ON FIRE';    color = '#ff6b35'; }
    else if (consensusCount === 0)       { icon = '❄️'; label = 'ICY';        color = '#4fc3f7'; }
    else                                 { icon = '🌡️'; label = 'WARMING UP'; color = '#ffd700'; }
    el.innerHTML = icon + ' <span style="font-weight:700;color:' + color + ';">' + label + '</span>'
        + ' <span style="font-size:0.7rem;opacity:0.55;">(last ' + last.length + ' rounds)</span>';
    el.style.display = '';
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
    // AH6/AJ: card animation on the newly selected card (style-selectable)
    if (selectedVote !== null) {
        var selCard = document.querySelector('.poker-card.selected');
        if (selCard) {
            var _animStyle = localStorage.getItem('es_cardAnimStyle') || 'flip';
            var _animCls = _animStyle === 'flip' ? 'card-flipping' : 'card-anim-' + _animStyle;
            selCard.classList.add(_animCls);
            var _fd = (typeof _getFlipDuration === 'function' ? _getFlipDuration() : 600) + 100;
            setTimeout(function() { selCard.classList.remove(_animCls); }, _fd);
        }
    }
    if (selectedVote !== null) _qPlayVoteTick();  // Q1

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
    await _invokeRoomSetting('ghostMode', String(!roomState.ghostModeEnabled),
        () => connection.invoke('ToggleGhostMode', !roomState.ghostModeEnabled));
}

function openPinModal(forJoin) {
    // Setting/clearing the PIN is host-only; the join-required prompt (forJoin) is for everyone.
    if (!forJoin && !roomState.isHost) { _showToastAD('🔒 Only the host can set the room PIN', 'warning'); return; }
    const modal = document.getElementById('pinModal');
    if (!modal) return;
    const titleEl = document.getElementById('pinModalTitle');
    const submitEl = document.getElementById('pinSubmitBtn');
    const msgEl = document.getElementById('pinModalMsg');
    const inp = document.getElementById('pinInput');
    if (forJoin) {
        if (titleEl) titleEl.textContent = '🔒 PIN Required';
        if (submitEl) { submitEl.textContent = 'Join'; submitEl.style.display = ''; }
        if (msgEl) { msgEl.textContent = 'This room has a PIN. Enter it to join.'; msgEl.style.display = ''; }
        if (inp) inp.oninput = null;
    } else {
        if (titleEl) titleEl.textContent = '🔒 Set Room PIN';
        if (msgEl) msgEl.style.display = 'none';
        // The primary button's meaning depends on whether a PIN exists and whether the box is empty:
        //   box not empty            -> Set PIN
        //   box empty + PIN exists    -> Clear PIN
        //   box empty + no PIN        -> Cancel (no-op)
        if (inp) inp.oninput = _updatePinSubmitLabel;
    }
    if (inp) inp.value = '';
    if (!forJoin) _updatePinSubmitLabel();

    // For the join-required prompt, dismissing the modal (X / Cancel / backdrop / Esc) without
    // entering the PIN means they can't join — send them back to the home page.
    _pinJoinPending = forJoin;
    if (forJoin) {
        modal.addEventListener('hidden.bs.modal', function _onPinHide() {
            modal.removeEventListener('hidden.bs.modal', _onPinHide);
            if (_pinJoinPending) window.location.href = '/';
        });
    }

    new bootstrap.Modal(modal).show();
    setTimeout(() => { if (inp) inp.focus(); }, 350);
}

function _updatePinSubmitLabel() {
    const submitEl = document.getElementById('pinSubmitBtn');
    if (!submitEl) return;
    const hasText = ((document.getElementById('pinInput')?.value) || '').trim().length > 0;
    if (hasText) {
        submitEl.textContent = 'Set PIN';
        submitEl.style.display = '';
    } else if (roomState.hasPin) {
        submitEl.textContent = 'Clear PIN';
        submitEl.style.display = '';
    } else {
        // No PIN and empty box — the footer Cancel button already covers this, so hide
        // the primary button rather than show a second "Cancel".
        submitEl.style.display = 'none';
    }
}

function submitPin() {
    const pin = (document.getElementById('pinInput')?.value || '').trim();
    _pinJoinPending = false; // submitting (Join/Set/Clear) — don't treat the ensuing hide as a cancel
    const bsModal = bootstrap.Modal.getInstance(document.getElementById('pinModal'));
    if (bsModal) bsModal.hide();
    if (_pendingRoomName) {
        // Re-join after PIN prompt
        sessionStorage.setItem('es_roomPin_' + _pendingRoomName, pin);
        connection.invoke('JoinRoom', _pendingRoomName, _pendingUserName, _pendingIsObserver, pin).catch(console.error);
        _pendingRoomName = null;
    } else if (pin) {
        connection.invoke('SetRoomPin', pin).catch(console.error);          // Set PIN
    } else if (roomState.hasPin) {
        connection.invoke('SetRoomPin', null).catch(console.error);         // Clear PIN
    }
    // else: no PIN and empty box -> Cancel, nothing to do
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
    if (_isMobile) _closeStoriesSheet();
}

async function deleteStory(storyId) {
    if (!confirm('Delete this story?')) return;
    try { await connection.invoke('DeleteStory', storyId); } catch(e) { console.error(e); }
}

async function toggleAutoReveal(enabled) {
    await _invokeRoomSetting('autoReveal', String(enabled),
        () => connection.invoke('ToggleAutoReveal', enabled));
}

// N3: room-level reveal ordering toggle
async function toggleRevealOrdering(enabled) {
    await _invokeRoomSetting('revealMajorityFirst', String(enabled),
        () => connection.invoke('ToggleRevealOrdering', enabled));
}

async function toggleObserver(enabled) {
    isObserver = enabled;
    selectedVote = null;
    renderCards();
    // Re-join as observer/participant
    try {
        await connection.invoke('LeaveRoom');
        const _pin2 = sessionStorage.getItem('es_roomPin_' + ROOM_CONFIG.roomName) || null;
        await connection.invoke('JoinRoom', ROOM_CONFIG.roomName, ROOM_CONFIG.playerName, enabled, _pin2);
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
        // Start timer audio when countdown hits the trigger point
        if (typeof getTimerAudioSettings === 'function' && typeof startTimerAudio === 'function') {
            const _ta = getTimerAudioSettings();
            if (timerSeconds === (_ta.triggerAt || 10)) startTimerAudio(timerSeconds);
        }
        if (timerSeconds <= 0) {
            stopLocalTimer();
            if (typeof stopTimerAudio === 'function') stopTimerAudio();
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
    const isCurrentlyExpanded = panel.classList.contains('expanded');
    if (!isCurrentlyExpanded && roomState.participants.length <= 1) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 16px;border-radius:20px;font-size:0.82rem;z-index:2000;pointer-events:none;';
        t.textContent = '💬 No one else is here yet — chat will appear when others join';
        document.body.appendChild(t);
        setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
        return;
    }
    const body = document.getElementById('chatBody');
    const icon = document.getElementById('chatToggleIcon');
    const isExpanded = panel.classList.toggle('expanded');
    body.style.display = isExpanded ? 'flex' : 'none';
    icon.textContent = isExpanded ? '▲' : '▼';

    const isMobile = window.innerWidth < 992;
    const basePad = isMobile ? '56px' : '48px';
    document.getElementById('roomLayout').style.paddingBottom = isExpanded ? '280px' : basePad;

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
    const analyticsBtn = document.getElementById('analytics-trigger-btn');
    if (analyticsBtn) analyticsBtn.style.display = roomState.history.length >= 2 ? '' : 'none';

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

async function importFromJira() {
    const s = typeof getJiraSettings === 'function' ? getJiraSettings() : {};
    const domain = (s.domain || '').trim();
    const email  = (s.email  || '').trim();
    const token  = (s.token  || '').trim();
    const jqlEl  = document.getElementById('jiraImportJql');
    const jql    = (jqlEl?.value || s.jql || '').trim();
    const creds  = document.getElementById('jiraImportCreds');
    const status = document.getElementById('jiraImportStatus');

    if (!domain || !email || !token) {
        if (creds) creds.style.display = '';
        return;
    }
    if (creds) creds.style.display = 'none';
    if (!jql) { if (status) status.textContent = '⚠️ Enter a JQL filter first'; return; }

    if (status) status.textContent = '⏳ Importing…';
    try {
        await connection.invoke('ImportFromJira', domain, email, token, jql);
        const details = document.getElementById('jiraImportDetails');
        if (details) details.removeAttribute('open');
    } catch(e) {
        if (status) status.textContent = `❌ ${e.message || 'Import failed'}`;
    }
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
    if (e.key === 'Enter' && !roomState.votesRevealed) { e.preventDefault(); revealVotes(); }
    if (e.code === 'KeyR' && !e.ctrlKey) resetVotes();
    if (e.code === 'KeyF') togglePresentationMode();
    if (e.code === 'KeyN') {
        e.preventDefault();
        const inp = document.getElementById('newStoryInput');
        if (inp) { inp.focus(); inp.select(); }
    }
    if (e.key === '?') {
        if (typeof openSettingsModal === 'function') openSettingsModal('about');
    }
    if (_kbShortcutsEnabled && !e.ctrlKey && !e.altKey) {
        // 0: select ☕ card
        if (e.code === 'Digit0') { _selectCardByValue('☕'); }
        // 1–9: select nth card by position
        const numMatch = e.code.match(/^Digit([1-9])$/);
        if (numMatch) {
            const idx = parseInt(numMatch[1], 10) - 1;
            const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
            if (idx < values.length) castVote(values[idx]);
        }
        // C → coffee, Q → question mark, - → skip vote
        if (e.code === 'KeyC') { e.preventDefault(); _selectCardByValue('☕'); }
        if (e.code === 'KeyQ') { e.preventDefault(); _selectCardByValue('?'); }
        if (e.code === 'Minus') { e.preventDefault(); _selectCardByValue('🚫'); }
    }
    // ← / , → previous card;  → / . → next card
    if ((e.key === 'ArrowLeft' || e.key === ',') && !e.ctrlKey && !e.altKey) { e.preventDefault(); _navigateCard(-1); }
    if ((e.key === 'ArrowRight' || e.key === '.') && !e.ctrlKey && !e.altKey) { e.preventDefault(); _navigateCard(1); }
});

function _navigateCard(dir) {
    const isObsMode = isObserver || roomState.participants.some(p => p.connectionId === connection?.connectionId && p.isGhost);
    if (isObsMode) return;
    const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
    const idx = selectedVote != null ? values.indexOf(selectedVote) : -1;
    const next = Math.max(0, Math.min(values.length - 1, idx + dir));
    castVote(values[next]);
}

function _selectCardByValue(val) {
    const values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
    if (values.includes(val)) castVote(val);
}

document.getElementById('newStoryInput').addEventListener('keypress', e => { if (e.key === 'Enter') addStory(); });
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });
initVibePanel();
loadKbSettings();
loadReactionSettings();
loadTimerClockSettings();
// X2: apply change-vote hint body class from saved setting
if (localStorage.getItem('es_changeVoteHint') !== '0') document.body.classList.add('show-change-hint');
if (typeof startSeasonalAmbience === 'function') startSeasonalAmbience();

// ============================================================
// Sound Preference Prompt (N5) — shown once per page load on room join
// ============================================================
function _promptSoundPreferenceOnce() {
    if (sessionStorage.getItem('es_soundAsked')) return;
    var muted = localStorage.getItem('audio-all-off') === 'true';
    if (muted) { sessionStorage.setItem('es_soundAsked','1'); return; }
    var anyOn = false;
    if (typeof getTimerAudioSettings === 'function') {
        var ta = getTimerAudioSettings();
        if (ta.theme && ta.theme !== 'silent') anyOn = true;
    }
    if (typeof getAmbientSettings === 'function') {
        var am = getAmbientSettings();
        if (am.source && am.source !== 'none') anyOn = true;
    }
    if (!anyOn) return;
    sessionStorage.setItem('es_soundAsked', '1');
    // If user saved a default choice, apply it silently without showing the modal
    var defaultChoice = localStorage.getItem('es_soundDefaultChoice');
    if (defaultChoice && typeof _applySoundChoice === 'function') {
        _applySoundChoice(defaultChoice);
        return;
    }
    var modalEl = document.getElementById('soundConfirmModal');
    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// ============================================================
// AC — Session Timer + Clock (AC1, AC2)
// ============================================================
var _acTimerStart = null;
var _acLastStoryId = null;

// AG3: Hook called by saveTimerClockSettings (site.js) to access room-internal timer vars
function _acOnTimerEnabled(showTimerEl) {
    if (showTimerEl && showTimerEl.checked && _acLastStoryId && !_acTimerStart) {
        _acTimerStart = Date.now();
    }
}
window._acOnTimerEnabled = _acOnTimerEnabled;

// AC2: one persistent tick interval drives both timer and clock
function loadTimerClockSettings() {
    setInterval(_acTick, 1000);
    _acTick();
    _addPanelCloseButtons();
}

// AE7: Add × close buttons to dismissable panels
function _addPanelCloseButtons() {
    var panels = [
        {
            id: 'vibeCheckPanel',
            hide: function() {
                localStorage.setItem('es_hideVibeCheck', '1');
            }
        },
        {
            id: 'keyboard-legend',
            hide: function() {
                localStorage.setItem('es_kbShortcuts', 'false');
                var cb = document.getElementById('kb-shortcuts-toggle');
                if (cb) cb.checked = false;
                if (typeof toggleKbShortcuts === 'function') toggleKbShortcuts(false);
            }
        },
        // session-tc-bar × button is baked directly into Index.cshtml HTML (panel-close-btn static)
    ];
    panels.forEach(function(p) {
        var panel = document.getElementById(p.id);
        if (!panel) return;
        if (panel.querySelector('.panel-close-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'panel-close-btn';
        btn.title = p.id === 'session-tc-bar'
            ? 'Hide until reload (use Settings to permanently disable)'
            : 'Hide this panel';
        btn.setAttribute('aria-label', 'Close panel');
        btn.innerHTML = '&times;';
        btn.onclick = function(e) {
            e.stopPropagation();
            panel.style.display = 'none';
            p.hide();
        };
        // Append at end; CSS handles positioning (float:right for block, order/margin for flex)
        panel.appendChild(btn);
    });
    // Respect saved vibe hide state
    if (localStorage.getItem('es_hideVibeCheck') === '1') {
        var vibe = document.getElementById('vibeCheckPanel');
        if (vibe) vibe.style.display = 'none';
    }
}

function acStartStoryTimer(storyId) {
    if (storyId && storyId === _acLastStoryId) return;
    _acLastStoryId = storyId || null;
    _acTimerStart = storyId ? Date.now() : null;
    _acTick();  // immediate refresh; persistent interval handles subsequent ticks
}

// AG1+AG2: saveTimerClockSettings and _tcToggleMode moved to site.js so they are
// available on all pages (not just the Room page). _acOnTimerEnabled below exposes
// the room-internal timer-start logic as a hook for site.js to call.

function _acTick() {
    var bar = document.getElementById('session-tc-bar');
    if (!bar) return;

    var showTimer = localStorage.getItem('es_showTimer') !== '0';
    var showClock = localStorage.getItem('es_showClock') !== '0';
    var hasStory  = !!_acLastStoryId;

    // AH9: per-segment session-hide (separate × for timer and clock)
    var sessionHideTimer = sessionStorage.getItem('es_hideTimer') === '1';
    var sessionHideClock = sessionStorage.getItem('es_hideClock') === '1';

    var timerActive  = showTimer && hasStory && !!_acTimerStart && !sessionHideTimer;
    var clockActive  = showClock && !sessionHideClock;

    // Hide whole bar if nothing will show
    if (!timerActive && !clockActive) { bar.style.display = 'none'; return; }
    // AH2: use explicit 'flex' — inline style overrides, no d-flex class needed
    bar.style.display = 'flex';

    // Timer segment (AI3: controlled via stc-timer-wrap container)
    var timerEl = document.getElementById('stc-timer');
    var timerWrap = document.getElementById('stc-timer-wrap');
    if (timerEl) {
        if (timerActive) {
            var elapsed = Math.floor((Date.now() - _acTimerStart) / 1000);
            var m = Math.floor(elapsed / 60), s = elapsed % 60;
            timerEl.textContent = '⏱ ' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
            if (typeof _applyTimerStyle === 'function') _applyTimerStyle(timerEl);  // AK6
            if (timerWrap) timerWrap.style.display = '';
        } else {
            if (timerWrap) timerWrap.style.display = 'none';
        }
    }

    // Separator — only show when both visible
    var sep = document.getElementById('stc-sep');
    if (sep) sep.style.display = (timerActive && clockActive) ? '' : 'none';

    // Clock segment (AI3: controlled via stc-clock-wrap container)
    var clockEl = document.getElementById('stc-clock');
    var clockWrap = document.getElementById('stc-clock-wrap');
    if (clockEl) {
        if (clockActive) {
            _acRenderClock(clockEl);
            if (clockWrap) clockWrap.style.display = '';
        } else {
            if (clockWrap) clockWrap.style.display = 'none';
        }
    }
}

function _acRenderClock(clockEl) {
    var tz = localStorage.getItem('es_clockTimezone') || '';
    var styleData = {};
    try { styleData = JSON.parse(localStorage.getItem('es_clockStyle') || '{}'); } catch(e) {}
    var mode = styleData.mode || 'digital';
    var now = new Date();

    if (mode === 'analog') {
        var sz = styleData.analogSize || 52;
        var existing = clockEl.querySelector('svg');
        if (!existing) {
            clockEl.innerHTML = _acAnalogSvgTemplate(sz);
        } else {
            // Update size if it changed
            existing.setAttribute('width', sz);
            existing.setAttribute('height', sz);
        }
        _acUpdateAnalogHands(clockEl, now, tz, styleData);
        clockEl.style.display = '';
        return;
    }

    // Digital
    clockEl.innerHTML = '';
    var options = { hour: '2-digit', minute: '2-digit', hour12: false };
    var tzName = '';
    if (tz) {
        options.timeZone = tz;
        try {
            var parts = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' }).formatToParts(now);
            var tzPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
            if (tzPart) tzName = ' ' + tzPart.value;
        } catch(e) {}
    }
    var timeStr = now.toLocaleTimeString([], options);
    clockEl.textContent = '🕐 ' + timeStr + tzName;
    var color = styleData.color || '';
    var size = styleData.fontSize ? styleData.fontSize + 'px' : '';
    clockEl.style.color = color;
    clockEl.style.fontSize = size;
    clockEl.style.display = '';
}

function _acAnalogSvgTemplate(sz) {
    // AF7: Use class instead of id to allow multiple analog clocks without duplicate HTML IDs
    var s = sz || 52;
    return '<svg class="ac-analog" width="' + s + '" height="' + s + '" viewBox="0 0 100 100">'
        + '<circle class="ac-face" cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>'
        + '<line class="ac-hour" x1="50" y1="50" x2="50" y2="28" stroke="#212529" stroke-width="5" stroke-linecap="round"/>'
        + '<line class="ac-min"  x1="50" y1="50" x2="50" y2="16" stroke="#495057" stroke-width="3" stroke-linecap="round"/>'
        + '<line class="ac-sec"  x1="50" y1="55" x2="50" y2="12" stroke="#dc3545" stroke-width="1.5" stroke-linecap="round"/>'
        + '<circle cx="50" cy="50" r="2.5" fill="currentColor"/>'
        + '</svg>';
}

function _acUpdateAnalogHands(container, now, tz, styleData) {
    var displayDate = now;
    if (tz) {
        try {
            var s = now.toLocaleString('en-US', { timeZone: tz });
            displayDate = new Date(s);
        } catch(e) {}
    }
    var sec = displayDate.getSeconds();
    var min = displayDate.getMinutes();
    var hr  = displayDate.getHours() % 12;
    var sDeg = sec * 6;
    var mDeg = min * 6 + sec * 0.1;
    var hDeg = hr * 30 + min * 0.5;
    var svg = container.querySelector('svg');
    if (!svg) return;
    // AF7: Use class selectors (not #id) to support multiple analog clocks on the same page
    var setRot = function(cls, deg) {
        var el = svg.querySelector('.' + cls);
        if (el) el.setAttribute('transform', 'rotate(' + deg + ',50,50)');
    };
    setRot('ac-hour', hDeg);
    setRot('ac-min',  mDeg);
    setRot('ac-sec',  sDeg);
    var face = svg.querySelector('.ac-face');
    var face_style = styleData.face || 'minimal';
    var NS = 'http://www.w3.org/2000/svg';
    if (face) {
        if (face_style === 'filled') {
            face.setAttribute('fill', '#fff');
            face.setAttribute('stroke', 'currentColor');
            face.setAttribute('stroke-width', '3');
        } else if (face_style === 'classic') {
            face.setAttribute('fill', 'none');
            face.setAttribute('stroke', 'currentColor');
            face.setAttribute('stroke-width', '2');
        } else { // minimal
            face.setAttribute('fill', 'none');
            face.setAttribute('stroke', 'none');
        }
    }
    // Add/refresh cardinal tick marks for classic and filled (removed for minimal)
    svg.querySelectorAll('.ac-tick').forEach(function(t) { t.parentNode.removeChild(t); });
    if (face_style !== 'minimal') {
        [[50,6],[94,50],[50,94],[6,50]].forEach(function(pt) {
            var tick = document.createElementNS(NS, 'circle');
            tick.setAttribute('class', 'ac-tick');
            tick.setAttribute('cx', pt[0]);
            tick.setAttribute('cy', pt[1]);
            tick.setAttribute('r', face_style === 'filled' ? '4' : '3');
            tick.setAttribute('fill', 'currentColor');
            svg.insertBefore(tick, svg.firstChild);
        });
    }
    var hour = svg.querySelector('.ac-hour'); if (hour && styleData.hourColor) hour.setAttribute('stroke', styleData.hourColor);
    var minH = svg.querySelector('.ac-min');  if (minH && styleData.minColor)  minH.setAttribute('stroke', styleData.minColor);
    var secH = svg.querySelector('.ac-sec');  if (secH && styleData.secColor)  secH.setAttribute('stroke', styleData.secColor);
}

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
    // Clear button — hidden until a vibe is cast
    const clearBtn = document.createElement('button');
    clearBtn.id = 'vibeClearBtn';
    clearBtn.className = 'btn btn-xs btn-outline-secondary ms-1 py-0 px-1 d-none';
    clearBtn.title = 'Clear vibe';
    clearBtn.textContent = '✕';
    clearBtn.onclick = () => { if (_myVibe) castVibeLocal(_myVibe); }; // toggle off
    container.appendChild(clearBtn);
}

function castVibeLocal(emoji) {
    const isDeselect = _myVibe === emoji;
    if (isDeselect) {
        _myVibe = null;
        document.querySelectorAll('.vibe-btn').forEach(b => b.classList.remove('vibe-selected'));
        connection.invoke('CastVibe', '').catch(e => console.error(e));
        const clr = document.getElementById('vibeClearBtn');
        if (clr) clr.classList.add('d-none');
        return;
    }
    _myVibe = emoji;
    document.querySelectorAll('.vibe-btn').forEach(b =>
        b.classList.toggle('vibe-selected', b.dataset.vibe === emoji));
    connection.invoke('CastVibe', emoji).catch(e => console.error(e));
    // Show clear button
    const clr = document.getElementById('vibeClearBtn');
    if (clr) clr.classList.remove('d-none');

    const btn = document.querySelector('.vibe-btn[data-vibe="' + emoji + '"]');
    if (btn) {
        const floater = document.createElement('div');
        floater.className = 'vibe-float-emoji';
        floater.textContent = emoji;
        const r = btn.getBoundingClientRect();
        floater.style.left = (r.left + r.width / 2 - 14) + 'px';
        floater.style.top  = (r.top - 10) + 'px';
        document.body.appendChild(floater);
        setTimeout(() => floater.remove(), 950);
    }
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
// P1 — Keyboard Shortcuts
// ============================================================
function loadKbSettings() {
    var v = localStorage.getItem('es_kbShortcuts');
    _kbShortcutsEnabled = (v === null) ? true : (v === 'true');
    var el = document.getElementById('kb-shortcuts-toggle');
    if (el) el.checked = _kbShortcutsEnabled;
    _updateKeyboardLegend();
}

function toggleKbShortcuts(enabled) {
    _kbShortcutsEnabled = enabled;
    localStorage.setItem('es_kbShortcuts', String(enabled));
    _updateKeyboardLegend();
}
window.toggleKbShortcuts = toggleKbShortcuts;

function _updateKeyboardLegend() {
    var legend = document.getElementById('keyboard-legend');
    if (!legend) return;
    if (!_kbShortcutsEnabled) { legend.style.display = 'none'; return; }
    var values = skipVoteEnabled ? [...currentEstimateValues, '🚫'] : currentEstimateValues;
    var parts = [];
    // AK: each entry = 3D keycap + plain value label beside it
    values.forEach(function(v, i) {
        if (i < 9) parts.push('<span class="kb-entry"><span class="kb-key">' + (i + 1) + '</span><span class="kb-val">' + escHtml(v) + '</span></span>');
    });
    if (values.includes('☕')) parts.push('<span class="kb-entry"><span class="kb-key">C</span><span class="kb-val">☕</span></span>');
    if (values.includes('?'))  parts.push('<span class="kb-entry"><span class="kb-key">Q</span><span class="kb-val">?</span></span>');
    if (values.includes('🚫')) parts.push('<span class="kb-entry"><span class="kb-key">−</span><span class="kb-val">🚫</span></span>');
    parts.push('<span class="kb-entry"><span class="kb-key">,</span><span class="kb-key">←</span><span class="kb-val">◄</span></span>');
    parts.push('<span class="kb-entry"><span class="kb-key">.</span><span class="kb-key">→</span><span class="kb-val">►</span></span>');
    legend.innerHTML = parts.join(' ');
    legend.style.display = '';
}

function _populateRoomOtherSettings() {
    var kbEl = document.getElementById('kb-shortcuts-toggle');
    if (kbEl) kbEl.checked = _kbShortcutsEnabled;
    var rEnEl = document.getElementById('reaction-enabled-toggle');
    if (rEnEl) rEnEl.checked = _reactionEnabled;
    var rPalEl = document.getElementById('reaction-palette-input');
    if (rPalEl) rPalEl.value = _reactionPalette.join(' ');
    // AG4: update reaction preview whenever the modal opens
    if (typeof _renderReactionPreview === 'function') _renderReactionPreview();

    // AC4: populate timer/clock form
    var showTimerEl = document.getElementById('tc-show-timer');
    if (showTimerEl) showTimerEl.checked = localStorage.getItem('es_showTimer') !== '0';
    var showClockEl = document.getElementById('tc-show-clock');
    if (showClockEl) showClockEl.checked = localStorage.getItem('es_showClock') !== '0';
    var tzEl = document.getElementById('tc-timezone');
    if (tzEl) tzEl.value = localStorage.getItem('es_clockTimezone') || '';

    var styleData = {};
    try { styleData = JSON.parse(localStorage.getItem('es_clockStyle') || '{}'); } catch(e) {}
    var mode = styleData.mode || 'digital';
    var modeRadio = document.querySelector('input[name="tc-mode"][value="' + mode + '"]');
    if (modeRadio) modeRadio.checked = true;
    _tcToggleMode(mode);

    var colorEl = document.getElementById('tc-color');
    if (colorEl) colorEl.value = styleData.color || '#6c757d';
    var fsEl = document.getElementById('tc-font-size');
    if (fsEl) fsEl.value = styleData.fontSize || 13;
    var faceEl = document.getElementById('tc-face');
    if (faceEl) faceEl.value = styleData.face || 'minimal';
    var hourEl = document.getElementById('tc-hour-color');
    if (hourEl) hourEl.value = styleData.hourColor || '#212529';
    var minEl = document.getElementById('tc-min-color');
    if (minEl) minEl.value = styleData.minColor || '#495057';
    var secEl = document.getElementById('tc-sec-color');
    if (secEl) secEl.value = styleData.secColor || '#dc3545';
    var analogSizeEl = document.getElementById('tc-analog-size');
    if (analogSizeEl) analogSizeEl.value = styleData.analogSize || 52;
    var prev = document.getElementById('tc-clock-preview');
    if (prev) _acRenderClock(prev);

    // AK6: populate count-up timer style controls + preview
    var tStyle = (typeof _getTimerStyle === 'function') ? _getTimerStyle() : {};
    var tColEl = document.getElementById('tc-timer-color');
    if (tColEl) tColEl.value = tStyle.color || '#6c757d';
    var tSizeEl = document.getElementById('tc-timer-size');
    if (tSizeEl) tSizeEl.value = tStyle.fontSize || 13;
    var tFontEl = document.getElementById('tc-timer-font');
    if (tFontEl) tFontEl.value = tStyle.fontFamily || '';
    if (typeof _applyTimerStyle === 'function') _applyTimerStyle(document.getElementById('tc-timer-preview'), tStyle);
}
window._populateRoomOtherSettings = _populateRoomOtherSettings;

// ============================================================
// P2 — Emoji Reactions
// ============================================================
function loadReactionSettings() {
    var v = localStorage.getItem('es_reactionEnabled');
    _reactionEnabled = (v === null) ? true : (v === 'true');
    try {
        var p = JSON.parse(localStorage.getItem('es_reactionPalette') || 'null');
        if (Array.isArray(p) && p.length > 0) _reactionPalette = p.slice(0, 8);
    } catch(e) {}
    initReactionPanel();
}

function saveReactionSettings() {
    var rEnEl = document.getElementById('reaction-enabled-toggle');
    if (rEnEl) {
        _reactionEnabled = rEnEl.checked;
        localStorage.setItem('es_reactionEnabled', String(_reactionEnabled));
        // AH10: clear session-hide when user explicitly re-enables reactions
        if (_reactionEnabled) sessionStorage.removeItem('es_hideReactions');
    }
    var rPalEl = document.getElementById('reaction-palette-input');
    if (rPalEl) {
        var parts = rPalEl.value.split(/\s+/).filter(Boolean).slice(0, 8);
        _reactionPalette = parts.length > 0 ? parts : [...REACTION_DEFAULT_PALETTE];
        localStorage.setItem('es_reactionPalette', JSON.stringify(_reactionPalette));
    }
    initReactionPanel();
}
window.saveReactionSettings = saveReactionSettings;

function initReactionPanel() {
    var panel = document.getElementById('reactionPanel');
    if (!panel) return;
    panel.innerHTML = '';
    // AH10: respect session-hide flag
    if (!_reactionEnabled || sessionStorage.getItem('es_hideReactions') === '1') {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    // AH10: close button (session-only hide)
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'panel-close-btn';
    closeBtn.title = 'Hide until reload';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function(e) {
        e.stopPropagation();
        sessionStorage.setItem('es_hideReactions', '1');
        panel.style.display = 'none';
    };
    panel.style.position = 'relative';
    panel.appendChild(closeBtn);
    _reactionPalette.forEach(function(emoji) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reaction-btn';
        btn.title = 'React: ' + emoji;
        btn.textContent = emoji;
        btn.onclick = function() { castReaction(emoji); };
        panel.appendChild(btn);
    });
}

async function castReaction(emoji) {
    var now = Date.now();
    if (now - _reactionLastMs < REACTION_RATE_LIMIT_MS) return;
    _reactionLastMs = now;
    try { await connection.invoke('SendReaction', emoji); } catch(e) { console.error(e); }
}

function _reactionFloatFromBadge(senderCid, emoji) {
    var badge = document.querySelector('[data-connection-id="' + senderCid + '"]');
    var x, y;
    if (badge) {
        var r = badge.getBoundingClientRect();
        x = r.left + r.width / 2 - 16;
        y = r.top - 10;
    } else {
        x = window.innerWidth / 2 - 16;
        y = window.innerHeight * 0.6;
    }
    var floater = document.createElement('div');
    floater.className = 'reaction-float';
    floater.textContent = emoji;
    floater.style.left = x + 'px';
    floater.style.top  = y + 'px';
    document.body.appendChild(floater);
    setTimeout(function() { floater.remove(); }, 1400);
}

// ============================================================
// Q1 — Vote Cast Tick
// ============================================================
function _qPlayVoteTick() {
    if (getAllSoundsOff && getAllSoundsOff()) return;
    if (localStorage.getItem('es_voteTick') !== '1') return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.09);
        osc.onended = function() { ctx.close(); };
    } catch(e) {}
}

// ============================================================
// Q2 — Desktop Notification on Reveal
// ============================================================
async function _qRequestNotifyPermission(enabled) {
    if (!enabled) return;
    if (!('Notification' in window)) { alert('Your browser does not support desktop notifications.'); return; }
    if (Notification.permission !== 'granted') {
        var result = await Notification.requestPermission();
        if (result !== 'granted') {
            var el = document.getElementById('desktop-notify-enabled');
            if (el) { el.checked = false; localStorage.setItem('es_desktopNotify', '0'); }
        }
    }
}
window._qRequestNotifyPermission = _qRequestNotifyPermission;

function _qTryDesktopNotify(stats) {
    if (localStorage.getItem('es_desktopNotify') !== '1') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;   // only fire when user is in another tab
    var msg = (stats && stats.isConsensus) ? '🎉 Consensus!' : 'Votes revealed';
    if (stats && stats.average != null) msg += ' · Avg: ' + stats.average;
    new Notification('EstimationStation', { body: msg, icon: '/favicon.ico', tag: 'es-reveal' });
}

// ============================================================
// Sequential Reveal (Poker Hand)
// ============================================================
function _sequentialReveal(votes, stats) {
    const cs = typeof getCelebrationSettings === 'function' ? getCelebrationSettings() : {};
    const useSuspense  = cs.suspenseReveal !== false;
    // N3: room-level setting takes precedence over per-client preference
    const useOrdering  = roomState.revealMajorityFirst !== false;

    // Build base order (vote-cast order, then any remaining)
    const base = _roundVoteOrder.slice();
    roomState.participants.forEach(p => {
        if (votes[p.connectionId] && !base.includes(p.connectionId)) base.push(p.connectionId);
    });
    const voters = base.filter(cid => votes[cid] != null);

    // Consensus ordering: majority first, outlier last (extra pause)
    let revealOrder = voters;
    const outlierId = (useOrdering && stats && !stats.isConsensus) ? stats.shameParticipantId : null;
    if (outlierId && voters.includes(outlierId)) {
        revealOrder = [...voters.filter(cid => cid !== outlierId), outlierId];
    }

    // Render with votes hidden
    roomState.votesRevealed = false;
    renderParticipants();
    roomState.votesRevealed = true;

    // Timing config
    const speeds   = { fast: 500, normal: 800, dramatic: 1300 };
    const slotMs   = useSuspense ? (speeds[cs.suspenseSpeed || 'normal'] || 800) : 0;
    const flipGap  = cs.revealFlipGap || 380;
    const outlierPause = outlierId ? 700 : 0;

    revealOrder.forEach((cid, i) => {
        const isOutlier = cid === outlierId;
        // Outlier gets the extra dramatic pause before its flip
        const delay = i * flipGap + (isOutlier ? outlierPause : 0);

        setTimeout(() => {
            const badge = document.querySelector('[data-connection-id="' + cid + '"]');
            if (!badge) return;
            badge.classList.add('poker-flip');

            if (useSuspense && votes[cid]) {
                _slotMachineReveal(badge, votes[cid], slotMs, () => {
                    badge.classList.remove('poker-flip');
                    _emitRevealParticles(badge, cs);
                });
            } else {
                setTimeout(() => {
                    badge.classList.remove('poker-flip');
                    const voteSpan = badge.querySelector('.vote-hidden, .vote-waiting');
                    if (voteSpan && votes[cid]) {
                        voteSpan.className = 'participant-vote';
                        voteSpan.textContent = votes[cid];
                    }
                    _emitRevealParticles(badge, cs);
                }, 225);
            }
        }, delay);
    });

    // Supernova fires after all cards have landed
    if (stats && stats.isConsensus && cs.consensusSupernova !== false) {
        const totalMs = revealOrder.length * flipGap + slotMs + 300;
        setTimeout(() => {
            if (typeof triggerConsensusSupernova === 'function') triggerConsensusSupernova();
        }, totalMs);
    }
}

function _slotMachineReveal(badge, finalValue, duration, onComplete) {
    const voteSpan = badge.querySelector('.vote-hidden, .vote-waiting, .participant-vote');
    if (!voteSpan) { if (onComplete) onComplete(); return; }

    voteSpan.className = 'participant-vote slot-cycling';
    const pool = currentEstimateValues.length > 1 ? currentEstimateValues : ['1','2','3','5','8','13'];
    const totalCycles = Math.max(8, Math.round(duration / 75));
    let cycle = 0;

    const tick = () => {
        cycle++;
        if (cycle >= totalCycles) {
            voteSpan.textContent = finalValue;
            voteSpan.className   = 'participant-vote slot-landed';
            setTimeout(() => {
                voteSpan.classList.remove('slot-landed');
                if (onComplete) onComplete();
            }, 160);
            return;
        }
        voteSpan.textContent = pool[Math.floor(Math.random() * pool.length)];
        // Ease-out: starts at ~50ms, slows to ~250ms near the end
        const t = cycle / totalCycles;
        const delay = 50 + t * t * 250;
        setTimeout(tick, delay);
    };
    tick();
}

function _emitRevealParticles(badge, cs) {
    if (cs.revealParticles !== false && typeof confetti !== 'undefined') {
        const r = badge.getBoundingClientRect();
        const type = cs.revealParticleType || 'star';
        // O5: resolve shapes — mixed uses all 3 built-ins; emoji uses shapeFromText
        let shapes;
        if (typeof _resolveParticleShapes === 'function') {
            shapes = _resolveParticleShapes(type, cs.revealParticleEmoji);
        } else if (type === 'mixed') {
            shapes = ['star', 'circle', 'square'];
        } else {
            shapes = [type === 'emoji' ? 'star' : type];
        }
        confetti({
            particleCount: cs.revealParticleCount || 8,
            spread: 50,
            startVelocity: 18,
            decay: 0.88,
            scalar: type === 'emoji' ? 2 : 1,
            origin: {
                x: (r.left + r.width / 2) / window.innerWidth,
                y: (r.top  + r.height / 2) / window.innerHeight
            },
            shapes: shapes,
            colors: ['#ffd700', '#ff6b6b', '#00ff88', '#ffffff', '#00cfff']
        });
    }
}

// ============================================================
// Confidence Indicator
// ============================================================
function castConfidence(level) {
    connection.invoke('CastConfidence', level).catch(() => {});
    _updateConfidenceUI(level);
}

function _updateConfidenceUI(level) {
    document.querySelectorAll('#confidenceSelector .conf-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i < level);
    });
}

// ============================================================
// Sound receive settings
// ============================================================
var _SOUND_RECEIVE_KEY = 'es_soundReceiveSettings';
function _getSoundReceiveSettings() {
    try { return Object.assign({ receive: true, subtitle: true }, JSON.parse(localStorage.getItem(_SOUND_RECEIVE_KEY) || '{}')); }
    catch(e) { return { receive: true, subtitle: true }; }
}
function saveSoundReceiveSettings() {
    var recv = document.getElementById('sound-receive-enabled');
    var sub  = document.getElementById('sound-show-subtitle');
    localStorage.setItem(_SOUND_RECEIVE_KEY, JSON.stringify({
        receive:  !!(recv && recv.checked),
        subtitle: !!(sub  && sub.checked)
    }));
    var subWrap = document.getElementById('sound-subtitle-wrap');
    if (subWrap) subWrap.style.display = (recv && recv.checked) ? 'none' : '';
}
function populateSoundReceiveSection() {
    var s = _getSoundReceiveSettings();
    var recv = document.getElementById('sound-receive-enabled');
    if (recv) recv.checked = s.receive !== false;
    var sub = document.getElementById('sound-show-subtitle');
    if (sub) sub.checked = s.subtitle !== false;
    var subWrap = document.getElementById('sound-subtitle-wrap');
    if (subWrap) subWrap.style.display = s.receive !== false ? 'none' : '';
}
function _showSoundSubtitle(soundId, senderName) {
    var icons = { bell: '🔔', fanfare: '🎉', drumroll: '🥁', airhorn: '📯' };
    var icon = icons[soundId] || (soundId.startsWith('custom:') ? '🎵' : '🔊');
    var label = soundId.startsWith('custom:') ? soundId.slice(7) : (soundId.charAt(0).toUpperCase() + soundId.slice(1));
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);'
        + 'background:rgba(30,30,30,0.88);color:#fff;padding:6px 16px;border-radius:20px;'
        + 'font-size:0.85rem;z-index:9000;pointer-events:none;white-space:nowrap;'
        + 'animation:sea-popup-in 0.3s ease-out forwards;';
    toast.textContent = icon + ' ' + senderName + ' played ' + label;
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2800);
}

// ============================================================
// Custom Sounds
// ============================================================
var _customSounds = {};
var _CUSTOM_SOUNDS_KEY = 'es_customSounds';

function _loadCustomSounds() {
    try { _customSounds = JSON.parse(localStorage.getItem(_CUSTOM_SOUNDS_KEY) || '{}'); } catch(e) { _customSounds = {}; }
}
function _saveCustomSounds() {
    try { localStorage.setItem(_CUSTOM_SOUNDS_KEY, JSON.stringify(_customSounds)); } catch(e) {}
}

function addCustomSoundSlot() {
    var list = document.getElementById('custom-sounds-list');
    if (!list) return;
    var existing = list.querySelectorAll('.custom-sound-slot').length;
    if (existing >= 3) return;
    var slotId = 'custom' + (existing + 1);
    var slot = document.createElement('div');
    slot.className = 'custom-sound-slot d-flex align-items-center gap-2 mt-2';
    slot.dataset.slotId = slotId;
    var saved = _customSounds[slotId];
    slot.innerHTML = '<span class="small text-muted" style="min-width:60px;">' + slotId + '</span>'
        + (saved ? '<span class="small text-success">✓ ' + (saved.label || slotId) + '</span>' : '<span class="small text-muted">No file</span>')
        + '<input type="file" accept="audio/*" style="display:none;" />'
        + '<button type="button" class="btn btn-outline-secondary btn-sm" style="font-size:0.7rem;padding:1px 7px;">📂 Choose</button>'
        + (saved ? '<button type="button" class="btn btn-outline-primary btn-sm" style="font-size:0.7rem;padding:1px 7px;" onclick="playCustomSoundLocal(\'' + slotId + '\')">▶ Play</button>'
                 + '<button type="button" class="btn btn-outline-success btn-sm" style="font-size:0.7rem;padding:1px 7px;" onclick="broadcastCustomSound(\'' + slotId + '\')">📡 Broadcast</button>' : '')
        + (saved ? '<button type="button" class="btn btn-outline-danger btn-sm" style="font-size:0.7rem;padding:1px 7px;" onclick="removeCustomSound(\'' + slotId + '\')">✕</button>' : '');
    var fileInput = slot.querySelector('input[type=file]');
    var chooseBtn = slot.querySelector('button');
    chooseBtn.onclick = function() { fileInput.click(); };
    fileInput.onchange = function() {
        var file = fileInput.files[0];
        if (!file) return;
        if (file.size > 600_000) { alert('File too large (max ~600KB). Please use a shorter clip.'); return; }
        var reader = new FileReader();
        reader.onload = function(ev) {
            var base64 = ev.target.result;
            _validateAudioDuration(base64, function(ok, dur) {
                if (!ok) { alert('Audio too long (' + Math.round(dur) + 's). Max 5 seconds.'); return; }
                var label = file.name.replace(/\.[^.]+$/, '').slice(0, 20);
                _customSounds[slotId] = { label: label, data: base64 };
                _saveCustomSounds();
                renderCustomSoundSlots();
            });
        };
        reader.readAsDataURL(file);
    };
    list.appendChild(slot);
}
function renderCustomSoundSlots() {
    var list = document.getElementById('custom-sounds-list');
    if (!list) return;
    list.innerHTML = '';
    _loadCustomSounds();
    var keys = Object.keys(_customSounds);
    for (var i = 0; i < Math.max(keys.length, 0); i++) {
        var slotId = 'custom' + (i + 1);
        if (!_customSounds[slotId]) continue;
        var saved = _customSounds[slotId];
        var slot = document.createElement('div');
        slot.className = 'custom-sound-slot d-flex align-items-center gap-2 mt-2';
        slot.dataset.slotId = slotId;
        var sid = slotId;
        slot.innerHTML = '<span class="small text-muted" style="min-width:60px;">' + sid + '</span>'
            + '<span class="small text-success flex-grow-1">✓ ' + (saved.label || sid) + '</span>'
            + '<button type="button" class="btn btn-outline-primary btn-sm" style="font-size:0.7rem;padding:1px 7px;">▶ Play</button>'
            + '<button type="button" class="btn btn-outline-success btn-sm" style="font-size:0.7rem;padding:1px 7px;">📡 Broadcast</button>'
            + '<button type="button" class="btn btn-outline-danger btn-sm" style="font-size:0.7rem;padding:1px 7px;">✕</button>';
        (function(s) {
            slot.querySelectorAll('button')[0].onclick = function() { playCustomSoundLocal(s); };
            slot.querySelectorAll('button')[1].onclick = function() { broadcastCustomSound(s); };
            slot.querySelectorAll('button')[2].onclick = function() { removeCustomSound(s); };
        })(sid);
        list.appendChild(slot);
    }
    var addBtn = document.getElementById('custom-sound-add-btn');
    if (addBtn) addBtn.style.display = keys.length >= 3 ? 'none' : '';
}
function playCustomSoundLocal(slotId) {
    var s = _customSounds[slotId];
    if (!s || !s.data) return;
    try { new Audio(s.data).play().catch(() => {}); } catch(e) {}
}
function broadcastCustomSound(slotId) {
    var s = _customSounds[slotId];
    if (!s || !s.data) return;
    try { new Audio(s.data).play().catch(() => {}); } catch(e) {}
    if (typeof connection !== 'undefined' && connection.state === 'Connected') {
        connection.invoke('TriggerCustomSound', s.data, s.label || slotId).catch(() => {});
    }
}
function removeCustomSound(slotId) {
    delete _customSounds[slotId];
    // Re-pack to keep keys contiguous
    var vals = Object.values(_customSounds);
    _customSounds = {};
    vals.forEach(function(v, i) { _customSounds['custom' + (i + 1)] = v; });
    _saveCustomSounds();
    renderCustomSoundSlots();
}
function _validateAudioDuration(base64, cb) {
    try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) { cb(true, 0); return; }
        var ctx = new AudioCtx();
        // Convert base64 data URL to ArrayBuffer
        var parts = base64.split(',');
        var raw = atob(parts[1]);
        var buf = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        ctx.decodeAudioData(buf.buffer, function(decoded) {
            ctx.close();
            cb(decoded.duration <= 5, decoded.duration);
        }, function() { ctx.close(); cb(true, 0); });
    } catch(e) { cb(true, 0); }
}

// ============================================================
// Soundboard
// ============================================================
function playSound(soundId) {
    _playSoundLocal(soundId);
    const broadcast = document.getElementById('soundBroadcastCheck');
    if (broadcast && broadcast.checked) {
        connection.invoke('TriggerSound', soundId).catch(() => {});
    }
}

function _playSoundLocal(soundId) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        switch (soundId) {
            case 'fanfare':   _soundFanfare(ctx);  break;
            case 'drumroll':  _soundDrumroll(ctx); break;
            case 'bell':      _soundBell(ctx);     break;
            case 'airhorn':   _soundAirhorn(ctx);  break;
        }
        setTimeout(() => ctx.close(), 2500);
    } catch (e) {}
}

function _soundBell(ctx) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.2);
}

function _soundFanfare(ctx) {
    [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        const t = ctx.currentTime + i * 0.13;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t); osc.stop(t + 0.35);
    });
}

function _soundDrumroll(ctx) {
    for (let i = 0; i < 14; i++) {
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let j = 0; j < data.length; j++) data[j] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        src.buffer = buf;
        src.connect(gain); gain.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.07;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.start(t); src.stop(t + 0.04);
    }
}

function _soundAirhorn(ctx) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(85, ctx.currentTime + 0.7);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.75);
}

// ============================================================
// Test helpers (settings modal) — room-specific only
// Generic test functions (testHotCold, testVoteDist, etc.) live in site.js
// ============================================================
function testConfidenceIndicator() {
    var sel = document.getElementById('confidenceSelector');
    if (!sel) return;
    var orig = sel.style.cssText;
    sel.style.cssText = 'display:block;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2000;';
    setTimeout(function() { sel.style.cssText = orig; sel.style.display = 'none'; }, 3000);
}

function testSoundboard() {
    _playSoundLocal('bell');
    setTimeout(function() { _playSoundLocal('fanfare'); }, 800);
    setTimeout(function() { _playSoundLocal('drumroll'); }, 1600);
}

// ============================================================
// V1: Sidebar resize handle
// ============================================================
(function() {
    var handle = document.getElementById('sidebar-resize-handle');
    if (!handle) return;
    var dragging = false, startX, startW;
    var panel = document.getElementById('storiesPanel');
    var MIN_W = 80, NARROW_THRESHOLD = 160;
    function maxW() { return Math.floor(window.innerWidth * 0.4); }
    function applyWidth(w) {
        document.documentElement.style.setProperty('--sidebar-width', w + 'px');
        var storiesPanel = document.querySelector('.stories-panel');
        if (storiesPanel) storiesPanel.classList.toggle('narrow', w < NARROW_THRESHOLD);
    }
    handle.addEventListener('mousedown', function(e) {
        dragging = true; startX = e.clientX; startW = panel.offsetWidth;
        document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var w = Math.max(MIN_W, Math.min(maxW(), startW + (e.clientX - startX)));
        applyWidth(w);
    });
    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = ''; document.body.style.userSelect = '';
        var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
        if (w >= MIN_W) localStorage.setItem('es_sidebarWidth', w);
    });
    var saved = parseInt(localStorage.getItem('es_sidebarWidth'));
    if (saved >= MIN_W) applyWidth(saved);
})();

// ============================================================
// AK1: Controls panel collapse/expand (persisted)
// ============================================================
function _setControlsCollapsed(collapsed) {
    var panel = document.querySelector('.controls-panel');
    var layout = document.getElementById('roomLayout');
    if (panel) panel.classList.toggle('collapsed', collapsed);
    if (layout) layout.classList.toggle('controls-collapsed', collapsed);
    var icon = document.getElementById('controlsToggleIcon');
    if (icon) icon.textContent = collapsed ? '⟨' : '⟩';
}
function toggleControlsPanel() {
    var panel = document.querySelector('.controls-panel');
    var collapsed = panel ? !panel.classList.contains('collapsed') : true;
    _setControlsCollapsed(collapsed);
    localStorage.setItem('es_controlsPanelCollapsed', collapsed ? '1' : '0');
}
(function() {
    if (localStorage.getItem('es_controlsPanelCollapsed') === '1') _setControlsCollapsed(true);
})();

// ============================================================
// AD — Host + Settings Lock + Participant Messaging
// ============================================================

// AD1/AD2 — Apply host-awareness and lock-mode UI
function _applyHostLockUI() {
    var lockMode = roomState.settingsLockMode;
    var isHost = roomState.isHost;

    // Host-only elements (lock selector)
    document.querySelectorAll('[data-host-only]').forEach(function(el) {
        el.style.display = isHost ? '' : 'none';
    });

    // Sync host lock selector value
    var sel = document.getElementById('settingsLockSelect');
    if (sel && sel.value !== lockMode) sel.value = lockMode;

    // Room-setting containers: hide in 'hidden' mode; disable in 'hostonly' mode
    document.querySelectorAll('[data-room-setting]').forEach(function(container) {
        if (lockMode === 'hidden' && !isHost) {
            container.style.display = 'none';
            return;
        }
        container.style.display = '';
        var canEdit = isHost || lockMode === 'none' || lockMode === 'ask';
        // Apply disabled to any interactive child elements
        container.querySelectorAll('input, select, button').forEach(function(ctrl) {
            if (canEdit) { ctrl.removeAttribute('disabled'); }
            else { ctrl.setAttribute('disabled', 'disabled'); }
        });
        // Also handle when the container itself is a button
        if (container.tagName === 'BUTTON' || container.tagName === 'INPUT' || container.tagName === 'SELECT') {
            if (canEdit) { container.removeAttribute('disabled'); }
            else { container.setAttribute('disabled', 'disabled'); }
        }
        container.classList.toggle('room-setting-locked', !canEdit);
    });

    // Update host crown on participant badges
    document.querySelectorAll('.participant-badge[data-connection-id]').forEach(function(badge) {
        badge.classList.toggle('is-host', badge.dataset.connectionId === roomState.hostConnectionId);
    });
}

// AD2 — Set settings lock mode (host-only, called from settings UI)
async function setSettingsLock(mode) {
    try { await connection.invoke('SetSettingsLock', mode); } catch(e) { console.error(e); }
}

// AD1 — Transfer host to another participant (host-only)
async function transferHost(targetConnectionId) {
    try { await connection.invoke('TransferHost', targetConnectionId); } catch(e) { console.error(e); }
}

// AD3 — Gate room-setting invocations through the lock mode
async function _invokeRoomSetting(settingKey, valueJson, directInvokeFn) {
    if (roomState.isHost || roomState.settingsLockMode === 'none') {
        try { await directInvokeFn(); } catch(e) { console.error(e); }
        return;
    }
    if (roomState.settingsLockMode === 'ask') {
        try {
            await connection.invoke('RequestSettingChange', settingKey, valueJson);
            _showToastAD('⏳ Request sent to host for approval', 'info');
        } catch(e) { console.error(e); }
        return;
    }
    // hostonly / hidden — should be disabled in UI, but guard defensively
    _showToastAD('🔒 Only the host can change room settings', 'warning');
}

// AD3 — Host approval toast (shown to host when a non-host requests a change)
function _showHostApprovalToast(requestId, requesterName, settingLabel) {
    var toast = document.createElement('div');
    toast.className = 'host-approval-toast';
    toast.dataset.requestId = requestId;
    toast.innerHTML =
        '<div style="margin-bottom:6px"><strong>' + escHtml(requesterName) + '</strong> wants to change <em>' + escHtml(settingLabel) + '</em></div>' +
        '<div class="d-flex gap-2">' +
        '<button class="btn btn-xs btn-success py-0" onclick="_approveSettingChange(\'' + requestId + '\',true)">✅ Approve</button>' +
        '<button class="btn btn-xs btn-danger py-0" onclick="_approveSettingChange(\'' + requestId + '\',false)">❌ Deny</button>' +
        '</div>';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 30000);
}
async function _approveSettingChange(requestId, approved) {
    try {
        await connection.invoke('ApproveSettingChange', requestId, approved);
        document.querySelectorAll('.host-approval-toast[data-request-id="' + requestId + '"]')
            .forEach(function(t) { t.remove(); });
    } catch(e) { console.error(e); }
}

// AD5 — Room creation setup prompt (shown to host when alone in room)
function _showHostSetupPrompt() {
    if (roomState.settingsLockMode && roomState.settingsLockMode !== 'none') return;
    if (document.getElementById('host-setup-modal')) return; // already shown
    var modal = document.createElement('div');
    modal.id = 'host-setup-modal';
    modal.className = 'host-setup-modal-backdrop';
    modal.innerHTML =
        '<div class="host-setup-modal-box">' +
        '<div class="host-setup-title">👑 You\'re the host!</div>' +
        '<p class="host-setup-desc">Choose how other participants can change room settings (estimate set, auto-reveal, ghost mode, etc.)</p>' +
        '<div class="host-setup-options">' +
        '<button class="host-setup-opt" onclick="_applyHostSetup(\'none\')">🔓 <strong>No Lock</strong><br><small>Anyone can change room settings</small></button>' +
        '<button class="host-setup-opt" onclick="_applyHostSetup(\'ask\')">🙋 <strong>Ask First</strong><br><small>Changes need your approval</small></button>' +
        '<button class="host-setup-opt" onclick="_applyHostSetup(\'hostonly\')">🔒 <strong>Host Only</strong><br><small>Others see settings but can\'t change</small></button>' +
        '<button class="host-setup-opt" onclick="_applyHostSetup(\'hidden\')">🙈 <strong>Hidden</strong><br><small>Only you see room settings</small></button>' +
        '</div>' +
        '<button class="host-setup-skip" onclick="_applyHostSetup(\'none\')">Skip (No Lock)</button>' +
        '</div>';
    document.body.appendChild(modal);
}
async function _applyHostSetup(mode) {
    var modal = document.getElementById('host-setup-modal');
    if (modal) modal.remove();
    await setSettingsLock(mode);
}

// AD6 — Participant right-click context menu
function _showParticipantContextMenu(e, connectionId, name) {
    e.preventDefault();
    _closeParticipantCtxMenu();

    var items = [];
    if (roomState.isHost && connectionId !== myConnectionId) {
        items.push({ label: '👑 Transfer Host', action: function() { transferHost(connectionId); } });
        items.push({ label: '🚷 Remove from room', action: function() { kickParticipant(connectionId, name); } });
        items.push({ type: 'sep' });
    }
    items.push({ label: '📨 Private Message', action: function() { _openPrivateMessageInput(connectionId, name); } });
    items.push({ label: '😄 Send Emoji',      action: function() { _openEmojiSendPicker(connectionId, name); } });
    items.push({ label: '🔊 Send Sound',      action: function() { _openSoundSendMenu(connectionId, name); } });
    if (connectionId !== myConnectionId) {
        items.push({ type: 'sep' });
        items.push({ label: '🚪 Ask if still here', action: function() { askParticipantLeave(connectionId, name); } });
    }

    var menu = document.createElement('ul');
    menu.id = 'participant-ctx-menu';
    menu.className = 'participant-context-menu';
    items.forEach(function(item) {
        var li = document.createElement('li');
        if (item.type === 'sep') {
            li.className = 'ctx-sep';
        } else {
            li.textContent = item.label;
            li.addEventListener('click', function() { _closeParticipantCtxMenu(); item.action(); });
        }
        menu.appendChild(li);
    });
    document.body.appendChild(menu);

    // Position near cursor, keep in viewport
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';

    setTimeout(function() {
        document.addEventListener('click', _closeParticipantCtxMenu, { once: true });
    }, 0);
}
function _closeParticipantCtxMenu() {
    var m = document.getElementById('participant-ctx-menu');
    if (m) m.remove();
}

// ============================================================
// Remove-user flow (host kick / "ask to leave" / idle handled server-side)
// ============================================================

// Host-only: immediately remove a participant (with a quick confirm to avoid misclicks).
async function kickParticipant(connectionId, name) {
    if (!roomState.isHost) return;
    if (!confirm('Remove ' + (name || 'this participant') + ' from the room?')) return;
    try { await connection.invoke('RemoveParticipant', connectionId); } catch (e) { console.error(e); }
}

// Anyone: ping a participant asking if they're still there.
async function askParticipantLeave(connectionId, name) {
    try { await connection.invoke('RequestLeave', connectionId); } catch (e) { console.error(e); }
}

// Shown to the target of a leave request. Yes -> leave, No -> stay; if they don't answer before
// the countdown ends, the server removes them (or transfers host if they are the host).
function _showLeaveRequestDialog(requestId, requesterName, timeoutSeconds) {
    _closeLeaveRequestDialog();
    var secs = timeoutSeconds || 60;
    var backdrop = document.createElement('div');
    backdrop.id = 'leave-request-modal';
    backdrop.className = 'host-setup-modal-backdrop';
    backdrop.innerHTML =
        '<div class="host-setup-modal-box" style="max-width:380px;">' +
        '<div class="host-setup-title">🚪 Are you still there?</div>' +
        '<p class="host-setup-desc"><strong>' + escHtml(requesterName) + '</strong> asked if you want to leave the room.<br>' +
        'Do you want to leave?</p>' +
        '<div class="d-flex gap-2 justify-content-center mb-2">' +
        '<button class="btn btn-danger" onclick="_respondLeave(\'' + requestId + '\', true)">🚪 Yes, leave</button>' +
        '<button class="btn btn-success" onclick="_respondLeave(\'' + requestId + '\', false)">✋ No, I\'m staying</button>' +
        '</div>' +
        '<div class="small text-muted">Auto-removed in <strong id="leave-countdown">' + secs + '</strong>s if you don\'t respond.</div>' +
        '</div>';
    document.body.appendChild(backdrop);

    var remaining = secs;
    backdrop._timer = setInterval(function () {
        remaining--;
        var el = document.getElementById('leave-countdown');
        if (el) el.textContent = Math.max(0, remaining);
        if (remaining <= 0) { _closeLeaveRequestDialog(); } // server removes us shortly after
    }, 1000);
}

function _closeLeaveRequestDialog() {
    var m = document.getElementById('leave-request-modal');
    if (!m) return;
    if (m._timer) clearInterval(m._timer);
    m.remove();
}

async function _respondLeave(requestId, willLeave) {
    _closeLeaveRequestDialog();
    try { await connection.invoke('RespondLeave', requestId, willLeave); } catch (e) { console.error(e); }
}

// We were removed (kicked / accepted leave / timed out / idle). Show why, then return to lobby.
function _handleRemovedFromRoom(reason) {
    var msgMap = {
        removed: 'You were removed from the room by the host.',
        left:    'You left the room.',
        timeout: 'You were removed from the room (no response to the "are you there?" prompt).',
        idle:    'You were removed from the room after 2 hours of inactivity.'
    };
    try { if (connection) connection.stop(); } catch (e) {}
    alert(msgMap[reason] || 'You have been removed from the room.');
    window.location.href = '/';
}

async function setLeaveTimeout(seconds) {
    try { await connection.invoke('SetLeaveTimeout', parseInt(seconds, 10)); } catch (e) { console.error(e); }
}

function _syncLeaveTimeoutSelect() {
    var sel = document.getElementById('leaveTimeoutSelect');
    if (sel && String(roomState.leaveRequestTimeoutSeconds)) {
        sel.value = String(roomState.leaveRequestTimeoutSeconds || 60);
    }
}

// AD7 — Private message
function _openPrivateMessageInput(connectionId, name) {
    var msg = prompt('Private message to ' + name + ':');
    if (msg && msg.trim()) {
        connection.invoke('SendPrivateMessage', connectionId, msg.trim()).catch(console.error);
    }
}
function _showPrivateMessageToast(senderName, message) {
    var toast = document.createElement('div');
    toast.className = 'private-msg-toast';
    toast.innerHTML =
        '<div class="pm-header">🔒 Private from <strong>' + escHtml(senderName) + '</strong></div>' +
        '<div class="pm-body">' + escHtml(message) + '</div>' +
        '<button class="pm-close" onclick="this.closest(\'.private-msg-toast\').remove()">✕</button>';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 15000);
}

// AD8 — Send emoji privately
function _openEmojiSendPicker(connectionId, name) {
    _closeParticipantCtxMenu();
    var palette = [];
    try { palette = JSON.parse(localStorage.getItem('es_reactionPalette') || '[]'); } catch(e) {}
    if (!palette.length) palette = ['👍','👏','🎉','😂','❤️','🔥','😮','💡','😄','🤣','😎','🥳','👀','💯','🙈'];

    var menu = document.createElement('div');
    menu.className = 'emoji-send-menu';
    palette.forEach(function(em) {
        var btn = document.createElement('button');
        btn.className = 'emoji-send-btn';
        btn.textContent = em;
        btn.title = 'Send ' + em + ' to ' + name;
        btn.addEventListener('click', function() {
            menu.remove();
            connection.invoke('SendPrivateReaction', connectionId, em).catch(console.error);
        });
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    // Position at centre-bottom of screen on mobile, or near mouse on desktop
    menu.style.bottom = '80px';
    menu.style.right = '20px';
    setTimeout(function() {
        document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }, { once: true });
    }, 0);
}

// AD9 — Send sound privately
function _openSoundSendMenu(connectionId, name) {
    _closeParticipantCtxMenu();
    var sounds = [
        { id:'fanfare',  label:'🎺 Fanfare' },
        { id:'drumroll', label:'🥁 Drumroll' },
        { id:'bell',     label:'🔔 Bell' },
        { id:'airhorn',  label:'📯 Airhorn' }
    ];
    var menu = document.createElement('div');
    menu.className = 'sound-send-menu';
    sounds.forEach(function(s) {
        var btn = document.createElement('button');
        btn.className = 'sound-send-btn';
        btn.textContent = s.label;
        btn.title = 'Send ' + s.label + ' sound to ' + name;
        btn.addEventListener('click', function() {
            menu.remove();
            connection.invoke('SendSoundToParticipant', connectionId, s.id).catch(console.error);
        });
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    menu.style.position = 'fixed';
    menu.style.bottom = '80px';
    menu.style.right = '20px';
    setTimeout(function() {
        document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }, { once: true });
    }, 0);
}

// AD — Simple toast helper (avoids dependency on external showToast)
function _showToastAD(message, type) {
    if (typeof showToast === 'function') { showToast(message, type); return; }
    var t = document.createElement('div');
    t.className = 'ad-toast ad-toast-' + (type || 'info');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(function() { if (t.parentNode) t.remove(); }, 4000);
}

// ============================================================
// Init
// ============================================================
const isMobile = window.innerWidth < 992;
document.getElementById('roomLayout').style.paddingBottom = isMobile ? '56px' : '48px';
initSignalR();
