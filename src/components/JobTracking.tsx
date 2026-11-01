import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { doneFloorStart, useDoneFloorActive } from "@/components/job-card/useDoneFloor";
import { announceTransition } from "@/components/whatNext/HelperDoneWhatNext";
import { TRANSITION_TOAST } from "@/components/job-card/trackerTransitionCopy";
import { takeHelperStepRequest } from "@/components/job-card/helperStepRequest";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { subscribeJobRealtime } from "@/lib/jobRealtimeBus";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { APPROVAL_WINDOW_HOURS } from "../../supabase/functions/_shared/escrowTiming";
import { haversineMiles } from "@/lib/geo";
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, CalendarCheck, FileText, AlertTriangle, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { jobStartDateTime } from "@/lib/dateUtils";
import { confirmOpensMs, jobDateMs, todayMs, JOB_TIMEZONE } from "@/lib/jobDate";
import { formatShortDate } from "@/lib/format";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { arrivalEstablished, arrivalEvidenceState, arrivalGateMessage, arrivalMapLabel, arrivalRefusalFromError, arrivalRefusalMessage, arrivalState, arrivalVerdictFromRpc, arrivalVerdictMessage, type ArrivalRefusal, type ArrivalVerdict } from "@/lib/arrivalGate";
import { trackingProofCaption } from "./trackingProofCaption";
import { report } from "@/lib/errorLogger";
import { trackJobCompleted } from "@/lib/jobCompletedEvent";
import { BEFORE_PHOTO_GATE_REASON, lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";
import { startEnRouteWatch, type EnRouteMode } from "@/lib/enRouteLocation";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobProgress } from "@/components/tracker/jobProgressState"; import type { CardFace } from "@/components/tracker/jobStepFromWait";
import { JobStepRowSlot, useInJobStepRow } from "@/components/job-card/jobStepRow";
/* `JobActionChip` was imported here for the "Try my location again" chip
   only; that control is gone (owner, 2026-09-19) and this component draws no
   chips of its own again — just its one primary. */
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";

// Lazy-load the Leaflet tracking map so the ~45KB Leaflet bundle is only
// pulled in when a tracking card between On the way and Done is visible.
const TrackingMap = lazy(() =>
  import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap }))
);

/**
 * `label` names the STEP; `action` is what the button that reaches it SAYS.
 *
 * The next-step CTA used to render `label`, so it read "Accepted", "On the
 * Way", "Arrived", "Working", "Done" — the same five nouns the completed steps
 * directly above it already display. Nothing told the reader the button did
 * anything, and "Done" is the money-critical one: it requests the payout.
 *
 * The labels are kept SHORT on purpose. `button.tsx` sets `whitespace-nowrap`,
 * so a label that outgrows its box spills instead of wrapping. On a 320px
 * phone this button has roughly 170px of text room (card px-4, tracker p-3,
 * size="sm" px-4, an 18px icon and its gap), which is ~20 characters of the
 * 14px bold sans it renders in. The Done action reads "Mark job complete"
 * (owner, 2026-09-14: name the event, not the money) — the same words as the
 * card's PayoutPrimary button, so the two controls for one action agree.
 *
 * Both step arrays are annotated with this ONE type so `displaySteps`
 * (`[...PRE_STATUSES, ...STATUSES]`) stays a single array type rather than a
 * union of two shapes the `.map` below would have to reconcile.
 */
type TrackerStep = {
  key: string;
  label: string;
  /** Action phrasing for the next-step CTA; `null` where the step is never a
   *  button target. */
  action: string | null;
  icon: LucideIcon;
  color: string;
};

/** Where the compact rail's cursor sits, given the same inputs the full rail
 *  derives from. One definition of the `includePostingSteps` offset, so the
 *  two rails cannot disagree about which step a job is on. */
function railDisplayIdx({
  currentStatusIdx,
  includePostingSteps,
  helperId,
}: {
  currentStatusIdx: number;
  includePostingSteps: boolean;
  helperId: string | null | undefined;
}): number {
  if (!includePostingSteps) return currentStatusIdx;
  return helperId ? PRE_STATUSES.length + currentStatusIdx : 0;
}

