/**
 * /jobs/:id for a signed-in member: the job page (boards 15 and 42 on a
 * phone, 168 and 169 on a desktop). Before this, a signed-in visitor was
 * bounced to /home?quickApply=<id>; the job now has a page of its own and
 * that quick-apply sheet is what the page's Apply button opens.
 *
 * One layout, two sides (spec §1.4, every member is both):
 *  - the POSTER of the job sees their budget, how the money is held, where
 *    the job is (a four-step tracker) and their applicants;
 *  - anyone else sees what they would take home (the real 5% + 70c rule,
 *    helprFlatFee.ts via JobPrice's computeNet) and Apply.
 * Every number is real or hidden (§1.5); no street address before a hire
 * (§1.6): the page prints the city only.
 */
import { InstantBookPanel } from "@/components/jobs/InstantBookPanel";
import { useFeature } from "@/hooks/useFeature";
import { InstantBookingCard } from "@/components/jobs/InstantBookingCard";
import { Link, useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { ScopeVideo } from "@/components/jobs/ScopeVideo";
import { safeScopeVideoUrl } from "@/lib/scopeVideo";
import { DeclutterGallery } from "@/components/declutter/DeclutterGallery";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCity } from "@/lib/locationUtils";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { jobEyebrow } from "./jobEyebrow";
import { useJobPage, useMyInstantBooking, useOfferedToMe, type JobPageRow } from "./useJobPage";
import { seriesSummary } from "@/lib/format";
import { JobTracker, PosterPrice, PosterMoneyNotes, HelprPrice, HelprMoneyNotes, PostedBy, HiredHelpr, RevisionAsk } from "./JobPageParts";
import { OnTheWayNow, showsNow } from "./OnTheWayNow";
import { JobPageActionRow, type RowAction } from "./JobPageActionRow";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { mapsSearchUrl } from "@/lib/mapsLink";
import { HiredSeriesSection } from "./HiredSeriesSection";
import { NoApplicantsYet } from "./NoApplicantsYet";
import { HelprGuaranteePanel } from "@/components/guarantee/HelprGuaranteePanel";
import { jobPageViewerState } from "./viewerState";
import { useQuery } from "@tanstack/react-query";
import { fetchSellerCard } from "@/lib/declutter/api";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";
import { usePageConfirmArrival } from "./usePageConfirmArrival";
import { hiredHelprFace } from "./hiredHelprFace";
import { HAS_HELPR, usePosterPageActions } from "./posterPageActions";
import { usePosterPageFlows } from "./usePosterPageFlows";
import { MineFaceNote } from "@/components/job-card/MineJobFace";
import { doneFloorStart, useDoneFloorMinutesLeft } from "@/components/job-card/useDoneFloor";
import { PageApplySheet, usePageApply } from "./PageApplySheet";
import { JobProofPhotos } from "@/components/jobs/JobProofPhotos";
import { useAgeGate } from "@/hooks/useAgeGate";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import { isSellForMeJob, SELL_FOR_ME_DONE_NOTE } from "@/lib/declutter/sellForMe";

/** "Sat, Oct 31 · 9:00 AM · Delcambre": only the parts the job really has. */
function metaLine(job: JobPageRow): string {
  return [
    job.date_needed ? formatJobDate(job.date_needed) : null,
    jobStartTimeLabel(job.start_time, job.is_flexible_schedule),
    job.location ? getCity(job.location) : null,
  ].filter(Boolean).join(" · ");
}

const CARD = "rounded-2xl border border-border bg-card";
/** A crew job whose roster the poster follows on the page (JA-32): filling, booked, under way, being fixed, done. */
const CREW_ROSTER_STATUSES: ReadonlySet<string> = new Set(["open", "accepted", "in_progress", "revision_requested", "completed", "disputed"]);

