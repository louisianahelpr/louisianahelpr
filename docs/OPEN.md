# Open list

**This is the ONLY open-work list** (owner, 2026-09-12). Handoff memories, the
audit-bus ledger and agent reports are evidence, not backlogs: anything still
open from them gets a line here, with the check that guards it once one exists.

Written 2026-09-11. The point of this file is that the backlog stops living in
chat scrollback. Anything not in here is either done or forgotten, and both of
those are answerable by reading this instead of guessing.

Grouped by SURFACE, not by the order it was noticed — because most of these are
instances of a few shared problems, and fixing them surface-by-surface costs a
fraction of fixing them one report at a time.

---

## SECURITY — contact-detail smuggling in bios & job descriptions (terminal 7, 2026-09-12)

**Class: contact filter not applied to every user-authored text surface.** The
server gate `public.contact_leak_reason(text)` is called BEFORE INSERT only on
`messages` (`scan_message_content`) and `applications`
(`scan_application_contact_info`). Verified live on 2026-09-12
(`information_schema.triggers`): there is **no** contact-scan trigger on
`profiles` or `jobs`. So a phone number, email, or off-platform-payment phrase
in a **profile bio** or a **job description** is stored verbatim and shown to the
other party, never flagged — the same disintermediation the message gate exists
to prevent, on two surfaces that skip it entirely.

- **Repro (live):** as `poster-e2e`, `POST /rest/v1/jobs` with
  `description: "Regular text. reach me at 504-555-0100"` → row stored, no
  `flag_reason`, visible to any selected helper. Same with a `profiles.bio`
  PATCH containing `"call 504-555-0100 or venmo me"`.
- **Check (proven able to fail):** `e2e/journeys/abuse/contact-smuggling.spec.ts`
  asserts the strings are stored verbatim TODAY (documenting the gap); the day a
  scan trigger is added it flips and forces the assertion to be updated to expect
  a flag. `src/lib/contactFilterParity.test.ts` locks client↔server parity.
- **Fix (needs owner OK — trust-surface migration):** add a BEFORE INSERT/UPDATE
  trigger on `jobs.description` and `profiles.bio` calling `contact_leak_reason`,
  hiding/flagging on a hit (mirror the messages behaviour). Not applied — this
  is a prod DDL change on a trust surface; awaiting owner go.

## SECURITY — server contact gate misses hyphenated-domain emails (terminal 7, 2026-09-12)

**Class: client scanner stricter than the authoritative server gate.** The email
branch of `contact_leak_reason` is `[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}` — the
domain label has **no hyphen**, so `jane@my-domain.com` is NOT detected
server-side. The client `messageScanner.ts` DOES catch it (`[a-zA-Z0-9.-]+`), so
a normal user is warned — but a **direct-API sender bypasses the client entirely**
and the message is delivered unflagged. Confirmed by
`src/lib/contactFilterParity.test.ts` (the `serverLeakReason` replica returns
null for the hyphenated domain).

- **Fix (small, needs owner OK — trust migration):** widen the server domain to
  `[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}` and keep the client in sync. Test in
  place to lock it. Not shipped — trust-function DDL, awaiting owner go.
- **Documented limitation (both layers):** `"jane (at) gmail (dot) com"` worded
  obfuscation evades client and server alike; noted, not currently in scope.

## Terminal 7 suites shipped (2026-09-12)

- `e2e/journeys/abuse/` — IDOR & authz matrix (cross-account read/write refusal,
  self-review, review-without-completed-job, self-application, poster money-column
  lock) + contact smuggling. API-level, RLS-pinned to the live policies.
- `e2e/journeys/notifications/` — `create-notification` authz/link/type
  sanitisation, preference OFF round-trip, real in-app link opens its screen with
  no error page, trigger→in-app row→email_send_log on a funded thread.
- Inventory: `docs/audit/notification-inventory.md`.
- Nightly + dispatch: `.github/workflows/e2e-abuse-notifications.yml` (shared-
  accounts concurrency group; pre/post sweeper).

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

## Race conditions — proven on prod 2026-09-13 (terminal 3, seed accounts, all fixture rows deleted)
- **PROVEN 14/20 — apply vs cancel.** `enforce_application_job_state()` read the
  job without a lock; the INSERT then waited on the FK behind
  `poster_cancel_job()`'s `FOR UPDATE` and committed a `pending` application on
  the `cancelled` job (job xmin < application xmin in every bad round), with a
  "New application" notification to the poster who had just cancelled. Fix in
  migration `20260913014328` (`SELECT … FOR SHARE`). **Re-measured after
  db-deploy 34732902550 (d0471d07f): 0/20** — every round was apply-first or
  `job_not_open`. CLOSED.
- **PROVEN 5/20 — helper confirm vs cancel (money).** The plain-offer confirm at
  `useOfferHandlers.ts` is a client `UPDATE jobs SET helper_confirmed_at` with
  no status predicate; queued behind the cancel it stamped a CANCELLED job.
  `poster_cancel_job` had recorded `$0 / no strike / "no fee applies"`, but
  `void-cancelled-payments` recomputes committed from `helper_confirmed_at` and
  would have captured 25% ($25 of $100) from the poster. Fix in the same
  migration (`trg_confirm_on_live_job`, 42501 unless OLD.status ∈ open|accepted)
  plus `.eq("status","accepted")` on the client. PGlite: 16/16 after, 8 red
  before. **Re-measured after deploy: 0/20** — every cancelled row is either
  confirmed-then-cancelled (fee == cron fee, one strike) or unconfirmed with
  $0; a clean confirm on an accepted job still succeeds (1/1). CLOSED.
- **NOT REPRODUCED 0/20 — direct-offer accept vs cancel.** `respond_to_direct_offer`
  and `poster_cancel_job` both lock with `FOR UPDATE`; every round was either
  accept→cancel (fee $25 == cron $25, one strike) or cancel→`job_not_open`.
- **Unreachable — "apply at the old price".** `enforce_poster_jobs_money_lock`
  refuses `budget` once `payment_status <> 'unpaid'`, unfunded jobs are on no
  browse surface, and `applications` has no price column. No test written.
