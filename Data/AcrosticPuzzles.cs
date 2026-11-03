namespace EstimationStation.Data;

// A single acrostic puzzle: a quote/author plus one clue per word of the quote. Simplification
// (see report): rather than a classic NYT-style acrostic (where each clue answer's letters are
// scattered across unrelated positions in the quote), each clue's answer IS one word of the
// quote and LetterPositions[clueIndex] is simply that word's own flat character run — this
// keeps construction trivially self-verifying (no hand-computed index arrays that could
// silently desync from the quote text) while still giving the fill UI the same shape Crossword
// has: a numbered clue list, a shared letter grid, live collaborative fill, one Solved event.
public class AcrosticPuzzle
{
    public string Quote { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string[] ClueTexts { get; set; } = Array.Empty<string>();
    public string[] ClueAnswers { get; set; } = Array.Empty<string>();
    public int[][] LetterPositions { get; set; } = Array.Empty<int[]>();
}

// Curated, self-contained bank of hand-authored acrostic puzzles (original clues; quotes are
// public-domain-style proverbs/literary lines, no copyrighted lyrics), used as the shared daily
// room puzzle, same "no dictionary/API dependency" philosophy as WordleWords.cs /
// Data.CrosswordPuzzles. Picked by day-seed (see PokerHub.EnsureAcrosticPuzzle), not generated.
internal static class AcrosticPuzzles
{
    // Splits the quote into words (each word's own letters, in its own quote position) and
    // pairs them with the given per-word clues, in the quote's own left-to-right order — so the
    // resulting LetterPositions can never desync from the quote text itself.
    private static AcrosticPuzzle Build(string quote, string author, string[] wordClues)
    {
        var upperQuote = quote.ToUpperInvariant();
        var words = new List<(string word, int start)>();
        var i = 0;
        while (i < upperQuote.Length)
        {
            if (!char.IsLetter(upperQuote[i])) { i++; continue; }
            var start = i;
            while (i < upperQuote.Length && char.IsLetter(upperQuote[i])) i++;
            words.Add((upperQuote.Substring(start, i - start), start));
        }
        if (words.Count != wordClues.Length)
            throw new InvalidOperationException($"Acrostic puzzle build failed: quote has {words.Count} words but {wordClues.Length} clues were given.");

        var clueAnswers = new string[words.Count];
        var positions = new int[words.Count][];
        for (var w = 0; w < words.Count; w++)
        {
            clueAnswers[w] = words[w].word;
            var pos = new int[words[w].word.Length];
            for (var j = 0; j < pos.Length; j++) pos[j] = words[w].start + j;
            positions[w] = pos;
        }

        return new AcrosticPuzzle
        {
            Quote = upperQuote,
            Author = author,
            ClueTexts = wordClues,
            ClueAnswers = clueAnswers,
            LetterPositions = positions,
        };
    }

    public static readonly AcrosticPuzzle[] Puzzles =
    {
        Build("KNOWLEDGE IS POWER", "Francis Bacon", new[]
        {
            "Facts and understanding gained through learning",
            "A linking verb (am/are/___)",
            "Strength or the ability to control",
        }),
        Build("PATIENCE IS A VIRTUE", "Proverb", new[]
        {
            "Calm tolerance in the face of delay",
            "A linking verb (am/are/___)",
            "Indefinite article before a consonant sound",
            "A trait of high moral standing",
        }),
        Build("ACTIONS SPEAK LOUDER THAN WORDS", "Proverb", new[]
        {
            "Things done, as opposed to said",
            "Communicate with the voice",
            "Greater in volume",
            "In comparison with",
            "Units of language, spoken or written",
        }),
        Build("HONESTY IS THE BEST POLICY", "Proverb", new[]
        {
            "Truthfulness and moral uprightness",
            "A linking verb (am/are/___)",
            "Definite article",
            "Superlative of good",
            "A course of action or plan",
        }),
        Build("EVERY CLOUD HAS A SILVER LINING", "Proverb", new[]
        {
            "Each and all, without exception",
            "A visible mass of water vapor in the sky",
            "Possesses",
            "Indefinite article before a consonant sound",
            "A shiny precious metal",
            "An inner layer or border",
        }),
        Build("BREVITY IS THE SOUL OF WIT", "William Shakespeare", new[]
        {
            "Concise, short expression",
            "A linking verb (am/are/___)",
            "Definite article",
            "The essence or spirit of something",
            "Belonging to",
            "Cleverness expressed in speech",
        }),
        Build("FORTUNE FAVORS THE BOLD", "Latin Proverb", new[]
        {
            "Luck or destiny, often good",
            "Prefers or shows partiality toward",
            "Definite article",
            "Courageous, daring",
        }),
        Build("PRACTICE MAKES PERFECT", "Proverb", new[]
        {
            "Repeated exercise to improve a skill",
            "Creates or produces",
            "Flawless, without fault",
        }),
        Build("THE PEN IS MIGHTIER THAN THE SWORD", "Edward Bulwer-Lytton", new[]
        {
            "Definite article",
            "A writing instrument",
            "A linking verb (am/are/___)",
            "More powerful",
            "In comparison with",
            "Definite article",
            "A bladed weapon",
        }),
        Build("WHERE THERE IS A WILL THERE IS A WAY", "Proverb", new[]
        {
            "At what place",
            "In that place",
            "A linking verb (am/are/___)",
            "Indefinite article before a consonant sound",
            "Strong determination or intent",
            "In that place",
            "A linking verb (am/are/___)",
            "Indefinite article before a consonant sound",
            "A path or method of doing something",
        }),
        Build("ALL THAT GLITTERS IS NOT GOLD", "William Shakespeare", new[]
        {
            "Every one, the whole of",
            "The specific one just mentioned",
            "Sparkles or shines brightly",
            "A linking verb (am/are/___)",
            "A word of negation",
            "A precious yellow metal",
        }),
        Build("HASTE MAKES WASTE", "Proverb", new[]
        {
            "Excessive speed or urgency",
            "Creates or produces",
            "Careless squandering of resources",
        }),
    };
}
