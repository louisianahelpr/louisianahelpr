/**
 * Shops: NO ID check, for sellers or buyers (owner 2026-11-20, matching Declutter). 20261120203904_shops_no_id_check
 * drops the two refusals of 20261105174853 (the seller's first live item, the buyer's first order) and the
 * "Verify your ID in Settings" payout notice; declutter-money skips the ID hold for a shop payout; the app no longer
 * opens the ID sheet for Shops or says the check is coming. Read from the definitions the migrations LEAVE
 * (effectiveDefs, which honours DROP FUNCTION) and from comment-blanked source.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsNoIdCheck.pglite.mjs (10 PASS; NEW_MIGRATION=skip: 6 of 6
 * RED checks fail).
 *
 * @mutate supabase/migrations/20261120203904_shops_no_id_check.sql | DROP FUNCTION IF EXISTS public.shop_identity_before_list();\n |
 * @mutate supabase/migrations/20261120203904_shops_no_id_check.sql | DROP TRIGGER IF EXISTS trg_shop_orders_identity_before_buy ON public.shop_orders;\n |
 * @mutate supabase/migrations/20261120203904_shops_no_id_check.sql |       -- CHANGED (owner 2026-11-20): no ID check for Shops, so | WHEN public.payout_waits_on_identity(o.seller_id) THEN 'Verify your ID in Settings'\n      -- CHANGED (owner 2026-11-20): no ID check for Shops, so
 * @mutate supabase/functions/declutter-money/index.ts | const idHold = declutterKindSkipsIdHold(kind) \|\| kind === "shop" ? { kind: "clear" as const } : await checkIdentityHold(admin, payeeId); | const idHold = declutterKindSkipsIdHold(kind) ? { kind: "clear" as const } : await checkIdentityHold(admin, payeeId);
 * @mutate src/lib/shops/items.ts | function rpcData<T>(result: { data: T; error: { message: string } \| null }, words: (e: unknown) => string \| null): T {\n  if (!result.error) return result.data; | function rpcData<T>(result: { data: T; error: { message: string } \| null }, words: (e: unknown) => string \| null): T {\n  if (!result.error) return result.data;\n  void import("@/lib/identityCheck").then((m) => m.openIdentityCheck("shop_list"));
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261120203904_shops_no_id_check.sql"), "utf8")).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("Shops asks for no ID (owner 2026-11-20)", () => {
  it("reads real definitions (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(1000);
    expect(body("shop_complete_handover").length).toBeGreaterThan(2000);
  });

  it("the two refusals are gone: no trigger function is left, and the triggers are dropped", () => {
    expect(DEFS.has("shop_identity_before_list")).toBe(false);
    expect(DEFS.has("shop_identity_before_buy")).toBe(false);
    expect(MIG).toContain("DROP TRIGGER IF EXISTS trg_shop_items_identity_before_list ON public.shop_items;");
    expect(MIG).toContain("DROP TRIGGER IF EXISTS trg_shop_orders_identity_before_buy ON public.shop_orders;");
    // No Shops function the migrations leave calls the ID gate.
    const shopFns = [...DEFS.keys()].filter((n) => /^shops?_/.test(n));
    expect(shopFns.length).toBeGreaterThan(40);
    expect(shopFns.filter((n) => /declutter_identity_gate|identity_required_to_/.test(body(n)))).toEqual([]);
  });

  it("the payout notice never waits on the ID; every money step is as before", () => {
    const b = body("shop_complete_handover");
    expect(b).not.toMatch(/payout_waits_on_identity|Verify your ID/);
    expect(b).toContain("v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text,");
    expect(b).toContain("v_setup_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(o.seller_id), 0);");
    expect(b).toContain("IF v_setup_fee > 0 AND public.setup_fee_other_payout_first(o.seller_id, v_payout, v_setup_fee) THEN");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;");
  });

  it("declutter-money sends a shop payout without the ID hold, and keeps it for every other kind", () => {
    const m = src("supabase/functions/declutter-money/index.ts");
    expect(m).toMatch(/const idHold = declutterKindSkipsIdHold\(kind\) \|\| kind === "shop" \? \{ kind: "clear" as const \} : await checkIdentityHold\(admin, payeeId\);/);
  });

  it("the app never opens the ID sheet for Shops nor says the check is coming", () => {
    const shopFiles = trackedFiles("src").filter((f) => /\/shops?\//i.test(f) && /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
    expect(shopFiles.length).toBeGreaterThan(30);
    const asks = shopFiles.filter((f) => /openIdentityCheck|openShopsIdentityCheckFor|identity_required_to_|useIdentityCheck(?:Status|On)|[Vv]erify your ID/.test(src(f)));
    expect(asks).toEqual([]);
  });
});
