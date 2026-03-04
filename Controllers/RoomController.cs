using Microsoft.AspNetCore.Mvc;
using EstimationStation.Models;

namespace EstimationStation.Controllers;

public class RoomController : Controller
{
    public IActionResult Index(string roomName, string name)
    {
        if (string.IsNullOrWhiteSpace(roomName))
            return RedirectToAction("Index", "Home");

        var model = new RoomViewModel
        {
            RoomName = roomName,
            PlayerName = string.IsNullOrWhiteSpace(name) ? "Anonymous" : name
        };

        return View(model);
    }
}
