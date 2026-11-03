namespace EstimationStation.Services;

public class JumblePuzzle
{
    public string[] Scrambled { get; set; } = Array.Empty<string>();
    public string[] Words { get; set; } = Array.Empty<string>();
    public int[] MarkedIndex { get; set; } = Array.Empty<int>();
    public string FinalAnswer { get; set; } = string.Empty;
}

// Per-room Jumble tunables, locked in by the first participant to configure the game for the
// day (see Room.Jumble* / PokerHub.GameConfigure). Defaults reproduce the original hardcoded
// 4-scrambled-words / 4-letter-final-answer / 4-to-6-letter puzzle exactly. WordCount doubles
// as the final answer's length: each scrambled word contributes one marked letter to it.
public class JumbleOptions
{
    public const int MinWordCount = 3;
    public const int MaxWordCount = 7;
    public const int MinWordLength = 3;
    public const int MaxWordLength = 8;

    public int WordCount { get; set; } = 4;
    public int MinLength { get; set; } = 4;
    public int MaxLength { get; set; } = 6;

    public JumbleOptions Normalized()
    {
        var min = Math.Clamp(MinLength, MinWordLength, MaxWordLength);
        return new JumbleOptions
        {
            WordCount = Math.Clamp(WordCount, MinWordCount, MaxWordCount),
            MinLength = min,
            MaxLength = Math.Clamp(MaxLength, min, MaxWordLength),
        };
    }
}

// Builds a daily Jumble: picks a random final answer of WordCount letters, then for each of its
// letters picks a random common word (length MinLength..MaxLength) containing that letter,
// scrambles each word (retrying if the scramble equals the original or repeats another
// scrambled word already used this puzzle), and records which scrambled-word position holds the
// "marked" letter that feeds the final answer.
public class JumbleGenerator
{
    private const int MaxWordAttempts = 30;
    private const int MaxScrambleAttempts = 30;

    private readonly WordListService _words;

    public JumbleGenerator(WordListService words)
    {
        _words = words;
    }

    public JumblePuzzle Generate(int seed, JumbleOptions? options = null)
    {
        var opts = (options ?? new JumbleOptions()).Normalized();
        var count = opts.WordCount;
        var rng = new Random(seed);

        // The final answer is one word whose length equals the number of scrambled words. Fall
        // back through the full dictionary and then a literal placeholder so an unusual word
        // count can never leave the room without a puzzle.
        var finalPool = _words.CommonByLength.TryGetValue(count, out var commonFinals) && commonFinals.Length > 0
            ? commonFinals
            : (_words.AllWordsByLength.TryGetValue(count, out var anyFinals) && anyFinals.Length > 0
                ? anyFinals
                : new[] { new string('A', count) });
        var finalAnswer = finalPool[rng.Next(finalPool.Length)].ToUpperInvariant();

        var candidatePool = new List<string>();
        for (var len = opts.MinLength; len <= opts.MaxLength; len++)
        {
            if (_words.CommonByLength.TryGetValue(len, out var words))
                candidatePool.AddRange(words.Select(w => w.ToUpperInvariant()));
        }
        if (candidatePool.Count == 0) candidatePool.Add(new string('A', opts.MinLength));

        var scrambled = new string[count];
        var chosenWords = new string[count];
        var markedIndex = new int[count];
        var usedWords = new HashSet<string>();
        var usedScrambles = new HashSet<string>();

        for (var i = 0; i < count; i++)
        {
            var letter = finalAnswer[i];
            var choices = candidatePool.Where(w => w.Contains(letter) && !usedWords.Contains(w)).ToList();
            if (choices.Count == 0) choices = candidatePool.Where(w => !usedWords.Contains(w)).ToList();
            if (choices.Count == 0) choices = candidatePool;

            var word = choices[rng.Next(choices.Count)];
            for (var attempt = 0; attempt < MaxWordAttempts && usedWords.Contains(word); attempt++)
                word = choices[rng.Next(choices.Count)];
            usedWords.Add(word);

            var markPos = Enumerable.Range(0, word.Length).Where(p => word[p] == letter).ToArray();
            var chosenMarkPos = markPos.Length > 0 ? markPos[rng.Next(markPos.Length)] : rng.Next(word.Length);

            var scramble = Scramble(word, rng);
            for (var attempt = 0; attempt < MaxScrambleAttempts && (scramble == word || usedScrambles.Contains(scramble)); attempt++)
                scramble = Scramble(word, rng);
            usedScrambles.Add(scramble);

            chosenWords[i] = word;
            scrambled[i] = scramble;
            markedIndex[i] = chosenMarkPos;
        }

        return new JumblePuzzle
        {
            Scrambled = scrambled,
            Words = chosenWords,
            MarkedIndex = markedIndex,
            FinalAnswer = finalAnswer,
        };
    }

    private static string Scramble(string word, Random rng)
    {
        var chars = word.ToCharArray();
        for (var i = chars.Length - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }
}
