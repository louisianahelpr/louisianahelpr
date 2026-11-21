/**
 * Saved-gift price alerts (owner approved in a pop-up, 2026-11-21: "Saved-list price alerts — opt-in email when a
 * saved gift drops in price, plus a reminder before Dec 15"). The rules and the words, in one place.
 *
 * Every layer:
 *   client     src/pages/info/giftGuides/fun/PriceAlertsOptIn.tsx (the opt-in card under the planner's lists) and
 *              src/lib/giftPriceAlertsApi.ts (which saved ideas go, and the call)
 *   server     public.gift_price_alert_subscribe (SECURITY DEFINER, anon + authenticated; validates and rate limits)
 *   table      public.gift_price_alerts (RLS on, no client privilege at all) - migration *_gift_price_alerts.sql
 *   prices     /gift-guides/price-feed.json, written by the build from src/content/giftGuidePicks/*.json (the daily
 *              price train's output) - scripts/giftGuidePriceFeed.mjs
 *   sender     supabase/functions/gift-price-alerts (cron daily): price-drop digests, and the Dec 10 reminder
 *   email      _shared/email-templates/giftPriceAlert.tsx (commercial: one-click unsubscribe + postal address)
 *   opt-out    email-unsubscribe, list 'gift_price_alerts' (stamps gift_price_alerts.unsubscribed_at only)
 *
 * Zero imports on purpose, so a vitest can load it (src/test/giftPriceAlerts.test.ts).
 */

/** email_send_log.template_name and the queue label for each email. */
export const PRICE_DROP_TEMPLATE = "gift_price_drop";
export const REMINDER_TEMPLATE = "gift_price_reminder";

/** A drop counts when the price fell by at least this many dollars ... */
export const DROP_MIN_DOLLARS = 5;
/** ... or by at least this percent of the price it is measured from. */
export const DROP_MIN_PERCENT = 10;

/** The reminder goes out on this December day (Louisiana time), and is caught up through the 14th if a run fails. */
export const REMINDER_MONTH = 12;
export const REMINDER_DAY = 10;
export const REMINDER_LAST_DAY = 14;

/** One saved gift in a subscription (public.gift_price_alerts.items). */
export interface AlertItem {
  href: string;
  name: string;
  /** The starting price: the guide's own price the first time the sender saw the gift (never a price the shopper sent:
   *  lh-silent-failure review, a typed "was" price would be a false claim). Null until then. */
  price: number | null;
  /** The feed's price as last seen, and when it was first seen at that price. A drop is mailed only once the new
   *  price has held for HOLD_HOURS (both runs of one day read the same deploy, so "two runs" alone is not enough: one
   *  bad scrape or a rolled-back deploy must survive the next day's price train first; lh-silent-failure review). */
  seen?: number | null;
  seenAt?: string | null;
  /** The price the last drop email named, so the same drop is never mailed twice. */
  alerted?: number | null;
  /** The guide it came from (the email links an Amazon item to this guide page, never straight to Amazon). */
  guide?: string | null;
}

/** One product in the price feed. */
export interface FeedItem {
  price: number;
  name?: string;
  image?: string;
  guide?: string;
}

export interface PriceFeed {
  items: Record<string, FeedItem>;
}

/** One dropped item, for the email. */
export interface Drop {
  href: string;
  name: string;
  was: number;
  now: number;
  image?: string;
  guide?: string | null;
}

/** A drop deeper than this share of the price is treated as a broken price, never mailed (reported instead). */
export const SUSPECT_DROP_PERCENT = 70;
/** How long a new price must hold before a drop email names it. */
export const HOLD_HOURS = 20;

const cents = (n: number) => Math.round(n * 100) / 100;
const isPrice = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 100000;

/**
 * Whether going from `from` to `now` is a drop worth an email: lower by at least $5 or at least 10% of `from`.
 * Compared in cents, so $50.00 -> $45.00 is exactly 10% and counts.
 */
export function isDrop(from: number, now: number): boolean {
  if (!isPrice(from) || !isPrice(now) || now >= from) return false;
  const fromC = Math.round(from * 100);
  const nowC = Math.round(now * 100);
  const off = fromC - nowC;
  return off >= DROP_MIN_DOLLARS * 100 || off * 100 >= fromC * DROP_MIN_PERCENT;
}

/** The price a drop is measured from: the last price we emailed about, else the price when saved. */
export const baselineOf = (item: AlertItem): number | null =>
  isPrice(item.alerted) ? item.alerted : isPrice(item.price) ? item.price : null;

/**
 * Compare one subscription's saved gifts with today's prices.
 *   drops:   the items to email about (in the saved order), named by the FEED (never the shopper's text, lh-authz-rls
 *            review), each down at least $5 or 10% from its baseline, at a price that has held for HOLD_HOURS;
 *   suspect: drops deeper than 70%, not mailed and not marked (the run reports them: likely a broken price);
 *   items:   the list to store back: `seen` set to today's price, a first sighting's `price` set to it (never a drop
 *            on its first sighting), each mailed item's `alerted` set to it;
 *   changed: whether `items` differs from what was stored.
 * An item missing from today's feed (taken off a guide, or no price today) is left exactly as it was.
 */
