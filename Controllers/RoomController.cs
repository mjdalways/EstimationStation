using Microsoft.AspNetCore.Mvc;
using EstimationStation.Models;

namespace EstimationStation.Controllers;

public class RoomController : Controller
{
    public IActionResult Index(string roomName, string name)
    {
        if (string.IsNullOrWhiteSpace(roomName))
            return RedirectToAction("Index", "Home");

        if (string.IsNullOrWhiteSpace(name))
            return RedirectToAction("Index", "Home", new { room = roomName });

        var model = new RoomViewModel
        {
            RoomName = roomName,
            PlayerName = name
        };

        return View(model);
    }
}
