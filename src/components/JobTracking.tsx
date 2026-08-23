import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, CalendarCheck, FileText } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { parseLocalDate } from "@/lib/dateUtils";
import { formatShortDate } from "@/lib/format";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { report } from "@/lib/errorLogger";
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
  if (helperConfirmedAt && posterConfirmedAt) atLeast(STATUS_IDX.job_confirmed);
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
  jobStartTime: _jobStartTime,
  jobStatus,
  helperConfirmedAt: initialHelperConfirmedAt,
  posterConfirmedAt: initialPosterConfirmedAt,
  helperOnTheWayAt: initialHelperOnTheWayAt,
  helperArrivedAt: initialHelperArrivedAt,
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
      helperCompletedAt: initialHelperCompletedAt ?? null,
      posterCompletedAt: initialPosterCompletedAt ?? null,
    });
  }, [initialHelperOnTheWayAt, initialHelperArrivedAt, initialHelperCompletedAt, initialPosterCompletedAt]);
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

  const getDistanceFt = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 20902231; // Earth radius in feet
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const updateStatus = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);
    const loc = await getLocation();

    // GPS proximity check for "arrived" — must be within 500ft of job location
    if (newStatus === "arrived") {
      if (!loc) {
        hapticError();
        toast.error("Enable GPS in Settings to mark Arrived — then try again.");
        setUpdating(false);
        return;
      }
      const { data: job, error: jobErr } = await supabase.from("jobs").select("latitude, longitude").eq("id", jobId).single();
      if (jobErr) report(jobErr, { tags: { source: "JobTracking.arrivedProximity" } });
      if (job?.latitude && job?.longitude) {
        const dist = getDistanceFt(loc.lat, loc.lng, Number(job.latitude), Number(job.longitude));
        if (dist > 500) {
          hapticError();
          toast.error(`Couldn't mark arrived — you're about ${Math.round(dist)}ft from the job site. Move closer and try again.`);
          setUpdating(false);
          return;
        }
      }
    }

    const now = new Date().toISOString();
    setTracking(prev => prev ? { ...prev, status: newStatus, latitude: loc?.lat || prev.latitude, longitude: loc?.lng || prev.longitude, updated_at: now } : {
      id: "temp",
      status: newStatus,
      latitude: loc?.lat || null,
      longitude: loc?.lng || null,
      eta_minutes: null,
      updated_at: now,
    });

    const { error: writeErr } = tracking && tracking.id !== "temp"
      ? await supabase
          .from("job_tracking")
          .update({
            status: newStatus,
            latitude: loc?.lat || null,
            longitude: loc?.lng || null,
            updated_at: now,
          })
          .eq("id", tracking.id)
      : await supabase.from("job_tracking").insert({
          job_id: jobId,
          helper_id: helperId,
          status: newStatus,
          latitude: loc?.lat || null,
          longitude: loc?.lng || null,
        });
    if (writeErr) {
      report(writeErr, { tags: { source: "JobTracking.updateStatus" } });
      hapticError();
      toast.error("Couldn't update your status — try again?");
      setUpdating(false);
      loadTracking();
      return;
    }

    // Auto-transition job status
    if (newStatus === "done") {
      // This stamp is what enters the job into the payout pipeline — if it
      // silently fails the helper never gets paid, so surface it and stop.
      const { error: doneErr } = await supabase.from("jobs").update({ helper_completed_at: now }).eq("id", jobId);
      if (doneErr) {
        report(doneErr, { tags: { source: "JobTracking.helperCompleted" } });
        hapticError();
        toast.error("Couldn't mark the job complete — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
    } else if (["on_the_way", "arrived", "working"].includes(newStatus)) {
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
      const stampErrors: string[] = [];
      if (job && job.status === "accepted") {
        const { error } = await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);
        if (error) { report(error, { tags: { source: "JobTracking.statusInProgress" } }); stampErrors.push("status"); }
      }
      if (newStatus === "arrived") {
        const { error } = await supabase.from("jobs").update({ helper_arrived_at: now }).eq("id", jobId);
        if (error) { report(error, { tags: { source: "JobTracking.arrivedAt" } }); stampErrors.push("arrival time"); }
      }
      if (newStatus === "on_the_way") {
        const { error } = await supabase.from("jobs").update({ helper_on_the_way_at: now }).eq("id", jobId);
        if (error) { report(error, { tags: { source: "JobTracking.onTheWayAt" } }); stampErrors.push("departure time"); }
      }
      if (stampErrors.length > 0) {
        hapticError();
        toast.error("Saved for you, but we couldn't update the poster's view — check your connection.");
        setUpdating(false);
        loadTracking();
        return;
      }
    }

    // Send notification to poster
    if (isHelper) {
      const { data: job, error: notifyErr } = await supabase.from("jobs").select("title, customer_id").eq("id", jobId).single();
      if (notifyErr) report(notifyErr, { tags: { source: "JobTracking.notifyPoster" } });
      if (job?.customer_id) {
        const statusLabel = STATUSES.find(s => s.key === newStatus)?.label || newStatus;
        const { createNotification } = await import("@/lib/notifications");
        await createNotification({
          user_id: job.customer_id,
          title: `Helpr is ${statusLabel}`,
          message: `Your Helpr updated their status to "${statusLabel}" for "${job.title}".`,
          type: "info",
          link: `/my-posts?filter=in_progress`,
        });
      }
    }

    hapticSuccess();
    toast.success(`Status updated: ${STATUSES.find(s => s.key === newStatus)?.label}`);
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
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="font-display italic font-bold leading-tight text-headline-card min-w-0"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          Job tracking
        </h3>
        {/* WHOSE progress — in the heading, not under the current step. It used
            to caption the live dot, which gave every step column a third line
            of vertical space to accommodate one word on one of them, and moved
            down the row as the job advanced. Up here it holds still, and the
            step row lost a line (owner: "can we move this somewhere else so we
            can tighten up the spacing"). Owner card only — a helpr looking at
            their own tracker does not need to be told it is theirs. */}
        {!isHelper && firstName && (
          <span
            className="font-serif italic text-ds-13 leading-none shrink-0 ml-auto"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            {firstName}
          </span>
        )}
        {/* NO SOS PILL HERE (owner: "remove globally"). It was the last
            survivor of an older arrangement: the owner's SOS moved into the
            action row long ago, and the helpr's stayed hanging off the tracker
            heading — so one safety control lived in two different places
            depending on which side of the job you were on, and on the helpr
            side it sat inside a progress card rather than with the actions.
            SosShareButton itself is untouched; it is still mounted from the
            action row, which is where every other control on the card is. */}
      </div>

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
              // THE CURRENT STEP CARRIES THE TROUBLE. A job in revision or in
              // dispute used to paint the same bark green as one running
              // perfectly, so the tracker — the biggest thing on the card —
              // was the one element that never said anything had gone wrong.
              // Amber for a revision, red for a dispute (owner). Only the
              // CURRENT dot changes: the steps behind it really did happen and
              // recolouring the whole line would read as "none of this counts".
              const currentTone =
                jobStatus === "disputed"
                  ? { fill: "hsl(var(--destructive))", ring: "hsl(var(--destructive) / 0.30)" }
                  : jobStatus === "revision_requested"
                    ? { fill: "hsl(var(--amber-solid))", ring: "hsl(var(--amber-solid) / 0.30)" }
                    : { fill: "hsl(var(--bark))", ring: "hsl(var(--bark) / 0.30)" };
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  // `grow` on a `w-[68px] shrink-0` basis: the steps SHARE any
                  // spare width instead of huddling in the middle of a wide
                  // card (owner: "spread out more to fill space"), and the
                  // moment the row is narrower than 8 × 68px they stop growing,
                  // hold their width and scroll — `shrink-0` is what keeps a
                  // label from being squeezed into a hyphenated column.
                  className="w-[68px] shrink-0 grow snap-center flex flex-col items-center gap-1"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                    style={
                      isCurrent
                        ? {
                            background: currentTone.fill,
                            color: "hsl(var(--parchment))",
                            boxShadow: `0 0 0 2px ${currentTone.ring}, 0 0 0 4px hsl(var(--parchment))`,
                          }
                        : isActive
                          ? { background: "hsl(var(--bark) / 0.18)", color: "hsl(var(--bark))" }
                          : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.80)" }
                    }
                  >
                    <Icon className="w-4 h-4" />
                  </div>
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

      {/* Progress bar — driven by the same `currentStatusIdx` as the step row
          above, so the two can never disagree (a job sitting on "Done" used to
          be able to paint a one-seventh sliver). */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--olivewood) / 0.10)" }}>
        <div
          className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
          style={{
            width: `${((displayIdx + 1) / displaySteps.length) * 100}%`,
            background: "hsl(var(--bark) / 0.85)",
          }}
        />
      </div>

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

      {/* Last update */}
      {tracking && (
        <p className="text-ds-10 text-muted-foreground text-center">
          Last updated: {new Date(tracking.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {tracking.latitude && (
            <span className="ml-2 inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5" />
              {tracking.latitude.toFixed(4)}, {tracking.longitude?.toFixed(4)}
            </span>
          )}
        </p>
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

        const isLocked = jobDay ? today < jobDay : false;
        const lockMessage = jobDay && isLocked
          ? `Actions available on ${formatShortDate(jobDay)}`
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
