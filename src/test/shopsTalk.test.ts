/**
 * Shops H1 (audit 11-05; owner L48 "messages any time", O9): a member messages a shop and the shop answers. Reads the
 * EFFECTIVE (newest) definitions and the screen that mounts it; behaviour on a real database is
 * src/test/pglite/shopsTalk.pglite.mjs (3x, Supabase's default anon execute grant emulated).
 *
 * @mutate supabase/migrations/20261105185006_shops_talk.sql |   IF v_owner = v_uid THEN\n    RAISE EXCEPTION 'own_shop' |   IF false THEN\n    RAISE EXCEPTION 'own_shop'
 * @mutate supabase/migrations/20261105185006_shops_talk.sql |   IF public.are_users_blocked(t.buyer_id, s.owner_id) THEN\n    RAISE EXCEPTION 'talk_blocked' |   IF false THEN\n    RAISE EXCEPTION 'talk_blocked'
 * @mutate supabase/migrations/20261105185006_shops_talk.sql | REVOKE ALL ON FUNCTION public.shops_send_talk_message(uuid, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_send_talk_message(uuid, text) FROM PUBLIC;
 * @mutate src/components/shops/ShopView.tsx | {!s.mine && <ShopMessageButton shopId={s.id} />} | <ShopMessageButton shopId={s.id} />
 * @mutate src/components/shops/ShopView.tsx |         <ShopTalkFromLink />\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");
const RPCS = ["shops_open_talk", "shops_talk_view", "shops_send_talk_message", "shops_my_talks", "shops_mark_talk_read"];

describe("a member can message a shop (Shops H1)", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of [...RPCS, "shop_talk_side", "reject_contact_leak_in_shop_talk"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(150);
    }
  });

  it("every RPC is behind the Shops switch and refuses strangers; never anon", () => {
    for (const fn of RPCS) {
      expect(flat(fn), fn).toContain("PERFORM public.require_feature('shops')");
      const file = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", DEFS.get(fn)?.file ?? ""), "utf8")).replace(/\s+/g, " ");
      expect(file, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    for (const fn of ["shops_talk_view", "shops_send_talk_message", "shops_mark_talk_read"]) {
      expect(flat(fn), fn).toContain("v_side := public.shop_talk_side(p_talk_id, v_uid); IF v_side IS NULL THEN RAISE EXCEPTION 'talk_not_found'");
    }
  });

  it("never your own shop, never across a block, the leak filter on every message, the notice never carries words", () => {
    expect(flat("shops_open_talk")).toContain("IF v_owner = v_uid THEN RAISE EXCEPTION 'own_shop'");
    expect(flat("shops_open_talk")).toContain("NOT public.shop_state_ok(p_shop_id)");
    expect(flat("shops_send_talk_message")).toContain("IF public.are_users_blocked(t.buyer_id, s.owner_id) THEN RAISE EXCEPTION 'talk_blocked'");
    expect(flat("reject_contact_leak_in_shop_talk")).toContain("public.contact_leak_reason(NEW.body)");
    expect(flat("shops_send_talk_message")).not.toMatch(/declutter_notify\([^;]*v_body/);
  });

  it("the shop page mounts it: Message for a visitor, Messages for the owner, the thread from ?talk=", () => {
    const view = src("src/components/shops/ShopView.tsx");
    expect(view).toContain("{!s.mine && <ShopMessageButton shopId={s.id} />}");
    expect(view).toContain("{s.mine && <ShopTalksCard />}");
    expect(view).toContain("<ShopTalkFromLink />");
  });
});
