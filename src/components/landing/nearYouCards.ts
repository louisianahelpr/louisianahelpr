import { jobCategoryLabel } from "@/lib/jobCategories";
import type { FreshItem } from "./FreshDeclutterSection";
import { liveJobDate, liveJobPrice, type LiveJob } from "./LiveJobsSection";
import type { LandingMode } from "./landingMode";

/**
 * A job as its Near you card draws it, worked out here (the page chunk) so the lazy grid chunk imports neither the
 * jobs read nor the category list: importing them from there regrouped shared chunks and put /declutter/item/:id's
 * critical path over its budget (measured 445 KB gz against 400 + 5%, scripts/perf/critical-path.mjs, 11-10).
 */
export type NearJob = { id: string; title: string; label: string; where: string; price: string };

/** One card in "Near you this week": an open job or a Declutter listing. */
export type NearCard = { kind: "job"; job: NearJob } | { kind: "item"; item: FreshItem };

/** Two rows of four from lg, four rows of two on a phone. */
export const NEAR_YOU_LIMIT = 8;

function nearJob(j: LiveJob): NearJob {
  const date = liveJobDate(j.date_needed);
  return {
    id: j.id,
    title: j.title,
    label: j.category ? jobCategoryLabel(j.category) : "Help wanted",
    where: [j.parish ? `${j.parish} Parish` : null, date].filter(Boolean).join(", "),
    // The Helpr's take-home, the /browse card's number (liveJobPrice).
    price: liveJobPrice(j),
  };
}

/**
 * Direction A (owner 11-10, "Porch and Parish"): jobs and Declutter items side by side, one grid. The hero's Jobs |
 * Declutter choice (landingMode.ts) decides which comes first (D001: the section follows the hero's one switch), and the
 * two alternate while both last; the rest are the other kind. With no open job the grid is all Declutter items, and with
 * no item all jobs (D003: never an empty card while either has something to show).
 */
export function mixNearCards(jobs: LiveJob[], items: FreshItem[], mode: LandingMode, limit = NEAR_YOU_LIMIT): NearCard[] {
  const j: NearCard[] = jobs.map((job) => ({ kind: "job", job: nearJob(job) }));
  const i: NearCard[] = items.map((item) => ({ kind: "item", item }));
  const [first, second] = mode === "declutter" ? [i, j] : [j, i];
  const out: NearCard[] = [];
  for (let n = 0; out.length < limit && (n < first.length || n < second.length); n++) {
    if (n < first.length) out.push(first[n]);
    if (out.length < limit && n < second.length) out.push(second[n]);
  }
  return out;
}
