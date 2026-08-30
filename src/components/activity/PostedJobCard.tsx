import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RotateCcw, Users, RefreshCw, Clock, Check, ChevronDown } from "lucide-react";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { SeriesStrip } from "@/components/activity/SeriesStrip";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { IncomingReportCard } from "./PetReportCard";
import { formatPrice, formatPriceExact, formatRecurrenceInterval } from "@/lib/format";
import { type PostedJobCardProps } from "./postedJobCard/types";
import { PostedJobApplicants } from "./postedJobCard/PostedJobApplicants";
import { PostedJobActions } from "./postedJobCard/PostedJobActions";
import { JOB_ACTION_FULL_CLASS, jobActionChipStyle } from "./JobActionRow";

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
  applicantCounts,
  expandedJobId,
  setExpandedJobId,
  helperNames,
  completedJobMeta,
  userId,
  onBoost,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  onRevision,
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

  // `isFullyCompleted` used to live here and gated two things: whether the
  // card was expandable at all, and whether the collapsed-only Re-Post button
  // showed. Both are gone — every card expands, and every card hides its body
  // until it does — so "archived completed" is no longer a special layout.
  // The "Tipped & Reviewed" strip below reads completedJobMeta directly.
  const isExpanded = expandedJobId === job.id;

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
  const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";

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
              <JobCardMetaRow
                // The card's ONE expand affordance. Every posted card is
                // collapsed on arrival now (owner, 2026-08-27), so it needs a
                // visible control saying there is more underneath — there was
                // none: the only chevron on this card lived in the
                // "Tipped & Reviewed" strip, which renders on archived cards
                // and nowhere else.
                //
                // A bare rotating glyph, pinned to the end of the meta line, is
                // what the code around it has described for a while ("move the
                // details arrow up and remove the words details") without
                // anything actually passing `trailing`. It costs no row.
                // Non-interactive: the whole card is the hit target (see
                // JobCardShell), so a nested button here would be a control
                // inside a control.
                trailing={
                  <ChevronDown
                    aria-hidden
                    className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  />
                }
                dateNeeded={job.date_needed}
                startTime={job.start_time}
                flexibleLabel="Flexible time"
                location={job.location}
                latitude={job.latitude}
                longitude={job.longitude}
                expiresAt={!job.helper_id && job.status !== "cancelled" ? job.expires_at : null}
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
                 {job.is_group_job && (
                   <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} Helpr${job.helpers_needed === 1 ? "" : "s"}` : "Group job"}</span>
                 )}
               </JobCardMetaRow>
  );

  return (
          <JobCardShell
            // EVERY card expands now, not just the ones with a description or
            // an archived-completed summary. A posted card opens collapsed
            // (owner, 2026-08-27: it used to arrive with the tracker, the
            // Applicants button and the whole Share/Boost/Edit/Cancel row
            // already open, so four jobs filled several screens and none of
            // them could be compared at a glance), and what is behind the tap
            // is now the card's whole body — so the tap has to be offered on
            // all of them.
            expandable
            expanded={isExpanded}
            onToggle={() => setExpandedJobId(isExpanded ? null : job.id)}
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

            {/* Where this job stands — a full-width band directly under the
                title divider, not a pill floating in the body padding. Active
                folds several statuses into one list, so without this a job
                awaiting a reply, one whose offer was just declined, and one
                already underway all look alike. Unlike the old pill this also
                colours the terminal statuses, so a Completed / Cancelled /
                Disputed card is identifiable at a glance too. */}
            {/* NO STATUS STRIPE. Owner: "can be removed so we can better
                organize on the top by active / completed / cancelled etc" —
                the filter tabs above the list carry the status now, so a
                coloured band on every card repeated the tab the reader is
                standing in, once per card, all the way down the page. What
                the band said that a tab cannot, each card still says better:
                an assigned job shows the tracker sitting on its real step, an
                open one shows its applicant count, a cancelled one leads with
                "Re-Post This Job". */}

            {/* Summary — BEHIND THE EXPAND (owner, 2026-08-27).
                Collapsed, a posted card is its title, its price and its meta
                line (location · date · time), which is what a poster scans a
                list of their own jobs FOR. Everything from here down — the
                brief, the live tracker, the state chips, the countdowns, the
                revision panel — appears on tap. */}
            {isExpanded && (
            <div className="px-4 py-2.5 space-y-2">
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
                {hasDescription && (
                  <p className="text-ds-11 text-muted-foreground leading-relaxed">{job.description}</p>
                )}
                {hasRequirements && (
                  <div className="rounded-ds-sm bg-secondary/30 p-2">
                    <p className="text-ds-10 text-muted-foreground mb-0.5">Special Requirements</p>
                    <p className="text-ds-11 text-foreground">{job.special_requirements}</p>
                  </div>
                )}
              </div>
            )}

              {/* Assigned helper display — only on the states with no tracking
                  card. Where the tracker IS mounted it carries the helper's
                  name and avatar in its own header instead (owner: the helper
                  "belongs in the tracker, not in that small pop up icon
                  thing"), so this row would be the same fact stated twice. */}
              {job.helper_id && !showsTracker && (job.status === "revision_requested" || job.status === "completed" || job.status === "disputed") && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-ds-sm bg-muted/40">
                  <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-ds-10 font-bold shrink-0">
                    {(helperNames[job.helper_id] || "H")[0].toUpperCase()}
                  </div>
                  {/* No "Completed by" prefix on a completed job: the card's
                      status stripe already reads "Completed" four rows above,
                      so this row was the second place the card announced the
                      status. What it uniquely carries is WHO — the avatar plus
                      the name link say that on their own. The other states keep
                      their prefix, because "Offered to" is a fact the stripe
                      does not carry. */}
                  {job.status !== "completed" && (
                    <span className="text-ds-11 text-muted-foreground">Offered to</span>
                  )}
                  <a href={`/user/${job.helper_id}`} onClick={(e) => e.stopPropagation()} className="text-ds-11 font-medium text-primary hover:underline">
                    {helperNames[job.helper_id] || "Helpr"}
                  </a>
                </div>
              )}

              {/* Cancelled: show fee info if a fee was recorded */}
              {job.status === "cancelled" && (
                <div className="space-y-1.5">
                  {/* The "Cancelled" pill that used to lead this row is gone —
                      the full-width status stripe at the top of the card now
                      says it, in the same destructive tint. Only the fee badge
                      (which the stripe does NOT carry) remains. */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Fee status badge — only when a fee was actually assessed */}
                    {job.cancellation_fee != null && job.cancellation_fee > 0 && job.cancellation_fee_status && (() => {
                      const feeAmt = `$${formatPriceExact(job.cancellation_fee)}`;
                      const statusCopy: Record<string, string> = {
                        pending: `Fee ${feeAmt} · pending`,
                        charged: `Fee ${feeAmt} · charged`,
                        waived:  `Fee ${feeAmt} · waived`,
                      };
                      const label = statusCopy[job.cancellation_fee_status] ?? `Fee ${feeAmt}`;
                      const isPending = job.cancellation_fee_status === "pending";
                      const isCharged = job.cancellation_fee_status === "charged";
                      return (
                        <span
                          className="inline-flex items-center gap-1 text-ds-11 font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: isCharged
                              ? "hsl(var(--destructive) / 0.07)"
                              : isPending
                              ? "hsl(var(--gold-warm) / 0.12)"
                              : "hsl(var(--olivewood) / 0.08)",
                            color: isCharged
                              ? "hsl(var(--destructive))"
                              : isPending
                              ? "hsl(var(--amber-ink))"
                              : "hsl(var(--olivewood))",
                            border: `0.5px solid ${isCharged ? "hsl(var(--destructive) / 0.20)" : isPending ? "hsl(var(--gold-warm) / 0.30)" : "hsl(var(--olivewood) / 0.22)"}`,
                          }}
                        >
                          {/* No DollarSign glyph. `label` already carries the
                              symbol (feeAmt is built as `$${…}` above), so the icon
                              rendered "$ Fee $12.50 · charged" — the doubled money
                              sign the owner reported. A currency symbol is
                              typography: it belongs in the same text node as the
                              digits, inheriting the font, weight and figure
                              alignment, never beside them as a Lucide icon. */}
                          <span className="tabular-nums">{label}</span>
                        </span>
                      );
                    })()}
                  </div>
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
                  {/* Only the WAITING half survives. "Eli T. accepted" was the
                      tracker's Accepted step said again in words, a few rows
                      above the tracker itself (owner: "remove", twice). The
                      waiting pill is not a duplicate — nothing in the tracker
                      says a step is overdue, only which one is current. */}
                  {!job.helper_confirmed_at && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-ds-11 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1" style={{ background: "hsl(var(--amber-tint) / 0.10)", color: "hsl(var(--amber-ink))" }}><Clock className="w-3 h-3" /> Waiting for {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} to accept</span>
                    </div>
                  )}
                  {/* Job countdown */}
                  <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
                  {job.helper_confirmed_at && (
                    <div className="space-y-1.5">
                      {/* No "X says they've arrived" banner (owner: "remove") —
                          the tracker's Arrived step is lit, which is the same
                          statement with the whole timeline around it.

                          The Confirm Arrival ACTION stays, and is gated on the
                          work not being finished: a job whose helpr has marked
                          it done cannot still be asking whether they turned up,
                          and that impossible pair was on screen (owner: "they
                          can't be done and you haven't even marked them
                          arrived"). Its handler stops propagation for the same
                          reason as the tracker wrapper below: the card shell
                          owns the expand toggle, so an unguarded control fires
                          its action AND collapses the card under the finger. */}
                      {job.helper_arrived_at
                        && !job.poster_confirmed_arrival_at
                        && !job.helper_completed_at && (
                        /* Same full-width treatment as its twin in
                           PostedJobActions ("Confirm They Arrived") — this one
                           was the solid `default` CTA while the identical
                           action one state later was a quiet tint, so the same
                           decision shouted or whispered depending on which
                           branch rendered it. Both are the `primary` tint now.
                           (The label divergence is reported, not silently
                           changed.) */
                        <Button size="sm" variant="outline" className={JOB_ACTION_FULL_CLASS} style={jobActionChipStyle("primary")} onClick={(e) => { e.stopPropagation(); onConfirmArrival(job.id); }}>
                          <CheckCircle2 className="w-4 h-4" /> Confirm Arrival
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}


              {(job.status === "in_progress" || job.status === "revision_requested") && job.poster_confirmed_arrival_at && !job.poster_confirmed_working_at && (
                <span className="text-ds-11 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1" style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}><Check className="w-3 h-3" strokeWidth={3} /> Arrival confirmed</span>
              )}

              {/* The completion-confirmation chip row was REMOVED here (owner,
                  2026-08-19: "remove offered to eli / eli confirmed / waiting
                  for you — all of this is done in the live tracker").

                  It restated, as four pills, exactly what the JobTracking
                  strip below already shows as steps: who has confirmed and who
                  is still owed. Two renderings of one state on one card is the
                  thing that makes a screen feel assembled rather than
                  designed — and the tracker is the better of the two, because
                  it also shows the ORDER the steps happen in. */}

              {/* Visible live tracking */}
              {showsTracker && (
                <div onClick={(e) => e.stopPropagation()}>
                  <JobTracking includePostingSteps jobId={job.id} helperId={job.helper_id} helperName={helperName} isHelper={false} isOwner={true} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperArrivalVerifiedAt={job.helper_arrival_verified_at} posterConfirmedArrivalAt={job.poster_confirmed_arrival_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />
                </div>
              )}

              {/* Pet care report card — show incoming daily reports from helper */}
              {job.category === "pet_care" && (job.status === "accepted" || job.status === "in_progress" || job.status === "completed") && (
                <div onClick={(e) => e.stopPropagation()}>
                  <IncomingReportCard jobId={job.id} />
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

            {/* Completed hint */}
            {job.status === "completed" && (() => {
              const cMeta = completedJobMeta[job.id];
              const hasTipped = cMeta?.tipped;
              const hasReviewed = cMeta?.reviewed;
              // Hidden once the card is EXPANDED — the expanded body already
              // shows the same fact as the Tipped/Reviewed pill buttons in
              // the action row below, so this collapsed-state summary line
              // became a redundant third repetition of "already done".
              if (hasTipped && hasReviewed && !isExpanded) {
                return (
                  <div className="px-4 py-1.5 border-t border-[hsl(var(--olivewood)/0.1)] bg-card flex items-center justify-between">
                    {/* No chevron here any more — the meta row's `trailing`
                        slot carries the card's one expand glyph now, so this
                        strip would have been a second one on the same card,
                        two rows apart. */}
                    <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Tipped &amp; Reviewed</span>
                  </div>
                );
              }
              // Nothing when the job is still awaiting a tip and/or a review.
              // This used to print a bare "Tip & review" / "Leave a tip" /
              // "Leave a review" strip directly above the action row that
              // already carries a Tip chip and a Review chip — a label with no
              // control, naming the buttons underneath it. The chips ARE the
              // prompt. Only the fully-archived summary above survives.
              return null;
            })()}

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
                  <JobConfirmation jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
                  {job.is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner={true} initialHelpers={initialGroupHelpers} />}

                </div>
              )}

              {/* Applicants button + inline expanded applicant list */}
              {job.status === "open" && (
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
                onEdit={onEdit}
                onCancel={onCancel}
                onComplete={onComplete}
                completingJobId={completingJobId}
                onRevision={onRevision}
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
          </JobCardShell>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const PostedJobCard = memo(PostedJobCardInner);
