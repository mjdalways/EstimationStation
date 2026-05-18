# v5 Group Y — Card Back Redesign

**Date:** 2026-05-18  
**Items:** Y2, Y3 (Y4/Y5 were already done; Y1 deferred)  
**Files changed:** 3

---

## Y2 — More Card Back Styles: Gradients, Solid Colors, Patterns

### Root cause
Only four preset CSS classes existed (baize, space, retro, seasonal). No support for custom colours, gradients, or user-uploaded images.

### Changes

**`wwwroot/css/site.css` — new card back classes:**

```css
.card-back-checker .participant-badge.voted { ... repeating-conic-gradient checkerboard }
.card-back-stripes .participant-badge.voted { ... repeating-linear-gradient diagonal }
.card-back-solid .participant-badge.voted   { background: var(--cb-solid, #1a1a2e); }
.card-back-gradient .participant-badge.voted { background: linear-gradient(var(--cb-grad-dir, 135deg), var(--cb-grad-a, #6366f1), var(--cb-grad-b, #ec4899)); }
.card-back-customimage .participant-badge.voted { background-image: var(--cb-custom-img); background-size: cover; background-position: center; }
```

**`Views/Shared/_Layout.cshtml` — Visual tab, Participant Card Backs section:**
- `#cardBackSelect` expanded with 5 new options: checker, stripes, solid, gradient, customimage
- `#cb-solid-opts`: colour input `#cb-solid-color` with `oninput="setCbSolidColor(this.value)"`
- `#cb-gradient-opts`: two colour inputs `#cb-grad-a`/`#cb-grad-b` + direction select `#cb-grad-dir`, all `oninput/onchange="applyCbGradient()"`
- `#cb-image-opts`: file input + Clear button (Y3)
- All sub-panels start `display:none!important` and are shown by `_cbUpdateSubOpts()`

**`wwwroot/js/site.js`:**
- `_cardBackClasses` extended with 5 new class names
- `applyCardBackDesign()` — after existing class toggle, restores CSS vars from localStorage for solid/gradient/customimage; populates colour inputs; calls `_cbUpdateSubOpts(design)`
- `_cbUpdateSubOpts(design)` — shows/hides the three sub-panels by toggling `display` via `style.setProperty(..., 'important')`
- `setCbSolidColor(color)` — saves `es_cbSolidColor`, sets `--cb-solid` CSS var
- `applyCbGradient()` — reads three inputs, saves `es_cbGrad` JSON, sets `--cb-grad-*` CSS vars

---

## Y3 — Import Image File as Card Back

### Root cause
No way to use a personal image on voted badges.

### Changes

**`wwwroot/js/site.js`:**

```javascript
function handleCardBackImage(inp) {
    var file = inp && inp.files && inp.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) { alert('Image must be under 200 KB.'); inp.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
        var data = ev.target.result;
        localStorage.setItem('es_cardBackCustomImage', data);
        document.documentElement.style.setProperty('--cb-custom-img', 'url("' + data + '")');
        setCardBackDesign('customimage');
    };
    reader.readAsDataURL(file);
}

function clearCardBackImage() {
    localStorage.removeItem('es_cardBackCustomImage');
    document.documentElement.style.removeProperty('--cb-custom-img');
    setCardBackDesign('default');
    var inp = document.getElementById('cb-image-file');
    if (inp) inp.value = '';
}
```

**`Views/Shared/_Layout.cshtml` — `#cb-image-opts` panel:**
- `<input type="file" id="cb-image-file" accept="image/*" onchange="handleCardBackImage(this)">`
- `<button onclick="clearCardBackImage()">✕ Clear image</button>`

---

## Already Done (Y4/Y5)

- **Y4** (`_previewFlip()`): adds `.flip-preview` class to `#card-back-preview` for 700 ms — was already present
- **Y5** (`cel-flip-gap` slider + `revealFlipGap`): slider existed in celebration settings, populated by `populateCelebrationTab()` — was already present

## Deferred

- **Y1** (separate `es_participantCardBack` / `es_voteCardBack` keys): requires duplicating the card back section for the vote picker row. Low urgency — deferred.

---

## Summary

| Item | Key | Mechanism |
|------|-----|-----------|
| Y2 checker | — | CSS `repeating-conic-gradient` |
| Y2 stripes | — | CSS `repeating-linear-gradient` |
| Y2 solid | `es_cbSolidColor` | `--cb-solid` CSS var |
| Y2 gradient | `es_cbGrad` JSON | `--cb-grad-a/b/dir` CSS vars |
| Y3 custom image | `es_cardBackCustomImage` | `--cb-custom-img` CSS var (base64 data URL) |

No server changes. All stored in localStorage.
