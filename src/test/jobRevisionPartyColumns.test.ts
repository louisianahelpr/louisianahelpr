/**
 * Q1231 — a revision request is the poster's; its answer is the Helpr's.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): "Job parties can manage revisions"
 * (FOR ALL) admits the requester, the poster and the Helpr in USING and WITH
 * CHECK, and anon/authenticated held table-level INSERT and UPDATE. The Helpr
 * could file a "revision request" with requested_by = the poster, or rewrite
 * the poster's description and photos; any signed-in account could file one on
 * any job by naming itself as requested_by.
 *
 * THE CLASS, two layers:
 *   1. Grants: authenticated INSERTs exactly the columns CompletionChoiceSheet
 *      sends and UPDATEs only status (scripts/ci/client-insert-columns.sql,
 *      pinned two-way by messagesInsertColumnsClientScoped.test.ts and run
 *      live after every db-deploy); anon nothing.
 *   2. enforce_job_revision_party_columns, BEFORE INSERT OR UPDATE for a
 *      client seat: requested_by pinned to the caller, only the job's poster
 *      inserts, a request is born pending, its text/photos/requester never
 *      change, and only the job's Helpr moves status, once, out of pending.
 *   3. No client DELETE (a review must-fix folded into Q1231: the Helpr could delete the poster's request).
 * Behaviour, red then green: src/test/pglite/jobRevisionPartyColumns.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 10 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FN = "enforce_job_revision_party_columns";
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), "utf8") }));

describe("Q1231 layer 2: the party trigger", () => {
  const def = effectiveDefs(MIG_DIR).get(FN);
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ").toLowerCase();

  it("exists, is SECURITY INVOKER and gates on the request role", () => {
    expect(def, `${FN} is not defined by any migration`).toBeTruthy();
    expect(body).not.toMatch(/security\s+definer/);
    expect(body).toMatch(/if current_user::text not in \('authenticated', 'anon'\) then return new; end if;/);
  });

  it("on INSERT: only the job's poster, requested_by pinned, born pending with no answer", () => {
    expect(body).toMatch(/if v_uid is null or v_poster is distinct from v_uid then raise exception 'revision_poster_only/);
    expect(body).toMatch(/new\.requested_by := v_uid;/);
    expect(body).toMatch(/new\.status := 'pending';/);
    expect(body).toMatch(/new\.helper_response := null;/);
  });

  it("on UPDATE: the request is immutable and only the Helpr answers", () => {
    for (const col of ["requested_by", "job_id", "description", "photos", "created_at"]) {
      expect(body, `${col} is not pinned on UPDATE`).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(body).toMatch(/and \(v_uid is null or v_helpr is distinct from v_uid\) then raise exception 'revision_helpr_answers/);
    expect(body).toMatch(/if new\.status is distinct from old\.status and not \(old\.status = 'pending' and new\.status in \('accepted', 'rejected'\)\) then raise exception 'revision_answer_once/);
  });

  it("is attached BEFORE INSERT OR UPDATE on job_revisions by the last migration that names it", () => {
    expect(files().length).toBeGreaterThan(400);
    let state: string | null = null;
    for (const f of files()) {
      const sql = blankSqlComments(f.sql);
      for (const m of sql.matchAll(/(create\s+trigger\s+trg_job_revision_party_columns\s+([^;]*?)\s+on\s+(?:public\.)?job_revisions([^;]*))|(drop\s+trigger\s+(?:if\s+exists\s+)?trg_job_revision_party_columns\s+on\s+(?:public\.)?job_revisions)/gi)) {
        state = m[1] ? `${m[2]} ${m[3]}`.replace(/\s+/g, " ").toLowerCase() : null;
      }
    }
    expect(state).toMatch(/^before insert or update\b.*for each row execute function (public\.)?enforce_job_revision_party_columns/);
  });
});

describe("Q1231 layer 1: the grants", () => {
  it("authenticated INSERTs only the five sent columns and UPDATEs only status; anon nothing", () => {
    const a = replayTablePrivileges(files(), "job_revisions", "authenticated");
    expect(a.table.has("INSERT")).toBe(false);
    expect(a.table.has("UPDATE")).toBe(false);
    expect([...a.cols.get("INSERT")!].sort()).toEqual(["description", "job_id", "photos", "requested_by", "status"]);
    expect([...a.cols.get("UPDATE")!]).toEqual(["status"]);
    const anon = replayTablePrivileges(files(), "job_revisions", "anon");
    expect([...anon.table]).toEqual([]);
    // No client deletes a revision request (a review must-fix folded into Q1231).
    expect(a.table.has("DELETE")).toBe(false);
    expect([...a.cols.get("DELETE")!]).toEqual([]);
  });

  it("the replay can fail: before 20261004185940 both held table-level INSERT and UPDATE", () => {
    const before = files().filter((f) => f.name < "20261004185940");
    expect(replayTablePrivileges(before, "job_revisions", "authenticated").table.has("UPDATE")).toBe(true);
    expect(replayTablePrivileges(before, "job_revisions", "anon").table.has("INSERT")).toBe(true);
  });
});

// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql | NEW.requested_by    := v_uid; | NULL;
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql | IF v_uid IS NULL OR v_poster IS DISTINCT FROM v_uid THEN | IF false THEN
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql |      OR NEW.description IS DISTINCT FROM OLD.description\n |
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql |      AND (v_uid IS NULL OR v_helpr IS DISTINCT FROM v_uid) THEN |      AND false THEN
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql | GRANT UPDATE (status) ON public.job_revisions TO authenticated; | GRANT UPDATE (status, description) ON public.job_revisions TO authenticated;
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql | REVOKE ALL ON public.job_revisions FROM PUBLIC, anon; | REVOKE ALL ON public.job_revisions FROM PUBLIC;
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql | REVOKE DELETE ON public.job_revisions FROM PUBLIC, anon, authenticated; | REVOKE DELETE ON public.job_revisions FROM PUBLIC, anon;
// @mutate supabase/migrations/20261004185940_job_revisions_party_columns.sql |      AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected')) THEN |      AND false THEN
