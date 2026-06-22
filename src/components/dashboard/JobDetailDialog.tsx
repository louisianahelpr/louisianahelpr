import { useState, useEffect, useRef, type ElementType } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPin, Calendar, Clock, Flag, Users, Repeat, Timer, Bookmark, MessageSquare, Rocket, Zap, ChevronRight, Check, ShieldCheck,
} from "lucide-react";
import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { getCity } from "@/lib/locationUtils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatJobDate, parseLocalDate } from "@/lib/dateUtils";
import { haversineMiles } from "@/lib/geo";
import { getParishCentroid } from "@/lib/parishCentroids";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import type { EnrichedJob } from "./types";
import { JobPosterCard } from "./JobPosterCard";
import { formatTime12 } from "@/components/TimePickerSelect";
import { IconActionButton } from "./IconActionButton";
import { PhotoLightbox } from "./PhotoLightbox";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { report } from "@/lib/errorLogger";
import { useDrivingTime } from "@/hooks/useDrivingTime";
import { JobPrice } from "./JobPrice";

interface JobDetailDialogProps {
  job: EnrichedJob | null;
  effectiveFee: number;
  /** The helpr's currently-filtered job list — used for swipe navigation. */
  allJobs?: EnrichedJob[];
  /** Save state + toggle — when omitted, the bookmark button hides. */
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  /** Helpr's current geolocation. When provided, the Where tile shows
      a rough mileage to the job's parish centroid. */
  userLat?: number | null;
  userLng?: number | null;
  onClose: () => void;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
  /** Switching the dialog from one job to another (swipe gesture or similar-job tap). */
  onSelect?: (job: EnrichedJob) => void;
  /** Logged-out preview: render the public job info read-only and replace
      every action (apply/message/save/report) with a single sign-up CTA.
      The poster card, applicant banners, and authed look-ups are skipped —
      a guest only has the masked public RPC fields. */
  guest?: boolean;
}

