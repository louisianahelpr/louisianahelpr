// @mutate scripts/ci/main-batch.mjs |   if (last.head_sha === head) return | if (last.head_sha === "never") return
// @mutate scripts/ci/main-batch.mjs |   if (!(age >= DEBOUNCE_MS)) return | if (false) return
// @mutate scripts/ci/main-batch.mjs | && r.conclusion !== "cancelled" |
// @mutate scripts/ci/main-batch.mjs | changedFiles.length < COMPARE_FILE_CAP | true
// @mutate scripts/ci/main-batch.mjs |   if (!last) return { action: "dispatch" | if (!last) return { action: "skip"
// @mutate scripts/scoreboard.mjs | events: ["schedule", "workflow_dispatch"], skipMainBatch: true | events: ["schedule", "workflow_dispatch"]
/**
 * The main-batch dispatcher (scripts/ci/main-batch.mjs) decides when the heavy
 * non-required checks of main run, now that they no longer run per push
 * (owner, 2026-10-02: stay on GitHub Free). A wrong "skip" silently stops
 * checking main, so every unknown must dispatch (fail closed), and a "skip"
 * is only allowed for: HEAD already batched, the last batch < 15 min old, or
 * (ui-sweep) a fully-read change list with no UI file in it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BATCH_MARK,
  COMPARE_FILE_CAP,
  DEBOUNCE_MS,
  TARGETS,
  UI_PATHS,
  batchRuns,
  decide,
  matchesPaths,
} from "../../scripts/ci/main-batch.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { SUITES, suitePool } from "../../scripts/scoreboard.mjs";

const REPO = path.resolve(__dirname, "../..");
const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-10-02T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const batch = (sha: string, mins: number, conclusion: string | null = "success") => ({
  display_title: `E2E real backend ${BATCH_MARK}${sha})`,
  head_sha: sha,
  created_at: minsAgo(mins),
  conclusion,
});
const manual = (sha: string, mins: number) => ({ display_title: "E2E real backend", head_sha: sha, created_at: minsAgo(mins), conclusion: "success" });

describe("main-batch decide()", () => {
  it("dispatches when no earlier batch exists (a manual dispatch is not a batch)", () => {
    expect(decide({ head: HEAD, runs: [], now: NOW }).action).toBe("dispatch");
    expect(decide({ head: HEAD, runs: [manual(HEAD, 60)], now: NOW }).action).toBe("dispatch");
  });

  it("skips when HEAD is already batched, however old that batch is", () => {
    expect(decide({ head: HEAD, runs: [batch(HEAD, 300)], now: NOW }).action).toBe("skip");
  });

  it("skips inside the debounce window, dispatches once it has passed", () => {
    const debounceMin = DEBOUNCE_MS / 60_000;
    expect(decide({ head: HEAD, runs: [batch(OLD, debounceMin - 1)], now: NOW }).action).toBe("skip");
    expect(decide({ head: HEAD, runs: [batch(OLD, debounceMin)], now: NOW }).action).toBe("dispatch");
  });

  it("ignores a cancelled batch (it checked nothing)", () => {
    const runs = [batch(HEAD, 2, "cancelled"), batch(OLD, 40)];
    expect(decide({ head: HEAD, runs, now: NOW })).toMatchObject({ action: "dispatch", base: OLD });
  });

  it("uses the NEWEST batch regardless of API order", () => {
    const runs = [batch(OLD, 60), batch(HEAD, 5)];
    expect(decide({ head: HEAD, runs, now: NOW }).action).toBe("skip");
  });

  it("a path-filtered target skips only on a complete change list with no watched file", () => {
    const runs = [batch(OLD, 40)];
    const base = { head: HEAD, runs, now: NOW, paths: UI_PATHS };
    expect(decide({ ...base, changedFiles: ["supabase/functions/x/index.ts", "docs/OPEN.md"] }).action).toBe("skip");
    expect(decide({ ...base, changedFiles: ["docs/OPEN.md", "src/pages/home/Home.tsx"] }).action).toBe("dispatch");
    // Fail closed on every unknown.
    expect(decide({ ...base, changedFiles: null }).action).toBe("dispatch");
    expect(decide({ ...base, changedFiles: [] }).action).toBe("dispatch");
    const truncated = Array.from({ length: COMPARE_FILE_CAP }, (_, i) => `docs/f${i}.md`);
    expect(decide({ ...base, changedFiles: truncated }).action).toBe("dispatch");
  });

  it("a target without paths dispatches for any new HEAD, whatever changed", () => {
    expect(decide({ head: HEAD, runs: [batch(OLD, 40)], now: NOW, paths: [], changedFiles: ["docs/OPEN.md"] }).action).toBe("dispatch");
  });
});

describe("main-batch helpers", () => {
  it("matchesPaths handles dir/** prefixes and exact files only", () => {
    expect(matchesPaths("src/a/b.tsx", ["src/**"])).toBe(true);
    expect(matchesPaths("srcx/a.ts", ["src/**"])).toBe(false);
    expect(matchesPaths("index.html", ["index.html"])).toBe(true);
    expect(matchesPaths("public/index.html", ["index.html"])).toBe(false);
  });

  it("batchRuns keeps only marked, non-cancelled runs, newest first", () => {
    const out = batchRuns([manual(HEAD, 1), batch(OLD, 50), batch(HEAD, 10), batch(HEAD, 3, "cancelled")]);
    expect(out.map((r: { created_at: string }) => r.created_at)).toEqual([minsAgo(10), minsAgo(50)]);
  });

  it("UI_PATHS is the list ui-sweep's in-job paths-filter used (moved, not narrowed)", () => {
    expect(UI_PATHS).toEqual([
      "src/**",
      "public/**",
      "index.html",
      "vite.config.ts",
      "tailwind.config.ts",
      "package.json",
      "package-lock.json",
      "playwright.config.ts",
      "e2e/happy-path/**",
      ".github/workflows/ui-sweep.yml",
    ]);
  });
});

describe("main-batch wiring", () => {
  it("every target titles its batch runs with the marker the dispatcher, main-red-watch and the account lock look for", () => {
    for (const t of TARGETS) {
      const src = readFileSync(path.join(REPO, ".github/workflows", t.file), "utf8");
      const runName = src.match(/^run-name: (.*)$/m)?.[1] ?? "";
      expect(runName, t.file).toContain(`format('{0} ${BATCH_MARK}{1})', github.workflow, github.sha)`);
      expect(runName, t.file).toContain("inputs.batch");
    }
  });

  it("the account-lock scripts use the same marker", () => {
    for (const f of ["scripts/e2e/wait-shared-accounts.mjs", "scripts/canary/shared-accounts-busy.mjs"]) {
      expect(readFileSync(path.join(REPO, f), "utf8"), f).toContain(`"${BATCH_MARK}"`);
    }
  });
});

describe("SCOREBOARD reads e2e-real-backend specs from a spec run, not a main batch", () => {
  it("a newer main batch (anon tier, no spec summary) does not decide the row", () => {
    const s = SUITES.find((x: { workflow: string }) => x.workflow === "e2e-real-backend.yml");
    const runs = [
      { id: 2, event: "workflow_dispatch", title: `E2E real backend ${BATCH_MARK}${HEAD})`, conclusion: "success" },
      { id: 1, event: "schedule", title: "E2E real backend", conclusion: "failure" },
    ];
    expect(suitePool(s, runs).map((r: { id: number }) => r.id)).toEqual([1]);
  });
});
