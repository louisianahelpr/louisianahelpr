/**
 * Declutter porch default (spec row 101, owner 2026-10-16: "I'd rather porch
 * pick up and not having to meet someone for a code or qr code"). Migration
 * 20261017055504_declutter_porch_default. Read from the NEWEST definitions the
 * migrations leave (effectiveDefs), so a later restatement of checkout that
 * drops the porch refusal fails here: the app pre-selecting porch is never the
 * protection.
 *
 * Behaviour (22 checks, 3x replay, migration skipped = RED, server check
 * planted off = RED, measured 2026-10-16): src/test/pglite/declutterPorchDefault.pglite.mjs.
 *
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql | SELECT 1 FROM public.declutter_cart_items c\n         JOIN public.declutter_items i ON i.id = c.item_id\n        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN | SELECT 1 FROM public.declutter_cart_items c\n         JOIN public.declutter_items i ON i.id = c.item_id\n        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok AND false) THEN
 * @mutate supabase/migrations/20261017055504_declutter_porch_default.sql | ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS porch_ok boolean NOT NULL DEFAULT true; | ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS porch_ok boolean NOT NULL DEFAULT false;
 * @mutate supabase/migrations/20261017055504_declutter_porch_default.sql |   IF v_status <> 'draft' THEN\n    RAISE EXCEPTION 'item_not_editable' | IF false THEN\n    RAISE EXCEPTION 'item_not_editable'
 * @mutate supabase/migrations/20261017055504_declutter_porch_default.sql |   UPDATE public.declutter_items SET porch_ok = p_porch_ok, updated_at = now() |   UPDATE public.declutter_items SET status = 'draft', porch_ok = p_porch_ok, updated_at = now()
 * @mutate supabase/migrations/20261031182255_declutter_handovers_guard_fails_closed.sql |   IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND OLD.status <> 'draft'\n     AND NOT (OLD.porch_ok IS FALSE AND NEW.porch_ok IS TRUE)\n     AND NOT (OLD.status = 'live' AND COALESCE(current_setting('declutter.editing_listing', true), '') = OLD.id::text) THEN |   IF false THEN
 * @mutate supabase/migrations/20261031182255_declutter_handovers_guard_fails_closed.sql | AND NOT (OLD.status = 'live' AND COALESCE(current_setting('declutter.editing_listing', true), '') = OLD.id::text) THEN\n    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',\n      HINT = 'Porch | AND NOT (OLD.status = 'live' AND current_setting('declutter.editing_listing', true) = OLD.id::text) THEN\n    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',\n      HINT = 'Porch
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | const order: Handover[] = ([...(porchOk ? ["porch" as const] : []), "pickup_home", | const order: Handover[] = (["pickup_home", "porch",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261017055504_declutter_porch_default.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const CART_UI = readFileSync(join(process.cwd(), "src/components/declutter/DeclutterTradeViews.tsx"), "utf8");

describe("Declutter porch default (row 101, 20261017055504)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of ["declutter_set_porch_ok", "declutter_start_checkout", "declutter_my_cart"]) expect(body(fn), fn).not.toBe("");
    expect(MIG.length).toBeGreaterThan(5_000);
  });

  it("porch is ON by default for every listing, and can never be NULL", () => {
    expect(flat(MIG)).toContain("ADD COLUMN IF NOT EXISTS porch_ok boolean NOT NULL DEFAULT true");
  });

  it("the server refuses a porch checkout when any grouped line's item has porch off", () => {
    const b = flat(body("declutter_start_checkout"));
    const check = "IF p_handover = 'porch' AND EXISTS ( SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN RAISE EXCEPTION 'porch_unavailable'";
    expect(b).toContain(check);
    // Before the idempotent return: an open porch order is never handed back either.
    expect(b.indexOf(check)).toBeLessThan(b.indexOf("IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover"));
    // After the item locks, so the choice it reads cannot change under it.
    expect(b.indexOf("ORDER BY i.id FOR UPDATE")).toBeLessThan(b.indexOf(check));
  });

  it("only the seller changes it, only on their own draft, behind the switch", () => {
    const b = flat(body("declutter_set_porch_ok"));
    expect(b).toContain("PERFORM public.require_feature('declutter');");
    expect(b).toContain("PERFORM public.declutter_assert_member(true);");
    expect(b).toContain("IF p_porch_ok IS NULL THEN RAISE EXCEPTION 'invalid_porch_choice'");
    expect(b).toContain("WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;");
    expect(b).toContain("IF v_status <> 'draft' THEN RAISE EXCEPTION 'item_not_editable'");
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_set_porch_ok(uuid, boolean) FROM PUBLIC, anon;");
  });

  // Q2462 (20261028235249): a listed item may GAIN porch pickup (declutter_add_handover, the seller's way out of a
  // handover chat); turning it off once listed is still refused.
  // Audit 1028 D1-1 (owner 2026-10-29): the one exception is declutter_edit_listing on a LIVE item (no order exists),
  // which names the item in a transaction-local flag (PGlite T11 in declutterHandoverChoices.pglite.mjs). A flag never
  // set in the session compares as '' and is refused (20261031182255, declutterHandoversGuardFailsClosed.pglite.mjs).
  it("the table itself refuses turning porch off once the item left draft (lh-authz-rls review nit #3)", () => {
    expect(flat(body("declutter_items_porch_frozen"))).toContain(
      "IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND OLD.status <> 'draft' AND NOT (OLD.porch_ok IS FALSE AND NEW.porch_ok IS TRUE) AND NOT (OLD.status = 'live' AND COALESCE(current_setting('declutter.editing_listing', true), '') = OLD.id::text) THEN RAISE EXCEPTION 'item_not_editable'");
    expect(flat(MIG)).toContain("BEFORE UPDATE OF porch_ok ON public.declutter_items FOR EACH ROW EXECUTE FUNCTION public.declutter_items_porch_frozen();");
  });

  // The one way back to draft (owner 2026-10-28, Relist): declutter_reopen_listing moves only the seller's own WITHDRAWN
  // item, which has no order, so a porch change there touches no sale; publishing runs every listing rule again.
  const REOPEN = "20261028180400_declutter_reopen_taken_down.sql";
  it("the only way back to draft is reopening a withdrawn listing, which has no order", () => {
    const sql = flat(blankSqlComments(readFileSync(join(MIG_DIR, REOPEN), "utf8")));
    expect(sql).toContain("IF v_item.status <> 'withdrawn' THEN RAISE EXCEPTION 'item_not_editable'");
    expect(sql).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;");
  });

  // LEAD-LIST-FOR-SELLER (20261101034159, 2026-11-01): the seller's approval moves a Helpr-written listing from
  // 'pending_seller_approval' (never listed, never in a cart or order) to draft, then publishes it in the same
  // transaction (declutter_approve_listed_for_me), so every listing rule runs as for any new listing. Allowed only
  // when the UPDATE's own WHERE pins status = 'pending_seller_approval'.
  const PENDING_APPROVAL = "20261101034159_declutter_list_for_seller.sql";
  it("porch_ok is frozen once listed because no migration ever moves an item back to draft (lh-money-escrow review nit #4)", () => {
    let updates = 0;
    let fromPending = 0;
    const back: string[] = [];
    for (const f of readdirSync(MIG_DIR).filter((x: string) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      for (const m of sql.matchAll(/UPDATE\s+public\.declutter_items(?:\s+\w+)?\s+SET\s+([\s\S]*?)(?:\bWHERE\b([^;]*))?;/gi)) {
        updates++;
        if (!/\bstatus\s*=\s*'draft'/i.test(m[1]) || f === REOPEN) continue;
        if (f === PENDING_APPROVAL && /\bstatus\s*=\s*'pending_seller_approval'/i.test(m[2] ?? "")) { fromPending++; continue; }
        back.push(`${f}: ${flat(m[0]).slice(0, 120)}`);
      }
    }
    expect(updates).toBeGreaterThan(20);
    expect(fromPending).toBe(1); // exact: the one approval UPDATE (two-way: a removed or second one fails)
    expect(back).toEqual([]);
  });

  it("the cart reports porch per line, and the app offers porch first only when every line allows it", () => {
    expect(flat(body("declutter_my_cart"))).toContain("i.porch_ok");
    // Seller delivery (20261027153244) keeps porch first and adds its choice after pickup at the home.
    // Owner 2026-10-28: filtered to the ways the seller ticked for every item (wayAllowed).
    expect(CART_UI).toContain('const order: Handover[] = ([...(porchOk ? ["porch" as const] : []), "pickup_home",');
  });
});
