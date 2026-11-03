namespace EstimationStation.Models;

// ============================================================================
// Feature 11 — Ceremony Suite models
//
// Split into its own file rather than piled onto the end of PokerModels.cs purely for
// legibility: every type here belongs to one of the F11 patches (P1 session history,
// P4 retro, P5 standup, P6 Connections, P8 team pet) and they all hang off `Room`,
// which still lives in PokerModels.cs.
// ============================================================================

/// <summary>
/// F11/P1 — one completed reveal. Appended in PokerHub.RevealVotes under lock (room).
/// Re-votes on the same story append a NEW round with an incremented RoundNumber rather
/// than replacing the previous one, so "this one took three rounds" stays visible.
/// </summary>
public class SessionRound
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string? StoryId { get; set; }
    public string StoryTitle { get; set; } = string.Empty;
    public string? JiraKey { get; set; }
    public DateTime RevealedAtUtc { get; set; } = DateTime.UtcNow;
    // Participant Name -> the card they played. Name, not ConnectionId, so the record
    // survives reconnects and still means something a week later.
    public Dictionary<string, string> Votes { get; set; } = new();
    // Participant Name -> 1..5 confidence, where the room collected it.
    public Dictionary<string, int> Confidences { get; set; } = new();
    // Names whose vote came from a pre-cast proxy vote (F11/P3) rather than the live round.
    public List<string> ProxyVoters { get; set; } = new();
    public string? FinalEstimate { get; set; }
    public bool WasUnanimous { get; set; }
    // Seconds from the story becoming current (or the previous reveal of it) to this reveal.
    public int DiscussionSeconds { get; set; }
    // 1 for the first reveal of a story, 2 for the next, ...
    public int RoundNumber { get; set; } = 1;
}

// ---------------------------------------------------------------------------
// F11/P4 — Retro
// ---------------------------------------------------------------------------

public class RetroBoard
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = string.Empty;
    public string SprintName { get; set; } = string.Empty;
    public string SprintGoal { get; set; } = string.Empty;
    // JSON blob of the last successful Jira sprint fetch (R3), cached on the board so the
    // whole room sees the same sprint context without every client needing Jira credentials.
    // Never contains credentials — only issue keys/summaries/status/points.
    public string? SprintContextJson { get; set; }
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAtUtc { get; set; }
    // collect | reveal | group | vote | discuss | actions | closed
    public string Phase { get; set; } = "collect";
    // Immutable after creation (R8): people write under one assumption and must not be
    // exposed under another. AuthorName is still stored server-side (rate limiting, "delete
    // my own note") but is stripped from every payload, the UI and the export.
    public bool Anonymous { get; set; } = false;
    // Dot-vote budget per person.
    public int VotesPerPerson { get; set; } = 3;
    // Room-wide freeze for when a conversation needs to happen off the board (R8).
    public bool Paused { get; set; } = false;
    public List<RetroColumn> Columns { get; set; } = new();
    public List<RetroNote> Notes { get; set; } = new();
    public List<RetroAction> Actions { get; set; } = new();
    public List<RetroGroup> Groups { get; set; } = new();
    // Note/group ids the room has already worked through in the Discuss phase.
    public List<string> DiscussedNoteIds { get; set; } = new();
    public string? CurrentTopicId { get; set; }
    // R6: ids of actions pulled forward from the previous board, awaiting Done/Still open/Drop.
    public List<string> CarriedActionIds { get; set; } = new();
}

public class RetroColumn
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Emoji { get; set; } = string.Empty;
    public string Colour { get; set; } = "#6c757d";
    public int Order { get; set; }
}

