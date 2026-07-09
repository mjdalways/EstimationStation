namespace EstimationStation.Services;

public class RoomCleanupService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<RoomCleanupService> _logger;
    private static readonly TimeSpan _ttl = TimeSpan.FromDays(30);
    private static readonly TimeSpan _interval = TimeSpan.FromHours(1);

    public RoomCleanupService(IServiceProvider services, ILogger<RoomCleanupService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(_interval, stoppingToken);
            try
            {
                using var scope = _services.CreateScope();
                var repo = scope.ServiceProvider.GetRequiredService<IRoomRepository>();
                var mediaStore = scope.ServiceProvider.GetRequiredService<RoomMediaStore>();
                var rooms = scope.ServiceProvider.GetRequiredService<RoomService>();
                var cutoff = DateTime.UtcNow - _ttl;
                foreach (var room in repo.GetAllRooms())
                {
                    if (room.LastActivity < cutoff)
                    {
                        // B8: also drop the in-memory entry, or a later SaveRoom on it (e.g. a
                        // stray connection) would mark it dirty and resurrect the file we're
                        // about to delete. No-ops if the room is back in active use.
                        if (!rooms.TryEvictRoom(room.Name)) continue;
                        repo.DeleteRoom(room.Name);
                        mediaStore.DeleteRoom(room.Name);
                        _logger.LogInformation("Deleted stale room: {Room}", room.Name);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Room cleanup error");
            }
        }
    }
}
