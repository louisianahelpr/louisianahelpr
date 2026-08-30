import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { channelNonce } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { haversineMiles } from "@/lib/geo";
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, CalendarCheck, FileText } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { parseLocalDate } from "@/lib/dateUtils";
import { formatShortDate } from "@/lib/format";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { arrivalEstablished, arrivalGateMessage, arrivalState, arrivalStateLabel } from "@/lib/arrivalGate";
import { report } from "@/lib/errorLogger";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";

// Lazy-load the Leaflet tracking map so the ~45KB Leaflet bundle is only
// pulled in when an active "on_the_way" tracking card is visible.
const TrackingMap = lazy(() =>
  import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap }))
);

const STATUSES = [
  { key: "assigned", label: "Offered", icon: Clock, color: "text-muted-foreground" },
  { key: "confirmed", label: "Accepted", icon: CheckCircle2, color: "text-primary" },
  // CalendarCheck, not ShieldCheck: at the 16px the step row draws these at,
  // a shield-with-a-tick and the circle-with-a-tick above it were two dark
  // rings with a check in them and read as the same step twice. This one means
  // "both sides confirmed, the date is locked", which a calendar says plainly
  // and cannot be confused with "Accepted".
  { key: "job_confirmed", label: "Confirmed", icon: CalendarCheck, color: "text-primary" },
  { key: "on_the_way", label: "On the Way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", icon: PartyPopper, color: "text-primary" },
];

/**
 * The two steps that happen BEFORE anyone is offered the job. A poster's own
 * card starts life at "Posted" with nobody assigned, so without these the
 * tracker had nothing to say until a helper had already been picked — which is
 * why an open job showed no tracker at all. They are PREPENDED (never
 * substituted) so a job that advances keeps one continuous timeline, and they
 * reuse the exact step shape/styling of `STATUSES` rather than introducing a
 * second tracker.
 */
/**
 * ONE pre-assignment step, not two (owner: "I think posted and applicants can
 * be merged").
 *
 * They were never two things that happen in sequence — a job is posted, and
 * applications arrive against that same posted job — so the tracker spent two
 * of its nine columns on one state, and the count they conveyed is already on
 * the card. The step's icon and caption carry the difference now: a file with
 * no caption while nobody has applied, and the people icon with "N applied"
 * underneath once they have.
 */
const PRE_STATUSES = [
  { key: "posted", label: "Posted", icon: FileText, color: "text-primary" },
];

/** Index of each step in `STATUSES`, by key. Keeps the derivation below
    readable and stops a re-ordering of the array from silently changing
    what "on the way" means. */
export const STATUS_IDX = {
  assigned: 0,
  confirmed: 1,
  job_confirmed: 2,
  on_the_way: 3,
  arrived: 4,
  working: 5,
  done: 6,
} as const;

/** Everything the tracker can learn about how far along a job is. All
    optional: a caller that knows nothing still gets a sane step 0. */
export type JobProgressEvidence = {
  /** `status` from the latest `job_tracking` row, when one exists. */
  trackingStatus?: string | null;
  /** `jobs.status`. */
  jobStatus?: string | null;
  helperConfirmedAt?: string | null;
  /** Day-before re-confirmation stamp (migration 20260824213000); see the
   *  gate below for how it composes with the accept-time stamp. */
  helperDayofConfirmedAt?: string | null;
  /** Job date (YYYY-MM-DD) — lets the mutual gate honour an accept that
   *  itself happened inside the 24h window. Optional; absent = lenient. */
  jobDateNeeded?: string;
  posterConfirmedAt?: string | null;
  helperOnTheWayAt?: string | null;
  helperArrivedAt?: string | null;
  helperCompletedAt?: string | null;
  posterCompletedAt?: string | null;
};

/**
 * Which step of `STATUSES` a job is actually on.
 *
 * This used to read the `job_tracking` row FIRST and, if there wasn't one,
 * fall all the way back to 0 — so a job whose helper had finished and whose
 * poster was staring at "Approve & release payment" rendered as "Offered"
 * with the bar at 1/7. The jobs row already carried the truth (the
 * `helper_on_the_way_at` / `helper_arrived_at` / `helper_completed_at`
 * stamps); it just wasn't being read.
 *
 * So: score the job row for the FURTHEST milestone it can evidence, score the
 * tracking row, and take the max. A missing or stale tracking row can then
 * never drag the tracker backwards, while a live tracking row (the helper
 * tapping through the steps) still leads the way when it's ahead.
 */
export function deriveCurrentStatusIdx({
  trackingStatus,
  jobStatus,
  helperConfirmedAt,
  helperDayofConfirmedAt,
  jobDateNeeded,
  posterConfirmedAt,
  helperOnTheWayAt,
  helperArrivedAt,
  helperCompletedAt,
  posterCompletedAt,
}: JobProgressEvidence): number {
  // An unrecognised tracking status yields -1 from findIndex — treat that as
  // "no evidence" rather than letting it blank out the whole tracker.
  const trackingIdx = trackingStatus
    ? STATUSES.findIndex((s) => s.key === trackingStatus)
    : -1;

  let jobIdx = -1;
  const atLeast = (idx: number) => { if (idx > jobIdx) jobIdx = idx; };

  if (jobStatus === "accepted") atLeast(STATUS_IDX.assigned);
  // A job cannot BE in progress without having been confirmed, so the status
  // itself is evidence of at least "Confirmed" even when no stamp survived.
  // Without this floor the seeded/older in-progress rows — assigned, underway,
  // but carrying none of the four timestamps — still read "Offered" with the
  // bar at 14%, which is the same lie the owner reported on the
  // ready-to-release job, just with a different missing column. Deliberately
  // `job_confirmed` and not `working`: "the work has started" is a claim only
  // an actual stamp or the helper's own tracking row gets to make.
  if (jobStatus === "in_progress" || jobStatus === "revision_requested") {
    atLeast(STATUS_IDX.job_confirmed);
  }
  if (helperConfirmedAt || posterConfirmedAt) atLeast(STATUS_IDX.confirmed);
  // The MUTUAL step wants the helper's DAY-BEFORE stamp, not the accept-time
  // one — accepting a job five days out says nothing about the day itself
  // (2026-08-24 lifecycle review). An accept that itself happened inside the
  // 24h window counts (same grace as JobConfirmation), as does any row where
  // no job date is known to measure against.
  const helperAnsweredDayOf =
    !!helperDayofConfirmedAt ||
    (!!helperConfirmedAt &&
      (!jobDateNeeded ||
        parseLocalDate(jobDateNeeded).getTime() -
          new Date(helperConfirmedAt).getTime() <=
          24 * 3_600_000));
  if (helperAnsweredDayOf && posterConfirmedAt) {
    atLeast(STATUS_IDX.job_confirmed);
  }
  if (helperOnTheWayAt) atLeast(STATUS_IDX.on_the_way);
  if (helperArrivedAt) {
    atLeast(STATUS_IDX.arrived);
    // Arrived + still `in_progress` almost certainly means on site and
    // working — there is no "started working" stamp on the jobs row. But
    // that is an INFERENCE, and applying it unconditionally would make the
    // Arrived step unreachable: the helper tapping Arrived also flips the job
    // to `in_progress`, so every arrival would skip straight to Working. So
    // it only fills a gap: when a tracking row exists it is the helper's own
    // statement of where they are, and it wins.
    if (trackingIdx < 0 && jobStatus === "in_progress") atLeast(STATUS_IDX.working);
  }
  if (helperCompletedAt || posterCompletedAt || jobStatus === "completed") {
    atLeast(STATUS_IDX.done);
  }

  // Floor at 0: the tracker always shows at least "Offered".
  const idx = Math.max(0, trackingIdx, jobIdx);

  // A REVISION UNDOES "Done". `helper_completed_at` stays stamped when the
  // poster sends the work back, so the tracker sat on a fully-green Done —
  // beside a card that said "Revision requested" and an action row offering
  // Approve or Dispute. Owner: "all of these things can't be true at once."
  // The work is back with the helpr, which is what Working means, and the
  // stamp is not cleared because it is a record of what happened; the tracker
  // just stops treating it as the final word while the job is in revision.
  if (jobStatus === "revision_requested") {
    return Math.min(idx, STATUS_IDX.working);
  }
  return idx;
}

