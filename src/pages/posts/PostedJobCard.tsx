import { memo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RotateCcw, RefreshCw, Check, MapPinOff } from "lucide-react";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { SeriesStrip } from "@/pages/posts/SeriesStrip";
import { JobCountdown } from "@/components/job-card/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";
import { JobStatusStrip } from "../../components/job-card/JobStatusStrip";
import { posterStatusLine } from "../../components/job-card/jobStatusLine";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { PersonTile } from "@/components/PersonTile";
import { JobCardShell } from "../../components/job-card/JobCardShell";
import { JobCardTitleBar } from "../../components/job-card/JobCardTitleBar";
import { JobCardMetaRow } from "../../components/job-card/JobCardMetaRow";
import { JobCardPersonContext, personSlotValue, useJobCardPersonSlot } from "../../components/job-card/jobCardPerson";
import { JobCardPhotoStrip } from "../../components/job-card/JobCardPhotoStrip";
import { formatPrice, formatPriceExact, formatRecurrenceInterval } from "@/lib/format";
import { type PostedJobCardProps } from "./postedJobCard/types";
import { PostedJobApplicants } from "./postedJobCard/PostedJobApplicants";
import { PostedJobActions } from "./postedJobCard/PostedJobActions";
import { useHighlightPulse } from "../../components/job-card/useHighlightPulse";
import { UnfundedJobNotice, shouldShowUnfundedNotice } from "./postedJobCard/UnfundedJobNotice";
import { PaymentProblemNotice } from "../../components/job-card/PaymentProblemNotice";
import { cardPaymentProblem } from "@/lib/jobPaymentCardState";
import { useFundExistingJob } from "@/hooks/useFundExistingJob";

/**
 * PostedJobCard — one card in the poster's "my posts" feed: the job
 * summary plus the state-specific section (open / accepted / in-progress
 * / revision / completed / disputed) and its actions.
 *
 * Extracted verbatim from PostedJobsTab.tsx (a 929-line file whose bulk
 * was this one render function). Faithful relocation — the JSX is
 * unchanged; every value the card read from the parent is now a prop.
 */
