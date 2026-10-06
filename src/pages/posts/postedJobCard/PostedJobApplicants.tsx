import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

import { type Job } from "../../../components/job-card/activityConstants";
import { takesApplicants } from "./crewRefill";

interface PostedJobApplicantsProps {
  job: Job;
  /** The crew's roster (group jobs): a booked crew a member left takes
   *  applicants for the free spot (Q1378). Undefined on single jobs. */
  crewRoster?: readonly unknown[];
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
 * The inline "Message all N applicants" broadcast composer was removed
 * (owner: no product need for bulk-messaging applicants) along with its
 * BroadcastComposer/useBroadcastMessage implementation.
 */
export function PostedJobApplicants({
  job,
  crewRoster,
  applicantCounts,
  onLoadApplications,
}: PostedJobApplicantsProps) {
  // An open job, or a booked crew with a free spot before its start (Q1378).
  if (!takesApplicants(job, crewRoster)) return null;
  return (
    <div className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" className="w-full rounded-ds-md glass-press" onClick={() => onLoadApplications(job)}>
        <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
      </Button>
    </div>
  );
}
