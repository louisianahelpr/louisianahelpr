/**
 * Q2268: the seller's "Accept all / Pick some" bundle request, server side.
 * Behaviour (real Postgres): src/test/pglite/declutterBundleRequest.pglite.mjs (30 PASS; 4 planted defects red).
 * This guard pins, on the NEWEST definition of each function (any dollar tag, comments blanked), the money and
 * authz lines that proof exercises, so a later restatement cannot quietly drop one.
 *
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql | v_req.buyer_id, least(v_row.price_cents, v_item.o_price_cents) | v_req.buyer_id, v_row.price_cents
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql | IF NOT FOUND OR v_req.seller_id <> v_uid THEN | IF NOT FOUND THEN
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql | EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'PT404' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN | EXCEPTION WHEN SQLSTATE 'XX999' THEN
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql |   PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy'); |   PERFORM 1;
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql | GRANT EXECUTE ON FUNCTION public.declutter_bundle_sweep() TO service_role; | GRANT EXECUTE ON FUNCTION public.declutter_bundle_sweep() TO authenticated;
 * @mutate supabase/migrations/20261104103528_declutter_bundle_request.sql |     SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_item_id, v_uid); |     SELECT seller_id AS o_seller_id, current_price_cents AS o_price_cents INTO v_item FROM public.declutter_items WHERE id = v_item_id;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FNS = ["declutter_request_bundle", "declutter_answer_bundle", "declutter_withdraw_bundle", "declutter_bundle_sweep"];

const body = (name: string): string => {
  const def = effectiveDefs(DIR).get(name);
  expect(def, `${name} is gone`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};

/** Every migration's SQL, comments blanked, oldest first. */
const allSql = (): string => migrationFiles(DIR).map((f) => blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"))).join("\n");

describe("Declutter bundle request (Q2268)", () => {
  it("all four functions exist", () => {
    const defs = effectiveDefs(DIR);
    const present = FNS.filter((f) => defs.has(f));
    expect(present.length).toBeGreaterThan(3);
  });

  it("the buyer's checks run on every asked item (card, blocks, own item, seed rules, still live)", () => {
    // Review 11-04 (blocker): the first-purchase ID check runs at the ask, as the buyer.
    expect(body("declutter_request_bundle")).toMatch(/PERFORM\s+public\.declutter_identity_gate\(v_uid,\s*'identity_required_to_buy'\)/i);
    expect(body("declutter_request_bundle")).toMatch(/FOREACH\s+v_item_id\s+IN\s+ARRAY\s+v_ids\s+LOOP\s+SELECT\s+\*\s+INTO\s+v_item\s+FROM\s+public\.declutter_lock_buyable_item\(v_item_id,\s*v_uid\)/i);
  });

  it("only the request's seller answers, each accepted item is charged the lower of the asked and today's price, and a sold item is skipped, not charged", () => {
    const b = body("declutter_answer_bundle");
    expect(b).toMatch(/IF\s+NOT\s+FOUND\s+OR\s+v_req\.seller_id\s*<>\s*v_uid\s+THEN/i);
    expect(b).toMatch(/declutter_lock_buyable_item\(v_row\.item_id,\s*v_req\.buyer_id\)/i);
    expect(b).toMatch(/declutter_take_item\(v_row\.item_id,\s*v_req\.buyer_id,\s*least\(v_row\.price_cents,\s*v_item\.o_price_cents\)/i);
    expect(b).toMatch(/EXCEPTION\s+WHEN\s+SQLSTATE\s+'55000'\s+OR\s+SQLSTATE\s+'PT404'\s+OR\s+SQLSTATE\s+'P0002'\s+OR\s+SQLSTATE\s+'22023'\s+THEN/i);
  });

  it("anon executes none of them; the sweep is service_role only", () => {
    const sql = allSql();
    for (const f of FNS) expect(sql, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`, "i"));
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_bundle_sweep\(\) TO service_role;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_bundle_sweep\(\) TO [^;]*authenticated/i);
  });
});
