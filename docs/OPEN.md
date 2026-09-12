# Open list

Written 2026-09-11. The point of this file is that the backlog stops living in
chat scrollback. Anything not in here is either done or forgotten, and both of
those are answerable by reading this instead of guessing.

Grouped by SURFACE, not by the order it was noticed — because most of these are
instances of a few shared problems, and fixing them surface-by-surface costs a
fraction of fixing them one report at a time.

---

## Decided 2026-09-11, now queued to build

- **Live location: background tracking, REQUIRED while en route.** Today it is
  `setInterval(pushPosition, 45_000)` in the WebView (JobTracking.tsx:692),
  running only while the job is `on_the_way`. There is no `watchPosition` and no
  background-location capability, so **iOS suspends it the moment the helper
  locks their phone or opens Maps** — i.e. exactly while they are driving, which
  is the only time it matters. Owner chose real background location from "On My
  Way" until arrival. Carries `UIBackgroundModes: location`, an Apple review
  justification, a privacy-label change, and battery cost.
- **Earnings splits into two tabs.** Earnings = what you made (summary, history,
  forecast, export, streak). Payouts = how you get paid (setup — currently
  NESTED inside the earnings tab — methods, wallet/cash-out, threshold, payout
  history, transfers, Instant Cash Out). Lane `earnings-split`.

## Job card (BOTH sides) — IN PROGRESS, lane `step-components`
Owner decided 2026-09-11: helper and poster cards share ONE shell, filling the
same slots (tracker / primary action / secondary row / the ask / escape link)
with different content per side and per step.

- **Poster name has two treatments** (REPEAT report — raised before, not fixed).
  `AppliedJobCard.tsx` ~169 collapsed: quiet inline avatar + name. ~293
  expanded: the same fact as a grey `bg-muted/40` band with an added "Posted
  by" label. Expanding a card should reveal more, never redraw what was
  already there. `bg-muted/40` around an identity or meta row is suspect
  generally here — the owner previously flagged the same band behind the
  location chip.
- Helper-name placement and the name in the tracking panel, poster side —
  check whether these are the same one-fact-two-treatments shape.

- One component per step; six states currently have six different layouts.
- `DisputedSection` still renders the OLD hand-rolled Photo Proof card that
  `adb4773dd` replaced elsewhere. Two designs ship side by side today.
- "Add a before photo" panel still shows in the Request-My-Payout state.
- Action row is 1-up / 2-up / 3-up with no rule; "Report a Problem" is a link
  under the row while "Can't Finish" is a chip inside it.

## Performance — audit done, NO fixes applied yet
Measured against prod, warm median:
- Postgres read ~101–118ms · edge fn without a third party ~128ms ·
  **edge fn → Stripe 395–893ms**. The third-party hop is the whole problem;
  the Deno runtime is not.
- `check-pro-subscription` (893ms) lands 570ms after everything else on
  /dashboard. `stripe-connect status` (395ms) is the "Connect to start earning"
  delay on /profile.
- **Neither is prefetched anywhere**, and 24 call sites set `gcTime: 5min`,
  which is below the threshold for React Query persistence to survive a
  rehydrate — so persistence covers the fast queries and excludes every slow
  one.
- Duplicate queries: `get_my_pending_direct_offers` ×2 per route,
  `applications?status=eq.pending` ×2, `profiles?select=ban_status` ×3 — raw
  `supabase.rpc` calls outside React Query, so no dedupe.
- CLS is 0.0000 on all five routes measured. This reads as slow, not broken —
  do not spend budget on skeletons.

## Messages screen
- **A selected thread should be the FULL page**, with back to return to the
  list. Today the list and the thread sit side by side and the thread is cut
  off. (owner, 2026-09-11)
- **Search: replace the "Cancel" text button with an × icon** —
  `ConversationList.tsx:790` (`ScreenHeaderRow`). "Cancel" is being cut off.

## Profile
- **Avatar has a square/rectangle behind the circle** — remove it. Seen on the
  profile header's 88px avatar (`AvatarFallback`), which is `rounded-full`, so
  the square is coming from something behind or around it, not the fallback
  itself.
