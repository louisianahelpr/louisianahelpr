import { useEffect, useRef, useState, useCallback } from "react";
import { doneFloorStart, useDoneFloorActive } from "@/components/job-card/useDoneFloor";
import { useContinueDay } from "@/hooks/useContinueDays";
import { continueDayDoneNote } from "@/lib/continueDayWords";
import { announceTransition } from "@/components/whatNext/HelperDoneWhatNext";
import { TRANSITION_TOAST } from "@/components/job-card/trackerTransitionCopy";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { subscribeJobRealtime } from "@/lib/jobRealtimeBus";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { arrivalEstablished, arrivalEvidenceState, arrivalGateMessage, arrivalMapLabel, arrivalRefusalFromError, arrivalRefusalMessage, arrivalState, arrivalVerdictFromRpc, arrivalVerdictMessage, type ArrivalRefusal, type ArrivalVerdict } from "@/lib/arrivalGate";
import { railDisplayIdx } from "@/components/tracker/railDisplayIdx";
import { report } from "@/lib/errorLogger";
import { trackJobCompleted } from "@/lib/jobCompletedEvent";
import { fireSuccessMoment } from "@/lib/successMoment";
import { isExpectedLifecycleRefusal, lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";
import { startEnRouteWatch, type EnRouteMode } from "@/lib/enRouteLocation";
import type { CardFace } from "@/components/tracker/jobStepFromWait";
import { useInJobStepRow } from "@/components/job-card/jobStepRow";
import { JobTrackingView } from "./JobTrackingView";

import { STATUSES, PRE_STATUSES } from "@/components/job-card/trackerSteps";

export { STATUS_IDX, deriveCurrentStatusIdx } from "@/lib/jobProgressIndex";
import { STATUS_IDX, deriveCurrentStatusIdx } from "@/lib/jobProgressIndex";

export { trackingProofCaption } from "./trackingProofCaption";
export { shouldShowTrackingMap } from "./trackingMapGate";
import { shouldShowTrackingMap } from "./trackingMapGate";
import { isMissingRpcNamed } from "@/lib/missingRpc";


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

  /**
   * Same read as `getLocation`, but it KEEPS THE REASON it failed.
   *
   * `getLocation` deliberately swallows every failure into `null` because its
   * caller (the `arrived` transition) proceeds either way — the claim is
   * stamped whether or not a fix arrives. The retry below is the opposite: a
   * failed fix is the ONLY thing it has to report, and "we couldn't get your
   * location" is useless to a helper whose real problem is that they tapped
   * Don't Allow. Permission-denied gets its own sentence naming Settings.
   */
  const getLocationOutcome = async (): Promise<
    { lat: number; lng: number } | { error: "denied" | "unavailable" }
  > => {
    if (!isNativePlatform && !navigator.geolocation) return { error: "unavailable" };
    let location: { lat: number; lng: number } | null = null;
    let denied = false;
    await requestPermission("location", async () => {
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 15000, maximumAge: 30000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (e) {
          // Capacitor surfaces a denial as a message, not a code, on iOS.
          const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
          if (/denied|permission|authorized|authoriz/i.test(msg)) denied = true;
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          (err) => {
            // 1 === PERMISSION_DENIED
            if (err?.code === 1) denied = true;
            resolve();
          },
          { timeout: 15000, maximumAge: 30000 },
        );
      });
    });
    if (location) return location;
    // A one-shot fix can time out while the en-route watch is still receiving
    // positions (seen on prod 2026-09-14: a helper 2,099 mi away got "we
    // couldn't get your location" and the RPC was never called, while the
    // status line above read "2099 mi from job"). Use the watch's own last
    // point if it is under a minute old — the SERVER still measures the
    // distance and refuses anything outside 500ft, so this can only turn a
    // vague "no location" into the real answer.
    const recent = lastEnRouteFixRef.current;
    if (!denied && recent && Date.now() - recent.at < 60_000) return { lat: recent.lat, lng: recent.lng };
    return { error: denied ? "denied" : "unavailable" };
  };

  /**
   * WRITE A VERDICT ONTO THE MIRRORED STAMPS.
   *
   * ONE place, because both callers of `mark_helper_arrival` (the Arrived
   * transition and the Location retry) have to apply the same three facts in
   * the same order, and they used to disagree: the transition stamped
   * `arrivalVerifiedAt` unconditionally — on a bare claim as well as a verified
   * one — which painted the tracker's proof line "Arrival GPS-verified" for a
   * helper whose phone had produced no fix at all.
   *
   * Never DOWNGRADES: every field is `prev ?? …`, matching the RPC, which
   * cannot un-verify an arrival either (20260919155016).
   */
  const applyArrivalVerdict = (v: ArrivalVerdict) => {
    const nowIso = new Date().toISOString();
    setJobStamps((prev) => ({
      ...prev,
      // ALWAYS: the check-in is recorded on every call now. This is the stamp
      // that makes the poster's "Confirm they've arrived" control appear, so
      // failing to mirror it here is what leaves the Helpr staring at a CTA
      // telling them to ask for a tap the other side cannot yet offer.
      arrivedAt: prev.arrivedAt ?? nowIso,
      // ONLY when the server actually measured them at the job.
      arrivalVerifiedAt: v.verified ? (prev.arrivalVerifiedAt ?? nowIso) : prev.arrivalVerifiedAt,
      nearMissAt: v.basis === "near_miss" ? (prev.nearMissAt ?? nowIso) : prev.nearMissAt,
      posterConfirmedArrivalAt: v.posterConfirmed
        ? (prev.posterConfirmedArrivalAt ?? nowIso)
        : prev.posterConfirmedArrivalAt,
    }));
  };

  /* `retryArrivalVerification` LIVED HERE and is gone (owner, 2026-09-19).
     The "Try my location again" chip it backed is removed from the action row;
     the same operation now runs from the pull-to-refresh gesture on My Jobs,
     in `src/lib/arrivalRefresh.ts`, gated on an arrival that is recorded and
     unverified. That module carries the reasoning, the conservatism rules, and
     the note on why the replacement had to exist before the chip could go.

     `getLocationOutcome` and `applyArrivalVerdict` above are UNCHANGED and
     still have their other caller — the "I've arrived" transition — so nothing
     was deleted with this beyond the retry itself. */



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

  const runStatusUpdate = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);

    // ── EVERY GATE RUNS BEFORE EVERY WRITE ──
    //
    // These three checks used to sit AFTER the job_tracking row had already
    // been updated to the new status, so a REJECTED "Done" left
    // `job_tracking.status = 'done'` persisted on the server while
    // `helper_completed_at` was never written and no payout was requested.
    // `deriveCurrentStatusIdx` takes the max of the tracking row and the jobs
    // row, so the rail painted fully green through Done — and each rejection
    // path then called loadTracking(), re-reading the row it had just poisoned.
    // The poster saw the identical false state over the job_tracking realtime
    // channel. Nothing may be persisted until every gate has passed, and these
    // paths deliberately do NOT loadTracking(): nothing was written, so there
    // is nothing to re-read.
    //
    // SAME GATES AS PayoutPrimary's "Mark it done" (owner, 2026-08-24 E2E): this
    // button used to write helper_completed_at with no checks at all, so the
    // before/after-photo requirement and the 30-minute work floor on the payout
    // CTA were decorative — the tracker was a free bypass that still started
    // the auto-release clock. Fetch the row fresh (this component isn't handed
    // proof URLs) and enforce both, with the reason stated. The poster's
    // working-confirmation is deliberately NOT required (owner): a ghosting
    // poster must not be able to block the payout request — they keep the
    // review window instead.
    //
    // Running ahead of getLocation() is deliberate as well: a helper who
    // cannot complete yet should not be made to answer a location prompt first.
    if (newStatus === "done") {
      const { data: gate, error: gateErr } = await supabase
        .from("jobs")
        .select("proof_before_urls, proof_after_urls, require_photo_proof, poster_confirmed_working_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, helper_arrival_near_miss_at")
        .eq("id", jobId)
        .single();
      if (gateErr) {
        report(gateErr, { tags: { source: "JobTracking.doneGateFetch" } });
        hapticError();
        toast.error("Couldn't check the job's completion requirements — try again?");
        setUpdating(false);
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
        return;
      }
      // ONE shared proof rule (photoProofPolicy) — same predicate the payout
      // CTA and completeJob's re-check enforce, same stated reason.
      // `gate`, not `undefined` — the poster's per-job answer
      // (`require_photo_proof`, 2026-09-11) lives on this row and the DB
      // trigger reads it. Passing undefined here demanded photos on a job the
      // poster had excused and the server would have accepted: a dead Done
      // button with a toast explaining a rule that no longer applied.
      const proofJob = { require_photo_proof: gate?.require_photo_proof ?? true };
      const hasPhotos = hasRequiredProof(proofJob, gate?.proof_before_urls, gate?.proof_after_urls);
      if (!hasPhotos) {
        hapticError();
        toast.error(requiredProof(proofJob).reason);
        setUpdating(false);
        return;
      }
      // The 30-minute floor greys the button at render (useDoneFloor); no toast (owner, 2026-10-08).
    }

    const now0 = new Date().toISOString();
    // `arrived` keeps the REASON a fix failed, because it changes what the
    // Helpr is told afterwards ("Location is turned off…" vs "we couldn't get
    // a fix"). It no longer changes WHETHER they check in. Every other step
    // proceeds either way, so it only needs the coordinates.
    const locOutcome = newStatus === "arrived" ? await getLocationOutcome() : null;
    const loc = locOutcome ? ("error" in locOutcome ? null : locOutcome) : await getLocation();

    // "MARK ARRIVED" ALWAYS RECORDS THE CHECK-IN. LOCATION IS EVIDENCE, NOT A
    // DOOR.
    //
    // OWNER, 2026-09-19 (verbatim): "if gps is not on, they can mark themselves
    // as arrived but can not move on until the poster marks them arrived … but
    // even if gps does confirm they are there the poster still needs ro cfnrm
    // wither way".
    //
    // WHAT THIS REPLACED. Under VN-33 (20260915044137) the RPC REFUSED a far or
    // fix-less arrival and wrote nothing, and this branch returned before the
    // tracking row was written — so a Helpr with Location off never got a
    // `helper_arrived_at`, the poster's "Confirm they've arrived" control (gated on
    // exactly that column) never rendered, and the Helpr's blocked CTA told them
    // to go ask the poster for a tap the poster was never offered. A deadlock
    // with a polite explanation on both ends.
    //
    // NOW: no early return on a failed fix. The RPC is called either way —
    // without coordinates when there are none — it stamps `helper_arrived_at`
    // on every call, and it stamps `helper_arrival_verified_at` only when it
    // genuinely measured the Helpr at the job. The verdict says which happened
    // and `arrivalVerdictMessage` turns that into the one sentence the Helpr
    // reads; every branch of it ends on the poster's tap, because that is the
    // only gate left and they have to know it is coming ("they shoud be aware
    // of this so they dont try to cheat the system").
    if (newStatus === "arrived") {
      const { data: verdict, error: arrivalErr } = await supabase.rpc("mark_helper_arrival", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (arrivalErr) {
        const refusal = arrivalRefusalFromError(arrivalErr);
        hapticError();
        if (identityRefusal(arrivalErr) && openIdentityCheck("start")) { setUpdating(false); return; } // Stripe Identity first (20261021081258); a sheet that cannot open (ID check off) falls to the error below
        if (refusal) {
          // LEGACY ONLY — the live RPC raises none of these any more. A queued
          // request answered by the previous definition still can, and it
          // genuinely wrote nothing, so the rail must not advance.
          setArrivalRefusal(refusal);
          toast.warning(arrivalRefusalMessage(refusal), { duration: 9000 });
          setUpdating(false);
          return;
        }
        report(arrivalErr, { tags: { source: "JobTracking.markArrival" } });
        toast.error(
          isMissingRpcNamed(arrivalErr, "mark_helper_arrival") // short window between merge and the auto-deploy landing
            ? "Arrival check-in is updating — try again in a minute."
            : (rpcErrorMessage("mark_helper_arrival", arrivalErr) ?? lifecycleErrorMessage(arrivalErr) ?? "Couldn't mark you arrived — try again?"),
        );
        setUpdating(false);
        loadTracking();
        return;
      }
      // A NULL ERROR IS NOT A WRITE. The RPC returns a jsonb verdict on every
      // success; `arrivalVerdictFromRpc` returns null when the body is absent
      // or unrecognisable, and that means something silently did nothing. It is
      // NOT treated as a success — the rail stays put and the row is re-read.
      const v = arrivalVerdictFromRpc(verdict);
      if (!v) {
        report(new Error("mark_helper_arrival returned no verdict"), {
          tags: { source: "JobTracking.markArrival" },
        });
        hapticError();
        toast.error("Couldn't mark you arrived — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
      setArrivalRefusal(null);
      applyArrivalVerdict(v);
      // The check-in SUCCEEDED in every one of these branches, so none gets the error haptic or an error toast. An
      // unverified location is an ordinary outcome (Location off, a wrong map pin, a bad fix), not the Helpr's fault:
      // treating it as one is the "accusation" the owner ruled out. Unsettled goes through the bare `toast()` (`toast.info`
      // renders nothing without an action, toastPolicy.ts) so the Helpr learns the poster must confirm (owner,
      // 2026-09-19: "they shoud be aware of this"). Settled, the tracker's next step already says so.
      const settled = v.verified || v.posterConfirmed;
      if (settled) hapticSuccess();
      else toast(arrivalVerdictMessage(v), { duration: 9000 });
    }

    const now = now0;

    // THE MONEY STAMP LANDS BEFORE THE TRACKING ROW SAYS "DONE".
    //
    // This used to run AFTER the job_tracking write, which is the second half
    // of the same defect the gates above fix: a stamp rejected by RLS or by a
    // job that had already moved on still left a persisted `status = 'done'`
    // behind it. `helper_completed_at` is what enters the job into the payout
    // pipeline, so it is the event the tracker is allowed to draw — and it has
    // to be the one that happens first.
    //
    // .select("id"): "silently fails" includes matching zero rows, which
    // returns error === null. Without the row count this stamp could no-op
    // (RLS, a job that already moved on) and the helper would be told the
    // payout clock had started.
    //
    // .in("status", LIVE): the stamp only lands on a job that is still live.
    // Queued behind a poster's cancel (or a release) it used to stamp the
    // cancelled/completed row; now it matches zero rows and says so. The
    // database enforces the same rule (trg_completion_on_live_job,
    // 20260914215112) — this is the client half, so the Helpr gets the honest
    // "already completed or cancelled" message instead of a trigger error.
    //
    // poster_completed_at comes back so a Done that lands AFTER the poster
    // already confirmed finishes the release (below) instead of leaving a job
    // both parties confirmed sitting in_progress.
    if (newStatus === "done") {
      let posterAlreadyConfirmed: boolean | undefined;

      // COMPLETION IS A SERVER DECISION. rpc_helper_mark_done re-runs the
      // assigned-Helpr / live-job / arrival / proof / 30-minute gates and stamps
      // helper_completed_at = now() itself, so a direct PATCH can no longer pick
      // the stamp's VALUE (a backdate makes it instantly auto-releasable) or land
      // it on a job that already moved on (H-001/H-002,
      // enforce_job_completion_server_owned). It returns poster_completed_at so a
      // Done that arrives AFTER the poster already confirmed still finishes the
      // release below.
      //
      // PGRST202 → the short merge→deploy window before the RPC lands (same
      // pattern as helper_mark_on_the_way / mark_helper_arrival). In that window
      // the completion trigger is not live either, so the legacy direct stamp
      // still works and stays the fallback body.
      const { data: doneRes, error: doneRpcErr } = await supabase.rpc("rpc_helper_mark_done", {
        _job_id: jobId,
      });
      if (!doneRpcErr) {
        posterAlreadyConfirmed = !!(doneRes as { poster_completed_at?: string | null } | null | undefined)?.poster_completed_at;
      } else if (isMissingRpcNamed(doneRpcErr, "rpc_helper_mark_done")) {
        try {
          const [stamped] = unwrapMutation(
            await supabase
              .from("jobs")
              .update({ helper_completed_at: now })
              .eq("id", jobId)
              .in("status", ["accepted", "in_progress", "revision_requested"])
              .select("id, poster_completed_at"),
            {
              action: "mark the job complete",
              rejectedMessage: "We couldn't mark this job complete — it may have already been completed or cancelled. Refresh the page.",
              context: { jobId },
            },
          );
          posterAlreadyConfirmed = !!stamped?.poster_completed_at;
        } catch (doneErr) {
          if (!isWriteRejected(doneErr)) {
            report(doneErr, { tags: { source: "JobTracking.helperCompleted" } });
          }
          hapticError();
          toast.error(lifecycleErrorMessage(doneErr) ?? mutationErrorMessage(doneErr, "Couldn't mark the job complete — try again?"));
          setUpdating(false);
          loadTracking();
          return;
        }
      } else {
        // The RPC refused (a completion gate, a live-job race, authz) or errored.
        // Its custom codes get their sentence through rpcErrorMessage; a benign
        // race is not reported (matches the old zero-row path).
        // A3-115: "done" before a day set to finish (continue_day_ahead) is the rule working, not a defect.
        if (!isWriteRejected(doneRpcErr) && !isExpectedLifecycleRefusal(doneRpcErr)) {
          report(doneRpcErr, { tags: { source: "JobTracking.helperCompleted" } });
        }
        hapticError();
        toast.error(
          lifecycleErrorMessage(doneRpcErr)
            ?? rpcErrorMessage("rpc_helper_mark_done", doneRpcErr)
            ?? "Couldn't mark the job complete — try again?",
        );
        setUpdating(false);
        loadTracking();
        return;
      }

      // BOTH SIDES HAVE NOW CONFIRMED — FINISH IT. The poster's release
      // committed first with this Helpr not yet done, so it only stamped
      // poster_completed_at; this plain stamp completes nothing on its own, and
      // the job sat in_progress with both confirmations until the 24h sweep
      // (14/20 PGlite rounds, 20260914215112). create-payment's release treats
      // exactly this shape as "fall through and complete" and runs the Stripe
      // capture check the database cannot. The stamp above stands either way,
      // so a failure here is reported and told, not rolled back.
      if (posterAlreadyConfirmed) {
        const { data: rel, error: relErr } = await supabase.functions.invoke("create-payment", {
          body: { action: "release", jobId },
        });
        if (relErr || (rel as { error?: string } | null)?.error) {
          report(relErr ?? new Error(String((rel as { error?: string }).error)), {
            tags: { source: "JobTracking.finishRelease" },
            context: { jobId },
          });
          toast.warning("Marked done. The person who posted this job already approved, but we couldn't schedule your payout just now. Because they approved, we schedule it for you within the day unless something needs a look. Refresh the page.", { duration: 8000 });
        } else {
          // Q222 analytics + Q2029 success moment (the poster release's beat): true only for a NEW completion, so a replay never plays twice.
          if (trackJobCompleted(jobId, rel as { bothDone?: boolean } | null, "job_tracking", helperId)) fireSuccessMoment({ label: "Job completed" });
        }
      }
    }

    // THE OPTIMISTIC ROW IS REVERTIBLE, because it also leads reality until
    // the write lands. `loadTracking()` on the failure paths below only calls
    // setTracking when the server returns a row — so on the very case that
    // matters (the INSERT branch, where no row exists yet) a rejected write
    // left this `id: "temp"` row in place with the new status on it, and
    // `deriveCurrentStatusIdx` reads `tracking.status` first. Same defect
    // shape as the persisted one the gates above fix, one layer up: nothing
    // may claim a step the server did not accept.
    const trackingBeforeWrite = tracking;
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
    // It used to be three client writes (tracking upsert, jobs.status = in_progress, helper_on_the_way_at); a run
    // interrupted after write #2 left in_progress with NO tracking row or departure stamp (live 2026-08-28, job
    // db21c20d). The RPC does all three atomically, checks the caller is the confirmed helper, and (status + stamp in
    // ONE jobs update) the notify trigger fires once instead of twice.
    //
    // PGRST202 fallback: merge→deploy window for a brand-new RPC (as mark_helper_arrival above); legacy sequence below.
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
      } else if (identityRefusal(otwErr) && openIdentityCheck("start")) {
        // Stripe Identity first (20261021081258): nothing was written; the ID sheet, not a toast.
        hapticError(); setUpdating(false); setTracking(trackingBeforeWrite); return; // a sheet that cannot open falls to the branch below, which reports and toasts
      } else if (!isMissingRpcNamed(otwErr, "helper_mark_on_the_way")) {
        report(otwErr, { tags: { source: "JobTracking.markOnTheWay" } });
        hapticError();
        toast.error(rpcErrorMessage("helper_mark_on_the_way", otwErr) ?? "Couldn't mark you on the way — try again?");
        setUpdating(false);
        setTracking(trackingBeforeWrite);
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
          rejectedMessage: "We couldn't update your status — this job may have been cancelled. Refresh the page.",
          context: { jobId, newStatus },
        },
      );
    } catch (writeErr) {
      if (!isWriteRejected(writeErr)) {
        report(writeErr, { tags: { source: "JobTracking.updateStatus" } });
      }
      hapticError();
      toast.error(lifecycleErrorMessage(writeErr) ?? mutationErrorMessage(writeErr, "Couldn't update your status — try again?"));
      setUpdating(false);
      setTracking(trackingBeforeWrite);
      loadTracking();
      return;
    }

    // Auto-transition job status
    let statusTransitioned = false;
    // `done` is handled above — its gates run before any write and its
    // `helper_completed_at` stamp lands before the tracking row records it.
    if (["on_the_way", "arrived", "working"].includes(newStatus) && !onTheWayAtomic) {
      const { data: job, error: statusErr } = await supabase.from("jobs").select("status").eq("id", jobId).single();
      if (statusErr) report(statusErr, { tags: { source: "JobTracking.autoTransition" } });
      // These writes used to drop their errors, while the `helper_completed_at`
      // stamp on the `done` path was carefully checked. That asymmetry was the
      // bug: these are the exact columns the POSTER's timeline reads, so on an
      // RLS or network failure the helper got a success buzz (and now a success
      // toast) while the poster's screen never moved — a phantom success on the
      // one signal the poster is waiting for.
      //
      // The tracking row itself is already written and is the source of truth
      // for the helper's own view, so a failure here does not invalidate the
      // action — it just means the poster won't see it. Hence: report, and tell
      // the truth in the toast, rather than aborting the whole transition.
      //
      // .select("id") on both: a zero-row update is the same phantom
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
            { action: `update the ${label} shown to the person who posted this job`, context: { jobId } },
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
        toast.error("Saved for you, but we couldn't update what the person who posted this job sees — check your connection.");
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
    // Link: /posts?filter=scheduled — the old filter=in_progress is not a
    // bucket Activity knows (needs_you/scheduled/waiting/done) and landed on
    // the default list; a poster's in_progress job buckets as "scheduled".
    //
    // The RESULT of that send is checked. It used to be discarded, so a failed
    // read of the job row — or a failed edge-function invoke — meant the
    // poster's only "work has started" signal silently never sent while the
    // helper was told everything was fine. `createNotification` already
    // report()s its own failure, so this only has to tell the person.
    let posterNotified = true;
    if (isHelper && newStatus === "working" && !statusTransitioned) {
      const { data: job, error: notifyErr } = await supabase.from("jobs").select("title, customer_id").eq("id", jobId).single();
      if (notifyErr) report(notifyErr, { tags: { source: "JobTracking.notifyPoster" } });
      if (job?.customer_id) {
        const { notifyJobParty } = await import("@/lib/notifications");
        // Copy and link (`/posts?job=`) are built server-side (Q223).
        const { error: pushErr } = await notifyJobParty({
          user_id: job.customer_id,
          job_id: jobId,
          template: "work_started",
        });
        if (pushErr) posterNotified = false;
      } else {
        // No customer_id in hand (the read failed, or the row is gone) — there
        // is nobody to notify, which is the same outcome as a failed send.
        posterNotified = false;
      }
    }

    hapticSuccess();
    // SAY SOMETHING. Every transition used to fire haptics and nothing else,
    // so on the web — and on any phone with haptics off — a successful tap gave
    // no feedback at all. The tracker row moves, but it is one small step in a
    // scrolling line and easy to miss on the very tap that matters most.
    if (!posterNotified) {
      toast.warning("Work started — we saved it, but couldn't tell the person who posted this job. Send them a message so they know.");
    } else {
      // `arrived` has no entry in the map on purpose — see TRANSITION_TOAST.
      const message = TRANSITION_TOAST[newStatus];
      if (message) announceTransition(newStatus, message, { jobId, at: now });
    }
    setUpdating(false);
    loadTracking();
  };

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
