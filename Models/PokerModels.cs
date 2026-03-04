namespace EstimationStation.Models;

public class Room
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public List<Participant> Participants { get; set; } = new();
    public List<Story> Stories { get; set; } = new();
    public bool AutoReveal { get; set; } = false;
    public bool VotesRevealed { get; set; } = false;
    public string? CurrentStoryId { get; set; }
    public string EstimateSet { get; set; } = "fibonacci";
    public string? CustomEstimates { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastActivity { get; set; } = DateTime.UtcNow;
}

public class Participant
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Vote { get; set; }
    public bool IsObserver { get; set; } = false;
}

public class Story
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = string.Empty;
    public string? FinalEstimate { get; set; }
    public bool IsCompleted { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ChatMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ParticipantName { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class EstimateSetInfo
{
    public string Name { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string[] Values { get; set; } = Array.Empty<string>();
}

public class RoomViewModel
{
    public string RoomName { get; set; } = string.Empty;
    public string PlayerName { get; set; } = string.Empty;
}
