/**
 * Vitest's dep-optimizer cache must live in the checkout, never under
 * node_modules: worktrees symlink node_modules to the main checkout's, so a
 * cache there is shared by every worktree and wiped by each run's start
 * (random "React.forwardRef is not a function" failures, 2026-10-06).
 *
 * @mutate vitest.config.ts |   cacheDir: ".vitest-cache", |   cacheDir: "node_modules/.vitest",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("vitest cache is per checkout", () => {
  it("cacheDir is set and not under node_modules", () => {
    const m = /\bcacheDir:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync("vitest.config.ts", "utf8"));
    expect(m, "vitest.config.ts sets cacheDir").not.toBeNull();
    expect(m![1]).not.toMatch(/node_modules/);
  });
  it("the cache directory is gitignored", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.vitest-cache$/m);
  });
});
