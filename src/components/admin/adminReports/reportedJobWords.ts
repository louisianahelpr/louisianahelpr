/**
 * App audit 11-23 HA-08: a job review report ('review', ReviewsSection) holds the REVIEW's id and a message report
 * ('message', Messages) the MESSAGE's id, never a person. The queue looked both up as a person, found no profile, and
 * titled the card "Deleted account — retaliation" with Message Reported greyed out. The person is the review's writer
 * (reviews.reviewer_id) or the message's sender (messages.sender_id), and the context is its job. Admins read every
 * review ("Admins can view all reviews") and every reported message ("Admins can view reported or hidden messages").
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

const JOB_REVIEW_REPORT = "review";
const MESSAGE_REPORT = "message";
export const isJobWordsReport = (t: string) => t === JOB_REVIEW_REPORT || t === MESSAGE_REPORT;

export type JobWords = { author: string | null; jobId: string | null; rating: number | null };

/** Reviews and messages by id. A failed read is reported and leaves its rows out (they then read "… unavailable"). */
export async function hydrateReportedJobWords(rows: { reported_type: string; reported_id: string }[]): Promise<{
  words: Map<string, JobWords>;
  failed: boolean;
}> {
  const idsOf = (t: string) => [...new Set(rows.filter((r) => r.reported_type === t).map((r) => r.reported_id))];
  const reviewIds = idsOf(JOB_REVIEW_REPORT);
  const messageIds = idsOf(MESSAGE_REPORT);
  const words = new Map<string, JobWords>();
  let failed = false;
  if (reviewIds.length > 0) {
    const { data, error } = await supabase.from("reviews").select("id, reviewer_id, job_id, rating").in("id", reviewIds);
    if (error) { failed = true; report(error, { severity: "warning", tags: { source: "AdminReports.hydrateJobReviews" } }); }
    for (const r of data ?? []) words.set(r.id, { author: r.reviewer_id ?? null, jobId: r.job_id ?? null, rating: r.rating ?? null });
  }
  if (messageIds.length > 0) {
    const { data, error } = await supabase.from("messages").select("id, sender_id, job_id").in("id", messageIds);
    if (error) { failed = true; report(error, { severity: "warning", tags: { source: "AdminReports.hydrateMessages" } }); }
    for (const m of data ?? []) words.set(m.id, { author: m.sender_id ?? null, jobId: m.job_id ?? null, rating: null });
  }
  return { words, failed };
}

/** The card's title: who wrote it and on which job, or that it is gone / could not be read. */
export function jobWordsSubject(type: string, w: JobWords | undefined, failed: boolean, nameFor: (id: string | null) => string, jobTitle: (id: string | null) => string | undefined): string {
  const part = type === JOB_REVIEW_REPORT ? "review" : "message";
  if (!w) return failed ? `${part === "review" ? "Review" : "Message"} unavailable` : `Deleted ${part}`;
  const title = jobTitle(w.jobId);
  const stars = type === JOB_REVIEW_REPORT && w.rating != null ? ` (${w.rating} star${w.rating === 1 ? "" : "s"})` : "";
  return title ? `${nameFor(w.author)} · ${part}${stars} on "${title}"` : `${nameFor(w.author)} · ${part}${stars}`;
}
