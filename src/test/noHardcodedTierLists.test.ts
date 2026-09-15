/**
 * A tier list typed out by hand drifts the day a tier is added. Plus was
 * restored on 2026-09-05 and `weekly-helper-report` kept filtering
 * `.in("subscription_tier", ["pro", "elite"])`, so Plus members never got the
 * report their perk promises (found 2026-09-14). Tier gates must be derived
 * from the perk matrix (`TIER_PERK_MATRIX` / `hasPerk`), never a literal array.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "supabase/functions"];
const LITERAL_TIER_LIST =
  /subscription_tier["'`]?\s*,\s*\[\s*["'](?:free|basic|pro|plus|elite)["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function findLiteralTierLists(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => LITERAL_TIER_LIST.test(f.text)).map((f) => f.path);
}

describe("tier gates are derived from the perk matrix", () => {
  it("the pattern catches the original weekly-helper-report filter", () => {
    expect(
      findLiteralTierLists([{ path: "x.ts", text: `.in("subscription_tier", ["pro", "elite"])` }]),
    ).toEqual(["x.ts"]);
  });

  it("no source file filters subscription_tier by a hand-typed tier list", () => {
    const files = ROOTS.flatMap((r) => walk(r)).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    expect(findLiteralTierLists(files)).toEqual([]);
  });
});
