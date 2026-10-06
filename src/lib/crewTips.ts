/**
 * Q709(c), owner 2026-10-05: a completed crew card shows ONE Tip per member,
 * each showing "Tipped" once this poster has tipped THAT member. A paid tip row
 * names its member (tips.helper_id), so "tipped" is per (job, member), never
 * per job: tipping one member leaves every other member's Tip live.
 *
 * `rows` are the crew's roster rows in hire order; a row whose member deleted
 * their account (helper_id NULL) has nobody to tip and is left out.
 */
export function crewTipsFor(
  jobId: string,
  rows: ReadonlyArray<{ job_id: string; helper_id: string | null }>,
  names: ReadonlyMap<string, string>,
  paidTips: ReadonlyArray<{ job_id: string; helper_id: string | null }>,
): Array<{ id: string; name: string; tipped: boolean }> {
  const tipped = new Set(paidTips.map((t) => `${t.job_id}:${t.helper_id}`));
  return rows
    .filter((r): r is { job_id: string; helper_id: string } => r.job_id === jobId && !!r.helper_id)
    .map((r) => ({
      id: r.helper_id,
      name: names.get(r.helper_id) || "Helpr",
      tipped: tipped.has(`${jobId}:${r.helper_id}`),
    }));
}
