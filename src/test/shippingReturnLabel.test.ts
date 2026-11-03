/**
 * Q2259 spec 5.3 "a return label if the admin wants the item back = seller debt". The newest
 * declutter_admin_request_return_label is admin only behind declutter_shipping, only for a delivered ship order with a
 * not_as_described refund, TEST labels only; the worker's declutter_ship_return_label_bought books the cost as ONE
 * seller debt once; the table cannot hold a live return label; only the buyer reads the label.
 * Behaviour proven in PGlite: src/test/pglite/shippingReturnLabel.pglite.mjs (93/93; NEW_MIGRATION=skip 38 FAIL;
 * 11 planted defects RED).
 *
 * @mutate supabase/migrations/20261103212046_shipping_return_label.sql | AND d.reason = 'not_as_described') THEN | AND d.reason IS NOT NULL) THEN
 * @mutate supabase/migrations/20261103212046_shipping_return_label.sql |   IF s.label_mode IS DISTINCT FROM 'test' THEN |   IF false THEN
 * @mutate supabase/migrations/20261103212046_shipping_return_label.sql | label_mode text NOT NULL CHECK (label_mode = 'test'), | label_mode text NOT NULL CHECK (label_mode IN ('test', 'live')),
 * @mutate supabase/migrations/20261103212046_shipping_return_label.sql | AND v_uid IS NOT NULL AND o.buyer_id = v_uid; | AND v_uid IS NOT NULL;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");

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
    return { file: f, body: flat(sql.slice(at, sql.indexOf(tag[1], start))) };
  }
  throw new Error(`no ${name}`);
}

function newestTable(name: string): string {
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const at = sql.search(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(`));
    if (at >= 0) return flat(sql.slice(at, sql.indexOf("\n);", at)));
  }
  throw new Error(`no table ${name}`);
}

describe("an admin can ask for a damaged item back; the return label is the seller's debt", () => {
  it("the request is admin only, behind the switch, for a delivered not-as-described ship order, test labels only", () => {
    const fn = newest("declutter_admin_request_return_label");
    expect(fn.file >= "20261103212046").toBe(true);
    const must = [
      "PERFORM public.require_feature('declutter_shipping');",
      "IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin_only'",
      "o := public.declutter_lock_order(p_order_id);",
      "WHERE d.order_id = o.id AND d.reason = 'not_as_described') THEN",
      "IF s.id IS NULL OR s.label_state <> 'bought' OR s.delivered_at IS NULL THEN",
      "IF s.label_mode IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'return_label_test_only'",
      "INSERT INTO public.admin_audit_log",
    ];
    for (const s of must) expect(fn.body, s).toContain(s);
    expect(must.length).toBeGreaterThan(5);
  });
  it("the worker's record books the cost as one seller debt, once", () => {
    const fn = newest("declutter_ship_return_label_bought");
    for (const s of [
      "IF r.state = 'bought' THEN RETURN 'already';",
      "VALUES (o.seller_id, 'ship_label', r.id, p_cost_cents, p_cost_cents) ON CONFLICT (source_kind, source_ref) DO NOTHING",
    ]) expect(fn.body, s).toContain(s);
  });
  it("the table holds test labels only, one per order; only the buyer reads one", () => {
    const t = newestTable("shipping_return_labels");
    expect(t).toContain("order_id uuid NOT NULL UNIQUE");
    expect(t).toContain("label_mode text NOT NULL CHECK (label_mode = 'test'),");
    expect(newest("declutter_my_return_label").body).toContain("AND v_uid IS NOT NULL AND o.buyer_id = v_uid;");
  });
});
