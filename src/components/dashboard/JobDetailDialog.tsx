import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHero, DialogBody, DIALOG_TOP_RIGHT_RESERVE } from "@/components/ui/dialog";
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
          // `?? ""` — a job whose poster deleted their account is anonymised,
          // not removed (20260901033011), so it has no address to name. getCity
          // answers "" and the share copy falls back to "Louisiana".
          job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: getCity(job.location ?? "").replace(/,\s*LA\s*$/i, "") }}
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
     2026-08-31: "Covering buttons"). The COUNT is derived from the same
     conditions as `cornerActions` above, deliberately — a reserve keyed on
     anything else goes stale the moment an icon is added or hidden, which is
     how the row came to depend on the badges happening to be short.

     The WIDTHS now come from dialog.tsx (DIALOG_TOP_RIGHT_RESERVE) rather than
     being restated here. They were literals in this file, computed by hand from
     dialog.tsx's `right-[52px]`, its 44px X and its row gap — three numbers in
     another file. Evening up that row's pitch on 2026-09-02 changed the gap and
     left these 12px short with nothing to catch it. */
  const cornerIconCount = guest
    ? 0
    : (viewerUserId !== job.customer_id ? 1 : 0) + (onToggleSave ? 1 : 0) + 1;
  const iconLaneReserve =
    DIALOG_TOP_RIGHT_RESERVE[
      Math.min(cornerIconCount, 3) as keyof typeof DIALOG_TOP_RIGHT_RESERVE
    ];

  return (
    <Dialog open={!!job} onOpenChange={() => onClose()}>
      <DialogContent
          stepped
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
          // The owner has since asked for centred again, twice. Anchoring was
          // treating the symptom: the box moves because its HEIGHT changes
          // after open, and it changes because content lands late. That is
          // NOT yet fixed where it belongs, and this comment previously claimed
          // it was. It said "the panel now reserves its poster row and note
          // field from the first frame (see `min-h` below)" — there is no
          // `min-h` in this file and never was. I described a fix I had not
          // written, and the stale e2e assertion on the old top-anchor hid the
          // consequence until lh-test-ci removed it: measured live, the sheet
          // still jumps 66px between the detail step (top 185) and the apply
          // step (top 118.6), which is exactly the "opens small then gets
          // bigger" the anchor was introduced to mask. Filed as TC-003.
          //
          // Left centred because the owner asked for centred twice, knowing the
          // history. The jump is a real open defect, not an accepted cost — it
          // needs a height reservation sized from the settled content, which is
          // a measurement someone has to take rather than a number to guess.
          "max-h-[86dvh]",
          "content-start",
          "sm:w-[calc(100%-2rem)] sm:max-w-lg",
          "sm:pb-7",
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
                {/* THE HOUSE BODY VOICE, not this dialog's own (2026-08-31).
                    This was `font-serif text-ds-15` at `ink-deep / 0.88`,
                    hand-set here — upright serif, one of the SEVEN different
                    body sizes the popup audit found across 24 dialogs, and two
                    steps larger and darker than the prose every confirm in the
                    app speaks. A helpr reading a job description and then a
                    cancellation confirm was reading two different products.
                    `DialogBody` is that one voice (serif italic, ds-12,
                    olivewood/0.8 — byte-identical to what BrandConfirmDialog
                    gives ~26 confirms), and it takes no className, so this
                    cannot drift back one utility at a time.
                    The <p> keeps only NON-TYPE utilities: line-clamp-3 turns it
                    into a display:-webkit-box, which defaults to
                    min-width:auto and sizes to its max-content width — so a
                    normal word near the edge overflows and the box's own
                    overflow:hidden clips it mid-word instead of wrapping.
                    min-w-0 lets the box shrink to its container so text wraps,
                    and we only clamp when the text is actually long enough to
                    need it so short descriptions stay plain blocks that wrap
                    cleanly. */}
                <DialogBody>
                  <p
                    className={`break-words min-w-0 ${!descExpanded && job.description.length > 180 ? "line-clamp-3" : ""}`}
                  >
                    {job.description}
                  </p>
                </DialogBody>
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

        {/* ── FRAME CHROME, RENDERED AFTER THE HERO ─────────────────────────
            NOTHING RENDERS ABOVE THE HERO (dialog.tsx, "THE POPUP GRAMMAR").
            These two elements used to be the first children of DialogContent,
            which is what held this file out of the 2026-08-31 popup-grammar
            pass: the rule exists because the one dialog that put a 56px icon
            tile above its title pushed the title off the row the X is aligned
            to, and a reader opening a popup should meet its title first.
            They come AFTER the Hero in the DOM now — which is what they are:
            card chrome, not header content. Both carry
            `data-frame-chrome` and both bleed into the p-4/p-5 gutter (the
            rail is `absolute`; the badge row cancels the padding with negative
            margins), neither is in the reading stack, and a screen reader now
            gets "<job title>" before "Home Repair · Urgent · Boosted" rather
            than after — the better order of the two.
            The badge row takes `order-first` to stay the top-left corner tab
            the owner asked for ("category top left"). `order` is safe here and
            nowhere near the WCAG 2.4.3 problem the footer has: this row holds
            nothing focusable (it is `pointer-events-none`), so there is no
            focus order to mismatch, and the reading order it produces is the
            sensible one. It is also the ONLY way to keep both halves — the
            corner tab AND a Hero with nothing above it — without going back to
            `absolute`, which is the defect below.
            The alternative considered and rejected: moving the strip visually
            BELOW the title. That deletes an owner-approved design element
            (the flush corner tab) to satisfy a rule aimed at icon tiles in the
            header stack, so the strip stays where the owner put it and only
            its DOM position changes.

            The category chip is rendered as its own element rather than
            passed to DialogHero as an
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
          className={`relative order-first z-20 pointer-events-none flex flex-wrap items-stretch -mt-4 -mx-4 sm:-mt-5 sm:-mx-5 ${iconLaneReserve}`}
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
            The apply FORM renders here, in the body's source position and
            above the footer: it is a note field plus an attachment picker
            and is routinely taller than the sheet, so it belongs in the run
            of content the dialog scrolls, not in a pinned track. */}
        {step === "apply" && applyStep ? applyStep({ onBack: () => setStep("detail") }) : null}

        {/* ── WHY THERE IS NO <DialogFooter> HERE ────────────────────────────
            Deliberate, and the one part of the popup grammar this dialog does
            not adopt. Recorded here rather than left as a silent omission.
            THE MEASUREMENT. `DialogFooter` is only a flex row, so wrapping
            this action strip in one would not by itself pin anything — but
            every previous attempt to give this sheet a footer TRACK came with
            a height to pin it against, and that is what produced the defect in
            the geometry note on DialogContent above: `h-[92dvh]` +
            `grid-rows-[auto_1fr_auto]` opened a sparse job at 747px with
            364.7px of dead space between the last content pixel and a
            stranded CTA (320: the same; a recommended+urgent+boosted job at
            375: 337.7px). The lesson recorded there is that pinning a footer
            to fill leftover space moves the emptiness somewhere worse. A
            footer here is one `h-*` away from that every time.
            THE SHAPE DOES NOT FIT EITHER, independently of the geometry. The
            grammar's footer is at most one dismiss plus at most one commit,
            built only from DialogSecondaryAction / DialogPrimaryAction /
            DialogDestructiveAction. This strip is not that:
              · Three of its four mutually-exclusive slot branches are not
                commits at all — "This is your post" and "Applied — #3" are
                STATUS, and the credential gate is a navigation.
              · Those branches are deliberately the same `h-11 sm:h-12` box,
                because `viewerTier` resolves a beat after open and an
                unequal branch made the dialog visibly resize under the reader
                (880px → 746px, the owner's "opens bigger then gets smaller").
                The action primitives accept no `size` or `className` — by
                design — so that equal-height invariant cannot be expressed
                through them.
              · The Message button is a 44px ICON, not a ghost text dismiss,
                and the owner explicitly consolidated this row to ONE
                full-width CTA with Message beside it (2026-08-30). On a phone
                `POPUP_FOOTER_ROW` is a reversed COLUMN, so a DialogFooter
                would stack Message as a second full-width bar under the CTA —
                the two-slabs-of-equal-weight treatment that consolidation
                removed.
            Everything else in the grammar IS adopted: one shell, the Hero with
            nothing above it, DialogBody prose, the shared close X, one
            destructive colour. This dialog has a body-level action strip
            instead of a footer, and that is the whole exception.
            If you are about to add a `<DialogFooter>` here: re-read the
            geometry note above, then re-measure a sparse job at 320/375 before
            and after. `dialogShell.test.ts` pins this decision so the
            re-reading is not optional. */}
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

        <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} setLightboxIndex={setLightboxIndex} openInGridNonce={gridOpenNonce} />
      </DialogContent>
    </Dialog>
  );
};

export default JobDetailDialog;
