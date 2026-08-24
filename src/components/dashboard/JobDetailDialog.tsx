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
    // No onClose() — the route change unmounts this dialog on its own, and
    // calling it here raced the navigation: the feed's close handler clears
    // ?job= with setSearchParams(..., { replace: true }), which acts on the
    // CURRENT location and so replaced the entry we had just pushed.
    navigate(`/messages?userId=${job.customer_id}&jobId=${job.id}`);
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
        // PHONE = BOTTOM SHEET, sm+ = the usual centred dialog.
        //
        // As a centred card this used ~58% of a 402x874 screen with ~21% dead
        // scrim above AND below it — a job preview, the densest read in the
        // app, boxed into the middle half of the phone while the thumb sat
        // over empty backdrop. Anchoring it to the bottom is the standard iOS
        // presentation for exactly this (a detail sheet over a list), gives
        // the content ~92dvh instead of 88% of a shrunken box, and puts the
        // "Sign up to apply" CTA in the thumb arc rather than mid-screen.
        //
        // The overrides come in three parts because the base DialogContent is
        // centred by transform, not by inset:
        //   1. geometry — top-auto/bottom-0 + zeroed translate, full width,
        //      square bottom corners (28px top only, from .glass-modal).
        //   2. animation — the base sets --tw-enter-translate-x:-50% via
        //      `slide-in-from-left-1/2` to compensate for its own centering
        //      transform. With the transform gone that would fly the sheet in
        //      from off-screen left, so it is neutralised to -0 and the sheet
        //      rises from the bottom instead. zoom is dropped to 100 — a
        //      bottom sheet slides, it does not scale.
        //   3. sm: — every one of the above is restored so tablet/desktop
        //      render EXACTLY as before. This is a phone-only presentation.
        // tailwind-merge resolves each against the base class in the same
        // group, so ordering here is the whole mechanism.
        className={[
          "grid-cols-1",
          // 1. phone geometry
          "left-0 top-auto bottom-0 translate-x-0 translate-y-0",
          "w-full max-w-none max-h-[92dvh] rounded-b-none rounded-t-[28px]",
          // 2. phone animation
          "data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-bottom-full data-[state=open]:zoom-in-100",
          "data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-bottom-full data-[state=closed]:zoom-out-100",
          // 3. sm+ restores DialogContent's OWN geometry — top-anchored at 7vh,
          //    not the vertically-centred dialog this used to rebuild.
          //
          //    It restored `top-[50%] translate-y-[-50%]` verbatim, which is
          //    the arrangement DialogContent moved away from: a vertically
          //    centred box RE-CENTRES as its content arrives, so the panel
          //    opens small and then grows in both directions while you are
          //    reading it (owner: "opens small then gets bigger?"). Every
          //    other dialog in the app was fixed by anchoring the top edge;
          //    this one — the job detail, the most-opened modal here — kept
          //    rebuilding the old behaviour inside its phone-sheet override
          //    and so kept jumping.
          //
          //    `max-h` matches the global 86vh for the same reason: two
          //    ceilings 2dvh apart on one component is a difference nobody
          //    chose.
          "sm:left-[50%] sm:top-[7vh] sm:bottom-auto sm:translate-x-[-50%] sm:translate-y-0",
          "sm:w-[calc(100%-2rem)] sm:max-w-lg sm:max-h-[86vh] sm:rounded-t-[28px] sm:rounded-b-[28px]",
          "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-4 sm:data-[state=open]:zoom-in-95",
          "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-4 sm:data-[state=closed]:zoom-out-95",
          // Home-indicator clearance. The sheet is flush to the bottom edge,
          // so without this the footer CTA sits under the indicator on every
          // modern iPhone. sm+ is a floating card again and returns to the
          // base p-7 padding.
          "pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-7",
          /* CAPPED AT THE READING COLUMN (owner). `xl:max-w-6xl` opened this
             at 1152px — half again as wide as `max-w-3xl`, the column every
             page behind it uses — for a job that is usually a title, three
             meta chips and a paragraph. It read as a modal dwarfing the page
             rather than sitting over it. 3xl matches the page; phone sheet and
             tablet are untouched, this only changes 1024px and up. */
          "lg:max-w-3xl",
        ].join(" ")}

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
        {/* Category chip, then the canonical popup title (DialogHero).
            The chip is rendered HERE rather than passed to DialogHero as an
            `eyebrow`: DialogHero accepts that prop but deliberately does not
            render it (the 2026-07-25 "one main title" decision), so the
            category this dialog used to pass was silently discarded. The
            browse card leads with the category — it is the first thing a
            helpr filters on — and opening the job dropped it entirely. Same
            dot + icon + label treatment as the feed card so the two read as
            the same object. */}
        <div className="flex items-center gap-1.5 pr-10">
          {/* THE SAME CHIP the feed card and the map popup wear (owner: "should
              be in top left like the job card"). It used to be a bespoke
              treatment here — a coloured dot in a circle plus burnt-sienna
              serif caps — so the one object had three appearances across the
              three surfaces it shows up on, two of which sit side by side on
              the desktop website. Now it is `catStyle.badge` + CategoryIcon +
              the serif-italic label, verbatim, and a change to the category
              palette moves all three together. */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-ds-sm border text-ds-10 font-semibold leading-none ${catStyle.badge}`}
          >
            <CategoryIcon
              category={job.category}
              aria-hidden
              className="w-2.5 h-2.5 shrink-0"
              strokeWidth={2.25}
            />
            <span className="font-serif italic">
              {categoryLabels[job.category] || job.category}
            </span>
          </span>
        </div>
        <DialogHero title={job.title} />

        {/* One column at every width. This used to become a 7/5 split-pane
            at xl — sized for the era when the dialog opened at xl:max-w-6xl
            (1152px). The owner capped the dialog to the 3xl reading column,
            and the split inside 768px crushed the footer CTA to "Ap…" and
            left the description column ending in dead space (owner
            screenshot, 2026-08-24). The wrappers stay (`contents`) so the
            source order and stat-tile grouping are untouched. */}
        <div className="contents">
        <div className="contents min-w-0">
        {/* Photo cover wrapped so Boosted (top-right) and Urgent
            (top-left) can stamp the corners without being clipped by
            the photo's overflow-hidden. */}
        {photos.length > 0 && (
          <div className="relative">
            {job.is_urgent && (
              <span
                aria-label="Urgent"
                className="urgent-pulse absolute -top-2 -left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-ds-9 font-bold uppercase tracking-wider"
                style={{ border: "0.5px solid hsl(var(--accent) / 0.5)" }}
              >
                <Zap className="w-2.5 h-2.5 text-accent fill-accent" /> Urgent
              </span>
            )}
            {job.isBoosted && (
              <span
                aria-label="Boosted"
                className="boosted-shimmer boosted-pulse absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-9 font-bold uppercase tracking-wider"
                style={{
                  color: "hsl(var(--amber-ink))",
                  border: "0.5px solid hsl(var(--boost-tint) / 0.6)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "inset 0 -1px 1px 0 hsl(var(--boost-tint) / 0.20), " +
                    "0 1px 2px hsl(var(--boost-tint) / 0.20), " +
                    "0 4px 10px -3px hsl(var(--boost-tint) / 0.34)",
                }}
              >
                <Rocket
                  className="w-2.5 h-2.5"
                  strokeWidth={2.25}
                  style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }}
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
                View All
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
              className="boosted-shimmer boosted-pulse absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-9 font-bold uppercase tracking-wider"
              style={{
                color: "hsl(var(--amber-ink))",
                border: "0.5px solid hsl(var(--boost-tint) / 0.6)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                  "inset 0 -1px 1px 0 hsl(var(--boost-tint) / 0.20), " +
                  "0 1px 2px hsl(var(--boost-tint) / 0.20), " +
                  "0 4px 10px -3px hsl(var(--boost-tint) / 0.34)",
              }}
            >
              <Rocket className="w-2.5 h-2.5" strokeWidth={2.25} style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }} />
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
              className={`font-serif text-ds-15 leading-relaxed break-words min-w-0 ${!descExpanded && (job.description?.length ?? 0) > 180 ? "line-clamp-3" : ""}`}
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
                {descExpanded ? "Show Less" : "Read More"}
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
        <div className="contents min-w-0">
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
          />
        </div>

        {/* Poster card is AUTHED-ONLY (owner decision 2026-08-22: "guest page
            should not have who posted the job").

            It used to render for guests as social proof, but on the logged-out
            preview it is the weakest tile on the screen and the most costly:
            its two differentiating signals (repeat-customer count, poster
            cancellation rate) are authed-only and silently collapse to their
            guest defaults, so a guest saw a name and an avatar and nothing
            that helps them judge the job. Worse, the tile is a link to
            /user/:id — a ProtectedRoute — so the one tappable thing in it
            bounced a guest to /login mid-preview. The guest dialog now stays
            about the JOB; identity is something you get after signing up. */}
        {!guest && (
          <JobPosterCard job={job} repeatJobs={repeatJobs} cancellationRate={posterCancelRate} guest={guest} />
        )}

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
