import { type Job, type EnrichedApplication } from "@/components/job-card/activityConstants";
import { type JobAnalytics } from "../useJobAnalytics";
import { type DistanceBand } from "../useApplicantSignals";

// Moved out of ApplicantsPanel.tsx unchanged (Q806 god-component ratchet, pure move).
export interface ApplicantsPanelProps {
  /** No longer read here — the bid-mode sort default was its only consumer,
      and bidding is gone. Kept on the interface so PostedJobsTab still
      type-checks until it stops passing it. */
  jobs?: Job[];
  selectedJob: Job;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  applicationsLoading: boolean;
  applicationsError: boolean;
  onLoadApplications: (job: Job) => void;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onDeclineApplication: (app: EnrichedApplication, note: string, jobTitle: string) => void;
  neighborCountMap: Map<string, number>;
  completedCountsMap: Map<string, number>;
  repeatHireMap: Map<string, number>;
  onTimeMap: Map<string, number>;
  distanceBandMap: Map<string, DistanceBand>;
  /** Reach for the selected job. Undefined until the view-count query
      resolves, or when the job has never been viewed — the readout is
      simply omitted in both cases rather than rendering a zero. */
  jobAnalytics?: JobAnalytics;
  /** Opens JobBoostDialog / EditJobDialog for the selected job. Both are
      already state on the Activity page (useActivityActions' `setBoostJobId`
      and `setEditJob`); they are threaded down here so the "nobody has
      applied" empty state can offer the two levers that actually change the
      outcome, instead of naming them in prose and leaving the poster to go
      find the controls on the card behind this overlay. Optional: the empty
      state omits a lever it cannot open rather than rendering a dead one. */
  onBoost?: (jobId: string) => void;
  onEdit?: (job: Job) => void;
}
