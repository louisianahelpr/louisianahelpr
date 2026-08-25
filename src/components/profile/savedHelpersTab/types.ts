export type SavedSort = "rebooked" | "recent" | "rating" | "alpha";

export const sortOptions: { value: SavedSort; label: string }[] = [
  { value: "recent", label: "Recent activity" },
  { value: "rating", label: "Rating" },
  { value: "rebooked", label: "Jobs together" },
  { value: "alpha", label: "Alphabetical" },
];

export interface SavedHelper {
  helper_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  parish: string | null;
  skills: string | null;
  hourly_rate: number | null;
  saved_at: string;
  completed_jobs_together: number;
  last_job_at: string | null;
  /** Average rating from the helper's public review wall. Optional —
      the get_my_saved_helpers RPC may not surface it on older
      deploys; the Rating sort treats missing values as 0. */
  avg_rating?: number | null;
  /** Poster-only note. Surfaced by the get_my_saved_helpers RPC once
      migration 20260609110000 is applied; nullable so older deploys
      return undefined. */
  private_note?: string | null;
}

export interface SavedHelpersTabProps {
  onBack: () => void;
}
