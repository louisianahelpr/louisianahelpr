/*
 * GUARD (docs/OPEN.md Q1354): every pinned Action SHA is the commit its
 * `# vX.Y.Z` comment names.
 *
 * actionsPinnedToSha.test.ts proves the pin SHAPE; a wrong or orphaned SHA
 * passes it. scripts/ci/action-pins-match-tags.mjs (nightly,
 * .github/workflows/action-pins.yml) resolves each tag with `git ls-remote`
 * and fails on a SHA that is not the tag's commit or a tag that is gone. This
 * test pins the pure parts on fixtures (the network half runs only in the
 * workflow) and proves the scan reads the real workflow tree.
 *
 * Proven red 2026-10-12, live: pinning denoland/setup-deno to ...cf2ee
 * (tag v2.0.5 is ...cf2ed) made the script exit 1 naming test.yml; on the
 * real tree it reported 15 pins across 15 action repos, all matching.
 */
// @mutate scripts/ci/action-pins-match-tags.mjs |     else if (got !== p.sha) lines.push( |     else if (false) lines.push(
// @mutate scripts/ci/action-pins-match-tags.mjs |     if (!got) lines.push( |     if (false) lines.push(
// @mutate scripts/ci/action-pins-match-tags.mjs |     if (ref === `refs/tags/${tag}^{}`) return sha; |     if (false) return sha;
// @mutate .github/workflows/action-pins.yml |         run: node scripts/ci/action-pins-match-tags.mjs |         run: echo skipped
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { collectPins, peeledSha, judge, workflowFiles } from "../../scripts/ci/action-pins-match-tags.mjs";

const ROOT = resolve(__dirname, "../..");
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

type Pin = { repo: string; sha: string; tag: string; files: string[] };

describe("pinned Action SHAs match their tags (Q1354)", () => {
  it("collects pins from the real workflow tree, one per (repo, sha, tag)", () => {
    const files = (workflowFiles() as string[]).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));
    expect(files.length).toBeGreaterThan(60);
    const pins = collectPins(files) as Pin[];
    expect(pins.length).toBeGreaterThan(10);
    const checkout = pins.find((p) => p.repo === "actions/checkout");
    expect(checkout?.files.length).toBeGreaterThan(50);
    expect(pins.find((p) => p.repo === "github/codeql-action")).toBeTruthy();
    expect(readFileSync(resolve(ROOT, ".github/workflows/action-pins.yml"), "utf8")).toMatch(
      /run: node scripts\/ci\/action-pins-match-tags\.mjs/,
    );
  });

  it("reads a sub-path action as its repo and ignores local and unpinned uses", () => {
    const text = [
      `      - uses: github/codeql-action/upload-sarif@${A} # v4.38.2`,
      `      - uses: ./.github/actions/nightly-issue-sync`,
      `      - uses: actions/checkout@v4`,
      `    uses: owner/repo/.github/workflows/x.yml@${B} # v1`,
    ].join("\n");
    expect(collectPins([{ path: "w.yml", text }])).toEqual([
      { repo: "github/codeql-action", sha: A, tag: "v4.38.2", files: ["w.yml"] },
      { repo: "owner/repo", sha: B, tag: "v1", files: ["w.yml"] },
    ]);
  });

  it("takes the peeled commit of an annotated tag, else the lightweight tag", () => {
    expect(peeledSha(`${A}\trefs/tags/v1.0.0\n${B}\trefs/tags/v1.0.0^{}\n`, "v1.0.0")).toBe(B);
    expect(peeledSha(`${C}\trefs/tags/v2\n`, "v2")).toBe(C);
    expect(peeledSha(`${C}\trefs/tags/v2.1\n`, "v2")).toBeNull();
  });

  it("fails on a SHA that is not the tag's commit and on a missing tag; passes a match", () => {
    const pins: Pin[] = [
      { repo: "x/ok", sha: A, tag: "v1", files: ["a.yml"] },
      { repo: "x/moved", sha: A, tag: "v2", files: ["b.yml"] },
      { repo: "x/gone", sha: A, tag: "v3", files: ["c.yml"] },
    ];
    const resolved = new Map<string, string | null>([
      ["x/ok#v1", A],
      ["x/moved#v2", B],
      ["x/gone#v3", null],
    ]);
    const r = judge(pins, resolved);
    expect(r.ok).toBe(false);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatch(/x\/moved.*tag v2 is b{40}, not the pinned SHA \(b\.yml\)/);
    expect(r.lines[1]).toMatch(/x\/gone.*tag v3 not found/);
    expect(judge(pins.slice(0, 1), resolved)).toEqual({ ok: true, lines: [] });
  });
});
