/**
 * A SHARED TEST ACCOUNT'S AUTH ID IS SPELLED IN ONE PLACE (docs/OPEN.md Q1650).
 *
 * Each re-creation of the shared accounts (Q905 on 2026-10-01, Q1649 on
 * 2026-10-09) changes their auth ids, and 28 files (probes, the prod-audit
 * harness and sweeper, the journeys' throwaway helpers) carried their own copy,
 * so each one meant a repo-wide hand edit, and only
 * scripts/test-signin-link.mjs ACCOUNTS is compared with prod nightly
 * (check-test-account-strikes.mjs findPinnedIdDrift). retiredTestAccountIds
 * catches a KNOWN-old id only after it is listed there.
 *
 * Rule: no tracked code file outside scripts/test-signin-link.mjs spells a
 * pinned ACCOUNTS id; code imports ACCOUNTS (or resolves by email). Comments
 * do not count (a dated note may quote an id).
 *
 * @mutate e2e/prod-audit/harness.ts | export const POSTER_ID = ACCOUNTS["poster-e2e"].userId; | export const POSTER_ID = "951264df-1e7c-4b6f-912e-a1be37e0dbfb";
 * @mutate scripts/probes/release-race.prod.mjs | const HELPER = ACCOUNTS["helper-e2e"].userId; | const HELPER = "7b923b19-aba5-44cb-8730-8c33ba2b9321";
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";
import { blankComments, blankHashComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const HOME = "scripts/test-signin-link.mjs";
const CODE = /\.(m?[jt]sx?|cjs|sh|ya?ml|sql|py)$/;

const files = execFileSync("git", ["ls-files", "scripts", "e2e", ".github", "src", "supabase"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\n")
  .filter((f) => CODE.test(f) && f !== HOME);
const pinned = Object.entries(ACCOUNTS)
  .map(([role, a]) => [role, a.userId] as const)
  .filter((e): e is readonly [string, string] => typeof e[1] === "string");

function code(f: string): string {
  const s = readFileSync(join(REPO, f), "utf8");
  if (/\.sql$/.test(f)) return blankSqlComments(s);
  if (/\.(sh|ya?ml|py)$/.test(f)) return blankHashComments(s);
  return blankComments(s);
}

function spellings(file: string, text: string): string[] {
  return pinned.filter(([, id]) => text.includes(id)).map(([role, id]) => `${file}: ${role} ${id}`);
}

describe("shared test-account ids live only in ACCOUNTS (Q1650)", () => {
  it("reads real inventories", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("e2e/prod-audit/harness.ts");
    expect(pinned.length).toBeGreaterThanOrEqual(4);
  });

  it("no code file outside test-signin-link.mjs spells a pinned id", () => {
    expect(files.flatMap((f) => spellings(f, code(f)))).toEqual([]);
  });

  it("is red on a hard-coded copy, and blind to one in a comment", () => {
    const id = ACCOUNTS["helper-e2e"].userId;
    expect(spellings("x.mjs", blankComments(`const HELPER = "${id}";`))).toHaveLength(1);
    expect(spellings("x.mjs", blankComments(`// was ${id}\nconst HELPER = ACCOUNTS["helper-e2e"].userId;`))).toEqual([]);
  });
});
