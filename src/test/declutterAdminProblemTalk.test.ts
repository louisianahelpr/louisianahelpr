/**
 * AL-6 (owner 2026-10-28 anti-lying measures, "Chats saved and filtered"): for a reported Declutter problem an admin
 * reads the order's handover chat and its items' questions, whole, as sides only (migration 20261029005124,
 * declutter_admin_problem_talk). Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs), so a later
 * restatement that drops a rule fails here.
 *
 * Behaviour on a real database: src/test/pglite/declutterHandoverChoices.pglite.mjs T9 (3x; AL6_MIGRATION=skip 14 FAIL;
 * RED on 6 planted defects: no admin check, no chat window, an id for the side, removed questions dropped, anon
 * granted, an unknown problem answered).
 *
 * What it pins, each shown red by the @mutate below it:
 *   1. admins only, checked FIRST; no switch gate (row 62: open problems stay decidable with Declutter off);
 *   2. the columns: a side, the words and times, nothing that names a person (no name, id, email or address);
 *   3. the chat is the order's own: that buyer and seller, opened from its first cart line to the payment;
 *   4. every question on its items, removed ones included and marked (the history is kept);
 *   5. never PUBLIC or anon.
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql |   IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN | IF false THEN
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql | CASE WHEN m.sender_id = t.buyer_id THEN 'buyer' ELSE 'seller' END AS side, | m.sender_id::text AS side,
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql |            AND t.opened_at >= COALESCE(v_from, v_order.created_at)\n |
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql |          WHERE q.item_id IN | WHERE q.removed_at IS NULL AND q.item_id IN
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql | REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC;
 *   6. the chat after payment (D2-1, 20261030042545): that order's only, as the side kept on each message.
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql |          WHERE ot.order_id = v_order.id |          WHERE true
 * @mutate supabase/migrations/20261030042545_declutter_admin_problem_talk_order_chat.sql |                om.sender_side, |                om.sender_id::text,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const def = DEFS.get("declutter_admin_problem_talk");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
const grants = blankSqlComments(def ? readFileSync(join(MIG, def.file.split("/").pop()!), "utf8") : "").replace(/\s+/g, " ");

describe("AL-6: an admin reads a reported problem's chat and questions, as sides only", () => {
  it("reads the newest definition (floor)", () => {
    expect(def?.file ?? "").toContain("20261030042545_declutter_admin_problem_talk_order_chat.sql");
    expect(flat.length).toBeGreaterThan(900);
  });

  it("admins only, checked first; no switch gate (row 62)", () => {
    expect(flat).toMatch(/AS \$fn\$ DECLARE .*? BEGIN IF NOT public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';/);
    expect(flat).not.toContain("require_feature");
    expect(flat).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp'");
  });

  it("returns a side, the words and the times, nothing that names a person", () => {
    const table = /RETURNS TABLE\((.*?)\) LANGUAGE/.exec(flat)?.[1] ?? "";
    expect(table.split(",").map((c) => c.trim().split(" ")[0])).toEqual(["kind", "side", "body", "said_at", "answer", "answered_at", "removed"]);
    expect(flat).toContain("CASE WHEN m.sender_id = t.buyer_id THEN 'buyer' ELSE 'seller' END AS side,");
    expect(flat).toContain("CASE WHEN q.asker_id = v_order.buyer_id THEN 'buyer' ELSE 'another_member' END,");
    expect(flat).not.toMatch(/full_name|member_display_name|email|address/);
  });

  it("the chat is that order's own: its buyer and seller, from its first cart line to the payment", () => {
    expect(flat).toContain("WHERE t.buyer_id = v_order.buyer_id AND t.seller_id = v_order.seller_id AND t.opened_at >= COALESCE(v_from, v_order.created_at) AND t.opened_at <= COALESCE(v_order.paid_at, now())");
    expect(flat).toContain("SELECT min(c.created_at) INTO v_from FROM public.declutter_cart_items c WHERE c.order_id = v_order.id;");
  });

  it("every question on its items, removed ones kept and marked", () => {
    expect(flat).toContain("q.removed_at IS NOT NULL");
    expect(flat).toMatch(/FROM public\.declutter_questions q WHERE q\.item_id IN \(SELECT c\.item_id FROM public\.declutter_cart_items c WHERE c\.order_id = v_order\.id\)/);
  });

  // D2-1 leftover (lead-approved 2026-10-30, 20261030042545): the chat after payment, that order's only, as sides.
  it("the chat after payment: that order's own messages, each as the side kept on it", () => {
    expect(flat).toContain("SELECT 'order_chat'::text, om.sender_side, om.body, om.created_at, NULL::text, NULL::timestamptz, false, om.id FROM public.declutter_order_talks ot JOIN public.declutter_order_talk_messages om ON om.talk_id = ot.id WHERE ot.order_id = v_order.id");
    expect(flat).not.toMatch(/om\.sender_id/);
  });

  it("never PUBLIC or anon", () => {
    expect(grants).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_problem_talk(uuid) FROM PUBLIC, anon;");
    expect(grants).toContain("GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_talk(uuid) TO authenticated, service_role;");
  });
});
