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
 * on 2026-09-13, and the per-diff run blocked db-deploy).
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

  it("an edited old migration whose functions were dropped later passes the per-file run", () => {
    const r = spawnSync(
      "node",
      [
        "scripts/check-migration-grants.mjs",
        "supabase/migrations/20260504142454_fix_role_checks_via_user_roles.sql",
        "supabase/migrations/20260509195035_rewrite_helper_filters_behavior_based.sql",
      ],
      { cwd: resolve(__dirname, "..", ".."), encoding: "utf8" },
    );
    expect(r.stdout + r.stderr).toContain("carry an explicit GRANT or REVOKE");
    expect(r.status).toBe(0);
  }, 60_000);
});
