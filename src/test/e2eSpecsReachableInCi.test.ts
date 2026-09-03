import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every Playwright spec in this repo must be RUN by some CI job — or be
 * listed below with a reason.
 *
 * WHAT THIS CATCHES
 * -----------------
 * A spec file that exists, typechecks, passes review, and is executed by
 * nothing. It is the most expensive kind of dead code, because unlike dead
 * code it actively misleads: the journey looks covered, the file is right
 * there with assertions in it, and the coverage is zero.
 *
 * Measured 2026-09-03: of the nine spec files Playwright resolves into the
 * `chromium` project, exactly ONE (mobile-viewports.spec.ts) was named by a
 * workflow. `e2e-happy-path.yml` runs `--project=happy-path`, `ui-sweep.yml`
 * and `a11y-axe.yml` likewise, and `mobile-viewports.yml` names a single
 * file by path. So `payment-lifecycle.spec.ts` and
 * `two-role-lifecycle.spec.ts` — the two specs that exist SPECIFICALLY to
 * cover escrow, accept, and the two-role handoff — ran on no push, ever.
 *
 * WHY IT IS SHAPED THIS WAY
 * -------------------------
 * Both sides are derived from the world, never declared twice:
 *   - the spec list comes from the filesystem;
 *   - the CI list comes from parsing the workflow files for the actual
 *     commands they run, resolved through playwright.config.ts's own
 *     project definitions.
 * A list that is both a test's input and its definition of correctness
 * cannot fail for a missing member — that mistake has been made three times
 * in this repo. The only hand-written list here is the exemption list, and
 * that one is supposed to be hand-written: it is the diff where someone
 * says out loud that a journey is not covered.
 */

const REPO = resolve(__dirname, "../..");
const E2E = join(REPO, "e2e");
const WORKFLOWS = join(REPO, ".github/workflows");

/**
 * Specs deliberately not run by any CI job. Each entry must say WHY, and
 * "why" has to be a real constraint, not "we didn't get to it".
 *
 * Adding a line here is the point: it turns a silent gap into a reviewed
 * one. Removing a spec's coverage without adding a line reds this test.
 */
const NOT_RUN_IN_CI: Record<string, string> = {
  "two-role-lifecycle.spec.ts":
    "Needs two seeded real accounts plus an ACCEPTED job scheduled inside the " +
    "day-of window (PLAYWRIGHT_TWO_ROLE, PLAYWRIGHT_POSTER_SESSION, " +
    "PLAYWRIGHT_HELPER_SESSION, PLAYWRIGHT_LIFECYCLE_JOB_ID). The state cannot " +
    "be minted in CI without writing to the production database. Operator-run; " +
    "see scripts/e2e/README.md.",
  "payment-lifecycle.spec.ts":
    "Its authenticated half needs PLAYWRIGHT_TEST_USER_* against the deployed " +
    "site. Its public half needs no credentials and COULD run in CI, but it " +
    "asserts against production over the network on every push, which makes it " +
    "flaky by construction (a red run during a Vercel deploy means nothing). " +
    "Wiring it needs a decision about whether CI may depend on prod being up.",
  "auth.spec.ts": "Needs PLAYWRIGHT_TEST_USER_* credentials for a real account on the deployed site.",
  "post-and-apply.spec.ts": "Needs real credentials and writes a job to the live database.",
  "smoke.spec.ts": "Points at the deployed site; superseded in CI by the mocked happy-path suite.",
  "a11y.spec.ts": "Deployed-site axe run; a11y-axe.yml covers the same routes against the local preview build.",
  "visual-audit/desktop-fill.spec.ts": "Deployed-site visual audit; ui-sweep.yml covers the same ground locally.",
  "visual-audit/responsive.spec.ts": "Deployed-site visual audit; ui-sweep.yml covers the same ground locally.",
};

/** Every *.spec.ts under e2e/, as paths relative to e2e/. */
function allSpecs(dir = E2E, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...allSpecs(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".spec.ts")) out.push(rel);
  }
  return out.sort();
}

/**
 * The Playwright commands CI actually runs, with `npm run` aliases resolved
 * through package.json. Returns the raw command strings.
 */
