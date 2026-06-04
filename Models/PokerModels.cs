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
    public Dictionary<string, string> Vibes { get; set; } = new();
    public bool GhostModeEnabled { get; set; } = false;
    public string? ShameParticipantId { get; set; }
    public string? Pin { get; set; }
    public bool RevealMajorityFirst { get; set; } = true;
    // AD1 — Host tracking
    public string? HostConnectionId { get; set; }
    // AD2 — Settings lock: none | ask | hostonly | hidden
    public string SettingsLockMode { get; set; } = "none";
    // Host-configurable seconds an "are you there?" leave prompt waits before auto-removal (30..300)
    public int LeaveRequestTimeoutSeconds { get; set; } = 60;
}

public class Participant
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Vote { get; set; }
    public bool IsObserver { get; set; } = false;
    public bool IsGhost { get; set; } = false;
    public bool CounterUsed { get; set; } = false;
    public string? AvatarData { get; set; }
    public int? Confidence { get; set; }
    // Last time this participant interacted; drives the 2-hour idle removal sweep.
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
}

public class Story
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = string.Empty;
    public string? FinalEstimate { get; set; }
    public bool IsCompleted { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? JiraKey { get; set; }
    public string? JiraUrl { get; set; }
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public string? IssueType { get; set; }
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
