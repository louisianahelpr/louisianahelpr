## Acknowledged rules

1. Tapping the **Profile** bottom-nav icon while the user is anywhere inside the Profile stack (any sub-tab or sub-route) returns them to the Profile root (the landing menu — `tab=landing`, no query params).
2. None of the Profile sub-pages may scroll at the page level. Each sub-page's outer container is `h-[100dvh] overflow-hidden` in a flex column.
3. Only the inner content region (settings list / form fields) gets `overflow-y-auto` with `min-h-0 flex-1` so it occupies the space between the header and the bottom nav.
4. Edit Profile action buttons (Cancel / Save Changes) get the premium look used elsewhere: `rounded-[20px]` + layered shadow `shadow-[0_2px_4px_hsl(var(--primary)/0.15),0_12px_32px_-12px_hsl(var(--primary)/0.45)]`, full-height `h-12`, no flat states.

## Current architecture (so we don't break it)

The "sub-pages" the user named are **not all separate routes**. Most live as internal `tab` state inside `src/pages/Profile.tsx`:

- Internal tabs (one route, `/profile?tab=…`): Payout (`payment`), Subscription, Referral, Licenses + Insurance (`credentials`), Edit Profile (`profile`), Notifications, Account Settings (`security`), Warnings, Help (`support`), Legal.
- Real routes: `/schedule`, `/availability`, `/saved-helpers`.

So the "navigation reset" rule has two implementations:
- For real routes → MobileNav must `navigate('/profile')`.
- For internal tabs → MobileNav already lands on `/profile`, but if the user is on `/profile?tab=xxx`, tapping Profile must clear the tab back to `landing`.

## Plan

### 1. MobileNav — Profile tab reset (`src/components/MobileNav.tsx`)

Extend `tabStacks["/profile"]` to include the real Profile sub-routes:

```ts
"/profile": ["/support", "/user", "/admin", "/schedule", "/availability", "/saved-helpers"]
```

In `handleClick`, add a Profile-specific branch: when `path === "/profile"` AND we're already on `/profile` but `location.search` contains a `tab` param other than `landing`, call `navigate('/profile')` (no query) so the page resets to the landing menu. This piggybacks on Profile's existing `popstate` listener which already syncs `tab` from the URL.

### 2. Profile sub-pages — scroll lock (no page scroll, internal scroll only)

Apply the same shell pattern we used on Availability to:

- `src/pages/Profile.tsx` — wrap the tab content area so the outer page is `h-[100dvh] overflow-hidden flex flex-col`, header is fixed-height, and the tab content container is `flex-1 min-h-0 overflow-y-auto`. Each tab body keeps its existing markup; only the wrapper changes.
- `src/pages/Schedule.tsx`
- `src/pages/Availability.tsx` — already done; verify and leave as-is.
- `src/pages/SavedHelpers.tsx`
- `src/pages/Support.tsx`

Pattern per page:
```tsx
<div className="h-[100dvh] max-h-[100dvh] flex flex-col bg-premium-page overflow-hidden">
  <Header />                                {/* shrink-0 */}
  <main data-allow-scroll="true"
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+96px)]">
    {content}
  </main>
</div>
```

`data-allow-scroll="true"` bypasses the global wheel/touchmove lock so internal scroll works on iOS. Bottom padding keeps the last item clear of the bottom nav.

### 3. Edit Profile buttons — premium styling (`src/pages/Profile.tsx`, lines ~838–858)

Replace current `rounded-[18px]` / `h-11` with the premium token used by the menu cards:

- Cancel: `rounded-[20px] h-12 bg-white border border-border/40 shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] active:scale-[0.98]`
- Save Changes: `rounded-[20px] h-12 bg-primary text-primary-foreground shadow-[0_2px_4px_hsl(var(--primary)/0.15),0_12px_32px_-12px_hsl(var(--primary)/0.45)] active:scale-[0.98]` (preserve existing `saving`/`justSaved` states)

### 4. QA before declaring done

For each page below, in the live preview:
1. Open the page, attempt to scroll the body — page must not move.
2. Scroll inside the inner list/form — must scroll smoothly.
3. From inside the page, tap the **Profile** bottom-nav icon — must land on `/profile` with the landing menu visible (no `?tab=` in URL).

Pages to QA: Edit Profile, Payout, Subscription, Referral, Licenses, Insurance, Schedule, Availability, Saved Helpr, Notifications, Account Settings, Warnings, Help, Legal. Plus visual check on the new Cancel/Save buttons.

## Files to edit

- `src/components/MobileNav.tsx` — extend `/profile` stack + reset-tab branch
- `src/pages/Profile.tsx` — outer shell scroll lock + premium Edit Profile buttons
- `src/pages/Schedule.tsx` — outer shell scroll lock
- `src/pages/SavedHelpers.tsx` — outer shell scroll lock
- `src/pages/Support.tsx` — outer shell scroll lock
- `src/pages/Availability.tsx` — verify only

No business-logic, data, or DB changes.
