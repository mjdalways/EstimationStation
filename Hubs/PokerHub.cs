using Microsoft.AspNetCore.SignalR;
using EstimationStation.Models;
using EstimationStation.Services;

namespace EstimationStation.Hubs;

public class PokerHub : Hub
{
    private readonly RoomService _roomService;

    public PokerHub(RoomService roomService)
    {
        _roomService = roomService;
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

    public async Task JoinRoom(string roomName, string userName, bool isObserver)
    {
        var room = _roomService.GetOrCreateRoom(roomName);
        _roomService.MapConnection(Context.ConnectionId, roomName);

        var participant = new Participant
        {
            ConnectionId = Context.ConnectionId,
            Name = userName,
            IsObserver = isObserver
        };

        lock (room)
        {
            room.Participants.RemoveAll(p => p.ConnectionId == Context.ConnectionId);
            room.Participants.Add(participant);
            room.LastActivity = DateTime.UtcNow;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);

        // Send full state to the joining participant
        await Clients.Caller.SendAsync("RoomState", BuildRoomState(room));

        // Notify others
        await Clients.OthersInGroup(roomName).SendAsync("ParticipantJoined", new
        {
            connectionId = participant.ConnectionId,
            name = participant.Name,
            isObserver = participant.IsObserver,
            hasVoted = participant.Vote != null
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
            if (participant == null || participant.IsObserver) return;
            participant.Vote = vote;

            if (room.AutoReveal && !room.VotesRevealed && vote != null)
            {
                var voters = room.Participants.Where(p => !p.IsObserver).ToList();
                shouldAutoReveal = voters.Count > 0 && voters.All(p => p.Vote != null);
            }
        }

        // Broadcast whether this participant now has a vote (false when they unselected)
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
        }

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
                p.Vote = null;
            room.VotesRevealed = false;
        }

        await Clients.Group(roomName).SendAsync("VotesReset");
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

        await Clients.Group(roomName).SendAsync("StoryUpdated", storyId, title);
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

        await Clients.Group(roomName).SendAsync("StoryCompleted", storyId, estimate);
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
            currentStoryId = room.CurrentStoryId,
            estimateSet = room.EstimateSet,
            estimateValues,
            customEstimates = room.CustomEstimates,
            participants = room.Participants.Select(p => new
            {
                connectionId = p.ConnectionId,
                name = p.Name,
                isObserver = p.IsObserver,
                hasVoted = p.Vote != null,
                vote = room.VotesRevealed ? p.Vote : null
            }),
            stories = room.Stories.Select(s => new
            {
                id = s.Id,
                title = s.Title,
                isCompleted = s.IsCompleted,
                finalEstimate = s.FinalEstimate,
                createdAt = s.CreatedAt
            })
        };
    }

    private static object CalculateStats(Room room)
    {
        var numericVotes = room.Participants
            .Where(p => !p.IsObserver && p.Vote != null)
            .Select(p => p.Vote!)
            .Where(v => double.TryParse(v.Replace("½", "0.5"), out _))
            .Select(v => double.Parse(v.Replace("½", "0.5")))
            .ToList();

        if (numericVotes.Count == 0)
        {
            return new { average = (double?)null, min = (double?)null, max = (double?)null, isConsensus = false };
        }

        var avg = numericVotes.Average();
        var min = numericVotes.Min();
        var max = numericVotes.Max();
        var isConsensus = numericVotes.Distinct().Count() == 1;

        return new { average = Math.Round(avg, 1), min, max, isConsensus };
    }
}
