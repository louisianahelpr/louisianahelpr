import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

import { type Job } from "../activityConstants";

interface PostedJobApplicantsProps {
  job: Job;
  applicantCounts: Record<string, number>;
  onLoadApplications: (job: Job) => void;
}

/**
 * PostedJobApplicants — the open-job "Applicants" button.
 *
 * Used to also render an inline expanded applicant list the moment the
 * whole CARD expanded (`isExpanded`), which is not the same thing as the
 * button being tapped. Tapping the button already opens the full-screen
 * ApplicantsPanel (see PostedJobsTab's `selectedJob`), so a poster who just
 * expanded the card to read its details got a second, unsolicited applicant
 * preview underneath. Owner: "applicants should not show here, only when
 * the applicants button is clicked" — removed; the button's existing
 * onLoadApplications -> ApplicantsPanel flow is the one surface now.
 *
 * The inline "Message all N applicants" broadcast composer lived only in
 * the removed block (`useBroadcastMessage`, still at
 * ./useBroadcastMessage.ts) and has no home in ApplicantsPanel today — that
 * capability is gone until/unless it's rebuilt there. Flagged, not silently
 * dropped: worth a decision if broadcasting to applicants should exist.
 */
export function PostedJobApplicants({
  job,
  applicantCounts,
  onLoadApplications,
}: PostedJobApplicantsProps) {
  return (
    <div className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" className="w-full rounded-ds-md glass-press" onClick={() => onLoadApplications(job)}>
        <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
      </Button>
    </div>
  );
}
