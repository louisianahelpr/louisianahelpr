/**
 * A skipped test is not a passed test. This reporter makes every skip VISIBLE
 * and makes an unjustified one FAIL THE RUN (docs/OPEN.md Q52, owner
 * 2026-09-23: "nothing is a false positive or going green if it's not truly
 * green"). On 2026-09-23 the nightly prod-audit skipped 17 tests for missing
 * prod fixtures and reported green.
 *
 * Additive: it prints nothing per test, so run it NEXT TO the normal reporter:
 *   npx playwright test … --reporter=list,./e2e/reporters/skipReporter.ts
 * A `--reporter` flag REPLACES the config's reporters, so every CI invocation
 * must name this one too; src/test/e2eSkipsAreJustified.test.ts checks that.
 *
 * How a skip is judged: Playwright stamps each skip/fixme annotation with the
 * file:line of the call that made it. That line is looked up among the skip
 * sites found from source (e2e/skipSites.ts) and its verdict read from
 * e2e/skipAllowlist.ts. Only `justified` passes. A skip with no location, at an
 * unknown site, or at a `failure` site fails the run. A test skipped with NO
 * skip annotation (serial-mode tests after an earlier failure, or a run cut
 * short by maxFailures) is also a failure: it did not run.
 */
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sitesInSource, toRepoPath, type SkipSite } from "../skipSites";
import { entriesFor } from "../skipAllowlist";

interface Judged {
  test: string;
  where: string;
  reason: string;
  verdict: "justified" | "failure";
  why: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function judgeSkip(
  annotations: { type: string; description?: string; location?: { file: string; line: number } }[],
  sitesOf: (file: string) => SkipSite[],
  anyFailure: boolean,
): Omit<Judged, "test"> {
  const ann = annotations.find((a) => a.type === "skip" || a.type === "fixme");
  if (!ann) {
    return {
      where: "(no skip annotation)",
      reason: "",
      verdict: "failure",
      why: anyFailure
        ? "not run: an earlier test in its serial group failed (that failure already reds the run)"
        : "skipped with no skip call — the test never ran (maxFailures, interruption, or a harness bug)",
    };
  }
  const reason = ann.description ?? "";
  if (!ann.location) {
    return { where: "(no location)", reason, verdict: "failure", why: "skip carries no source location, so it cannot be matched to a justified site" };
  }
  const file = toRepoPath(REPO_ROOT, ann.location.file);
  const site = sitesOf(file).find((s) => s.line === ann.location!.line);
  const where = `${file}:${ann.location.line}`;
  if (!site) return { where, reason, verdict: "failure", why: "not a known skip site (e2e/skipSites.ts found no skip call on this line)" };
  const entries = entriesFor(file, site.text);
  if (entries.length !== 1) {
    return { where, reason, verdict: "failure", why: entries.length ? "ambiguous: several allowlist entries match this site" : "no entry in e2e/skipAllowlist.ts" };
  }
  return { where, reason, verdict: entries[0].verdict, why: entries[0].why };
}

export default class SkipReporter implements Reporter {
  private root?: Suite;
  private cache = new Map<string, SkipSite[]>();

  onBegin(_config: FullConfig, suite: Suite) {
    this.root = suite;
  }

  private sitesOf = (file: string): SkipSite[] => {
    let s = this.cache.get(file);
    if (!s) {
      try {
        s = sitesInSource(file, readFileSync(resolve(REPO_ROOT, file), "utf8"));
      } catch {
        // Unreadable file: no sites, so every skip in it is judged "not a
        // known skip site" and FAILS the run — the safe direction.
        s = [];
      }
      this.cache.set(file, s);
    }
    return s;
  };

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | undefined> {
    const tests: TestCase[] = this.root?.allTests() ?? [];
    const anyFailure = tests.some((t) => t.outcome() === "unexpected");
    const judged: Judged[] = tests
      .filter((t) => t.outcome() === "skipped")
      .map((t) => {
        const last = t.results[t.results.length - 1];
        const anns = [...t.annotations, ...(last?.annotations ?? [])];
        return { test: `${toRepoPath(REPO_ROOT, t.location.file)} › ${t.titlePath().slice(3).join(" › ")}`, ...judgeSkip(anns, this.sitesOf, anyFailure) };
      });
    const bad = judged.filter((j) => j.verdict === "failure");
    const ok = judged.length - bad.length;

    const lines = [
      `SKIPPED: ${judged.length} (${ok} justified, ${bad.length} UNJUSTIFIED — each counts as a failure)`,
      ...judged.map((j) => `  ${j.verdict === "failure" ? "✗ UNJUSTIFIED" : "· justified  "} ${j.test}\n      at ${j.where}${j.reason ? ` — "${j.reason}"` : ""}\n      ${j.why}`),
    ];
    console.log("\n" + lines.join("\n"));

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const md = [
        `### Playwright skips: ${judged.length} (${ok} justified, **${bad.length} unjustified = failure**)`,
        "",
        ...(judged.length ? ["| verdict | test | site | reason |", "|---|---|---|---|"] : []),
        ...judged.map((j) => `| ${j.verdict === "failure" ? "**FAIL**" : "justified"} | ${j.test.replace(/\|/g, "\\|")} | ${j.where} | ${(j.reason || j.why).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
        "",
      ].join("\n");
      try {
        appendFileSync(summary, md + "\n");
      } catch {
        /* the console block above still lands in the log */
      }
    }

    if (bad.length && result.status === "passed") {
      console.log(`FAIL: ${bad.length} test(s) skipped without a justified reason (e2e/skipAllowlist.ts). A skip is not a pass.`);
      return { status: "failed" };
    }
    return undefined;
  }

  printsToStdio() {
    return false;
  }
}
