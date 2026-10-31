import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export type ClosedJobLabel = { title: string | null; date_needed: string | null };

/**
 * JOBS-12: the title and date of jobs closed to this Helpr. Never throws: without them the row keeps its plain line.
 * A missing function (isMissingRpcNamed) is the few minutes before db-deploy finishes; any other error is reported.
 */
export async function fetchClosedJobLabels(needed: boolean): Promise<Map<string, ClosedJobLabel>> {
  if (!needed) return new Map();
  const { data, error } = await supabase.rpc("get_closed_application_job_labels");
  if (error) {
    if (!isMissingRpcNamed(error, "get_closed_application_job_labels")) report(error, { severity: "warning", tags: { source: "useActivityData.closedJobLabels" } });
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.job_id, { title: row.title, date_needed: row.date_needed }]));
}