export function findDrops(items: AlertItem[], feed: PriceFeed, nowAt: Date): { drops: Drop[]; suspect: Drop[]; items: AlertItem[]; changed: boolean } {
  const stamp = nowAt.toISOString();
  const drops: Drop[] = [];
  const suspect: Drop[] = [];
  let changed = false;
  const next = items.map((item) => {
    const cur = feed.items[item.href];
    if (!cur || !isPrice(cur.price)) return item;
    const now = cents(cur.price);
    const from = baselineOf(item);
    if (from === null) {
      changed = true;
      return { ...item, price: now, seen: now, seenAt: stamp };
    }
    if (item.seen !== now) {
      // A new price: remembered, and judged once it has held for HOLD_HOURS.
      changed = true;
      return { ...item, seen: now, seenAt: stamp };
    }
    const heldMs = item.seenAt ? nowAt.getTime() - new Date(item.seenAt).getTime() : NaN;
    if (!(heldMs >= HOLD_HOURS * 3600 * 1000)) return item;
    if (!isDrop(from, now) || !cur.name) return item;
    const d: Drop = { href: item.href, name: cur.name, was: cents(from), now, ...(cur.image ? { image: cur.image } : {}), guide: cur.guide ?? item.guide ?? null };
    if (Math.round(now * 100) * 100 < Math.round(from * 100) * (100 - SUSPECT_DROP_PERCENT)) {
      suspect.push(d);
      return item;
    }
    changed = true;
    drops.push(d);
    return { ...item, alerted: now };
  });
  return { drops, suspect, items: next, changed };
}
/** Today's date in Louisiana as [year, month, day]. */
export function louisianaDate(now: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return [get("year"), get("month"), get("day")];
}

/**
 * Whether the before-Dec-15 reminder is due for a subscription now: Louisiana date Dec 10..14, and no reminder sent
 * yet this season (none, or the last one before December 1 of this year).
 */
export function reminderDue(now: Date, sentAt: string | null): boolean {
  const [y, m, d] = louisianaDate(now);
  if (m !== REMINDER_MONTH || d < REMINDER_DAY || d > REMINDER_LAST_DAY) return false;
  if (!sentAt) return true;
  const sent = new Date(sentAt);
  if (Number.isNaN(sent.getTime())) return true;
  const [sy, sm] = louisianaDate(sent);
  return !(sy === y && sm === REMINDER_MONTH);
}

/** Read the build's price feed strictly: only https product links with a real price. */
export function parseFeed(raw: unknown): PriceFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const items = (raw as { items?: unknown }).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) return null;
  const out: Record<string, FeedItem> = {};
  for (const [href, v] of Object.entries(items as Record<string, unknown>)) {
    if (!/^https:\/\//.test(href) || !v || typeof v !== "object") continue;
    const f = v as Record<string, unknown>;
    if (!isPrice(f.price)) continue;
    out[href] = {
      price: f.price,
      ...(typeof f.name === "string" ? { name: f.name } : {}),
      ...(typeof f.image === "string" && /^https:\/\//.test(f.image) ? { image: f.image } : {}),
      ...(typeof f.guide === "string" && /^[a-z0-9-]{1,60}$/.test(f.guide) ? { guide: f.guide } : {}),
    };
  }
  return { items: out };
}

/** Read a stored items array strictly (a hand-edited row never breaks a run). */
export function parseItems(raw: unknown): AlertItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v): AlertItem[] => {
    if (!v || typeof v !== "object") return [];
    const i = v as Record<string, unknown>;
    if (typeof i.href !== "string" || !/^https:\/\//.test(i.href) || typeof i.name !== "string") return [];
    return [{
      href: i.href,
      name: i.name,
      price: isPrice(i.price) ? i.price : null,
      ...(isPrice(i.seen) ? { seen: i.seen } : {}),
      ...(typeof i.seenAt === "string" ? { seenAt: i.seenAt } : {}),
      ...(isPrice(i.alerted) ? { alerted: i.alerted } : {}),
      ...(typeof i.guide === "string" ? { guide: i.guide } : {}),
    }];
  });
}

/** Amazon allows its links and product photos only on our pages, never in an email (Associates policy). */
export const isAmazonUrl = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return /(^|\.)amazon\.[a-z.]+$/.test(h) || h === "amzn.to" || /(^|\.)media-amazon\.com$/.test(h) || /(^|\.)ssl-images-amazon\.com$/.test(h);
  } catch {
    // Not a URL: treated as Amazon, so it is never put in an email.
    return true;
  }
};

/** Where an item's email link goes: the shop for most, our guide page for an Amazon item. */
export function emailLink(href: string, guide: string | null | undefined, appUrl: string): string {
  if (!isAmazonUrl(href)) return href;
  return `${appUrl}/gift-guides${guide && /^[a-z0-9-]{1,60}$/.test(guide) ? `/${guide}` : ""}`;
}

/** The photo an email may show (none for Amazon). */
export const emailImage = (image: string | undefined) => (image && /^https:\/\//.test(image) && !isAmazonUrl(image) ? image : undefined);

export const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

/** The words. Short, warm, plain; sentence case; no exclamation pileups. */
export const PRICE_ALERT_COPY = {
  dropSubject: (n: number, first: string) => (n === 1 ? `Price drop: ${first}` : `${n} gifts on your list just dropped in price`),
  dropPreheader: "Something you saved costs less today.",
  dropIntro: (n: number) => (n === 1 ? "Good news: a gift you saved on Louisiana Helpr costs less today." : `Good news: ${n} gifts you saved on Louisiana Helpr cost less today.`),
  dropOutro: "Prices change fast this time of year, so it may not last.",
  reminderSubject: "Your gift list, before Dec 15",
  reminderPreheader: "A quick nudge so everything arrives in time.",
  reminderIntro: "Just a friendly nudge: Dec 15 is right around the corner, and that's about the last safe day to order for Christmas delivery.",
  reminderListLead: "Here's what's on your list:",
  reminderDropped: "Price dropped",
  button: "See your gift list",
  was: (n: number) => `was ${money(n)}`,
  closing: "Happy shopping,",
  signOff: "Louisiana Helpr",
  reason: "You're getting this because you asked for price alerts on your saved gifts at louisianahelpr.com.",
  unsubscribe: "Stop price alerts",
} as const;