function PostedJobCardInner({
  job,
  highlight = false,
  applicantCounts,
  pendingApplicantCounts,
  expandedJobIds,
  toggleExpandedJobId,
  helperNames,
  helperAvatars,
  completedJobMeta,
  userId,
  onBoost,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  onNoShow,
  onTip,
  onReview,
  onDispute,
  onReport,
  onViewDispute,
  onConfirmArrival,
  confirmingArrivalJobId,
  onConfirmWorking,
  confirmingWorkingJobId,
  onLoadApplications,
  // No longer read here — the inline applicant preview that consumed these
  // was removed (owner: "applicants should not show here, only when the
  // applicants button is clicked"). Still required on the prop type because
  // PostedJobsTab's fetch/state plumbing for them is untouched; only this
  // card's own render stopped using them.
  onLoadInlineApplicants: _onLoadInlineApplicants,
  inlineApplicants: _inlineApplicants,
  loadingApplicants: _loadingApplicants,
  applicantErrors: _applicantErrors,
  initialTracking,
  initialGroupHelpers,
  onActionComplete,

}: PostedJobCardProps) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  // Deep-link target: scroll here and pulse once. Same hook the applied card
  // uses — see src/components/job-card/useHighlightPulse.ts.
  useHighlightPulse(highlight, cardRef);

  /* The person slot, opened BEFORE any branch in this component (rules of
     hooks). The tile itself is built further down, once the card knows the
     Helpr; `stepCarriesTile` is the step shell reporting that it took it. */
  const { claim: personClaim, stepCarriesTile } = useJobCardPersonSlot();

  // `isFullyCompleted` used to live here and gated two things: whether the
  // card was expandable at all, and whether the collapsed-only Re-Post button
  // showed. Both are gone — every card expands, and every card hides its body
  // until it does — so "archived completed" is no longer a special layout.
  // The "Tipped & Reviewed" strip below reads completedJobMeta directly.
  const { fundJob, fundingJobId } = useFundExistingJob();
  const isExpanded = expandedJobIds.has(job.id);

  // A description that merely restates the title is not a description.
  const hasDescription =
    job.description.trim().toLowerCase() !== job.title.trim().toLowerCase();
  const hasRequirements = !!job.special_requirements?.trim();

  // The tracking card carries the assigned helper's identity (see below), so
  // the standalone "Offered to …" pill row only renders on the states where no
  // tracker is mounted — completed / revision_requested / disputed. This is a
  // move, not a delete: every state that showed the helper still shows them.
  // An OPEN job now shows the tracker too, sitting on its real pre-assignment
  // step (Posted / Applicants) — the owner asked for a tracker on posted jobs,
  // and the same component renders it with the two leading steps prepended.
  // A job awaiting a revision or sitting in a dispute is still LIVE — the
  // poster has a decision in front of them — so it keeps the tracker (owner:
  // "where is the live tracker?"). It used to drop to the bare "Offered to …"
  // pill the moment work was submitted, which hid the whole history at exactly
  // the point the poster is judging it. `completed` still has no tracker: the
  // job is over, and a full green bar is a trophy, not information.
  const showsTracker =
    ((job.status === "accepted" ||
      job.status === "in_progress" ||
      job.status === "revision_requested" ||
      job.status === "disputed" ||
      // Completed keeps it too (owner: "remove [the stripe]. should show
      // tracker"). A finished job's history is the most useful thing on the
      // card once the actions are done — who did it and when each step
      // landed — and it replaces a green band that only repeated the filter
      // the user is already standing in.
      job.status === "completed") &&
      !!job.helper_id) ||
    job.status === "open";
  /* An unfunded job has not been posted to anyone. All four browse surfaces
     require a funded payment_status, so no helper can return it — yet three
     controls on this card asserted the opposite, and the poster believed them:
     the tracker lit "Posted" as a COMPLETED step roughly 40px above the notice
     reading "Payment not finished"; the Applicants button offered to show
     applicants for a listing nobody could see (and its "0" reads as weak
     demand rather than as invisibility); and Boost offered to charge for
     promoting it.

     Each is gated off rather than reworded, because there is no true version
     of any of them until the money lands. UnfundedJobNotice is then the only
     thing this card says about state, which is the point — one claim, and a
     button that fixes it. */
  const unfunded = shouldShowUnfundedNotice(job);
  const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";

  /* THE HELPR'S PROFILE TILE — built here, rendered DIRECTLY ABOVE THE ACTION
     ROW (owner, 2026-09-19: "the helpr or posted by should be right above the
     buttons"). Third position in five days; jobCardPerson.tsx carries the
     whole history and the reasoning.

     The card builds it because the card is what holds the id, the name and the
     avatar. WHERE it lands is no longer the card's business: it is published
     through `JobCardPersonContext` and the step shell (JobStepCard) renders it
     as the last thing before its one row.

     `stepCarriesTile` is the SHELL'S OWN ANSWER, not a second transcription of
     which statuses draw a step card. PostedJobActions returns null outright for
     `cancelled` and `pending_approval` (STATUS_RENDERS_ACTIONS), and an
     un-expanded card draws no actions at all — in exactly those states nothing
     claims the tile and the fallback below prints it, so the Helpr's profile
     cannot silently vanish from a card again.

     NOTHING WHILE COLLAPSED (V6, reaffirmed by the owner 2026-09-19): the tile
     is `null` unless `isExpanded`, gated HERE rather than downstream, because
     this card is the only thing that knows its own expand state.

     On THIS card that gate is defence-in-depth and says so honestly: both
     render sites (the step card and the fallback below) already sit behind
     `isExpanded`, so removing it changes nothing today — which is exactly why
     it stays. The tile has moved three times in five days, and the rule
     belongs to the tile rather than to wherever it currently happens to be
     mounted. On the HELPER card the same line IS load-bearing, because that
     card's step cards render while collapsed; the mutation register in
     src/test/jobCardPersonTileAboveRow.test.tsx records that asymmetry. */
  const helperTile = isExpanded && job.helper_id ? (
    <PersonTile
      userId={job.helper_id}
      to={`/user/${job.helper_id}`}
      name={helperName}
      avatarUrl={helperAvatars?.[job.helper_id] ?? null}
      eyebrow="Helpr"
      onClick={(e) => e.stopPropagation()}
    />
  ) : null;
  const personCtx = personSlotValue(helperTile, personClaim);

  /* THE TRACKER — EXPANDED ONLY, ON EVERY STATUS INCLUDING A CONTESTED ONE.
     (owner, 2026-09-19, later the same day: "the live tracker should also be
     collapsed for disputes unless its clicked to expand it".)

     THIS SUPERSEDES ITEM 13 FROM THAT MORNING, and the reversal is the owner's,
     not a regression. `187f61c3f` un-gated the tracker on a COLLAPSED card for
     `disputed` and `revision_requested` only, so a dispute was visible without
     a tap. They have now seen it: the STATUS STRIP is the signal a dispute is
     open (it says so, in sienna, with "Payment on hold"), and the eight-step
     tracker plus its map is detail — which on this card lives behind the
     expand, like everything else. `PostedJobCard.contestedTracker.test.tsx`
     records the whole arc and now pins the new contract.

     So there is exactly ONE placement again, and a collapsed card mounts no
     <JobTracking> at all — which also means no realtime channel and no
     per-card queries on a list that can be long.

     THE TRACKER NO LONGER CARRIES THE PERSON TILE. It did for three days
     (owner, 2026-09-16); the owner has since moved the tile to directly above
     the action row, so the `personTile` slot is gone from <JobTracking>
     altogether. The V6 rule it existed to protect is unchanged and now lives
     at `helperTile` above: nothing about the Helpr on a collapsed card. */
  const trackerBlock = showsTracker && !unfunded ? (
    <div onClick={(e) => e.stopPropagation()}>
      {/* `embedded`: this card is already a JobCardShell glass card,
          so the tracker renders without a box of its own (same fix
          as HelperTrackerPanel; guard noNestedTrackerCard.test.ts). */}
      <JobTracking embedded includePostingSteps jobId={job.id} helperId={job.helper_id} helperName={helperName} isHelper={false} isOwner={true} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperArrivalVerifiedAt={job.helper_arrival_verified_at} helperArrivalNearMissAt={(job as { helper_arrival_near_miss_at?: string | null }).helper_arrival_near_miss_at} posterConfirmedArrivalAt={job.poster_confirmed_arrival_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />
    </div>
  ) : null;

  /**
   * Location · date · time — built ONCE and placed twice.
   *
   * On the desktop website it rides the TITLE row (owner: "move these up to
   * the right of the title to free up space, but only in webpage"): a wide
   * card gave the title a third of one row and this a tenth of the next, so
   * the card spent two rows on what fits comfortably in one. On phone it stays
   * exactly where it was — there is no spare width to move anything into.
   * Same node either way, so the two placements cannot drift apart.
   */
  const metaRow = (
            <>
              {/* NO HELPR NAME ROW HERE (owner, 2026-09-14, VN-22: "the person
                  working the job should show when it's expanded, not like
                  that"). This reverses the earlier "one fact, one treatment"
                  ruling that kept a 16px monogram + name link on the collapsed
                  card and deferred to the tracker header when expanded. The
                  Helpr now appears once, as a PersonTile under the description,
                  on the expanded card only. */}
              <JobCardMetaRow
                dateNeeded={job.date_needed}
                startTime={job.start_time}
                // The poster's own tick is what licenses the word "Flexible" —
                // the row used to print it for any job with no start time,
                // which is a promise the poster never made. Nothing is shown
                // when there is neither a time nor the flag.
                isFlexibleSchedule={job.is_flexible_schedule}
                flexibleLabel="Flexible time"
                // A job whose poster deleted their account is anonymised, not
                // removed (20260901033011), so it stands with no address. The
                // chip's normaliser already treats "" as absent.
                location={job.location ?? ""}
                // Tap expands, HOLD opens the map (owner: "tapping the
                // location here shouldn't open the map… I keep tapping it on
                // accident"). The location sits in the middle of the card body,
                // so a thumb aimed at the card hit a link and got thrown out to
                // a map; now every part of the collapsed card does the same
                // thing on tap. Opt-in per card so My Jobs is untouched — see
                // the prop's note in JobCardMetaRow.
                locationPressToMap
                /* THE FULL ADDRESS GOES WHERE THE CITY WAS (owner, 2026-09-19,
                   pointing at /jobs: "the full address needs to go where the
                   city place is"). The poster is always entitled to their own
                   job's address — `user_may_see_job_address` lists them first —
                   so this is unconditional here, where on the Helpr's card it
                   rides the same gate the old address LINE did. */
                showFullAddress
                latitude={job.latitude}
                longitude={job.longitude}
                expiresAt={!job.helper_id && job.status !== "cancelled" ? job.expires_at : null}
                // "👥 3", right after the time — the same chip and the same
                // slot the browse feed and the applied card now use.
                helpersNeeded={job.is_group_job ? (job.helpers_needed ?? 2) : null}
                // "View details" costs no row of its own any more.
                //
                // It used to sit below the meta row as a standalone 44px
                // control plus a 10px stack gap — 54px of card height for a
                // single word pair, on a card that already stacks a status
                // stripe, a meta row, state chips, a tracker and an action row.
                // Pinned to the right of the meta line it costs ~8px instead.
                //
                // The 44px TOUCH TARGET is preserved and is deliberately larger
                // than the visible box: `py-3.5` grows the hit area to 44px and
                // `-my-2.5` pulls the layout box back down, so the row grows by
                // 8px rather than 28px. The overhang lands on the card's own
                // padding and the non-interactive status stripe, never on
                // another control — the only other interactive thing in this
                // row is the location link at the opposite end.
              >
                {/* The applicant COUNT deliberately does not appear here.
                    An open job with applicants used to state the same number
                    three times inside ~120px of one card: this chip, the state
                    pill above it ("2 applicants · pick someone"), and the
                    primary "Applicants (2)" button below. The button is the
                    one that keeps it — it is the actionable one, and it is
                    where a poster goes to act on the number. The pill now says
                    only "Pick someone" (see postedActiveState). */}
                {/* The view count is deliberately NOT here either. It was
                    stated twice on one card — this chip and the Activity
                    panel below the tracker — and the owner's ruling on the
                    pair was "show only when applicants is clicked". Both are
                    gone; reach now lives solely in the Applicants panel. */}
                 {/* Interval word only when the SeriesStrip isn't already
                     stating the full shape (owner: less hectic — one series
                     statement per card, not two). */}
                 {job.is_recurring && !(job.recurrence_days && job.recurrence_days.length > 0) && (
                   <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 shrink-0 text-primary" /> {formatRecurrenceInterval(job.recurrence_interval)}</span>
                 )}
                 {/* The group-size chip is NOT a child any more — it is
                     JobCardMetaRow's own `helpersNeeded` prop, which pins it
                     directly after the TIME (owner: "3 helprs needed goes to
                     the right of time"). As a child it landed last, after the
                     recurring chip and the expiry countdown, and the applied
                     card stated the same fact in a footer line at the bottom of
                     the card. One chip, one position, both surfaces. */}
               </JobCardMetaRow>
            </>
  );

  return (
        /* The Helpr's tile, published to whichever JobStepCard this status
           mounts (jobCardPerson.tsx). The provider wraps the WHOLE card, not
           just the actions block, so the fallback below and the claim above it
           are answering the same question. */
        <JobCardPersonContext.Provider value={personCtx}>
        <div ref={cardRef}>
          <JobCardShell
            // EVERY card expands now, not just the ones with a description or
            // an archived-completed summary. A posted card opens collapsed
            // (owner, 2026-08-27: it used to arrive with the tracker, the
            // Applicants button and the whole Share/Boost/Edit/Cancel row
            // already open, so four jobs filled several screens and none of
            // them could be compared at a glance), and what is behind the tap
            // is now the card's whole body — so the tap has to be offered on
            // all of them.
            // One exception (owner, 2026-09-14, VN-29): a COMPLETED job with a
            // tip or review still outstanding opens expanded, and collapses
            // once both are done. The default lives in useCardExpansion
            // (src/components/job-card), which owns `expandedJobIds`.
            expandable
            expanded={isExpanded}
            onToggle={() => toggleExpandedJobId(job.id)}
            // scroll-mt keeps a card's title from ghosting up under the
            // translucent (~0.85 opacity) page title card when it scrolls
            // to the top of the list.
            className="group relative scroll-mt-3"
            category={job.category}
          >
            <JobCardTitleBar
              title={job.title}
              category={job.category}
              amount={formatPrice(job.budget)}
              meta={metaRow}
            />

            {/* The series, made visible — parents only (see SeriesStrip). */}
            {!job.parent_job_id && (
              <SeriesStrip
                jobId={job.id}
                recurrenceDays={job.recurrence_days}
                recurrenceWeeks={job.recurrence_weeks}
                dateNeeded={job.date_needed}
                seriesHelperCommitted={!!job.recurring_helper_id}
              />
            )}

            {/* THE OLD STATUS STRIPE IS STILL GONE, AND THE STRIP ABOVE IS NOT
                IT COMING BACK — read this before assuming the ruling reversed.

                Owner, earlier: "can be removed so we can better organize on the
                top by active / completed / cancelled etc". The band that was
                removed printed the job's STATUS ENUM, in colour, on every card
                — i.e. it repeated the filter tab the reader was already
                standing in, once per card, all the way down the page. The
                dispute badge was then carved out as the documented EXCEPTION to
                that rule, because a 72-hour clock on someone's money is not
                something a tab can carry.

                That exception is now the rule (owner, 2026-09-19: "similar to
                how dispute open displays"), and it is a different claim: the
                strip says WHAT THE CARD IS WAITING ON and WHOSE MOVE IT IS —
                "Confirm they arrived", "Your Helpr is on the way", "Approve &
                release pay". No tab can say any of that, and its eyebrow is
                taken from the tab's own bucket precisely so it can never
                contradict the one the reader is in. */}

            {/* Summary — BEHIND THE EXPAND (owner, 2026-08-27).
                Collapsed, a posted card is its title, its price and its meta
                line (location · date · time), which is what a poster scans a
                list of their own jobs FOR. Everything from here down — the
                brief, the live tracker, the state chips, the countdowns, the
                revision panel — appears on tap. */}
            {isExpanded && (
            /* GROUPED WITH THE META, NOT WITH THE TRACKER (owner, 2026-09-19:
               the description "should be under the location date and time on
               expansion. not with the live tracker box").

               It was ALREADY under the meta in document order — that is why
               nothing moved here. What was wrong was PROXIMITY, and the
               numbers say it plainly:

                 meta -> description   10px (title bar pb-2.5) + 10px (pt-2.5) = 20px
                 description -> tracker 8px (space-y-2)

               The description sat twice as far from the line it belongs to as
               from the block it does not, so it read as the tracker's caption.
               Inverted, with no element moved and nothing added:

                 meta -> description   10px + 4px (pt-1)            = 14px
                 description -> tracker 8px + 12px (the pt-3 below) = 20px

               `pb-2.5` keeps the block's own bottom edge exactly where it was;
               only the top tightens. */
            <div className="px-4 pt-1 pb-2.5 space-y-2" data-job-card-body="">
              {/* Under the title on EVERY width (owner: "move back under
                title globally"). This was `lg:hidden`, with a second copy
                lifted into the title bar on desktop — two arrangements of one
                card, and the desktop one truncated the city to an ellipsis
                before it would drop. One placement, no truncation. */}
            {/* Description behind a tap.
                The card used to print the brief in full (a short one cleared
                the old `length > 100` gate, so no toggle was offered and the
                two-line clamp never engaged) which made an already tall card
                taller. It is collapsed by default now and expands IN PLACE on
                this same card — no navigation, owner's explicit choice over
                opening the job detail.

                ONE affordance, not two: this is the same `expandedJobId`
                toggle the card already owned, now actually gating the text it
                sits under, rather than a second control bolted beneath copy
                that was already fully visible.

                The toggle itself has moved up into the meta row's `trailing`
                slot (see above) so it no longer costs a row; only the revealed
                copy lives here, and it renders nothing at all when collapsed. */}
            {isExpanded && (hasDescription || hasRequirements) && (
              <div className="space-y-1.5">
                {/* `break-words` on both: a description is free text, and one
                    unbroken token (a URL, a gate-code string, a pasted address
                    with no spaces) ran straight out of the card and was cut at
                    its edge — measured at 375, 2026-09-07. Wrap it, never clip. */}
                {hasDescription && (
                  <p className="text-ds-11 text-muted-foreground leading-relaxed break-words">{job.description}</p>
                )}
                {hasRequirements && (
                  <div className="rounded-ds-sm bg-secondary/30 p-2">
                    <p className="text-ds-10 text-muted-foreground mb-0.5">Special Requirements</p>
                    <p className="text-ds-11 text-foreground break-words">{job.special_requirements}</p>
                  </div>
                )}
              </div>
            )}

              {/* THE HELPR, AS A PROFILE (owner, 2026-09-14, VN-22: "the
                  profile for who's working the job should be shown when the job
                  is expanded under the job description, not in that little
                  area"). The shared PersonTile — the same tile JobDetailDialog
                  uses for "Posted by" — so it is one profile treatment app-wide.
                  No rating: the card's data carries the Helpr's name and avatar
                  only, and a second query per card is not worth a number the
                  profile one tap away already shows. Stops propagation so the
                  tap opens the profile without also collapsing the card.

                  MOVED AGAIN (owner, 2026-09-19): it now sits directly above
                  the action row, rendered by the step shell — see `helperTile`
                  / `stepCarriesTile` above. This spot is the FALLBACK for the
                  states that draw no action row at all (cancelled,
                  pending_approval), so those cards keep the Helpr's profile
                  rather than losing it with the row. Exactly one of the two
                  ever renders: `stepCarriesTile` is the shell reporting that it
                  took the tile, not a re-derivation of which statuses have a
                  row. */}
              {!stepCarriesTile && helperTile}

              {/* Cancelled: show fee info if a fee was recorded */}
              {job.status === "cancelled" && (
                <div className="space-y-1.5">
                  {/* The "Cancelled" pill that used to lead this row is gone —
                      the full-width status stripe at the top of the card now
                      says it, in the same destructive tint. Only the fee badge
                      (which the stripe does NOT carry) remains. */}
                  {/* NO PILL. Owner, 2026-09-12: "no pills" — and when asked
                      whether this one should survive because it states money
                      rather than job state, "remove it too, no pills means
                      none". The FACT does not vanish with the pill: a charged
                      cancellation fee with nothing on the card saying so would
                      be a worse defect than the pill ever was. It is a plain
                      money line now, in the card's own type, which is where a
                      currency amount belongs anyway.

                      Keeping `tabular-nums`: the digits still have to align
                      with the other money on the card. And still no glyph —
                      `feeAmt` already carries the symbol, which is what
                      produced the doubled "$ Fee $12.50" the owner reported. A
                      currency symbol is typography; it belongs in the same text
                      node as the digits, never beside them as an icon. */}
                  {job.cancellation_fee != null && job.cancellation_fee > 0 && job.cancellation_fee_status && (() => {
                    const feeAmt = `$${formatPriceExact(job.cancellation_fee)}`;
                    const statusCopy: Record<string, string> = {
                      pending: `Fee ${feeAmt} · pending`,
                      charged: `Fee ${feeAmt} · charged`,
                      waived:  `Fee ${feeAmt} · waived`,
                    };
                    const label = statusCopy[job.cancellation_fee_status] ?? `Fee ${feeAmt}`;
                    const isCharged = job.cancellation_fee_status === "charged";
                    return (
                      <p
                        className="text-ds-11 font-medium tabular-nums"
                        style={{
                          color: isCharged
                            ? "hsl(var(--destructive))"
                            : "hsl(var(--olivewood) / 0.85)",
                        }}
                      >
                        {label}
                      </p>
                    );
                  })()}
                  {/* Re-post CTA — all cancelled / expired jobs.
                      Navigates to /post-job?rebook=<id> which pre-fills
                      every field except the date (date must be in the
                      future; old date is intentionally skipped). */}
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full rounded-ds-md mt-2"
                    onClick={(e) => { e.stopPropagation(); navigate(`/post-job?rebook=${job.id}`); }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Re-Post This Job
                  </Button>
                </div>
              )}

              {/* Accepted status */}
              {job.status === "accepted" && (
                <div className="space-y-2">
                  {/* The "Waiting for … to accept" pill is GONE too (owner,
                      2026-09-11: "no no pills").

                      This one had survived an earlier pass with a written
                      justification — that the tracker says which step is
                      CURRENT but not that it is overdue. The owner has now
                      ruled on the whole class rather than case by case: no
                      status pills on the card, the tracker is where job state
                      is read. Do not reintroduce one with a fresh argument for
                      why this particular pill is different; that argument has
                      already been made and overruled. */}
                  {/* Job countdown */}
                  <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
                  {/* No "X says they've arrived" banner (owner: "remove") —
                      the tracker's Arrived step is lit, which is the same
                      statement with the whole timeline around it.

                      The Confirm Arrival ACTION moved to the card's ONE action
                      row (owner, 2026-09-14, VN-21: every button on a Posts
                      card on one row): it is ScheduledStep's primary now, same
                      gate, same handler. It used to be a full-width button up
                      here, a row of its own above the tracker. */}
                </div>
              )}


              {/* The "Arrival confirmed" chip was REMOVED here (owner,
                  2026-09-11, pointing at it on the card: "not needed. these are
                  also on the tracker").

                  It is the same defect as the completion-confirmation pills
                  noted just below, which the owner had already had removed on
                  2026-08-19 — this one simply survived that pass. The tracker
                  directly below reads `posterConfirmedArrivalAt` and draws the
                  Arrived step from it, so the chip restated, a few rows higher,
                  the one fact the tracker already shows IN ORDER. */}

              {/* The completion-confirmation chip row was REMOVED here (owner,
                  2026-08-19: "remove offered to eli / eli confirmed / waiting
                  for you — all of this is done in the live tracker").

                  It restated, as four pills, exactly what the JobTracking
                  strip below already shows as steps: who has confirmed and who
                  is still owed. Two renderings of one state on one card is the
                  thing that makes a screen feel assembled rather than
                  designed — and the tracker is the better of the two, because
                  it also shows the ORDER the steps happen in. */}

              {/* Visible live tracking — built once above (`trackerBlock`),
                  because a CONTESTED job also draws it while collapsed.

                  `pt-3` is the other half of the description's regrouping (see
                  the block's own note above): it pushes the tracker 20px clear
                  of the brief, so the brief reads with the meta line above it
                  rather than as this box's caption. PADDING, not margin —
                  `space-y-2` sets `margin-top` on every sibling here and its
                  `> * + *` selector outranks a plain `mt-*` on the child. */}
              <div className="pt-3" data-job-card-tracker-gap="">{trackerBlock}</div>

              {/* WHY THERE IS NO MAP — the honest state for an un-geocoded job.
                  (owner: "this should show map tracker when they're on the way")

                  The live map is NOT missing as a feature: JobTracking already
                  mounts <TrackingMap> for the poster the moment the helper is
                  `on_the_way`, with no isHelper gate, and PostedJobCard already
                  hands it `jobLatitude`/`jobLongitude`. Driven with a seeded
                  en-route job it renders — one `.leaflet-container`, one helper
                  pin — on this exact card.

                  What it also requires is the job's OWN coordinates, for the
                  destination pin. When `jobs.latitude/longitude` are null the
                  whole block short-circuits and renders NOTHING: no map, no
                  error, no sentence. Driven with the identical job and the
                  identical live tracking row but null coords: zero leaflet
                  containers, zero console errors. That is the card the owner
                  screenshotted — a helper en route to their house and a card
                  that says nothing about where they are.

                  Null coordinates are not rare: the app's only geocoder was CSP-
                  blocked for a period and both call sites swallow the failure
                  with `catch { return null }`, so every job posted in that
                  window has them.

                  So: say it. The condition here is the exact INVERSE of
                  JobTracking's map gate on the one term this card can read
                  independently — a job with null coordinates can never be the
                  job whose map mounted — so the two can never both render.

                  Fixing the underlying geocode, and the sibling case (helper
                  hasn't shared a position at all, which is JobTracking's own
                  gate), are reported as follow-ups — both live in files this
                  card does not own. */}
              {job.status === "in_progress" &&
                !!job.helper_id &&
                !!job.helper_on_the_way_at &&
                !job.helper_arrived_at &&
                (job.latitude == null || job.longitude == null) && (
                  <div
                    className="rounded-ds-md px-3 py-2 flex items-start gap-2"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "hsl(var(--amber-tint) / 0.10)",
                      border: "0.5px solid hsl(var(--amber-tint) / 0.32)",
                    }}
                  >
                    <MapPinOff
                      aria-hidden
                      className="w-3.5 h-3.5 shrink-0 mt-0.5"
                      style={{ color: "hsl(var(--amber-ink))" }}
                      strokeWidth={2.25}
                    />
                    <p
                      className="font-sans leading-snug text-ds-12"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                        No live map for this job.
                      </span>{" "}
                      We couldn't pin this job's address on a map, so {helperName}'s
                      position can't be shown. The steps above still update as they
                      go — message them if you need an ETA.
                    </p>
                  </div>
                )}

              {/* Revision notice */}
              {job.status === "revision_requested" && (
                <div className="p-2 rounded-ds-sm border space-y-1.5" style={{ background: "hsl(var(--amber-tint) / 0.10)", borderColor: "hsl(var(--amber-tint) / 0.20)" }}>
                  {/* Heading intentionally dropped: the card's status stripe
                      already reads "Revision requested" a few rows above, so
                      repeating it here labelled the same state twice. What this
                      panel uniquely carries is the NOTE and the deadline, which
                      is what it now leads with. */}
                  {job.revision_note && <p className="text-ds-11 text-muted-foreground">{job.revision_note}</p>}
                  {job.revision_completed_at && (
                    <div className="p-1.5 rounded border" style={{ background: "hsl(var(--success-tint))", borderColor: "hsl(var(--success-border))" }}>
                      <p className="text-ds-11 font-medium inline-flex items-center gap-1" style={{ color: "hsl(var(--success-ink))" }}><Check className="w-3 h-3" strokeWidth={3} /> Helpr marked revision as fixed</p>
                      {job.revision_acceptance_deadline && (
                        <DeadlineCountdown
                          deadline={job.revision_acceptance_deadline}
                          expiredText="Acceptance deadline passed — payment releasing to Helpr"
                          consequenceText="Accept the fix, or dispute. If no action is taken, payment auto-releases to the Helpr."
                          variant="warning"
                        />
                      )}
                    </div>
                  )}
                  {!job.revision_completed_at && job.revision_deadline && (
                    <DeadlineCountdown
                      deadline={job.revision_deadline}
                      expiredText="Revision deadline passed — you can now dispute or complete"
                      consequenceText="Helpr must fix the revision before this deadline. After that, you can dispute or mark complete."
                      variant="warning"
                    />
                  )}
                </div>
              )}
            </div>
            )}

            {/* THE COMPLETED HINT IS GONE — the status strip says it now.
                This printed "Tipped & Reviewed" or "Tipped — review still
                open" on its own row, directly above the strip that said
                "DONE · Paid and closed". So a finished job with a loose end
                wore TWO rows and TWO checks that contradicted each other
                (owner, 2026-09-21: "it should also only have 1 check at the
                bottom. it cant be both done and reviewed tip open").
                Both facts are one line now: `derivePosterWait` takes the same
                `completedJobMeta` this component reads and answers
                done_paid / done_tip_open / done_review_open / done_both_open,
                and the check is reserved for the one that has earned it. */}


            {/* A collapsed-only "Re-Post" button used to sit here, for archived
                completed jobs. It existed because the action row below was the
                one thing hidden when an archived card was collapsed, so Re-Post
                had to be re-offered outside it. Now EVERY card hides its
                actions until it is expanded, and expanding an archived card
                reveals PostedJobActions with its own Re-post — so this was the
                only action visible on a collapsed card, on one status out of
                six. Nothing is lost: it is the same destination, one tap in. */}

            {/* Additional details — BEHIND THE EXPAND, on every status (owner,
                2026-08-27). The gate used to be `!isFullyCompleted ||
                isExpanded`, i.e. collapsed only ever hid anything on an
                archived completed job; an open job showed its photos, its
                Applicants button and the full Share / Boost / Edit / Cancel row
                on arrival. No action was removed — they all live one tap in. */}
            {isExpanded && (
            <div>
              {/* Q360: the money problem jobs.status cannot show (bank took the
                  payment back / card declined), first thing in the open card.
                  A declined card on an open job is already said, with its
                  Finish Paying button, by UnfundedJobNotice below. */}
              {!shouldShowUnfundedNotice(job) && cardPaymentProblem(job) && (
                <div className="px-4 pt-3 pb-3 border-t border-border/30">
                  <PaymentProblemNotice job={job} />
                </div>
              )}
              {(job.photos || []).length > 0 && (
                <div className="px-4 py-3 space-y-3 border-t border-border/30">
                  <div>
                    <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                    <JobCardPhotoStrip urls={job.photos || []} size="md" />
                  </div>
                </div>
              )}

              {/* Features for active jobs.
                  The wrapper stops propagation: JobConfirmation and
                  GroupJobHelpers both own real controls (confirm / decline, the
                  group-helper roster) and neither stops it internally, so
                  without this every tap in them also toggled the card open or
                  shut. Same pattern as the tracker wrapper above. */}
              {(job.status === "in_progress" || job.status === "accepted") && (
                <div className="px-4 pb-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* `embedded` for the same reason as the tracker above. */}
                  <JobConfirmation embedded jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} onCantMakeIt={() => onCancel(job)} />
                  {job.is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner={true} jobStatus={job.status} initialHelpers={initialGroupHelpers} />}

                </div>
              )}

              {/* An unfunded job is invisible to every helper while this card
                  looks completely normal — whether the calendar sync created
                  it or the poster's own checkout was abandoned. Say so before
                  the applicants row, which would otherwise read "0 applicants"
                  and be taken as low demand. */}
              {shouldShowUnfundedNotice(job) && (
                <UnfundedJobNotice
                  job={job}
                  onFund={fundJob}
                  funding={fundingJobId === job.id}
                />
              )}

              {/* Applicants button + inline expanded applicant list */}
              {job.status === "open" && !unfunded && (
                <PostedJobApplicants
                  job={job}
                  applicantCounts={applicantCounts}
                  onLoadApplications={onLoadApplications}
                />
              )}

              {/* The Activity panel (views / % applied) used to sit here.
                  Owner: "just remove it from there. Show it when applicants is
                  clicked." Reach is a number you consult while deciding
                  between applicants, not standing information the card owes
                  you on every scroll — so it now lives in the Applicants
                  panel's header (ApplicantsPanel.tsx) and nowhere else. The
                  meta row's duplicate "N views" chip went with it, by the same
                  ruling: one place, on demand. */}

              {/* Actions */}
              <PostedJobActions
                job={job}
                userId={userId}
                helperNames={helperNames}
                completedJobMeta={completedJobMeta}
                onBoost={onBoost}
                unfunded={unfunded}
                onEdit={onEdit}
                onCancel={onCancel}
                onComplete={onComplete}
                completingJobId={completingJobId}
                onNoShow={onNoShow}
                onTip={onTip}
                onReview={onReview}
                onDispute={onDispute}
                onReport={onReport}
                onViewDispute={onViewDispute}
                onConfirmArrival={onConfirmArrival}
                confirmingArrivalJobId={confirmingArrivalJobId}
                onConfirmWorking={onConfirmWorking}
                confirmingWorkingJobId={confirmingWorkingJobId}
                onActionComplete={onActionComplete}
              />
            </div>
            )}
            {/* WHAT THIS CARD IS WAITING ON — ONE STRIP AT THE CARD'S BOTTOM
                EDGE, AND THE ONLY THING A COLLAPSED CARD SAYS ABOUT STATE.
                (owner, 2026-09-19: "in the box to the left of the dots should
                show what we are waiting on, like if the person is on their way
                or confirmed but now you need to confirm etc, remove the dots",
                and on the look: "similar to how dispute open displays.")

                IT REPLACES FOUR BLOCKS THAT USED TO STAND HERE, and each of
                them was this same idea written once more:

                  · the collapsed DISPUTE badge (sienna, "Dispute open …
                    Payment on hold") — now `tone: "alarm"`, same words, same
                    tokens, same `data-dispute-open-badge` hook;
                  · the collapsed CONFIRMATION badge ("Needs your OK … Confirm
                    They Arrived") — now the `confirm_arrival` /
                    `confirm_working` lines, same rung, same
                    `data-poster-owes-confirmation` hook;
                  · the CONTESTED card's full tracker, un-gated that morning so
                    a dispute was visible without a tap — the owner has since
                    seen it and ruled the other way: the strip is the signal,
                    the tracker is detail, and detail lives behind the expand
                    (see PostedJobCard.contestedTracker.test.tsx);
                  · the compact 16px-dot rail, chosen hours earlier because the
                    labelled rail could not fit 212px — superseded outright.
                    Eight anonymous dots give a position on a track; this gives
                    the reader their next move.

                A COLLAPSED CARD NOW CONTAINS NO TRACKER AT ALL, on any status.
                That also takes <JobTracking>'s realtime channel and its
                queries off every row of the list — the strip is a pure render
                over columns this card already holds, and the list's own
                freshness never came from the tracker.

                WHY THE BOTTOM EDGE AND NOT UNDER THE TITLE, where the dispute
                badge sat: "in the box TO THE LEFT OF THE DOTS" — the dots were
                at the bottom, so that is the slot the owner is pointing at.
                It is also the same slot on the Helpr's card, and these two
                cards sit in two tabs of one screen: a status line that lived
                at the top of one and the bottom of the other would be the
                "assembled rather than designed" defect this card keeps having
                removed. The dispute is no less visible for it — it is still a
                full-width tinted band on the collapsed card, unmissable
                without a tap, which was the whole of the 2026-09-06 finding.

                The rule this strip reads is NOT a new one: `posterStatusLine`
                takes its eyebrow from `postedActivityBucket` (the same word as
                the tab above the list) and its sentence from the confirmation
                ladder and the bucket's own predicates. See jobStatusLine.ts. */}
            {!isExpanded && (
              <JobStatusStrip
                /* The completion meta is passed so the strip can tell a
                   finished job from one with a loose end. It is the same
                   `completedJobMeta` this card already reads two hundred lines
                   up — the row it used to paint from it is gone, because a
                   card cannot be both "Done" and "Reviewed — tip still open"
                   (owner, 2026-09-21: "it should also only have 1 check at the
                   bottom"). */
                line={posterStatusLine(
                  job,
                  pendingApplicantCounts?.[job.id] ?? 0,
                  undefined,
                  completedJobMeta[job.id],
                )}
              />
            )}
          </JobCardShell>
        </div>
        </JobCardPersonContext.Provider>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const PostedJobCard = memo(PostedJobCardInner);
