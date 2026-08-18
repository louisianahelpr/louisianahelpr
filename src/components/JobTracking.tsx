import { lazy, Suspense, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, ShieldCheck, AlertTriangle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { parseLocalDate } from "@/lib/dateUtils";
import { formatShortDate } from "@/lib/format";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { report } from "@/lib/errorLogger";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { shareNative } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";

// Lazy-load the Leaflet tracking map so the ~45KB Leaflet bundle is only
// pulled in when an active "on_the_way" tracking card is visible.
const TrackingMap = lazy(() =>
  import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap }))
);

const STATUSES = [
  { key: "assigned", label: "Offered", icon: Clock, color: "text-muted-foreground" },
  { key: "confirmed", label: "Accepted", icon: CheckCircle2, color: "text-primary" },
  { key: "job_confirmed", label: "Confirmed", icon: ShieldCheck, color: "text-primary" },
  { key: "on_the_way", label: "On the Way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", icon: PartyPopper, color: "text-primary" },
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
  return Math.max(0, trackingIdx, jobIdx);
}

/**
 * How to phrase the assigned helper's name for the step the job is on.
 * "Offered to Camille" is only true at step 0 — once she has accepted, is
 * driving over, or is holding a wrench, saying "Offered to" is wrong.
 * Returned as before/after fragments so the name itself can stay a link.
 */
