/*
 * GUARD (lead, 2026-10-12): the generated-files refresh bots wait while a
 * batch train is in the land queue. Bot PRs #2893 (open-auto-tick) and #2896
 * (inventories) merged under train PR #2897 and sent it DIRTY. The train
 * regenerates the same files itself, and each rebuild cost a full CI round.
 *
 * The shared .github/actions/refresh-pr action holds a refresh when
 * `hold-for-trains: "true"` is set and any open PR outside bot/refresh/**
 * carries the land-queue label: it does not open, replace or merge, and it turns
 * the bot PR's auto-merge off. Every generated-files bot sets the input.
 *
 * Red first: on origin/main's workflows, neither the input nor the hold exists.
 */
// @mutate .github/actions/refresh-pr/action.yml |             if [ "$TRAINS" -gt 0 ]; then |             if false; then
// @mutate .github/workflows/staleness-watch.yml |           hold-for-trains: "true"\n |
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The generated-files refresh bots (open-done-when ticks are left to land promptly: owner order). */
const GENERATED_BOTS = [
  "open-auto-tick.yml",
  "scoreboard.yml",
  "loading-states-refresh.yml",
  "write-contract-refresh.yml",
  "staleness-watch.yml",
];

type Step = { uses?: string; with?: Record<string, unknown> };
function refreshSteps(file: string): Step[] {
  const wf = parse(read(`.github/workflows/${file}`)) as { jobs: Record<string, { steps?: Step[] }> };
  return Object.values(wf.jobs).flatMap((j) => j.steps ?? []).filter((s) => s.uses === "./.github/actions/refresh-pr");
}

describe("refresh bots wait while a batch train is in the land queue", () => {
  it.each(GENERATED_BOTS)("%s calls refresh-pr with hold-for-trains: \"true\"", (file) => {
    const steps = refreshSteps(file);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(String(s.with?.["hold-for-trains"])).toBe("true");
  });

  it("refresh-pr declares the input and holds before it opens, replaces or merges", () => {
    const action = read(".github/actions/refresh-pr/action.yml");
    const spec = parse(action) as { inputs: Record<string, { default?: string }> };
    expect(spec.inputs["hold-for-trains"]?.default).toBe("false");
    const hold = action.indexOf('if [ "$HOLD_FOR_TRAINS" = "true" ]; then');
    expect(hold).toBeGreaterThan(-1);
    // Before the push, the PR create and the auto-merge.
    for (const later of ['bash "$PUSHER" push', "gh pr create", "--auto --squash"]) {
      expect(action.lastIndexOf(later), later).toBeGreaterThan(hold);
    }
    const block = action.slice(hold, action.indexOf("\n          fi\n", hold));
    // Counts open land-queue PRs that are not bot/refresh/** (the bots label their own PRs).
    expect(block).toMatch(/startswith\("bot\/refresh\/"\) \| not/);
    expect(block).toMatch(/\.name == "land-queue"/);
    expect(block).toContain("--disable-auto");
    expect(block).toMatch(/if \[ "\$TRAINS" -gt 0 \]; then[\s\S]*exit 0/);
  });
});
