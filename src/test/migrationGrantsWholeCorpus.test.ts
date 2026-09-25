/*
 * Q263: `check-migration-grants --all` is clean over the WHOLE migration
 * corpus, not just the files a PR changes. It flagged 25 functions (2026-09-23):
 * 7 were a dynamic `EXECUTE format('GRANT … %s')` loop the checker could not
 * see, 12 were functions later migrations dropped, and 3 live ones had grants
 * only by default privilege (pinned by 20260923211545, matching prod proacl).
 * A new function without an explicit GRANT/REVOKE now fails here even if the
 * per-PR run was skipped.
 *
 * Per-file pinning uses the NEWEST migration defining each function
 * (2026-09-25: updated from 20260504142454 / 20260509195035 to the migrations
 * that now define those same functions: rename_tab_addresses and
 * retire_approval_status_reads).
 *
 * @mutate scripts/check-migration-grants.mjs | if (droppedForGood(name.toLowerCase())) continue; | void 0;
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("check-migration-grants --all (Q263)", () => {
  it("flags nothing across the whole corpus", () => {
    const r = spawnSync("node", ["scripts/check-migration-grants.mjs", "--all"], {
      cwd: resolve(__dirname, "..", ".."),
      encoding: "utf8",
    });
    expect(r.stdout + r.stderr).toContain("carry an explicit GRANT or REVOKE");
    expect(r.status).toBe(0);
  }, 60_000);

  it("migrations that redefine many functions pass the per-file run", () => {
    const r = spawnSync(
      "node",
      [
        "scripts/check-migration-grants.mjs",
        "supabase/migrations/20260924220318_rename_tab_addresses.sql",
        "supabase/migrations/20260924055509_get_safe_profiles_hide_anonymized.sql",
      ],
      { cwd: resolve(__dirname, "..", ".."), encoding: "utf8" },
    );
    expect(r.stdout + r.stderr).toContain("carry an explicit GRANT or REVOKE");
    expect(r.status).toBe(0);
  }, 60_000);
});
