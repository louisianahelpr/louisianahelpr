/**
 * Every e2e guard the vacuity gate mutates runs under a playwright project
 * that actually RUNS it.
 *
 * scripts/vacuity/run.mjs picked the project from a hand list of four dirs
 * and sent every other spec to "chromium", whose testIgnore drops
 * job-status-fixtures, canary and privacy. Those guards came back "No tests
 * found": a red baseline, INCONCLUSIVE, and Vacuity red on main (the
 * accepted-fixture guard, nightly-red #1794 follow-up). The project now comes
 * from playwright.config.ts itself; this checks the whole class from the
 * inventory of registered e2e specs.
 *
 * @mutate scripts/vacuity/run.mjs |   projects.find((p) => rel.startsWith(p.dir + "/"))?.name ?? "chromium"; |   "chromium";
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import { projectsFromConfig as rawProjects, pwProjectFor as rawFor } from "../../scripts/vacuity/run.mjs";

type Project = { name: string; dir: string };
const projectsFromConfig = rawProjects as (src: string) => Project[];
const pwProjectFor = rawFor as (rel: string, projects: Project[]) => string;

const ROOT = resolve(__dirname, "../..");
const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");

function specs(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const abs = join(dir, f);
    if (statSync(abs).isDirectory()) return specs(abs);
    return /\.spec\.ts$/.test(f) ? [relative(ROOT, abs)] : [];
  });
}

const registered = specs(join(ROOT, "e2e")).filter((f) => /@mutate /.test(readFileSync(join(ROOT, f), "utf8")));
const chromiumIgnore = (() => {
  const m = /name:\s*"chromium",[\s\S]*?testIgnore:\s*\/(.+)\/,/.exec(config);
  if (!m) throw new Error("chromium project has no testIgnore regex in playwright.config.ts");
  return new RegExp(m[1]);
})();

describe("vacuity: each mutated e2e spec runs under a project that runs it", () => {
  const projects = projectsFromConfig(config);

  it("reads the project dirs from the config", () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(projects.map((p) => p.name)).toContain("job-status-fixtures");
  });

  it.each(registered)("%s", (spec) => {
    const name = pwProjectFor(spec, projects);
    if (name === "chromium") {
      expect(chromiumIgnore.test(spec), `${spec} goes to chromium, which ignores it`).toBe(false);
    } else {
      const p = projects.find((q) => q.name === name)!;
      expect(spec.startsWith(p.dir + "/")).toBe(true);
    }
  });
});