public class RetroNote
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ColumnKey { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    // Kept server-side even on an anonymous board; stripped from every outbound payload.
    public string AuthorName { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? EditedAtUtc { get; set; }
    public string Colour { get; set; } = "#fff3cd";
    public string? GroupId { get; set; }
    // Free position within its column, as a 0..1 fraction of the column box, so a note lands
    // in the same relative spot on every screen size.
    public double X { get; set; }
    public double Y { get; set; }
    // Name -> dots spent on this note.
    public Dictionary<string, int> Votes { get; set; } = new();
    public List<string> LinkedIssueKeys { get; set; } = new();
    public List<string> LinkedRoundIds { get; set; } = new();
}

public class RetroGroup
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ColumnKey { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Colour { get; set; } = "#e9ecef";
    public List<string> NoteIds { get; set; } = new();
    // Groups are dot-votable in their own right, out of the same budget as notes.
    public Dictionary<string, int> Votes { get; set; } = new();
}

public class RetroAction
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Text { get; set; } = string.Empty;
    public string Owner { get; set; } = string.Empty;
    public DateTime? DueDateUtc { get; set; }
    // open | in-progress | done | dropped
    public string Status { get; set; } = "open";
    public List<string> SourceNoteIds { get; set; } = new();
    public string? JiraKey { get; set; }
    public string? JiraUrl { get; set; }
    public string CreatedInBoardId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    // R6: the action on the previous board this one continues. Walking the chain is how the
    // UI knows an action has survived three retros.
    public string? CarriedFromActionId { get; set; }
    // How many boards this action has been carried across (0 = raised here).
    public int CarryCount { get; set; } = 0;
}

// ---------------------------------------------------------------------------
// F11/P5 — Standup
// ---------------------------------------------------------------------------

public class StandupState
{
    public bool Active { get; set; }
    // Participant Names, in turn order.
    public List<string> Order { get; set; } = new();
    public int CurrentIndex { get; set; } = 0;
    public int SecondsPerPerson { get; set; } = 90;
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime TurnStartedAtUtc { get; set; } = DateTime.UtcNow;
    public List<string> Skipped { get; set; } = new();
    public List<string> Done { get; set; } = new();
    // Name -> the notes that person prepared beforehand. Kept outside Active so they survive
    // between standups and can be filled in before one starts.
    public Dictionary<string, StandupNote> Notes { get; set; } = new();
}

public class StandupNote
{
    public string Yesterday { get; set; } = string.Empty;
    public string Today { get; set; } = string.Empty;
    public string Blockers { get; set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

// ---------------------------------------------------------------------------
// F11/P6 — Connections
// ---------------------------------------------------------------------------

public class ConnectionsCategory
{
    public string Name { get; set; } = string.Empty;
    // 0 = easiest .. 3 = hardest, mirroring the familiar colour ladder.
    public int Difficulty { get; set; }
    public List<string> Words { get; set; } = new();
}

public class ConnectionsPlayerState
{
    // Category names solved, in the order they were solved.
    public List<string> SolvedCategories { get; set; } = new();
    public int Mistakes { get; set; } = 0;
    public bool Completed { get; set; } = false;
    public bool Failed { get; set; } = false;
    public int Seconds { get; set; } = 0;
    public DateTime? StartedAtUtc { get; set; }
}

// ---------------------------------------------------------------------------
// F11/P8 — Team pet
// ---------------------------------------------------------------------------

public class TeamPet
{
    public const int MaxLog = 60;

    public string Species { get; set; } = "blob";
    public string Name { get; set; } = string.Empty;
    public DateTime AdoptedAtUtc { get; set; } = DateTime.UtcNow;
    public int Xp { get; set; } = 0;
    // Derived on every state build from Log + open aged actions, never trusted as stored
    // truth, so it cannot drift out of sync between clients.
    public string Mood { get; set; } = "content";
    public DateTime? LastFedUtc { get; set; }
    public DateTime? LastMoodEvalUtc { get; set; }
    public List<string> Accessories { get; set; } = new();
    // Capped ring buffer so the pet can explain itself ("+15, retro actions all closed").
    public List<PetEvent> Log { get; set; } = new();
}

public class PetEvent
{
    public DateTime AtUtc { get; set; } = DateTime.UtcNow;
    public string Kind { get; set; } = string.Empty;
    public int Delta { get; set; }
    public string Note { get; set; } = string.Empty;
}
