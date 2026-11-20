/**
 * CMP-5 (lead decision 2026-10-30 05:00Z): a paid listing live 14 days with no sale and no accepted offer gets ONE
 * nudge, "<item> hasn't sold yet. Drop the price?", suggesting about 15% lower (whole dollars, never below the
 * seller's lowest price), linking to Manage with that price filled in. Free items, items whose price drops are on,
 * and test data never get one. Selling shows the same nudge as a row. The server sweep sends the notice (once per
 * listing per 14 days); this file is the rule the screen shows, kept pure so both Selling and its tests read it.
 */

/** Days live, unsold, before the nudge. */
export const PRICE_NUDGE_DAYS = 14;
/** The suggested cut: about 15% off. */
const PRICE_NUDGE_PCT = 15;
/** The lowest price Declutter takes ($1). */
const MIN_PRICE_CENTS = 100;

/**
 * The price to suggest: about 15% below now, in whole dollars, never below the lowest price (or $1). Null when it
 * cannot go lower than it is (already at the lowest price, or a whole-dollar step would not lower it).
 */
export function suggestedDropCents(currentCents: number, floorCents: number | null | undefined): number | null {
  if (!Number.isFinite(currentCents) || currentCents <= MIN_PRICE_CENTS) return null;
  const target = Math.floor((currentCents * (100 - PRICE_NUDGE_PCT)) / 100 / 100) * 100;
  const lowest = Math.max(MIN_PRICE_CENTS, Math.ceil(Math.max(floorCents ?? 0, 0) / 100) * 100);
  const cents = Math.max(target, lowest);
  return cents < currentCents ? cents : null;
}

export interface NudgeItem {
  status: string;
  current_price_cents: number;
  live_at: string | null;
  is_seed?: boolean | null;
}

/**
 * Is this listing due a "drop the price?" nudge: live, priced (never free), live 14+ days, its price drops off
 * (`dropsOn` false), and not test data. Live means no sale and no accepted offer (either one reserves the item).
 */
export function priceNudgeDue(item: NudgeItem, dropsOn: boolean, now: number = Date.now()): boolean {
  if (item.status !== "live" || item.current_price_cents <= 0 || dropsOn || item.is_seed) return false;
  if (!item.live_at) return false;
  const live = Date.parse(item.live_at);
  return Number.isFinite(live) && now - live >= PRICE_NUDGE_DAYS * 86_400_000;
}

/**
 * The Selling link the notice opens: Manage for this item at Change price, with the suggested price filled in. The
 * sheet works the price out again from the lowest price as it is then (suggestedDropCents), so a lowest price changed
 * since the notice is never undercut.
 */
export function priceNudgePath(itemId: string): string {
  return `/declutter?tab=selling&manage=${encodeURIComponent(itemId)}&drop=1`;
}

/** Reads `?manage=<id>&drop=1` back: the item to open, or null. */
export function readPriceNudgeLink(params: URLSearchParams): string | null {
  const itemId = params.get("manage");
  return itemId && params.get("drop") === "1" && /^[0-9a-f-]{36}$/i.test(itemId) ? itemId : null;
}
