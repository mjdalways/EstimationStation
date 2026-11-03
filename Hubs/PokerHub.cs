using Microsoft.AspNetCore.SignalR;
using EstimationStation.Models;
using EstimationStation.Services;
using EstimationStation.Data;
using System.Collections.Concurrent;
using System.Globalization;

namespace EstimationStation.Hubs;

public class PokerHub : Hub
{
    private readonly RoomService _roomService;
    private readonly JiraService _jiraService;
    private readonly LeaveRequestStore _leaveStore;
    private readonly WordListService _wordList;
    private readonly CrosswordGenerator _crosswordGen;
    private readonly WordSearchGenerator _wordSearchGen;
    private readonly SpellingBeeGenerator _spellingBeeGen;
    private readonly JumbleGenerator _jumbleGen;
    private readonly ConnectionsGenerator _connectionsGen;
    private readonly RoomCreationGuard _roomGuard;

    // AD3 — Pending setting-change requests for "ask" lock mode
    private static readonly ConcurrentDictionary<string, PendingSettingRequest> _pendingRequests = new();
    private record PendingSettingRequest(string RoomName, string RequesterConnectionId, string RequesterName, string SettingKey, string ValueJson, DateTime CreatedAt);

    // Server-side rate limiting: connectionId -> (action -> last-fired ticks). Backstops the
    // client-side throttles so a crafted client can't flood the room with sounds/reactions/audio.
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, long>> _rateLimits = new();

    private bool RateLimited(string action, TimeSpan minInterval)
    {
        var perConn = _rateLimits.GetOrAdd(Context.ConnectionId, _ => new());
        var now = DateTime.UtcNow.Ticks;
        var min = minInterval.Ticks;
        bool allowed = false;
        perConn.AddOrUpdate(action,
            _ => { allowed = true; return now; },
            (_, last) => { if (now - last >= min) { allowed = true; return now; } return last; });
        return !allowed;
    }

