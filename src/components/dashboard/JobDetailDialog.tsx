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
    viewerAppPosition,
    viewerUserId,
    repeatJobs,
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

  // Corner actions — Save · Share · Report, in the SAME row as the dialog's
  // own X (owner, 2026-08-30: "this with the x" / "not pieced together" —
  // used to be a second `absolute`-positioned div hand-offset to sit beside
  // the shared close button rather than sharing its row). Passed to
  // DialogContent's `topRightSlot` instead. Guests get none of them: all
  // three need an account, and the guest footer already carries its one
  // sign-up CTA.
  const cornerActions = !guest && (
    <>
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
    </>
  );

  /* How much of the sheet's top-right corner the icon cluster occupies, so the
     badge row below can reserve it instead of running underneath it (owner,
     2026-08-31: "Covering buttons"). DERIVED FROM THE SAME CONDITIONS as
     `cornerActions` above, deliberately — a reserve keyed on anything else
     goes stale the moment an icon is added or hidden, which is how the row
     came to depend on the badges happening to be short.
     Geometry is DialogContent's (dialog.tsx): the close X is `right-3` (12px)
     + 32px wide = 44px; when a `topRightSlot` is present its container starts
     at `right-[46px]` and is n×32px + (n−1)×2px of `gap-0.5`. Values below are
     that width + ~4px of breathing room. Tailwind needs the class as a
     literal, so these are spelled out rather than computed into a template. */
  const cornerIconCount = guest
    ? 0
    : (viewerUserId !== job.customer_id ? 1 : 0) + (onToggleSave ? 1 : 0) + 1;
  const iconLaneReserve =
    cornerIconCount >= 3
      ? "pr-[9.375rem]" // 150px — Share + Save + Report + X
      : cornerIconCount === 2
        ? "pr-[7.25rem]" // 116px — two of the three + X
        : cornerIconCount === 1
          ? "pr-[5.125rem]" // 82px — one + X
          : "pr-[3rem]"; // 48px — the shared close X on its own (guest)

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent
        topRightSlot={cornerActions}
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
        // …WHICH `max-h` ALONE NEVER DELIVERED (owner, 2026-08-31: "phone
        // should open not at the bottom"). `max-h-[92dvh]` is a CEILING, and a
        // short job never came near it: measured at 375x812, a title + one-line
        // description + three meta chips + poster row + CTA opened the sheet at
        // 397.7px — 49.0% of the viewport, i.e. a small box pinned to the
        // bottom edge under a half-screen of blurred dead band. (320: 54.9%.
        // A boosted/urgent/recommended job: 51.9%.) The fix is a FIXED height,
        // `h-[92dvh]`, so every job opens at the same generous size and the
        // sheet's proportions stop being a function of how much the poster
        // typed. Only a fixed height also makes "the CTA sits in the thumb
        // arc" true for the SHORT case, which is the case that was wrong.
        //
        // A fixed height on a `display:grid` box needs explicit tracks or the
        // default `align-content: normal` stretches every auto row to fill it,
        // which just re-distributes the dead space instead of removing it. So
        // the phone sheet declares three rows —
        //   grid-rows-[auto_minmax(0,1fr)_auto]
        //     row 1  the badge strip (flush corner tabs, see below)
        //     row 2  the scrollable body — `minmax(0,…)` + `min-h-0` on the
        //            div so it can actually SHRINK below its content and
        //            scroll internally rather than pushing row 3 off-screen
        //     row 3  the footer CTA, pinned in the thumb arc
        // — and the JSX below renders EXACTLY three in-flow children to fill
        // them (the left rail stripe is `absolute`, PhotoLightbox portals, so
        // neither takes a track). The outer box keeps the base
        // `overflow-y-auto` but can no longer scroll: rows 1+3 are ~170px of a
        // 747px sheet, so row 2 always absorbs the slack.
        //
        // The overrides come in three parts because the base DialogContent is
        // centred by transform, not by inset:
        //   1. geometry — top-auto/bottom-0 + zeroed translate, full width,
        //      FIXED 92dvh height + the three-row track, square bottom corners
        //      (28px top only, from .glass-modal).
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
          "left-0 top-auto bottom-0 translate-x-0 translate-y-0 [translate:0_0]",
          "w-full max-w-none h-[92dvh] max-h-[92dvh] rounded-b-none rounded-t-[28px]",
          "grid-rows-[auto_minmax(0,1fr)_auto]",
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
          // `sm:[translate:-50%_0]`, not `sm:translate-x-[-50%] sm:translate-y-0`:
          // the base DialogContent centers via the standalone `translate` CSS
          // property (`[translate:-50%_-50%]`, chosen so tailwindcss-animate's
          // keyframes — which write `transform` — never clobber it). Tailwind's
          // `translate-x-*`/`translate-y-*` utilities set `--tw-translate-x/y`
          // composed into `transform`, a DIFFERENT property from `translate` —
          // so `sm:translate-y-0` was zeroing a `transform` that was never the
          // one moving this box, while the base's real `translate-y: -50%`
          // stayed in effect at every width. On a dialog taller than the
          // viewport (top-anchored at 7vh, not vertically centered) that extra
          // -50% shift pushed the whole card up past the top edge — the title/
          // category/price header rendered above y=0, unreachably clipped by
          // the fixed positioning (confirmed live: measured top -131px against
          // an intended +32px/7vh). Overriding the SAME `translate` property
          // the base uses is the only way to actually zero it.
          "sm:left-[50%] sm:top-[7vh] sm:bottom-auto sm:[translate:-50%_0]",
          // `sm:h-auto sm:grid-rows-none` undo the two phone-only lines above:
          // above sm this is a floating card that shrinks to its content and
          // lays its children out on implicit auto rows, exactly as before.
          "sm:h-auto sm:grid-rows-none",
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
        {/* Category — top-LEFT corner tab, flush on the card's own edge,
            plus the rail stripe down the left side (owner, via pop-up
            question, 2026-08-30: "category top left ... add the category
            stripe back to the left side").
            data-frame-chrome: these elements deliberately bleed into the
            dialog's padding gutter (the rail is absolute left-0 relative to
            the fixed DialogContent; the badge row is in flow with negative
            margins — neither sits inside the p-4/p-5 content box) to achieve
            the flush-edge design — the apply-dialog-fit e2e excludes them
            from its content-overflow check on that basis. */}
        <span
          aria-hidden
          data-frame-chrome="true"
          className={`absolute left-0 top-0 bottom-0 w-1.5 z-10 rounded-tl-lg rounded-bl-lg ${catStyle.dot}`}
        />
        {/* THE BADGE ROW IS IN FLOW, NOT ABSOLUTE, AND RESERVES THE ICON LANE.
            (owner, 2026-08-31, screenshot annotated "Covering buttons".)
            It used to be `absolute top-0 left-0 … flex items-stretch` — a
            shrink-to-fit strip with no width limit, sharing the sheet's top
            band with the OTHER absolutely-positioned cluster up there (the
            Share/Save/Report row at right-[46px] and the close X at right-3,
            both y=8..40). Two absolute siblings in one band collide as soon as
            the left one gets long, and the strip is z-20 against their z-10, so
            the pills painted OVER the buttons: measured before the fix, on a
            painting job that was recommended + urgent + boosted, the strip ran
            451px wide inside a 320/375px sheet and `elementFromPoint` at the
            centre of Share, Save and Report returned a BADGE, not the button —
            at 320, at 375 AND at 768 (where the sheet is 512px and the strip
            still overshoots the lane). Even a plain 2-badge job broke Share and
            Save at 320. It was never "three pills are one too many"; it was
            chrome positioned by hope.
            The fix has three parts and needs all of them:
              · RESERVE — `iconLaneReserve` below is the icon cluster's real
                measured width, derived from the same conditions that decide
                which icons `cornerActions` renders, so the badges cannot enter
                the lane no matter how many of either render.
              · POINTER-EVENTS-NONE — the reserve keeps the PILLS out of the
                lane, but this row is a stretched grid item, so its (empty,
                transparent) box still spans the full sheet width at z-20 and
                would sit on top of the buttons for hit-testing:
                `elementFromPoint` at each icon centre returned this DIV even
                where no pill was anywhere near it. The row holds nothing
                interactive, so it opts out of hit-testing entirely and taps
                land on the buttons underneath.
              · IN FLOW — `flex-wrap` + negative margins that cancel the
                dialog's own padding. Wrapping is only safe once the row takes
                a track: as an absolute box a second line would have landed on
                top of the title. In flow it pushes the title down instead, so
                0/1/2/3/4 badges are all just "the row is taller", and the
                title's clearance stops being the hand-tuned `mt-5` magic
                number it used to be (see the title row below).
            DELIBERATE TRADE-OFF: at 320px, four badges (~460px of pills) into
            a 168px lane-free width is genuinely 3–4 short lines. That is the
            chosen resolution — every badge stays readable and nothing hides —
            rather than truncating, clipping, or dropping the lower-priority
            pills, which would silently lose information the owner explicitly
            asked to carry over from the feed card. It only bites on the rare
            recommended+urgent+boosted job on the narrowest phone; 1–2 badges,
            the normal case, still render as one flush corner tab exactly as
            before. This is a change at EVERY width, not a phone-only one,
            because the collision was measured at 768 too. */}
        <div
          data-frame-chrome="true"
          className={`relative z-20 pointer-events-none flex flex-wrap items-stretch -mt-4 -mx-4 sm:-mt-5 sm:-mx-5 ${iconLaneReserve}`}
        >
          <span
            className={`inline-flex items-center gap-1.5 pl-3.5 pr-3 py-1.5 rounded-tl-lg text-ds-13 font-semibold leading-none shadow-sm border-b border-r ${!isRecommended && !job.is_urgent && !job.isBoosted ? "rounded-br-lg" : ""} ${catStyle.badge}`}
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-ds-13 font-semibold leading-none shadow-sm border-b ${!job.is_urgent && !job.isBoosted ? "rounded-br-lg" : ""}`}
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
              className={`urgent-pulse inline-flex items-center gap-1.5 px-3 py-1.5 text-ds-12 font-bold uppercase leading-none shadow-sm border-b ${!job.isBoosted ? "rounded-br-lg" : ""}`}
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
              className="boosted-pulse inline-flex items-center gap-1.5 px-3 py-1.5 rounded-br-lg text-ds-12 font-bold uppercase leading-none shadow-sm border-b"
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
        {/* ROW 2 — THE SCROLLING BODY.
            Everything the helpr reads lives in here so the footer CTA below
            can hold the bottom edge of a fixed-height sheet instead of
            floating wherever the content happened to end (see the geometry
            note on DialogContent). `min-h-0` is the load-bearing half: a grid
            item defaults to `min-height:auto`, which refuses to shrink below
            its content, so without it a long job would push the CTA row off
            the bottom of the sheet rather than scrolling inside this box.
            `overflow-x-hidden` pairs with the `min-w-0` for the same reason
            grid-cols-1 exists on the dialog — a long unbroken word must wrap,
            not widen the column.
            `content-start` is the other half of giving a grid a fixed height:
            a grid's default `align-content` behaves as STRETCH, so on a short
            job every row inflated to share out the 600px of new body space —
            the title floated in the middle of an over-tall first row, the stat
            tiles drifted apart, and the poster card became a mostly-empty slab
            (seen on the first pass at 375). Packing the rows to the top keeps
            each one its natural size and collects the slack in ONE place,
            immediately above the pinned CTA, which is what a roomy sheet is
            supposed to look like.
            `sm:contents` DISSOLVES this wrapper above sm, so every child slots
            straight back into the dialog's own implicit-row grid in the same
            source order and the tablet/desktop card renders exactly as it did
            before this file grew a phone body. */}
        <div className="grid grid-cols-1 content-start gap-3 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain sm:contents">
        {/* Title+description share the row with price, price as a small
            pill vertically centered against BOTH lines — same layout as
            JobCard's title row (owner: "fix the layout so it's more
            similar to the job card, with money on the right of the title
            in a pill box", then "center [it] better between title and
            description"). `chip` is the exact component JobCard uses so the
            number is styled identically on both surfaces.
            `mt-1`, not the `mt-5` this carried until 2026-08-31: that margin
            existed to clear the badge row while the badge row was `absolute`
            and therefore invisible to layout — a hand-measured number that had
            already been wrong twice (it was `mt-7`, tuned for the pre-`compact`
            44px icon row, before that). The badge row takes its own grid track
            now, so the dialog's own `gap-3` does the clearing and this is just
            the last few px needed to clear the corner icon cluster
            (absolute, y=8..40). Measured after: title top lands at 43px on
            phone and 43px at sm — the sm case was 40px before, so the desktop
            card is unmoved for all practical purposes. */}
        <div className="mt-1 flex items-center gap-3">
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
            screenshot, 2026-08-24). The wrapper stays (`contents`) so the
            source order and stat-tile grouping are untouched. */}
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
        {/* Posted-by — always visible now, no toggle (owner: "remove
            details and put posted by info here"). Poster card is
            AUTHED-ONLY (owner decision 2026-08-22: "guest page should not
            have who posted the job") — a guest never sees it at all. */}
        {!guest && (
          <JobPosterCard job={job} repeatJobs={repeatJobs} guest={guest} />
        )}

        {/* Apply lives on THIS screen now — no second popup (owner: "they
            will apply on the screen before this", "doesn't need to be 2
            steps", "delete [the apply step]"). Tapping Apply Now used to
            swap the whole sheet to a second view with its own back button
            and a second copy of the title; it now just reveals the note +
            attachments form in place, in the same scroll, same title. The
            plain footer (Message / Apply / Applied / your-post / credential
            gate) hides once that form is up — there is nothing left for it
            to do until the helpr submits or the sheet closes.
            The apply FORM renders inside the scrolling body (here), not in
            the pinned footer track below: it is a note field plus an
            attachment picker and is routinely taller than the sheet, so a
            fixed-height auto row would either crush the body to nothing or
            overflow it. As the body's last child it scrolls exactly the way
            it did when the whole dialog was one scroll container. */}
        {step === "apply" && applyStep ? applyStep({ onBack: () => setStep("detail") }) : null}
        </div>

        {/* ROW 3 — THE PINNED FOOTER. Its own grid track, so on a phone the
            primary CTA sits on the sheet's bottom edge (inside the
            home-indicator inset) for EVERY job, short or long, instead of
            landing wherever the content stopped. `sm:contents` dissolves the
            wrapper above sm so the footer is a plain row of the floating
            card's grid again, unchanged. */}
        <div className="min-w-0 sm:contents">
        {step === "apply" && applyStep ? null : (
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

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
