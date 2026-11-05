import { useEffect, useRef, useState, useCallback } from "react";
import { doneFloorStart, useDoneFloorActive } from "@/components/job-card/useDoneFloor";
import { useContinueDay } from "@/hooks/useContinueDays";
import { continueDayDoneNote } from "@/lib/continueDayWords";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { subscribeJobRealtime } from "@/lib/jobRealtimeBus";
import { toast } from "sonner";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { arrivalEvidenceState, arrivalMapLabel, arrivalState, type ArrivalRefusal } from "@/lib/arrivalGate";
import { railDisplayIdx } from "@/components/tracker/railDisplayIdx";
import { report } from "@/lib/errorLogger";
import { startEnRouteWatch, type EnRouteMode } from "@/lib/enRouteLocation";
import type { CardFace } from "@/components/tracker/jobStepFromWait";
import { useInJobStepRow } from "@/components/job-card/jobStepRow";
import { JobTrackingView } from "./JobTrackingView";
import { trackingLocation } from "./trackingLocation";
import { statusUpdate } from "./statusUpdate";

import { STATUSES, PRE_STATUSES } from "@/components/job-card/trackerSteps";

export { STATUS_IDX, deriveCurrentStatusIdx } from "@/lib/jobProgressIndex";
import { STATUS_IDX, deriveCurrentStatusIdx } from "@/lib/jobProgressIndex";

export { trackingProofCaption } from "./trackingProofCaption";
export { shouldShowTrackingMap } from "./trackingMapGate";
import { shouldShowTrackingMap } from "./trackingMapGate";


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

