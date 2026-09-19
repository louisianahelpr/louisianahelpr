import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/nativeInit";
import { arrivalVerdictFromRpc, type ArrivalVerdict } from "@/lib/arrivalGate";
import { report } from "@/lib/errorLogger";
import { rpcErrorCode } from "@/lib/lifecycleErrors";

/**
 * PULL-TO-REFRESH RE-CHECKS AN ARRIVAL THAT GPS NEVER CONFIRMED.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Owner, 2026-09-19: remove the "Try My Location Again" chip from the job
 * card's action row, and make the refresh gesture do the job instead.
 *
 * That ruling was made knowing exactly what the button was for, because it was
 * measured first: when an arrival is RECORDED BUT UNVERIFIED the rail has
 * already advanced, so the row's primary reads "Start Working", not "Mark
 * Arrived" — there is no other control whose tap re-runs the location fix. The
 * chip was the only claimed -> verified path in the product, and
 * `usePullToRefresh` only refetched React Query. Deleting the chip without
 * this module would have removed the Helpr's ability to earn GPS proof of an
 * arrival they had already made, permanently, with no replacement. So the
 * fallback is made real first and the chip goes second.
 *
 * ── A REFRESH GESTURE THAT WRITES IS UNUSUAL, SO THIS IS DELIBERATELY TIMID ─
 * Every one of these is a rule, not a preference:
 *
 *   1. IT ASKS FOR A FIX ONLY WHEN A FIX COULD HELP. {@link arrivalToUpgrade}
 *      is checked BEFORE geolocation is touched, so a Helpr with nothing to
 *      upgrade — which is almost every refresh, on almost every screen — never
 *      triggers a permission prompt, a GPS spin-up, or a write. No candidate,
 *      no side effect of any kind.
 *   2. IT NEVER BLOCKS THE REFETCH. The caller fires this alongside its own
 *      refresh and does not await it. A denied prompt or a 15-second timeout
 *      must not hold the list hostage; the gesture's advertised job is
 *      refreshing, and it always finishes on time.
 *   3. IT IS SILENT WHEN IT CANNOT HELP. No error toast, ever, for a refresh
 *      that simply got no fix. Nothing is broken in that case: the arrival is
 *      already recorded, the job is not blocked on it, and the Helpr did not
 *      ask for this — they asked for a refresh, and they got one. A toast
 *      would be the app apologising for work the user never requested. The
 *      only thing it ever says is a SUCCESS: "GPS confirmed you were at the
 *      job", once, at the moment the upgrade actually lands.
 *   4. IT NEVER STORMS THE PERMISSION PROMPT. A denial is remembered for the
 *      rest of the page's life ({@link deniedThisSession}) and every later
 *      refresh degrades to a plain refresh with no prompt. iOS shows the
 *      system dialog once per install, but a browser re-prompts per gesture,
 *      and a Helpr pulling to refresh five times must not be asked five times.
 *   5. ITS ERROR COPY COMES FROM THE RPC'S OWN TABLE. Nothing here matches on
 *      message text — `rpcErrorCode` decides what is an ordinary refusal and
 *      what is a fault worth reporting, which is the same table every other
 *      call site of this function reads.
 *   6. IT RELIES ON THE SERVER'S IDEMPOTENCE RATHER THAN RE-IMPLEMENTING IT.
 *      `mark_helper_arrival` (20260919155016) returns early on
 *      `already_verified`, cannot downgrade a verification to a bare claim,
 *      and preserves the ORIGINAL `arrived_at` across a claim -> GPS upgrade.
 *      So calling it again is safe and cannot move the rail or restart a
 *      clock. Nothing here re-checks any of that client-side; duplicating a
 *      server rule in the client is how the two drift.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────
 * Helper side only, and only a job whose arrival is stamped and unverified.
 * Never on the poster's tab (they cannot check themselves in), never before an
 * arrival exists (that is the "I've Arrived" tap's job and it must stay a
 * deliberate act, not something a scroll gesture does), and never on a
 * verified one (there is nothing to win).
 */

/** The shape this module needs off an applied job — nothing more. */
export interface ArrivalUpgradeCandidate {
  id: string;
  helper_id?: string | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  status?: string | null;
}

/**
 * The ONE job a refresh could usefully re-check, or null.
 *
 * Pure and exported so the gate is testable without a browser, a gesture or a
 * database — the whole point of the "ask for a fix only when a fix could help"
 * rule is that this predicate is the thing that decides it.
 *
 * `poster_confirmed_arrival_at` DISQUALIFIES a job. Once the poster has
 * vouched, the arrival is settled by the attestation that actually decides it;
 * chasing GPS proof afterwards is the "don't nag" half of the owner's
 * 2026-09-19 ruling, and it is the same exclusion `gpsNudgeHere` makes.
 */
