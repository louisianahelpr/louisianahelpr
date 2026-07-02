// Shape of a row from get_ranked_open_jobs. The RPC returns the full job
// detail set; we type the subset the guest browse card actually reads.
export interface PublicJob {
  id: string;
  title: string;
  description: string | null;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  start_time: string | null;
  is_urgent: boolean | null;
  urgent_fee: number | null;
  is_recurring: boolean | null;
  recurrence_interval: string | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  created_at: string;
  expires_at: string | null;
  boost_expires_at: string | null;
  pricing_mode?: string | null;
}

export interface JobsPage {
  jobs: PublicJob[];
  nextOffset: number | null;
}
