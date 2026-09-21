import { describe, expect, it } from "vitest";
import { isWholeRepoRun } from "./gateLockGlobalSetup";

describe("gate lock applies only to whole-repo vitest runs", () => {
  const node = ["node", "/x/vitest"];
  it("locks a bare `vitest run`", () => {
    expect(isWholeRepoRun([...node, "run"])).toBe(true);
    expect(isWholeRepoRun([...node, "run", "--reporter", "dot"])).toBe(true);
  });
  it("skips scoped runs and watch mode", () => {
    expect(isWholeRepoRun([...node, "run", "src/lib/foo.test.ts"])).toBe(false);
    expect(isWholeRepoRun([...node, "run", "--reporter", "dot", "chunkReload"])).toBe(false);
    expect(isWholeRepoRun([...node])).toBe(false);
  });
});

// Shown able to fail 2026-09-21: treating a positional file filter as a
// whole-repo run makes every scoped `vitest run <file>` take the machine-wide
// gate lock, so lanes serialise behind one another for no reason.
// @mutate src/test/gateLockGlobalSetup.ts | return false; // a positional file filter | return true; // a positional file filter
// And the other direction: a whole-repo run that skips the lock is the 2026-09-13
// three-at-once load-58 stall.
// @mutate src/test/gateLockGlobalSetup.ts | if (i === -1) return false; | if (i === -1) return false;\n  if (true) return false;
