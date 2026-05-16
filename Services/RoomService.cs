using System.Collections.Concurrent;
using EstimationStation.Models;

namespace EstimationStation.Services;

public class RoomService
{
    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, string> _connectionToRoom = new();
    private readonly IRoomRepository _repo;

    public RoomService(IRoomRepository repo)
    {
        _repo = repo;
    }

    public static readonly Dictionary<string, EstimateSetInfo> EstimateSets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["fibonacci"] = new EstimateSetInfo
        {
            Name = "fibonacci",
            DisplayName = "Fibonacci",
            Values = new[] { "0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕" }
        },
        ["modified-fibonacci"] = new EstimateSetInfo
        {
            Name = "modified-fibonacci",
            DisplayName = "Modified Fibonacci",
            Values = new[] { "½", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "☕" }
        },
        ["t-shirt"] = new EstimateSetInfo
        {
            Name = "t-shirt",
            DisplayName = "T-Shirt",
            Values = new[] { "XS", "S", "M", "L", "XL", "XXL", "?", "☕" }
        },
        ["powers-of-2"] = new EstimateSetInfo
        {
            Name = "powers-of-2",
            DisplayName = "Powers of 2",
            Values = new[] { "1", "2", "4", "8", "16", "32", "64", "?", "☕" }
        },
        ["custom"] = new EstimateSetInfo
        {
            Name = "custom",
            DisplayName = "Custom",
            Values = Array.Empty<string>()
        }
    };

    public Room GetOrCreateRoom(string roomName)
    {
        if (_rooms.TryGetValue(roomName, out var existing)) return existing;

        var persisted = _repo.GetRoom(roomName);
        if (persisted != null)
        {
            _rooms[roomName] = persisted;
            return persisted;
        }

        var room = new Room { Name = roomName };
        _rooms[roomName] = room;
        _repo.SaveRoom(room);
        return room;
    }

    public void SaveRoom(Room room)
    {
        room.LastActivity = DateTime.UtcNow;
        _repo.SaveRoom(room);
    }

    public Room? GetRoom(string roomName)
    {
        _rooms.TryGetValue(roomName, out var room);
        return room;
    }

    public void MapConnection(string connectionId, string roomName)
    {
        _connectionToRoom[connectionId] = roomName;
    }

    public string? GetRoomForConnection(string connectionId)
    {
        _connectionToRoom.TryGetValue(connectionId, out var roomName);
        return roomName;
    }

    public void RemoveConnection(string connectionId)
    {
        if (_connectionToRoom.TryRemove(connectionId, out var roomName))
        {
            if (_rooms.TryGetValue(roomName, out var room))
                _repo.SaveRoom(room);
        }
    }
}
