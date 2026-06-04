# EstimationStation — Feature Plan v6.0

> **Stack:** ASP.NET Core 10 / C# / SignalR / Bootstrap 5 / Vanilla JS  
> **Created:** 2026-05-18  
> **Updated:** 2026-05-19  
> **Shipped in v5.0:** Groups T, U, V, W, X, Y, Z, AA, FX, O, P, Q, C, F, N, AC, AD, AE (partial), AF, AG, AH  

Carries forward all unimplemented items from v5.0. Completed groups have been moved to the [Done table](#done---completed-v3-through-v50).

---

## Priority Table

| # | Group | Feature | Effort | Status |
|---|-------|---------|--------|--------|
| 1 | [AM](./plans/FEATURE-PLAN-6.0-AM.md) | 🎛️ Fully-customizable event system — add/remove/edit events & animations, action-name based, save/load, reset, override-not-delete defaults | Hard | ⏳ **Next up** |
| — | [AN](./plans/FEATURE-PLAN-6.0-AN.md) | 🏷️ Terminology rename — "Events" tab → **Fun**, "Seasons" tab → **Events** | Small | ✅ Done |
| — | [AL](./plans/FEATURE-PLAN-6.0-AL.md) | 🚩 Local flag pack (~250, MIT) + country dropdown, no CDN | Medium | ✅ Done |
| 2 | [AJ](./plans/FEATURE-PLAN-6.0-AJ.md) | 🃏 Additional Card Animations — explode, tardis, hide, run-away, fly-away | Hard | ⏳ Pending |
| 3 | [AK2](./plans/FEATURE-PLAN-6.0-AK.md) | ✋ Story drag-reorder + drag-handle cursor (unblocks deferred AK2) | Medium | ⏳ Pending |
| 4 | [AE](./plans/FEATURE-PLAN-6.0-AE.md) | 🪟 Widget Panel System (rest of AE) | Hard | ⏳ Pending |
| 5 | [AI](./plans/FEATURE-PLAN-6.0-AI.md) | 🕐 Custom Clock Face — background colour, custom hands, number style, digital font/12h–24h | Hard | ⏳ Pending |
| — | [AB](./plans/FEATURE-PLAN-6.0-AB.md) | ✂️ Image Upload with Crop/Pan/Zoom — shared crop dialog for avatars, card backs, season sprites | Hard | ⏸ Deferred |
| — | [J](./plans/FEATURE-PLAN-6.0-J.md) | 📱 Mobile Experience — stories bottom sheet, vote tap targets, lite mode | Medium-Hard | ⏸ Deferred |
| — | [K](./plans/FEATURE-PLAN-6.0-K.md) | 💾 Room Persistence — JSON file per room, survive server restart, 7-day TTL | Hard | ⏸ Deferred |
| — | [AK](./plans/FEATURE-PLAN-6.0-AK.md) | 🔧 UX Polish Backlog — AK1/AK3/AK4/AK5/AK6 done (AK2 split out as #3 above) | Medium | 🟡 Mostly done |

---

## Done — Completed v3 through v5.0

| Group | Feature | Version |
|-------|---------|---------|
| **AE11a** | 🚩 Generic flag image support in seasonal animations — `flagUrl`/`flagFirst` meta fields; `_seaFlagHtml` builder; per-animation **Flag URL** input; users can swap US flag for any country (flagcdn.com) | v6 / 2026-06-04 |
| **AH** | 🔧 Bug Sweep + UI Polish — animation tests use live values; clock bar × hides correctly; clock preview on home page; Events tab chevron standardised; ↺ Change hint on vote card; card flip on vote; unified emoji input-group with picker; nowrap settings fields; separate timer/clock × buttons; reactions panel ×; avatar bg for all sources; real badge/card specimens in theme preview; DiceBear tile visibility | v5 / 2026-05-18 |
| **AG** | ⚙️ Settings Safety + Reaction Preview — `saveTimerClockSettings` and `_tcToggleMode` moved to site.js; `_acOnTimerEnabled` hook in room.js; live reaction palette preview | v5 / 2026-05-18 |
| **AF** | 🗓️ Seasonal Dates + Animation + Clock Fixes — `:scope>` selector fix; Thanksgiving/Pancake/Aug Bank/Mid-Autumn/Holi next dates; alias crash fix; custom emoji picker; live test values; analog SVG class IDs; sessionStorage × button; clock preview tick interval; draggable settings modal | v5 / 2026-05-18 |
| **AE** | 🪟 AE1–AE7 — seasons save updates status bar; flip test on vote picker; celebration booleans default OFF; all 22 custom animations configurable; clock inline in story bar; panel × close buttons; count-up timer + analog clock full settings | v5 / 2026-05-18 |
| **AD** | 👑 Host Lock + Settings Lock + Participant Messaging — host tracking, 4 lock modes, setup prompt, room-setting tags, context menu | v5 / 2026-05-18 |
| **FX** | 🛠️ Variable season next-dates; popup/corner/alias META promotions; test buttons; Visual tab real poker-card HTML; card backs in Visual tab; settings search; accent section headers; story note layout; sidebar narrow mode; resize grip; Star Wars crawl configurable; emoji picker expanded; arrow navigation; vibe deselect | v5 |
| **AA** | 🌸 Active season status bar; next-occurrence dates; Star Wars crawl; configurable runner motionStyles; per-animation test buttons; frequency sliders; Export/Import JSON; emoji picker on season inputs | v5 |
| **Z** | ⚙️ Settings search; bulk on/off/reset per tab; global export/import | v5 |
| **Y** | 🃏 Separate participant back vs vote card back; 5 new back styles; image import; flip test; speed slider | v5 |
| **X** | 🔄 Flip on vote cast; ↺ Change hint on re-vote hover | v5 |
| **W** | 🖼️ Visual Settings tab; live preview; compact mode; confidence prompt toggle | v5 |
| **V** | ↔️ Sidebar drag-resize; narrow mode text truncation; title tooltips on overflow | v5 |
| **U** | ✨ Title attrs; story notes below title; Accept/Override clarity; label renames; Events collapsible | v5 |
| **T** | 🐛 Voice InvalidStateError + toggle; awards "Unknown" fallback; shark direction; lava test stop/settings | v5 |
| **AC** | ⏱️ Count-up timer + live clock; timezone; digital/analog; full colour/size customisation | v5 |
| **P** | ⌨️ Keyboard shortcuts (1–9, C, Q, −, arrows); shortcut legend; emoji reaction bar | v4 |
| **O** | 🎨 Emoji picker; particle shape + custom emoji; flip speed slider; card font size; compact mode | v4 |
| **N** | 🗂️ Audio tab; Other tab; reveal ordering; collapsible sections; sound join dialog | v4 |
| **Q** | 🔔 Vote cast tick; desktop notification on reveal | v4 |
| **F** | 🔒 Room PIN UI — join tab collapsible; session PIN storage; prompt on PIN_REQUIRED; badge sync; set/clear from room | v4 |
| **C** | 📊 Sprint dashboard — running total, sparkline, historical velocity chart | v4 |
| **A–M** | v3.0 groups — suspense reveal, voice bars, poker reveal, speed badges, hot/cold, vote distribution, avatar system, seasonal animations, card reveal particles, audio broadcast, soundboard, floor is lava, discussion timer, shame spotlight, avatar battle, etc. | v3 |

---

## Won't Do / Permanently Deferred

| Feature | Reason |
|---------|--------|
| 🔮 Oracle Prediction | Adds a pre-reveal waiting phase that disrupts flow for quick sessions. Shelved twice. |
| 😈 Devil's Advocate Role | Requires server-side secret state per participant, complicates shame/outlier logic, can feel unfair. Shelved twice. |
| 📋 Copy Estimates to Clipboard | Superseded by Jira write-back (Group H). |
| 🔵 Azure DevOps / Linear Import | Technically straightforward but target user base is Jira-first. Revisit if demand emerges. |
| 🌡️ Re-vote Nudge Banner | Hot/cold meter and stats bar already provide sufficient signal. Extra banner is noise. |
| 🐉 Boss Fight Arena | High complexity, procedural art, HP tracking. Scope dwarfs value for a planning tool. |
| 🔄 Auto-reveal as Personal Preference | `ToggleAutoReveal` has no host check — personal override creates divergent room state. |
| ⚙️ Move JS Timings to appsettings.json | Client animation timings belong in JS/localStorage where users can tune them via settings UI. |
| 📐 Range Voting (min/max) | Breaking API change to `CastVote` and all downstream handlers. Consensus on a range is harder to act on. |
| 🗂️ Jira On-Premise / Data Center | Different auth (OAuth 2.0, Kerberos). Scope creep. Jira Cloud covers target users. |
