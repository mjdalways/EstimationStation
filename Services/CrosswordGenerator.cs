using System.Text.RegularExpressions;
using EstimationStation.Data;

namespace EstimationStation.Services;

public readonly record struct CrosswordSlot(int Number, char Direction, int Row, int Col, int Length);

// Builds a fresh NxN crossword puzzle from WordListService data via backtracking
// constraint-satisfaction over a black-cell template, instead of picking from a fixed
// hand-authored set. Clue text comes from real NGSL definitions wherever possible (a
// dictionary definition of the answer word is a legitimate, non-spoiler crossword clue).
//
// Grid size is chosen per-room (see Room.CrosswordSize / PokerHub.GameConfigure) rather than
// fixed at 5. The 11 hand-tuned 5x5 templates are still tried first at size 5 so rooms that
// never change the size get exactly the puzzles they used to; every other size uses
// procedurally generated 180-degree-rotationally-symmetric templates.
//
// Three things keep this fast enough to run inline on a hub call (it holds the room lock):
//   * an inverted letter-position index over the word pools, so finding the words matching a
//     partially-filled slot is a couple of array intersections instead of a full pool scan;
//   * most-constrained-slot-first ordering, which prunes the search tree far earlier than
//     positional order does;
//   * a hard wall-clock deadline, so a pathological template can never stall a room.
//
// Always succeeds: if every template/candidate-pool combination fails within budget, falls back
// to one of the hand-authored Data.CrosswordPuzzles.Puzzles (a 5x5), same as before this
// generator existed.
public class CrosswordGenerator
{
    public const int MinSize = 4;
    public const int MaxSize = 9;
    public const int DefaultSize = 5;

    private const int CandidateCap = 300;
    // Ceiling on procedurally generated black-cell density. 0.34 leaves enough short slots for
    // large grids to fill reliably without the result reading as mostly-black.
    private const double MaxBlackFraction = 0.34;
    private const int TemplatesPerDensity = 3;
    // Whole-Generate wall clock. Generation happens under `lock (room)` on the hub call that
    // configures the game, so this is the worst a room can ever be blocked for.
    private const int TimeBudgetMs = 1500;

    private readonly WordListService _words;

    // Inverted index over each word pool: _index[(defined, length)][pos * 26 + letter] lists the
    // words of that length with that letter at that position, and _pools holds the unfiltered
    // pool for the same key. Built lazily per (pool, length) actually used, then immutable —
    // the generator is a singleton shared by every room, hence the lock around construction.
    private readonly Dictionary<(bool defined, int length), string[]> _pools = new();
    private readonly Dictionary<(bool defined, int length), string[]?[]> _index = new();
    private readonly object _indexLock = new();

    public CrosswordGenerator(WordListService words)
    {
        _words = words;
    }

    public static int ClampSize(int size) => Math.Clamp(size, MinSize, MaxSize);

    // The original hand-tuned 5x5 templates: 180-degree-rotationally-symmetric, low-to-moderate
    // density. Still tried first at size 5 so a room that never changes its grid size keeps
    // getting the same quality of puzzle it always did.
    private static readonly (int r, int c)[][] Legacy5x5 =
    {
        Array.Empty<(int,int)>(),
        new[] { (0,1), (4,3) },
        new[] { (0,3), (4,1) },
        new[] { (1,0), (3,4) },
        new[] { (1,4), (3,0) },
        new[] { (0,2), (4,2) },
        new[] { (2,0), (2,4) },
        new[] { (0,1), (1,4), (3,0), (4,3) },
        new[] { (0,0), (0,4), (4,0), (4,4) },
        new[] { (1,1), (1,3), (3,1), (3,3) },
        new[] { (0,1), (4,3), (2,0), (2,4) },
    };

    public CrosswordPuzzle Generate(int seed, int size = DefaultSize)
    {
        size = ClampSize(size);
        var rng = new Random(seed);
        var deadline = DateTime.UtcNow.AddMilliseconds(TimeBudgetMs);

        // Two passes over the same template sequence, exactly as before: first insisting every
        // answer has a real NGSL definition (so every clue is a genuine definition), then
        // relaxing to the full dictionary if that over-constrains the grid. The definitions
        // pass gets the first half of the clock so a hard grid still leaves time to relax.
        var passDeadlines = new[] { DateTime.UtcNow.AddMilliseconds(TimeBudgetMs / 2), deadline };
        for (var pass = 0; pass < 2; pass++)
        {
            var requireDefinitions = pass == 0;
            foreach (var template in Templates(size, new Random(rng.Next())))
            {
                if (DateTime.UtcNow >= passDeadlines[pass]) break;
                var puzzle = TryBuild(template, size, new Random(rng.Next()), requireDefinitions, deadline);
                if (puzzle != null) return puzzle;
            }
        }

        return CrosswordPuzzles.Puzzles[Math.Abs(seed) % CrosswordPuzzles.Puzzles.Length];
    }

