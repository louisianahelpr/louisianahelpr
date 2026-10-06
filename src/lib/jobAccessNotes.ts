import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";

/**
 * Write the poster's Access & Parking notes for one job (Q1438).
 *
 * They live in public.job_access_notes, not on the job row, because they can
 * hold a gate code: RLS lets only the poster and the booked Helpr(s) read
 * them, and nothing in browse joins that table. The poster is the only writer
 * (and not once a Helpr is booked: enforce_job_access_notes_write, Q1204
 * parity), so this is called by the post flow right after the job insert and
 * by EditJobDialog.
 *
 *   text with content -> upsert the one row (the post flow's retry and the
 *                        edit dialog both land here; upsert keeps it one row)
 *   blank             -> delete the row; zero rows is legitimate there (there
 *                        may never have been a note), so that delete is not
 *                        held to a row count.
 *
 * A null error is not a write (CLAUDE.md): the upsert ends in .select() and
 * goes through unwrapMutation, so an RLS refusal that returns no row throws.
 */
export async function saveJobAccessNote(jobId: string, text: string): Promise<void> {
  const notes = text.trim();
  if (!notes) {
    // Zero rows is legitimate: a job that never had a note. The error still throws.
    const { error } = await supabase.from("job_access_notes").delete().eq("job_id", jobId);
    if (error) throw error;
    return;
  }
  unwrapMutation(
    await supabase
      .from("job_access_notes")
      .upsert({ job_id: jobId, notes }, { onConflict: "job_id" })
      .select("job_id"),
    { action: "save the access and parking notes", context: { job_id: jobId } },
  );
}
