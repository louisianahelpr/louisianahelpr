# Open list

Written 2026-09-11. The point of this file is that the backlog stops living in
chat scrollback. Anything not in here is either done or forgotten, and both of
those are answerable by reading this instead of guessing.

Grouped by SURFACE, not by the order it was noticed — because most of these are
instances of a few shared problems, and fixing them surface-by-surface costs a
fraction of fixing them one report at a time.

---

## Needs a decision before anyone can build

- **Live location tracking — should it be required?** Today it is
  `setInterval(pushPosition, 45_000)` in the WebView (JobTracking.tsx:692),
  running only while the job is `on_the_way`. There is no `watchPosition` and no
  background-location capability, so **iOS suspends it the moment the helper
  locks their phone or opens Maps** — i.e. exactly while they are driving.
  Making it genuinely live means background location, which means an Apple
  review justification, a privacy-label change, battery cost, and a decision
  about whether a helper must share continuous location to work at all.
- **Earnings + payout organisation** — owner asked for it; scope not yet agreed.

## Job card (helper side) — IN PROGRESS, lane `step-components`
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
