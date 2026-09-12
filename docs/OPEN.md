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

## Time picker regressed to a native input — restore the scroll wheels
Owner, 2026-09-11: "this needs to be a scroll how it was before how hour time
and ap pm". The Set-hours popover now renders a native `<input type="time">`
("05:-- PM" with a clock affordance) instead of the previous hour / minute /
AM-PM scroll columns. Native time inputs are keyboard-first and look different
on every platform — which also breaks the one-surface rule, since iOS, Android
and desktop each render their own. Restore the wheel picker.

## Availability: "Until 2:44 AM" is a hardcoded 4 hours nobody chose
`AvailabilityTab.tsx:73` calls `set_available_now` with `p_hours: 4`; the live
RPC is `p_hours numeric DEFAULT 4` → `available_until = now() + 4 hours`. The
card then prints "Until <that time>" as though it were a setting the helper
picked. Tap it at 10:44 PM and it announces you as available until 2:44 AM.

Worse, the SAME SCREEN holds a second, unrelated availability system: the
weekly Sun–Sat grid (9 AM–5 PM). The grid says 9–5, the toggle says until
2:44 AM, and neither reads the other. One fact, two systems — decide which is
authoritative, and either let the helper choose the duration or derive it from
the grid's hours for today.

## From the state-matrix sweep (logged 2026-09-11)

Real screen count, derived from code, not guessed: 28 routes that render a
screen + 26 Profile tabs + 25 Admin views + Activity/Legal sections = **~73
signed-in screens**, plus **94 files containing an overlay**. 73 + 94 = ~167,
which is where "162" comes from. The owner's number was right.

- [x] **S1 · DONE (a520a50a8).** Cause: these pages pick skeleton-vs-error from
      the query's settled state, so the shared retry schedule IS the
      time-to-error. `queryClient.ts` had `retry: failureCount < 2` on TanStack's
      default backoff — three round trips plus three seconds of pure waiting.
      Now one retry with an explicit capped `retryDelay`. Measured at 375:
      /my-jobs **3.41s -> 1.15s**, /my-posts 3.42 -> 1.40, /messages 3.39 -> 1.14,
      /dashboard 1.44 -> 1.24. Retries were NOT removed — a spec that fails the
      first read then succeeds proves a blip still self-heals with no error card.
      Original report: **A backend failure shows ~20s of skeletons.** SEEN
      on /dashboard, /my-jobs, /my-posts, /messages, both widths. The designed
      "We couldn't load this / Try again" card only appears after React Query
      exhausts retry+backoff. Until then: blank pills, no message, no way out.
- [x] **S2 · DONE (a520a50a8).** Cause: `useActivityData` returned
      `loading: isLoading`, and `isLoading` is `isPending && isFetching` — false
      in exactly the two states where there is no answer yet: a disabled query,
      and a cached-empty result being refetched. So the empty state rendered
      while the read that would return the user's work was still in flight. Now
      the skeleton holds until the tab's core query has settled, and keeps
      holding during a refetch only when there are zero rows to show (so a
      background refetch never blanks an existing list). False-empty window
      **3.7s -> 0s**. Original report: **A false empty state flashes.** SEEN on
      /my-jobs at 375: "No applications yet" at 3.8s, then at 15s the same page
      says "you have 1 in Waiting". The user is told they have nothing while
      they have work.
- [x] **S3 · DONE — it was the MOCK, not the app.** `WorkRecord.tsx` reads the
      profile with `.single()`; the Playwright fixture ignored the
      `Accept: application/vnd.pgrst.object+json` header and returned an ARRAY,
      so `created_at` was undefined (`Invalid Date`) and `full_name` was
      undefined ("Helpr Member" — visible in the same screenshot). Live, both
      render correctly, and prod has 0 null `created_at` across 8 profiles.
      Fixed at source with `honourSingleObject()` in the fixture, which now
      unwraps one row or returns 406/PGRST116 like real PostgREST.
      Original report: **Work Record prints `Invalid Date`** in MEMBER SINCE — on a document
      framed as an Employment & Earnings Record for an employer.
