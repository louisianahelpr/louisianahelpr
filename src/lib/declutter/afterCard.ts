/**
 * "Add a card, then carry on" for Declutter (owner, 2026-10-19: Buy now and
 * Make an offer always show; with no saved card, tapping one saves a card and
 * comes BACK to that same action).
 *
 * On the web, saving a card leaves the app for Stripe's page, which returns to
 * /declutter?card=saved (supabase/functions/declutter-card success_url), so the
 * item and the action are remembered in this tab's sessionStorage before
 * leaving and picked up on the way back. The action rides back to the item in
 * the router's history state, never the address: a link someone sends can't
 * open a Buy confirm by itself. In the app's in-app browser the page never
 * unloads and OfferPanel resumes from its own state instead.
 *
 * DA-11: an offer asks for the card at Send, so the amount already typed rides
 * along the same way and is back in the box (cancelled too; nothing is sent).
 *
 * Storage can be missing or refuse (private mode): then the member simply
 * lands on Declutter with the card saved and taps again. Nothing here moves
 * money; the server checks every buy and offer as before.
 */
export type AfterCardAction = "buy" | "offer";

const KEY = "declutter.afterCard";
/** Long enough to fill in a card on Stripe's page; a stale intent is dropped. */
export const AFTER_CARD_TTL_MS = 30 * 60_000;
/** What an offer box can hold (dollarsInputToCents has the last word); anything else is not ours and is dropped. */
const OFFER_AMOUNT = /^[0-9$., ]{1,12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAfterCardAction(v: unknown): v is AfterCardAction {
  return v === "buy" || v === "offer";
}

export function rememberAfterCard(itemId: string, action: AfterCardAction, now = Date.now(), offerAmount?: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ itemId, action, at: now, ...(offerAmount ? { offerAmount } : {}) }));
  } catch {
    // Storage unavailable (private mode): the member lands on Declutter and taps again.
  }
}

function cleanOfferAmount(v: unknown): string | null {
  return typeof v === "string" && OFFER_AMOUNT.test(v) ? v : null;
}

/** The remembered item and action, once (it is cleared), or null when none, stale or malformed. */
export function takeAfterCard(now = Date.now()): { itemId: string; action: AfterCardAction; offerAmount?: string } | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was remembered, so there is nothing to resume.
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { itemId?: unknown; action?: unknown; at?: unknown; offerAmount?: unknown };
    if (typeof v.itemId !== "string" || !UUID.test(v.itemId) || !isAfterCardAction(v.action)) return null;
    if (typeof v.at !== "number" || now - v.at > AFTER_CARD_TTL_MS || now < v.at) return null;
    const offerAmount = cleanOfferAmount(v.offerAmount);
    return { itemId: v.itemId, action: v.action, ...(offerAmount ? { offerAmount } : {}) };
  } catch {
    // Not our JSON (another writer, or truncated): resume nothing.
    return null;
  }
}

/** Where /declutter?card=saved (or =cancelled) sends a member who left an item to save a card. */
export function afterCardPath(itemId: string): string {
  return `/declutter/item/${encodeURIComponent(itemId)}`;
}

/** The router state that carries the action and the typed amount back to the item (read once by OfferPanel). */
export type AfterCardState = { afterCard?: AfterCardAction; cardCancelled?: AfterCardAction; offerAmount?: string };

/** Which state a return from Stripe's card page brings: the action only when the card was saved. */
export function afterCardReturnState(saved: boolean, next: { action: AfterCardAction; offerAmount?: string }): AfterCardState | null {
  const amount = next.offerAmount ? { offerAmount: next.offerAmount } : {};
  if (saved) return { afterCard: next.action, ...amount };
  // NIGHT-BUYING0-7: cancelled, the item opens the card step again for the same action, saying no card was saved.
  return { cardCancelled: next.action, ...amount };
}

export function cardCancelledFromState(state: unknown): AfterCardAction | null {
  const a = typeof state === "object" && state !== null ? (state as { cardCancelled?: unknown }).cardCancelled : null;
  return isAfterCardAction(a) ? a : null;
}

export function afterCardFromState(state: unknown): AfterCardAction | null {
  const a = typeof state === "object" && state !== null ? (state as { afterCard?: unknown }).afterCard : null;
  return isAfterCardAction(a) ? a : null;
}

export function offerAmountFromState(state: unknown): string | null {
  return cleanOfferAmount(typeof state === "object" && state !== null ? (state as { offerAmount?: unknown }).offerAmount : null);
}
