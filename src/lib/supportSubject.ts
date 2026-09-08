/**
 * The `?subject=` a job's "Contact Admin" chip hands to /support.
 *
 * It used to be `Dispute on job <uuid>`, chosen so the URL carries nothing
 * personal. Right instinct, wrong noun: the person then landed on a form whose
 * subject line was a 36-character hex string they did not write and could not
 * recognise, clipped mid-token at 375 ("Dispute on job 3f2a9c1e-7b4d-4e8a…").
 * A job's title is what the poster typed to describe the work and is already
 * public on Browse, so it discloses nothing the UUID did not — and it is the
 * name both people actually use for the job. The short id stays on the end so
 * support can still find the row without asking "which job?".
 *
 * Fallback: an anonymised job (account deletion blanks title to nothing useful)
 * or a missing title falls back to the short id alone.
 */
const SUBJECT_MAX = 120; // mirrors Support.tsx — the input's own maxLength

export function shortJobId(id: string): string {
  return id.slice(0, 8);
}

export function disputeSupportSubject(job: { id: string; title?: string | null }): string {
  const title = (job.title ?? "").trim();
  const tail = ` (job #${shortJobId(job.id)})`;
  if (!title) return `Dispute on job #${shortJobId(job.id)}`;
  const head = "Dispute on ";
  const room = SUBJECT_MAX - head.length - tail.length - 2; // the two quotes
  const shown = title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title;
  return `${head}"${shown}"${tail}`;
}
