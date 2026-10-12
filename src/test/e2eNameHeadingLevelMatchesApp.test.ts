/**
 * Q1429 CLASS GUARD: an e2e locator for a person's NAME heading asks for the
 * heading level the Profile landing actually renders the name at.
 *
 * 2026-10-09 the owner moved the name back beside the photo: IdentityHeader
 * renders `displayName` in an <h2> and the page <h1> reads "Profile". The
 * 03-account "sign back in" step still waited for the name at level 1, so
 * e2e-journeys run 38181872855 (2026-10-12) failed it on both engines with
 * the name on screen.
 *
 * Inventory: every tracked e2e/ .ts file. A variable assigned from an
 * expression that reads `full_name` is a name; a getByRole("heading", ...)
 * whose `name` is that variable and that pins a `level` must pin
 * IdentityHeader's level.
 *
 * @mutate e2e/journeys/03-account.spec.ts | { name, exact: true, level: 2 } | { name, exact: true, level: 1 }
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function appNameLevel(): number {
  const src = blankComments(readFileSync(resolve(ROOT, "src/components/profile/profileLanding/IdentityHeader.tsx"), "utf8"));
  const m = src.match(/<h([1-6])\b[^>]*>\s*\{displayName\}/);
  if (!m) throw new Error("IdentityHeader no longer renders {displayName} directly inside an <hN>: update this guard");
  return Number(m[1]);
}

/** `name-variable: level` for every name-heading locator in one file. */
function nameHeadingLevels(code: string): { v: string; level: number }[] {
  const names = new Set([...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=[^;\n]*full_name/g)].map((m) => m[1]));
  const out: { v: string; level: number }[] = [];
  for (const m of code.matchAll(/getByRole\(\s*"heading"\s*,\s*\{([^}]*)\}/g)) {
    const opts = m[1];
    const lv = opts.match(/\blevel:\s*(\d)/);
    if (!lv) continue;
    const named = opts.match(/\bname:\s*(\w+)\b/)?.[1] ?? (/(^|[\s,])name\s*(,|$)/.test(opts) ? "name" : null);
    if (named && names.has(named)) out.push({ v: named, level: Number(lv[1]) });
  }
  return out;
}

describe("e2e name-heading locators follow the app's heading level (Q1429)", () => {
  const level = appNameLevel();
  const files = execFileSync("git", ["ls-files", "e2e"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts"));
  const found = files.flatMap((f) =>
    nameHeadingLevels(blankComments(readFileSync(resolve(ROOT, f), "utf8"))).map((h) => ({ f, ...h })),
  );

  it("finds the 03-account sign-back-in locator", () => {
    // Inventory floor: one name-heading locator on 2026-10-12.
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((h) => h.f)).toContain("e2e/journeys/03-account.spec.ts");
  });

  it("every one asks for the level IdentityHeader renders", () => {
    expect(found.filter((h) => h.level !== level).map((h) => `${h.f}: ${h.v} at level ${h.level}, app renders h${level}`)).toEqual([]);
  });

  it("the parser reads both the shorthand and the named form", () => {
    const code = 'const name = rows[0]?.full_name ?? "";\nconst who = x.full_name;\npage.getByRole("heading", { name, exact: true, level: 1 });\npage.getByRole("heading", { name: who, level: 3 });\npage.getByRole("heading", { name: "Profile", level: 1 });';
    expect(nameHeadingLevels(code)).toEqual([
      { v: "name", level: 1 },
      { v: "who", level: 3 },
    ]);
  });
});
