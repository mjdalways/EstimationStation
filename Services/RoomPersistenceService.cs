namespace EstimationStation.Services;

/// <summary>
/// Periodically flushes rooms with pending in-memory changes to disk, so the SignalR hub threads
/// never block on file I/O. A final flush runs on shutdown so the last few seconds of activity
/// are not lost during a graceful stop.
/// </summary>
public class RoomPersistenceService : BackgroundService
{
    private readonly RoomService _rooms;
    private static readonly TimeSpan _interval = TimeSpan.FromSeconds(2);

    public RoomPersistenceService(RoomService rooms) => _rooms = rooms;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(_interval, stoppingToken);
                _rooms.FlushDirty();
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
        finally
        {
            _rooms.FlushDirty(); // final flush on shutdown
        }
    }
}
