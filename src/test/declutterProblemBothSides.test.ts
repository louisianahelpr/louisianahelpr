/**
 * Declutter audit 1b #3 (prod 2026-10-29): a second report on a sale with an open problem was answered with the first
 * report's id and its words were thrown away, and the seller could not give their side. Builder 45 (measured live):
 * refund requests took no photos, and no problem photo could be uploaded after the handover.
 *
 * Reads the EFFECTIVE (newest) definitions, comments blanked:
 *   - CLASS: no Declutter report/request RPC answers an open problem's id to a different report: every
 *     `FROM public.declutter_problems ... status = 'open'` found-branch in declutter_report_problem either checks it
 *     is the same reporter, reason and words, or raises;
 *   - declutter_problem_add_side: only the other side, only open, own problem-folder photos, at most 3;
 *   - declutter_ask_refund stores photos (own problem folder, at most 3); to_admin carries them to the problem;
 *   - declutter_handover_photo_access lets the problem folder take uploads after the handover only while a problem
 *     or a request is live, and keeps handover photos paid-only.
 * Backend proof: src/test/pglite/declutterProblemBothSides.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |     RAISE EXCEPTION 'problem_already_open' USING ERRCODE = '55000',\n      HINT = 'A problem is already open on this sale. Add your side to it, with photos, and Louisiana Helpr reads both.';\n | RETURN v_id;\n
 * @mutate supabase/migrations/20261029225634_declutter_problem_both_sides_and_photos.sql |   IF p.reporter_id IS NOT DISTINCT FROM v_uid OR p.reporter_side = v_side THEN | IF false THEN
 * @mutate supabase/migrations/20261030143141_admin_alerts_skip_test_accounts.sql |  COALESCE(r.photo_paths, '{}'))\n    RETURNING id INTO v_problem; |  '{}')\n    RETURNING id INTO v_problem;
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |                            OR (split_part(p_name, '/', 3) = 'problem' AND o.status = 'handed_over' |                            OR (o.status = 'handed_over'
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |   VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours', COALESCE(p_photo_paths, '{}')) |   VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours', '{}')
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const body = (name: string) => flat(DEFS.get(name)?.stmt ?? "");
const PHOTO_RULE = [
  "split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text",
  "split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'",
  "split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text",
  "NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path)",
];

describe("audit 1b #3: both sides of a problem; photos on refund requests", () => {
  it("CLASS: a second report on an open problem is never answered with the first report's id unless it is the same report", () => {
    const r = body("declutter_report_problem");
    expect(r.length).toBeGreaterThan(1500);
    const found = r.indexOf("WHERE p.order_id = o.id AND p.status = 'open'; IF FOUND THEN");
    expect(found).toBeGreaterThan(0);
    const branch = r.slice(found, r.indexOf("END IF; IF p_reason IS NULL", found));
    // Every RETURN in the found-branch sits behind the same-report check; the rest raise.
    const returns = branch.split("RETURN v_id;").length - 1;
    expect(returns).toBe(1);
    expect(branch).toMatch(/IF EXISTS \(SELECT 1 FROM public\.declutter_problems p WHERE p\.id = v_id AND p\.reporter_id = v_uid AND p\.reason = p_reason AND p\.note = btrim\(p_note\)\) THEN RETURN v_id; END IF;/);
    expect(branch).toContain("RAISE EXCEPTION 'problem_already_reported'");
    expect(branch).toContain("RAISE EXCEPTION 'problem_already_open'");
  });

  it("add_side: only the other side, only while open, own problem-folder photos, at most 3", () => {
    const a = body("declutter_problem_add_side");
    expect(a).toContain("SECURITY DEFINER");
    expect(a).toContain("IF p.reporter_id IS NOT DISTINCT FROM v_uid OR p.reporter_side = v_side THEN RAISE EXCEPTION 'problem_side_is_yours'");
    expect(a).toContain("IF p.status <> 'open' THEN RAISE EXCEPTION 'problem_already_decided'");
    expect(a).toContain("IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN RAISE EXCEPTION 'too_many_problem_photos'");
    for (const rule of PHOTO_RULE) expect(a).toContain(rule);
  });

  it("ask_refund stores own problem-folder photos (at most 3); to_admin carries them to the problem; the view shows them", () => {
    const ask = body("declutter_ask_refund");
    expect(ask).toContain("p_photo_paths text[] DEFAULT '{}'");
    expect(ask).toContain("IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN RAISE EXCEPTION 'too_many_problem_photos'");
    for (const rule of PHOTO_RULE) expect(ask).toContain(rule);
    expect(ask).toContain("VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours', COALESCE(p_photo_paths, '{}'))");
    expect(body("declutter_refund_request_to_admin")).toContain("COALESCE(r.photo_paths, '{}')) RETURNING id INTO v_problem;");
    expect(body("declutter_refund_request_view")).toContain("'photo_paths', COALESCE(r.photo_paths, '{}')");
  });

  it("the storage write rule: problem folder after the handover only while live; handover photos stay paid-only", () => {
    const acc = body("declutter_handover_photo_access");
    expect(acc).toContain("AND (o.status = 'paid' OR (split_part(p_name, '/', 3) = 'problem' AND o.status = 'handed_over' AND (public.declutter_problem_window_open(o.id)");
    expect(acc).toContain("WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning'))");
    expect(acc).toContain("WHERE x.order_id = o.id AND x.status = 'open')");
  });
});