const JobDetailDialog = ({
  job, effectiveFee, allJobs: _allJobs, isSaved, onToggleSave, userLat, userLng, onClose, onApply, onReport, onSelect: _onSelect, guest = false,
}: JobDetailDialogProps) => {
  const navigate = useNavigate();
  const [descExpanded, setDescExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Nonce bump tells PhotoLightbox to open in grid mode when the user
  // taps the "View all" pill on the cover. Plain number so a click
  // increments + re-fires the effect even on the same photo.
  const [gridOpenNonce, setGridOpenNonce] = useState(0);
  const [applicationCount, setApplicationCount] = useState<number | null>(null);
  // The viewer's own application position (1-indexed) among existing
  // applicants for this job — null if they haven't applied yet. Drives
  // the "you're #3 of 7" banner that replaces the generic "X applied"
  // line for already-applied helpers, so the feed feels accountable.
  const [viewerAppPosition, setViewerAppPosition] = useState<number | null>(null);
  // The auth'd user's ID — used to hide the Share button for jobs the
  // current user posted (they're the owner, not a potential helper).
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  // Repeat-customer count — number of completed jobs between this
  // helper and this poster. Drives the "Worked with you N times"
  // badge that surfaces emotional re-booking trust.
  const [repeatJobs, setRepeatJobs] = useState<number>(0);
  // Cancellation rate of the poster — surfaced inline on the poster
  // card when they have ≥5 jobs of history so a single cancelled job
  // doesn't slap on a 100% rate. Null while loading or when below the
  // sample-size floor.
  const [posterCancelRate, setPosterCancelRate] = useState<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Viewer's subscription tier — drives the Helper Pro fee upsell in
  // FeeBreakdown. Cached per-session (staleTime 60s). Falls back to "free"
  // so the upsell shows unless a paid tier is positively confirmed.
  const { data: viewerSubscriptionTier = "free" } = useQuery({
    queryKey: ["viewerSubscriptionTier"],
    enabled: !guest,
    staleTime: 60_000,
    queryFn: async (): Promise<string> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return "free";
      const { data, error } = await supabase
        .from("profiles")
        .select("subscription_tier")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) return "free";
      return (data as { subscription_tier: string | null }).subscription_tier ?? "free";
    },
  });

  // Viewer's credential tier — used to gate the Apply button when the job
  // requires a minimum tier. Fetched once per session (staleTime 60s) and
  // falls back to 0 gracefully when the RPC doesn't exist yet (PGRST202).
  const { data: viewerTier = 0 } = useQuery({
    queryKey: ["viewerCredentialTier"],
    enabled: !guest,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      try {
        const { data, error } = await supabase.rpc("get_user_credential_tier", {
          p_user_id: user.id,
        });
        // PGRST202 = function not found (migration not yet applied to prod) —
        // treat as tier 0 so open jobs remain accessible.
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return 0;
          report(error, { tags: { source: "JobDetailDialog.viewerTier" } });
          return 0;
        }
        return typeof data === "number" ? data : 0;
      } catch {
        return 0;
      }
    },
  });

  // Reset transient state when the dialog switches to a new job.
  useEffect(() => {
    setLightboxIndex(null);
    setApplicationCount(null);
    setViewerAppPosition(null);
    setViewerUserId(null);
    setPosterCancelRate(null);
    setDescExpanded(false);
  }, [job?.id]);

  // Record a view when a helper opens this job's detail dialog.
  // Fire-and-forget — we don't block the UI on this. The RPC is
  // idempotent (ON CONFLICT DO NOTHING) so repeated opens are safe.
  // Skip recording if the viewer is the poster (customer_id matches).
  useEffect(() => {
    if (guest || !job?.id) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        // Don't record the poster viewing their own job
        if (!user || user.id === job.customer_id) return;
        // record_job_view isn't in the generated Functions map (migration
        // unapplied to prod); call it via a narrowly-typed wrapper. PGRST202
        // is swallowed by the surrounding try/catch.
        const recordJobViewRpc = supabase.rpc as unknown as (
          fn: "record_job_view",
          args: { p_job_id: string },
        ) => Promise<{ data: unknown; error: { code?: string } | null }>;
        await recordJobViewRpc("record_job_view", { p_job_id: job.id });
      } catch {
        // Non-critical — PGRST202 (not yet deployed) or network error
      }
    })();
  }, [guest, job?.id, job?.customer_id]);

  // Fetch how many helprs have already applied AND — if the viewer is
  // already in that queue — what position (1-indexed by created_at)
  // they hold. The position is what powers the "you're #3 of 7" banner
  // for an already-applied helper; the raw count powers the original
  // "X helpers applied — you'd be #(X+1)" banner for fresh viewers.
  useEffect(() => {
    if (guest || !job?.id) return;
    let cancelled = false;
    (async () => {
      // We need both the total count AND, for the current user, the
      // index of their application in created_at order. Doing the
      // small list fetch (just ids + created_at + helper_id) and
      // counting locally is cheaper than two round-trips for a job
      // with under ~50 applicants — and the head-count above is
      // already gated to "has the helpr seen this job? yes."
      const [{ data: apps, error }, { data: userRes }] = await Promise.all([
        supabase
          .from("applications")
          .select("id, helper_id, created_at")
          .eq("job_id", job.id)
          .order("created_at", { ascending: true }),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      if (error) {
        report(error, { tags: { source: "JobDetailDialog.applicationCount" } });
        setApplicationCount(0);
        return;
      }
      const rows = apps ?? [];
      setApplicationCount(rows.length);
      const helperId = userRes?.user?.id;
      if (helperId) {
        setViewerUserId(helperId);
        const idx = rows.findIndex((a) => a.helper_id === helperId);
        setViewerAppPosition(idx >= 0 ? idx + 1 : null);
      } else {
        setViewerUserId(null);
        setViewerAppPosition(null);
      }
    })();
    return () => { cancelled = true; };
  }, [guest, job?.id]);

  // Fetch the poster's cancellation rate — shows next to their name on
  // the poster card. Combined poster-side + worked-side rate, capped at
  // a ≥5 sample size so a fresh poster doesn't read "100%" off one
  // cancelled job. Mirrors the math in UserProfile so the inline
  // number matches the profile page if the helpr taps through.
  useEffect(() => {
    if (guest || !job?.customer_id) return;
    let cancelled = false;
    (async () => {
      const customerId = job.customer_id;
      const [postedTotalRes, postedCancelRes, workedTotalRes, workedCancelRes] = await Promise.all([
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("status", "cancelled"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", customerId),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", customerId).eq("status", "cancelled"),
      ]);
      if (cancelled) return;
      // Don't silently swallow a failed count query — a dropped error would
      // skew the rate (a failed `cancelled` count reads as 0 → an
      // artificially clean rate). On any error, report and show no rate.
      const firstError = [postedTotalRes, postedCancelRes, workedTotalRes, workedCancelRes]
        .find((res) => res.error)?.error;
      if (firstError) {
        report(firstError, { tags: { source: "JobDetailDialog.posterCancelRate" } });
        setPosterCancelRate(null);
        return;
      }
      const total = (postedTotalRes.count ?? 0) + (workedTotalRes.count ?? 0);
      const cancelledCount = (postedCancelRes.count ?? 0) + (workedCancelRes.count ?? 0);
      if (total >= 5) setPosterCancelRate((cancelledCount / total) * 100);
      else setPosterCancelRate(null);
    })();
    return () => { cancelled = true; };
  }, [guest, job?.customer_id]);

  // Fetch how many completed jobs the current helper has done for this
  // poster. Drives the repeat-customer badge in the poster card —
  // emotional rebooking signal when the relationship has history.
  useEffect(() => {
    if (guest || !job?.customer_id) {
      setRepeatJobs(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const helperId = userRes?.user?.id;
      if (!helperId || cancelled) return;
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", job.customer_id)
        .eq("helper_id", helperId)
        .eq("status", "completed");
      if (error) report(error, { tags: { source: "JobDetailDialog.repeatJobs" } });
      if (!cancelled) setRepeatJobs(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [guest, job?.customer_id]);

  // Distance + driving-time estimate for the Where tile. Computed up
  // here (not inside the IIFE below) so the useDrivingTime hook can
  // run at the top level. Falls back to null on either axis when the
  // parish centroid or helpr coords are missing.
  const parishCentroidForDriving = getParishCentroid(job?.parish);
  const distMilesForDriving =
    userLat != null && userLng != null && parishCentroidForDriving
      ? haversineMiles(userLat, userLng, parishCentroidForDriving.lat, parishCentroidForDriving.lng)
      : null;
  const drivingMinutes = useDrivingTime(
    userLat,
    userLng,
    parishCentroidForDriving?.lat ?? null,
    parishCentroidForDriving?.lng ?? null,
    distMilesForDriving,
  );
  const drivingLabel = drivingMinutes == null
    ? null
    : drivingMinutes < 60
      ? `${drivingMinutes} min drive`
      : `${Math.floor(drivingMinutes / 60)}h ${drivingMinutes % 60}m drive`;

  if (!job) return null;

  const photos = job.photos || [];
  const catStyle = categoryColors[job.category] || categoryColors.other;

  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const commissionPercent = job.helper_fee_percent ?? effectiveFee;

  const handleAskQuestion = () => {
    navigate(`/messages?userId=${job.customer_id}&jobId=${job.id}`);
    onClose();
  };

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent
        // grid-cols-1: the base DialogContent is `display:grid` with implicit
        // `auto` columns, which size to max-content and can grow wider than
        // the dialog; paired with the content's `overflow-y-auto` (which makes
        // overflow-x compute to `auto`), the over-wide track gets clipped,
        // cutting long words in the description mid-glyph. grid-cols-1 swaps the
        // track to `minmax(0,1fr)`, pinning it to the dialog width so children
        // wrap instead of overflowing.
        className="grid-cols-1 sm:max-w-lg !gap-2"
        onTouchStart={(e) => {
          if (!_allJobs || !_onSelect) return;
          const t = e.touches[0];
          touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
        }}
        onTouchEnd={(e) => {
          // Mobile swipe to navigate between jobs in the filtered list.
          // Threshold: 60px horizontal movement, less than 50px vertical
          // (so accidental scroll-swipes don't fire), under 600ms total.
          if (!_allJobs || !_onSelect) return;
          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          const dt = Date.now() - start.t;
          if (Math.abs(dx) < 60 || Math.abs(dy) > 50 || dt > 600) return;
          const idx = _allJobs.findIndex((j) => j.id === job!.id);
          if (idx < 0) return;
          const nextIdx = dx < 0 ? idx + 1 : idx - 1;
          if (nextIdx < 0 || nextIdx >= _allJobs.length) return;
          _onSelect(_allJobs[nextIdx]);
        }}
      >
        {/* Header — mirrors the dashboard's Browse Tasks block: italic
            Garamond eyebrow (category) → bold italic Bodoni headline (job
            title) → italic Garamond meta (location · time · status pills). */}
        <DialogHeader className="!text-left space-y-0 pr-10 mb-2">
          <span
            className="text-[0.62rem] font-serif italic uppercase tracking-[0.18em] flex items-center gap-1.5"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
          >
            <span
              aria-label={categoryLabels[job.category] || job.category}
              className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${catStyle.dot}`}
            >
              <CategoryIcon
                category={job.category}
                aria-hidden
                className="w-2.5 h-2.5 text-white/90"
                strokeWidth={2.5}
              />
            </span>
            {categoryLabels[job.category] || job.category}
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "1.5rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {job.title}
          </DialogTitle>
        </DialogHeader>

        {/* Photo cover wrapped so Boosted (top-right) and Urgent
            (top-left) can stamp the corners without being clipped by
            the photo's overflow-hidden. */}
        {photos.length > 0 && (
          <div className="relative">
            {job.is_urgent && (
              <span
                aria-label="Urgent"
                className="urgent-pulse absolute -top-2 -left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold uppercase tracking-wider"
                style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
              >
                <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
              </span>
            )}
            {job.isBoosted && (
              <span
                aria-label="Boosted"
                className="boosted-shimmer boosted-pulse absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                style={{
                  color: "hsl(38 60% 28%)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.6)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "inset 0 -1px 1px 0 hsl(var(--gold-warm) / 0.20), " +
                    "0 1px 2px hsl(var(--gold-warm) / 0.20), " +
                    "0 4px 10px -3px hsl(var(--gold-warm) / 0.34)",
                }}
              >
                <Rocket
                  className="w-2.5 h-2.5"
                  strokeWidth={2.25}
                  style={{ color: "hsl(var(--gold-warm))", fill: "hsl(var(--gold-warm) / 0.35)" }}
                />
                Boosted
              </span>
            )}
            <button
              type="button"
              onClick={() => setLightboxIndex(0)}
              aria-label="View photos"
              className="relative block w-full aspect-video rounded-ds-md overflow-hidden group"
              style={{
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                boxShadow:
                  "inset 0 0 0 1px rgba(255, 255, 255, 0.5), " +
                  "0 1px 2px hsl(var(--olivewood) / 0.08), " +
                  "0 8px 24px -6px hsl(var(--bark) / 0.18)",
              }}
            >
              {/* 16:9 cover inside a max-w-lg (512px) dialog — request a
                  ~512x288 thumbnail (via Supabase render + Vercel edge)
                  instead of the raw upload. The wrapper is `aspect-video`,
                  so the box is already CLS-safe. */}
              <OptimizedImage src={photos[0]} width={512} height={288} alt="Cover" fadeIn className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
              {photos.length > 1 && (
                <span
                  className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold"
                  style={{
                    backgroundColor: "var(--glass-bg-strong)",
                    backdropFilter: "blur(12px) saturate(150%)",
                    WebkitBackdropFilter: "blur(12px) saturate(150%)",
                    color: "hsl(var(--ink-deep))",
                    border: "0.5px solid var(--glass-border)",
                    boxShadow: "0 1px 4px hsl(var(--bark) / 0.18)",
                  }}
                >
                  +{photos.length - 1} more
                </span>
              )}
            </button>
            {/* "View all" — opens the lightbox straight into grid mode
                so a helpr can scan a project with lots of reference
                shots without tapping next/next/next. */}
            {photos.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setGridOpenNonce((n) => n + 1);
                  setLightboxIndex(0);
                }}
                aria-label="View all photos in a grid"
                className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold uppercase tracking-[0.05em] transition-transform active:scale-95 hover:scale-105"
                style={{
                  backgroundColor: "var(--glass-bg-strong)",
                  backdropFilter: "blur(12px) saturate(150%)",
                  WebkitBackdropFilter: "blur(12px) saturate(150%)",
                  color: "hsl(var(--ink-deep))",
                  border: "0.5px solid var(--glass-border)",
                  boxShadow: "0 1px 4px hsl(var(--bark) / 0.18)",
                }}
              >
                View all
              </button>
            )}
          </div>
        )}

        {/* Group / recurring tags */}
        {(job.is_group_job || job.is_recurring) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {job.is_group_job && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-ds-10 font-semibold uppercase tracking-wider border border-primary/20">
                <Users className="w-3 h-3" strokeWidth={2.25} />
                {job.helpers_needed ?? 2} helprs needed
              </span>
            )}
            {job.is_recurring && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--burnt-sienna)/0.08)] text-[hsl(var(--burnt-sienna))] text-ds-10 font-semibold uppercase tracking-wider border border-[hsl(var(--burnt-sienna)/0.2)]">
                <Repeat className="w-3 h-3" strokeWidth={2.25} />
                {job.recurrence_interval || "Recurring"}
              </span>
            )}
          </div>
        )}

        {/* Scope video — shows before description so helpers immediately
            see what's needed. Hidden when no video attached. */}
        {job.scope_video_url && (
          <div className="rounded-ds-md overflow-hidden mb-3">
            <video
              src={job.scope_video_url}
              controls
              playsInline
              preload="none"
              className="w-full max-h-48 object-cover"
              style={{ background: "hsl(var(--bark) / 0.05)" }}
            />
            <p
              className="font-serif italic text-ds-11 mt-1 text-center"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Scope video — see exactly what's needed
            </p>
          </div>
        )}

        {/* Description — own glass plate. When there's no photo, this
            is where Boosted (top-right) and Urgent (top-left) stamps
            live. "Read more" expands the full text inline when long. */}
        {/* min-w-0: as a grid item of the DialogContent grid this defaults
            to min-width:auto, so a long unbroken word would force the item
            wider than the track and the line-clamp box would clip the
            overflow. min-w-0 lets it shrink to the track and wrap. */}
        <div className="relative min-w-0">
          {photos.length === 0 && job.is_urgent && (
            <span
              aria-label="Urgent"
              className="urgent-pulse absolute -top-2 -left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold uppercase tracking-wider"
              style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
            >
              <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
            </span>
          )}
          {photos.length === 0 && job.isBoosted && (
            <span
              aria-label="Boosted"
              className="boosted-shimmer boosted-pulse absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
              style={{
                color: "hsl(38 60% 28%)",
                border: "0.5px solid hsl(var(--gold-warm) / 0.6)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                  "inset 0 -1px 1px 0 hsl(var(--gold-warm) / 0.20), " +
                  "0 1px 2px hsl(var(--gold-warm) / 0.20), " +
                  "0 4px 10px -3px hsl(var(--gold-warm) / 0.34)",
              }}
            >
              <Rocket className="w-2.5 h-2.5" strokeWidth={2.25} style={{ color: "hsl(var(--gold-warm))", fill: "hsl(var(--gold-warm) / 0.35)" }} />
              Boosted
            </span>
          )}
          <div
            className="rounded-ds-md px-3.5 py-2.5"
            style={{
              backgroundColor: "var(--glass-bg-soft)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              border: "0.5px solid var(--glass-border)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05)",
            }}
          >
            {/* line-clamp-3 turns this <p> into a display:-webkit-box,
                which defaults to min-width:auto and sizes to its max-content
                width — so a normal word near the edge overflows and the box's
                own overflow:hidden clips it mid-word instead of wrapping.
                min-w-0 lets the box shrink to its container so text wraps,
                and we only clamp when the text is actually long enough to
                need it (matching the Read more threshold) so short
                descriptions stay plain blocks that wrap cleanly. */}
            <p
              className={`font-serif text-[0.95rem] leading-relaxed break-words min-w-0 ${!descExpanded && (job.description?.length ?? 0) > 180 ? "line-clamp-3" : ""}`}
              style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
            >
              {job.description}
            </p>
            {/* Show "Read more" only when the description is long enough
                to overflow line-clamp-3. ~180 chars covers the threshold. */}
            {(job.description?.length ?? 0) > 180 && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="mt-1.5 text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] hover:opacity-80 transition-opacity"
                style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}
              >
                {descExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        </div>

        {/* Stat strip — sits ABOVE the payout pill so the helpr scans the
            facts (where, when, how long, deadline) before they see the
            payout. Where + Date are clickable: Where opens Google Maps,
            Date opens Google Calendar. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(() => {
            const dateNeeded = parseLocalDate(job.date_needed);
            const dateValid = !isNaN(dateNeeded.getTime());
            let calendarUrl: string | null = null;
            if (dateValid) {
              const dateStartIso = dateNeeded.toISOString().slice(0, 10).replace(/-/g, "");
              const dateEnd = new Date(dateNeeded.getTime() + (job.estimated_hours ? Number(job.estimated_hours) * 3600 * 1000 : 24 * 3600 * 1000));
              const dateEndIso = dateEnd.toISOString().slice(0, 10).replace(/-/g, "");
              calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(job.title)}&dates=${dateStartIso}/${dateEndIso}&details=${encodeURIComponent(job.description.slice(0, 200))}&location=${encodeURIComponent(job.location)}`;
            }
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`;
            // Distance estimate when both helpr coords + parish centroid
            // available. distMilesForDriving + drivingLabel are computed
            // above (because useDrivingTime is a hook); we just compose
            // the user-facing copy here.
            const distMiles = distMilesForDriving;
            const distOnly = distMiles != null
              ? distMiles < 1 ? "less than 1 mi" : `~${Math.round(distMiles)} mi`
              : null;
            // Compose distance + driving time on one line when both are
            // available: "12 min · ~4 mi". Falls back to either alone.
            const distLabel = distOnly && drivingLabel
              ? `${drivingLabel} · ${distOnly}`
              : drivingLabel ?? distOnly;
            // Closes urgency: <24h to expiry → render in Sienna with subtle pulse
            const hoursLeft = job.expires_at
              ? differenceInHours(new Date(job.expires_at), new Date())
              : null;
            const closesUrgent = hoursLeft != null && hoursLeft >= 0 && hoursLeft < 24;
            const tiles = [
              { Icon: MapPin, label: "Where", value: getCity(job.location).replace(/,\s*LA\s*$/i, ""), sub: distLabel, href: mapsUrl, urgent: false },
              {
                Icon: Calendar,
                label: "Date",
                value: dateValid ? formatJobDate(job.date_needed) : "—",
                sub: null,
                href: calendarUrl,
                urgent: false,
              },
              // Time is its own tile (not a sub-line under Date) so the date
              // stops truncating and the start time reads as a first-class
              // fact. Omitted when unset, matching Estimated/Closes below.
              // 12-hour clock (e.g. "2:30 PM"), matching the feed card — not
              // the raw "14:30:00" the DB column stores.
              ...(job.start_time
                ? [{
                    Icon: Clock,
                    label: "Time",
                    value: formatTime12(job.start_time),
                    sub: null,
                    href: null,
                    urgent: false,
                  }]
                : []),
              // Estimated-hours tile is omitted entirely when unset — a bare
              // "Estimated —" read as a bug rather than "no estimate given".
              ...(job.estimated_hours != null
                ? [{
                    Icon: Clock,
                    label: "Estimated",
                    value: `${job.estimated_hours} ${Number(job.estimated_hours) === 1 ? "hr" : "hrs"}`,
                    sub: null,
                    href: null,
                    urgent: false,
                  }]
                : []),
              // Closes tile is omitted entirely when the job has no expiry —
              // an empty "—" deadline read as a bug rather than "no deadline".
              ...(job.expires_at
                ? [{
                    Icon: Timer,
                    label: "Closes",
                    value: formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }),
                    sub: null,
                    href: null,
                    urgent: closesUrgent,
                  }]
                : []),
            ];
            return tiles.map(({ Icon, label, value, sub, href, urgent }, index) => {
              // An odd tile count leaves the last tile alone in the 2-col
              // mobile grid with an empty cell beside it — let it span the
              // full width instead so the strip reads as intentional.
              const fillsRow = tiles.length % 2 === 1 && index === tiles.length - 1;
              const Wrapper: ElementType = href ? "a" : "div";
              // Only the anchor branch carries href/target/rel; an empty object
              // for the div branch. Typed as the minimal shared shape so the
              // spread is valid whether Wrapper resolves to <a> or <div>.
              const wrapperProps: { href?: string; target?: string; rel?: string } = href
                ? { href, target: "_blank", rel: "noopener noreferrer" }
                : {};
              return (
                <Wrapper
                  key={label}
                  {...wrapperProps}
                  className={`relative min-w-0 rounded-ds-md p-2.5 overflow-hidden ${fillsRow ? "col-span-2 sm:col-span-1" : ""} ${href ? "glass-press transition-shadow hover:shadow-md cursor-pointer" : ""} ${urgent ? "urgent-pulse" : ""}`}
                  style={{
                    backgroundColor: urgent ? "hsl(var(--accent) / 0.10)" : "var(--glass-bg-soft)",
                    backdropFilter: "blur(18px) saturate(160%)",
                    WebkitBackdropFilter: "blur(18px) saturate(160%)",
                    border: urgent
                      ? "0.5px solid hsl(var(--accent) / 0.45)"
                      : "0.5px solid var(--glass-border)",
                    boxShadow:
                      "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                      (urgent
                        ? "0 1px 2px hsl(var(--accent) / 0.18)"
                        : "0 1px 2px hsl(var(--olivewood) / 0.05)"),
                    display: "block",
                  }}
                >
                  <div className="relative z-10">
                    <p
                      className="flex items-center justify-center gap-1.5 text-ds-11 font-sans font-semibold uppercase"
                      style={{
                        color: urgent ? "hsl(var(--accent))" : "hsl(var(--olivewood) / 0.8)",
                        letterSpacing: "0.06em",
                      }}
                    >
                      <Icon
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: urgent ? "hsl(var(--accent))" : "hsl(var(--burnt-sienna) / 0.7)" }}
                      />
                      {label}
                    </p>
                    <p
                      className="font-display italic font-bold mt-1 text-[16px] leading-tight tracking-tight truncate text-center"
                      style={{ color: urgent ? "hsl(var(--accent))" : "hsl(var(--ink-deep))" }}
                    >
                      {value}
                    </p>
                    {sub && (
                      <p className="font-serif italic text-ds-11 truncate text-center mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                        {sub}
                      </p>
                    )}
                  </div>
                </Wrapper>
              );
            });
          })()}
        </div>

        {/* Payout — the shared JobPrice element (detail variant), tap
            anywhere to expand the breakdown. Same component as the feed
            card so the number is identical across surfaces. */}
        <div className="relative">
          <JobPrice
            variant="detail"
            budget={job.budget}
            effectiveFee={commissionPercent}
            urgentFee={job.urgent_fee ?? 0}
            helpersNeeded={helpers}
            showProUpsell={!viewerSubscriptionTier || viewerSubscriptionTier === "free"}
          />
        </div>

        {!guest && <JobPosterCard job={job} repeatJobs={repeatJobs} cancellationRate={posterCancelRate} />}

        {/* Applicant queue banner. Two flavors:
            - **Already applied** — the viewer is in the queue. Show a
              calm green "you're #3 of 7" banner that frames their
              position relative to the rest, so they don't doom-refresh.
            - **Not yet applied** — the original "X applied — you'd be
              #(X+1) in line" sienna nudge. Only renders when there's
              at least one existing applicant, so fresh posts don't
              fire the urgency tone for nothing.

            While `applicationCount` is still loading (null), reserve the
            banner's height with a quiet pulsing skeleton row so the footer
            buttons below don't jump down when the count resolves on a slow
            network. The skeleton matches the real banner's px-3 py-2 box so
            the swap is zero-shift. */}
        {applicationCount === null && !guest ? (
          <div
            aria-hidden
            className="rounded-ds-md px-3 py-2 flex items-center gap-2 animate-pulse"
            style={{
              background: "hsl(var(--olivewood) / 0.05)",
              border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            }}
          >
            <span
              className="w-3.5 h-3.5 shrink-0 rounded-full"
              style={{ background: "hsl(var(--olivewood) / 0.14)" }}
            />
            <span
              className="h-3 rounded-full w-2/3"
              style={{ background: "hsl(var(--olivewood) / 0.12)" }}
            />
          </div>
        ) : viewerAppPosition !== null && (
          <div
            className="rounded-ds-md px-3 py-2 flex items-center gap-2"
            style={{
              background: "hsl(155 60% 96%)",
              border: "0.5px solid hsl(155 35% 70% / 0.35)",
            }}
          >
            <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(155 50% 30%)" }} strokeWidth={2.5} />
            <p
              className="font-serif italic leading-snug"
              style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.85)" }}
            >
              <span className="not-italic font-display font-bold" style={{ color: "hsl(155 45% 22%)" }}>
                You've applied.
              </span>{" "}
              You're applicant #{viewerAppPosition} of {applicationCount}.
            </p>
          </div>
        )}
        {viewerAppPosition === null && applicationCount !== null && applicationCount > 0 && (
          <div
            className="rounded-ds-md px-3 py-2 flex items-center gap-2"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <Users className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
            <p
              className="font-serif italic leading-snug"
              style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.85)" }}
            >
              <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                {applicationCount} helpr{applicationCount === 1 ? "" : "s"} already applied.
              </span>{" "}
              You'd be #{applicationCount + 1} in line.
            </p>
          </div>
        )}

        {/* Footer actions — Flag · Save · Message · Apply.
            Each secondary icon button gets a hover-scale + glow ring effect
            so they feel tactile rather than static.
            Guests get a single sign-up CTA instead — apply/message/save/report
            all require an account, so we surface one clear next step. */}
        {guest ? (
          <Button
            size="lg"
            onClick={() => { navigate("/signup"); onClose(); }}
            className="btn-liquid-fill w-full rounded-ds-md h-11 sm:h-12 px-3 group relative overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.86) 100%)",
              border: "0.5px solid hsl(var(--bark))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.25), " +
                "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.18), " +
                "0 1px 2px hsl(var(--olivewood) / 0.12), " +
                "0 8px 22px -6px hsl(var(--bark) / 0.45)",
            }}
          >
            <span
              className="relative z-10 inline-flex items-center justify-center gap-2 min-w-0"
              style={{ color: "white", textShadow: "0 1px 2px rgba(0, 0, 0, 0.28)" }}
            >
              <span className="truncate">Sign up to apply</span>
              <ChevronRight
                className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
                strokeWidth={2.5}
              />
            </span>
          </Button>
        ) : (
        <div className="flex gap-1.5 pt-0.5">
          <IconActionButton
            ariaLabel="Report this job"
            onClick={() => { onReport(job.id); onClose(); }}
            hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--burnt-sienna) / 0.20), 0 0 0 3px hsl(var(--burnt-sienna) / 0.08)"
            hoverColor="hsl(var(--burnt-sienna) / 0.85)"
            icon={
              /* Flag waves on hover — subtle counter-clockwise tilt */
              <Flag className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-12 group-active:rotate-0" />
            }
          />
          {onToggleSave && (
            <IconActionButton
              ariaLabel={isSaved ? "Unsave job" : "Save job"}
              ariaPressed={isSaved}
              onClick={() => onToggleSave(job.id, !isSaved)}
              pressed={isSaved}
              pressedBackground="hsl(var(--primary) / 0.12)"
              pressedBorder="0.5px solid hsl(var(--primary) / 0.4)"
              pressedColor="hsl(var(--primary))"
              hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--primary) / 0.22), 0 0 0 3px hsl(var(--primary) / 0.10)"
              hoverColor="hsl(var(--primary))"
              icon={
                /* Bookmark lifts on hover, pops on toggle */
                <Bookmark
                  className={`w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 ${isSaved ? "fill-primary bookmark-pop" : ""}`}
                  key={String(isSaved)}
                  strokeWidth={2}
                />
              }
            />
          )}
          {/* Share — helpers forward great jobs to neighbours / friends.
              Hidden for the poster (they already own it). Matches the
              icon-row sizing of its neighbours (Flag · Save · Message). */}
          {viewerUserId !== job.customer_id && (
            <ShareJobButton
              variant="icon"
              job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: getCity(job.location).replace(/,\s*LA\s*$/i, "") }}
              ariaLabel="Share this job"
            />
          )}
          {/* Message the poster — gated to people with a real reason to
              reach them: the poster themselves, a helper who's been offered
              or hired onto the job, OR a helper who has already applied
              (they may have a genuine question — "is the gate code needed?").
              A helper just browsing can't DM cold, so posters aren't flooded.
              The backend poster-first rule still governs the actual send. */}
          {(viewerUserId === job.customer_id ||
            viewerUserId === (job as { offered_to_helper_id?: string | null }).offered_to_helper_id ||
            viewerUserId === (job as { helper_id?: string | null }).helper_id ||
            viewerAppPosition != null) && (
          <IconActionButton
            ariaLabel="Ask a question"
            onClick={handleAskQuestion}
            hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--bark) / 0.22), 0 0 0 3px hsl(var(--bark) / 0.08)"
            hoverColor="hsl(var(--bark))"
            icon={
              /* Message glides forward on hover — like sending */
              <MessageSquare className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            }
          />
          )}
          {/* Own-job guard — a poster can reach their own job via a shared
              link or Quick Apply toast, so swap the Apply CTA for a plain
              "your post" marker. The Dashboard apply handler also rejects
              self-applications, but hiding the button avoids the dead-end tap. */}
          {viewerUserId === job.customer_id ? (
            <div
              className="flex-1 rounded-ds-md h-11 sm:h-12 px-3 flex items-center justify-center gap-2 text-center"
              style={{
                background: "hsl(var(--bark) / 0.06)",
                border: "0.5px solid hsl(var(--bark) / 0.18)",
              }}
            >
              <span
                className="font-display italic font-semibold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                This is your post
              </span>
            </div>
          ) : (job.credential_tier ?? 0) > 0 && viewerTier < (job.credential_tier ?? 0) ? (
            <div
              className="flex-1 rounded-ds-md p-3 text-center"
              style={{
                background: "hsl(var(--bark) / 0.08)",
                border: "0.5px solid hsl(var(--bark) / 0.2)",
              }}
            >
              <ShieldCheck
                className="w-5 h-5 mx-auto mb-1"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={2}
              />
              <p
                className="font-display italic font-semibold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {(job.credential_tier ?? 0) === 1
                  ? "ID verification required"
                  : (job.credential_tier ?? 0) === 2
                    ? "Licensed pros only"
                    : "Licensed & insured required"}
              </p>
              <p
                className="font-serif italic text-ds-12 mt-0.5"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Get verified to apply for this job
              </p>
              <button
                className="mt-2 text-ds-12 font-sans font-semibold underline underline-offset-2 active:opacity-70 transition-opacity"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                onClick={() => { navigate("/profile"); onClose(); }}
              >
                Get verified →
              </button>
            </div>
          ) : (
            <Button
              size="lg"
              onClick={() => { onApply(job.id); onClose(); }}
              className="btn-liquid-fill flex-1 min-w-0 rounded-ds-md h-11 sm:h-12 px-3 group relative overflow-hidden"
              style={{
                // Two-stop bark gradient under the glass surface — subtle
                // top-light to bottom-deep wash so the button doesn't read flat.
                background:
                  "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.86) 100%)",
                border: "0.5px solid hsl(var(--bark))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.01em",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.25), " +
                  "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.18), " +
                  "0 1px 2px hsl(var(--olivewood) / 0.12), " +
                  "0 8px 22px -6px hsl(var(--bark) / 0.45)",
              }}
            >
              <span
                className="relative z-10 inline-flex items-center justify-center gap-2 min-w-0"
                style={{
                  color: "white",
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.28)",
                }}
              >
                <span className="truncate">{job.instant_book ? "Book now" : "Apply"}</span>
                <ChevronRight
                  className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
                  strokeWidth={2.5}
                />
              </span>
            </Button>
          )}
        </div>
        )}

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
