# AQ — Room Visualization (Table View → 3D Room → Virtual Space)

> **Priority:** Future roadmap  
> **Effort:** Hard → Very Hard (phased)  
> **Files:** `wwwroot/js/`, `wwwroot/css/`, `Views/Room/Index.cshtml`, `Hubs/PokerHub.cs`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

Inspiration: Kumospace, Around, SpatialChat — but purpose-built for planning poker.  
Phased from a simple 2D seating map all the way to a fully customizable virtual room.

---

## AQ1 — 2D Top-Down Table View

A simple bird's-eye SVG/Canvas rendering of a meeting table with seats around it.

- Each seat shows the participant's avatar + name badge.
- Voted / not-voted / revealed state reflected visually (card face-down on table, revealed face-up).
- Table shape configurable: round, rectangular, boardroom.
- Replaces or supplements the current flat participant badge grid.
- Responsive — collapses back to badge grid on narrow screens.
- No seating choice required at this phase; seats auto-assigned in join order.

**Effort:** Medium. Pure CSS/SVG, no 3D engine.

**Files:** `wwwroot/js/room.js` (new `renderTableView()`), `wwwroot/css/site.css`, `Views/Room/Index.cshtml`.

---

## AQ2 — Choose Your Seat on Entry

- Room join flow presents a top-down table view; user clicks an empty chair to claim their seat.
- Seat assignment broadcast via SignalR (`SeatClaimed`, `SeatReleased`).
- Seat assignments persisted to room state (survive reconnect within the session).
- Visual: claimed seat shows avatar immediately; clicking an occupied seat is a no-op.
- Host can reassign or free a seat via context menu.

**Effort:** Medium. Extends AQ1 with a SignalR seat-claim protocol.

---

## AQ3 — 3D Room with Chairs & Avatars

Upgrade from 2D to an isometric or perspective 3D room view rendered in Canvas / Three.js (lightweight, lazy-loaded).

- Each seat is a 3D chair; participants' avatars sit in their chair.
- Simple idle animation: head bob, wave on vote cast.
- Camera can be tilted / rotated by the viewer (personal preference, not broadcast).
- Vote state shown as a card held face-down → flipped face-up on reveal.
- Room style: "office", "lounge", "outdoor terrace" as initial presets.

**Effort:** Hard. Requires a 3D rendering strategy decision (Three.js vs CSS 3D transforms vs an isometric grid).

**Open question:** Use Three.js (adds ~600 KB gzipped) vs a pure CSS isometric grid (no JS payload, limited fidelity).

---

## AQ4 — Room Customization

Host (and collaborators) can modify the virtual room:

| Element | Options |
|---|---|
| **Table** | Shape (round/rect/boardroom), material (wood, glass, marble), size |
| **Chairs** | Style (office, armchair, bean bag, director's chair) |
| **Walls** | Colour, wallpaper pattern |
| **Floor** | Carpet, wood, tile, concrete |
| **Lighting** | Time of day (warm/cool/neon) |
| **Accessories** | Coffee station, whiteboard (see AQ5), plants, bookshelf |

Changes broadcast in real-time. Saved to room state.

---

## AQ5 — Shared Whiteboard

An in-room whiteboard element that any participant can draw on.

- Freehand draw, shapes, sticky notes, text.
- Real-time sync via SignalR (delta stroke broadcast, not full redraw).
- Export as PNG.
- Can be toggled visible / hidden by the host.
- Used during discussion phase to sketch out acceptance criteria, diagrams, etc.

**Effort:** Hard. Collaborative drawing sync is non-trivial at low latency. Consider using a CRDT or operational-transform approach for stroke merging.

---

## AQ6 — Window Views

The virtual room has one or more windows. Each window shows a configurable scene:

| View | Description |
|---|---|
| 🏖️ Beach | Animated ocean, sand, palm trees; time of day follows local clock |
| 🌆 City skyline | Configurable city (New York, London, Tokyo, generic); day/night cycle |
| 🌲 Forest | Trees, birds, rain/sun toggle |
| 🌌 Space | Stars, slow parallax nebula |
| ❄️ Mountain | Snow, pine trees, aurora option |
| 🎨 Custom | Upload a static image or animated GIF as the view |

All views use CSS animations (no video); weather/time syncs to the participant's local clock by default (can be pinned to a specific time).

**Effort:** Medium per view once the window-frame infrastructure is in place.

---

## Phasing Recommendation

| Phase | Groups | Prerequisite |
|---|---|---|
| 1 | AQ1 (2D table) | None — can ship any time |
| 2 | AQ2 (seat choice) | AQ1 |
| 3 | AQ3 (3D room) | AQ1/AQ2; decide on 3D engine |
| 4 | AQ4 (room customization) | AQ3 |
| 5 | AQ5 (whiteboard) | AQ3 (needs the room rendering layer) |
| 6 | AQ6 (window views) | AQ4 |

AQ1 and AQ2 are the most immediately deliverable and add visible value with low risk.
AQ3+ is a significant investment — evaluate after AQ2 ships and users respond.

---

## Verification (AQ1/AQ2)

- [ ] Table view renders all participants in seats around a configurable table shape
- [ ] Voted/revealed state shown visually on the table
- [ ] Join flow presents seat picker; seat claimed atomically
- [ ] Seat persists across reconnect within session
- [ ] Collapses to badge grid on narrow screens
- [ ] `dotnet build` → 0 errors
