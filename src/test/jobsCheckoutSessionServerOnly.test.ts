/**
 * Q1757 — only the server may change jobs.stripe_session_id, admins included.
 *
 * Since test mode for test accounts, the session prefix (cs_test_ / cs_live_)
 * decides which Stripe key moves a job's escrow, so an admin rewriting it
 * could have a test-mode payout mark a live escrow paid. Posters (Q1366) and
 * Helprs were already locked out; admins passed every jobs lock.
 *
 * Pinned on the definition the database holds (newest migration); behaviour,
 * red then green: src/test/pglite/jobsCheckoutSessionServerOnly.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 2 FAILED, the admin swap and the
 * admin clear).
 *
 * @mutate supabase/migrations/20261015014815_jobs_checkout_session_server_only.sql |      AND NOT public.is_server_context() THEN |      AND false THEN
 * @mutate supabase/migrations/20261015014815_jobs_checkout_session_server_only.sql |   BEFORE UPDATE OF stripe_session_id ON public.jobs |   BEFORE UPDATE OF title ON public.jobs
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const defs = effectiveDefs(DIR);

/** The newest CREATE TRIGGER of that name across every migration, comments blanked. */
function newestTrigger(name: string): string {
  let found = "";
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const re = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[\\s\\S]*?;`, "gi");
    for (const m of sql.matchAll(re)) found = m[0];
  }
  return found;
}

describe("Q1757: jobs.stripe_session_id is server-only for every caller", () => {
  const body = blankSqlComments(defs.get("enforce_jobs_checkout_session_server_only")?.stmt ?? "");

  it("the parse sees the migrations and the function", () => {
    expect(defs.size).toBeGreaterThan(200);
    expect(body.length).toBeGreaterThan(100);
  });

  it("refuses a changed session unless the caller is a server context (no admin carve-out)", () => {
    expect(body).toMatch(/NEW\.stripe_session_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.stripe_session_id/i);
    expect(body).toMatch(/AND\s+NOT\s+public\.is_server_context\(\)/i);
    expect(body).not.toMatch(/has_role/i);
    expect(body).toMatch(/ERRCODE\s*=\s*'42501'/);
  });

  it("is attached BEFORE UPDATE OF stripe_session_id ON public.jobs", () => {
    const trig = newestTrigger("trg_jobs_checkout_session_server_only");
    expect(trig).toMatch(/BEFORE\s+UPDATE\s+OF\s+stripe_session_id\s+ON\s+public\.jobs/i);
    expect(trig).toMatch(/EXECUTE\s+FUNCTION\s+public\.enforce_jobs_checkout_session_server_only\(\)/i);
  });
});
