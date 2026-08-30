import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import {
  Repeat, Rocket, Zap, Bookmark, Flag, Star,
} from "lucide-react";
import { categoryLabels, categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { getCity } from "@/lib/locationUtils";
import { IconActionButton } from "./IconActionButton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
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
  /** Returning `false` means the request was refused (offline, signed out,
   *  your own post) — the sheet then stays on the detail step. */
  onApply: (jobId: string) => void | boolean | Promise<void | boolean>;
  onReport: (jobId: string) => void;
  /** Switching the dialog from one job to another (swipe gesture or similar-job tap). */
  onSelect?: (job: EnrichedJob) => void;
  /** Logged-out preview: render the public job info read-only and replace
      every action (apply/message/save/report) with a single sign-up CTA.
      The poster card, applicant banners, and authed look-ups are skipped —
      a guest only has the masked public RPC fields. */
  guest?: boolean;
  /** Renders the APPLY STEP inside this same sheet.
   *
   *  When supplied, tapping Apply Now no longer closes the sheet and hands off
   *  to a separate centred modal — it swaps this sheet's body in place, so the
   *  whole apply flow happens on one surface anchored to one edge (owner,
   *  2026-08-28: "I don't like how one opens at the bottom then the next is in
   *  the middle"). Only the feed passes it; the guest surfaces (Jobs,
   *  JobDetail, DashboardGuest) have no apply flow to render and keep the old
   *  behaviour, where the footer's guest branch navigates to signup itself. */
  applyStep?: (ctx: { onBack: () => void }) => ReactNode;
}

