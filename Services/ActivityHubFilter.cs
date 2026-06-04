using EstimationStation.Services;
using Microsoft.AspNetCore.SignalR;

namespace EstimationStation.Hubs;

/// <summary>
/// Stamps a participant's LastSeen on every hub invocation, so the background sweep can tell who
/// has gone idle. Centralizing it here means every interaction counts as activity without having
/// to touch each hub method.
/// </summary>
public class ActivityHubFilter : IHubFilter
{
    private readonly RoomService _rooms;

    public ActivityHubFilter(RoomService rooms) => _rooms = rooms;

    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        Touch(invocationContext.Context.ConnectionId);
        return await next(invocationContext);
    }

    private void Touch(string connectionId)
    {
        var roomName = _rooms.GetRoomForConnection(connectionId);
        if (roomName == null) return;
        var room = _rooms.GetRoom(roomName);
        if (room == null) return;
        lock (room)
        {
            var p = room.Participants.FirstOrDefault(x => x.ConnectionId == connectionId);
            if (p != null) p.LastSeen = DateTime.UtcNow;
        }
    }
}
