/**
 * GUARD (Q1948 L92, owner 11-12): following a shop tells you when it lists something new, once per item, and never
 * for test data. Migration 20261112070000; backend proof src/test/pglite/shopsFollowAlerts.pglite.mjs.
 *
 * Built from the migrations (the NEWEST definition of shop_items_tell_followers and the newest type CHECK):
 *   1. A trigger on shop_items runs shop_items_tell_followers BEFORE INSERT OR UPDATE OF status.
 *   2. The function stamps followers_told_at and returns early once stamped (one notice per item), skips an is_seed
 *      item, a test shop, a test owner, a paused shop and one not in good standing, skips the owner, a blocked
 *      follower and a follower with the shops switch off, writes type shops_following, and catches its own errors.
 *   3. shops_following is in the newest notifications_type_check and every client/edge registry; its email switch
 *      defaults OFF (no email sender) and the settings row says so.
 *
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql |   IF NEW.status IS DISTINCT FROM 'live' OR NEW.followers_told_at IS NOT NULL THEN |   IF NEW.status IS DISTINCT FROM 'live' THEN
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql |      WHERE f.shop_id = v_shop.id\n       AND f.user_id <> v_shop.owner_id\n       AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id)\n |      WHERE f.shop_id = v_shop.id\n       AND f.user_id <> v_shop.owner_id\n
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql |   IF coalesce(NEW.is_seed, false) THEN\n    RETURN NEW;\n  END IF;\n |
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql |   EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'shop_items_tell_followers: %', SQLERRM;\n |
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql |   BEFORE INSERT OR UPDATE OF status ON public.shop_items | AFTER DELETE ON public.shop_items
 * @mutate supabase/migrations/20261112070000_shops_follow_alerts.sql | email_shops_following boolean NOT NULL DEFAULT false; | email_shops_following boolean NOT NULL DEFAULT true;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, sql: flat(readFileSync(resolve(MIGRATIONS, f), "utf8")) }));
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("Shops: new from shops you follow (L92)", () => {
  it("a trigger on shop_items runs shop_items_tell_followers before an insert or a status change", () => {
    const last = [...all].reverse().find((m) => m.sql.includes("TRIGGER trg_shop_items_tell_followers"));
    expect(last?.sql).toMatch(/CREATE TRIGGER trg_shop_items_tell_followers BEFORE INSERT OR UPDATE OF status ON public\.shop_items FOR EACH ROW EXECUTE FUNCTION public\.shop_items_tell_followers\(\)/);
  });

  it("once per item, every skip, the type, and a catch", () => {
    const body = flat(DEFS.get("shop_items_tell_followers")?.stmt ?? "");
    expect(body).toContain("IF NEW.status IS DISTINCT FROM 'live' OR NEW.followers_told_at IS NOT NULL THEN RETURN NEW;");
    expect(body).toContain("NEW.followers_told_at := now();");
    expect(body).toContain("IF coalesce(NEW.is_seed, false) THEN RETURN NEW;");
    for (const skip of ["coalesce(v_shop.is_seed, false)", "coalesce(v_shop.paused, false)", "NOT public.shop_state_ok(v_shop.id)", "public.is_test_subject(v_shop.owner_id)",
      "AND f.user_id <> v_shop.owner_id AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id) AND public.feature_enabled_for_user('shops', f.user_id)"]) {
      expect(body, skip).toContain(skip);
    }
    expect(body).toContain("'shops_following', v_link, v_shop.owner_id");
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING 'shop_items_tell_followers: %', SQLERRM;/);
  });

  it("shops_following is in the newest type CHECK, every registry, and its email switch defaults OFF", () => {
    const check = [...all].reverse().find((m) => m.sql.includes("ADD CONSTRAINT notifications_type_check"));
    expect(check?.sql).toContain("'shops_following'");
    expect(check?.sql).toContain("'admin_activity'");
    const mig = all.find((m) => m.f.endsWith("_shops_follow_alerts.sql"))?.sql ?? "";
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS email_shops_following boolean NOT NULL DEFAULT false;");
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS shops_following boolean NOT NULL DEFAULT true;");
    expect(read("supabase/functions/_shared/notificationTypes.ts")).toMatch(/shops_following:\s+\{ prefCol: 'email_shops_following'/);
    expect(read("supabase/functions/create-notification/index.ts")).toContain('"shops_following"');
    expect(read("src/components/notificationPreferences/constants.tsx")).toMatch(/key: "shops_following", emailKey: "email_shops_following".*noEmailSwitch: NO_EMAIL/);
    expect(read("src/components/notificationPreferences/deployLagColumns.ts")).toContain('"shops_following"');
  });
});
