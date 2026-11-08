/**
 * DECLUTTER NOTICES THAT MATTER ARE EMAILED, AND SAY WHAT IS TRUE (Declutter buy audit 11-08: H1, M1, M3, M4).
 * Migration 20261108202546_declutter_notices_email_and_honest_sold.sql.
 *
 * Behaviour (real Postgres): src/test/pglite/declutterNoticesEmail.pglite.mjs (2026-11-08: 27 PASS; 17 FAIL with
 * NEW_MIGRATION=skip; each of 7 mutants red).
 *
 * This guard holds the CLASS on the effective (newest) definitions and the client:
 *   - H1: a trigger emails every notice of the four action kinds; the only titles it skips each have their own email
 *     (a receipt) or are named here, exact both ways; the Notifications screen shows a real Email switch for exactly
 *     the kinds that now email;
 *   - M1: no Declutter function tells a seller "Sold" before the payment lands;
 *   - M3: the free-ask sweep closes an ask with no time;
 *   - M4: the "Card saved" notice and the payment page's consent line say the same thing.
 *
 * @mutate supabase/migrations/20261108202546_declutter_notices_email_and_honest_sold.sql |   WHEN (NEW.type IN ('declutter_offers', 'declutter_sales', 'declutter_pickups', 'declutter_refunds') |   WHEN (NEW.type IN ('declutter_offers', 'declutter_sales', 'declutter_pickups')
 * @mutate supabase/migrations/20261108202546_declutter_notices_email_and_honest_sold.sql |     PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',\n      format('"%s" is held | 'Sold: waiting for the buyer to pay',\n      format('"%s" is held
 * @mutate supabase/migrations/20261108202546_declutter_notices_email_and_honest_sold.sql |             OR (q.pickup_at IS NULL AND q.created_at <= p_now - interval '48 hours')) |             OR false)
 * @mutate supabase/functions/declutter-checkout/index.ts |   "We'll save this card for your next Declutter buy. It's charged only when you press Pay | "We'll save this card. It's charged only when you press Pay
 * @mutate supabase/functions/declutter-checkout/index.ts |       ...consentText, |
 * @mutate src/components/notificationPreferences/constants.tsx |   { key: "declutter_refunds", emailKey: "email_declutter_refunds", label: "Refunds", description: "Refund requests, reported problems and strikes. Refund receipts are always emailed.", icon: <Undo2 className="w-3.5 h-3.5" /> }, |   { key: "declutter_refunds", emailKey: "email_declutter_refunds", label: "Refunds", description: "Refund requests, reported problems and strikes. Refund receipts are always emailed.", icon: <Undo2 className="w-3.5 h-3.5" />, noEmailSwitch: "x" },
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { declutterRows } from "@/components/notificationPreferences/constants";

const MIG_DIR = "supabase/migrations";
const defs = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const FIX = blankSqlComments(readFileSync(`${MIG_DIR}/20261108202546_declutter_notices_email_and_honest_sold.sql`, "utf8"));
const checkout = blankComments(readFileSync("supabase/functions/declutter-checkout/index.ts", "utf8"));

/** The kinds the trigger emails. */
const EMAILED = ["declutter_offers", "declutter_sales", "declutter_pickups", "declutter_refunds"];
/** Titles of those kinds it does NOT email, each with the reason. Exact, both ways. */
// @two-way src/test/declutterNoticesEmail.test.ts:expect(titles.sort()).toEqual(Object.keys(SKIPPED).sort());
const SKIPPED: Record<string, string> = {
  "Payment received": "the buyer's declutter_receipt email (stripe-webhook)",
  "Buyer paid": "the seller's declutter_sold email (_shared/declutterSellerEmail.ts)",
  "Refund on its way": "the buyer's declutter_refund email",
  "Delivery pay raised": "the raise receipt (stripe-webhook declutterCheckout.ts sendMoneyEmail)",
  "Your raise is coming back": "declutter-money tellBuyerRefunded",
  "Shipping refund on its way": "declutter-money tellBuyerRefunded",
  "Card saved": "the payment page said it first (M4)",
  "New message about your order": "the delayed Unread message reminder is emailed",
  "New message about a handover": "the delayed Unread message reminder is emailed",
  "New message about a delivery": "the delayed Unread message reminder is emailed",
  "Listing updated": "an edit to an item someone offered on",
  "Listing changed": "an edit to an item someone offered on",
};