- [x] **S4 · DONE — and Work Record was the one lying.** The Reviews tab filters
      `feedback_visible_at <= now()`; Work Record had NO reveal filter, so it
      counted reviews the app deliberately hides during the blind window. In
      prod this never surfaced only because the `reviews` SELECT policy enforces
      the reveal — verified live: as an ordinary member, 0 of 16 blind-window
      reviews are readable. **An employer-facing number must not lean on RLS for
      its correctness**, so the filter is now explicit in the page. The mock had
      a second cause: `SEED_REVIEWS` lacked `feedback_visible_at`, a column the
      prod trigger always stamps. Both fixed; the two screens now agree.
      Original report: **Two screens disagree about the same reviews.** Work Record says
      AVG RATING 4.5 (2); ?tab=reviews says "No reviews yet". Same account,
      same session.
- [x] **S5 · DONE.** The desktop rail wrapped `EmptyState variant="inline"`
      (which paints its own fill and border) inside a `.liquid-glass` card. Added
      a `bare` variant that carries layout and paints nothing. Measured:
      liquid-glass boxes in the panel **2 -> 1**, then eyeballed. Every other
      Profile tab checked at 1440 — no other nested card.
      Original report: **Nested white card inside the white panel** at
      /profile?tab=pets @1440 — the 2026-09-07 defect at a width nobody rechecked.
- [x] **S6 · DONE.** The chip row was `overflow-x-auto scrollbar-hide` — a
      horizontal scroller with no affordance, and a mouse has no horizontal
      swipe. Now wraps. Chips fully inside the card: 1440 **10/11 -> 11/11**,
      375 **2/11 -> 11/11**. Eyeballed both.
      Original report: **Skills chips clipped mid-word** at /profile?tab=profile @1440
      ("Eve…"), no scroll affordance.
- [x] **S7 · NOT A DEFECT — the mock again.** The sweep's RPC catch-all returns
      `null` for `get_helper_analytics`, and the page's `!data` branch correctly
      renders the error. Live, the RPC returns a full payload and the page
      renders the UPGRADE panel at both widths. The app is right; the temporary
      spec was incomplete. Original report: **?tab=analytics error state.**
- [x] **S8 · DONE.** The sentence was sharing a tinted box with the 44px
      switch. Switch moved up to the heading row; the sentence gets the card's
      width. Measured: description **204px / 4 lines -> 293px / 3 lines**,
      switch top 508 -> 445. Eyeballed.
      Original report: **"Instant Release" body wraps in a ~250px column** inside a
      full-width card, ?tab=auto_tip @375.
- [x] **S9 · NOT A DEFECT — deliberate.** It is `TITLE_CARD_STYLE`'s top-right
      burnt-sienna radial glow, present on every title card. Sampled 254->251 RGB
      across the right half, identical live and in the original screenshot. Left
      alone. Original report: **Messages header pill grey band** across its right
      half, @1440 empty.

Clean: zero horizontal overflow on all 54 captures; every empty state on the 15
previously-uncaptured Profile tabs is designed, not blank.

## Needs the owner — prod write

      Original report: **Duplicate seed family.** `jobs` holds two exact mirror families,
      `5eed0a…` and `5eed0b…`: 26 jobs / 24 applications / 80 messages EACH,
      all 26 titles+statuses matching pairwise, identical `created_at`. The seed
      script ran twice. This is why every job card looks doubled on /dashboard —
      it is duplicated DATA, not a render defect. Deleting one family is a
      destructive prod DELETE of ~130 rows; either family is equivalent.

## Closed 2026-09-11

- [x] **Notification panel count — ROOT CAUSE FOUND, fixed in 74bb850a9.** The
      two numbers were never out of sync; the LIST was. The bell and the chip
      read the same variable in the same component, so they cannot diverge. The
      panel fetched the latest 50 by `created_at` (a recency page) while the
      badge counted unread across the whole table. Different sets. On the
      owner's account: 73 rows, 10 unread, 63 read — and the ten unread rank
      53rd-62nd, because 63 read rows landed after them. So the page contained
      zero unread while the chip correctly said 10. Re-measured through the real
      component at that exact row shape: **unread rows rendered 0 → 10**. This
      also un-breaks Mark all read, which derived its ids from the page, found
      none, and returned early — a silent no-op on the one account that needed
      it. My three previous attempts were all correct and all irrelevant: no
      amount of sharing one variable makes a page contain rows it never asked
      for.
- [x] **Job cards render twice — was duplicated seed data, not a render defect.**
      Closed by the prod delete above.