const STATUSES: TrackerStep[] = [
  // Step 0 is never the TARGET of the next-step button (nextIdx is always
  // currentStatusIdx + 1 ≥ 1), so it has no action phrasing.
  { key: "assigned", label: "Offered", action: null, icon: Clock, color: "text-muted-foreground" },
  { key: "confirmed", label: "Accepted", action: "I've accepted", icon: CheckCircle2, color: "text-primary" },
  // CalendarCheck, not ShieldCheck: at the 16px the step row draws these at,
  // a shield-with-a-tick and the circle-with-a-tick above it were two dark
  // rings with a check in them and read as the same step twice. This one means
  // "both sides confirmed, the date is locked", which a calendar says plainly
  // and cannot be confused with "Accepted".
  { key: "job_confirmed", label: "Confirmed", action: "Confirm this job", icon: CalendarCheck, color: "text-primary" },
  { key: "on_the_way", label: "On the way", action: "I'm on my way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", action: "I've arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", action: "Start working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", action: "Mark job complete", icon: PartyPopper, color: "text-primary" },
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
const PRE_STATUSES: TrackerStep[] = [
  // Pre-assignment, so never a helper button target — hence `action: null`.
  { key: "posted", label: "Posted", action: null, icon: FileText, color: "text-primary" },
];

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

export function JobTracking({
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
    // SAME GATES AS PayoutPrimary's "Mark job complete" (owner, 2026-08-24 E2E): this
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
          arrivalErr.code === "PGRST202"
            // Short window between merge and the auto-deploy landing.
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
      } else if (doneRpcErr.code === "PGRST202") {
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
        if (!isWriteRejected(doneRpcErr)) {
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
          // Analytics (Q222): the Helpr's Done finished a job the poster had
          // already approved. Once per job.
          trackJobCompleted(jobId, rel as { bothDone?: boolean } | null, "job_tracking", helperId);
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
      } else if (otwErr.code !== "PGRST202") {
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
  // rail — see `railDisplayIdx` at the top of this file. Inlined here until
  // 2026-09-19, when a second rail started needing the same answer.
  const displayIdx = railDisplayIdx({ currentStatusIdx, includePostingSteps, helperId });



  if (!helperId && !includePostingSteps) return null;

  return (
    // p-3 / space-y-2, and NO visible heading (owner: "drop the Job tracking
    // heading", 2026-08-24) — the step row is self-evidently a tracker, and
    // the serif heading + name row was ~50px of every card. The heading stays
    // for screen readers (a landmark region with steps but no name announces
    // as loose fragments); the helper's NAME moved down to the freshness
    // stamp, which is the line that describes their last ping anyway.
    <div className={embedded ? "space-y-2" : "rounded-2xl liquid-glass p-3 space-y-2"}>
      <h3 className="sr-only">Job tracking</h3>
      {/* NO SOS PILL HERE (owner: "remove globally") — it lives in the action
          row with every other control, on both sides of the job. */}
      {/* Progress timeline */}
      {/* THE ONE TRACKER (owner, 2026-10-21: "we need 1 tracker"). The 8-icon stepper (Posted · Offered ·
          Accepted · Confirmed · On the way · Arrived · Working · Done) is gone: the same four segments and
          next line as chat and the job page (jobProgress, src/components/tracker/jobProgressState.ts). The sub-steps live in
          the line ("Yusef is on the way"), and this card's controls below are unchanged. */}
      <JobProgress
        progress={jobProgress(
          {
            id: jobId, status: jobStatus ?? null, helper_id: helperId, date_needed: jobDateNeeded, start_time: jobStartTime ?? null,
            helper_confirmed_at: helperConfirmedAt, helper_dayof_confirmed_at: helperDayofConfirmedAt, poster_confirmed_at: posterConfirmedAt,
            helper_on_the_way_at: jobStamps.onTheWayAt ?? (tracking?.status === "on_the_way" ? tracking.updated_at : null),
            helper_arrived_at: jobStamps.arrivedAt, helper_arrival_verified_at: jobStamps.arrivalVerifiedAt,
            poster_confirmed_arrival_at: jobStamps.posterConfirmedArrivalAt, poster_confirmed_working_at: posterConfirmedWorkingAt,
            helper_completed_at: jobStamps.helperCompletedAt, poster_completed_at: jobStamps.posterCompletedAt,
            // The open card reads the same Helpr line and button as its collapsed face (photo rule, tracking row).
            require_photo_proof: requirePhotoProof, proof_before_urls: proofBeforeUrls, proof_after_urls: proofAfterUrls,
          },
          { viewer: _isOwner ? "poster" : "helpr", otherFirst: ((_isOwner ? helperName : posterName) ?? "").trim().split(/\s+/)[0] || null, rescheduled, workUnderway: currentStatusIdx >= STATUS_IDX.working, tracking, card: progressCard },
        )}
      />


      {/* Last update — directly below the step row (used to sit below the
          removed progress bar; the freshness stamp still closes the tracker
          it vouches for). */}
      {tracking && (
        <p className="text-ds-10 text-muted-foreground text-center">
          {/* NO NAME IN FRONT OF "Updated" (owner, 2026-09-16: "remove the
              name to the left of updated"). The stamp used to open with the
              Helpr's first name on the poster's card — "Hallie · Updated 4:12
              PM" — from when the tracker's heading row was dropped and the
              name had to land somewhere. It does not have to land here: the
              expanded card now carries the Helpr as a PersonTile of their own
              (VN-22), so this line was the second print of one name. */}
          Updated {new Date(tracking.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {/* THE PROOF CLAUSE. Derived from `arrivalState()` — the same single
              input as the unverified-arrival toast, the completion gate and
              the DB trigger — so the line can never again say "GPS confirmed"
              directly beneath a toast saying we could not confirm it. See
              `trackingProofCaption` (./trackingProofCaption.ts) for the four states and why the
              distance stays but the word "confirmed" does not.

              Still only rendered when there is something to say: a position to
              report, or an arrival claim from `arrived` onward whose absence of
              a position is itself the fact. */}
          {(() => {
            const hasPosition = tracking.latitude != null;
            // VN-20: while the map's job pin carries the settled arrival, this
            // line keeps the location and drops the verification clause.
            const trackingIdxHere =
              STATUS_IDX[tracking.status as keyof typeof STATUS_IDX] ?? -1;
            if (!hasPosition && trackingIdxHere < STATUS_IDX.arrived && currentArrivalState === "none") {
              return null;
            }
            const mi =
              hasPosition &&
              jobLatitude != null &&
              jobLongitude != null &&
              tracking.longitude != null
                ? haversineMiles(tracking.latitude!, tracking.longitude, jobLatitude, jobLongitude)
                : null;
            const proof = trackingProofCaption(currentArrivalState, mi, hasPosition, arrivalOnMap, !!jobStamps.arrivalVerifiedAt);
            const Glyph = proof.tone === "warn" ? AlertTriangle : MapPin;
            return (
              <span
                className={`ml-2 inline-flex items-center gap-0.5${proof.tone === "warn" ? " font-semibold" : ""}`}
                style={proof.tone === "warn" ? { color: "hsl(var(--amber-ink))" } : undefined}
              >
                <Glyph className="w-2.5 h-2.5 shrink-0" />
                {proof.text}
              </span>
            );
          })()}
          {/* ETA, moved here off the "On the way" step (owner, 2026-09-11:
              "move 12 min into the line below"). Same guard as before — only
              while the helper is genuinely en route and the server has an
              estimate — so this line never carries a stale number once they
              have arrived. `tabular-nums` keeps the digits from reflowing the
              line as the estimate ticks down. */}
          {tracking?.status === "on_the_way" && tracking.eta_minutes != null && (
            <span
              className="ml-2 inline-flex items-center gap-0.5 tabular-nums font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              ~{tracking.eta_minutes} min
            </span>
          )}
        </p>
      )}

      {/* NO TRACKING ROW, SETTLED ARRIVAL, ARRIVED IS THE CURRENT STEP.
          The status line above only exists once a `job_tracking` row does,
          and the map needs one too — but the arrival stamps live on the jobs
          row (a poster's "Confirm they've arrived", or a job whose tracking row
          was never written). When the Arrived step carried "Poster confirmed"
          itself this case still said something; with that caption moved to
          the map (VN-20) it would have said nothing at all. So the fact gets
          the status line's own slot and wording, scoped to exactly when the
          old caption showed (Arrived is the current step). */}
      {!tracking &&
        settledArrivalLabel != null &&
        displaySteps[displayIdx]?.key === "arrived" && (
          <p
            className="text-ds-10 text-muted-foreground text-center"
            data-testid="arrival-fact-fallback"
          >
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {trackingProofCaption(currentArrivalState, null, false, false, !!jobStamps.arrivalVerifiedAt).text}
            </span>
          </p>
        )}

      {/* THE OTHER PARTY IS NO LONGER DRAWN HERE. It sat between the rail and
          the map for three days (owner, 2026-09-16) and the owner has moved it
          again, to directly above the action row (2026-09-19). See the note
          where the `personTile` prop used to be declared. */}

      {/* Tracking map — KEPT UNTIL DONE (owner, 2026-09-14: "Keep map until
          done"; was en-route only). Shown from On the way through Arrived and
          Working while both positions are known (`shouldShowTrackingMap`),
          for the Helpr and the poster alike, and hidden once the job is
          marked done. Past On the way the helper pin is the last ping on the
          tracking row — the map draws it, it does not start or extend any
          location watch. Lazy-loaded so the Leaflet chunk isn't paid for by
          cards that never enter these steps. Falls back to the status line
          when coordinates are unavailable. A settled arrival rides on its job
          pin (VN-20); the status line above drops that clause while it does. */}
      {mapShown && tracking && jobLatitude != null && jobLongitude != null && (
          <Suspense fallback={null}>
            <TrackingMap
              helperLat={tracking.latitude!}
              helperLng={tracking.longitude!}
              destLat={jobLatitude}
              destLng={jobLongitude}
              destinationLabel={arrivalOnMap ? settledArrivalLabel : null}
              helperLive={tracking.status === "on_the_way"}
            />
          </Suspense>
        )}


      {/* Helper controls — skip the job_confirmed step since that's handled by JobConfirmation */}
      {isHelper && (() => {
        // The job's DAY and the job's START are both resolved in the JOB's
        // timezone, never the viewer's. A 2026-09-06 end-to-end review viewing
        // from Pacific found this whole block two hours out on a 6:30 PM
        // Central job: the countdown, the "Actions unlock at" string, and the
        // gate that actually enables the button. See jobStartDateTime.
        const jobDayMs = jobDateMs(jobDateNeeded);
        const jobDay: Date | null = jobDayMs === null ? null : new Date(jobDayMs);
        const todayStartMs = todayMs();
        const startAt = jobStartDateTime(jobDateNeeded, jobStartTime);

        // Find next actionable status (skip job_confirmed — handled by JobConfirmation component)
        let nextIdx = currentStatusIdx + 1;
        if (
          nextIdx < STATUSES.length &&
          STATUSES[nextIdx].key === "job_confirmed" &&
          // Once the HELPER has confirmed, skip to on_the_way — that is all
          // helper_mark_on_the_way asks for (see `helperHasConfirmed`).
          // Otherwise stay here: the confirmation the line below points at is
          // theirs to give, so the instruction is actionable.
          helperHasConfirmed
        ) {
          nextIdx++;
        }

        const nextStatus = STATUSES[nextIdx];
        if (!nextStatus) return null;

        /* THE SERVER'S ON-THE-WAY FLOOR, ENFORCED BY NAME — NOT BY POSITION.
         *
         * `helper_mark_on_the_way` has exactly one content predicate:
         * `v_job.helper_confirmed_at IS NULL` → `helper_not_confirmed`
         * (read live off prod, 2026-09-19; pinned by
         * src/test/jobsGuardRpcParity.test.ts). So "I'm on my way" must never
         * be offered without that stamp.
         *
         * This check used to live INSIDE the `job_confirmed` skip above, which
         * made it positional: it only ran when the rail happened to sit one
         * step short of Confirmed. Prod job bb2c3732 walked straight past it —
         * `deriveCurrentStatusIdx` floored an `in_progress` job at Confirmed on
         * the STATUS alone, so `nextIdx` was already `on_the_way` and the gate
         * was never consulted. The derivation is fixed above; this is the half
         * that makes the gate impossible to skip again, whatever a future
         * derivation does: it keys on the STEP THE BUTTON WOULD TAKE, which is
         * the same thing the server keys on.
         *
         * Scoped to exactly what the server refuses, and no wider (`arrived`,
         * `working` and `done` have their own gates and do NOT read this
         * stamp): the standing rule on this card is that the client is the same
         * rule as the server, never stricter — a poster or a data gap must not
         * be able to trap a helper on a step the server would have allowed.
         */
        if (!helperHasConfirmed && (nextStatus.key === "job_confirmed" || nextStatus.key === "on_the_way")) {
          /* "Confirm the job below" is only true once there IS something
             below. JobConfirmation opens 24 hours out; before that it used
             to render nothing, so this line pointed at an empty space.
             JobConfirmation now shows its own "opens in …" card in that
             window, and this line matches it rather than contradicting it. */
          // The SAME instant the control below turns on: midnight the day before
          // (confirmOpensMs, Q1647). It measured 24h before the START, so a 10 AM
          // job's button was live from midnight while this line was silent.
          const confirmOpen =
            !jobDateNeeded || jobDayMs === null || Date.now() >= confirmOpensMs(jobDateNeeded);
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

        // While a revision is open, the revision flow OWNS completion (the
        // card's "Mark fixed" → poster accepts). The tracker caps its index
        // at Working in this state, which made its next-step button "Done" —
        // so the card offered Done, "I'll Fix It" and "Mark fixed" at once,
        // three CTAs for one decision. Hide the tracker's Done here.
        //
        // `disputed` is in the same list for the same mechanical reason and a
        // sharper one. The clamp above now caps a disputed job at Working too,
        // which makes its next step "Done" — and Done here is not a label, it
        // is `completeJob`: it REQUESTS THE PAYOUT. Offering that on a job
        // whose card says "nothing is charged or released until then" would
        // hand the helper a money button while an admin holds the money. The
        // completion for a disputed job comes out of the dispute's resolution,
        // never out of this rail.
        if (
          nextStatus.key === "done" &&
          (jobStatus === "revision_requested" || jobStatus === "disputed")
        ) {
          return null;
        }

        // Locked until TWO HOURS BEFORE the start time, not just until
        // midnight of the job day (owner, 2026-08-24 transition audit): the
        // old gate let a helper tap "On the way" at 7 AM for an 8 PM job,
        // starting the tracker half a day early and making the poster's
        // "they're on the way" signal meaningless. A job with no start_time
        // falls back to the old day gate — with nothing to measure against,
        // day-of is the honest window.
        const UNLOCK_BEFORE_MS = 2 * 3_600_000;
        // `startAt` falls back to midnight in the job's zone when there is no
        // start_time, so the two-hour rule would unlock a flexible job at 10 PM
        // the night before. Only gate on it when a start time actually exists;
        // otherwise the day gate is the honest window.
        const isLocked = jobStartTime && startAt
          ? Date.now() < startAt.getTime() - UNLOCK_BEFORE_MS
          : jobDayMs !== null
            ? todayStartMs < jobDayMs
            : false;
        const lockMessage = isLocked
          ? jobStartTime && startAt
            ? (() => {
                // Date-stamp the UNLOCK moment, not the job's day — for an
                // early-morning start the 2h-before unlock lands on the
                // PREVIOUS calendar day (a 12:00 AM Aug 29 job unlocks
                // 10:00 PM Aug 28; the old string said "on Aug 29").
                const unlockAt = new Date(startAt.getTime() - UNLOCK_BEFORE_MS);
                // Rendered in the JOB's zone. Printing this instant with the
                // viewer's default zone would name an hour the helper will not
                // see on the clock at the job, which is the same defect one
                // layer up in the sentence rather than the gate.
                const zoned = { timeZone: JOB_TIMEZONE } as const;
                const unlockDayStr = unlockAt.toLocaleDateString("en-CA", zoned);
                const unlockDayMs = jobDateMs(unlockDayStr);
                const dateSuffix =
                  unlockDayMs !== null && todayStartMs < unlockDayMs
                    ? ` on ${formatShortDate(new Date(unlockDayMs))}`
                    : "";
                return `This button turns on at ${unlockAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoned })}${dateSuffix}`;
              })()
            : `This button turns on ${formatShortDate(jobDay!)}`
          : null;

        const isDoneStep = nextStatus.key === "done";

        // ARRIVAL HAS TO BE ESTABLISHED BEFORE THE RAIL LEAVES "ARRIVED".
        //
        // The owner's report: "It let me keep going to working even though I'm
        // nowhere near the job. The poster never even confirmed I was there."
        // They were right — there was no gate of any kind on Arrived → Working:
        // * client — this CTA was disabled only on `updating || isLocked`;
        // * server — `working` writes nothing but `job_tracking.status`, and
        //   job_tracking's only policy is `auth.uid() = helper_id`
        //   (20260311041556). No trigger, no transition matrix, no proximity.
        //   `enforce_job_status_transition` (20260828020000) governs
        //   `jobs.status` only, and accepted → in_progress is allowed outright.
        // So the ONLY arrival gate in the system sat on completion
        // (`enforce_helper_completion_gates`), and the two steps in between
        // were free. A helper 1792 miles away walked the rail to Done.
        //
        // ONE RULE, NOT A SECOND ONE: `arrivalEstablished` — the same predicate
        // the payout CTA, `completeJob`, create-payment and the DB triggers use.
        //
        // AND IT IS THE POSTER'S TAP, IN EVERY CASE (owner, 2026-09-19 —
        // supersedes VN-33's "verified AND confirmed"). A GPS-verified arrival
        // does NOT open this door; a Location-off arrival does not close it.
        // `helper_arrival_verified_at` is read nowhere in this gate on purpose.
        // The job_tracking trigger (`enforce_job_tracking_arrival_gate`) refuses
        // the Working step on the server under the same one-stamp rule, so this
        // is the explanation, not the only lock. The poster's tap lands back
        // here over the `jobs` realtime subscription above, so the button
        // re-enables itself while the helper is looking at it.
        //
        // THIS LINE IS ALSO THE ANTI-CHEAT NOTICE. Owner: "they shoud be aware
        // of this so they dont try to cheat the system" — every branch of
        // `arrivalGateMessage` names "Confirm they've arrived" and whose tap it is,
        // and the Helpr reads it the moment they reach the Arrived step, before
        // they have any reason to try walking the rail on their own. (The
        // separate "Awaiting confirmation" caption under the Arrived step is NOT
        // coming back: owner item 12, 2026-09-16, removed it deliberately and
        // the amber step colour carries that signal now — `arrivalStateLabel`.)
        const needsArrival =
          (nextStatus.key === "working" || isDoneStep) && !arrivalEstablished(arrivalEvidence);
        // Same rule, same message source, but say which door is locked: the
        // helper blocked at Working is being told they can't start work, not
        // that they can't get paid.
        const arrivalBlockReason = !needsArrival
          ? null
          : arrivalGateMessage(arrivalEvidence, isDoneStep ? "wrap-up" : "tracker");
        /* CHECKED IN, BUT THE SERVER NEVER PUT THEM AT THE JOB.
         *
         * The state the GPS encouragement and the "Try my location again"
         * button both belong to, defined ONCE so the sentence and the control
         * it names can never appear without each other.
         *
         * It reads the EVIDENCE STATE, not an error: since 20260919155016 an
         * unverified arrival is an ORDINARY, expected row (Location off, no
         * fix, a wrong map pin) rather than a failure. The previous gate's
         * `&& !nearMissAt` exclusion is dropped — a near miss is precisely the
         * case where a second, better fix changes something — and `"confirmed"`
         * is excluded, which is the "don't nag" half of the owner's ruling: once
         * the poster has vouched, the Helpr is unblocked and the arrival is
         * settled by the one attestation that actually decides it, so there is
         * nothing left to encourage them towards.
         */
        const gpsNudgeHere =
          isHelper && (currentArrivalEvidence === "claimed" || currentArrivalEvidence === "near_miss");
        // LEGACY (pre-20260919155016 RPC only): the tap was refused outright and
        // nothing was written, so the line says why and the button becomes the
        // retry. Cleared the moment an arrival is recorded.
        const arrivalRefusedHere = nextStatus.key === "arrived" && arrivalRefusal != null;
        const arrivalRefusalReason = arrivalRefusal && nextStatus.key === "arrived" ? arrivalRefusalMessage(arrivalRefusal) : null;

        // The button is disabled for two different reasons and only ever
        // explained one of them. `isLocked` had a sentence under it; `updating`
        // had nothing — so the CTA went dead and silent for the length of a
        // geolocation fix plus two or three round-trips (measured at ~12s on a
        // bad connection) with no clue why. Same line, same voice, both
        // reasons — and now the arrival gate too, which must never be a silent
        // dead button: every branch of `arrivalBlockReason` names the poster's
        // "Confirm they've arrived" tap, which is the way out.
        // The proof-photo gate, at RENDER time rather than only on click.
        // A state sweep found the two money controls disagreeing in 17 frames:
        // this CTA rendered an ENABLED "Request My Payout" (now "Mark job complete") while
        // ActiveJobSection's button sat directly below it, DISABLED, reading
        // "Upload before & after photos first". Both enforce the same rule —
        // the comment on the click-time gate below says the two "must not
        // disagree again" — but this one enforced it by failing on tap and
        // showing a toast. So the control that LOOKED pressable was the one
        // that didn't work, which is the worse half of the pair to get wrong.
        const needsProof =
          isDoneStep &&
          proofBeforeUrls !== undefined &&
          !hasRequiredProof({ require_photo_proof: requirePhotoProof ?? true }, proofBeforeUrls, proofAfterUrls);

        /* THE BEFORE PHOTO GATES "START WORKING" (owner, 2026-09-19: "if a
         * before photo is required they can't press the working button until
         * its done and same for a completed job for an after photo").
         *
         * THE SERVER IS THE ORACLE, AND IT SAYS SO SINCE 20260919195158:
         * `enforce_job_tracking_arrival_gate()` raises
         * `tracker_requires_before_photo` on `status = 'working'` under exactly
         * this predicate. This block came in the same commit as that migration
         * and must never lead it — a client stricter than the database is the
         * class that produced the bad-GPS deadlock removed earlier the same day.
         *
         * ONLY the BEFORE photo, and only to START. The after photo is what
         * `needsProof` above gates, on the Done step, where the work exists to
         * photograph.
         *
         * `requiredProof().before` rather than a second reading of the flag —
         * the policy module is the one definition, and the migration's SQL is
         * a stated mirror of it. `proofBeforeUrls !== undefined` for the same
         * reason `needsProof` has it: an unloaded gate query must not disable
         * the button on a job that needs no photo at all.
         */
        // Greyed for the first 30 minutes (useDoneFloor); PayoutUnlockNote says when.
        const doneTooEarly = isDoneStep && doneFloorActive;

        const needsBeforePhoto =
          nextStatus.key === "working" &&
          proofBeforeUrls !== undefined &&
          requiredProof({ require_photo_proof: requirePhotoProof ?? true }).before &&
          (proofBeforeUrls?.length ?? 0) === 0;

        const disabledReason = updating
          ? "Saving your update — one moment…"
          : isLocked
            ? lockMessage
            : arrivalBlockReason
              ?? arrivalRefusalReason
              // AFTER the arrival reason, matching the server's branch order:
              // the poster's tap is the earlier event and the bigger blocker,
              // and a Helpr who is not yet confirmed on site has nothing to
              // photograph "as it was when you got there" anyway.
              ?? (needsBeforePhoto ? BEFORE_PHOTO_GATE_REASON : null)
              ?? (needsProof ? requiredProof({ require_photo_proof: requirePhotoProof ?? true }).reason : null);
        // Amber, like the arrival gate: both are the helper being told what
        // blocks the next step, not a neutral status. The before-photo gate is
        // amber for the same reason and not the muted grey of a wait — it is
        // something the Helpr must DO, and the chip that does it is in the same
        // row, one control to the left.
        const amberReason =
          (needsArrival || arrivalRefusedHere || needsBeforePhoto) && !updating && !isLocked;

        /* ── THE GPS NUDGE: EXPLAIN THE BENEFIT, DON'T BLOCK OR NAG ──────────
         *
         * OWNER, 2026-09-19: "so encourgage to turn on gps" — and, asked how
         * hard to push: explain the benefit, don't block or nag.
         *
         * TWO FRAMINGS WERE EXPLICITLY REJECTED and must not come back:
         *   - "unverified arrivals count against you" — to a Helpr standing in
         *     a metal warehouse with one bar, that is an accusation, not advice;
         *   - a prompt on every attempt. This is a QUIET LINE tied to the state
         *     of the row (checked in, no GPS confirmation yet), not a dialog, not
         *     a toast, and not something that reappears on each tap.
         *
         * It is MUTED, never the amber the blocked CTA wears: amber on this
         * card means "something is stopping you", and nothing here is. The one
         * thing stopping them is the poster's tap, and `reasonEl` above says so.
         *
         * ONE TAP is the "Try my location again" button rendered directly below
         * it (`retryEl`), which re-runs the permission pre-prompt and the fix.
         * Same gate as that button, deliberately: a line about turning Location
         * on, with no control on screen, is worse than no line at all.
         *
         * ONE SENTENCE, AND ONLY THE BENEFIT (owner, 2026-09-19, final browser
         * gate: "amber says what is BLOCKING; muted says why GPS helps. Nothing
         * else"). It used to run three sentences and end by naming the button
         * directly beneath it — while the amber line above ALSO said "turn
         * Location on" and ALSO named "Try my location again". Ten lines of
         * prose between the photo box and the buttons, saying two things twice.
         * The instruction is gone (the button is right there, wearing the same
         * words) and the "gets you confirmed faster" clause is gone with it:
         * that is a nudge about the poster's behaviour, not a benefit we can
         * promise. What is left is the one thing Location actually buys them.
         */
        const gpsBenefitEl = gpsNudgeHere ? (
          <p className="text-ds-11 text-center text-muted-foreground">
            Turning Location on gives you GPS proof you were here, if this job is ever disputed.
          </p>
        ) : null;

        const reasonEl = disabledReason || gpsBenefitEl ? (
          <>
            {disabledReason ? (
              <p
                className={`text-ds-11 text-center${amberReason ? " font-semibold" : " text-muted-foreground"}`}
                style={amberReason ? { color: "hsl(var(--amber-ink))" } : undefined}
              >
                {disabledReason}
              </p>
            ) : null}
            {gpsBenefitEl}
          </>
        ) : null;

        /* THE ROW'S PRIMARY, drawn by the row's own primitive.
         *
         * It used to be a raw `<Button size="sm" className="w-full h-auto">`
         * with the icon inline and a bare 14px label, portalled into a row of
         * stacked 11px chips — "Message" and "I'm on my way" side by side as
         * two different kinds of object, which is the screenshot the owner sent
         * twice. `JobStepPrimaryButton` is that one object; nothing about the
         * gates, the busy state or the confirm dialog moves. */
        const runNext = () => { if (isDoneStep) setConfirmDoneOpen(true); else void updateStatus(nextStatus.key); };
        const ctaDisabled = updating || isLocked || needsArrival || needsBeforePhoto || needsProof || doneTooEarly;
        // Boards 62/64: the face (or an after-photo upload, afterPhotosLeadToDone) asked for THIS step; a greyed draw keeps it.
        // AUD31-79: only once the tracking row has settled; a first draw from the job row alone dropped the request.
        if (trackingSettled && !ctaDisabled && takeHelperStepRequest(jobId, nextStatus.key)) queueMicrotask(runNext);
        const ctaEl = (
          <JobStepPrimaryButton
            icon={nextStatus.icon}
            // The ACTION, not the step's name — see STATUSES. After a
            // refused arrival the same tap is a retry, so it says so.
            label={arrivalRefusedHere ? "Try my location again" : (nextStatus.action ?? nextStatus.label)}
            // Done asks first — see the dialog below. Every other step is a
            // reversible statement about where the helper is; this one moves
            // money and cannot be taken back from here.
            onClick={runNext}
            // SAME OBJECT, SAME DISABLED STATE (jobRowControlSameness). The
            // before-photo gate adds a reason, not a new kind of control: a
            // control that LOOKED pressable and then failed on tap with a toast
            // is the shape the comment above `needsProof` records as the worse
            // half to get wrong, and it is not coming back for this gate.
            disabled={ctaDisabled}
          />
        );


        const doneDialog = (
          <>
            {/* THE ONE TAP THAT MOVES MONEY GETS A CONFIRMATION.
                The poster's mirror of this decision opens CompletionChoiceSheet
                and walks them through it; the helper's requested the payout on
                a single tap of a button that just said "Done". Shared shell
                (BrandConfirmDialog → DialogHero → the glass modal every
                other popup in the app wears), so this is one more confirm and
                not a new kind of thing. */}
            {isDoneStep && (
              <BrandConfirmDialog
                open={confirmDoneOpen}
                onOpenChange={(next) => { if (!updating) setConfirmDoneOpen(next); }}
                title="Mark this job complete?"
                description="This tells the person who posted this job the work is finished, so they can approve it."
                primaryLabel="Mark job complete"
                primaryTone="bark"
                primaryDisabled={updating}
                onPrimary={(e) => {
                  e.preventDefault();
                  setConfirmDoneOpen(false);
                  void updateStatus("done");
                }}
                secondaryLabel="Cancel"
              >
                <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
                  The person who posted this job approves the work or asks for a change. If they haven’t answered in {APPROVAL_WINDOW_HOURS} hours, Helpr support steps in. Your payment stays held safely until the job is approved. You can’t take this back from here.
                </p>
              </BrandConfirmDialog>
            )}
          </>
        );

        // ONE ROW (owner, 2026-09-14, VN-21). Inside a job step card this CTA
        // IS the card's primary: it portals into the card's single action row
        // (the step's own `primary` then stands down), its reason sits on the
        // line directly above that row, and the dialog stays here. State, gates
        // and handlers are untouched — only the DOM position moves.
        // PHOTO FIRST (owner, 2026-10-08): an owed photo IS the primary (HelperPhotoAsk).
        const photoIsPrimary = needsBeforePhoto || needsProof;
        if (inStepRow) {
          return (
            <>
              {photoIsPrimary ? null : <JobStepRowSlot slot="note">{reasonEl}</JobStepRowSlot>}
              {/* ONE control in this slot (the retry chip went 2026-09-19; the
                  refresh gesture does it, src/lib/arrivalRefresh.ts). `primaryNeeds`
                  still takes an ARRAY: the day-of confirmation can add one here. */}
              {photoIsPrimary ? null : <JobStepRowSlot slot="primary">{ctaEl}</JobStepRowSlot>}
              {doneDialog}
            </>
          );
        }

        return (
          <div className="pt-2 border-t border-border space-y-2">
            {reasonEl}
            {ctaEl}
            {doneDialog}
          </div>
        );
      })()}

    </div>
  );
}
