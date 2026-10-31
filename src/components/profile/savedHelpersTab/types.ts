// NIGHT-SAVEDS1-SS-6: no "Rating" sort. get_my_saved_helpers returns no rating (newest definition,
// 20261021131322), so every row sorted as 0 and the option did nothing. Each sort here reads a field the RPC returns
// (guard: src/test/savedHelprsSortsReadRealFields.test.ts).
export type SavedSort = "rebooked" | "recent" | "alpha";

export const sortOptions: { value: SavedSort; label: string }[] = [
  { value: "recent", label: "Recent activity" },
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
  saved_at: string;
  completed_jobs_together: number;
  last_job_at: string | null;
  /** Poster-only note. Surfaced by the get_my_saved_helpers RPC once
      migration 20260609110000 is applied; nullable so older deploys
      return undefined. */
  private_note?: string | null;
}

export interface SavedHelpersTabProps {
  onBack: () => void;
}
