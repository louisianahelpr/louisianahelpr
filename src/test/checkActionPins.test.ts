/**
 * Q1354: scripts/check-action-pins.mjs fails when a pinned Action SHA is not
 * the commit its `# vX.Y.Z` comment names, and the nightly workflow runs it.
 *
 * Live (2026-10-07, gh api): 341 pinned `uses:` lines, 15 distinct tags, every
 * SHA its tag's commit; `--inject-mismatch` (one SHA flipped in memory) exits 1
 * naming the line. Here the pure parts run against a stub resolver, and the
 * workflow wiring is read from the YAML.
 *
 * @mutate scripts/check-action-pins.mjs |     else if (got.sha !== p.sha) failures.push( |     else if (false) failures.push(
 * @mutate scripts/check-action-pins.mjs |     if (got.error) failures.push( |     if (false) failures.push(
 * @mutate .github/workflows/code-scanning-alerts.yml |         run: node scripts/check-action-pins.mjs | run: echo skipped
 * @mutate .github/workflows/code-scanning-alerts.yml |     needs: [check, action-pins] |     needs: [check]
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { pinsFromText, verifyPins, repoPins, type ActionPin as Pin } from "../../scripts/check-action-pins.mjs";
const ROOT = join(__dirname, "..", "..");
const SHA_A = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const SHA_B = "820762786026740c76f36085b0efc47a31fe5020";

describe("Q1354: pinned Action SHAs are checked against their tags", () => {
  it("inventory: the repo's pins parse (floor), none unparseable", () => {
    const pins: Pin[] = repoPins(ROOT);
    expect(pins.length).toBeGreaterThan(300);
    expect(pins.filter((p) => p.problem)).toEqual([]);
    expect(new Set(pins.map((p) => `${p.repo}@${p.tag}`)).size).toBeGreaterThan(10);
  });

  it("parses owner/repo out of a sub-path action and skips local and docker refs", () => {
    const text = [
      `      - uses: github/codeql-action/upload-sarif@${SHA_A} # v4.1.0`,
      "      - uses: ./.github/actions/nightly-issue-sync",
      "      - uses: docker://alpine@sha256:abc",
      "      - uses: actions/checkout@v4",
    ].join("\n");
    const pins: Pin[] = pinsFromText("w.yml", text);
    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({ repo: "github/codeql-action", sha: SHA_A, tag: "v4.1.0", line: 1 });
    expect(pins[1]).toMatchObject({ action: "actions/checkout@v4", line: 4 });
    expect(pins[1].problem).toBeTruthy();
  });

  it("a SHA that is not its tag's commit fails; an unresolvable tag fails; a match passes", async () => {
    const pins = pinsFromText(
      "w.yml",
      [
        `- uses: actions/checkout@${SHA_A} # v7.0.1`,
        `- uses: actions/setup-node@${SHA_A} # v7.0.0`,
        `- uses: gone/action@${SHA_B} # v1.0.0`,
      ].join("\n"),
    );
    const tags: Record<string, string> = { "actions/checkout@v7.0.1": SHA_A, "actions/setup-node@v7.0.0": SHA_B };
    const failures = await verifyPins(pins, async (repo, tag) => {
      const sha = tags[`${repo}@${tag}`];
      if (!sha) throw new Error("HTTP 404");
      return sha;
    });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/w\.yml:2 actions\/setup-node: pinned 3d3c.* but v7\.0\.0 is 8207/);
    expect(failures[1]).toMatch(/w\.yml:3 gone\/action: tag v1\.0\.0 did not resolve \(HTTP 404\)/);
  });

  it("the nightly workflow runs it and its red reaches the nightly-red issue", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/code-scanning-alerts.yml"), "utf8"));
    expect(wf.on.schedule?.length).toBeGreaterThan(0);
    const steps: { run?: string; env?: Record<string, string> }[] = wf.jobs["action-pins"].steps;
    const run = steps.find((s) => s.run?.includes("scripts/check-action-pins.mjs"));
    expect(run?.run?.trim()).toBe("node scripts/check-action-pins.mjs");
    expect(run?.env?.GH_TOKEN).toBeTruthy();
    expect(wf.jobs.notify.needs).toContain("action-pins");
    expect(String(wf.jobs.notify.steps.find((s: { with?: { status?: string } }) => s.with?.status)?.with?.status)).toMatch(/needs\['action-pins'\]\.result == 'success'/);
  });
});
