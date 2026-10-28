/**
 * A seller's Declutter notice never opens the BUYER's side (Declutter audit 2 SE2-4, still on prod in audit 3,
 * 2026-10-28; fixed in 20261028200440). The seller's "A Helpr will pick it up", "Helpr pickup booked" and
 * "Picked up" linked /declutter?view=cart, the buyer's cart, so tapping them showed the seller nothing of theirs.
 *
 * THE CLASS: every declutter_notify / _strict call in the EFFECTIVE definition of every SQL function
 * (helpers/effectiveFunctionDefs) whose recipient is plainly the seller (o.seller_id, NEW.seller_id, v_seller,
 * p_seller_id, r.seller_id ...; a CASE recipient is either side and is skipped) must not link the buyer's
 * screens (?view=cart, ?tab=buying, ?view=bought). Backend proof of the fix:
 * src/test/pglite/declutterAudit3Server.pglite.mjs.
 */
// @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql | You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),\n      '/declutter?tab=selling' | You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),\n      '/declutter?view=cart'
// @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql | you''ll be told the pickup time.', '/declutter?tab=selling' | you''ll be told the pickup time.', '/declutter?view=cart'
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));

/** The top-level arguments of the call whose "(" is at `open`. */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'") {
      let j = i + 1;
      while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) j += code[j] === "'" ? 2 : 1;
      cur += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      if (depth === 0) { args.push(cur.trim()); return args; }
      depth--;
    }
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return args;
}

interface Call { fn: string; to: string; title: string; link: string }
const calls: Call[] = [];
for (const [fn, def] of DEFS) {
  if (fn === "declutter_notify" || fn === "declutter_notify_strict") continue;
  const code = blankSqlComments(def.stmt);
  for (const m of code.matchAll(/declutter_notify(?:_strict)?\s*\(/g)) {
    const a = callArgs(code, m.index! + m[0].length - 1);
    if (a.length >= 5) calls.push({ fn, to: a[0], title: a[2].replace(/\s+/g, " "), link: a[4] });
  }
}
const toSeller = calls.filter((c) => !/^CASE\b/i.test(c.to) && /seller/i.test(c.to));
const BUYER_SCREENS = /'\/declutter\?(?:view=cart|tab=buying|view=bought)\b/;

describe("a seller's Declutter notice opens the seller's side", () => {
  it("reads the calls (floors, so a parser that reads nothing goes red)", () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(toSeller.length).toBeGreaterThan(20);
  });

  it("no notice to the seller links the buyer's cart or Buying", () => {
    const wrong = toSeller.filter((c) => BUYER_SCREENS.test(c.link)).map((c) => `${c.fn}: ${c.title} -> ${c.link}`);
    expect(wrong).toEqual([]);
  });
});
