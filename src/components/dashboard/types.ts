import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

export type EnrichedJob = Partial<Job> & Pick<Job, "id" | "title" | "description" | "category" | "budget" | "date_needed" | "location" | "customer_id" | "status" | "created_at"> & {
  posterName?: string;
  posterAvatarUrl?: string | null;
  posterReviewCount?: number;
  posterAvgRating?: number;
  posterCompletedJobs?: number;
  posterSubscriptionTier?: string | null;
  isBoosted?: boolean;
  /**
   * Social-proof + trust signals added in migration 20260616120000
   * (browse_card_signals). Both are optional because that migration is
   * not auto-deployed — until `supabase db push` runs, the feed query
   * leaves them unset and the card hides the signals:
   *   - applicant_count: helpers who have already applied (view column).
   *   - posterIdVerified: poster completed ID verification (get_safe_profiles).
   */
  applicant_count?: number;
  posterIdVerified?: boolean;
  /**
   * Q1409: on a crew, how many spots a Helpr can apply for right now
   * (public.crew_spots_open via open_jobs_browse; read by fetchCrewSpotsOpen
   * after the main list). Unset until it is read, and on single jobs.
   */
  crew_spots_open?: number | null;
};
