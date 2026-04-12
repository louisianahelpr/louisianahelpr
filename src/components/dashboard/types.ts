import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

export type EnrichedJob = Partial<Job> & Pick<Job, "id" | "title" | "description" | "category" | "budget" | "date_needed" | "location" | "customer_id" | "status" | "created_at"> & {
  posterName?: string;
  posterReviewCount?: number;
  posterAvgRating?: number;
  posterCompletedJobs?: number;
  isBoosted?: boolean;
};
