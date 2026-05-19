# AB — Image Upload with Crop/Pan/Zoom

> **Priority:** 3  
> **Effort:** Hard  
> **Files:** `Views/Shared/_Layout.cshtml`, `wwwroot/css/site.css`, `wwwroot/js/room.js`, `wwwroot/js/avatar.js`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

---

## Overview

> **Key principle:** Build one shared `openCropDialog(file, aspectRatio, onConfirm)` utility — avatar upload, card back image import, and season sprite import all wire into it. Build once, use everywhere.

---

## AB1 — Core Crop Dialog

After file selection: open a crop dialog showing the image in a constrained viewport.

- **Pan:** drag to reposition within the crop frame
- **Zoom:** pinch (touch) or scroll wheel; determines how much of the image fits the output
- **Crop frame:** fixed aspect ratio matching the target (square for avatars, rectangle for card backs)
- **Confirm:** renders final output to a hidden `<canvas>`, reads back as base64 JPEG at target size:
  - Avatars: 128×128 px
  - Card backs: 200×280 px
- **Mobile:** touch events (pinch-to-zoom, single-finger drag) must work
- **Dependency:** Vanilla JS only — no library

### API

```javascript
openCropDialog(file, { aspectRatio, outputWidth, outputHeight, title }, function(base64jpeg) {
    // called with the cropped image as a base64 JPEG string
});
```

### Implementation Notes

- Modal overlay with the image rendered on a `<canvas>` inside a fixed-size viewport
- Track `panX`, `panY`, `zoom` as state; re-render on each pointer/wheel event
- On confirm: draw transformed image to an offscreen canvas at `outputWidth × outputHeight`; export via `canvas.toDataURL('image/jpeg', 0.85)`
- Crop frame overlay: semi-transparent mask outside the frame, drag handles at corners for visual reference (frame itself is fixed — only the image pans/zooms)

---

## AB5 — Season Background Image Import *(deferred from AA4)*

Import a custom background image for Star Wars Day or any custom season.

- Stored as base64 in `sea_cfg_{season}`
- Applied as `background-image` on the seasonal overlay div
- Crop/pan via the shared `openCropDialog()` utility
- Clear button reverts to default seasonal CSS

---

## AB6 — Custom Seasonal Theme Builder *(deferred from AA9)*

Allow users to define a fully custom season: name, date range (month/day start–end), icon emoji, colour palette, optional background image.

- Custom seasons stored in `es_customSeasons` localStorage JSON array
- Appear in the Seasons tab alongside built-ins; enable/disable like any other season
- Background image upload uses the shared crop dialog
- Custom seasons integrate with `_seaGetSeason()` date-matching logic

---

## Verification

- [ ] Avatar upload: after selecting a file, crop dialog opens with correct 1:1 aspect ratio
- [ ] Pan and zoom work with mouse and touch
- [ ] Confirm produces a 128×128 JPEG applied as avatar
- [ ] Card back image: crop dialog uses the correct 200×280 aspect ratio
- [ ] Season background: crop dialog applies and saves as `sea_cfg_` background
- [ ] Custom season: created season appears in Seasons tab, activates on its date range
- [ ] `dotnet build` → 0 errors