/**
 * How to phrase the assigned helper's name for the step the job is on.
 * "Offered to Camille" is only true at step 0 — once she has accepted, is
 * driving over, or is holding a wrench, saying "Offered to" is wrong.
 * Returned as before/after fragments so the name itself can stay a link.
 */
export type TrackingData = {
  id: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  eta_minutes: number | null;
  updated_at: string;
};

export function JobTracking({
  jobId,
  helperId,
  helperName,
  isHelper,
  isOwner: _isOwner,
  jobDateNeeded,
  jobStartTime,
  jobStatus,
  helperConfirmedAt: initialHelperConfirmedAt,
  helperDayofConfirmedAt = null,
  posterConfirmedAt: initialPosterConfirmedAt,
  helperOnTheWayAt: initialHelperOnTheWayAt,
  helperArrivedAt: initialHelperArrivedAt,
  helperArrivalVerifiedAt: initialHelperArrivalVerifiedAt,
  posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt,
  helperCompletedAt: initialHelperCompletedAt,
  posterCompletedAt: initialPosterCompletedAt,
  initialTracking,
  jobLatitude,
  jobLongitude,
  includePostingSteps = false,
}: {
  jobId: string;
  helperId: string | null;
  /**
   * Display name of the assigned helper. Supplied by the poster-side card so
   * the tracker can state WHO it is tracking. It is rendered as a caption on
   * the progress bar — "Camille is on the way" — not as a row under the
   * heading, where the owner read it as a second title stacked on the first.
   * Optional: the helper-side mounts are tracking themselves and have no one
   * to name.
   */
  helperName?: string | null;
  isHelper: boolean;
  isOwner: boolean;
  jobDateNeeded?: string;
  jobStartTime?: string | null;
  jobStatus?: string;
  helperConfirmedAt?: string | null;
  /** Day-before re-confirmation stamp — see JobProgressEvidence. */
  helperDayofConfirmedAt?: string | null;
  posterConfirmedAt?: string | null;
  /**
   * Lifecycle stamps straight off the jobs row. All optional and all
   * defaulting to "unknown" so existing call sites keep compiling and keep
   * their exact current behaviour — but without them the tracker can only
   * guess, and guesses wrong: a job whose helper has already finished shows
   * as "Offered" because no `job_tracking` row exists to say otherwise.
   * Pass them (`job.helper_on_the_way_at` etc.) wherever the jobs row is in
   * hand — see `deriveCurrentStatusIdx`.
   */
  helperOnTheWayAt?: string | null;
  helperArrivedAt?: string | null;
  /**
   * The two-party arrival evidence (see `src/lib/arrivalGate.ts`).
   * `helperArrivalVerifiedAt` is stamped only when the SERVER computed the
   * helper within 500ft; `posterConfirmedArrivalAt` is the poster's vouch.
   * The tracker's Arrived step used to light identically for all three cases,
   * which is how a poster ended up looking at "Working" while still being
   * asked to confirm an arrival — two ladders drawn as one.
   */
  helperArrivalVerifiedAt?: string | null;
  posterConfirmedArrivalAt?: string | null;
  helperCompletedAt?: string | null;
  posterCompletedAt?: string | null;
  /**
   * Optional pre-fetched latest tracking row. When provided (including
   * `null`, meaning "no tracking row exists yet"), the per-card initial
   * `loadTracking()` round-trip is skipped — the parent has already
   * batched-fetched tracking for every card on the page. Realtime
   * subscriptions stay active so live updates after mount still flow.
   * Pass `undefined` (the default) for legacy callers — the component
   * falls back to its own per-mount fetch.
   */
  initialTracking?: TrackingData | null;
  /**
   * Job destination coordinates (from the jobs row). When provided alongside
   * helper live location, an Uber-style mini-map is shown while the helper
   * is "on_the_way". Both must be non-null for the map to render — the
   * existing ETA text is shown as fallback.
   */
  jobLatitude?: number | null;
  jobLongitude?: number | null;
  /**
   * Poster-side only: prepend the pre-assignment steps ("Posted",
   * "Applicants") so an OPEN job — one with no helper yet — still shows where
   * it stands. With this on the tracker renders without a `helperId`.
   */
  includePostingSteps?: boolean;
}) {
  // Seed from the parent-batched tracking row when present so we don't
  // fire one fetch per rendered card (N+1 across active jobs on Activity).
  const [tracking, setTracking] = useState<TrackingData | null>(initialTracking ?? null);
  const [updating, setUpdating] = useState(false);
  const [helperConfirmedAt, setHelperConfirmedAt] = useState(initialHelperConfirmedAt);
  const [posterConfirmedAt, setPosterConfirmedAt] = useState(initialPosterConfirmedAt);
  // Lifecycle stamps off the jobs row, mirrored into state so the realtime
  // `jobs` UPDATE below can advance the tracker without a parent refetch.
  const [jobStamps, setJobStamps] = useState({
    onTheWayAt: initialHelperOnTheWayAt ?? null,
    arrivedAt: initialHelperArrivedAt ?? null,
    arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
    posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
    helperCompletedAt: initialHelperCompletedAt ?? null,
    posterCompletedAt: initialPosterCompletedAt ?? null,
  });
  const { request: requestPermission } = usePermissionRationale();

  // Sync props
  useEffect(() => { setHelperConfirmedAt(initialHelperConfirmedAt); }, [initialHelperConfirmedAt]);
  useEffect(() => { setPosterConfirmedAt(initialPosterConfirmedAt); }, [initialPosterConfirmedAt]);
  useEffect(() => {
    setJobStamps({
      onTheWayAt: initialHelperOnTheWayAt ?? null,
      arrivedAt: initialHelperArrivedAt ?? null,
      arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
      posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
      helperCompletedAt: initialHelperCompletedAt ?? null,
      posterCompletedAt: initialPosterCompletedAt ?? null,
    });
  }, [initialHelperOnTheWayAt, initialHelperArrivedAt, initialHelperArrivalVerifiedAt, initialPosterConfirmedArrivalAt, initialHelperCompletedAt, initialPosterCompletedAt]);
  // Keep the batched-tracking prop in sync after activity refreshes — when
  // the parent refetches its batched job_tracking rows, the new value flows
  // back into the card (e.g. cache invalidation after a write).
  useEffect(() => {
    if (initialTracking !== undefined) setTracking(initialTracking);
  }, [initialTracking]);

  const loadTracking = useCallback(async () => {
    if (!helperId) return;
    const { data, error } = await supabase
      .from("job_tracking")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[JobTracking] failed to load tracking:", error);
      report(error, { severity: "warning", tags: { source: "JobTracking.load" } });
      toast.error("Couldn't load job tracking — try again?");
      return;
    }
    if (data && data.length > 0) {
      setTracking(data[0] as unknown as TrackingData);
    }
  }, [jobId, helperId]);

  useEffect(() => {
    if (!helperId) return;
    // Only fall back to a per-card fetch when the parent did NOT supply
    // pre-fetched tracking. Activity surfaces always supply it (even as
    // `null` to mean "no row yet"), so the initial query is eliminated;
    // the realtime channel below still patches live updates after mount.
    if (initialTracking === undefined) loadTracking();

    const channel = supabase
      .channel(`tracking-${jobId}-${channelNonce()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_tracking", filter: `job_id=eq.${jobId}` },
        (payload) => {
          if (payload.new && typeof payload.new === "object" && "id" in payload.new) {
            setTracking(payload.new as unknown as TrackingData);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            const updated = payload.new as any;
            if (updated.helper_confirmed_at !== undefined) setHelperConfirmedAt(updated.helper_confirmed_at);
            if (updated.poster_confirmed_at !== undefined) setPosterConfirmedAt(updated.poster_confirmed_at);
            setJobStamps((prev) => ({
              onTheWayAt: updated.helper_on_the_way_at !== undefined ? updated.helper_on_the_way_at : prev.onTheWayAt,
              arrivedAt: updated.helper_arrived_at !== undefined ? updated.helper_arrived_at : prev.arrivedAt,
              arrivalVerifiedAt: updated.helper_arrival_verified_at !== undefined ? updated.helper_arrival_verified_at : prev.arrivalVerifiedAt,
              posterConfirmedArrivalAt: updated.poster_confirmed_arrival_at !== undefined ? updated.poster_confirmed_arrival_at : prev.posterConfirmedArrivalAt,
              helperCompletedAt: updated.helper_completed_at !== undefined ? updated.helper_completed_at : prev.helperCompletedAt,
              posterCompletedAt: updated.poster_completed_at !== undefined ? updated.poster_completed_at : prev.posterCompletedAt,
            }));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // `initialTracking` is read once when the effect runs to decide whether
    // to skip the fallback fetch. Subsequent prop changes flow through the
    // sync-effect above, not here — so it intentionally stays out of deps.
  }, [jobId, helperId, loadTracking]);

  const getLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    if (!isNativePlatform && !navigator.geolocation) return null;
    let location: { lat: number; lng: number } | null = null;
    // Pre-prompt before the first OS dialog this session, so the helper
    // sees a friendly "we use your location to confirm arrival" message
    // before iOS shows its system alert.
    await requestPermission("location", async () => {
      // On native (iOS/Android) read through the Capacitor Geolocation
      // plugin only — falling through to the WKWebView navigator.geolocation
      // shim fires a SECOND "localhost would like to use your location"
      // prompt on top of the OS-native one.
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 10000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          /* denied / unavailable — leave location null */
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          () => resolve(),
          { timeout: 10000 },
        );
      });
    });
    return location;
  };


  const updateStatus = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);
    const now0 = new Date().toISOString();
    const loc = await getLocation();

    // ARRIVAL IS A TWO-PARTY, SERVER-VERIFIED EVENT.
    //
    // The client no longer decides whether the helper is close enough — it
    // hands its coordinates to `mark_helper_arrival`, which does the haversine
    // itself and stamps `helper_arrival_verified_at` only when the answer is
    // yes. The verdict is what the completion gate reads, and it is not a
    // value this code can send.
    //
    // NO FIX, OR TOO FAR, IS NOT A DEAD END. The helper still marks the claim
    // (`helper_arrived_at`) — the poster genuinely needs to know someone says
    // they're here — but a bare claim does NOT unlock wrap-up on its own. The
    // recourse is the poster: they can see the helper standing in front of
    // them, and their "Confirm They Arrived" tap satisfies the gate. That is
    // deliberate. Requiring location with no recourse would turn the accidental
    // trap this replaces (an unreachable `job_checkins` fallback) into policy,
    // and a helper inside a metal building would still be unable to get paid.
    let arrivalVerified: boolean | null = null;
    if (newStatus === "arrived") {
      const { data: verdict, error: arrivalErr } = await supabase.rpc("mark_helper_arrival", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (arrivalErr) {
        report(arrivalErr, { tags: { source: "JobTracking.markArrival" } });
        hapticError();
        toast.error(
          arrivalErr.code === "PGRST202"
            // Short window between merge and the auto-deploy landing.
            ? "Arrival check-in is updating — try again in a minute."
            : "Couldn't mark you arrived — try again?",
        );
        setUpdating(false);
        loadTracking();
        return;
      }
      const v = verdict as { verified?: boolean; distance_ft?: number | null } | null;
      arrivalVerified = !!v?.verified;
      setJobStamps((prev) => ({
        ...prev,
        arrivedAt: prev.arrivedAt ?? now0,
        arrivalVerifiedAt: arrivalVerified ? (prev.arrivalVerifiedAt ?? now0) : prev.arrivalVerifiedAt,
      }));
      if (!arrivalVerified) {
        // Say exactly what happened and exactly what unblocks them. Never
        // "enable GPS in Settings" and nothing else — that was the dead end.
        const far = v?.distance_ft != null;
        toast.warning(
          far
            ? `Marked arrived, but you're about ${v!.distance_ft}ft from the job site so we couldn't confirm it. Ask the poster to tap "Confirm They Arrived" — that unlocks wrap-up.`
            : "Marked arrived, but we couldn't get your location to confirm it. Turn Location on in Settings, or ask the poster to tap \"Confirm They Arrived\" — either one unlocks wrap-up.",
          { duration: 9000 },
        );
      }
    }

    const now = now0;
    setTracking(prev => prev ? { ...prev, status: newStatus, latitude: loc?.lat || prev.latitude, longitude: loc?.lng || prev.longitude, updated_at: now } : {
      id: "temp",
      status: newStatus,
      latitude: loc?.lat || null,
      longitude: loc?.lng || null,
      eta_minutes: null,
      updated_at: now,
    });

    // ON THE WAY IS ONE TRANSACTION, NOT THREE WRITES.
    //
    // This transition used to be three sequential client writes (tracking
    // upsert, jobs.status = in_progress, jobs.helper_on_the_way_at) — a run
    // interrupted after write #2 left status = in_progress with NO tracking
    // row and NO departure stamp (proven live 2026-08-28, job db21c20d). The
    // RPC does all three atomically, validates the caller is the confirmed
    // helper server-side, and — because status + timestamp land in ONE jobs
    // update — the notify trigger fires once instead of twice.
    //
    // PGRST202 fallback: merge→deploy window for a brand-new RPC (same
    // pattern as mark_helper_arrival above); the legacy sequence stays as
    // the fallback body below.
    let onTheWayAtomic = false;
    if (newStatus === "on_the_way") {
      const { error: otwErr } = await supabase.rpc("helper_mark_on_the_way", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (!otwErr) {
        onTheWayAtomic = true;
        setJobStamps((prev) => ({ ...prev, onTheWayAt: prev.onTheWayAt ?? now }));
      } else if (otwErr.code !== "PGRST202") {
        report(otwErr, { tags: { source: "JobTracking.markOnTheWay" } });
        hapticError();
        toast.error("Couldn't mark you on the way — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
      // PGRST202 → fall through to the legacy three-write sequence.
    }

    // .select("id") on both branches: the tracking row is the source of truth
    // for the helper's own view, and an update that matches zero rows returns
    // error === null — the card would have kept the optimistic status forever.
    try {
      if (!onTheWayAtomic)
      unwrapMutation(
        tracking && tracking.id !== "temp"
          ? await supabase
              .from("job_tracking")
              .update({
                status: newStatus,
                latitude: loc?.lat || null,
                longitude: loc?.lng || null,
                updated_at: now,
              })
              .eq("id", tracking.id)
              .select("id")
          : await supabase.from("job_tracking").insert({
              job_id: jobId,
              helper_id: helperId,
              status: newStatus,
              latitude: loc?.lat || null,
              longitude: loc?.lng || null,
            }).select("id"),
        {
          action: "update your status",
          rejectedMessage: "We couldn't update your status — this job may have been cancelled. Pull to refresh.",
          context: { jobId, newStatus },
        },
      );
    } catch (writeErr) {
      if (!isWriteRejected(writeErr)) {
        report(writeErr, { tags: { source: "JobTracking.updateStatus" } });
      }
      hapticError();
      toast.error(mutationErrorMessage(writeErr, "Couldn't update your status — try again?"));
      setUpdating(false);
      loadTracking();
      return;
    }

    // Auto-transition job status
    let statusTransitioned = false;
    if (newStatus === "done") {
      // SAME GATES AS "I'm Done — Request Payout" (owner, 2026-08-24 E2E):
      // this button used to write helper_completed_at with no checks at all,
      // so the before/after-photo requirement and the 30-minute work floor on
      // the payout CTA were decorative — the tracker was a free bypass that
      // still started the auto-release clock. Fetch the row fresh (this
      // component isn't handed proof URLs) and enforce both, with the reason
      // stated. The poster's working-confirmation is deliberately NOT
      // required (owner): a ghosting poster must not be able to block the
      // payout request — they keep the 24h review window instead.
      const { data: gate, error: gateErr } = await supabase
        .from("jobs")
        .select("proof_before_urls, proof_after_urls, poster_confirmed_working_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at")
        .eq("id", jobId)
        .single();
      if (gateErr) {
        report(gateErr, { tags: { source: "JobTracking.doneGateFetch" } });
        hapticError();
        toast.error("Couldn't check the job's completion requirements — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
      // ARRIVAL FIRST — the same rule completeJob and the DB trigger use.
      // This replaces nothing on this path (the tracker's Done step never
      // checked location at all), but it is the gate the payout CTA now
      // enforces, and the two must not disagree again.
      if (!arrivalEstablished(gate)) {
        hapticError();
        toast.error(arrivalGateMessage(gate), { duration: 8000 });
        setUpdating(false);
        loadTracking();
        return;
      }
      // ONE shared proof rule (photoProofPolicy) — same predicate the payout
      // CTA and completeJob's re-check enforce, same stated reason.
      const hasPhotos = hasRequiredProof(undefined, gate?.proof_before_urls, gate?.proof_after_urls);
      if (!hasPhotos) {
        hapticError();
        toast.error(requiredProof().reason);
        setUpdating(false);
        loadTracking();
        return;
      }
      const workStart = gate?.poster_confirmed_working_at ?? gate?.helper_arrived_at;
      const MIN_WORK_MS = 30 * 60 * 1000;
      if (workStart && Date.now() - new Date(workStart).getTime() < MIN_WORK_MS) {
        const minsLeft = Math.ceil((MIN_WORK_MS - (Date.now() - new Date(workStart).getTime())) / 60000);
        hapticError();
        toast.error(`Almost — Done unlocks in ${minsLeft} min. Jobs can't be completed in under 30 minutes.`);
        setUpdating(false);
        loadTracking();
        return;
      }
      // This stamp is what enters the job into the payout pipeline — if it
      // silently fails the helper never gets paid, so surface it and stop.
      // .select("id"): "silently fails" includes matching zero rows, which
      // returns error === null. Without the row count this stamp could no-op
      // (RLS, a job that already moved on) and the helper would be told the
      // payout clock had started.
      try {
        unwrapMutation(
          await supabase.from("jobs").update({ helper_completed_at: now }).eq("id", jobId).select("id"),
          {
            action: "mark the job complete",
            rejectedMessage: "We couldn't mark this job complete — it may have already been completed or cancelled. Pull to refresh.",
            context: { jobId },
          },
        );
      } catch (doneErr) {
        if (!isWriteRejected(doneErr)) {
          report(doneErr, { tags: { source: "JobTracking.helperCompleted" } });
        }
        hapticError();
        toast.error(mutationErrorMessage(doneErr, "Couldn't mark the job complete — try again?"));
        setUpdating(false);
        loadTracking();
        return;
      }
    } else if (["on_the_way", "arrived", "working"].includes(newStatus) && !onTheWayAtomic) {
      const { data: job, error: statusErr } = await supabase.from("jobs").select("status").eq("id", jobId).single();
      if (statusErr) report(statusErr, { tags: { source: "JobTracking.autoTransition" } });
      // These three writes used to drop their errors, while the `done` stamp
      // directly above was carefully checked. That asymmetry was the bug: these
      // are the exact columns the POSTER's timeline reads, so on an RLS or
      // network failure the helper saw "Status updated: On the way" and the
      // poster's screen never moved — a phantom success on the one signal the
      // poster is waiting for.
      //
      // The tracking row itself is already written and is the source of truth
      // for the helper's own view, so a failure here does not invalidate the
      // action — it just means the poster won't see it. Hence: report, and tell
      // the truth in the toast, rather than aborting the whole transition.
      //
      // .select("id") on all three: a zero-row update is the same phantom
      // success as an error here, and is the more likely of the two (RLS on
      // jobs the helper doesn't own, or a job cancelled out from under them).
      const stampErrors: string[] = [];
      const stampJob = async (
        patch: TablesUpdate<"jobs">,
        label: string,
        source: string,
      ) => {
        try {
          unwrapMutation(
            await supabase.from("jobs").update(patch).eq("id", jobId).select("id"),
            { action: `update the poster's ${label}`, context: { jobId } },
          );
        } catch (err) {
          if (!isWriteRejected(err)) report(err, { tags: { source } });
          stampErrors.push(label);
        }
      };
      if (job && job.status === "accepted") {
        await stampJob({ status: "in_progress" }, "status", "JobTracking.statusInProgress");
        statusTransitioned = true;
      }
      // `helper_arrived_at` is NOT stamped here any more — mark_helper_arrival
      // above wrote it (and the status transition) inside the same transaction
      // that decided whether the arrival was verified. Stamping it a second
      // time from the client would be the only writer able to set it without a
      // proximity verdict attached.
      if (newStatus === "on_the_way") {
        await stampJob({ helper_on_the_way_at: now }, "departure time", "JobTracking.onTheWayAt");
      }
      if (stampErrors.length > 0) {
        hapticError();
        toast.error("Saved for you, but we couldn't update the poster's view — check your connection.");
        setUpdating(false);
        loadTracking();
        return;
      }
    }

    // Notify the poster — ONLY when no server-side writer already did.
    //
    // Every transit event used to notify TWICE (proven live 2026-08-28, job
    // db21c20d): the notify_poster_on_status_change DB trigger
    // (20260824070000, kept — it fires even if this client dies mid-flow)
    // AND this block. Per-event server coverage:
    //   - on_the_way : trigger on jobs.helper_on_the_way_at (stamped by the
    //                  helper_mark_on_the_way RPC or the legacy stampJob) →
    //                  client notification REMOVED.
    //   - arrived    : trigger on jobs.helper_arrived_at (stamped by
    //                  mark_helper_arrival) → REMOVED.
    //   - done       : trigger on jobs.helper_completed_at → REMOVED.
    //   - working    : trigger fires only on the accepted→in_progress status
    //                  transition ("Work has started"). When the job is
    //                  ALREADY in_progress (the normal case — on_the_way set
    //                  it) no jobs column changes at the "working" tap, so no
    //                  server writer exists and the client one is KEPT.
    // Link: /my-posts?filter=scheduled — the old filter=in_progress is not a
    // bucket Activity knows (needs_you/scheduled/waiting/done) and landed on
    // the default list; a poster's in_progress job buckets as "scheduled".
    if (isHelper && newStatus === "working" && !statusTransitioned) {
      const { data: job, error: notifyErr } = await supabase.from("jobs").select("title, customer_id").eq("id", jobId).single();
      if (notifyErr) report(notifyErr, { tags: { source: "JobTracking.notifyPoster" } });
      if (job?.customer_id) {
        const { createNotification } = await import("@/lib/notifications");
        await createNotification({
          user_id: job.customer_id,
          title: "Work has started",
          message: `Your Helpr started working on "${job.title}".`,
          type: "info",
          link: `/my-posts?filter=scheduled`,
        });
      }
    }

    hapticSuccess();
    setUpdating(false);
    loadTracking();
  };

  // Determine current status index from every signal available — see
  // `deriveCurrentStatusIdx` for why the jobs row has to be read too.
  const bothConfirmed = !!helperConfirmedAt && !!posterConfirmedAt;

  const currentStatusIdx = deriveCurrentStatusIdx({
    trackingStatus: tracking?.status,
    jobStatus,
    helperConfirmedAt,
    helperDayofConfirmedAt,
    jobDateNeeded,
    posterConfirmedAt,
    helperOnTheWayAt: jobStamps.onTheWayAt,
    helperArrivedAt: jobStamps.arrivedAt,
    helperCompletedAt: jobStamps.helperCompletedAt,
    posterCompletedAt: jobStamps.posterCompletedAt,
  });

  // What the STEP ROW draws. Without the posting steps this is exactly the old
  // behaviour (`STATUSES` / `currentStatusIdx`); with them the row is offset by
  // the two prepended steps, and a job with nobody assigned yet sits on
  // "Posted" or — once at least one application is in — "Applicants".
  // WHOSE job this is, for the tracker heading. It used to caption the current
  // STEP, which cost every step column a third line to hold one word on one of
  // them and moved down the row as the job advanced. A helpr tracking their own
  // job needs no one named, hence the `isHelper` gate at the call site.
  const firstName = helperName?.trim().split(/\s+/)[0] ?? null;

  const currentArrivalState = arrivalState({
    helper_arrived_at: jobStamps.arrivedAt,
    helper_arrival_verified_at: jobStamps.arrivalVerifiedAt,
    poster_confirmed_arrival_at: jobStamps.posterConfirmedArrivalAt,
  });
  const arrivalCaption = arrivalStateLabel(currentArrivalState);

  // Timestamp behind each COMPLETED step, for the tap/hover tooltip below.
  // Reuses fields the tracker already has in scope — no new backend field.
  // Steps with no reliable single timestamp (Offered/Posted, Working — the
  // "working" span has a start but no dedicated stamp on this row) render
  // without a tooltip rather than guessing.
  const stepTimestamps: Partial<Record<string, string | null | undefined>> = {
    confirmed: helperConfirmedAt,
    job_confirmed: posterConfirmedAt,
    on_the_way: jobStamps.onTheWayAt,
    arrived: jobStamps.arrivedAt ?? jobStamps.arrivalVerifiedAt ?? jobStamps.posterConfirmedArrivalAt,
    done: jobStamps.helperCompletedAt ?? jobStamps.posterCompletedAt,
  };
  const [openStepTooltip, setOpenStepTooltip] = useState<string | null>(null);

  const displaySteps = includePostingSteps ? [...PRE_STATUSES, ...STATUSES] : STATUSES;
  const displayIdx = includePostingSteps
    ? helperId
      ? PRE_STATUSES.length + currentStatusIdx
      : 0
    : currentStatusIdx;

  // The step row is ONE horizontally-scrolling line (owner: "the live tracker
  // should be 1 scrollable line"). Because it scrolls, the current step can sit
  // off-screen — so it is scrolled back into view whenever the job advances.
  //
  // `scrollIntoView` is deliberately NOT used: with `block`/`inline` it walks up
  // to the nearest scrollable ancestor and, if this row were ever non-scrollable,
  // would yank the whole activity feed instead. Setting `scrollLeft` on the row
  // itself cannot escape the element, so the feed can never move.
  const stepRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = stepRowRef.current;
    if (!row) return;
    const step = row.children[displayIdx] as HTMLElement | undefined;
    if (!step) return;
    const target = step.offsetLeft - (row.clientWidth - step.offsetWidth) / 2;
    const max = row.scrollWidth - row.clientWidth;
    row.scrollTo({
      left: Math.max(0, Math.min(target, max)),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [displayIdx]);

  // Edge fade. A step that straddles the card edge used to read as chopped
  // text ("On the W…"), giving no clue the row scrolls. A mask feathers
  // whichever edge still has content behind it — and ONLY that edge, so a row
  // that fits (or is scrolled to an end) isn't dimmed for no reason.
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const row = stepRowRef.current;
    if (!row) return;
    const sync = () => {
      const max = row.scrollWidth - row.clientWidth;
      setEdges({ start: row.scrollLeft > 1, end: row.scrollLeft < max - 1 });
    };
    sync();
    row.addEventListener("scroll", sync, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(row);
    return () => {
      row.removeEventListener("scroll", sync);
      ro?.disconnect();
    };
  }, [displaySteps.length]);

  // A half-cut 68px step leaves ~34px of label showing, so a 20px fade ended
  // BEFORE the cut text and the label still read as hard-clipped — measured on
  // an iPhone 17 Pro, the row showed a crisp "ed" (Accepted) at the left edge
  // and "W" (Working) at the right. 36px covers the sliver a half-cut step
  // actually leaves, which is what the fade was for.
  const FADE = "36px";
  const stepRowMask = `linear-gradient(to right, transparent 0, black ${edges.start ? FADE : "0px"}, black calc(100% - ${edges.end ? FADE : "0px"}), transparent 100%)`;

  if (!helperId && !includePostingSteps) return null;

  return (
    // p-3 / space-y-2, and NO visible heading (owner: "drop the Job tracking
    // heading", 2026-08-24) — the step row is self-evidently a tracker, and
    // the serif heading + name row was ~50px of every card. The heading stays
    // for screen readers (a landmark region with steps but no name announces
    // as loose fragments); the helper's NAME moved down to the freshness
    // stamp, which is the line that describes their last ping anyway.
    <div className="rounded-2xl liquid-glass p-3 space-y-2">
      <h3 className="sr-only">Job tracking</h3>
      {/* NO SOS PILL HERE (owner: "remove globally") — it lives in the action
          row with every other control, on both sides of the job. */}


      {/* Progress timeline */}
      {(() => {
        // ONE scrolling line, seven steps (owner: "the live tracker should be
        // 1 scrollable line"). It was previously a 4 + 3 wrapping grid, which
        // was itself a fix for an earlier scroller that sliced whatever step
        // straddled the card edge — the reported "On the W".
        //
        // That slicing is why every step has a FIXED width and `shrink-0`
        // rather than being sized by its label: the row can only ever be cut
        // between steps, never through one, so no label is clipped mid-word at
        // any width. `snap-x`/`snap-center` land the scroll on whole steps for
        // the same reason.
        return (
          // The mask lives on this NON-SCROLLING wrapper, not on the scroller
          // itself. Measured on device: the row reported sw=652 cw=260, and
          // WebKit sizes a mask on a scroll container to its SCROLLABLE
          // CONTENT, not its visible box — so `calc(100% - 36px)` put the fade
          // at x≈616 of 652, permanently scrolled out of sight. The fade was
          // being painted correctly and could never be seen, which is why
          // widening it from 20px to 36px changed nothing. On a wrapper that
          // does not scroll, 100% is the visible 260px and the fade lands on
          // the edges the user is actually looking at.
          <div
            className="-mx-1 px-1"
            style={{ maskImage: stepRowMask, WebkitMaskImage: stepRowMask }}
          >
          <div
            ref={stepRowRef}
            // A scrolling region must be keyboard-reachable or axe's
            // `scrollable-region-focusable` fails — arrow keys need somewhere
            // to land now that content can sit off-screen. The group role +
            // label keep it announcing as "Job progress, group" rather than
            // seven loose fragments.
            tabIndex={0}
            role="group"
            aria-label="Job progress"
            className="flex gap-1 overflow-x-auto scrollbar-hide snap-x py-0.5 items-start"
            // `safe center` — the row centres in its card when the steps FIT,
            // and falls back to start-aligned the moment they don't (owner:
            // "center better globally"). Plain `center` would keep centring
            // while overflowing, which pushes the first steps off the LEFT edge
            // where no scroll gesture reaches them — the bug the `safe` keyword
            // exists for. Eight steps at 68px fit a desktop card and overflow a
            // phone one, so this row is on both sides of that line depending on
            // the screen, and neither alignment alone is right for both.
            style={{ justifyContent: "safe center" }}
          >
            {displaySteps.map((s, idx) => {
              const isActive = idx <= displayIdx;
              const isCurrent = idx === displayIdx;
              const isPassed = idx < displayIdx;
              // Whole tracker reached the end — every active step reads as
              // done, current dot included (owner: "if it reaches Done, all
              // green").
              const allDone = displayIdx === displaySteps.length - 1;
              // A dispute is pinned to the Working step specifically —
              // wherever the row actually is when it happens, "Working" is
              // where the job went wrong, so it stays red even once the job
              // has since moved past it.
              const disputedWorking = jobStatus === "disputed" && s.key === "working";
              // THE CURRENT STEP CARRIES THE TROUBLE. A job in revision or in
              // dispute used to paint the same bark green as one running
              // perfectly, so the tracker — the biggest thing on the card —
              // was the one element that never said anything had gone wrong.
              // Amber for a resolution pending (not yet escalated), red for a
              // dispute (owner). Only the CURRENT dot changes here — the
              // steps behind it really did happen and recolouring the whole
              // line would read as "none of this counts" — except Working
              // under an open dispute, and Done once the whole job is green.
              const currentTone =
                jobStatus === "disputed"
                  ? { fill: "hsl(var(--destructive))", ring: "hsl(var(--destructive) / 0.30)" }
                  : jobStatus === "revision_requested"
                    ? { fill: "hsl(var(--amber-solid))", ring: "hsl(var(--amber-solid) / 0.30)" }
                    : allDone
                      ? { fill: "hsl(var(--success-ink))", ring: "hsl(var(--success-ink) / 0.30)" }
                      : { fill: "hsl(var(--bark))", ring: "hsl(var(--bark) / 0.30)" };
              const Icon = s.icon;
              const ts = stepTimestamps[s.key];
              // Tooltip only on a genuinely COMPLETED step (passed, or the
              // final Done step once the whole job is green) that has a
              // timestamp to show — never on the still-in-progress current
              // step, which has no "when" yet.
              const showTooltip = !!ts && (isPassed || (isCurrent && allDone));
              const Wrapper = showTooltip ? "button" : "div";
              return (
                <div
                  key={s.key}
                  // `grow` on a `w-[68px] shrink-0` basis: the steps SHARE any
                  // spare width instead of huddling in the middle of a wide
                  // card (owner: "spread out more to fill space"), and the
                  // moment the row is narrower than 8 × 68px they stop growing,
                  // hold their width and scroll — `shrink-0` is what keeps a
                  // label from being squeezed into a hyphenated column.
                  className="w-[60px] shrink-0 grow snap-center flex flex-col items-center gap-1 relative"
                >
                  <Wrapper
                    {...(showTooltip
                      ? {
                          type: "button" as const,
                          onClick: (e: ReactMouseEvent) => {
                            e.stopPropagation();
                            setOpenStepTooltip((k) => (k === s.key ? null : s.key));
                          },
                          onMouseEnter: () => setOpenStepTooltip(s.key),
                          onMouseLeave: () => setOpenStepTooltip((k) => (k === s.key ? null : k)),
                          "aria-label": `${s.label} — ${new Date(ts as string).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
                        }
                      : {})}
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-all !min-h-0 !min-w-0"
                    style={
                      disputedWorking
                        ? {
                            background: "hsl(var(--destructive))",
                            color: "hsl(var(--parchment))",
                          }
                        : isCurrent
                        ? {
                            background: currentTone.fill,
                            color: "hsl(var(--parchment))",
                            boxShadow: `0 0 0 2px ${currentTone.ring}, 0 0 0 4px hsl(var(--parchment))`,
                          }
                        : isPassed || (isActive && allDone)
                          ? { background: "hsl(var(--success-ink) / 0.20)", color: "hsl(var(--success-ink))" }
                          : isActive
                            ? { background: "hsl(var(--bark) / 0.18)", color: "hsl(var(--bark))" }
                            : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.80)" }
                    }
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </Wrapper>
                  {/* Tap/hover tooltip on a completed step, showing when it
                      happened. `showTooltip` gates this to steps that both
                      have a timestamp and are actually done — see the
                      Wrapper/showTooltip logic above. */}
                  {showTooltip && openStepTooltip === s.key && (
                    <div
                      role="tooltip"
                      className="absolute top-8 z-20 px-2 py-1 rounded-ds-md text-ds-9 font-sans font-semibold whitespace-nowrap pointer-events-none"
                      style={{
                        background: "hsl(var(--ink-deep))",
                        color: "hsl(var(--parchment))",
                        boxShadow: "0 4px 14px -4px hsl(var(--ink-deep) / 0.4)",
                      }}
                    >
                      {new Date(ts as string).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                  <span
                    // ds-9 below 360px so "Confirmed" — the longest unbreakable
                    // label — still fits its column on a 320px phone.
                    //
                    // `w-full` is load-bearing. Without it the span sized to its
                    // TEXT, not to the 68px column, so a wider label ("On the
                    // Way") spilled out of its own step and got sliced by the
                    // row's edge — the crisp "ed" and "W" the owner reported.
                    // The comment above this row claims a step "can only ever
                    // be cut between steps, never through one"; that was only
                    // true of the step BOX, never of the label inside it.
                    // Constrained to the column, a long label wraps within its
                    // own step and the edge mask feathers whole steps as
                    // intended.
                    className="w-full text-ds-9 min-[360px]:text-ds-10 font-sans font-semibold text-center leading-tight"
                    style={{
                      color: isCurrent
                        ? "hsl(var(--bark))"
                        : isActive
                          ? "hsl(var(--ink-deep))"
                          : "hsl(var(--olivewood) / 0.80)",
                    }}
                  >
                    {s.label}
                  </span>
                  {/* ETA rides UNDER ITS OWN STEP (owner: "put eta under on
                      the way"). It used to be a centred paragraph below the
                      map, a full card-width away from the word it qualifies —
                      so "On the Way" and "~12 min" were two unrelated-looking
                      facts and the reader had to join them. Here the number is
                      the step's own caption.

                      Only this step, only while the helpr is actually en
                      route, so no other column ever gains a third line and the
                      row keeps the tight rhythm the heading-name move bought
                      it. `items-start` on the row means the taller column
                      hangs below the others rather than pushing them down. */}
                  {/* ARRIVED CARRIES ITS OWN VERIFICATION STATE (owner:
                      "light it when helpr says they arrived but poster has to
                      confirm"). The step lights on the helper's mark, and this
                      caption says which of the three things that mark actually
                      is — poster-confirmed, location-confirmed, or a claim
                      still waiting on the poster. Without it the tracker drew
                      all three identically, which is how a poster ended up
                      reading "Working" while their card still asked them to
                      confirm the arrival: two ladders, one drawing. */}
                  {/* Only while Arrived is still the CURRENT step. Once the
                      job progresses past it (Working, Done, …) the caption
                      went stale — a job sitting on "Working" still showed
                      "Poster confirmed" frozen under Arrived, which no
                      longer told the reader anything they didn't already
                      know from the step being lit. */}
                  {s.key === "arrived" && idx === displayIdx && arrivalCaption && (
                    <span
                      className="w-full text-ds-9 font-sans font-semibold text-center leading-tight"
                      style={{
                        color:
                          currentArrivalState === "claimed"
                            ? "hsl(var(--amber-ink))"
                            : "hsl(var(--bark))",
                      }}
                    >
                      {arrivalCaption}
                    </span>
                  )}
                  {s.key === "on_the_way" &&
                    tracking?.status === "on_the_way" &&
                    tracking.eta_minutes != null && (
                      <span
                        className="w-full text-ds-9 font-sans font-semibold text-center leading-tight tabular-nums"
                        style={{ color: "hsl(var(--bark))" }}
                      >
                        ~{tracking.eta_minutes} min
                      </span>
                    )}
                </div>
              );
            })}
          </div>
          </div>
        );
      })()}

      {/* Progress bar/fill-line REMOVED (owner, 2026-08-30) — the step icons
          already convey progress on their own; a second bar duplicating the
          same "how far along" signal directly beneath them was redundant. */}

      {/* Last update — directly below the step row (used to sit below the
          removed progress bar; the freshness stamp still closes the tracker
          it vouches for). */}
      {tracking && (
        <p className="text-ds-10 text-muted-foreground text-center">
          {/* The helper's name opens the stamp — this line describes THEIR
              last ping, and it is where the name landed when the heading row
              was dropped (owner card only, same rule as before). */}
          {!isHelper && firstName ? `${firstName} · ` : ""}
          Updated {new Date(tracking.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {/* The coordinate stamp is the PROOF, so its absence has to be
              stated rather than left blank. A helpr with location off can now
              mark themselves arrived by attestation (see `updateStatus`), and
              a self-reported arrival that rendered identically to a
              GPS-confirmed one would be the app quietly overstating what it
              knows. Only shown from `arrived` onward — before that there is
              nothing to have proved. */}
          {tracking.latitude ? (
            <span className="ml-2 inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5" />
              {/* Human distance, not raw coordinates (owner, 2026-08-24:
                  "29.9477, -91.9887" reads as developer output). The GPS fix
                  is still the proof — it is just stated as the fact a person
                  actually wants: how far from the job the helpr's last ping
                  was. Falls back to a plain "GPS confirmed" when the job has
                  no coordinates to measure against. */}
              {jobLatitude != null && jobLongitude != null && tracking.longitude != null
                ? (() => {
                    const mi = haversineMiles(
                      tracking.latitude,
                      tracking.longitude,
                      jobLatitude,
                      jobLongitude,
                    );
                    return mi < 0.1
                      ? "GPS confirmed · at the job"
                      : `GPS confirmed · ${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi from job`;
                  })()
                : "GPS confirmed"}
            </span>
          ) : (STATUS_IDX[tracking.status as keyof typeof STATUS_IDX] ?? -1) >= STATUS_IDX.arrived ? (
            <span className="ml-2 inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5" />
              Location not shared
            </span>
          ) : null}
        </p>
      )}

      {/* Live-tracking map — shown while helper is on the way and both
          positions are known. Lazy-loaded so the Leaflet chunk isn't paid
          for by cards that never enter this state. Falls back silently to
          the ETA caption on the tracker step when coordinates are unavailable or the
          Leaflet bundle hasn't loaded yet. */}
      {tracking?.status === "on_the_way" &&
        tracking.latitude != null &&
        tracking.longitude != null &&
        jobLatitude != null &&
        jobLongitude != null && (
          <Suspense fallback={null}>
            <TrackingMap
              helperLat={tracking.latitude}
              helperLng={tracking.longitude}
              destLat={jobLatitude}
              destLng={jobLongitude}
            />
          </Suspense>
        )}


      {/* Helper controls — skip the job_confirmed step since that's handled by JobConfirmation */}
      {isHelper && (() => {
        let jobDay: Date | null = null;
        if (jobDateNeeded) {
          jobDay = parseLocalDate(jobDateNeeded);
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find next actionable status (skip job_confirmed — handled by JobConfirmation component)
        let nextIdx = currentStatusIdx + 1;
        if (nextIdx < STATUSES.length && STATUSES[nextIdx].key === "job_confirmed") {
          // If both confirmed, skip to on_the_way; otherwise stay (no button shown)
          if (bothConfirmed) {
            nextIdx++;
          } else {
            /* "Confirm the job below" is only true once there IS something
               below. JobConfirmation opens 24 hours out; before that it used
               to render nothing, so this line pointed at an empty space.
               JobConfirmation now shows its own "opens in …" card in that
               window, and this line matches it rather than contradicting it. */
            const confirmOpen =
              !jobDay || jobDay.getTime() - Date.now() <= 24 * 3_600_000;
            /* Silent before the window opens: JobConfirmation renders its own
               "Confirmation opens in …" strip directly below in that state and
               says the same thing with a clock attached. Two sentences saying
               "you'll confirm later", stacked, is the duplication this card
               keeps being audited for. */
            if (!confirmOpen) return null;
            return (
              <div className="pt-2 border-t border-border">
                <p className="text-ds-11 text-muted-foreground text-center">
                  Confirm the job below to unlock the next step
                </p>
              </div>
            );
          }
        }

        const nextStatus = STATUSES[nextIdx];
        if (!nextStatus) return null;

        // While a revision is open, the revision flow OWNS completion (the
        // card's "Mark Fixed" → poster accepts). The tracker caps its index
        // at Working in this state, which made its next-step button "Done" —
        // so the card offered Done, "I'll Fix It" and "Mark Fixed" at once,
        // three CTAs for one decision. Hide the tracker's Done here.
        if (nextStatus.key === "done" && jobStatus === "revision_requested") return null;

        // Locked until TWO HOURS BEFORE the start time, not just until
        // midnight of the job day (owner, 2026-08-24 transition audit): the
        // old gate let a helper tap "On the Way" at 7 AM for an 8 PM job,
        // starting the tracker half a day early and making the poster's
        // "they're on the way" signal meaningless. A job with no start_time
        // falls back to the old day gate — with nothing to measure against,
        // day-of is the honest window.
        const startAt = jobDay
          ? (() => {
              if (!jobStartTime) return null;
              const [h, m] = jobStartTime.split(":").map(Number);
              const d = new Date(jobDay);
              d.setHours(h || 0, m || 0, 0, 0);
              return d;
            })()
          : null;
        const UNLOCK_BEFORE_MS = 2 * 3_600_000;
        const isLocked = startAt
          ? Date.now() < startAt.getTime() - UNLOCK_BEFORE_MS
          : jobDay
            ? today < jobDay
            : false;
        const lockMessage = isLocked
          ? startAt
            ? (() => {
                // Date-stamp the UNLOCK moment, not the job's day — for an
                // early-morning start the 2h-before unlock lands on the
                // PREVIOUS calendar day (a 12:00 AM Aug 29 job unlocks
                // 10:00 PM Aug 28; the old string said "on Aug 29").
                const unlockAt = new Date(startAt.getTime() - UNLOCK_BEFORE_MS);
                const unlockDay = new Date(unlockAt);
                unlockDay.setHours(0, 0, 0, 0);
                const dateSuffix = today < unlockDay ? ` on ${formatShortDate(unlockDay)}` : "";
                return `Actions unlock at ${unlockAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${dateSuffix}`;
              })()
            : `Actions available on ${formatShortDate(jobDay!)}`
          : null;

        return (
          <div className="pt-2 border-t border-border space-y-2">
            {isLocked && lockMessage && (
              <p className="text-ds-11 text-muted-foreground text-center">{lockMessage}</p>
            )}
            <Button
              size="sm"
              className="w-full"
              onClick={() => updateStatus(nextStatus.key)}
              disabled={updating || isLocked}
            >
              <nextStatus.icon className="w-3.5 h-3.5 mr-1" />
              {nextStatus.label}
            </Button>
          </div>
        );
      })()}

    </div>
  );
}
