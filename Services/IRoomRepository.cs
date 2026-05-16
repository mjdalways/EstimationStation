using EstimationStation.Models;

namespace EstimationStation.Services;

public interface IRoomRepository
{
    Room? GetRoom(string name);
    void SaveRoom(Room room);
    void DeleteRoom(string name);
    IEnumerable<Room> GetAllRooms();
}
