/**
 * NOID-20 "a job" label (lead 2026-10-31): get_message_thread_job_titles hands a job's title to a PARTICIPANT of a
 * conversation on that job and to nobody else. Read from the NEWEST definition the migrations leave (any dollar tag),
 * comments blanked. The behaviour itself (participant gets the title, a non-participant / anon / no uid gets
 * nothing, RLS unchanged) is proven in PGlite: src/test/pglite/messageThreadJobTitles.pglite.mjs (9/9 after, 2/9
 * with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261101014031_message_thread_job_titles.sql |           AND (m.sender_id = (SELECT auth.uid()) OR m.receiver_id = (SELECT auth.uid())) |           AND true
 * @mutate supabase/migrations/20261101014031_message_thread_job_titles.sql | FROM PUBLIC, anon; | FROM PUBLIC;
 * @mutate supabase/migrations/20261101014031_message_thread_job_titles.sql |  RETURNS TABLE(job_id uuid, title text) |  RETURNS TABLE(job_id uuid, title text, customer_id uuid)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DIR = join(ROOT, "supabase", "migrations");
const def = effectiveDefs(DIR).get("get_message_thread_job_titles");

describe("get_message_thread_job_titles answers participants only (NOID-20)", () => {
  it("the newest definition exists and is a read-only SECURITY DEFINER with a pinned search_path", () => {
    expect(def, "no migration defines public.get_message_thread_job_titles").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/STABLE\s+SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("returns only the title, only for jobs the caller has a message on", () => {
    const body = blankSqlComments(def!.stmt).replace(/\s+/g, " ");
    expect(body).toMatch(/RETURNS TABLE\(job_id uuid, title text\)/i);
    expect(body).toMatch(/SELECT j\.id, j\.title FROM public\.jobs j/i);
    expect(body).toMatch(/EXISTS \( SELECT 1 FROM public\.messages m WHERE m\.job_id = j\.id AND \(m\.sender_id = \(SELECT auth\.uid\(\)\) OR m\.receiver_id = \(SELECT auth\.uid\(\)\)\) \)/i);
  });

  it("is closed to PUBLIC and anon, open to signed-in members", () => {
    const sql = blankSqlComments(readFileSync(join(DIR, def!.file), "utf8"));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_message_thread_job_titles\(uuid\[\]\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_message_thread_job_titles\(uuid\[\]\) TO authenticated, service_role;/);
  });
});
