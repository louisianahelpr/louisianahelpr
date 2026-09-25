/*
 * A password a test generates for a prod account must meet Supabase Auth's
 * policy: a lowercase letter, an uppercase letter, a digit and a symbol.
 *
 * FOUND 2026-09-25: the privacy journey (run 36092612315) failed creating its
 * disposable account with 422 weak_password. Its password was
 * `randomBytes(24).toString("base64url")`, which carries no `-` or `_` about a
 * third of the time, so the monthly journey was red on a coin flip.
 *
 * CLASS: every random password in e2e/ and scripts/ comes from
 * strongTestPassword() (src/test/strongTestPassword.ts), never raw randomness.
 *
 * @mutate src/test/strongTestPassword.ts | return `${randomBytes(24).toString("base64url")}aZ9!`; | return randomBytes(24).toString("base64url");
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strongTestPassword } from "./strongTestPassword";

const REPO = resolve(__dirname, "..", "..");

/** Supabase Auth "lower, upper, digit and symbol" (the 422 names these sets). */
function meetsPolicy(pw: string): boolean {
  return /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(pw);
}

/** A password-named binding or key assigned from raw randomness. */
const RAW_RANDOM_PASSWORD = /\bpass(?:word)?\w*\s*[:=]\s*[^;\n]*\b(?:randomBytes|randomUUID|Math\.random)\b/i;

describe("generated test passwords meet the Auth password policy", () => {
  it("strongTestPassword always has every character class", () => {
    for (let i = 0; i < 2000; i++) {
      const pw = strongTestPassword();
      expect(meetsPolicy(pw), pw).toBe(true);
    }
  });

  it("the detector catches the pattern that broke the privacy journey", () => {
    expect(RAW_RANDOM_PASSWORD.test('const PASSWORD = randomBytes(24).toString("base64url");')).toBe(true);
    expect(RAW_RANDOM_PASSWORD.test("const PASSWORD = strongTestPassword();")).toBe(false);
  });

  it("no e2e spec or script builds a password from raw randomness", () => {
    const files = execFileSync("git", ["ls-files", "--", "e2e", "scripts"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && f !== "src/test/strongTestPassword.ts");
    expect(files.length, "git ls-files found no e2e/ or scripts/ sources — this check reads nothing").toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(resolve(REPO, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_RANDOM_PASSWORD.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "use strongTestPassword() from src/test/strongTestPassword.ts").toEqual([]);
  });
});
