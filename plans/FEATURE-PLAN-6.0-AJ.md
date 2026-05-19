# AJ — Additional Card Animations

> **Priority:** 5  
> **Effort:** Hard  
> **Files:** `wwwroot/js/room.js`, `wwwroot/css/site.css`, `Views/Shared/_Layout.cshtml`  
> [← Back to Feature Plan](../FEATURE-PLAN-6.0.md)

Additional reveal animations for vote cards, selectable alongside the existing flip. Deferred from Group AH.

---

## Animations

| Name | Description |
|------|-------------|
| **Explode** | Card shatters into fragments flying off-screen |
| **Tardis** | Card spins and scales to a tiny dot, then re-expands showing the number |
| **Hide** | Card slides down off-screen then returns from below with number revealed |
| **Run-Away** | Card sprints off to the side, bounces back with number revealed |
| **Fly-Away** | Card lifts off-screen upward and returns from above with number |

---

## Implementation Approach

Each animation is a CSS `@keyframes` block applied via a class on `.poker-card` at the moment `castVote()` fires in `room.js`.

```javascript
// In castVote(), after renderCards():
if (selectedVote !== null) {
    var selectedCard = document.querySelector('.poker-card.selected');
    if (selectedCard) {
        selectedCard.classList.add('card-anim-' + currentAnimStyle);
        setTimeout(function() {
            selectedCard.classList.remove('card-anim-' + currentAnimStyle);
        }, es_flipDuration || 700);
    }
}
```

**Speed:** Controlled by the [AK4](./FEATURE-PLAN-6.0-AK.md#ak4----flip-speed-setting) flip speed setting (`es_flipDuration`).

**Selection:** Animation style selectable in Settings → Visual tab via a `<select>` or radio group. Stored in `es_cardAnimStyle` (values: `flip`, `explode`, `tardis`, `hide`, `run-away`, `fly-away`).

---

## CSS Keyframe Outlines

```css
/* Explode — fragments via clip-path or transform on child elements */
@keyframes cardExplode { ... }

/* Tardis — spin + scale down, then scale up */
@keyframes cardTardis {
    0%   { transform: rotateY(0)   scale(1); }
    40%  { transform: rotateY(360deg) scale(0.05); }
    60%  { transform: rotateY(360deg) scale(0.05); }
    100% { transform: rotateY(720deg) scale(1); }
}

/* Hide — slide down and back up */
@keyframes cardHide {
    0%   { transform: translateY(0); }
    45%  { transform: translateY(120%); }
    55%  { transform: translateY(120%); }
    100% { transform: translateY(0); }
}

/* Run-Away — shoot right, rebound from left */
@keyframes cardRunAway {
    0%   { transform: translateX(0); }
    40%  { transform: translateX(200%); opacity: 0; }
    41%  { transform: translateX(-200%); opacity: 0; }
    55%  { transform: translateX(-200%); opacity: 1; }
    100% { transform: translateX(0); }
}

/* Fly-Away — rise up and descend */
@keyframes cardFlyAway {
    0%   { transform: translateY(0); }
    45%  { transform: translateY(-200%); opacity: 0; }
    55%  { transform: translateY(-200%); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
}
```

---

## Verification

- [ ] Settings → Visual tab shows animation style selector with all 6 options (including existing Flip)
- [ ] Selecting a vote card triggers the chosen animation
- [ ] Each animation completes and leaves the card in its final selected state
- [ ] Animation duration respects the AK4 flip speed setting
- [ ] No layout shift or z-index issues during animation
- [ ] Works on all supported themes
- [ ] `dotnet build` → 0 errors
