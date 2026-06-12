using System.Collections.Concurrent;
using System.Text.Json;
using EstimationStation.Models;

namespace EstimationStation.Services;

// Per-room shared media library (window-view images/videos) for the 3D Room Scene.
// Files live under <rooms-sibling>/_assets/<sanitizedRoom>/, metadata in assets.json
// next to them. Mirrors FileRoomRepository's storage conventions (see Appendix A).
public class RoomMediaStore
{
    private const int MaxFiles = 8;
    private const long MaxTotalBytes = 60L * 1024 * 1024;

    private static readonly Dictionary<string, string> _extByMime = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = ".png",
        ["image/jpeg"] = ".jpg",
        ["image/gif"] = ".gif",
        ["image/webp"] = ".webp",
        ["video/mp4"] = ".mp4",
        ["video/webm"] = ".webm",
    };

    private readonly string _basePath;
    private readonly JsonSerializerOptions _jsonOpts = new() { WriteIndented = false };
    private readonly ConcurrentDictionary<string, object> _locks = new(StringComparer.OrdinalIgnoreCase);

    public RoomMediaStore(IConfiguration config)
    {
        var roomsPath = config["RoomStoragePath"] ?? Path.Combine(AppContext.BaseDirectory, "rooms");
        var root = Path.GetDirectoryName(Path.GetFullPath(roomsPath)) ?? AppContext.BaseDirectory;
        _basePath = Path.Combine(root, "_assets");
        Directory.CreateDirectory(_basePath);
    }

    private object LockFor(string room) => _locks.GetOrAdd(room, _ => new object());

    private string RoomDir(string room) => Path.Combine(_basePath, RoomService.NormalizeName(room));

    private string MetaPath(string room) => Path.Combine(RoomDir(room), "assets.json");

    public async Task<MediaEntry?> SaveAsync(string room, IFormFile file)
    {
        if (file.Length <= 0) return null;

        var header = new byte[16];
        int read;
        using (var s = file.OpenReadStream())
        {
            read = await s.ReadAsync(header.AsMemory(0, header.Length));
        }

        var mime = ValidatedMime(file.ContentType, header, read);
        if (mime == null) return null;

        var dir = RoomDir(room);
        Directory.CreateDirectory(dir);
        var id = Guid.NewGuid().ToString("N");
        var ext = _extByMime[mime];
        var path = Path.Combine(dir, id + ext);

        var entry = new MediaEntry
        {
            Id = id,
            Name = string.IsNullOrWhiteSpace(file.FileName) ? (id + ext) : Path.GetFileName(file.FileName),
            Mime = mime,
            Size = file.Length,
            AddedAt = DateTime.UtcNow,
        };

        lock (LockFor(room))
        {
            var entries = LoadMeta(room).OrderBy(e => e.AddedAt).ToList();

            // Evict oldest entries until the new file fits within the per-room quota.
            while (entries.Count > 0 &&
                   (entries.Count >= MaxFiles || entries.Sum(e => e.Size) + entry.Size > MaxTotalBytes))
            {
                var oldest = entries[0];
                entries.RemoveAt(0);
                DeleteFile(dir, oldest);
            }

            using (var dst = File.Create(path))
            using (var src = file.OpenReadStream())
            {
                src.CopyTo(dst);
            }

            entries.Add(entry);
            SaveMeta(room, entries);
        }

        return entry;
    }

    public IReadOnlyList<MediaEntry> List(string room)
    {
        lock (LockFor(room))
        {
            return LoadMeta(room).OrderBy(e => e.AddedAt).ToList();
        }
    }

    public (Stream stream, MediaEntry entry)? Open(string room, string id)
    {
        lock (LockFor(room))
        {
            var entry = LoadMeta(room).FirstOrDefault(e => e.Id == id);
            if (entry == null) return null;
            var path = Path.Combine(RoomDir(room), entry.Id + _extByMime[entry.Mime]);
            if (!File.Exists(path)) return null;
            return (File.OpenRead(path), entry);
        }
    }

    public bool Delete(string room, string id)
    {
        lock (LockFor(room))
        {
            var entries = LoadMeta(room);
            var entry = entries.FirstOrDefault(e => e.Id == id);
            if (entry == null) return false;
            DeleteFile(RoomDir(room), entry);
            entries.Remove(entry);
            SaveMeta(room, entries);
            return true;
        }
    }

    // Called by RoomCleanupService when a stale room is deleted entirely.
    public void DeleteRoom(string room)
    {
        lock (LockFor(room))
        {
            var dir = RoomDir(room);
            if (Directory.Exists(dir))
            {
                try { Directory.Delete(dir, recursive: true); } catch { /* best effort */ }
            }
        }
    }

    private void DeleteFile(string dir, MediaEntry entry)
    {
        if (!_extByMime.TryGetValue(entry.Mime, out var ext)) return;
        var path = Path.Combine(dir, entry.Id + ext);
        try { if (File.Exists(path)) File.Delete(path); } catch { /* best effort */ }
    }

    private List<MediaEntry> LoadMeta(string room)
    {
        var path = MetaPath(room);
        if (!File.Exists(path)) return new List<MediaEntry>();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<List<MediaEntry>>(json) ?? new List<MediaEntry>();
        }
        catch
        {
            return new List<MediaEntry>();
        }
    }

    private void SaveMeta(string room, List<MediaEntry> entries)
    {
        var json = JsonSerializer.Serialize(entries, _jsonOpts);
        var path = MetaPath(room);
        var tmpPath = path + ".tmp";
        try
        {
            File.WriteAllText(tmpPath, json);
            File.Move(tmpPath, path, overwrite: true);
        }
        catch
        {
            try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { /* best effort */ }
            throw;
        }
    }

    // Whitelist by claimed content-type, then verify magic bytes so a renamed/forged
    // upload can't masquerade as a different format (path-traversal / content-spoofing).
    private static string? ValidatedMime(string? claimedMime, byte[] header, int len)
    {
        if (claimedMime == null || !_extByMime.ContainsKey(claimedMime)) return null;

        bool ok = claimedMime.ToLowerInvariant() switch
        {
            "image/png" => len >= 4 && header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47,
            "image/jpeg" => len >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,
            "image/gif" => len >= 4 && header[0] == 0x47 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x38, // "GIF8"
            "image/webp" => len >= 12 && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46 // "RIFF"
                            && header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50,        // "WEBP"
            "video/mp4" => len >= 8 && header[4] == 0x66 && header[5] == 0x74 && header[6] == 0x79 && header[7] == 0x70, // "ftyp"
            "video/webm" => len >= 4 && header[0] == 0x1A && header[1] == 0x45 && header[2] == 0xDF && header[3] == 0xA3,
            _ => false,
        };

        return ok ? claimedMime.ToLowerInvariant() : null;
    }
}
