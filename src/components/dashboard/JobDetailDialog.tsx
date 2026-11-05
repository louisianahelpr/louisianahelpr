import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHero, DialogBody } from "@/components/ui/dialog";
import { Repeat, Bookmark, Flag } from "lucide-react";
import { seriesSummary } from "@/lib/format";
import { getCity } from "@/lib/locationUtils";
import { IconActionButton } from "./IconActionButton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import type { EnrichedJob } from "./types";
import { JobPosterCard } from "./JobPosterCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { useJobDetailData } from "./jobDetailDialog/useJobDetailData";
import { JobStatTiles } from "./jobDetailDialog/JobStatTiles";
import { JobDetailFooter } from "./jobDetailDialog/JobDetailFooter";
import { askQuestionCounterpart } from "./jobDetailDialog/askQuestionCounterpart";
import { cornerIconLaneReservePx, CROWDED_RAIL_RESERVE_PX } from "./jobDetailDialog/cornerLane";
import { JobDetailTitleRow } from "./jobDetailDialog/JobDetailTitleRow";
import { JobDetailBadgeRow } from "./jobDetailDialog/JobDetailBadgeRow";
import { JobDetailPhotoCover } from "./jobDetailDialog/JobDetailPhotoCover";
import { useSheetSwipe } from "./jobDetailDialog/useSheetSwipe";
import { SeriesTermsLine } from "@/components/series/SeriesTermsLine";
import { recurrenceShapeLabel } from "@/lib/recurringSchedule";
import { JobDetailNotes } from "@/components/job-card/JobNotes";
import { ScopeVideo } from "@/components/jobs/ScopeVideo";
import { safeScopeVideoUrl } from "@/lib/scopeVideo";

export interface JobDetailDialogProps {
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
   *  your own post). Nothing steps any more, so the answer is only used by
   *  the caller's own submit path; the sheet just stays where it is. */
  onApply: (jobId: string) => void | boolean | Promise<void | boolean>;
  onReport: (jobId: string) => void;
  /** Switching the dialog from one job to another (swipe gesture or similar-job tap). */
  onSelect?: (job: EnrichedJob) => void;
  /** Logged-out preview: render the public job info read-only and replace
      every action (apply/message/save/report) with a single sign-up CTA.
      The poster card, applicant banners, and authed look-ups are skipped —
      a guest only has the masked public RPC fields. */
  guest?: boolean;
  /** THE APPLY FORM, RENDERED ON THIS SAME SHEET — NOT A SECOND STEP.
   *
   *  Owner, 2026-09-09, from two device screenshots: "collapse the two steps
   *  into one". The note-to-poster field, the save-as-default-pitch checkbox,
   *  the payout explainer and a single "Apply Now" now all live on the job
   *  detail sheet itself. There is no Continue, no step change, and one less
   *  tap to apply.
   *
   *  When supplied AND the viewer is actually able to apply, this renders in
   *  place of the footer's Apply CTA (the footer's other three branches —
   *  "This is your post", "Applied", the credential gate — are STATUS and
   *  navigation, not commits, so they still render and this does not).
   *  Only the feed passes it; the guest surfaces (Jobs, JobDetail,
   *  DashboardGuest) have no apply flow and keep the footer's guest branch,
   *  which navigates to signup itself. */
  applyForm?: ReactNode;
}

export { cornerIconLaneReservePx, CROWDED_RAIL_RESERVE_PX };