export function helperStatusPhrase(idx: number): { before: string; after: string } {
  switch (idx) {
    case STATUS_IDX.confirmed: return { before: "", after: "accepted this job" };
    case STATUS_IDX.job_confirmed: return { before: "", after: "confirmed — ready to start" };
    case STATUS_IDX.on_the_way: return { before: "", after: "is on the way" };
    case STATUS_IDX.arrived: return { before: "", after: "has arrived" };
    case STATUS_IDX.working: return { before: "", after: "is working on the job" };
    case STATUS_IDX.done: return { before: "", after: "finished the job" };
    default: return { before: "Offered to", after: "" };
  }
}

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
  const [sosOpen, setSosOpen] = useState(false);
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
      if (job && job.status === "accepted") {
        await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);
      }
      if (newStatus === "arrived") {
        await supabase.from("jobs").update({ helper_arrived_at: now }).eq("id", jobId);
      }
      if (newStatus === "on_the_way") {
        await supabase.from("jobs").update({ helper_on_the_way_at: now }).eq("id", jobId);
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

  // SOS is a safety control for someone who is EN ROUTE or ON SITE. It used to
  // render for the whole of `in_progress`, which begins at the "Offered" step —
  // so the poster saw an SOS button on a job where, in the owner's words, "no
  // one is even there". It now appears from "On the Way" onward and stays up
  // through Arrived / Working / Done-pending, dropping only once the job is
  // closed out. Never deleted: it is the one control that matters if a visit
  // goes wrong.
  const showSos =
    currentStatusIdx >= STATUS_IDX.on_the_way &&
    jobStatus !== "completed" &&
    jobStatus !== "cancelled";

  // NOTE: the step row used to scroll horizontally, and an effect here
  // re-centred the current step on every advance. Both are gone: the row no
  // longer scrolls (it wraps to a 4 + 3 grid on phones), so there is nothing
  // to centre — and calling scrollIntoView with no scrollable ancestor left
  // would have walked up to the document and yanked the feed instead.

  if (!helperId) return null;

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="font-display italic font-bold leading-tight text-headline-card min-w-0"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          Job tracking
        </h3>
        {/* SOS share button. Lets either party quickly share their location
            context with a trusted contact for safety — see `showSos` for why
            it no longer appears the moment a job turns `in_progress`. */}
        {showSos && (
          <button
            type="button"
            onClick={() => setSosOpen(true)}
            aria-label="SOS — share your location"
            className="h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold shrink-0 active:scale-95 transition-all"
            style={{
              color: "hsl(var(--burnt-sienna))",
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            SOS
          </button>
        )}
      </div>

      {/* Progress timeline */}
      {(() => {
        const getSubtext = (_key: string): string | null => {
          return null;
        };

        // Wraps, never scrolls. Seven steps do not fit one phone-width row at a
        // legible size, and while it scrolled the row simply sliced whatever
        // step straddled the card edge — the reported "On the W". A scroller
        // can always be cut mid-word, so the row is a grid instead: four steps
        // then three on phones, all seven once there is room. Nothing is ever
        // clipped, at 320px or anywhere else, because nothing overflows.
        return (
          <div
            // Read-only text, no longer a scrollable region, so it needs no tab
            // stop of its own (axe's `scrollable-region-focusable` no longer
            // applies). The group role + label keep it announcing as
            // "Job progress, group" rather than seven loose fragments.
            role="group"
            aria-label="Job progress"
            className="grid grid-cols-4 sm:grid-cols-7 gap-x-1 gap-y-3 items-start"
          >
            {STATUSES.map((s, idx) => {
              const isActive = idx <= currentStatusIdx;
              const isCurrent = idx === currentStatusIdx;
              const Icon = s.icon;
              const subtext = getSubtext(s.key);
              return (
                <div
                  key={s.key}
                  className="min-w-0 flex flex-col items-center gap-1"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                    style={
                      isCurrent
                        ? {
                            background: "hsl(var(--bark))",
                            color: "hsl(var(--parchment))",
                            boxShadow: "0 0 0 2px hsl(var(--bark) / 0.30), 0 0 0 4px hsl(var(--parchment))",
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
                    className="text-ds-9 min-[360px]:text-ds-10 font-sans font-semibold text-center leading-tight"
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
                  {subtext && (
                    <span className="text-ds-9 text-muted-foreground text-center leading-none">{subtext}</span>
                  )}
                </div>
              );
            })}
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
            width: `${((currentStatusIdx + 1) / STATUSES.length) * 100}%`,
            background: "hsl(var(--bark) / 0.85)",
          }}
        />
      </div>

      {/* Who is being tracked, phrased for the step the job is actually on.
          This used to be an "Offered to <Name>" row sitting immediately under
          the "Job tracking" heading, where it read as a second title — and it
          still said "Offered to" for a helpr who was already holding a wrench.
          It now captions the progress it belongs to. `isHelper` mounts skip
          it: a helper tracking their own job needs no one named. */}
      {!isHelper && helperName && (() => {
        const { before, after } = helperStatusPhrase(currentStatusIdx);
        return (
          <div className="flex items-center justify-center gap-1.5 min-w-0">
            <span
              className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-10 font-bold shrink-0"
              aria-hidden
            >
              {helperName[0].toUpperCase()}
            </span>
            <p className="text-ds-11 text-muted-foreground truncate">
              {before && <span>{before} </span>}
              {helperId ? (
                <a
                  href={`/user/${helperId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-primary hover:underline"
                >
                  {helperName}
                </a>
              ) : (
                <span className="font-medium">{helperName}</span>
              )}
              {after && <span> {after}</span>}
            </p>
          </div>
        );
      })()}

      {/* Live-tracking map — shown while helper is on the way and both
          positions are known. Lazy-loaded so the Leaflet chunk isn't paid
          for by cards that never enter this state. Falls back silently to
          the ETA text below when coordinates are unavailable or the
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

      {/* ETA */}
      {tracking?.eta_minutes && tracking.status === "on_the_way" && (
        <p className="text-ds-11 text-muted-foreground text-center">
          ETA: ~{tracking.eta_minutes} min
        </p>
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

      {/* SOS confirmation sheet */}
      <Sheet open={sosOpen} onOpenChange={setSosOpen}>
        <SheetContent side="bottom" className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {/* Canonical sheet header — this was a bare SheetHeader/SheetTitle
              stack with no eyebrow and default type tokens, which read as a
              different designer's popup next to every other titled sheet. */}
          <SheetHero
            eyebrow="Live location"
            title="Share your location"
          />
          <div className="mt-4 space-y-2">
            <Button
              className="w-full"
              onClick={async () => {
                setSosOpen(false);
                await shareNative({
                  title: "I'm on a Helpr job — share my location",
                  text: `I'm currently on a Helpr job. You can reach me at: https://www.louisianahelpr.com/track/${jobId}`,
                  url: `https://www.louisianahelpr.com/track/${jobId}`,
                  dialogTitle: "Share your location",
                });
              }}
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share location link
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setSosOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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
