// PROVEN ABLE TO FAIL: adding one more raw `hover:underline` anywhere under
// src/**/*.tsx, or dropping one without lowering HOVER_UNDERLINE_SITE_COUNT
// below, turns this red in both directions.
// @mutate src/components/AttachmentLink.tsx | text-primary hover:underline | text-primary hover:underline hover:underline

/**
 * Q248(b): 36 hand-rolled `hover:underline` sites vs. the 4 files that use
 * the shared `.link-standard` class (src/index.css) — the ONE canonical
 * text-link affordance (spring-eased underline reveal + focus ring + a
 * pointer-coarse 44px hit target). Migrating all 36 was judged not mechanical
 * (each site has its own surrounding markup/typography), so this is an
 * EXACT, two-way count: it fails if a new hand-rolled site appears, and it
 * fails if the count drops without this baseline being lowered in the same
 * commit (CLAUDE.md "every number we track stays current").
 *
 * Measured 2026-09-23: `grep -rn "hover:underline" src --include="*.tsx" | wc -l` → 36
 * Measured 2026-09-23: `grep -rl "link-standard" src --include="*.tsx" | wc -l` → 4
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

const HOVER_UNDERLINE_SITE_COUNT = 36;
const LINK_STANDARD_FILE_COUNT = 4;

describe("Q248(b): hover:underline vs the shared link-standard", () => {
  const files = tsxFiles();

  it("finds a real corpus of .tsx files to scan", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("exactly 36 hand-rolled hover:underline sites (raise or lower this baseline in the same commit as any change)", () => {
    let hits = 0;
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      hits += (src.match(/hover:underline/g) ?? []).length;
    }
    expect(hits).toBe(HOVER_UNDERLINE_SITE_COUNT);
  });

  it("exactly 4 files on the shared link-standard (raise or lower this baseline in the same commit as any change)", () => {
    const onStandard = files.filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("link-standard"));
    expect(onStandard.length).toBe(LINK_STANDARD_FILE_COUNT);
  });
});