    // Where to start the density sweep for a given size. Small grids fill fine wide open (a 5x5
    // with no black cells is a double word square, and the legacy templates prove those exist in
    // this word list), but an open 7x7+ is effectively unfillable — starting the sweep there
    // just burns the whole clock on impossible grids. So anything above 5 starts around 22%
    // black, which caps slots at a length the pools can actually satisfy.
    private static int StartBlack(int size)
    {
        if (size <= DefaultSize) return 0;
        var start = (int)Math.Round(size * size * 0.22);
        return start % 2 == 0 ? start : start + 1; // symmetric pairs, so always even
    }

    // Template sequence for a size: hand-authored 5x5 first (size 5 only), then procedurally
    // generated symmetric templates at ascending black-cell density from StartBlack upward.
    // Ascending order means the openest grids that stand a chance are tried first, with denser,
    // easier-to-fill grids as the reliability fallback.
    private static IEnumerable<(int r, int c)[]> Templates(int size, Random rng)
    {
        if (size == DefaultSize)
        {
            foreach (var t in Legacy5x5) yield return t;
        }

        var start = StartBlack(size);
        if (start == 0 && size != DefaultSize) yield return Array.Empty<(int, int)>();

        var maxBlack = (int)(size * size * MaxBlackFraction);
        var seen = new HashSet<string>();
        for (var target = Math.Max(2, start); target <= maxBlack; target += 2)
        {
            for (var attempt = 0; attempt < TemplatesPerDensity; attempt++)
            {
                var t = RandomSymmetricTemplate(size, target, rng);
                if (t.Length == 0) continue;
                var key = string.Join(";", t.Select(x => x.r + "," + x.c).OrderBy(s => s, StringComparer.Ordinal));
                if (!seen.Add(key)) continue;
                yield return t;
            }
        }
    }

    // Grows a black-cell set toward targetBlack by repeatedly adding a random cell together
    // with its 180-degree partner, keeping an addition only if the grid stays usable (white
    // region connected, no white cell stranded without a 2+ letter slot). Returns whatever it
    // reached - a template slightly under target is still a perfectly good grid.
    private static (int r, int c)[] RandomSymmetricTemplate(int size, int targetBlack, Random rng)
    {
        var black = new HashSet<(int r, int c)>();
        var cells = new List<(int r, int c)>();
        for (var r = 0; r < size; r++)
            for (var c = 0; c < size; c++)
                cells.Add((r, c));
        for (var i = cells.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (cells[i], cells[j]) = (cells[j], cells[i]);
        }

        foreach (var cell in cells)
        {
            if (black.Count >= targetBlack) break;
            var partner = (r: size - 1 - cell.r, c: size - 1 - cell.c);
            if (black.Contains(cell) || black.Contains(partner)) continue;

            black.Add(cell);
            black.Add(partner);
            if (!IsUsable(size, black))
            {
                black.Remove(cell);
                black.Remove(partner);
            }
        }
        return black.ToArray();
    }

