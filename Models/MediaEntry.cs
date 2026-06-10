namespace EstimationStation.Models;

// Metadata for one file in a room's shared media library (RoomMediaStore).
public class MediaEntry
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Mime { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
    public string? UploadedBy { get; set; }
}
