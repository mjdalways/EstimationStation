FEATURE PLAN v5.0 — GROUPS AB (IMAGE CROP) + J (MOBILE) + K (ROOM PERSISTENCE)
Files: wwwroot/js/site.js, wwwroot/js/room.js, wwwroot/css/site.css, Views/Shared/_Layout.cshtml, Hubs/PokerHub.cs, Services/IRoomRepository.cs (new), Services/JsonFileRoomRepository.cs (new), Program.cs, appsettings.json

KEY FACTS:
- Avatar upload: _Layout.cshtml line ~1092, input id="avatar-upload-input", img id="avatar-preview"
- Card back image: site.js applyCardBackDesign() line 1032, localStorage 'es_cardBackCustomImg' (base64)
- Season sprite: seasonal.js AA4 — customImg stored in sea_cfg_${season} localStorage key
- _openStoriesSheet()/_closeStoriesSheet() at room.js:690–706 (already exist, check what they do exactly)
- Vote cards rendered as .poker-card elements in Index.cshtml
- PokerHub.cs JoinRoom at line 29; Room model in RoomService or Models/Room.cs
- RoomService uses in-memory ConcurrentDictionary — persistence layer sits under it

---

GROUP AB — IMAGE UPLOAD WITH CROP/PAN/ZOOM

AB1 — Shared Crop Dialog Component

FILE: wwwroot/js/site.js — add openCropDialog() utility

var _cropState = { canvas:null, ctx:null, img:null, scale:1, ox:0, oy:0, dragging:false, lastX:0, lastY:0, aspect:1, onConfirm:null };

function openCropDialog(file, aspectRatio, onConfirm) {
  _cropState.aspect = aspectRatio || 1;
  _cropState.onConfirm = onConfirm;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      _cropState.img = img;
      _cropState.scale = Math.max(200/img.naturalWidth, 200/img.naturalHeight);
      _cropState.ox = 0; _cropState.oy = 0;
      _cropShowDialog();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
window.openCropDialog = openCropDialog;

function _cropShowDialog() {
  document.getElementById('_crop_dialog')?.remove();
  var W = 300; var H = Math.round(W / _cropState.aspect);
  var html = '<div id="_crop_dialog" class="modal fade show" style="display:block;background:rgba(0,0,0,0.7);z-index:3000;" tabindex="-1">' +
    '<div class="modal-dialog modal-sm modal-dialog-centered">' +
    '<div class="modal-content"><div class="modal-header py-2"><h6 class="modal-title mb-0">Crop Image</h6></div>' +
    '<div class="modal-body p-2 text-center">' +
    '<div style="position:relative;display:inline-block;overflow:hidden;width:' + W + 'px;height:' + H + 'px;border:2px solid var(--accent);border-radius:6px;cursor:move;" id="_crop_viewport">' +
    '<canvas id="_crop_canvas" width="' + W + '" height="' + H + '" style="display:block;"></canvas>' +
    '</div>' +
    '<div class="d-flex align-items-center gap-2 mt-2"><span class="small">🔍</span>' +
    '<input type="range" id="_crop_zoom" min="0.5" max="4" step="0.05" value="1" class="form-range flex-grow-1">' +
    '<span class="small">4×</span></div>' +
    '<div class="text-muted small mt-1">Drag to pan · Pinch or slider to zoom</div>' +
    '</div>' +
    '<div class="modal-footer py-2">' +
    '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'_crop_dialog\').remove()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="_cropConfirm()">Apply</button>' +
    '</div></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  _cropState.canvas = document.getElementById('_crop_canvas');
  _cropState.ctx = _cropState.canvas.getContext('2d');
  _cropDrawFrame();
  _cropBindEvents();
}

function _cropDrawFrame() {
  var st = _cropState; var c = st.canvas; var ctx = st.ctx;
  if (!c || !ctx || !st.img) return;
  ctx.clearRect(0, 0, c.width, c.height);
  var iw = st.img.naturalWidth * st.scale;
  var ih = st.img.naturalHeight * st.scale;
  ctx.drawImage(st.img, st.ox + (c.width - iw)/2, st.oy + (c.height - ih)/2, iw, ih);
}

function _cropBindEvents() {
  var vp = document.getElementById('_crop_viewport');
  var zoom = document.getElementById('_crop_zoom');
  zoom.value = _cropState.scale;
  zoom.addEventListener('input', function() {
    _cropState.scale = parseFloat(this.value);
    _cropDrawFrame();
  });
  vp.addEventListener('mousedown', function(e) {
    _cropState.dragging = true; _cropState.lastX = e.clientX; _cropState.lastY = e.clientY;
  });
  document.addEventListener('mousemove', function(e) {
    if (!_cropState.dragging) return;
    _cropState.ox += e.clientX - _cropState.lastX;
    _cropState.oy += e.clientY - _cropState.lastY;
    _cropState.lastX = e.clientX; _cropState.lastY = e.clientY;
    _cropDrawFrame();
  });
  document.addEventListener('mouseup', function() { _cropState.dragging = false; });
  // Touch (mobile pinch zoom)
  var _lastPinchDist = null;
  vp.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      _cropState.dragging = true;
      _cropState.lastX = e.touches[0].clientX; _cropState.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      _cropState.dragging = false;
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      _lastPinchDist = Math.sqrt(dx*dx + dy*dy);
    }
    e.preventDefault();
  }, { passive: false });
  vp.addEventListener('touchmove', function(e) {
    if (e.touches.length === 1 && _cropState.dragging) {
      _cropState.ox += e.touches[0].clientX - _cropState.lastX;
      _cropState.oy += e.touches[0].clientY - _cropState.lastY;
      _cropState.lastX = e.touches[0].clientX; _cropState.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2 && _lastPinchDist) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx + dy*dy);
      _cropState.scale *= dist / _lastPinchDist;
      _cropState.scale = Math.max(0.5, Math.min(4, _cropState.scale));
      _lastPinchDist = dist;
      zoom.value = _cropState.scale;
    }
    _cropDrawFrame();
    e.preventDefault();
  }, { passive: false });
  vp.addEventListener('touchend', function() { _cropState.dragging = false; _lastPinchDist = null; });
}

