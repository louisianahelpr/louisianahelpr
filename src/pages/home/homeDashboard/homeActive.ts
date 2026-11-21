/**
 * "Your active listings and jobs" on Home (owner polish 11-20), derived from the reads Home already makes: the posted
 * jobs still looking for help (status "open"; a booked one is in Coming up) and the member's live Declutter listings.
 * Newest first within each kind, jobs before listings. No request of its own. Guard: src/test/homeMoreRows1120.test.tsx.
 */
export type HomeActiveItem =
  | { kind: "job"; id: string; title: string; to: string; applicants: number }
  | { kind: "item"; id: string; title: string; to: string; priceCents: number };

type PostedLike = { id: string; title?: string | null; status: string; created_at?: string | null };
type ItemLike = { id: string; title?: string | null; status: string; current_price_cents?: number | null; live_at?: string | null };

/** The reads the list is derived from (useHomeSummary's `activeFrom`), handed to the lazy HomeMoreRows. */
export interface HomeActiveSource {
  postedJobs: readonly PostedLike[];
  pendingApplicantCounts: Readonly<Record<string, number>>;
  items: readonly ItemLike[];
}

const newestFirst =(a?: string | null, b?: string | null) => (b ?? "").localeCompare(a ?? "");

export function deriveHomeActive(
  postedJobs: readonly PostedLike[],
  pendingApplicantCounts: Readonly<Record<string, number>>,
  items: readonly ItemLike[],
): HomeActiveItem[] {
  const jobs: HomeActiveItem[] = postedJobs
    .filter((j) => j.status === "open")
    .slice()
    .sort((a, b) => newestFirst(a.created_at, b.created_at))
    .map((j) => ({ kind: "job", id: `job-${j.id}`, title: j.title ?? "", to: `/jobs/${j.id}`, applicants: pendingApplicantCounts[j.id] ?? 0 }));
  const listings: HomeActiveItem[] = items
    .filter((i) => i.status === "live")
    .slice()
    .sort((a, b) => newestFirst(a.live_at, b.live_at))
    .map((i) => ({ kind: "item", id: `item-${i.id}`, title: i.title ?? "", to: `/declutter/item/${i.id}`, priceCents: i.current_price_cents ?? 0 }));
  return [...jobs, ...listings];
}