const JobDetailDialog = ({
  job, effectiveFee, allJobs: _allJobs, isSaved, onToggleSave, userLat, userLng, onClose, onApply, onReport, onSelect: _onSelect, guest = false, applyForm,
}: JobDetailDialogProps) => {
  const navigate = useNavigate();
  const swipeHandlers = useSheetSwipe(job, _allJobs, _onSelect);

  /* NO STEP, NO PIN. This sheet used to carry `step: "detail" | "apply"`, a
     `goToApply()` that read the sheet's own top edge and pinned it before
     stepping, and a `pinnedTop`/`pinnedStyle` pair holding that edge for the
     rest of the open. Every line of that existed for ONE reason: the box
     resized when it swapped steps, and a centred box absorbs a resize
     symmetrically, so the top edge walked 73px up at 375x812 mid-act.

     With one step there is nothing to pin — the sheet renders its final
     height on the first frame and stays centred (owner asked for centred
     twice). Re-adding a step is re-adding all of it. */

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
  // Mirrors JobCard's `recommended={i === 0}` — that prop is purely
  // positional (the first card of whatever list is currently showing), not
  // a field on the job row, so the dialog derives the same thing from the
  // same list it already gets for swipe navigation (owner: "if a job is
  // recommended it should carry over" into this dialog too).
  const isRecommended = !!_allJobs && _allJobs[0]?.id === job.id;

  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  // Viewer fee only — the same resolver the Browse card and apply sheet use (open_jobs_browse
  // has no helper_fee_percent, so a `job.helper_fee_percent ?? …` fallback was dead code).
  const commissionPercent = effectiveFee;

  /* WHICH OF THE TWO SURFACES THE BOTTOM OF THIS SHEET IS.
     The footer's CTA slot has four mutually exclusive branches and only ONE of
     them is a commit: Apply. The other three — "This is your post", "Applied",
     and the credential gate — are status and navigation, so they keep the
     footer. The commit branch is replaced outright by the inline apply form,
     which carries its own "Apply Now".

     Read the conditions in the same order JobDetailFooter reads them, because
     if these two disagree the sheet renders either two CTAs or none.

     `viewerAppPosition === null` while the applications look-up is in flight,
     so an already-applied job shows the form for a beat before collapsing to
     "Applied". That is the rare case (the feed filters applied jobs out) and
     it is the right way round: the overwhelmingly common viewer is a helpr who
     can apply, and they get the correct layout on frame one.

     The own-post case is NOT left to that race — Dashboard withholds
     `applyForm` entirely when the signed-in user is the poster, which it knows
     synchronously, so a poster never sees an apply form flash on their own
     job. */
  const showInlineApply =
    !guest &&
    !!applyForm &&
    viewerUserId !== job.customer_id &&
    viewerAppPosition === null &&
    !((job.credential_tier ?? 0) > 0 && viewerTier < (job.credential_tier ?? 0));

  const handleAskQuestion = () => {
    // No onClose() — the route change unmounts this dialog on its own, and
    // calling it here raced the navigation: the feed's close handler clears
    // ?job= with setSearchParams(..., { replace: true }), which acts on the
    // CURRENT location and so replaced the entry we had just pushed.
    // DH-002: the poster messages their Helpr, never themselves.
    const counterpart = askQuestionCounterpart(job, viewerUserId);
    if (counterpart) navigate(`/messages?userId=${counterpart}&jobId=${job.id}`);
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
      {/* Share leftmost (owner: "share on the left") — Bookmark then Flag
          follow, all at the FULL 44px, matching the shared close X (owner,
          2026-09-11: "i would prefer them be all 44 or 32. needs to be
          consistent").
          These were `compact` (32px) from 2026-08-30, when 44px icons were
          reported as making "a large gap above title". That trade is no
          longer available: the X cannot go to 32 — the `compactClose` prop
          that allowed it was removed on 2026-09-02 precisely because 32x32
          is under the 44x44 HIG tap-target floor, on the one control all 55
          dialogs share. So 44 for all four is the only size that is both
          consistent AND hittable. The row grows ~12px taller than the
          compact version; that is the cost, and it is a deliberate trade,
          not an oversight. */}
      {viewerUserId !== job.customer_id && (
        <ShareJobButton
          variant="icon"
          bare
          // `?? ""` — a job whose poster deleted their account is anonymised,
          // not removed (20260901033011), so it has no address to name. getCity
          // answers "" and the share copy falls back to "Louisiana".
          job={{ id: job.id, title: job.title, budget: job.budget, helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent, category: job.category, city: getCity(job.location ?? "").replace(/,\s*LA\s*$/i, "") }}
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
          icon={
            <Bookmark
              className={`w-4 h-4 ${isSaved ? "fill-primary bookmark-pop" : ""}`}
              key={String(isSaved)}
            />
          }
        />
      )}
      <IconActionButton
        ariaLabel="Report this job"
        onClick={() => { onReport(job.id); onClose(); }}
        bare
        icon={
          <Flag className="w-4 h-4" />
        }
      />
    </>
  );

  /* How much of the sheet's top-right corner the icon cluster occupies, so the
     badge row below can reserve it instead of running underneath it (owner,
     2026-08-31: "Covering buttons"). The COUNT is derived from the same
     conditions as `cornerActions` above, deliberately — a reserve keyed on
     anything else goes stale the moment an icon is added or hidden, which is
     how the row came to depend on the badges happening to be short.

     ── WHY THIS IS ARITHMETIC AND NO LONGER DIALOG_TOP_RIGHT_RESERVE ────────
     Measured at 320 on 2026-09-19 (test-results/messages-lane/tiles-neither-320.png):
     a PLAIN yard-work job — no Recommended, no Urgent, no Boosted — painted its
     "Yard Work" corner tab over the Share glyph. The tab ran x=20..135 while
     the Share button's box starts at x=99.5, a 35px overlap on a sheet 290px
     wide.

     The reserve was not ignored; it was WRONG. dialog.tsx's table
     (54 / 88 / 128 / 168) is the 32px-icon arithmetic: `right-[56px]` + n*32 +
     (n-1)*8. On 2026-09-11 every caller's chrome icons went to the full 44px
     HIG box (IconActionButton / ShareJobButton `bare` without `compact` →
     `h-11 w-11`) and that table was never recomputed, so it under-reserves by
     12px per icon — 36px at three, which is the measured overlap. The table
     lives in src/components/ui/dialog.tsx and is reported, not edited, here.

     So the lane is computed from the geometry itself, from the three numbers
     dialog.tsx actually declares:
       · the close X:  `right-1` (4px) + a stated 44x44 box;
       · the slot row: `absolute right-[56px] ... gap-2` (8px);
       · its children: 44px each (the `bare`, non-`compact` icon box).
     src/test/dialogCornerLaneIsReserved.test.ts re-derives all three by
     reading those files and fails if this reserve is ever short again —
     including for the 32px table, which is how it was shown red. */
  const cornerIconCount = guest
    ? 0
    : (viewerUserId !== job.customer_id ? 1 : 0) + (onToggleSave ? 1 : 0) + 1;
  const iconLaneReservePx = cornerIconLaneReservePx(cornerIconCount);

  /* THE WORD STEPS ASIDE WHEN THE RAIL CANNOT HOLD IT.
     Below 400px the sheet is ~290px wide, so a correctly-reserved three-icon
     lane (204px) leaves 86px — and the tab's own chrome (14px glyph + 6px gap
     + 14/12px padding) is 46px of that, so the longest labels ("Yard Work",
     "Storm Prep", ~72px) cannot fit and would render as "Yard…". A one-letter
     label is worse than none: the glyph is unique per category and the title
     directly below says what the work is.

     This used to key on the extra badges alone, which is why the plain job in
     the screenshot kept its word and overflowed instead. The badges are not
     the only thing that crowds this rail — the icon lane does too, and it is
     now measured rather than assumed. */
  const railIsCrowded =
    isRecommended || job.is_urgent || job.isBoosted ||
    iconLaneReservePx >= CROWDED_RAIL_RESERVE_PX;

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent
        topRightSlot={cornerActions}
        // ONE SHELL AT EVERY WIDTH — TOP-ANCHORED, CONTENT-SIZED.
        //
        // History, because this box has been wrong in three different
        // directions and each fix has to survive the next one:
        //
        //   · IT WAS A BOTTOM SHEET (2026-08-31, commit 7a8ee749). The owner
        //     said the phone sheet "should open not at the bottom"; that was
        //     read as "it is too short" and answered with `h-[92dvh]`, three
        //     explicit grid tracks and the CTA welded to the bottom edge. The
        //     complaint was the ANCHOR, not the height — the owner has since
        //     spelled it out: "hug it, no minimum — but it would open from the
        //     bottom of the screen which is odd. That's not right." The fixed
        //     height made a sparse job WORSE: measured at 375x812, a title +
        //     one-line description + meta chips + poster card opened at 747px
        //     (92.0% of the viewport) with 364.7px of empty space between the
        //     last content pixel and a stranded "Continue" on the bottom edge
        //     (320: the same 364.7px; a recommended+urgent+boosted job at 375:
        //     337.7px). All of that is gone — no height, no explicit tracks,
        //     no bottom anchor.
        //
        //   · IT WAS VERTICALLY CENTRED before that, and a vertically-centred
        //     box RE-CENTRES as its content arrives, so the panel opened small
        //     and grew in both directions while you read it (owner: "opens
        //     small then gets bigger?"). `top-[7vh]` is the fix, and it now
        //     applies at EVERY width rather than only sm+ — the phone gets the
        //     same anchor for the same reason.
        //
        //   · `translate` AND `transform` ARE NOT INTERCHANGEABLE HERE. The
        //     base DialogContent centres with the standalone `translate`
        //     property (`[translate:-50%_-50%]`), deliberately, so
        //     tailwindcss-animate's keyframes — which write `transform` —
        //     can never clobber the centring. Tailwind's `translate-x-*` /
        //     `translate-y-*` utilities feed `transform`, a DIFFERENT
        //     property, so a `translate-y-0` here zeroed something that was
        //     never moving this box while the base's real `translate: … -50%`
        //     stayed in effect at every width. On a top-anchored dialog that
        //     surplus -50% pushed the header above y=0 (measured live at
        //     top: -131px). Only `[translate:-50%_0]` — the same property the
        //     base uses — actually zeroes it.
        //
        // WHAT IS LEFT, and why each line is here:
        //
        //   grid-cols-1
        //     The base DialogContent is `display:grid` with implicit `auto`
        //     columns, which size to max-content and can grow wider than the
        //     dialog; paired with `overflow-y-auto` (which makes overflow-x
        //     compute to `auto`) the over-wide track gets clipped, cutting
        //     long words in the description mid-glyph. This pins the track to
        //     `minmax(0,1fr)` so children wrap instead of overflowing.
        //
        //   left-[50%] top-[7vh] bottom-auto [translate:-50%_0]
        //     Horizontally centred, TOP-anchored, bottom free — unprefixed, so
        //     phone and desktop are the same object. `bottom-auto` is
        //     belt-and-braces against a `bottom-0` creeping back in.
        //
        //   max-h-[86dvh]
        //     A CEILING, not a height: with no `h-*` the box hugs its content
        //     ("hug it, no minimum"), and only a job tall enough to need it
        //     scrolls internally, in the base's own `overflow-y-auto`.
        //     86 — NOT the 92 the bottom sheet used — because the top edge sits
        //     at 7vh now: 7 + 92 = 99vh would leave the CTA ~8px off the bottom
        //     of the screen, i.e. under the home indicator on every modern
        //     iPhone, which is the bottom-anchored look this change exists to
        //     remove. 7 + 86 = 93vh leaves a 7vh gutter, symmetric with the
        //     top. `dvh` rather than the base's `vh` so a mobile browser's
        //     dynamic toolbar cannot push the card past the visible viewport;
        //     the two units are identical on desktop, so sm+ measures exactly
        //     as it did before (698.3px on an 812-tall window, confirmed).
        //
        //   content-start
        //     Kept from the deleted body wrapper. A grid's default
        //     `align-content` behaves as STRETCH, and on the fixed-height sheet
        //     that inflated every row on a short job — the title floated in the
        //     middle of an over-tall first row, the stat tiles drifted apart,
        //     and the poster card became a mostly-empty slab. A content-sized
        //     box has no free space to distribute, so this is a no-op today and
        //     a guard against the next `h-*`.
        //
        //   sm:w-[calc(100%-2rem)] sm:max-w-lg · sm:pb-7 · lg:max-w-3xl
        //     Measure and sm+ padding, both unchanged. The phone keeps the base
        //     `w-[calc(100vw-2rem)]` — the same 16px gutter every other dialog
        //     in the app gets. `lg:max-w-3xl` caps the desktop card at the
        //     reading column the page behind it uses (owner): `xl:max-w-6xl`
        //     opened this at 1152px and read as a modal dwarfing the page.
        //
        // WHAT IS DELIBERATELY ABSENT:
        //
        //   · No radius classes. `.glass-modal` already sets
        //     `border-radius: 28px`; the sheet's `rounded-b-none` existed only
        //     because it was welded to the bottom edge. FLOATING CARD, NOT
        //     FULL-BLEED — the decision this rewrite had to make. Square bottom
        //     corners and edge-to-edge sides are the grammar of a sheet that
        //     MEETS the screen edge; anchored at 7vh with a free bottom, both
        //     of those edges end in mid-air, where a flat corner reads as a
        //     clipped card rather than a designed one. It also honours the
        //     app-wide rule recorded in dialog.tsx — these popups share one
        //     shell.
        //
        //   · No `pb-[calc(1.25rem+env(safe-area-inset-bottom))]`. That was
        //     home-indicator clearance for a sheet flush to the bottom edge.
        //     The card bottoms out at 93vh in the worst case now, so the inset
        //     is dead weight and the phone returns to the base `p-4`.
        //
        //   · No slide-* animation overrides, at ANY width. The phone branch
        //     used `slide-in-from-bottom-full`, meaningless once the card is
        //     top-anchored. The `sm:` branch used `slide-in-from-left-1/2`,
        //     inherited from the era when the base centred by `transform`: it
        //     sets `--tw-enter-translate-x: -50%`, which now COMPOSES with the
        //     base's `translate: -50%` instead of restating it, for -100%
        //     total. Sampled live at 768 before this change, the card entered
        //     at left: -115.2px (off screen) and slid 256px into place —
        //     exactly the "flies in from off-screen left" bug this file's
        //     history says was fixed once already. Deleting both branches hands
        //     the animation back to the base's fade + zoom-95, which is what
        //     dialog.tsx documents as correct now that centring rides
        //     `translate`.
        //
        //   · No `overscroll-contain`. `.glass-modal` already declares
        //     `overscroll-behavior-y: contain`, which is all the deleted body
        //     wrapper was restating.
        //
        // tailwind-merge resolves each line against the base class in the same
        // group, so ordering here is the whole mechanism.
        className={[
          "grid-cols-1",
          // CENTRED — inherited from DialogContent, not restated here.
          //
          // This line used to read `left-[50%] top-[7vh] bottom-auto
          // [translate:-50%_0]`, i.e. the caller opting OUT of the shared
          // shell's centring. It was added to cure a real symptom the owner
          // reported ("opens small then gets bigger?"): a vertically-centred
          // box re-centres as its content arrives, so the panel appeared to
          // grow in both directions while you read it. Top-anchoring hid that
          // by pinning one edge.
          //
          // The owner has since asked for centred again, twice, and it is
          // centred now with nothing left to fight it. Anchoring was treating a
          // symptom: the box moved because its HEIGHT changed after open, and
          // the biggest source of that was the detail -> apply STEP, which
          // resized the sheet mid-act (measured: top 185 -> 118.6). There is
          // one step now, so the sheet renders its whole height on the first
          // frame. What is left is the ordinary late-content wobble every
          // centred dialog in this app has (a tier query, a poster row) —
          // small, and shared with the rest of the shell rather than special
          // to this file.
          "max-h-[86dvh]",
          // NO HEIGHT FLOOR, AND NOTHING LEFT THAT WOULD WANT ONE. This carried
          // `min-h-[min(68dvh,600px)]` from 2026-09-03 to 2026-09-09,
          // reserving the apply step's height on the detail step so a centred
          // box could not jump when it grew. It was dead space under a short
          // job's Continue — owner flagged it three times, last from a device
          // screenshot with ~430px blank below the CTA. Both the floor and the
          // step it existed for are gone: the sheet hugs its content and the
          // apply form is part of that content from the first frame.
          "content-start",
          "sm:w-[calc(100%-2rem)] sm:max-w-lg",
          "sm:pb-7",
          "lg:max-w-3xl",
        ].filter(Boolean).join(" ")}

        {...swipeHandlers}
      >
        {/* NO BODY WRAPPER. Everything from here down to the footer is a
            direct grid item of DialogContent, on the base's own implicit
            auto rows and its `gap-3`. That is the shape sm+ has always
            rendered: the 2026-08-31 phone wrapper carried `sm:contents`,
            which dissolved it above 640px, so this IS that shape — now at
            every width. It existed only to give a FIXED-height sheet a
            scrollable middle track and a footer pinned under it; with the
            height gone there is no slack to pin against, and a job long
            enough to overflow scrolls in the dialog's own
            `overflow-y-auto` (see the geometry note on DialogContent).
            `content-start` moved up to DialogContent with it. */}
        {/* Title + description + pay, one row (see JobDetailTitleRow). */}
        <JobDetailTitleRow hero={<DialogHero title={job.title} />} job={job} viewerUserId={viewerUserId} descExpanded={descExpanded} setDescExpanded={setDescExpanded} commissionPercent={commissionPercent} helpers={helpers} />

        {/* Frame chrome after the hero: the category caption + Recommended/Urgent/Boosted row (see JobDetailBadgeRow). */}
        <JobDetailBadgeRow job={job} isRecommended={isRecommended} railIsCrowded={railIsCrowded} iconLaneReservePx={iconLaneReservePx} />

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
          <JobDetailPhotoCover photos={photos} setLightboxIndex={setLightboxIndex} setGridOpenNonce={setGridOpenNonce} />
        )}

        {/* Recurrence — its own row below the category/urgent/boosted line.
            Urgent/Boosted moved up into that row (owner: "move to the right
            of category"); recurrence stays separate since it isn't one of
            the pills the mockup called out. */}
        {job.is_recurring && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-ds-12 font-semibold border" style={{ color: "hsl(var(--sage-ink))", borderColor: "hsl(var(--bark) / 0.45)" }}>
                <Repeat className="w-3 h-3" />
                {seriesSummary(job as Parameters<typeof seriesSummary>[0]) ?? recurrenceShapeLabel(job as Parameters<typeof recurrenceShapeLabel>[0])}
              </span>
              {/* The series terms, before applying (Q407 4). */}
              {!(job as { parent_job_id?: string | null }).parent_job_id && (
                <SeriesTermsLine jobId={job.id} known={(job as { series_split_ok?: boolean | null }).series_split_ok} />
              )}
          </div>
        )}

        {/* Scope video — shows before description so helpers immediately
            see what's needed. Hidden when no video attached. The browse
            view carries the column since 20261029194021 (A2-B6). */}
        {safeScopeVideoUrl(job.scope_video_url) && (
          <div className="rounded-ds-md overflow-hidden mb-3">
            <ScopeVideo url={job.scope_video_url} />
            {/* Same body voice as the description above — this line was
                `text-ds-11` where the description was `text-ds-15`, two of the
                seven sizes one dialog was speaking. Alignment and the top gap
                live on the wrapper because DialogBody takes no className, by
                design. */}
            <div className="mt-1 text-center">
              <DialogBody>
                <p>Scope video — see exactly what's needed</p>
              </DialogBody>
            </div>
          </div>
        )}

        {/* THE TRUE DISTANCE, UNSUPPRESSED — this is the one surface that
            should state it.

            fecdbf6e7 wrapped this number in a bound that returned null past
            500 mi, on the belief that "1634 mi" was a symptom of a bad origin.
            It was not: the owner was in Menlo Park and the figure was correct
            (geo.ts). Hiding it here was the wrong half of that fix. The browse
            card suppresses the pill because a commute estimate on a scan row
            is noise; the detail sheet is the opposite case — the user has
            opened THIS job and asked about it, there is room for a full
            answer, and "we know where you are but won't say how far" would be
            a worse answer than the mileage.

            The drive-time half beside it is still absent, and correctly so:
            `drivingLabel` comes from useDrivingTime, which declines to
            estimate a drive nobody drives. So the Where tile reads "~1634 mi"
            with no ETA — true, and not pretending to be a commute. */}
        <JobDetailNotes job={job} guest={guest} viewerUserId={viewerUserId} />
        <JobStatTiles job={job} distMilesForDriving={distMilesForDriving} drivingLabel={drivingLabel} />
        </div>
        {/* Posted-by — always visible now, no toggle (owner: "remove
            details and put posted by info here"). Poster card is
            AUTHED-ONLY (owner decision 2026-08-22: "guest page should not
            have who posted the job") — a guest never sees it at all. */}
        {!guest && (
          <JobPosterCard job={job} repeatJobs={repeatJobs} guest={guest} />
        )}

        {/* THE APPLY FORM, IN THE RUN OF CONTENT — one sheet, one CTA.
            (owner, 2026-09-09: "collapse the TWO steps into ONE ... one less
            tap to apply".) The note field, the save-as-default-pitch checkbox,
            the payout explainer and the single "Apply Now" render right here,
            below the poster card, in the same scroll and under the same title.
            There is no Continue button and no step change left to make.
            It sits in the body's source position rather than a pinned track
            because it is routinely taller than the sheet — ApplyBody's own
            `.sheet-sticky-actions` keeps its submit row on screen while the
            content above it scrolls. */}
        {/* ── WHY THERE IS NO <DialogFooter> HERE ────────────────────────────
            NO <DialogFooter>, DELIBERATELY — the one popup in the app without
            one. The full reasoning (three of the four CTA branches are status
            or navigation rather than commits; the equal `h-11 sm:h-12` box
            that stops the sheet resizing when `viewerTier` lands; the phone
            column that would stack Message as a second slab; and the geometry
            history where every footer TRACK arrived with a height and opened a
            sparse job at 747px with 364.7px of dead space) is asserted and
            recorded in `src/components/ui/dialogShell.test.ts` — read it there
            before adding one, because that test will fail if you do. */}
        {showInlineApply ? applyForm : (
          <JobDetailFooter
            job={job}
            guest={guest}
            /* Only reached on the surfaces with no inline form: the guest
               sheets (whose branch navigates to signup itself) and the three
               non-commit branches above, which never call this. */
            onApply={(id) => onApply(id)}
            navigate={navigate}
            viewerUserId={viewerUserId}
            viewerAppPosition={viewerAppPosition}
            viewerTier={viewerTier}
            onAskQuestion={handleAskQuestion}
          />
        )}

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