function _cropConfirm() {
  var st = _cropState;
  if (!st.canvas || !st.onConfirm) return;
  // Export current canvas view as base64 JPEG
  var dataUrl = st.canvas.toDataURL('image/jpeg', 0.88);
  document.getElementById('_crop_dialog')?.remove();
  st.onConfirm(dataUrl);
}
window._cropConfirm = _cropConfirm;

---

AB2 — Wire Crop to Avatar Upload

FILE: Views/Shared/_Layout.cshtml — Profile tab, avatar-upload-input (line ~1092)

CURRENT: <input type="file" id="avatar-upload-input" accept="image/*" onchange="handleAvatarUpload(event)">
CHANGE onchange to: onchange="openCropDialog(event.target.files[0], 1, _applyCroppedAvatar)"

FILE: wwwroot/js/site.js — replace handleAvatarUpload body (or add _applyCroppedAvatar alongside it):

function _applyCroppedAvatar(dataUrl) {
  localStorage.setItem('es_avatar', dataUrl);
  var preview = document.getElementById('avatar-preview');
  if (preview) preview.src = dataUrl;
  applyAvatar();
}
window._applyCroppedAvatar = _applyCroppedAvatar;

---

AB3 — Wire Crop to Card Back Image Import

FILE: wwwroot/js/site.js — inside card-back image import handler (wherever card-back-image-input onchange fires, related to Y3)

Change so file goes through crop first:
  input.onchange = function(e) {
    openCropDialog(e.target.files[0], 3/4, function(dataUrl) {
      localStorage.setItem('es_cardBackCustomImg', dataUrl);
      applyCardBackDesign();
    });
  };

Aspect ratio 3/4 matches portrait card proportions.

---

AB4 — Wire Crop to Season Sprite Import

FILE: wwwroot/js/seasonal.js — handleSeaImageUpload() from AA4 plan

Change so file goes through crop before storing:
  openCropDialog(file, 1, function(dataUrl) {
    var cfg = JSON.parse(localStorage.getItem('sea_cfg_' + seasonKey) || '{}');
    cfg[animName + '_customImg'] = dataUrl;
    localStorage.setItem('sea_cfg_' + seasonKey, JSON.stringify(cfg));
  });

Aspect ratio 1 (square) works for sprite emojis.

---

GROUP J — MOBILE EXPERIENCE

J1 — Stories Bottom Sheet (already partially implemented)

FILE: wwwroot/js/room.js — _openStoriesSheet() and _closeStoriesSheet() at lines 690–706

READ THESE FUNCTIONS first to understand current implementation. The bottom sheet may already work on mobile — verify:
- Does it have a swipe-down-to-close gesture?
- Does it have a drag handle?

If drag handle missing, add to sheet HTML (wherever sheet is rendered/injected):
  <div id="stories-sheet-handle" style="width:40px;height:4px;background:rgba(128,128,128,0.4);border-radius:2px;margin:8px auto 0;cursor:grab;"></div>