function triggerWhen(): string {
  return /CREATE TRIGGER trg_email_declutter_notice[\s\S]*?WHEN \(([\s\S]*?)\)\s*EXECUTE FUNCTION public\.email_declutter_notice\(\)/.exec(FIX)?.[1] ?? "";
}

describe("H1: Declutter action notices are emailed", () => {
  const when = triggerWhen();

  it("the trigger covers exactly the four action kinds", () => {
    const kinds = /NEW\.type IN \(([^)]*)\)/.exec(when)?.[1] ?? "";
    expect([...kinds.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...EMAILED].sort());
  });

  it("the titles it skips are exactly the listed ones, each with its reason", () => {
    const list = /NEW\.title NOT IN \(([\s\S]*?)\)\s*AND/.exec(when)?.[1] ?? "";
    const titles = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    expect(titles.length).toBeGreaterThan(5);
    expect(titles.sort()).toEqual(Object.keys(SKIPPED).sort());
    expect(when).toContain("NEW.title NOT LIKE 'Your payout for %'");
  });

  it("the trigger calls send_notice_email with the notice's own type (its email switch decides) and skips test members", () => {
    const fn = body("email_declutter_notice");
    expect(fn).toContain("public.is_test_member(NEW.user_id)");
    expect(fn).toMatch(/PERFORM public\.send_notice_email\(NEW\.user_id, NEW\.title, NEW\.message, NEW\.type, NEW\.link, NULL\)/);
  });

  it("the Notifications screen has a real Email switch for each emailed kind (and a dash for the rest)", () => {
    const rows = new Map<string, (typeof declutterRows)[number]>(declutterRows.map((r) => [r.key, r]));
    for (const k of EMAILED) expect(rows.get(k)?.noEmailSwitch, k).toBeUndefined();
    for (const k of ["declutter_listings", "declutter_questions"]) expect(rows.get(k)?.noEmailSwitch, k).toBeTruthy();
  });
});

describe("M1: a seller is not told Sold before the payment lands", () => {
  it("declutter_take_item and declutter_answer_bundle say someone is buying, never Sold", () => {
    for (const fn of ["declutter_take_item", "declutter_answer_bundle"]) {
      expect(body(fn), fn).not.toMatch(/'(Bundle )?[Ss]old: waiting/);
    }
    expect(body("declutter_take_item").match(/'Someone''s buying your item'/g)?.length).toBe(2);
    expect(body("declutter_answer_bundle")).toContain("'Bundle accepted: waiting for the buyer to pay'");
  });
});

describe("M3: a free ask with no pickup time ends after 48 hours", () => {
  it("the sweep closes it, with its own words", () => {
    const fn = body("sweep_declutter_free_asks");
    expect(fn).toContain("OR (q.pickup_at IS NULL AND q.created_at <= p_now - interval '48 hours'))");
    expect(fn).toContain("'Your ask ended'");
  });
});

describe("M4: the card-save consent on the payment page and the notice match", () => {
  it("the first-buy payment page shows the consent line, and the notice repeats it", () => {
    const consent = /const CARD_SAVE_CONSENT =\s*"([^"]+)"/.exec(checkout)?.[1] ?? "";
    expect(consent.startsWith("We'll save this card for your next Declutter buy.")).toBe(true);
    expect(checkout).toContain("custom_text: { submit: { message: CARD_SAVE_CONSENT } }");
    expect(checkout).toMatch(/\.\.\.consentText,\s*expires_at: expiresAt/);
    const notice = /'Card saved',\s*'((?:[^']|'')*)'/.exec(body("declutter_save_card"))?.[1].replace(/''/g, "'") ?? "";
    expect(notice).toBe(consent.replace("We'll save this card", "We saved this card"));
  });
});
