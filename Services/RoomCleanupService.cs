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
                var cutoff = DateTime.UtcNow - _ttl;
                foreach (var room in repo.GetAllRooms())
                {
                    if (room.LastActivity < cutoff)
                    {
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
