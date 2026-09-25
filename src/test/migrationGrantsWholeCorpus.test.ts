/*
 * Q263: `check-migration-grants --all` is clean over the WHOLE migration
 * corpus, not just the files a PR changes. It flagged 25 functions (2026-09-23):
 * 7 were a dynamic `EXECUTE format('GRANT … %s')` loop the checker could not
 * see, 12 were functions later migrations dropped, and 3 live ones had grants
 * only by default privilege (pinned by 20260923211545, matching prod proacl).
 * A new function without an explicit GRANT/REVOKE now fails here even if the
 * per-PR run was skipped.
 *
 * An EDITED old migration defining a since-dropped function is not a new
 * function either (2026-09-24: the address rename edited 20260504142454 and
 * 20260509195035, whose get_approved_helpers / get_hero_parishes were dropped
 * on 2026-09-13, and the per-diff run blocked db-deploy). The per-file case
 * runs on a temp-dir copy of that shape, not the real 2026-05 files: pinning
 * them by name trips guardsReadTheNewestMigration, since the rename
 * redefined their other functions.
 *
 * @mutate scripts/check-migration-grants.mjs | if (droppedForGood(name.toLowerCase())) continue; | void 0;
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("check-migration-grants --all (Q263)", () => {
  it("flags nothing across the whole corpus", () => {
    const r = spawnSync("node", ["scripts/check-migration-grants.mjs", "--all"], {
      cwd: resolve(__dirname, "..", ".."),
      encoding: "utf8",
    });
    expect(r.stdout + r.stderr).toContain("carry an explicit GRANT or REVOKE");
    expect(r.status).toBe(0);
  }, 60_000);

  const ROOT = resolve(__dirname, "..", "..");
  const perFile = (sql: string) => {
    const dir = mkdtempSync(join(tmpdir(), "grants-"));
    try {
      const file = join(dir, "edited_old_migration.sql");
      writeFileSync(file, sql);
      return spawnSync("node", ["scripts/check-migration-grants.mjs", file], { cwd: ROOT, encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // get_approved_helpers: created in 20260509195035, dropped for good in
  // 20260913053041, never granted anywhere.
  it("an edited old migration whose functions were dropped later passes the per-file run", () => {
    const r = perFile(
      "CREATE OR REPLACE FUNCTION public.get_approved_helpers()\nRETURNS SETOF uuid LANGUAGE sql AS $$ select null::uuid $$;\n",
    );
    expect(r.stdout + r.stderr).toContain("carry an explicit GRANT or REVOKE");
    expect(r.status).toBe(0);
  }, 60_000);

  it("the per-file run still fails a new function with no GRANT or REVOKE", () => {
    const r = perFile(
      "CREATE OR REPLACE FUNCTION public.zz_grants_fixture_never_granted()\nRETURNS int LANGUAGE sql AS $$ select 1 $$;\n",
    );
    expect(r.stderr).toContain("public.zz_grants_fixture_never_granted");
    expect(r.status).toBe(1);
  }, 60_000);
});
