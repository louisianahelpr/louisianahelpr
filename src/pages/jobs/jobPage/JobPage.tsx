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
import { CountdownRows } from "@/components/job-card/CountdownRows";
import { collapsedClocks } from "@/components/job-card/collapsedClocks";
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
import { useJobPage, useMyInstantBooking, useOfferedToMe, useOwesReview, type JobPageRow } from "./useJobPage";
import { seriesSummary } from "@/lib/format";
import { JobTracker, PosterPrice, PosterMoneyNotes, HelprPrice, HelprMoneyNotes, PostedBy, HiredHelpr, RevisionAsk } from "./JobPageParts";
import { OnTheWayNow, showsNow } from "./OnTheWayNow";
import { JobPageActionRow, type RowAction } from "./JobPageActionRow";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { mapsSearchUrl } from "@/lib/mapsLink";
import { HiredSeriesSection } from "./HiredSeriesSection";
import { NoApplicantsYet } from "./NoApplicantsYet";
import { HelprGuaranteePanel } from "@/components/guarantee/HelprGuaranteePanel";
import { jobPageViewerState } from "./viewerState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { lazy, Suspense, useState } from "react";
import { fetchSellerCard } from "@/lib/declutter/api";
import { fetchJobOfferTargets } from "@/lib/jobOfferTargets";
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

