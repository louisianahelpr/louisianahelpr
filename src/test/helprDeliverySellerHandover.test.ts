/**
 * App audit 2026-10-28, report 1c #1 and #4 (lead-approved plan, 2026-10-29). Reads the NEWEST definition of each
 * function (effectiveDefs replays every migration, any dollar-quote tag) and pins:
 *   - helpr_task_picked_up refuses 'too_early' until 30 minutes before the booked pickup, unless the seller tapped
 *     "Handed over" for THIS Helpr (handed_over_to = the caller);
 *   - helpr_task_handed_over is the seller's (pickup_contact) only, changes no status, moves no money, and is
 *     REVOKEd from PUBLIC and anon;
 *   - helpr_task_view returns problem_open and handed_over_at to the parties only;
 *   - helpr_my_route leaves out an accepted task held by an open problem.
 * Backend proof, red without the migration and on five planted defects:
 * src/test/pglite/helprDeliverySellerHandover.pglite.mjs.
 *
 * @mutate supabase/migrations/20261030012018_helpr_delivery_seller_handover.sql |      AND (t.pickup_slot_start IS NULL OR now() < t.pickup_slot_start - interval '30 minutes') THEN |      AND false THEN
 * @mutate supabase/migrations/20261030012018_helpr_delivery_seller_handover.sql |   IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN |   IF v_uid IS NULL THEN
 * @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |               AND NOT (x.status = 'accepted' AND public.helpr_task_source_held(x.source_kind, x.source_id)) |               AND true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const grants = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n").replace(/\s+/g, " ");

describe("Helpr delivery: seller handover and held pickups", () => {
  it("the inventory read something", () => {
    for (const fn of ["helpr_task_picked_up", "helpr_task_handed_over", "helpr_task_view", "helpr_my_route"]) {
      expect(body(fn).length, fn).toBeGreaterThan(400);
    }
  });

  it("Picked up waits for 30 minutes before the pickup, unless the seller handed it to this Helpr", () => {
    expect(body("helpr_task_picked_up")).toContain(
      "IF t.handed_over_to IS DISTINCT FROM v_uid AND (t.pickup_slot_start IS NULL OR now() < t.pickup_slot_start - interval '30 minutes') THEN RAISE EXCEPTION 'too_early'");
  });

  it("only the seller taps Handed over; it changes no status and is not callable by anon", () => {
    const b = body("helpr_task_handed_over");
    expect(b).toContain("IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'task_not_found'");
    expect(b).toContain("SET handed_over_at = now(), handed_over_to = t.helpr_id, updated_at = now()");
    const sets = [...b.matchAll(/\bUPDATE\s+public\.\w+\s+SET\s+(.*?)\bWHERE\b/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect(s).not.toMatch(/\bstatus\s*=/);
    expect(b).not.toMatch(/payout|refund|stripe/i);
    expect(grants).toContain("REVOKE ALL ON FUNCTION public.helpr_task_handed_over(uuid) FROM PUBLIC, anon;");
  });

  it("the view says a sale is held, and whether the seller handed it over, to the parties only", () => {
    const v = body("helpr_task_view");
    expect(v).toContain("'problem_open', CASE WHEN v_role <> 'candidate' THEN public.helpr_task_source_held(t.source_kind, t.source_id) END");
    expect(v).toContain("'handed_over_at', CASE WHEN v_role <> 'candidate' AND t.helpr_id IS NOT NULL AND t.handed_over_to = t.helpr_id THEN t.handed_over_at END");
  });

  it("a held pickup is no stop on My route", () => {
    expect(body("helpr_my_route")).toContain("AND NOT (x.status = 'accepted' AND public.helpr_task_source_held(x.source_kind, x.source_id))");
  });
});
