using EstimationStation.Models;

namespace EstimationStation.Services;

/// <summary>
/// F11/P6 — Connections. Options record + Normalized(), following WordSearchGenerator /
/// SpellingBeeGenerator exactly, so the game inherits gameNeedsSetup / GameConfigure /
/// coop+competitive modes / the leaderboard from the Feature 10 framework for free.
/// </summary>
public class ConnectionsOptions
{
    public const int MinCategoryCount = 3;
    public const int MaxCategoryCount = 5;
    public const int MinWordsPerCategory = 3;
    public const int MaxWordsPerCategory = 5;
    public const int MinMistakesAllowed = 1;
    public const int MaxMistakesAllowed = 8;
    public const int MinDifficulty = 0;
    public const int MaxDifficulty = 2;

    public int CategoryCount { get; set; } = 4;
    public int WordsPerCategory { get; set; } = 4;
    public int MistakesAllowed { get; set; } = 4;
    /// <summary>0 = categories from distinct families, 1 = normal, 2 = deliberately overlapping.</summary>
    public int Difficulty { get; set; } = 1;

    public ConnectionsOptions Normalized() => new()
    {
        CategoryCount = Math.Clamp(CategoryCount, MinCategoryCount, MaxCategoryCount),
        WordsPerCategory = Math.Clamp(WordsPerCategory, MinWordsPerCategory, MaxWordsPerCategory),
        MistakesAllowed = Math.Clamp(MistakesAllowed, MinMistakesAllowed, MaxMistakesAllowed),
        Difficulty = Math.Clamp(Difficulty, MinDifficulty, MaxDifficulty)
    };
}

public class ConnectionsPuzzle
{
    /// <summary>The shuffled grid — CategoryCount * WordsPerCategory words. Safe to send.</summary>
    public List<string> Words { get; set; } = new();
    /// <summary>Server-only: the solution. Difficulty ascends 0..n-1 in list order.</summary>
    public List<ConnectionsCategory> Categories { get; set; } = new();
}

public class ConnectionsGenerator
{
    // A curated bank, in the same "no dictionary/API dependency" spirit as Data.AcrosticPuzzles
    // and Data.WordleWords. A generated Connections puzzle is not really possible from a plain
    // word list — the whole game is semantic — so the categories are hand-authored. Family is
    // what the difficulty knob works on: same-family categories share a surface reading and
    // make for deliberately confusable grids.
    private sealed record Category(string Family, string Name, string[] Words);

