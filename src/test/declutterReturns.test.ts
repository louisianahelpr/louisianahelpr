/**
 * Declutter returns (migration 20261030071818_declutter_returns.sql; builder 37's design approved by the lead 2026-10-29; owner: refunds
 * for problems only, and only the two free ways back, no paid Helpr trip). What this pins, on the NEWEST
 * definitions:
 *   - the seller's full-refund answer and the way are ONE call: declutter_accept_refund_with_return sets status
 *     'returning' and the way in the same UPDATE, behind the switch, the ban check and the seller-only side check;
 *   - only 'drop_off' and 'collect' exist (the CHECK and the RPC);
 *   - the buyer's drop-off takes a live photo at the address, on or after the return day, and moves no money;
 *   - the collect address is the buyer's to set, and the view shows it only while returning + collect;
 *   - declutter_refund_item_returned stays the only path that refunds; the photo is optional (DEFAULT NULL);
 *   - the 72-hour admin backstop counts from declutter_return_backstop_at (the later of return_by and the return
 *     day/time + 24 hours);
 *   - the return RPCs and return copy appear only in the refund components and their lib.
 * Behaviour per account: src/test/pglite/declutterReturns.pglite.mjs.
 *
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN\n    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;\n  IF r.status <> 'open' THEN\n    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';\n  END IF;\n  IF now() >= r.answer_by THEN\n    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',\n      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';\n  END IF;\n  -- CHANGED (BUY-25 | IF false THEN\n  END IF;\n  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;\n  IF r.status <> 'open' THEN\n    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';\n  END IF;\n  IF now() >= r.answer_by THEN\n    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',\n      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';\n  END IF;\n  -- CHANGED (BUY-25
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   IF p_way IS NULL OR p_way NOT IN ('drop_off', 'collect') THEN | IF p_way IS NULL THEN
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF (now() AT TIME ZONE 'America/Chicago')::date < r.return_day THEN | IF false THEN
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN\n    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',\n      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';\n  END IF;\n  -- At the address | IF false THEN\n    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023';\n  END IF;\n  -- At the address
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF v_m IS NULL OR v_m > 200 THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the seller''s pickup address.'; |   IF false THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023';
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |   IF r.status <> 'returning' OR r.return_way IS DISTINCT FROM 'collect' THEN | IF r.status <> 'returning' THEN
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   v_show_address := COALESCE(r.status = 'returning' AND r.return_way = 'collect', false); |   v_show_address := true;
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |   SELECT greatest(r.return_by, |   SELECT least(r.return_by,
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql | CREATE OR REPLACE FUNCTION public.declutter_refund_item_returned(p_request_id uuid, p_photo_path text DEFAULT NULL) | CREATE OR REPLACE FUNCTION public.declutter_refund_item_returned(p_request_id uuid, p_photo_path text)
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | acceptRefundWithReturn(r.id, | answerRefund(r.id,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";

// declutter_return_dropped_off now lives in 20261030164712 and is read through DEFS. MIG is only for what stays in the
// returns migration: the CHECK and the DROP/REVOKE of declutter_refund_item_returned.
const MIG_FILE = join("supabase/migrations", readdirSync(join(process.cwd(), "supabase/migrations")).find((n: string) => n.endsWith("_declutter_returns.sql")) ?? "");
const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(process.cwd(), MIG_FILE), "utf8")).replace(/\s+/g, " ");

const RETURN_RPCS = ["declutter_accept_refund_with_return", "declutter_return_dropped_off", "declutter_set_return_address"];

describe("Declutter returns: the two free ways, one atomic answer, one money path", () => {
  it("reads the newest definitions (floors)", () => {
    for (const fn of [...RETURN_RPCS, "declutter_refund_item_returned", "declutter_refund_request_view", "declutter_refund_request_sweep", "declutter_handover_photo_access"]) {
      expect(body(fn).length, fn).toBeGreaterThan(500);
    }
  });

  it("the seller's full refund and the way are one call, seller only, behind the switch and the ban check", () => {
    const a = body("declutter_accept_refund_with_return");
    expect(a).toMatch(/^.*?PERFORM public\.require_feature\('declutter_refund_requests'\);.*IF public\.is_caller_banned\(\) THEN RAISE EXCEPTION 'account_restricted'/);
    expect(a).toMatch(/IF p_way IS NULL OR p_way NOT IN \('drop_off', 'collect'\) THEN RAISE EXCEPTION 'invalid_return_way'/);
    expect(a).toMatch(/IS DISTINCT FROM 'seller' THEN RAISE EXCEPTION 'refund_not_found'.*IF r\.status <> 'open' THEN RAISE EXCEPTION 'refund_already_answered'/);
    expect(a).toMatch(/SET status = 'returning', return_agreed_at = now\(\), return_by = now\(\) \+ interval '72 hours', return_way = p_way, return_day = v_day/);
    expect(a).not.toMatch(/declutter_refund_after_handover/);
    // The panel sends "Refund in full" through it, never as a second call after declutter_answer_refund.
    const panel = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterRefundRequest.tsx"), "utf8"));
    expect(panel).toMatch(/choice === "full" && pickArgs && !neverGotIt\) return acceptRefundWithReturn\(r\.id, pick\.way, pickArgs\.day, pickArgs\.atIso\)/);
  });

  it("only drop_off and collect: the CHECK ties each way to its fields", () => {
    expect(MIG).toMatch(/ADD CONSTRAINT declutter_refund_requests_return_way CHECK \( CASE WHEN return_way IS NULL THEN .* WHEN return_way = 'drop_off' THEN .* WHEN return_way = 'collect' THEN .* ELSE false END\)/);
  });

  it("the buyer's drop-off: live photo, at the address, on or after the day; it moves no money", () => {
    const d = body("declutter_return_dropped_off");
    expect(d).toMatch(/IS DISTINCT FROM 'buyer' THEN RAISE EXCEPTION 'refund_not_found'/);
    expect(d).toMatch(/IF \(now\(\) AT TIME ZONE 'America\/Chicago'\)::date < r\.return_day THEN RAISE EXCEPTION 'before_return_day'/);
    expect(d).toMatch(/IF NOT public\.handover_photo_is_fresh\('declutter-handover', p_photo_path\) THEN RAISE EXCEPTION 'photo_too_old'/);
    expect(d).toMatch(/IF v_m IS NULL OR v_m > 200 THEN RAISE EXCEPTION 'not_at_pickup'/);
    expect(d).not.toMatch(/declutter_refund_after_handover|status = 'agreed'/);
  });

  it("the collect address: the buyer's to set; the seller sees it only while returning + collect", () => {
    expect(body("declutter_set_return_address")).toMatch(/IS DISTINCT FROM 'buyer' THEN RAISE EXCEPTION 'refund_not_found'.*IF r\.status <> 'returning' OR r\.return_way IS DISTINCT FROM 'collect' THEN/);
    const v = body("declutter_refund_request_view");
    expect(v).toMatch(/v_show_address := COALESCE\(r\.status = 'returning' AND r\.return_way = 'collect', false\);/);
    for (const c of ["return_address", "return_lat", "return_lng"]) {
      expect(v).toContain(`'${c}', CASE WHEN v_show_address THEN r.${c} END`);
    }
  });

  it("I got it back stays the only money path; its photo is optional", () => {
    expect(DEFS.get("declutter_refund_item_returned")?.stmt).toMatch(/declutter_refund_item_returned\(p_request_id uuid, p_photo_path text DEFAULT NULL\)/);
    expect(body("declutter_refund_item_returned")).toMatch(/v_out := public\.declutter_refund_after_handover\(o\.id, 'refund_request_full', NULL\);/);
    expect(MIG).toContain("DROP FUNCTION IF EXISTS public.declutter_refund_item_returned(uuid);");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_refund_item_returned(uuid, text) FROM PUBLIC, anon;");
    for (const fn of RETURN_RPCS) expect(body(fn), fn).not.toMatch(/declutter_refund_after_handover/);
  });

  it("the admin backstop counts from the later of return_by and the return day/time + 24 hours", () => {
    expect(body("declutter_return_backstop_at")).toMatch(/greatest\(r\.return_by, CASE WHEN r\.return_way = 'collect' THEN r\.return_at \+ interval '24 hours'/);
    expect(body("declutter_refund_request_sweep")).toMatch(/x\.status = 'returning' AND x\.return_by <= now\(\) AND public\.declutter_return_backstop_at\(x\) <= now\(\)/);
    expect(body("declutter_refund_request_sweep")).toMatch(/r\.status = 'returning' AND public\.declutter_return_backstop_at\(r\) <= now\(\)/);
  });

  it("the return RPCs and the return copy appear only in the refund components and their lib", () => {
    const allowed = new Set([
      "src/lib/declutter/refundReturns.ts",
      "src/components/declutter/DeclutterRefundReturn.tsx",
      "src/components/declutter/DeclutterRefundRequest.tsx",
      "src/lib/lifecycleErrors.ts",
      "src/integrations/supabase/types.ts",
    ]);
    const marks = [...RETURN_RPCS, "refundReturns", "DeclutterRefundReturn", "drop-off photo", "Both ways are free"];
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/") && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(join(process.cwd(), f), "utf8"));
      for (const m of marks) {
        if (!src.includes(m)) continue;
        if (allowed.has(f)) seen++;
        else offenders.push(`${f}: ${m}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen).toBeGreaterThan(5);
  });
});
