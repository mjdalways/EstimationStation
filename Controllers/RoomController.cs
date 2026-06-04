using Microsoft.AspNetCore.Mvc;
using EstimationStation.Models;
using EstimationStation.Services;

namespace EstimationStation.Controllers;

public class RoomController : Controller
{
    public IActionResult Index(string roomName, string name)
    {
        if (string.IsNullOrWhiteSpace(roomName))
            return RedirectToAction("Index", "Home");

        // Canonicalize so the displayed name, invite links and the SignalR room all agree.
        var canonical = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(canonical))
            return RedirectToAction("Index", "Home");
        if (canonical != roomName)
            return RedirectToAction("Index", "Room", new { roomName = canonical, name });

        if (string.IsNullOrWhiteSpace(name))
            return RedirectToAction("Index", "Home", new { room = canonical });

        var model = new RoomViewModel
        {
            RoomName = canonical,
            PlayerName = name
        };

        return View(model);
    }
}
