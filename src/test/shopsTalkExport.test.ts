/**
 * Shops messages in Download My Data (NOT-LAUNCHED Q1947): the newest export_my_data carries each side's shop chats
 * (the shopper's, and every chat with the owner's shop) and their messages, never the other side's id. Reads the
 * EFFECTIVE (newest) definition; behaviour on a real database is src/test/pglite/shopsTalkExport.pglite.mjs (3x).
 *
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql | ELSE to_jsonb(t) - 'buyer_id' - 'buyer_notified_at' | ELSE to_jsonb(t) - 'buyer_notified_at'
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql | jsonb_build_object('shop_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object( | jsonb_build_object('shop_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('sender_id', t.sender_id,
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql | WHERE t.buyer_id = v_uid OR t.shop_id IN (SELECT s.id FROM public.shops s WHERE s.owner_id = v_uid))); | WHERE t.buyer_id = v_uid)));
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { resolve } from "node:path";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

/** One section of the newest export_my_data, from its jsonb_build_object to the next one (or the RETURN). */
const section = (name: string) => {
  const t = flat("export_my_data");
  const start = t.indexOf(`jsonb_build_object('${name}',`);
  if (start < 0) return "";
  const next = t.indexOf("v_out := v_out", start);
  return t.slice(start, next < 0 ? t.indexOf("RETURN v_out", start) : next);
};

describe("Shops messages: Download My Data (Q1947)", () => {
  it("reads the newest definition (floor)", () => {
    expect(DEFS.get("export_my_data")?.file ?? "").not.toBe("");
    expect(section("shop_talks").length).toBeGreaterThan(200);
    expect(section("shop_talk_messages").length).toBeGreaterThan(200);
  });

  it("each side gets its chats: the shopper's own, and every chat with the owner's shop", () => {
    expect(section("shop_talks")).toContain("WHERE t.buyer_id = v_uid OR t.shop_id IN (SELECT s.id FROM public.shops s WHERE s.owner_id = v_uid)");
    expect(section("shop_talk_messages")).toContain("WHERE st.buyer_id = v_uid OR s.owner_id = v_uid");
  });

  it("the export never hands one side the other's id", () => {
    expect(section("shop_talks")).toContain("ELSE to_jsonb(t) - 'buyer_id' - 'buyer_notified_at' - 'buyer_read_at' END");
    expect(section("shop_talks")).toContain("THEN to_jsonb(t) - 'shop_notified_at' - 'shop_read_at'");
    expect(section("shop_talk_messages")).not.toMatch(/to_jsonb\(t\)|'sender_id'/);
    expect(section("shop_talk_messages")).toContain("'mine', t.sender_id IS NOT DISTINCT FROM v_uid,");
  });
});
