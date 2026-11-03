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

    /// <summary>
    /// F11/P3 — the absentee pre-vote page. Deliberately its own page rather than a mode of
    /// the room: someone leaving estimates in advance must not show up in the participant
    /// list, claim a chair or count toward the auto-reveal quorum. Everything it needs
    /// (stories, existing pre-votes) arrives over the hub via PrevoteJoin, which re-checks
    /// the room PIN, so this action itself intentionally reveals nothing about the room.
    /// </summary>
    public IActionResult Prevote(string roomName, string name)
    {
        var canonical = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(canonical))
            return RedirectToAction("Index", "Home");
        if (canonical != roomName)
            return RedirectToAction("Prevote", "Room", new { roomName = canonical, name });

        return View(new RoomViewModel { RoomName = canonical, PlayerName = name ?? string.Empty });
    }
}
