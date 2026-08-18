import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
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
  initialTracking,
  jobLatitude,
  jobLongitude,
}: {
  jobId: string;
  helperId: string | null;
  /**
   * Display name of the assigned helper. Supplied by the poster-side card so
   * the tracker can state WHO it is tracking in its own header. Before this,
   * the name lived in a standalone "Offered to …" pill row floating above the
   * tracker; the owner asked for it to move inside — "it belongs in the
   * tracker, not in that small pop up icon thing". Optional: the helper-side
   * mounts are tracking themselves and have no one to name.
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
  const [sosOpen, setSosOpen] = useState(false);
  const { request: requestPermission } = usePermissionRationale();

  // Sync props
  useEffect(() => { setHelperConfirmedAt(initialHelperConfirmedAt); }, [initialHelperConfirmedAt]);
  useEffect(() => { setPosterConfirmedAt(initialPosterConfirmedAt); }, [initialPosterConfirmedAt]);
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

  // Determine current status index based on tracking data + confirmation state
  const bothConfirmed = !!helperConfirmedAt && !!posterConfirmedAt;
  const eitherConfirmed = !!helperConfirmedAt || !!posterConfirmedAt;

  const currentStatusIdx = tracking
    ? STATUSES.findIndex((s) => s.key === tracking.status)
    : eitherConfirmed
      ? STATUSES.findIndex((s) => s.key === "job_confirmed")
      : helperConfirmedAt
        ? STATUSES.findIndex((s) => s.key === "confirmed")
        : (jobStatus === "accepted" ? STATUSES.findIndex((s) => s.key === "assigned") : 0);

  // Bring the live step to the user, rather than making them scroll to find it.
  //
  // The step row scrolls horizontally (seven steps do not fit 375px legibly), so
  // once a job passes the third or fourth step the current one sits off-screen.
  // Every advance re-centres it. `block: "nearest"` keeps the PAGE still — the
  // default would scroll the whole card into view and yank the feed under the
  // reader's thumb, which is worse than the problem being solved.
  //
  // Guarded on the ref existing rather than on currentStatusIdx alone: the row
  // is inside an IIFE that only renders when there is a helper, so on the first
  // pass the node may not be mounted yet.
  const stepRowRef = useRef<HTMLDivElement | null>(null);
  const currentStepRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = currentStepRef.current;
    if (!el || !stepRowRef.current) return;
    el.scrollIntoView({
      // Respect a reduced-motion preference — an unexpected horizontal slide is
      // exactly the kind of movement that setting exists to suppress.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentStatusIdx]);

  if (!helperId) return null;

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="font-display italic font-bold leading-tight text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Job tracking
          </h3>
          {/* Who is being tracked. Moved here from the standalone pill row the
              card used to render between the description and this card — same
              avatar, same name, same link to their profile, one less floating
              row. `isHelper` mounts skip it: a helper tracking their own job
              does not need to be told whose job it is. */}
          {!isHelper && helperName && (
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              <span
                className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-10 font-bold shrink-0"
                aria-hidden
              >
                {helperName[0].toUpperCase()}
              </span>
              <span className="text-ds-11 text-muted-foreground shrink-0">Offered to</span>
              {helperId ? (
                <a
                  href={`/user/${helperId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-ds-11 font-medium text-primary hover:underline truncate"
                >
                  {helperName}
                </a>
              ) : (
                <span className="text-ds-11 font-medium truncate">{helperName}</span>
              )}
            </div>
          )}
        </div>
        {/* SOS share button — only during in_progress jobs.
            Lets either party quickly share their location context
            with a trusted contact for safety. */}
        {jobStatus === "in_progress" && (
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

        // Horizontally scrollable, not compress-to-fit. Seven steps sharing one
        // 375px row via `flex-1` squeezed each to ~46px, which clipped the last
        // label ("Done") against the card edge — the step the poster most wants
        // to see. The row now scrolls and each step keeps a legible fixed width;
        // stepRowRef + currentStepRef centre the active step whenever it
        // advances, so the thing that just happened comes to the user instead of
        // the user having to go find it. `scrollbar-hide` matches the filter-chip
        // rows elsewhere.
        return (
          <div
            ref={stepRowRef}
            // A scrollable region with no focusable content inside it is
            // unreachable by keyboard — axe's `scrollable-region-focusable`,
            // serious. The steps are read-only text, so there is nothing in
            // here to focus; the container itself takes the tab stop, and the
            // group role + label mean it announces as "Job progress, group"
            // rather than as an unnamed scroller.
            tabIndex={0}
            role="group"
            aria-label="Job progress"
            className="flex items-start gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1 snap-x snap-mandatory rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {STATUSES.map((s, idx) => {
              const isActive = idx <= currentStatusIdx;
              const isCurrent = idx === currentStatusIdx;
              const Icon = s.icon;
              const subtext = getSubtext(s.key);
              return (
                <div
                  key={s.key}
                  ref={isCurrent ? currentStepRef : undefined}
                  className="shrink-0 w-[4.5rem] flex flex-col items-center gap-1 snap-center"
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
                    className="text-ds-10 font-sans font-semibold text-center leading-tight"
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

      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--olivewood) / 0.10)" }}>
        <div
          className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
          style={{
            width: `${((currentStatusIdx + 1) / STATUSES.length) * 100}%`,
            background: "hsl(var(--bark) / 0.85)",
          }}
        />
      </div>

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
