import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import {
  Users, Repeat, Rocket, Zap,
} from "lucide-react";
import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { OptimizedImage } from "@/components/ui/optimized-image";
import type { EnrichedJob } from "./types";
import { JobPosterCard } from "./JobPosterCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { JobPrice } from "./JobPrice";
import { useJobDetailData } from "./jobDetailDialog/useJobDetailData";
import { JobStatTiles } from "./jobDetailDialog/JobStatTiles";
import { ApplicantQueueBanner } from "./jobDetailDialog/ApplicantQueueBanner";
import { JobDetailFooter } from "./jobDetailDialog/JobDetailFooter";

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
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const {
    descExpanded, setDescExpanded,
    lightboxIndex, setLightboxIndex,
    gridOpenNonce, setGridOpenNonce,
    applicationCount,
    viewerAppPosition,
    viewerUserId,
    repeatJobs,
    posterCancelRate,
    viewerSubscriptionTier,
    viewerTier,
    distMilesForDriving,
    drivingLabel,
  } = useJobDetailData({ job, guest, userLat, userLng });

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
        //
        // xl+ bumps to max-w-6xl so the two-column split-pane layout below
        // has breathing room (left 7/12 job content, right 5/12 sticky
        // apply pane). Below xl the dialog keeps its single-column stack.
        className="grid-cols-1 sm:max-w-lg lg:max-w-3xl xl:max-w-6xl !gap-2"
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
        {/* Canonical popup header (DialogHero). The category dot keeps its
            category color; the eyebrow text stays the canonical burnt-sienna,
            so this job dialog reads as a sibling of every other popup. */}
        <DialogHero
          eyebrowClassName="flex items-center gap-1.5"
          eyebrow={
            <>
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
            </>
          }
          title={job.title}
        />

        {/* Split-pane wrapper. Below xl this is a no-op flex column
            (contents flow like they used to). At xl+ it's a 12-col grid:
            the left column carries the job content (photo, pills, video,
            description, stat tiles); the right column stickies the
            actionable content (payout, poster card, queue banner, footer).
            xl:items-start is required for the sticky right column to work
            — a stretch align would size both columns to the tallest and
            the right column would never scroll past its own height. */}
        <div className="contents xl:grid xl:grid-cols-12 xl:gap-6 xl:items-start">
        <div className="contents xl:col-span-7 xl:flex xl:flex-col xl:gap-2 min-w-0">
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
                  color: "hsl(var(--amber-ink))",
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

        {/* Status pills — urgent · group size · recurrence — in one
            aligned flex row so the signals read as a single set instead
            of stacking unevenly. Urgent only joins this row when there's
            no photo; with a photo it overlays the image up top instead. */}
        {((job.is_urgent && photos.length === 0) || job.is_group_job || job.is_recurring) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {job.is_urgent && photos.length === 0 && (
              <span
                aria-label="Urgent"
                className="urgent-pulse inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-ds-10 font-semibold uppercase tracking-wider"
                style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
              >
                <Zap className="w-3 h-3 fill-accent" strokeWidth={2.25} />
                Urgent
              </span>
            )}
            {job.is_group_job && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-ds-10 font-semibold uppercase tracking-wider border border-primary/20">
                <Users className="w-3 h-3" strokeWidth={2.25} />
                {job.helpers_needed ?? 2} Helprs needed
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

        {/* Description — own glass plate. When there's no photo, the
            Boosted (top-right) stamp lives here; Urgent has moved up into
            the status-pill row. "Read more" expands the text inline. */}
        {/* min-w-0: as a grid item of the DialogContent grid this defaults
            to min-width:auto, so a long unbroken word would force the item
            wider than the track and the line-clamp box would clip the
            overflow. min-w-0 lets it shrink to the track and wrap. */}
        <div className="relative min-w-0">
          {photos.length === 0 && job.isBoosted && (
            <span
              aria-label="Boosted"
              className="boosted-shimmer boosted-pulse absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
              style={{
                color: "hsl(var(--amber-ink))",
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

        <JobStatTiles job={job} distMilesForDriving={distMilesForDriving} drivingLabel={drivingLabel} />
        </div>
        {/* Right column — the "act on this job" pane. Sticky at xl+ so
            the apply/message CTAs stay pinned as the helpr scrolls a long
            description on the left. `xl:top-0` sticks to the dialog's
            internal scroll container (the DialogContent itself); the
            container has p-7 top padding, so top-0 aligns cleanly under
            the header. Below xl this div collapses via `contents` and
            each child slots back into the outer single-column grid,
            preserving the original vertical order. */}
        <div className="contents xl:col-span-5 xl:flex xl:flex-col xl:gap-2 xl:sticky xl:top-0 xl:self-start min-w-0">
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
            pricingMode={job.pricing_mode}
            showProUpsell={!viewerSubscriptionTier || viewerSubscriptionTier === "free"}
          />
        </div>

        {/* Poster card shows for guests too — the guest feed already enriches
            each job with the poster's name, avatar, rating and review count, so
            the logged-out preview carries the same social proof as the authed
            dialog. The two authed-only signals (repeat-customer count, poster
            cancellation rate) stay at their guest defaults (0 / null) and their
            lines simply hide, so the only real difference remains the footer
            CTA below. */}
        <JobPosterCard job={job} repeatJobs={repeatJobs} cancellationRate={posterCancelRate} guest={guest} />

        <ApplicantQueueBanner guest={guest} applicationCount={applicationCount} viewerAppPosition={viewerAppPosition} />

        <JobDetailFooter
          job={job}
          guest={guest}
          isSaved={isSaved}
          onToggleSave={onToggleSave}
          onClose={onClose}
          onApply={onApply}
          onReport={onReport}
          navigate={navigate}
          viewerUserId={viewerUserId}
          viewerAppPosition={viewerAppPosition}
          viewerTier={viewerTier}
          onAskQuestion={handleAskQuestion}
        />
        </div>
        </div>

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
