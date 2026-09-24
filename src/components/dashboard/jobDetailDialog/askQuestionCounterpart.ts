type JobParties = {
  customer_id: string | null;
  helper_id?: string | null;
  offered_to_helper_id?: string | null;
};

/**
 * Who "Ask a question" on a job opens a thread with (DH-002).
 * A poster reaches their hired (or offered) Helpr; anyone else reaches the
 * poster. Never the viewer themselves, and null when there is nobody on the
 * other side yet (the button is then not shown).
 */
export function askQuestionCounterpart(job: JobParties, viewerUserId: string | null): string | null {
  if (viewerUserId == null) return null;
  const other = viewerUserId === job.customer_id
    ? job.helper_id ?? job.offered_to_helper_id ?? null
    : job.customer_id;
  return other && other !== viewerUserId ? other : null;
}
