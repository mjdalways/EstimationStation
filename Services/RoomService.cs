using System.Collections.Concurrent;
using EstimationStation.Models;

namespace EstimationStation.Services;

public class RoomService
{
    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, string> _connectionToRoom = new();

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
        return _rooms.GetOrAdd(roomName, name => new Room { Name = name });
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
        _connectionToRoom.TryRemove(connectionId, out _);
    }
}
