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
import { hasStreetAddress } from "@/pages/jobs/appliedJobCard/JobAddressLine";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { jobEyebrow } from "./jobEyebrow";
import { useJobPage, type JobPageRow } from "./useJobPage";
import { JobTracker, PosterMoney, HelprMoney, PostedBy } from "./JobPageParts";
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
import { PageApplySheet, usePageApply } from "./PageApplySheet";
import { GetHelpNow } from "@/components/jobs/GetHelpNow";

/** "Sat, Oct 31 · 9:00 AM · Delcambre": only the parts the job really has. */
function metaLine(job: JobPageRow, showStreet: boolean): string {
  return [
    job.date_needed ? formatJobDate(job.date_needed) : null,
    jobStartTimeLabel(job.start_time, job.is_flexible_schedule),
    showStreet && hasStreetAddress(job.location) ? job.location : job.location ? getCity(job.location) : null,
  ].filter(Boolean).join(" · ");
}

/**
 * The job statuses in which the Helpr's Working card prints the street (AppliedJobCard's
 * showFullAddress: offered, confirmed, working, disputed). The job page prints the same
 * street in the same states (audit 2026-10-28 F7: the offer card showed "4412 Highland Rd"
 * while the job page said only "Baton Rouge"). Owner rule 2026-08-31: "Should only see
 * address when they are offered the job"; the server (user_may_see_job_address) decides
 * what `location` holds, this only stops the page printing the city in its place.
 */
const STREET_STATUSES = new Set(["open", "accepted", "in_progress", "revision_requested", "disputed"]);

const CARD = "rounded-2xl border border-border bg-card";