Add swipe-to-close: attach touchstart/touchmove/touchend to the handle or sheet header:
  var _sheetDragY = null;
  document.addEventListener('touchstart', function(e) {
    var handle = document.getElementById('stories-sheet-handle');
    if (!handle || !handle.contains(e.target)) return;
    _sheetDragY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (_sheetDragY === null) return;
    var dy = e.touches[0].clientY - _sheetDragY;
    var sheet = document.getElementById('stories-sheet');
    if (sheet && dy > 0) sheet.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    if (_sheetDragY === null) return;
    var dy = (e.changedTouches[0]?.clientY || 0) - _sheetDragY;
    _sheetDragY = null;
    var sheet = document.getElementById('stories-sheet');
    if (sheet) sheet.style.transform = '';
    if (dy > 80) _closeStoriesSheet();
  });

FILE: wwwroot/css/site.css — stories sheet on mobile

@media (max-width: 767px) {
  #stories-sheet {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    max-height: 70vh;
    overflow-y: auto;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.3);
    z-index: 1050;
    transition: transform 0.25s ease;
  }
}

---

J2 — Vote Card Tap Targets

FILE: wwwroot/css/site.css — .poker-card minimum tap target

@media (max-width: 767px) {
  .poker-card {
    min-width: 48px !important;
    min-height: 52px !important;
    font-size: 1.1rem;
    padding: 6px 4px;
  }
  .cards-row {
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
}

Also ensure .poker-card has cursor:pointer and -webkit-tap-highlight-color:transparent for iOS.

---

J3 — Auto Lite Mode on Small Screens

FILE: wwwroot/js/room.js — add near top, after connection setup:

function _isMobileLite() {
  return window.innerWidth < 600 && localStorage.getItem('es_mobileLiteOverride') !== '0';
}

Where confetti / fireworks / slot machine are triggered, gate with:
  if (!_isMobileLite()) { /* fire confetti/fireworks/slot-machine animation */ }

Specifically in celebration.js, check _sequentialReveal and triggerConsensusSupernova:
  // At start of triggerConsensusSupernova:
  if (typeof _isMobileLite === 'function' && _isMobileLite()) return;

  // In _sequentialReveal, skip confetti burst per card:
  if (!_isMobileLite()) confetti({ ... });

FILE: Views/Shared/_Layout.cshtml — Other tab (near voice/misc controls)
  <div class="form-check form-switch mt-2">
    <input class="form-check-input" type="checkbox" id="mobile-lite-override"
           onchange="localStorage.setItem('es_mobileLiteOverride',this.checked?'0':'1')">
    <label class="form-check-label" for="mobile-lite-override">Enable animations on mobile (may be slow)</label>
  </div>
  <div class="text-muted small">Auto-disabled on screens under 600px wide.</div>

In openSettingsModal() populate:
  var mlo = document.getElementById('mobile-lite-override');
  if (mlo) mlo.checked = localStorage.getItem('es_mobileLiteOverride') === '0';

---

J4 — Input Attributes for Mobile Keyboard

FILE: Views/Home/Index.cshtml — createRoomName and joinRoomName inputs
  Add: inputmode="text" autocapitalize="off" autocorrect="off"

FILE: Views/Shared/_Layout.cshtml — PIN inputs (F1), any numeric inputs
  Add: inputmode="numeric" to PIN fields and any 4-digit input

FILE: Views/Home/Index.cshtml — player name input
  Add: autocomplete="nickname"

These attributes are already recommended practice; check if any are missing and add them.

---

GROUP K — ROOM PERSISTENCE

K1 — IRoomRepository Interface

FILE: Services/IRoomRepository.cs (new file)

using EstimationStation.Models;

namespace EstimationStation.Services;

public interface IRoomRepository
{
    Task<Room?> GetAsync(string roomName);
    Task SaveAsync(Room room);
    Task DeleteAsync(string roomName);
    Task<IEnumerable<string>> ListActiveAsync(TimeSpan maxAge);
}

---

K2 — JsonFileRoomRepository

FILE: Services/JsonFileRoomRepository.cs (new file)

using System.Text.Json;
using System.Collections.Concurrent;
using EstimationStation.Models;

namespace EstimationStation.Services;

public class JsonFileRoomRepository : IRoomRepository
{
    private readonly string _basePath;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public JsonFileRoomRepository(IConfiguration config)
    {
        _basePath = config["RoomPersistence:Path"] ?? "rooms";
        Directory.CreateDirectory(_basePath);
    }

    private SemaphoreSlim _lock(string name) =>
        _locks.GetOrAdd(name.ToLowerInvariant(), _ => new SemaphoreSlim(1, 1));

    private string _path(string name) =>
        Path.Combine(_basePath, name.ToLowerInvariant().Replace("..", "") + ".json");

    public async Task<Room?> GetAsync(string roomName)
    {
        var path = _path(roomName);
        if (!File.Exists(path)) return null;
        var sem = _lock(roomName);
        await sem.WaitAsync();
        try
        {
            var json = await File.ReadAllTextAsync(path);
            return JsonSerializer.Deserialize<Room>(json);
        }
        catch { return null; }
        finally { sem.Release(); }
    }

    public async Task SaveAsync(Room room)
    {
        var sem = _lock(room.Name);
        await sem.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(room, new JsonSerializerOptions { WriteIndented = false });
            await File.WriteAllTextAsync(_path(room.Name), json);
        }
        finally { sem.Release(); }
    }

    public async Task DeleteAsync(string roomName)
    {
        var path = _path(roomName);
        if (File.Exists(path)) File.Delete(path);
        _locks.TryRemove(roomName.ToLowerInvariant(), out _);
        await Task.CompletedTask;
    }

    public async Task<IEnumerable<string>> ListActiveAsync(TimeSpan maxAge)
    {
        var cutoff = DateTime.UtcNow - maxAge;
        return Directory.GetFiles(_basePath, "*.json")
            .Where(f => File.GetLastWriteTimeUtc(f) >= cutoff)
            .Select(f => Path.GetFileNameWithoutExtension(f));
        // async not strictly needed here but interface requires it
    }
}

