/**
 * Q1945: helpr_task_lock checks the caller on its unlocked read BEFORE taking the Declutter order lock and the task
 * row lock: a member who is not the task's Helpr, buyer or seller (and not an admin) is refused 'task_not_found' on a
 * task that is not open. Every member RPC that takes the lock still re-checks its own party rule on the locked row.
 * Backend proof: src/test/pglite/helprTaskLockChecksCallerFirst.pglite.mjs (3x; red on the 20261017055505 version and
 * on its planted defects).
 *
 * @mutate supabase/migrations/20261103072510_declutter_checkout_reach_not_found_is_404.sql | AND v_uid IS DISTINCT FROM t.pickup_contact_id |
 * @mutate supabase/migrations/20261103072510_declutter_checkout_reach_not_found_is_404.sql | IF NOT public.is_server_context() AND t.status IS DISTINCT FROM 'open' | IF NOT public.is_server_context() AND false
 * @mutate supabase/migrations/20261103072510_declutter_checkout_reach_not_found_is_404.sql | AND NOT public.has_role(v_uid, 'admin') THEN | THEN
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = (name: string) => flat(blankSqlComments(defs.get(name)?.stmt ?? ""));

describe("helpr_task_lock refuses a stranger before it locks anything", () => {
  it("the caller check sits between the unlocked read and the first lock", () => {
    expect(defs.size).toBeGreaterThan(500);
    const lock = body("helpr_task_lock");
    const check = lock.indexOf("IF NOT public.is_server_context() AND t.status IS DISTINCT FROM 'open' AND v_uid IS DISTINCT FROM t.helpr_id AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id AND NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';");
    expect(check).toBeGreaterThan(lock.indexOf("SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;"));
    expect(check).toBeLessThan(lock.indexOf("PERFORM public.declutter_lock_order(t.source_id);"));
    expect(check).toBeLessThan(lock.indexOf("FOR UPDATE"));
  });

  it("every member RPC that takes the lock still refuses a non-party on the locked row (inventory)", () => {
    const callers = [...defs.keys()].filter((n) => n !== "helpr_task_lock" && body(n).includes("helpr_task_lock("));
    expect(callers.length).toBeGreaterThan(15);
    // The ones that are not member calls: the sweep (service), accept (any member, open task), the raise pair (buyer
    // page / webhook; the raise checks its own order party).
    const nonParty = new Set(["helpr_task_sweep", "helpr_task_accept", "declutter_delivery_raise_start", "declutter_delivery_raise_paid"]);
    for (const n of callers.filter((c) => !nonParty.has(c))) {
      expect(body(n), n).toMatch(/helpr_task_lock\(p_task_id\); (?:IF t\.(?:helpr_id|customer_id|pickup_contact_id) IS DISTINCT FROM v_uid|v_side := CASE WHEN t\.helpr_id = v_uid)/);
    }
  });
});
