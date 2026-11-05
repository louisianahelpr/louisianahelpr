/**
 * Shops H4 part 1 (20261105174853_shops_identity_check; audit ~/.lh-shots/audit-1105-shops.md H4, owner rule 10-30
 * "once per account, ever"): the shop owner is checked like a Declutter seller (at the first live item) and the
 * buyer like a Declutter buyer (at the first order), through Declutter's one gate. The fast half, read from the
 * NEWEST definitions the migrations leave:
 *
 *   1. The two trigger functions call declutter_identity_gate for the row's owner / buyer, with Declutter's codes,
 *      judge a listing only on draft -> pending_review / live, and are not client-callable.
 *   2. The triggers sit on shop_items (status) and shop_orders (INSERT), and the real writers put the caller in
 *      the judged column (shops_request_order inserts buyer_id = v_uid; publish writes the owner's own item).
 *   3. The app answers the refusal: the one ID sheet opens with Shops' own words, never "Declutter", and the
 *      refusal has plain words.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsIdentityCheck.pglite.mjs (22 PASS; --before 8 of 8 RED
 * checks fail).
 *
 * @mutate supabase/migrations/20261105174853_shops_identity_check.sql |     PERFORM public.declutter_identity_gate(NEW.owner_id, 'identity_required_to_list'); |     NULL;
 * @mutate supabase/migrations/20261105174853_shops_identity_check.sql |   PERFORM public.declutter_identity_gate(NEW.buyer_id, 'identity_required_to_buy'); |   NULL;
 * @mutate supabase/migrations/20261105174853_shops_identity_check.sql | (TG_OP = 'INSERT' OR OLD.status = 'draft') | (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'live'))
 * @mutate src/lib/shops/orders.ts |     void openShopsIdentityCheckFor(refusal);\n | \n
 * @mutate src/lib/shops/items.ts |   void openShopsIdentityCheckFor(result.error);\n | \n
 * @mutate src/lib/shops/errors.ts |   if (kind === "buy") return openIdentityCheck("shop_buy"); |   if (kind === "buy") return openIdentityCheck("buy");
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const opened = vi.hoisted(() => ({ reasons: [] as string[] }));
vi.mock("@/lib/identityCheck", async (orig) => ({
  ...(await orig<typeof import("@/lib/identityCheck")>()),
  openIdentityCheck: (reason: string) => {
    opened.reasons.push(reason);
    return true;
  },
}));

import { openShopsIdentityCheckFor, shopsErrorMessage } from "@/lib/shops/errors";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261105174853_shops_identity_check.sql";
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8")).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("Shops ID check, once per account (20261105174853)", () => {
  it("reads real definitions (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(1000);
    expect(body("shop_identity_before_list").length).toBeGreaterThan(100);
    expect(body("shop_identity_before_buy").length).toBeGreaterThan(100);
  });

  it("1. the triggers call Declutter's one gate for the row's owner / buyer", () => {
    const list = body("shop_identity_before_list");
    expect(list).toContain("IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN");
    expect(list).toContain("PERFORM public.declutter_identity_gate(NEW.owner_id, 'identity_required_to_list');");
    expect(body("shop_identity_before_buy")).toContain("PERFORM public.declutter_identity_gate(NEW.buyer_id, 'identity_required_to_buy');");
    for (const fn of ["shop_identity_before_list", "shop_identity_before_buy"]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`);
      expect(MIG).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`));
    }
    // The gate keeps its carve-outs (server writes, admins, exempt, verified): Shops reuses it, never a copy.
    const gate = body("declutter_identity_gate");
    expect(gate).toContain("IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) THEN RETURN;");
    expect(gate).toContain("IF public.is_identity_verified(auth.uid()) THEN RETURN;");
  });

  it("2. the triggers sit on the tables the real writers use, judging the caller", () => {
    expect(MIG).toContain("CREATE TRIGGER trg_shop_items_identity_before_list BEFORE INSERT OR UPDATE OF status ON public.shop_items FOR EACH ROW EXECUTE FUNCTION public.shop_identity_before_list();");
    expect(MIG).toContain("CREATE TRIGGER trg_shop_orders_identity_before_buy BEFORE INSERT ON public.shop_orders FOR EACH ROW EXECUTE FUNCTION public.shop_identity_before_buy();");
    expect(MIG).toContain("DROP TRIGGER IF EXISTS trg_shop_items_identity_before_list ON public.shop_items;");
    expect(MIG).toContain("DROP TRIGGER IF EXISTS trg_shop_orders_identity_before_buy ON public.shop_orders;");
    const req = body("shops_request_order");
    expect(req).toMatch(/INSERT INTO public\.shop_orders \(buyer_id, [^)]*\) VALUES \(v_uid,/);
    expect(req).toContain("v_uid uuid := (SELECT auth.uid());");
    expect(body("shops_publish_item")).toContain("v_item := public.shops_lock_own_item(p_item_id, v_uid);");
    // shop-checkout asks for the order with the BUYER's token, so auth.uid() is the buyer inside the trigger.
    expect(src("supabase/functions/shop-checkout/index.ts")).toContain('await asBuyer.rpc("shops_request_order"');
  });

  it("3. the app opens the one ID sheet with Shops' own words, and says what to do", async () => {
    opened.reasons.length = 0;
    expect(await openShopsIdentityCheckFor(new Error("identity_required_to_buy"))).toBe(true);
    expect(await openShopsIdentityCheckFor({ message: "identity_required_to_list" })).toBe(true);
    expect(await openShopsIdentityCheckFor(new Error("item_not_found"))).toBe(false);
    expect(opened.reasons).toEqual(["shop_buy", "shop_list"]);
    expect(shopsErrorMessage(new Error("identity_required_to_buy"))).toBe("Verify your ID with Stripe first. It takes about 2 minutes, once, then order again.");
    expect(shopsErrorMessage(new Error("identity_required_to_list"))).toBe("Verify your ID with Stripe first. It takes about 2 minutes, once, then publish again.");
    const sheet = src("src/components/identity/IdentityCheckSheet.tsx");
    for (const reason of ["shop_buy", "shop_list"]) {
      const line = new RegExp(`\\n\\s*${reason}: "([^"]+)",`).exec(sheet)?.[1] ?? "";
      expect(line).toMatch(/Stripe checks a photo ID and a selfie\.$/);
      expect(line).not.toMatch(/Declutter/);
    }
    // Every refusal path the two triggers reach goes through the sheet opener.
    expect(src("src/lib/shops/items.ts")).toMatch(/function rpcData[\s\S]{0,500}void openShopsIdentityCheckFor\(result\.error\);/);
    expect(src("src/lib/shops/orders.ts")).toMatch(/async function invokeShopCheckout[\s\S]{0,900}void openShopsIdentityCheckFor\(refusal\);\s*throw refusal;/);
  });
});
