# K — Room Persistence

> **Priority:** Deferred (investigation phase)  
> **Effort:** Hard  
> **Files:** `Program.cs`, `RoomService.cs`, new `IRoomRepository.cs`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

> 🔍 **Status:** Investigation. Recommendation from v4.0 confirmed: Option 2 (JSON file per room) as the implementation approach.

---

## Design

**Option 2 — JSON file per room** (chosen over SQLite and in-memory-only):

- JSON file per room in `rooms/{name}.json`
- Write on every mutation
- Hydrate in-memory store on server startup from existing files
- `IRoomRepository` abstraction allows future swap to SQLite without touching hub/service code

---

## Implementation Plan

### K1 — IRoomRepository Interface

```csharp
public interface IRoomRepository {
    Task SaveAsync(Room room, CancellationToken ct = default);
    Task<Room?> LoadAsync(string name, CancellationToken ct = default);
    Task DeleteAsync(string name, CancellationToken ct = default);
    Task<IReadOnlyList<string>> ListNamesAsync(CancellationToken ct = default);
}
```

### K2 — JsonFileRoomRepository

- Path: `rooms/{name}.json` (configurable via `appsettings.json`: `"RoomStoragePath": "rooms/"`)
- `SemaphoreSlim` per room name for safe concurrent file I/O (extends existing `lock(room)` pattern)
- Serialise with `System.Text.Json`; ignore unknown properties for forward compatibility

### K3 — Startup Hydration

- In `Program.cs` or a hosted startup service: scan `rooms/` directory, deserialise each file, populate the in-memory `RoomService` store
- Rooms already in memory remain unchanged — persistence is additive

### K4 — TTL Cleanup (Background Service)

- `IHostedService` runs on a configurable interval (default: every hour)
- Auto-deletes rooms inactive for 7 days (last-activity timestamp stored in JSON)
- Configurable TTL via `appsettings.json`: `"RoomTtlDays": 7`

---

## Scope

| In scope | Out of scope |
|----------|-------------|
| Stories, participants, votes, room settings | Vote history, analytics (stay in client localStorage) |
| Persist across server restarts | Real-time backup / cloud sync |
| 7-day TTL cleanup | Per-user data migration |

---

## Verification

- [ ] Create a room, add stories, cast votes → restart the server → room is still present with all data
- [ ] Room inactive for > 7 days is automatically cleaned up
- [ ] Concurrent vote casts from multiple participants don't corrupt the JSON file
- [ ] `rooms/` path configurable in `appsettings.json`
- [ ] `dotnet build` → 0 errors
