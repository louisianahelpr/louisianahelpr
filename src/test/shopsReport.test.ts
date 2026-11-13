/**
 * Shops H2 (audit 11-05): a shop or a live shop item can be reported, never by its owner and never one a member can't
 * be shown, and an admin acts on it from the reports queue (hide the shop, take the item down). Reads the EFFECTIVE
 * (newest) definitions and the screens that offer Report; behaviour on a real database is
 * src/test/pglite/shopsReport.pglite.mjs (3x, Supabase's default anon execute grant emulated).
 *
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql | 'declutter_review'::text, 'shop'::text, 'shop_item'::text, 'shop_talk_message'::text, 'home_listing'::text, 'home_talk_message'::text, 'shop_review'::text])); | 'declutter_review'::text, 'shop_talk_message'::text, 'home_listing'::text, 'home_talk_message'::text, 'shop_review'::text]));
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |     IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM sh.owner_id THEN |     IF false THEN
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |            AND (NOT public.shop_state_ok(sh.id) |            AND (false
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |                 OR (NEW.reported_type = 'shop_item' AND si.status IS DISTINCT FROM 'live'))) THEN |                 OR false)) THEN
 * @mutate supabase/migrations/20261105182210_shops_report_shop_and_item.sql | REVOKE ALL ON FUNCTION public.shops_admin_take_down_item(uuid, text, uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_admin_take_down_item(uuid, text, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261105182210_shops_report_shop_and_item.sql |   IF i.owner_id = v_uid THEN |   IF false THEN
 * @mutate src/components/shops/ShopView.tsx | {!s.mine && <ShopReportShop shopId={s.id} />} | <ShopReportShop shopId={s.id} />
 * @mutate src/components/shops/ShopView.tsx | <ShopItemsList shopId={s.id} reportable={!s.mine} orderable= | <ShopItemsList shopId={s.id} reportable orderable=
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { REASONS, REPORTED_NOUN } from "@/components/reportDialog/reportReasons";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).replace(/\s+/g, " ");
const typeFile = [...files].reverse().find((f) => sqlOf(f).includes("ADD CONSTRAINT reports_reported_type_check")) ?? "";
const types = sqlOf(typeFile);
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");

describe("a shop or shop item can be reported (Shops H2)", () => {
  it("reads the newest definitions (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    for (const fn of ["report_message_party_and_copy", "notify_reporter_report_outcome", "shops_admin_reported", "shops_admin_take_down_item"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("the database allows both types, and the client's union matches", () => {
    expect(types).toMatch(/'shop'::text, 'shop_item'::text(, '[a-z_]+'::text)*\]\)\)/);
    expect(REASONS.shop.length).toBeGreaterThan(2);
    expect(REASONS.shop_item.length).toBeGreaterThan(2);
    expect(REPORTED_NOUN.shop).toBe("Shop");
  });

  it("the copy trigger: only what the reporter could be shown, never your own, and the older branches kept", () => {
    const f = flat("report_message_party_and_copy");
    expect(f).toContain("IF NEW.reported_type IN ('shop', 'shop_item') THEN");
    expect(f).toContain("AND (NOT public.shop_state_ok(sh.id) OR (NEW.reported_type = 'shop_item' AND si.status IS DISTINCT FROM 'live')))");
    expect(f).toContain("IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM sh.owner_id THEN RAISE EXCEPTION 'report_own_content'");
    expect(f).toContain("IF NEW.reported_type = 'declutter_review' THEN");
    expect(f).toContain("IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN");
    expect(f).toContain("NEW.reporter_id IS DISTINCT FROM m.receiver_id");
    expect(flat("notify_reporter_report_outcome")).toContain("WHEN 'shop' THEN 'a shop' WHEN 'shop_item' THEN 'a shop item'");
  });

  it("the queue's read and the take-down are admin-only, never anon; the take-down refuses your own item and starts the re-check", () => {
    for (const fn of ["shops_admin_reported", "shops_admin_take_down_item"]) {
      expect(flat(fn), fn).toContain("PERFORM public.require_feature('shops')");
      expect(flat(fn), fn).toMatch(/has_role\(.*'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin'/);
    }
    const td = flat("shops_admin_take_down_item");
    expect(td).toContain("IF i.owner_id = v_uid THEN RAISE EXCEPTION 'own_item'");
    expect(td).toContain("rp.reported_type = 'shop_item' AND rp.reported_id = p_item_id");
    // shops_publish_item's 30-day hold reads this audit action with owner_id.
    expect(td).toMatch(/'shop_item_rejected', 'shop_item'.*'owner_id', i\.owner_id/);
    const mig = sqlOf(DEFS.get("shops_admin_take_down_item")?.file ?? "");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.shops_admin_take_down_item(uuid, text, uuid) FROM PUBLIC, anon;");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.shops_admin_reported(uuid[]) FROM PUBLIC, anon;");
  });

  it("visitors get Report on the shop and each item; the owner never does", () => {
    const view = src("src/components/shops/ShopView.tsx");
    expect(view).toContain("{!s.mine && <ShopReportShop shopId={s.id} />}");
    expect(view).toContain("<ShopItemsList shopId={s.id} reportable={!s.mine} orderable=");
    const pub = src("src/components/shops/PublicShopView.tsx");
    expect(pub).toContain("<ShopReportShop shopId={shop.id} signedIn={signedIn} />");
    expect(pub).toContain("<ShopItemsGrid items={shop.items} reportable={signedIn} "); // S2-038 adds From prices and the read-only sheet
    const report = src("src/components/shops/ShopReport.tsx");
    expect(report).toContain('reportedType="shop"');
    expect(report).toContain('reportedType="shop_item"');
    // The admin queue hydrates and acts on them.
    expect(src("src/components/admin/adminReports/fetchReports.ts")).toContain("hydrateReportedShops(reportRows)");
    expect(src("src/components/admin/AdminReports.tsx")).toContain("<ShopReportPanel");
  });
});
