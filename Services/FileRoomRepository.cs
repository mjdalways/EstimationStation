using System.Text.Json;
using EstimationStation.Models;

namespace EstimationStation.Services;

public class FileRoomRepository : IRoomRepository
{
    private readonly string _basePath;
    private readonly JsonSerializerOptions _jsonOpts = new() { WriteIndented = false };

    public FileRoomRepository(IConfiguration config)
    {
        _basePath = config["RoomStoragePath"]
            ?? Path.Combine(AppContext.BaseDirectory, "rooms");
        Directory.CreateDirectory(_basePath);
    }

    private string FilePath(string name) =>
        Path.Combine(_basePath, SanitizeName(name) + ".json");

    private static string SanitizeName(string name) =>
        string.Concat(name.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_')).ToLower();

    public Room? GetRoom(string name)
    {
        var path = FilePath(name);
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<Room>(json);
        }
        catch { return null; }
    }

    public void SaveRoom(Room room)
    {
        try
        {
            var path = FilePath(room.Name);
            File.WriteAllText(path, JsonSerializer.Serialize(room, _jsonOpts));
        }
        catch { /* log in production */ }
    }

    public void DeleteRoom(string name)
    {
        var path = FilePath(name);
        if (File.Exists(path)) File.Delete(path);
    }

    public IEnumerable<Room> GetAllRooms()
    {
        if (!Directory.Exists(_basePath)) return [];
        return Directory.EnumerateFiles(_basePath, "*.json")
            .Select(f => {
                try { return JsonSerializer.Deserialize<Room>(File.ReadAllText(f)); }
                catch { return null; }
            })
            .Where(r => r != null)!;
    }
}
