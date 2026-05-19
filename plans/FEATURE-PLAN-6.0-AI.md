# AI — Custom Clock Face

> **Priority:** 4  
> **Effort:** Hard  
> **Files:** `wwwroot/js/room.js`, `wwwroot/js/site.js`, `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

Deep customisation of the clock beyond current colour/size options. Deferred from Group AH.

---

## AI1 — Clock Background Colour

- Add `bgColor` to `es_clockStyle` with colour picker + "transparent" option
- Applied to the `#stc-clock` span container and `#tc-clock-preview` in settings

**Storage:** `es_clockStyle.bgColor` (CSS colour string or `'transparent'`)

---

## AI2 — Custom Hands (analog)

- **Hand style:** solid / dashed / arrow — per hand
- **Thickness:** 1–6 px — per hand
- **Length:** 50–100% of radius — per hand
- Stored in `es_clockStyle.hands` as an object: `{ hour: { style, width, length }, min: ..., sec: ... }`
- Rendered via SVG `<line>` attributes in `_acAnalogSvgTemplate` (room.js) and `_acRenderClockBasic` (site.js)

---

## AI3 — Number Style (analog)

Options:
- `digits` — Arabic numerals (1–12)
- `roman` — Roman numerals (I–XII)
- `ticks` — tick marks only
- `none` — clean face with no markings

Stored in `es_clockStyle.numberStyle`.  
Rendered as SVG `<text>` elements (for digits/roman) or short `<line>` elements (for ticks) placed at 30° intervals around the clock face.

---

## AI4 — Font Family + 12h/24h Toggle (digital)

- **Font family** `<select>` — monospace subset: `Consolas`, `Courier New`, `Cascadia Code`, `monospace`
- **12h/24h checkbox** — stored as `es_clockStyle.h24` (boolean)
- Both `_acRenderClockBasic` (site.js) and `_acRenderClock` (room.js) read `h24`; extend both to also read `fontFamily`

**Storage:** `es_clockStyle.fontFamily`, `es_clockStyle.h24`

---

## Implementation Notes

All new settings go in the **Other → Clock** section of the settings modal alongside existing clock controls.

The `_acAnalogSvgTemplate()` function in `room.js` generates the SVG markup — it needs to accept the full clock style object and apply `hands`, `numberStyle`, and `bgColor`.

The `_acRenderClockBasic()` function in `site.js` (home/non-room page preview) should also apply `fontFamily`, `h24`, and `bgColor` for consistency.

---

## Verification

- [ ] Clock background colour picker applied to story bar clock and settings preview
- [ ] "Transparent" option removes the clock background
- [ ] Analog hour/minute/second hands individually configurable (style, width, length)
- [ ] Number style cycles correctly through digits / roman / ticks / none on the analog face
- [ ] Digital clock uses the selected font family
- [ ] 12h/24h toggle updates both story bar and settings preview in real time
- [ ] Settings preview (home page) reflects all new settings correctly
- [ ] `dotnet build` → 0 errors
