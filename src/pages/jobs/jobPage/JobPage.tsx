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
import { useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { DeclutterGallery } from "@/components/declutter/DeclutterGallery";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { formatCategory } from "@/lib/format";
import { getCity } from "@/lib/locationUtils";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { jobCategoryGroupOf, JOB_CATEGORY_GROUPS, sentenceCaseLabel } from "@/lib/jobCategoryGroups";
import { useJobPage, type JobPageRow } from "./useJobPage";
import { JobTracker, PosterMoney, HelprMoney, PostedBy } from "./JobPageParts";

function groupLabel(category: string): string | null {
  const id = jobCategoryGroupOf(category);
  if (!id || id === "other") return null;
  return JOB_CATEGORY_GROUPS.find((g) => g.id === id)?.label ?? null;
}

/** "Sat, Oct 31 · 9:00 AM · Delcambre": only the parts the job really has. */
function metaLine(job: JobPageRow): string {
  return [
    job.date_needed ? formatJobDate(job.date_needed) : null,
    jobStartTimeLabel(job.start_time, job.is_flexible_schedule),
    job.location ? getCity(job.location) : null,
  ].filter(Boolean).join(" · ");
}

const CARD = "rounded-2xl border border-border bg-card";

export default function JobPage({ id, userId }: { id: string; userId: string }) {
  const navigate = useNavigate();
  const { job: q, applicants, isPoster } = useJobPage(id, userId);

  if (q.isLoading) {
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
  const isHired = !isPoster && !!job.helper_id && job.helper_id === userId;
  const category = sentenceCaseLabel(categoryLabels[job.category] ?? formatCategory(job.category));
  const group = groupLabel(job.category);
  const meta = metaLine(job);
  const open = job.status === "open";
  const pending = applicants.data?.pending ?? 0;
  const total = applicants.data?.total ?? 0;
  // The Apply sheet (with its note field and the server's own checks) is the
  // quick-apply flow; the page opens it rather than growing a second one.
  const canApply = !isPoster && !party && open;

  const primary = isPoster
    ? {
        label: open && pending > 0 ? `Review ${pending} applicant${pending === 1 ? "" : "s"}` : "Open in Posted",
        go: () => navigate(`/posts?highlight=${encodeURIComponent(job.id)}`),
      }
    : isHired
      ? { label: "Open in Working", go: () => navigate("/jobs?tab=working") }
      : canApply
        ? { label: "Apply", go: () => navigate(`/home?quickApply=${encodeURIComponent(job.id)}`) }
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
            job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: job.location ? getCity(job.location) : undefined }}
          />
        ) : undefined
      }
    >
      <div data-job-page="" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-x-8 lg:gap-y-6">
        <div className="lg:col-start-1 lg:row-start-1">
          <DeclutterGallery urls={job.photos ?? []} category={job.category} title={job.title} icon={getCategoryIcon(job.category)} shape="banner" />
        </div>

        <section
          aria-label="Job summary"
          className={`space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-5`}
        >
          <div className="space-y-1">
            <p className="text-ds-13 font-semibold text-primary">{group ? `${group} · ${category}` : category}</p>
            <h2 className="text-ds-24 font-bold leading-tight [overflow-wrap:anywhere]">{job.title}</h2>
            {meta && <p data-job-meta="" className="text-ds-14 text-muted-foreground">{meta}</p>}
          </div>
          <JobTracker status={job.status} side={isPoster ? "poster" : isHired ? "helpr" : null} />
          {isPoster ? (
            <PosterMoney job={job} total={total} loading={applicants.isLoading} />
          ) : (
            <HelprMoney job={job} />
          )}
          {primary && (
            <Button variant="primary" size="lg" className="w-full rounded-full text-ds-16" onClick={primary.go}>
              {primary.label}
            </Button>
          )}
          {!isPoster && !isHired && <p className="text-ds-13 text-muted-foreground">The street address is shared after you're hired.</p>}
        </section>


        {(job.description?.trim() || (!isPoster && job.customer_id)) && (
          <div className="space-y-4 lg:col-start-1 lg:row-start-2">
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
    </AppPage>
  );
}
