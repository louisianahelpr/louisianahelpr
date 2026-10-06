/**
 * supabase/.temp is the Supabase CLI's per-checkout scratch dir (project ref,
 * pooler url). Tracked, it breaks every CI `supabase link` ("AlreadyExists:
 * FileSystem.makeDirectory .../supabase/.temp"): on 2026-10-06 a worktree's
 * symlink to the main checkout's .temp was committed (bd4515d6f) because the
 * ignore rule was "supabase/.temp/", which matches a directory but not a
 * symlink, and write-contract-refresh went red on its Link step.
 *
 * @mutate .gitignore | /supabase/.temp | /supabase/.temp/
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

describe("supabase/.temp is never tracked", () => {
  it("no tracked path lives at or under supabase/.temp", () => {
    const tracked = git("ls-files", "supabase").split("\n").filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked.filter((f) => f === "supabase/.temp" || f.startsWith("supabase/.temp/"))).toEqual([]);
  });

  it("the ignore rule also covers a symlink (a file), not only a directory", () => {
    // check-ignore --no-index judges the path against the rules alone.
    expect(git("check-ignore", "--no-index", "-v", "supabase/.temp").trim()).toMatch(/\.gitignore:\d+:\/supabase\/\.temp\s/);
  });
});