- ~~Verified group should sort before As-a-Helpr / As-a-poster~~ — DONE,
  `RecognitionRow.tsx` GROUP_ORDER, not yet visually confirmed.

## Notification counts — REOPENED, my error
The owner reported the badge and the real numbers disagree, and noted I had
called this fixed. **They are right and I fixed the wrong thing.** Commit
`a93e5830b` only made the date-divider count LOOK like the panel's other quiet
text — a styling change. It never touched whether the numbers AGREE. Observed:
bell badge **10**, panel "Unread **11**". Two different sources of one count.
Find both and make one authoritative.

## Bugs found but not fixed
- **Every job card renders TWICE on /dashboard** (seen in the perf lane's
  screenshot). Unconfirmed cause.
- **No retry for a failed arrival.** `mark_helper_arrival` fires once and the
  tracker only moves forward, so a helper who denied location then enabled it
  has no way to re-verify and stays dependent on the poster.
- **No pre-expiry warning** on an accepted job — `AppliedJobCard` passes
  `expiresAt` only while pending, so the ghosting clock is invisible until it
  fires.

## Conventions half-applied
- **× vs labelled cancel.** `dialog.tsx` auto-hides the × when a
  `DialogSecondaryAction` registers — self-enforcing, by design. `sheet.tsx`
  renders `SheetCloseButton` unconditionally and shares none of it. Today's
  toast fix covered toasts only (2 of ~560 call sites).
- **`CardSubPanel`** was extracted today from PhotoProof; the same shape is
  hand-drawn ~59 more times.

## Verification debt
Everything shipped 2026-09-11 gated on typecheck + vitest only, because
Chromium was not installed until late in the day. **Nothing has been eyeballed**
except the guest /browse shell, the applicants card, and the poster photo
toggle. Owner's standing rule is that a visual is not done until it has been
looked at.

Harness contract for the helper job card, learned the hard way — two lanes
stalled on it:
- `useActivityData` needs BOTH the `applications` rows AND the RPC
  `get_jobs_for_my_applications` (SETOF jobs, no args), intersected on
  `job_id`. Mock only the `jobs` table and every app gets `job: null`.
- `HelperRevisionCard` reads the `job_revisions` table, falling back to
  `jobs.revision_note` — SINGULAR.
- Set `HAPPY_PATH_BASE_URL=http://localhost:5183`.
- Screenshot BEFORE asserting, and open the PNG. A spec here passed while
  photographing a page of skeletons because it asserted the capture succeeded
  rather than that anything was in it.

## Job card meta row
- **Location must always outrank "16 hours left".** At narrow widths the meta
  row drops the place name while keeping the expiry countdown — seen on
  `JobCard` in the browse feed with the map open. Where you are is the first
  filter a helper applies; how long is left is secondary. (owner, 2026-09-11)

## The job card is not one component — CONFIRMED
Owner asked directly ("is this all one component? if not fix it"). It is not:
- The category corner-tab (`rounded-br-lg rounded-tr-none`) is hand-rolled in
  **two** places — `activity/JobCardShell.tsx` and `dashboard/JobCard.tsx`.
- `activity/JobCardTitleBar.tsx` already owns title + price pill, and
  `dashboard/JobCard.tsx` reimplements the same thing inline instead.
- The price pill's literal colours (`hsl(var(--bark) / 0.10)` fill,
  `/ 0.28` border) are hand-written across 10+ files.

SEQUENCING, deliberately: this waits for lane `step-components`, which is
mid-flight defining the one shell both job cards fill. Retrofitting
`dashboard/JobCard.tsx` onto pieces whose API is still moving would be work
done twice. The moment that lane lands, the browse card adopts the same
chip / title-price / meta pieces — that is the fix, not a second set of
components.

## Notification count — STILL WRONG (reported again 2026-09-11)
My c14f86df4 fixed badge-vs-list DRIFT (setUnreadTotal was written once but the
list mutated in five places). It did not fix this. Do not re-fix drift.

One datum already gathered, prod: `lexilombas05@gmail.com` has **10** unread
notification rows, of types `application` and `new_offers` only. The bell
showed **10** — so the BELL IS CORRECT and the panel's "Unread 11" is the
wrong number. Start there, not at the badge. Suspect the panel's own
`unreadInPage`/tab-count derivation, or a row the list counts that the DB
query does not (optimistic insert, realtime dupe).

