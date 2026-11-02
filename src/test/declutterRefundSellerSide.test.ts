/**
 * A3-74 (audit 11-01; lead 11-01: decide_by = when it reaches Louisiana Helpr + 48 h, display only): the seller's side
 * on a refund ("I don't agree" or a part offer: an optional note and up to 3 photos) reaches the admin as the
 * problem's other side, and the problem carries decide_by. Reads the EFFECTIVE (newest) definitions; behaviour on a real
 * database is src/test/pglite/declutterRefundSellerSide.pglite.mjs (3x, Supabase's default anon grant emulated).
 *
 * @mutate supabase/migrations/20261102041000_declutter_refund_seller_side.sql |          OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text\n         OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter' |          OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
 * @mutate supabase/migrations/20261102041000_declutter_refund_seller_side.sql |   NEW.decide_by := COALESCE(NEW.decide_by, now() + interval '48 hours'); |   NEW.decide_by := NEW.decide_by;
 * @mutate supabase/migrations/20261102041000_declutter_refund_seller_side.sql |   IF NEW.reporter_side = 'buyer' AND NEW.other_side_note IS NULL AND r.seller_side_at IS NOT NULL THEN |   IF NEW.reporter_side = 'buyer' AND r.seller_side_at IS NOT NULL THEN
 * @mutate supabase/migrations/20261102041000_declutter_refund_seller_side.sql | REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC;
 * @mutate supabase/migrations/20261102041000_declutter_refund_seller_side.sql |       'decide_by', (SELECT x.decide_by | 'decide_by_gone', (SELECT x.decide_by
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const NEW = "20261102041000_declutter_refund_seller_side.sql";
const mig = blankSqlComments(readFileSync(resolve(MIG, NEW), "utf8")).replace(/\s+/g, " ");

describe("the seller's side of a refund reaches Louisiana Helpr, with a decide-by (A3-74)", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of ["declutter_answer_refund", "declutter_refund_request_view", "declutter_problem_refund_side", "declutter_refund_seller_side_to_problem"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("the answer takes an optional note and up to 3 photos from the seller's own folder, on part and decline only", () => {
    const f = flat("declutter_answer_refund");
    expect(f).toContain("p_note text DEFAULT NULL, p_photo_paths text[] DEFAULT '{}'");
    expect(f).toContain("IF p_answer IN ('part', 'decline') THEN");
    expect(f).toContain("split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text");
    expect(f).toContain("split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text");
    expect(f).toContain("NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path)");
    expect(f).toContain("cardinality(COALESCE(p_photo_paths, '{}')) > 3");
    // The money path is the same as before: the never-got-it refund and the part bounds.
    expect(f).toContain("v_out := public.declutter_refund_after_handover(o.id, 'seller_no_show', NULL);");
    expect(f).toContain("IF p_offer_cents IS NULL OR p_offer_cents <= 0 OR p_offer_cents >= o.items_cents THEN");
    expect(mig).toContain("DROP FUNCTION IF EXISTS public.declutter_answer_refund(uuid, text, integer);");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC, anon;");
  });

  it("a problem on a refunded sale gets decide_by and the seller's side; joining fills it without overwriting", () => {
    const ins = flat("declutter_problem_refund_side");
    expect(ins).toContain("NEW.decide_by := COALESCE(NEW.decide_by, now() + interval '48 hours');");
    expect(ins).toContain("NEW.reporter_side = 'buyer' AND NEW.other_side_note IS NULL AND r.seller_side_at IS NOT NULL");
    const join = flat("declutter_refund_seller_side_to_problem");
    expect(join).toContain("p.other_side_note IS NULL AND NEW.seller_side_at IS NOT NULL");
    expect(join).toContain("decide_by = COALESCE(p.decide_by, now() + interval '48 hours')");
    expect(mig).toContain("BEFORE INSERT ON public.declutter_problems");
    expect(mig).toContain("AFTER UPDATE OF status, problem_id ON public.declutter_refund_requests");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_problem_refund_side() FROM PUBLIC, anon, authenticated;");
  });

  it("both sides read the seller's side, the problem and decide_by", () => {
    const v = flat("declutter_refund_request_view");
    expect(v).toContain("'seller_note', r.seller_note, 'seller_photo_paths', COALESCE(r.seller_photo_paths, '{}')");
    expect(v).toContain("'decide_by', (SELECT x.decide_by FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'open')");
  });
});
