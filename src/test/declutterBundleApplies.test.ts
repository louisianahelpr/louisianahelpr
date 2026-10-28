/**
 * "Buy 2+, get N% off" can be shown only where it applies (deep audit 2026-10-28, #36; migration 20261028214524).
 * The badge showed on items whose price already is their private lowest price, where checkout cannot discount.
 * declutter_bundle_applies(ids) answers which LIVE items checkout can discount, with the SAME bound
 * declutter_bundle_targets uses (never below GREATEST($1, the item's floor)), ids only.
 *
 * Reads the EFFECTIVE definitions: the bound in declutter_bundle_applies must stay the one in
 * declutter_bundle_targets (if checkout's bound changes, this goes red until the read follows it), and the read
 * is signed-in + switch, anon revoked. Backend proof: src/test/pglite/declutterBundleApplies.pglite.mjs (3x;
 * the real declutter_bundle_targets discounts exactly the returned items at 5% and 50%; RED before it and on 7
 * planted defects).
 */
// @mutate supabase/migrations/20261028214524_declutter_bundle_applies.sql | AND i.current_price_cents > GREATEST(100, COALESCE(p.floor_price_cents, 100)) | AND i.current_price_cents > 100
// @mutate supabase/migrations/20261028214524_declutter_bundle_applies.sql |        AND i.status = 'live'\n |
// @mutate supabase/migrations/20261028214524_declutter_bundle_applies.sql |   PERFORM public.require_feature('declutter');\n |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(DIR);
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("the bundle badge shows only where checkout can apply it", () => {
  const applies = flat("declutter_bundle_applies");
  const targets = flat("declutter_bundle_targets");

  it("reads both definitions (floor)", () => {
    expect(applies.length).toBeGreaterThan(400);
    expect(targets.length).toBeGreaterThan(400);
  });

  it("uses checkout's own bound: never below GREATEST($1, the item's floor)", () => {
    expect(targets).toContain("GREATEST(100, COALESCE(b.floor, 100),");
    expect(targets).toContain("p.floor_price_cents AS floor");
    expect(applies).toContain("AND i.current_price_cents > GREATEST(100, COALESCE(p.floor_price_cents, 100))");
  });

  it("live items only, ids only, signed in with the switch on, anon revoked", () => {
    expect(applies).toContain("RETURNS uuid[]");
    expect(applies).toContain("AND i.status = 'live'");
    expect(applies).toContain("AND NOT (i.is_seed AND public.seed_hidden_for(v_uid))");
    expect(applies.indexOf("RAISE EXCEPTION 'not_authenticated'")).toBeGreaterThan(-1);
    expect(applies.indexOf("PERFORM public.require_feature('declutter');")).toBeGreaterThan(applies.indexOf("'not_authenticated'"));
    expect(applies).toContain("SELECT array_agg(i.id ORDER BY i.id)");
    const sql = blankSqlComments(readFileSync(resolve(DIR, DEFS.get("declutter_bundle_applies")!.file), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_bundle_applies(uuid[]) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_bundle_applies(uuid[]) TO authenticated, service_role;");
  });
});