## Browse map — controls and preview card escape the map bounds
Owner, 2026-09-11 ("fix this bullshit"), with three screenshots:
- The **recenter button** (`browse-map-recenter`, BrowseMap.tsx:843) sits half
  outside the map's right edge — clipped against the boundary between the map
  and the page background.
- The **job preview card** (`aside`, the drag-handle + close-X sheet) is cut off
  at the bottom; its lower half runs past the visible map area.
Both are `position: absolute` inside the map container — check what is actually
establishing their containing block. CLAUDE.md's standing trap: any ancestor
with transform/filter/backdrop-filter/contain/will-change becomes the containing
block for absolutely/fixed positioned descendants, and the map's own chrome uses
backdrop-filter.
- **The preview card is not anchored to its pin.** Tapping a pin opens the card
  pinned to the BOTTOM of the map, nowhere near the marker that was tapped, so
  the reader has to work out which pin they are looking at. It should attach to
  (or at least point at) its own marker. Same screenshot set as above.

### Notification count — ruled out
`notifications.read` is `NOT NULL` in prod (10 false / 63 true for
lexilombas05), so the null-vs-false split between the server count
(`.eq("read", false)`) and the client filter (`!n.read`) is NOT the cause.
Next suspect: there are FOUR `<NotificationPanel />` mounts (DesktopTopNav,
AdminTopBar, DashboardTitleBar, DashboardHeader), each with its own
`notifications` array and its own `unreadTotal`, sharing no cache. Mark one
read and the others never hear about it. Lift the state into a shared query.

## Profile badges — "Verified" rung duplicates "Stripe verified"
The VERIFIED group shows "Stripe verified"; the AS A HELPR group directly
below opens with a ladder rung also called "Verified". Same fact, twice, two
inches apart. Drop the redundant one — the account-level badge above already
says it. (owner, 2026-09-11)

### DECIDED — At-a-glance stat tiles: exactly FOUR
Rating · Jobs posted · Jobs completed · Cancelled. (owner, 2026-09-11, via
pop-up, explicitly "im not asnwering this again".) Currently renders seven.
Drop: on-time %, rebooked %, needed-revisions %.

## CONSISTENCY — identity verification has FOUR renderings
One fact, four treatments, and the owner has raised this repeatedly:
1. Profile "Verified" group — **"Stripe verified"**, gold pill + shield icon
2. Profile "As a Helpr" group — **"Verified"**, ladder rung, different pill
3. Profile header — **"ID verified by Stripe"**
4. `dashboard/JobPosterCard.tsx:83` — **"✓ ID VERIFIED"**, uppercase, no pill,
   a literal ✓ character instead of the shield icon everything else uses

ONE component, ONE label, ONE treatment, everywhere. Pick the pill+shield form
(it is the one with an icon and a real badge primitive behind it) and delete
the other three. #2 is already logged separately as redundant with #1.

This is the class the owner keeps pointing at: the same fact hand-drawn per
surface. Same disease as the job card (three copies) and the price pill (10+).
- Profile: remove the white card behind the 'Finish setting up' payout banner (ProfileLanding, Profile.tsx:608) — the banner already has its own sienna-tinted surface; the liquid-glass box behind it is a second boundary. (owner, 2026-09-11)
- Reviews empty state: fix spacing — the 5-star illustration sits too close/tight above 'No reviews yet' (EmptyStateIllustration.tsx:37, EmptyReviews). Its viewBox is cropped ('2 34 116 26') so the glyph's own bounds don't match its visual weight. (owner, 2026-09-11)

## Shells leave a gap on the left and right — fix GLOBALLY
Owner, 2026-09-11: "on all these there shouldnot be a gap on the left or right
it needs to fill the space it stead rn ots showing like a small shadow look. so
fix these shells globally".

Seen on /profile?tab=availability: `AppShell` → `container mx-auto px-5 lg:px-8
xl:px-12` → `page-measure mx-auto`. The inner card stops short of the frame on
both sides, so the page reads as a narrow sheet floating on a wider surface
rather than filling it. This is the SHELL, so it affects every AppShell page —
fix once in the shell, never per page.
