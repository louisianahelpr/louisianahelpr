// Proven able to fail 2026-09-20: rewriting a live REVOKE ALL as REVOKE
// MAINTAIN — the exact 2026-09-15 shape — turns it red.
// @mutate supabase/migrations/20260915030812_contact_leak_reason_exempts_location_shares.sql | REVOKE ALL ON FUNCTION public.contact_leak_reason(text) | REVOKE MAINTAIN ON FUNCTION public.contact_leak_reason(text)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A migration GRANT/REVOKE must not name a privilege keyword the db-deploy
 * replay-smoke Postgres cannot parse.
 *
 * 2026-09-15: 20260915041247 wrote `REVOKE ... MAINTAIN ON open_jobs_browse`.
 * Prod is PostgreSQL 17.6, where MAINTAIN is a real privilege (the view even
 * held it), and PGlite (PG16/17) parsed it — so the local probe and the author
 * both saw green. But db-deploy's "replay every migration + smoke" gate runs an
 * OLDER supabase/postgres image that predates PG17, and there it is
 * `ERROR: unrecognized privilege type "maintain"`. The gate failed and the push
 * step was skipped — a CRITICAL RLS-bypass fix silently did NOT deploy while
 * every local check was green.
 *
 * The durable fix is `REVOKE ALL` / `GRANT SELECT`, which names no
 * version-specific keyword. This test stops the specific keyword class from
 * coming back through a path (PGlite, a newer local psql) that cannot see the
 * replay image's limit. It is deliberately a denylist of the keywords known to
 * be newer than the replay image, not an allowlist of SQL — it only reads
 * GRANT/REVOKE statements.
 */
const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

// Privileges newer than the db-deploy replay-smoke Postgres image. MAINTAIN
// arrived in PG17; the replay image is older. Add to this list if the same
// shape recurs with another new privilege — do not delete it to make a
// migration pass.
const REPLAY_UNSUPPORTED = ["MAINTAIN"];

/** GRANT/REVOKE statements (to the terminating semicolon), comments stripped. */
function grantRevokeStatements(sql: string): string[] {
  const noComments = sql.replace(/--[^\n]*/g, "");
  return [...noComments.matchAll(/\b(?:GRANT|REVOKE)\b[\s\S]*?;/gi)].map((m) => m[0]);
}

describe("migration GRANT/REVOKE avoids privileges the replay-smoke Postgres cannot parse", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

  it("names no privilege newer than the db-deploy replay image", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
      for (const stmt of grantRevokeStatements(sql)) {
        for (const priv of REPLAY_UNSUPPORTED) {
          // Word-boundary, and only inside a GRANT/REVOKE — so a column or
          // object literally named "maintain" elsewhere is not a false hit.
          if (new RegExp(`\\b${priv}\\b`, "i").test(stmt)) {
            offenders.push(`${f}: names ${priv} in a ${/^\s*REVOKE/i.test(stmt) ? "REVOKE" : "GRANT"}`);
          }
        }
      }
    }
    expect(
      offenders,
      `These migrations name a privilege the db-deploy replay-smoke Postgres cannot parse, ` +
        `so the migration passes PGlite/local psql and then FAILS the deploy gate (the ` +
        `2026-09-15 open_jobs_browse incident). Use REVOKE ALL / GRANT SELECT, which names ` +
        `no version-specific keyword:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("can fail (a synthetic REVOKE ... MAINTAIN is caught)", () => {
    const stmt = "REVOKE INSERT, MAINTAIN ON public.x FROM anon;";
    const hit = REPLAY_UNSUPPORTED.some((p) => new RegExp(`\\b${p}\\b`, "i").test(grantRevokeStatements(stmt)[0]));
    expect(hit).toBe(true);
    // and it does not fire on a same-named identifier outside GRANT/REVOKE
    expect(grantRevokeStatements("CREATE TABLE maintain (id int);")).toEqual([]);
  });
});
