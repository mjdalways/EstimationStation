using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using EstimationStation.Models;

namespace EstimationStation.Controllers;

public class HomeController : Controller
{
    public IActionResult Index(string? room)
    {
        ViewData["InviteRoom"] = room;
        return View();
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    public ContentResult Sitemap()
    {
        var baseUrl = $"{Request.Scheme}://{Request.Host}";
        var xml = $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url>
                <loc>{baseUrl}/</loc>
                <changefreq>weekly</changefreq>
                <priority>1.0</priority>
              </url>
            </urlset>
            """;
        return Content(xml, "application/xml");
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