const JobDetailDialog = ({
  job, effectiveFee, allJobs: _allJobs, isSaved, onToggleSave, userLat, userLng, onClose, onApply, onReport, onSelect: _onSelect, guest = false, applyStep,
}: JobDetailDialogProps) => {
  const navigate = useNavigate();
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  /* Which half of the sheet is showing. The apply UI used to be a separate
     centred AlertDialog that opened AFTER this one closed; it is a step of
     this same surface now. */
  const [step, setStep] = useState<"detail" | "apply">("detail");
  const jobId = job?.id ?? null;
  // Back to the detail step whenever the sheet closes or swaps to another job
  // — otherwise reopening the sheet, or swiping to the next job, would land
  // straight on the apply form for a job the helpr has not read yet.
  useEffect(() => { setStep("detail"); }, [jobId]);

  const {
    descExpanded, setDescExpanded,
    lightboxIndex, setLightboxIndex,
    gridOpenNonce, setGridOpenNonce,
    applicationCount,
    viewerAppPosition,
    viewerUserId,
    repeatJobs,
    posterCancelRate,
    viewerTier,
    distMilesForDriving,
    drivingLabel,
  } = useJobDetailData({ job, guest, userLat, userLng });

  if (!job) return null;

  const photos = job.photos || [];
  const catStyle = categoryColors[job.category] || categoryColors.other;
  // Mirrors JobCard's `recommended={i === 0}` — that prop is purely
  // positional (the first card of whatever list is currently showing), not
  // a field on the job row, so the dialog derives the same thing from the
  // same list it already gets for swipe navigation (owner: "if a job is
  // recommended it should carry over" into this dialog too).
  const isRecommended = !!_allJobs && _allJobs[0]?.id === job.id;

  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  // Viewer fee only — the same resolver the Browse card and apply sheet use.
  // (The browse feed's open_jobs_browse select doesn't expose
  // helper_fee_percent, so a `job.helper_fee_percent ?? …` fallback here was
  // dead code that merely LOOKED like a different fee rule.)
  const commissionPercent = effectiveFee;

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
        {/* Corner actions — Save · Share · Report, parked beside the
            dialog's own X so the footer can be a single full-width Apply
            (owner, 2026-08-30: "this with the x"). Absolutely positioned
            against the DialogContent's padding box, mirroring the X's
            own `right-3 top-3`, and offset left of it by one 44px slot
            each. Guests get none of them: all three need an account, and
            the guest footer already carries its one sign-up CTA. */}
        {!guest && (
          <div className="absolute right-[2.875rem] top-3 z-10 flex items-center gap-0.5">
            {/* Share leftmost (owner: "share on the left") — Bookmark then
                Flag follow. `compact` (32px, not the usual 44px) so the row
                needs less clearance above the title (owner: 44px icons
                "made a large gap above title") — the X button itself is
                separate shared chrome and stays its usual size. */}
            {viewerUserId !== job.customer_id && (
              <ShareJobButton
                variant="icon"
                bare
                compact
                job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: getCity(job.location).replace(/,\s*LA\s*$/i, "") }}
                ariaLabel="Share this job"
              />
            )}
            {onToggleSave && (
              <IconActionButton
                ariaLabel={isSaved ? "Unsave job" : "Save job"}
                ariaPressed={isSaved}
                onClick={() => onToggleSave(job.id, !isSaved)}
                pressed={isSaved}
                pressedBackground="hsl(var(--primary) / 0.12)"
                pressedBorder="0.5px solid hsl(var(--primary) / 0.4)"
                pressedColor="hsl(var(--primary))"
                bare
                compact
                icon={
                  <Bookmark
                    className={`w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 ${isSaved ? "fill-primary bookmark-pop" : ""}`}
                    key={String(isSaved)}
                    strokeWidth={2}
                  />
                }
              />
            )}
            <IconActionButton
              ariaLabel="Report this job"
              onClick={() => { onReport(job.id); onClose(); }}
              bare
              compact
              icon={
                <Flag className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-12 group-active:rotate-0" />
              }
            />
          </div>
        )}
        {/* Category — top-LEFT corner tab, flush on the card's own edge,
            plus the rail stripe down the left side (owner, via pop-up
            question, 2026-08-30: "category top left ... add the category
            stripe back to the left side").
            data-frame-chrome: these elements deliberately bleed into the
            dialog's padding gutter (absolute left-0 relative to the fixed
            DialogContent, not the p-5 content box) to achieve the flush-edge
            design — the apply-dialog-fit e2e excludes them from its content-
            overflow check on that basis. */}
        <span
          aria-hidden
          data-frame-chrome="true"
          className={`absolute left-0 top-0 bottom-0 w-1.5 z-10 rounded-tl-lg rounded-bl-lg ${catStyle.dot}`}
        />
        <div data-frame-chrome="true" className="absolute top-0 left-0 z-20 flex items-stretch">
          <span
            className={`inline-flex items-center gap-1.5 pl-4 pr-3.5 py-2 rounded-tl-lg text-ds-15 font-semibold leading-none shadow-sm border-b border-r ${!isRecommended && !job.is_urgent && !job.isBoosted ? "rounded-br-lg" : ""} ${catStyle.badge}`}
          >
            <CategoryIcon
              category={job.category}
              aria-hidden
              className="w-3.5 h-3.5 shrink-0"
              strokeWidth={2.25}
            />
            <span className="font-serif italic">
              {categoryLabels[job.category] || job.category}
            </span>
          </span>
          {/* Recommended — right of category, before Urgent/Boosted (owner:
              "if a job is recommended it should carry over on the right of
              the category before urgent/boosted"). Same tab styling as
              JobCard's own Recommended chip. */}
          {isRecommended && (
            <span
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-ds-15 font-semibold leading-none shadow-sm border-b ${!job.is_urgent && !job.isBoosted ? "rounded-br-lg" : ""}`}
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                color: "hsl(var(--burnt-sienna))",
                borderColor: "hsl(var(--burnt-sienna) / 0.20)",
              }}
            >
              <Star className="w-3.5 h-3.5 shrink-0" strokeWidth={2} style={{ fill: "hsl(var(--burnt-sienna) / 0.3)" }} />
              Recommended
            </span>
          )}
          {/* Urgent/Boosted — right of category, same top-left cluster
              (owner: "move to right of category"). */}
          {job.is_urgent && (
            <span
              aria-label="Urgent"
              className={`urgent-pulse inline-flex items-center gap-1.5 px-3.5 py-2 text-ds-14 font-bold uppercase leading-none shadow-sm border-b ${!job.isBoosted ? "rounded-br-lg" : ""}`}
              style={{
                color: "hsl(var(--accent))",
                background: "hsl(var(--accent) / 0.15)",
                borderColor: "hsl(var(--accent) / 0.5)",
                letterSpacing: "0.05em",
              }}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--accent))", fill: "hsl(var(--accent))" }} />
              Urgent
            </span>
          )}
          {job.isBoosted && (
            <span
              aria-label="Boosted"
              className="boosted-pulse inline-flex items-center gap-1.5 px-3.5 py-2 rounded-br-lg text-ds-14 font-bold uppercase leading-none shadow-sm border-b"
              style={{
                color: "hsl(var(--boost-ink))",
                background: "hsl(var(--boost-tint) / 0.16)",
                borderColor: "hsl(var(--boost-tint) / 0.5)",
                letterSpacing: "0.05em",
              }}
            >
              <Rocket className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }} />
              Boosted
            </span>
          )}
        </div>
        {/* Title+description share the row with price, price as a small
            pill vertically centered against BOTH lines — same layout as
            JobCard's title row (owner: "fix the layout so it's more
            similar to the job card, with money on the right of the title
            in a pill box", then "center [it] better between title and
            description"). `chip` is the exact component JobCard uses so the
            number is styled identically on both surfaces.
            `mt-1`: measured live (owner kept saying "still too much space"
            and was right — `mt-7` was tuned for the OLD 44px icon row and
            never brought down after the icons became `compact` (32px), so
            it was stacking a stale margin on top of DialogHero's own `pt-2`).
            Icon row bottom sits ~45px from the dialog's true top; normal
            flow (after the dialog's own p-7 padding) already starts around
            28px, and DialogHero's `pt-2` adds another 8px — `mt-1` is what's
            actually left to clear the icons, no more. */}
        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <DialogHero title={job.title} />
            {/* Description — always visible right under the title (owner:
                "move the description under the title, put posted by info
                there [in Details]"). It used to fold behind the Details
                toggle alongside the poster card; that toggle is gone too
                now (owner: "remove details and put posted by info here"). */}
            {job.description && (
              <div className="relative min-w-0 mt-1">
                {/* line-clamp-3 turns this <p> into a display:-webkit-box, which
                    defaults to min-width:auto and sizes to its max-content width
                    — so a normal word near the edge overflows and the box's own
                    overflow:hidden clips it mid-word instead of wrapping.
                    min-w-0 lets the box shrink to its container so text wraps,
                    and we only clamp when the text is actually long enough to
                    need it so short descriptions stay plain blocks that wrap
                    cleanly. */}
                <p
                  className={`font-serif text-ds-15 leading-relaxed break-words min-w-0 ${!descExpanded && job.description.length > 180 ? "line-clamp-3" : ""}`}
                  style={{ color: "hsl(var(--ink-deep) / 0.88)" }}
                >
                  {job.description}
                </p>
                {job.description.length > 180 && (
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
            )}
          </div>
          <div className="shrink-0">
            <JobPrice
              variant="chip"
              size="lg"
              budget={job.budget}
              effectiveFee={commissionPercent}
              urgentFee={job.urgent_fee ?? 0}
              helpersNeeded={helpers}
            />
          </div>
        </div>

        {/* One column at every width. This used to become a 7/5 split-pane
            at xl — sized for the era when the dialog opened at xl:max-w-6xl
            (1152px). The owner capped the dialog to the 3xl reading column,
            and the split inside 768px crushed the footer CTA to "Ap…" and
            left the description column ending in dead space (owner
            screenshot, 2026-08-24). The wrappers stay (`contents`) so the
            source order and stat-tile grouping are untouched. */}
        <div className="contents">
        <div className="contents min-w-0">
        {/* Photo cover. Urgent/Boosted used to stamp this photo's corners —
            they now live on the money box instead (see below), the one
            place they show up regardless of whether a photo exists. */}
        {photos.length > 0 && (
          <div className="relative">
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

        {/* Recurrence — its own row below the category/urgent/boosted line.
            Urgent/Boosted moved up into that row (owner: "move to the right
            of category"); recurrence stays separate since it isn't one of
            the pills the mockup called out. */}
        {job.is_recurring && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[hsl(var(--burnt-sienna)/0.08)] text-[hsl(var(--burnt-sienna))] text-ds-10 font-semibold uppercase tracking-wider border border-[hsl(var(--burnt-sienna)/0.2)]">
                <Repeat className="w-3 h-3" strokeWidth={2.25} />
                {/* The SHAPE, not just the word (owner, 2026-08-24: a sitter
                    deciding whether to take a series needs "Mon, Wed, Fri ×
                    6 wks", not "weekly"). Falls back to the interval word for
                    legacy rows without a day set. */}
                {(() => {
                  const days = (job as { recurrence_days?: number[] | null }).recurrence_days;
                  const weeks = (job as { recurrence_weeks?: number | null }).recurrence_weeks;
                  if (days && days.length > 0 && weeks) {
                    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                    return `${days.map((d) => names[d]).join(", ")} × ${weeks} wk${weeks === 1 ? "" : "s"}`;
                  }
                  return job.recurrence_interval || "Recurring";
                })()}
              </span>
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
        {/* Posted-by — always visible now, no toggle (owner: "remove
            details and put posted by info here"). Poster card is
            AUTHED-ONLY (owner decision 2026-08-22: "guest page should not
            have who posted the job") — a guest never sees it at all. */}
        {!guest && (
          <JobPosterCard job={job} repeatJobs={repeatJobs} cancellationRate={posterCancelRate} guest={guest} />
        )}

        <ApplicantQueueBanner guest={guest} applicationCount={applicationCount} viewerAppPosition={viewerAppPosition} />

        {/* Apply lives on THIS screen now — no second popup (owner: "they
            will apply on the screen before this", "doesn't need to be 2
            steps", "delete [the apply step]"). Tapping Apply Now used to
            swap the whole sheet to a second view with its own back button
            and a second copy of the title; it now just reveals the note +
            attachments form in place, in the same scroll, same title. The
            plain footer (Message / Apply / Applied / your-post / credential
            gate) hides once that form is up — there is nothing left for it
            to do until the helpr submits or the sheet closes. */}
        {step === "apply" && applyStep ? (
          applyStep({ onBack: () => setStep("detail") })
        ) : (
          <JobDetailFooter
            job={job}
            guest={guest}
            onApply={async (id) => {
              const accepted = await onApply(id);
              // Without an apply step (the guest surfaces) this closes as it
              // always did. With one, the form reveals in place — but only if
              // the request was actually accepted, or we would show an apply
              // form for a job the flow just refused.
              if (!applyStep) { onClose(); return; }
              if (accepted !== false) setStep("apply");
            }}
            navigate={navigate}
            viewerUserId={viewerUserId}
            viewerAppPosition={viewerAppPosition}
            viewerTier={viewerTier}
            onAskQuestion={handleAskQuestion}
          />
        )}
        </div>
        </div>

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
