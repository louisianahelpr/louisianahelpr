/**
 * A SHARED TEST ACCOUNT'S OLD AUTH ID NEVER COMES BACK INTO RUNNABLE CODE.
 *
 * ─── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * On 2026-10-09 01:29Z all six shared test accounts were deleted through the
 * GoTrue admin API and re-created by hand at 01:59Z with NEW auth ids
 * (docs/OPEN.md Q1649). scripts/test-signin-link.mjs ACCOUNTS is checked
 * nightly against prod (scripts/check-test-account-strikes.mjs,
 * findPinnedIdDrift, Q905), but 28 other files (probes, the prod-audit
 * harness and sweeper, the journeys' throwaway helpers) hard-coded the same
 * ids, and nothing compared those to anything. A probe pointed at a deleted
 * id targets nobody, and a "permission denied" from it reads as a pass.
 *
 * ─── WHAT IT ASSERTS ───────────────────────────────────────────────────────
 * No tracked code file under scripts/, e2e/ or .github/ contains an id in
 * RETIRED below, and none of ACCOUNTS' pinned ids is retired. When an account
 * is re-created again: add its old id here and replace it everywhere in the
 * same commit (dated records under docs/ and applied migrations keep theirs).
 *
 * @mutate scripts/test-signin-link.mjs | userId: "7b923b19-aba5-44cb-8730-8c33ba2b9321", | userId: "437de07d-1bd7-46c8-a451-6b46aa3bcad5",
 * @mutate e2e/prod-audit/harness.ts | export const POSTER_ID = ACCOUNTS["poster-e2e"].userId; | export const POSTER_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f";
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";

const REPO = resolve(__dirname, "../..");

/** Auth ids of shared test accounts that no longer exist on prod (measured, auth.users by email). */
const RETIRED: Record<string, string> = {
  "f6cc3ebb-9478-473c-8eb8-62b406f0734f": "eli.test.helper, gone 2026-10-01 (Q905)",
  "71c56dfb-b326-4010-b960-b18dd3966e7f": "helpr-e2e-poster-0902, deleted 2026-10-09 01:29Z (Q1649)",
  "437de07d-1bd7-46c8-a451-6b46aa3bcad5": "helpr-e2e-helper-0902, deleted 2026-10-09 01:29Z (Q1649)",
  "96c9899e-87a2-49e2-bbdd-268717d52aee": "helpr-audit-web-0824, deleted 2026-10-09 01:29Z (Q1649)",
  "f55112c7-612e-44a0-b6aa-443cdfbc33d6": "eli.test.helper, deleted 2026-10-09 01:29Z (Q1649)",
  "68c11a39-0c7c-40d6-8420-7c37bccaa4ec": "helpr-seed-admin-0912, deleted 2026-10-09 01:29Z (Q1649)",
};

const CODE = /\.(m?[jt]sx?|cjs|sh|ya?ml|sql|py)$/;

function walk(rel: string, out: string[]) {
  for (const name of readdirSync(join(REPO, rel))) {
    if (name === "node_modules") continue;
    const r = `${rel}/${name}`;
    if (statSync(join(REPO, r)).isDirectory()) walk(r, out);
    else if (CODE.test(name)) out.push(r);
  }
}

describe("retired shared-account ids stay out of runnable code (Q1649)", () => {
  const files: string[] = [];
  for (const d of ["scripts", "e2e", ".github"]) walk(d, files);

  it("scans the runnable trees (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("scripts/test-signin-link.mjs");
    expect(files).toContain("e2e/prod-audit/harness.ts");
  });

  it("no scripts/, e2e/ or .github/ code file names a retired id", () => {
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(join(REPO, f), "utf8");
      for (const [id, why] of Object.entries(RETIRED)) if (s.includes(id)) hits.push(`${f}: ${id} (${why})`);
    }
    expect(hits).toEqual([]);
  });

  it("no ACCOUNTS pin is a retired id", () => {
    const pinned = Object.entries(ACCOUNTS as Record<string, { userId: string | null }>).filter(([, a]) => a.userId && RETIRED[a.userId]);
    expect(pinned.map(([role, a]) => `${role}: ${a.userId}`)).toEqual([]);
  });
});