    private static readonly Category[] Bank =
    {
        // --- Software / this team's world -----------------------------------------
        new("agile",   "Scrum ceremonies",        new[]{"STANDUP","RETRO","PLANNING","REFINEMENT","REVIEW","DEMO"}),
        new("agile",   "Estimation scales",       new[]{"FIBONACCI","TSHIRT","LINEAR","POWERS","BUCKET","DOTS"}),
        new("agile",   "Kanban column names",     new[]{"BACKLOG","TODO","DOING","BLOCKED","REVIEW","DONE"}),
        new("agile",   "Sprint artefacts",        new[]{"BURNDOWN","VELOCITY","CHARTER","ROADMAP","EPIC","SPIKE"}),
        new("dev",     "Version control verbs",   new[]{"COMMIT","BRANCH","MERGE","REBASE","STASH","CHERRY"}),
        new("dev",     "HTTP verbs",              new[]{"GET","POST","PUT","PATCH","DELETE","HEAD"}),
        new("dev",     "Things that can leak",    new[]{"MEMORY","SECRET","PIPE","ROOF","FAUCET","NEWS"}),
        new("dev",     "Programming languages",   new[]{"RUST","GO","SWIFT","RUBY","BASIC","JULIA"}),
        new("dev",     "Kinds of test",           new[]{"UNIT","SMOKE","LOAD","REGRESSION","ACCEPTANCE","FUZZ"}),
        new("dev",     "Database words",          new[]{"INDEX","QUERY","SCHEMA","CURSOR","TRIGGER","VIEW"}),

        // --- Everyday semantics ----------------------------------------------------
        new("nature",  "Big cats",                new[]{"LION","TIGER","JAGUAR","LEOPARD","COUGAR","LYNX"}),
        new("nature",  "Trees",                   new[]{"OAK","MAPLE","BIRCH","CEDAR","ASH","WILLOW"}),
        new("nature",  "Weather",                 new[]{"HAIL","SLEET","FROST","THUNDER","BREEZE","DRIZZLE"}),
        new("nature",  "Big cats' habitats",      new[]{"SAVANNA","JUNGLE","TUNDRA","DESERT","MARSH","STEPPE"}),
        new("food",    "Citrus fruit",            new[]{"LEMON","LIME","ORANGE","CITRON","POMELO","YUZU"}),
        new("food",    "Pasta shapes",            new[]{"PENNE","FUSILLI","ORZO","RIGATONI","FARFALLE","SHELLS"}),
        new("food",    "Ways to cook an egg",     new[]{"POACH","SCRAMBLE","BOIL","FRY","CODDLE","BAKE"}),
        new("food",    "Hot drinks",              new[]{"COCOA","COFFEE","TEA","CIDER","BROTH","TODDY"}),
        new("colour",  "Shades of red",           new[]{"CRIMSON","SCARLET","RUBY","CHERRY","ROSE","CORAL"}),
        new("colour",  "Shades of blue",          new[]{"NAVY","AZURE","COBALT","TEAL","INDIGO","SLATE"}),

        // --- Wordplay-ish ----------------------------------------------------------
        new("play",    "___ board",               new[]{"KEY","SURF","CARD","DASH","SKATE","CHALK"}),
        new("play",    "___ break",               new[]{"COFFEE","DAY","JAIL","HEART","TIE","OUT"}),
        new("play",    "Fire ___",                new[]{"WORKS","FLY","PLACE","WALL","DRILL","ARM"}),
        new("play",    "Card games",              new[]{"BRIDGE","HEARTS","RUMMY","POKER","WHIST","SNAP"}),
        new("play",    "Board games",             new[]{"CHESS","RISK","CLUE","SORRY","GO","CHECKERS"}),
        new("play",    "Chess pieces",            new[]{"PAWN","ROOK","KNIGHT","BISHOP","QUEEN","KING"}),
        new("play",    "Things with keys",        new[]{"PIANO","MAP","LOCK","TYPIST","CIPHER","KEYBOARD"}),
        new("play",    "Poker hands",             new[]{"FLUSH","STRAIGHT","PAIR","HOUSE","TRIPS","HIGH"}),

        // --- Office / meeting ------------------------------------------------------
        new("office",  "Meeting killers",         new[]{"TANGENT","MUTE","LATENCY","ECHO","RAMBLE","OVERRUN"}),
        new("office",  "On a whiteboard",         new[]{"MARKER","ERASER","MAGNET","ARROW","BOX","SCRIBBLE"}),
        new("office",  "Desk objects",            new[]{"STAPLER","MUG","LAMP","MONITOR","PLANT","NOTEPAD"}),
        new("office",  "Calendar words",          new[]{"INVITE","DECLINE","RECUR","BUSY","SLOT","AGENDA"}),

        // --- Motion / measures -----------------------------------------------------
        new("motion",  "Ways to move slowly",     new[]{"AMBLE","TRUDGE","CRAWL","SHUFFLE","PLOD","MEANDER"}),
        new("motion",  "Ways to move fast",       new[]{"DART","SPRINT","BOLT","ZOOM","TEAR","HURTLE"}),
        new("measure", "Units of time",           new[]{"SECOND","MINUTE","HOUR","WEEK","MONTH","ERA"}),
        new("measure", "Units of length",         new[]{"INCH","FOOT","YARD","MILE","METRE","LEAGUE"}),
        new("measure", "Things measured in points", new[]{"STORY","FONT","SCORE","WINE","RUGBY","COMPASS"}),

        // --- Music / sound ---------------------------------------------------------
        new("music",   "String instruments",      new[]{"VIOLIN","CELLO","HARP","BANJO","SITAR","LUTE"}),
        new("music",   "Musical dynamics",        new[]{"FORTE","PIANO","CRESCENDO","LEGATO","STACCATO","TEMPO"}),
        new("music",   "Loud noises",             new[]{"CLANG","BOOM","CRASH","BANG","ROAR","SLAM"}),

        // --- Body / idiom ----------------------------------------------------------
        new("body",    "Parts of a shoe",         new[]{"SOLE","TONGUE","HEEL","LACE","TOE","EYELET"}),
        new("body",    "Parts of a river",        new[]{"MOUTH","BED","BANK","DELTA","BEND","SOURCE"}),
        new("body",    "Parts of a book",         new[]{"SPINE","LEAF","JACKET","INDEX","CHAPTER","MARGIN"}),
        new("body",    "Parts of a chair",        new[]{"ARM","BACK","LEG","SEAT","CASTER","RAIL"}),
    };

