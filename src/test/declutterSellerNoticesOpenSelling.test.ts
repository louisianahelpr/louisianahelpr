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
 *
 * #37 (deep audit 2026-10-28, migration 20261028223036) extends it to BOTH sides: ?view=offers is guessed from the
 * member's badges (tabs.ts oldDeclutterView) and can open either side, so no plainly-seller or plainly-buyer notice
 * links it; a buyer's notice never links Selling (?tab=selling, ?view=selling, ?view=sales, ?view=mine); and the
 * notices that can go to either side (a strike, a counteroffer, a declined counter) follow the side the function
 * knows. Shown RED with 20261028223036 removed (3 of 4 tests). Backend proof: src/test/pglite/declutterNoticeLinksTabs.pglite.mjs.
 */
// @mutate supabase/migrations/20261029162620_declutter_smart_offers.sql | v_item.o_title),\n    '/declutter?tab=selling', v_uid); | v_item.o_title),\n    '/declutter?view=offers', v_uid);
// @mutate supabase/migrations/20261028223036_declutter_notice_links_open_the_right_tab.sql | format('The seller paused "%s", so your offer is closed. Nothing was charged.', v_item.title),\n      '/declutter?tab=buying', v_uid); | format('The seller paused "%s", so your offer is closed. Nothing was charged.', v_item.title),\n      '/declutter?tab=selling', v_uid);
// @mutate supabase/migrations/20261028223036_declutter_notice_links_open_the_right_tab.sql | '/declutter?tab=' \|\| CASE WHEN p_side = 'seller' THEN 'selling' ELSE 'buying' END | '/declutter?view=offers'
// @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),\n      '/declutter?tab=selling' | You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),\n      '/declutter?view=cart'
// @mutate supabase/migrations/20261030164712_declutter_porch_places.sql | you''ll be told the pickup time.', '/declutter?tab=selling' | you''ll be told the pickup time.', '/declutter?view=cart'
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
// #37: a recipient that is plainly the buyer (o.buyer_id, r.buyer_id, v_line.buyer_id, NEW.buyer_id, p_buyer, v_buyer).
const toBuyer = calls.filter((c) => !/^CASE\b/i.test(c.to) && /buyer/i.test(c.to));
const BUYER_SCREENS = /'\/declutter\?(?:view=cart|tab=buying|view=bought)\b/;
const SELLER_SCREENS = /'\/declutter\?(?:tab=selling|view=selling|view=sales|view=mine)\b/;
// ?view=offers is guessed from the member's badges (tabs.ts oldDeclutterView), so it can open either side.
const EITHER_SIDE = /'\/declutter\?view=offers\b/;

describe("a Declutter notice opens the recipient's own side", () => {
  it("reads the calls (floors, so a parser that reads nothing goes red)", () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(toSeller.length).toBeGreaterThan(20);
    expect(toBuyer.length).toBeGreaterThan(30);
  });

  it("no notice to the seller links the buyer's cart or Buying, or the either-side offers address", () => {
    const wrong = toSeller.filter((c) => BUYER_SCREENS.test(c.link) || EITHER_SIDE.test(c.link)).map((c) => `${c.fn}: ${c.title} -> ${c.link}`);
    expect(wrong).toEqual([]);
  });

  it("no notice to the buyer links Selling, or the either-side offers address (#37)", () => {
    const wrong = toBuyer.filter((c) => SELLER_SCREENS.test(c.link) || EITHER_SIDE.test(c.link)).map((c) => `${c.fn}: ${c.title} -> ${c.link}`);
    expect(wrong).toEqual([]);
  });

  it("a notice that can go to either side follows the side the function already knows (#37)", () => {
    const link = (fn: string, title: string) => calls.filter((c) => c.fn === fn && c.title === title).map((c) => c.link.replace(/\s+/g, " "));
    expect(link("declutter_give_strike", "'You got a Declutter strike'")).toEqual(["'/declutter?tab=' || CASE WHEN p_side = 'seller' THEN 'selling' ELSE 'buying' END"]);
    expect(link("declutter_respond_offer", "'New counteroffer'")).toEqual(["'/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END"]);
    expect(link("declutter_respond_offer", "'Offer declined'")).toEqual(["CASE WHEN v_side = 'seller' THEN '/declutter/item/' || o.item_id::text ELSE '/declutter?tab=selling' END"]);
  });
});