export default function JobPage({ id, userId }: { id: string; userId: string }) {
  const navigate = useNavigate();
  const { job: q, applicants, isPoster, myApplication, tracking, onCrew, crewConfirmed } = useJobPage(id, userId);
  const offeredToMe = useOfferedToMe(id, !isPoster && q.data?.job.direct_offer_status === "pending");
  // CMP-4: the booked Helpr's instant booking (Confirm / Decline, the 2-hour countdown), the Working offer card's own.
  // Instant book is off for everyone (owner 11-01, switch 'instant_book'): no Book now list, no booking card.
  const instantBookOn = useFeature("instant_book");
  // The offer read is shared (useOfferedToMe), so the cached row is ignored too while the switch is off.
  const bookedUntil = useMyInstantBooking(id, instantBookOn && !isPoster && q.data?.job.direct_offer_status === "pending");
  const instantUntil = instantBookOn ? bookedUntil : null;
  // Q1586(c): the same under-18 grey-out as every other Apply; a tap says why, before the sheet and its uploads (JOBS-17).
  const { gate: ageGate, gatedProps: ageGatedProps } = useAgeGate();
  const trackingStatus = tracking.data ?? null;
  // The poster's "First L." (the same card PostedBy draws, so the read is shared), for "Waiting on Lexi".
  const posterId = q.data?.job.customer_id ?? null;
  const posterCard = useQuery({ queryKey: ["declutter", "seller-card", posterId], queryFn: () => fetchSellerCard(posterId!), enabled: !!posterId && !isPoster });
  const posterFirst = (posterCard.data?.name ?? "").trim().split(/\s+/)[0] || null;
  // The hired Helpr's first name, off the same card read the poster's Message button uses (posterPageActions), so
  // the tracker line names who the page names: "Eli is working", not "Your Helpr is working" (B49 375 look, 10-31).
  const helperId = isPoster ? q.data?.job.helper_id ?? null : null;
  const helperCard = useQuery({ queryKey: ["declutter", "seller-card", helperId], queryFn: () => fetchSellerCard(helperId!), enabled: !!helperId });
  const helperFirst = (helperCard.data?.name ?? "").trim().split(/\s+/)[0] || null;
  // The poster's Instant Release (the card's own read, PostedJobActions): the work is approved for them, so no clock.
  const { profile: ownProfile } = useCurrentUser();
  const instantRelease = !!(ownProfile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  const arrival = usePageConfirmArrival(isPoster ? q.data?.job : null);
  const apply = usePageApply(isPoster ? null : q.data?.job, posterCard.data);
  // The Working card's own 30 minutes: Mark job complete is greyed here too (useDoneFloor).
  const doneFloorMinutes = useDoneFloorMinutesLeft(doneFloorStart(q.data?.job.poster_confirmed_working_at, q.data?.job.helper_arrived_at));
  // The Posted card's own approve, cancel, edit and step flows, on this page (LEAD-JOBPAGE-LAYOUT, money half).
  const posterFlows = usePosterPageFlows({ jobId: id, enabled: isPoster, trackingStatus, onChanged: () => void q.refetch() });
  const posterActions = usePosterPageActions({
    job: q.data?.job, userId, enabled: isPoster, flows: posterFlows,
    posterWait: isPoster && q.data ? posterStatusLine(q.data.job as unknown as Job, applicants.data?.pending ?? 0).id : null,
    open: q.data?.job.status === "open", pending: applicants.data?.pending ?? 0, onChanged: () => void q.refetch(),
  });

  if (q.isPending) {
    return (
      <AppPage title="Job" backTo="/jobs">
        <div role="status" aria-busy="true" aria-label="Loading job"><JobCardSkeleton /></div>
      </AppPage>
    );
  }
  if (q.isError) {
    return (
      <AppPage title="Job" backTo="/jobs">
        <ErrorState variant="inline" title="We couldn't load this job." body="Check your connection and try again." onRetry={() => void q.refetch()} />
      </AppPage>
    );
  }
  if (!q.data) {
    return (
      <AppPage title="Job" backTo="/jobs">
        <EmptyState
          variant="inline"
          icon={Briefcase}
          title="This job isn't available."
          body="It may have been filled, expired or taken down."
          action={<Button variant="outline" size="sm" className="rounded-full" onClick={() => navigate("/jobs")}>Browse jobs</Button>}
        />
      </AppPage>
    );
  }

  const { job, party } = q.data;
  const hasPhoto = (job.photos ?? []).some((u) => !!u);
  const hasVideo = !!safeScopeVideoUrl(job.scope_video_url);
  // A crew member is hired through the roster (helper_id is null on a crew job, A2-B8): street, tracker, Working card.
  const isHired = !isPoster && ((!!job.helper_id && job.helper_id === userId) || onCrew);
  const eyebrow = jobEyebrow(job.category);
  // The offered or hired Helpr (helper_id is set from the offer on): the street, as on their Working card.
  // The city here; the street once, on the Address line below for the offered or hired Helpr (F7, JOBS2-39: it was printed twice in a row).
  const meta = metaLine(job);
  const open = job.status === "open";
  const pending = applicants.data?.pending ?? 0;
  const total = applicants.data?.total ?? 0;
  // The Apply sheet (with its note field and the server's own checks) is the
  // quick-apply flow; the page opens it rather than growing a second one.
  const canApply = !isPoster && !party && open;

  // Every viewer state, one table (viewerState.ts): applied, offered, hired, declined, closed, own job.
  const viewer = jobPageViewerState({ isPoster, userId: userId ?? null, job, myApplication: myApplication.data, posterFirst, onCrew, offeredToMe });
  // The job's own Working card, in its live bucket, opened (F10): `?job=` names a job on Working (`?highlight=` there
  // is an application id), and `open=1` expands the card instead of only pulsing it.
  const highlight = `/jobs?tab=working&job=${encodeURIComponent(job.id)}&open=1`;
  // The poster's own line, the one the Posted card and this page's tracker print (posterStatusLine): when it asks
  // them to confirm the Helpr arrived, the button here does it (F14), instead of sending them to the card.
  const posterWait = isPoster ? posterStatusLine(job as unknown as Job, pending).id : null;
  // The hired Helpr (F26): the Working card's own next-step button, plus Message and the street address.
  const messagePoster = () => navigate(job.customer_id ? `/messages?jobId=${encodeURIComponent(job.id)}&userId=${job.customer_id}` : "/messages");
  const openWorking = () => navigate(highlight);
  const hiredFace = isHired && viewer.action.kind === "open_working"
    ? hiredHelprFace(job, { userId, posterFirst, trackingStatus, doneFloorMinutes, open: openWorking, message: messagePoster })
    : null;
  // The poster's own step on this page, over posterPageActions' (undefined: theirs).
  const posterStep = posterWait === "confirm_arrival"
    ? { label: arrival.confirming ? "Confirming…" : "Confirm they've arrived", go: () => void arrival.confirm(), disabled: arrival.confirming }
    : jobIsUnfundedDraft(job)
    // JOBS-9: an unpaid job is on no list (owner 2026-09-27), so Manage job opened a list without it. The copy is the way on.
    ? { label: "Post this job again", go: () => navigate(`/post-job?rebook=${encodeURIComponent(job.id)}`) }
    // LEAD-JOBPAGE-LAYOUT (owner 2026-10-31): the step due now, or the next useful thing; never "Manage job"
    // (posterPageActions.tsx: confirm, approve, cancel and the card's steps all on this page).
    : undefined;
  // The hired Helpr's row (owner 2026-11-01, the same rules as the poster's, JobPageActionRow.tsx): the Working card's
  // step leads on the right, with Message and "Open in working" beside it (one, or More options); when the face's
  // button IS Message or Open in working, it leads and the other sits beside it.
  const hiredRow = (() => {
    if (!hiredFace) return null;
    const msg: RowAction | null = job.customer_id && !job.is_group_job ? { key: "message", label: `Message ${posterFirst ?? "them"}`, go: messagePoster } : null;
    const work: RowAction = { key: "working", label: "Open in working", go: openWorking };
    const faceIs = hiredFace.onClick === messagePoster ? "message" : hiredFace.onClick === openWorking && hiredFace.label === "Open in working" ? "working" : "step";
    const lead: RowAction = faceIs === "message" && msg ? msg
      : faceIs === "working" ? work
      : { key: "step", label: hiredFace.label, go: hiredFace.onClick, disabled: !!hiredFace.disabled };
    const extras = [msg, work].filter((a): a is RowAction => !!a && a.key !== lead.key);
    return <JobPageActionRow tag="helpr" lead={lead} leadIsStep={faceIs === "step"} extras={extras} />;
  })();
  // Everyone else's one button: Apply, See the offer, View application, Open in working.
  const primary = isPoster || hiredFace
    ? null
      // CMP-4: an instant booking is answered on its card below, never "See the offer" (or Apply after a decline).
    : instantUntil
      ? null
    : viewer.action.kind === "open_working"
      ? { label: "Open in working", go: openWorking }
      : viewer.action.kind === "see_offer"
        ? { label: "See the offer", go: () => navigate(highlight) }
        : viewer.action.kind === "view_application"
          ? { label: "View application", go: () => navigate(highlight) }
          : viewer.action.kind === "apply" && canApply
            // The apply sheet opens over THIS page (F9), the flow Home runs (PageApplySheet).
            ? { label: "Apply", go: ageGate("apply", () => void apply.flow.handleApplyRequest(job.id)), gated: ageGatedProps("apply") }
            : null;

  const share = open ? (
    <ShareJobButton
      variant="icon"
      bare
      job={{ id: job.id, title: job.title, budget: job.budget, helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent, category: job.category, city: job.location ? getCity(job.location) : undefined }}
    />
  ) : null;

  /*
   * ONE SCREEN, IN THE OWNER'S ORDER (2026-10-31, LEAD-JOBPAGE-LAYOUT): the top bar is the back arrow with the job's
   * TITLE beside it (share and the app's help icon at its right), then the price, the description, the tracker, the step needed now
   * as the big button with the other actions under it, and the Helpr Guarantee at the very bottom. "Get help now" and
   * its reply line are gone (help is the top bar's icon). A Helpr reads what the job is before Apply
   * (LEAD-APPLICANT-JOBINFO). On a phone the two column boxes are `contents`, so their parts take that order in one
   * stack; the desktop keeps its two columns (photos + details left, the summary card right).
   * Guard: src/test/jobPageOneScreenOrder.test.tsx.
   */
  return (
    <AppPage
      title={job.title}
      backTo={isPoster ? "/posts" : "/jobs"}
      titleActions={share ?? undefined}
    >
      <div data-job-page="" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-x-8 lg:gap-y-6">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-4">
          {/* A real photo or nothing (audit #8): no coloured placeholder band standing in for one. */}
          {hasPhoto && (
            <div data-job-photos="" className="order-1 lg:order-none">
              <DeclutterGallery urls={job.photos ?? []} category={job.category} title={job.title} icon={job.category === "other" ? Briefcase : getCategoryIcon(job.category)} shape="banner" />
            </div>
          )}
          {(job.description?.trim() || hasVideo) && (
            <div data-job-details="" className="order-3 space-y-4 lg:order-none">
              {/* The poster's scope video (A2-B6), for the poster and the Helpr alike; nothing when there is none. */}
              {hasVideo && <ScopeVideo url={job.scope_video_url} />}
              {job.description?.trim() && (
                <section aria-labelledby="job-page-details" className={`${CARD} p-4 lg:p-5`}>
                  <h2 id="job-page-details" className="text-ds-16 font-semibold">Details</h2>
                  <p className="mt-1.5 whitespace-pre-line text-ds-15 leading-relaxed [overflow-wrap:anywhere]">{job.description.trim()}</p>
                </section>
              )}
            </div>
          )}
          {!isPoster && !isHired && job.customer_id && <div className="order-6 lg:order-none"><PostedBy posterId={job.customer_id} /></div>}
          {/* CMP-4: the poster's top 3 with Book now, or who is booked and until when. Nothing when nobody qualifies. */}
          {instantBookOn && isPoster && !job.is_group_job && job.status === "open" && <div className="order-5 lg:order-none"><InstantBookPanel jobId={job.id} /></div>}
        </div>

        <div className="contents lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-4 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-5">
          <section aria-label="Job summary" data-job-head="" className="order-2 space-y-4 lg:order-none">
            {/* Owner 2026-11-01: the poster's amount sits on the RIGHT of this block, no budget card of its own. */}
            <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {/* The title is the top bar's, beside the back arrow; the category sits small under it. */}
              <p className="text-ds-13 font-semibold text-primary">{eyebrow}</p>
              {meta && <p data-job-meta="" className="text-ds-14 text-muted-foreground">{meta}</p>}
              {/* JOBS-18: every visit, before they apply or answer; a hired Helpr reads it in HiredSeriesSection. */}
              {!isHired && seriesSummary(job) && <p data-job-series="" className="text-ds-14 text-muted-foreground">{seriesSummary(job)}</p>}
              {/* The hired Helpr is owed the street address (the party read carries it; RLS gives it only to parties). */}
              {/* JA-20: the address opens Maps (directions), the card's own mapsSearchUrl (the address, never the
                  coordinates). JA-25: not once the job is cancelled; it is no longer theirs to go to. */}
              {isHired && job.location && job.status !== "cancelled" && (
                <p data-job-address="" className="text-ds-14 text-foreground [overflow-wrap:anywhere]">
                  <span className="font-semibold">Address: </span>
                  <a href={mapsSearchUrl(job.location)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {job.location}
                  </a>
                </p>
              )}
            </div>
            {isPoster ? <PosterPrice job={job} /> : <HelprPrice job={job} noShow={myApplication.data?.closed_reason === "no_show"} />}
            </div>
            {isPoster ? (
              <PosterMoneyNotes job={job} total={total} loading={applicants.isLoading} />
            ) : (
              <HelprMoneyNotes job={job} hired={isHired} noShow={myApplication.data?.closed_reason === "no_show"} />
            )}
          </section>

          <section aria-label="Where the job is" data-job-steps="" className="order-4 space-y-4 lg:order-none">
            {/* Owner 2026-11-01: "Yusef is on the way · since 8:51 AM" and where he is, ABOVE the tracker. */}
            {isPoster && <OnTheWayNow job={job} helperFirst={helperFirst} trackingStatus={trackingStatus} />}
            <JobTracker job={job} side={isPoster ? "poster" : isHired ? "helpr" : null} trackingStatus={trackingStatus}
              hideNext={isPoster && showsNow(job, trackingStatus)}
              otherFirst={isPoster ? helperFirst : posterFirst}
              pendingApplicants={isPoster && applicants.data ? pending : undefined}
              crewMember={!isPoster && onCrew ? { confirmed: crewConfirmed } : undefined} />
            {(isPoster || isHired) && <RevisionAsk job={job} side={isPoster ? "poster" : "helpr"} posterFirst={posterFirst} />}
            {/* JA-32 (audit 11-01): a crew's roster on the page itself: each member, their step, Message, and the
                per-member Confirm Arrived / Confirm work / Didn't show (JOBS-3), never only under More options. */}
            {isPoster && job.is_group_job && posterFlows.ready && CREW_ROSTER_STATUSES.has(job.status ?? "") && (
              <section aria-label="Your crew" data-job-crew="" className={`${CARD} p-4`}>
                <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner jobStatus={job.status}
                  initialHelpers={posterFlows.crewRoster ?? []} dateNeeded={job.date_needed} startTime={job.start_time}
                  onMessage={(helprId) => navigate(`/messages?jobId=${encodeURIComponent(job.id)}&userId=${helprId}`)} />
              </section>
            )}
            {/* The Helpr's photos, as soon as they're submitted: the job's two parties only, off the party read. */}
            {party && (isPoster || isHired) && <JobProofPhotos beforeUrls={job.proof_before_urls} afterUrls={job.proof_after_urls} />}
            {isHired && <HiredSeriesSection job={job} userId={userId} />}
            {/* CMP-4: the booked Helpr's card, the same one the Working offer card shows (InstantBookingCard). */}
            {!isPoster && instantUntil && <InstantBookingCard jobId={job.id} title={job.title} declineUntil={instantUntil} />}
            {viewer.status && !(!isPoster && instantUntil) && <p data-viewer-status="" className="text-ds-14 font-semibold text-foreground">{viewer.status}</p>}
            {/* Owner 2026-11-01: the Helpr's card sits ABOVE the buttons. */}
            {isPoster && job.helper_id && !job.is_group_job && HAS_HELPR.has(job.status ?? "") && <HiredHelpr helprId={job.helper_id} />}
            {/* The hired Helpr's poster card sits ABOVE the buttons, as the poster's Helpr card does (owner 2026-11-01). */}
            {isHired && job.customer_id && <PostedBy posterId={job.customer_id} />}
            {/* Reported as a no-show (closed_reason 'no_show'): where the strikes are explained. */}
            {myApplication.data?.closed_reason === "no_show" && <Link to="/rules#strikes-bans" className="text-ds-14 font-medium text-primary underline underline-offset-2">How no-show strikes work</Link>}
            {/* JA-9 (Jobs audit 11-01): how long the poster has to check the work, beside Approve, not only on the card.
                The card's own clock and words (InProgressStep); nothing releases on a timer (owner 2026-10-23). */}
            {isPoster && posterWait === "approve" && job.helper_completed_at && !instantRelease && (
              <div data-approve-by="">
                <DeadlineCountdown
                  deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(APPROVAL_WINDOW_HOURS)).toISOString()}
                  expiredText={`${APPROVAL_WINDOW_HOURS} hours passed — Helpr support will reach out. Your payment stays held.`}
                  consequenceText="to review — then Helpr support steps in"
                  inline
                  variant="warning"
                />
              </div>
            )}
            {isPoster && posterActions.row(posterStep)}
            {isPoster && posterActions.panel}
            {hiredRow}
            {primary && (
              <Button
                variant="primary"
                size="lg"
                className="w-full rounded-full text-ds-16"
                onClick={primary.go}
                {...("gated" in primary ? primary.gated : {})}
              >
                {primary.label}
              </Button>
            )}
            {!isPoster && <MineFaceNote note={hiredFace?.note} />}
            {/* LEAD-LIST-FOR-SELLER: the Working card's done rule, said here too (its panel lives on that card). */}
            {isHired && isSellForMeJob(job.category) && !job.helper_completed_at && hiredFace && (
              <p data-sell-for-me-done-note="" className="text-center text-ds-13 text-muted-foreground">{SELL_FOR_ME_DONE_NOTE}</p>
            )}
            {/* Not beside an instant booking's "You're booked" (B80 375 look, 11-01): the two read as a contradiction. */}
            {!isPoster && !isHired && !instantUntil && <p className="text-ds-13 text-muted-foreground">The street address is shared once you're offered the job.</p>}
          </section>

          {/* Board 57: the poster's open, paid job that nobody has applied to yet. */}
          {/* Paid or, with the card hold at posting (Q2399), a held card: both are live listings. */}
          {isPoster && open && (job.payment_status === "escrow" || job.payment_status === "held") && !applicants.isLoading && !!applicants.data && total === 0 && (
            <div className="order-5 lg:order-none">
              <NoApplicantsYet job={job} onManage={posterActions.edit} />
            </div>
          )}

          {/* Helpr Guarantee (owner 2026-10-27): the poster's explainer and "Not done right"; the hired Helpr's answer. At the very bottom (owner 2026-10-31). */}
          <div data-job-guarantee="" className="order-last lg:order-none empty:hidden">
          <HelprGuaranteePanel job={job} userId={userId} side={isPoster ? "poster" : isHired ? "helpr" : null} />
          </div>
        </div>
      </div>
      {!isPoster && <PageApplySheet apply={apply} />}
      {posterActions.dialogs}
    </AppPage>
  );
}
