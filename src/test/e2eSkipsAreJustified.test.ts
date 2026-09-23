/*
 * CLASS GUARD: a skipped Playwright test must not read as a passed one.
 *
 * Owner, 2026-09-23 (docs/OPEN.md Q52): "nothing is a false positive or going
 * green if it's not truly green." That night the nightly prod-audit skipped 17
 * tests — among them the double-apply race in
 * e2e/prod-audit/interruptions.spec.ts — because a prod fixture was missing,
 * and the run was GREEN. Every CI invocation passed `--reporter=list`, which
 * prints a skip as a grey dash and exits 0.
 *
 * The fix has three parts, and this file holds each of them to account:
 *   1. e2e/skipSites.ts        — every skip site under e2e/, found from source
 *   2. e2e/skipAllowlist.ts    — a verdict per site: `justified` (the test does
 *                                not apply by design) or `failure`
 *   3. e2e/reporters/skipReporter.ts — reports every skip, FAILS the run on any
 *                                skip that is not at a justified site
 * and the reporter must actually be in play wherever CI runs Playwright: a CLI
 * `--reporter` flag REPLACES the config's reporter list.
 */
// @mutate e2e/skipAllowlist.ts | match: "RUN_APPSTORE_SHOTS", | match: "RUN_APPSTORE_SHOTS_GONE",
// @mutate e2e/reporters/skipReporter.ts | return { status: "failed" }; | return undefined;
// @mutate e2e/skipSites.ts | const ALIAS = /\bconst | const ALIAS = /\bconst_never_matches
// @mutate playwright.config.ts | ? [["list"], ["./e2e/reporters/skipReporter.ts"]] | ? [["list"]]
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { allSkipSites } from "../../e2e/skipSites";
import { SKIP_ALLOWLIST, entriesFor } from "../../e2e/skipAllowlist";
import SkipReporter from "../../e2e/reporters/skipReporter";

const ROOT = resolve(__dirname, "..", "..");
const sites = allSkipSites(ROOT);

describe("every e2e skip is justified or fails the run", () => {
  it("found the skip sites from source (cannot pass vacuously)", () => {
    // 63 on 2026-09-23. A floor, not an exact count: sites come and go with specs.
    expect(sites.length).toBeGreaterThan(50);
    // Each kind of site the scanner claims to find is actually found.
    expect(sites.some((s) => s.text.startsWith("sweepDescribe("))).toBe(true); // aliased describe.skip
    expect(sites.some((s) => s.file === "e2e/journeys/fixtures.ts")).toBe(true); // skip inside a helper
    expect(sites.some((s) => s.text === "test.skip(...args)")).toBe(true); // static skip via wrapper
  });

  it("every skip site has exactly one verdict in e2e/skipAllowlist.ts", () => {
    const bad = sites
      .map((s) => ({ s, n: entriesFor(s.file, s.text).length }))
      .filter((x) => x.n !== 1)
      .map((x) => `${x.s.file}:${x.s.line} (${x.n} entries) ${x.s.text.slice(0, 100)}`);
    expect(
      bad,
      "A skip reports GREEN. Give each new skip site an entry in e2e/skipAllowlist.ts: `justified` only if the " +
        "test truly does not apply to the run by design; a missing fixture/credential/upstream state is `failure`:\n  " +
        bad.join("\n  "),
    ).toEqual([]);
  });

  it("every allowlist entry still matches a skip site, with a real reason (two-way)", () => {
    const stale = SKIP_ALLOWLIST.filter(
      (e) => !sites.some((s) => entriesFor(s.file, s.text).includes(e)),
    ).map((e) => `${e.file} :: ${e.match}`);
    expect(stale, `entries that match no skip site — remove them:\n  ${stale.join("\n  ")}`).toEqual([]);
    for (const e of SKIP_ALLOWLIST) expect(e.why.length, `${e.file} :: ${e.match} needs a real reason`).toBeGreaterThan(30);
  });

  it("the reporter FAILS a passing run that skipped at a failure site, and passes one skipped at a justified site", async () => {
    const at = (file: string, pick: (t: string) => boolean) => {
      const s = sites.find((x) => x.file === file && pick(x.text));
      if (!s) throw new Error(`no site in ${file}`);
      return { file: join(ROOT, s.file), line: s.line };
    };
    const fakeTest = (loc: { file: string; line: number } | undefined, description = "r") => ({
      outcome: () => "skipped",
      annotations: loc ? [{ type: "skip", description, location: loc }] : [],
      results: [],
      location: { file: join(ROOT, "e2e/x.spec.ts"), line: 1, column: 1 },
      titlePath: () => ["", "p", "x.spec.ts", "t"],
    });
    const run = async (tests: unknown[]) => {
      const r = new SkipReporter();
      r.onBegin({} as never, { allTests: () => tests } as never);
      return await r.onEnd({ status: "passed" } as never);
    };
    // The 2026-09-23 case: a GAP skip in prod-audit.
    const gap = at("e2e/prod-audit/interruptions.spec.ts", (t) => t.includes("GAP:"));
    expect(await run([fakeTest(gap)])).toEqual({ status: "failed" });
    // A skip at no known site, and a test that never ran with no skip call.
    expect(await run([fakeTest({ file: join(ROOT, "e2e/prod-audit/interruptions.spec.ts"), line: 1 })])).toEqual({ status: "failed" });
    expect(await run([fakeTest(undefined)])).toEqual({ status: "failed" });
    // A justified skip leaves a passing run alone.
    const pinned = at("e2e/journeys/01-browse.spec.ts", (t) => t.includes("SCENARIO pins another scenario"));
    expect(await run([fakeTest(pinned)])).toBeUndefined();
  });

  it("the Playwright config runs the skip reporter in CI and locally", () => {
    const cfg = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
    const reporterExpr = /\n\s*reporter:([\s\S]*?)\n\s*use:/.exec(cfg)?.[1] ?? "";
    const ci = /process\.env\.CI\s*\?([\s\S]*?)\n\s*:/.exec(reporterExpr)?.[1] ?? "";
    expect(ci, "CI branch of playwright.config.ts `reporter:`").toContain("./e2e/reporters/skipReporter.ts");
    expect(reporterExpr.split("./e2e/reporters/skipReporter.ts").length - 1).toBe(2);
  });

  it("every `playwright test` in a workflow keeps the skip reporter (a --reporter flag replaces the config's)", () => {
    const dir = join(ROOT, ".github", "workflows");
    const calls: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
      readFileSync(join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/^\s*#/.test(line) || !/\bplaywright test\b/.test(line)) return;
        calls.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(calls.length).toBeGreaterThan(8);
    const dropped = calls.filter((c) => /--reporter[= ]/.test(c) && !c.includes("skipReporter"));
    expect(
      dropped,
      "These pass --reporter without the skip reporter, so a skipped test exits 0. Use " +
        "--reporter=list,./e2e/reporters/skipReporter.ts:\n  " + dropped.join("\n  "),
    ).toEqual([]);
  });
});
