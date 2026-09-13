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
