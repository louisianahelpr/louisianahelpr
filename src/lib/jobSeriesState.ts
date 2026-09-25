import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { JOB_SERIES_STATE_COLUMNS } from "@/lib/jobColumns";

/** The recurring-series state of one jobs row (see JOB_SERIES_STATE_COLUMNS). */
export type JobSeriesState = { series_ended_on?: string | null; series_split_ok?: boolean };

/**
 * A column the database does not have yet: Postgres 42703 through PostgREST,
 * or PostgREST's own schema-cache miss. This is the deploy-lag window between
 * the web deploy and db-deploy (see JOB_SERIES_STATE_COLUMNS).
 */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "42703" || code === "PGRST204" || /column .* does not exist/i.test(String(error.message ?? ""));
}

/**
 * The series columns for `jobIds`, keyed by id. NEVER throws: a missing column
 * (the migration has not landed yet) is an empty map, silently; any other
 * failure is reported as a warning and is also an empty map, so the cards
 * render as a running series rather than the whole Activity read failing.
 */
export async function fetchJobSeriesState(jobIds: string[]): Promise<Map<string, JobSeriesState>> {
  const out = new Map<string, JobSeriesState>();
  const ids = [...new Set(jobIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("jobs")
    .select(["id", ...JOB_SERIES_STATE_COLUMNS].join(", "))
    .in("id", ids);
  if (error) {
    if (!isMissingColumnError(error)) {
      report(error, { severity: "warning", tags: { source: "jobSeriesState.fetch" } });
    }
    return out;
  }
  for (const row of (data ?? []) as unknown as Array<{ id: string } & JobSeriesState>) {
    const { id, ...state } = row;
    out.set(id, state);
  }
  return out;
}
