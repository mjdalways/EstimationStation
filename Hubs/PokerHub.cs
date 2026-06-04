using Microsoft.AspNetCore.SignalR;
using EstimationStation.Models;
using EstimationStation.Services;
using System.Collections.Concurrent;

namespace EstimationStation.Hubs;

public class PokerHub : Hub
{
    private readonly RoomService _roomService;
    private readonly JiraService _jiraService;
    private readonly LeaveRequestStore _leaveStore;

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

    public PokerHub(RoomService roomService, JiraService jiraService, LeaveRequestStore leaveStore)
    {
        _roomService = roomService;
        _jiraService = jiraService;
        _leaveStore = leaveStore;
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

        var room = _roomService.GetOrCreateRoom(roomName);

        // PIN check — skip for the very first joiner (they set the PIN after joining)
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
        lock (room)
        {
            bool midVote = !room.VotesRevealed && room.Participants.Any(p => !p.IsObserver && p.Vote != null);
            participant.IsGhost = room.GhostModeEnabled && midVote;
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

        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        _roomService.SaveRoom(room);

        // Send full state to the joining participant
        await Clients.Caller.SendAsync("RoomState", BuildRoomState(room, Context.ConnectionId));

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
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant != null)
            {
                participantName = participant.Name;
                room.Participants.Remove(participant);
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
        if (newHostId != null)
        {
            await Clients.Group(roomName).SendAsync("HostChanged", newHostId);
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

        Dictionary<string, string?> votes;
        object stats;
        lock (room)
        {
            room.VotesRevealed = true;
            votes = room.Participants.ToDictionary(p => p.ConnectionId, p => p.Vote);
            stats = CalculateStats(room);
            room.ShameParticipantId = FindShameParticipantId(room);
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesRevealed", votes, stats);
    }

    public async Task HideVotes()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            room.VotesRevealed = false;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesHidden");
    }

    public async Task ResetVotes()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
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
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("VotesReset");
        await Clients.Group(roomName).SendAsync("VibeUpdated", new Dictionary<string, int>());
    }

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

        lock (room)
        {
            room.CurrentStoryId = storyId;
            // Reset votes when switching story
            foreach (var p in room.Participants)
                p.Vote = null;
            room.VotesRevealed = false;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("CurrentStoryChanged", storyId);
        await Clients.Group(roomName).SendAsync("VotesReset");
    }

    public async Task DeleteStory(string storyId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        lock (room)
        {
            room.Stories.RemoveAll(s => s.Id == storyId);
            if (room.CurrentStoryId == storyId)
                room.CurrentStoryId = null;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("StoryDeleted", storyId);
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
        if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
        lock (room) { room.HostConnectionId = targetConnectionId; }
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
        if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
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
                var setName = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(valueJson)?["set"] ?? "fibonacci";
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
        if (!room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
        if (RateLimited("privateMsg", TimeSpan.FromMilliseconds(750))) return;
        var sender = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (sender == null) return;
        message = (message ?? "").Trim();
        if (message.Length > 500) message = message[..500];
        if (string.IsNullOrEmpty(message)) return;
        await Clients.Client(targetConnectionId).SendAsync("PrivateMessageReceived", sender.Name, message, DateTime.UtcNow);
    }

    // AD6 — Private emoji reaction to a single participant
    public async Task SendPrivateReaction(string targetConnectionId, string emoji)
    {
        if (string.IsNullOrWhiteSpace(emoji) || emoji.Length > 10) return;
        if (RateLimited("privateReaction", TimeSpan.FromMilliseconds(500))) return;
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || !room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
        var sender = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (sender == null) return;
        await Clients.Client(targetConnectionId).SendAsync("PrivateReactionReceived", sender.Name, emoji);
    }

    // AD7 — Private sound to a single participant
    public async Task SendSoundToParticipant(string targetConnectionId, string soundId)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        var room = _roomService.GetRoom(roomName);
        if (room == null || !room.Participants.Any(p => p.ConnectionId == targetConnectionId)) return;
        var sender = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (sender == null) return;
        var validSounds = new[] { "fanfare", "drumroll", "bell", "airhorn" };
        if (!validSounds.Contains(soundId)) return;
        if (RateLimited("sound", TimeSpan.FromSeconds(1))) return;
        await Clients.Client(targetConnectionId).SendAsync("SoundTriggered", soundId, sender.Name);
    }

    public async Task SetEstimateSet(string setName, string? customValues)
    {
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
                values = customValues.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToArray();
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

        // Strip protocol if user pasted a full URL
        domain = domain.Replace("https://", "").Replace("http://", "").TrimEnd('/');
        if (!domain.Contains(".atlassian.net"))
        {
            await Clients.Caller.SendAsync("Error", "Jira domain must end in .atlassian.net");
            return;
        }

        List<JiraIssue> issues;
        try
        {
            issues = await _jiraService.FetchIssuesAsync(domain, email, token, jql);
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
        var senderName = room?.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name ?? "Someone";
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

        domain = domain.Replace("https://", "").Replace("http://", "").TrimEnd('/');
        if (!domain.EndsWith(".atlassian.net", StringComparison.OrdinalIgnoreCase))
        {
            await Clients.Caller.SendAsync("JiraWriteResult", jiraKey, false, "Invalid domain");
            return;
        }

        try
        {
            await _jiraService.WriteEstimateAsync(domain, email, token, jiraKey, numericEstimate, fieldId);
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

    private static string? FindShameParticipantId(Room room)
    {
        var numericVoters = room.Participants
            .Where(p => !p.IsObserver && p.Vote != null && double.TryParse(p.Vote!.Replace("½", "0.5"), out _))
            .Select(p => (participant: p, val: double.Parse(p.Vote!.Replace("½", "0.5"))))
            .ToList();

        if (numericVoters.Count < 3) return null;

        var groups = numericVoters
            .GroupBy(x => x.participant.Vote!)
            .OrderByDescending(g => g.Count())
            .ToList();

        var topGroup = groups[0];
        if (topGroup.Count() * 2 < numericVoters.Count) return null;

        var majorityNum = double.Parse(topGroup.Key.Replace("½", "0.5"));
        var outliers = numericVoters
            .Where(x => x.participant.Vote != topGroup.Key)
            .OrderByDescending(x => Math.Abs(x.val - majorityNum))
            .ToList();

        if (outliers.Count == 0) return null;
        var maxDist = Math.Abs(outliers[0].val - majorityNum);
        var farthest = outliers.Where(x => Math.Abs(x.val - majorityNum) == maxDist).ToList();
        return farthest.Count == 1 ? farthest[0].participant.ConnectionId : null;
    }

    private static object BuildRoomState(Room room, string requestingConnectionId)
    {
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
                confidence = room.VotesRevealed ? p.Confidence : null
            }),
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
            })
        };
    }

    private static object CalculateStats(Room room)
    {
        var numericVoters = room.Participants
            .Where(p => !p.IsObserver && p.Vote != null && double.TryParse(p.Vote!.Replace("½", "0.5"), out _))
            .Select(p => (participant: p, val: double.Parse(p.Vote!.Replace("½", "0.5"))))
            .ToList();

        if (numericVoters.Count == 0)
            return new { average = (double?)null, min = (double?)null, max = (double?)null, isConsensus = false,
                         majorityValue = (string?)null, outlierValue = (string?)null,
                         shameParticipantName = (string?)null, shameParticipantId = (string?)null };

        var numericValues = numericVoters.Select(x => x.val).ToList();
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
                var majorityNum = double.Parse(majorityValue.Replace("½", "0.5"));

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
