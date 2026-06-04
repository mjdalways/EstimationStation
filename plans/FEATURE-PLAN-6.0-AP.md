# AP — Room Identity & Custom Icon

> **Priority:** Future roadmap  
> **Effort:** Medium  
> **Files:** Server (RoomService, PokerHub), `wwwroot/`, `Views/`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

---

## Vision

Each room gets a visual identity — a custom icon shown in the navbar, lobby, browser tab, and invite links.
Two paths to an icon:

1. **Upload** — host uploads an image (PNG/SVG/JPG ≤ 200 KB); crops via the AB crop dialog.
2. **Collaborate** — team designs one together in-session (see AP2 below).

---

## AP1 — Upload / Choose Room Icon

- Host uploads an image in the Room Settings or via a dedicated "Room icon" button in the navbar.
- Stored server-side per room (base64 in room JSON or a `/rooms/{name}/icon` file).
- Shown in:
  - Navbar beside the room name.
  - Lobby room-join cards (if we add a room browser).
  - Browser `<title>` favicon (injected as a `<link rel="icon">` blob URL).
  - Invite link previews (Open Graph `og:image`).
- Falls back to the EstimationStation logo when no icon is set.
- Built-in icon picker: a curated set of ~20 SVG glyphs (🃏 poker chip, 🚀 rocket, 🎯 target, 🧠 brain, ☕ coffee, 🌊 wave, 🎲 dice, 🏆 trophy, etc.) so teams can pick one without uploading.

**Files:** `Hubs/PokerHub.cs` (`SetRoomIcon`), `Services/RoomService.cs`, `wwwroot/js/room.js`, `Views/Room/Index.cshtml`, `Views/Shared/_Layout.cshtml`

---

## AP2 — Collaborative Icon Designer (Stretch)

A simple shared pixel-art / emoji-grid canvas where any participant can add/move/remove emoji tiles to compose the icon in real-time. Think a 8×8 or 12×12 grid where each cell can hold one emoji or a solid colour.

- Host opens the icon designer modal; all participants see the live canvas via SignalR.
- Cells can be painted with the emoji picker or a colour swatch.
- "Lock" button (host only) freezes the canvas and adopts it as the room icon.
- Export as SVG for re-use.

This is deliberately simple — no vector tools, no layers. The point is the shared creative moment.

**Additional files:** new SignalR messages (`IconCellUpdated`, `IconLocked`); a small canvas component in `room.js`.

---

## Open Questions

- Where is the icon stored long-term? Options: in the room JSON (base64, ~50 KB limit), a separate `/wwwroot/uploads/rooms/` folder, or an in-memory cache only for the session.
- Should the icon survive a server restart? (Depends on Group K Room Persistence being done first for true durability.)
- Copyright: uploaded images — should we strip EXIF metadata on the server before storage?

---

## Verification

- [ ] Host can upload an image and see it in the navbar immediately
- [ ] Built-in icon picker works with no upload
- [ ] Icon shown as favicon in browser tab
- [ ] AP2: two participants can paint cells; changes sync in real-time
- [ ] AP2: host can lock the canvas and adopt it as the room icon
- [ ] `dotnet build` → 0 errors
