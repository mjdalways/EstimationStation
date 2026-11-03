namespace EstimationStation.Services;

public class WordSearchPuzzle
{
    public string[] GridRows { get; set; } = Array.Empty<string>();
    public string[] Words { get; set; } = Array.Empty<string>();
    // word -> [startRow, startCol, endRow, endCol]
    public Dictionary<string, int[]> Solutions { get; set; } = new();
}

// Per-room Word Search tunables, locked in by the first participant to configure the game for
// the day (see Room.WordSearch* / PokerHub.GameConfigure). Defaults reproduce the original
// hardcoded 12x12 / 14-word / 4-8-letter / all-8-directions puzzle exactly.
public class WordSearchOptions
{
    public const int MinGridSize = 6;
    public const int MaxGridSize = 20;
    public const int MinWordCount = 4;
    public const int MaxWordCount = 30;
    public const int MinWordLength = 3;
    public const int MaxWordLength = 12;

    public int Size { get; set; } = 12;
    public int WordCount { get; set; } = 14;
    public int MinLength { get; set; } = 4;
    public int MaxLength { get; set; } = 8;
    public bool AllowDiagonal { get; set; } = true;
    public bool AllowReverse { get; set; } = true;

    // Clamps every field into a self-consistent, generatable range. Word length is additionally
    // capped at the grid size (a 9-letter word cannot fit on a 6x6 board) and MaxLength is
    // pulled up to MinLength if a caller inverts them.
    public WordSearchOptions Normalized()
    {
        var size = Math.Clamp(Size, MinGridSize, MaxGridSize);
        var min = Math.Clamp(MinLength, MinWordLength, Math.Min(MaxWordLength, size));
        var max = Math.Clamp(MaxLength, min, Math.Min(MaxWordLength, size));
        return new WordSearchOptions
        {
            Size = size,
            WordCount = Math.Clamp(WordCount, MinWordCount, MaxWordCount),
            MinLength = min,
            MaxLength = max,
            AllowDiagonal = AllowDiagonal,
            AllowReverse = AllowReverse,
        };
    }
}

// Builds a fresh NxN word search from WordListService's common-word pool, placing the requested
// number of words in the enabled directions at random start positions, retrying on letter
// conflicts, then filling remaining cells with random letters. Always succeeds - worst case it
// places fewer words than the target if the grid fills up, same "always returns something
// usable" philosophy as CrosswordGenerator, just without a hand-authored fallback bank (a
// partially-filled word search is still a valid, playable puzzle).
public class WordSearchGenerator
{
    private const int PlaceAttemptsPerWord = 60;

    // (dRow, dCol) for the 8 compass directions, grouped so a subset can be selected from the
    // room's AllowDiagonal/AllowReverse settings.
    private static readonly (int dr, int dc)[] ForwardStraight = { (0, 1), (1, 0) };
    private static readonly (int dr, int dc)[] ReverseStraight = { (0, -1), (-1, 0) };
    private static readonly (int dr, int dc)[] ForwardDiagonal = { (1, 1), (1, -1) };
    private static readonly (int dr, int dc)[] ReverseDiagonal = { (-1, 1), (-1, -1) };

    private readonly WordListService _words;

    public WordSearchGenerator(WordListService words)
    {
        _words = words;
    }

    public WordSearchPuzzle Generate(int seed, WordSearchOptions? options = null)
    {
        var opts = (options ?? new WordSearchOptions()).Normalized();
        var size = opts.Size;
        var directions = DirectionsFor(opts);

        var rng = new Random(seed);
        var grid = new char[size, size];
        for (var r = 0; r < size; r++)
            for (var c = 0; c < size; c++)
                grid[r, c] = '\0';

        var pool = new List<string>();
        for (var len = opts.MinLength; len <= opts.MaxLength; len++)
        {
            if (_words.CommonByLength.TryGetValue(len, out var words))
                pool.AddRange(words.Where(w => w.All(char.IsLetter)));
        }
        Shuffle(pool, rng);

        var placed = new Dictionary<string, int[]>();
        var placedWords = new HashSet<string>();
        foreach (var candidate in pool)
        {
            if (placed.Count >= opts.WordCount) break;
            var word = candidate.ToUpperInvariant();
            if (placedWords.Contains(word)) continue;
            if (TryPlace(word, grid, size, directions, rng, out var coords))
            {
                placed[word] = coords;
                placedWords.Add(word);
            }
        }

        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (grid[r, c] == '\0') grid[r, c] = (char)('A' + rng.Next(26));
            }
        }

        var rows = new string[size];
        for (var r = 0; r < size; r++)
        {
            var chars = new char[size];
            for (var c = 0; c < size; c++) chars[c] = grid[r, c];
            rows[r] = new string(chars);
        }

        return new WordSearchPuzzle
        {
            GridRows = rows,
            Words = placed.Keys.OrderBy(w => w, StringComparer.Ordinal).ToArray(),
            Solutions = placed,
        };
    }

    // Left-to-right and top-to-bottom are always available; disabling reverse drops the two
    // backwards straight directions, disabling diagonals drops all four slanted ones.
    private static (int dr, int dc)[] DirectionsFor(WordSearchOptions opts)
    {
        var dirs = new List<(int dr, int dc)>(ForwardStraight);
        if (opts.AllowReverse) dirs.AddRange(ReverseStraight);
        if (opts.AllowDiagonal)
        {
            dirs.AddRange(ForwardDiagonal);
            if (opts.AllowReverse) dirs.AddRange(ReverseDiagonal);
        }
        return dirs.ToArray();
    }

    private static bool TryPlace(string word, char[,] grid, int size, (int dr, int dc)[] directions, Random rng, out int[] coords)
    {
        coords = Array.Empty<int>();
        if (word.Length > size || directions.Length == 0) return false;

        for (var attempt = 0; attempt < PlaceAttemptsPerWord; attempt++)
        {
            var (dr, dc) = directions[rng.Next(directions.Length)];
            var startRow = rng.Next(size);
            var startCol = rng.Next(size);
            var endRow = startRow + dr * (word.Length - 1);
            var endCol = startCol + dc * (word.Length - 1);
            if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;

            var fits = true;
            for (var i = 0; i < word.Length; i++)
            {
                var r = startRow + dr * i;
                var c = startCol + dc * i;
                var existing = grid[r, c];
                if (existing != '\0' && existing != word[i]) { fits = false; break; }
            }
            if (!fits) continue;

            for (var i = 0; i < word.Length; i++)
            {
                var r = startRow + dr * i;
                var c = startCol + dc * i;
                grid[r, c] = word[i];
            }
            coords = new[] { startRow, startCol, endRow, endCol };
            return true;
        }
        return false;
    }

    private static void Shuffle(List<string> list, Random rng)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }
}
