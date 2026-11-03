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
    // Wordle: shared per-room daily puzzle. "yyyy-MM-dd" (UTC) that drives the daily reset.
    // Also doubles as the "today's game is configured" flag: null, or a stale (non-today)
    // date, means no one has set up today's game yet (see WordleConfigure in PokerHub.cs).
    public string? WordlePuzzleId { get; set; }
    // Wordle: today's answer, uppercase. Server-only — never sent to clients as-is.
    public string? WordleWord { get; set; }
    // Wordle: per-day setup, locked in by whoever configures the game first that day (see
    // WordleConfigure). "Fixed" = every guess/answer is exactly WordleLength letters.
    // "UpTo" = the daily answer's length is randomly chosen from 5..WordleLength each day
    // (so UpTo(5) is identical to Fixed(5) — 5 is always the floor). Same values apply to
    // everyone in the room for the day; the next UTC day resets and lets the next first
    // opener choose again.
    public string WordleLengthMode { get; set; } = "Fixed";
    public int WordleLength { get; set; } = 5;
    public int WordleMaxGuesses { get; set; } = 6;
    // Wordle: per-player progress, keyed by participant Name (not ConnectionId — every
    // reconnect gets a brand-new ConnectionId, and by the time a rejoin could re-key a
    // per-connection dictionary the old connection has usually already disconnected and
    // been cleaned up, same as ChairClaims). Name is already this app's de facto stable
    // per-room identity (see the stale-session reconciliation in JoinRoom).
    public Dictionary<string, WordlePlayerState> WordleStates { get; set; } = new();
    // Crossword: shared per-room daily puzzle (like Wordle). "yyyy-MM-dd" (UTC) drives the daily
    // reset. A stale (non-today) id is the "nobody has set up today's game yet" signal that
    // BuildRoomState reports as crosswordNeedsSetup — see GameConfigure in PokerHub.cs.
    public string? CrosswordPuzzleId { get; set; }
    // Crossword: grid dimension, locked in for the day by whoever configures the game first
    // (GameConfigure). 5 is the original hardcoded size. See CrosswordGenerator.MinSize/MaxSize.
    public int CrosswordSize { get; set; } = 5;
    // Crossword: today's generated puzzle solution + clues (server-only; never sent to
    // clients as-is — see Services/CrosswordGenerator.cs). Persisted the same way
    // WordleWord is: the whole Room round-trips through FileRoomRepository as plain JSON,
    // so "spoiler-safe" here means "never sent over the wire," not "never on disk."
    public string[]? CrosswordRows { get; set; }
    public string[]? CrosswordAcrossClues { get; set; }
    public string[]? CrosswordDownClues { get; set; }
    // Crossword: shared collaborative fill state, keyed "row,col" -> single uppercase letter.
    // Anyone in the room can fill any cell; broadcast live like WhiteboardStrokes. Never cleared
    // except on a new puzzle (daily rollover or host reshuffle).
    public Dictionary<string, string> CrosswordCells { get; set; } = new();
    // Crossword: cell key -> filler's participant Name, alongside CrosswordCells. Leaderboard
    // standings are derived from this (count of currently-correct cells per name), not stored separately.
    public Dictionary<string, string> CrosswordCellFiller { get; set; } = new();
    // "coop" (shared grid, no leaderboard) or "competitive" (private per-player grid, timed
    // race, feeds the leaderboard). See HangmanMode.
    public string CrosswordMode { get; set; } = "coop";
    // Competitive mode only: each player's own private cell fills on the same day's grid,
    // keyed by participant Name like WordleStates.
    public Dictionary<string, GridFillPlayerState> CrosswordCompetitiveStates { get; set; } = new();

    // Hangman: shared per-room daily puzzle (like Wordle/Crossword). "yyyy-MM-dd" (UTC).
    public string? HangmanPuzzleId { get; set; }
    // "coop" (shared word, whole room guesses together, no leaderboard) or "competitive"
    // (private race against the same word, timed, feeds the leaderboard). Host-chosen at
    // puzzle (re)generation; carried forward on day-rollover regeneration until changed.
    public string HangmanMode { get; set; } = "coop";
    // Hangman: today's answer, uppercase. Server-only — never sent to clients as-is.
    public string? HangmanWord { get; set; }
    // Hangman: optional NGSL definition of the word, shown as a clue. May be null if the
    // picked word has no WordListService.Definitions entry.
    public string? HangmanClue { get; set; }
    public HashSet<string> HangmanGuessedLetters { get; set; } = new();
    public int HangmanWrongCount { get; set; } = 0;
    // Hangman per-day tunables, locked in by whoever configures the game first (GameConfigure).
    // The defaults (6 wrong guesses, a 5-10 letter word, clue shown) are the original hardcoded
    // behaviour. HangmanShowClue false withholds the NGSL definition for a harder game.
    public int HangmanMaxWrong { get; set; } = 6;
    public int HangmanMinLength { get; set; } = 5;
    public int HangmanMaxLength { get; set; } = 10;
    public bool HangmanShowClue { get; set; } = true;
    // Letter -> first guesser's participant Name, for social credit / leaderboard standings.
    public Dictionary<string, string> HangmanGuessedBy { get; set; } = new();
    // Competitive mode only: each player's own private guessed-letters progress against the
    // same day's word, keyed by participant Name like WordleStates.
    public Dictionary<string, HangmanPlayerState> HangmanCompetitiveStates { get; set; } = new();

    // Word Search: shared per-room daily puzzle.
    public string? WordSearchPuzzleId { get; set; }
    // Word Search per-day tunables, locked in by whoever configures the game first
    // (GameConfigure). The defaults are the original hardcoded 12x12 / 14-word / 4-8-letter /
    // all-8-directions puzzle. See Services/WordSearchGenerator.cs WordSearchOptions.
    public int WordSearchSize { get; set; } = 12;
    public int WordSearchWordCount { get; set; } = 14;
    public int WordSearchMinLength { get; set; } = 4;
    public int WordSearchMaxLength { get; set; } = 8;
    public bool WordSearchAllowDiagonal { get; set; } = true;
    public bool WordSearchAllowReverse { get; set; } = true;
    // Grid rows, one string per row of uppercase letters — safe to send as-is.
    public string[] WordSearchGridRows { get; set; } = Array.Empty<string>();
    public string[] WordSearchWords { get; set; } = Array.Empty<string>();
    // Word -> [startRow,startCol,endRow,endCol]. Server-only — reveals every answer's location.
    public Dictionary<string, int[]> WordSearchSolutions { get; set; } = new();
    public Dictionary<string, WordSearchFoundEntry> WordSearchFound { get; set; } = new();
    // "coop" (shared grid, no leaderboard) or "competitive" (private per-player found-word
    // list on the same grid, timed race, feeds the leaderboard). See HangmanMode.
    public string WordSearchMode { get; set; } = "coop";
    // Competitive mode only: each player's own private found-word list on the same day's
    // grid, keyed by participant Name like WordleStates.
    public Dictionary<string, WordSearchPlayerState> WordSearchCompetitiveStates { get; set; } = new();

    // Spelling Bee: shared per-room daily puzzle.
    public string? SpellingBeePuzzleId { get; set; }
    // Spelling Bee per-day tunables, locked in by whoever configures the game first
    // (GameConfigure). The defaults are the original hardcoded 7 letters / 4-letter minimum /
    // +7 pangram bonus. See Services/SpellingBeeGenerator.cs SpellingBeeOptions.
    public int SpellingBeeLetterCount { get; set; } = 7;
    public int SpellingBeeMinWordLength { get; set; } = 4;
    public int SpellingBeePangramBonus { get; set; } = 7;
    // Uppercase letters, index 0 = center, SpellingBeeLetterCount long. Safe to send.
    public string SpellingBeeLetters { get; set; } = string.Empty;
    // Server-only — the full valid-word / pangram sets for today, never sent as-is.
    public HashSet<string> SpellingBeeValidWords { get; set; } = new();
    public HashSet<string> SpellingBeePangrams { get; set; } = new();
    // Keyed by participant Name, like WordleStates — each player's found words stay private.
    public Dictionary<string, SpellingBeePlayerState> SpellingBeeStates { get; set; } = new();
    // "competitive" (private found-word lists + score, feeds the leaderboard) or "coop"
    // (one shared found-word list for the whole room, no leaderboard). See HangmanMode.
    public string SpellingBeeMode { get; set; } = "competitive";
    // Coop mode only: one shared found-word list + total score for the whole room.
    public List<string> SpellingBeeSharedFound { get; set; } = new();
    public int SpellingBeeSharedScore { get; set; } = 0;

    // Jumble: shared per-room daily puzzle.
    public string? JumblePuzzleId { get; set; }
    // Jumble per-day tunables, locked in by whoever configures the game first (GameConfigure).
    // The defaults are the original hardcoded 4 words / 4-6 letters each. JumbleWordCount is
    // also the final answer's length. See Services/JumbleGenerator.cs JumbleOptions.
    public int JumbleWordCount { get; set; } = 4;
    public int JumbleMinLength { get; set; } = 4;
    public int JumbleMaxLength { get; set; } = 6;
    public string[] JumbleScrambled { get; set; } = Array.Empty<string>();
    // Server-only unscrambled answers for the small words.
    public string[] JumbleWords { get; set; } = Array.Empty<string>();
    public int[] JumbleMarkedIndex { get; set; } = Array.Empty<int>();
    // Server-only — the final answer built from the marked letters, JumbleWordCount long.
    public string? JumbleFinalAnswer { get; set; }
    public Dictionary<string, JumblePlayerState> JumbleStates { get; set; } = new();
    // "competitive" (private per-player race, feeds the leaderboard) or "coop" (one shared
    // room-wide attempt, no leaderboard). See HangmanMode.
    public string JumbleMode { get; set; } = "competitive";
    // Coop mode only: one shared attempt for the whole room, mirrors JumblePlayerState.
    public JumblePlayerState? JumbleSharedState { get; set; }

    // Acrostic: shared per-room daily puzzle, picked from the hand-authored Data.AcrosticPuzzles
    // bank by day-seed (same PickWordleWord-style selection, not generated).
    public string? AcrosticPuzzleId { get; set; }
    // Which Data.AcrosticPuzzles.Puzzles entry is active today. Server-only until solved — the
    // quote/author/clue text is derived from it server-side for the client payload instead.
    public int AcrosticIndex { get; set; } = -1;
    // Acrostic per-day tunable, locked in by whoever configures the game first (GameConfigure).
    // The bank is hand-authored so there is nothing to generate — the one meaningful knob is
    // how long a quote to draw from it. 0 means "any length", the original behaviour.
    public int AcrosticMaxQuoteLength { get; set; } = 0;
    // Shared collaborative fill state, keyed by flat quote position -> single uppercase letter.
    // Same model as CrosswordCells.
    public Dictionary<string, string> AcrosticCells { get; set; } = new();
    public Dictionary<string, string> AcrosticCellFiller { get; set; } = new();
    // "coop" (shared grid, no leaderboard) or "competitive" (private per-player grid, timed
    // race, feeds the leaderboard). See HangmanMode.
    public string AcrosticMode { get; set; } = "coop";
    // Competitive mode only: each player's own private cell fills on the same day's quote,
    // keyed by participant Name like WordleStates.
    public Dictionary<string, GridFillPlayerState> AcrosticCompetitiveStates { get; set; } = new();

    // Leaderboard: single append/upsert-only log across all games. See
    // Hubs/PokerHub.cs UpsertDailyStandings/GetLeaderboard.
    public List<LeaderboardResultEntry> LeaderboardLog { get; set; } = new();

    // ========================================================================
    // Feature 11 — Ceremony Suite. Types live in Models/Feature11Models.cs.
    // ========================================================================

    // F11/P1: the durable record of every reveal this room has done. Previously this lived
    // only in the browser tab that watched the reveal happen (room.js roomState.history), so
    // a refresh or a late join lost it — which quietly made awards.js and analytics.js
    // invisible for most of the room. Appended in PokerHub.RevealVotes, trimmed oldest-first
    // at MaxSessionRounds because Room round-trips through FileRoomRepository as plain JSON
    // and this is the first genuinely unbounded per-round list.
    public const int MaxSessionRounds = 500;
    public List<SessionRound> SessionRounds { get; set; } = new();
    // When the current round started (story became current, or the last reveal was reset).
    // The only new field the plan did not name — SessionRound.DiscussionSeconds needs a
    // server-side clock, and the client's own timer is per-tab and dies on refresh.
    public DateTime RoundStartedAtUtc { get; set; } = DateTime.UtcNow;

    // F11/P2: up to MaxReferenceStories already-estimated stories pinned as calibration
    // anchors beside the deck ("this is what a 3 looks like here"). Story ids only — the
    // value comes off Story.FinalEstimate, so nothing has to be kept in sync.
    public const int MaxReferenceStories = 5;
    public List<string> ReferenceStoryIds { get; set; } = new();

    // F11/P3: votes left in advance by someone who cannot attend. storyId -> name -> vote.
    // Keyed by participant Name because Name (not ConnectionId) is this app's stable
    // per-room identity — see the WordleStates comment above.
    public Dictionary<string, Dictionary<string, string>> ProxyVotes { get; set; } = new();
    // Whether proxy votes count toward the auto-reveal quorum. Host opt-in, off by default
    // so a stale pre-vote can never reveal a round on its own.
    public bool CountProxyVotes { get; set; } = false;

    // F11/P4: retro boards, newest first. Deliberately NOT built on WhiteboardStrokes —
    // that list is append-only, and retro notes need to move, be edited, grouped, voted on
    // and hidden until reveal.
    public const int MaxRetroBoards = 40;
    public List<RetroBoard> RetroBoards { get; set; } = new();
    public string? ActiveRetroBoardId { get; set; }

    // F11/P5: round-robin standup walk. Non-null once a standup has ever been prepared in
    // this room; Standup.Active says whether one is running right now.
    public StandupState? Standup { get; set; }

    // F11/P6 — Connections: shared per-room daily puzzle, same first-to-arrive setup
    // mechanic as every other game (see GameConfigure).
    public string? ConnectionsPuzzleId { get; set; }
    public int ConnectionsMistakesAllowed { get; set; } = 4;
    public int ConnectionsCategoryCount { get; set; } = 4;
    public int ConnectionsWordsPerCategory { get; set; } = 4;
    // 0 = clearly distinct categories, 1 = normal, 2 = deliberately overlapping decoys.
    public int ConnectionsDifficulty { get; set; } = 1;
    // The shuffled grid, safe to send to clients.
    public List<string> ConnectionsWords { get; set; } = new();
    // Server-only — which words belong to which category, and the category names.
    public List<ConnectionsCategory> ConnectionsCategories { get; set; } = new();
    // Keyed by participant Name, like WordleStates.
    public Dictionary<string, ConnectionsPlayerState> ConnectionsStates { get; set; } = new();
    // "coop" (one shared grid for the whole room, no leaderboard — the good one here) or
    // "competitive" (private per-player grid, feeds the leaderboard). See HangmanMode.
    public string ConnectionsMode { get; set; } = "coop";
    public ConnectionsPlayerState? ConnectionsSharedState { get; set; }

    // F11/P7: pre-reveal wagers on what the final estimate will be. storyId -> name -> value.
    public Dictionary<string, Dictionary<string, string>> Predictions { get; set; } = new();
    // storyId -> the value the round actually landed on, so who-called-it-right survives a
    // story being re-opened and re-estimated.
    public Dictionary<string, string> PredictionOutcomes { get; set; } = new();
    // date (yyyy-MM-dd) -> name -> correct calls that day. Not in the plan, but needed:
    // UpsertDailyStandings can only express an *ordering*, and predictions accrue over a
    // whole session, so the running tally has to live somewhere the ranking can be rebuilt
    // from. Trimmed to the same 400-day window as LeaderboardLog.
    public Dictionary<string, Dictionary<string, int>> PredictionScores { get; set; } = new();

    // F11/P8: the team pet. One per room, rendered page-wide by wwwroot/js/pet.js.
    public TeamPet? Pet { get; set; }
    // Room-wide off switch for teams who find it insufferable. (There is also a per-viewer
    // localStorage hide, for the one person who does.)
    public bool PetEnabled { get; set; } = true;
}