- [x] **Browse map pin anchoring.** Nothing mirrored MapKit selection into the
      DOM, so every pin stayed 44x44. Selected pin is now 64x64 with a halo and
      a caret in that pin's screen column. Recenter and card overflow did NOT
      reproduce (12/13px inside; the card sits 112px above the edge, which is
      `MAP_DOCK_CLEARANCE`) so they were left alone.
- [x] **Arrival retry.** `mark_helper_arrival` verified idempotent live — a
      second call can only add the verified stamp. "Try my location again" added
      while arrival is `claimed`; it never advances the rail.
- [x] **Hardcoded availability vs the weekly grid.** The grid is authoritative:
      it is the only one the helper configured. Was "Until 2:44 AM" over a 9-5
      grid; now "Today's hours ended at 5:00 PM · signal 2 more hours". A
      MISSING row resolves to what the grid draws, not to "off" — reading it as
      "off" reintroduced the contradiction in one step, caught by screenshot.
- [x] **Time-picker scroll wheels.** The native-input swap was keyed on the
      DEVICE while the problem it solves is the CONTAINER, so it fired inside a
      fixed 300px popover too. Wide desktop forms keep it; the popover opts out.
      Verified `nativeTimeInputs: 0`, wheels + AM/PM at 1440 and 393.

Not a defect: the lone `animate-pulse` is `MobileNav.tsx:779`, the `aria-hidden`,
`motion-safe`-gated halo behind the Post FAB. Screenshot specs should exclude
`[aria-hidden]` rather than assert "no pulse" — and note a `.animate-pulse`
class selector misses it entirely, since it is `motion-safe:animate-pulse`.

Open, small: the bell abbreviates at "99+" while the chip prints the true total.
Now reachable in prod. Mild disagreement, not yet fixed.

