/**
 * Declutter notice copy (lead 2026-10-28, from the Declutter audit's read of live notice text;
 * migration 20261028171944):
 *   - nothing tells a buyer an item is theirs before they paid ("It's yours: check out ..." is
 *     "Reserved for you: check out ...", the owner's wording);
 *   - prices read the way the app shows them (src/lib/declutter/distance.ts formatPrice): the one
 *     writer of Declutter notices applies declutter_price_words, and a function that writes its own
 *     Declutter notice row formats with declutter_price_text, never to_char(..., 'FM...00');
 *   - the seller's sale notices open Selling, not ?view=offers.
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs). Backend proof:
 * src/test/pglite/declutterNoticeCopy.pglite.mjs (BEFORE on prod's bodies, 3x replay, 6 planted defects RED).
 */
// @mutate supabase/migrations/20261031111949_declutter_notices_open_the_order.sql |           public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link); |           public.declutter_notice_names_item(p_user, p_other, v_link, p_message), v_link);
// @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql | You get paid after the handover.', public.declutter_price_text(o.items_cents),\n           public.declutter_order_items_named(p_order_id)),\n    '/declutter?view=selling', o.buyer_id); | You get paid after the handover.', public.declutter_price_text(o.items_cents),\n           public.declutter_order_items_named(p_order_id)),\n    '/declutter?view=offers', o.buyer_id);
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const code = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

/** Every declutter_notify / _strict call: [function, title expression, link expression]. */
function calls(): { fn: string; title: string; link: string }[] {
  const out: { fn: string; title: string; link: string }[] = [];
  for (const [fn, def] of DEFS) {
    if (fn === "declutter_notify" || fn === "declutter_notify_strict") continue;
    const src = blankSqlComments(def.stmt);
    for (const m of src.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
      const args: string[] = [];
      let depth = 0, cur = "";
      for (let i = m.index! + m[0].length; i < src.length; i++) {
        const c = src[i];
        if (c === "'") { let j = i + 1; while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j += src[j] === "'" ? 2 : 1; cur += src.slice(i, j + 1); i = j; continue; }
        if (c === "(") depth++;
        if (c === ")") { if (depth === 0) { args.push(cur.trim()); break; } depth--; }
        if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      out.push({ fn, title: args[2] ?? "", link: args[4] ?? "" });
    }
  }
  return out;
}

describe("Declutter notice copy", () => {
  const all = calls();

  it("reads the call sites (floor)", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("no notice tells a buyer an item is theirs before they paid", () => {
    const offenders = all.filter((c) => /It''s yours: check out/.test(c.title)).map((c) => c.fn);
    expect(offenders).toEqual([]);
    expect(code("declutter_take_item")).toContain("'Reserved for you: check out within 48 hours'");
  });

  it("the seller's sale notices open Selling", () => {
    const seller = ["'Buyer paid'", "'Sold: waiting for the buyer to pay'", "'Someone claimed your free item'"];
    const hits = all.filter((c) => seller.includes(c.title));
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.filter((c) => !/'\/declutter\?(view|tab)=selling'/.test(c.link)).map((c) => `${c.fn}: ${c.title} -> ${c.link}`)).toEqual([]);
  });

  it("every Declutter notice reads prices the app's way", () => {
    expect(code("declutter_notify_strict")).toMatch(/public\.declutter_price_words\((?:public\.declutter_notice_names_item\(p_user, p_other, [pv]_link, p_message\)|p_message)\)/); // v_link: DC-17 (20261030133115)
    expect(code("declutter_price_words")).toContain("regexp_replace");
    // A function that writes its own Declutter notice row does not go through the writer.
    const direct = [...DEFS.keys()].filter((fn) => {
      const src = code(fn);
      return fn !== "declutter_notify_strict" && /INSERT\s+INTO\s+public\.notifications/i.test(src) && /'\/declutter/.test(src);
    });
    expect(direct).toContain("declutter_price_drop_alert");
    expect(direct.filter((fn) => /FM9+0\.00/.test(code(fn)))).toEqual([]);
  });
});
