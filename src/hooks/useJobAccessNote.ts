import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * The poster's Access & Parking notes for one job (Q1461), or null.
 *
 * WHO GETS A ROW is decided by the database, not here: job_access_notes'
 * SELECT policy (can_read_job_access_notes, 20261006204113) returns it only to
 * the poster, the job's Helpr, the series' standing Helpr and the crew roster.
 * Everyone else reads zero rows, which is null. `enabled` only saves the
 * request on cards that could not be one of those (and on collapsed cards).
 *
 * The one tolerated failure is a table the database does not have yet (the
 * minutes between the web deploy and db-deploy): that is "no note". Any other
 * error throws.
 */
const ACCESS_NOTES_NOT_DEPLOYED = new Set(["42P01", "PGRST205"]);

export async function fetchJobAccessNote(jobId: string): Promise<string | null> {
  const { data, error } = await supabase.from("job_access_notes").select("notes").eq("job_id", jobId).maybeSingle();
  if (error) {
    if (ACCESS_NOTES_NOT_DEPLOYED.has(String(error.code ?? ""))) return null;
    throw error;
  }
  return data?.notes ?? null;
}

/**
 * The note, read once the surface is open. A plain effect rather than a React
 * Query query on purpose: the cards and dialogs that show it are rendered in
 * many places (and tests) with no QueryClient, and a small primary-key read
 * per opened card needs no cache. A failed read is REPORTED (never silent) and
 * the surface shows no note, exactly as for a viewer the database withholds it
 * from; it never takes the card down.
 */
export function useJobAccessNote(jobId: string | null | undefined, enabled: boolean): string | null {
  const [note, setNote] = useState<{ jobId: string; notes: string | null } | null>(null);
  useEffect(() => {
    if (!jobId || !enabled) return;
    let live = true;
    fetchJobAccessNote(jobId).then(
      (notes) => { if (live) setNote({ jobId, notes }); },
      (err: unknown) => report(err, { severity: "warning", tags: { source: "useJobAccessNote" }, context: { job_id: jobId } }),
    );
    return () => { live = false; };
  }, [jobId, enabled]);
  // A note read for another job (the surface was reused) is never shown.
  return note && note.jobId === jobId ? note.notes : null;
}
