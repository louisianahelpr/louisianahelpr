/**
 * Declutter haul-away (docs/specs/declutter-haul-away.md): the small, pure
 * pieces (the `?haulAway=` parse, the row shape, which rows one trip takes,
 * which job may be deleted). Loaded only through ./haulAway, which both
 * screens load on demand; My listings' render-time pieces are ./haulAwayLink.
 * Nothing here is imported statically by a screen (only its types): a module
 * two signed-in chunks share lands in the signed-in-shared chunk on /posts'
 * critical path (Q178; measured 2026-10-17).
 */
import type { DeliverySize } from "@/lib/declutter/api";

/**
 * Most items one haul-away takes (the server refuses more: haul_away_too_many).
 * The same number as ./haulAwayLink's HAUL_AWAY_MAX_ITEMS, restated rather
 * than imported so the Declutter screen shares no module with this one
 * (src/lib/declutter/haulAway.test.ts keeps the two equal).
 */
export const HAUL_AWAY_PARSE_MAX = 10;

/** Server states (declutter_haul_away_state). */
export type HaulAwayState =
  | "eligible" | "too_soon" | "in_sale" | "hauled" | "booked" | "paying" | "unpaid" | "not_unsold";

export interface HaulAwayRow {
  item_id: string;
  title: string;
  description: string;
  delivery_size: DeliverySize;
  item_status: string;
  state: HaulAwayState;
  /** When a live item can be hauled (14 days after it went live); null when not live. */
  eligible_at: string | null;
  job_id: string | null;
  /** Same value = same pickup address (the address itself is not in this row). */
  pickup_group: string;
  photo_paths: string[];
  /**
   * The linked job's hold (declutter_haul_job_hold): 'job_open' is the only one
   * the app may delete; 'job_stuck' (a declined card) the poster's DELETE policy
   * refuses. Null when not linked.
   */
  job_hold: "none" | "job_open" | "job_stuck" | "paying" | "hauled" | "booked" | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?haulAway=` -> the item ids: valid uuids only, no repeats, at most 10. Empty when none. */
export function parseHaulAwayParam(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s));
  return [...new Set(ids)].slice(0, HAUL_AWAY_PARSE_MAX);
}

/**
 * Can this row go on a NEW haul-away job as it stands? Eligible, or an unpaid
 * earlier post whose job is already gone or cancelled (hold 'none'). The same
 * rule as declutter_link_haul_away, which moves a link only off a job holding
 * nothing: an unpaid post whose job is still open ('job_open', 'job_stuck') is
 * refused there (haul_away_job_open), so it is never offered here; "Finish
 * booking" on its listing deletes that job first.
 */
export function isPostable(row: Pick<HaulAwayRow, "state" | "job_hold">): boolean {
  return row.state === "eligible" || (row.state === "unpaid" && row.job_hold === "none");
}

/**
 * The seller's items that can go in ONE haul-away trip: postable, from the
 * pickup address with the most of them. Empty when none.
 */
export function oneTripGroup(rows: HaulAwayRow[]): HaulAwayRow[] {
  const groups = new Map<string, HaulAwayRow[]>();
  for (const r of rows.filter(isPostable)) groups.set(r.pickup_group, [...(groups.get(r.pickup_group) ?? []), r]);
  let best: HaulAwayRow[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best.slice(0, HAUL_AWAY_PARSE_MAX);
}

/**
 * The job My listings must delete before "Finish booking" / "Put back on sale":
 * only an open, never-paid one with no live checkout that the poster's DELETE
 * policy allows ('job_open'). A cancelled job (hold 'none') is never deleted:
 * it stays on record with its photos; a 'job_stuck' one cannot be.
 */
export function haulJobToDelete(row: Pick<HaulAwayRow, "job_id" | "job_hold">): string | null {
  return row.job_id && row.job_hold === "job_open" ? row.job_id : null;
}
