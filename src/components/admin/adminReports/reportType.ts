import type { ReportedWanted } from "@/lib/declutter/api";

/** One row of the admin reports queue. */
export type Report = {
  id: string;
  // Nullable since 20260902051631 — the reporter may have deleted their account.
  reporter_id: string | null;
  reported_id: string;
  reported_type: string;
  reason: string;
  description: string | null;
  /** Messages audit M2: the reported message's words, copied by the database when the report was filed. */
  reported_content?: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
  /** False when the actor has no `profiles` row — messaging them is a no-op. */
  reporter_exists?: boolean;
  reported_exists?: boolean;
  reported_job_exists?: boolean;
  /** Item B: a reported listing still up (live, paused or held), so an admin can take it down. */
  reported_listing_down_ok?: boolean;
  /** Audit 10-30 #8: a reported Wanted post, read through declutter_admin_reported_wanted. */
  reported_wanted?: ReportedWanted;
  /** B48: a reported Declutter question already removed, so the card offers no take-down. */
  reported_question_gone?: boolean;
  /** Q366: the person behind the subject — `reported_id` for a user report,
   *  the application's helper for an application report, null otherwise. */
  subject_user_id?: string | null;
  /** Q368: the reported person/job or the reporter is a seed row. */
  is_test?: boolean;
  assigned_to_name?: string;
};
