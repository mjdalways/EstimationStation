using EstimationStation.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace EstimationStation.Services;

/// <summary>
/// Background sweep that (1) enforces the timeout on pending "are you there?" leave requests and
/// (2) removes participants who have been idle for 2 hours or more. Runs off the hub threads and
/// broadcasts through <see cref="IHubContext{PokerHub}"/>.
/// </summary>
public class ParticipantSweepService : BackgroundService
{
    private readonly RoomService _rooms;
    private readonly LeaveRequestStore _leaveStore;
    private readonly IHubContext<PokerHub> _hub;
    private static readonly TimeSpan _tick = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan _idleTtl = TimeSpan.FromHours(2);

    public ParticipantSweepService(RoomService rooms, LeaveRequestStore leaveStore, IHubContext<PokerHub> hub)
    {
        _rooms = rooms;
        _leaveStore = leaveStore;
        _hub = hub;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Task.Delay(_tick, stoppingToken); }
            catch (OperationCanceledException) { break; }

            try { await SweepAsync(); }
            catch { /* keep the loop alive; transient errors are non-fatal */ }
        }
    }

    private async Task SweepAsync()
    {
        var now = DateTime.UtcNow;

        // 1) Expired leave requests
        foreach (var kv in _leaveStore.Requests.ToArray())
        {
            var req = kv.Value;
            if ((now - req.CreatedAt).TotalSeconds < req.TimeoutSeconds) continue;
            if (!_leaveStore.Requests.TryRemove(kv.Key, out _)) continue;

            var room = _rooms.GetRoom(req.RoomName);
            if (room == null) continue;

            bool targetGone, targetIsHost, requesterPresent;
            lock (room)
            {
                targetGone = !room.Participants.Any(p => p.ConnectionId == req.TargetConnectionId);
                targetIsHost = room.HostConnectionId == req.TargetConnectionId;
                requesterPresent = room.Participants.Any(p => p.ConnectionId == req.RequesterConnectionId);
            }
            if (targetGone) continue; // already gone

            if (targetIsHost)
            {
                // Host didn't answer — don't remove them; just hand host to the requester.
                if (requesterPresent)
                {
                    lock (room) { room.HostConnectionId = req.RequesterConnectionId; }
                    _rooms.SaveRoom(room);
                    await _hub.Clients.Group(req.RoomName).SendAsync("HostChanged", req.RequesterConnectionId);
                }
                await _hub.Clients.Client(req.TargetConnectionId).SendAsync("LeaveRequestExpired");
            }
            else
            {
                await PokerHub.RemoveAndBroadcastAsync(
                    _rooms, _hub.Clients, _hub.Groups, room, req.RoomName, req.TargetConnectionId, "timeout");
            }
        }

        // 2) Idle participants (>= 2h with no hub activity)
        foreach (var room in _rooms.ActiveRooms)
        {
            List<string> idle;
            lock (room)
            {
                idle = room.Participants
                    .Where(p => (now - p.LastSeen) >= _idleTtl)
                    .Select(p => p.ConnectionId)
                    .ToList();
            }
            foreach (var cid in idle)
                await PokerHub.RemoveAndBroadcastAsync(_rooms, _hub.Clients, _hub.Groups, room, room.Name, cid, "idle");
        }
    }
}
