/*
 * GUARD (docs/OPEN.md Q45): the database backup is PROVEN restorable, on a
 * schedule, and a failed restore is reported.
 *
 * Prod has no PITR, and the platform's daily backups restore only IN PLACE. The
 * nightly db-backup artifact is the only restore source, and until
 * 2026-09-23 no one had ever restored one. This test pins the drill that does:
 * the workflow exists, is scheduled, downloads the latest backup artifact,
 * decrypts it, restores into a THROWAWAY local stack (never prod), runs the
 * restore + row-count comparison script, and reports through
 * nightly-issue-sync with a status that reads the drill job.
 *
 * It also pins the script's own teeth, because a drill that restores and then
 * compares nothing is the false green this guard exists against.
 */
// @mutate .github/workflows/db-restore-drill.yml | bash scripts/db-restore-drill.sh | echo skipped
// @mutate scripts/db-restore-drill.sh | FAIL=1 | FAIL=0

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const wf = code(read(".github/workflows/db-restore-drill.yml"));
const script = code(read("scripts/db-restore-drill.sh"));
const known = read("scripts/db-restore-drill-known-errors.txt");

describe("the backup restore drill exists and has teeth", () => {
  it("is scheduled and dispatchable", () => {
    expect(wf).toMatch(/^\s{2}schedule:\s*\n\s+- cron:\s*"[^"]+"/m);
    expect(wf).toMatch(/^\s{2}workflow_dispatch:/m);
  });

  it("restores the newest successful db-backup artifact", () => {
    expect(wf).toMatch(/gh run list[^\n]*-w db-backup\.yml[^\n]*--status success/);
    expect(wf).toMatch(/gh run download/);
    expect(wf).toMatch(/gpg --batch[^\n]*--decrypt/);
  });

  it("restores into a throwaway local stack, never prod", () => {
    expect(wf).toMatch(/supabase init/);
    expect(wf).toMatch(/supabase start/);
    expect(wf).toMatch(/TARGET_DB_URL:\s*postgresql:\/\/[^\n]*@127\.0\.0\.1:/);
    expect(wf).not.toMatch(/supabase link/);
    // The script refuses a hosted target outright.
    expect(script).toMatch(/\*fncmgoasalhdgfwzhsqa\*\|\*supabase\.co\*/);
  });

  it("runs the restore + comparison script as a step", () => {
    expect(wf).toMatch(/^\s+bash scripts\/db-restore-drill\.sh /m);
  });

  it("the script restores all three files and compares key tables with prod", () => {
    for (const f of ["roles", "schema", "data"]) expect(script).toContain(`-f "$DIR/${f}.sql"`);
    expect(script).toMatch(/session_replication_role = replica/);
    expect(script).toMatch(/api\.supabase\.com\/v1\/projects\/\$\{SUPABASE_PROJECT_REF\}\/database\/query/);
    const tables = /TABLES=\(([\s\S]*?)\)/.exec(script)?.[1].split(/\s+/).filter(Boolean) ?? [];
    // Floor: marketplace + money ledgers + logins.
    expect(tables.length).toBeGreaterThan(10);
    for (const t of ["auth.users", "public.profiles", "public.jobs", "public.payout_transfers", "public.disputes"]) {
      expect(tables).toContain(t);
    }
  });

  it("the script FAILS on an unexpected error, a missing table and an out-of-tolerance count", () => {
    expect(script).toMatch(/N_UNEXP" -gt 0[\s\S]{0,200}FAIL=1/);
    expect(script).toMatch(/table did not restore"; FAIL=1/);
    expect(script).toMatch(/prod has rows, restore has none"; FAIL=1/);
    expect(script).toMatch(/off by \$diff[^\n]*FAIL=1/);
    expect(script).toMatch(/exit "\$FAIL"\s*$/);
    // No comparison is not a pass.
    expect(script).toMatch(/SUPABASE_ACCESS_TOKEN[^\n]*SUPABASE_PROJECT_REF[\s\S]{0,300}exit 1/);
  });

  it("the script carries the three repairs the first drill proved necessary", () => {
    // 306 of 306 functions came back anon-executable without this (prod: 17).
    expect(script).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon/);
    expect(script).toMatch(/restored copy lets anon EXECUTE[^\n]*\n\s+FAIL=1/);
    // 0 of 55 cron schedules came back: the backup must carry cron.sql and the drill must load it.
    expect(script).toMatch(/-f "\$DIR\/cron\.sql"/);
    expect(script).toMatch(/backup has no cron\.sql[\s\S]{0,160}FAIL=1/);
    expect(read(".github/workflows/db-backup.yml")).toMatch(/-C out roles\.sql schema\.sql data\.sql cron\.sql/);
    // ensure_rls is commented out of every CLI schema dump.
    expect(script).toMatch(/CREATE EVENT TRIGGER ensure_rls/);
  });

  it("every known-benign restore error carries a reason", () => {
    const entries = known.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const [file, re, reason] = e.split("|");
      expect(["roles", "acl", "schema", "pgmq", "evt", "venue", "data", "cron"], e).toContain(file);
      expect(() => new RegExp(re), e).not.toThrow();
      expect((reason ?? "").length, e).toBeGreaterThan(40);
    }
  });

  it("reports its result through nightly-issue-sync, reading the drill job", () => {
    expect(wf).toMatch(/^\s*-?\s*uses:\s*\.\/\.github\/actions\/nightly-issue-sync\b/m);
    expect(wf).toMatch(/status:\s*\$\{\{\s*needs\.drill\.result == 'success'/);
  });
});
