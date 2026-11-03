using EstimationStation.Data;

namespace EstimationStation.Services;

// Loads the two shipped word-list data files (Data/wordlists/) once at startup into memory:
//   words.txt — Re-Enable (github.com/JakesMD/Re-Enable), ~172k words, MIT licensed, already
//                filtered for profanity/proper-nouns/abbreviations/obscure-archaic terms.
//                Used ONLY for guess-legality checks (any length, 2-28 letters).
//   ngsl.tsv   — New General Service List, ~2.8k words with real plain-English definitions.
//                Used for curated "common word" answer pools and (via Definitions) genuine
//                non-spoiler crossword clue text.
// Small enough (~2-3MB of short strings) to comfortably hold in RAM — no SQLite, no
// per-request file I/O. Registered as a singleton and built once in Program.cs.
public class WordListService
{
    private const int MinWordleLength = 5;
    private const int MinCommonWordsForLength = 50;

    // Guess-legality dictionary (Re-Enable), keyed by word length.
    public IReadOnlyDictionary<int, HashSet<string>> ValidByLength { get; }
    // Same data as ValidByLength but as arrays, for candidate iteration (crossword fallback fill).
    public IReadOnlyDictionary<int, string[]> AllWordsByLength { get; }
    // NGSL words that have a definition, keyed by length — the crossword generator's primary
    // fill pool (a definition doubles as a real clue).
    public IReadOnlyDictionary<int, string[]> DefinedByLength { get; }
    // Wordle's "common answer" pool by length. Length 5 is the existing hand-curated
    // WordleWords.Answers (higher quality bar than raw NGSL); every other length falls back
    // to the NGSL words of that length.
    public IReadOnlyDictionary<int, string[]> CommonByLength { get; }
    public IReadOnlyDictionary<string, string> Definitions { get; }
    // Wordle lengths allowed for a room to choose, computed dynamically: 5 upward, for as
    // long as the common-word pool at that length has at least MinCommonWordsForLength words.
    public int[] AllowedWordleLengths { get; }

    public WordListService(IWebHostEnvironment env)
    {
        var dir = Path.Combine(env.ContentRootPath, "Data", "wordlists");

        var validByLength = new Dictionary<int, HashSet<string>>();
        var wordsPath = Path.Combine(dir, "words.txt");
        if (File.Exists(wordsPath))
        {
            foreach (var line in File.ReadLines(wordsPath))
            {
                var w = line.Trim().ToUpperInvariant();
                if (w.Length < 2 || !w.All(char.IsLetter)) continue;
                if (!validByLength.TryGetValue(w.Length, out var set))
                    validByLength[w.Length] = set = new HashSet<string>();
                set.Add(w);
            }
        }
        ValidByLength = validByLength;
        AllWordsByLength = validByLength.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray());

        var definitions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var definedByLengthBuild = new Dictionary<int, List<string>>();
        var ngslPath = Path.Combine(dir, "ngsl.tsv");
        if (File.Exists(ngslPath))
        {
            foreach (var line in File.ReadLines(ngslPath).Skip(1))
            {
                var parts = line.Split('\t', 2);
                if (parts.Length == 0) continue;
                var word = parts[0].Trim();
                if (word.Length == 0 || !word.All(char.IsLetter)) continue;
                var upper = word.ToUpperInvariant();
                var def = parts.Length > 1 ? parts[1].Trim().Trim('"').Trim() : "";
                definitions[upper] = def;
                if (!definedByLengthBuild.TryGetValue(upper.Length, out var list))
                    definedByLengthBuild[upper.Length] = list = new List<string>();
                list.Add(upper);
            }
        }
        Definitions = definitions;
        DefinedByLength = definedByLengthBuild.ToDictionary(kv => kv.Key, kv => kv.Value.Distinct().ToArray());

        var commonByLengthBuild = DefinedByLength.ToDictionary(kv => kv.Key, kv => kv.Value);
        commonByLengthBuild[5] = WordleWords.Answers;
        CommonByLength = commonByLengthBuild;

        var allowed = new List<int>();
        for (var len = MinWordleLength; ; len++)
        {
            if (CommonByLength.TryGetValue(len, out var words) && words.Length >= MinCommonWordsForLength)
                allowed.Add(len);
            else
                break;
        }
        if (allowed.Count == 0) allowed.Add(MinWordleLength);
        AllowedWordleLengths = allowed.ToArray();
    }

    public bool IsValidWord(string word)
    {
        if (string.IsNullOrEmpty(word)) return false;
        var upper = word.ToUpperInvariant();
        return ValidByLength.TryGetValue(upper.Length, out var set) && set.Contains(upper);
    }
}
