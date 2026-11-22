/**
 * Saved-gift price alerts (owner approved in a pop-up, 2026-11-21): the drop rule, the reminder day, the price feed,
 * the client's opt-in (consent never pre-ticked, signed out works), the database shape (no client privilege, anon only
 * through the validated function), the sender's test-data rules, and the one-click unsubscribe list.
 *
 * Behaviour of the SQL is proven in src/test/pglite/giftPriceAlerts.pglite.mjs (migration applied 3x): 22 PASS,
 * NEW_MIGRATION=skip RED, 13 planted defects each caught (2026-11-21). This file pins the rest.
 *
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts | const DROP_MIN_DOLLARS = 5; | const DROP_MIN_DOLLARS = 50;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts | const DROP_MIN_PERCENT = 10; | const DROP_MIN_PERCENT = 1;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |     return { ...item, alerted: now }; |     return item;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |   isPrice(item.alerted) ? item.alerted : isPrice(item.price) ? item.price : null; |   isPrice(item.price) ? item.price : null;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts | const REMINDER_DAY = 10; | const REMINDER_DAY = 1;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |   return !(sy === y && sm === REMINDER_MONTH); |   return true;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |   if (!isAmazonUrl(href)) return href; |   return href;
 * @mutate scripts/lib/giftGuidePriceFeed.mjs |       if (prev && prev.at >= p.priceAt) continue; |       if (prev) continue;
 * @mutate src/lib/giftPriceAlertsApi.ts |       if (!i.href \|\| !/^https:\/\//.test(i.href) \|\| seen.has(i.href) \|\| !i.name.trim()) continue; |       if (!i.href) continue;
 * @mutate src/pages/info/giftGuides/fun/PriceAlertsOptIn.tsx |   const [consent, setConsent] = useState(false); |   const [consent, setConsent] = useState(true);
 * @mutate supabase/functions/gift-price-alerts/index.ts |     q = onlyEmail ? q.eq("email", onlyEmail).eq("is_seed", true) : q.eq("is_seed", false); |     q = onlyEmail ? q.eq("email", onlyEmail) : q;
 * @mutate supabase/functions/gift-price-alerts/index.ts |       if ((!onlyEmail && isTestAddress(row.email)) \|\| suppressed.has(row.email)) { |       if (suppressed.has(row.email)) {
 * @mutate supabase/functions/gift-price-alerts/index.ts |           if (!cur?.name) return []; |           if (!cur) return [];
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |     if (item.seen !== now) { |     if (false) {
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts | const HOLD_HOURS = 20; | const HOLD_HOURS = 1;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts | const SUSPECT_DROP_PERCENT = 70; | const SUSPECT_DROP_PERCENT = 100;
 * @mutate supabase/functions/_shared/giftPriceAlerts.ts |     const d: Drop = { href: item.href, name: cur.name, | const d: Drop = { href: item.href, name: item.name,
 * @mutate supabase/functions/_shared/unsubscribe.ts |   return value === 'job_matches' \|\| value === 'gift_price_alerts' ? value : 'promotions' |   return value === 'job_matches' ? value : 'promotions'
 * @mutate supabase/functions/email-unsubscribe/index.ts |       .from('gift_price_alerts') |       .from('profiles')
 * @mutate supabase/migrations/20261121210818_gift_price_alerts.sql | REVOKE ALL ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) FROM PUBLIC;
 * @mutate supabase/functions/_shared/email-templates/giftPriceAlert.tsx |     footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} reasonLine={C.reason} unsubscribeLabel={C.unsubscribe} />}\n  >\n    <Text className="e-text" style={textStyle}>{C.dropIntro(items.length)}</Text> |     footer={null}\n  >\n    <Text className="e-text" style={textStyle}>{C.dropIntro(items.length)}</Text>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import {
  PRICE_ALERT_COPY,
  emailImage,
  emailLink,
  findDrops,
  isDrop,
  parseFeed,
  parseItems,
  reminderDue,
  type AlertItem,
} from "../../supabase/functions/_shared/giftPriceAlerts";
import { buildPriceFeed } from "../../scripts/lib/giftGuidePriceFeed.mjs";
import { alertItemsFromPlan, looksLikeEmail, ALERT_MAX_ITEMS } from "@/lib/giftPriceAlertsApi";
import { parseUnsubscribeLink } from "@/lib/emailUnsubscribe";
import type { GiftPlan } from "@/content/giftGuideFun1120";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const MIG_DIR = join(ROOT, "supabase/migrations");
const migFile = readdirSync(MIG_DIR).filter((f) => f.endsWith("_gift_price_alerts.sql")).sort().pop();

describe("the drop rule: at least $5 or at least 10%", () => {
  it("counts $5 off on any price, 10% off on a small one, and nothing smaller or upward", () => {
    expect(isDrop(100, 95)).toBe(true); // $5 (5%)
    expect(isDrop(100, 95.01)).toBe(false); // $4.99, 4.99%
    expect(isDrop(20, 18)).toBe(true); // exactly 10%
    expect(isDrop(20, 18.01)).toBe(false); // 9.95%
    expect(isDrop(50, 45)).toBe(true); // both
    expect(isDrop(500, 496)).toBe(false); // $4, 0.8%
    expect(isDrop(10, 12)).toBe(false);
    expect(isDrop(10, 10)).toBe(false);
    expect(isDrop(10, 0)).toBe(false); // a zero price is a broken feed, never a drop
  });

  const T0 = new Date("2026-11-22T15:29:00Z");
  const later = (h: number) => new Date(T0.getTime() + h * 3600 * 1000);
  it("measures from the last emailed price, waits for a new price to hold 20 hours, names items by the feed, and a first sighting only sets the start", () => {
    const old = "2026-11-01T15:29:00.000Z";
    const items: AlertItem[] = [
      { href: "https://a.co/1", name: "Socks <a href=evil>", price: 20, seen: 20, seenAt: old },
      { href: "https://a.co/2", name: "Mug", price: 40, seen: 29, seenAt: old, alerted: 30 },
      { href: "https://a.co/3", name: "Hat", price: null },
      { href: "https://a.co/4", name: "Gone", price: 25, seen: 25, seenAt: old },
    ];
    const feed = { items: { "https://a.co/1": { price: 17, name: "Cozy socks", image: "https://img.co/1.jpg" }, "https://a.co/2": { price: 29, name: "Mug" }, "https://a.co/3": { price: 9, name: "Hat" } } };
    // Run 1: Socks moved 20 -> 17: remembered, not mailed yet.
    const r1 = findDrops(items, feed, T0);
    expect(r1.drops).toEqual([]);
    expect(r1.items[0]).toMatchObject({ seen: 17, seenAt: T0.toISOString() });
    expect(r1.items[2]).toMatchObject({ price: 9, seen: 9 }); // first sighting sets the start, never a drop
    expect(r1.items[3]).toEqual(items[3]); // off the feed: untouched
    // Six hours later (the same day's second run, same deploy): still held back.
    const r2 = findDrops(r1.items, feed, later(6));
    expect(r2.drops).toEqual([]);
    expect(r2.changed).toBe(false);
    // A day later the price held: mailed once, under the FEED's name; Mug ($29 vs last-emailed $30) is not a drop.
    const r3 = findDrops(r2.items, feed, later(24));
    expect(r3.drops.map((d) => [d.href, d.name, d.was, d.now])).toEqual([["https://a.co/1", "Cozy socks", 20, 17]]);
    expect(r3.items[0].alerted).toBe(17);
    // Next run: nothing new.
    const r4 = findDrops(r3.items, feed, later(30));
    expect(r4.drops).toEqual([]);
    expect(r4.changed).toBe(false);
  });

  it("a drop over 70% is a likely broken price: reported, never mailed or marked", () => {
    const old = "2026-11-01T15:29:00.000Z";
    const items: AlertItem[] = [{ href: "https://a.co/1", name: "Boots", price: 50, seen: 4.99, seenAt: old }];
    const r = findDrops(items, { items: { "https://a.co/1": { price: 4.99, name: "Boots" } } }, T0);
    expect(r.drops).toEqual([]);
    expect(r.suspect.map((d) => d.now)).toEqual([4.99]);
    expect(r.items[0].alerted).toBeUndefined();
    // 70% exactly still counts as a real drop.
    expect(findDrops([{ href: "https://a.co/1", name: "B", price: 50, seen: 15, seenAt: old }], { items: { "https://a.co/1": { price: 15, name: "B" } } }, T0).drops.length).toBe(1);
  });
});

describe("the reminder: Dec 10 in Louisiana, caught up through Dec 14, once a season", () => {
  // 15:29 UTC is 9:29 AM in Louisiana in December (CST).
  const at = (iso: string) => new Date(iso);
  it("is due from Dec 10 to Dec 14 only", () => {
    expect(reminderDue(at("2026-12-09T15:29:00Z"), null)).toBe(false);
    expect(reminderDue(at("2026-12-10T15:29:00Z"), null)).toBe(true);
    expect(reminderDue(at("2026-12-14T21:29:00Z"), null)).toBe(true);
    expect(reminderDue(at("2026-12-15T15:29:00Z"), null)).toBe(false);
    expect(reminderDue(at("2026-11-21T15:29:00Z"), null)).toBe(false);
    // 2026-12-10T03:00Z is still Dec 9 in Louisiana.
    expect(reminderDue(at("2026-12-10T03:00:00Z"), null)).toBe(false);
  });
  it("is sent once a season: not again after this December's, but again next year", () => {
    expect(reminderDue(at("2026-12-11T15:29:00Z"), "2026-12-10T15:30:00Z")).toBe(false);
    expect(reminderDue(at("2027-12-10T15:29:00Z"), "2026-12-10T15:30:00Z")).toBe(true);
    expect(reminderDue(at("2026-12-10T15:29:00Z"), "2026-11-30T15:30:00Z")).toBe(true);
  });
});

describe("emails never carry an Amazon link or photo (Associates policy)", () => {
  it("links an Amazon item to our guide page and drops its photo; other shops link straight through", () => {
    expect(emailLink("https://www.amazon.com/dp/B0X?tag=louisianahelpr-20", "her", "https://www.louisianahelpr.com")).toBe("https://www.louisianahelpr.com/gift-guides/her");
    expect(emailLink("https://amzn.to/abc", null, "https://www.louisianahelpr.com")).toBe("https://www.louisianahelpr.com/gift-guides");
    expect(emailLink("https://shopmy.us/p/1", "her", "https://x")).toBe("https://shopmy.us/p/1");
    expect(emailImage("https://m.media-amazon.com/images/I/1.jpg")).toBeUndefined();
    expect(emailImage("https://cdn.shop.com/1.jpg")).toBe("https://cdn.shop.com/1.jpg");
  });
  it("the words stay short and plain (no exclamation marks, sentence case subjects)", () => {
    const all = JSON.stringify(PRICE_ALERT_COPY) + PRICE_ALERT_COPY.dropSubject(1, "Socks") + PRICE_ALERT_COPY.dropSubject(3, "x");
    expect(all).not.toMatch(/!/);
    expect(PRICE_ALERT_COPY.reminderSubject).toBe("Your gift list, before Dec 15");
  });
});

describe("the price feed is built from the guide picks", () => {
  const feed = buildPriceFeed(join(ROOT, "src/content/giftGuidePicks"));
  const n = Object.keys(feed.items).length;
  it("holds every priced pick, keyed by its https link", () => {
    // 637 distinct priced links on 2026-11-21.
    expect(n).toBeGreaterThan(300);
    for (const [href, v] of Object.entries(feed.items)) {
      expect(href).toMatch(/^https:\/\//);
      expect(v.price).toBeGreaterThan(0);
    }
  });
  it("a link in two guides takes the price with the newest check day", () => {
    const parsed = parseFeed(feed);
    expect(parsed && Object.keys(parsed.items).length).toBe(n);
    const picks = readdirSync(join(ROOT, "src/content/giftGuidePicks")).filter((f) => f.endsWith(".json"))
      .flatMap((f) => (JSON.parse(read(`src/content/giftGuidePicks/${f}`)).picks ?? []) as { href: string; price?: number; priceAt?: string }[]);
    for (const p of picks) {
      if (!p.price || !p.priceAt || !/^https:\/\//.test(p.href)) continue;
      expect(feed.items[p.href].at >= p.priceAt).toBe(true);
    }
  });
  it("the build writes it (vite plugin) and the sender reads that exact path", () => {
    expect(blankComments(read("vite.config.ts"))).toMatch(/this\.emitFile\(\{ type: "asset", fileName: PRICE_FEED_FILE/);
    expect(blankComments(read("supabase/functions/gift-price-alerts/index.ts"))).toContain("/gift-guides/price-feed.json");
  });
  it("parseItems drops a hand-edited bad row instead of breaking the run", () => {
    expect(parseItems([{ href: "javascript:x", name: "a" }, { href: "https://a/b", name: "ok", price: "5", seen: 4 }, null])).toEqual([{ href: "https://a/b", name: "ok", price: null, seen: 4 }]);
  });
});

describe("the opt-in (client)", () => {
  const plan = (ideas: GiftPlan["people"][number]["ideas"]): GiftPlan => ({ updatedAt: 0, people: [{ id: "p", name: "Mom", ideas }] });
  it("sends only gifts from our guides (an https link), each once, at most 60", () => {
    const got = alertItemsFromPlan(plan([
      { id: "1", name: "Socks", bought: false, href: "https://shop.co/a", price: 20, guide: "her" },
      { id: "2", name: "Typed idea", bought: false },
      { id: "3", name: "Dup", bought: false, href: "https://shop.co/a" },
      { id: "4", name: "Plain http", bought: false, href: "http://shop.co/b" },
    ]));
    expect(got).toEqual([{ href: "https://shop.co/a", name: "Socks", guide: "her" }]); // never a price: the server takes the guide's
    const many = alertItemsFromPlan(plan(Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: `G${i}`, bought: false, href: `https://s.co/${i}` }))));
    expect(many.length).toBe(ALERT_MAX_ITEMS);
  });
  it("checks the address before sending", () => {
    expect(looksLikeEmail("ann@gmail.com")).toBe(true);
    expect(looksLikeEmail("ann@gmail")).toBe(false);
  });
  it("the consent box starts unticked, the card says unsubscribe anytime, and it works signed out (no sign-in gate)", () => {
    const src = blankComments(read("src/pages/info/giftGuides/fun/PriceAlertsOptIn.tsx"));
    expect(src).toContain("useState(false)");
    expect(src).toMatch(/const \[consent, setConsent\] = useState\(false\)/);
    expect(src).toContain("{W.unsubscribe}");
    expect(src).toMatch(/user\?\.email/); // filled in when signed in
    expect(src).not.toMatch(/navigate\(["']\/login/);
    expect(read("src/lib/giftPriceAlertsApi.ts")).toMatch(/unsubscribe: "Unsubscribe anytime/);
    expect(blankComments(read("src/pages/info/giftGuides/fun/GiftPlanner.tsx"))).toContain("<PriceAlertsOptIn />");
  });
});

describe("the database: no client privilege, anon only through the validated function", () => {
  const sql = blankSqlComments(read(`supabase/migrations/${migFile}`));
  it("exists once, created with RLS on and every client role revoked", () => {
    expect(migFile).toBeTruthy();
    expect(sql).toMatch(/ALTER TABLE public\.gift_price_alerts ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toContain("REVOKE ALL ON TABLE public.gift_price_alerts FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.gift_price_alerts TO (anon|authenticated)/);
    expect(sql).toContain("REVOKE ALL ON TABLE public.gift_price_alert_hits FROM PUBLIC, anon, authenticated;");
  });
  it("the opt-in refuses without consent, is revoked by role name before being granted, and the other functions are service-role only", () => {
    expect(sql).toMatch(/IF p_consent IS NOT TRUE THEN\s+RAISE EXCEPTION 'no_consent'/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.gift_price_alert_subscribe(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.gift_price_alerts_expire() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.gift_price_alerts_expire() TO service_role;");
    expect(sql).toMatch(/is_seed boolean NOT NULL DEFAULT false/);
  });
  it("the cron calls the sender twice a day", () => {
    expect(sql).toContain("cron.schedule('gift-price-alerts', '29 15,21 * * *'");
    expect(sql).toContain("'/functions/v1/gift-price-alerts'");
  });
});

describe("the sender never mails test data, and every email can be unsubscribed in one click", () => {
  const fn = blankComments(read("supabase/functions/gift-price-alerts/index.ts"));
  it("filters is_seed out; test mode (one address, cron secret) reads only a seed row; re-checks test addresses, skips suppressed ones", () => {
    expect(fn).toContain('q = onlyEmail ? q.eq("email", onlyEmail).eq("is_seed", true) : q.eq("is_seed", false);');
    expect(fn.indexOf("verifyCronSecret(req)")).toBeLessThan(fn.indexOf("req.json()"));
    expect(fn).toContain("(!onlyEmail && isTestAddress(row.email)) || suppressed.has(row.email)");
    expect(fn).toContain("if (!cur?.name) return [];"); // the reminder names only feed gifts, by the feed's name
    expect(fn).toContain('buildUnsubscribeUrl(row.email, "gift_price_alerts")');
    expect(fn).toContain('unsubscribeHeaders(row.email, "gift_price_alerts")');
  });
  it("both emails carry the marketing footer (unsubscribe + postal address)", () => {
    const t = blankComments(read("supabase/functions/_shared/email-templates/giftPriceAlert.tsx"));
    expect(t.match(/footer=\{<MarketingFooter unsubscribeUrl=\{unsubscribeUrl\}/g)?.length).toBe(2);
  });
  it("the gift_price_alerts link verifies only as that list and turns off only those emails", () => {
    const u = blankComments(read("supabase/functions/_shared/unsubscribe.ts"));
    expect(u).toContain("export type UnsubscribeList = 'promotions' | 'job_matches' | 'gift_price_alerts'");
    expect(u).toContain("return value === 'job_matches' || value === 'gift_price_alerts' ? value : 'promotions'");
    const h = blankComments(read("supabase/functions/email-unsubscribe/index.ts"));
    const branch = h.slice(h.indexOf("if (list === 'gift_price_alerts') {"), h.indexOf("let profile"));
    expect(branch).toContain(".from('gift_price_alerts')");
    expect(branch).not.toMatch(/marketing_consent|email_promotions|suppressed_emails/);
    expect(parseUnsubscribeLink("?e=YQ&sig=b&list=gift_price_alerts")?.list).toBe("gift_price_alerts");
    expect(parseUnsubscribeLink("?e=YQ&sig=b&list=other")?.list).toBe("promotions");
  });
});
