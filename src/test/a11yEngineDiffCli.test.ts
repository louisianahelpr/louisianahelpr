import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The a11y-webkit-prod "WebKit-only violations" job could not pass, and nobody
 * read the red.
 *
 * 2026-09-19: `nightly-red: a11y-webkit-prod` (#1597) had been open since
 * 2026-09-14 with five "Still red" comments. BOTH sweep legs were green every
 * time; the diff job died in 2 seconds on
 *
 *     usage: a11y-engine-diff.mjs <chromium-report.json> <webkit-report.json> …
 *     ##[error]Process completed with exit code 2
 *
 * because scripts/audit/a11y-engine-diff.mjs computed its positional arguments
 * as `args.filter((a) => !a.startsWith("--"))`. The workflow passes
 * `--out webkit-only.json`; `webkit-only.json` does not start with `--`, so it
 * counted as a THIRD report path and the script printed its usage and exited 2.
 * Five nights of real WebKit-vs-Chromium a11y evidence was captured, uploaded,
 * and never compared — and a11y-webkit-prod is a REQUIRED release check
 * (scripts/release-gate.mjs keys on this workflow name and this job name).
 *
 * THE CLASS, not the instance: any value-taking flag whose value is mistaken
 * for a positional. This test does not hard-code the command line — it READS
 * the workflow, extracts the exact `node scripts/audit/a11y-engine-diff.mjs …`
 * invocation CI runs, substitutes the shell variables with real fixture
 * reports, and runs it. Add a flag to the workflow without teaching the script
 * to parse it and this goes red on the spot.
 *
 * Exit codes of the script under test: 0 = no WebKit-only finding, 1 = fresh
 * WebKit-only findings, 2 = a report is missing/unreadable or the two reports
 * cover different screens. **2 on a well-formed pair is the bug** — it is the
 * "could not run" code, and CI cannot tell it apart from a broken argument
 * list without this test.
 */

const ROOT = resolve(__dirname, "../..");
const WORKFLOW = join(ROOT, ".github/workflows/a11y-webkit-prod.yml");
const SCRIPT = join(ROOT, "scripts/audit/a11y-engine-diff.mjs");

/** One well-formed sweep report row: the same screen, clean, on both engines. */
function report(): string {
  return JSON.stringify({
    screens: [
      { name: "/browse", variant: "guest", status: "ok", topViolations: [], contrastFailures: [], layout: { overflowPx: 0 } },
      { name: "/home", variant: "helper", status: "ok", topViolations: [], contrastFailures: [], layout: { overflowPx: 0 } },
    ],
  });
}

/**
 * The argument list the workflow actually hands the script, with `$C` / `$W`
 * (shell variables holding the two downloaded report paths) resolved to the
 * fixture files and any output path pointed into the temp dir.
 */
export function ciArgsFrom(workflowYaml: string, chromium: string, webkit: string, dir: string): string[] {
  const line = workflowYaml.split("\n").find((l) => l.includes("node scripts/audit/a11y-engine-diff.mjs"));
  if (!line) throw new Error("a11y-webkit-prod.yml no longer invokes scripts/audit/a11y-engine-diff.mjs");
  // Everything after the shell pipe belongs to `tee`, not to node.
  const command = line.trim().split("|")[0];
  const argv = command.replace(/^node\s+\S+\s*/, "").split(/\s+/).filter(Boolean);
  return argv.map((a) => {
    const bare = a.replace(/^"|"$/g, "");
    if (bare === "$C" || bare === "${C}") return chromium;
    if (bare === "$W" || bare === "${W}") return webkit;
    if (bare.endsWith(".json") && !bare.startsWith("--")) return join(dir, bare);
    return bare;
  });
}

// @mutate scripts/audit/a11y-engine-diff.mjs | const VALUE_FLAGS = new Set(["--known", "--out"]); | const VALUE_FLAGS = new Set([]);
// @mutate scripts/audit/a11y-engine-diff.mjs | if (VALUE_FLAGS.has(a)) i++; // skip its value | if (false) i++; // skip its value

describe("a11y-engine-diff parses the command line a11y-webkit-prod actually runs", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  it("the workflow still drives this script (the guard is pointed at something real)", () => {
    expect(yaml).toContain("node scripts/audit/a11y-engine-diff.mjs");
    expect(yaml).toContain("name: WebKit-only violations");
  });

  it("runs to a verdict — never exit 2 — on the workflow's own argument list", () => {
    const dir = mkdtempSync(join(tmpdir(), "a11y-diff-"));
    const c = join(dir, "chromium.json");
    const w = join(dir, "webkit.json");
    writeFileSync(c, report());
    writeFileSync(w, report());

    const args = ciArgsFrom(yaml, c, w, dir);
    // Sanity: the list CI runs really does carry a value-taking flag, or this
    // test proves nothing about the class.
    expect(args.some((a) => a.startsWith("--")), "the workflow passes no flags — this guard would be vacuous").toBe(true);

    let status = 0;
    let out: string;
    try {
      out = execFileSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? 1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(out, "the script printed its usage — an option VALUE was counted as a report path").not.toContain("usage:");
    expect(status, `exit 2 means "could not run", not a verdict:\n${out}`).not.toBe(2);
    expect(status).toBe(0);
  });

  it("every value-taking flag the script documents is declared in VALUE_FLAGS", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const declared = new Set([...(src.match(/const VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/"(--[a-z-]+)"/g)].map((m) => m[1]));
    // `opt("--x")` reads the NEXT argv entry, so every opt() call site is by
    // definition a value-taking flag.
    const valueTaking = [...src.matchAll(/\bopt\("(--[a-z-]+)"\)/g)].map((m) => m[1]);
    expect(valueTaking.length).toBeGreaterThan(0);
    for (const f of valueTaking) {
      expect(declared.has(f), `${f} takes a value but is not in VALUE_FLAGS — its value will be read as a report path`).toBe(true);
    }
  });
});
