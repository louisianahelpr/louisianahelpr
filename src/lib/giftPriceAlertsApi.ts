/**
 * Saved-gift price alerts, the client half (owner approved in a pop-up, 2026-11-21: "Saved-list price alerts — opt-in
 * email when a saved gift drops in price, plus a reminder before Dec 15"). Every layer is listed in
 * supabase/functions/_shared/giftPriceAlerts.ts.
 *   gift_price_alert_subscribe(email, items, consent) -> {items}   anyone (no account needed)
 * The Supabase client loads only when the person presses the button (loadModule), never on page load.
 */
import { loadModule } from "@/lib/loadModule";
import type { GiftPlan } from "@/content/giftGuideFun1120";
import { isMissingRpcNamed } from "@/lib/missingRpc";

type Err = { code?: string; message?: string } | null;
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Err }>;

/** The most saved gifts one sign-up carries (the server keeps at most this many too). */
export const ALERT_MAX_ITEMS = 60;

/** One saved gift as the server takes it. No price: the server starts from the guide's own price, never one sent here. */
export interface AlertItemIn { href: string; name: string; guide?: string }

/**
 * The saved gifts that can be watched: ideas from our guides (an https shop link), each link once, at most 60. An idea
 * the person typed in has no link, so there is nothing to watch for it.
 */
export function alertItemsFromPlan(plan: GiftPlan): AlertItemIn[] {
  const seen = new Set<string>();
  const out: AlertItemIn[] = [];
  for (const p of plan.people) {
    for (const i of p.ideas) {
      if (out.length >= ALERT_MAX_ITEMS) return out;
      if (!i.href || !/^https:\/\//.test(i.href) || seen.has(i.href) || !i.name.trim()) continue;
      seen.add(i.href);
      out.push({ href: i.href, name: i.name.trim().slice(0, 120), ...(i.guide ? { guide: i.guide } : {}) });
    }
  }
  return out;
}

/** A plain check before sending (the server checks again). */
export const looksLikeEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e.trim()) && e.trim().length <= 254;

/** Each code gift_price_alert_subscribe raises, in plain words (src/test/rpcErrorCopyCoverage.test.ts, both ways). */
export const PRICE_ALERT_RPC_ERROR_COPY = {
  gift_price_alert_subscribe: {
    no_consent: "Tick the box so we know it's OK to email you.",
    bad_email: "That email address doesn't look right. Check it and try again.",
    no_items: "Save a gift from one of our guides first, then turn on alerts.",
    rate_limited: "That's a lot of sign-ups in a row. Try again in a little while.",
  },
} satisfies Record<string, Record<string, string>>;

/** Words for an error the call returned, or null when it is not one of its codes (whole-token match). */
function rpcErrorMessage(rpc: keyof typeof PRICE_ALERT_RPC_ERROR_COPY, error: Err): string | null {
  const raw = error?.message ?? "";
  const table: Record<string, string> = PRICE_ALERT_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

export class PriceAlertError extends Error {
  constructor(message: string, public readonly words: string) {
    super(message);
  }
}

/** The answer for an address that unsubscribed before (not an error: see the migration). */
const WAS_UNSUBSCRIBED_WORDS = "This email turned price alerts off before. Sign in with it to turn them back on.";
const FAILED_WORDS = "We couldn't turn on alerts just now. Check your connection and try again.";
/** The function is not on the server yet (deployed before its migration): said plainly, never a fake success. */
const NOT_READY_WORDS = "Price alerts aren't ready yet. Please try again tomorrow.";

/** Turn alerts on for these gifts. Resolves with how many the server kept; throws PriceAlertError with words to show. */
export async function subscribePriceAlerts(email: string, items: AlertItemIn[], consent: boolean): Promise<number> {
  const m = await loadModule(() => import("@/integrations/supabase/client"));
  if (!m) throw new PriceAlertError("client not loaded", FAILED_WORDS);
  const sb = m.supabase as unknown as { rpc: Rpc };
  const { data, error } = await sb.rpc("gift_price_alert_subscribe", { p_email: email.trim(), p_items: items, p_consent: consent });
  if (error) {
    if (isMissingRpcNamed(error, "gift_price_alert_subscribe")) throw new PriceAlertError(error.message ?? "not found", NOT_READY_WORDS);
    throw new PriceAlertError(error.message ?? "failed", rpcErrorMessage("gift_price_alert_subscribe", error) ?? FAILED_WORDS);
  }
  const d = data as { items?: unknown; was_unsubscribed?: unknown } | null;
  if (d?.was_unsubscribed === true) throw new PriceAlertError("was_unsubscribed", WAS_UNSUBSCRIBED_WORDS);
  const n = d?.items;
  if (typeof n !== "number" || n < 1) throw new PriceAlertError("bad answer", FAILED_WORDS);
  return n;
}

/** This device remembers that alerts are on (for the card's "on" state only; the server is the record). */
const ALERTS_DEVICE_KEY = "lh-gift-price-alerts";
export interface AlertsOnDevice { email: string; count: number; at: number }

/** The first moment after a sign-up's season: Feb 1 after it (the server deletes the subscription then). */
function seasonEnd(at: number): number {
  const d = new Date(at);
  const y = d.getMonth() === 0 ? d.getFullYear() : d.getFullYear() + 1;
  return new Date(y, 1, 1).getTime();
}

export function readAlertsOnDevice(now = Date.now()): AlertsOnDevice | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(ALERTS_DEVICE_KEY) ?? "null") as Partial<AlertsOnDevice> | null;
    if (!v || typeof v.email !== "string" || typeof v.count !== "number" || typeof v.at !== "number") return null;
    // Last season's sign-up is gone from the server, so the card asks again.
    return now < seasonEnd(v.at) ? { email: v.email, count: v.count, at: v.at } : null;
  } catch {
    // Storage blocked or not ours: the card shows the sign-up form again.
    return null;
  }
}

export function saveAlertsOnDevice(v: AlertsOnDevice) {
  try {
    window.localStorage.setItem(ALERTS_DEVICE_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked: the alerts are on (the server has them); only this card forgets it on the next visit.
  }
}

/** The card's words. */
export const ALERT_WORDS = {
  title: "Price drop alerts",
  lead: "Email me if any of these drop in price, and a reminder before Dec 15.",
  email: "Your email",
  consent: "Yes, email me about price drops on my saved gifts and one reminder before Dec 15.",
  unsubscribe: "Unsubscribe anytime with one click from any of these emails.",
  button: "Turn on alerts",
  sending: "Turning on...",
  none: "Save a gift from one of our guides and you can get an email when its price drops.",
  on: (email: string, n: number) => `Alerts are on for ${email} (${n} ${n === 1 ? "gift" : "gifts"}).`,
  update: "Update my alerts",
  changed: "You've saved more gifts since. Update your alerts to watch them too.",
  needConsent: PRICE_ALERT_RPC_ERROR_COPY.gift_price_alert_subscribe.no_consent,
  badEmail: PRICE_ALERT_RPC_ERROR_COPY.gift_price_alert_subscribe.bad_email,
  failed: FAILED_WORDS,
} as const;
