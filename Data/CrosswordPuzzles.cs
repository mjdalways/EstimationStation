namespace EstimationStation.Data;

// A single 5x5 crossword puzzle: the solution grid ('#' marks a black cell) plus clue text
// for every across/down word, in row-major encounter order (the order Hubs/PokerHub.cs's
// ComputeCrosswordLayout discovers them while scanning the grid). Numbers are never stored
// here — they're computed at runtime from the black-cell layout, same numbering algorithm
// every physical crossword uses.
public class CrosswordPuzzle
{
    public string[] Rows { get; set; } = Array.Empty<string>();
    public string[] AcrossClues { get; set; } = Array.Empty<string>();
    public string[] DownClues { get; set; } = Array.Empty<string>();
}

// Curated, self-contained set of 5x5 crossword puzzles (original grids + original clues,
// not copied from any real publication) used as the shared daily room puzzle, same
// "no dictionary/API dependency" philosophy as WordleWords.cs.
internal static class CrosswordPuzzles
{
    public static readonly CrosswordPuzzle[] Puzzles =
    {
        new CrosswordPuzzle
        {
            Rows = new[] { "P#SPY", "ECHO#", "GLASS", "#IDEA", "APE#D" },
            AcrossClues = new[]
            {
                "Secret agent",
                "Repeated sound",
                "Clear drinking vessel",
                "Concept or plan",
                "Great primate",
            },
            DownClues = new[]
            {
                "Wooden fastener",
                "Protection from sun",
                "Strike a stance",
                "Fastener",
                "Feeling down",
            },
        },
        new CrosswordPuzzle
        {
            Rows = new[] { "CUBE#", "A#RAW", "SPARE", "TIN#R", "#EDGE" },
            AcrossClues = new[]
            {
                "Six-sided shape",
                "Uncooked",
                "Extra, backup",
                "Soft metal, or a can",
                "Outer border",
            },
            DownClues = new[]
            {
                "Actors in a show",
                "Product label",
                "Hearing organ",
                "Past tense of are",
                "Round dessert",
            },
        },
        new CrosswordPuzzle
        {
            Rows = new[] { "#BULK", "BUN#N", "ASIDE", "N#TOE", "DIET#" },
            AcrossClues = new[]
            {
                "Large mass",
                "Round bread roll",
                "To one side",
                "Foot digit",
                "Eating plan",
            },
            DownClues = new[]
            {
                "Public transit vehicle",
                "Bring together",
                "Leg joint",
                "Musical group",
                "Small round mark",
            },
        },
        new CrosswordPuzzle
        {
            Rows = new[] { "EDGE#", "AIR#P", "SMALL", "T#SEA", "#SPIN" },
            AcrossClues = new[]
            {
                "Outer border",
                "What we breathe",
                "Not big",
                "Ocean",
                "Rotate quickly",
            },
            DownClues = new[]
            {
                "Sunrise direction",
                "Not bright",
                "Firmly hold",
                "Prepared scheme",
                "Hawaiian flower necklace",
            },
        },
        new CrosswordPuzzle
        {
            Rows = new[] { "ELF#E", "#IRON", "ROUND", "UNIT#", "G#TOW" },
            AcrossClues = new[]
            {
                "Santa's helper",
                "Pressing appliance, or a metal",
                "Circular",
                "Single measured item",
                "Pull a vehicle",
            },
            DownClues = new[]
            {
                "King of the jungle",
                "Sweet plant product",
                "Finish",
                "On top of",
                "Floor covering",
            },
        },
        new CrosswordPuzzle
        {
            Rows = new[] { "B#DRY", "ACRE#", "GUESS", "#RATE", "GEM#T" },
            AcrossClues = new[]
            {
                "Not wet",
                "Land measurement unit",
                "Estimate without certainty",
                "Speed, or a charge",
                "Precious stone",
            },
            DownClues = new[]
            {
                "Carrying sack",
                "Sleep-time vision",
                "Relax",
                "Medical fix",
                "Group, or to place",
            },
        },
    };
}
