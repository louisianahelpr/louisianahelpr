/**
 * Q250: useUserProfileData ran a helper_credentials count query on every
 * public profile view and returned it as `hasSubmittedCredentials`, which no
 * screen read. Class: a value the profile hook returns that nothing consumes
 * (each one costs a query or a computation per profile view).
 *
 * Every key in the hook's returned object must be referenced by some
 * non-test file in src/ other than the hook itself, or sit in the exact
 * KNOWN_UNCONSUMED list below (reported, not removed: dead code is a report).
 *
 * @mutate src/pages/user/useUserProfileData.ts |     data,\n    isError, |     data,\n    q250Planted: null,\n    isError,
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const HOOK = "src/pages/user/useUserProfileData.ts";

// @two-way src/test/profileHookReturnsAreConsumed.test.ts:expect(unconsumed.sort()).toEqual
const KNOWN_UNCONSUMED = ["postedCancelledCount", "statSamples"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\/test\//.test(p)) out.push(p);
  }
  return out;
}

function returnedKeys(src: string): string[] {
  const start = src.lastIndexOf("\n  return {\n");
  expect(start, "hook's top-level return object not found").toBeGreaterThan(0);
  const end = src.indexOf("\n  };", start);
  return src
    .slice(start + "\n  return {\n".length, end)
    .split("\n")
    .map((l) => l.trim().match(/^([A-Za-z_$][\w$]*)\s*[,:]/)?.[1])
    .filter((k): k is string => !!k);
}

describe("useUserProfileData returns only consumed values (Q250)", () => {
  const hookSrc = readFileSync(join(ROOT, HOOK), "utf8");
  const keys = returnedKeys(hookSrc);
  const others = walk(join(ROOT, "src"))
    .filter((p) => relative(ROOT, p) !== HOOK)
    .map((p) => readFileSync(p, "utf8"));

  it("parses a real return object", () => {
    expect(keys.length).toBeGreaterThan(20);
    expect(others.length).toBeGreaterThan(500);
  });

  it("every returned key is consumed or listed, and the list is exact", () => {
    const unconsumed = keys.filter(
      (k) => !others.some((src) => new RegExp(`\\b${k}\\b`).test(src)),
    );
    expect(unconsumed.sort()).toEqual([...KNOWN_UNCONSUMED].sort());
  });
});
