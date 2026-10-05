/**
 * Q1234 — on an application, each party writes only its own columns.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): lock_applications_owner_columns pins
 * only helper_id and job_id and authenticated held table-level UPDATE, so the
 * applicant could set the poster's offer_message, decline_reason,
 * poster_viewed_at, closed_reason and stake_*, and the poster could rewrite
 * the applicant's message, attachment_urls, stake_* and moderation flags.
 *
 * THE CLASS, two layers:
 *   1. Grants: authenticated UPDATEs exactly the columns the client sends
 *      (scripts/ci/client-insert-columns.sql, pinned two-way against the
 *      write-contract AST by messagesInsertColumnsClientScoped.test.ts, run
 *      live after every db-deploy); anon none.
 *   2. enforce_application_party_columns, BEFORE UPDATE for a client seat:
 *      message/attachment_urls are the applicant's, status/decline_reason the
 *      poster's, and the poster's only status move is pending -> rejected.
 * Behaviour, red then green: src/test/pglite/applicationPartyColumns.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 11 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FN = "enforce_application_party_columns";
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), "utf8") }));

describe("Q1234 layer 2: the party trigger", () => {
  const def = effectiveDefs(MIG_DIR).get(FN);
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ").toLowerCase();

  it("exists, is SECURITY INVOKER and gates on the request role", () => {
    expect(def, `${FN} is not defined by any migration`).toBeTruthy();
    expect(body).not.toMatch(/security\s+definer/);
    expect(body).toMatch(/if current_user::text not in \('authenticated', 'anon'\) then return new; end if;/);
  });

  it("message and attachment_urls are the applicant's", () => {
    expect(body).toMatch(/and \(v_uid is null or v_uid is distinct from old\.helper_id\) then raise exception 'application_applicant_only/);
  });

  it("status and decline_reason are the poster's, and the poster only declines", () => {
    expect(body).toMatch(/if v_uid is null or v_uid is distinct from public\.get_job_customer_id\(old\.job_id\) then raise exception 'application_poster_only/);
    expect(body).toMatch(/and not \(old\.status::text = 'pending' and new\.status::text = 'rejected'\) then raise exception 'application_status_via_rpc/);
    expect(body).toMatch(/if new\.decline_reason is distinct from old\.decline_reason and not \(old\.status::text = 'pending' and new\.status::text = 'rejected'\) then raise exception 'application_decline_reason_with_decline/);
  });

  it("is attached BEFORE UPDATE on applications by the last migration that names it", () => {
    expect(files().length).toBeGreaterThan(400);
    let state: string | null = null;
    for (const f of files()) {
      const sql = blankSqlComments(f.sql);
      for (const m of sql.matchAll(/(create\s+trigger\s+trg_application_party_columns\s+([^;]*?)\s+on\s+(?:public\.)?applications([^;]*))|(drop\s+trigger\s+(?:if\s+exists\s+)?trg_application_party_columns\s+on\s+(?:public\.)?applications)/gi)) {
        state = m[1] ? `${m[2]} ${m[3]}`.replace(/\s+/g, " ").toLowerCase() : null;
      }
    }
    expect(state).toMatch(/^before update\b.*for each row execute function (public\.)?enforce_application_party_columns/);
  });
});

describe("Q1234 layer 1: the grants", () => {
  it("authenticated UPDATEs only the four client columns; anon nothing", () => {
    const a = replayTablePrivileges(files(), "applications", "authenticated");
    expect(a.table.has("UPDATE")).toBe(false);
    expect([...a.cols.get("UPDATE")!].sort()).toEqual(["attachment_urls", "decline_reason", "message", "status"]);
    expect(replayTablePrivileges(files(), "applications", "anon").table.has("UPDATE")).toBe(false);
  });

  it("the replay can fail: before 20261004190334 authenticated held table-level UPDATE", () => {
    const before = files().filter((f) => f.name < "20261004190334");
    expect(replayTablePrivileges(before, "applications", "authenticated").table.has("UPDATE")).toBe(true);
  });
});

// @mutate supabase/migrations/20261004190334_application_party_columns.sql |      AND (v_uid IS NULL OR v_uid IS DISTINCT FROM OLD.helper_id) THEN |      AND false THEN
// @mutate supabase/migrations/20261004190334_application_party_columns.sql | IF v_uid IS NULL OR v_uid IS DISTINCT FROM public.get_job_customer_id(OLD.job_id) THEN | IF false THEN
// @mutate supabase/migrations/20261004190334_application_party_columns.sql |     IF NEW.status IS DISTINCT FROM OLD.status\n       AND NOT (OLD.status::text = 'pending' AND NEW.status::text = 'rejected') THEN |     IF NEW.status IS DISTINCT FROM OLD.status\n       AND false THEN
// @mutate supabase/migrations/20261004190334_application_party_columns.sql | GRANT UPDATE (status, decline_reason, message, attachment_urls) ON public.applications TO authenticated; | GRANT UPDATE (status, decline_reason, message, attachment_urls, offer_message) ON public.applications TO authenticated;
// @mutate supabase/migrations/20261004190334_application_party_columns.sql | REVOKE UPDATE ON public.applications FROM PUBLIC, anon, authenticated; | REVOKE UPDATE ON public.applications FROM PUBLIC, anon;
// @mutate supabase/migrations/20261004190334_application_party_columns.sql |     IF NEW.decline_reason IS DISTINCT FROM OLD.decline_reason\n | IF false AND NEW.decline_reason IS DISTINCT FROM OLD.decline_reason\n
