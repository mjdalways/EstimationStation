namespace EstimationStation.Services;

public class SpellingBeePuzzle
{
    // Uppercase letters, index 0 = center. Length is the room's configured letter count.
    public string Letters { get; set; } = string.Empty;
    public HashSet<string> ValidWords { get; set; } = new();
    public HashSet<string> Pangrams { get; set; } = new();
}

// Per-room Spelling Bee tunables, locked in by the first participant to configure the game for
// the day (see Room.SpellingBee* / PokerHub.GameConfigure). Defaults reproduce the original
// hardcoded 7-letter / 4-letter-minimum / +7-pangram-bonus puzzle exactly.
public class SpellingBeeOptions
{
    public const int MinLetterCount = 5;
    public const int MaxLetterCount = 9;
    public const int MinMinWordLength = 3;
    public const int MaxMinWordLength = 6;
    public const int MaxPangramBonus = 25;

    public int LetterCount { get; set; } = 7;
    public int MinWordLength { get; set; } = 4;
    public int PangramBonus { get; set; } = 7;

    public SpellingBeeOptions Normalized() => new()
    {
        LetterCount = Math.Clamp(LetterCount, MinLetterCount, MaxLetterCount),
        MinWordLength = Math.Clamp(MinWordLength, MinMinWordLength, MaxMinWordLength),
        PangramBonus = Math.Clamp(PangramBonus, 0, MaxPangramBonus),
    };
}

// Builds a daily Spelling Bee: picks a random word with exactly LetterCount distinct letters as
// the seed, makes one of its letters the center, then scans the full word list for every word
// (length >= MinWordLength) buildable from only those letters (repeats allowed) that contains
// the center letter. Retries with a different seed word if the resulting valid-word count is
// too small, mirroring CrosswordGenerator's retry-then-fallback shape - and if no attempt clears
// the bar (likely at 5 letters with a 6-letter minimum), returns the richest puzzle it saw
// rather than failing the room's day.
public class SpellingBeeGenerator
{
    private const int MinValidWords = 20;
    private const int MaxAttempts = 40;

    private readonly WordListService _words;

    public SpellingBeeGenerator(WordListService words)
    {
        _words = words;
    }

    public SpellingBeePuzzle Generate(int seed, SpellingBeeOptions? options = null)
    {
        var opts = (options ?? new SpellingBeeOptions()).Normalized();
        var rng = new Random(seed);
        var seedPool = SeedWordPool(opts.LetterCount);
        if (seedPool.Length == 0)
        {
            // No word anywhere in the list has exactly this many distinct letters - degenerate
            // case, but keep the room usable with a hand-picked fallback letter set.
            return BuildFromLetters("RTAENILS", opts);
        }

        SpellingBeePuzzle? best = null;
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var seedWord = seedPool[rng.Next(seedPool.Length)];
            var distinctLetters = seedWord.Distinct().ToArray();
            if (distinctLetters.Length != opts.LetterCount) continue;
            var center = distinctLetters[rng.Next(distinctLetters.Length)];
            var letters = new string(distinctLetters);
            var (valid, pangrams) = ComputeValidWords(letters, center, opts.MinWordLength);
            var puzzle = new SpellingBeePuzzle
            {
                Letters = center + string.Join("", distinctLetters.Where(l => l != center)),
                ValidWords = valid,
                Pangrams = pangrams,
            };
            if (valid.Count >= MinValidWords) return puzzle;
            if (best == null || valid.Count > best.ValidWords.Count) best = puzzle;
        }

        return best ?? BuildFromLetters(seedPool[0], opts);
    }

    private SpellingBeePuzzle BuildFromLetters(string wordOrLetters, SpellingBeeOptions opts)
    {
        var distinctLetters = wordOrLetters.Distinct().Take(opts.LetterCount).ToArray();
        var center = distinctLetters[0];
        var letters = new string(distinctLetters);
        var (valid, pangrams) = ComputeValidWords(letters, center, opts.MinWordLength);
        return new SpellingBeePuzzle
        {
            Letters = center + string.Join("", distinctLetters.Where(l => l != center)),
            ValidWords = valid,
            Pangrams = pangrams,
        };
    }

    // Seed candidates are words with exactly letterCount distinct letters. Scanning only the
    // few shortest lengths that can hold that many distinct letters keeps this cheap while
    // still yielding thousands of candidates at every supported letter count.
    private string[] SeedWordPool(int letterCount)
    {
        var pool = new List<string>();
        for (var len = letterCount; len <= letterCount + 3; len++)
        {
            if (!_words.AllWordsByLength.TryGetValue(len, out var words)) continue;
            pool.AddRange(words.Where(w => w.Distinct().Count() == letterCount));
            if (pool.Count > 0 && len > letterCount) break;
        }
        return pool.ToArray();
    }

    private (HashSet<string> valid, HashSet<string> pangrams) ComputeValidWords(string letters, char center, int minWordLength)
    {
        var letterSet = new HashSet<char>(letters);
        var valid = new HashSet<string>();
        var pangrams = new HashSet<string>();

        foreach (var kv in _words.AllWordsByLength)
        {
            if (kv.Key < minWordLength) continue;
            foreach (var w in kv.Value)
            {
                if (!w.Contains(center)) continue;
                if (!w.All(letterSet.Contains)) continue;
                valid.Add(w);
                if (letterSet.All(w.Contains)) pangrams.Add(w);
            }
        }
        return (valid, pangrams);
    }
}