- **Class check still owed (prevent, don't chase):** a CI check that every
  trigger/RPC reading `jobs` before a dependent write does so under a row lock
  (`FOR SHARE`/`FOR UPDATE`), and that no client `UPDATE jobs` that stamps a
  lifecycle column lacks a `status` predicate. Not written yet.
- **PGlite cannot prove lock ordering** (single connection); the `FOR SHARE`
  half is proven only by the prod re-run above. A two-connection Postgres in
  CI (`db-smoke`) could run the race harness nightly.

## Bugs found but not fixed
- **Every job card renders TWICE on /dashboard** (seen in the perf lane's
  screenshot). Unconfirmed cause.
- **No retry for a failed arrival.** `mark_helper_arrival` fires once and the
  tracker only moves forward, so a helper who denied location then enabled it
  has no way to re-verify and stays dependent on the poster.
- **No pre-expiry warning** on an accepted job — `AppliedJobCard` passes
  `expiresAt` only while pending, so the ghosting clock is invisible until it
  fires.
- **Complete Profile: input values clipped by the check icon at every phone
  width** (prod, 2026-09-12, Chromium + WebKit). `48b0d9b23` added the ZIP
  check with `pr-10`; at 375 the ZIP field leaves 29px for a 48px value and
  prod shows "705"/"528" (320→11px, 390→34px, 430→47px, all <48). Same class
  hits Last name ("Incomplet"). Edit Profile got a fixed ZIP column in
  `41cacda14`; Complete Profile did not. Repro: `admin-e2e`/`incomplete-e2e`
  sessions, `/complete-profile` at 375.
- **PostJob `PhotoUpload` focus ring never paints.** `dbed7befd` added
  `focus-within:ring-2`, but the label's inline `style={{ boxShadow: "inset …" }}`
  (`src/components/postjob/detailsSection/PhotoUpload.tsx` ~139-143, ~227-231)
  overrides Tailwind's ring (also box-shadow). Keyboard users get a named,
  focusable picker with no visible focus. Measured on prod 2026-09-12.
- **A brand-new account is asked to "Re-Agree"** — `TermsReconsentDialog`
  opens for a profile that never accepted any version (`terms_version_accepted`
  empty), on top of the Complete Profile gate. Copy says "re-agree" and
  "material update" to someone seeing the Terms for the first time. Seed
  accounts now pre-accept in `prod-seed.mjs` so the sweep gets past it.
- **Still unverified on prod after today's `dbed7befd`:** `role="img"` spans
  (no urgent/boosted/just-posted/pinned rows were live), admin KPI tile height
  + fraud-filter select 44px (now reachable via `admin-e2e`).

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

- [x] **DONE e59a7ff85 — reproduced, then fixed.** With every non-account read
      500ing at 1440: "We couldn't load jobs." at x=93 and "We couldn't load the
      map." at x=663, side by side — two triangles, two Try again buttons. The
      desktop map column is now gated on the EXACT condition the feed uses for
      its own card, so the two cannot disagree. Cards **2 -> 1**; card width
      **481 -> 1006** (spans the panel). `mapVisible` untouched so the column
      returns the moment the feed has rows; healthy 1440 re-verified unchanged.
      The map toggle is disabled while that card is up, since with the column
      suppressed it would be an affordance guaranteed to do nothing.
      Original report: **two error cards for one outage** — "We couldn't
      load jobs" and "We couldn't load the map", side by side
      (`/tmp/freshness/r4-dash-1440.png`). Each panel legitimately owns its own
      read and the map panel only exists at desktop, but it is the same
      one-outage-many-messages shape just fixed for the toast. Desktop dashboard
      layout was not that lane's scope.
- [x] **NOW EXECUTED (b941fbfcd).** `NotificationPanel.refreshToast.test.tsx`
      renders the real panel and drives the real `loadNotifications` through the
      pull-to-refresh callback. Open panel with rows + failed refresh → toasts;
      closed panel → silent. Proved both ways: removing the branch fails one
      test, making it unconditional fails the other.
      Original: **One branch is code-verified but NOT runtime-verified.** The notification
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

- [x] **Nested white card inside white card — SUPERSEDED.** The owner ruled on
      this (see "Nested white cards" under Owner decisions below); a lane is
      applying it. Kept for the evidence, not as a separate task.
      Original report: **Nested white card inside white card — SYSTEMIC.**
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

- [x] **SUPERSEDED — see the full investigation under Owner decisions below.**
      Original report: **`favorite_helpers` has no FK** — 7 of its 12
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
- [x] **DONE e59a7ff85 — and WORSE than I logged it.** The toast does not
      overlap the title card, it REPLACES it: toast y 8–84, the title card owns
      the same band, so `<h1>My Jobs</h1>` is invisible and its two controls —
      **"Search jobs" and "Filter by status" — are unreachable for the full
      12 seconds**. No offset fixes that; the title card owns the top band by
      design. The shared `<Toaster>` was NOT moved: the nudge alone opts out per
      toast to `bottom-center`, and only below the Toaster's own 768px
      breakpoint, so at 1440 it is untouched. The added bottom offsets were
      verified inert for top-anchored toasts rather than assumed — an ordinary
      toast still lands at y 8 at 375 and y 24 at 1440. Nudge at 375
      **y 8–84 over the title -> y 640–716**, 32px clear of the dock; occluded
      controls **2 -> 0**.
      And the answer to why it fired on /my-jobs but not /dashboard: it is not a
      global toast at all. `usePushPermissionNudge` is called only from
      `Activity.tsx` and `useActivityActions.ts`.
      Original report: **"Get notified?" toast covers the My Jobs title card** Measured:
      toast at y 8–84, the `<h1>` at y 31–51, and `elementFromPoint` over the
      title returns the toast. Harmless at 1440. Moving it means changing the
      toaster position app-wide, so it belongs to whoever owns toasts.
- [x] **DONE e59a7ff85 — it DID reproduce.** There is no denied or banned
      account in prod, which is why nobody had ever walked into it; the lane
      rewrote `approval_status`/`ban_status` in the profiles RESPONSE client-side
      so both screens rendered for real — **no prod row was mutated**. Both were
      left-pinned at 1440: card x 48–496, centre 272 **->** 496–944, centre 720
      (= viewport centre, no rail on these routes). 375 unchanged. Fixed with
      `centerColumn`, the same prop `/payment-success` uses, applied to the
      loading skeleton as well as the loaded branch so the card does not jump
      when the profile lands.
      Original report: **AccountDenied / AccountBanned likely share it** —
      same `AuthShell` call with no `centerColumn`, where AccountPending passes
      `align="center"`. CODE READ ONLY, not reproduced live, not touched.
- [x] **DONE afe650635.** Measured before: /my-jobs 1 panel at x 48–1144 (w
      1096), inbox 1 panel, **thread 0 panels** at both widths — it painted
      straight onto the canvas. `ChatPaneShell`'s standalone branch now renders
      through `PageScaffold` (the shared shell, NOT a hand-rolled panel), which
      is a thin wrapper over the same `AppShell`, so the 100dvh lock and
      bottom-nav reservation are unchanged. After: thread **1 panel, x 48–1144,
      w 1096, radius 24, 1px border — byte-identical geometry to /my-jobs**;
      375 matches the inbox. The stop-condition was checked rather than assumed:
      internal scrolling survives and the composer still reaches the viewport
      edge, with all 14 `messages-thread.spec.ts` specs passing. The lane also
      caught itself: re-using the page gutter inside the card pushed the
      composer controls to x=40 at 375 and clipped "Type a message…" mid-word —
      spotted in the SCREENSHOT and backed out.
      Original report: **open thread at 1440 has no card boundary** — every other
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

- [x] **DONE 0e4a57017 — the owner's ruling applied, and it was FAR more than the
      two screens anyone had seen.** 43 same-material (white-in-white) nested
      pairs eliminated across 8 surfaces, identical counts at 375 and 1440:
      `/profile` landing **4 -> 0**, `/settings` **4 -> 0**,
      availability (both routes, both roles) **7 -> 0**, Admin Health's Config
      Checks + Scheduled Jobs **20 -> 0**, Admin Jobs rows **5 -> 0**, Admin
      Disputes **1 -> 0**, Admin Settings' admin-user rows **1 -> 0**, Admin
      Analytics' empty state **1 -> 0**. Group cards, eyebrows and rows are
      untouched — only the OUTER wrapper stopped painting, exactly as ruled.
      Done through a shared mechanism, not per-page forks: `AdminCard` gained
      `surface?: "card" | "none"`, default unchanged, so the other ~20 admin
      views are untouched. Eyeballed at both widths, not just counted.

      **The detector missed one on its first pass, for a reason worth keeping:**
      it skipped `role="button"` elements, so Admin Jobs' rows did not register.
      Widened, found, fixed. That is the same shape as the 2026-09-07 miss — a
      detector whose definition quietly excluded the case — and it is why the
      count is trustworthy only after you check what the detector cannot see.

      Deliberately LEFT, with reasons: `PageScaffold`'s bleeding panel around job
      cards (My Posts, Activity, Dashboard) matches the shape literally but IS
      the documented two-card shell in CLAUDE.md — removing it is a layout
      decision for the owner, not this ruling. Work Record's grey stat tiles and
      the tinted inset panels inside AdminCards (`bg-muted/40`, `destructive/5`
      and friends) are a different material and read as inset, not box-in-box.
      Segmented-control tracks and the EmptyState icon disc are detector noise.

      Original ruling: **KEEP THE GROUPS, DROP THE OUTER CARD.**
      The WORK / MONEY group cards and their eyebrow labels stay exactly as they
      are; the outer wrapper stops painting a white card and a border, so there
      is one boundary per group instead of a box inside a box. Applies
      everywhere it appears — `/profile` landing (`SettingsSection.tsx:44`, 4
      instances) and Admin Health's "Configuration Checks" at minimum. Sweep for
      others rather than fixing only the two that were seen. NOT YET DONE.

- [x] **Missing foreign keys — DONE 6417eed97, owner said go.** Live in prod,
      verified by `pg_get_constraintdef`. See the overnight rulings section.
      Original: **Missing foreign keys — INVESTIGATION DONE.**
      Findings, all measured live:

      **The orphans are historical, and the leak is already plugged.** Every
      orphaned `favorite_helpers` row was created **on or before 2026-09-01**.
      The migration that makes account deletion purge these tables landed
      **2026-09-02** (`20260902051631_account_deletion_reaches_tracking_consent_availability_favorites_reports`,
      alongside `20260902014651_account_deletion_purges_the_no_fk_tables` — the
      name says outright that the no-FK tables are handled in code by choice).
      The single row created since (2026-09-11) is valid on BOTH sides. So the
      deletion path works and is not producing new orphans.

      **But an orphan already cost us a real bug today.** The 40-notification
      flood came from an orphaned `favorite_helpers` row pointing at a customer
      with no `profiles` row. A foreign key would have made that bug impossible
      rather than merely fixed.

      **Counts:** `favorite_helpers` 12 rows — 7 orphaned `customer_id`, 10
      orphaned `helper_id`, identical against `profiles` and `auth.users`. Only
      **1** row is clean on both sides. `notifications` 540 rows, **1** orphan
      left after today's delete. `profiles` 8 rows, 8 of 8 have an `auth.users`
      row, so that side is sound.

      **The FK is safe to add, and CASCADE is the right rule.** `profiles.user_id`
      already carries a UNIQUE constraint, so it is a valid FK target.
      `favorite_helpers` today has only `UNIQUE (customer_id, helper_id)` and its
      primary key — no FKs at all. Account deletion ANONYMISES rather than
      deletes (`profiles.anonymized_at`), so the profiles row SURVIVES a normal
      deletion and CASCADE would never fire on one. It fires only on a HARD
      delete of a profile — which is exactly what produced these orphans.

      **Recommended plan, in this order:** (1) delete the 11 pre-2026-09-02
      orphan rows, keeping the 1 valid one; (2) add
      `favorite_helpers.customer_id` and `.helper_id` -> `profiles(user_id)`
      ON DELETE CASCADE; (3) same for `notifications.user_id` after clearing its
      last orphan. Prove the migration replay-safe under PGlite by applying it
      3x, per CLAUDE.md. Step 1 must precede step 2 — a constraint added over
      existing orphans fails.

      Superseded note: **owner ruled INVESTIGATE AND REPORT FIRST.** No
      schema change yet. Work out what would break, how many existing rows
      violate each constraint, and what account deletion is supposed to do here
      (remember deletion ANONYMISES rather than deletes, so a naive FK with
      CASCADE would destroy history the app deliberately keeps). Bring back a
      concrete plan. Applies to `favorite_helpers.customer_id` / `.helper_id`
      (7 of 12 live rows orphaned) and `notifications.user_id`.


## New reports from the last-three lane (2026-09-11)

- [x] **DONE afe650635 — worse than reported.** Toast x 1060–1416; rail "Post a
      Job" x 1209–1411 overlapping, and over "Notifications"
      `elementFromPoint` returned THE TOAST — genuinely unclickable, not merely
      overlapped. Cause: sonner portals to `<body>`, so it sits outside BOTH
      rail insets. Fixed in CSS gated on the same three classes as the existing
      insets, setting `right` rather than the custom property sonner writes
      inline. After: toast x **812–1168**, and `elementFromPoint` over both
      controls returns the control. Scoped to right-anchored containers and
      verified not assumed: the 375 top-centre toast is unchanged, and the rule
      was checked in `dist/assets/*.css` after a build, not on the dev server —
      the CSS-minifier trap in CLAUDE.md.
      Original report: **desktop toast overlaps the rail**
      Job" and "Notifications" controls.** Pre-existing, affects EVERY toast, and
      unchanged by the nudge fix (which only moved that one toast, and only below
      768px). Same family as the My Jobs defect, at the other breakpoint.
- [x] **DONE afe650635 — REAL, not a harness artefact.** `supabase.auth
      .getSession()` does no shape validation: it checks the session exists and
      has not expired, then hands the stored user straight through. This app
      supplies its own storage adapter on both platforms, so those bytes travel
      through code that can return a partial value, and `!!user` is then true.
      Reproduced with the id stripped from the persisted session: **7 malformed
      PostgREST requests from 5 call sites** (`profiles`, `user_roles`,
      `user_blocks`, `messages`, `notifications` x3) — against prod those are
      400s on a uuid column, i.e. "We couldn't load your account" with a Try
      again that can never succeed. Fixed at the ROOT, not at five call sites:
      `emitAuthSnapshot` normalises an id-less user to signed-out and reports to
      Sentry. **7 -> 0**, and the user lands on /login with their path preserved.
      Deliberately NOT fixed by flipping `useCurrentUser`'s `enabled`, which
      would have made the query disabled -> `isLoading:false, data:undefined,
      isError:false` -> ProtectedRoute's optimistic fall-through, i.e. **fail
      OPEN for a banned account**.
      Original report: **stale session sends `user_id=eq.undefined`**
      route render "We couldn't load your account", with `user_id=eq.undefined`
      going to PostgREST.** Hit while building the harness, so it may be a
      harness artefact — but the request is genuinely MALFORMED rather than
      skipped, which is a guard missing at the call site, not a server problem.
      Worth reproducing before believing either way.

- [x] **PROVEN 2026-09-12 18:56 UTC — the flood is over.** Cron 39 has now run
      THREE times since the fix (06:41, 12:41, 18:41, last status `succeeded`)
      and availability-titled notifications are still **0**, with
      `notification_dedupe_suppressions` also 0 — nothing even tried to
      duplicate. The expectation is now a measurement.
      Original: **PENDING PROOF: the availability flood must stay at zero after the next
      cron tick.** As of 2026-09-12 05:42 UTC: availability-titled notifications
      **0**, `notification_dedupe_suppressions` **0** (nothing has tried to
      duplicate yet), newest notification in the whole table 2026-09-11 20:37.
      `cron.job` 39 runs `41 */6 * * *`, so the next tick is **06:41 UTC**. That
      is the forward proof, and it has NOT happened yet — the fix is deployed and
      the old rows are gone, but "no new ones are being written" is so far an
      expectation, not a measurement. One query settles it:
      `select count(*) from public.notifications where title ilike '%updated availability%';`
      It must still be 0 after 06:41.


## Guest /browse: I re-applied a decision the owner had already reversed

- [x] **Search + Filters on guest /browse — ASKED, and the owner confirmed they
      stay OFF (e85b82a5b).** I removed them earlier today (8321d4344). The test
      guarding that area carried a dated note saying the owner had reversed that
      exact removal on 2026-09-07 ("/browse can have the filters", c7bce404e)
      and warning that the spec "kept the suite red for two days asserting the
      decision it replaced". Rather than pick a side I put the contradiction to
      the owner directly, who chose **keep them off, update the test**. The
      assertion is now inverted with the full flip-flop history beside it and an
      explicit "do not flip this back on the strength of the c7bce404e commit
      message alone — ask first".
- [x] **Guest /browse had TWO `<h1>Browse Jobs</h1>` — my regression, fixed
      c27ad084b.** Moving the page onto `PublicHeaderPage` today gave it a
      visible h1 while `BrowseTasksToolbar` still rendered its own sr-only one.
      An a11y defect and a Playwright strict-mode violation, red at 320, 375 and
      1440. The toolbar now takes `renderHeading`; NATIVE still renders it,
      because `PageScaffold`'s title card there is the H logo and carries no
      heading. The same shell change also turned the two CTAs into the marketing
      Navbar's `<Button asChild><Link>` — an anchor, so `role="link"` — and the
      spec now asserts the real role while keeping its intent.
      8/8 in `home-chrome.spec.ts` green.

- [x] **DONE 7c824db4c — every toast moved to the bottom**, owner ruling, locked
      by `src/test/toastPlacement.test.ts`.
      Original: **Top-anchored toasts have now landed on a header control THREE times.**
      The My Jobs title card (e59a7ff85), the desktop right rail (afe650635),
      and now: at 375 every top-centre toast covers the header's Notifications
      bell (toast y 8–78 vs bell y 21–77; `elementFromPoint` returns the toast).
      Three one-off fixes is a pattern, not a coincidence — this wants an owner
      ruling on where toasts belong, not a fourth patch.
- [x] **CLOSED, working as intended — no change.** Looked at it at 1440 now that
      the thread sits in a panel: the header, the off-platform banner and the
      composer share one centred 780px column, and the band behind the composer
      lines up with the banner above it. The cap itself is the owner's fix for
      "the bottom bar does not fit correctly"; widening it would reintroduce that.
      Original: **At 1440 the composer bar spans the 780px reading column, not the full
      panel.** `ChatView` caps timeline and composer with one `max-w-[780px]`
      wrapper. That cap is owner-set ("the bottom bar does not fit correctly"),
      so it was left alone.

## Still red, and it is the owner's own report (lead, 2026-09-11)

- [x] **DONE 84d84bc63 — the payout notice rides inside the sticky block with the
      Apply button**, so the reason you cannot be hired and its Set Up Payouts
      link are never covered. Overlap 21.1px → 0, checked in both hosts.
      Original: **The Apply sheet's submit row STILL covers the payout notice — my earlier
      fix was incomplete.** Owner's words: "the you can apply button is cut off
      by apply". `fa716f4b9` fixed the case where the sheet does NOT scroll, by
      gating `.sheet-sticky-actions` on a real `hostScrolls` measurement. The
      SCROLLING case was never fixed and is now **worse: 6px -> 21.1px**. I
      opened the failure screenshot and LOOKED: "Apply Now" sits on the payout
      notice and hides its last line and its "Set Up Payouts" link — the one
      control that would let the user resolve the block.
      Reproduces reliably locally AND in CI, so it is not the documented
      shared-tree flakiness. It is the last red test in the happy-path smoke.
      Mechanism as far as I got: with the sheet overflowing, the row's natural
      position is below the fold, so `bottom: 0` pins it to the scroller's
      bottom edge — exactly where the notice sits. That is ordinary sticky
      behaviour, which is why a naive tweak will not settle it. Handed to a lane
      with the brief that the reason you cannot be hired AND the link that fixes
      it must both stay readable.

# ============================================================
# OVERNIGHT BRIEF — agreed with the owner 2026-09-12, ~06:45 UTC
# ============================================================
# Owner: "no agents either, you do it all on your own no rush take your time
# and be thorough" · "make sure every gap is covered. no excuses"
#
# THE CORRECTION THAT DEFINES THIS RUN. Owner: "you still didnt ask what the
# audit should do bc last time there were alot of gaps you just looked and
# didnt make sure anything worked as it should." So this is NOT a look-at-it
# pass. Every screen must be PROVEN TO WORK, not just proven to render.
#
# COVERAGE — a screen is not audited until all of this exists for it:
#   · states: empty · loading · error · populated
#   · widths: 375 and 1440
#   · themes: light and dark
#   (up to 16 captures per screen, and EVERY screen gets seen)
#
# DEPTH — click EVERY control on every screen: buttons, links, tabs, toggles,
# filters, form fields. Press it and verify WHAT ACTUALLY HAPPENED: the right
# thing opened, the data changed, the state moved, the toast told the truth.
# Anything that does nothing, or lies, is a defect.
#
# JOURNEYS — run the whole loop across two test accounts, Stripe test mode:
# post → fund → apply → hire → message → on my way → arrived → working →
# complete → approve → release → review, plus cancel, dispute and refund.
#
# PROD WRITES — allowed. Create test data freely, mark it clearly, back it up
# and clean it up at the end. Never touch the owner's real rows.
#
# ROOT CAUSE — chase every failure all the way down: database, RLS policies,
# edge functions, triggers. Verify the LIVE object, never the migration file.
# Fix the cause, not the symptom.
#
# AUTHORITY — fix everything, including the subjective calls, using the rules
# already given (CONSISTENCY above all). Owner reviews the diff.
#
# ORDER — daily screens first (Dashboard, My Jobs, My Posts, Messages, job
# cards), then Profile + tabs, then Post a Job, then Admin, then the 94
# overlays. But EVERYTHING must be seen.
#
# REPORT — tracker file as usual, plus a written summary covering what changed
# and what needs the owner.
#
# RULINGS GIVEN TONIGHT, to action:
#   · Remove the cancellation fee pill too — "no pills" means none.
#   · Move ALL toasts to the bottom (above the dock on phone, bottom-right on
#     desktop) so nothing at the top of any screen can be covered.
#   · Run the whole foreign-key plan: clean the 11 orphans, then add the
#     constraints, replay-safe, verified by object state.

## Overnight — the three rulings, all DONE (2026-09-12)

- [x] **Red build fixed first — a838fa807.** The empty-state sweep was failing a
      137-screen run because /dashboard logged a 406 from `POST referral_codes`.
      The mock returned `[]` for every write under a comment claiming that was
      "so `.insert().select()` patterns get back data" — an empty array is
      precisely NOT data. It only surfaced once `honourSingleObject` started
      modelling real PostgREST earlier today. Chased to the live database rather
      than believing the symptom: `referral_codes` has matching INSERT and
      SELECT policies in prod (`pg_policy`), so the real insert DOES return its
      row and there was no app defect behind the red. The mock now echoes the
      request body as the representation, the way PostgREST does.
      **1 failed request -> 0; empty-state sweep 137/137 green.**
- [x] **No pills, including the fee — 903bbc622.** Both sides done in one pass,
      the poster's card and the helper's, because one surface keeping it would
      be the exact inconsistency the ruling removes. The AMOUNT stays as a plain
      money line: a cancellation fee charged with nothing on the card saying so
      would be worse than the pill, and on the helper's side it is their money.
      `PostedJobCard` is down to one `rounded-full` and it is an avatar.
- [x] **Every toast anchors to the bottom — 7c824db4c.** This REVERSES an
      earlier owner decision, and the reason is recorded beside it because the
      argument for top (a top banner is the iOS convention) is reasonable and
      will be made again — it lost to three measured collisions in one day. The
      dock, the original objection to bottom, was already solved by offsets the
      one opted-out toast was using, so the flip costs nothing that was not
      already handled. The nudge's per-toast override is DELETED rather than
      left as a special case that reads as meaningful and does nothing.
      **A comment could not stop a fourth reversal, so the ruling is a test**
      (`src/test/toastPlacement.test.tsx`), proved to fail when reverted.
- [x] **Foreign keys — 6417eed97, live in prod and verified by object state.**
      `favorite_helpers.customer_id`, `.helper_id` and `notifications.user_id`
      now REFERENCES `profiles(user_id) ON DELETE CASCADE`, confirmed with
      `pg_get_constraintdef` rather than by the deploy going green. 11 orphaned
      favourite rows + 1 debris notification cleared first (backed up), in that
      order deliberately — a constraint added over violations fails outright.
      Cascade is safe precisely because account deletion ANONYMISES rather than
      deletes, so it can never fire on an ordinary deletion. Proved under
      PGlite: applied 3x consecutively, orphan inserts refused on both tables,
      the row SURVIVING when the profile is anonymised and disappearing only on
      a hard delete, unrelated notifications untouched.
      This closes the class of bug behind the 40-notification flood, rather than
      only the instance.

## ⚠️ FOR THE OWNER — your profile photo is (almost certainly) your ID document

Found 2026-09-12 while walking /dashboard, /my-jobs, /my-posts, /messages and
/profile with a real session. Every one of those pages logs
`400 GET .../user-documents/76b07824…/avatar.png`.

**Nothing is leaked.** That object is in the `user-documents` bucket, which is
`public = false`, and I confirmed the URL answers **400** — both there and at
the same path in the public `avatars` bucket. It is not anonymously fetchable.

**But look at what it is.** In `storage.objects`, for your user id:

| bucket | object | bytes | created |
|---|---|---|---|
| `user-documents` | `…/avatar.png` | **810107** | 2026-05-03 17:11:09.220671 |
| `id-documents` | `…/id-document-1777828268516.png` | **810107** | 2026-05-03 17:11:09.302834 |

Identical byte count, written **80 milliseconds apart**. That is one upload
landing in two places: your identity document was also written as your avatar.
This is precisely the scenario `src/lib/avatarStorage.ts`'s own header describes
— "the ID picker and the avatar picker have sat one tap apart… Two identity
documents were found live in this bucket exactly this way."

**What I did and deliberately did not do.** I did NOT copy the file into the
public `avatars` bucket to "fix" the broken image — that would publish an
identity document. I did NOT null your `avatar_url`, because the brief says not
to touch your real rows. The app already degrades correctly: every avatar call
site now renders through the shared `UserAvatar`, which falls back to a
monogram, so you see initials rather than a broken image. The only live symptom
is the 400 in the console on every page.

**What needs you:** upload a real profile photo (that writes to the public
`avatars` bucket via the consolidated path, which is correct now), and then say
the word and I will delete the stale `user-documents/…/avatar.png` object and
clear the dead URL. The `id-documents` copy is where an ID document belongs and
should stay.

Systemic check done, not assumed: yours is the ONLY profile whose `avatar_url`
points at a non-public bucket. Every other row uses `avatars` or the brand-asset
function.

## The night's audit — infrastructure, and what it has found so far

**`scripts/audit/walk-every-control.mjs`** — the answer to "you just looked and
didn't make sure anything worked". It signs in with a real prod session, waits
for content rather than photographing skeletons, records layout facts, then
presses EVERY button, link, tab, toggle and checkbox and records what actually
changed: the URL, a dialog, the controls, the fields, the toggle state, the
console.

**It took six rounds to make it trustworthy, and that is the point.** Every one
of these was the harness accusing working code:
- held element handles across clicks, so a re-render detached them → reported
  the notifications bell unclickable;
- measured change by text length alone → reported the dashboard's Search dead,
  when it swaps the whole header for a field (517 chars → 514);
- counted any card inside a card → reported the documented two-card shell's
  17px-inset job cards, 4-6 per dashboard;
- took a minimum over four edge gaps → reported the tinted "Lafayette" location
  chips as nested cards, 8 per screen;
- reported `sr-only` controls unclickable — they are clipped to a pixel ON
  PURPOSE, for screen readers;
- reported the whole bottom nav on /messages unclickable, because opening a
  thread hides the dock and the labels were captured on load;
- reported already-active tabs dead ("Home" on /dashboard, "Posts" on
  /my-posts, "Messages" on /messages, "Terms" on legal);
- could not see toggle state, so "Copy Mon to all" looked dead.
A harness that calls working controls broken spends the night's attention on
itself. **Every finding below was reproduced by hand before being believed.**

### Confirmed and FIXED
- [x] **Tapping Search on /dashboard left the field unfocused** (bfadf5460).
      The header swapped to a search box and `document.activeElement` stayed on
      BODY, so on a phone the keyboard never came up and you had to tap again —
      two taps for one intent on the primary surface. Fixed for the standalone
      header form ONLY; the copy embedded in the filter sheet still does not
      autofocus, deliberately, because that sheet is opened by a sort/category
      control and focusing threw the keyboard over the chips. Verified both in
      Chrome.

### Confirmed NOT defects (evidence both ways, so they stop being re-reported)
- **"Copy Mon to all" on the availability tab works.** It reported dead under
  the test account because all seven of that account's days are ALREADY an
  identical 09:00–17:00 — so the copy legitimately changes nothing. Driven on an
  account where a day differed, it flips that day on (`aria-checked` false →
  true). Not a defect; the data was uniform.
- **`/`, `/browse`, `/complete-profile`, `/account-*`, `/admin` report the
  dashboard's controls** because they REDIRECT for a signed-in approved
  non-admin. Expected.

### The two-account journey — `scripts/audit/two-account-journey.mjs`
9 of 10 steps pass. It proves: both sessions are really signed in; each account
can read its own profile under RLS; **the helper CANNOT read the poster's email**;
the browse feed answers; and it cleans up its own rows.

Two corrections to my own test, not the app:
- It first reported an RLS failure on a message the helper could not read. The
  thread's counterparty was the OWNER, not the helper, so **RLS was right and
  the assertion was wrong.** (That run also put a test message in the owner's
  real inbox; it has been deleted, and the script now cleans up.)
- A completed job's thread offers no composer via `/messages?jobId=…` because a
  conversation is built FROM messages — a job with none has no thread to open.
  The real entry point is the job card's Message action. Not yet driven.

- [x] **THE MONEY LOOP IS COVERED — passed on production 2026-09-12 19:41 UTC**
      (run 34714860101, first attempt, 27.3s, no retry). Sandbox confirmed first,
      not assumed: every `stripe_session_id` in `jobs` is `cs_test_`. Verified in
      the database, not from the green tick: job `5f20df1e…` completed and
      `released`, before AND after proof photos, helper and poster both done, a
      review, and a `payout_transfers` row `status=paid`, 2200 cents ($25 budget
      less the fee) with a real Stripe `tr_…` transfer id created at 19:41:49.
      Getting there took five fixes, each found by reading the run rather than
      guessing:
        1. the token mint's "check the password" message was wrong — auth had
           logged the sign-ins as 200; the mint is now a script that reports the
           real HTTP status and retries (dba125b99);
        2. the spec waited for a "Before Photos" button that the step-by-step
           photo redesign had removed from production (ed8371fc0);
        3. it uploaded before-then-after, but the Working step asks for the after
           photo first (same commit);
        4. a second `page.goto` raced the page's post-upload refetch and hung 296s;
           the before upload now waits on the same page for the card to advance
           (66f5d8108) — and a local check showed a refetch alone causes zero
           history writes, so this is not a user-facing defect;
        5. the final `is_seed === false` assertion predated the derive-from-account
           migration; it now asserts the flag is UNCHANGED (a06d987ba).
      Found and fixed a real product gap on the way: a proof-photo upload relied
      only on best-effort realtime to advance the card (ad9a884b7).
      Original: **THE MONEY LOOP IS NOT COVERED.** Funding,
      release and refund were all skipped. The Stripe key the edge functions
      actually use cannot be read, `scripts/e2e/stripe-sandbox-on.sh` is
      owner-run, and the Stripe account exposes a LIVE context — so driving a
      payment could charge a real card. **Owner: run the sandbox script and I
      will drive post → fund → apply → hire → complete → release → review end to
      end.** Until then, escrow, payout and refund remain proven only by the CI
      spec's own history, not by anything I ran tonight.

## Money and trust audit (read-only against prod, 2026-09-12)

**No real money is stuck anywhere.** Checked every integrity invariant I could
express over `jobs`:

| check | result |
|---|---|
| REAL (non-seed) jobs with stuck money | **0** |
| completed but not released/refunded/cancelled | 3 — **all `is_seed`** |
| escrow still held on a finished job | 1 — **seed**, the disputed fixture |
| released with no helper | 0 |
| non-positive budget | 0 |
| platform fee exceeding the budget | 0 |
| open job already assigned a helper | 0 |
| in-progress job with no helper | 0 |
| `cancellation_fee_status = 'charged'` with no fee amount | 0 |
| payout_transfers rows pointing at a job that no longer exists | 0 |

Real jobs in prod: **3**. Payout rows 10, refunds 39, tips 3.

**The repeating "Dispute split did not settle" alert — NOT a defect, and I
nearly filed it as one.** Dispute `c7a12050` is `status=decided` with
`execution_status='pending'`, never started, no error, so cron 15 (`21 */6`)
re-alerts every 30h. My first read was that nothing calls
`execute-dispute-split` — `grep -rn "execute-dispute-split" src` returns only
its own tests. **That was wrong: the call is there, at
`AdminDisputes.tsx:330`, split across a line break so the function name sits on
the line after `invoke(`.** The designed flow is admin decides →
`rpc_decide_dispute` → client invokes the settler, and `UnsettledSettlements.tsx`
exists precisely to list decisions whose money has not moved. The stuck row is
SEED data created already-decided without the settler ever being invoked.
Worth clearing so the alert stops, but the product path is intact.

A note on method: a multi-line call is invisible to a single-line grep, and
"nothing calls this function" is exactly the kind of confident, wrong conclusion
that a grep invites. Read the call site.

## Cross-account authorization — NO LEAKS (17 probes, two real sessions)

`scripts/audit/cross-account-authz.mjs`. Not a policy read: two real tokens, real
PostgREST, one signed-in member asking for another's rows — the question a
hostile user would ask. CLAUDE.md is explicit that a policy can look correct and
still not do what you think.

Clean on all of it: payout transfers, refunds, tips, disputes, PIF credits, W9
tax records, verification history, other people's roles, fee config, error logs,
push tokens, saved searches, saved helpers, notifications, messages to third
parties, the poster's email, and **the exact address of a job she was never
hired for** (no latitude/longitude handed over).

It carries a control so it cannot pass vacuously: the helper must still be able
to read her OWN profile. A database where nothing works must not look like a
database where nothing leaks.

**Its first run reported five leaks and every one was the probe's fault** — two
asked for a column and a table that do not exist (`payout_transfers.amount`,
`id_verifications`), and three forgot to exclude the user's OWN rows, so her own
role, tips on jobs she worked and disputes she is a party to all came back and
read as breaches. Each was checked against the database before being believed.
A probe that cannot tell "your row" from "someone else's row" cannot report a
leak, only noise; a 400/404 now reports itself as a broken probe rather than a
finding.

---

# ☀️ MORNING SUMMARY — what happened overnight

*(written as the night went; the audit sweep's full results are appended below
when it finishes)*

## Your three rulings, all done and verified in prod
1. **No pills.** Both sides of the cancellation fee too. The amount survives as
   a plain money line — a fee charged with nothing saying so would be worse than
   the pill.
2. **All toasts moved to the bottom.** This reversed an earlier decision of
   yours, so the reason sits beside it in the code, and the ruling is now a
   TEST that fails if anyone flips it back.
3. **Foreign keys added and live**, verified by object state rather than by the
   deploy going green. This closes the CLASS of bug behind the 40-notification
   flood, not just the instance.

## The most serious thing I found
**Your profile photo is almost certainly your ID document.** Same byte count as
your `id-documents` copy, written 80 milliseconds apart. Nothing is leaked — the
bucket is private and the URL 400s — and the app already falls back to your
initials, so the only live symptom is console noise. I did NOT copy it to the
public bucket (that would publish an identity document) and did NOT edit your
row. Upload a real photo and say the word; I will clear the dead object.

## What I proved, rather than assumed
- **No cross-account leaks**, 17 probes, two real sessions, asking the question a
  hostile user would ask — including the exact address of a job she was never
  hired for. With a control so it cannot pass vacuously.
- **No real money is stuck.** Every integrity invariant over `jobs` is clean;
  the only unresolved payments are seed fixtures.
- **The dispute settlement path is intact** — I nearly filed it as broken
  because a grep for the settler returned only tests. The call is there, split
  across a line break.

## What I could NOT do, and why
**The money loop.** Funding, release and refund are untouched because I could
not confirm the Stripe key the edge functions use is test mode, and the account
has a live context. Driving a payment could have charged a real card. Run
`scripts/e2e/stripe-sandbox-on.sh` and I will drive post → fund → apply → hire →
complete → release → review end to end.

## The honest note about the harness
The audit tool accused working code **eight separate times** before it was
trustworthy — dead controls that were already-selected tabs, an unclickable
notifications bell that was a stale element handle, nested cards that were the
documented two-card shell. Every finding in this file was reproduced by hand
before being believed. That is why there are fewer findings here than you might
expect, and why the ones that remain are real.

## Sweep results — 58 routes, both widths, both themes

Four runs. **375 light and 375 dark completed all 58 routes each**; the 1440 pair
was re-run sequentially because four concurrent browsers starved the dev server
and produced a wall of `page.goto: Timeout` on the Profile tabs — contention,
not defects, and worth saying plainly rather than filing thirty findings.

### Answered, with evidence — NOT defects
- **"Save" on the auto-tip tab gives no feedback, and that is deliberate.** It
  works: clicking it issues `PATCH profiles` then refetches, verified on the
  network. There is no success toast because `applyToastPolicy()` neuters every
  action-less `toast.success` app-wide by an owner decision of 2026-08-13
  (confirmations read as clutter and covered the header). The intended
  confirmation is the haptic plus the re-seeded values. **See the open question
  below — that convention has a hole on the web.**
- **"Copy Mon to all"** — no-op only because that account's seven days are
  already an identical 09:00–17:00. Proven to work where a day differs.
- **"Light" / "Dark" on the accessibility tab, "Off" on auto-tip, "Lifetime" on
  earnings, "Post a new job" on /post-job, "Home" on /dashboard** — every one is
  the already-selected option or the current route. Pressing them is supposed to
  do nothing.
- **"Follow us on Facebook"** opens a new tab, which the walker cannot see as a
  change in the page it is watching.
- **"Recenter map"** appears on /admin, /account-*, /signup-pending and / at
  1440 because every one of those REDIRECTS a signed-in approved non-admin to
  /dashboard, which has the map. Same control, one screen.

### Real, and open
- [x] **TEXT CLIPPED on home_history — RETRACTED, it was my detector.** The
      description excerpt is `line-clamp-2`, a deliberate two-line truncation
      that draws its OWN ellipsis. Tailwind sets `-webkit-line-clamp` without
      setting `text-overflow`, so a check that only knew the latter read a
      designed excerpt as text the box cannot show. Detector fixed; the route
      now reports clean. **This was the last finding standing from the sweep,
      and it was mine, not the app's.**
- [x] **ANSWERED by the owner's "consequential actions only" ruling.** Auto-tip
      Save is a settings save the form already reflects, so it stays silent by
      design; the actions with a real-world effect now confirm.
      Original: **OPEN QUESTION FOR THE OWNER — Save confirms with a haptic, and the web
      has no haptics.** The 2026-08-13 ruling killed action-less success toasts,
      and the stated confirmation on the auto-tip screen is "the haptic plus the
      re-seeded values". On the phone-sized WEBSITE and on desktop there is no
      haptic, and the re-seeded values are identical to what the user just
      typed — so pressing Save produces **literally nothing observable**. That
      collides with the standing rule that the phone-sized website and the
      native app are ONE surface. I have NOT changed it, because adding a toast
      would reverse your ruling. Options: a brief inline "Saved" beside the
      button (no toast), or accept web having no confirmation.

## ⭐ THE FINDING WORTH READING FIRST — consequential actions confirm nothing, and the reason for that just expired

Driving every control at 1440 turned up buttons that reach the server and then
show the user **nothing at all**. Verified on the network, not guessed:

| control | what it actually does | what you see |
|---|---|---|
| Security → "Email me a password reset link" | `POST /auth/v1/recover` — the email really is sent | **nothing** |
| Subscription → "Refresh membership status" | `POST check-pro-subscription`, then refetches | **nothing** |
| Auto-tip → "Save" | `PATCH profiles`, then refetches | **nothing** |

Zero text change, zero toast, no dialog, no error. Press "Email me a password
reset link" and you cannot tell it worked — so you press it again.

**The cause is one deliberate app-wide policy**, `src/lib/toastPolicy.ts`, which
suppresses every action-less `toast.success` (and `.message`/`.info`) on your
2026-08-13 decision. Its own header gives the reason:

> "The confirmations … read as clutter and, **once toasts moved to the top of
> the screen, began covering page headers.**"

**That reason no longer exists.** Toasts moved to the BOTTOM tonight, on your
ruling, precisely because top-anchored toasts kept covering headers and controls.
The policy was a workaround for the placement, and the placement is fixed.

Two supporting facts, so this is not a guess:
- The exception proves the mechanism. "Send test notification" DOES show a
  toast — because its message carries a warning ("Sent to the bell icon — but
  the Email switch for Work Status is off"), so it is not an action-less
  success and the policy lets it through.
- The auto-tip screen's own comment says the intended confirmation is "the
  haptic plus the re-seeded values". **There are no haptics on the web**, and
  the re-seeded values are identical to what the user just typed — so on the
  phone-sized website and on desktop the confirmation is nothing at all. That
  collides with the standing rule that the website and the app are ONE surface.

- [x] **DONE 40dbf2d84 — owner ruled "consequential actions only".** A new
      `confirmConsequential` renders through the real `toast.success`, keeping
      success styling; 22 call sites across 18 files moved (password reset,
      email change, membership refresh and restore, dispute resolved / withdrawn
      / settled, bans, denials, restrictions, strike reversal, force-update gate,
      abuse caps, test notifications, review posted). Trivial saves stay silent.
      Also fixed a dropped error under it: Refresh membership status discarded
      `functions.invoke`'s result, so a server failure never reached the catch.
      Seen by eye at 375 and 1440: success check, bottom-anchored, clear of the
      dock. Guard tests proved to fail both ways.

      Original: **DECISION FOR THE OWNER.** I did NOT re-enable success toasts — that
      reverses an explicit ruling of yours and changes every screen at once.
      The options:
      1. **Re-enable them now that toasts sit at the bottom** (one-line change
         in `toastPolicy.ts`) — fixes the whole invisible-action class at once.
      2. **Re-enable only for consequential actions** (an email sent, a password
         reset, a payment refreshed) and keep trivial saves silent.
      3. **Keep them off and add inline confirmation** beside the button
         ("Sent ✓"), which never covers anything.
      My recommendation is 2: the actions that need confirming are the ones with
      a real-world side effect, and a "Saved" on every field edit is the clutter
      you removed in the first place.

- [x] **RESOLVED — the "signed-out on return from checkout" symptom is a retry
      artefact, not a user path.** It appeared on every RETRY attempt observed
      today (11:38, 19:26, 19:38) and on no first attempt, and the clean run at
      19:41 passed first time without it. The loop also continued past it each
      time, since it is a warning with a fallback. Watch it if it ever shows on a
      first attempt; until then it is not a defect.
      Original: **The production money-loop test is FLAKY, and the symptom is worth
      watching.** `prod-lifecycle.spec.ts` ("post, fund, apply, hire, complete,
      release, review") failed once at 11:38 and PASSED on the very same commit
      at 11:10, with every other run today green — so the payment path is not
      broken, it is intermittent. The failure mode is specific and not a
      timeout: it ends parked on
      `…/login?redirect=%2Fpayment-success%3Fjob_id%3D…`, i.e. **the return from
      Stripe checkout landed signed-OUT**, with the harness noting "no inline
      error text found on the page".
      That is the same shape as the native Stripe-return handoff problem already
      in the notes. If a real poster hits it they are asked to log in again
      immediately after paying, which is the worst possible moment. Not chased
      further tonight because I could not drive the money loop myself (see the
      Stripe sandbox item), and because a single flake on a green day is a
      watch, not a diagnosis. **Next run that fails, pull the error-context.md
      artefact before it expires.**


- [ ] **FOR THE OWNER — the dead avatar URL is CLEARED (2026-09-12); the duplicate FILE is still there.**
      `profiles.avatar_url` for the owner is now null, verified by the UPDATE's
      returned row, so the 400 on every page is gone and the app shows initials.
      The owner reported deleting the file, but `storage.objects` still lists
      `user-documents/76b07824…/avatar.png` with its original 2026-05-03
      timestamp, so that delete did not land. Everything else in the folder is
      untouched and the `id-documents` copy is intact.
      Original: **FOR THE OWNER — delete the duplicate of your ID document.** Confirmed by
      SHA-256, not just size: `user-documents/76b07824…/avatar.png` is
      byte-for-byte identical to `id-documents/76b07824…/id-document-1777828268516.png`
      (both `63fc9c6d587cf9b5…`). My delete was blocked by the permission
      classifier, so I did not route around it. To finish: Supabase dashboard →
      Storage → `user-documents` → folder `76b07824-9b41-4741-a4c4-4f8de362f682`
      → delete `avatar.png`. Keep the `id-documents` copy. Then upload a real
      profile photo, which writes to the public `avatars` bucket and replaces the
      dead URL. Nothing is leaked in the meantime — the bucket is private.

- [x] **DONE — ZIP shows its valid check on Complete Profile, signup AND Edit Profile.**
      Original: **Complete Profile: ZIP shows no check mark when filled.** Owner, 2026-09-12,
      pointing at `#zipCode` holding "70528": the neighbouring fields show the
      valid ✓, ZIP does not. `src/pages/CompleteProfile.tsx:771`.

- [x] **DONE — a position/zoom step before every profile photo save.**
      Original: **Profile photo upload has no crop/position step — it cuts heads off.**
      Owner, 2026-09-12: "the profile picture spot doesnt give them the option to
      like center the picture better it crops their head off". The avatar is
      shown center-cropped in a circle with no way to move or zoom the image
      before saving.

- [x] **DONE (fd2d7f73c, screenshots of both honest cards) — "Update ready." is an error screen pretending to be good news — remove it
      everywhere.** Owner, 2026-09-12, clicking Terms / Rules / Privacy on Complete
      Profile: "there should not be a such thing as an update ready screen this is
      clearly an error and all of them need to be fixed". Reproduced on localhost:
      all three routes render RouteErrorBoundary's chunk-load state. Cause on the
      dev server is Vite `504 (Outdated Optimize Dep)` on `@radix-ui_react-tabs.js`
      → `Failed to fetch dynamically imported module: …/Legal.tsx` (the dependency
      pre-bundle went stale after today's `npm run build` / `cap sync`). But the
      real defect is the SCREEN: any failed chunk load is labelled "A newer version
      of the app was just released", which is a guess and here is false.
- [x] **DONE (325e4009c, measured 60/60 at 360, 375, 1440 + screenshot) — Complete Profile: "Enter App" and "Sign Out" are different heights.** Owner,
      2026-09-12: "buttons should be the same size". Measured from the selection:
      Enter App 49.5px, Sign Out 60px, stacked full-width.

## Audit gaps — owner, 2026-09-12: "why were these missed and how do we fix this gap"

Rule for this section (owner): nothing that needs the browser is marked done
until the browser has been used to LOOK at it. Agents run one at a time.

- [x] **DONE de9d3cd88 — Button size classes that silently do nothing.** Unlayered
      `button { min-height: 44px }` beats Tailwind utilities. Detector:
      `buttonGeometry.ts` requestedNotRendered. Agent 1 (Opus), in browser now.
- [ ] **Sibling buttons of different heights never compared.** Detector:
      `buttonGeometry.ts` siblingMismatch, plus dialogs via overlay-sweep. Agent 2 (Fable), queued.
- [x] **DONE f5e0e104f (red/green proven) — New-tab links never followed.** walk-every-control.mjs + sweep
      newTabDestinations. Agent 3 (Sonnet), code done, red/green browser proof queued.
- [x] **DONE 2263feec8 (34 tests, red with Update ready restored) — Stale deploy only simulated on one route.** Multi-route chunk-failure
      spec. Agent 4 (Opus), queued.
- [ ] **Visual sweep could report "147 passed" with no server.** Fixed in
      91693fbd8: fails at the start (1 failed, 147 did not run, verified). Still
      needs a real sweep run with the server up, screenshots looked at.
- [ ] **Anon surface contract failed CI on one gateway 504.** Fixed in
      91693fbd8: the rpc probe retries 5xx twice; verified green against prod.
      Not browser work; closes when the next CI run is green.
- [ ] **Parallel sessions collide on the test-server port 4173.** One session's
      tests can hit another worktree's preview. The stale-bundle guard catches it
      locally. Open: give each worktree its own HAPPY_PATH_PORT by default.
- [ ] **No test moved the clock** (time-travel lane, 2026-09-12). Inventory: `docs/audit/time-inventory.md`.
      Prod spec `e2e/journeys/time-travel.spec.ts` covers the listing-expiry chip (day before, 1 min
      before, at start, next day, Pacific viewer, both DST mornings) and the availability row
      (16:59/17:00 CT, Pacific, both DST Sundays): 2 passed, and a mutant (fall-back start at the naive
      CDT instant) went red. Screenshots looked at. PGlite `scripts/probes/offer-expiry.probe.mjs` covers both
      offer sweeps. STILL UNCOVERED on prod, announced on every run: offer countdown, confirm window,
      review window → auto-release, subscription expiry. Each needs a funded/hired job or a paid tier
      on the E2E accounts (the prod-lifecycle legs). Server cutoffs of `auto-expire-jobs` step 2
      (CT evening, DST nights), `expiring-jobs-push` and `sweep_*` have no clock-moving test now that the
      mock date filter is dropped. They need PGlite probes of the SQL sweeps, or pure cutoff helpers extracted from
      the edge functions.
- [ ] **Direct-offer expiry never tells the poster** (VERIFIED LIVE). `expire_pending_direct_offers()`
      (20260423025644) flips expired offers in one CTE, then notifies from a separate scan limited to
      `direct_offer_expires_at > now() - interval '5 minutes'`. Its only caller, `auto-expire-jobs`, runs
      `0 * * * *`, so only offers that expired in the 5 minutes before the hour are announced. Prod: 1
      expired direct offer (expired at :41), 0 "Direct offer expired" notifications ever. Repro:
      `node scripts/probes/offer-expiry.probe.mjs` → FAIL "expired 19 min before the hourly run →
      poster told (notifications=0)". Fix: notify from the UPDATE's RETURNING, and REVOKE FROM PUBLIC, anon,
      authenticated. Migration left to the coordinator: it was classifier-blocked for this lane. Re-measure with the probe (goes
      green) and the live count.
- [ ] **An expired listing sits under "Waiting" until midnight.** Seen in the time-travel screenshot
      `08-job-dst-fall-at-start`: at its start time an open, unfilled job reads "Expired", which is correct,
      but stays in the Waiting tab for the rest of the CT day. It is invisible to every helper from `expires_at` on, so there is
      nothing to wait for. It moves to Needs You only at CT midnight (`isPastDue` is day-grained). Product call:
      bucket on `expires_at <= now` as well.
- [ ] **"Expired" shows for the last 59 seconds of a live listing.** `formatTimeLeft` floors to whole
      minutes and returns "Expired" when the floor is 0, while `JobCardMetaRow` has already decided the job is
      NOT expired. Copy call (e.g. "Less than a minute left"); the floor rule forbids "1 minute left".
- [ ] **`expiring-jobs-push` can never warn a short-lead listing.** It runs once a day (`14 14 * * *`) over
      `(now, now+24h]`, so a job posted after today's run that expires before tomorrow's is never warned.
      No other sweep covers it.
- [ ] **Lead, needs device repro: a phone clock >1h fast may sign the user out.** In the prod time-travel
      spec, one context per step with its own freshly minted session and the browser clock days ahead
      landed on "That page needs an account. Log in…" on 2 of 3 runs. supabase-js reads the stored `expires_at`
      against the device clock, and overlapping refreshes of a rotating token look like the cause. The spec now
      restates `expires_at` against the moved clock, which is a harness workaround. Repro: remove that line in
      `openAt` and run the job test. Confirm on a real iPhone with the clock set manually ahead before
      treating it as an app defect.
- [ ] **My Posts search only searches the open status tab, and says the job does not exist** (journeys
      lane, 2026-09-12, seen on prod at 390px). Repro: as the poster, post and fund a job (it lands in
      Waiting), open `/my-posts` (opens on Needs You), tap Search and type a word from its title. Result:
      "No jobs in this view / No jobs match your search — try a different term." with no pointer to
      Waiting, where the job is. The non-search empty state does point at other tabs ("14 in Done and 52
      in Cancelled"); the search empty state does not. A poster looking for a job they just posted is told
      it is not there. Screenshot looked at (`02-marketplace` failure-poster.png, run of 01:47Z). Journey
      J2 now opens the Waiting tab explicitly. Not fixed: needs a product call (search across tabs, or
      name the tab holding matches).
- [ ] **Tracking map throws "reading '_leaflet_pos'" on My Jobs** (journeys lane, 2026-09-12). Found by the
      J3 journey's error_logs check: as the helper, open `/my-jobs` and switch to Waiting while a card with a
      tracking map is mounted. `report()` fired `TypeError: Cannot read properties of undefined (reading
      '_leaflet_pos')` from TrackingMap. Prod `error_logs`: 13 rows since 2026-08-23, all from `/my-jobs`, 2
      users. Cause: `fitBounds`/`setView` animate, and the zoom-end timer reads a pane that unmounted.
      Fix in the commit adding this line: `animate: false` on both. Closes when the J3 journey runs green on
      the deployed bundle and `error_logs` shows no new `_leaflet_pos` row.
- [ ] **A hired, funded job never says the money is held, on either side's card** (journeys lane,
      2026-09-12, 390px, looked at). After Stripe funds the job (`payment_status = escrow`) and the helper
      accepts, the poster's expanded Scheduled card shows the tracker, photos and "Confirmation opens in 1d
      2h"; the helper's shows the tracker and the confirm deadline. Neither mentions that $25 is held for the
      job. The only place it is said is the one-time "Payment authorized" page. Product call: whether the
      Scheduled cards should carry a "Payment held" line (the disputed card already shows "Payment on hold").
      J4 records the count as a `funded-indicator` annotation rather than failing on copy that does not exist.

## Working forwards — owner, 2026-09-12: "all 6 need to happen"

- [x] **Lint for root-cause patterns at write time.** 53440856f `local/no-button-height-override` (76 legacy hits / 38 files, shrink-only ledger); 0f5bfe179 global control CSS may not out-rank utilities (red on the pre-fix index.css) and new-tab links may not target redirect routes (red on the original /terms case).
- [x] **Changed-screen checks before push.** 213053f0f `.husky/pre-push` → `npm run check:changed`: import graph maps a diff to routes, sweeps only those at phone-light (/login: ~10s, screenshot inspected). Press-every-control joins it when that harness lands.
- [x] **Owner reports become failing tests first.** 55ba5a461 `npm run repro`; generated spec proven in the browser: located the element, screenshotted 375 + 1440, failed on its placeholder.
- [x] **One open-work list.** This file. CLAUDE.md now says so; memory handoffs and agent reports point here instead of carrying their own open items.
- [x] **Automatic browser lock + per-worktree test ports.** c3b133e39: `~/.lh-browser.lock` via Playwright globalSetup (second holder waited 10s, then ran); worktrees get a path-derived port, main keeps 4173.
- [x] **Nightly WebKit + real-backend run.** e83876cc5 `nightly-webkit.yml` runs the whole happy-path suite in real WebKit (helper-apply 2/2 locally; first CI run dispatched). Real backend already nightly in e2e-real-backend.yml.


### Found while closing the audit gaps (2026-09-12)

- [ ] **The sweep never rendered /complete-profile.** Seed profile is complete, so it redirected to /dashboard; both owner bugs lived there. New `complete-profile-incomplete` screen. Uncommitted, waiting on the full sweep.
- [ ] **Profile photo on /complete-profile unreachable by keyboard/screen reader** (hidden file input, aria-label on <label>). Same class in 7 more pickers: dispute evidence x2, completion photos, Edit Profile photo, post-job photos x2, post-job video. All fixed + `fileInputsKeyboardReachable.test.ts`. Uncommitted.
- [ ] **aria-label on role-less elements, 15 places** (job-card chips, pinned/active dots, earnings projection, checkout redirect overlay, post-job photo labels). Fixed + `noAriaLabelOnGenericElements.test.ts`. Uncommitted.
- [ ] **Admin KPI tiles ragged in a row; fraud filter select 48px beside a 44px button.** Fixed; detector tightened with fixture cases. Uncommitted.
- [ ] **Pre-push check blocks on pre-existing sweep failures.** A global-file push runs the whole sweep; it was red on old sibling mismatches, so pushes needed LH_SKIP_CHANGED_CHECK. Closes when the full sweep is green.
- [ ] **One icon Button held at 44px by its parent's `[&_button]:h-11`** (AdminTopBar bell / menu). Intentional; detector now ignores parent-sized buttons.
- [ ] **Sweep mock data is thin.** 7 jobs, 8 applications, 6 messages, 2 reviews, 2 notifications; every other table returns [] (earnings, payouts, disputes, pets, home history, work record, saved Helprs, credentials, referrals, admin data) and nothing is long or crowded. Expand seed + add a heavy-content variant. Queued after the current sweep.
- [ ] **No end-to-end user-journey suite** (owner: "interactive and click through everything as a regular user would"). Only the money loop and two-role lifecycle exist. Build journeys for every flow on the real backend with the test accounts; Stripe steps need sandbox ON. Queued after press-every-control.
- [x] **Write contract: client writes checked against prod's schema.** `scripts/audit/write-contract.mjs` inventories every `.insert/.update/.upsert/.delete/.rpc` in `src/` (224 on 2026-09-12: 75 rpc, 83 update, 38 insert, 10 upsert, 18 delete, 0 unresolved) and checks each against `write-contract.snapshot.json` (read-only pull from prod): columns exist, NOT NULL sent, enum/check values, table + column grants, RLS policy per role and op, rpc existence/signature/EXECUTE. Guard: `src/test/writeContract.test.ts` (each check shown able to fail). Nightly `write-contract-refresh.yml` re-pulls and fails on drift. Still unchecked: 13 payloads built from non-literal objects (known keys checked, NOT NULL not asserted); anon role only for call sites listed in `ANON_CALL_SITES`; RLS `WITH CHECK` expressions are not evaluated.
- [x] **FIXED 1cdd3b786 — `saved_jobs` / `thread_pins` upsert failed on an existing row.** Verified live in `pg_policies`: INSERT/SELECT/DELETE policies, no UPDATE. PGlite repro: a fresh upsert works, but hitting the conflict raises an RLS error — exactly the "already saved" case the upsert was written for. Fixed with `ignoreDuplicates: true`; the write contract now passes.
- [ ] **`instant_book_claim` RPC called but dropped from prod** (`src/pages/dashboard/useApplyFlow.ts:244`). Verified live: `to_regprocedure('public.instant_book_claim(uuid)')` is null; dropped by `20260904034410_drop_dead_features_instant_book_skills_reminders_dup_disputes`. The call swallows PGRST202, so nothing visibly breaks, but the `isInstantBook` branch is dead code for a removed feature. Owner call: delete the branch (and any remaining instant-book UI). Baselined in `scripts/audit/write-contract.baseline.json`; remove the entry when fixed (the guard fails on stale entries).

### Queued — start only after several running audit agents finish (owner, 2026-09-12: "don't launch any more, wait")

- [ ] **Pre-release gate:** run every audit against the exact build being shipped to TestFlight/App Store; block the release on red.
- [ ] **Production watching:** alert when real users hit error screens or failed requests (Sentry + error_logs), not only in tests.
- [ ] **In-app "Report a problem" with state:** captures screen, route and recent errors automatically.
- [ ] **Accessibility sweep in WebKit:** the axe sweep runs only in Chromium; iPhone users get WebKit.

### Findings from paused audit lanes (2026-09-12), to triage on resume

- [ ] **Keyboard lane:** DOB wheel picker (`Month` listbox) focusable with no visible focus ring; focus drops to <body> after opening a message thread and after toggling the push master switch; `#require-photo-proof` switch reported unnamed (it has a `<label htmlFor>`, which should name a button, so verify in the accessibility tree before changing it). WIP a23bcb847 in its worktree.
- [ ] **Concurrency lane (leads, unrun):** `enforce_application_job_state` reads the job without a lock, so an application may land on a job being cancelled or re-priced; the client accept is a conditional update that doesn't check job status, so accept may stamp a cancelled job, or a cancel may count a just-accepted helper and charge a fee. Money/authz: needs a proven repro before any change.
- [ ] **Write-contract lane:** `instant_book_claim` RPC no longer exists in prod; `useApplyFlow.ts` quietly skips the error, so it is dead code. 4 open-payload `profiles` updates not yet checked against 11 non-updatable columns.
- [ ] **press-every-control:** checkout presses fail in mock mode because edge functions aren't mocked ("Couldn't open checkout"); the dock "Home" button reported not clickable on /profile; the payout-check banner is pressable but does nothing. Triage after the full run.
- [x] **Fixed by coordinator:** DST start time, listing expiry and confirm card zones (790004248); saved_jobs/thread_pins re-save RLS (1cdd3b786); press-every-control service-worker false failures (ef1574d65).

### Move every audit off mocks and onto prod (owner, 2026-09-12)

- [ ] **Seed prod test data** for the two test accounts in every state the mock seed had (all job/payment statuses, disputes, long thread, payouts, reviews, credentials, pets…), all `is_seed`, restorable, and never visible to real users. Replaces seedData.ts as the audit data source.
- [ ] **Visual sweep** against prod as the test accounts (not installSupabaseMocks). Empty/error-state sweeps: decide what replaces them honestly (a throwaway test account for empty; real network failure injection for errors).
- [ ] **press-every-control MODE=prod**: destructive presses allowed only on test-owned records; admin actions only against test targets.
- [ ] **Paused lanes on resume use prod:** keyboard/large text, messy input, interruptions, slow phone/returning, scorecard, explorer. Their mocked specs get migrated, not extended.
- [ ] **Existing mocked happy-path specs in CI** (e2e-happy-path.yml, ui-sweep, a11y-axe): migrate to prod-backed or retire, one at a time, keeping CI green.
- [ ] **Uncommitted mock fixture change discarded** (edge-function stub bodies) per this decision.

### REDO on prod — work that was only verified on mocks (owner: "no mock mode ever")

- [ ] Prod test data for every state (seed lane resumed on prod: scripts/audit/prod-seed.mjs).
- [ ] Button geometry + sibling heights (de9d3cd88, admin tiles, fraud select): re-verify on prod screens.
- [ ] Keyboard file pickers, aria-label roles, dark contrast (dbed7befd): re-verify on prod screens.
- [ ] /complete-profile sweep screen: needs a real incomplete-profile test account, not a mock rule.
- [ ] Stale-deploy spec (2263feec8): routes loaded with the prod backend.
- [ ] New-tab destination check (f5e0e104f): sweep side re-run on prod.
- [ ] Messy-input specs (1eb8e7caf), deep-link interruptions (c4a52d937 WIP), keyboard journeys (a23bcb847 WIP): migrate to prod before extending.
- [ ] press-every-control full run: MODE=prod, destructive presses only on test-owned records.
- [ ] Mock seed (59a92d362) and mock-only harness pieces: retire once prod equivalents pass.

### Launch checklist (owner decisions that flip at launch)

- [ ] **Switch Stripe to live** (`scripts/e2e/stripe-sandbox-off.sh`, owner-run). Owner, 2026-09-12: sandbox stays ON until launch so money journeys run nightly on the test card. After the switch, payment steps in audits skip as UNCOVERED unless sandbox is turned on for a test window.
- [ ] **Hide seed/demo jobs publicly** (`seed_jobs_hidden_publicly()`). Owner, 2026-09-12: stays OFF for now; anon browse shows 9 demo listings.
