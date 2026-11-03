using System.Collections.Concurrent;

namespace EstimationStation.Services;

/// <summary>
/// Stops anyone creating rooms without limit (each new room is a file on disk).
/// Existing rooms are never affected: only the creation of a new room name is counted.
/// shortcut: counts live in memory and reset when the app restarts; fine for a limit this loose.
/// </summary>
public class RoomCreationGuard(IConfiguration config)
{
    private readonly int _perIpPerHour = config.GetValue("Limits:NewRoomsPerIpPerHour", 20);
    private readonly int _totalPerHour = config.GetValue("Limits:NewRoomsPerHour", 500);
    private readonly ConcurrentDictionary<string, Queue<DateTime>> _byIp = new();
    private readonly Queue<DateTime> _all = new();
    private readonly object _lock = new();

    public bool Allow(string? ip)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-1);
        lock (_lock)
        {
            Trim(_all, cutoff);
            if (_all.Count >= _totalPerHour) return false;
            var q = _byIp.GetOrAdd(ip ?? "unknown", _ => new Queue<DateTime>());
            Trim(q, cutoff);
            if (q.Count >= _perIpPerHour) return false;
            q.Enqueue(now);
            _all.Enqueue(now);
            if (_byIp.Count > 5000) foreach (var k in _byIp.Where(p => p.Value.Count == 0).Select(p => p.Key).ToList()) _byIp.TryRemove(k, out _);
            return true;
        }
    }

    private static void Trim(Queue<DateTime> q, DateTime cutoff)
    {
        while (q.Count > 0 && q.Peek() < cutoff) q.Dequeue();
    }
}

public class MediaBudgetExceededException : Exception;
