// Declutter: Stripe Identity once, at the first purchase or the first listing (owner 2026-10-22, Declutter terms
// answer #9). 20261021202226 adds BEFORE triggers so every buy/list path is judged whichever RPC writes the row:
// a listing entering pending_review / live by its seller, and an offer, a cart line or an order INSERTed for the
// acting member as buyer. The rule is the Jobs one (is_identity_verified), with the same carve-outs (server
// writes, admins, enrolled test accounts). Behaviour, red then green, with prod's helper bodies:
// src/test/pglite/declutterIdentityGate.pglite.mjs. The client opens the one ID sheet on either code.
//
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql |   BEFORE INSERT ON public.declutter_orders |   AFTER INSERT ON public.declutter_orders
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql |   BEFORE INSERT ON public.declutter_offers |   BEFORE UPDATE ON public.declutter_offers
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql |   IF public.is_identity_verified(auth.uid()) THEN | IF true THEN
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql |   IF NEW.status IN ('pending_review', 'live') AND | IF NEW.status IN ('live') AND
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql |   BEFORE UPDATE OF amount_cents ON public.declutter_offers |   BEFORE UPDATE OF status ON public.declutter_offers
// @mutate supabase/migrations/20261021202226_declutter_identity_first_buy_or_list.sql | (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) | (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
// @mutate src/lib/declutter/api.ts |   openIdentitySheetFor(result.error); |   void result;
// @mutate src/lib/identityCheck.ts |   if (/(^\|[^a-z_])identity_required_to_buy($\|[^a-z_])/.test(m)) return "buy"; |
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

// These cases test the ID check while it is ON. The owner switched it off on
// 2026-10-23 (switch `identity_check`); src/test/identityCheckOffEntryPoints.test.ts
// covers the off state.
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckOn: () => true, useIdentityCheckStatus: () => ({ on: true, settled: true }) }));
beforeEach(() => setIdentityCheckOn(true));
afterEach(() => setIdentityCheckOn(false));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }));

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);

/** Live triggers after every migration: name@table -> its CREATE TRIGGER text (DROP TRIGGER removes). */
function liveTriggers(): Map<string, { table: string; text: string }> {
  const live = new Map<string, { table: string; text: string }>();
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    const re = /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?(\w+)|\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+([\s\S]*?)\bON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1]) live.delete(`${m[1]}@${m[2]}`);
      else live.set(`${m[3]}@${m[5]}`, { table: m[5], text: `${m[4]} ON ${m[5]}${m[6]}` });
    }
  }
  return live;
}

describe("Declutter asks for Stripe Identity once, at the first purchase or listing", () => {
  const triggers = [...liveTriggers().values()];

  it("reads the trigger inventory (floor)", () => {
    expect(triggers.length).toBeGreaterThan(100);
  });

  it("a cart never asks: adding to it buys nothing, and checkout's order insert is judged (owner 2026-10-30, 20261031220849)", () => {
    expect(triggers.filter((x) => x.table === "declutter_cart_items" && x.text.includes("declutter_identity_before_buy()"))).toEqual([]);
  });

  it.each(["declutter_offers", "declutter_orders"])("a BEFORE INSERT trigger on %s judges the buyer", (table) => {
    const t = triggers.filter((x) => x.table === table && x.text.includes("declutter_identity_before_buy()") && /^BEFORE\s+INSERT/i.test(x.text));
    expect(t.length, `${table} has no identity trigger`).toBe(1);
    expect(t[0].text).toMatch(/^BEFORE\s+INSERT\s+ON/i);
  });

  it("the buyer's own counter is judged (a Wanted reply is an offer the seller inserts for the poster)", () => {
    const t = triggers.filter((x) => x.table === "declutter_offers" && x.text.includes("declutter_identity_before_buy()") && /UPDATE/i.test(x.text));
    expect(t.length).toBe(1);
    expect(t[0].text.replace(/\s+/g, " ")).toMatch(/^BEFORE UPDATE OF amount_cents ON declutter_offers FOR EACH ROW WHEN \(NEW\.amount_cents IS DISTINCT FROM OLD\.amount_cents\)/i);
  });

  it("a BEFORE INSERT OR UPDATE OF status trigger on declutter_items judges a listing going up", () => {
    const t = triggers.filter((x) => x.table === "declutter_items" && x.text.includes("declutter_identity_before_list()"));
    expect(t.length).toBe(1);
    expect(t[0].text).toMatch(/^BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+status\s+ON/i);
    const body = blankSqlComments(DEFS.get("declutter_identity_before_list")?.stmt ?? "").replace(/\s+/g, " ");
    // Only publish and relist (from draft or paused): an item put back on sale by a sale's own system is not new.
    expect(body).toContain("IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN");
    expect(body).toContain("PERFORM public.declutter_identity_gate(NEW.seller_id, 'identity_required_to_list')");
  });

  it("the gate is the Jobs rule with the Jobs carve-outs, judged only for the acting member", () => {
    const body = blankSqlComments(DEFS.get("declutter_identity_gate")?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain("IF public.is_server_context() OR auth.uid() IS NULL OR p_member IS DISTINCT FROM auth.uid() THEN RETURN;");
    expect(body).toContain("IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) THEN RETURN;");
    expect(body).toContain("IF public.is_identity_verified(auth.uid()) THEN RETURN;");
    expect(body).toContain("RAISE EXCEPTION 'identity_required_to_list'");
    expect(body).toContain("RAISE EXCEPTION 'identity_required_to_buy'");
  });

  it("the client knows both codes and opens the one ID sheet from any Declutter call", async () => {
    const { identityRefusal, useIdentityCheckSheet, closeIdentityCheck } = await import("@/lib/identityCheck");
    expect(identityRefusal({ message: "identity_required_to_buy" })).toBe("buy");
    expect(identityRefusal("identity_required_to_list")).toBe("list");
    expect(identityRefusal("identity_required_to_buyer")).toBeNull();
    const { rpcData } = await import("@/lib/declutter/api");
    const { result } = renderHook(() => useIdentityCheckSheet());
    act(() => closeIdentityCheck());
    expect(result.current.open).toBe(false);
    act(() => {
      expect(() => rpcData({ data: null, error: { message: "identity_required_to_buy" } }, () => null)).toThrow();
    });
    expect(result.current).toMatchObject({ open: true, reason: "buy" });
    act(() => closeIdentityCheck());
    act(() => {
      expect(() => rpcData({ data: null, error: { message: "item_not_found" } }, () => null)).toThrow();
    });
    expect(result.current.open).toBe(false);
  });
});
