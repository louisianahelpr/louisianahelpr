/**
 * Declutter trades audit 11-08 (#1, #2, #4-#9, #11): a trade is two $0 lines marked with swap_id, and every free-item
 * path branches on the mark. Behaviour (real Postgres): src/test/pglite/declutterTradesFixes.pglite.mjs (42 PASS;
 * NEW_MIGRATION=skip is red, 29 fail). This guard pins, on the NEWEST definitions (any dollar tag, comments blanked),
 * the lines that proof exercises, plus the two restated bodies the proof cannot run in its small world
 * (declutter_deadline_sweep's free branch and declutter_my_cart's source).
 *
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   IF v_all_swap THEN\n    PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');\n  ELSE | IF false THEN\n    PERFORM 1;\n  ELSE
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |           IF v_line.swap_id IS NOT NULL THEN\n            PERFORM public.declutter_end_swap(v_line.swap_id, NULL); |           IF false THEN\n            PERFORM 1;
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |           v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);\n          -- CHANGED (trades #2) |           -- CHANGED (trades #2)
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |     PERFORM public.declutter_end_swap(v_line.swap_id, v_uid);\n    RETURN public.declutter_active_strike_count(v_uid); |     RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id, 'x', v_line.id);
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   UPDATE public.declutter_cart_items SET swap_id = p_swap_id WHERE id IN (v_buyer_line, v_seller_line); |   NULL;
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |          CASE WHEN c.swap_id IS NOT NULL THEN 'swap' ELSE c.source END  -- DB-5; | c.source  -- DB-5;
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   IF NOT coalesce(p_seed, false) THEN\n    PERFORM public.send_notice_email | IF true THEN\n    PERFORM public.send_notice_email
 * @mutate supabase/migrations/20261108195151_declutter_trades_fixes.sql |   AFTER UPDATE OF status, seller_hidden, current_price_cents ON public.declutter_items |   AFTER UPDATE OF status, seller_hidden ON public.declutter_items
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const defs = effectiveDefs(DIR);
const body = (name: string): string => {
  const def = defs.get(name);
  expect(def, `${name} is gone`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};
/** The newest CREATE TRIGGER for a trigger name (comments blanked). */
const newestTrigger = (name: string): string => {
  let last = "";
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
    for (const m of sql.matchAll(new RegExp(`CREATE TRIGGER ${name}\\s+([\\s\\S]*?);`, "gi"))) last = m[1];
  }
  return last;
};

describe("Declutter trades fixes (audit 11-08)", () => {
  it("#1 an all-trade free checkout keeps the ID check and skips the fee half; anything else meets the full gate", () => {
    const b = body("declutter_checkout_free");
    expect(b).toMatch(/IF v_all_swap THEN\s+PERFORM public\.declutter_identity_gate\(v_uid, 'identity_required_to_buy'\);\s+ELSE\s+PERFORM public\.declutter_free_claim_gate\(v_uid\);/i);
    expect(b).toMatch(/v_all_swap := NOT EXISTS \(SELECT 1 FROM public\.declutter_cart_items c WHERE c\.id = ANY \(v_lines\) AND c\.swap_id IS NULL\)/i);
  });

  it("#2 accept marks both lines, and the cart read says 'swap' for them", () => {
    expect(body("declutter_respond_swap")).toMatch(/UPDATE public\.declutter_cart_items SET swap_id = p_swap_id WHERE id IN \(v_buyer_line, v_seller_line\)/i);
    expect(body("declutter_my_cart")).toMatch(/CASE WHEN c\.swap_id IS NOT NULL THEN 'swap' ELSE c\.source END/i);
  });

  it("#2/#4 the deadline sweep's free branch reopens held-back offers and ends a trade once, with no free-item notice", () => {
    const b = body("declutter_deadline_sweep");
    const free = b.slice(b.indexOf("ELSIF v_line.price_cents = 0 THEN"), b.indexOf("ELSIF v_line.source = 'buy' THEN"));
    expect(free.length).toBeGreaterThan(200);
    expect(free).toMatch(/declutter_reopen_voided_offers\(v_line\.id\)/);
    expect(free).toMatch(/IF v_line\.swap_id IS NOT NULL THEN\s+PERFORM public\.declutter_end_swap\(v_line\.swap_id, NULL\);\s+ELSE\s+PERFORM public\.declutter_notify\(v_line\.buyer_id, 'declutter_sales', 'Free item went back up'/i);
  });

  it("#5 backing out of a trade line ends the whole trade, with no strike", () => {
    const b = body("declutter_seller_cancel_sale");
    const swap = b.slice(b.indexOf("IF v_line.swap_id IS NOT NULL THEN"), b.indexOf("IF v_line.price_cents = 0 THEN"));
    expect(swap).toMatch(/PERFORM public\.declutter_end_swap\(v_line\.swap_id, v_uid\);\s+RETURN public\.declutter_active_strike_count\(v_uid\);/i);
    expect(swap).not.toMatch(/declutter_give_strike/);
    expect(body("declutter_end_swap")).not.toMatch(/declutter_give_strike/);
  });

  it("#6/#7 the void trigger also fires on a price change, and test trades are never emailed", () => {
    expect(newestTrigger("declutter_items_void_swaps")).toMatch(/AFTER UPDATE OF status, seller_hidden, current_price_cents ON public\.declutter_items/i);
    expect(body("declutter_swap_tell")).toMatch(/IF NOT coalesce\(p_seed, false\) THEN\s+PERFORM public\.send_notice_email/i);
  });
});
