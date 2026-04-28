## Goal

Standardize a "Fixed App Shell + Internal Scroll Box" architecture so the Top Nav and Bottom Dock/FAB never move. Only the inner content area scrolls, and only when needed.

## Current state

Today every page uses `min-h-screen` and lets the **whole window** scroll. The bottom nav (`MobileNav`, `position: fixed`) and any sticky headers float over a long page that scrolls in the body. This causes:
- Address bar jumps on iOS
- Headers/dock that appear to "move" between routes
- Inconsistent scroll behavior page-to-page

The Subscription page already proves the target pattern works.

## Proposed architecture

### 1. New reusable shell component

Create `src/components/AppShell.tsx`:

```tsx
<AppShell
  header={<TopBar title="Jobs" onBack={...} />}   // optional
  scrollable                                       // default true; set false for fit-to-screen pages
>
  {children}
</AppShell>
```

Internals:
- Outer: `fixed inset-0 flex flex-col overflow-hidden bg-background` with `height: 100dvh`
- Header slot: `shrink-0`, with `padding-top: env(safe-area-inset-top)`
- Content slot:
  - If `scrollable`: `flex-1 min-h-0 overflow-y-auto no-scrollbar` with bottom padding `calc(env(safe-area-inset-bottom) + 96px)` to clear the dock
  - If not: `flex-1 min-h-0 overflow-hidden`
- Bottom nav (`MobileNav`) stays mounted at the App level — unchanged — so it never re-renders between routes (no flicker).

### 2. Global CSS

`src/index.css` already has `.no-scrollbar`. Add:
- `html, body, #root { height: 100%; overflow: hidden; overscroll-behavior: none; }` so the window itself never scrolls.
- Keep `.no-scrollbar` as the opt-in helper (don't hide scrollbars globally — desktop forms etc. still benefit from scroll affordance inside modals).

### 3. Migrate pages to AppShell

Convert these pages from `min-h-screen` to `<AppShell>`:

| Page | Header | Scrollable? |
|---|---|---|
| Dashboard | existing top bar | yes |
| Jobs | "Jobs" + filters | yes |
| Messages (list view) | "Messages" | yes |
| Messages (active thread) | conversation header | yes (chat list already scrolls internally — keep that, set page non-scrollable) |
| Profile | "Profile" | yes |
| Activity | "Activity" + tabs | yes |
| SubscriptionTab | already uses pattern → refactor to use `AppShell` for consistency |
| Settings sub-screens (Payment, Notifications, etc.) | sub-screen header | yes |

Public/landing pages (`Index`, `Heroes`, `ForBusiness`, `Features`, legal pages) keep normal document scroll — they aren't part of the app shell.

### 4. Subscription page polish (already mostly done)

- Confirm cards use `rounded-[24px]` (currently 24px ✓)
- Pro card: white background + green bloom shadow ✓
- Tighten spacing: reduce `gap-2.5` between cards to `gap-2`, drop the status text top padding from `pt-2` to `pt-1.5`
- Wrap content in the new `AppShell` for parity

### 5. Bottom dock stability

Move `<MobileNav />` rendering up so it lives **outside** the `<Routes>` tree (it's already in `App.tsx` — verify it's outside `<PageTransition>` which remounts on route change). This guarantees zero flicker between route changes.

## Technical details

- Use `100dvh` (dynamic viewport height) instead of `100vh` — fixes iOS Safari address-bar jump
- Header padding: `padding-top: calc(env(safe-area-inset-top, 0px) + 8px)`; max header height ~60px including safe area
- Content padding-bottom: `calc(env(safe-area-inset-bottom, 0px) + 96px)` to clear the floating dock + FAB
- Keep `useKeyboardInset` working for Messages — when the keyboard opens on iOS, the inner scroll box absorbs the resize because the outer shell is `100dvh`
- Pull-to-refresh (`PullToRefreshWrapper`) wraps the **inner scroll container**, not the page
- `interactive-widget=resizes-content` is already in the viewport meta (mobile-ux memory) — preserved

## Files to create/edit

**Create:**
- `src/components/AppShell.tsx`

**Edit:**
- `src/index.css` — body/root height lock
- `src/App.tsx` — verify `MobileNav` placement outside route transitions
- `src/pages/Dashboard.tsx`, `Jobs.tsx`, `Messages.tsx`, `Profile.tsx`, `Activity.tsx` — wrap in `AppShell`
- `src/components/profile/SubscriptionTab.tsx` — switch to `AppShell`, tighten spacing
- Sub-tabs inside Profile (Payment, Notifications, Subscription) — use `AppShell` with `onBack`

## Out of scope

- Public marketing pages (Index, Heroes, ForBusiness, Features, legal) — these are document-scroll by design for SEO and long-form content
- Modals/dialogs — already overlay with their own scroll containment
- Admin pages — internal tooling, not part of the consumer app shell

## Risk / rollout

- Risk: iOS keyboard interactions on Messages — mitigated by `100dvh` + existing `useKeyboardInset`
- Risk: Pull-to-refresh on Dashboard — must be re-attached to the inner scroll node
- Will migrate one page at a time, verifying each on mobile preview before moving on