function useJobTrackingModel({
  jobId,
  helperId,
  helperName,
  posterName,
  // `helperName` was not destructured for a while — nothing in here reads it since
  // the name left the freshness stamp (owner, 2026-09-16). Still accepted on
  // the type so the poster card's call site is unchanged.
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
  helperArrivalNearMissAt: initialHelperArrivalNearMissAt,
  helperCompletedAt: initialHelperCompletedAt,
  // Optional. Supplied by the surface that already holds the job row, so the
  // Done CTA can honour the proof gate at RENDER time instead of only on tap.
  // Undefined means "caller doesn't know", and the gate stays inactive — the
  // click-time check below is unchanged and remains the enforcement.
  proofBeforeUrls,
  proofAfterUrls,
  requirePhotoProof,
  posterCompletedAt: initialPosterCompletedAt,
  posterConfirmedWorkingAt = null,
  initialTracking,
  jobLatitude,
  jobLongitude,
  includePostingSteps = false,
  embedded = false,
  rescheduled = false, progressCard,
}: {
  jobId: string;
  helperId: string | null;
  /**
   * Display name of the assigned helper. NO LONGER RENDERED by this component
   * (owner, 2026-09-16: "remove the name to the left of updated"): it used to
   * open the freshness stamp — "Camille · Updated 4:12 PM" — and before that
   * captioned the progress bar. The name is printed once now, by the
   * PersonTile the card hands in (now above the action row, not here — owner,
   * 2026-09-19). Still accepted, and still passed by the poster card, so no
   * call site had to change with the caption.
   */
  helperName?: string | null;
  /** The poster's name, for the Helpr's tracker line ("Waiting on Lexi to confirm"); first word only is shown. */
  posterName?: string | null;
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
  /** VN-33(b): a within-a-mile near miss (the map pin may be wrong). */
  helperArrivalNearMissAt?: string | null;
  helperCompletedAt?: string | null;
  /** Optional; when omitted the Done CTA's render-time proof gate stays off. */
  proofBeforeUrls?: string[] | null;
  proofAfterUrls?: string[] | null;
  /** The poster's per-job photo answer. Omitted = required, which is the
   *  column's own NOT NULL DEFAULT and the pre-migration behaviour. */
  requirePhotoProof?: boolean | null;
  posterCompletedAt?: string | null;
  /** `jobs.poster_confirmed_working_at`: starts the 30-minute Done floor (useDoneFloor). */
  posterConfirmedWorkingAt?: string | null;
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
   * the helper's last tracking ping, a mini-map is shown from "on_the_way"
   * until the job is marked done (owner, 2026-09-14). Both must be non-null
   * for the map to render — the status line is the fallback.
   */
  jobLatitude?: number | null;
  jobLongitude?: number | null;
  /* `personTile` WAS HERE and is GONE (owner, 2026-09-19, third position for
     this tile in five days): "the helpr or posted by should be right above the
     buttons". It is no longer anywhere near the tracker, so a slot here would
     be a prop nobody passes. Both cards now publish the tile through
     `JobCardPersonContext` (src/components/job-card/jobCardPerson.tsx) and the
     step shell renders it directly above the action row. This component is
     back to owning only the position. */
  /**
   * Poster-side only: prepend the pre-assignment steps ("Posted",
   * "Applicants") so an OPEN job — one with no helper yet — still shows where
   * it stands. With this on the tracker renders without a `helperId`.
   */
  includePostingSteps?: boolean;
  /** Drop this panel's own `rounded-2xl liquid-glass p-3` chrome, for a caller
   *  that already wraps it in a card (HelperTrackerPanel). Without it the
   *  tracker is a bordered card nested directly inside another one.
   *  `src/test/noNestedTrackerCard.test.ts` enforces this at every call site. */
  embedded?: boolean;
  /** Moved by an accepted change (useJobRescheduled in the caller): the line names the new slot (owner, 2026-10-21). */
  rescheduled?: boolean;
  /** The poster card's own line and face for an OPEN job: it knows the applicants, this panel does not (A2-B15). */
  progressCard?: CardFace;
}) {
  // Seed from the parent-batched tracking row when present so we don't
  // fire one fetch per rendered card (N+1 across active jobs on Activity).
  const [tracking, setTracking] = useState<TrackingData | null>(initialTracking ?? null);
  // AUD31-79: whether the tracking row has been read (handed in by the list, or this card's own read answered). Until
  // then the tracker draws from the job row alone, which can name an earlier step than the row will.
  const [trackingSettled, setTrackingSettled] = useState(initialTracking !== undefined);
  const [updating, setUpdating] = useState(false);
  /** Which tier of en-route tracking the RUNTIME actually established — never
   *  what we hoped for. `null` means no watch is running. Drives both the
   *  helper's honesty banner and the poster's freshness stamp. */
  const [, setEnRouteMode] = useState<EnRouteMode | null>(null);
  // The tracker's final step requests the payout, so it asks first — see the
  // BrandConfirmDialog at the bottom of the helper controls.
  const [confirmDoneOpen, setConfirmDoneOpen] = useState(false);
  /**
   * LEGACY ONLY since 2026-09-19. Why an "I've arrived" tap was REFUSED, back
   * when `mark_helper_arrival` refused far or fix-less arrivals and wrote
   * nothing (VN-33, 20260915044137). Migration 20260919155016 removed every
   * refusal — the RPC now records the check-in on every call — so this can only
   * be set by a response from the previous definition (a queued request, or a
   * client that raced the auto-deploy). It is deliberately NOT repurposed for
   * "your location didn't verify": that is an ordinary, expected outcome now
   * and it is read off the stamps, not off an error.
   */
  const [arrivalRefusal, setArrivalRefusal] = useState<ArrivalRefusal | { kind: "denied" } | null>(null);
  const [helperConfirmedAt, setHelperConfirmedAt] = useState(initialHelperConfirmedAt);
  const [posterConfirmedAt, setPosterConfirmedAt] = useState(initialPosterConfirmedAt);
  // Lifecycle stamps off the jobs row, mirrored into state so the realtime
  // `jobs` UPDATE below can advance the tracker without a parent refetch.
  const [jobStamps, setJobStamps] = useState({
    onTheWayAt: initialHelperOnTheWayAt ?? null,
    arrivedAt: initialHelperArrivedAt ?? null,
    arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
    posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
    nearMissAt: initialHelperArrivalNearMissAt ?? null,
    helperCompletedAt: initialHelperCompletedAt ?? null,
    posterCompletedAt: initialPosterCompletedAt ?? null,
  });
  const doneFloorActive = useDoneFloorActive(doneFloorStart(posterConfirmedWorkingAt, jobStamps.arrivedAt));
  // A day set to finish still ahead (Auditor 11, 11-01): the server refuses "done" until then
  // (continue_day_ahead), so the Done step is greyed with the note, as on the job page and the card face.
  const continueDayNote = continueDayDoneNote(useContinueDay(jobId, jobStatus === "in_progress"));
  const { request: requestPermission } = usePermissionRationale();
  /** Mounted inside a job step card, the next-step CTA is THAT card's primary
   *  and renders in its one action row (owner, 2026-09-14, VN-21). */
  const inStepRow = useInJobStepRow();

  // Sync props
  useEffect(() => { setHelperConfirmedAt(initialHelperConfirmedAt); }, [initialHelperConfirmedAt]);
  useEffect(() => { setPosterConfirmedAt(initialPosterConfirmedAt); }, [initialPosterConfirmedAt]);
  useEffect(() => {
    setJobStamps({
      onTheWayAt: initialHelperOnTheWayAt ?? null,
      arrivedAt: initialHelperArrivedAt ?? null,
      arrivalVerifiedAt: initialHelperArrivalVerifiedAt ?? null,
      posterConfirmedArrivalAt: initialPosterConfirmedArrivalAt ?? null,
      nearMissAt: initialHelperArrivalNearMissAt ?? null,
      helperCompletedAt: initialHelperCompletedAt ?? null,
      posterCompletedAt: initialPosterCompletedAt ?? null,
    });
  }, [initialHelperOnTheWayAt, initialHelperArrivedAt, initialHelperArrivalVerifiedAt, initialPosterConfirmedArrivalAt, initialHelperArrivalNearMissAt, initialHelperCompletedAt, initialPosterCompletedAt]);
  // Keep the batched-tracking prop in sync after activity refreshes — when
  // the parent refetches its batched job_tracking rows, the new value flows
  // back into the card (e.g. cache invalidation after a write).
  useEffect(() => {
    if (initialTracking !== undefined) {
      setTracking(initialTracking);
      setTrackingSettled(true);
    }
  }, [initialTracking]);

  const loadTracking = useCallback(async () => {
    if (!helperId) return;
    const { data, error } = await supabase
      .from("job_tracking")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    setTrackingSettled(true);
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

  const jobTerminal = jobStatus === "completed" || jobStatus === "cancelled";
  useEffect(() => {
    if (!helperId) return;
    // Only fall back to a per-card fetch when the parent did NOT supply
    // pre-fetched tracking. Activity surfaces always supply it (even as
    // `null` to mean "no row yet"), so the initial query is eliminated;
    // the realtime channel below still patches live updates after mount.
    if (initialTracking === undefined) loadTracking();
    // A completed or cancelled job can no longer move along the tracker, so
    // it holds no realtime bindings (Q777: prod realtime.subscription, 50 of
    // one poster's 52 jobs bindings were completed jobs). Contested statuses
    // (revision_requested, disputed) can still change and keep theirs.
    if (jobTerminal) return;

    // The job's ONE shared channel (src/lib/jobRealtimeBus.ts): the chat's job card listens on it too.
    // The tracker is a progress bar driven ENTIRELY by other people's writes. A dead channel freezes it
    // mid-job on a step that has already been passed, which reads as "the helper has stopped" rather than
    // "we lost the socket", so re-read the row the moment we are back.
    const offTracking = subscribeJobRealtime(
      jobId,
      "tracking",
      (payload) => {
        if (payload.new && typeof payload.new === "object" && "id" in payload.new) {
          setTracking(payload.new as unknown as TrackingData);
        }
      },
      { onRecovered: () => void loadTracking() },
    );
    const offJob = subscribeJobRealtime(
      jobId,
      "job",
      (payload) => {
        if (payload.new && typeof payload.new === "object") {
          const updated = payload.new as Partial<Tables<"jobs">>;
          if (updated.helper_confirmed_at !== undefined) setHelperConfirmedAt(updated.helper_confirmed_at);
          if (updated.poster_confirmed_at !== undefined) setPosterConfirmedAt(updated.poster_confirmed_at);
          setJobStamps((prev) => ({
            onTheWayAt: updated.helper_on_the_way_at !== undefined ? updated.helper_on_the_way_at : prev.onTheWayAt,
            arrivedAt: updated.helper_arrived_at !== undefined ? updated.helper_arrived_at : prev.arrivedAt,
            arrivalVerifiedAt: updated.helper_arrival_verified_at !== undefined ? updated.helper_arrival_verified_at : prev.arrivalVerifiedAt,
            posterConfirmedArrivalAt: updated.poster_confirmed_arrival_at !== undefined ? updated.poster_confirmed_arrival_at : prev.posterConfirmedArrivalAt,
            nearMissAt: updated.helper_arrival_near_miss_at !== undefined ? updated.helper_arrival_near_miss_at : prev.nearMissAt,
            helperCompletedAt: updated.helper_completed_at !== undefined ? updated.helper_completed_at : prev.helperCompletedAt,
            posterCompletedAt: updated.poster_completed_at !== undefined ? updated.poster_completed_at : prev.posterCompletedAt,
          }));
        }
      },
    );

    return () => { offTracking(); offJob(); };
    // `initialTracking` is read once when the effect runs to decide whether
    // to skip the fallback fetch. Subsequent prop changes flow through the
    // sync-effect above, not here — so it intentionally stays out of deps.
  }, [jobId, helperId, loadTracking, jobTerminal]);

  // LIVE position updates while the helper is EN ROUTE.
  //
  // The tracker was not live. getLocation() is a one-shot read fired only when
  // the helper taps a status button, so the poster's map showed a pin and an
  // "Updated 10:09" stamp that never moved. Verified on 2026-08-31 by moving
  // the helper 1.5 km and waiting 45s: job_tracking.updated_at stayed frozen
  // while the poster's card still read "GPS confirmed · at the job".
  //
  // Scope is deliberately narrow:
  //  * HELPER only — the poster must never broadcast their position.
  //  * `on_the_way` only. Once arrived the position stops mattering, and
  //    tracking someone for the whole duration of a job is surveillance, not a
  //    feature.
  //  * Silent: a failed refresh leaves the last known point rather than
  //    throwing a toast at someone who is driving.
  //
  // ── WHY THIS IS NO LONGER A setInterval ────────────────────────────────
  // It used to be `setInterval(pushPosition, 45_000)` — a JavaScript timer in
  // the WKWebView. iOS suspends the WebView, and every timer in it, the moment
  // the app is backgrounded. So the "live" tracker ran only while the helper
  // was looking at the app and stopped the second they locked the phone or
  // switched to Maps, which is exactly what a person driving to a job does:
  // live when it did not matter, dead when it did. Nothing errored, nothing
  // logged, and the poster's map kept presenting a stale point as current.
  //
  // `startEnRouteWatch` replaces it with a real position watch and reports
  // which of three modes the runtime actually got (background / foreground /
  // denied). That mode drives the UI below — we never claim background
  // delivery we have not established. See src/lib/enRouteLocation.ts.
  // The last position the en-route watch delivered. The arrival read falls
  // back to it when a fresh one-shot fix times out (see getLocationOutcome).
  const lastEnRouteFixRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  useEffect(() => {
    setEnRouteMode(null);
    if (!isHelper) return;
    if (tracking?.status !== "on_the_way") return;
    const trackingId = tracking?.id;
    if (!trackingId || trackingId === "temp") return;

    let cancelled = false;

    const watch = startEnRouteWatch({
      onMode: (mode) => {
        if (!cancelled) setEnRouteMode(mode);
      },
      onPosition: (p) => {
        if (cancelled) return;
        lastEnRouteFixRef.current = { lat: p.lat, lng: p.lng, at: Date.now() };
        // No unwrapMutation here on purpose: this is a best-effort position
        // refresh, and a zero-row result just means the job moved on. The
        // status writes below remain guarded, which is where correctness
        // matters. Fire-and-forget deliberately — the callback may run while
        // the app is suspended-but-executing and must not block the watch.
        //
        // The `.then()` is what makes it fire at all: a PostgrestBuilder is a
        // lazy thenable that issues its fetch inside then(), so `void
        // supabase.from(…).update(…).eq(…)` sent NOTHING and every en-route
        // position after the first was dropped on the floor — the poster's map
        // held the point from whenever the row was last written by another
        // path. Same class as useMessagesData.ts:440 and
        // useMessagesRealtime.ts:71. Still non-blocking: nobody awaits this.
        void supabase
          .from("job_tracking")
          .update({
            latitude: p.lat,
            longitude: p.lng,
            updated_at: new Date(p.at).toISOString(),
          })
          .eq("id", trackingId)
          .then(({ error }) => {
            if (error) report(error, { severity: "warning", tags: { source: "JobTracking.enRoutePosition" } });
          });
      },
    });

    return () => {
      cancelled = true;
      watch.stop();
    };
  }, [isHelper, tracking?.status, tracking?.id]);

  const { getLocation, getLocationOutcome, applyArrivalVerdict } = trackingLocation({ requestPermission, lastEnRouteFixRef, setJobStamps });



  // SYNCHRONOUS IN-FLIGHT GUARD. `updating` is React state, so two taps on
  // the Mark Complete confirm dispatched in one frame both read false and wrote
  // helper_completed_at — moving the stamp the 24h auto-release clock is keyed
  // on, and (landing after a concurrent release or cancel) stamping a job that
  // was no longer live. A ref sees the first tap. Same class and fix as
  // useActivityActions' completeInFlight (JobTracking.doneInFlight.test.tsx).
  const updateInFlight = useRef(false);
  const updateStatus = async (newStatus: string) => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    try {
      await runStatusUpdate(newStatus);
    } finally {
      updateInFlight.current = false;
    }
  };

  const runStatusUpdate = statusUpdate({ jobId, helperId, isHelper, tracking, setTracking, setUpdating, setArrivalRefusal, setJobStamps, loadTracking, getLocation, getLocationOutcome, applyArrivalVerdict });

  // Determine current status index from every signal available — see
  // `deriveCurrentStatusIdx` for why the jobs row has to be read too.
  // WHAT THE SERVER ACTUALLY REQUIRES BEFORE A HELPER CAN SET OFF.
  //
  // This used to be `bothConfirmed` — the helper's confirmation AND the
  // poster's. `helper_mark_on_the_way`
  // (supabase/migrations/20260829061546_helper_mark_on_the_way_atomic.sql)
  // checks exactly two things: the caller is the assigned helper, and
  // `v_job.helper_confirmed_at IS NOT NULL`. It never looks at
  // `poster_confirmed_at`. So a helper whose poster simply never confirmed sat
  // on "Confirm the job below to unlock the next step" — pointed at a card
  // holding no control of theirs — on a job the server would have started
  // happily. That is the same ghosting-poster trap the payout CTA was fixed for
  // (owner, 2026-08-24: a poster who never confirms must not be able to block
  // the helper); the client is now the same rule as the server, no stricter.
  //
  // The tracker's `job_confirmed` STEP still lights on the mutual stamp — see
  // `deriveCurrentStatusIdx`. This gate is only about which button the helper
  // is allowed to reach.
  // On My Way needs the Helpr's OWN day-before tap; the accept never counts
  // (Q1570), the same rule helper_mark_on_the_way enforces.
  const helperHasConfirmed = !!helperDayofConfirmedAt;

  const currentStatusIdx = deriveCurrentStatusIdx({
    trackingStatus: tracking?.status,
    jobStatus,
    helperConfirmedAt,
    helperDayofConfirmedAt,
    jobDateNeeded,
    jobStartTime,
    posterConfirmedAt,
    helperOnTheWayAt: jobStamps.onTheWayAt,
    helperArrivedAt: jobStamps.arrivedAt,
    helperArrivalVerifiedAt: jobStamps.arrivalVerifiedAt,
    posterConfirmedArrivalAt: jobStamps.posterConfirmedArrivalAt,
    helperArrivalNearMissAt: jobStamps.nearMissAt,
    helperCompletedAt: jobStamps.helperCompletedAt,
    posterCompletedAt: jobStamps.posterCompletedAt,
  });

  // What the STEP ROW draws. Without the posting steps this is exactly the old
  // behaviour (`STATUSES` / `currentStatusIdx`); with them the row is offset by
  // the two prepended steps, and a job with nobody assigned yet sits on
  // "Posted" or — once at least one application is in — "Applicants".
  //
  // `firstName` IS GONE (owner, 2026-09-16: "remove the name to the left of
  // updated"). It existed only to open the freshness stamp with the Helpr's
  // first name on the poster's card; nothing else read it. `helperName` is
  // therefore no longer read by this component — the prop is kept on the type
  // so its one caller keeps compiling, and the name is printed once, by the
  // PersonTile the card renders directly above its action row.

  const arrivalEvidence = {
    helper_arrived_at: jobStamps.arrivedAt,
    helper_arrival_verified_at: jobStamps.arrivalVerifiedAt,
    poster_confirmed_arrival_at: jobStamps.posterConfirmedArrivalAt,
    helper_arrival_near_miss_at: jobStamps.nearMissAt,
  };
  const currentArrivalState = arrivalState(arrivalEvidence);
  /**
   * THE FIVE-STATE READ, for the copy that has to tell a claim with NO location
   * at all ("turn Location on") from one that landed near the pin ("the pin may
   * be off"). `arrivalState` above collapses both into `"claimed"`, which is
   * why it is not used for any of the new copy (src/lib/arrivalGate.ts).
   */
  const currentArrivalEvidence = arrivalEvidenceState(arrivalEvidence);
  // The settled arrival fact goes on the map's job pin when the map is drawn,
  // and falls back to the status line when it is not (VN-20).
  const markedDone =
    currentStatusIdx >= STATUS_IDX.done ||
    !!jobStamps.helperCompletedAt ||
    !!jobStamps.posterCompletedAt ||
    jobStatus === "completed" ||
    jobStatus === "cancelled";
  // The map survives a contested completion (owner, 2026-09-16) — see
  // `shouldShowTrackingMap`. Same two statuses the rail clamps to Working.
  const contested = jobStatus === "revision_requested" || jobStatus === "disputed";
  const mapShown = shouldShowTrackingMap(tracking, jobLatitude, jobLongitude, markedDone, contested);
  const settledArrivalLabel = arrivalMapLabel(currentArrivalState);
  const arrivalOnMap = mapShown && settledArrivalLabel != null;


  const displaySteps = includePostingSteps ? [...PRE_STATUSES, ...STATUSES] : STATUSES;
  // ONE definition of the offset, shared with the collapsed card's compact
  // rail — see src/components/tracker/railDisplayIdx.ts. Inlined here until
  // 2026-09-19, when a second rail started needing the same answer.
  const displayIdx = railDisplayIdx({ currentStatusIdx, includePostingSteps, helperId, preStepCount: PRE_STATUSES.length });
  return {
    _isOwner,
    arrivalEvidence,
    arrivalOnMap,
    arrivalRefusal,
    confirmDoneOpen,
    continueDayNote,
    currentArrivalEvidence,
    currentArrivalState,
    currentStatusIdx,
    displayIdx,
    displaySteps,
    doneFloorActive,
    embedded,
    helperConfirmedAt,
    helperDayofConfirmedAt,
    helperHasConfirmed,
    helperId,
    helperName,
    inStepRow,
    isHelper,
    jobDateNeeded,
    jobId,
    jobLatitude,
    jobLongitude,
    jobStamps,
    jobStartTime,
    jobStatus,
    mapShown,
    posterConfirmedAt,
    posterConfirmedWorkingAt,
    posterName,
    progressCard,
    proofAfterUrls,
    proofBeforeUrls,
    requirePhotoProof,
    rescheduled,
    setConfirmDoneOpen,
    settledArrivalLabel,
    tracking,
    trackingSettled,
    updateStatus,
    updating,
  };
}

/** What the open tracker's view reads (Q806: the JSX lives in ./JobTrackingView; this file keeps the state and handlers). */
export type JobTrackingModel = ReturnType<typeof useJobTrackingModel>;

export function JobTracking(props: Parameters<typeof useJobTrackingModel>[0]) {
  const m = useJobTrackingModel(props);
  if (!m.helperId && !props.includePostingSteps) return null;
  return <JobTrackingView {...m} />;
}