public class WordSearchFoundEntry
{
    public string FoundBy { get; set; } = string.Empty;
    // [startRow, startCol, endRow, endCol]
    public int[] Coords { get; set; } = Array.Empty<int>();
}

public class SpellingBeePlayerState
{
    public List<string> FoundWords { get; set; } = new();
    public int Score { get; set; } = 0;
}

public class JumblePlayerState
{
    // Sized to the room's configured JumbleWordCount rather than a fixed 4. Rooms persisted
    // before the setting existed round-trip with 4-element arrays, so EnsureSize grows (or
    // shrinks) them to match the current puzzle before any indexing.
    public bool[] WordsSolved { get; set; } = new bool[4];
    // The player's own solved word text, index-aligned with WordsSolved — needed so a
    // reconnect/reload can re-show already-solved tiles + their marked letter instead of
    // losing that progress (JumbleGuessWord blocks re-guessing a solved slot).
    public string?[] SolvedWords { get; set; } = new string?[4];

    public void EnsureSize(int count)
    {
        if (WordsSolved.Length != count)
        {
            var solved = WordsSolved;
            Array.Resize(ref solved, count);
            WordsSolved = solved;
        }
        if (SolvedWords.Length != count)
        {
            var words = SolvedWords;
            Array.Resize(ref words, count);
            SolvedWords = words;
        }
    }
    public bool FinalSolved { get; set; } = false;
    public int Attempts { get; set; } = 0;
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

// Leaderboard: one append/upsert-only entry per (Game, Date, Name). Points come from
// placement (3/2/1/0.5), never from raw score/time — see UpsertDailyStandings.
public class LeaderboardResultEntry
{
    public string Game { get; set; } = string.Empty;
    // "yyyy-MM-dd" (UTC)
    public string Date { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public double Points { get; set; } = 0;
}

public class WordlePlayerState
{
    public List<string> Guesses { get; set; } = new();
    public bool Solved { get; set; } = false;
    public bool Failed { get; set; } = false;
    public DateTime? FinishedAt { get; set; }
}

// Competitive Hangman: one player's own private guessing progress against the shared day's word.
public class HangmanPlayerState
{
    public HashSet<string> GuessedLetters { get; set; } = new();
    public int WrongCount { get; set; } = 0;
    public bool Solved { get; set; } = false;
    public bool Failed { get; set; } = false;
    public DateTime? FinishedAt { get; set; }
}

// Competitive Word Search: one player's own private found-word list on the shared day's grid.
public class WordSearchPlayerState
{
    public List<string> Found { get; set; } = new();
    public DateTime? FinishedAt { get; set; }
}

// Competitive Crossword/Acrostic: one player's own private cell fills on the shared day's grid.
public class GridFillPlayerState
{
    public Dictionary<string, string> Cells { get; set; } = new();
    public bool Solved { get; set; } = false;
    public DateTime? FinishedAt { get; set; }
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
