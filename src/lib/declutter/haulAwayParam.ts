/**
 * Declutter haul-away (docs/specs/declutter-haul-away.md): the small, pure
 * pieces the screens need at render (the `?haulAway=` link, the row shape,
 * which rows one trip takes). Kept apart from ./haulAway (the server calls),
 * which both screens load only when needed: a module two signed-in chunks
 * share lands in the signed-in-shared chunk on /posts' critical path (Q178).
 */
import type { DeliverySize } from "@/lib/declutter/api";

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
  /** The linked job's hold: 'job_open' is the only one the app may delete. Null when not linked. */
  job_hold: "none" | "job_open" | "paying" | "hauled" | "booked" | null;
}

/** Most items one haul-away takes (the server refuses more: haul_away_too_many). */
const HAUL_AWAY_MAX_ITEMS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?haulAway=` -> the item ids: valid uuids only, no repeats, at most 10. Empty when none. */
export function parseHaulAwayParam(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s));
  return [...new Set(ids)].slice(0, HAUL_AWAY_MAX_ITEMS);
}

/** The Post a Job link for these items. */
export function haulAwayPostJobPath(itemIds: string[]): string {
  return `/post-job?haulAway=${itemIds.slice(0, HAUL_AWAY_MAX_ITEMS).join(",")}`;
}

/** Can these rows be posted as one haul-away? Eligible, or an unpaid earlier post. */
export function isPostable(row: Pick<HaulAwayRow, "state">): boolean {
  return row.state === "eligible" || row.state === "unpaid";
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
  return best.slice(0, HAUL_AWAY_MAX_ITEMS);
}

/** Whole days until a too-soon item can be hauled (at least 1). */
export function daysUntil(iso: string | null, now = Date.now()): number {
  if (!iso) return 1;
  return Math.max(1, Math.ceil((Date.parse(iso) - now) / 86_400_000));
}

/**
 * The job My listings must delete before "Book it again" / "Put back on sale":
 * only an open, never-paid one with no live checkout ('job_open'). A cancelled
 * job (hold 'none') is never deleted: it stays on record with its photos.
 */
export function haulJobToDelete(row: Pick<HaulAwayRow, "job_id" | "job_hold">): string | null {
  return row.job_id && row.job_hold === "job_open" ? row.job_id : null;
}