export function arrivalToUpgrade(
  jobs: readonly ArrivalUpgradeCandidate[],
  userId: string | null | undefined,
): ArrivalUpgradeCandidate | null {
  if (!userId) return null;
  return (
    jobs.find(
      (j) =>
        j.helper_id === userId &&
        !!j.helper_arrived_at &&
        !j.helper_arrival_verified_at &&
        !j.poster_confirmed_arrival_at &&
        // A finished, cancelled or disputed job is not somewhere new evidence
        // helps: the decision it would have fed has already been taken.
        (j.status === "in_progress" || j.status === "accepted"),
    ) ?? null
  );
}

/** Set once a fix is refused, for the life of the page. See rule 4. */
let deniedThisSession = false;

/** Test seam: forget the remembered denial. Not called by the app. */
export function resetArrivalRefreshDenial(): void {
  deniedThisSession = false;
}

/**
 * A single location fix, or null.
 *
 * A standalone cousin of JobTracking's `getLocationOutcome`, and deliberately
 * the SIMPLER of the two: it has no en-route watch to fall back on (that ref
 * lives inside the tracker component, which is not mounted on a collapsed
 * card) and it does not need to tell a denial from a timeout, because this
 * caller says nothing either way. What it does share is the timeout and
 * `maximumAge`, so the two paths cannot disagree about what "current" means.
 */
async function oneShotFix(): Promise<{ lat: number; lng: number } | null> {
  if (deniedThisSession) return null;
  try {
    if (isNativePlatform) {
      // DESTRUCTURED, never awaited as a value — awaiting a Capacitor plugin
      // object is thenable assimilation and silently resolves to nothing.
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition({ timeout: 15000, maximumAge: 30000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
    if (!navigator.geolocation) return null;
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          if (err?.code === 1) deniedThisSession = true; // PERMISSION_DENIED
          resolve(null);
        },
        { timeout: 15000, maximumAge: 30000 },
      );
    });
  } catch (e) {
    // Capacitor surfaces an iOS denial as a message, not a code.
    const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
    if (/denied|permission|authorized|authoriz/i.test(msg)) deniedThisSession = true;
    return null;
  }
}

export interface ArrivalUpgradeResult {
  /** Why nothing happened, or `upgraded` when the verification landed. */
  outcome: "no-candidate" | "no-fix" | "refused" | "unchanged" | "upgraded";
  verdict?: ArrivalVerdict;
}

/**
 * Re-check one unverified arrival. Never throws; never awaited by the caller.
 *
 * Returns a result rather than toasting, so the decision about what the user
 * hears stays with the screen that owns the gesture — and so this is testable
 * without asserting on toast spies.
 */
export async function upgradeUnverifiedArrival(
  jobs: readonly ArrivalUpgradeCandidate[],
  userId: string | null | undefined,
): Promise<ArrivalUpgradeResult> {
  const job = arrivalToUpgrade(jobs, userId);
  // RULE 1: the gate is BEFORE the fix. Nothing below this line runs on a
  // refresh with nothing to upgrade, which is nearly all of them.
  if (!job) return { outcome: "no-candidate" };

  const fix = await oneShotFix();
  if (!fix) return { outcome: "no-fix" }; // RULE 3: silent.

  const { data, error } = await supabase.rpc("mark_helper_arrival", {
    p_job_id: job.id,
    p_lat: fix.lat,
    p_lng: fix.lng,
  });
  if (error) {
    /* WHICH REFUSALS ARE ORDINARY — read from the RPC's own code table, not
       from its message text.
       `rpcErrorCode` (src/lib/lifecycleErrors.ts) maps the three structural
       refusals `mark_helper_arrival` can still raise: job_not_found,
       not_the_assigned_helper, job_not_active. All three mean "this job moved
       on while the list was stale", which a refresh is exactly the wrong
       moment to complain about — the refetch running alongside this is about
       to show the Helpr the true state anyway.

       PGRST202 is the same class one layer down: the RPC has not deployed yet.

       Anything else is a genuine fault and still reaches Sentry. A refresh
       that quietly cannot write must not be invisible to US just because it is
       deliberately invisible to the Helpr.

       (This was a regex over `error.message` until `rpcErrorCopyCoverage`
       failed on it: the repo's rule is that every RPC call site reads its copy
       through this helper, and matching on message text is how a call site
       ends up describing refusals the function stopped raising.) */
    const known = rpcErrorCode("mark_helper_arrival", error);
    if (!known && (error as { code?: string }).code !== "PGRST202") {
      report(error, { tags: { source: "arrivalRefresh.markHelperArrival" }, context: { job_id: job.id } });
    }
    return { outcome: "refused" };
  }

  // A NULL `error` IS NOT A WRITE. The RPC always returns a jsonb verdict on
  // success, so an absent or unreadable body means something silently did
  // nothing and must never be read as a verification that may not exist.
  const verdict = arrivalVerdictFromRpc(data);
  if (!verdict) {
    report(new Error("mark_helper_arrival returned no verdict"), {
      tags: { source: "arrivalRefresh.markHelperArrival" },
      context: { job_id: job.id },
    });
    return { outcome: "refused" };
  }
  return verdict.verified
    ? { outcome: "upgraded", verdict }
    : { outcome: "unchanged", verdict };
}