    /// <summary>
    /// Deterministic for a given seed, exactly like every other generator here, so the
    /// room's daily puzzle survives a process restart.
    /// </summary>
    public ConnectionsPuzzle Generate(int seed, ConnectionsOptions? options = null)
    {
        var opt = (options ?? new ConnectionsOptions()).Normalized();
        var rng = new Random(seed);

        var picked = PickCategories(rng, opt);

        // A word may appear only once in the grid, and a category is only usable if it still
        // has enough distinct words after earlier picks claimed some of them. PickCategories
        // guarantees that, so this is a straight take.
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<ConnectionsCategory>();
        for (var i = 0; i < picked.Count; i++)
        {
            var words = Shuffle(rng, picked[i].Words.Where(w => !used.Contains(w)).ToList())
                .Take(opt.WordsPerCategory).ToList();
            foreach (var w in words) used.Add(w);
            result.Add(new ConnectionsCategory
            {
                Name = picked[i].Name,
                Difficulty = i,          // list order IS the difficulty ladder
                Words = words
            });
        }

        var grid = Shuffle(rng, result.SelectMany(c => c.Words).ToList());
        return new ConnectionsPuzzle { Words = grid, Categories = result };
    }

    // Difficulty 0 wants categories that could not be confused with each other; difficulty 2
    // wants the opposite. "Family" is the lever: same-family categories read alike ("Big cats"
    // next to "Big cats' habitats"), so hard grids prefer them and easy grids forbid them.
    private static List<Category> PickCategories(Random rng, ConnectionsOptions opt)
    {
        var pool = Shuffle(rng, Bank.ToList());
        var chosen = new List<Category>();
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        bool Fits(Category c)
        {
            if (c.Words.Count(w => !used.Contains(w)) < opt.WordsPerCategory) return false;
            if (opt.Difficulty == 0 && chosen.Any(x => x.Family == c.Family)) return false;
            return true;
        }

        // Hard mode seeds the board with a family that has enough members to fill it, then
        // takes as many of that family as it can before topping up from elsewhere.
        if (opt.Difficulty == 2)
        {
            var family = pool.GroupBy(c => c.Family)
                             .Where(g => g.Count() >= Math.Min(opt.CategoryCount, 3))
                             .OrderBy(_ => rng.Next())
                             .FirstOrDefault();
            if (family != null)
            {
                foreach (var c in family)
                {
                    if (chosen.Count >= opt.CategoryCount) break;
                    if (!Fits(c)) continue;
                    chosen.Add(c);
                    foreach (var w in c.Words) used.Add(w);
                }
            }
        }

        foreach (var c in pool)
        {
            if (chosen.Count >= opt.CategoryCount) break;
            if (chosen.Contains(c) || !Fits(c)) continue;
            chosen.Add(c);
            foreach (var w in c.Words) used.Add(w);
        }

        // Last resort (a very small bank plus an aggressive difficulty filter): relax the
        // family rule rather than hand back a short grid.
        if (chosen.Count < opt.CategoryCount)
        {
            foreach (var c in pool)
            {
                if (chosen.Count >= opt.CategoryCount) break;
                if (chosen.Contains(c)) continue;
                if (c.Words.Count(w => !used.Contains(w)) < opt.WordsPerCategory) continue;
                chosen.Add(c);
                foreach (var w in c.Words) used.Add(w);
            }
        }

        return chosen;
    }

    private static List<T> Shuffle<T>(Random rng, List<T> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
        return list;
    }
}
