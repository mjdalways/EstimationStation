# EstimationStation — Feature Implementation Plan

**Date**: 2026-05-10  
**Branch**: `claude/plan-consensus-features-RNEKZ`  
**Stack**: ASP.NET Core 10 / C#, SignalR, Bootstrap 5, Vanilla JS, CSS Variables

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Settings System — New "Behavior" Tab](#2-settings-system--new-behavior-tab)
3. [Feature 1: Shame](#3-feature-1-shame)
4. [Feature 2: User Avatars](#4-feature-2-user-avatars)
5. [Feature 3: Avatar Battle](#5-feature-3-avatar-battle)
6. [Tech Weapons Arsenal](#6-tech-weapons-arsenal)
7. [Open Source Attribution](#7-open-source-attribution)
8. [Complete File Manifest](#8-complete-file-manifest)
9. [Implementation Order](#9-implementation-order)

---

## 1. Architecture Overview

### Existing Stack (Unchanged)

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10, C#, SignalR (`PokerHub.cs`) |
| Storage | In-memory `ConcurrentDictionary` in `RoomService.cs` — no database |
| Frontend | Vanilla JS + jQuery, Bootstrap 5 |
| Real-time | SignalR groups per room |
| Theming | CSS custom properties (`--var-name`), 11 base themes + custom editor |
| Celebrations | `canvas-confetti` + `fireworks-js` (CDN), managed by `celebration.js` |
| Libraries | All vendored in `wwwroot/lib/` — **no npm, no bundler** |

### New JS Files (Pattern: mirrors `celebration.js`)

Each new feature gets its own self-contained JS file with:
- `DEFAULT_X` constant — all default values
- `getXSettings()` — reads localStorage, merges with defaults
- `saveXSettings(s)` — persists to localStorage as JSON
- `populateXTab()` — populates settings form from stored values
- `saveXFromForm()` — reads form DOM → calls `saveXSettings()`
- `testX()` — fires the effect with fake data for preview
- `resetXSettings()` — restores defaults

### New localStorage Keys

| Key | Feature | Type |
|---|---|---|
| `es_postRevealBehavior` | Master behavior toggles | Object |
| `es_shameSettings` | Shame configuration | Object |
| `es_battleSettings` | Battle configuration | Object |
| `es_avatarSettings` | Avatar preferences | Object |

### Established Keys (Unchanged)

| Key | Purpose |
|---|---|
| `es_theme` | Active theme name |
| `es_customThemes` | Custom theme definitions |
| `es_playerName` | Remembered player name |
| `es_recentRooms` | Last 5 rooms |
| `es_celebrationSettings` | Celebration effect config |

### Script Include Order (Updated `_Layout.cshtml`)

```html
<!-- Existing -->
<script src="~/lib/jquery/dist/jquery.min.js"></script>
<script src="~/lib/bootstrap/dist/js/bootstrap.bundle.min.js"></script>
<script src="~/lib/signalr/signalr.min.js"></script>

<!-- New: Avatar libraries (vendored UMD builds) -->
<script src="~/lib/dicebear/core.umd.min.js"></script>
<script src="~/lib/dicebear/collection.umd.min.js"></script>
<script src="~/lib/boring-avatars/boring-avatars.umd.min.js"></script>

<script src="~/js/site.js" asp-append-version="true"></script>

<!-- Existing CDN celebrations -->
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1/dist/confetti.browser.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/fireworks-js@2/dist/index.umd.js"></script>

<!-- New feature scripts -->
<script src="~/js/celebration.js" asp-append-version="true"></script>
<script src="~/js/avatar.js" asp-append-version="true"></script>
<script src="~/js/shame.js" asp-append-version="true"></script>
<script src="~/js/battle.js" asp-append-version="true"></script>

@await RenderSectionAsync("Scripts", required: false)
```

---

## 2. Settings System — New "Behavior" Tab

### New Tab in Existing Settings Modal

Add a fifth tab to `settingsTabs` Bootstrap nav in `_Layout.cshtml`:

```html
<!-- Tab button (alongside theme, celebration, profile, about) -->
<li class="nav-item" role="presentation">
  <button class="nav-link" id="tab-behavior-btn" data-bs-toggle="tab"
          data-bs-target="#tab-behavior" type="button" role="tab">
    🎭 Behavior
  </button>
</li>

<!-- Tab pane -->
<div class="tab-pane fade" id="tab-behavior" role="tabpanel">
  <!-- See full HTML spec below -->
</div>
```

### Behavior Tab HTML Structure

```
🎭 Post-Reveal Behavior
════════════════════════════════════════════════════════

🎉 After Consensus
  [✓] Enable celebration effects          ← master toggle (mirrors celebration tab)
  [▶ Configure Celebration]               ← scroll to / open celebration tab

────────────────────────────────────────────────────────

😤 After Single Outlier
  [✓] Enable shame animation

  ▼ Shame Configuration (collapsible)
    Animation style:    [● Pulse] [○ Shake] [○ Spotlight]
    Duration:           [━━━●━━━] 6s
    Shame color:        [████] #ff4444
    Floating emojis:    [✓]
    Emoji set:          [🥲][👎][😤][💀]   (toggleable chips)
    Custom emojis:      [_______________________]
    BOO! font size:     [━━●━━━━] 48px
    Positive message:   [But wait... maybe you're onto something. State your case!]
    Transition delay:   [━━●━━━━] 3s
    [Test Shame ▶]  [Reset to Defaults]

────────────────────────────────────────────────────────

⚔️ After Disagreement
  [✓] Enable battle animation

  ▼ Battle Configuration (collapsible)
    (see §5 for full battle config UI)
    [Test Battle ▶]  [Reset to Defaults]

────────────────────────────────────────────────────────

⚖️ Priority Rules
  When exactly 1 outlier exists:
    [● Shame only]  [○ Battle only]  [○ Both (shame then battle)]
  Minimum voters to trigger battle: [━●━━━━] 3
  Show skip button on all overlays: [✓]
  Skip button label: [Skip ▶_______]

[Save Behavior Settings]
```

### `es_postRevealBehavior` Schema

```javascript
{
  celebrationEnabled: true,
  shameEnabled: true,
  battleEnabled: true,
  outlierBehavior: 'shame-only',   // 'shame-only' | 'battle-only' | 'both'
  minVotersForBattle: 3,
  showSkip: true,
  skipLabel: 'Skip ▶'
}
```

### Dispatch Logic in `room.js` (`VotesRevealed` handler)

```javascript
connection.on('VotesRevealed', (votes, stats) => {
    // ... existing: render participant badges, show stats panel ...

    const beh = getPostRevealBehavior();

    if (stats.isConsensus) {
        if (beh.celebrationEnabled) triggerCelebration();
        return;
    }

    const groups = buildVoteGroups(roomState.participants, votes);
    const hasOutlier  = !!stats.shameParticipantId;
    const hasBattle   = groups.length >= 2 && totalVoters(groups) >= beh.minVotersForBattle;

    if (hasOutlier && beh.shameEnabled &&
        (beh.outlierBehavior === 'shame-only' || beh.outlierBehavior === 'both')) {
        triggerShame(stats.shameParticipantName, stats.shameParticipantId);
    }

    const shameBlocksBattle = hasOutlier && beh.outlierBehavior === 'shame-only';
    if (hasBattle && beh.battleEnabled && !shameBlocksBattle) {
        triggerBattle(groups);
    }
});
```

---

## 3. Feature 1: Shame

### Trigger Condition

After votes are revealed: **exactly one participant voted a different numeric value from all others** (n−1 voters agree on value X; 1 voter chose value Y). Non-numeric votes (`?`, `☕`) are excluded from the outlier check, same as from averaging.

### 3.1 Backend — `PokerModels.cs`

Add to the stats return object (anonymous type or named class):

```csharp
public class VoteStats
{
    public double? Average { get; set; }
    public string? Min { get; set; }
    public string? Max { get; set; }
    public bool IsConsensus { get; set; }
    public string? ShameParticipantName { get; set; }
    public string? ShameParticipantId { get; set; }   // SignalR ConnectionId
}
```

### 3.2 Backend — `PokerHub.cs` — `CalculateStats()`

After the existing consensus check, append:

```csharp
// Single-outlier detection
if (!stats.IsConsensus && numericVotes.Count >= 2)
{
    var groups = numericVotes
        .GroupBy(kvp => kvp.Value)
        .OrderByDescending(g => g.Count())
        .ToList();

    if (groups.Count == 2 && groups[1].Count() == 1)
    {
        var outlierId = groups[1].First().Key;   // ConnectionId
        var outlier   = room.Participants
            .FirstOrDefault(p => p.ConnectionId == outlierId);
        if (outlier != null)
        {
            stats.ShameParticipantName = outlier.Name;
            stats.ShameParticipantId   = outlierId;
        }
    }
}
```

### 3.3 New File — `wwwroot/js/shame.js`

```javascript
const DEFAULT_SHAME = {
    animationStyle:  'pulse',    // 'pulse' | 'shake' | 'spotlight'
    duration:        6000,       // ms total
    shameColor:      '#ff4444',
    floatingEmojis:  true,
    emojis:          ['🥲', '👎', '😤'],
    booFontSize:     48,         // px
    positiveMessage: "But wait... maybe you're onto something. 🤔 State your case!",
    transitionDelay: 3000        // ms before positive message appears
};

function getShameSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem('es_shameSettings') || '{}');
        return Object.assign({}, DEFAULT_SHAME, stored);
    } catch { return { ...DEFAULT_SHAME }; }
}

function saveShameSettings(s) {
    localStorage.setItem('es_shameSettings', JSON.stringify(s));
}

function triggerShame(participantName, participantId) {
    const s = getShameSettings();

    // 1. Apply highlight class to the participant's badge
    const badge = document.querySelector(`[data-participant-id="${participantId}"]`);
    if (badge) {
        badge.style.setProperty('--shame-color', s.shameColor);
        badge.classList.add('shame-highlight');
        badge.dataset.style = s.animationStyle;

        if (s.animationStyle === 'spotlight') {
            const backdrop = document.createElement('div');
            backdrop.className = 'shame-backdrop';
            document.body.appendChild(backdrop);
        }
    }

    // 2. Spawn floating emojis
    if (s.floatingEmojis) {
        const rect = badge?.getBoundingClientRect();
        const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const y = rect ? rect.top : window.innerHeight / 2;

        for (let i = 0; i < 6; i++) {
            setTimeout(() => spawnBooEmoji(s, x, y), i * 220);
        }
    }

    // 3. Show shame toast
    showShameToast(participantName, s);

    // 4. Clean up after duration
    setTimeout(() => cleanupShame(badge), s.duration);
}

function spawnBooEmoji(s, cx, cy) {
    const el = document.createElement('div');
    el.className = 'boo-emoji';
    el.style.fontSize = s.booFontSize + 'px';
    el.style.left = (cx + (Math.random() - 0.5) * 80) + 'px';
    el.style.top  = cy + 'px';
    el.textContent = s.emojis[Math.floor(Math.random() * s.emojis.length)];
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

function showShameToast(name, s) {
    const toast = document.createElement('div');
    toast.className = 'shame-toast';
    toast.innerHTML = `
        <div class="shame-name">👀 ${escapeHtml(name)} went rogue!</div>
        <div class="shame-boo">BOO! 😤 Everyone else agreed...</div>
        <div class="shame-positive" style="display:none">${escapeHtml(s.positiveMessage)}</div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.querySelector('.shame-boo').style.display = 'none';
        toast.querySelector('.shame-positive').style.display = 'block';
    }, s.transitionDelay);

    setTimeout(() => toast.remove(), s.duration);
}

function cleanupShame(badge) {
    if (badge) {
        badge.classList.remove('shame-highlight');
        badge.style.removeProperty('--shame-color');
    }
    document.querySelector('.shame-backdrop')?.remove();
}

function populateShameTab() { /* read getShameSettings(), set form field values */ }
function saveShameFromForm() { /* read form DOM → saveShameSettings() */ }
function testShame()         { triggerShame('TestUser', null); }
function resetShameSettings(){ saveShameSettings({ ...DEFAULT_SHAME }); populateShameTab(); }
```

### 3.4 New File — `wwwroot/css/shame.css`

```css
:root {
    --shame-color: #ff4444;
    --shame-font-size: 48px;
}

/* ── Highlight animations ─────────────────────────── */
@keyframes shame-pulse {
    0%,100% { box-shadow: 0 0 0 0 var(--shame-color); }
    50%      { box-shadow: 0 0 24px 12px color-mix(in srgb, var(--shame-color) 40%, transparent); }
}
@keyframes shame-shake {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-8px) rotate(-3deg); }
    40%     { transform: translateX(8px)  rotate(3deg); }
    60%     { transform: translateX(-5px) rotate(-2deg); }
    80%     { transform: translateX(5px)  rotate(2deg); }
}

.shame-highlight[data-style="pulse"] {
    animation: shame-pulse 0.6s infinite;
    outline: 3px solid var(--shame-color);
    border-radius: inherit;
}
.shame-highlight[data-style="shake"] {
    animation: shame-shake 0.5s infinite;
    outline: 3px solid var(--shame-color);
}
.shame-highlight[data-style="spotlight"] {
    position: relative;
    z-index: 200;
}

/* ── Backdrop (spotlight mode) ────────────────────── */
.shame-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 190;
    animation: fade-in 0.3s ease;
}

/* ── Floating emojis ──────────────────────────────── */
@keyframes boo-float {
    0%   { transform: translateY(0) scale(1);   opacity: 1; }
    100% { transform: translateY(-150px) scale(1.5); opacity: 0; }
}
.boo-emoji {
    position: fixed;
    font-size: var(--shame-font-size);
    animation: boo-float 1.8s ease-out forwards;
    pointer-events: none;
    z-index: 300;
    user-select: none;
}

/* ── Toast ────────────────────────────────────────── */
@keyframes shame-toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.shame-toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    color: #fff;
    border-left: 6px solid var(--shame-color);
    border-radius: 12px;
    padding: 20px 28px;
    max-width: 440px;
    width: 90vw;
    text-align: center;
    z-index: 310;
    animation: shame-toast-in 0.4s ease;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.shame-toast .shame-name     { font-size: 1.4rem; font-weight: bold; color: var(--shame-color); }
.shame-toast .shame-boo      { font-size: 1.1rem; margin-top: 8px; color: #ffaaaa; }
.shame-toast .shame-positive { font-size: 1rem;   margin-top: 10px; color: #88ff88;
                                animation: fade-in 0.5s ease; }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
```

---

## 4. Feature 2: User Avatars

### 4.1 Open Source Libraries — Sourcing & Licensing

| Library | License | Attribution | Styles | Source |
|---|---|---|---|---|
| **DiceBear Core** v9 | MIT | None required | — | npmjs.com/package/@dicebear/core |
| **DiceBear Collection** v9 | MIT / CC BY 4.0 per style | Varies by style | adventurer, bottts, croodles, fun-emoji, open-peeps, pixel-art, thumbs, micah | npmjs.com/package/@dicebear/collection |
| **Boring Avatars** v2 | MIT | None required | beam, marble, pixel, bauhaus, ring, sunset | npmjs.com/package/boring-avatars |

Since the project uses **no npm**, both libraries' UMD/IIFE builds are downloaded via `npm pack` (or from jsDelivr) and copied to:
- `wwwroot/lib/dicebear/core.umd.min.js`
- `wwwroot/lib/dicebear/collection.umd.min.js`
- `wwwroot/lib/boring-avatars/boring-avatars.umd.min.js`

**DiceBear style attribution** (add to About tab / credits file):

| Style | License | Credit |
|---|---|---|
| adventurer | CC BY 4.0 | Lisa Wischofsky |
| bottts | CC BY 4.0 | Pablo Stanley |
| croodles | CC BY 4.0 | Hannah Langford |
| fun-emoji | CC BY 4.0 | Davis Uche |
| open-peeps | CC0 | Pablo Stanley |
| pixel-art | CC BY 4.0 | Plastic Jam |
| thumbs | CC0 | DiceBear |
| micah | CC BY 4.0 | Micah Lanier |

### 4.2 Backend — `PokerModels.cs`

```csharp
public class Participant
{
    public string ConnectionId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Vote { get; set; }
    public bool IsObserver { get; set; }
    public string? AvatarData { get; set; }   // NEW — see format table below
}
```

### Avatar Data Format

| Source | `AvatarData` value | Example |
|---|---|---|
| Initials (default) | `null` or `"initials"` | — |
| DiceBear | `"dicebear:{style}:{seed}:{optionsJson}"` | `"dicebear:bottts:Alice:{}"` |
| Boring Avatar | `"boring:{style}:{seed}"` | `"boring:beam:John"` |
| Uploaded photo | `"data:image/jpeg;base64,{b64}"` | max 48 KB after resize |

### 4.3 Backend — `PokerHub.cs`

**New hub method:**

```csharp
public async Task UpdateAvatar(string avatarData)
{
    // Guard: uploaded images must be small enough for SignalR
    if (avatarData?.StartsWith("data:") == true && avatarData.Length > 65_536)
    {
        await Clients.Caller.SendAsync("Error", "Avatar image too large (max ~48 KB). Please resize.");
        return;
    }

    var roomName    = _roomService.GetRoomForConnection(Context.ConnectionId);
    var room        = _roomService.GetRoom(roomName);
    var participant = room?.Participants.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
    if (participant == null) return;

    participant.AvatarData = avatarData;

    await Clients.Group(roomName).SendAsync("AvatarUpdated", Context.ConnectionId, avatarData);
}
```

**Include `AvatarData` in existing broadcasts:**

- `JoinRoom` → include `AvatarData` in participant payload sent via `RoomState` and `ParticipantJoined`
- `RoomState` event → each participant object includes `avatarData` field
- `ParticipantJoined` event → include `avatarData` field
- `NameUpdated` event → include `avatarData` field (name change doesn't reset avatar)

**Updated `JoinRoom` flow:**

```csharp
public async Task JoinRoom(string roomName, string userName, bool isObserver, string? avatarData = null)
{
    var participant = new Participant
    {
        ConnectionId = Context.ConnectionId,
        Name         = userName.Trim()[..Math.Min(userName.Trim().Length, 32)],
        IsObserver   = isObserver,
        AvatarData   = avatarData
    };
    // ... existing room join logic ...
}
```

### 4.4 New File — `wwwroot/js/avatar.js`

```javascript
const DICEBEAR_STYLES = [
    'adventurer', 'bottts', 'croodles', 'fun-emoji',
    'open-peeps', 'pixel-art', 'thumbs', 'micah'
];
const BORING_STYLES = ['beam', 'marble', 'pixel', 'bauhaus', 'ring', 'sunset'];

const DEFAULT_AVATAR = {
    source:          'initials',   // 'initials' | 'dicebear' | 'boring' | 'upload'
    dicebearStyle:   'bottts',
    dicebearSeed:    'name',       // 'name' | custom string
    dicebearOptions: {},
    boringStyle:     'beam',
    boringSeed:      'name'
};

function getAvatarSettings() {
    try {
        return Object.assign({}, DEFAULT_AVATAR,
            JSON.parse(localStorage.getItem('es_avatarSettings') || '{}'));
    } catch { return { ...DEFAULT_AVATAR }; }
}

function saveAvatarSettings(s) {
    localStorage.setItem('es_avatarSettings', JSON.stringify(s));
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderAvatar(avatarData, name, size = 48) {
    const wrapper = document.createElement('div');
    wrapper.className = 'avatar-wrapper';
    wrapper.style.setProperty('--av-size', size + 'px');

    if (!avatarData || avatarData === 'initials') {
        wrapper.innerHTML = `<div class="av-initials"
            style="background:${colorFromName(name)}">${getInitials(name)}</div>`;
    } else if (avatarData.startsWith('dicebear:')) {
        const svg = generateDiceBear(avatarData);
        wrapper.innerHTML = `<div class="av-image">${svg}</div>`;
    } else if (avatarData.startsWith('boring:')) {
        const svg = generateBoringAvatar(avatarData, size);
        wrapper.innerHTML = `<div class="av-image">${svg}</div>`;
    } else if (avatarData.startsWith('data:')) {
        wrapper.innerHTML = `<img class="av-image" src="${avatarData}" alt="${escapeHtml(name)}">`;
    }
    return wrapper;
}

function generateDiceBear(avatarDataStr) {
    const parts   = avatarDataStr.split(':');
    const style   = parts[1];
    const seed    = parts[2];
    const options = JSON.parse(parts.slice(3).join(':') || '{}');

    // Uses vendored DiceBear UMD globals: window.DiceBear, window.DiceBearCollection
    const styleModule = window.DiceBearCollection?.[style];
    if (!styleModule || !window.DiceBear) return generateInitialsFallback(seed);

    const avatar = window.DiceBear.createAvatar(styleModule, { seed, ...options });
    return avatar.toString();   // returns SVG string
}

function generateBoringAvatar(avatarDataStr, size) {
    const [, style, seed] = avatarDataStr.split(':');
    // Uses vendored Boring Avatars UMD: window.BoringAvatars
    if (!window.BoringAvatars) return generateInitialsFallback(seed);
    return window.BoringAvatars.toSvg({ name: seed, variant: style, size });
}

function generateInitialsFallback(name) {
    return `<div class="av-initials" style="background:${colorFromName(name)}">${getInitials(name)}</div>`;
}

function getInitials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromName(name) {
    let hash = 0;
    for (const ch of (name || '')) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

// ── Upload handling ─────────────────────────────────────────────────────────

function handleAvatarUpload(file, callback) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 128;
            const ctx = canvas.getContext('2d');
            // Cover-crop to square
            const side = Math.min(img.width, img.height);
            const ox = (img.width  - side) / 2;
            const oy = (img.height - side) / 2;
            ctx.drawImage(img, ox, oy, side, side, 0, 0, 128, 128);
            callback(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ── Settings UI helpers ─────────────────────────────────────────────────────

function populateAvatarTab()  { /* read getAvatarSettings(), populate form */ }
function saveAvatarFromForm() { /* read form DOM → saveAvatarSettings() → connection.invoke('UpdateAvatar', ...) */ }
function resetAvatarSettings(){ saveAvatarSettings({ ...DEFAULT_AVATAR }); populateAvatarTab(); }
```

### 4.5 Avatar Settings UI — Profile Tab Enhancement

The existing `tab-profile` tab gains an Avatar section after the name/observer fields:

```
── Avatar ────────────────────────────────────────────────────────

Source:
  [○ Initials]  [○ DiceBear]  [○ Boring Avatars]  [○ Upload Photo]

▼ DiceBear Options  (visible when DiceBear selected)
  Style:
  ┌──────────┬──────────┬──────────┬──────────┐
  │ 🤖 Bottts│ 🧙 Advent│ ✏️ Croodl│ 😊 Fun E │
  ├──────────┼──────────┼──────────┼──────────┤
  │ 🧍 Peeps │ 👾 Pixel │ 👍 Thumbs│ 🎨 Micah │
  └──────────┴──────────┴──────────┴──────────┘
  Seed:       [● My name]  [○ Custom: ___________]
  Background: [████] (color picker, optional)

▼ Boring Avatars Options  (visible when Boring selected)
  Style:
  [ beam ] [ marble ] [ pixel ] [ bauhaus ] [ ring ] [ sunset ]

▼ Upload Photo  (visible when Upload selected)
  [Choose File…]  Formats: JPG, PNG, GIF, WebP  Max: 2 MB
  ┌────────────────────────┐
  │    (preview circle)    │   128 × 128, cropped to circle
  └────────────────────────┘
  Note: Image is resized locally before transmission.

Live Preview:
  ┌────┐
  │ AV │  ← 64 px circle, updates as options change
  └────┘
  John D.

[Save Avatar]  [Reset to Initials]
```

### 4.6 New File — `wwwroot/css/avatar.css`

```css
/* ── Core avatar wrapper ──────────────────────────── */
.avatar-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.av-initials,
.av-image,
.av-image img,
.av-image svg {
    width:  var(--av-size, 48px);
    height: var(--av-size, 48px);
    border-radius: 50%;
    object-fit: cover;
    overflow: hidden;
    display: block;
}

.av-initials {
    font-weight: 700;
    color: #fff;
    font-size: calc(var(--av-size, 48px) * 0.38);
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
}

/* ── Vote-status rings ────────────────────────────── */
.avatar-wrapper.av-voted     { outline: 3px solid var(--accent);         outline-offset: 2px; }
.avatar-wrapper.av-not-voted { opacity: 0.5; }
.avatar-wrapper.av-observer  { outline: 3px dashed var(--text-secondary); outline-offset: 2px; }
.avatar-wrapper.av-me        { outline: 3px solid var(--btn-primary);     outline-offset: 2px; }

/* ── Library style picker grid ───────────────────── */
.avatar-style-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
}
.avatar-style-option {
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 6px;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s;
}
.avatar-style-option.selected,
.avatar-style-option:hover { border-color: var(--accent); }
.avatar-style-option img,
.avatar-style-option svg   { width: 48px; height: 48px; border-radius: 50%; }
.avatar-style-option small  { display: block; font-size: 0.7rem; margin-top: 4px; }
```

### 4.7 `room.js` Changes

**`renderParticipants()` update** — replace text-initial badges with `renderAvatar()`:

```javascript
function renderParticipants() {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';

    roomState.participants.forEach(p => {
        const card = document.createElement('div');
        card.className = 'participant-card';
        card.dataset.participantId = p.connectionId;

        const avatarEl = renderAvatar(p.avatarData, p.name, 48);
        // Apply vote-status ring
        if (p.isObserver)      avatarEl.classList.add('av-observer');
        else if (p.vote)       avatarEl.classList.add('av-voted');
        else                   avatarEl.classList.add('av-not-voted');
        if (p.connectionId === myConnectionId) avatarEl.classList.add('av-me');

        // ... existing name label, vote badge ...
        card.appendChild(avatarEl);
        container.appendChild(card);
    });
}
```

**New `AvatarUpdated` handler:**

```javascript
connection.on('AvatarUpdated', (connectionId, avatarData) => {
    const participant = roomState.participants.find(p => p.connectionId === connectionId);
    if (participant) {
        participant.avatarData = avatarData;
        renderParticipants();
    }
});
```

---

## 5. Feature 3: Avatar Battle

### 5.1 Trigger Condition

After votes are revealed: **2 or more distinct numeric vote values exist** among non-observer voters. Takes priority check from `es_postRevealBehavior.outlierBehavior` setting (see §2).

### 5.2 Vote Group Builder (`room.js`)

```javascript
function buildVoteGroups(participants, votes) {
    const groups = {};
    participants.forEach(p => {
        if (p.isObserver) return;
        const v = votes[p.connectionId];
        if (v) {
            if (!groups[v]) groups[v] = [];
            groups[v].push(p);
        }
    });
    // Sort descending by group size; [['5', [p1,p2]], ['8', [p3]], ...]
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

function totalVoters(groups) {
    return groups.reduce((sum, [, members]) => sum + members.length, 0);
}
```

### 5.3 Animation Sequence

| Phase | Default Duration | What Happens |
|---|---|---|
| **Lineup** | 0 – 1.5s | Dark arena overlay fades in; participant avatars + arms slide in from left/right grouped by vote value |
| **Taunt** | 1.5 – 3s | Speech bubble shows each team's vote value; avatars lean toward center; arms raise |
| **Clash** | 3 – 8s | 2–3 clash cycles: teams rush center, fight cloud pops with hit word, teams bounce back |
| **Aftermath** | 8 – 11s | Arms droop, avatars tilt, battered filter applied, stars orbit heads |
| **Resolution** | 11 – 14s | Arena dims; resolution text fades in line by line |
| **Auto-dismiss** | 14s+ | Overlay fades out (or immediately on skip button click) |

**Speed multipliers** (applied to all phase durations):

| Speed Setting | Multiplier |
|---|---|
| Slow | 1.5× |
| Normal | 1.0× |
| Fast | 0.65× |

### 5.4 Arena DOM Structure

```html
<div id="battle-arena" class="battle-arena-overlay">

  <div class="battle-stage">
    <!-- Left team(s) -->
    <div class="battle-team team-left" data-vote="5">
      <div class="team-vote-label">5</div>
      <div class="team-fighters">
        <!-- One .fighter div per participant, avatar + arms -->
      </div>
    </div>

    <!-- Fight zone (center) -->
    <div class="fight-zone">
      <div class="fight-cloud">💥</div>
      <span class="hit-text"></span>
    </div>

    <!-- Right team(s) -->
    <div class="battle-team team-right" data-vote="13">
      <div class="team-vote-label">13</div>
      <div class="team-fighters">
        <!-- fighters -->
      </div>
    </div>
  </div>

  <!-- Resolution text (hidden until aftermath) -->
  <div class="battle-resolution" style="display:none">
    <p class="battle-headline"></p>
    <p class="battle-cta"></p>
  </div>

  <button class="btn-skip-battle" onclick="dismissBattle()">Skip ▶</button>
</div>
```

**Fighter element structure:**

```html
<div class="fighter" data-connection-id="...">
  <div class="fighter-avatar-wrap">
    <!-- renderAvatar() output here -->
    <!-- Arms appended by attachArms() -->
  </div>
  <div class="fighter-name">Alice</div>
</div>
```

### 5.5 Multi-Team Battle (3+ Vote Values)

**Round-robin mode** (default):
- Round 1: Group A vs Group B
- Round 2: Survivors vs Group C (each round 70% duration of prior)
- All battered fighters accumulate on screen as rounds progress

**Free-for-all mode**:
- All groups appear in a horizontal strip
- Fight clouds appear between every adjacent pair simultaneously
- Faster, more chaotic — good for 4+ groups

Configured via `es_battleSettings.battleStyle`.

### 5.6 Battle Configuration UI (within Behavior tab)

```
⚔️ Battle Configuration
────────────────────────────────────────

Animation
  Style:         [● Round-robin]  [○ Free-for-all]
  Speed:         [○ Slow] [● Normal] [○ Fast]
  Total duration:[━━━●━━] 12s

Fight Words  (editable chips, click × to remove, + to add)
  [POW!×] [WHAM!×] [BAM!×] [ZAP!×] [KABLAM!×] [CRUNCH!×] [SMASH!×]
  [+ Add word]

Appearance
  Team A color:       [████] #4488cc
  Team B color:       [████] #cc4444
  Team C color:       [████] #44cc44
  Fight cloud color:  [████] rgba(255,200,50,0.9)
  Arena background:   [████] rgba(0,0,0,0.85)
  Arena blur:         [✓]  backdrop-filter: blur(4px) on page content

Arms & Weapons
  Weapon style:
  ┌──────────┬──────────┬──────────┬──────────┐
  │🗡️ Sword  │🏏 Stick  │ ✊ Fist  │✏️ Pencil │
  ├──────────┼──────────┼──────────┼──────────┤
  │🪄 Wand   │🍞 Toast  │⌨️ Keyboard│🖥️ Monitor│
  ├──────────┼──────────┼──────────┼──────────┤
  │🖱️🖱️Nunchk│🖱️ Flail │💳 Card   │🧾 POS    │
  ├──────────┼──────────┼──────────┼──────────┤
  │🔌 USB    │🪢 Cable  │💾 Floppy │🎲 Random │
  └──────────┴──────────┴──────────┴──────────┘
  Per-fighter weapon: [✓] Each fighter uses their preferred weapon (set in profile)

  Arm skin tone:       [████] #f4c08a  [6 preset swatches]
  Arm sleeve color:    [● Follows team color]  [○ Custom: ████]

Aftermath
  Battered filter:     [✓]  (desaturate + tilt)
  Orbiting stars:      [✓]
  Star count:          [━●━━━] 3

Resolution Text
  Line 1: [⚔️ A fierce battle of opinions!___________________]
  Line 2: [State your case — describe your reasoning._______]

Auto-skip after: [━━━●━] 14s    (0 = never auto-skip)

[Test Battle ▶]  [Reset to Defaults]
```

### 5.7 `es_battleSettings` Schema

```javascript
{
    battleStyle:          'round-robin',   // 'round-robin' | 'free-for-all'
    speed:                'normal',         // 'slow' | 'normal' | 'fast'
    totalDuration:        12000,
    hitWords:             ['POW!','WHAM!','BAM!','ZAP!','KABLAM!','CRUNCH!','SMASH!'],
    teamColors:           ['#4488cc','#cc4444','#44cc44','#cc44cc'],
    fightCloudColor:      'rgba(255,200,50,0.9)',
    arenaBackground:      'rgba(0,0,0,0.85)',
    arenaBlur:            true,
    weaponStyle:          'random',         // weapon key or 'random'
    perFighterWeapon:     false,
    armSkinTone:          '#f4c08a',
    armSleeveFollowsTeam: true,
    armSleeveColor:       '#4488cc',
    batteredFilter:       true,
    orbitingStars:        true,
    starCount:            3,
    resolutionLine1:      '⚔️ A fierce battle of opinions!',
    resolutionLine2:      'State your case — describe your reasoning and let\'s find common ground.',
    autoSkipMs:           14000             // 0 = never
}
```

### 5.8 Arm SVG — Construction with Actual Hands

The arm SVG is generated by `buildArmSVG(weaponKey, skinTone, sleeveColor)` and returned as an SVG element. ViewBox is `0 0 48 110`; `overflow="visible"` for wide weapons.

```svg
<!-- Base arm (all weapons share this body) -->
<svg class="fighter-arm" viewBox="0 0 48 110" width="48" height="110" overflow="visible">

  <!-- Sleeve / upper arm -->
  <rect x="14" y="0" width="20" height="45" rx="10"
        fill="var(--arm-sleeve, #4488cc)"/>

  <!-- Skin gap at elbow -->
  <rect x="16" y="38" width="16" height="14" rx="5"
        fill="var(--arm-skin, #f4c08a)"/>

  <!-- Forearm -->
  <rect x="15" y="50" width="18" height="36" rx="9"
        fill="var(--arm-skin, #f4c08a)"/>

  <!-- Wrist -->
  <ellipse cx="24" cy="87" rx="10" ry="7"
           fill="var(--arm-skin, #f4c08a)"/>

  <!-- Palm -->
  <rect x="16" y="84" width="20" height="16" rx="8"
        fill="var(--arm-skin, #f4c08a)"/>

  <!-- Knuckle row -->
  <circle cx="20" cy="84" r="5" fill="var(--arm-skin, #f4c08a)"/>
  <circle cx="27" cy="83" r="5" fill="var(--arm-skin, #f4c08a)"/>
  <circle cx="33" cy="84" r="4.5" fill="var(--arm-skin, #f4c08a)"/>

  <!-- Thumb -->
  <ellipse cx="14" cy="90" rx="5" ry="7"
           fill="var(--arm-skin, #f4c08a)" transform="rotate(-20 14 90)"/>

  <!-- Weapon slot — only one .weapon-active shown at a time -->
  <!-- See §6 for all weapon <g> elements -->

</svg>
```

**CSS positioning on fighter:**

```css
.fighter-arm {
    position: absolute;
    bottom: 4px;
    width: 48px;
    height: 110px;
}
.fighter-arm.arm-right {
    right: -52px;
    transform-origin: 24px 0;
}
.fighter-arm.arm-left {
    left: -52px;
    transform: scaleX(-1);
    transform-origin: 24px 0;
}
```

**Swing animations:**

```css
@keyframes arm-swing-ready {
    0%,100% { transform: rotate(-15deg); }
    50%     { transform: rotate(20deg); }
}
@keyframes arm-swing-ready-left {
    0%,100% { transform: scaleX(-1) rotate(-15deg); }
    50%     { transform: scaleX(-1) rotate(20deg); }
}
@keyframes arm-swing-attack {
    0%   { transform: rotate(-30deg); }
    40%  { transform: rotate(50deg); }
    60%  { transform: rotate(50deg); }
    100% { transform: rotate(-30deg); }
}
.arm-swinging.arm-right { animation: arm-swing-ready  0.7s ease-in-out infinite; }
.arm-swinging.arm-left  { animation: arm-swing-ready-left 0.7s ease-in-out infinite; }
.arm-attacking.arm-right { animation: arm-swing-attack 0.5s ease-in-out; }
```

---

## 6. Tech Weapons Arsenal

### Weapon Registry

```javascript
const WEAPON_REGISTRY = {
    // ── Classic weapons ────────────────────────────────────────
    sword:         { label: '🗡️ Sword',           hitWords: ['POW!','SLASH!','CLANG!'] },
    stick:         { label: '🏏 Stick/Club',       hitWords: ['THWACK!','BONK!','WHUMP!'] },
    fist:          { label: '✊ Fist',              hitWords: ['POW!','WHAM!','BAM!'] },
    pencil:        { label: '✏️ Pencil',            hitWords: ['SCRIBBLE!','DRAFT!','REVISE!'] },
    wand:          { label: '🪄 Magic Wand',        hitWords: ['ZAP!','KAPOW!','ALAKAZAM!'] },
    // ── Tech weapons ───────────────────────────────────────────
    toast:         { label: '🍞 Toast',             hitWords: ['CRUMBLE!','BUTTER!','TOASTED!'] },
    keyboard:      { label: '⌨️ Keyboard',          hitWords: ['CTRL+ALT+DEL!','SYNTAX ERROR!','BUFFER OVERFLOW!'] },
    monitor:       { label: '🖥️ Monitor',           hitWords: ['BSOD!','404!','KERNEL PANIC!'] },
    mouseNunchuk:  { label: '🖱️🖱️ Mouse Nunchuks', hitWords: ['DOUBLE CLICK!','RIGHT CLICK!','DRAG & DROP!'] },
    mouseFlail:    { label: '🖱️ Mouse Flail',       hitWords: ['SCROLL LOCK!','CAPS LOCK!','NUM LOCK!'] },
    creditCard:    { label: '💳 Credit Card',       hitWords: ['DECLINED!','INSUFFICIENT FUNDS!','CHARGEBACK!'] },
    posTerminal:   { label: '🧾 POS Terminal',      hitWords: ['PROCESSING...','AMOUNT: ∞','PIN REQUIRED!'] },
    usbDrive:      { label: '🔌 USB Drive',         hitWords: ['PLUG & PLAY!','NOT RECOGNIZED!','SAFELY REMOVE!'] },
    ethernetWhip:  { label: '🪢 Ethernet Whip',     hitWords: ['PACKET LOSS!','TIMEOUT!','PING: 9999ms'] },
    floppyShuriken:{ label: '💾 Floppy Disk',       hitWords: ['CORRUPTED!','DISK FULL!','SAVE ERROR!'] },
    random:        { label: '🎲 Random',            hitWords: [] }
};
```

### Weapon Hit Word Cycling

```javascript
function getNextHitWord(weaponKey, state) {
    const words = WEAPON_REGISTRY[weaponKey]?.hitWords;
    if (!words || words.length === 0) return 'POW!';
    state.hitWordIndex = (state.hitWordIndex || 0) % words.length;
    return words[state.hitWordIndex++];
}
```

---

### 6.1 Classic Weapons (Original Set)

#### 🗡️ Sword

```svg
<g class="weapon weapon-sword">
  <rect x="21" y="5"  width="6"  height="70" rx="3"  fill="#d0d0d0"/>
  <rect x="21" y="5"  width="6"  height="8"  rx="2"  fill="#bbb"/>
  <rect x="13" y="20" width="22" height="6"  rx="3"  fill="#8B4513"/>
  <rect x="20" y="26" width="8"  height="16" rx="4"  fill="#6B3410"/>
</g>
```

Attack: standard swing. Hit effect: sparks (3–4 small gold circles scatter).

#### 🏏 Stick / Club

```svg
<g class="weapon weapon-stick">
  <rect x="20" y="5"  width="8"  height="75" rx="4" fill="#8B5E3C"/>
  <ellipse cx="24" cy="5" rx="10" ry="7"          fill="#6B4423"/>
</g>
```

Attack: overhead cricket-bat swing. Hit effect: wood-chip particles.

#### ✊ Fist

No extra weapon element — closed hand from base arm. Add motion-blur lines:

```svg
<g class="weapon weapon-fist">
  <line x1="38" y1="82" x2="50" y2="72" stroke="rgba(200,200,200,0.6)" stroke-width="2"/>
  <line x1="40" y1="88" x2="53" y2="86" stroke="rgba(200,200,200,0.6)" stroke-width="2"/>
  <line x1="38" y1="94" x2="50" y2="98" stroke="rgba(200,200,200,0.6)" stroke-width="2"/>
</g>
```

Attack: fast jab. Hit effect: impact ring radiates from fist.

#### ✏️ Pencil

```svg
<g class="weapon weapon-pencil">
  <rect x="20" y="8"  width="8" height="65" rx="3"  fill="#f7d44c"/>
  <polygon points="20,73 28,73 24,88"                fill="#f4c08a"/>
  <rect x="20" y="8"  width="8" height="8"  rx="2"  fill="#ff9999"/>
  <rect x="20" y="14" width="8" height="3"          fill="#bbb"/>
  <line x1="20" y1="24" x2="28" y2="24" stroke="#e6c244" stroke-width="1"/>
  <line x1="20" y1="32" x2="28" y2="32" stroke="#e6c244" stroke-width="1"/>
</g>
```

Attack: stabbing thrust. Hit effect: scribble lines radiate from tip.

#### 🪄 Magic Wand

```svg
<g class="weapon weapon-wand">
  <rect x="22" y="10" width="4" height="70" rx="2" fill="#5c3a8f"/>
  <circle cx="24" cy="8" r="9"                     fill="#ffe066"/>
  <!-- Star points -->
  <polygon points="24,1 25.5,6 30,6 26.5,9 28,14 24,11 20,14 21.5,9 18,6 22.5,6"
           fill="#fff" opacity="0.8"/>
</g>
```

Attack: swooping arc with sparkle trail. Hit effect: star particles + brief flash.

---

### 6.2 Tech Weapons

#### 🍞 Toast

**Source**: Custom SVG. OpenMoji 🍞 (CC BY-SA 4.0) used as visual reference.

```svg
<g class="weapon weapon-toast">
  <!-- Crust body -->
  <rect x="6" y="18" width="36" height="40" rx="4"  fill="#8B5E3C"/>
  <!-- Bread interior -->
  <rect x="10" y="24" width="28" height="30" rx="3" fill="#D4A26A"/>
  <!-- Rounded toast top bump -->
  <ellipse cx="24" cy="20" rx="16" ry="9"            fill="#8B5E3C"/>
  <ellipse cx="24" cy="19" rx="13" ry="7"            fill="#C8864A"/>
  <!-- Toast cross-hatch burn lines -->
  <line x1="12" y1="28" x2="34" y2="40" stroke="#B8742A" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="12" y1="37" x2="34" y2="49" stroke="#B8742A" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Butter pat -->
  <rect x="14" y="28" width="10" height="7" rx="2"  fill="#ffd966" opacity="0.9"
        transform="rotate(-8 19 31)"/>
  <!-- Steam wisps -->
  <path d="M16 15 Q14 10 16 6 Q18 2 16 -2"
        stroke="rgba(200,200,200,0.7)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <path d="M28 14 Q26 9 28 5 Q30 1 28 -3"
        stroke="rgba(200,200,200,0.7)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</g>
```

**Attack**: Flat-swipe arc (horizontal 90° rotation at peak of swing).  
**Hit effect**: 8 small tan/brown squares (crumbs) scatter from impact, fall with gravity via `@keyframes crumb-fall`.  
**Special**: Butter pat wobbles with separate sub-animation.

#### ⌨️ Keyboard

**Source**: Tabler Icons `keyboard` — MIT license, no attribution required.  
**Download**: https://tabler.io/icons/icon/keyboard (copy SVG path data).  
The 24×24 icon is scaled 2.2× and rotated −15° to appear held at an angle like a cricket bat.

```svg
<g class="weapon weapon-keyboard"
   transform="translate(-14, 5) scale(2.2) rotate(-15 12 12)">
  <!-- Paste Tabler 'keyboard' SVG path data here -->
  <!-- Tabler uses stroke-based paths on a 24×24 viewBox -->
  <!-- Fallback custom representation: -->
  <rect x="1" y="5"  width="22" height="14" rx="2" fill="#e0e0e0" stroke="#bbb" stroke-width="0.5"/>
  <!-- Key rows: row 1 -->
  <rect x="2.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="5.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="8.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="11.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="14.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="17.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="20.5" y="6.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <!-- Row 2 -->
  <rect x="2.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="5.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="8.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="11.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="14.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <rect x="17.5" y="9.5" width="2" height="2" rx="0.4" fill="#aaa"/>
  <!-- Row 3: Space bar -->
  <rect x="6"   y="12.5" width="12" height="2" rx="0.8" fill="#aaa"/>
  <!-- Enter key (red for drama) -->
  <rect x="20.5" y="9.5" width="2" height="5"  rx="0.4" fill="#ff6644"/>
</g>
```

**Attack**: Overhead cricket-bat slam (slow windup, hard downswing).  
**Hit word**: Cycles: `CTRL+ALT+DEL!` → `SYNTAX ERROR!` → `BUFFER OVERFLOW!`  
**Hit effect**: 3–5 random keycap letters (`Q`, `W`, `$`, `#`, `ESC`) pop off and spin away.  
**Scale note**: Keyboard is widest weapon — arm SVG uses `overflow="visible"`.

#### 🖥️ Computer Monitor

**Source**: Tabler Icons `device-imac` — MIT license.  
**Download**: https://tabler.io/icons/icon/device-imac  
Held by the stand base like a mace.

```svg
<g class="weapon weapon-monitor"
   transform="translate(-22, -10) scale(2.8) rotate(-10 12 12)">
  <!-- Paste Tabler 'device-imac' SVG path data here -->
  <!-- Custom fallback: -->
  <!-- Screen bezel -->
  <rect x="1" y="1"  width="22" height="16" rx="2" fill="#2c2c2c"/>
  <!-- Screen content -->
  <rect x="2.5" y="2.5" width="19" height="12" rx="1" fill="#1a6aff"/>
  <!-- Screen glare -->
  <line x1="4" y1="4" x2="9" y2="4" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
  <!-- On-screen skull (during slam) — shown via JS class toggle -->
  <text x="12" y="11" text-anchor="middle" font-size="6" class="monitor-battle-icon">💀</text>
  <!-- Neck -->
  <rect x="10" y="17" width="4" height="4"  fill="#2c2c2c"/>
  <!-- Base -->
  <rect x="7"  y="21" width="10" height="2" rx="1" fill="#2c2c2c"/>
</g>
```

**Attack**: Slow, heavy overhead slam (long windup, maximum impact).  
**Hit word**: `BSOD!` → `404!` → `KERNEL PANIC!`  
**Hit effect**: Full-arena blue flash (150ms, 20% opacity blue overlay) + white scan lines drift down for 500ms.

#### 🖱️🖱️ Mouse Nunchuks

**Source**: Tabler Icons `device-computer-mouse` — MIT.  
**Download**: https://tabler.io/icons/icon/device-computer-mouse  
Two mice connected by a USB cable, swung in figure-8 pattern.

```svg
<g class="weapon weapon-mouse-nunchuk" transform="translate(-8, 0)">
  <!-- Mouse 1 — held in fist -->
  <g transform="translate(12, 20)">
    <ellipse cx="8" cy="12" rx="8" ry="12"  fill="#e8e8e8"/>
    <ellipse cx="8" cy="12" rx="6" ry="10"  fill="#f0f0f0"/>
    <path d="M4 3 Q8 1 12 3" stroke="#ccc" stroke-width="0.8" fill="none"/>  <!-- button split -->
    <ellipse cx="8" cy="8" rx="2.5" ry="4"  fill="#bbb"/>  <!-- scroll wheel -->
    <circle  cx="8" cy="22" r="1.5"          fill="#88aaff"/>  <!-- LED -->
  </g>
  <!-- Connecting USB cord — wavy, animated via .nunchuk-cord class -->
  <path class="nunchuk-cord"
        d="M20 44 C10 52, 32 60, 20 68 C8 76, 30 84, 24 92"
        stroke="#555" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <!-- Mouse 2 — at cord end, angled -->
  <g transform="translate(18, 90) rotate(40)">
    <ellipse cx="8" cy="12" rx="8" ry="12"  fill="#e8e8e8"/>
    <ellipse cx="8" cy="12" rx="6" ry="10"  fill="#f0f0f0"/>
    <path d="M4 3 Q8 1 12 3" stroke="#ccc" stroke-width="0.8" fill="none"/>
    <ellipse cx="8" cy="8" rx="2.5" ry="4"  fill="#bbb"/>
    <circle  cx="8" cy="22" r="1.5"          fill="#88aaff"/>
  </g>
</g>
```

**Attack**: Figure-8 swing — `@keyframes figure-eight` on the arm; `.nunchuk-cord` path attribute is updated by JS (4 keyframes of different Bezier curves) with 150ms delay to simulate cord lag.  
**Hit word**: `DOUBLE CLICK!` → `RIGHT CLICK!` → `DRAG & DROP!`  
**Hit effect**: Two simultaneous impact circles (double hit).

#### 🖱️ Mouse Flail

**Source**: Same Tabler `device-computer-mouse` icon, single mouse.

```svg
<g class="weapon weapon-mouse-flail">
  <!-- Cord from hand, arc to orbiting mouse -->
  <path class="flail-cord"
        d="M24 84 C32 72, 52 56, 46 40 C40 24, 22 18, 30 8"
        stroke="#555" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <!-- Orbiting mouse (JS animates transform) -->
  <g class="flail-mouse">
    <ellipse cx="8" cy="12" rx="8" ry="12"  fill="#e8e8e8"/>
    <ellipse cx="8" cy="12" rx="6" ry="10"  fill="#f0f0f0"/>
    <ellipse cx="8" cy="8" rx="2.5" ry="4"  fill="#bbb"/>
    <circle  cx="8" cy="22" r="1.5"          fill="#88aaff"/>
  </g>
  <!-- Motion-blur ghost copies (opacity 0.3, 0.15) -->
  <g class="flail-ghost-1" opacity="0.3"><!-- same mouse, offset by 20° in orbit --></g>
  <g class="flail-ghost-2" opacity="0.15"><!-- offset by 40° --></g>
</g>
```

**Attack**: JS drives `transform` on `.flail-mouse` in a `requestAnimationFrame` loop, orbiting it around the fist with configurable radius (default 45px). Cord path `d` attribute updates each frame.  
**Hit word**: `SCROLL LOCK!` → `CAPS LOCK!` → `NUM LOCK!`  
**Hit effect**: Motion blur trail stays visible during impact; brief freeze then orbit resumes.

#### 💳 Credit Card

**Source**: Tabler Icons `credit-card` — MIT.  
**Download**: https://tabler.io/icons/icon/credit-card  
Held edge-on like a blade / thrown like a shuriken.

```svg
<g class="weapon weapon-credit-card"
   transform="translate(-5, 22) rotate(-30 20 13)">
  <!-- Card body -->
  <rect x="0" y="0"   width="42" height="27" rx="3" fill="#1a3a6e"/>
  <!-- Magnetic stripe -->
  <rect x="0" y="5"   width="42" height="7"          fill="#111"/>
  <!-- EMV Chip -->
  <rect x="4" y="14"  width="11" height="9"  rx="1"  fill="#d4a017"/>
  <line x1="4" y1="17"  x2="15" y2="17" stroke="#b8860b" stroke-width="0.6"/>
  <line x1="4" y1="20"  x2="15" y2="20" stroke="#b8860b" stroke-width="0.6"/>
  <line x1="9" y1="14"  x2="9"  y2="23" stroke="#b8860b" stroke-width="0.6"/>
  <!-- Number dots -->
  <circle cx="21" cy="19" r="1.3" fill="#999"/>
  <circle cx="25" cy="19" r="1.3" fill="#999"/>
  <circle cx="29" cy="19" r="1.3" fill="#999"/>
  <circle cx="33" cy="19" r="1.3" fill="#999"/>
  <!-- Shine line -->
  <line x1="3"  y1="1.5" x2="16" y2="1.5"
        stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
  <!-- Network logo placeholder (circle) -->
  <circle cx="36" cy="10" r="4" fill="none" stroke="#ff6600" stroke-width="1.2"/>
  <circle cx="39" cy="10" r="4" fill="none" stroke="#ff9900" stroke-width="1.2" opacity="0.7"/>
</g>
```

**Attack**: Forward flick. Card animates `transform: rotate(Ndeg)` at 60ms per revolution during throw; decelerates on hit (`animation-timing-function: ease-out`).  
**Hit word**: `DECLINED!` → `INSUFFICIENT FUNDS!` → `CHARGEBACK!`  
**Hit effect**: Card "embeds" — stops spinning, oscillates ±5° (`animation: card-wobble 0.4s ease`).

#### 🧾 POS Terminal / Payment Terminal

**Source**: Custom SVG — no open source equivalent exists for a realistic POS terminal.

```svg
<g class="weapon weapon-pos-terminal" transform="translate(8, 8)">
  <!-- Main body -->
  <rect x="0" y="0"   width="28" height="52" rx="4" fill="#2c2c2c"/>
  <!-- Screen area -->
  <rect x="3" y="3"   width="22" height="16" rx="2" fill="#1a8a3c"/>
  <!-- Screen text lines -->
  <rect x="5" y="6"   width="14" height="2" rx="0.5" fill="#00ff66" opacity="0.9"/>
  <rect x="5" y="10"  width="9"  height="2" rx="0.5" fill="#00ff66" opacity="0.7"/>
  <rect x="5" y="14"  width="12" height="2" rx="0.5" fill="#00ff66" opacity="0.5"/>
  <!-- Keypad (3 cols × 4 rows) -->
  <rect x="4"  y="23" width="6" height="5" rx="1" fill="#444"/>
  <rect x="11" y="23" width="6" height="5" rx="1" fill="#444"/>
  <rect x="18" y="23" width="6" height="5" rx="1" fill="#444"/>
  <rect x="4"  y="30" width="6" height="5" rx="1" fill="#444"/>
  <rect x="11" y="30" width="6" height="5" rx="1" fill="#444"/>
  <rect x="18" y="30" width="6" height="5" rx="1" fill="#444"/>
  <rect x="4"  y="37" width="6" height="5" rx="1" fill="#444"/>
  <rect x="11" y="37" width="6" height="5" rx="1" fill="#006600"/>  <!-- OK (green) -->
  <rect x="18" y="37" width="6" height="5" rx="1" fill="#660000"/>  <!-- Cancel (red) -->
  <!-- Card slot -->
  <rect x="6"  y="44" width="16" height="4" rx="1" fill="#555"/>
  <rect x="11" y="44" width="6"  height="4"         fill="#111"/>   <!-- slot opening -->
  <!-- Receipt paper (extends on hit via JS) -->
  <g class="pos-receipt">
    <rect x="9" y="-2"  width="10" height="5" rx="1" fill="#f5f5f5"/>
    <path d="M10 -4 Q11 -5.5 12 -4 Q13 -2.5 14 -4 Q15 -5.5 16 -4 Q17 -2.5 18 -4"
          stroke="#ccc" stroke-width="0.6" fill="none"/>
  </g>
</g>
```

**Attack**: Overhead terminal-slam (held upright, slammed down like a gavel).  
**Hit word**: `PROCESSING...` → `AMOUNT: ∞` → `PIN REQUIRED!`  
**Hit effect**: `.pos-receipt` `transform: translateY(-40px)` animates over 300ms (paper feeds out). Screen flashes green (#00ff00) → red (#ff0000). Receipt text updates to `"AMOUNT: ∞"` in tiny font.

#### 🔌 USB Drive

**Source**: Tabler Icons `usb` — MIT.  
**Download**: https://tabler.io/icons/icon/usb

```svg
<g class="weapon weapon-usb" transform="translate(10, 12)">
  <!-- Drive body -->
  <rect x="5"  y="22" width="18" height="38" rx="3" fill="#4488cc"/>
  <rect x="5"  y="22" width="18" height="7"  rx="2" fill="#2255aa"/>
  <!-- Brand stripe -->
  <rect x="5"  y="31" width="18" height="2"         fill="#336699"/>
  <!-- USB connector -->
  <rect x="7"  y="10" width="14" height="14" rx="1" fill="#c8c8c8"/>
  <rect x="8"  y="11" width="12" height="12" rx="0.5" fill="#b0b0b0"/>
  <!-- USB symbol pins (simplified) -->
  <rect x="10" y="12" width="2" height="5"   fill="#888"/>
  <rect x="16" y="12" width="2" height="5"   fill="#888"/>
  <!-- LED indicator -->
  <circle cx="14" cy="46" r="2.5" fill="#00ff88" opacity="0.95"/>
  <!-- Keychain hole -->
  <circle cx="14" cy="56" r="3"  fill="none" stroke="#3366aa" stroke-width="1.5"/>
</g>
```

**Attack**: Fast jab thrust (rapid forward + return, 200ms).  
**Hit word**: `PLUG & PLAY!` → `NOT RECOGNIZED!` → `SAFELY REMOVE!`  
**Hit effect**: Gold spark particles (5–6 small `circle` elements, `stroke: #ffd700`) scatter from connector tip.

#### 🪢 Ethernet Cable Whip

**Source**: Custom SVG. RJ45 plug shape custom-drawn; cable is a dynamic Bezier path.

```svg
<g class="weapon weapon-ethernet">
  <!-- Cable — long wavy path, JS morphs the 'd' attribute during swing -->
  <path class="whip-cord"
        d="M24 82 C34 66, 18 52, 32 36 C46 20, 22 10, 38 -6"
        stroke="#f5a623" stroke-width="4"
        fill="none" stroke-linecap="round"/>
  <!-- Cable stripe (dashed, same path) -->
  <path class="whip-cord-stripe"
        d="M24 82 C34 66, 18 52, 32 36 C46 20, 22 10, 38 -6"
        stroke="#d48f1a" stroke-width="1.8"
        fill="none" stroke-dasharray="5 9" stroke-linecap="round"/>
  <!-- RJ45 connector at whip tip -->
  <g class="whip-tip" transform="translate(32, -10) rotate(45)">
    <rect x="-5" y="-4"  width="10" height="8"  rx="1.5" fill="#cccccc"/>
    <rect x="-4" y="4"   width="8"  height="4"  rx="0.5" fill="#aaaaaa"/>
    <!-- 8 tiny pins -->
    <rect x="-4" y="2" width="1.2" height="3" fill="#888"/>
    <rect x="-2" y="2" width="1.2" height="3" fill="#888"/>
    <rect x="0"  y="2" width="1.2" height="3" fill="#888"/>
    <rect x="2"  y="2" width="1.2" height="3" fill="#888"/>
    <rect x="4"  y="2" width="1.2" height="3" fill="#888"/>
    <!-- Locking tab -->
    <rect x="-3" y="-6" width="6" height="3" rx="1" fill="#aaa"/>
  </g>
</g>
```

**Attack**: Whip-crack — cable path morphs from coiled (S-curve) to straight-then-curl in 200ms via JS-driven `d` attribute interpolation. The `.whip-tip` element translates along the path endpoint.  
**Hit word**: `PACKET LOSS!` → `TIMEOUT!` → `PING: 9999ms`  
**Hit effect**: Snap-ring radiates from RJ45 tip (expanding circle, opacity 0→1→0 over 300ms).

#### 💾 Floppy Disk Shuriken

**Source**: Custom SVG — recognizable 3.5" floppy design.

```svg
<g class="weapon weapon-floppy"
   transform="translate(4, 16) rotate(-20 17 18)">
  <!-- Disk body -->
  <rect x="0" y="0"   width="34" height="36" rx="2.5" fill="#1a1a2e"/>
  <!-- Label area -->
  <rect x="4" y="4"   width="26" height="18" rx="1.5" fill="#e8e4d9"/>
  <!-- Label text lines -->
  <line x1="6"  y1="8"  x2="28" y2="8"  stroke="#ccc" stroke-width="1.2"/>
  <line x1="6"  y1="12" x2="24" y2="12" stroke="#ccc" stroke-width="1.2"/>
  <line x1="6"  y1="16" x2="26" y2="16" stroke="#ccc" stroke-width="1.2"/>
  <!-- Shutter (metal slider, silver) -->
  <rect x="10" y="25" width="18" height="9" rx="1"   fill="#999"/>
  <rect x="14" y="25" width="10" height="9" rx="0"   fill="#666"/>  <!-- disk opening -->
  <!-- Disk hub (visible through opening) -->
  <circle cx="19" cy="29" r="3"                      fill="#333"/>
  <circle cx="19" cy="29" r="1.2"                    fill="#888"/>
  <!-- Write protect notch -->
  <rect x="2"  y="28" width="5" height="5"  rx="1"  fill="#333"/>
  <!-- Manufacturer corner logo -->
  <rect x="25" y="27" width="6" height="5"  rx="0.5" fill="#2244aa"/>
</g>
```

**Attack**: Spinning shuriken throw — same CSS spin as credit card (`transform: rotate(Ndeg)`) but faster (45ms per revolution).  
**Hit word**: `CORRUPTED!` → `DISK FULL!` → `SAVE ERROR!`  
**Hit effect**: Matrix rain — 8–10 small green characters (`0`, `1`, `#`, `%`) fall from impact point, `@keyframes matrix-fall` (translateY 0 → 80px, opacity 1→0, 600ms).

---

### 6.3 Fight Cloud & Hit Text CSS

```css
/* ── Fight cloud ──────────────────────────────────── */
.fight-zone { position: relative; display: flex; align-items: center; justify-content: center; }

.fight-cloud {
    position: absolute;
    width: 160px;
    height: 120px;
    background: radial-gradient(
        ellipse,
        var(--fight-cloud-color, rgba(255,200,50,0.92)) 20%,
        rgba(255,120,0,0.65) 70%,
        transparent 100%
    );
    border-radius: 52% 64% 58% 68% / 58% 62% 52% 72%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3.2rem;
    filter: blur(1px);
    pointer-events: none;
    z-index: 10;
}

@keyframes cloud-pop {
    0%   { transform: scale(0) rotate(-18deg); opacity: 0; }
    50%  { transform: scale(1.35) rotate(6deg); opacity: 1; }
    75%  { transform: scale(1)    rotate(-2deg); opacity: 1; }
    100% { transform: scale(0);                  opacity: 0; }
}

/* ── Hit text ─────────────────────────────────────── */
.hit-text {
    position: absolute;
    font-family: var(--heading-font, sans-serif);
    font-weight: 900;
    font-size: 2rem;
    color: #fff;
    text-shadow: 3px 3px 0 #000, -1px -1px 0 #000;
    pointer-events: none;
    z-index: 11;
    white-space: nowrap;
}

@keyframes hit-word-fly {
    0%   { transform: scale(0.3) rotate(-22deg); opacity: 0; }
    30%  { transform: scale(1.45) rotate(8deg);  opacity: 1; }
    70%  { transform: scale(1.1)  rotate(-3deg); opacity: 1; }
    100% { transform: scale(0.6) rotate(14deg) translateY(-50px); opacity: 0; }
}
```

### 6.4 Aftermath CSS

```css
/* ── Battered state ────────────────────────────────── */
@keyframes battered-sway {
    0%,100% { transform: rotate(-6deg) translateY(2px); }
    50%     { transform: rotate(6deg)  translateY(-2px); }
}
.fighter-battered .fighter-avatar-wrap {
    filter: saturate(0.25) contrast(1.25) brightness(0.85);
    animation: battered-sway 0.9s ease-in-out infinite;
}
.fighter-battered .fighter-arm {
    transform-origin: top center;
    transform: rotate(35deg);   /* drooping arm */
    animation: none;
}
.fighter-battered.arm-left .fighter-arm {
    transform: scaleX(-1) rotate(35deg);
}

/* ── Orbiting stars ───────────────────────────────── */
.star-orbit-container {
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
}
.star-orbit-item {
    position: absolute;
    font-size: 1rem;
    animation: star-orbit 1.2s linear infinite;
    transform-origin: 0 -28px;
}
.star-orbit-item:nth-child(2) { animation-delay: -0.4s; }
.star-orbit-item:nth-child(3) { animation-delay: -0.8s; }

@keyframes star-orbit {
    from { transform: rotate(0deg)   translateY(-28px); }
    to   { transform: rotate(360deg) translateY(-28px); }
}
```

### 6.5 Resolution Text CSS

```css
.battle-resolution {
    position: absolute;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    max-width: 520px;
    width: 90vw;
    z-index: 20;
}
.battle-headline {
    font-size: 1.6rem;
    font-weight: 800;
    color: #fff;
    text-shadow: 2px 2px 8px rgba(0,0,0,0.8);
    animation: fade-in-up 0.6s ease forwards;
}
.battle-cta {
    font-size: 1.1rem;
    color: #ffe;
    margin-top: 8px;
    animation: fade-in-up 0.6s ease 0.4s both;
}
@keyframes fade-in-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

---

## 7. Open Source Attribution

### Required Attribution

**`wwwroot/OPEN-SOURCE-CREDITS.txt`** (also displayed in the About tab of settings):

```
EstimationStation — Open Source Attributions
═════════════════════════════════════════════

Avatar Libraries
────────────────
DiceBear (avatars)
  License : MIT
  Styles  : adventurer (Lisa Wischofsky, CC BY 4.0),
            bottts (Pablo Stanley, CC BY 4.0),
            croodles (Hannah Langford, CC BY 4.0),
            fun-emoji (Davis Uche, CC BY 4.0),
            open-peeps (Pablo Stanley, CC0),
            pixel-art (Plastic Jam, CC BY 4.0),
            thumbs (DiceBear, CC0),
            micah (Micah Lanier, CC BY 4.0)
  Source  : https://dicebear.com

Boring Avatars
  License : MIT
  Source  : https://github.com/boringdesigners/boring-avatars

Battle Weapon Graphics
──────────────────────
Tabler Icons
  Items   : keyboard, device-imac, device-computer-mouse, credit-card, usb
  License : MIT (no attribution required)
  Source  : https://tabler.io/icons
  © Paweł Kuna

OpenMoji (visual reference for toast graphic)
  License : CC BY-SA 4.0
  Source  : https://openmoji.org
  © HfG Schwäbisch Gmünd — Credit: "OpenMoji"

Custom SVG Artwork (Mouse Nunchuks, Mouse Flail, POS Terminal,
Ethernet Cable Whip, Floppy Disk Shuriken, Toast)
  License : MIT
  Created specifically for EstimationStation

Celebration Libraries
─────────────────────
canvas-confetti
  License : ISC
  Source  : https://github.com/catdad/canvas-confetti

fireworks-js
  License : MIT
  Source  : https://github.com/crashmax-dev/fireworks-js
```

---

## 8. Complete File Manifest

### Modified Files

| File | Changes |
|---|---|
| `PokerModels.cs` | Add `AvatarData: string?` to `Participant`; add `ShameParticipantName: string?` and `ShameParticipantId: string?` to vote stats object |
| `PokerHub.cs` | Extend `CalculateStats()` with outlier detection; add `UpdateAvatar(string)` hub method; include `avatarData` in `JoinRoom`, `RoomState`, `ParticipantJoined`, `NameUpdated` broadcast payloads; update `JoinRoom` signature to accept optional `avatarData` param |
| `wwwroot/js/room.js` | Update `renderParticipants()` to use `renderAvatar()`; add `AvatarUpdated` SignalR handler; add post-reveal dispatch logic (shame / battle triggers); add `buildVoteGroups()` and `totalVoters()` helpers; add `data-participant-id` attributes to participant badges |
| `wwwroot/js/site.js` | Wire new "Behavior" tab to `openSettingsModal()`; add avatar picker UI logic in Profile tab; call `populateShameTab()`, `populateBattleTab()`, `populateAvatarTab()` when settings modal opens; add save handlers for each new tab |
| `wwwroot/css/site.css` | Import new CSS files; ensure no conflicts with new `.avatar-wrapper`, `.battle-arena-overlay`, `.shame-toast` selectors |
| `Views/Shared/_Layout.cshtml` | Add Behavior tab button and pane HTML; expand Profile tab with avatar section; add weapon gallery grid HTML; add shame config HTML; include new CSS and JS `<link>`/`<script>` tags; add DiceBear + Boring Avatars `<script>` includes |

### New Files

| File | Purpose |
|---|---|
| `wwwroot/js/avatar.js` | Avatar rendering engine, DiceBear/BoringAvatar wrappers, upload handler, settings helpers |
| `wwwroot/js/shame.js` | Shame animation engine, settings helpers, test/reset functions |
| `wwwroot/js/battle.js` | Battle animation engine, weapon registry, arm SVG builder, fight sequence orchestrator, settings helpers |
| `wwwroot/css/avatar.css` | Avatar wrapper, vote-status rings, style-picker grid |
| `wwwroot/css/shame.css` | Shame pulse/shake/spotlight animations, floating emojis, toast component |
| `wwwroot/css/battle.css` | Battle arena overlay, fighter positioning, arm animations, fight cloud, hit text, aftermath, resolution |
| `wwwroot/lib/dicebear/core.umd.min.js` | DiceBear core — vendored from jsDelivr or npm pack |
| `wwwroot/lib/dicebear/collection.umd.min.js` | DiceBear all styles — vendored |
| `wwwroot/lib/boring-avatars/boring-avatars.umd.min.js` | Boring Avatars — vendored |
| `wwwroot/OPEN-SOURCE-CREDITS.txt` | Attribution file for CC BY licensed assets |

---

## 9. Implementation Order

### Phase 1 — Avatars (Foundational)
All other features visually depend on avatars being rendered.

1. Add `AvatarData` to `Participant` model
2. Update `JoinRoom`, `RoomState`, `ParticipantJoined` payloads in hub
3. Add `UpdateAvatar()` hub method
4. Vendor DiceBear and Boring Avatars UMD builds into `wwwroot/lib/`
5. Create `avatar.js` (rendering engine + upload handler)
6. Create `avatar.css`
7. Update `renderParticipants()` in `room.js`
8. Add `AvatarUpdated` SignalR handler in `room.js`
9. Add avatar picker UI to Profile tab in settings

### Phase 2 — Post-Reveal Behavior Settings
Establish the master settings tab shell before wiring individual effects.

10. Add "Behavior" tab button and pane skeleton to `_Layout.cshtml`
11. Implement `getPostRevealBehavior()` / `savePostRevealBehavior()`
12. Add post-reveal dispatch logic to `room.js` `VotesRevealed` handler (stubs: `triggerShame()`, `triggerBattle()` can be empty at this stage)

### Phase 3 — Shame
13. Add outlier detection to `CalculateStats()` in `PokerHub.cs`
14. Add `ShameParticipantName` / `ShameParticipantId` to stats broadcast
15. Create `shame.js`
16. Create `shame.css`
17. Add shame config UI to Behavior tab
18. Wire `populateShameTab()` / `saveShameFromForm()` in `site.js`

### Phase 4 — Battle (Core)
19. Create `battle.css` (arena layout, fighter positioning, arm CSS, cloud, aftermath, resolution)
20. Create `battle.js` skeleton: `triggerBattle()`, `buildArena()`, phase sequence with `setTimeout`
21. Implement `buildArmSVG()` for classic weapons (sword, stick, fist, pencil, wand)
22. Implement fight cloud + hit text animation
23. Implement aftermath phase (battered filter + orbiting stars)
24. Implement resolution phase + auto-dismiss

### Phase 5 — Tech Weapons
25. Add all 10 tech weapon SVG definitions to `buildArmSVG()` in `battle.js`
26. Implement weapon-specific attack animations (figure-eight, orbit, whip-crack, card-spin)
27. Implement weapon-specific hit particles (crumbs, keycaps, BSOD flash, matrix rain, etc.)
28. Expand weapon selector in battle settings UI from 5 to 15 options + per-fighter toggle

### Phase 6 — Polish & Integration
29. Add credits to About tab and `OPEN-SOURCE-CREDITS.txt`
30. Test all three post-reveal paths with various vote combinations
31. Verify SignalR message size stays within limits for uploaded avatars (≤65 KB)
32. Test mobile layout — battle arena and shame toast must be usable on narrow screens
33. Validate all settings persist across page refresh and reconnect

---

*End of plan. Version 1.0 — EstimationStation Feature Planning Document.*
