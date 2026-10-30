/**
 * The reports queue's half for a reported Wanted post (posting audit 10-30 #8). A Wanted report's `reported_id` is a
 * declutter_wanted id, never a person: its words, poster, photos and test flag are read through
 * declutter_admin_reported_wanted, because the post's own policy shows it only to its poster.
 */
import type { ReportedWanted } from "@/lib/declutter/api";
import { report } from "@/lib/errorLogger";

export const WANTED_REPORT = "declutter_wanted";

/** Posts by id. A failed read is reported and yields an empty map (each row then reads "Wanted post unavailable"). */
export async function hydrateReportedWanted(rows: { reported_type: string; reported_id: string }[]): Promise<{
  posts: Map<string, ReportedWanted>;
  failed: boolean;
}> {
  const ids = [...new Set(rows.filter((r) => r.reported_type === WANTED_REPORT).map((r) => r.reported_id))];
  const posts = new Map<string, ReportedWanted>();
  if (ids.length === 0) return { posts, failed: false };
  try {
    const { fetchReportedWanted } = await import("@/lib/declutter/api");
    for (const p of await fetchReportedWanted(ids)) posts.set(p.wanted_id, p);
    return { posts, failed: false };
  } catch (err) {
    // Never blank the queue over a name read: reported, and the rows say the post is unavailable.
    report(err, { severity: "warning", tags: { source: "AdminReports.hydrateWanted" } });
    return { posts, failed: true };
  }
}

/** What the card calls a reported Wanted post. */
export function wantedSubject(post: ReportedWanted | undefined, failed: boolean): string {
  if (post) return `Wanted post "${post.what}"`;
  return failed ? "Wanted post unavailable" : "Deleted Wanted post";
}
