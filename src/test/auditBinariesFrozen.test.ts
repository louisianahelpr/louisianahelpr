/**
 * No new binary audit output lands under docs/audit (OPEN.md Q1306).
 *
 * .git passed 485 MB (2026-10-04) and docs/audit held screenshots that every
 * clone carries forever. Visual evidence goes to ~/.lh-shots/<task>/ (the
 * agent brief's rule); CI evidence goes to a workflow artifact. The images
 * already committed stay (rewriting history is not worth it) and are listed,
 * EXACTLY, in auditBinaries.allowlist.json: 121 on 2026-10-12 (82 webp, 30
 * png, 9 jpg), measured with `git ls-files docs/audit`.
 *
 * Two-way: a tracked image under docs/audit that is not listed fails (a new
 * one), and a listed one that is no longer tracked fails (delete it from the
 * list in the same commit, so the list only shrinks).
 *
 * The one legitimate growth is an owner visual-notes row being Confirmed:
 * scripts/check-visual-notes.mjs requires its screenshot committed beside the
 * notes (3 rows of docs/audit/visual-notes-2026-09-14.md are still unconfirmed).
 * Add that file to the list by name in the same commit; nothing else.
 *
 * Inventory: `git ls-files --cached --others --exclude-standard docs/audit`,
 * so an image added and not yet staged is seen too.
 *
 * Proven red 2026-10-12: renaming the first allowlist entry failed "every
 * image under docs/audit is listed"; a new untracked
 * docs/audit/q1306-probe.png failed the same test.
 *
 * @mutate src/test/auditBinaries.allowlist.json | "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-after-1440-dark.png" | "docs/audit/launch-2026-09/lanes/e2e/shots/ghost-job-after-1440-dark.PNG"
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../..");
const BINARY = /\.(png|jpe?g|webp|gif|avif|heic|mp4|mov|webm|zip|pdf)$/i;

const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "docs/audit"],
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\n")
  .filter(Boolean);
const images = tracked.filter((f) => BINARY.test(f));
const allowed: string[] = JSON.parse(readFileSync(join(REPO, "src/test/auditBinaries.allowlist.json"), "utf8"));

describe("no new binary audit output under docs/audit (Q1306)", () => {
  it("inventory is the real docs/audit tree", () => {
    expect(tracked.length).toBeGreaterThan(150);
    expect(images.length).toBeGreaterThan(100);
  });

  it("every image under docs/audit is listed (new screenshots go to ~/.lh-shots or a CI artifact)", () => {
    const listed = new Set(allowed);
    expect(images.filter((f) => !listed.has(f))).toEqual([]);
  });

  it("every listed image is still in the tree (a removed one leaves the list in the same commit)", () => {
    const present = new Set(images);
    expect(allowed.filter((f) => !present.has(f))).toEqual([]);
  });

  it("the list has no duplicates", () => {
    expect(allowed.length).toBe(new Set(allowed).size);
  });
});