function ciPlaywrightCommands(): { workflow: string; command: string }[] {
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(join(REPO, "package.json"), "utf8"),
  ).scripts;

  const found: { workflow: string; command: string }[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
    for (const rawLine of readFileSync(join(WORKFLOWS, file), "utf8").split("\n")) {
      const line = rawLine.trim();
      // Comments describe commands; they do not run them.
      if (line.startsWith("#")) continue;

      if (/(^|\s|`)(npx\s+)?playwright\s+test\b/.test(line)) {
        found.push({ workflow: file, command: line });
        continue;
      }
      const npmRun = /npm\s+run\s+([a-zA-Z0-9:_-]+)/.exec(line);
      if (npmRun && scripts[npmRun[1]] && /playwright\s+test\b/.test(scripts[npmRun[1]])) {
        found.push({ workflow: file, command: scripts[npmRun[1]] });
      }
    }
  }
  return found;
}

/** Project definitions, read from the real config rather than restated. */
function playwrightProjects(): { name: string; testDir: string; testIgnore?: RegExp }[] {
  const src = readFileSync(join(REPO, "playwright.config.ts"), "utf8");
  const projects: { name: string; testDir: string; testIgnore?: RegExp }[] = [];
  // The config is TypeScript with a runtime executablePath probe, so it is
  // read rather than imported. Only the three fields that decide which files
  // a project matches are extracted, and the extraction is verified against
  // Playwright's own answer in the first test below.
  const block = /\{\s*name:\s*"([^"]+)",([\s\S]*?)\n {4}\},/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(src)) !== null) {
    const [, name, body] = m;
    const dir = /testDir:\s*"([^"]+)"/.exec(body);
    // The body of a regex literal, allowing escaped slashes — the real value
    // is /happy-path\//, which a naive [^/]+ truncates to "happy-path\".
    const ignore = /testIgnore:\s*\/((?:[^/\\]|\\.)+)\//.exec(body);
    projects.push({
      name,
      testDir: (dir?.[1] ?? "./e2e").replace(/^\.\//, "").replace(/^e2e\/?/, ""),
      testIgnore: ignore ? new RegExp(ignore[1]) : undefined,
    });
  }
  return projects;
}

/** Specs a given project would collect. */
function specsInProject(p: { testDir: string; testIgnore?: RegExp }, specs: string[]): string[] {
  return specs.filter((s) => {
    if (p.testDir && !s.startsWith(`${p.testDir}/`)) return false;
    if (p.testIgnore && p.testIgnore.test(s)) return false;
    return true;
  });
}

const specs = allSpecs();
const projects = playwrightProjects();
const commands = ciPlaywrightCommands();

/** Specs reachable by at least one CI command. */
function reachableSpecs(): Map<string, string[]> {
  const reach = new Map<string, string[]>();
  for (const { workflow, command } of commands) {
    const projFlag = /--project[= ]([a-zA-Z0-9_-]+)/.exec(command);
    const selected = projFlag ? projects.filter((p) => p.name === projFlag[1]) : projects;

    // Positional filters: Playwright matches them as substrings/regexes of
    // the file path. A shell variable ($SPECS) cannot be resolved here, and
    // is deliberately treated as matching NOTHING — over-crediting coverage
    // is the failure mode this test exists to prevent.
    const filters = command
      .replace(/^.*playwright\s+test\b/, "")
      .split(/\s+/)
      .filter((t) => t && !t.startsWith("-") && !t.includes("$"));

    for (const p of selected) {
      for (const s of specsInProject(p, specs)) {
        if (filters.length > 0 && !filters.some((f) => s.includes(f.replace(/^e2e\//, "")))) continue;
        reach.set(s, [...(reach.get(s) ?? []), workflow]);
      }
    }
  }
  return reach;
}

describe("Playwright project resolution", () => {
  // Guards the extraction above. If playwright.config.ts changes shape, this
  // fails here rather than silently reporting every spec as unreachable
  // (which would look like a coverage catastrophe and get the test muted).
  it("finds both projects and resolves them to non-empty, disjoint file sets", () => {
    expect(projects.map((p) => p.name).sort()).toEqual(["chromium", "happy-path"]);
    const chromium = specsInProject(projects.find((p) => p.name === "chromium")!, specs);
    const happy = specsInProject(projects.find((p) => p.name === "happy-path")!, specs);
    expect(chromium.length).toBeGreaterThan(0);
    expect(happy.length).toBeGreaterThan(0);
    expect(chromium.filter((f) => happy.includes(f))).toEqual([]);
    // Ground truth, measured with `npx playwright test --project=… --list`.
    expect(chromium).toContain("payment-lifecycle.spec.ts");
    expect(chromium).toContain("two-role-lifecycle.spec.ts");
    expect(happy).toContain("happy-path/customer-post-job.spec.ts");
  });

  it("finds the CI commands that run Playwright", () => {
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.map((c) => c.workflow)).toContain("e2e-happy-path.yml");
  });
});

describe("every Playwright spec is either run by CI or explicitly exempted", () => {
  const reach = reachableSpecs();

  it.each(specs)("%s", (spec) => {
    const runners = reach.get(spec);
    const exempt = NOT_RUN_IN_CI[spec];

    if (!runners && !exempt) {
      throw new Error(
        `${spec} is run by no CI job.\n\n` +
          `A spec nothing executes is worse than no spec: the journey reads as covered ` +
          `and is not. Either name it in a workflow, or add it to NOT_RUN_IN_CI in this ` +
          `file with the constraint that stops it running.`,
      );
    }
    if (runners && exempt) {
      throw new Error(
        `${spec} is listed in NOT_RUN_IN_CI but IS run by ${runners.join(", ")}.\n` +
          `Delete the stale exemption — an exemption list that lies is how a real gap ` +
          `hides next to a fake one.`,
      );
    }
    expect(runners ?? exempt).toBeTruthy();
  });

  it("every exemption names a spec that still exists", () => {
    const stale = Object.keys(NOT_RUN_IN_CI).filter((f) => !existsSync(join(E2E, f)));
    expect(stale, `NOT_RUN_IN_CI names spec files that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  it("reports the current split, so the number is visible rather than inferred", () => {
    const run = specs.filter((s) => reach.has(s));
    const notRun = specs.filter((s) => !reach.has(s));
    // eslint-disable-next-line no-console
    console.log(
      `\nPlaywright specs: ${run.length} run in CI, ${notRun.length} not.\n` +
        `Not run:\n${notRun.map((s) => `  - ${s}: ${NOT_RUN_IN_CI[s] ?? "UNEXPLAINED"}`).join("\n")}\n`,
    );
    expect(run.length + notRun.length).toBe(specs.length);
  });
});
