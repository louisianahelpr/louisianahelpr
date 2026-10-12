/**
 * The shared test accounts' auth ids are spelled in ONE file (OPEN.md Q1650).
 *
 * scripts/test-signin-link.mjs ACCOUNTS is the only copy checked against prod
 * every night (check-test-account-strikes.mjs findPinnedIdDrift). On
 * 2026-10-11, 27 other code files (probes, the prod-audit harness and
 * sweeper, the journeys' throwaway helpers, shellSpacing) carried their own
 * copy, so every re-creation of an account (Q905 2026-10-01, Q1649
 * 2026-10-09) meant a repo-wide hand edit, and a copy that drifted aimed its
 * probe at nobody. They now import ACCOUNTS (TypeScript through
 * scripts/test-signin-link.d.mts).
 *
 * Inventory: every tracked code file in the repo (`git ls-files`, same
 * extensions as retiredTestAccountIds.test.ts), Markdown and docs/ excluded:
 * dated records keep the ids they measured. Fails on any file other than
 * test-signin-link.mjs that contains a pinned (non-null) ACCOUNTS userId,
 * outside a guard's own `@mutate` line (which plants the id, never runs).
 *
 * Proven red 2026-10-12: putting the literal id back in e2e/prod-audit/harness.ts
 * and, separately, in scripts/probes/release-race.prod.mjs each failed it, naming the file.
 *
 * @mutate e2e/prod-audit/harness.ts | export const HELPER_ID = ACCOUNTS["helper-e2e"].userId; | export const HELPER_ID = "7b923b19-aba5-44cb-8730-8c33ba2b9321";
 * @mutate scripts/probes/release-race.prod.mjs | const POSTER = ACCOUNTS["poster-e2e"].userId; | const POSTER = "951264df-1e7c-4b6f-912e-a1be37e0dbfb";
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";

const REPO = resolve(__dirname, "../..");
const HOME = "scripts/test-signin-link.mjs";
const CODE = /\.(m?[jt]sx?|cjs|sh|ya?ml|sql|py)$/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: REPO,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((f) => CODE.test(f) && !f.startsWith("docs/") && !f.includes("node_modules/"));

const pinned = Object.entries(ACCOUNTS as Record<string, { userId: string | null }>)
  .filter(([, a]) => a.userId)
  .map(([role, a]) => [role, a.userId as string] as const);

describe("shared test-account ids live only in scripts/test-signin-link.mjs (Q1650)", () => {
  it("inventory is the real tree, and ACCOUNTS pins the four stable accounts", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(files).toContain(HOME);
    expect(files).toContain("e2e/prod-audit/harness.ts");
    expect(pinned.map(([r]) => r).sort()).toEqual(["helper", "helper-e2e", "poster", "poster-e2e"]);
  });

  it("no other code file spells a pinned id (import ACCOUNTS instead)", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (f === HOME) continue;
      // A guard's own `@mutate` line names the id it plants; that line never runs.
      const s = readFileSync(join(REPO, f), "utf8")
        .split("\n")
        .filter((l) => !l.includes("@mutate "))
        .join("\n");
      for (const [role, id] of pinned) if (s.includes(id)) hits.push(`${f}: ${role} ${id}`);
    }
    expect(hits).toEqual([]);
  });
});
