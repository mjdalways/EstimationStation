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
    // Room Scene: authoritative chair claims (chair index -> claim). Drives 2D/3D seating
    // so every participant sees the same person in the same seat, with race-safe claiming.
    public Dictionary<int, ChairClaim> ChairClaims { get; set; } = new();
    // Room Scene: shared furniture layout (JSON array of {id,type,x,z}). Whole-layout sync —
    // any add/move/remove/reset replaces this and is broadcast so everyone sees the same room.
    public string? RoomLayoutJson { get; set; }
    // AQ5: collaborative whiteboard — each entry is one JSON stroke {color,width,erase,pts:[...]}.
    // Appended as a delta and broadcast; late joiners replay the whole list.
    public List<string> WhiteboardStrokes { get; set; } = new();
    // AP1: room identity icon — either an emoji glyph or a data: URL image. Shown in the
    // navbar + browser tab. Host-set, broadcast to everyone.
    public string? RoomIcon { get; set; }
    // Room Scene: per-chair position overrides (JSON map idx -> {x,z}) when chairs are
    // dragged off their default ring. Whole-map sync, like the furniture layout.
    public string? ChairPositionsJson { get; set; }
    // Room Scene: décor position overrides (JSON map key -> {x,z[,rot]}) for the props
    // (confetti/jukebox), whiteboard, and project screen when dragged from their default
    // spots. Whole-map sync, like ChairPositionsJson.
    public string? DecorPositionsJson { get; set; }
    // Room Scene: shared visual config (chair count, table shape, window view, etc.) as a
    // JSON object. Server-merged from BroadcastSceneConfig patches so late joiners get the
    // current state without relying on the host being online.
    public string? SceneConfigJson { get; set; }
    // One-shot host onboarding: true once the first joiner has been sent the "you're the
    // host — choose a settings lock" prompt, so it never re-appears on later host logins.
    public bool SetupPromptShown { get; set; } = false;
}

public class ChairClaim
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
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
    // Spatial presence (Kumospace-style free roam). Transient live pose in the 3D room.
    public double? PosX { get; set; }
    public double? PosZ { get; set; }
    public double? Yaw { get; set; }
    public string? Pose { get; set; }   // null = seated/standing by claim; "walk" | "idle" = roaming
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
