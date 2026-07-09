using System.Collections.Concurrent;
using EstimationStation.Models;

namespace EstimationStation.Services;

public class RoomService
{
    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, string> _connectionToRoom = new();
    // Rooms with unsaved in-memory changes, flushed to disk by RoomPersistenceService.
    private readonly ConcurrentDictionary<string, byte> _dirty = new();
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

    /// <summary>
    /// Canonical room key: strip to letters/digits/-/_ and lower-case. This MUST match the
    /// file-name rule in <see cref="FileRoomRepository"/> so the in-memory key and the persisted
    /// file never diverge. Without it, "My Room", "my room" and "myroom" would map to one file
    /// but three separate in-memory rooms, clobbering each other's state. Returns "" when nothing
    /// usable remains (callers should reject empty).
    /// </summary>
    public static string NormalizeName(string? roomName) =>
        string.Concat((roomName ?? "").Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_')).ToLowerInvariant();

    public Room GetOrCreateRoom(string roomName)
    {
        roomName = NormalizeName(roomName);
        if (_rooms.TryGetValue(roomName, out var existing)) return existing;

        var persisted = _repo.GetRoom(roomName);
        if (persisted != null)
        {
            persisted.Name = roomName; // keep loaded room's name canonical
            // Participants hold SignalR ConnectionIds that are only valid within a single
            // server process lifetime. Any participants in the file are stale — their
            // connections are definitively gone. Clear them so nobody sees ghost participants
            // after a restart (dev or production). Stories, settings and pin are preserved.
            persisted.Participants.Clear();
            persisted.HostConnectionId = null;  // stale connection ID
            persisted.VotesRevealed = false;    // no participants left to have voted
            persisted.Vibes.Clear();            // per-round data tied to participants
            persisted.ChairClaims.Clear();      // claims also hold stale connection IDs
            _rooms[roomName] = persisted;
            return persisted;
        }

        var room = new Room { Name = roomName };
        _rooms[roomName] = room;
        _repo.SaveRoom(room);
        return room;
    }

    /// <summary>
    /// Records a change in memory and marks the room dirty. Persistence is coalesced and written
    /// by <see cref="RoomPersistenceService"/> off the SignalR threads, so a burst of votes/vibes
    /// no longer triggers one synchronous disk write each. The in-memory state stays current, so
    /// real-time broadcasts and joins are unaffected; only the on-disk copy lags by a few seconds.
    /// </summary>
    public void SaveRoom(Room room)
    {
        room.LastActivity = DateTime.UtcNow;
        _dirty[NormalizeName(room.Name)] = 1;
    }

    /// <summary>Writes all rooms with pending changes to disk. Called periodically and on shutdown.</summary>
    public void FlushDirty()
    {
        foreach (var name in _dirty.Keys.ToArray())
        {
            if (!_dirty.TryRemove(name, out _)) continue;
            if (_rooms.TryGetValue(name, out var room))
                _repo.SaveRoom(room);
        }
    }

    public Room? GetRoom(string roomName)
    {
        _rooms.TryGetValue(NormalizeName(roomName), out var room);
        return room;
    }

    /// <summary>Result of removing a participant from a room.</summary>
    public record RemovalResult(bool Removed, string Name, bool WasHost, string? NewHostId, List<int> ReleasedChairs);

    /// <summary>
    /// Removes a participant from a room's state under lock, frees any chair claim they held,
    /// and transfers host to the next remaining participant if the one removed was the host.
    /// Pure state mutation — the caller is responsible for connection cleanup, persistence,
    /// and broadcasting.
    /// </summary>
    public RemovalResult RemoveParticipant(Room room, string connectionId)
    {
        string name = string.Empty;
        bool removed = false, wasHost = false;
        string? newHostId = null;
        var releasedChairs = new List<int>();
        lock (room)
        {
            var p = room.Participants.FirstOrDefault(x => x.ConnectionId == connectionId);
            if (p != null) { name = p.Name; room.Participants.Remove(p); removed = true; }
            foreach (var kv in room.ChairClaims.Where(kv => kv.Value.ConnectionId == connectionId).ToList())
            {
                room.ChairClaims.Remove(kv.Key);
                releasedChairs.Add(kv.Key);
            }
            if (room.HostConnectionId == connectionId)
            {
                wasHost = true;
                if (room.Participants.Count > 0)
                {
                    room.HostConnectionId = room.Participants[0].ConnectionId;
                    newHostId = room.HostConnectionId;
                }
            }
        }
        return new RemovalResult(removed, name, wasHost, newHostId, releasedChairs);
    }

    /// <summary>Returns the in-memory rooms (used by the idle sweep).</summary>
    public IEnumerable<Room> ActiveRooms => _rooms.Values;

    /// <summary>
    /// Drops a room from the in-memory cache (used by <see cref="RoomCleanupService"/> after it
    /// deletes the on-disk file). Without this the in-memory entry lives forever — any later
    /// SaveRoom on it (e.g. from a lingering connection) would mark it dirty and
    /// FlushDirty/RoomPersistenceService would resurrect the file the cleanup just deleted.
    /// No-ops if the room has participants (still in active use) or is dirty (unsaved changes
    /// would be lost) — evict on the next sweep instead of racing a live room.
    /// </summary>
    public bool TryEvictRoom(string roomName)
    {
        var key = NormalizeName(roomName);
        if (!_rooms.TryGetValue(key, out var room)) return true;
        lock (room)
        {
            if (room.Participants.Count > 0) return false;
        }
        if (_dirty.ContainsKey(key)) return false;
        return _rooms.TryRemove(key, out _);
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
            // B9: coalesce like every other mutation (SaveRoom marks dirty; RoomPersistenceService
            // flushes) instead of a synchronous disk write on the hub thread.
            if (_rooms.TryGetValue(roomName, out var room))
                SaveRoom(room);
        }
    }
}
