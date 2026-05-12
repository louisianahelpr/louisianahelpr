# Accessibility audit

Run this on a real iOS device with VoiceOver and Dynamic Type at largest text size. Most issues will surface on those two paths alone; the rest of the list is contrast + motion preferences.

## VoiceOver pass — golden flows

Enable VoiceOver: Settings → Accessibility → VoiceOver → On.

### Onboarding
- [ ] Tap-to-focus reads every form label clearly (e.g. "Email, text field, required")
- [ ] "Continue" button reads as "Continue, button, dimmed" when prerequisites missing
- [ ] Password show/hide eye buttons announce state ("Show password" / "Hide password")
- [ ] Step indicator reads "Step 2 of 3" not just "2 of 3"

### Dashboard
- [ ] HelprMark in nav reads as link to home
- [ ] Job cards: full title + budget + "button" hint
- [ ] Filter pills: announce state ("Sort, Newest, button")
- [ ] Frosted-circle icons announce as decorative (not as separate tappable items)

### Apply flow
- [ ] JobDetailDialog opens with focus on dialog title
- [ ] Queue-position strip reads "X helpers already applied, you would be number X+1 in line"
- [ ] Apply button reads "Apply, earn $X, button"
- [ ] Photo lightbox: arrows + close X are reachable via swipe nav

### Chat
- [ ] My bubbles announce as "Sent: \<text\>"
- [ ] Their bubbles announce as "Received from \<name\>: \<text\>"
- [ ] Read receipt avatar/check has aria-label "Read" or "Delivered"
- [ ] Quick reply chips read out their full action label

### Profile
- [ ] Avatar squircle has alt text matching name
- [ ] Tier badges read ("Pro" / "Elite") inline with name
- [ ] Verified ribbon announces "Verified Helpr"
- [ ] Completion meter reads percentage and missing item

## Dynamic Type pass

Settings → Accessibility → Display & Text Size → Larger Text → max.

- [ ] Greeting card doesn't truncate the name at "Lexi" → ensure clamp scales
- [ ] Job card title can wrap to 2 lines, payout chip stays visible
- [ ] PostJob category chips wrap (don't horizontal scroll off-screen)
- [ ] Modal dialogs scroll internally — Cancel/Confirm buttons always reachable
- [ ] Bottom nav labels don't overflow into the dock FAB

## Contrast pass

Visually walk every screen on **both** light and dark mode. Special attention:

- [ ] Gold-warm callouts (annual lock-in, boost cooldown) on parchment: text contrast ≥ 4.5:1
- [ ] Burnt-sienna copy on the cream backdrop: same threshold
- [ ] Disabled bark buttons at 50% opacity: still legible as buttons
- [ ] Bark gradient bubbles in chat: parchment text never drops below 4.5:1
- [ ] Sienna pip on unread notification rows: distinguishable from ink-deep title

## Motion preferences

Settings → Accessibility → Motion → Reduce Motion → On.

- [ ] Toast slide-in disabled (or shortened)
- [ ] AnimatedCounter falls back to static value (no count-up animation)
- [ ] Pull-to-refresh spinner still works but without the rotation flourish
- [ ] Modal zoom-in is a simple fade
- [ ] Confetti on first job complete should NOT fire (or fire a single-static burst)

## Touch target sizes

Apple HIG: minimum 44×44pt for every tap target.

- [ ] Bottom nav tab tap area ≥ 44 (currently min-h-[48px] — pass)
- [ ] Filter pill row buttons ≥ 44 with padding
- [ ] Chat composer send button ≥ 44
- [ ] Notification panel dismiss X — historically too small; verify after the safe-area fix

## Color blindness check

Use Settings → Accessibility → Display & Text Size → Color Filters → Deuteranopia.

- [ ] Job status pills (Open / Awarded / Done / Cancelled) still distinguishable
- [ ] Star rating sienna fill vs olivewood empty stays clearly differentiated
- [ ] Pro/Elite halo rings (sienna vs gold) remain distinct

## Known carve-outs
- Boosted job pulse animation will still pulse under Reduce Motion — acceptable per current design (subtle ambient signal, not a content motion).
- Map view density buckets rely on color saturation; not WCAG-compliant for color-only differentiation. Acceptable since count is also in the popup.

## Sign off
Audit performed by: ____________
Date: ____________
Open issues filed: ____________