---

K3 — RoomService Integration

FILE: Services/RoomService.cs (existing) — inject IRoomRepository

Add constructor parameter:
  private readonly IRoomRepository _repo;

  public RoomService(IRoomRepository repo) { _repo = repo; }

On GetRoom() — hydrate from repo if not in memory:
  public Room? GetRoom(string name)
  {
    if (_rooms.TryGetValue(name, out var room)) return room;
    // Try hydrate from disk (sync wrapper — only at startup/first access)
    var fromDisk = _repo.GetAsync(name).GetAwaiter().GetResult();
    if (fromDisk != null) { _rooms[name] = fromDisk; return fromDisk; }
    return null;
  }

On CreateRoom() / mutating operations — save after mutation:
  After any CreateRoom or significant state change (vote cast, story completed, etc.):
  _ = _repo.SaveAsync(room);  // fire-and-forget; don't await in sync path

NOTE: If RoomService is already async (takes Task<> returns), await directly. If sync, use fire-and-forget.

---

K4 — TTL Cleanup Background Service

FILE: Services/RoomCleanupService.cs (new file)

using Microsoft.Extensions.Hosting;

namespace EstimationStation.Services;

public class RoomCleanupService : BackgroundService
{
    private readonly IRoomRepository _repo;
    private readonly RoomService _rooms;
    private readonly TimeSpan _ttl;

    public RoomCleanupService(IRoomRepository repo, RoomService rooms, IConfiguration config)
    {
        _repo = repo;
        _rooms = rooms;
        _ttl = TimeSpan.FromHours(config.GetValue<int>("RoomPersistence:TtlHours", 48));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
            var active = await _repo.ListActiveAsync(_ttl);
            // Rooms NOT in active list have expired — nothing to delete (ListActiveAsync already returns only fresh rooms)
            // Delete rooms that are stale: get all files, remove those older than TTL
            var stale = Directory.GetFiles(config["RoomPersistence:Path"] ?? "rooms", "*.json")
                .Where(f => File.GetLastWriteTimeUtc(f) < DateTime.UtcNow - _ttl);
            foreach (var f in stale)
            {
                var name = Path.GetFileNameWithoutExtension(f);
                await _repo.DeleteAsync(name);
                _rooms.RemoveRoom(name);  // add RemoveRoom() to RoomService if not present
            }
        }
    }
}

NOTE: RoomCleanupService needs IConfiguration injected if you use config["..."] inside ExecuteAsync. Alternatively, store _path in field set in constructor.

---

K5 — appsettings.json + Program.cs

FILE: appsettings.json — add section:
  "RoomPersistence": {
    "Path": "rooms",
    "TtlHours": 48
  }

FILE: Program.cs — register services:
  builder.Services.AddSingleton<IRoomRepository, JsonFileRoomRepository>();
  builder.Services.AddSingleton<RoomService>();
  builder.Services.AddHostedService<RoomCleanupService>();

If RoomService was previously registered as AddSingleton without IRoomRepository, update the registration to include constructor injection — DI will resolve IRoomRepository automatically.

---

K6 — Room Model Serialization

FILE: Models/Room.cs (or wherever Room is defined)

Ensure all properties have public getters and setters (for JsonSerializer). Any HashSet<ConnectionId> or ConcurrentDictionary in the model needs a JSON-serializable equivalent or [JsonIgnore] if transient.

Add [JsonIgnore] to:
- Any SignalR connection-related fields (ConnectionId strings in Participants can stay as they hydrate fine)
- Active timers or task references

If Participant has only { ConnectionId, Name, IsObserver, ... } it serializes cleanly.

The Story model needs public setters for all properties used in serialization.