    // A template is usable if the white cells form one connected region and every white cell
    // sits in at least one horizontal or vertical run of length >= 2 - i.e. it can be reached
    // and constrained by some clue. (TryBuild re-checks coverage against the real slot layout;
    // this is the cheap pre-filter that keeps template growth from painting itself into a
    // corner.)
    private static bool IsUsable(int size, HashSet<(int r, int c)> black)
    {
        bool IsBlack(int r, int c) => r < 0 || r >= size || c < 0 || c >= size || black.Contains((r, c));

        (int r, int c)? start = null;
        var whiteCount = 0;
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (IsBlack(r, c)) continue;
                whiteCount++;
                start ??= (r, c);
                var hasRun = !IsBlack(r, c - 1) || !IsBlack(r, c + 1) || !IsBlack(r - 1, c) || !IsBlack(r + 1, c);
                if (!hasRun) return false;
            }
        }
        if (start == null) return false;

        var seen = new HashSet<(int r, int c)> { start.Value };
        var queue = new Queue<(int r, int c)>();
        queue.Enqueue(start.Value);
        while (queue.Count > 0)
        {
            var (r, c) = queue.Dequeue();
            foreach (var (dr, dc) in new[] { (0, 1), (0, -1), (1, 0), (-1, 0) })
            {
                var nr = r + dr;
                var nc = c + dc;
                if (IsBlack(nr, nc) || !seen.Add((nr, nc))) continue;
                queue.Enqueue((nr, nc));
            }
        }
        return seen.Count == whiteCount;
    }

    // Standard crossword numbering: scan row-major; a cell starts an across word if it's not
    // black, there's a non-black neighbor to its right, and (it's the left edge or the cell to
    // its left is black); starts a down word symmetrically. Any cell that starts either kind
    // gets the next sequential number. Shared by the generator and by PokerHub (client layout
    // payload / fill validation) so there is exactly one numbering implementation.
    public static List<CrosswordSlot> ComputeLayout(string[] rows)
    {
        var size = rows.Length;
        bool IsBlack(int r, int c) => r < 0 || r >= size || c < 0 || c >= size || rows[r][c] == '#';

        var slots = new List<CrosswordSlot>();
        var number = 0;
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (IsBlack(r, c)) continue;
                var startsAcross = !IsBlack(r, c + 1) && (c == 0 || IsBlack(r, c - 1));
                var startsDown = !IsBlack(r + 1, c) && (r == 0 || IsBlack(r - 1, c));
                if (!startsAcross && !startsDown) continue;
                number++;
                if (startsAcross)
                {
                    var len = 0;
                    while (!IsBlack(r, c + len)) len++;
                    slots.Add(new CrosswordSlot(number, 'A', r, c, len));
                }
                if (startsDown)
                {
                    var len = 0;
                    while (!IsBlack(r + len, c)) len++;
                    slots.Add(new CrosswordSlot(number, 'D', r, c, len));
                }
            }
        }
        return slots;
    }

    private CrosswordPuzzle? TryBuild((int r, int c)[] blackCells, int size, Random rng, bool requireDefinitions, DateTime deadline)
    {
        var blackSet = new HashSet<(int, int)>(blackCells);
        var template = new string[size];
        for (var r = 0; r < size; r++)
        {
            var chars = new char[size];
            for (var c = 0; c < size; c++) chars[c] = blackSet.Contains((r, c)) ? '#' : '.';
            template[r] = new string(chars);
        }

        var layout = ComputeLayout(template);

        // Every non-black cell must belong to at least one length>=2 entry, or it can never
        // be filled via any clue/crossing constraint.
        var covered = new bool[size, size];
        foreach (var e in layout)
        {
            for (var i = 0; i < e.Length; i++)
            {
                if (e.Direction == 'A') covered[e.Row, e.Col + i] = true;
                else covered[e.Row + i, e.Col] = true;
            }
        }
        for (var r = 0; r < size; r++)
            for (var c = 0; c < size; c++)
                if (!blackSet.Contains((r, c)) && !covered[r, c]) return null;

        var grid = new char[size, size];
        for (var r = 0; r < size; r++)
            for (var c = 0; c < size; c++)
                grid[r, c] = blackSet.Contains((r, c)) ? '#' : '.';

        var remaining = new List<CrosswordSlot>(layout);
        var chosen = new Dictionary<(int, char, int, int), string>();
        var used = new HashSet<string>(StringComparer.Ordinal);
        // Pattern -> matching words, scoped to this one attempt. The same partial pattern comes
        // up constantly during backtracking, and most-constrained-first ordering asks for every
        // remaining slot's candidates at every node, so without this the index lookups dominate.
        var cache = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var budget = Math.Max(20000, size * size * 1200);

        if (!Backtrack(remaining, grid, rng, requireDefinitions, chosen, used, cache, ref budget, deadline)) return null;

        var solutionRows = new string[size];
        for (var r = 0; r < size; r++)
        {
            var chars = new char[size];
            for (var c = 0; c < size; c++) chars[c] = grid[r, c];
            solutionRows[r] = new string(chars);
        }

        var acrossClues = new List<string>();
        var downClues = new List<string>();
        foreach (var e in layout)
        {
            var word = chosen[(e.Number, e.Direction, e.Row, e.Col)];
            var clue = ClueFor(word);
            if (e.Direction == 'A') acrossClues.Add(clue); else downClues.Add(clue);
        }

        return new CrosswordPuzzle
        {
            Rows = solutionRows,
            AcrossClues = acrossClues.ToArray(),
            DownClues = downClues.ToArray(),
        };
    }

    // Most-constrained-slot-first backtracking: at every node, fill whichever remaining slot has
    // the fewest matching words. That finds dead ends immediately instead of discovering them
    // several slots later, which is the difference between seconds and milliseconds on the
    // bigger grids.
    private bool Backtrack(List<CrosswordSlot> remaining, char[,] grid, Random rng, bool requireDefinitions,
        Dictionary<(int, char, int, int), string> chosen, HashSet<string> used,
        Dictionary<string, string[]> cache, ref int budget, DateTime deadline)
    {
        if (remaining.Count == 0) return true;
        if (--budget <= 0) return false;
        if (DateTime.UtcNow >= deadline) return false;

        var bestIdx = -1;
        string[]? bestCandidates = null;
        for (var i = 0; i < remaining.Count; i++)
        {
            var candidates = CandidatesFor(remaining[i], grid, requireDefinitions, cache);
            if (candidates.Length == 0) return false; // this slot is already unsatisfiable
            if (bestCandidates == null || candidates.Length < bestCandidates.Length)
            {
                bestIdx = i;
                bestCandidates = candidates;
                if (candidates.Length == 1) break; // can't do better than forced
            }
        }

        var slot = remaining[bestIdx];
        remaining.RemoveAt(bestIdx);
        var key = (slot.Number, slot.Direction, slot.Row, slot.Col);

        foreach (var word in Sample(bestCandidates!, rng))
        {
            if (!used.Add(word)) continue; // no repeated answers within one puzzle
            var newlySet = Place(slot, word, grid);
            chosen[key] = word;
            if (Backtrack(remaining, grid, rng, requireDefinitions, chosen, used, cache, ref budget, deadline)) return true;
            chosen.Remove(key);
            used.Remove(word);
            Unplace(slot, newlySet, grid);
            if (budget <= 0 || DateTime.UtcNow >= deadline) break;
        }

        remaining.Insert(bestIdx, slot);
        return false;
    }

    // Up to CandidateCap words from the match list, in random order. Sampling rather than
    // shuffling the whole list matters for wide-open slots, where the match list is the entire
    // pool for that length.
    private static IEnumerable<string> Sample(string[] candidates, Random rng)
    {
        if (candidates.Length <= CandidateCap)
        {
            var copy = (string[])candidates.Clone();
            for (var i = copy.Length - 1; i > 0; i--)
            {
                var j = rng.Next(i + 1);
                (copy[i], copy[j]) = (copy[j], copy[i]);
            }
            return copy;
        }

        var picked = new HashSet<int>();
        var result = new List<string>(CandidateCap);
        while (result.Count < CandidateCap)
        {
            var idx = rng.Next(candidates.Length);
            if (picked.Add(idx)) result.Add(candidates[idx]);
        }
        return result;
    }

    private static string PatternKey(CrosswordSlot slot, char[,] grid)
    {
        var chars = new char[slot.Length];
        for (var i = 0; i < slot.Length; i++)
        {
            var r = slot.Direction == 'A' ? slot.Row : slot.Row + i;
            var c = slot.Direction == 'A' ? slot.Col + i : slot.Col;
            chars[i] = grid[r, c];
        }
        return new string(chars);
    }

    private string[] CandidatesFor(CrosswordSlot slot, char[,] grid, bool requireDefinitions, Dictionary<string, string[]> cache)
    {
        var pattern = PatternKey(slot, grid);
        if (cache.TryGetValue(pattern, out var cached)) return cached;

        var pool = Pool(requireDefinitions, slot.Length);
        string[] result;
        if (pool.Length == 0)
        {
            result = Array.Empty<string>();
        }
        else
        {
            // Start from the smallest posting list among the already-fixed letters, then filter
            // that down by the rest of the pattern. With no fixed letters the whole pool matches.
            var index = Index(requireDefinitions, slot.Length);
            var narrowest = pool;
            var anyFixed = false;
            for (var i = 0; i < pattern.Length; i++)
            {
                var ch = pattern[i];
                if (ch < 'A' || ch > 'Z') continue;
                anyFixed = true;
                var posting = index[i * 26 + (ch - 'A')];
                if (posting == null) { narrowest = Array.Empty<string>(); break; }
                if (posting.Length < narrowest.Length) narrowest = posting;
            }

            if (!anyFixed || narrowest.Length == 0)
            {
                result = narrowest;
            }
            else
            {
                var matches = new List<string>();
                foreach (var w in narrowest)
                    if (Matches(w, pattern)) matches.Add(w);
                result = matches.ToArray();
            }
        }

        cache[pattern] = result;
        return result;
    }

    // The word pool for one (definitions-required?, length) pair, and its inverted
    // letter-position index. Built once per pair and then read-only; the lock only ever
    // contends on the first few generations after startup.
    private string[] Pool(bool requireDefinitions, int length)
    {
        EnsureIndexed(requireDefinitions, length);
        lock (_indexLock) { return _pools[(requireDefinitions, length)]; }
    }

    private string[]?[] Index(bool requireDefinitions, int length)
    {
        EnsureIndexed(requireDefinitions, length);
        lock (_indexLock) { return _index[(requireDefinitions, length)]; }
    }

    private void EnsureIndexed(bool requireDefinitions, int length)
    {
        var key = (requireDefinitions, length);
        lock (_indexLock)
        {
            if (_pools.ContainsKey(key)) return;
        }

        var source = requireDefinitions
            ? (_words.DefinedByLength.TryGetValue(length, out var defined) ? defined : Array.Empty<string>())
            : (_words.AllWordsByLength.TryGetValue(length, out var all) ? all : Array.Empty<string>());

        // A word whose own definition contains the word is a giveaway clue, so it's dropped from
        // the definitions pool up front rather than re-tested (with a regex!) at every lookup.
        if (requireDefinitions)
        {
            source = source.Where(w => !(_words.Definitions.TryGetValue(w, out var def) && ContainsWholeWord(def, w))).ToArray();
        }

        var buckets = new List<string>?[length * 26];
        foreach (var w in source)
        {
            for (var i = 0; i < length; i++)
            {
                var ch = w[i];
                if (ch < 'A' || ch > 'Z') continue;
                var slot = i * 26 + (ch - 'A');
                (buckets[slot] ??= new List<string>()).Add(w);
            }
        }
        var built = new string[]?[length * 26];
        for (var i = 0; i < buckets.Length; i++) built[i] = buckets[i]?.ToArray();

        lock (_indexLock)
        {
            _pools[key] = source;
            _index[key] = built;
        }
    }

    private static int[] Place(CrosswordSlot slot, string word, char[,] grid)
    {
        var newlySet = new List<int>();
        for (var i = 0; i < slot.Length; i++)
        {
            var r = slot.Direction == 'A' ? slot.Row : slot.Row + i;
            var c = slot.Direction == 'A' ? slot.Col + i : slot.Col;
            if (grid[r, c] == '.')
            {
                grid[r, c] = word[i];
                newlySet.Add(i);
            }
        }
        return newlySet.ToArray();
    }

    private static void Unplace(CrosswordSlot slot, int[] newlySet, char[,] grid)
    {
        foreach (var i in newlySet)
        {
            var r = slot.Direction == 'A' ? slot.Row : slot.Row + i;
            var c = slot.Direction == 'A' ? slot.Col + i : slot.Col;
            grid[r, c] = '.';
        }
    }

    private static bool Matches(string word, string pattern)
    {
        for (var i = 0; i < pattern.Length; i++)
            if (pattern[i] != '.' && pattern[i] != word[i]) return false;
        return true;
    }

    private static bool ContainsWholeWord(string text, string word)
    {
        if (string.IsNullOrEmpty(text)) return false;
        return Regex.IsMatch(text, $@"\b{Regex.Escape(word)}\b", RegexOptions.IgnoreCase);
    }

    private string ClueFor(string word)
    {
        if (_words.Definitions.TryGetValue(word, out var def) && !string.IsNullOrWhiteSpace(def))
        {
            var clue = char.ToUpperInvariant(def[0]) + def.Substring(1);
            return clue.TrimEnd('.');
        }
        return "Common word";
    }
}
