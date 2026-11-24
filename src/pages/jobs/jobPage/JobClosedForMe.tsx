import { useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { jobDayLabel } from "@/lib/jobDateWindow";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enJobs";
import type { useJobPage } from "./useJobPage";

/**
 * #33 (deep audit 11-22): the Helpr applied and the job closed to them, so the job itself can't be read. The page
 * says what their Working row says: the job's own name, its day and "no longer available" (useJobPage's closedForMe).
 * Null when there is nothing to say yet or the viewer never applied: JobPage then shows its plain "not available".
 */
export function JobClosedForMe({ closedForMe }: { closedForMe: ReturnType<typeof useJobPage>["closedForMe"] }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  if (closedForMe?.isPending) {
    return (
      <AppPage title={t("jobPage.title")} backTo="/jobs">
        <div role="status" aria-busy="true" aria-label={t("jobPage.loading")}><JobCardSkeleton /></div>
      </AppPage>
    );
  }
  const closed = closedForMe?.data;
  if (closed) {
    const closedTitle = closed.label?.title?.trim();
    const closedDay = closed.label?.date_needed ? jobDayLabel(closed.label) : null;
    return (
      <AppPage title={closedTitle || t("jobPage.title")} backTo="/jobs">
        <EmptyState
          variant="inline"
          icon={Briefcase}
          title={closed.status}
          body={closedDay ? `${closedDay} · ${t("jobPage.closedBody")}` : t("jobPage.closedBody")}
          action={<Button variant="outline" size="sm" className="rounded-full" onClick={() => navigate("/jobs")}>{t("jobPage.browseJobs")}</Button>}
        />
      </AppPage>
    );
  }
  return null;
}
