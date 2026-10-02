// Every @mutate line in the repo must resolve: target exists, find-string is in
// it exactly once, find !== replace. The vacuity job checks this, but only on a
// push to main (not a required PR check), so a doc edit that reworded a
// find-string landed green and turned vacuity red on main (2026-10-02, run
// 36985646507: two registrations against .claude/AGENT-BRIEF.md). Vitest is
// required on every PR, so the registration phase runs here too.
// @mutate .claude/AGENT-BRIEF.md | main requires Vitest, Test and | main needs Vitest, Test and
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = (f: string) => pathToFileURL(resolve(__dirname, "../../scripts/vacuity", f)).href;

describe("@mutate registrations resolve against the live repo", () => {
  it("has no stale, missing, ambiguous or no-op registration", async () => {
    const { collectMutations } = await import(/* @vite-ignore */ url("run.mjs"));
    const { guardFiles } = await import(/* @vite-ignore */ url("lib.mjs"));
    const { errors, mutations } = collectMutations(guardFiles());
    expect(mutations.length).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });
});
