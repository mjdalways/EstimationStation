using System.Collections.Concurrent;

namespace EstimationStation.Services;

/// <summary>
/// Pending "are you there? / do you want to leave?" requests, shared between the hub (which
/// creates and resolves them) and the background sweep (which enforces the timeout). Keyed by a
/// short request id that is only ever sent to the target client.
/// </summary>
public class LeaveRequestStore
{
    public ConcurrentDictionary<string, PendingLeave> Requests { get; } = new();
}

public record PendingLeave(
    string RoomName,
    string RequesterConnectionId,
    string RequesterName,
    string TargetConnectionId,
    string TargetName,
    DateTime CreatedAt,
    int TimeoutSeconds);
