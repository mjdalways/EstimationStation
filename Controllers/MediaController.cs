using System.Text.RegularExpressions;
using EstimationStation.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace EstimationStation.Controllers;

// Runs as a resource filter — i.e. before MVC model binding. ASP.NET Core's
// FormValueProviderFactory eagerly calls Request.ReadFormAsync() for any multipart POST
// during model binding (even with no [FromForm]/IFormFile parameters), which turns an
// oversized body into a generic 400 ModelState error before the action ever runs. Checking
// Content-Length here lets us return a real 413 instead.
public class MaxBodySizeAttribute : Attribute, IAsyncResourceFilter
{
    private readonly long _maxBytes;
    public MaxBodySizeAttribute(long maxBytes) => _maxBytes = maxBytes;

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        if (request.ContentLength is long len && len > _maxBytes)
        {
            context.Result = new StatusCodeResult(StatusCodes.Status413PayloadTooLarge);
            return;
        }
        var feature = context.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature != null && !feature.IsReadOnly) feature.MaxRequestBodySize = _maxBytes;
        await next();
    }
}

// Per-room shared media library for the 3D Room Scene's window view (P2/P3 of Feature 6).
// No auth — same trust model as the SignalR room group: anyone who knows the room name
// can list/fetch/upload/delete its media. {id} is a server-generated GUID scoped to the
// room's own folder, which is the isolation boundary.
[ApiController]
[Route("api/rooms/{roomName}/window-media")]
public class MediaController : ControllerBase
{
    private const long MaxUploadBytes = 15_728_640;

    private static readonly Regex _idPattern = new("^[0-9a-f]{32}$", RegexOptions.Compiled);

    private readonly RoomMediaStore _store;
    private readonly RoomService _roomService;
    private readonly IRoomRepository _roomRepository;

    public MediaController(RoomMediaStore store, RoomService roomService, IRoomRepository roomRepository)
    {
        _store = store;
        _roomService = roomService;
        _roomRepository = roomRepository;
    }

    [HttpPost]
    [MaxBodySize(MaxUploadBytes)]
    public async Task<IActionResult> Upload(string roomName, IFormFile? file)
    {
        if (!RoomExists(roomName, out var normalized)) return NotFound();
        if (file == null || file.Length == 0) return BadRequest();

        var entry = await _store.SaveAsync(normalized, file);
        if (entry == null) return BadRequest("Unsupported or invalid file.");
        return Ok(entry);
    }

    [HttpGet]
    public IActionResult List(string roomName)
    {
        if (!RoomExists(roomName, out var normalized)) return NotFound();
        return Ok(_store.List(normalized));
    }

    [HttpGet("{id}")]
    public IActionResult Get(string roomName, string id)
    {
        if (!RoomExists(roomName, out var normalized)) return NotFound();
        if (!_idPattern.IsMatch(id)) return NotFound();

        var result = _store.Open(normalized, id);
        if (result == null) return NotFound();

        var (stream, entry) = result.Value;
        Response.Headers.ETag = "\"" + entry.Id + "\"";
        return File(stream, entry.Mime, enableRangeProcessing: true);
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(string roomName, string id)
    {
        if (!RoomExists(roomName, out var normalized)) return NotFound();
        if (!_idPattern.IsMatch(id)) return NotFound();

        return _store.Delete(normalized, id) ? NoContent() : NotFound();
    }

    private bool RoomExists(string roomName, out string normalized)
    {
        normalized = RoomService.NormalizeName(roomName);
        if (string.IsNullOrEmpty(normalized)) return false;
        return _roomService.GetRoom(normalized) != null || _roomRepository.GetRoom(normalized) != null;
    }
}
