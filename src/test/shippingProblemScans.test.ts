/**
 * Q2259 shipping problem scans (spec 7: return-to-sender and failure scans go to a problem state): the newest
 * declutter_ship_problem_scan opens one system 'not_received' problem on a paid ship order when the shipment first
 * reaches 'return_to_sender' or 'failure' (never 'available_for_pickup'), under the sweeps' order lock, once (the
 * one-open-problem index), and tells admins only about real members. The trigger fires on tracking_status changes.
 * Behaviour proven in PGlite: src/test/pglite/shippingProblemScans.pglite.mjs (64/64; NEW_MIGRATION=skip 10 FAIL;
 * 5 planted defects RED).
 *
 * @mutate supabase/migrations/20261103204805_shipping_problem_scans_open_a_problem.sql | NOT IN ('return_to_sender', 'failure') | NOT IN ('return_to_sender')
 * @mutate supabase/migrations/20261103204805_shipping_problem_scans_open_a_problem.sql | IF o.status <> 'paid' OR | IF
 * @mutate supabase/migrations/20261103204805_shipping_problem_scans_open_a_problem.sql | ON CONFLICT (order_id) WHERE status = 'open' DO NOTHING | ON CONFLICT DO NOTHING
 * @mutate supabase/migrations/20261103204805_shipping_problem_scans_open_a_problem.sql | AFTER UPDATE OF tracking_status ON public.shipments\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_problem_scan() | AFTER UPDATE OF accepted_at ON public.shipments\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_problem_scan()
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The newest CREATE of a function, any dollar tag, comments blanked. */
function newest(name: string): { file: string; body: string } {
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "g");
    let m: RegExpExecArray | null;
    let at = -1;
    while ((m = re.exec(sql))) at = m.index;
    if (at < 0) continue;
    const tag = /\bAS (\$\w*\$)/.exec(sql.slice(at));
    if (!tag) continue;
    const start = at + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], start);
    return { file: f, body: flat(sql.slice(at, end)) };
  }
  throw new Error(`no ${name}`);
}

/** The newest CREATE TRIGGER <name> statement, comments blanked. */
function newestTrigger(name: string): string {
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const at = sql.lastIndexOf(`CREATE TRIGGER ${name} `);
    if (at >= 0) return flat(sql.slice(at, sql.indexOf(";", at)));
  }
  throw new Error(`no trigger ${name}`);
}

describe("a return-to-sender or failure scan opens a problem on the order", () => {
  const fn = newest("declutter_ship_problem_scan");

  it("opens one system not_received problem on a paid ship order, under the order lock", () => {
    expect(fn.file >= "20261103204805").toBe(true);
    for (const cond of [
      "NEW.tracking_status NOT IN ('return_to_sender', 'failure')",
      "OR OLD.tracking_status IS NOT DISTINCT FROM NEW.tracking_status THEN RETURN NEW;",
      "o := public.declutter_lock_order(NEW.declutter_order_id);",
      "IF o.status <> 'paid' OR o.handover IS DISTINCT FROM 'ship' THEN RETURN NEW;",
      "VALUES (o.id, NULL, 'system', 'not_received',",
      "ON CONFLICT (order_id) WHERE status = 'open' DO NOTHING",
      "IF NOT (COALESCE(o.is_seed, false) OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN",
    ]) expect(fn.body, cond).toContain(cond);
    expect(fn.body).not.toContain("available_for_pickup");
  });

  it("fires on every tracking_status change of a shipment", () => {
    expect(newestTrigger("trg_shipments_problem_scan")).toBe(
      "CREATE TRIGGER trg_shipments_problem_scan AFTER UPDATE OF tracking_status ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_problem_scan()");
  });

  it("every shipping sweep skips an order with an open problem (so the problem holds the money)", () => {
    const sweep = newest("declutter_ship_sweep").body;
    const n = sweep.split("NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')").length - 1;
    expect(n).toBeGreaterThan(2);
  });
});