const DisputeTimelineDialog = lazy(() => import("@/components/DisputeTimelineDialog").then((m) => ({ default: m.DisputeTimelineDialog })));
const ReviewForm = lazy(() => import("@/components/ReviewPanel").then((m) => ({ default: m.ReviewForm })));
// JA-17: the Working card's Accept / Decline on this page; loaded only for a Helpr with an offer.
// From the Jobs section's chunk (it holds useActivityActions already), never a chunk of its own: see JobsSection.tsx.
const PageOfferPanel = lazy(() => import("../JobsSection").then((m) => ({ default: m.PageOfferPanel })));

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
  const queryClient = useQueryClient();
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
  // JA-49 (lead 11-01, B107): a direct offer out names the OFFERED Helpr (no helper_id yet; offered_to_helper_id is not
  // selectable, so the poster reads it through get_job_offer_targets, as Messages does).
  const offerPending = isPoster && q.data?.job.status === "open" && q.data?.job.direct_offer_status === "pending";
  const offerTarget = useQuery({
    queryKey: ["job-offer-target", id],
    queryFn: async () => (await fetchJobOfferTargets([id])).get(id) ?? null,
    enabled: !!offerPending,
  });
  const helperId = isPoster ? q.data?.job.helper_id ?? (offerPending ? offerTarget.data ?? null : null) : null;
  const helperCard = useQuery({ queryKey: ["declutter", "seller-card", helperId], queryFn: () => fetchSellerCard(helperId!), enabled: !!helperId });
  const helperFirst = (helperCard.data?.name ?? "").trim().split(/\s+/)[0] || null;
  // The poster's Instant Release (the card's own read, PostedJobActions): the work is approved for them, so no clock.
  const { profile: ownProfile } = useCurrentUser();
  const instantRelease = !!(ownProfile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  // JA-22 (Jobs audit 11-01): the hired Helpr's finished, paid job leads with "Leave a review" (the Working card's own
  // owesReview: paid or paying out, a poster to review, the window open, no review of theirs yet).
  const owed = useOwesReview(q.data?.job, userId, !isPoster);
  const owesReview = owed.owes;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  // Computer (the `lg` grid): the price sits in the side card; a phone shows it beside the title (mockups 4 and 5).
  const wide = useIsWebDesktop();
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
    ? hiredHelprFace(job, { userId, posterFirst, trackingStatus, doneFloorMinutes, open: openWorking, message: messagePoster, owesReview, review: () => setReviewOpen(true) })
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
    // JA-18: a face that opens the Working card ("See your crew steps") IS "Open in working": never both.
    const faceIs = hiredFace.onClick === messagePoster ? "message" : hiredFace.onClick === openWorking ? "working" : "step";
    const lead: RowAction = faceIs === "message" && msg ? msg
      : faceIs === "working" ? { ...work, label: hiredFace.label }
      : { key: "step", label: hiredFace.label, go: hiredFace.onClick, disabled: !!hiredFace.disabled };
    // L27 JA-F2: a cancelled job is in no live Working list, so "Open in working" there is a dead end: not offered.
    const extras = [msg, job.status === "cancelled" ? null : work].filter((a): a is RowAction => !!a && a.key !== lead.key);
    return <JobPageActionRow tag="helpr" lead={lead} leadIsStep={faceIs === "step"} extras={extras} />;
  })();
  // JA-17: after an answer on the page, re-read the job, my application and the pending-offer row (useOfferedToMe).
  const refetchPage = () => {
    void q.refetch();
    void myApplication.refetch();
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.jobs.all, "page-offered-to-me", job.id] });
  };
  // Shown only while the Working row is read, or if it has none for this job: the old way to the offer.
  const seeOffer = (
    <Button variant="primary" size="lg" className="w-full rounded-full text-ds-16" onClick={() => navigate(highlight)}>See the offer</Button>
  );
  // Everyone else's one button: Apply, View application, Open in working.
  const primary = isPoster || hiredFace
    ? null
      // CMP-4: an instant booking is answered on its card below, never "See the offer" (or Apply after a decline).
    : instantUntil
      ? null
    : viewer.action.kind === "open_working"
      ? { label: "Open in working", go: openWorking }
      // JA-17: an offer is answered on this page (PageOfferPanel below), never by leaving it for the Working card.
      : viewer.action.kind === "see_offer"
        ? null
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

  // JA-48 / JA-49: an offer or a booking out to one Helpr; the page waits on them, never on "more applicants".
  const offerOut = isPoster && open && job.direct_offer_status === "pending";
  // JA-27: a no-show put this job back up (the closed application's time); null when there was none.
  const noShowAt = isPoster && open ? applicants.data?.noShowAt ?? null : null;
  const noShowRepostedOn = noShowAt === null ? null : noShowAt ? formatJobDate(noShowAt.slice(0, 10)) : "";
  // The review window, IN the next-step line (owner 11-01: "Next: approve Yusef's work · 23h 52m left, then Helpr
  // support steps in"); nothing releases on a timer (owner 2026-10-23), so the words say who steps in.
  const approveLeft = isPoster && posterWait === "approve" && job.helper_completed_at && !instantRelease
    ? reviewTimeLeft(new Date(job.helper_completed_at).getTime() + hoursToMs(APPROVAL_WINDOW_HOURS))
    : null;
  const posterDetails = job.description?.trim() ?? "";
  // On a phone the details read two lines with "Show more" (mockup 5); a short one has nothing more to show.
  const detailsLong = posterDetails.length > 90 || posterDetails.includes("\n");
  const helprPrice = isPoster ? null : <HelprPrice job={job} noShow={myApplication.data?.closed_reason === "no_show"} />;
  const price = isPoster ? <PosterPrice job={job} labelled={wide} /> : wide
    ? <div className="flex items-start justify-between gap-3"><p className="text-ds-16 font-semibold">Your pay</p>{helprPrice}</div>
    : helprPrice;
  const moneyNotes = isPoster
    ? <PosterMoneyNotes job={job} total={total} loading={applicants.isLoading} />
    : <HelprMoneyNotes job={job} hired={isHired} noShow={myApplication.data?.closed_reason === "no_show"} />;

  /*
   * JOB PAGE LAYOUT V2 (owner 2026-11-01 12:00 PM, mockups 4 and 5 in ~/Documents/Louisiana Helpr):
   *  1. the title in the top bar, the category, day and town under it (and on a phone the price on the right);
   *  2. Details FIRST (a phone shows two lines and "Show more");
   *  3. the status line (the NEXT STEP, owner 12:05 PM) and the tracker, full width;
   *  4. the main column: Photos from the job, the job's own photos, the crew, what to fix;
   *  5. the side card (sticky on a computer): the price and the one money sentence, the other person's card, and the
   *     buttons SIDE BY SIDE with the green one on the RIGHT (JobPageActionRow); the Helpr Guarantee small under it.
   * Guard: src/test/jobPageLayoutV2.test.tsx.
   */
  return (
    <AppPage
      title={job.title}
      backTo={isPoster ? "/posts" : "/jobs"}
      titleActions={share ?? undefined}
    >
      <div data-job-page="" data-layout="v2" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-x-6 lg:gap-y-5">
        <section aria-label="Job summary" data-job-head="" className="space-y-2 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {/* The category, then the day, time and town on one line (mockup 4: "Yard work · Sun, Nov 1 · 9 AM · …"). */}
              <p className="text-ds-14 text-muted-foreground">
                <span className="font-semibold text-primary">{eyebrow}</span>
                {meta && <>{" · "}<span data-job-meta="">{meta}</span></>}
              </p>
              {/* JOBS-18: every visit, before they apply or answer; a hired Helpr reads it in HiredSeriesSection. */}
              {!isHired && seriesSummary(job) && <p data-job-series="" className="text-ds-14 text-muted-foreground">{seriesSummary(job)}</p>}
              {/* JA-20: the hired Helpr's street opens Maps; JA-25: not once the job is cancelled. */}
              {isHired && job.location && job.status !== "cancelled" && (
                <p data-job-address="" className="text-ds-14 text-foreground [overflow-wrap:anywhere]">
                  <span className="font-semibold">Address: </span>
                  <a href={mapsSearchUrl(job.location)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {job.location}
                  </a>
                </p>
              )}
            </div>
            {!wide && price}
          </div>
          {!wide && moneyNotes}
        </section>

        {(posterDetails || hasVideo) && (
          <div data-job-details="" className="space-y-4 lg:col-span-2">
            {/* The poster's scope video (A2-B6), for the poster and the Helpr alike; nothing when there is none. */}
            {hasVideo && <ScopeVideo url={job.scope_video_url} />}
            {posterDetails && (
              <section aria-labelledby="job-page-details" className={`${CARD} p-4 lg:p-5`}>
                <h2 id="job-page-details" className="text-ds-16 font-semibold">Details</h2>
                <p data-details-text="" data-clamped={detailsLong && !detailsOpen ? "" : undefined}
                  className={`mt-1.5 whitespace-pre-line text-ds-15 leading-relaxed [overflow-wrap:anywhere] ${detailsLong && !detailsOpen ? "line-clamp-2 lg:line-clamp-none" : ""}`}>
                  {posterDetails}
                </p>
                {detailsLong && (
                  <Button type="button" variant="link" data-details-more="" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}
                    size="sm" className="mt-1 px-0 text-ds-15 font-semibold lg:hidden">
                    {detailsOpen ? "Show less" : "Show more"}
                  </Button>
                )}
              </section>
            )}
          </div>
        )}

        <section aria-label="Where the job is" data-job-steps="" className={`${CARD} space-y-4 p-4 empty:hidden lg:col-span-2 lg:p-5`}>
          {/* Owner 2026-11-01: "Yusef is on the way · since 8:51 AM" and where he is, ABOVE the tracker. */}
          {isPoster && <OnTheWayNow job={job} helperFirst={helperFirst} trackingStatus={trackingStatus} />}
          <JobTracker job={job} side={isPoster ? "poster" : isHired ? "helpr" : null} trackingStatus={trackingStatus}
            hideNext={isPoster && showsNow(job, trackingStatus)}
            otherFirst={isPoster ? helperFirst : posterFirst}
            pendingApplicants={isPoster && applicants.data ? pending : undefined}
            offerOut={offerOut} offerUntil={job.direct_offer_expires_at ?? null} noShowRepostedOn={noShowRepostedOn} approveLeft={approveLeft}
            crewMember={!isPoster && onCrew ? { confirmed: crewConfirmed } : undefined} />
          {/* JA-34 (audit 11-01): the card's own clock ("28m until the job starts"), so the page knows what its card knows. */}
          {/* JA-30 (Jobs audit 11-01): the dispute line says when they hear back; "See the case" opens the case itself
              (the Working and Posted cards' own DisputeTimelineDialog: the reason, both sides' evidence, the decision). */}
          {party && (isPoster || isHired) && (job.status === "disputed" || !!job.has_active_dispute) && (
            <Button type="button" variant="link" size="sm" data-see-the-case="" onClick={() => setCaseOpen(true)}
              className="h-auto px-0 text-ds-15 font-semibold">
              See the case
            </Button>
          )}
          {(isPoster || isHired) && job.status === "accepted" && <CountdownRows variant="bare" clocks={collapsedClocks({ ...job, status: job.status }, isPoster)} />}
        </section>

        <div data-job-main="" className="flex min-w-0 flex-col gap-4 empty:hidden lg:col-start-1">
          {(isPoster || isHired) && <RevisionAsk job={job} side={isPoster ? "poster" : "helpr"} posterFirst={posterFirst} />}
          {/* The Helpr's photos, as soon as they're submitted: the job's two parties only, off the party read. Big, in
              the main column (mockup 4). */}
          {party && (isPoster || isHired) && ((job.proof_before_urls ?? []).some(Boolean) || (job.proof_after_urls ?? []).some(Boolean)) && (
            <section aria-label="Photos from the job" className={`${CARD} p-4 lg:p-5`}>
              <JobProofPhotos beforeUrls={job.proof_before_urls} afterUrls={job.proof_after_urls} />
            </section>
          )}
          {/* JA-32 (audit 11-01): a crew's roster on the page itself. */}
          {isPoster && job.is_group_job && posterFlows.ready && CREW_ROSTER_STATUSES.has(job.status ?? "") && (
            <section aria-label="Your crew" data-job-crew="" className={`${CARD} p-4`}>
              <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner jobStatus={job.status}
                initialHelpers={posterFlows.crewRoster ?? []} dateNeeded={job.date_needed} startTime={job.start_time}
                onMessage={(helprId) => navigate(`/messages?jobId=${encodeURIComponent(job.id)}&userId=${helprId}`)} />
            </section>
          )}
          {/* A real photo or nothing (audit #8): the poster's own photos of the job. */}
          {hasPhoto && (
            <div data-job-photos="">
              <DeclutterGallery urls={job.photos ?? []} category={job.category} title={job.title} icon={job.category === "other" ? Briefcase : getCategoryIcon(job.category)} shape="banner" />
            </div>
          )}
          {isHired && <HiredSeriesSection job={job} userId={userId} />}
          {/* CMP-4: the poster's top 3 with Book now, or who is booked and until when. Nothing when nobody qualifies. */}
          {instantBookOn && isPoster && !job.is_group_job && job.status === "open" && <InstantBookPanel jobId={job.id} />}
          {/* Board 57: the poster's open, paid job that nobody has applied to yet; never while an offer or booking is
              out (JA-48 / JA-49: "Copy link" and "Edit job" beside a booked Helpr). */}
          {isPoster && open && !offerOut && (job.payment_status === "escrow" || job.payment_status === "held") && !applicants.isLoading && !!applicants.data && total === 0 && (
            <NoApplicantsYet job={job} onManage={posterActions.edit} />
          )}
          {!isPoster && !isHired && job.customer_id && <PostedBy posterId={job.customer_id} />}
        </div>

        {/* Lead 11-01 (B107): a stage with nothing in the main column (no photos, crew or fix: Done, Cancelled) left an
            EMPTY left column beside the card at 1440. The card (and the Guarantee under it) then sits right under the
            tracker at full content width, from 1024 up. */}
        <aside aria-label="Price and actions" data-job-side="" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:self-start lg:[[data-job-main]:empty+&]:col-start-1 lg:[[data-job-main]:empty+&]:col-span-2">
          <section data-job-card="" className={`${CARD} space-y-4 p-4 empty:hidden lg:p-5`}>
            {wide && price}
            {wide && moneyNotes}
            {/* CMP-4: the booked Helpr's card, the same one the Working offer card shows (InstantBookingCard). */}
            {!isPoster && instantUntil && <InstantBookingCard jobId={job.id} title={job.title} declineUntil={instantUntil} />}
            {viewer.status && !(!isPoster && instantUntil) && <p data-viewer-status="" className="text-ds-14 font-semibold text-foreground">{viewer.status}</p>}
            {/* Owner 2026-11-01: the other person's card sits ABOVE the buttons. */}
            {isPoster && job.helper_id && !job.is_group_job && HAS_HELPR.has(job.status ?? "") && <HiredHelpr helprId={job.helper_id} />}
            {isHired && job.customer_id && <PostedBy posterId={job.customer_id} />}
            {/* Reported as a no-show (closed_reason 'no_show'): where the strikes are explained. */}
            {myApplication.data?.closed_reason === "no_show" && <Link to="/rules#strikes-bans" className="text-ds-14 font-medium text-primary underline underline-offset-2">How no-show strikes work</Link>}
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
            {!isPoster && !hiredFace && !instantUntil && viewer.action.kind === "see_offer" && (
              <Suspense fallback={seeOffer}>
                <PageOfferPanel jobId={job.id} onChanged={refetchPage} fallback={seeOffer} />
              </Suspense>
            )}
            {!isPoster && <MineFaceNote note={hiredFace?.note} />}
            {/* LEAD-LIST-FOR-SELLER: the Working card's done rule, said here too (its panel lives on that card). */}
            {isHired && isSellForMeJob(job.category) && !job.helper_completed_at && hiredFace && (
              <p data-sell-for-me-done-note="" className="text-center text-ds-13 text-muted-foreground">{SELL_FOR_ME_DONE_NOTE}</p>
            )}
            {/* Not beside an instant booking's "You're booked" (B80), nor to a Helpr already offered it (JA-50). */}
            {!isPoster && !isHired && !instantUntil && viewer.action.kind !== "see_offer" && <p className="text-ds-13 text-muted-foreground">The street address is shared once you're offered the job.</p>}
          </section>
          {/* Helpr Guarantee (owner 2026-10-27), small, under the card (mockups 4 and 5). */}
          <div data-job-guarantee="" className="empty:hidden">
            <HelprGuaranteePanel job={job} userId={userId} side={isPoster ? "poster" : isHired ? "helpr" : null} />
          </div>
        </aside>
      </div>
      {!isPoster && <PageApplySheet apply={apply} />}
      {reviewOpen && job.customer_id && (
        <Suspense fallback={null}>
          {/* The Working card's own review of the poster (ActivityDialogs' helper mount). */}
          <ReviewForm revieweeRole="poster" open onClose={() => { setReviewOpen(false); owed.refetch(); }}
            jobId={job.id} revieweeId={job.customer_id} revieweeName={posterCard.data?.name ?? "the person who posted this job"} />
        </Suspense>
      )}
      {caseOpen && (
        <Suspense fallback={null}>
          <DisputeTimelineDialog jobId={job.id} jobTitle={job.title} userId={userId} open
            onClose={() => setCaseOpen(false)} onUpdated={() => void q.refetch()} />
        </Suspense>
      )}
      {posterActions.dialogs}
    </AppPage>
  );
}

/** "23h 52m left, then Helpr support steps in", or, once the window passed, that support reaches out. */
function reviewTimeLeft(deadlineMs: number, now = Date.now()): string {
  const ms = deadlineMs - now;
  if (ms <= 0) return `${APPROVAL_WINDOW_HOURS} hours passed. Helpr support will reach out; your payment stays held`;
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h}h ${m}m` : `${m}m`} left, then Helpr support steps in`;
}