export default function JobPage({ id, userId }: { id: string; userId: string }) {
  const navigate = useNavigate();
  const { job: q, applicants, isPoster, myApplication, tracking, onCrew } = useJobPage(id, userId);
  const trackingStatus = tracking.data ?? null;
  // The poster's "First L." (the same card PostedBy draws, so the read is shared), for "Waiting on Lexi".
  const posterId = q.data?.job.customer_id ?? null;
  const posterCard = useQuery({ queryKey: ["declutter", "seller-card", posterId], queryFn: () => fetchSellerCard(posterId!), enabled: !!posterId && !isPoster });
  const posterFirst = (posterCard.data?.name ?? "").trim().split(/\s+/)[0] || null;
  const arrival = usePageConfirmArrival(isPoster ? q.data?.job : null);
  const apply = usePageApply(isPoster ? null : q.data?.job, posterCard.data);

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
  const meta = metaLine(job, isHired && STREET_STATUSES.has(job.status ?? ""));
  const open = job.status === "open";
  const pending = applicants.data?.pending ?? 0;
  const total = applicants.data?.total ?? 0;
  // The Apply sheet (with its note field and the server's own checks) is the
  // quick-apply flow; the page opens it rather than growing a second one.
  const canApply = !isPoster && !party && open;

  // Every viewer state, one table (viewerState.ts): applied, offered, hired, declined, closed, own job.
  const viewer = jobPageViewerState({ isPoster, userId: userId ?? null, job, myApplication: myApplication.data, posterFirst, onCrew });
  // The job's own Working card, in its live bucket, opened (F10): `?job=` names a job on Working (`?highlight=` there
  // is an application id), and `open=1` expands the card instead of only pulsing it.
  const highlight = `/jobs?tab=working&job=${encodeURIComponent(job.id)}&open=1`;
  // The poster's own line, the one the Posted card and this page's tracker print (posterStatusLine): when it asks
  // them to confirm the Helpr arrived, the button here does it (F14), instead of sending them to the card.
  const posterWait = isPoster ? posterStatusLine(job as unknown as Job, pending).id : null;
  // The hired Helpr (F26): the Working card's own next-step button, plus Message and the street address.
  const messagePoster = () => navigate(job.customer_id ? `/messages?jobId=${encodeURIComponent(job.id)}&userId=${job.customer_id}` : "/messages");
  const hiredFace = isHired && viewer.action.kind === "open_working"
    ? hiredHelprFace(job, { userId, posterFirst, trackingStatus, open: () => navigate(highlight), message: messagePoster })
    : null;
  const primary = isPoster && posterWait === "confirm_arrival"
    ? { label: arrival.confirming ? "Confirming…" : "Confirm arrival", go: () => void arrival.confirm(), disabled: arrival.confirming }
    : isPoster
    ? {
        label: open && pending > 0 ? `Review ${pending} applicant${pending === 1 ? "" : "s"}` : "Manage job",
        // The Posted card face is a link back to this page (board 14), so the
        // page sends the poster to that card with its live controls open.
        go: () =>
          navigate(
            open && pending > 0
              // Review opens the applicants themselves (useReviewApplicantsDeepLink), not just the card.
              ? `/posts?highlight=${encodeURIComponent(job.id)}&applicants=1`
              : `/posts?highlight=${encodeURIComponent(job.id)}&manage=1`,
          ),
      }
    : hiredFace
      ? { label: hiredFace.label, go: hiredFace.onClick, disabled: !!hiredFace.disabled, secondary: hiredFace.tone === "secondary" }
      : viewer.action.kind === "open_working"
      ? { label: "Open in working", go: () => navigate(highlight) }
      : viewer.action.kind === "see_offer"
        ? { label: "See the offer", go: () => navigate(highlight) }
        : viewer.action.kind === "view_application"
          ? { label: "View application", go: () => navigate(highlight) }
          : viewer.action.kind === "apply" && canApply
            // The apply sheet opens over THIS page (F9), the flow Home runs (PageApplySheet).
            ? { label: "Apply", go: () => void apply.flow.handleApplyRequest(job.id) }
            : null;

  return (
    <AppPage
      title={job.title}
      backTo={isPoster ? "/posts" : "/jobs"}
      phoneHidesTitle
      titleActions={
        open ? (
          <ShareJobButton
            variant="icon"
            bare
            job={{ id: job.id, title: job.title, budget: job.budget, helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent, category: job.category, city: job.location ? getCity(job.location) : undefined }}
          />
        ) : undefined
      }
    >
      <div data-job-page="" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-x-8 lg:gap-y-6">
        {/* A real photo or nothing (audit #8): no coloured placeholder band standing in for one. */}
        {hasPhoto && (
          <div data-job-photos="" className="lg:col-start-1 lg:row-start-1">
            <DeclutterGallery urls={job.photos ?? []} category={job.category} title={job.title} icon={job.category === "other" ? Briefcase : getCategoryIcon(job.category)} shape="banner" />
          </div>
        )}

        <section
          aria-label="Job summary"
          className={`space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-5`}
        >
          <div className="space-y-1">
            <p className="text-ds-13 font-semibold text-primary">{eyebrow}</p>
            {/* Desktop prints the title once, in the page header (lead review 2026-10-20). */}
            <h2 className="text-ds-24 font-bold leading-tight [overflow-wrap:anywhere] lg:hidden">{job.title}</h2>
            {meta && <p data-job-meta="" className="text-ds-14 text-muted-foreground">{meta}</p>}
            {/* The hired Helpr is owed the street address (the party read carries it; RLS gives it only to parties). */}
            {isHired && job.location && (
              <p data-job-address="" className="text-ds-14 text-foreground [overflow-wrap:anywhere]">
                <span className="font-semibold">Address: </span>
                {job.location}
              </p>
            )}
          </div>
          <JobTracker job={job} side={isPoster ? "poster" : isHired ? "helpr" : null} trackingStatus={trackingStatus}
            pendingApplicants={isPoster && applicants.data ? pending : undefined} />
          {isHired && <HiredSeriesSection job={job} userId={userId} />}
          {isPoster ? (
            <PosterMoney job={job} total={total} loading={applicants.isLoading} />
          ) : (
            <HelprMoney job={job} />
          )}
          {/* Helpr Guarantee (owner 2026-10-27): the poster's explainer and "Not done right"; the hired Helpr's answer. */}
          <HelprGuaranteePanel job={job} userId={userId} side={isPoster ? "poster" : isHired ? "helpr" : null} />
          {viewer.status && <p data-viewer-status="" className="text-ds-14 font-semibold text-foreground">{viewer.status}</p>}
          {/* Reported as a no-show (closed_reason 'no_show'): where the strikes are explained. */}
          {myApplication.data?.closed_reason === "no_show" && <Link to="/rules#strikes-bans" className="text-ds-14 font-medium text-primary underline underline-offset-2">How no-show strikes work</Link>}
          {primary && (
            <Button
              variant={"secondary" in primary && primary.secondary ? "outline" : "primary"}
              size="lg"
              className="w-full rounded-full text-ds-16"
              onClick={primary.go}
              disabled={"disabled" in primary ? primary.disabled : false}
            >
              {primary.label}
            </Button>
          )}
          {hiredFace && (
            <div data-hired-actions="" className="flex flex-wrap gap-2">
              {/* Message the poster, unless the main button already is that (a waiting card's one button). */}
              {hiredFace.onClick !== messagePoster && (
                <Button variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={messagePoster}>
                  Message {posterFirst ?? "them"}
                </Button>
              )}
              <Button variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={() => navigate(highlight)}>
                Open in working
              </Button>
            </div>
          )}
          {!isPoster && !isHired && <p className="text-ds-13 text-muted-foreground">The street address is shared once you're offered the job.</p>}
          {(isPoster || isHired) && <GetHelpNow job={job} />}
        </section>


        {/* Board 57: the poster's open, paid job that nobody has applied to yet. */}
        {/* Paid or, with the card hold at posting (Q2399), a held card: both are live listings. */}
        {isPoster && open && (job.payment_status === "escrow" || job.payment_status === "held") && !applicants.isLoading && !!applicants.data && total === 0 && (
          <NoApplicantsYet job={job} onManage={() => navigate(`/posts?highlight=${encodeURIComponent(job.id)}&manage=1`)} />
        )}
        {(job.description?.trim() || hasVideo || (!isPoster && job.customer_id)) && (
          <div className={`space-y-4 lg:col-start-1 ${hasPhoto ? "lg:row-start-2" : "lg:row-start-1"}`}>
            {/* The poster's scope video (A2-B6), for the poster and the Helpr alike; nothing when there is none. */}
            {hasVideo && <ScopeVideo url={job.scope_video_url} />}
            {job.description?.trim() && (
              <section aria-labelledby="job-page-details" className={`${CARD} p-4 lg:p-5`}>
                <h2 id="job-page-details" className="text-ds-16 font-semibold">Details</h2>
                <p className="mt-1.5 whitespace-pre-line text-ds-15 leading-relaxed [overflow-wrap:anywhere]">{job.description.trim()}</p>
              </section>
            )}
            {!isPoster && job.customer_id && <PostedBy posterId={job.customer_id} />}
          </div>
        )}
      </div>
      {!isPoster && <PageApplySheet apply={apply} />}
    </AppPage>
  );
}
