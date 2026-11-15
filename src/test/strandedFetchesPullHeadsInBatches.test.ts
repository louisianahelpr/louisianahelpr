/*
 * branch-prune's `stranded` job fetches closed PR heads in batches, not one
 * `git fetch` per PR (Q1816, nightly-red #2366).
 *
 * Measured 2026-11-15: every branch-prune run since 2026-11-13 was cancelled at
 * a job timeout (stranded at 15 min, e.g. run 43732583624). From a local clone,
 * one fetch per PR head took ~1.2 s, and 462 PRs closed unmerged since
 * 2026-10-03 made that ~9 min of the stranded job alone
 * (~/.lh-shots/builder4-1115/stranded-timing.txt).
 *
 * Drives the real remoteInventory with a fake git/gh and counts fetches.
 */

// @mutate scripts/stranded-work.mjs | export const PULL_FETCH_BATCH = 100; | export const PULL_FETCH_BATCH = 1;
// @mutate scripts/stranded-work.mjs |   fetchPullHeads(git, closed.map((pr) => pr.number)); |   for (const pr of closed) git(["fetch", "-q", "origin", `+refs/pull/${pr.number}/head:refs/stranded/pr/${pr.number}`]);
// @mutate scripts/stranded-work.mjs |         try { git(["fetch", "-q", "origin", spec(n)]); } catch { /* deleted fork head: judged stranded by the caller */ } |         void n;

import { describe, it, expect } from "vitest";
import { remoteInventory, fetchPullHeads, PULL_FETCH_BATCH, setMainRef } from "../../scripts/stranded-work.mjs";

type Argv = string[];

function fakeGit(failWhen: (argv: Argv) => boolean = () => false) {
  const fetches: Argv[] = [];
  const judged: string[] = [];
  const git = (argv: Argv) => {
    if (argv[0] === "fetch") {
      fetches.push(argv);
      if (failWhen(argv)) throw new Error("fatal: couldn't find remote ref");
      return "";
    }
    if (argv[0] === "for-each-ref") return "";
    // unlandedContent's first read of each fetched head; no merge base ends its judging there.
    if (argv[0] === "merge-base") { judged.push(argv[2]); throw new Error("no merge base"); }
    throw new Error(`unexpected git ${argv.join(" ")}`);
  };
  return { git, fetches, judged };
}

const closedPrs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    number: 1000 + i, headRefOid: `sha${i}`, headRefName: `b${i}`, mergedAt: null,
    closedAt: "2026-11-01T00:00:00Z", title: `PR ${i}`, author: { login: "lane" },
  }));

function fakeGh(prs: ReturnType<typeof closedPrs>) {
  return (argv: Argv, o: { raw?: boolean } = {}) => {
    if (argv[0] === "pr" && argv[1] === "list") return [];
    if (argv[0] === "api") return o.raw ? prs.map((p) => JSON.stringify(p)).join("\n") : prs;
    if (argv[0] === "pr" && argv[1] === "view") return { comments: [] };
    throw new Error(`unexpected gh ${argv.join(" ")}`);
  };
}

describe("stranded-work fetches closed PR heads in batches", () => {
  setMainRef("origin/main");

  it("250 closed PRs take 3 fetches through the real remoteInventory, every head named once", () => {
    const prs = closedPrs(250);
    const { git, fetches, judged } = fakeGit();
    remoteInventory(git, new Map(), fakeGh(prs));
    expect(PULL_FETCH_BATCH).toBeGreaterThan(1);
    expect(fetches.length).toBe(Math.ceil(250 / PULL_FETCH_BATCH));
    const specs = fetches.flatMap((f) => f.slice(3));
    expect(specs).toHaveLength(250);
    expect(new Set(specs).size).toBe(250);
    expect(specs[0]).toBe("+refs/pull/1000/head:refs/stranded/pr/1000");
    // Every fetched head is still judged, from the ref the batch wrote: batching drops none.
    expect(judged).toHaveLength(250);
    expect(new Set(judged)).toEqual(new Set(prs.map((p) => `refs/stranded/pr/${p.number}`)));
  });

  it("a batch that fails on one deleted head falls back to one fetch per PR in that batch only", () => {
    const deleted = "+refs/pull/1005/head:refs/stranded/pr/1005";
    const { git, fetches } = fakeGit((argv) => argv.includes(deleted));
    const numbers = Array.from({ length: PULL_FETCH_BATCH + 10 }, (_, i) => 1000 + i);
    fetchPullHeads(git, numbers);
    // batch 1 (fails) + PULL_FETCH_BATCH singles + batch 2
    expect(fetches.length).toBe(1 + PULL_FETCH_BATCH + 1);
    const singles = fetches.filter((f) => f.length === 4).map((f) => f[3]);
    expect(singles).toHaveLength(PULL_FETCH_BATCH);
    expect(singles).toContain("+refs/pull/1001/head:refs/stranded/pr/1001");
  });
});
