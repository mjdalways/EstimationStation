using Microsoft.AspNetCore.SignalR;
using EstimationStation.Models;
using EstimationStation.Services;

namespace EstimationStation.Hubs;

public class PokerHub : Hub
{
    private readonly RoomService _roomService;
    private readonly JiraService _jiraService;

    public PokerHub(RoomService roomService, JiraService jiraService)
    {
        _roomService = roomService;
        _jiraService = jiraService;
    }

    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveRoom();
        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string roomName, string userName, bool isObserver, string? pin = null)
    {
        var room = _roomService.GetOrCreateRoom(roomName);

        // PIN check — skip for the very first joiner (they set the PIN after joining)
        if (room.Participants.Count > 0 && room.Pin != null && room.Pin != pin)
        {
            await Clients.Caller.SendAsync("Error", "PIN_REQUIRED");
            return;
        }

        _roomService.MapConnection(Context.ConnectionId, roomName);

        var participant = new Participant
        {
            ConnectionId = Context.ConnectionId,
            Name = userName,
            IsObserver = isObserver
        };

        lock (room)
        {
            bool midVote = !room.VotesRevealed && room.Participants.Any(p => !p.IsObserver && p.Vote != null);
            participant.IsGhost = room.GhostModeEnabled && midVote;
            room.Participants.RemoveAll(p => p.ConnectionId == Context.ConnectionId);
            room.Participants.Add(participant);
            room.LastActivity = DateTime.UtcNow;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        _roomService.SaveRoom(room);

        // Send full state to the joining participant
        await Clients.Caller.SendAsync("RoomState", BuildRoomState(room));

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
    }

    public async Task LeaveRoom()
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

        string participantName = string.Empty;
        lock (room)
        {
            var participant = room.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (participant != null)
            {
                participantName = participant.Name;
                room.Participants.Remove(participant);
            }
        }

        _roomService.RemoveConnection(Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);

        if (!string.IsNullOrEmpty(participantName))
        {
            await Clients.Group(roomName).SendAsync("ParticipantLeft", Context.ConnectionId, participantName);
        }
    }

    public async Task UpdateName(string newName)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

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

        lock (room)
        {
            room.AutoReveal = enabled;
        }

        _roomService.SaveRoom(room);
        await Clients.Group(roomName).SendAsync("AutoRevealToggled", enabled);
    }

    public async Task SetEstimateSet(string setName, string? customValues)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;

        var room = _roomService.GetRoom(roomName);
        if (room == null) return;

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
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        await Clients.Group(roomName).SendAsync("ReceiveReaction", Context.ConnectionId, emoji);
    }

    public async Task TriggerCustomSound(string base64Data, string label)
    {
        var roomName = _roomService.GetRoomForConnection(Context.ConnectionId);
        if (roomName == null) return;
        if (string.IsNullOrEmpty(base64Data) || base64Data.Length > 700_000) return;

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

    private static object BuildRoomState(Room room)
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
            hasPin = room.Pin != null,
            currentStoryId = room.CurrentStoryId,
            estimateSet = room.EstimateSet,
            estimateValues,
            customEstimates = room.CustomEstimates,
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
