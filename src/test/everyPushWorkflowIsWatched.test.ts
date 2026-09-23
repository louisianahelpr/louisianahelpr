/*
 * CLASS GUARD: a push-on-main workflow that fails must land somewhere a person
 * will see.
 *
 * 2026-09-23: Vitest sat red on main for ~11 hours across ~30 pushes; nobody
 * saw it, because push failures reported nowhere but the commit's checks.
 * .github/workflows/main-red-watch.yml now files a `nightly-red` issue (and a
 * Slack post when it is new) for each watched workflow. This reads every
 * workflow file, so the NEXT push workflow cannot ship unwatched, and a
 * renamed one cannot silently drop off the list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DIR = join(__dirname, "..", "..", ".github", "workflows");
const WATCHER = "main-red-watch.yml";
// It IS the alarm: it fails by design while a red is open. Watching it loops.
const NOT_WATCHED = new Set(["Nightly reds nobody read"]);

type Wf = { file: string; name: string; on: Record<string, unknown> };
const workflows: Wf[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((file) => {
    const d = parse(readFileSync(join(DIR, file), "utf8")) as Record<string | number, unknown>;
    const on = (d.on ?? d[1] ?? d["true"]) as unknown;
    return { file, name: String(d.name ?? file), on: on && typeof on === "object" ? (on as Record<string, unknown>) : {} };
  });

function pushesToMain(w: Wf): boolean {
  if (!("push" in w.on)) return false;
  const branches = (w.on.push as { branches?: string[] } | null)?.branches;
  return !branches || branches.includes("main");
}

export function unwatched(all: Wf[], watchedNames: string[]): string[] {
  const watched = new Set(watchedNames);
  return all
    .filter((w) => w.file !== WATCHER && pushesToMain(w) && !NOT_WATCHED.has(w.name) && !watched.has(w.name))
    .map((w) => `${w.file} ("${w.name}")`);
}

const watcher = workflows.find((w) => w.file === WATCHER)!;
const watchedNames = ((watcher.on.workflow_run as { workflows?: string[] })?.workflows ?? []) as string[];

describe("every push-on-main workflow is watched by main-red-watch", () => {
  it("the inventory is real", () => {
    expect(workflows.filter(pushesToMain).length).toBeGreaterThanOrEqual(10);
    expect(watchedNames.length).toBeGreaterThanOrEqual(10);
  });

  it("no push-on-main workflow is missing from the watch list", () => {
    expect(unwatched(workflows, watchedNames)).toEqual([]);
  });

  it("every watched name is a real workflow (a rename would silently unwatch it)", () => {
    const names = new Set(workflows.map((w) => w.name));
    expect(watchedNames.filter((n) => !names.has(n))).toEqual([]);
  });

  it("is RED when a push workflow is dropped from the list", () => {
    expect(unwatched(workflows, watchedNames.filter((n) => n !== "Vitest"))).toEqual(['vitest.yml ("Vitest")']);
  });
});
