import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPin, Calendar, DollarSign, Clock, Flag, Users, Repeat, Timer, Bookmark, MessageSquare, ChevronDown, Rocket, Zap, ChevronRight,
} from "lucide-react";
import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { getCityState } from "@/lib/locationUtils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { parseLocalDate } from "@/lib/dateUtils";
import { haversineMiles } from "@/lib/geo";
import { getParishCentroid } from "@/lib/parishCentroids";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import type { EnrichedJob } from "./types";
import { JobPosterCard } from "./JobPosterCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";

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
}

const JobDetailDialog = ({
  job, effectiveFee, allJobs: _allJobs, isSaved, onToggleSave, userLat, userLng, onClose, onApply, onReport, onSelect: _onSelect,
}: JobDetailDialogProps) => {
  const navigate = useNavigate();
  const [payoutExpanded, setPayoutExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [applicationCount, setApplicationCount] = useState<number | null>(null);
  // Repeat-customer count — number of completed jobs between this
  // helper and this poster. Drives the "Worked with you N times"
  // badge that surfaces emotional re-booking trust.
  const [repeatJobs, setRepeatJobs] = useState<number>(0);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Reset transient state when the dialog switches to a new job.
  useEffect(() => {
    setLightboxIndex(null);
    setApplicationCount(null);
    setDescExpanded(false);
    setPayoutExpanded(false);
  }, [job?.id]);

  // Fetch how many helprs have already applied — gives the helpr context
  // about competition/freshness before they commit.
  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id)
      .then(({ count }) => { if (!cancelled) setApplicationCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [job?.id]);

  // Fetch how many completed jobs the current helper has done for this
  // poster. Drives the repeat-customer badge in the poster card —
  // emotional rebooking signal when the relationship has history.
  useEffect(() => {
    if (!job?.customer_id) {
      setRepeatJobs(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const helperId = userRes?.user?.id;
      if (!helperId || cancelled) return;
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", job.customer_id)
        .eq("helper_id", helperId)
        .eq("status", "completed");
      if (!cancelled) setRepeatJobs(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [job?.customer_id]);

  if (!job) return null;

  const photos = job.photos || [];
  const catStyle = categoryColors[job.category] || categoryColors.other;

  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelper = job.budget / helpers;
  const commissionPercent = job.helper_fee_percent ?? effectiveFee;
  const commission = (perHelper * commissionPercent) / 100;
  const payout = perHelper - commission + (job.urgent_fee ?? 0);

  const handleAskQuestion = () => {
    navigate(`/messages?userId=${job.customer_id}&jobId=${job.id}`);
    onClose();
  };

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent
        className="sm:max-w-lg !gap-2"
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
                className="urgent-pulse absolute -top-2 -left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[9px] font-bold uppercase tracking-wider"
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
              <OptimizedImage src={photos[0]} width={512} height={288} alt="Cover" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
              {photos.length > 1 && (
                <span
                  className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold"
                  style={{
                    backgroundColor: "hsla(0, 0%, 100%, 0.85)",
                    backdropFilter: "blur(12px) saturate(150%)",
                    WebkitBackdropFilter: "blur(12px) saturate(150%)",
                    color: "hsl(var(--ink-deep))",
                    border: "0.5px solid hsla(0, 0%, 100%, 0.6)",
                    boxShadow: "0 1px 4px hsl(var(--bark) / 0.18)",
                  }}
                >
                  +{photos.length - 1} more
                </span>
              )}
            </button>
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
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/40 text-foreground/80 text-ds-10 font-semibold uppercase tracking-wider border border-border/60">
                <Repeat className="w-3 h-3" strokeWidth={2.25} />
                {job.recurrence_interval || "Recurring"}
              </span>
            )}
          </div>
        )}

        {/* Description — own glass plate. When there's no photo, this
            is where Boosted (top-right) and Urgent (top-left) stamps
            live. "Read more" expands the full text inline when long. */}
        <div className="relative">
          {photos.length === 0 && job.is_urgent && (
            <span
              aria-label="Urgent"
              className="urgent-pulse absolute -top-2 -left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[9px] font-bold uppercase tracking-wider"
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
              backgroundColor: "hsla(0, 0%, 100%, 0.45)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              border: "0.5px solid hsla(0, 0%, 100%, 0.5)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05)",
            }}
          >
            <p
              className={`font-serif text-[0.95rem] leading-relaxed ${descExpanded ? "" : "line-clamp-3"}`}
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(() => {
            const dateNeeded = parseLocalDate(job.date_needed);
            const dateStartIso = dateNeeded.toISOString().slice(0, 10).replace(/-/g, "");
            const dateEnd = new Date(dateNeeded.getTime() + (job.estimated_hours ? Number(job.estimated_hours) * 3600 * 1000 : 24 * 3600 * 1000));
            const dateEndIso = dateEnd.toISOString().slice(0, 10).replace(/-/g, "");
            const calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(job.title)}&dates=${dateStartIso}/${dateEndIso}&details=${encodeURIComponent(job.description.slice(0, 200))}&location=${encodeURIComponent(job.location)}`;
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`;
            // Distance estimate when both helpr coords + parish centroid available
            const parishCentroid = getParishCentroid(job.parish);
            const distMiles = userLat != null && userLng != null && parishCentroid
              ? haversineMiles(userLat, userLng, parishCentroid.lat, parishCentroid.lng)
              : null;
            const distLabel = distMiles != null
              ? distMiles < 1 ? "less than 1 mi" : `~${Math.round(distMiles)} mi away`
              : null;
            // Closes urgency: <24h to expiry → render in Sienna with subtle pulse
            const hoursLeft = job.expires_at
              ? differenceInHours(new Date(job.expires_at), new Date())
              : null;
            const closesUrgent = hoursLeft != null && hoursLeft >= 0 && hoursLeft < 24;
            const tiles = [
              { Icon: MapPin, label: "Where", value: getCityState(job.location).replace(/,\s*LA\s*$/i, ""), sub: distLabel, href: mapsUrl, urgent: false },
              {
                Icon: Calendar,
                label: "Date",
                value: dateNeeded.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                sub: job.start_time || null,
                href: calendarUrl,
                urgent: false,
              },
              {
                Icon: Clock,
                label: "Estimated",
                value: job.estimated_hours != null
                  ? `${job.estimated_hours}${Number(job.estimated_hours) === 1 ? "hr" : "hrs"}`
                  : "—",
                sub: null,
                href: null,
                urgent: false,
              },
              {
                Icon: Timer,
                label: "Closes",
                value: job.expires_at ? formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) : "—",
                sub: null,
                href: null,
                urgent: closesUrgent,
              },
            ];
            return tiles.map(({ Icon, label, value, sub, href, urgent }) => {
              const Wrapper: any = href ? "a" : "div";
              const wrapperProps: any = href
                ? { href, target: "_blank", rel: "noopener noreferrer" }
                : {};
              return (
                <Wrapper
                  key={label}
                  {...wrapperProps}
                  className={`relative rounded-ds-md p-2.5 overflow-hidden ${href ? "transition-shadow hover:shadow-md cursor-pointer" : ""} ${urgent ? "urgent-pulse" : ""}`}
                  style={{
                    backgroundColor: urgent ? "hsl(var(--accent) / 0.10)" : "hsla(0, 0%, 100%, 0.45)",
                    backdropFilter: "blur(18px) saturate(160%)",
                    WebkitBackdropFilter: "blur(18px) saturate(160%)",
                    border: urgent
                      ? "0.5px solid hsl(var(--accent) / 0.45)"
                      : "0.5px solid hsla(0, 0%, 100%, 0.5)",
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
                        color: urgent ? "hsl(var(--accent))" : "hsl(var(--olivewood) / 0.65)",
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
                      <p className="font-serif italic text-ds-11 truncate text-center mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                        {sub}
                      </p>
                    )}
                  </div>
                </Wrapper>
              );
            });
          })()}
        </div>

        {/* Payout — featured pill, tap anywhere to expand the breakdown. */}
        <div className="relative">
        <button
          type="button"
          onClick={() => setPayoutExpanded((v) => !v)}
          aria-expanded={payoutExpanded}
          className="w-full text-left rounded-ds-md p-3 transition-shadow hover:shadow-lg relative overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
              "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
            backdropFilter: "blur(20px) saturate(170%)",
            WebkitBackdropFilter: "blur(20px) saturate(170%)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            // Stack: bright top rim (highlight catch), inset bottom seat,
            // gold-warm hairline glow, soft amber drop. Reads as "this is
            // a physical surface, not a flat panel."
            boxShadow:
              "inset 0 1.5px 0 0 hsla(0, 0%, 100%, 0.95), " +
              "inset 0 1px 2px 0 rgba(255, 255, 255, 0.6), " +
              "inset 0 -1px 2px 0 hsl(var(--bark) / 0.12), " +
              "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 8px 18px -5px hsl(var(--bark) / 0.26)",
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p
                className="text-[0.6rem] font-serif italic uppercase tracking-[0.18em] flex items-center gap-1"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
              >
                <DollarSign className="w-3 h-3" /> You earn
              </p>
              <p
                className="font-display font-bold tabular-nums leading-none mt-1"
                style={{
                  fontSize: "1.5rem",
                  color: "hsl(var(--bark))",
                  letterSpacing: "-0.02em",
                }}
              >
                ${payout.toFixed(2)}
              </p>
              {/* Always-visible micro-breakdown so helpers see the math
                  without needing to tap-expand. Full breakdown still
                  available below on expand. */}
              <p className="font-sans tabular-nums text-ds-10 tracking-[0.02em] mt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                ${job.budget.toFixed(0)} budget − {commissionPercent}% fee
                {(job.urgent_fee ?? 0) > 0 ? ` + $${Number(job.urgent_fee).toFixed(0)} urgent` : ""}
              </p>
            </div>
            <ChevronDown
              className={`shrink-0 w-4 h-4 transition-transform ${payoutExpanded ? "rotate-180" : ""}`}
              style={{ color: "hsl(var(--olivewood) / 0.6)" }}
            />
          </div>
          {payoutExpanded && (
            <div
              className="mt-2 pt-2 space-y-0.5 text-ds-11 font-serif italic"
              style={{ color: "hsl(var(--olivewood) / 0.85)", borderTop: "0.5px solid hsl(var(--bark) / 0.18)" }}
            >
              <div className="flex justify-between">
                <span>Budget</span>
                <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${job.budget.toFixed(2)}</span>
              </div>
              {helpers > 1 && (
                <div className="flex justify-between">
                  <span>÷ {helpers} helprs</span>
                  <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${perHelper.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>− {commissionPercent}% platform fee</span>
                <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${commission.toFixed(2)}</span>
              </div>
              {(job.urgent_fee ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span>+ urgent bonus</span>
                  <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>+${Number(job.urgent_fee).toFixed(2)}</span>
                </div>
              )}
              <div
                className="flex justify-between pt-1 mt-1 font-display not-italic font-bold"
                style={{ color: "hsl(var(--ink-deep))", borderTop: "0.5px dashed hsl(var(--bark) / 0.18)" }}
              >
                <span>Take-home</span>
                <span className="tabular-nums">${payout.toFixed(2)}</span>
              </div>
            </div>
          )}
        </button>
        </div>

        <JobPosterCard job={job} repeatJobs={repeatJobs} />

        {/* Applicant queue + Apply social proof — surfaces "X helpers
            already applied — you'd be #(X+1) in line" only when there
            are existing applicants, so it functions as light urgency
            without crying wolf on fresh posts. */}
        {applicationCount !== null && applicationCount > 0 && (
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
            so they feel tactile rather than static. */}
        <div className="flex gap-1.5 pt-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Report this job"
            className="group rounded-ds-md h-11 w-11 sm:h-12 sm:w-12 shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
            onClick={() => { onReport(job.id); onClose(); }}
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.32)",
              backdropFilter: "blur(20px) saturate(150%)",
              WebkitBackdropFilter: "blur(20px) saturate(150%)",
              border: "0.5px solid hsla(0, 0%, 100%, 0.4)",
              color: "hsl(var(--olivewood) / 0.6)",
              boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04), 0 0 0 0 hsl(var(--burnt-sienna) / 0.0)",
              transition: "all 0.2s ease, box-shadow 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--burnt-sienna) / 0.20), 0 0 0 3px hsl(var(--burnt-sienna) / 0.08)";
              e.currentTarget.style.color = "hsl(var(--burnt-sienna) / 0.85)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04), 0 0 0 0 hsl(var(--burnt-sienna) / 0.0)";
              e.currentTarget.style.color = "hsl(var(--olivewood) / 0.6)";
            }}
          >
            {/* Flag waves on hover — subtle counter-clockwise tilt */}
            <Flag className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-12 group-active:rotate-0" />
          </Button>
          {onToggleSave && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={isSaved ? "Unsave job" : "Save job"}
              className="group rounded-ds-md h-11 w-11 sm:h-12 sm:w-12 shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
              onClick={() => onToggleSave(job.id, !isSaved)}
              style={{
                backgroundColor: isSaved ? "hsl(var(--primary) / 0.12)" : "hsla(0, 0%, 100%, 0.32)",
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                border: isSaved ? "0.5px solid hsl(var(--primary) / 0.4)" : "0.5px solid hsla(0, 0%, 100%, 0.4)",
                color: isSaved ? "hsl(var(--primary))" : "hsl(var(--olivewood) / 0.6)",
                boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)",
                transition: "all 0.2s ease, box-shadow 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--primary) / 0.22), 0 0 0 3px hsl(var(--primary) / 0.10)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)";
              }}
            >
              {/* Bookmark lifts on hover, pops on toggle */}
              <Bookmark
                className={`w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 ${isSaved ? "fill-primary bookmark-pop" : ""}`}
                key={String(isSaved)}
                strokeWidth={2}
              />
            </Button>
          )}
          {/* Share — helpers occasionally want to forward a great job
              to another helper. Matches the icon-row sizing of its
              neighbours (Flag · Save · Message). */}
          <ShareJobButton
            variant="icon"
            job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
            ariaLabel="Share this job with another helpr"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ask a question"
            className="group rounded-ds-md h-11 w-11 sm:h-12 sm:w-12 shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
            onClick={handleAskQuestion}
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.32)",
              backdropFilter: "blur(20px) saturate(150%)",
              WebkitBackdropFilter: "blur(20px) saturate(150%)",
              border: "0.5px solid hsla(0, 0%, 100%, 0.4)",
              color: "hsl(var(--olivewood) / 0.6)",
              boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)",
              transition: "all 0.2s ease, box-shadow 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--bark) / 0.22), 0 0 0 3px hsl(var(--bark) / 0.08)";
              e.currentTarget.style.color = "hsl(var(--bark))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)";
              e.currentTarget.style.color = "hsl(var(--olivewood) / 0.6)";
            }}
          >
            {/* Message glides forward on hover — like sending */}
            <MessageSquare className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Button>
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
              <span className="truncate">Apply</span>
              <span
                className="font-display italic font-bold tabular-nums shrink-0"
                style={{ fontSize: "0.95rem", letterSpacing: "-0.01em" }}
              >
                · earn ${payout.toFixed(0)}
              </span>
              <ChevronRight
                className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
                strokeWidth={2.5}
              />
            </span>
          </Button>
        </div>

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
