/**
 * Declutter audit 1b #6 (prod 2026-10-29): a refund that left the seller owing money (declutter_seller_fee_debts) was
 * never explained; the card later took "$0.69 you owed" out of a payout with no notice before it.
 *
 * CLASS: every place the EFFECTIVE migrations insert a refund-keyed declutter_seller_fee_debts row (refund_id) tells
 * the seller right after the insert. Today: declutter_record_refund ('You owe from a refund', only when the insert
 * inserted, so a replay says nothing) and declutter_setup_job_fee_debt (its own notice). A new refund-debt writer
 * without a notice turns this red. (Shops refunds and delivery raises key their debts by other columns.)
 * Backend proof: src/test/pglite/declutterRefundDebtNotice.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql |       IF FOUND THEN\n        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund', |       IF false THEN\n        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql |       IF FOUND THEN\n        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund', |       IF true THEN\n        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql | public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0 | NULL::text, to_char(v_fee / 100.0
 * BUY-30 (20261031105148): the notice names the item; proof src/test/pglite/declutterRefundDebtNoticeNamesItem.pglite.mjs (3x; skip red).
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("audit 1b #6: a refund that leaves the seller owing money tells them", () => {
  const INSERT = /INSERT INTO public\.declutter_seller_fee_debts (?:AS d )?\(seller_id, refund_id,/;
  const writers = [...DEFS].filter(([, d]) => INSERT.test(flat(d.stmt)));

  it("reads the refund-debt writers (floor)", () => {
    expect(writers.map(([n]) => n).sort()).toEqual(["declutter_record_refund", "declutter_setup_job_fee_debt"]);
  });

  it("every refund-debt insert is followed by a notice to the seller", () => {
    const missing = writers.filter(([, d]) => {
      const b = flat(d.stmt);
      const at = b.search(INSERT);
      return !b.slice(at, at + 900).includes("PERFORM public.declutter_notify(v_seller,");
    }).map(([n]) => n);
    expect(missing).toEqual([]);
  });

  it("record_refund tells the seller only when it recorded a new debt, in words that name no fee", () => {
    const b = flat(DEFS.get("declutter_record_refund")?.stmt ?? "");
    expect(b).toMatch(/ON CONFLICT \(refund_id\) DO NOTHING; IF FOUND THEN PERFORM public\.declutter_notify\(v_seller, 'declutter_refunds', 'You owe from a refund',/);
    // BUY-30 (20261031105148): the notice names the item.
    const words = "'This refund on %s leaves you owing $%s. It comes out of your next Declutter sale''s payout.', public.declutter_order_items_named(p_order_id),";
    expect(b).toContain(words);
    expect(words).not.toMatch(/fee/i);
  });
});
