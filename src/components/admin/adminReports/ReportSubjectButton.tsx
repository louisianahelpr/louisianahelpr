/**
 * The first button on a report row (split out of AdminReports.tsx, componentSizeRatchet, posting audit 10-30 #8).
 * `reported_id` is a JOB id for job reports, and this button sent every one of them to /user/<job-id>, a profile page
 * that 404s (seen on the live queue 2026-09-07: "Deleted job, Spam or scam" offered "View Profile"). So it routes by
 * subject and is disabled when the subject is gone. A review or message report carries that row's id, not a person's,
 * so it has no profile to open. A Wanted report opens its poster: the post itself reads in WantedReportPanel.
 */
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LISTING_REPORT } from "./reportedListings";
import type { Report } from "./reportType";

export function ReportSubjectButton({ report }: { report: Report }) {
  const navigate = useNavigate();
  if (report.reported_type === "job") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={!report.reported_job_exists}
        title={!report.reported_job_exists ? "This job no longer exists" : undefined}
        onClick={() => navigate(`/jobs/${report.reported_id}`)}
      >
        <ExternalLink className="w-3.5 h-3.5 mr-1" /> View Job
      </Button>
    );
  }
  if (report.reported_type === LISTING_REPORT) {
    return (
      <Button size="sm" variant="outline" onClick={() => navigate(`/declutter/item/${report.reported_id}`)}>
        <ExternalLink className="w-3.5 h-3.5 mr-1" /> View Listing
      </Button>
    );
  }
  if (report.reported_type === "review" || report.reported_type === "message") return null;
  // A deleted poster or an unreadable post leaves no person to open, and reported_id is a post id, never a profile.
  if (report.reported_type === "declutter_wanted" && !report.subject_user_id) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={report.reported_exists === false}
      title={report.reported_exists === false ? "This account no longer exists" : undefined}
      onClick={() => navigate(`/user/${report.subject_user_id ?? report.reported_id}`)}
    >
      <ExternalLink className="w-3.5 h-3.5 mr-1" /> View Profile
    </Button>
  );
}