- [x] **`Admin.tsx` / `UserProfile.tsx` "hand-roll min-h-screen" — NOT a defect,
      2026-09-11.** I filed these two myself and I was wrong. CLAUDE.md defines
      TWO legitimate page shapes, and document-scroll pages are supposed to use
      a plain `min-h-screen bg-premium-page pb-safe-nav` wrapper and explicitly
      NOT `AppShell`. Both `/admin` and `/user` are in `DOCUMENT_SCROLL_ROUTES`.
      `ALLOWED_SHELLS` had no entry for their category, so the test manufactured
      two offenders. The danger was the FRAMING, not the false positive: the
      comment said the list "must only ever SHRINK" and "deleting an entry is
      the fix", which aims the next reader at wrapping both in `AppShell` —
      breaking them twice (clipped below the fold under `overflow: hidden`, and
      a second rail inset on top of `#root`'s). Category now derives from
      `DOCUMENT_SCROLL_ROUTES`, exempt-by-name is gone.
- [x] **`/terms`, `/privacy`, `/rules` lost their native viewport lock — FOUND
      BY THE NEW GATE, fixed 2026-09-11.** `8570fdbef` made them real routes
      three commits ago and added them to `DOCUMENT_SCROLL_ROUTES` but not to
      `NATIVE_APP_SHELL_ROUTES`. On native they rendered `Legal.tsx` through
      `AppShell` with no `html.app-shell` class — the internal scroll container
      without the lock that makes it work — on three quarters of the legal
      surface, which is exactly the iOS notch-ghosting bug that list exists to
      prevent. Gate proved by mutation: every half fails when broken.
- [x] **"7 dead page files to delete" — WRONG, do not delete them (2026-09-11).**
      `AutoTip`, `HelprWrapped`, `HomeHistory`, `PetProfiles`, `StrSettings`,
      `HelperAnalytics`, `WorkRecord` and `GiftCard` are all LIVE: every one is
      imported by `src/pages/profile/ProfileTabPanels.tsx` and renders as the
      body of a Profile tab. They are unROUTED, which is what the orphan check
      reported, and "unrouted" was read as "dead". Deleting them would have
      blanked eight Profile tabs. The orphan assertion should say "routed by
      nothing AND imported by nothing" — as written it describes a real
      condition but names it misleadingly.

## Public-site visual pass (lead, 2026-09-11) — 20 routes captured at 375 and 1440

- [x] **Automated-test debris on the PUBLIC browse page — DONE 2026-09-11.**
      Deleted the 19 test jobs that carried no financial records (with 12
      applications, 7 reviews and 117 notifications), including BOTH publicly
      visible rows. Backup: `docs/backups/test-debris-backup-2026-09-11.json`.
      Re-measured the finding's own repro: test titles in `open_jobs_browse`
      **2 -> 0**, and confirmed by eye in a fresh capture of guest `/browse` at
      375 — the `[sweep-poster]` card is gone.

      **49 rows deliberately NOT deleted.** They carry payout_transfers,
      refunds, tips, disputes, W9 or PIF-credit records. `payout_transfers` is
      ON DELETE RESTRICT, so a settled job cannot be deleted by anyone anyway —
      and deleting settled money to tidy a list is worse than the list. None of
      the 49 is `open`, so none is publicly visible.

      **My "the spec never cleans up" claim was WRONG — correcting it.**
      `scripts/e2e/prod-lifecycle-sweeper.mjs` already exists, already runs in
      `e2e-real-backend.yml`, and already documents this exact residue and the
      exact ON DELETE RESTRICT constraint I then hit. The evidence it works:
      the newest test row is 2026-09-09, and dozens of CI runs have happened
      since with zero new rows. The accumulation had already stopped before I
      looked; what I deleted was historical residue from before it landed. The
      The sweeper keys on `[E2E DO NOT ACCEPT]` and never covered the 7
      sweep-harness titles (`[SWEEP]`, `[sweep-poster]`, `Sweep test`), which is
      where both public rows came from — but that is NOT a gap to fix either:
      grepped the whole repo and nothing creates those titles. The only match is
      a code COMMENT in `HelperRevisionCard.tsx:75` citing "the [SWEEP] patio
      job". They were typed by hand by an audit lane on 2026-09-07/08. No
      recurring source, so no sweeper change is warranted. NOTHING TO DO HERE.

      Original report: **Automated-test debris is live in prod.** SEEN at 375 on guest `/browse`: the first card
      reads `[sweep-poster] Deep clean before...`. Prod holds **68** such rows:
      61 titled `[E2E DO NOT ACCEPT] automated lifecycle …` and 7 from the sweep
      harness (`[SWEEP] …`, `[sweep-poster] …`, `Sweep test — …`). All are
      `is_seed = true`, so the launch switch will hide them — but that is an
      argument about launch day, not about today, and a visitor on the site now
      sees a bracketed test title as the top job. Two are `status = 'open'`:
      `[sweep-poster] Deep clean before move-out` and
      `Sweep test — deep clean kitchen`.
      The growth matters as much as the rows: first seen 2026-09-07, last
      2026-09-09, ~20 a day. The E2E lifecycle spec creates and never cleans up.
      Deleting is a prod DELETE; the spec also needs to clean up after itself.

Verified clean, so these can stop being re-reported:
- **Legal tab pills are NOT unequal.** Measured all three at 375: Terms, Rules
  and Privacy are each exactly **86px**, `flex: 1 1 0%`. The selected pill only
  READS wider because it is the filled one. Backlog item was stale.
- **The selected Legal pill does carry real gloss.** Computed `background-image`
  on its `btn-grad-primary` child is a genuine `radial-gradient(...)`, not a
  flat fill — checked the computed value, not the class name, per CLAUDE.md.
- **The grey Apple chip in the footer is deliberate**, not a broken asset:
  Apple and Instagram are `disabled` "coming soon" chips, Facebook is the only
  live account. Reasoned in the code.
- **The 404 page is fine** — "404", an explanation, Go Back and Back to Home,
  with the marketing footer. The temp spec's matcher was wrong, not the page.
- **/legal at 1440 fits correctly**: `#root` padding-right 248px applied once,
  content column 48→1144 centred in the 1192 post-rail area, zero overflow.
- **/dashboard at 375 fits**: frame 0→375 full width, zero overflow. Five
  distinct job cards, no doubling — the seed delete is confirmed VISUALLY, not
  just by a row count.

## Reports from the loading-states lane (not fixed, out of its scope)

- [x] **DONE f2b63d921.** Repro confirmed exactly: load /my-jobs empty, add an
      application server-side, reload -> **0** network requests for 60s while the
      page states the account has nothing. The persisted IndexedDB cache is what
      lets it survive a reload. Fix: `refetchOnMount: "always"` on the two
      activity CORE queries. Measured: `/rest/v1/applications` requests after
      reload **0 -> 1**; "No applications yet" at t=5s and t=8s **shown ->
      never**. Deliberately NOT `staleTime: 0` (that destroys the cache's
      purpose — every observer, tab switch and focus becomes a fresh wave), and
      NOT a zero-row-only stale window (a cached list of three that is now four
      is wrong the same way; the defect is "we re-showed a cached claim without
      checking it", not "empty is suspicious"). Cores only — details re-key off
      the core result and refetch anyway. Regression checked: populated cache +
      a 6s-slow revalidation paints rows at 800ms and never blanks to skeleton.
      Original report: **60s-stale empty list with NO refetch.**
      Within `CORE_STALE = 60s`, a user who just gained an application saw
      "No applications yet" for the full staleness window with zero network
      requests issued. Not a loading-state bug, so that lane left it — but it is
      a real "your work is invisible" window.
- [x] **DONE f2b63d921.** The toast now fires only when the panel is open and
      ALREADY showing rows. Measured: toast alongside the page's error card
      **t=1.5s to ~5s -> none**. Panel opened while failing with no rows still
      shows its inline card with Try again, 0 toasts. Eyeballed at 375 — one
      card, nothing floating over it.
      Original report: **two error messages for one outage** — a persistent
      inline "Couldn't load notifications — try again?" banner lingering ~4s
      beside the page's own error card.
- [x] **DONE f2b63d921 — and it was MUCH worse than I reported.** I said "10s
      plus a retry". It was **three** attempts: the query carried its own
      `retry: 2`, which is exactly why a520a50a8's retry-schedule change never
      reached it — this was the one query silently opting out of the shared
      client policy, so the global fix looked applied and wasn't. Measured
      against a hanging `/rest/v1/profiles`: time to "We couldn't load your
      account" **32.2s -> 13.0s**. Timeout 10000 -> 6000, and the local `retry`
      override removed so one place decides time-to-error. That also stops it
      retrying 4xx profile errors, which it was doing.
      Original report: **PROFILE_QUERY_TIMEOUT_MS is 10s per attempt.**
      Against a HANGING (not 500ing) backend, ProtectedRoute's account-level
      error card still costs 10s + a retry. The retry-count fix helps, but the
      10s timeout is the dominant term there.
- [x] **DONE — confirmed viewport-independent.** /my-jobs 935ms @1440 vs 923ms
      @375; /dashboard 1906ms @1440 vs 1910ms @375. Screenshots opened and
      looked at: designed error card, rail correct on the right, no dead gutter.
      **Measurement caveat worth keeping:** the pre-fix /dashboard number read
      1384ms and post-fix 1906ms. That is NOT a regression — the locator
      `/couldn't load/i` was matching the notification TOAST before it was
      removed. A measurement that was quietly measuring the wrong thing, which
      is the exact hazard CLAUDE.md names.
      Original report: **1440 not re-driven for S1/S2.** The fix is entirely in the data layer so
      it is viewport-independent, but it was verified at 375 only.

## CI reliability (lead, 2026-09-11)

- [x] **The anon surface contract failed the build on a lie — fixed d5b193c56.**
      `E2E real backend` went red at `b7bc81eb` with: *"public.get_ranked_open_jobs
      — the anon ranked-jobs RPC surface — answered anon with HTTP 504. A
      signed-out visitor sees nothing there."* None of that was true. I checked
      the object rather than the message: it is not a view and not broken — it
      is `get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)`,
      runs in **31ms**, and has no client caller. `probeSurface` decided the
      object's kind from `table probe status !== 404`, so ANY transient gateway
      error short-circuited to `kind: "view"` carrying the 5xx, and the failure
      text then described a public outage that was not happening.
      The next push went green with nothing fixed — the self-healing red
      CLAUDE.md warns about twice. Re-measured against live prod:
      `504 view … rows=-` **→** `200 rpc … rows=9`, whole contract passes.
      Worth noting this was NOT caused by the seed/test deletes, which is the
      first thing I checked given the timing.

- **Notification count — CONFIRMED BY EYE 2026-09-11, on real prod data.** Not a
  count, not a test: opened the panel at 375 in Chrome against the owner's own
  account and LOOKED. Bell badge **10**, "Unread" chip **10**, "THIS WEEK 10",
  and **ten actual unread rows** rendered, each with its unread dot, default tab
  Unread. The panel is 375 wide and 650 tall at top 86 — full width, correctly
  sized, so it is not caught by the transformed-ancestor `position: fixed` trap.
  After three fixes I called done without looking, this one was looked at.

  Aside, not a defect: the bell's click did not register through the browser
  pane's synthetic click; a real `.click()` opens it. Worth knowing so nobody
  files "the bell does nothing" from an automated driver.


## The mock boundary lied three times in one sweep (2026-09-11)

Three of the seven state-matrix "defects" (S3, S4-in-part, S7) were the
Playwright fixture, not the app — and they were filed as SEEN because they WERE
seen, in a screenshot. This is the `mock-boundary-is-why-audits-missed-it`
pattern running in reverse: usually the mock hides a real defect; here it
manufactured three. Both directions have the same root: **a fixture that does
not behave like PostgREST**. The `.single()` bug is the sharpest case — the
fixture ignored the object-Accept header for every `.single()` call in the app,
so ANY page reading one row got an array and rendered undefined fields.
Fixed at source, so the next sweep inherits a fixture that tells the truth.

Two follow-ups worth keeping:
- [x] **`formatMonthYear` printed `Invalid Date` — DONE 7b4cbc59a.** It now
      returns null and the Work Record drops the whole "Member since" field.
      An absent row reads as "not shown"; the literal string reads as a fact
      about the person, on a document framed to its reader as an Employment &
      Earnings Record for an employer. Prod cannot produce it today, but the
      page reached exactly this state on 2026-09-11 via the fixture bug. Proved
      by stashing the guard: the new test fails `expected 'Invalid Date' to be
      null` without it, 20/20 green with it.
- [x] **`zz-tmp-state-matrix.spec.ts` DELETED** along with the other three temp
      sweep specs. It mocked only two RPCs, so any RPC-backed tab always showed
      its error state in it — which is how it manufactured the analytics
      "defect". A spec that produces confident, empty evidence is worse than no
      spec.


## New, from the data-freshness lane (2026-09-11)

- [ ] **/dashboard at 1440 shows TWO error cards for one outage** — "We couldn't
      load jobs" and "We couldn't load the map", side by side
      (`/tmp/freshness/r4-dash-1440.png`). Each panel legitimately owns its own
      read and the map panel only exists at desktop, but it is the same
      one-outage-many-messages shape just fixed for the toast. Desktop dashboard
      layout was not that lane's scope.
- [ ] **One branch is code-verified but NOT runtime-verified.** The notification
      toast's "panel open and already showing rows" branch is only reachable via
      pull-to-refresh or a realtime event; the harness stubs realtime inert and a
      synthetic touch gesture did not fire the pull handler (instrumented: 0
      notification requests after the gesture). The branch was kept because it is
      the conservative narrowing — without it that case goes silent — but it was
      not proven to fire. Said plainly rather than counted as verified.

## The audit apparatus was the bug (lead, 2026-09-11)

- [x] **The admin visual sweep had never photographed a single admin view — fixed
      431d63125.** Ran it myself. All 25 admin captures came back
      **byte-for-byte identical**: every one a photograph of
      `RouteErrorBoundary`'s chunk-load state ("Update ready."), and the run
      reported **25 passed**. axe is perfectly happy with an error boundary — it
      is a heading and two buttons, and it is accessible. So the one check the
      file exists to perform had never run against a single admin view, and said
      green. The gate already failed a screen that did NOT render (a thrown test
      leaves `totalViolations` undefined); it did not fail a screen that rendered
      SOMETHING ELSE, and that hole was wide enough to drive the whole admin
      surface through. Now every capture is checked for the crash boundary, the
      chunk-load boundary and the account-error card. Proved both ways: red
      against the dev server naming both screens, green against a correct build.
      A second, quieter hole found on the way: without `PLAYWRIGHT_WEB_SERVER=1`
      all 25 tests pass in **672ms writing no images at all**.
- [x] **The 25 admin views are now actually captured** — 25 PNGs, 25 distinct,
      in `/tmp/ui-review/`. Admin Jobs and Admin Health both render correctly and
      read well. This is the first time anything in Admin has been looked at.

- [ ] **Nested white card inside white card — SYSTEMIC, needs the owner's call.**
      Two lanes hit it independently today: `/profile` landing draws 4
      (`SettingsSection.tsx:44` — each WORK / MONEY group is a `liquid-glass`
      card inside the outer `liquid-glass` wrapper), and Admin Health's
      "Configuration Checks" does the same (white bordered rows inside a white
      bordered card). It is the 2026-09-07 defect class. It is NOT being fixed
      unilaterally because the code records the owner ASKING for the eyebrow
      grouping ("better organization", 2026-08-24). Suggested shape: keep the
      eyebrows and the inner cards, drop the OUTER wrapper's material.

## Notification duplicates — I was wrong, and the lane found the real one

- [x] **My four "duplicate" groups were a FALSE POSITIVE — retracted.** My
      grouping key omitted `link`. Each "pair" was two DIFFERENT jobs with
      identical titles: `/jobs/5eed0a10-…-005` vs `/jobs/5eed0b10-…-005` — the
      duplicate seed families. One sweep run legitimately visited both copies, so
      `NOW()` matched to the microsecond. With `link` in the key: **0 groups over
      14 days**. `sweep_job_start_reminders()` was read live via
      `pg_get_functiondef` and is correct — single-table scan, no join
      multiplication, gated on `start_reminder_sent_at IS NULL`. My "join
      fan-out" hypothesis was wrong. The `admin_alert` repeats are also correct
      (24h dedupe window; those timestamps are 30h apart).
- [x] **The REAL defect, found by widening the search — fixed 870279f8f.**
      `saved-helper-availability-push` stores its "already notified" cursor with
      `.update(...).eq("user_id", id)`. For a customer with **no `profiles` row**
      that matches zero rows and PostgREST returns `{ data: null, error: null }`,
      so the `if (updateErr)` branch never fired, the cursor never advanced, and
      the identical notification re-sent **every 6 hours forever**. This is
      exactly CLAUDE.md's "a null error does NOT mean the write happened".
      Live: **40 byte-identical rows** to one user, timestamps exactly `:41`
      every 6h since 2026-09-07, still growing — and that user has no row in
      `profiles` OR `auth.users`. Fix: skip a pair whose cursor cannot be stored,
      and guard the write with `.select("user_id")` treating 0 rows as a defect.
      Plus a BEFORE INSERT trigger refusing an exact repeat of
      `(user_id, type, title, message, link)` within 10 minutes, counted in
      `notification_dedupe_suppressions` so suppression is never silent.
      Window chosen from the live table, not taste: across all 580 rows in
      history exactly ONE pair would have been caught. Migration applied 3x under
      PGlite (replay-safe); new test has a negative control so it cannot pass
      vacuously. Existing 40 rows NOT deleted — not authorised.

- [ ] **`favorite_helpers` has no FK on `customer_id`/`helper_id`** — 7 of its 12
      live rows point at a customer in neither `profiles` nor `auth.users`.
      `notifications.user_id` has no FK either, which is how rows were written
      for a user that does not exist. Reachable with no other bug.

## Authed visual sweep — REAL session, not mocks

- [x] **Messages painted a broken-image glyph for the other party, every row and
      the thread header, both widths — fixed 4a8690448.** Verified live: that
      profile has a truthy `avatar_url` and storage answers **HTTP 400**.
      `ConversationRow` and `ChatHeader` each hand-rolled an `<img>` with no
      error path, so the browser drew its broken-image icon. `/user/:id` showed
      initials for the same person because it goes through `UserAvatar` — the
      hand-rolled copies were the bug, exactly the "never hand-roll" rule. Both
      now use `UserAvatar`. Re-measured: visible broken `<img>` **10 -> 0** at
      both widths, 14 monograms painted.
- [x] **/payment-success at 1440 pinned its card to the left edge** with ~940px
      of dead canvas — fixed in the same commit. AuthShell's column defaults to
      `items-start` and this page has no brand panel to balance it. Re-measured:
      card 48–496 **->** 496–944, centre 720 = viewport centre.
- [ ] **"Get notified?" toast covers the My Jobs title card at 375.** Measured:
      toast at y 8–84, the `<h1>` at y 31–51, and `elementFromPoint` over the
      title returns the toast. Harmless at 1440. Moving it means changing the
      toaster position app-wide, so it belongs to whoever owns toasts.
- [ ] **AccountDenied / AccountBanned likely share the /payment-success defect** —
      same `AuthShell` call with no `centerColumn`, where AccountPending passes
      `align="center"`. CODE READ ONLY, not reproduced live, not touched.
- [ ] **The open message thread at 1440 has no card boundary** — every other
      authed page draws in a panel; the thread paints straight on canvas with a
      composer whose white band ends abruptly. Centred correctly. Design call.

Clean and worth recording: every authed route measured **zero horizontal
overflow** at 375 and 1440, and at 1440 the rail inset was applied exactly once
on every one.

## Deploy + gate verification (lead, 2026-09-11)

- [x] **Both halves of the notification fix are LIVE in prod, verified by object
      state rather than run colour** (CLAUDE.md: a green run is not a deploy).
      `Supabase DB Deploy` green on 870279f8f, and in prod
      `to_regclass('public.notification_dedupe_suppressions')` resolves and
      `pg_get_triggerdef` shows
      `CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON
      public.notifications FOR EACH ROW`. `Supabase Edge Functions Deploy` also
      ran and succeeded on the same sha, so the cursor fix is live too.
      (I briefly thought the trigger had not landed — my own query filtered on
      `tgname ilike '%dedupe%'` and the trigger is named `suppress_…`. The
      filter was wrong, not the deploy. Worth recording because "verify by
      object state" only works if the query actually asks the right question.)

- [x] **I broke CI and CI caught it — 5f7113ba1.** Making `formatMonthYear`
      return `string | null` broke the PDF export, which assigns it into a
      `[string, string]` column tuple: `TS2322` in `workRecordDocument.ts:395`.
      I had gated on `parsecheck` + a scoped vitest run and never ran the
      typecheck — which is precisely the case CLAUDE.md describes when it says a
      clean parse is never a substitute for `tsc -b --noEmit`. Fixed by dropping
      the column rather than coercing it, matching the on-screen behaviour.
      Full typecheck now clean, 20/20 tests green.

- [x] **Temp sweep specs deleted** (`zz-tmp-authed-verify`, `zz-tmp-public-verify`,
      `zz-tmp-state-matrix`, `zz-tmp-thread-verify`). They were untracked, so CI
      never saw them, but they broke the LOCAL typecheck with implicit-any errors
      and — worse — `zz-tmp-authed-verify` photographed loading skeletons while
      passing. Keeping a spec that produces confident, empty evidence is how the
      audits kept missing things.
- [x] **deadcode gate went red, now green — 980c82a2a.** Two unused files, both
      orphaned TODAY rather than found lying around: `MessagesEmptyThread` by my
      own removal of the Messages two-pane split, and `HelperBadges` by the
      identity work in `aa4ef9034`. Deleted both. Three comments named
      `HelperBadges.tsx` as a live surface; deleting the file without touching
      them would have left three confident statements pointing at something that
      no longer exists — the exact failure mode that made this codebase hard to
      audit. They now describe the surface, not the filename. NOT touching the
      131 unused exports: dead code you happen to notice is a report, not a task.
      `Test` workflow green on 980c82a2a.

## Owner decisions, 2026-09-11

- [x] **The 40 orphaned availability notifications are DELETED** (owner
      approved). Backed up first to
      `docs/backups/orphan-availability-notifications-2026-09-11.json` — all 40
      rows, 40 unique ids, every field. Re-measured: rows for that user
      **40 -> 0**, and `title ilike '%updated availability%'` across the whole
      table is now **0**. The newest row was 2026-09-12T00:41, i.e. the flood was
      still running right up to the deploy; the next 6-hourly tick at :41 is the
      forward proof that it stays at zero.
      (Note for anyone reading the delete: `returning` plus a count subquery in
      ONE statement reports the pre-delete snapshot — it said "deleted 40,
      remaining 40". The remaining count has to be a separate statement.)

- [ ] **Nested white cards: owner ruled KEEP THE GROUPS, DROP THE OUTER CARD.**
      The WORK / MONEY group cards and their eyebrow labels stay exactly as they
      are; the outer wrapper stops painting a white card and a border, so there
      is one boundary per group instead of a box inside a box. Applies
      everywhere it appears — `/profile` landing (`SettingsSection.tsx:44`, 4
      instances) and Admin Health's "Configuration Checks" at minimum. Sweep for
      others rather than fixing only the two that were seen. NOT YET DONE.

- [ ] **Missing foreign keys: owner ruled INVESTIGATE AND REPORT FIRST.** No
      schema change yet. Work out what would break, how many existing rows
      violate each constraint, and what account deletion is supposed to do here
      (remember deletion ANONYMISES rather than deletes, so a naive FK with
      CASCADE would destroy history the app deliberately keeps). Bring back a
      concrete plan. Applies to `favorite_helpers.customer_id` / `.helper_id`
      (7 of 12 live rows orphaned) and `notifications.user_id`.
