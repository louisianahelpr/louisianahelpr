/**
 * Q1262 (1) and (3) — a re-filed dispute keeps the Helpr's earlier answer, and
 * starts from its own evidence, unresolved.
 *
 * (1) open_dispute_as's NEW-dispute path clears jobs.dispute_helper_response
 *     (Q1165). Before 20261005064816 that erased the Helpr's statement for
 *     good: a poster could withdraw and re-file to wipe it. Now it is first
 *     archived on the previous (closed) dispute's own row, disputes.helper_response,
 *     a column no party can write (enforce_dispute_opener_column_whitelist pins it).
 * (3) The same path no longer appends the withdrawn dispute's photos onto the
 *     job's mirror, and clears the withdrawal's dispute_resolved_at.
 * Pins the NEWEST definitions (effectiveDefs replays every migration).
 * Behaviour: src/test/pglite/disputeRefileKeepsHelprAnswer.pglite.mjs (4 FAILED
 * on prod's state, ALL PASS applied 3x).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |      SET helper_response = j.dispute_helper_response |      SET helper_response = NULL
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |          dispute_resolved_at = NULL, |          dispute_resolved_at = dispute_resolved_at,
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |          dispute_evidence_urls = COALESCE(_evidence_urls, '{}'::text[]) |          dispute_evidence_urls = COALESCE(dispute_evidence_urls, '{}'::text[]) \|\| COALESCE(_evidence_urls, '{}'::text[])
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |   OR (NEW.helper_response IS DISTINCT FROM OLD.helper_response | OR (false
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |                AND OLD.helper_response IS NULL)) |                AND true))
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |   PERFORM set_config('app.dispute_archive_rpc', '1', true);\n  UPDATE public.disputes d |   UPDATE public.disputes d
// @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql |   PERFORM set_config('app.dispute_archive_rpc', '0', true);\n | \n
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const oda = flat("open_dispute_as");
const wl = flat("enforce_dispute_opener_column_whitelist");

describe("Q1262: a re-file keeps the Helpr's answer and starts its own evidence", () => {
  it("both newest definitions are found", () => {
    expect(oda).toMatch(/SECURITY DEFINER/);
    expect(wl).toMatch(/only the evidence on a dispute may be changed/);
  });

  it("(1) the new path archives the job's answer onto the previous closed dispute BEFORE the UPDATE that clears it", () => {
    const archive = oda.search(
      /UPDATE public\.disputes d SET helper_response = j\.dispute_helper_response FROM public\.jobs j WHERE j\.id = _job_id AND j\.dispute_helper_response IS NOT NULL AND d\.helper_response IS NULL AND d\.id = \(SELECT p\.id FROM public\.disputes p WHERE p\.job_id = _job_id AND p\.status <> 'open' ORDER BY p\.created_at DESC LIMIT 1\);/,
    );
    const clear = oda.search(/dispute_helper_response = NULL,/);
    expect(archive, "the archive UPDATE is missing").toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(archive);
    expect(archive).toBeGreaterThan(oda.indexOf("RETURN _existing_id;"));
  });

  it("(1) no party can write disputes.helper_response; only open_dispute_as's flagged NULL -> answer write passes", () => {
    expect(wl).toMatch(
      /OR \(NEW\.helper_response IS DISTINCT FROM OLD\.helper_response AND NOT \(current_setting\('app\.dispute_archive_rpc', true\) = '1' AND OLD\.helper_response IS NULL\)\) THEN RAISE EXCEPTION 'only the evidence on a dispute may be changed'/,
    );
  });

  it("(1) open_dispute_as raises the flag around exactly the archive UPDATE and lowers it before anything else (lh-authz-rls review)", () => {
    const on = oda.indexOf("PERFORM set_config('app.dispute_archive_rpc', '1', true); UPDATE public.disputes d SET helper_response");
    const off = oda.indexOf("PERFORM set_config('app.dispute_archive_rpc', '0', true); INSERT INTO public.disputes");
    expect(on, "the flag is not raised right before the archive UPDATE").toBeGreaterThan(-1);
    expect(off, "the flag is not lowered right after it").toBeGreaterThan(on);
    expect(oda.slice(on + 10, off)).not.toMatch(/set_config\('app\.dispute_archive_rpc'/);
    expect((oda.match(/app\.dispute_archive_rpc', '1'/g) ?? []).length).toBe(1);
  });

  it("(3) the new dispute's job row starts unresolved with its own evidence only", () => {
    const upd = oda.slice(oda.search(/dispute_helper_response = NULL,/));
    const stmt = upd.slice(0, upd.indexOf("WHERE id = _job_id"));
    expect(stmt).toMatch(/dispute_resolved_at = NULL,/);
    expect(stmt).toMatch(/dispute_evidence_urls = COALESCE\(_evidence_urls, '\{\}'::text\[\]\)/);
    expect(stmt).not.toMatch(/COALESCE\(dispute_evidence_urls/);
  });
});
