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
 *
 * 2026-10-12 (lead): bot PR #2914 (bot/refresh/morning-page) raced the trains:
 * morning-page, ios-icon-sync and ios-metadata call refresh-pr without the
 * hold, because the list here was hand-kept. The inventory is now READ from
 * the workflows (every refresh-pr caller), minus an exact exemption list.
 */
// @mutate .github/actions/refresh-pr/action.yml |             if [ "$TRAINS" -gt 0 ]; then |             if false; then
// @mutate .github/workflows/staleness-watch.yml |           hold-for-trains: "true"\n |
// @mutate .github/workflows/morning-page.yml |           hold-for-trains: "true"\n |
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Refresh-pr callers that do NOT hold for trains, each with why. Exact both ways.
 * open-done-when: its ticks are left to land promptly (owner order).
 */
// @two-way src/test/refreshBotsWaitForTrains.test.ts:an exempt bot that no longer calls refresh-pr
const EXEMPT: Record<string, string> = {
  "open-done-when.yml": "its ticks land promptly (owner order, 2026-10-12); a train regenerates OPEN.md anyway",
};

/** Every workflow that opens a bot/refresh/** PR through the shared refresh-pr action. */
const CALLERS = readdirSync(join(ROOT, ".github/workflows"))
  .filter((f) => /\.ya?ml$/.test(f))
  .filter((f) => read(`.github/workflows/${f}`).includes("uses: ./.github/actions/refresh-pr"))
  .sort();
const GENERATED_BOTS = CALLERS.filter((f) => !(f in EXEMPT));

type Step = { uses?: string; with?: Record<string, unknown> };
function refreshSteps(file: string): Step[] {
  const wf = parse(read(`.github/workflows/${file}`)) as { jobs: Record<string, { steps?: Step[] }> };
  return Object.values(wf.jobs).flatMap((j) => j.steps ?? []).filter((s) => s.uses === "./.github/actions/refresh-pr");
}

describe("refresh bots wait while a batch train is in the land queue", () => {
  it("reads the refresh-pr callers from the workflows (inventory floor), and the exemptions are exact", () => {
    expect(CALLERS.length).toBeGreaterThan(7);
    expect(CALLERS).toEqual(expect.arrayContaining(["morning-page.yml", "staleness-watch.yml", "open-done-when.yml"]));
    expect(Object.keys(EXEMPT).filter((f) => !CALLERS.includes(f)), "an exempt bot that no longer calls refresh-pr").toEqual([]);
  });

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
