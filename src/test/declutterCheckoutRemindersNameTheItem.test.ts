/**
 * The 48-hour checkout reminders name their item and open Buying (whole-app audit 2026-10-28, Declutter notices;
 * migration 20261029025838).
 *
 * The bug: declutter_deadline_sweep's "Check out within 24 hours" and "2 hours left to check out" said "You have an
 * item waiting in your cart" / "Check out in the next 2 hours", never which item, and every buyer notice the sweep
 * writes linked the retired /declutter?view=cart (the client guesses a tab from it: tabs.ts oldDeclutterView).
 *
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs):
 *   1. both reminders format the line's item title into the message;
 *   2. the sweep writes no ?view= link, and every buyer notice in it links /declutter?tab=buying;
 *   3. the new body is the previous effective body with exactly these lines changed (nothing else moved), so the
 *      restatement started from the newest definition.
 * Backend proof on a real database: src/test/pglite/declutterCheckoutReminders.pglite.mjs (3x; red without the
 * migration and on its planted defects).
 */
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END, | ELSE 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.' END,
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,\n      '/declutter?tab=buying'); | ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,\n      '/declutter?view=cart');
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql | can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),\n          '/declutter?tab=buying'); | can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),\n          '/declutter?view=cart');
// @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |   v_talked integer := 0;\n | \n
import { describe, it, expect } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const THIS = "20261029025838_declutter_checkout_reminders_name_the_item.sql";
const FN = "declutter_deadline_sweep";
// DA-12 (20261030063015_declutter_free_no_strike_for_48h.sql) restated the sweep again (free lines get no strike;
// graded by declutterFreeNoStrikeFor48h.test.ts). This file grades what THIS migration changed, so `now` is the
// sweep as THIS migration left it; the link rule below reads the newest definition.
const NEXT = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().find((f) => f > THIS);
const now = effectiveDefs(MIG, NEXT ? { before: NEXT } : {}).get(FN);
const newest = effectiveDefs(MIG).get(FN);
const before = effectiveDefs(MIG, { before: THIS }).get(FN);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

/** Each change this migration makes to the previous body, old -> new (whitespace-normalised, comments blanked). */
const CHANGES: [string, string, number][] = [
  [
    "RETURNING c.buyer_id LOOP",
    "RETURNING c.buyer_id, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title LOOP",
    2,
  ],
  [
    "'Check out within 24 hours', 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.', '/declutter?view=cart');",
    "'Check out within 24 hours', CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.' ELSE format('\"%s\" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END, '/declutter?tab=buying');",
    1,
  ],
  [
    "'2 hours left to check out', 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.', '/declutter?view=cart');",
    "'2 hours left to check out', CASE WHEN r.title IS NULL THEN 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.' ELSE format('Check out \"%s\" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END, '/declutter?tab=buying');",
    1,
  ],
  ["'/declutter?view=cart'", "'/declutter?tab=buying'", 4],
];

/** Every declutter_notify(...) call in the body: recipient, title, link (first, third and last argument). */
function notifies(code: string): { to: string; title: string; link: string }[] {
  const out: { to: string; title: string; link: string }[] = [];
  for (const m of code.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    let cur = "";
    const args: string[] = [];
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "'") {
        let j = i + 1;
        while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) j += code[j] === "'" ? 2 : 1;
        cur += code.slice(i, j + 1);
        i = j;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") { if (depth === 0) break; depth--; }
      if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    args.push(cur.trim());
    // The link is the fifth argument (p_link); a sixth, when present, is the counterpart.
    out.push({ to: args[0], title: args[2], link: args[4] });
  }
  return out;
}

describe("Declutter checkout reminders name the item and open Buying", () => {
  it("reads the sweep from this migration, and the body it restated (floor)", () => {
    expect(now?.file).toBe(THIS);
    expect(before?.file).toBeDefined();
    expect(before?.file).not.toBe(THIS);
    expect(flat(now?.stmt ?? "").length).toBeGreaterThan(5000);
  });

  it("both reminders put the line's item title in the message (newest definition)", () => {
    const body = flat(newest!.stmt);
    expect(body).toContain(`format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title)`);
    expect(body).toContain(`format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title)`);
    // DA-12 also returns the line's price (a free line is worded without a strike); DB-5 its source (a Buy now line too).
    expect(body.match(/RETURNING c\.buyer_id,(?: c\.price_cents,)?(?: c\.source,)? \(SELECT i\.title FROM public\.declutter_items i WHERE i\.id = c\.item_id\) AS title LOOP/g)?.length).toBe(2);
  });

  it("a later restatement keeps every variable this one declared", () => {
    const decls = (b: string) => {
      const code = blankSqlComments(b);
      return code.slice(code.indexOf("DECLARE"), code.indexOf("BEGIN")).split("\n").map((l) => l.trim()).filter((l) => l.endsWith(";"));
    };
    const mine = decls(now!.stmt);
    expect(mine.length).toBeGreaterThan(5);
    const later = decls(newest!.stmt);
    expect(mine.filter((d) => !later.includes(d))).toEqual([]);
  });

  it("no ?view= link is left, and every buyer notice opens Buying", () => {
    const calls = notifies(flat(newest!.stmt));
    // Inventory floor: the sweep's eleven notices (offer expired x2, two reminders, the missed-checkout outcomes).
    expect(calls.length).toBeGreaterThan(9);
    expect(calls.filter((c) => c.link.includes("?view="))).toEqual([]);
    const buyer = calls.filter((c) => /buyer_id$/.test(c.to) && c.link.startsWith("'/declutter?"));
    expect(buyer.length).toBeGreaterThan(5);
    expect(buyer.filter((c) => c.link !== "'/declutter?tab=buying'")).toEqual([]);
    expect(calls.filter((c) => /seller_id$/.test(c.to)).every((c) => c.link === "'/declutter?tab=selling'")).toBe(true);
  });

  it("the restatement is the newest previous body with only these lines changed", () => {
    let expected = flat(before!.stmt);
    for (const [from, to, n] of CHANGES) {
      expect(expected.split(from).length - 1, from).toBe(n);
      expected = expected.split(from).join(to);
    }
    expect(flat(now!.stmt)).toBe(expected);
  });
});
