// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql | IF NOT COALESCE(v_on, false) THEN | IF false THEN
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql | WHERE seller_id = p_seller AND manager_id = (SELECT auth.uid()) AND status = 'active' | WHERE seller_id = p_seller AND manager_id = (SELECT auth.uid())
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql | v_ok := EXISTS (SELECT 1 FROM public.declutter_orders WHERE id = v_target AND seller_id = p_seller); | v_ok := EXISTS (SELECT 1 FROM public.declutter_orders WHERE id = v_target);
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql | v_ok := EXISTS (SELECT 1 FROM public.declutter_offers WHERE id = v_target AND seller_id = p_seller); | v_ok := EXISTS (SELECT 1 FROM public.declutter_offers WHERE id = v_target);
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql |     WHEN 'answer_question' THEN 'messages' |     WHEN 'answer_question' THEN 'list'
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql |     WHEN 'respond_offer' THEN 'offers' |     WHEN 'respond_offer' THEN 'list'
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql | REVOKE ALL ON TABLE public.declutter_manager_actions FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.declutter_manager_actions TO authenticated;
// @mutate supabase/migrations/20261101181005_declutter_manager_mode.sql |   IF (SELECT auth.uid()) IS DISTINCT FROM v_mgr THEN\n    RAISE EXCEPTION 'act_as_seller_not_restored' |   IF false THEN\n    RAISE EXCEPTION 'act_as_seller_not_restored'
//
// Declutter manager mode (owner 11-01, "Manage my Declutter for me"; per-part permissions owner 9:56 AM): a manager
// acts for a seller ONLY through declutter_manage, ONLY while their grant is active, ONLY in a part the seller turned
// on, and ONLY on the seller's SELLING side (never her purchases, money settings or anything else). This reads the
// NEWEST definitions: every action declutter_manage runs maps to one part, the permission gate is asked before any
// call, every order / offer / item / question target is checked against p_seller as the SELLER, the acting-as-seller
// claims are restored and checked, and the action log and message table stay private.
// Behaviour under real roles (and mutants): src/test/pglite/declutterManagerMode.pglite.mjs (NEW_MIGRATION=skip red).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (n: string) => blankSqlComments(DEFS.get(n)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const PARTS = ["list", "prices", "offers", "messages", "pickups"];

/** The action -> part table of declutter_manage's newest body. */
function actionParts(): Map<string, string> {
  const b = body("declutter_manage");
  const table = /v_perm := CASE p_action([\s\S]*?)ELSE NULL END;/.exec(b)?.[1] ?? "";
  return new Map([...table.matchAll(/WHEN '([a-z_]+)' THEN '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
}

/** The actions the act-as-seller CASE runs. */
function runActions(): string[] {
  const b = body("declutter_manage");
  const run = /v_result := CASE p_action([\s\S]*?)\n\s*END;/.exec(b)?.[1] ?? "";
  return [...run.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((m) => m[1]);
}

/** Every statement in the migrations, comment-blanked, that touches `table`'s grants. */
function grantsOn(table: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG, f), "utf8"));
    for (const m of sql.matchAll(new RegExp(`(REVOKE|GRANT)[^;]*ON TABLE public\\.${table}\\b[^;]*;`, "g"))) out.push(flat(m[0]));
  }
  return out;
}

describe("Declutter manager mode: a manager acts only in the parts the seller turned on", () => {
  it("every action declutter_manage runs is mapped to exactly one part, and every part is real", () => {
    const parts = actionParts();
    const run = runActions();
    expect(parts.size).toBeGreaterThan(15);
    // add_item_photo is the one action run in place (the manager's own upload), not through a seller RPC.
    expect(run.filter((a) => !parts.has(a))).toEqual([]);
    expect([...parts.keys()].filter((a) => a !== "add_item_photo" && !run.includes(a))).toEqual([]);
    expect([...new Set(parts.values())].filter((p) => !PARTS.includes(p))).toEqual([]);
  });

  it("messages and offers are their own parts (a Listing-only manager can't reply or answer offers)", () => {
    const parts = actionParts();
    expect(parts.get("answer_question")).toBe("messages");
    expect(parts.get("send_order_message")).toBe("messages");
    expect(parts.get("respond_offer")).toBe("offers");
    expect(parts.get("set_listing_price")).toBe("prices");
    expect(parts.get("confirm_handover")).toBe("pickups");
  });

  it("the gate asks for an ACTIVE grant of this manager and the action's own part, before anything runs", () => {
    const gate = flat(body("declutter_manager_grant_for"));
    expect(gate).toContain("WHERE seller_id = p_seller AND manager_id = (SELECT auth.uid()) AND status = 'active'");
    expect(gate).toMatch(/IF NOT COALESCE\(v_on, false\) THEN RAISE EXCEPTION 'permission_off'/);
    const b = flat(body("declutter_manage"));
    expect(b.indexOf("public.declutter_manager_grant_for(p_seller, v_perm)")).toBeGreaterThan(0);
    expect(b.indexOf("public.declutter_manager_grant_for(p_seller, v_perm)")).toBeLessThan(b.indexOf("set_config('request.jwt.claim.sub', p_seller::text, true)"));
  });

  it("every target is checked against p_seller as the SELLER", () => {
    const b = flat(body("declutter_manage"));
    expect(b).toContain("v_ok := EXISTS (SELECT 1 FROM public.declutter_orders WHERE id = v_target AND seller_id = p_seller);");
    expect(b).toContain("v_ok := EXISTS (SELECT 1 FROM public.declutter_offers WHERE id = v_target AND seller_id = p_seller);");
    expect(b).toContain("v_ok := EXISTS (SELECT 1 FROM public.declutter_items WHERE id = v_target AND seller_id = p_seller);");
    expect(b).toMatch(/FROM public\.declutter_questions q JOIN public\.declutter_items i ON i\.id = q\.item_id WHERE q\.id = v_target AND i\.seller_id = p_seller/);
  });

  it("acting as the seller is restored on success and on error, and checked", () => {
    const b = flat(body("declutter_manage"));
    const restores = b.split("set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true)").length - 1;
    expect(restores).toBe(2);
    expect(b).toMatch(/IF \(SELECT auth\.uid\(\)\) IS DISTINCT FROM v_mgr THEN RAISE EXCEPTION 'act_as_seller_not_restored'/);
  });

  it("the action log and the manager-message table are private; grants are readable only by their two people", () => {
    for (const t of ["declutter_manager_actions", "declutter_manager_messages"]) {
      const g = grantsOn(t);
      expect(g.length).toBeGreaterThan(0);
      expect(g.at(-2) ?? "").toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(g.filter((s) => s.startsWith("GRANT") && /\b(authenticated|anon)\b/.test(s))).toEqual([]);
    }
    const g = grantsOn("declutter_manager_grants");
    expect(g.filter((s) => s.startsWith("GRANT") && /\b(authenticated|anon)\b/.test(s))).toEqual([
      "GRANT SELECT ON TABLE public.declutter_manager_grants TO authenticated;",
    ]);
  });

  it("ending access never needs the switch", () => {
    expect(body("declutter_manager_end")).not.toMatch(/require_feature/);
  });
});