    public PokerHub(RoomService roomService, JiraService jiraService, LeaveRequestStore leaveStore, WordListService wordList, CrosswordGenerator crosswordGen,
        WordSearchGenerator wordSearchGen, SpellingBeeGenerator spellingBeeGen, JumbleGenerator jumbleGen,
        ConnectionsGenerator connectionsGen, RoomCreationGuard roomGuard)
    {
        _roomGuard = roomGuard;
        _connectionsGen = connectionsGen;
        _roomService = roomService;
        _jiraService = jiraService;
        _leaveStore = leaveStore;
        _wordList = wordList;
        _crosswordGen = crosswordGen;
        _wordSearchGen = wordSearchGen;
        _spellingBeeGen = spellingBeeGen;
        _jumbleGen = jumbleGen;
    }

    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveRoom();
        _rateLimits.TryRemove(Context.ConnectionId, out _);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string roomName, string userName, bool isObserver, string? pin = null)
    {
        // Canonicalize once at the boundary so the group, connection map, dictionary key and
        // persisted file all agree (every downstream method reads the name back via
        // GetRoomForConnection). Reject names that have no usable characters.
        roomName = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(roomName))
        {
            await Clients.Caller.SendAsync("Error", "INVALID_ROOM");
            return;
        }

        // Joining an existing room is always allowed; only creating a brand-new room name is rate limited.
        if (!_roomService.Exists(roomName) && !_roomGuard.Allow(Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString()))
        {
            await Clients.Caller.SendAsync("Error", "TOO_MANY_ROOMS");
            return;
        }

        var room = _roomService.GetOrCreateRoom(roomName);

        // PIN check — skip for the very first joiner (they set the PIN after joining).
        // Known/accepted tradeoff (review B9): once a room empties (last participant leaves)
        // or the server restarts, the next joiner is treated as "first" and bypasses the PIN,
        // becoming host. Rooms are ephemeral and PIN is a casual deterrent, not an auth
        // boundary, so this is intentional rather than enforcing the PIN unconditionally.
        if (room.Participants.Count > 0 && room.Pin != null && room.Pin != pin)
        {
            await Clients.Caller.SendAsync("Error", "PIN_REQUIRED");
            return;
        }

        _roomService.MapConnection(Context.ConnectionId, roomName);

        // Cap display name length server-side (client maxlength is advisory only)
        userName = string.IsNullOrWhiteSpace(userName) ? "Anonymous" : userName.Trim();
        if (userName.Length > 50) userName = userName[..50];

        var participant = new Participant
        {
            ConnectionId = Context.ConnectionId,
            Name = userName,
            IsObserver = isObserver
        };

        bool hostReclaimed = false;
        var staleConnectionIds = new List<string>();
        var reKeyedChairs = new List<(int Idx, string? Color)>();
        lock (room)
        {
            bool midVote = !room.VotesRevealed && room.Participants.Any(p => !p.IsObserver && p.Vote != null);
            participant.IsGhost = room.GhostModeEnabled && midVote;

            // Reconcile a previous session for the same display name (e.g. closing and
            // reopening a tab): carry the old session's avatar over to the new connection,
            // re-key its chair claim and host status, and drop the stale entry — otherwise
            // a doppelganger lingers (with a non-interactive chair claim) until SignalR's
            // disconnect detection eventually catches up.
            foreach (var stale in room.Participants.Where(p => p.Name == userName && p.ConnectionId != Context.ConnectionId).ToList())
            {
                room.Participants.Remove(stale);
                staleConnectionIds.Add(stale.ConnectionId);
                if (!string.IsNullOrEmpty(stale.AvatarData)) participant.AvatarData = stale.AvatarData;

                foreach (var kv in room.ChairClaims.Where(kv => kv.Value.ConnectionId == stale.ConnectionId).ToList())
                {
                    room.ChairClaims[kv.Key] = new ChairClaim
                    {
                        ConnectionId = Context.ConnectionId,
                        Name = userName,
                        Color = kv.Value.Color
                    };
                    reKeyedChairs.Add((kv.Key, kv.Value.Color));
                }

                if (room.HostConnectionId == stale.ConnectionId)
                {
                    room.HostConnectionId = Context.ConnectionId;
                    hostReclaimed = true;
                }
            }

            room.Participants.RemoveAll(p => p.ConnectionId == Context.ConnectionId);
            room.Participants.Add(participant);
            room.LastActivity = DateTime.UtcNow;

            // AD1 — Set host to first joiner; also reclaim if the previous host is no longer present
            bool hostPresent = !string.IsNullOrEmpty(room.HostConnectionId)
                && room.Participants.Any(p => p.ConnectionId == room.HostConnectionId);
            if (!hostPresent)
            {
                room.HostConnectionId = Context.ConnectionId;
                hostReclaimed = true;
            }
        }

        foreach (var oldCid in staleConnectionIds) _roomService.RemoveConnection(oldCid);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);

        // One-shot host onboarding: only the first joiner of a freshly created room is
        // offered the settings-lock setup. The flag persists so later host logins
        // (and host transfers) never see the prompt again.
        bool showSetupPrompt = !room.SetupPromptShown;
        if (showSetupPrompt) room.SetupPromptShown = true;
        _roomService.SaveRoom(room);

        // Send full state to the joining participant
        await Clients.Caller.SendAsync("RoomState", BuildRoomState(room, Context.ConnectionId, showSetupPrompt));

        // A4 — a stale connection here isn't necessarily our own old tab; it may be a
        // different person who happens to share this display name. Tell them explicitly
        // so their tab shows a message and navigates home instead of silently no-oping on
        // every subsequent hub call. (If it *is* our own old tab, it's already gone and
        // this is a no-op.)
        foreach (var oldCid in staleConnectionIds)
            await Clients.Client(oldCid).SendAsync("RemovedFromRoom", "superseded");

        // Clean up the stale previous-session entries this join reconciled BEFORE announcing
        // the new join (A2): tell everyone the old connection left, and re-announce its
        // re-keyed chair claims under the new connection, so other clients never briefly
        // hold two entries (old + new cid) for the same name.
        foreach (var oldCid in staleConnectionIds)
            await Clients.OthersInGroup(roomName).SendAsync("ParticipantLeft", oldCid, userName);
        foreach (var (idx, color) in reKeyedChairs)
            await Clients.OthersInGroup(roomName).SendAsync("ChairClaimed", idx, userName, color, Context.ConnectionId);

        // Notify others
        await Clients.OthersInGroup(roomName).SendAsync("ParticipantJoined", new
        {
            connectionId = participant.ConnectionId,
            name = participant.Name,
            isObserver = participant.IsObserver,
            isGhost = participant.IsGhost,
            hasVoted = participant.Vote != null,
            avatarData = participant.AvatarData
        });

        // AD1 — if this joiner reclaimed an absent host, keep everyone's crown in sync
        if (hostReclaimed)
            await Clients.OthersInGroup(roomName).SendAsync("HostChanged", Context.ConnectionId);
    }

    public async Task LeaveRoom()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        string participantName = string.Empty;
        string? newHostId = null;
        bool wasHost = false;
        var releasedChairs = new List<int>();
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant != null)
            {
                participantName = participant.Name;
                room.Participants.Remove(participant);
            }
            // Free any chair this connection had claimed so the seat reopens.
            foreach (var kv in room.ChairClaims.Where(kv => kv.Value.ConnectionId == Context.ConnectionId).ToList())
            {
                room.ChairClaims.Remove(kv.Key);
                releasedChairs.Add(kv.Key);
            }
            // AD1 — Transfer host if the host left
            if (room.HostConnectionId == Context.ConnectionId && room.Participants.Any())
            {
                wasHost = true;
                room.HostConnectionId = room.Participants.First().ConnectionId;
                newHostId = room.HostConnectionId;
            }
        }

        _roomService.RemoveConnection(Context.ConnectionId);
        if (wasHost) _roomService.SaveRoom(room);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);

        if (!string.IsNullOrEmpty(participantName))
        {
            await Clients.Group(roomName).SendAsync("ParticipantLeft", Context.ConnectionId, participantName);
        }
        foreach (var idx in releasedChairs)
        {
            await Clients.Group(roomName).SendAsync("ChairReleased", idx);
        }
        if (newHostId != null)
        {
            await Clients.Group(roomName).SendAsync("HostChanged", newHostId);
        }
    }

    // ── Room Scene: race-safe chair claiming ──────────────────────────────
    // First-confirm-wins. The server holds the authoritative chair->participant map
    // and broadcasts ChairClaimed/ChairReleased; the loser of a race gets ChairClaimFailed.
    public async Task ClaimChair(int chairIdx, string? color)
    {
        if (chairIdx < 0 || chairIdx > 63) return;
        if (RateLimited("claimChair", TimeSpan.FromMilliseconds(150))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        string claimerName = string.Empty;
        int? releasedIdx = null;
        bool claimed = false;
        string winnerName = string.Empty;

        lock (room)
        {
            var p = room.Participants.FirstOrDefault(x => x.ConnectionId == Context.ConnectionId);
            if (p == null) return;
            claimerName = p.Name;

            // Taken by another *present* participant → race lost.
            if (room.ChairClaims.TryGetValue(chairIdx, out var existing)
                && existing.ConnectionId != Context.ConnectionId
                && room.Participants.Any(x => x.ConnectionId == existing.ConnectionId))
            {
                winnerName = existing.Name;
            }
            else
            {
                // Release any other chair this connection already held (moving seats).
                foreach (var kv in room.ChairClaims
                    .Where(kv => kv.Value.ConnectionId == Context.ConnectionId && kv.Key != chairIdx).ToList())
                {
                    room.ChairClaims.Remove(kv.Key);
                    releasedIdx = kv.Key;
                }
                room.ChairClaims[chairIdx] = new ChairClaim
                {
                    ConnectionId = Context.ConnectionId,
                    Name = p.Name,
                    Color = color
                };
                claimed = true;
            }
        }

        if (claimed)
        {
            _roomService.SaveRoom(room);
            if (releasedIdx != null)
                await Clients.Group(roomName).SendAsync("ChairReleased", releasedIdx.Value);
            await Clients.Group(roomName).SendAsync("ChairClaimed", chairIdx, claimerName, color, Context.ConnectionId);
        }
        else
        {
            await Clients.Caller.SendAsync("ChairClaimFailed", chairIdx, winnerName);
        }
    }

    // Room Scene: whole-layout furniture sync. Any add/move/remove/reset sends the full
    // layout; we store it and broadcast to everyone else so the room stays in sync.
    public async Task SetRoomLayout(string layoutJson)
    {
        if (string.IsNullOrEmpty(layoutJson) || layoutJson.Length > 8000) return;
        if (RateLimited("roomLayout", TimeSpan.FromMilliseconds(120))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room) { room.RoomLayoutJson = layoutJson; }
        _roomService.SaveRoom(room);
        // Originator already shows its own change live — only update the others.
        await Clients.OthersInGroup(roomName).SendAsync("RoomLayoutChanged", layoutJson);
    }

    // AQ5: collaborative whiteboard. Each completed stroke is broadcast as a delta and
    // appended to room state so late joiners can replay the board.
    public async Task WhiteboardDraw(string strokeJson)
    {
        if (string.IsNullOrEmpty(strokeJson) || strokeJson.Length > 20000) return;
        if (RateLimited("wbDraw", TimeSpan.FromMilliseconds(20))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room)
        {
            room.WhiteboardStrokes.Add(strokeJson);
            // Bound memory: keep the most recent strokes.
            if (room.WhiteboardStrokes.Count > 4000)
                room.WhiteboardStrokes.RemoveRange(0, room.WhiteboardStrokes.Count - 4000);
        }
        _roomService.SaveRoom(room);
        await Clients.OthersInGroup(roomName).SendAsync("WhiteboardStroke", strokeJson);
    }

    // AP1: host sets the room identity icon (emoji glyph or a data: URL image).
    public async Task SetRoomIcon(string? icon)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;
        if (icon != null)
        {
            if (icon.Length > 280_000) return;                       // ~200 KB image cap
            if (!icon.StartsWith("data:") && icon.Length > 16) return; // emoji glyph only otherwise
        }
        lock (room) { room.RoomIcon = string.IsNullOrEmpty(icon) ? null : icon; }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("RoomIconChanged", room.RoomIcon);
    }

    public async Task WhiteboardClear()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room) { room.WhiteboardStrokes.Clear(); }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("WhiteboardCleared");
    }

    // Host-only: free a specific chair (evict whoever's sitting there). Reassignment is
    // free-then-claim. Broadcasts ChairReleased so all views update.
    public async Task HostFreeChair(int chairIdx)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        bool removed;
        lock (room) { removed = room.ChairClaims.Remove(chairIdx); }
        if (removed)
        {
            _roomService.SaveRoom(room);
            await Clients.Group(roomName).SendAsync("ChairReleased", chairIdx);
        }
    }

    // Spatial presence: relay a participant's live position/heading so everyone sees them
    // roam the room. High-frequency + ephemeral → no SaveRoom; just update memory + relay.
    public async Task AvatarMove(double x, double z, double yaw, string pose)
    {
        if (RateLimited("avatarMove", TimeSpan.FromMilliseconds(40))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        // Clamp to a sane room-sized range to ignore garbage.
        if (double.IsNaN(x) || double.IsNaN(z) || double.IsNaN(yaw)) return;
        x = Math.Max(-12, Math.Min(12, x)); z = Math.Max(-12, Math.Min(12, z));
        yaw = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        string pose2;
        lock (room)
        {
            var p = room.Participants.FirstOrDefault(q => q.ConnectionId == Context.ConnectionId);
            if (p == null) return;
            p.PosX = x; p.PosZ = z; p.Yaw = yaw; p.Pose = (pose == "walk" || pose == "idle") ? pose : "idle";
            pose2 = p.Pose;
        }
        await Clients.OthersInGroup(roomName).SendAsync("AvatarMoved", Context.ConnectionId, x, z, yaw, pose2);
    }

    // Stop roaming (e.g. sat down / left the room) — clear pose so the avatar returns to
    // its seat/standing slot for everyone.
    public async Task AvatarStop()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room)
        {
            var p = room.Participants.FirstOrDefault(q => q.ConnectionId == Context.ConnectionId);
            if (p == null) return;
            p.Pose = null; p.PosX = null; p.PosZ = null; p.Yaw = null;
        }
        await Clients.OthersInGroup(roomName).SendAsync("AvatarStopped", Context.ConnectionId);
    }

    // Room Scene: chairs dragged off their default ring. Whole-map sync (idx -> {x,z}).
    public async Task SetChairPositions(string json)
    {
        if (string.IsNullOrEmpty(json) || json.Length > 6000) return;
        if (RateLimited("chairPos", TimeSpan.FromMilliseconds(120))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room) { room.ChairPositionsJson = json; }
        _roomService.SaveRoom(room);
        await Clients.OthersInGroup(roomName).SendAsync("ChairPositionsChanged", json);
    }

    // Room Scene: décor (props/whiteboard/project screen) dragged from their default spots.
    // Whole-map sync (key -> {x,z[,rot]}), mirrors SetChairPositions.
    public async Task SetDecorPositions(string json)
    {
        if (string.IsNullOrEmpty(json) || json.Length > 6000) return;
        if (RateLimited("decorPos", TimeSpan.FromMilliseconds(120))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        lock (room) { room.DecorPositionsJson = json; }
        _roomService.SaveRoom(room);
        await Clients.OthersInGroup(roomName).SendAsync("DecorPositionsChanged", json);
    }

    /// <summary>Broadcasts room-scene visual config (chair count, table shape, window view, etc.)
    /// so all participants render the same room. The patch is merged into the room's persisted
    /// SceneConfigJson (server-authoritative) so late joiners get the current state via
    /// BuildRoomState without depending on the host being online.</summary>
    public async Task BroadcastSceneConfig(string configJson)
    {
        if (string.IsNullOrEmpty(configJson) || configJson.Length > 4000) return;
        if (RateLimited("sceneConfig", TimeSpan.FromMilliseconds(500))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        try
        {
            var patch = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(configJson);
            if (patch == null) return;
            lock (room)
            {
                var merged = string.IsNullOrEmpty(room.SceneConfigJson)
                    ? new Dictionary<string, System.Text.Json.JsonElement>()
                    : System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(room.SceneConfigJson)
                        ?? new Dictionary<string, System.Text.Json.JsonElement>();
                foreach (var kv in patch) merged[kv.Key] = kv.Value;
                room.SceneConfigJson = System.Text.Json.JsonSerializer.Serialize(merged);
            }
        }
        catch
        {
            return; // malformed patch — drop rather than corrupt the persisted config
        }

        _roomService.SaveRoom(room);
        // Originator already shows its own change live — only update the others. Send the
        // patch (not the merged blob); each client merges it into its own local config.
        await Clients.OthersInGroup(roomName).SendAsync("SceneConfigUpdated", configJson);
    }

    public async Task ReleaseChair()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        var released = new List<int>();
        lock (room)
        {
            foreach (var kv in room.ChairClaims.Where(kv => kv.Value.ConnectionId == Context.ConnectionId).ToList())
            {
                room.ChairClaims.Remove(kv.Key);
                released.Add(kv.Key);
            }
        }
        if (released.Count > 0)
        {
            _roomService.SaveRoom(room);
            foreach (var idx in released)
                await Clients.Group(roomName).SendAsync("ChairReleased", idx);
        }
    }

    public async Task UpdateName(string newName)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        newName = string.IsNullOrWhiteSpace(newName) ? "Anonymous" : newName.Trim();
        if (newName.Length > 50) newName = newName[..50];

        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant != null)
                participant.Name = newName;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("NameUpdated", Context.ConnectionId, newName);
    }

    public async Task CastVote(string vote)
    {
        if (vote != null && vote.Length > 16) return; // B7: reject crafted/oversized vote values

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool shouldAutoReveal = false;
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant == null || participant.IsObserver || participant.IsGhost) return;
            participant.Vote = vote;

            if (room.AutoReveal && !room.VotesRevealed && vote != null)
            {
                var voters = room.Participants.Where(p => !p.IsObserver).ToList();
                shouldAutoReveal = voters.Count > 0 && voters.All(p => p.Vote != null);
            }
        }

        // Broadcast whether this participant now has a vote (false when they unselected)
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VoteCast", Context.ConnectionId, vote != null);

        if (shouldAutoReveal)
        {
            await RevealVotes();
        }
    }

    public async Task RevealVotes()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        Dictionary<string, string?> votes;
        object stats;
        object? roundPayload = null;
        object? predictionPayload = null;
        lock (room)
        {
            room.VotesRevealed = true;
            votes = room.Participants.ToDictionary(p => p.ConnectionId, p => p.Vote);
            stats = CalculateStats(room);
            room.ShameParticipantId = FindShameParticipantId(room);

            // F11/P1 — the durable record. Everything below is derived from state we already
            // had; the only reason it did not survive a refresh before is that it was only
            // ever assembled in the browser.
            var round = RecordSessionRound(room);
            roundPayload = SessionRoundPayload(round);
            // F11/P7 — predictions lock at reveal and score against whatever the room's
            // majority landed on.
            predictionPayload = ResolvePredictions(room, round);
        }

        // F11/P3 — pre-cast values are withheld until the reveal exactly like live votes, so
        // the reveal is the moment they have to be re-sent. ProxyVotesFor masks the value on
        // room.VotesRevealed, so every transition that flips that flag (or changes which story
        // is on the table) has to re-send as well — see SetCurrentStory, HideVotes, ResetVotes.
        List<object> revealedProxies;
        string? proxyStoryId;
        lock (room) { proxyStoryId = room.CurrentStoryId; revealedProxies = ProxyVotesFor(room, room.CurrentStoryId); }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesRevealed", votes, stats);
        if (revealedProxies.Count > 0)
            await Clients.Group(roomName).SendAsync("ProxyVotesUpdated", proxyStoryId, revealedProxies);
        if (roundPayload != null) await Clients.Group(roomName).SendAsync("SessionRoundRecorded", roundPayload);
        if (predictionPayload != null) await Clients.Group(roomName).SendAsync("PredictionsResolved", predictionPayload);
        await AwardPetForRound(roomName, room);
    }

    public async Task HideVotes()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        List<object> proxies;
        lock (room)
        {
            room.VotesRevealed = false;
            // F11/P3 — read *after* the flag flips so the values come back masked.
            proxies = ProxyVotesFor(room, room.CurrentStoryId);
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesHidden");
        if (proxies.Count > 0) await Clients.Group(roomName).SendAsync("ProxyVotesUpdated", room.CurrentStoryId, proxies);
    }

    public async Task ResetVotes()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        List<object> proxies;
        lock (room) { ResetRoundState(room); proxies = ProxyVotesFor(room, room.CurrentStoryId); }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesReset");
        await Clients.Group(roomName).SendAsync("VibeUpdated", new Dictionary<string, int>());
        if (proxies.Count > 0) await Clients.Group(roomName).SendAsync("ProxyVotesUpdated", room.CurrentStoryId, proxies);
    }

    // Shared by ResetVotes and SetCurrentStory so switching story doesn't leave stale
    // confidence/ghost/vibes state on the server while clients (which get VotesReset either
    // way) render as if it were fully cleared. Caller must hold lock(room).
    private static void ResetRoundState(Room room)
    {
        foreach (var p in room.Participants)
        {
            p.Vote = null;
            p.IsGhost = false;
            p.Confidence = null;
        }
        room.VotesRevealed = false;
        room.ShameParticipantId = null;
        room.Vibes.Clear();
        // F11/P1 — the discussion clock for the next SessionRound starts here.
        room.RoundStartedAtUtc = DateTime.UtcNow;
    }

    // =====================================================================
    // F11/P1 — persistent session history
    // =====================================================================

    // Appends one SessionRound for the round that has just been revealed. Caller must hold
    // lock(room). A re-vote on the same story appends a new round with an incremented
    // RoundNumber rather than replacing the previous one, so "this one took three rounds"
    // stays visible in the recap and the retro's estimated-vs-actual panel.
    private static SessionRound RecordSessionRound(Room room)
    {
        var story = room.CurrentStoryId != null
            ? room.Stories.FirstOrDefault(s => s.Id == room.CurrentStoryId) : null;

        var round = new SessionRound
        {
            StoryId = room.CurrentStoryId,
            StoryTitle = story?.Title ?? "(no story)",
            JiraKey = story?.JiraKey,
            RevealedAtUtc = DateTime.UtcNow,
            DiscussionSeconds = (int)Math.Max(0, Math.Round((DateTime.UtcNow - room.RoundStartedAtUtc).TotalSeconds)),
            RoundNumber = room.CurrentStoryId == null
                ? 1
                : room.SessionRounds.Count(r => r.StoryId == room.CurrentStoryId) + 1,
        };

        foreach (var p in room.Participants.Where(p => !p.IsObserver && p.Vote != null))
        {
            round.Votes[p.Name] = p.Vote!;
            if (p.Confidence.HasValue) round.Confidences[p.Name] = p.Confidence.Value;
        }

        // F11/P3 — absentees who pre-cast on this story show in the record, marked viaProxy.
        // Gated on CountProxyVotes: with it off, the pre-votes are still shown live as greyed
        // "absent" cards but never move the room's numbers, so a stale pre-vote from last week
        // cannot quietly decide a consensus.
        if (room.CountProxyVotes && room.CurrentStoryId != null
            && room.ProxyVotes.TryGetValue(room.CurrentStoryId, out var proxies))
        {
            foreach (var kv in proxies)
            {
                if (round.Votes.ContainsKey(kv.Key)) continue;   // they turned up after all
                round.Votes[kv.Key] = kv.Value;
                round.ProxyVoters.Add(kv.Key);
            }
        }

        var distinct = round.Votes.Values.Distinct().ToList();
        round.WasUnanimous = round.Votes.Count > 1 && distinct.Count == 1;
        round.FinalEstimate = story?.FinalEstimate ?? MajorityValue(round.Votes.Values);

        room.SessionRounds.Add(round);
        if (room.SessionRounds.Count > Room.MaxSessionRounds)
            room.SessionRounds.RemoveRange(0, room.SessionRounds.Count - Room.MaxSessionRounds);
        return round;
    }

    // The value most people played, ties broken by the lower card (the conservative read of a
    // split room). Null when there is nothing to count.
    private static string? MajorityValue(IEnumerable<string> votes)
    {
        var groups = votes.Where(v => !string.IsNullOrEmpty(v))
            .GroupBy(v => v)
            .Select(g => new { value = g.Key, count = g.Count() })
            .ToList();
        if (groups.Count == 0) return null;
        var top = groups.Max(g => g.count);
        return groups.Where(g => g.count == top)
            .OrderBy(g => double.TryParse(g.value.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : double.MaxValue)
            .First().value;
    }

    private static object SessionRoundPayload(SessionRound r) => new
    {
        id = r.Id,
        storyId = r.StoryId,
        storyTitle = r.StoryTitle,
        jiraKey = r.JiraKey,
        revealedAtUtc = r.RevealedAtUtc,
        votes = r.Votes.ToDictionary(kv => kv.Key, kv => kv.Value),
        confidences = r.Confidences.ToDictionary(kv => kv.Key, kv => kv.Value),
        proxyVoters = r.ProxyVoters.ToList(),
        finalEstimate = r.FinalEstimate,
        wasUnanimous = r.WasUnanimous,
        discussionSeconds = r.DiscussionSeconds,
        roundNumber = r.RoundNumber
    };

    public async Task ToggleGhostMode(bool enabled)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;
        string togglerName;
        lock (room)
        {
            room.GhostModeEnabled = enabled;
            togglerName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name ?? "Someone";
        }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("GhostModeToggled", enabled, togglerName);
    }

    public async Task SetRoomPin(string? pin)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        // Only the host may set or clear the room PIN.
        if (!string.IsNullOrEmpty(room.HostConnectionId) && room.HostConnectionId != Context.ConnectionId) return;
        // B9: enforce server-side what the lobby UI already promises (4-8 digits) — the
        // client's maxlength/pattern are advisory only.
        if (!string.IsNullOrWhiteSpace(pin) && !System.Text.RegularExpressions.Regex.IsMatch(pin.Trim(), @"^\d{4,8}$"))
            return;
        lock (room)
        {
            room.Pin = string.IsNullOrWhiteSpace(pin) ? null : pin.Trim();
            room.LastActivity = DateTime.UtcNow;
        }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("RoomPinSet", room.Pin != null);
    }

    public async Task CastCounterSpell()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        string casterName;
        lock (room)
        {
            if (!room.VotesRevealed) return;
            if (room.ShameParticipantId != Context.ConnectionId) return;
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant == null || participant.CounterUsed) return;
            participant.CounterUsed = true;
            casterName = participant.Name;
        }
        await Clients.Group(roomName).SendAsync("CounterSpellCast", Context.ConnectionId, casterName);
    }

    public async Task CastVibe(string emoji)
    {
        var allowed = new HashSet<string> { "🚀", "😱", "😴", "🤔", "💪", "🤷" };
        if (!allowed.Contains(emoji)) return;
        if (RateLimited("vibe", TimeSpan.FromMilliseconds(500))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        Dictionary<string, int> counts;
        lock (room)
        {
            room.Vibes[Context.ConnectionId] = emoji;
            counts = room.Vibes.Values
                .GroupBy(v => v)
                .ToDictionary(g => g.Key, g => g.Count());
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VibeUpdated", counts);
    }

    public async Task AddStory(string title)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        if (string.IsNullOrWhiteSpace(title)) return;
        title = title.Trim();
        if (title.Length > 200) title = title[..200];

        var story = new Story { Title = title };
        lock (room)
        {
            room.Stories.Add(story);
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryAdded", new
        {
            id = story.Id,
            title = story.Title,
            isCompleted = story.IsCompleted,
            finalEstimate = story.FinalEstimate,
            createdAt = story.CreatedAt
        });
    }

    public async Task UpdateStory(string storyId, string title)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        if (string.IsNullOrWhiteSpace(title)) return;
        title = title.Trim();
        if (title.Length > 200) title = title[..200];

        lock (room)
        {
            var story = room.Stories.FirstOrDefault(s => s.Id == storyId);
            if (story != null) story.Title = title;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryUpdated", storyId, title);
    }

    public async Task UpdateStoryNotes(string storyId, string? notes)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        if (notes != null && notes.Length > 2000)
            notes = notes[..2000];

        lock (room)
        {
            var story = room.Stories.FirstOrDefault(s => s.Id == storyId);
            if (story != null) story.Notes = notes;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryNotesUpdated", storyId, notes);
    }

    public async Task SetCurrentStory(string storyId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            room.CurrentStoryId = storyId;
            ResetRoundState(room);
        }

        // F11/P3 — room.js drops its pre-vote strip on CurrentStoryChanged and waits for this;
        // without it, estimates left in advance for the story just put on the table stay
        // invisible until the reveal.
        List<object> proxies;
        lock (room) { proxies = ProxyVotesFor(room, room.CurrentStoryId); }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("CurrentStoryChanged", storyId);
        await Clients.Group(roomName).SendAsync("VotesReset");
        await Clients.Group(roomName).SendAsync("VibeUpdated", new Dictionary<string, int>());
        if (proxies.Count > 0) await Clients.Group(roomName).SendAsync("ProxyVotesUpdated", storyId, proxies);
    }

    public async Task DeleteStory(string storyId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            room.Stories.RemoveAll(s => s.Id == storyId);
            if (room.CurrentStoryId == storyId)
                room.CurrentStoryId = null;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryDeleted", storyId);
    }

    // AK2: reorder stories — client sends the full ordered list of story IDs
    public async Task ReorderStories(List<string> orderedIds)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var lookup = room.Stories.ToDictionary(s => s.Id);
            var reordered = orderedIds
                .Where(id => lookup.ContainsKey(id))
                .Select(id => lookup[id])
                .ToList();
            // Append any stories not mentioned in orderedIds at the end (safety)
            reordered.AddRange(room.Stories.Where(s => !orderedIds.Contains(s.Id)));
            room.Stories = reordered;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoriesReordered", orderedIds);
    }

    public async Task ToggleAutoReveal(bool enabled)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            room.AutoReveal = enabled;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("AutoRevealToggled", enabled);
    }

    // N3 — room-level reveal ordering: majority votes revealed before the outlier
    public async Task ToggleRevealOrdering(bool enabled)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            room.RevealMajorityFirst = enabled;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("RevealOrderingToggled", enabled);
    }

    // AD1 — Transfer host to another participant (host-only)
    public async Task TransferHost(string targetConnectionId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;
        lock (room)
        {
            if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
            room.HostConnectionId = targetConnectionId;
        }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("HostChanged", targetConnectionId);
    }

    // Host-only: immediately remove a participant from the room.
    public async Task RemoveParticipant(string targetConnectionId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;
        if (targetConnectionId == Context.ConnectionId) return; // host can't kick themselves
        // No unlocked existence check here — RemoveAndBroadcastAsync's RemoveParticipant call
        // does the lookup under lock(room) and no-ops (res.Removed == false) if already gone.
        await RemoveAndBroadcastAsync(_roomService, Clients, Groups, room, roomName, targetConnectionId, "removed");
    }

    // Anyone: ask a participant whether they're still there / want to leave. They get a confirm
    // dialog; no answer within the room's timeout means the background sweep removes them (or,
    // if they're the host, transfers host to the requester).
    public async Task RequestLeave(string targetConnectionId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (targetConnectionId == Context.ConnectionId) return; // no asking yourself to leave
        if (RateLimited("requestLeave", TimeSpan.FromSeconds(2))) return;

        Participant? target, requester;
        int timeout;
        lock (room)
        {
            target = room.Participants.FirstOrDefault(p => p.ConnectionId == targetConnectionId);
            requester = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            timeout = room.LeaveRequestTimeoutSeconds;
        }
        if (target == null || requester == null) return;

        // Collapse any existing pending request for the same target so timers don't stack.
        foreach (var kv in _leaveStore.Requests)
            if (kv.Value.RoomName == roomName && kv.Value.TargetConnectionId == targetConnectionId)
                _leaveStore.Requests.TryRemove(kv.Key, out _);

        var requestId = Guid.NewGuid().ToString("N")[..8];
        _leaveStore.Requests[requestId] = new PendingLeave(
            roomName, Context.ConnectionId, requester.Name, targetConnectionId, target.Name, DateTime.UtcNow, timeout);

        await Clients.Client(targetConnectionId).SendAsync("LeaveRequested", requestId, requester.Name, timeout);
        await Clients.Caller.SendAsync("LeaveRequestSent", target.Name);
    }

    // Target's answer to a leave request: true = leave now, false = staying.
    public async Task RespondLeave(string requestId, bool willLeave)
    {
        if (!_leaveStore.Requests.TryGetValue(requestId, out var req)) return;
        if (req.TargetConnectionId != Context.ConnectionId) return; // only the target may answer
        _leaveStore.Requests.TryRemove(requestId, out _);

        var room = _roomService.GetRoom(req.RoomName);
        if (room == null) return;

        if (willLeave)
            await RemoveAndBroadcastAsync(_roomService, Clients, Groups, room, req.RoomName, req.TargetConnectionId, "left");
        else
            await Clients.Client(req.RequesterConnectionId).SendAsync("LeaveDeclined", req.TargetName);
    }

    // Host-only: configure how long the "are you there?" prompt waits before auto-removal.
    public async Task SetLeaveTimeout(int seconds)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;
        if (!new[] { 30, 60, 120, 180, 300 }.Contains(seconds)) return;
        lock (room) { room.LeaveRequestTimeoutSeconds = seconds; }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("LeaveTimeoutChanged", seconds);
    }

    // Shared removal + broadcast, used by the hub (host kick / accepted leave) and the background
    // sweep (timeout / idle). Removes from room state, cleans up the connection, persists, tells
    // the removed client to leave, and notifies the room (including any host hand-off).
    internal static async Task RemoveAndBroadcastAsync(
        RoomService roomService, IHubClients<IClientProxy> clients, IGroupManager groups,
        Room room, string roomName, string targetConnectionId, string reason)
    {
        var res = roomService.RemoveParticipant(room, targetConnectionId);
        if (!res.Removed) return;
        roomService.RemoveConnection(targetConnectionId);
        await groups.RemoveFromGroupAsync(targetConnectionId, roomName);
        roomService.SaveRoom(room);
        await clients.Client(targetConnectionId).SendAsync("RemovedFromRoom", reason);
        await clients.Group(roomName).SendAsync("ParticipantLeft", targetConnectionId, res.Name);
        foreach (var idx in res.ReleasedChairs)
            await clients.Group(roomName).SendAsync("ChairReleased", idx);
        if (res.NewHostId != null)
            await clients.Group(roomName).SendAsync("HostChanged", res.NewHostId);
    }

    // AD2 — Change settings lock mode (host-only)
    public async Task SetSettingsLock(string mode)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;
        var validModes = new[] { "none", "ask", "hostonly", "hidden" };
        if (!validModes.Contains(mode)) return;
        lock (room) { room.SettingsLockMode = mode; }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("SettingsLockChanged", mode);
    }

    // AD3 — Non-host requests a setting change (requires host approval in "ask" mode)
    public async Task RequestSettingChange(string settingKey, string valueJson)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.SettingsLockMode != "ask") return;
        if (room.HostConnectionId == Context.ConnectionId) return; // host doesn't need to ask
        if (string.IsNullOrEmpty(room.HostConnectionId)) return;

        var requester = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (requester == null) return;

        var requestId = Guid.NewGuid().ToString("N")[..8];
        _pendingRequests[requestId] = new PendingSettingRequest(
            roomName, Context.ConnectionId, requester.Name, settingKey, valueJson, DateTime.UtcNow);

        await Clients.Client(room.HostConnectionId).SendAsync("SettingChangeRequested",
            requestId, requester.Name, settingKey, valueJson);
    }

    // AD3 — Host approves or denies a pending setting change request
    public async Task ApproveSettingChange(string requestId, bool approved)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        if (!_pendingRequests.TryRemove(requestId, out var req)) return;
        if (req.RoomName != roomName) return;

        await Clients.Client(req.RequesterConnectionId).SendAsync("SettingChangeResolved", requestId, approved, req.SettingKey);

        if (approved)
            await ExecuteSettingChange(room, req.SettingKey, req.ValueJson);
    }

    private async Task ExecuteSettingChange(Room room, string settingKey, string valueJson)
    {
        switch (settingKey)
        {
            case "autoReveal":
                if (bool.TryParse(valueJson, out var ar)) {
                    lock (room) { room.AutoReveal = ar; }
                    _roomService.SaveRoom(room);
                    await Clients.Group(room.Name).SendAsync("AutoRevealToggled", ar);
                }
                break;
            case "ghostMode":
                if (bool.TryParse(valueJson, out var gm)) {
                    lock (room) { room.GhostModeEnabled = gm; }
                    _roomService.SaveRoom(room);
                    await Clients.Group(room.Name).SendAsync("GhostModeToggled", gm, "");
                }
                break;
            case "revealMajorityFirst":
                if (bool.TryParse(valueJson, out var rmf)) {
                    lock (room) { room.RevealMajorityFirst = rmf; }
                    _roomService.SaveRoom(room);
                    await Clients.Group(room.Name).SendAsync("RevealOrderingToggled", rmf);
                }
                break;
            case "estimateSet":
                var setDict = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(valueJson);
                var setName = (setDict != null && setDict.TryGetValue("set", out var sn)) ? sn : "fibonacci";
                if (RoomService.EstimateSets.TryGetValue(setName, out var info)) {
                    lock (room) { room.EstimateSet = setName; room.CustomEstimates = null; }
                    _roomService.SaveRoom(room);
                    await Clients.Group(room.Name).SendAsync("EstimateSetChanged", setName, info.Values);
                }
                break;
        }
    }

    // AD5 — Private message to a single participant
    public async Task SendPrivateMessage(string targetConnectionId, string message)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (RateLimited("privateMsg", TimeSpan.FromMilliseconds(750))) return;
        message = (message ?? "").Trim();
        if (message.Length > 500) message = message[..500];
        if (string.IsNullOrEmpty(message)) return;
        string? senderName;
        lock (room)
        {
            if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
            senderName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
        }
        if (senderName == null) return;
        await Clients.Client(targetConnectionId).SendAsync("PrivateMessageReceived", senderName, message, DateTime.UtcNow);
    }

    // AD6 — Private emoji reaction to a single participant
    public async Task SendPrivateReaction(string targetConnectionId, string emoji)
    {
        if (string.IsNullOrWhiteSpace(emoji) || emoji.Length > 10) return;
        if (RateLimited("privateReaction", TimeSpan.FromMilliseconds(500))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        string? senderName;
        lock (room)
        {
            if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
            senderName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
        }
        if (senderName == null) return;
        // C4: pass the sender's connectionId too so the recipient can attribute the reaction
        // (the client previously only received the name, which the float-animation helper
        // ignored, making private reactions appear anonymous).
        await Clients.Client(targetConnectionId).SendAsync("PrivateReactionReceived", senderName, emoji, Context.ConnectionId);
    }

    // AD7 — Private sound to a single participant
    public async Task SendSoundToParticipant(string targetConnectionId, string soundId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        var validSounds = new[] { "fanfare", "drumroll", "bell", "airhorn" };
        if (!validSounds.Contains(soundId)) return;
        if (RateLimited("sound", TimeSpan.FromSeconds(1))) return;
        string? senderName;
        lock (room)
        {
            if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
            senderName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
        }
        if (senderName == null) return;
        await Clients.Client(targetConnectionId).SendAsync("SoundTriggered", soundId, senderName);
    }

    public async Task SetEstimateSet(string setName, string? customValues)
    {
        // B7: cap custom estimate set size (every other mutator caps its input).
        if (customValues != null && customValues.Length > 500) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        string[] values;
        lock (room)
        {
            room.EstimateSet = setName;
            room.CustomEstimates = customValues;
            if (setName == "custom" && !string.IsNullOrEmpty(customValues))
            {
                values = customValues.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).Take(50).ToArray();
            }
            else if (RoomService.EstimateSets.TryGetValue(setName, out var info))
            {
                values = info.Values;
            }
            else
            {
                values = RoomService.EstimateSets["fibonacci"].Values;
            }
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("EstimateSetChanged", setName, values);
    }

    // By design (review B9): chat is relayed live and never persisted to Room, so late
    // joiners/reloads see no history. Keeps room state small and avoids storing arbitrary
    // free text long-term.
    public async Task SendChat(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        if (RateLimited("chat", TimeSpan.FromMilliseconds(500))) return;
        if (message.Length > 500) message = message[..500];

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        string participantName;
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            participantName = participant?.Name ?? "Unknown";
        }

        var timestamp = DateTime.UtcNow;
        await Clients.Group(roomName).SendAsync("ChatReceived", participantName, message, timestamp);
    }

    public async Task StartTimer(int seconds)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        string startedBy;
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            startedBy = participant?.Name ?? "Unknown";
        }

        await Clients.Group(roomName).SendAsync("TimerStarted", seconds, startedBy);
    }

    public async Task StopTimer()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        await Clients.Group(roomName).SendAsync("TimerStopped");
    }

    public async Task CompleteStory(string storyId, string estimate)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            var story = room.Stories.FirstOrDefault(s => s.Id == storyId);
            if (story != null)
            {
                story.FinalEstimate = estimate;
                story.IsCompleted = true;
            }
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryCompleted", storyId, estimate);
    }

    public async Task UpdateAvatar(string avatarData)
    {
        if (avatarData?.StartsWith("data:") == true && avatarData.Length > 65_536)
        {
            await Clients.Caller.SendAsync("Error", "Avatar image too large (max ~48 KB).");
            return;
        }

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant == null) return;
            participant.AvatarData = avatarData;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("AvatarUpdated", Context.ConnectionId, avatarData);
    }

    public async Task CastConfidence(int level)
    {
        if (level < 1 || level > 5) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant == null) return;
            participant.Confidence = level;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("ConfidenceCast", Context.ConnectionId, level);
    }

    public async Task TriggerSound(string soundId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var valid = new[] { "fanfare", "drumroll", "bell", "airhorn" };
        if (!valid.Contains(soundId)) return;
        if (RateLimited("sound", TimeSpan.FromSeconds(1))) return;

        var room = _roomService.GetRoom(roomName);
        var senderName = room?.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name ?? "Someone";

        await Clients.Group(roomName).SendAsync("SoundTriggered", soundId, senderName);
    }

    public async Task ImportFromJira(string domain, string email, string token, string jql)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        if (string.IsNullOrWhiteSpace(domain) || string.IsNullOrWhiteSpace(email) ||
            string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(jql)) return;

        if (!TryValidateJiraDomain(domain, out var validatedDomain))
        {
            await Clients.Caller.SendAsync("Error", "Jira domain must end in .atlassian.net");
            return;
        }

        List<JiraIssue> issues;
        try
        {
            issues = await _jiraService.FetchIssuesAsync(validatedDomain, email, token, jql);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Jira import failed: {ex.Message}");
            return;
        }

        var stories = new List<Story>();
        lock (room)
        {
            foreach (var issue in issues)
            {
                var story = new Story
                {
                    Title = $"[{issue.Key}] {issue.Summary}",
                    JiraKey = issue.Key,
                    JiraUrl = issue.Url,
                    Description = issue.Description,
                    IssueType = issue.IssueType
                };
                room.Stories.Add(story);
                stories.Add(story);
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoriesImported", stories.Select(s => new
        {
            id = s.Id,
            title = s.Title,
            isCompleted = s.IsCompleted,
            finalEstimate = s.FinalEstimate,
            createdAt = s.CreatedAt,
            jiraKey = s.JiraKey,
            jiraUrl = s.JiraUrl,
            description = s.Description,
            issueType = s.IssueType
        }));
    }

    // P2 — Emoji Reactions: relay emoji to room; no state stored; rate-limit is client-side
    public async Task SendReaction(string emoji)
    {
        if (string.IsNullOrWhiteSpace(emoji) || emoji.Length > 10) return;
        if (RateLimited("reaction", TimeSpan.FromMilliseconds(400))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        await Clients.Group(roomName).SendAsync("ReceiveReaction", Context.ConnectionId, emoji);
    }

    public async Task TriggerCustomSound(string base64Data, string label)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        if (string.IsNullOrEmpty(base64Data) || base64Data.Length > 700_000) return;
        if (RateLimited("customSound", TimeSpan.FromSeconds(3))) return;

        var room = _roomService.GetRoom(roomName);
        string senderName = "Someone";
        if (room != null)
            lock (room) { senderName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name ?? "Someone"; }
        var safeLabel = string.IsNullOrWhiteSpace(label) ? "Custom" : label[..Math.Min(label.Length, 30)];

        await Clients.Group(roomName).SendAsync("CustomSoundTriggered", base64Data, senderName, safeLabel);
    }

    public async Task WriteJiraEstimate(string domain, string email, string token,
        string jiraKey, string estimate, string fieldId = "customfield_10016")
    {
        if (string.IsNullOrWhiteSpace(jiraKey) || string.IsNullOrWhiteSpace(estimate)) return;

        if (!double.TryParse(estimate, System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out double numericEstimate))
        {
            return;
        }

        if (!TryValidateJiraDomain(domain, out var validatedDomain))
        {
            await Clients.Caller.SendAsync("JiraWriteResult", jiraKey, false, "Invalid domain");
            return;
        }

        try
        {
            await _jiraService.WriteEstimateAsync(validatedDomain, email, token, jiraKey, numericEstimate, fieldId);
            await Clients.Caller.SendAsync("JiraWriteResult", jiraKey, true, null);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("JiraWriteResult", jiraKey, false, ex.Message);
        }
    }

    // AD2 — Server-side enforcement of the room settings lock. The client UI hides/disables
    // locked controls, but a crafted client could still invoke the hub directly, so every
    // room-level (👥) setting mutator must verify this. Non-"none" modes restrict changes to
    // the host; non-hosts must go through RequestSettingChange/ApproveSettingChange instead.
    private static bool CanChangeRoomSetting(Room room, string connectionId) =>
        room.SettingsLockMode == "none"
        || string.IsNullOrEmpty(room.HostConnectionId)
        || room.HostConnectionId == connectionId;

    // Validates a user-supplied Jira domain by parsing it as a URI and checking the
    // *parsed host* (not the raw string) ends with .atlassian.net. This blocks SSRF
    // tricks like embedded credentials (x.atlassian.net@10.0.0.1) or path/query
    // suffixes (10.0.0.1/x?.atlassian.net) that a plain Contains/EndsWith on the raw
    // string would miss. Returns the clean host to use for outbound requests.
    private static bool TryValidateJiraDomain(string raw, out string host)
    {
        host = "";
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var trimmed = raw.Replace("https://", "").Replace("http://", "").TrimEnd('/');
        if (!Uri.TryCreate($"https://{trimmed}", UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != "https") return false;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return false;
        if (!uri.Host.EndsWith(".atlassian.net", StringComparison.OrdinalIgnoreCase)) return false;

        host = uri.Host;
        return true;
    }

    // Small stable hash (string.GetHashCode is randomized per-process in .NET, which would
    // make the "same room + same day -> same word" pick vary across server restarts before
    // it gets cached onto the room).
    private static int StableHash(string s)
    {
        unchecked
        {
            int hash = 17;
            foreach (char c in s) hash = hash * 31 + c;
            return hash;
        }
    }

    private static string TodayUtc() => DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    // =====================================================================
    // Per-game settings. Every gameplay value that used to be hardcoded in a
    // generator or client (grid size, word lengths, word counts, guess
    // allowance, scoring bonuses) is now per-room and locked in for the UTC day
    // by whoever configures the game first — the same "first to arrive" mechanic
    // Wordle has always used. Anyone in the room can be that first configurer;
    // it is deliberately not a host privilege. Host-only reshuffles
    // (*NewGame/*SetMode) reuse whatever settings the day was configured with.
    //
    // Settings travel as a flat name->int map in both directions (booleans ride
    // as 0/1) so one hub method, one client form and one state-payload shape
    // serve all seven games. Every value is re-clamped server-side against the
    // same Options.Normalized() the generators use, so a hand-crafted client can
    // only ever produce a puzzle that actually generates.
    // =====================================================================
    private static readonly string[] ConfigurableGames =
        { "wordle", "crossword", "hangman", "wordsearch", "spellingbee", "jumble", "acrostic", "connections" };

    // Hangman's word length bounds aren't a generator concern (it just picks from the pool),
    // so they're clamped here against what the common-word pool can plausibly serve.
    private const int HangmanMinWordLength = 3;
    private const int HangmanMaxWordLength = 15;
    private const int HangmanMinWrong = 3;
    private const int HangmanMaxWrongCap = 12;

    private static int Setting(IReadOnlyDictionary<string, int>? s, string key, int fallback)
        => s != null && s.TryGetValue(key, out var v) ? v : fallback;

    private static bool SettingFlag(IReadOnlyDictionary<string, int>? s, string key, bool fallback)
        => s != null && s.TryGetValue(key, out var v) ? v != 0 : fallback;

    // True when nobody has set today's puzzle up yet — a stale (non-today) puzzle id. Drives
    // the client's setup form (see the *NeedsSetup flags on BuildRoomState).
    private static bool GameNeedsSetup(Room room, string game) => game switch
    {
        "wordle" => room.WordlePuzzleId != TodayUtc(),
        "crossword" => room.CrosswordPuzzleId != TodayUtc(),
        "hangman" => room.HangmanPuzzleId != TodayUtc(),
        "wordsearch" => room.WordSearchPuzzleId != TodayUtc(),
        "spellingbee" => room.SpellingBeePuzzleId != TodayUtc(),
        "jumble" => room.JumblePuzzleId != TodayUtc(),
        "acrostic" => room.AcrosticPuzzleId != TodayUtc(),
        "connections" => room.ConnectionsPuzzleId != TodayUtc(),
        _ => false,
    };

    // The room's locked-in settings for one game, in the same flat shape GameConfigure accepts.
    // Rides on every BuildRoomState so the client's setup form pre-fills with the room's current
    // values, and so an already-configured game can show what it was set to.
    private static Dictionary<string, int> GameSettingsPayload(Room room, string game) => game switch
    {
        "wordle" => new Dictionary<string, int>
        {
            ["lengthMode"] = room.WordleLengthMode == "UpTo" ? 1 : 0,
            ["length"] = room.WordleLength,
            ["maxGuesses"] = room.WordleMaxGuesses,
        },
        "crossword" => new Dictionary<string, int>
        {
            ["size"] = room.CrosswordSize,
        },
        "hangman" => new Dictionary<string, int>
        {
            ["maxWrong"] = room.HangmanMaxWrong,
            ["minLength"] = room.HangmanMinLength,
            ["maxLength"] = room.HangmanMaxLength,
            ["showClue"] = room.HangmanShowClue ? 1 : 0,
        },
        "wordsearch" => new Dictionary<string, int>
        {
            ["size"] = room.WordSearchSize,
            ["wordCount"] = room.WordSearchWordCount,
            ["minLength"] = room.WordSearchMinLength,
            ["maxLength"] = room.WordSearchMaxLength,
            ["allowDiagonal"] = room.WordSearchAllowDiagonal ? 1 : 0,
            ["allowReverse"] = room.WordSearchAllowReverse ? 1 : 0,
        },
        "spellingbee" => new Dictionary<string, int>
        {
            ["letterCount"] = room.SpellingBeeLetterCount,
            ["minWordLength"] = room.SpellingBeeMinWordLength,
            ["pangramBonus"] = room.SpellingBeePangramBonus,
        },
        "jumble" => new Dictionary<string, int>
        {
            ["wordCount"] = room.JumbleWordCount,
            ["minLength"] = room.JumbleMinLength,
            ["maxLength"] = room.JumbleMaxLength,
        },
        "acrostic" => new Dictionary<string, int>
        {
            ["maxQuoteLength"] = room.AcrosticMaxQuoteLength,
        },
        "connections" => new Dictionary<string, int>
        {
            ["categoryCount"] = room.ConnectionsCategoryCount,
            ["wordsPerCategory"] = room.ConnectionsWordsPerCategory,
            ["mistakesAllowed"] = room.ConnectionsMistakesAllowed,
            ["difficulty"] = room.ConnectionsDifficulty,
        },
        _ => new Dictionary<string, int>(),
    };

    // The clamp ranges ApplyGameSettings enforces, shipped to the client so each game's setup
    // form can render the right inputs (and the right min/max) from one source of truth. Purely
    // advisory — the server re-clamps everything regardless of what the client sends.
    private static object GameLimitsPayload(WordListService wordList) => new
    {
        wordle = new
        {
            allowedLengths = wordList.AllowedWordleLengths,
            maxGuesses = new { min = 3, max = 10 },
        },
        crossword = new
        {
            size = new { min = CrosswordGenerator.MinSize, max = CrosswordGenerator.MaxSize },
        },
        hangman = new
        {
            maxWrong = new { min = HangmanMinWrong, max = HangmanMaxWrongCap },
            wordLength = new { min = HangmanMinWordLength, max = HangmanMaxWordLength },
        },
        wordsearch = new
        {
            size = new { min = WordSearchOptions.MinGridSize, max = WordSearchOptions.MaxGridSize },
            wordCount = new { min = WordSearchOptions.MinWordCount, max = WordSearchOptions.MaxWordCount },
            wordLength = new { min = WordSearchOptions.MinWordLength, max = WordSearchOptions.MaxWordLength },
        },
        spellingbee = new
        {
            letterCount = new { min = SpellingBeeOptions.MinLetterCount, max = SpellingBeeOptions.MaxLetterCount },
            minWordLength = new { min = SpellingBeeOptions.MinMinWordLength, max = SpellingBeeOptions.MaxMinWordLength },
            pangramBonus = new { min = 0, max = SpellingBeeOptions.MaxPangramBonus },
        },
        jumble = new
        {
            wordCount = new { min = JumbleOptions.MinWordCount, max = JumbleOptions.MaxWordCount },
            wordLength = new { min = JumbleOptions.MinWordLength, max = JumbleOptions.MaxWordLength },
        },
        acrostic = new
        {
            // 0 = no limit; the ceiling is the longest quote in the bank, past which the
            // setting stops making any difference.
            maxQuoteLength = new { min = 0, max = AcrosticPuzzles.Puzzles.Max(p => p.Quote.Length) },
        },
        connections = new
        {
            categoryCount = new { min = ConnectionsOptions.MinCategoryCount, max = ConnectionsOptions.MaxCategoryCount },
            wordsPerCategory = new { min = ConnectionsOptions.MinWordsPerCategory, max = ConnectionsOptions.MaxWordsPerCategory },
            mistakesAllowed = new { min = ConnectionsOptions.MinMistakesAllowed, max = ConnectionsOptions.MaxMistakesAllowed },
            difficulty = new { min = ConnectionsOptions.MinDifficulty, max = ConnectionsOptions.MaxDifficulty },
        },
    };

    // Writes a client-supplied settings map onto the room, clamping every value. Anything the
    // client omits keeps the room's existing value, so a partial map is a valid patch. Must be
    // called while holding `lock (room)`.
    private void ApplyGameSettings(Room room, string game, IReadOnlyDictionary<string, int>? s)
    {
        switch (game)
        {
            case "wordle":
            {
                var allowed = _wordList.AllowedWordleLengths.Length > 0 ? _wordList.AllowedWordleLengths : new[] { 5 };
                var length = Setting(s, "length", room.WordleLength);
                room.WordleLengthMode = Setting(s, "lengthMode", room.WordleLengthMode == "UpTo" ? 1 : 0) == 1 ? "UpTo" : "Fixed";
                room.WordleLength = allowed.Contains(length) ? length : allowed[0];
                room.WordleMaxGuesses = Math.Clamp(Setting(s, "maxGuesses", room.WordleMaxGuesses), 3, 10);
                break;
            }
            case "crossword":
                room.CrosswordSize = CrosswordGenerator.ClampSize(Setting(s, "size", room.CrosswordSize));
                break;
            case "hangman":
            {
                var min = Math.Clamp(Setting(s, "minLength", room.HangmanMinLength), HangmanMinWordLength, HangmanMaxWordLength);
                var max = Math.Clamp(Setting(s, "maxLength", room.HangmanMaxLength), min, HangmanMaxWordLength);
                room.HangmanMinLength = min;
                room.HangmanMaxLength = max;
                room.HangmanMaxWrong = Math.Clamp(Setting(s, "maxWrong", room.HangmanMaxWrong), HangmanMinWrong, HangmanMaxWrongCap);
                room.HangmanShowClue = SettingFlag(s, "showClue", room.HangmanShowClue);
                break;
            }
            case "wordsearch":
            {
                var opts = new WordSearchOptions
                {
                    Size = Setting(s, "size", room.WordSearchSize),
                    WordCount = Setting(s, "wordCount", room.WordSearchWordCount),
                    MinLength = Setting(s, "minLength", room.WordSearchMinLength),
                    MaxLength = Setting(s, "maxLength", room.WordSearchMaxLength),
                    AllowDiagonal = SettingFlag(s, "allowDiagonal", room.WordSearchAllowDiagonal),
                    AllowReverse = SettingFlag(s, "allowReverse", room.WordSearchAllowReverse),
                }.Normalized();
                room.WordSearchSize = opts.Size;
                room.WordSearchWordCount = opts.WordCount;
                room.WordSearchMinLength = opts.MinLength;
                room.WordSearchMaxLength = opts.MaxLength;
                room.WordSearchAllowDiagonal = opts.AllowDiagonal;
                room.WordSearchAllowReverse = opts.AllowReverse;
                break;
            }
            case "spellingbee":
            {
                var opts = new SpellingBeeOptions
                {
                    LetterCount = Setting(s, "letterCount", room.SpellingBeeLetterCount),
                    MinWordLength = Setting(s, "minWordLength", room.SpellingBeeMinWordLength),
                    PangramBonus = Setting(s, "pangramBonus", room.SpellingBeePangramBonus),
                }.Normalized();
                room.SpellingBeeLetterCount = opts.LetterCount;
                room.SpellingBeeMinWordLength = opts.MinWordLength;
                room.SpellingBeePangramBonus = opts.PangramBonus;
                break;
            }
            case "jumble":
            {
                var opts = new JumbleOptions
                {
                    WordCount = Setting(s, "wordCount", room.JumbleWordCount),
                    MinLength = Setting(s, "minLength", room.JumbleMinLength),
                    MaxLength = Setting(s, "maxLength", room.JumbleMaxLength),
                }.Normalized();
                room.JumbleWordCount = opts.WordCount;
                room.JumbleMinLength = opts.MinLength;
                room.JumbleMaxLength = opts.MaxLength;
                break;
            }
            case "acrostic":
                // 0 means "any length"; anything else is a ceiling on the quote's character
                // count. Clamped to the shortest quote in the bank so a too-low value still
                // leaves AcrosticCandidates something to pick.
                room.AcrosticMaxQuoteLength = Math.Max(0, Setting(s, "maxQuoteLength", room.AcrosticMaxQuoteLength));
                break;
            case "connections":
            {
                var opts = new ConnectionsOptions
                {
                    CategoryCount = Setting(s, "categoryCount", room.ConnectionsCategoryCount),
                    WordsPerCategory = Setting(s, "wordsPerCategory", room.ConnectionsWordsPerCategory),
                    MistakesAllowed = Setting(s, "mistakesAllowed", room.ConnectionsMistakesAllowed),
                    Difficulty = Setting(s, "difficulty", room.ConnectionsDifficulty),
                }.Normalized();
                room.ConnectionsCategoryCount = opts.CategoryCount;
                room.ConnectionsWordsPerCategory = opts.WordsPerCategory;
                room.ConnectionsMistakesAllowed = opts.MistakesAllowed;
                room.ConnectionsDifficulty = opts.Difficulty;
                break;
            }
        }
    }

    // (Re)generates one game's puzzle from the room's currently locked-in settings and clears
    // that game's progress. seedSuffix is empty for the day's first generation (so the same room
    // on the same day with the same settings gets the same puzzle across restarts) and a fresh
    // GUID for host reshuffles. Must be called while holding `lock (room)`.
    private void RegenerateGame(Room room, string game, string seedSuffix = "")
    {
        var today = TodayUtc();
        switch (game)
        {
            case "wordle":
                room.WordlePuzzleId = today;
                PickWordleWord(room, seedSuffix);
                room.WordleStates.Clear();
                break;

            case "crossword":
            {
                var puzzle = _crosswordGen.Generate(StableHash(room.Id + "-crossword-" + today + seedSuffix), room.CrosswordSize);
                room.CrosswordRows = puzzle.Rows;
                room.CrosswordAcrossClues = puzzle.AcrossClues;
                room.CrosswordDownClues = puzzle.DownClues;
                room.CrosswordPuzzleId = today;
                room.CrosswordCells.Clear();
                room.CrosswordCellFiller.Clear();
                room.CrosswordCompetitiveStates.Clear();
                break;
            }

            case "hangman":
            {
                var rng = new Random(StableHash(room.Id + "-hangman-" + today + seedSuffix));
                var lengths = _wordList.CommonByLength.Keys
                    .Where(l => l >= room.HangmanMinLength && l <= room.HangmanMaxLength).ToArray();
                var length = lengths.Length > 0 ? lengths[rng.Next(lengths.Length)] : room.HangmanMinLength;
                var pool = _wordList.CommonByLength.TryGetValue(length, out var words) && words.Length > 0 ? words : WordleWords.Answers;
                var word = pool[rng.Next(pool.Length)].ToUpperInvariant();

                room.HangmanPuzzleId = today;
                room.HangmanWord = word;
                room.HangmanClue = room.HangmanShowClue && _wordList.Definitions.TryGetValue(word, out var def) && !string.IsNullOrWhiteSpace(def) ? def : null;
                room.HangmanGuessedLetters.Clear();
                room.HangmanWrongCount = 0;
                room.HangmanGuessedBy.Clear();
                room.HangmanCompetitiveStates.Clear();
                break;
            }

            case "wordsearch":
            {
                var puzzle = _wordSearchGen.Generate(StableHash(room.Id + "-wordsearch-" + today + seedSuffix), new WordSearchOptions
                {
                    Size = room.WordSearchSize,
                    WordCount = room.WordSearchWordCount,
                    MinLength = room.WordSearchMinLength,
                    MaxLength = room.WordSearchMaxLength,
                    AllowDiagonal = room.WordSearchAllowDiagonal,
                    AllowReverse = room.WordSearchAllowReverse,
                });
                room.WordSearchGridRows = puzzle.GridRows;
                room.WordSearchWords = puzzle.Words;
                room.WordSearchSolutions = puzzle.Solutions;
                room.WordSearchPuzzleId = today;
                room.WordSearchFound.Clear();
                room.WordSearchCompetitiveStates.Clear();
                break;
            }

            case "spellingbee":
            {
                var puzzle = _spellingBeeGen.Generate(StableHash(room.Id + "-spellingbee-" + today + seedSuffix), new SpellingBeeOptions
                {
                    LetterCount = room.SpellingBeeLetterCount,
                    MinWordLength = room.SpellingBeeMinWordLength,
                    PangramBonus = room.SpellingBeePangramBonus,
                });
                room.SpellingBeeLetters = puzzle.Letters;
                room.SpellingBeeValidWords = puzzle.ValidWords;
                room.SpellingBeePangrams = puzzle.Pangrams;
                room.SpellingBeePuzzleId = today;
                room.SpellingBeeStates.Clear();
                room.SpellingBeeSharedFound.Clear();
                room.SpellingBeeSharedScore = 0;
                break;
            }

            case "jumble":
            {
                var puzzle = _jumbleGen.Generate(StableHash(room.Id + "-jumble-" + today + seedSuffix), new JumbleOptions
                {
                    WordCount = room.JumbleWordCount,
                    MinLength = room.JumbleMinLength,
                    MaxLength = room.JumbleMaxLength,
                });
                room.JumbleScrambled = puzzle.Scrambled;
                room.JumbleWords = puzzle.Words;
                room.JumbleMarkedIndex = puzzle.MarkedIndex;
                room.JumbleFinalAnswer = puzzle.FinalAnswer;
                room.JumblePuzzleId = today;
                room.JumbleStates.Clear();
                room.JumbleSharedState = null;
                break;
            }

            case "acrostic":
            {
                var rng = new Random(StableHash(room.Id + "-acrostic-" + today + seedSuffix));
                var candidates = AcrosticCandidates(room.AcrosticMaxQuoteLength);
                room.AcrosticIndex = candidates[rng.Next(candidates.Length)];
                room.AcrosticPuzzleId = today;
                room.AcrosticCells.Clear();
                room.AcrosticCellFiller.Clear();
                room.AcrosticCompetitiveStates.Clear();
                break;
            }

            case "connections":
            {
                var puzzle = _connectionsGen.Generate(StableHash(room.Id + "-connections-" + today + seedSuffix), new ConnectionsOptions
                {
                    CategoryCount = room.ConnectionsCategoryCount,
                    WordsPerCategory = room.ConnectionsWordsPerCategory,
                    MistakesAllowed = room.ConnectionsMistakesAllowed,
                    Difficulty = room.ConnectionsDifficulty,
                });
                room.ConnectionsWords = puzzle.Words;
                room.ConnectionsCategories = puzzle.Categories;
                room.ConnectionsPuzzleId = today;
                room.ConnectionsStates.Clear();
                room.ConnectionsSharedState = null;
                break;
            }
        }
    }

    // Acrostic is the one game with a hand-authored puzzle bank rather than a generator, so its
    // single tunable is which of those puzzles are eligible: indexes whose quote fits within
    // maxQuoteLength characters (0 = no limit). Never returns empty — a limit shorter than every
    // quote in the bank falls back to the shortest one.
    private static int[] AcrosticCandidates(int maxQuoteLength)
    {
        var all = Enumerable.Range(0, AcrosticPuzzles.Puzzles.Length).ToArray();
        if (maxQuoteLength <= 0) return all;
        var fitting = all.Where(i => AcrosticPuzzles.Puzzles[i].Quote.Length <= maxQuoteLength).ToArray();
        if (fitting.Length > 0) return fitting;
        return new[] { all.OrderBy(i => AcrosticPuzzles.Puzzles[i].Quote.Length).First() };
    }

    // Date-rollover cleanup for one game: a stale (non-today) puzzle id means the day turned
    // over, so the puzzle and everyone's progress are dropped and the game goes back to
    // "needs setup". Deliberately does NOT auto-pick a new puzzle — that is GameConfigure's
    // job, so the room chooses the day's settings before the day's puzzle exists. Must be
    // called while holding `lock (room)`.
    private static void EnsureGamePuzzle(Room room, string game)
    {
        var today = TodayUtc();
        switch (game)
        {
            case "wordle":
                if (room.WordlePuzzleId != null && room.WordlePuzzleId != today)
                {
                    room.WordlePuzzleId = null;
                    room.WordleWord = null;
                    room.WordleStates.Clear();
                }
                break;
            case "crossword":
                if (room.CrosswordPuzzleId != null && room.CrosswordPuzzleId != today)
                {
                    room.CrosswordPuzzleId = null;
                    room.CrosswordRows = null;
                    room.CrosswordAcrossClues = null;
                    room.CrosswordDownClues = null;
                    room.CrosswordCells.Clear();
                    room.CrosswordCellFiller.Clear();
                    room.CrosswordCompetitiveStates.Clear();
                }
                break;
            case "hangman":
                if (room.HangmanPuzzleId != null && room.HangmanPuzzleId != today)
                {
                    room.HangmanPuzzleId = null;
                    room.HangmanWord = null;
                    room.HangmanClue = null;
                    room.HangmanGuessedLetters.Clear();
                    room.HangmanWrongCount = 0;
                    room.HangmanGuessedBy.Clear();
                    room.HangmanCompetitiveStates.Clear();
                }
                break;
            case "wordsearch":
                if (room.WordSearchPuzzleId != null && room.WordSearchPuzzleId != today)
                {
                    room.WordSearchPuzzleId = null;
                    room.WordSearchGridRows = Array.Empty<string>();
                    room.WordSearchWords = Array.Empty<string>();
                    room.WordSearchSolutions.Clear();
                    room.WordSearchFound.Clear();
                    room.WordSearchCompetitiveStates.Clear();
                }
                break;
            case "spellingbee":
                if (room.SpellingBeePuzzleId != null && room.SpellingBeePuzzleId != today)
                {
                    room.SpellingBeePuzzleId = null;
                    room.SpellingBeeLetters = string.Empty;
                    room.SpellingBeeValidWords.Clear();
                    room.SpellingBeePangrams.Clear();
                    room.SpellingBeeStates.Clear();
                    room.SpellingBeeSharedFound.Clear();
                    room.SpellingBeeSharedScore = 0;
                }
                break;
            case "jumble":
                if (room.JumblePuzzleId != null && room.JumblePuzzleId != today)
                {
                    room.JumblePuzzleId = null;
                    room.JumbleScrambled = Array.Empty<string>();
                    room.JumbleWords = Array.Empty<string>();
                    room.JumbleMarkedIndex = Array.Empty<int>();
                    room.JumbleFinalAnswer = null;
                    room.JumbleStates.Clear();
                    room.JumbleSharedState = null;
                }
                break;
            case "acrostic":
                if (room.AcrosticPuzzleId != null && room.AcrosticPuzzleId != today)
                {
                    room.AcrosticPuzzleId = null;
                    room.AcrosticIndex = -1;
                    room.AcrosticCells.Clear();
                    room.AcrosticCellFiller.Clear();
                    room.AcrosticCompetitiveStates.Clear();
                }
                break;
            case "connections":
                if (room.ConnectionsPuzzleId != null && room.ConnectionsPuzzleId != today)
                {
                    room.ConnectionsPuzzleId = null;
                    room.ConnectionsWords.Clear();
                    room.ConnectionsCategories.Clear();
                    room.ConnectionsStates.Clear();
                    room.ConnectionsSharedState = null;
                }
                break;
        }
    }

    // Sends the game's own existing *Reset event so already-open clients pick up the new
    // puzzle's shape immediately. Every game already had one of these for its host reshuffle;
    // GameConfigure reuses them rather than inventing a parallel channel.
    private async Task SendGameReset(string roomName, Room room, string game)
    {
        switch (game)
        {
            case "wordle":
                await Clients.Group(roomName).SendAsync("WordleReset", room.WordleWord?.Length ?? 0);
                break;
            case "crossword":
                await Clients.Group(roomName).SendAsync("CrosswordReset", room.CrosswordPuzzleId, BuildCrosswordLayoutPayload(CurrentCrosswordPuzzle(room)));
                break;
            case "hangman":
                await Clients.Group(roomName).SendAsync("HangmanReset", room.HangmanWord?.Length ?? 0, room.HangmanClue, room.HangmanMaxWrong);
                break;
            case "wordsearch":
                await Clients.Group(roomName).SendAsync("WordSearchReset", room.WordSearchPuzzleId, room.WordSearchGridRows, room.WordSearchWords);
                break;
            case "spellingbee":
                await Clients.Group(roomName).SendAsync("SpellingBeeReset", room.SpellingBeePuzzleId, room.SpellingBeeLetters);
                break;
            case "jumble":
                await Clients.Group(roomName).SendAsync("JumbleReset", room.JumbleScrambled, room.JumbleMarkedIndex);
                break;
            case "acrostic":
                await Clients.Group(roomName).SendAsync("AcrosticReset", room.AcrosticPuzzleId, BuildAcrosticLayoutPayload(CurrentAcrosticPuzzle(room)));
                break;
            case "connections":
                await Clients.Group(roomName).SendAsync("ConnectionsReset", room.ConnectionsPuzzleId, room.ConnectionsWords, room.ConnectionsMistakesAllowed);
                break;
        }
    }

    // Host-only reshuffle of an already-configured game, keeping the day's locked-in settings.
    // Shared by every *NewGame method. Returns false when the game hasn't been set up today
    // (nothing to reshuffle — the caller's client is showing the setup form instead).
    private async Task<bool> ReshuffleGame(string game, string seedSuffix)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return false;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return false;

        lock (room)
        {
            EnsureGamePuzzle(room, game);
            if (GameNeedsSetup(room, game)) return false;
            RegenerateGame(room, game, seedSuffix);
        }
        _roomService.SaveRoom(room);
        await SendGameReset(roomName, room, game);
        return true;
    }

    // First participant to configure a game for the day locks its settings in for everyone else
    // that day (re-checked under `lock(room)` so two near-simultaneous first-openers can't both
    // configure — whichever wins is "first", the loser's submission is silently dropped since
    // the day is already set). Anyone can call this; it's a "first to arrive" mechanic, not a
    // host privilege.
    public async Task GameConfigure(string game, Dictionary<string, int>? settings)
    {
        if (RateLimited("gameConfigure", TimeSpan.FromSeconds(1))) return;
        game = (game ?? string.Empty).ToLowerInvariant();
        if (!ConfigurableGames.Contains(game)) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool changed;
        lock (room)
        {
            EnsureGamePuzzle(room, game);
            if (!GameNeedsSetup(room, game))
            {
                changed = false;
            }
            else
            {
                ApplyGameSettings(room, game, settings);
                RegenerateGame(room, game);
                changed = true;
            }
        }

        if (changed)
        {
            _roomService.SaveRoom(room);
            await Clients.Group(roomName).SendAsync("GameConfigured", game, GameSettingsPayload(room, game));
            await SendGameReset(roomName, room, game);
        }
    }

    // Wordle: date-rollover cleanup only — does NOT auto-pick a puzzle. A stale (non-today)
    // WordlePuzzleId is the "no one has configured today's game yet" signal that BuildRoomState
    // reports to clients as wordleNeedsSetup; the first participant to call WordleConfigure
    // for the day locks in the settings and picks the word (see WordleConfigure below). Must
    // be called while holding `lock (room)`.
    private static void EnsureWordlePuzzle(Room room) => EnsureGamePuzzle(room, "wordle");

    // Wordle: picks today's word from the configured length mode/length. "Fixed" always uses
    // WordleLength; "UpTo" (when WordleLength > 5) randomly picks one of the allowed lengths
    // from 5..WordleLength, so the actual daily word length can vary within that range —
    // UpTo(5) has nowhere to vary and behaves exactly like Fixed(5). Must be called while
    // holding `lock (room)`, with WordlePuzzleId/WordleLengthMode/WordleLength already set.
    private void PickWordleWord(Room room, string seedSuffix = "")
    {
        var rng = new Random(StableHash(room.Id + room.WordlePuzzleId + room.WordleLengthMode + room.WordleLength + seedSuffix));
        var length = room.WordleLength;
        if (room.WordleLengthMode == "UpTo" && length > 5)
        {
            var options = _wordList.AllowedWordleLengths.Where(l => l <= length).ToArray();
            if (options.Length > 0) length = options[rng.Next(options.Length)];
        }

        var pool = _wordList.CommonByLength.TryGetValue(length, out var words) && words.Length > 0
            ? words
            : WordleWords.Answers;
        room.WordleWord = pool[rng.Next(pool.Length)];
    }

    // Wordle: standard green/yellow/gray scoring against the answer, handling duplicate
    // letters the same way the real game does (two-pass: exact matches first, then
    // leftover-letter matches consume leftover answer positions). Length-agnostic — driven by
    // the answer's actual length, not a hardcoded 5.
    private static string[] ScoreWordleGuess(string guess, string answer)
    {
        var len = answer.Length;
        var result = new string[len];
        var consumed = new bool[len];
        for (int i = 0; i < len; i++)
        {
            if (guess[i] == answer[i]) { result[i] = "green"; consumed[i] = true; }
        }
        for (int i = 0; i < len; i++)
        {
            if (result[i] != null) continue;
            var found = false;
            for (int j = 0; j < len; j++)
            {
                if (!consumed[j] && guess[i] == answer[j]) { consumed[j] = true; found = true; break; }
            }
            result[i] = found ? "yellow" : "gray";
        }
        return result;
    }

    // Wordle's first-to-arrive setup now runs through the shared GameConfigure entry point
    // above (game "wordle", settings lengthMode/length/maxGuesses) alongside the other six
    // games, rather than through a bespoke WordleConfigure of its own.

    // Wordle: shared per-room daily puzzle. Guesses stay private to the guesser (sent only
    // to Clients.Caller); once someone finishes, a status-only summary (no word, no guesses)
    // is broadcast so the room can see who's playing/done without anyone getting spoiled.
    // Rejects guesses that aren't real words (dictionary check) without consuming an attempt.
    public async Task WordleGuess(string guess)
    {
        if (string.IsNullOrEmpty(guess) || !guess.All(char.IsLetter)) return;
        if (RateLimited("wordleGuess", TimeSpan.FromMilliseconds(300))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        guess = guess.ToUpperInvariant();
        string[]? feedback = null;
        bool justFinished = false;
        bool rejected = false;
        int maxGuesses = 0;
        WordlePlayerState? state = null;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureWordlePuzzle(room);
            var today = TodayUtc();
            if (room.WordlePuzzleId != today || room.WordleWord == null) return; // not configured yet today
            if (guess.Length != room.WordleWord.Length) return;

            maxGuesses = room.WordleMaxGuesses;
            if (!_wordList.IsValidWord(guess))
            {
                rejected = true;
            }
            else
            {
                if (!room.WordleStates.TryGetValue(participantName, out state!))
                {
                    state = new WordlePlayerState();
                    room.WordleStates[participantName] = state;
                }
                if (state.Solved || state.Failed || state.Guesses.Count >= maxGuesses) return;

                feedback = ScoreWordleGuess(guess, room.WordleWord);
                state.Guesses.Add(guess);
                if (guess == room.WordleWord)
                {
                    state.Solved = true;
                    state.FinishedAt = DateTime.UtcNow;
                    justFinished = true;
                }
                else if (state.Guesses.Count >= maxGuesses)
                {
                    state.Failed = true;
                    state.FinishedAt = DateTime.UtcNow;
                    justFinished = true;
                }

                if (justFinished)
                {
                    UpsertDailyStandings(room, "wordle", WordleStandings(room));
                    badges = ComputeDailyBadges(room);
                }
            }
        }

        if (rejected)
        {
            await Clients.Caller.SendAsync("WordleGuessRejected", guess);
            return;
        }
        if (state == null || feedback == null) return;

        _roomService.SaveRoom(room);
        await Clients.Caller.SendAsync("WordleGuessResult", guess, feedback, state.Solved, state.Failed, state.Guesses.Count, maxGuesses);

        if (justFinished)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            await Clients.Group(roomName).SendAsync("WordleStatusUpdate", new
            {
                name = participantName,
                solved = state.Solved,
                failed = state.Failed,
                attempts = state.Guesses.Count,
                maxGuesses
            });
            if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
        }
    }

    // Wordle: host-only manual reshuffle — resets everyone's in-progress puzzle for the room,
    // same restriction tier as SetRoomIcon/HostFreeChair since it disrupts other players.
    // Preserves the day's locked-in length mode/length/max-guesses; only re-picks the word.
    public async Task WordleNewGame() => await ReshuffleGame("wordle", Guid.NewGuid().ToString());

    // Crossword: builds the client-facing layout payload for a puzzle — structure, clue
    // numbers/text — with the solution grid never included. Shared by BuildRoomState (initial
    // load) and CrosswordNewGame's broadcast (so already-open clients pick up the new puzzle's
    // clues/black-cell shape immediately instead of only seeing their cells clear).
    private static object BuildCrosswordLayoutPayload(CrosswordPuzzle puzzle)
    {
        var across = new List<object>();
        var down = new List<object>();
        int aIdx = 0, dIdx = 0;
        foreach (var entry in CrosswordGenerator.ComputeLayout(puzzle.Rows))
        {
            if (entry.Direction == 'A')
                across.Add(new { number = entry.Number, row = entry.Row, col = entry.Col, length = entry.Length, clue = puzzle.AcrossClues[aIdx++] });
            else
                down.Add(new { number = entry.Number, row = entry.Row, col = entry.Col, length = entry.Length, clue = puzzle.DownClues[dIdx++] });
        }
        // Grid size comes from the puzzle itself, not a constant — the room's configured
        // crossword size can be anything from CrosswordGenerator.MinSize to MaxSize, and an
        // un-configured room has no puzzle at all (size 0, empty lists).
        var size = puzzle.Rows.Length;
        var black = new List<int[]>();
        for (int r = 0; r < size; r++)
            for (int c = 0; c < size; c++)
                if (puzzle.Rows[r][c] == '#') black.Add(new[] { r, c });
        return new { size, black, across, down };
    }

    private static CrosswordPuzzle CurrentCrosswordPuzzle(Room room) => new CrosswordPuzzle
    {
        Rows = room.CrosswordRows ?? Array.Empty<string>(),
        AcrossClues = room.CrosswordAcrossClues ?? Array.Empty<string>(),
        DownClues = room.CrosswordDownClues ?? Array.Empty<string>(),
    };

    private static void EnsureCrosswordPuzzle(Room room) => EnsureGamePuzzle(room, "crossword");

    // Competitive: placement = earliest solver first, then anyone with ≥1 filled cell gets
    // participation, mirrors WordleStandings.
    private static List<string> CrosswordCompetitiveStandings(Room room)
    {
        var ranked = room.CrosswordCompetitiveStates.Where(kv => kv.Value.Solved)
            .OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        ranked.AddRange(room.CrosswordCompetitiveStates.Where(kv => !kv.Value.Solved && kv.Value.Cells.Count > 0)
            .Select(kv => kv.Key));
        return ranked;
    }

    private static bool IsCrosswordSolved(CrosswordPuzzle puzzle, Dictionary<string, string> cells)
    {
        var size = puzzle.Rows.Length;
        if (size == 0) return false; // not configured today — nothing to solve
        for (int r = 0; r < size; r++)
        {
            for (int c = 0; c < size; c++)
            {
                if (puzzle.Rows[r][c] == '#') continue;
                if (!cells.TryGetValue($"{r},{c}", out var v) || v.Length == 0 || v[0] != puzzle.Rows[r][c]) return false;
            }
        }
        return true;
    }

    // Crossword: shared collaborative fill — anyone in the room can fill any cell, and fills
    // are broadcast live to everyone (not private, unlike Wordle guesses) since this is
    // cooperative, not competitive. An empty letter clears the cell.
    public async Task CrosswordFill(int row, int col, string letter)
    {
        if (RateLimited("cwFill", TimeSpan.FromMilliseconds(30))) return;
        if (row < 0 || col < 0) return; // upper bound depends on the room's grid size, checked under the lock
        letter = (letter ?? string.Empty).ToUpperInvariant();
        if (letter.Length > 1 || (letter.Length == 1 && !char.IsLetter(letter[0]))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool correct = false;
        bool justSolved;
        bool competitive = false;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureCrosswordPuzzle(room);
            if (GameNeedsSetup(room, "crossword")) return; // nobody has configured today's grid yet
            var puzzle = CurrentCrosswordPuzzle(room);
            if (row >= puzzle.Rows.Length || col >= puzzle.Rows.Length) return;
            if (puzzle.Rows[row][col] == '#') return;

            var key = $"{row},{col}";
            competitive = room.CrosswordMode == "competitive";

            if (competitive)
            {
                if (!room.CrosswordCompetitiveStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new GridFillPlayerState();
                    room.CrosswordCompetitiveStates[participantName] = pstate;
                }
                if (pstate.Solved) return; // already finished — ignore further edits

                var wasSolved = IsCrosswordSolved(puzzle, pstate.Cells);
                if (letter.Length == 0) pstate.Cells.Remove(key);
                else { pstate.Cells[key] = letter; correct = letter[0] == puzzle.Rows[row][col]; }
                justSolved = !wasSolved && IsCrosswordSolved(puzzle, pstate.Cells);
                if (justSolved)
                {
                    pstate.Solved = true;
                    pstate.FinishedAt = DateTime.UtcNow;
                }

                UpsertDailyStandings(room, "crossword", CrosswordCompetitiveStandings(room));
                badges = ComputeDailyBadges(room);
            }
            else
            {
                var wasSolved = IsCrosswordSolved(puzzle, room.CrosswordCells);
                if (letter.Length == 0)
                {
                    room.CrosswordCells.Remove(key);
                    room.CrosswordCellFiller.Remove(key);
                }
                else
                {
                    room.CrosswordCells[key] = letter;
                    room.CrosswordCellFiller[key] = participantName;
                    correct = letter[0] == puzzle.Rows[row][col];
                }
                justSolved = !wasSolved && IsCrosswordSolved(puzzle, room.CrosswordCells);
            }
        }

        _roomService.SaveRoom(room);
        // Unlike WhiteboardDraw (which only needs to reach *other* clients since the caller
        // already drew locally), the caller also needs this: `correct` depends on the solution
        // grid, which never leaves the server, so the caller can't compute it client-side.
        if (competitive)
        {
            await Clients.Caller.SendAsync("CrosswordCellFilled", row, col, letter, correct);
            if (justSolved) await Clients.Caller.SendAsync("CrosswordSolved");
        }
        else
        {
            await Clients.Group(roomName).SendAsync("CrosswordCellFilled", row, col, letter, correct);
            if (justSolved) await Clients.Group(roomName).SendAsync("CrosswordSolved");
        }
        if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
    }

    // Crossword: host-only manual reshuffle, same restriction tier as WordleNewGame/SetRoomIcon.
    public async Task CrosswordNewGame()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        await ReshuffleGame("crossword", Guid.NewGuid().ToString());
    }

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh grid so no
    // one carries progress across a mode switch, same restriction tier as CrosswordNewGame.
    // The regenerated grid keeps the day's locked-in size.
    public async Task CrosswordSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.CrosswordMode = mode; }
        await ReshuffleGame("crossword", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("CrosswordModeChanged", mode);
    }

    private static List<string> CrosswordStandings(Room room, CrosswordPuzzle puzzle)
    {
        var counts = new Dictionary<string, int>();
        foreach (var kv in room.CrosswordCells)
        {
            if (kv.Value.Length != 1 || !room.CrosswordCellFiller.TryGetValue(kv.Key, out var filler)) continue;
            var parts = kv.Key.Split(',');
            var r = int.Parse(parts[0], CultureInfo.InvariantCulture);
            var c = int.Parse(parts[1], CultureInfo.InvariantCulture);
            if (puzzle.Rows[r][c] != kv.Value[0]) continue;
            counts[filler] = counts.TryGetValue(filler, out var v) ? v + 1 : 1;
        }
        return counts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
    }

    private static List<string> WordleStandings(Room room)
    {
        if (room.WordlePuzzleId != TodayUtc()) return new List<string>();
        var ranked = room.WordleStates.Where(kv => kv.Value.Solved).OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        ranked.AddRange(room.WordleStates.Where(kv => !kv.Value.Solved && kv.Value.Guesses.Count > 0).Select(kv => kv.Key));
        return ranked;
    }

    // =====================================================================
    // Leaderboard — one shared append/upsert-only log across all 7 games.
    // Points are placement-based (3/2/1/0.5), never the raw score/time itself.
    // Must be called while holding `lock (room)`.
    // =====================================================================
    private static readonly string[] LeaderboardGames = { "wordle", "crossword", "hangman", "wordsearch", "spellingbee", "jumble", "acrostic", "connections", "predictions" };

    private static void UpsertDailyStandings(Room room, string game, List<string> rankedNames)
    {
        var today = TodayUtc();
        room.LeaderboardLog.RemoveAll(e => e.Date == today && e.Game == game);
        for (var i = 0; i < rankedNames.Count; i++)
        {
            double points = i == 0 ? 3 : i == 1 ? 2 : i == 2 ? 1 : 0.5;
            room.LeaderboardLog.Add(new LeaderboardResultEntry { Game = game, Date = today, Name = rankedNames[i], Points = points });
        }
        var cutoff = DateTime.UtcNow.AddDays(-400).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        room.LeaderboardLog.RemoveAll(e => string.Compare(e.Date, cutoff, StringComparison.Ordinal) < 0);
    }

    // Badges are a pure derived read from today's log slice, never stored on the Room
    // themselves. Gold/silver/bronze per game go to whoever currently holds today's 3/2/1
    // points for that game; the overall daily champion (highest cross-game sum) also gets a
    // crown. Multiple simultaneous badges per person are normal.
    private static Dictionary<string, List<string>> ComputeDailyBadges(Room room)
    {
        var today = TodayUtc();
        var result = new Dictionary<string, List<string>>();
        void Add(string name, string badge)
        {
            if (!result.TryGetValue(name, out var list)) result[name] = list = new List<string>();
            list.Add(badge);
        }

        foreach (var game in LeaderboardGames)
        {
            var entries = room.LeaderboardLog.Where(e => e.Date == today && e.Game == game).ToList();
            if (entries.Count > 0)
            {
                var gold = entries.FirstOrDefault(e => e.Points == 3);
                if (gold != null) Add(gold.Name, "gold-" + game);
                var silver = entries.FirstOrDefault(e => e.Points == 2);
                if (silver != null) Add(silver.Name, "silver-" + game);
                var bronze = entries.FirstOrDefault(e => e.Points == 1);
                if (bronze != null) Add(bronze.Name, "bronze-" + game);
            }
        }

        var overallTotals = new Dictionary<string, double>();
        foreach (var e in room.LeaderboardLog.Where(e => e.Date == today))
            overallTotals[e.Name] = overallTotals.TryGetValue(e.Name, out var v) ? v + e.Points : e.Points;
        if (overallTotals.Count > 0)
        {
            var top = overallTotals.OrderByDescending(kv => kv.Value).First();
            if (top.Value > 0) Add(top.Key, "crown");
        }
        return result;
    }

    // Overall/per-game leaderboard on demand. game == "overall" sums across every game;
    // range selects the log window (today's summary + badges already ride on RoomState).
    public async Task GetLeaderboard(string game, string range)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        List<object> ranked;
        lock (room)
        {
            var today = DateTime.UtcNow.Date;
            var cutoffDays = range switch { "weekly" => 7, "monthly" => 30, _ => int.MaxValue };
            IEnumerable<LeaderboardResultEntry> entries = room.LeaderboardLog;
            if (game != "overall") entries = entries.Where(e => e.Game == game);
            if (cutoffDays != int.MaxValue)
            {
                entries = entries.Where(e => DateTime.TryParse(e.Date, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                    && (today - d).TotalDays < cutoffDays);
            }
            else if (range == "daily")
            {
                var todayStr = TodayUtc();
                entries = entries.Where(e => e.Date == todayStr);
            }

            ranked = entries.GroupBy(e => e.Name)
                .Select(g => new { name = g.Key, points = g.Sum(e => e.Points) })
                .OrderByDescending(x => x.points)
                .Select(x => (object)x)
                .ToList();
        }

        await Clients.Caller.SendAsync("LeaderboardResult", game, range, ranked);
    }

    // =====================================================================
    // Hangman (collaborative) — one word per room per UTC day; every guess is broadcast to
    // the whole room, same live-collaboration model as Crossword.
    // =====================================================================
    private static void EnsureHangmanPuzzle(Room room) => EnsureGamePuzzle(room, "hangman");

    private static string HangmanMasked(Room room)
    {
        if (room.HangmanWord == null) return "";
        return new string(room.HangmanWord.Select(c => room.HangmanGuessedLetters.Contains(c.ToString()) ? c : '_').ToArray());
    }

    private static string HangmanMaskedFor(string word, HashSet<string> guessedLetters)
        => new string(word.Select(c => guessedLetters.Contains(c.ToString()) ? c : '_').ToArray());

    private static List<string> HangmanStandings(Room room)
    {
        if (room.HangmanWord == null) return new List<string>();
        var correctLetters = new HashSet<char>(room.HangmanWord);
        var counts = new Dictionary<string, int>();
        foreach (var kv in room.HangmanGuessedBy)
        {
            if (kv.Key.Length != 1 || !correctLetters.Contains(kv.Key[0])) continue;
            counts[kv.Value] = counts.TryGetValue(kv.Value, out var v) ? v + 1 : 1;
        }
        return counts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
    }

    // Competitive: placement = earliest solver first, then anyone who's failed or is still
    // guessing gets participation, mirrors WordleStandings.
    private static List<string> HangmanCompetitiveStandings(Room room)
    {
        var ranked = room.HangmanCompetitiveStates.Where(kv => kv.Value.Solved)
            .OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        ranked.AddRange(room.HangmanCompetitiveStates.Where(kv => !kv.Value.Solved && kv.Value.GuessedLetters.Count > 0)
            .Select(kv => kv.Key));
        return ranked;
    }

    public async Task HangmanGuessLetter(string letter)
    {
        if (RateLimited("hangmanGuess", TimeSpan.FromMilliseconds(200))) return;
        if (string.IsNullOrEmpty(letter) || letter.Length != 1 || !char.IsLetter(letter[0])) return;
        letter = letter.ToUpperInvariant();

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool correct = false, solved = false, failed = false;
        int wrongCount = 0;
        string? guesserName = null;
        string masked = "";
        bool competitive = false;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureHangmanPuzzle(room);
            if (room.HangmanWord == null) return;
            competitive = room.HangmanMode == "competitive";
            guesserName = participantName;

            if (competitive)
            {
                if (!room.HangmanCompetitiveStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new HangmanPlayerState();
                    room.HangmanCompetitiveStates[participantName] = pstate;
                }
                if (pstate.Solved || pstate.Failed || pstate.GuessedLetters.Contains(letter)) return;

                pstate.GuessedLetters.Add(letter);
                correct = room.HangmanWord.Contains(letter[0]);
                if (!correct) pstate.WrongCount++;
                wrongCount = pstate.WrongCount;
                solved = room.HangmanWord.All(c => pstate.GuessedLetters.Contains(c.ToString()));
                failed = !solved && wrongCount >= room.HangmanMaxWrong;
                masked = HangmanMaskedFor(room.HangmanWord, pstate.GuessedLetters);

                if (solved || failed)
                {
                    pstate.Solved = solved;
                    pstate.Failed = failed;
                    pstate.FinishedAt = DateTime.UtcNow;
                    UpsertDailyStandings(room, "hangman", HangmanCompetitiveStandings(room));
                    badges = ComputeDailyBadges(room);
                }
            }
            else
            {
                if (room.HangmanGuessedLetters.Contains(letter)) return;

                room.HangmanGuessedLetters.Add(letter);
                room.HangmanGuessedBy[letter] = participantName;
                correct = room.HangmanWord.Contains(letter[0]);
                if (!correct) room.HangmanWrongCount++;

                wrongCount = room.HangmanWrongCount;
                solved = room.HangmanWord.All(c => room.HangmanGuessedLetters.Contains(c.ToString()));
                failed = !solved && wrongCount >= room.HangmanMaxWrong;
                masked = HangmanMasked(room);
            }
        }

        _roomService.SaveRoom(room);
        if (competitive)
            await Clients.Caller.SendAsync("HangmanLetterGuessed", letter, correct, wrongCount, solved, failed, guesserName, masked);
        else
            await Clients.Group(roomName).SendAsync("HangmanLetterGuessed", letter, correct, wrongCount, solved, failed, guesserName, masked);
        if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
    }

    // Host-only manual reshuffle, same restriction tier as WordleNewGame/CrosswordNewGame.
    // The new word honours the day's locked-in length range and clue setting.
    public async Task HangmanNewGame() => await ReshuffleGame("hangman", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh word so no
    // one carries progress across a mode switch, same restriction tier as HangmanNewGame.
    public async Task HangmanSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.HangmanMode = mode; }
        await ReshuffleGame("hangman", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("HangmanModeChanged", mode);
    }

    // =====================================================================
    // Word Search (collaborative) — one grid per room per UTC day, sized and stocked from the
    // room's configured WordSearch* settings.
    // =====================================================================
    private static void EnsureWordSearchPuzzle(Room room) => EnsureGamePuzzle(room, "wordsearch");

    private static List<string> WordSearchStandings(Room room)
    {
        var counts = new Dictionary<string, int>();
        foreach (var entry in room.WordSearchFound.Values)
            counts[entry.FoundBy] = counts.TryGetValue(entry.FoundBy, out var v) ? v + 1 : 1;
        return counts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
    }

    // Competitive: whoever's found the most words on the shared grid ranks highest; a full
    // clear (found every word) is placed by earliest finish time ahead of any partial leader.
    private static List<string> WordSearchCompetitiveStandings(Room room)
    {
        var total = room.WordSearchWords.Length;
        var finishers = room.WordSearchCompetitiveStates.Where(kv => total > 0 && kv.Value.Found.Count >= total)
            .OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        finishers.AddRange(room.WordSearchCompetitiveStates.Where(kv => kv.Value.Found.Count < total && kv.Value.Found.Count > 0)
            .OrderByDescending(kv => kv.Value.Found.Count).Select(kv => kv.Key));
        return finishers;
    }

    public async Task WordSearchSubmit(string word, int startRow, int startCol, int endRow, int endCol)
    {
        if (RateLimited("wordSearchSubmit", TimeSpan.FromMilliseconds(150))) return;
        if (string.IsNullOrEmpty(word)) return;
        word = word.ToUpperInvariant();

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool accepted = false;
        bool competitive = false;
        string? foundByName = null;
        int[]? coords = null;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureWordSearchPuzzle(room);
            if (!room.WordSearchSolutions.TryGetValue(word, out var sol)) return;

            // Accept the selection in either end-to-end order.
            var forward = sol[0] == startRow && sol[1] == startCol && sol[2] == endRow && sol[3] == endCol;
            var backward = sol[0] == endRow && sol[1] == endCol && sol[2] == startRow && sol[3] == startCol;
            if (!forward && !backward) return;

            competitive = room.WordSearchMode == "competitive";
            foundByName = participantName;
            coords = sol;

            if (competitive)
            {
                if (!room.WordSearchCompetitiveStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new WordSearchPlayerState();
                    room.WordSearchCompetitiveStates[participantName] = pstate;
                }
                if (pstate.Found.Contains(word)) return;
                pstate.Found.Add(word);
                accepted = true;
                if (pstate.Found.Count >= room.WordSearchWords.Length) pstate.FinishedAt = DateTime.UtcNow;

                UpsertDailyStandings(room, "wordsearch", WordSearchCompetitiveStandings(room));
                badges = ComputeDailyBadges(room);
            }
            else
            {
                if (room.WordSearchFound.ContainsKey(word)) return;
                room.WordSearchFound[word] = new WordSearchFoundEntry { FoundBy = participantName, Coords = sol };
                accepted = true;

                UpsertDailyStandings(room, "wordsearch", WordSearchStandings(room));
                badges = ComputeDailyBadges(room);
            }
        }

        if (!accepted) return;
        _roomService.SaveRoom(room);
        if (competitive)
            await Clients.Caller.SendAsync("WordSearchWordFound", word, coords![0], coords[1], coords[2], coords[3], foundByName);
        else
            await Clients.Group(roomName).SendAsync("WordSearchWordFound", word, coords![0], coords[1], coords[2], coords[3], foundByName);
        if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
    }

    public async Task WordSearchNewGame() => await ReshuffleGame("wordsearch", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh grid so no
    // one carries progress across a mode switch, same restriction tier as WordSearchNewGame.
    public async Task WordSearchSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.WordSearchMode = mode; }
        await ReshuffleGame("wordsearch", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("WordSearchModeChanged", mode);
    }

    // =====================================================================
    // Spelling Bee (competitive) — one letter set per room per UTC day, sized by the room's
    // SpellingBeeLetterCount. Found words stay private to the finder (like Wordle guesses);
    // only score/count is broadcast.
    // =====================================================================
    private static void EnsureSpellingBeePuzzle(Room room) => EnsureGamePuzzle(room, "spellingbee");

    // Scoring: a word at exactly the room's minimum length is worth 1 point, anything longer
    // scores its own length, and a pangram (uses every letter) adds the room's configured
    // bonus on top.
    private static int SpellingBeeScore(Room room, string word)
    {
        if (word.Length <= room.SpellingBeeMinWordLength) return 1;
        var score = word.Length;
        if (room.SpellingBeePangrams.Contains(word)) score += room.SpellingBeePangramBonus;
        return score;
    }

    private static List<string> SpellingBeeStandings(Room room) =>
        room.SpellingBeeStates.OrderByDescending(kv => kv.Value.Score).Where(kv => kv.Value.Score > 0).Select(kv => kv.Key).ToList();

    public async Task SpellingBeeSubmit(string word)
    {
        if (RateLimited("spellingBeeSubmit", TimeSpan.FromMilliseconds(200))) return;
        if (string.IsNullOrEmpty(word) || !word.All(char.IsLetter)) return;
        word = word.ToUpperInvariant();

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool valid = false, alreadyFound = false, isPangram = false, coop = false;
        int scoreGain = 0, totalScore = 0, wordCount = 0;
        string? participantName = null;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureSpellingBeePuzzle(room);
            coop = room.SpellingBeeMode == "coop";
            if (word.Length < room.SpellingBeeMinWordLength || string.IsNullOrEmpty(room.SpellingBeeLetters)) { valid = false; }
            else
            {
                var center = room.SpellingBeeLetters[0];
                var letterSet = new HashSet<char>(room.SpellingBeeLetters);
                if (word.Contains(center) && word.All(letterSet.Contains) && room.SpellingBeeValidWords.Contains(word))
                {
                    if (coop)
                    {
                        if (room.SpellingBeeSharedFound.Contains(word))
                        {
                            alreadyFound = true;
                        }
                        else
                        {
                            valid = true;
                            isPangram = room.SpellingBeePangrams.Contains(word);
                            scoreGain = SpellingBeeScore(room, word);
                            room.SpellingBeeSharedFound.Add(word);
                            room.SpellingBeeSharedScore += scoreGain;
                            totalScore = room.SpellingBeeSharedScore;
                            wordCount = room.SpellingBeeSharedFound.Count;
                        }
                    }
                    else
                    {
                        if (!room.SpellingBeeStates.TryGetValue(participantName, out var state))
                        {
                            state = new SpellingBeePlayerState();
                            room.SpellingBeeStates[participantName] = state;
                        }
                        if (state.FoundWords.Contains(word))
                        {
                            alreadyFound = true;
                        }
                        else
                        {
                            valid = true;
                            isPangram = room.SpellingBeePangrams.Contains(word);
                            scoreGain = SpellingBeeScore(room, word);
                            state.FoundWords.Add(word);
                            state.Score += scoreGain;
                            totalScore = state.Score;
                            wordCount = state.FoundWords.Count;

                            UpsertDailyStandings(room, "spellingbee", SpellingBeeStandings(room));
                            badges = ComputeDailyBadges(room);
                        }
                    }
                }
            }
        }

        if (valid)
        {
            _roomService.SaveRoom(room);
            await Clients.Caller.SendAsync("SpellingBeeSubmitResult", true, word, scoreGain, isPangram, alreadyFound);
            if (coop)
            {
                await Clients.OthersInGroup(roomName).SendAsync("SpellingBeeSharedFound", word, scoreGain, isPangram, participantName, totalScore, wordCount);
            }
            else
            {
                await Clients.Group(roomName).SendAsync("SpellingBeeStatusUpdate", new { name = participantName, score = totalScore, wordCount });
                if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
            }
        }
        else
        {
            await Clients.Caller.SendAsync("SpellingBeeSubmitResult", false, word, 0, false, alreadyFound);
        }
    }

    public async Task SpellingBeeNewGame() => await ReshuffleGame("spellingbee", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh puzzle so no
    // one carries progress across a mode switch, same restriction tier as SpellingBeeNewGame.
    public async Task SpellingBeeSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.SpellingBeeMode = mode; }
        await ReshuffleGame("spellingbee", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("SpellingBeeModeChanged", mode);
    }

    // =====================================================================
    // Jumble (competitive) — 4 scrambled small words feed a final answer, one set per room
    // per UTC day. Small-word guesses stay private (like Wordle); the final-answer solve is
    // broadcast (attempts/elapsed only, no spoilers).
    // =====================================================================
    private static void EnsureJumblePuzzle(Room room) => EnsureGamePuzzle(room, "jumble");

    private static List<string> JumbleStandings(Room room)
    {
        var finishers = room.JumbleStates.Where(kv => kv.Value.FinalSolved).OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        finishers.AddRange(room.JumbleStates.Where(kv => !kv.Value.FinalSolved && kv.Value.WordsSolved.Any(w => w)).Select(kv => kv.Key));
        return finishers;
    }

    public async Task JumbleGuessWord(int index, string guess)
    {
        if (RateLimited("jumbleGuessWord", TimeSpan.FromMilliseconds(200))) return;
        if (index < 0 || string.IsNullOrEmpty(guess)) return; // upper bound is the room's word count, checked under the lock
        guess = guess.ToUpperInvariant();

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool correct = false, coop = false;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureJumblePuzzle(room);
            if (index >= room.JumbleWords.Length) return; // not configured today, or an out-of-range slot
            coop = room.JumbleMode == "coop";

            JumblePlayerState state;
            if (coop)
            {
                state = room.JumbleSharedState ??= new JumblePlayerState();
            }
            else
            {
                if (!room.JumbleStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new JumblePlayerState();
                    room.JumbleStates[participantName] = pstate;
                }
                state = pstate;
            }
            state.EnsureSize(room.JumbleWords.Length);
            if (state.FinalSolved || state.WordsSolved[index]) return;

            state.Attempts++;
            state.StartedAt ??= DateTime.UtcNow;
            correct = guess == room.JumbleWords[index];
            if (correct)
            {
                state.WordsSolved[index] = true;
                state.SolvedWords[index] = room.JumbleWords[index];
            }
        }

        _roomService.SaveRoom(room);
        if (coop)
            await Clients.Group(roomName).SendAsync("JumbleWordGuessResult", index, correct, correct ? room.JumbleWords[index] : null,
                correct ? room.JumbleMarkedIndex[index] : (int?)null);
        else
            await Clients.Caller.SendAsync("JumbleWordGuessResult", index, correct, correct ? room.JumbleWords[index] : null,
                correct ? room.JumbleMarkedIndex[index] : (int?)null);
    }

    public async Task JumbleGuessFinal(string guess)
    {
        if (RateLimited("jumbleGuessFinal", TimeSpan.FromMilliseconds(200))) return;
        if (string.IsNullOrEmpty(guess)) return;
        guess = guess.ToUpperInvariant();

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool correct = false, coop = false;
        int attempts = 0;
        double elapsedSeconds = 0;
        string? participantName = null;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureJumblePuzzle(room);
            if (room.JumbleFinalAnswer == null) return;
            coop = room.JumbleMode == "coop";

            JumblePlayerState state;
            if (coop)
            {
                state = room.JumbleSharedState ??= new JumblePlayerState();
            }
            else
            {
                if (!room.JumbleStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new JumblePlayerState();
                    room.JumbleStates[participantName] = pstate;
                }
                state = pstate;
            }
            state.EnsureSize(room.JumbleWords.Length);
            if (state.FinalSolved) return;

            state.Attempts++;
            state.StartedAt ??= DateTime.UtcNow;
            correct = guess == room.JumbleFinalAnswer;
            if (correct)
            {
                state.FinalSolved = true;
                state.FinishedAt = DateTime.UtcNow;
                attempts = state.Attempts;
                elapsedSeconds = (state.FinishedAt.Value - (state.StartedAt ?? state.FinishedAt.Value)).TotalSeconds;

                if (!coop)
                {
                    UpsertDailyStandings(room, "jumble", JumbleStandings(room));
                    badges = ComputeDailyBadges(room);
                }
            }
        }

        _roomService.SaveRoom(room);
        if (coop)
            await Clients.Group(roomName).SendAsync("JumbleFinalGuessResult", correct);
        else
            await Clients.Caller.SendAsync("JumbleFinalGuessResult", correct);
        if (correct && !coop)
        {
            await Clients.Group(roomName).SendAsync("JumbleStatusUpdate", new { name = participantName, attempts, elapsedSeconds });
            if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
        }
    }

    public async Task JumbleNewGame() => await ReshuffleGame("jumble", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh puzzle so no
    // one carries progress across a mode switch, same restriction tier as JumbleNewGame.
    public async Task JumbleSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.JumbleMode = mode; }
        await ReshuffleGame("jumble", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("JumbleModeChanged", mode);
    }

    // =====================================================================
    // F11/P6 — Connections. Group the grid into the hidden categories, with a
    // mistake budget. Coop (one shared grid for the whole room — the good one
    // here) or competitive (private grids, feeds the leaderboard) exactly like
    // Jumble; setup/limits/reshuffle all come from the Feature 10 framework.
    // =====================================================================
    private static void EnsureConnectionsPuzzle(Room room) => EnsureGamePuzzle(room, "connections");

    /// <summary>
    /// Only categories that have already been solved carry their words back — an unsolved
    /// category's membership is the entire secret of the puzzle. On a finished (or failed)
    /// board every category is revealed, same as the real thing.
    /// Caller must hold the room lock.
    /// </summary>
    private static object ConnectionsStatePayload(Room room, ConnectionsPlayerState st)
    {
        var over = st.Completed || st.Failed;
        var reveal = room.ConnectionsCategories
            .Where(c => over || st.SolvedCategories.Contains(c.Name))
            .Select(c => (object)new { name = c.Name, difficulty = c.Difficulty, words = c.Words.ToList() })
            .ToList();
        return new
        {
            solvedCategories = st.SolvedCategories.ToList(),
            mistakes = st.Mistakes,
            completed = st.Completed,
            failed = st.Failed,
            seconds = st.Seconds,
            startedAtUtc = st.StartedAtUtc,
            revealed = reveal
        };
    }

    private static List<string> ConnectionsStandings(Room room)
    {
        // Finishers first, fastest first; then everyone who solved at least one category,
        // most solved first. Same shape as JumbleStandings.
        var ranked = room.ConnectionsStates.Where(kv => kv.Value.Completed)
            .OrderBy(kv => kv.Value.Seconds).Select(kv => kv.Key).ToList();
        ranked.AddRange(room.ConnectionsStates
            .Where(kv => !kv.Value.Completed && kv.Value.SolvedCategories.Count > 0)
            .OrderByDescending(kv => kv.Value.SolvedCategories.Count)
            .Select(kv => kv.Key));
        return ranked;
    }

    /// <summary>
    /// One guess at a category: the selected words. A correct guess reveals the category; a
    /// wrong one burns a mistake. "One away" is reported because it is the single most useful
    /// piece of feedback the game gives, and it leaks nothing a player cannot already infer
    /// from the cards in front of them.
    /// </summary>
    public async Task ConnectionsSubmit(List<string>? words)
    {
        if (RateLimited("connectionsSubmit", TimeSpan.FromMilliseconds(250))) return;
        if (words == null || words.Count == 0 || words.Count > 8) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool coop = false, correct = false, oneAway = false, justFinished = false, justFailed = false;
        string? matchedCategory = null;
        int matchedDifficulty = 0;
        var matchedWords = new List<string>();
        int mistakes = 0;
        string? participantName = null;
        List<object>? revealed = null;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureConnectionsPuzzle(room);
            if (room.ConnectionsCategories.Count == 0) return; // not configured today
            coop = room.ConnectionsMode == "coop";

            ConnectionsPlayerState state;
            if (coop)
            {
                state = room.ConnectionsSharedState ??= new ConnectionsPlayerState();
            }
            else
            {
                if (!room.ConnectionsStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new ConnectionsPlayerState();
                    room.ConnectionsStates[participantName] = pstate;
                }
                state = pstate;
            }
            if (state.Completed || state.Failed) return;
            state.StartedAtUtc ??= DateTime.UtcNow;

            // A guess must be exactly one category's worth of still-unsolved words.
            if (words.Count != room.ConnectionsWordsPerCategory) return;
            var guess = words.Select(w => (w ?? "").Trim().ToUpperInvariant())
                             .Where(w => w.Length > 0).Distinct().ToList();
            if (guess.Count != room.ConnectionsWordsPerCategory) return;

            var open = room.ConnectionsCategories.Where(c => !state.SolvedCategories.Contains(c.Name)).ToList();
            if (!guess.All(w => open.Any(c => c.Words.Contains(w, StringComparer.OrdinalIgnoreCase)))) return;

            var hit = open.FirstOrDefault(c => c.Words.Count == guess.Count
                && c.Words.All(w => guess.Contains(w, StringComparer.OrdinalIgnoreCase)));
            if (hit != null)
            {
                correct = true;
                matchedCategory = hit.Name;
                matchedDifficulty = hit.Difficulty;
                matchedWords = hit.Words.ToList();
                state.SolvedCategories.Add(hit.Name);
                if (state.SolvedCategories.Count == room.ConnectionsCategories.Count)
                {
                    state.Completed = true;
                    justFinished = true;
                    state.Seconds = (int)Math.Round((DateTime.UtcNow - (state.StartedAtUtc ?? DateTime.UtcNow)).TotalSeconds);
                }
            }
            else
            {
                state.Mistakes++;
                // "One away" = every word but one shares a category.
                oneAway = open.Any(c => c.Words.Count(w => guess.Contains(w, StringComparer.OrdinalIgnoreCase)) == guess.Count - 1);
                if (state.Mistakes >= room.ConnectionsMistakesAllowed)
                {
                    state.Failed = true;
                    justFailed = true;
                }
            }
            mistakes = state.Mistakes;

            // On a finish or a bust the whole solution is safe to send — there is nothing
            // left to spoil for this player, and in coop the game is over for the room.
            if (justFinished || justFailed)
            {
                revealed = room.ConnectionsCategories
                    .OrderBy(c => c.Difficulty)
                    .Select(c => (object)new { name = c.Name, difficulty = c.Difficulty, words = c.Words })
                    .ToList();
            }

            if (justFinished && !coop)
            {
                UpsertDailyStandings(room, "connections", ConnectionsStandings(room));
                badges = ComputeDailyBadges(room);
            }
        }

        _roomService.SaveRoom(room);

        var payload = new
        {
            correct,
            oneAway,
            mistakes,
            category = matchedCategory,
            difficulty = matchedDifficulty,
            words = matchedWords,
            completed = justFinished,
            failed = justFailed,
            revealed
        };
        if (coop)
            await Clients.Group(roomName).SendAsync("ConnectionsResult", participantName, payload);
        else
            await Clients.Caller.SendAsync("ConnectionsResult", participantName, payload);

        if (justFinished && !coop)
        {
            await Clients.Group(roomName).SendAsync("ConnectionsStatusUpdate",
                new { name = participantName, mistakes });
            if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
        }
    }

    public async Task ConnectionsNewGame() => await ReshuffleGame("connections", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh puzzle so
    // no one carries progress across a mode switch, same restriction tier as JumbleSetMode.
    public async Task ConnectionsSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.ConnectionsMode = mode; }
        await ReshuffleGame("connections", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("ConnectionsModeChanged", mode);
    }

    // =====================================================================
    // Acrostic (collaborative) — a hand-authored quote+clues puzzle picked by day-seed (not
    // generated), filled collaboratively exactly like Crossword.
    // =====================================================================
    private static AcrosticPuzzle CurrentAcrosticPuzzle(Room room) =>
        AcrosticPuzzles.Puzzles[room.AcrosticIndex >= 0 && room.AcrosticIndex < AcrosticPuzzles.Puzzles.Length ? room.AcrosticIndex : 0];

    private static void EnsureAcrosticPuzzle(Room room) => EnsureGamePuzzle(room, "acrostic");

    // Competitive: placement = earliest solver first, then anyone with ≥1 filled cell gets
    // participation, mirrors CrosswordCompetitiveStandings.
    private static List<string> AcrosticCompetitiveStandings(Room room)
    {
        var ranked = room.AcrosticCompetitiveStates.Where(kv => kv.Value.Solved)
            .OrderBy(kv => kv.Value.FinishedAt).Select(kv => kv.Key).ToList();
        ranked.AddRange(room.AcrosticCompetitiveStates.Where(kv => !kv.Value.Solved && kv.Value.Cells.Count > 0)
            .Select(kv => kv.Key));
        return ranked;
    }

    private static object BuildAcrosticLayoutPayload(AcrosticPuzzle puzzle)
    {
        var clues = new List<object>();
        for (var i = 0; i < puzzle.ClueTexts.Length; i++)
        {
            clues.Add(new { index = i, clue = puzzle.ClueTexts[i], length = puzzle.ClueAnswers[i].Length, positions = puzzle.LetterPositions[i] });
        }
        return new { quoteLength = puzzle.Quote.Length, author = puzzle.Author, clues };
    }

    private static bool IsAcrosticSolved(AcrosticPuzzle puzzle, Dictionary<string, string> cells)
    {
        for (var i = 0; i < puzzle.Quote.Length; i++)
        {
            if (!char.IsLetter(puzzle.Quote[i])) continue;
            if (!cells.TryGetValue(i.ToString(CultureInfo.InvariantCulture), out var v) || v.Length == 0 || v[0] != puzzle.Quote[i]) return false;
        }
        return true;
    }

    private static List<string> AcrosticStandings(Room room, AcrosticPuzzle puzzle)
    {
        var counts = new Dictionary<string, int>();
        foreach (var kv in room.AcrosticCells)
        {
            if (kv.Value.Length != 1 || !room.AcrosticCellFiller.TryGetValue(kv.Key, out var filler)) continue;
            if (!int.TryParse(kv.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pos)) continue;
            if (pos < 0 || pos >= puzzle.Quote.Length || puzzle.Quote[pos] != kv.Value[0]) continue;
            counts[filler] = counts.TryGetValue(filler, out var v) ? v + 1 : 1;
        }
        return counts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
    }

    public async Task AcrosticFill(int position, string letter)
    {
        if (RateLimited("acrosticFill", TimeSpan.FromMilliseconds(30))) return;
        letter = (letter ?? string.Empty).ToUpperInvariant();
        if (letter.Length > 1 || (letter.Length == 1 && !char.IsLetter(letter[0]))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        bool correct = false, justSolved;
        bool competitive = false;
        Dictionary<string, List<string>>? badges = null;

        lock (room)
        {
            var participantName = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
            if (participantName == null) return;

            EnsureAcrosticPuzzle(room);
            if (GameNeedsSetup(room, "acrostic")) return; // nobody has picked today's quote yet
            var puzzle = CurrentAcrosticPuzzle(room);
            if (position < 0 || position >= puzzle.Quote.Length || !char.IsLetter(puzzle.Quote[position])) return;

            var key = position.ToString(CultureInfo.InvariantCulture);
            competitive = room.AcrosticMode == "competitive";

            if (competitive)
            {
                if (!room.AcrosticCompetitiveStates.TryGetValue(participantName, out var pstate))
                {
                    pstate = new GridFillPlayerState();
                    room.AcrosticCompetitiveStates[participantName] = pstate;
                }
                if (pstate.Solved) return;

                var wasSolved = IsAcrosticSolved(puzzle, pstate.Cells);
                if (letter.Length == 0) pstate.Cells.Remove(key);
                else { pstate.Cells[key] = letter; correct = letter[0] == puzzle.Quote[position]; }
                justSolved = !wasSolved && IsAcrosticSolved(puzzle, pstate.Cells);
                if (justSolved)
                {
                    pstate.Solved = true;
                    pstate.FinishedAt = DateTime.UtcNow;
                }

                UpsertDailyStandings(room, "acrostic", AcrosticCompetitiveStandings(room));
                badges = ComputeDailyBadges(room);
            }
            else
            {
                var wasSolved = IsAcrosticSolved(puzzle, room.AcrosticCells);
                if (letter.Length == 0)
                {
                    room.AcrosticCells.Remove(key);
                    room.AcrosticCellFiller.Remove(key);
                }
                else
                {
                    room.AcrosticCells[key] = letter;
                    room.AcrosticCellFiller[key] = participantName;
                    correct = letter[0] == puzzle.Quote[position];
                }
                justSolved = !wasSolved && IsAcrosticSolved(puzzle, room.AcrosticCells);
            }
        }

        _roomService.SaveRoom(room);
        if (competitive)
        {
            await Clients.Caller.SendAsync("AcrosticCellFilled", position, letter, correct);
            if (justSolved) await Clients.Caller.SendAsync("AcrosticSolved");
        }
        else
        {
            await Clients.Group(roomName).SendAsync("AcrosticCellFilled", position, letter, correct);
            if (justSolved) await Clients.Group(roomName).SendAsync("AcrosticSolved");
        }
        if (badges != null) await Clients.Group(roomName).SendAsync("DailyBadgesUpdate", badges);
    }

    public async Task AcrosticNewGame() => await ReshuffleGame("acrostic", Guid.NewGuid().ToString());

    // Host-only: switch Coop/Competitive at puzzle (re)generation — forces a fresh quote so no
    // one carries progress across a mode switch, same restriction tier as AcrosticNewGame.
    public async Task AcrosticSetMode(string mode)
    {
        if (mode != "coop" && mode != "competitive") return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        lock (room) { room.AcrosticMode = mode; }
        await ReshuffleGame("acrostic", Guid.NewGuid().ToString());
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("AcrosticModeChanged", mode);
    }

    private static string? FindShameParticipantId(Room room)
    {
        var numericVoters = room.Participants
            .Where(p => !p.IsObserver && p.Vote != null && double.TryParse(p.Vote!.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            .Select(p => (participant: p, val: double.Parse(p.Vote!.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture)))
            .ToList();

        if (numericVoters.Count < 3) return null;

        var groups = numericVoters
            .GroupBy(x => x.participant.Vote!)
            .OrderByDescending(g => g.Count())
            .ToList();

        var topGroup = groups[0];
        if (topGroup.Count() * 2 < numericVoters.Count) return null;

        var majorityNum = double.Parse(topGroup.Key.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture);
        var outliers = numericVoters
            .Where(x => x.participant.Vote != topGroup.Key)
            .OrderByDescending(x => Math.Abs(x.val - majorityNum))
            .ToList();

        if (outliers.Count == 0) return null;
        var maxDist = Math.Abs(outliers[0].val - majorityNum);
        var farthest = outliers.Where(x => Math.Abs(x.val - majorityNum) == maxDist).ToList();
        return farthest.Count == 1 ? farthest[0].participant.ConnectionId : null;
    }

    // ========================================================================
    // F11/P4 — RETRO MODE
    //
    // Same shape as the whiteboard: every mutation under lock (room), broadcast as a delta,
    // and the whole board rebuilt into RoomState for late joiners. The one thing retro adds
    // over the whiteboard is that what you are allowed to *see* depends on the phase, so
    // every outbound board goes through RetroBoardPayload(board, viewerName) rather
    // than being serialized directly — see the phase-visibility notes there.
    // ========================================================================

    private const int RetroMaxNoteLength = 500;
    private const int RetroMaxNotes = 400;
    private const int RetroMaxActions = 100;
    private const int RetroMinVotesPerPerson = 1;
    private const int RetroMaxVotesPerPerson = 10;

    private static readonly string[] RetroPhases =
        { "collect", "reveal", "group", "vote", "discuss", "actions", "closed" };

    /// <summary>
    /// R7 — the format library. Columns are just data, so an alternate retro format is a
    /// column preset and nothing else. The owner's four-column board is the default.
    /// </summary>
    private static List<RetroColumn> RetroColumnsFor(string format)
    {
        (string Key, string Label, string Emoji, string Colour)[] spec = format switch
        {
            "start-stop-continue" => new[]
            {
                ("start", "Start doing", "🟢", "#198754"),
                ("stop", "Stop doing", "🔴", "#dc3545"),
                ("continue", "Keep doing", "🔵", "#0d6efd"),
            },
            "mad-sad-glad" => new[]
            {
                ("mad", "Mad", "😠", "#dc3545"),
                ("sad", "Sad", "😢", "#6f42c1"),
                ("glad", "Glad", "😄", "#198754"),
            },
            "4ls" => new[]
            {
                ("liked", "Liked", "❤️", "#198754"),
                ("learned", "Learned", "💡", "#0d6efd"),
                ("lacked", "Lacked", "🕳️", "#dc3545"),
                ("longed", "Longed for", "🌠", "#6f42c1"),
            },
            "sailboat" => new[]
            {
                ("wind", "Wind (helping us)", "💨", "#198754"),
                ("anchors", "Anchors (slowing us)", "⚓", "#dc3545"),
                ("rocks", "Rocks (risks ahead)", "🪨", "#fd7e14"),
                ("island", "Island (our goal)", "🏝️", "#0d6efd"),
            },
            "starfish" => new[]
            {
                ("keep", "Keep doing", "✅", "#198754"),
                ("more", "More of", "➕", "#20c997"),
                ("less", "Less of", "➖", "#fd7e14"),
                ("start", "Start doing", "🟢", "#0d6efd"),
                ("stop", "Stop doing", "🔴", "#dc3545"),
            },
            // "default" — the four columns the owner's team already runs its retro in.
            _ => new[]
            {
                ("well", "What went well", "✅", "#198754"),
                ("didnt", "What didn't go well", "⚠️", "#dc3545"),
                ("questions", "Questions", "❓", "#0d6efd"),
                ("try", "Things to try next time", "🔄", "#6f42c1"),
            }
        };

        return spec.Select((c, i) => new RetroColumn
        {
            Key = c.Key,
            Label = c.Label,
            Emoji = c.Emoji,
            Colour = c.Colour,
            Order = i
        }).ToList();
    }

    // Caller must hold the room lock.
    private static RetroBoard? ActiveRetro(Room room) =>
        room.ActiveRetroBoardId == null
            ? null
            : room.RetroBoards.FirstOrDefault(b => b.Id == room.ActiveRetroBoardId);

    private static int RetroPhaseIndex(string phase) => Array.IndexOf(RetroPhases, phase);

    /// <summary>
    /// The whole safety story of the retro lives in this one method.
    ///
    ///  * Collect  — you see ONLY your own notes, plus a per-column count. That is the
    ///               anchoring-bias fix from R2 and it has to be enforced server-side, or a
    ///               crafted client just reads everyone's stickies out of the payload.
    ///  * Vote     — you see only your OWN dots; tallies appear when the phase advances, for
    ///               the same reason.
    ///  * Anonymous — AuthorName is stripped from every payload (it stays server-side purely
    ///               so "delete my own note" and rate limiting still work), and `mine` is the
    ///               only authorship signal that survives. R8 makes Anonymous immutable after
    ///               creation, so nobody writes under one assumption and is exposed under
    ///               another.
    ///  * Paused   — R8's freeze. Note bodies are withheld from everyone while a conversation
    ///               happens off the board.
    ///
    /// Caller must hold the room lock.
    /// </summary>
    private static object RetroBoardPayload(RetroBoard b, string? viewerName)
    {
        var phaseIdx = RetroPhaseIndex(b.Phase);
        var collecting = b.Phase == "collect";
        var votesHidden = phaseIdx <= RetroPhaseIndex("vote");
        var frozen = b.Paused;

        int VoteTotal(Dictionary<string, int> votes) => votes.Values.Sum();
        int MyVotes(Dictionary<string, int> votes) =>
            viewerName != null && votes.TryGetValue(viewerName, out var v) ? v : 0;

        var visibleNotes = b.Notes
            .Where(n => !collecting || (viewerName != null && n.AuthorName == viewerName))
            .Select(n => (object)new
            {
                id = n.Id,
                columnKey = n.ColumnKey,
                text = frozen && n.AuthorName != viewerName ? "" : n.Text,
                // Null on an anonymous board, always — including in the export.
                author = b.Anonymous ? null : n.AuthorName,
                mine = viewerName != null && n.AuthorName == viewerName,
                createdAtUtc = n.CreatedAtUtc,
                editedAtUtc = n.EditedAtUtc,
                colour = n.Colour,
                groupId = n.GroupId,
                x = n.X,
                y = n.Y,
                votes = votesHidden ? MyVotes(n.Votes) : VoteTotal(n.Votes),
                myVotes = MyVotes(n.Votes),
                votesHidden,
                linkedIssueKeys = n.LinkedIssueKeys.ToList(),
                linkedRoundIds = n.LinkedRoundIds.ToList(),
                discussed = b.DiscussedNoteIds.Contains(n.Id)
            })
            .ToList();

        // Per-column live counts are the only thing that crosses the Collect wall — "6 notes
        // so far" is the encouragement without the anchoring.
        var columnCounts = b.Columns.ToDictionary(c => c.Key, c => b.Notes.Count(n => n.ColumnKey == c.Key));

        var spent = viewerName == null ? 0 :
            b.Notes.Sum(n => MyVotes(n.Votes)) + b.Groups.Sum(g => MyVotes(g.Votes));

        return new
        {
            id = b.Id,
            title = b.Title,
            sprintName = b.SprintName,
            sprintGoal = b.SprintGoal,
            sprintContext = b.SprintContextJson,
            startedAtUtc = b.StartedAtUtc,
            closedAtUtc = b.ClosedAtUtc,
            phase = b.Phase,
            phases = RetroPhases,
            anonymous = b.Anonymous,
            votesPerPerson = b.VotesPerPerson,
            votesSpent = spent,
            paused = b.Paused,
            columns = b.Columns.OrderBy(c => c.Order)
                .Select(c => new { id = c.Id, key = c.Key, label = c.Label, emoji = c.Emoji, colour = c.Colour, order = c.Order })
                .ToList(),
            columnCounts,
            notes = visibleNotes,
            groups = b.Groups.Select(g => new
            {
                id = g.Id,
                columnKey = g.ColumnKey,
                title = g.Title,
                colour = g.Colour,
                noteIds = g.NoteIds.ToList(),
                votes = votesHidden ? MyVotes(g.Votes) : VoteTotal(g.Votes),
                myVotes = MyVotes(g.Votes),
                votesHidden,
                discussed = b.DiscussedNoteIds.Contains(g.Id)
            }).ToList(),
            actions = b.Actions.Select(a => RetroActionPayload(a)).ToList(),
            discussedIds = b.DiscussedNoteIds.ToList(),
            currentTopicId = b.CurrentTopicId,
            carriedActionIds = b.CarriedActionIds.ToList()
        };
    }

    private static object RetroActionPayload(RetroAction a) => new
    {
        id = a.Id,
        text = a.Text,
        owner = a.Owner,
        dueDateUtc = a.DueDateUtc,
        status = a.Status,
        sourceNoteIds = a.SourceNoteIds.ToList(),
        jiraKey = a.JiraKey,
        jiraUrl = a.JiraUrl,
        createdInBoardId = a.CreatedInBoardId,
        createdAtUtc = a.CreatedAtUtc,
        carriedFromActionId = a.CarriedFromActionId,
        carryCount = a.CarryCount
    };

    // Caller must hold the room lock. Lightweight index of every board for the archive list.
    private static List<object> RetroArchivePayload(Room room) =>
        room.RetroBoards
            .OrderByDescending(b => b.StartedAtUtc)
            .Select(b => (object)new
            {
                id = b.Id,
                title = b.Title,
                sprintName = b.SprintName,
                startedAtUtc = b.StartedAtUtc,
                closedAtUtc = b.ClosedAtUtc,
                phase = b.Phase,
                isActive = b.Id == room.ActiveRetroBoardId,
                noteCount = b.Notes.Count,
                actionCount = b.Actions.Count,
                openActionCount = b.Actions.Count(a => a.Status == "open")
            })
            .ToList();

    private async Task BroadcastRetro(string roomName, Room room)
    {
        // Phase visibility is per-viewer (Collect hides other people's notes, Vote hides
        // other people's dots), so the board cannot be broadcast as one shared payload —
        // each connection gets its own render of the same board.
        List<(string ConnectionId, object Payload)> perViewer;
        object archive;
        lock (room)
        {
            var b = ActiveRetro(room);
            archive = RetroArchivePayload(room);
            perViewer = room.Participants
                .Select(p => (p.ConnectionId, b == null ? (object)new { } : RetroBoardPayload(b, p.Name)))
                .ToList();
            if (b == null) perViewer = room.Participants.Select(p => (p.ConnectionId, (object)new { cleared = true })).ToList();
        }

        foreach (var (connectionId, payload) in perViewer)
            await Clients.Client(connectionId).SendAsync("RetroUpdated", payload, archive);
    }

    /// <summary>
    /// R2 + R6 — open a board. Every still-open action from the previous board is pulled
    /// forward as a fresh, chained action awaiting Done / Still open / Drop, because an
    /// action nobody revisits is the biggest failure mode of retros as a practice.
    /// </summary>
    public async Task RetroStart(string title, string sprintName, string sprintGoal,
        string format = "default", bool anonymous = false, int votesPerPerson = 3)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        title = Clamp(title, 120, "Retro");
        sprintName = Clamp(sprintName, 120, "");
        sprintGoal = Clamp(sprintGoal, 500, "");
        votesPerPerson = Math.Clamp(votesPerPerson, RetroMinVotesPerPerson, RetroMaxVotesPerPerson);

        lock (room)
        {
            var previous = ActiveRetro(room)
                ?? room.RetroBoards.OrderByDescending(b => b.StartedAtUtc).FirstOrDefault();

            var board = new RetroBoard
            {
                Title = title,
                SprintName = sprintName,
                SprintGoal = sprintGoal,
                Anonymous = anonymous,
                VotesPerPerson = votesPerPerson,
                Columns = RetroColumnsFor(format)
            };

            if (previous != null)
            {
                foreach (var open in previous.Actions.Where(a => a.Status == "open" || a.Status == "in-progress"))
                {
                    var carried = new RetroAction
                    {
                        Text = open.Text,
                        Owner = open.Owner,
                        DueDateUtc = open.DueDateUtc,
                        Status = "open",
                        SourceNoteIds = open.SourceNoteIds.ToList(),
                        JiraKey = open.JiraKey,
                        JiraUrl = open.JiraUrl,
                        CreatedInBoardId = board.Id,
                        CarriedFromActionId = open.Id,
                        CarryCount = open.CarryCount + 1
                    };
                    board.Actions.Add(carried);
                    board.CarriedActionIds.Add(carried.Id);
                }
            }

            room.RetroBoards.Add(board);
            room.ActiveRetroBoardId = board.Id;
            if (room.RetroBoards.Count > Room.MaxRetroBoards)
            {
                var oldest = room.RetroBoards.OrderBy(b => b.StartedAtUtc).First();
                if (oldest.Id != board.Id) room.RetroBoards.Remove(oldest);
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>Browse the archive — makes a closed board the one on screen, read-only.</summary>
    public async Task RetroOpenBoard(string? boardId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            if (boardId != null && !room.RetroBoards.Any(b => b.Id == boardId)) return;
            room.ActiveRetroBoardId = boardId;
        }
        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    public async Task RetroSetPhase(string phase)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;
        if (RetroPhaseIndex(phase) < 0) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            b.Phase = phase;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("RetroPhaseChanged", phase);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>R8 — freeze the board so a conversation can happen off it.</summary>
    public async Task RetroSetPaused(bool paused)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null) return;
            b.Paused = paused;
        }
        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    public async Task RetroSetVotesPerPerson(int votesPerPerson)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            b.VotesPerPerson = Math.Clamp(votesPerPerson, RetroMinVotesPerPerson, RetroMaxVotesPerPerson);
        }
        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    public async Task RetroAddNote(string columnKey, string text, string? colour = null)
    {
        if (RateLimited("retroAddNote", TimeSpan.FromMilliseconds(400))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            // Writing is a Collect/Reveal/Group activity; once the room is voting or
            // discussing, a new sticky just muddies the tallies.
            if (RetroPhaseIndex(b.Phase) > RetroPhaseIndex("group")) return;
            if (b.Notes.Count >= RetroMaxNotes) return;
            if (!b.Columns.Any(c => c.Key == columnKey)) return;

            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;

            text = Clamp(text, RetroMaxNoteLength, "");
            if (text.Length == 0) return;

            b.Notes.Add(new RetroNote
            {
                ColumnKey = columnKey,
                Text = text,
                AuthorName = me.Name,
                Colour = SafeColour(colour, "#fff3cd"),
                X = 0.5,
                Y = 0.5
            });
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    public async Task RetroEditNote(string noteId, string? text, string? colour)
    {
        if (RateLimited("retroEditNote", TimeSpan.FromMilliseconds(200))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            var note = b.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null) return;

            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;
            // Your own note, or the host tidying up. AuthorName is kept server-side on an
            // anonymous board precisely so this check still works there.
            if (note.AuthorName != me.Name && !CanChangeRoomSetting(room, Context.ConnectionId)) return;

            if (text != null)
            {
                var trimmed = Clamp(text, RetroMaxNoteLength, "");
                if (trimmed.Length == 0) return;
                note.Text = trimmed;
            }
            if (colour != null) note.Colour = SafeColour(colour, note.Colour);
            note.EditedAtUtc = DateTime.UtcNow;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    public async Task RetroMoveNote(string noteId, string? columnKey, double x, double y)
    {
        if (RateLimited("retroMoveNote", TimeSpan.FromMilliseconds(60))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        object? delta = null;
        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            var note = b.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null) return;
            if (columnKey != null && b.Columns.Any(c => c.Key == columnKey)) note.ColumnKey = columnKey;
            // 0..1 fractions of the column box, so a note lands in the same relative spot on
            // every screen size. Clamped because these arrive straight from a drag handler.
            note.X = Math.Clamp(x, 0, 1);
            note.Y = Math.Clamp(y, 0, 1);
            room.LastActivity = DateTime.UtcNow;
            delta = new { id = note.Id, columnKey = note.ColumnKey, x = note.X, y = note.Y };
        }

        _roomService.SaveRoom(room);
        // Drags fire constantly — send the position as a delta rather than re-rendering the
        // whole board for everyone on every mouse move.
        await Clients.Group(roomName).SendAsync("RetroNoteMoved", delta);
    }

    public async Task RetroDeleteNote(string noteId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            var note = b.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null) return;

            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;
            if (note.AuthorName != me.Name && !CanChangeRoomSetting(room, Context.ConnectionId)) return;

            b.Notes.Remove(note);
            foreach (var g in b.Groups) g.NoteIds.Remove(noteId);
            b.Groups.RemoveAll(g => g.NoteIds.Count == 0);
            b.DiscussedNoteIds.Remove(noteId);
            if (b.CurrentTopicId == noteId) b.CurrentTopicId = null;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>
    /// R2/3 — cluster duplicate sentiment so it stops splitting the vote. Dropping a note on
    /// a note makes a new group; dropping it on an existing group joins that one. A null
    /// targetId ungroups.
    /// </summary>
    public async Task RetroGroupNotes(string noteId, string? targetId, string? title)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            var note = b.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null) return;

            void DetachFromCurrentGroup()
            {
                if (note.GroupId == null) return;
                var old = b.Groups.FirstOrDefault(g => g.Id == note.GroupId);
                old?.NoteIds.Remove(note.Id);
                if (old != null && old.NoteIds.Count < 2) b.Groups.Remove(old);
                note.GroupId = null;
            }

            if (targetId == null) { DetachFromCurrentGroup(); }
            else
            {
                var group = b.Groups.FirstOrDefault(g => g.Id == targetId);
                if (group == null)
                {
                    var target = b.Notes.FirstOrDefault(n => n.Id == targetId);
                    if (target == null || target.Id == note.Id) return;

                    if (target.GroupId != null)
                    {
                        group = b.Groups.FirstOrDefault(g => g.Id == target.GroupId);
                    }
                    if (group == null)
                    {
                        group = new RetroGroup
                        {
                            ColumnKey = target.ColumnKey,
                            Title = Clamp(title, 80, Trim(target.Text, 40))
                        };
                        group.NoteIds.Add(target.Id);
                        target.GroupId = group.Id;
                        b.Groups.Add(group);
                    }
                }

                DetachFromCurrentGroup();
                if (!group.NoteIds.Contains(note.Id)) group.NoteIds.Add(note.Id);
                note.GroupId = group.Id;
                note.ColumnKey = group.ColumnKey;
                if (!string.IsNullOrWhiteSpace(title)) group.Title = Clamp(title, 80, group.Title);
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>
    /// Dot voting. delta is +1/-1; the server re-checks the per-person budget because the
    /// client's remaining-dots counter is advisory like every other client-side bound.
    /// </summary>
    public async Task RetroVote(string targetId, int delta)
    {
        if (RateLimited("retroVote", TimeSpan.FromMilliseconds(120))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            if (b.Phase != "vote") return;

            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;

            var noteTarget = b.Notes.FirstOrDefault(n => n.Id == targetId);
            var groupTarget = noteTarget == null ? b.Groups.FirstOrDefault(g => g.Id == targetId) : null;
            var votes = noteTarget?.Votes ?? groupTarget?.Votes;
            if (votes == null) return;
            // A grouped note is voted through its group, so the same sentiment can't be
            // double-counted by voting the cluster and its members separately.
            if (noteTarget?.GroupId != null) return;

            var spent = b.Notes.Where(n => n.GroupId == null).Sum(n => n.Votes.TryGetValue(me.Name, out var v) ? v : 0)
                      + b.Groups.Sum(g => g.Votes.TryGetValue(me.Name, out var v) ? v : 0);
            var current = votes.TryGetValue(me.Name, out var mine) ? mine : 0;
            var next = Math.Max(0, current + Math.Sign(delta));
            if (next > current && spent >= b.VotesPerPerson) return;

            if (next == 0) votes.Remove(me.Name); else votes[me.Name] = next;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>Discuss phase — spotlight a topic for the whole room, and tick it off.</summary>
    public async Task RetroSetTopic(string? topicId, bool markDiscussed = false)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            if (markDiscussed && topicId != null && !b.DiscussedNoteIds.Contains(topicId))
                b.DiscussedNoteIds.Add(topicId);
            b.CurrentTopicId = markDiscussed ? null : topicId;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>Link a note to the evidence it is about — a Jira issue or a P1 round.</summary>
    public async Task RetroLinkNote(string noteId, string? issueKey, string? roundId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null || b.Paused) return;
            var note = b.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null) return;

            if (!string.IsNullOrWhiteSpace(issueKey))
            {
                var key = Clamp(issueKey, 32, "");
                if (note.LinkedIssueKeys.Contains(key)) note.LinkedIssueKeys.Remove(key);
                else if (note.LinkedIssueKeys.Count < 10) note.LinkedIssueKeys.Add(key);
            }
            if (!string.IsNullOrWhiteSpace(roundId) && room.SessionRounds.Any(r => r.Id == roundId))
            {
                if (note.LinkedRoundIds.Contains(roundId)) note.LinkedRoundIds.Remove(roundId);
                else if (note.LinkedRoundIds.Count < 10) note.LinkedRoundIds.Add(roundId);
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    // ---- R4 — actionable items -------------------------------------------

    public async Task RetroAddAction(string text, string? owner, string? dueDate, List<string>? sourceNoteIds)
    {
        if (RateLimited("retroAddAction", TimeSpan.FromMilliseconds(300))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            if (b.Actions.Count >= RetroMaxActions) return;

            text = Clamp(text, RetroMaxNoteLength, "");
            if (text.Length == 0) return;

            b.Actions.Add(new RetroAction
            {
                Text = text,
                // Owners are picked from the room, but a name typed for someone who stepped
                // out is still valid — just length-capped like every other free-text field.
                Owner = Clamp(owner, 50, ""),
                DueDateUtc = ParseDate(dueDate),
                SourceNoteIds = (sourceNoteIds ?? new List<string>())
                    .Where(id => b.Notes.Any(n => n.Id == id) || b.Groups.Any(g => g.Id == id))
                    .Take(20).ToList(),
                CreatedInBoardId = b.Id
            });
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>
    /// R6 — this is also the Done / Still open / Drop control on the "Last time we said we'd…"
    /// strip, so closing a carried action is the same call as editing any other.
    /// </summary>
    public async Task RetroUpdateAction(string actionId, string? text, string? owner, string? dueDate, string? status)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        var petNotes = new List<string>();
        object? petPayload = null;
        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null) return;
            var action = b.Actions.FirstOrDefault(a => a.Id == actionId);
            if (action == null) return;

            var wasOpen = action.Status == "open" || action.Status == "in-progress";

            if (text != null)
            {
                var trimmed = Clamp(text, RetroMaxNoteLength, "");
                if (trimmed.Length > 0) action.Text = trimmed;
            }
            if (owner != null) action.Owner = Clamp(owner, 50, "");
            if (dueDate != null) action.DueDateUtc = ParseDate(dueDate);
            if (status != null && (status == "open" || status == "in-progress" || status == "done" || status == "dropped"))
                action.Status = status;

            // A carried action finally getting closed is the single most valuable thing a
            // team can do with a retro, so it is the pet's biggest reward.
            if (wasOpen && action.Status == "done")
            {
                var delta = action.CarryCount > 0 ? 25 : 12;
                var note = action.CarryCount > 0
                    ? $"a carried action was closed after {action.CarryCount + 1} retros"
                    : "a retro action was closed";
                if (AwardPet(room, "action-done", delta, note)) { petNotes.Add("action-done"); petPayload = PetPayload(room); }
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
        if (petPayload != null) await Clients.Group(roomName).SendAsync("PetUpdated", petPayload, petNotes);
    }

    /// <summary>
    /// R4 — push one action into Jira as a real ticket. Mirrors the WriteJiraEstimate write
    /// path exactly, including its per-item success/failure feedback and the SSRF guard.
    /// </summary>
    public async Task RetroPushActionToJira(string domain, string email, string token,
        string projectKey, string issueType, string actionId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        if (!TryValidateJiraDomain(domain, out var validatedDomain))
        {
            await Clients.Caller.SendAsync("RetroJiraResult", actionId, false, "Invalid domain", null, null);
            return;
        }
        if (string.IsNullOrWhiteSpace(projectKey))
        {
            await Clients.Caller.SendAsync("RetroJiraResult", actionId, false, "Project key required", null, null);
            return;
        }

        string summary, description;
        lock (room)
        {
            var b = ActiveRetro(room);
            var action = b?.Actions.FirstOrDefault(a => a.Id == actionId);
            if (b == null || action == null) return;
            if (action.JiraKey != null)
            {
                // Already pushed — creating a second ticket for the same action is never what
                // a second click means.
                return;
            }

            summary = Trim(action.Text, 200);
            var lines = new List<string> { action.Text, "" };
            if (!string.IsNullOrEmpty(action.Owner)) lines.Add($"Owner: {action.Owner}");
            if (action.DueDateUtc != null) lines.Add($"Due: {action.DueDateUtc:yyyy-MM-dd}");
            lines.Add($"Raised in retro: {b.Title}{(string.IsNullOrEmpty(b.SprintName) ? "" : " — " + b.SprintName)}");
            // Source stickies go in as evidence — but never on an anonymous board with any
            // hint of who wrote them, per R8.
            var sources = b.Notes.Where(n => action.SourceNoteIds.Contains(n.Id)).ToList();
            if (sources.Count > 0)
            {
                lines.Add("");
                lines.Add("From the board:");
                foreach (var n in sources)
                    lines.Add(b.Anonymous ? $"- {n.Text}" : $"- {n.Text} ({n.AuthorName})");
            }
            description = string.Join("\n", lines);
        }

        try
        {
            var issue = await _jiraService.CreateIssueAsync(validatedDomain, email, token,
                projectKey.Trim(), string.IsNullOrWhiteSpace(issueType) ? "Task" : issueType.Trim(),
                summary, description);

            lock (room)
            {
                var action = ActiveRetro(room)?.Actions.FirstOrDefault(a => a.Id == actionId);
                if (action != null) { action.JiraKey = issue.Key; action.JiraUrl = issue.Url; }
            }
            _roomService.SaveRoom(room);
            await Clients.Caller.SendAsync("RetroJiraResult", actionId, true, null, issue.Key, issue.Url);
            await BroadcastRetro(roomName, room);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("RetroJiraResult", actionId, false, ex.Message, null, null);
        }
    }

    /// <summary>
    /// R3 — fetch the sprint the retro is about and cache it on the board, so the whole room
    /// argues about evidence rather than memory. The result is cached server-side precisely
    /// so only one person needs Jira credentials.
    /// </summary>
    public async Task RetroFetchSprint(string domain, string email, string token, string sprintId,
        string? storyPointsField = null)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        if (!TryValidateJiraDomain(domain, out var validatedDomain))
        {
            await Clients.Caller.SendAsync("Error", "Jira domain must end in .atlassian.net");
            return;
        }
        if (string.IsNullOrWhiteSpace(sprintId)) return;

        JiraSprint sprint;
        try
        {
            sprint = await _jiraService.FetchSprintAsync(validatedDomain, email, token, sprintId.Trim(), storyPointsField);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Jira sprint fetch failed: {ex.Message}");
            return;
        }

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null) return;

            // Cross-reference against the room's own record (P1): what did we estimate this
            // at, and how hard was it to agree? A carried-over issue the room argued about
            // for three rounds is a retro topic that finds itself.
            var byKey = room.SessionRounds
                .Where(r => r.JiraKey != null)
                .GroupBy(r => r.JiraKey!)
                .ToDictionary(g => g.Key, g => new
                {
                    rounds = g.Count(),
                    estimate = g.OrderByDescending(r => r.RevealedAtUtc).First().FinalEstimate,
                    contested = g.Any(r => !r.WasUnanimous)
                });

            var context = new
            {
                id = sprint.Id,
                name = sprint.Name,
                goal = sprint.Goal,
                state = sprint.State,
                startDate = sprint.StartDate,
                endDate = sprint.EndDate,
                issues = sprint.Issues.Select(i => new
                {
                    key = i.Key,
                    summary = i.Summary,
                    status = i.Status,
                    statusCategory = i.StatusCategory,
                    issueType = i.IssueType,
                    assignee = i.Assignee,
                    resolvedAt = i.ResolvedAt,
                    storyPoints = i.StoryPoints,
                    url = i.Url,
                    ourRounds = byKey.TryGetValue(i.Key, out var m) ? m.rounds : 0,
                    ourEstimate = byKey.TryGetValue(i.Key, out var m2) ? m2.estimate : null,
                    ourContested = byKey.TryGetValue(i.Key, out var m3) && m3.contested
                }).ToList(),
                committedPoints = sprint.Issues.Sum(i => i.StoryPoints ?? 0),
                completedPoints = sprint.Issues.Where(i => i.StatusCategory == "done").Sum(i => i.StoryPoints ?? 0),
                carriedOver = sprint.Issues.Count(i => i.StatusCategory != "done")
            };

            b.SprintContextJson = System.Text.Json.JsonSerializer.Serialize(context);
            if (string.IsNullOrEmpty(b.SprintName)) b.SprintName = sprint.Name;
            if (string.IsNullOrEmpty(b.SprintGoal)) b.SprintGoal = sprint.Goal;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    /// <summary>R5 — archive the board. Open actions carry forward on the next RetroStart.</summary>
    public async Task RetroClose()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        var petNotes = new List<string>();
        object? petPayload = null;
        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            b.Phase = "closed";
            b.ClosedAtUtc = DateTime.UtcNow;
            b.CurrentTopicId = null;

            var assigned = b.Actions.Count(a => a.Status == "open" && !string.IsNullOrEmpty(a.Owner));
            if (assigned > 0 && AwardPet(room, "retro-closed", Math.Min(40, 10 + 5 * assigned),
                    $"retro closed with {assigned} action{(assigned == 1 ? "" : "s")} owned"))
            {
                petNotes.Add("retro-closed");
                petPayload = PetPayload(room);
            }
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
        if (petPayload != null) await Clients.Group(roomName).SendAsync("PetUpdated", petPayload, petNotes);
    }

    private static string Clamp(string? s, int max, string fallback)
    {
        if (string.IsNullOrWhiteSpace(s)) return fallback;
        s = s.Trim();
        return s.Length <= max ? s : s[..max];
    }

    // Whitelist rather than sanitize: these land straight in a style attribute client-side.
    private static string SafeColour(string? raw, string fallback)
    {
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        raw = raw.Trim();
        if (raw.Length is not (4 or 7) || raw[0] != '#') return fallback;
        for (var i = 1; i < raw.Length; i++)
            if (!Uri.IsHexDigit(raw[i])) return fallback;
        return raw;
    }

    private static DateTime? ParseDate(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? null
            : DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? d : null;

    // ========================================================================
    // F11/P5 — Standup / round-robin
    // ========================================================================

    private const int StandupMinSeconds = 15;
    private const int StandupMaxSeconds = 600;

    // Caller must hold the room lock.
    private static object? StandupPayload(Room room)
    {
        var s = room.Standup;
        if (s == null) return null;
        return new
        {
            active = s.Active,
            order = s.Order.ToList(),
            currentIndex = s.CurrentIndex,
            current = s.CurrentIndex >= 0 && s.CurrentIndex < s.Order.Count ? s.Order[s.CurrentIndex] : null,
            secondsPerPerson = s.SecondsPerPerson,
            startedAtUtc = s.StartedAtUtc,
            turnStartedAtUtc = s.TurnStartedAtUtc,
            skipped = s.Skipped.ToList(),
            done = s.Done.ToList(),
            // Notes are prepared beforehand and read out loud anyway, so unlike retro
            // stickies there is nothing to hide here.
            notes = s.Notes.ToDictionary(kv => kv.Key, kv => (object)new
            {
                yesterday = kv.Value.Yesterday,
                today = kv.Value.Today,
                blockers = kv.Value.Blockers,
                updatedAtUtc = kv.Value.UpdatedAtUtc
            })
        };
    }

    /// <summary>P5 — start the round robin. Order follows the seating if the room is using
    /// chairs, otherwise the participant list; "shuffle" randomises it.</summary>
    public async Task StandupStart(string order = "seating", int secondsPerPerson = 90)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        object? payload;
        lock (room)
        {
            var names = room.Participants.Where(p => !p.IsObserver && !p.IsGhost).Select(p => p.Name).Distinct().ToList();
            if (order == "shuffle")
            {
                var rng = new Random();
                names = names.OrderBy(_ => rng.Next()).ToList();
            }
            else if (order == "seating")
            {
                var seatOf = room.ChairClaims.ToDictionary(kv => kv.Value.Name, kv => kv.Key);
                names = names.OrderBy(n => seatOf.TryGetValue(n, out var idx) ? idx : int.MaxValue)
                             .ThenBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
            }
            if (names.Count == 0) return;

            var existingNotes = room.Standup?.Notes ?? new Dictionary<string, StandupNote>();
            room.Standup = new StandupState
            {
                Active = true,
                Order = names,
                CurrentIndex = 0,
                SecondsPerPerson = Math.Clamp(secondsPerPerson, StandupMinSeconds, StandupMaxSeconds),
                StartedAtUtc = DateTime.UtcNow,
                TurnStartedAtUtc = DateTime.UtcNow,
                // Notes survive between standups — people fill them in beforehand.
                Notes = existingNotes
            };
            payload = StandupPayload(room);
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StandupUpdated", payload);
    }

    /// <summary>Advance, skip or rewind. direction &gt; 0 moves on, &lt; 0 goes back.</summary>
    public async Task StandupAdvance(int direction = 1, bool skip = false)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        object? payload;
        bool finished = false;
        lock (room)
        {
            var s = room.Standup;
            if (s == null || !s.Active) return;

            if (s.CurrentIndex >= 0 && s.CurrentIndex < s.Order.Count && direction > 0)
            {
                var who = s.Order[s.CurrentIndex];
                var list = skip ? s.Skipped : s.Done;
                if (!list.Contains(who)) list.Add(who);
                (skip ? s.Done : s.Skipped).Remove(who);
            }

            s.CurrentIndex += direction > 0 ? 1 : -1;
            if (s.CurrentIndex < 0) s.CurrentIndex = 0;
            if (s.CurrentIndex >= s.Order.Count) { s.Active = false; finished = true; }
            s.TurnStartedAtUtc = DateTime.UtcNow;
            payload = StandupPayload(room);
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StandupUpdated", payload);
        if (finished) await Clients.Group(roomName).SendAsync("StandupFinished");
    }

    public async Task StandupStop()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        object? payload;
        lock (room)
        {
            if (room.Standup == null) return;
            room.Standup.Active = false;
            payload = StandupPayload(room);
        }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StandupUpdated", payload);
    }

    /// <summary>Your own yesterday/today/blockers, editable any time — that is the point of
    /// preparing them before the meeting rather than during it.</summary>
    public async Task StandupSetNote(string? yesterday, string? today, string? blockers)
    {
        if (RateLimited("standupNote", TimeSpan.FromMilliseconds(300))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        object? payload;
        lock (room)
        {
            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;
            room.Standup ??= new StandupState();
            room.Standup.Notes[me.Name] = new StandupNote
            {
                Yesterday = Clamp(yesterday, 600, ""),
                Today = Clamp(today, 600, ""),
                Blockers = Clamp(blockers, 600, ""),
                UpdatedAtUtc = DateTime.UtcNow
            };
            payload = StandupPayload(room);
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StandupUpdated", payload);
    }

    /// <summary>
    /// P5 — a blocker raised in standup goes straight onto the retro board rather than being
    /// forgotten by Friday. Lands in the "didn't go well" column, or the board's second
    /// column for formats that have no such key.
    /// </summary>
    public async Task StandupBlockerToRetro(string text)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            var b = ActiveRetro(room);
            if (b == null || b.ClosedAtUtc != null) return;
            if (b.Notes.Count >= RetroMaxNotes) return;
            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;

            text = Clamp(text, RetroMaxNoteLength, "");
            if (text.Length == 0) return;

            var column = b.Columns.FirstOrDefault(c => c.Key == "didnt")
                ?? b.Columns.OrderBy(c => c.Order).Skip(1).FirstOrDefault()
                ?? b.Columns.FirstOrDefault();
            if (column == null) return;

            b.Notes.Add(new RetroNote
            {
                ColumnKey = column.Key,
                Text = text,
                AuthorName = me.Name,
                Colour = "#f8d7da",
                X = 0.5,
                Y = 0.5
            });
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await BroadcastRetro(roomName, room);
    }

    // ========================================================================
    // F11/P2 — Reference deck (calibration anchors)
    // ========================================================================

    /// <summary>
    /// Pin up to Room.MaxReferenceStories already-estimated stories as live calibration
    /// examples beside the deck. Host-gated through the same path as every other room-level
    /// setting, and filtered server-side to completed stories that actually have an estimate
    /// so a crafted client can't pin an unestimated story and render an empty anchor.
    /// </summary>
    public async Task SetReferenceStories(List<string>? storyIds)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        List<string> accepted;
        lock (room)
        {
            accepted = (storyIds ?? new List<string>())
                .Distinct()
                .Where(id => room.Stories.Any(s => s.Id == id && s.IsCompleted && !string.IsNullOrEmpty(s.FinalEstimate)))
                .Take(Room.MaxReferenceStories)
                .ToList();
            room.ReferenceStoryIds = accepted;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("ReferenceStoriesUpdated", accepted);
    }

    // ========================================================================
    // F11/P3 — Proxy / absentee voting
    // ========================================================================

    /// <summary>
    /// Called from the standalone /room/{name}/prevote page, which is deliberately NOT joined
    /// to the SignalR group: an absentee leaving estimates in advance must not appear in the
    /// participant list, claim a chair or trip the auto-reveal quorum. That means there is no
    /// connection→room mapping to read, so the room name, display name and PIN all travel
    /// explicitly, and the PIN is re-checked here exactly as JoinRoom checks it.
    /// </summary>
    public async Task PrevoteJoin(string roomName, string userName, string? pin = null)
    {
        roomName = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(roomName)) { await Clients.Caller.SendAsync("Error", "INVALID_ROOM"); return; }

        var room = _roomService.GetRoom(roomName);
        if (room == null) { await Clients.Caller.SendAsync("Error", "NO_SUCH_ROOM"); return; }

        // Same casual-deterrent semantics as JoinRoom, minus its first-joiner exemption:
        // pre-voting never creates a room, so there is no "first joiner" to exempt.
        if (room.Pin != null && room.Pin != pin) { await Clients.Caller.SendAsync("Error", "PIN_REQUIRED"); return; }

        userName = string.IsNullOrWhiteSpace(userName) ? "Anonymous" : userName.Trim();
        if (userName.Length > 50) userName = userName[..50];

        object payload;
        lock (room)
        {
            var mine = new Dictionary<string, string>();
            foreach (var kv in room.ProxyVotes)
                if (kv.Value.TryGetValue(userName, out var v)) mine[kv.Key] = v;

            payload = new
            {
                roomName = room.Name,
                name = userName,
                countProxyVotes = room.CountProxyVotes,
                estimateValues = EstimateValuesFor(room),
                stories = room.Stories.Where(s => !s.IsCompleted).Select(s => new
                {
                    id = s.Id,
                    title = s.Title,
                    jiraKey = s.JiraKey,
                    jiraUrl = s.JiraUrl,
                    description = s.Description,
                    isCurrent = s.Id == room.CurrentStoryId
                }).ToList(),
                myVotes = mine
            };
        }

        await Clients.Caller.SendAsync("PrevoteState", payload);
    }

    /// <summary>F11/P3 — leave (or clear, with a null vote) one pre-cast estimate.</summary>
    public async Task CastProxyVote(string roomName, string userName, string? pin, string storyId, string? vote)
    {
        if (vote != null && vote.Length > 16) return;
        if (RateLimited("proxyVote", TimeSpan.FromMilliseconds(200))) return;

        roomName = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(roomName)) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (room.Pin != null && room.Pin != pin) { await Clients.Caller.SendAsync("Error", "PIN_REQUIRED"); return; }

        userName = string.IsNullOrWhiteSpace(userName) ? "Anonymous" : userName.Trim();
        if (userName.Length > 50) userName = userName[..50];

        bool isCurrent;
        lock (room)
        {
            var story = room.Stories.FirstOrDefault(s => s.Id == storyId && !s.IsCompleted);
            if (story == null) return;

            if (!room.ProxyVotes.TryGetValue(storyId, out var forStory))
                room.ProxyVotes[storyId] = forStory = new Dictionary<string, string>();

            if (vote == null) forStory.Remove(userName);
            else forStory[userName] = vote;

            if (forStory.Count == 0) room.ProxyVotes.Remove(storyId);
            isCurrent = room.CurrentStoryId == storyId;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Caller.SendAsync("ProxyVoteAccepted", storyId, vote);
        // The room only cares while that story is on the table; a pre-vote for story #14
        // shouldn't redraw anybody's deck.
        if (isCurrent) await Clients.Group(roomName).SendAsync("ProxyVotesUpdated", storyId, ProxyVotesFor(room, storyId));
    }

    /// <summary>
    /// F11/P3 — host opt-in for whether pre-cast votes move the room's numbers. Off by
    /// default: the absent cards are always *shown*, but a stale pre-vote from last week
    /// must not quietly decide a consensus unless the host says it should.
    /// </summary>
    public async Task SetCountProxyVotes(bool enabled)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        lock (room) { room.CountProxyVotes = enabled; room.LastActivity = DateTime.UtcNow; }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("CountProxyVotesUpdated", enabled);
    }

    // Caller must hold the room lock.
    private static List<object> ProxyVotesFor(Room room, string? storyId)
    {
        if (storyId == null || !room.ProxyVotes.TryGetValue(storyId, out var forStory)) return new List<object>();
        // An absentee who turned up after all still votes live; showing both would double them.
        return forStory
            .Where(kv => !room.Participants.Any(p => p.Name == kv.Key))
            .Select(kv => (object)new { name = kv.Key, vote = room.VotesRevealed ? kv.Value : null, hasVoted = true })
            .ToList();
    }

    private static string[] EstimateValuesFor(Room room)
    {
        if (room.EstimateSet == "custom" && !string.IsNullOrEmpty(room.CustomEstimates))
            return room.CustomEstimates.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToArray();
        if (RoomService.EstimateSets.TryGetValue(room.EstimateSet, out var info)) return info.Values;
        return RoomService.EstimateSets["fibonacci"].Values;
    }

    // ========================================================================
    // F11/P7 — Estimate prediction pool
    // ========================================================================

    /// <summary>
    /// Wager on what the final estimate will be, before the reveal. Predictions are private
    /// until resolution for exactly the reason the votes are: a visible call anchors the
    /// room. Locked (and scored) by ResolvePredictions inside RevealVotes.
    /// </summary>
    public async Task CastPrediction(string? value)
    {
        if (value != null && value.Length > 16) return;
        if (RateLimited("prediction", TimeSpan.FromMilliseconds(200))) return;

        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        int count;
        lock (room)
        {
            if (room.VotesRevealed) return;
            var storyId = room.CurrentStoryId;
            if (storyId == null) return;
            var me = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (me == null) return;

            if (!room.Predictions.TryGetValue(storyId, out var forStory))
                room.Predictions[storyId] = forStory = new Dictionary<string, string>();

            if (value == null) forStory.Remove(me.Name);
            else forStory[me.Name] = value;
            count = forStory.Count;
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Caller.SendAsync("PredictionAccepted", value);
        // Only the tally travels to the room — never who called what.
        await Clients.Group(roomName).SendAsync("PredictionCountUpdated", count);
    }

    /// <summary>
    /// Scores the current story's predictions against the round that just revealed. Caller
    /// must hold the room lock (it is invoked from inside RevealVotes' existing one).
    /// Returns null when there was nothing to resolve.
    /// </summary>
    private static object? ResolvePredictions(Room room, SessionRound round)
    {
        var storyId = round.StoryId;
        if (storyId == null) return null;
        if (!room.Predictions.TryGetValue(storyId, out var preds) || preds.Count == 0) return null;

        var final = round.FinalEstimate;
        if (string.IsNullOrEmpty(final)) return null;

        var today = TodayUtc();
        if (!room.PredictionScores.TryGetValue(today, out var todayScores))
            room.PredictionScores[today] = todayScores = new Dictionary<string, int>();

        var entries = new List<object>();
        foreach (var kv in preds.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
        {
            var correct = string.Equals(kv.Value, final, StringComparison.OrdinalIgnoreCase);
            if (correct) todayScores[kv.Key] = todayScores.TryGetValue(kv.Key, out var c) ? c + 1 : 1;
            entries.Add(new { name = kv.Key, predicted = kv.Value, correct });
        }

        room.PredictionOutcomes[storyId] = final;
        // Cleared so a re-vote on the same story collects fresh calls rather than re-scoring
        // predictions that were made against a round that has already happened.
        room.Predictions.Remove(storyId);

        // Feeds the existing podium/badges machinery as a pseudo-game, ranked by calls made
        // right today. UpsertDailyStandings can only express an ordering, which is why the
        // running counts live on Room.PredictionScores.
        var ranked = todayScores.Where(kv => kv.Value > 0)
            .OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
            .Select(kv => kv.Key).ToList();
        if (ranked.Count > 0) UpsertDailyStandings(room, "predictions", ranked);

        var cutoff = DateTime.UtcNow.AddDays(-400).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        foreach (var stale in room.PredictionScores.Keys.Where(d => string.Compare(d, cutoff, StringComparison.Ordinal) < 0).ToList())
            room.PredictionScores.Remove(stale);

        return new
        {
            storyId,
            roundId = round.Id,
            finalEstimate = final,
            entries,
            scores = todayScores.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
                .Select(kv => new { name = kv.Key, correct = kv.Value }).ToList<object>()
        };
    }

    // ========================================================================
    // F11/P8 — Team pet
    // ========================================================================

    private static readonly string[] PetSpecies = { "blob", "cat", "dragon", "owl", "axolotl", "robot" };

    // XP per level, flat. Levels only ever unlock cosmetics — nothing about the pet may gate,
    // block or alter a real feature.
    private const int PetXpPerLevel = 120;

    private static int PetLevel(int xp) => 1 + Math.Max(0, xp) / PetXpPerLevel;

    /// <summary>
    /// Mood is DERIVED on every read, never trusted as stored truth, so it cannot drift out
    /// of sync between clients. Trailing-14-day XP versus actions that have aged across two
    /// or more retros. Deliberately team-level: it must never read as blaming a person.
    /// Caller must hold the room lock.
    /// </summary>
    private static string DerivePetMood(Room room, TeamPet pet)
    {
        var since = DateTime.UtcNow.AddDays(-14);
        var recentXp = pet.Log.Where(e => e.AtUtc >= since).Sum(e => e.Delta);
        var agedActions = room.RetroBoards
            .SelectMany(b => b.Actions)
            .Count(a => a.Status == "open" && a.CarryCount >= 2);
        var quiet = room.LastActivity < DateTime.UtcNow.AddDays(-14);

        if (agedActions >= 3 || quiet) return "sulking";
        if (agedActions >= 1 && recentXp < 40) return "restless";
        if (recentXp >= 120) return "thriving";
        if (recentXp >= 40) return "happy";
        if (recentXp <= 0) return "restless";
        return "content";
    }

    /// <summary>Caller must hold the room lock. Returns true when the pet actually moved.</summary>
    private static bool AwardPet(Room room, string kind, int delta, string note)
    {
        if (!room.PetEnabled || room.Pet == null || delta == 0) return false;
        var pet = room.Pet;
        pet.Xp = Math.Max(0, pet.Xp + delta);
        pet.Log.Add(new PetEvent { Kind = kind, Delta = delta, Note = note });
        if (pet.Log.Count > TeamPet.MaxLog) pet.Log.RemoveRange(0, pet.Log.Count - TeamPet.MaxLog);
        pet.LastMoodEvalUtc = DateTime.UtcNow;
        pet.Mood = DerivePetMood(room, pet);
        return true;
    }

    // Caller must hold the room lock.
    private static object? PetPayload(Room room)
    {
        if (!room.PetEnabled || room.Pet == null) return null;
        var pet = room.Pet;
        pet.Mood = DerivePetMood(room, pet);
        var level = PetLevel(pet.Xp);
        return new
        {
            species = pet.Species,
            name = pet.Name,
            adoptedAtUtc = pet.AdoptedAtUtc,
            xp = pet.Xp,
            level,
            xpIntoLevel = pet.Xp % PetXpPerLevel,
            xpPerLevel = PetXpPerLevel,
            mood = pet.Mood,
            accessories = PetAccessoriesFor(level),
            log = pet.Log.OrderByDescending(e => e.AtUtc).Take(20)
                .Select(e => new { atUtc = e.AtUtc, kind = e.Kind, delta = e.Delta, note = e.Note }).ToList<object>()
        };
    }

    private static List<string> PetAccessoriesFor(int level)
    {
        var unlocked = new List<string>();
        if (level >= 2) unlocked.Add("scarf");
        if (level >= 4) unlocked.Add("hat");
        if (level >= 6) unlocked.Add("glasses");
        if (level >= 8) unlocked.Add("cape");
        if (level >= 10) unlocked.Add("crown");
        return unlocked;
    }

    /// <summary>
    /// F11/P8 — the scoring pass that runs after a reveal. Every input already existed before
    /// this feature; the pet is almost entirely derived state.
    /// </summary>
    private async Task AwardPetForRound(string roomName, Room room)
    {
        object? payload = null;
        var notes = new List<string>();
        lock (room)
        {
            if (!room.PetEnabled || room.Pet == null) return;

            var rounds = room.SessionRounds;
            if (rounds.Count == 0) return;
            var last = rounds[^1];

            if (last.WasUnanimous && last.RoundNumber == 1)
            {
                if (AwardPet(room, "unanimous", 5, "first-round agreement on " + Trim(last.StoryTitle, 40))) notes.Add("unanimous");
            }

            // Escalating streak bonus, awarded on the 3rd consecutive unanimous round and
            // every one after it, so a team on a roll feels it.
            var streak = 0;
            for (var i = rounds.Count - 1; i >= 0 && rounds[i].WasUnanimous; i--) streak++;
            if (last.WasUnanimous && streak >= 3)
            {
                if (AwardPet(room, "streak", Math.Min(20, 2 * streak), $"consensus streak of {streak}")) notes.Add("streak");
            }

            var voters = room.Participants.Where(p => !p.IsObserver && !p.IsGhost).ToList();
            if (voters.Count >= 2 && voters.All(p => p.Vote != null))
            {
                if (AwardPet(room, "everyone-voted", 2, "everybody voted")) notes.Add("everyone-voted");
            }

            var today = TodayUtc();
            var playersToday = room.LeaderboardLog.Where(e => e.Date == today).Select(e => e.Name).Distinct().Count();
            if (playersToday >= 3 && !room.Pet.Log.Any(e => e.Kind == "daily-game" && e.AtUtc.Date == DateTime.UtcNow.Date))
            {
                if (AwardPet(room, "daily-game", 3, "the room played today's game together")) notes.Add("daily-game");
            }

            if (notes.Count > 0) payload = PetPayload(room);
        }

        if (payload == null) return;
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("PetUpdated", payload, notes);
    }

    private static string Trim(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s[..max].TrimEnd() + "…");

    /// <summary>F11/P8 — host adopts once per room. Species is permanent; the name is not.</summary>
    public async Task AdoptPet(string species, string name)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        if (!PetSpecies.Contains(species)) species = "blob";
        name = string.IsNullOrWhiteSpace(name) ? "Pixel" : name.Trim();
        if (name.Length > 24) name = name[..24];

        object? payload;
        lock (room)
        {
            if (room.Pet != null) return; // adopt once; use RenamePet afterward
            room.Pet = new TeamPet { Species = species, Name = name };
            AwardPet(room, "adopted", 10, $"{name} moved in");
            payload = PetPayload(room);
            room.LastActivity = DateTime.UtcNow;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("PetUpdated", payload, new List<string> { "adopted" });
    }

    public async Task RenamePet(string name)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        name = string.IsNullOrWhiteSpace(name) ? "Pixel" : name.Trim();
        if (name.Length > 24) name = name[..24];

        object? payload;
        lock (room)
        {
            if (room.Pet == null) return;
            room.Pet.Name = name;
            payload = PetPayload(room);
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("PetUpdated", payload, new List<string>());
    }

    /// <summary>F11/P8 — room-wide off switch. (The per-viewer hide lives in localStorage.)</summary>
    public async Task SetPetEnabled(bool enabled)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null) return;
        if (!CanChangeRoomSetting(room, Context.ConnectionId)) return;

        object? payload;
        lock (room) { room.PetEnabled = enabled; payload = PetPayload(room); }
        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("PetEnabledUpdated", enabled, payload);
    }

    private object BuildRoomState(Room room, string requestingConnectionId, bool showSetupPrompt = false)
    {
        // Build entirely under the room lock and materialize every collection (.ToList()/
        // .ToArray()) before returning — SignalR serializes the returned object after this
        // method returns, so any deferred LINQ over room.Participants/Stories/ChairClaims
        // left un-materialized could enumerate concurrently with a join/leave mutating them.
        lock (room)
        {
            // Roll every game over to today first, then take one needs-setup snapshot each.
            // A game that needs setup has no puzzle at all: the client shows its settings form
            // (pre-filled from gameSettings below) instead of the board, and every payload
            // field that would describe a puzzle stays empty/null so nothing leaks before the
            // room has chosen the day's shape.
            foreach (var g in ConfigurableGames) EnsureGamePuzzle(room, g);
            var gameNeedsSetup = ConfigurableGames.ToDictionary(g => g, g => GameNeedsSetup(room, g));
            var gameSettings = ConfigurableGames.ToDictionary(g => g, g => GameSettingsPayload(room, g));
            var wordleNeedsSetup = gameNeedsSetup["wordle"];
            var acrosticNeedsSetup = gameNeedsSetup["acrostic"];

            var requestingName = room.Participants.FirstOrDefault(p => p.ConnectionId == requestingConnectionId)?.Name;
            WordlePlayerState? myWordleState = null;
            if (!wordleNeedsSetup && requestingName != null) room.WordleStates.TryGetValue(requestingName, out myWordleState);

            var crosswordPuzzle = CurrentCrosswordPuzzle(room);
            var crosswordLayoutPayload = BuildCrosswordLayoutPayload(crosswordPuzzle);
            // Correctness per filled cell — safe to reveal (mirrors CrosswordFill's own
            // `correct` flag) and needed so a fresh join/reconnect can render the green
            // highlight for cells someone else already filled correctly before this client
            // ever received their live CrosswordCellFilled broadcast.
            var crosswordCorrect = new Dictionary<string, bool>();
            foreach (var kv in room.CrosswordCells)
            {
                var parts = kv.Key.Split(',');
                var cwr = int.Parse(parts[0], CultureInfo.InvariantCulture);
                var cwc = int.Parse(parts[1], CultureInfo.InvariantCulture);
                crosswordCorrect[kv.Key] = kv.Value.Length == 1 && crosswordPuzzle.Rows[cwr][cwc] == kv.Value[0];
            }

            var hangmanMasked = HangmanMasked(room);
            HangmanPlayerState? myHangmanState = null;
            if (requestingName != null) room.HangmanCompetitiveStates.TryGetValue(requestingName, out myHangmanState);

            GridFillPlayerState? myCrosswordState = null;
            if (requestingName != null) room.CrosswordCompetitiveStates.TryGetValue(requestingName, out myCrosswordState);
            var myCrosswordCorrect = new Dictionary<string, bool>();
            if (myCrosswordState != null)
            {
                foreach (var kv in myCrosswordState.Cells)
                {
                    var parts = kv.Key.Split(',');
                    var cwr = int.Parse(parts[0], CultureInfo.InvariantCulture);
                    var cwc = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    myCrosswordCorrect[kv.Key] = kv.Value.Length == 1 && crosswordPuzzle.Rows[cwr][cwc] == kv.Value[0];
                }
            }

            WordSearchPlayerState? myWordSearchState = null;
            if (requestingName != null) room.WordSearchCompetitiveStates.TryGetValue(requestingName, out myWordSearchState);

            SpellingBeePlayerState? mySpellingBee = null;
            if (requestingName != null) room.SpellingBeeStates.TryGetValue(requestingName, out mySpellingBee);

            JumblePlayerState? myJumble = null;
            if (requestingName != null) room.JumbleStates.TryGetValue(requestingName, out myJumble);

            var acrosticPuzzle = CurrentAcrosticPuzzle(room);
            // Null layout while un-configured — CurrentAcrosticPuzzle falls back to Puzzles[0],
            // which would otherwise hand the client a quote nobody has chosen yet.
            var acrosticLayoutPayload = acrosticNeedsSetup ? null : BuildAcrosticLayoutPayload(acrosticPuzzle);
            var acrosticCorrect = new Dictionary<string, bool>();
            foreach (var kv in room.AcrosticCells)
            {
                if (int.TryParse(kv.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var apos))
                    acrosticCorrect[kv.Key] = kv.Value.Length == 1 && apos < acrosticPuzzle.Quote.Length && acrosticPuzzle.Quote[apos] == kv.Value[0];
            }
            ConnectionsPlayerState? myConnections = null;
            if (requestingName != null) room.ConnectionsStates.TryGetValue(requestingName, out myConnections);
            var connectionsNeedsSetup = gameNeedsSetup["connections"];

            GridFillPlayerState? myAcrosticState = null;
            if (requestingName != null) room.AcrosticCompetitiveStates.TryGetValue(requestingName, out myAcrosticState);
            var myAcrosticCorrect = new Dictionary<string, bool>();
            if (myAcrosticState != null)
            {
                foreach (var kv in myAcrosticState.Cells)
                {
                    if (int.TryParse(kv.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var apos))
                        myAcrosticCorrect[kv.Key] = kv.Value.Length == 1 && apos < acrosticPuzzle.Quote.Length && acrosticPuzzle.Quote[apos] == kv.Value[0];
                }
            }

            var todayStr = TodayUtc();
            var dailyBadges = ComputeDailyBadges(room);
            var dailySummary = LeaderboardGames.ToDictionary(g => g, g =>
                room.LeaderboardLog.Where(e => e.Date == todayStr && e.Game == g)
                    .OrderByDescending(e => e.Points)
                    .Select(e => new { name = e.Name, points = e.Points })
                    .ToList<object>());

            string[] estimateValues;
            if (room.EstimateSet == "custom" && !string.IsNullOrEmpty(room.CustomEstimates))
            {
                estimateValues = room.CustomEstimates.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToArray();
            }
            else if (RoomService.EstimateSets.TryGetValue(room.EstimateSet, out var info))
            {
                estimateValues = info.Values;
            }
            else
            {
                estimateValues = RoomService.EstimateSets["fibonacci"].Values;
            }

            return new
            {
                name = room.Name,
                // True only on the very first join of a freshly created room — gates the
                // one-shot "you're the host" settings-lock prompt client-side.
                showSetupPrompt,
                autoReveal = room.AutoReveal,
                votesRevealed = room.VotesRevealed,
                ghostModeEnabled = room.GhostModeEnabled,
                revealMajorityFirst = room.RevealMajorityFirst,
                hasPin = room.Pin != null,
                currentStoryId = room.CurrentStoryId,
                estimateSet = room.EstimateSet,
                estimateValues,
                customEstimates = room.CustomEstimates,
                // AD1 — host info
                isHost = room.HostConnectionId == requestingConnectionId,
                hostConnectionId = room.HostConnectionId,
                settingsLockMode = room.SettingsLockMode,
                leaveRequestTimeoutSeconds = room.LeaveRequestTimeoutSeconds,
                participants = room.Participants.Select(p => new
                {
                    connectionId = p.ConnectionId,
                    name = p.Name,
                    isObserver = p.IsObserver,
                    isGhost = p.IsGhost,
                    counterUsed = p.CounterUsed,
                    hasVoted = p.Vote != null,
                    vote = room.VotesRevealed ? p.Vote : null,
                    avatarData = p.AvatarData,
                    confidence = room.VotesRevealed ? p.Confidence : null,
                    posX = p.PosX, posZ = p.PosZ, yaw = p.Yaw, pose = p.Pose
                }).ToList(),
                stories = room.Stories.Select(s => new
                {
                    id = s.Id,
                    title = s.Title,
                    isCompleted = s.IsCompleted,
                    finalEstimate = s.FinalEstimate,
                    createdAt = s.CreatedAt,
                    jiraKey = s.JiraKey,
                    jiraUrl = s.JiraUrl,
                    description = s.Description,
                    notes = s.Notes,
                    issueType = s.IssueType
                }).ToList(),
                // Room Scene seating so a joiner immediately sees who sits where.
                chairClaims = room.ChairClaims.Select(kv => new
                {
                    idx = kv.Key,
                    name = kv.Value.Name,
                    color = kv.Value.Color,
                    connectionId = kv.Value.ConnectionId
                }).ToList(),
                roomLayout = room.RoomLayoutJson,
                whiteboardStrokes = room.WhiteboardStrokes.ToList(),
                roomIcon = room.RoomIcon,
                chairPositions = room.ChairPositionsJson,
                decorPositions = room.DecorPositionsJson,
                sceneConfig = room.SceneConfigJson,
                // Wordle: only the caller's own guesses (with server-computed feedback) come
                // back, never the word itself. Everyone else is a status-only summary. When no
                // one has configured today's game yet, the client renders a setup form instead
                // of the grid, using wordleAllowedLengths/wordleLengthMode/wordleLength/
                // wordleMaxGuesses as its pre-filled defaults.
                wordlePuzzleId = room.WordlePuzzleId,
                wordleNeedsSetup,
                wordleLengthMode = room.WordleLengthMode,
                wordleLength = room.WordleLength,
                wordleMaxGuesses = room.WordleMaxGuesses,
                wordleAllowedLengths = _wordList.AllowedWordleLengths,
                // The current day's actual answer length — safe to reveal (it sizes the grid)
                // even though the letters themselves never are; differs from wordleLength only
                // in "UpTo" mode, where the daily word's length is chosen within 5..wordleLength.
                wordleWordLength = wordleNeedsSetup ? (int?)null : room.WordleWord!.Length,
                myWordle = myWordleState == null ? null : new
                {
                    solved = myWordleState.Solved,
                    failed = myWordleState.Failed,
                    guesses = myWordleState.Guesses
                        .Select(g => new { word = g, feedback = ScoreWordleGuess(g, room.WordleWord!) })
                        .ToList()
                },
                wordleStatuses = wordleNeedsSetup ? new List<object>() : room.WordleStates
                    .Select(kv => new
                    {
                        name = kv.Key,
                        solved = kv.Value.Solved,
                        failed = kv.Value.Failed,
                        attempts = kv.Value.Guesses.Count
                    })
                    .ToList<object>(),
                // Crossword: solution grid never leaves the server — only structure (black
                // cells, clue numbers/text) and the already-typed, non-secret fill state.
                crosswordPuzzleId = room.CrosswordPuzzleId,
                crosswordMode = room.CrosswordMode,
                crosswordLayout = crosswordLayoutPayload,
                crosswordCells = room.CrosswordCells.ToDictionary(kv => kv.Key, kv => kv.Value),
                crosswordCorrect,
                myCrossword = myCrosswordState == null ? null : new { cells = myCrosswordState.Cells, correct = myCrosswordCorrect, solved = myCrosswordState.Solved },
                // Hangman: masked word is safe — every revealed letter was already broadcast
                // to the whole room, so the mask contains no information a fresh joiner
                // couldn't already have pieced together from HangmanLetterGuessed history.
                hangmanPuzzleId = room.HangmanPuzzleId,
                hangmanMode = room.HangmanMode,
                hangmanMasked,
                hangmanClue = room.HangmanClue,
                hangmanGuessedLetters = room.HangmanGuessedLetters.ToList(),
                hangmanWrongCount = room.HangmanWrongCount,
                hangmanMaxWrong = room.HangmanMaxWrong,
                hangmanGuessedBy = room.HangmanGuessedBy.ToDictionary(kv => kv.Key, kv => kv.Value),
                myHangman = myHangmanState == null ? null : new
                {
                    guessedLetters = myHangmanState.GuessedLetters.ToList(),
                    wrongCount = myHangmanState.WrongCount,
                    solved = myHangmanState.Solved,
                    failed = myHangmanState.Failed,
                    masked = room.HangmanWord == null ? "" : HangmanMaskedFor(room.HangmanWord, myHangmanState.GuessedLetters)
                },
                // Word Search: grid + word list are safe to send outright (finding a word is
                // the whole point); only the solution coordinates for words nobody has found
                // yet stay server-only.
                wordSearchPuzzleId = room.WordSearchPuzzleId,
                wordSearchMode = room.WordSearchMode,
                wordSearchGridRows = room.WordSearchGridRows,
                wordSearchWords = room.WordSearchWords,
                wordSearchFound = room.WordSearchFound.ToDictionary(kv => kv.Key, kv => new { foundBy = kv.Value.FoundBy, coords = kv.Value.Coords }),
                myWordSearch = myWordSearchState == null ? null : new { found = myWordSearchState.Found },
                // Spelling Bee: letters are safe; the valid-word/pangram sets and everyone
                // else's found words stay private — only the caller's own found words return.
                spellingBeePuzzleId = room.SpellingBeePuzzleId,
                spellingBeeMode = room.SpellingBeeMode,
                spellingBeeLetters = room.SpellingBeeLetters,
                mySpellingBee = mySpellingBee == null ? null : new { foundWords = mySpellingBee.FoundWords, score = mySpellingBee.Score },
                spellingBeeStatuses = room.SpellingBeeStates.Select(kv => new { name = kv.Key, score = kv.Value.Score, wordCount = kv.Value.FoundWords.Count }).ToList<object>(),
                spellingBeeSharedFound = room.SpellingBeeSharedFound,
                spellingBeeSharedScore = room.SpellingBeeSharedScore,
                // Jumble: scrambled tiles + marked positions are safe; the unscrambled answers
                // and final answer stay server-only — only the caller's own progress returns.
                jumblePuzzleId = room.JumblePuzzleId,
                jumbleMode = room.JumbleMode,
                jumbleScrambled = room.JumbleScrambled,
                jumbleMarkedIndex = room.JumbleMarkedIndex,
                myJumble = myJumble == null ? null : new
                {
                    wordsSolved = myJumble.WordsSolved,
                    solvedWords = myJumble.SolvedWords,
                    finalSolved = myJumble.FinalSolved,
                    attempts = myJumble.Attempts
                },
                jumbleStatuses = room.JumbleStates.Where(kv => kv.Value.FinalSolved)
                    .Select(kv => new { name = kv.Key, attempts = kv.Value.Attempts }).ToList<object>(),
                jumbleShared = room.JumbleSharedState == null ? null : new
                {
                    wordsSolved = room.JumbleSharedState.WordsSolved,
                    solvedWords = room.JumbleSharedState.SolvedWords,
                    finalSolved = room.JumbleSharedState.FinalSolved,
                    attempts = room.JumbleSharedState.Attempts
                },
                // Acrostic: quote/author/clue structure and non-secret fill state, same shape
                // as Crossword — which bank entry it is stays implicit (never sent as an index).
                acrosticPuzzleId = room.AcrosticPuzzleId,
                acrosticMode = room.AcrosticMode,
                acrosticLayout = acrosticLayoutPayload,
                acrosticCells = room.AcrosticCells.ToDictionary(kv => kv.Key, kv => kv.Value),
                acrosticCorrect,
                myAcrostic = myAcrosticState == null ? null : new { cells = myAcrosticState.Cells, correct = myAcrosticCorrect, solved = myAcrosticState.Solved },
                // Connections: the 16-word grid is safe to send outright (grouping it is the
                // whole game); the category memberships stay server-only until solved, which
                // is why only the *names* of already-solved categories and their words come
                // back rather than the full Categories list.
                connectionsPuzzleId = room.ConnectionsPuzzleId,
                connectionsMode = room.ConnectionsMode,
                connectionsWords = connectionsNeedsSetup ? new List<string>() : room.ConnectionsWords.ToList(),
                connectionsMistakesAllowed = room.ConnectionsMistakesAllowed,
                connectionsWordsPerCategory = room.ConnectionsWordsPerCategory,
                connectionsCategoryCount = room.ConnectionsCategoryCount,
                myConnections = myConnections == null ? null : ConnectionsStatePayload(room, myConnections),
                connectionsShared = room.ConnectionsSharedState == null ? null : ConnectionsStatePayload(room, room.ConnectionsSharedState),
                connectionsStatuses = connectionsNeedsSetup ? new List<object>() : room.ConnectionsStates
                    .Select(kv => (object)new
                    {
                        name = kv.Key,
                        solved = kv.Value.SolvedCategories.Count,
                        mistakes = kv.Value.Mistakes,
                        completed = kv.Value.Completed,
                        failed = kv.Value.Failed,
                        seconds = kv.Value.Seconds
                    }).ToList(),

                // ---- Feature 11 ------------------------------------------------------
                // P1 — the session record. Client-side `roomState.history` seeds from this
                // instead of only from live reveal events, which is what finally makes Hall
                // of Fame and Analytics visible to late joiners and after an F5.
                sessionRounds = room.SessionRounds.Select(SessionRoundPayload).ToList(),
                roundStartedAtUtc = room.RoundStartedAtUtc,
                // P2 — calibration anchors, resolved to their stories client-side.
                referenceStoryIds = room.ReferenceStoryIds.ToList(),
                // P3 — pre-cast votes for the story on the table, as greyed "absent" cards.
                // Values stay hidden until the reveal, exactly like live votes.
                proxyVotes = ProxyVotesFor(room, room.CurrentStoryId),
                countProxyVotes = room.CountProxyVotes,
                // P4 — the retro board, rendered for THIS viewer: during Collect they see only
                // their own notes, during Vote only their own dots. See RetroBoardPayload.
                retro = ActiveRetro(room) is { } activeBoard ? RetroBoardPayload(activeBoard, requestingName) : null,
                retroArchive = RetroArchivePayload(room),
                retroFormats = new[] { "default", "start-stop-continue", "mad-sad-glad", "4ls", "sailboat", "starfish" },
                retroLimits = new
                {
                    maxNoteLength = RetroMaxNoteLength,
                    maxNotes = RetroMaxNotes,
                    maxActions = RetroMaxActions,
                    votesPerPerson = new { min = RetroMinVotesPerPerson, max = RetroMaxVotesPerPerson }
                },
                // P5 — round robin.
                standup = StandupPayload(room),
                standupLimits = new { min = StandupMinSeconds, max = StandupMaxSeconds },
                // P7 — only your own call and the headcount; who predicted what stays private
                // until the reveal resolves it, for the same anchoring reason votes do.
                myPrediction = requestingName != null && room.CurrentStoryId != null
                    && room.Predictions.TryGetValue(room.CurrentStoryId, out var myPreds)
                    && myPreds.TryGetValue(requestingName, out var myCall) ? myCall : null,
                predictionCount = room.CurrentStoryId != null && room.Predictions.TryGetValue(room.CurrentStoryId, out var allPreds)
                    ? allPreds.Count : 0,
                predictionScores = room.PredictionScores.TryGetValue(TodayUtc(), out var todayCalls)
                    ? todayCalls.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(kv => (object)new { name = kv.Key, correct = kv.Value }).ToList()
                    : new List<object>(),
                // P8 — the team pet. Rendered page-wide by wwwroot/js/pet.js; owned by the room.
                petEnabled = room.PetEnabled,
                pet = PetPayload(room),
                petSpecies = PetSpecies,
                // Per-game setup state and the day's locked-in tunables, one entry per game in
                // ConfigurableGames. A game whose gameNeedsSetup entry is true has no puzzle yet:
                // its client renders the settings form (pre-filled from gameSettings) instead of
                // the board. gameLimits carries the server-side clamp ranges so each form can
                // build its inputs without duplicating the bounds client-side.
                gameNeedsSetup,
                gameSettings,
                gameLimits = GameLimitsPayload(_wordList),
                // Leaderboard: today's per-game standings + badges ride on every join/reconnect;
                // week/month/all-time are on-demand via GetLeaderboard.
                dailyBadges,
                dailySummary
            };
        }
    }

    private static object CalculateStats(Room room)
    {
        var numericVoters = room.Participants
            .Where(p => !p.IsObserver && p.Vote != null && double.TryParse(p.Vote!.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            .Select(p => (participant: p, val: double.Parse(p.Vote!.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture)))
            .ToList();

        // F11/P3 — pre-cast votes from people who aren't here. They move the average, the
        // range and the consensus flag only when the host has opted in; the outlier/shame
        // pick deliberately stays on people who are actually in the room, since there is no
        // sense in calling out an absentee for a card they played last Tuesday.
        var proxyValues = new List<double>();
        if (room.CountProxyVotes && room.CurrentStoryId != null
            && room.ProxyVotes.TryGetValue(room.CurrentStoryId, out var proxyForStory))
        {
            foreach (var kv in proxyForStory)
            {
                if (room.Participants.Any(p => p.Name == kv.Key)) continue; // they turned up after all
                if (double.TryParse(kv.Value.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture, out var pv))
                    proxyValues.Add(pv);
            }
        }

        if (numericVoters.Count == 0 && proxyValues.Count == 0)
            return new { average = (double?)null, min = (double?)null, max = (double?)null, isConsensus = false,
                         majorityValue = (string?)null, outlierValue = (string?)null,
                         shameParticipantName = (string?)null, shameParticipantId = (string?)null };

        var numericValues = numericVoters.Select(x => x.val).Concat(proxyValues).ToList();
        var avg = numericValues.Average();
        var min = numericValues.Min();
        var max = numericValues.Max();
        var isConsensus = numericValues.Distinct().Count() == 1;

        string? majorityValue = null, outlierValue = null, shameParticipantName = null, shameParticipantId = null;

        if (!isConsensus && numericVoters.Count >= 3)
        {
            var groups = numericVoters
                .GroupBy(x => x.participant.Vote!)
                .OrderByDescending(g => g.Count())
                .ToList();

            var topGroup = groups[0];
            if (topGroup.Count() * 2 >= numericVoters.Count)
            {
                majorityValue = topGroup.Key;
                var majorityNum = double.Parse(majorityValue.Replace("½", "0.5"), NumberStyles.Float, CultureInfo.InvariantCulture);

                var outliers = numericVoters
                    .Where(x => x.participant.Vote != majorityValue)
                    .OrderByDescending(x => Math.Abs(x.val - majorityNum))
                    .ToList();

                if (outliers.Count > 0)
                {
                    var maxDist = Math.Abs(outliers[0].val - majorityNum);
                    var farthest = outliers.Where(x => Math.Abs(x.val - majorityNum) == maxDist).ToList();

                    if (farthest.Count == 1)
                    {
                        var shame = farthest[0];
                        outlierValue = shame.participant.Vote;
                        shameParticipantName = shame.participant.Name;
                        shameParticipantId = shame.participant.ConnectionId;
                    }
                }
            }
        }

        return new { average = Math.Round(avg, 1), min, max, isConsensus,
                     majorityValue, outlierValue, shameParticipantName, shameParticipantId };
    }
}
