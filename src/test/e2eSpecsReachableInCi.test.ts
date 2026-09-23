// PROVEN ABLE TO FAIL 2026-09-21 (guard burn-down). Three shapes were run by
// hand; two are registered below and one cannot be (it lives in this file).
//
//  1. Registered — the sweeper's marker drifts from the spec's by one space:
//     reds "the prod loop and its sweeper agree on the marker" (1 of 72).
//     Live consequence: every production row the lifecycle spec creates
//     becomes unreachable by teardown while the sweeper reports "nothing
//     stranded".
//  2. Registered — an `if: ${{ secrets.… }}` on e2e-real-backend.yml's
//     anon-surface job: reds "keeps a real-backend check that needs no
//     provisioning". That is this file's central claim, and it can fail.
//  3. NOT registerable — the mock-boundary FLOOR. Breaking `mocksSupabase`
//     so it matches nothing was run by hand: reds "knows which specs are
//     mocked, and it is most of them". Measured today the floor has real
//     headroom (55 specs reached by CI, 29 of them mocked, floor > 10) and it
//     is a classifier guard, not a ratio — which is right, because the ratio
//     is deliberately being driven to zero by "no mock mode ever". A dead
//     classifier reads ~0 and reds. The mutation gate can only replace text in
//     a GUARDED file, and this classifier is in the guard itself, so no
//     `@mutate` can express it.
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | export const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]"; | export const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT] ";
// @mutate .github/workflows/e2e-real-backend.yml | \n  anon-surface:\n    name: Anon surface contract (real prod, read-only, no credentials)\n | \n  anon-surface:\n    name: Anon surface contract (real prod, read-only, no credentials)\n    if: ${{ secrets.E2E_SUPABASE_URL != '' }}\n
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
 * Every `if:` in `yaml` that could make something NOT run.
 *
 * `always()` (and its `${{ }}` spelling) is the one condition that can only
 * ADD executions, so it is not a way to silence a leg and is not returned.
 * Everything else is — a secret, a repository variable, an event name, a
 * branch, an actor — and is returned for the caller to fail on.
 */
function skippableConditions(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*if:\s*(.+?)\s*$/gm)]
    .map((m) => m[1])
    .filter((c) => !/^(\$\{\{\s*)?always\(\)(\s*\}\})?$/.test(c));
}

/**
 * Specs deliberately not run by any CI job. Each entry must say WHY, and
 * "why" has to be a real constraint, not "we didn't get to it".
 *
 * Adding a line here is the point: it turns a silent gap into a reviewed
 * one. Removing a spec's coverage without adding a line reds this test.
 */
const NOT_RUN_IN_CI: Record<string, string> = {
  /*
   * THIS LIST WAS THE HOLE, 2026-09-21.
   *
   * This guard was green at 72/72 while FIVE chromium specs had never executed
   * in CI — because all five were sitting right here. The guard worked
   * perfectly; its exemptions did not. That is the second time the same lesson
   * has been paid for in this repo (see "A guard is only as good as its
   * weakest exemption" in docs/GUARD-BURNDOWN.md, where three files exempted
   * as "Parity test; iterates the tier ladder" shipped the Plus-tier bug).
   *
   * Two of the five reasons were not merely stale, they were IMPOSSIBLE:
   * "ui-sweep.yml covers the same ground locally" cannot be true of a chromium
   * spec, because ui-sweep runs `--project=happy-path` and that project cannot
   * collect these files at all. Nobody checked, because an exemption's reason
   * was free text that nothing read.
   *
   * It is not free text any more — see the assertion below that an exemption
   * naming a workflow must name one whose project could actually collect the
   * spec. That check fails on the exact wording that was here.
   *
   * What the five were actually worth: 2.6 minutes of runner time, four
   * findings nobody had ever seen, one of them a spec that had been red for a
   * long time on a stale locator and one a real layout defect.
   */
};

/**
 * Specs a workflow DOES name but which self-skip unless an operator has
 * provisioned something — a credential, a seeded session, a job in a specific
 * lifecycle state.
 *
 * This category exists because "run by CI" and "actually executed" are not the
 * same claim, and conflating them is the failure this whole file is about. A
 * spec whose `test.skip(!haveCreds, …)` fires produces a green tick and zero
 * coverage; naming it in a workflow does not change that, it only moves where
 * the silence happens. `e2e-real-backend.yml` therefore annotates every skipped
 * leg with a ::warning:: and a step summary, and each entry here names the
 * secret whose absence causes it.
 */
const GATED_IN_CI: Record<string, { runner: string; needs: string }> = {
  "slow-network/slow-network.spec.ts": {
    runner: "slow-network.yml",
    needs: "PLAYWRIGHT_POSTER_EMAIL/_PASSWORD + PLAYWRIGHT_HELPER_EMAIL/_PASSWORD (the preflight job announces a ::warning when they are missing)",
  },
  "journeys/03-account.spec.ts": {
    runner: "e2e-journeys.yml",
    needs: "PLAYWRIGHT_HELPER_EMAIL + PLAYWRIGHT_HELPER_PASSWORD (the sign-out/sign-in leg; the rest runs on minted sessions)",
  },
  "auth.spec.ts": {
    runner: "e2e-real-backend.yml",
    needs: "PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_PASSWORD",
  },
  "payment-lifecycle.spec.ts": {
    runner: "e2e-real-backend.yml",
    needs: "PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_PASSWORD (its public half needs nothing)",
  },
  "two-role-lifecycle.spec.ts": {
    runner: "e2e-real-backend.yml",
    needs: "PLAYWRIGHT_TWO_ROLE=1 + PLAYWRIGHT_POSTER_SESSION + PLAYWRIGHT_HELPER_SESSION + PLAYWRIGHT_LIFECYCLE_JOB_ID",
  },
  "a11y-prod/a11y-prod.spec.ts": {
    runner: "a11y-webkit-prod.yml",
    needs:
      "PLAYWRIGHT_POSTER_EMAIL/_PASSWORD + PLAYWRIGHT_HELPER_EMAIL/_PASSWORD (preflight FAILS without them; " +
      "only the admin screens self-skip, on PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD).",
  },
  "prod-lifecycle.spec.ts": {
    runner: "e2e-real-backend.yml",
    needs:
      "PLAYWRIGHT_POSTER_EMAIL + PLAYWRIGHT_POSTER_PASSWORD + PLAYWRIGHT_HELPER_EMAIL + " +
      "PLAYWRIGHT_HELPER_PASSWORD (the two dedicated prod accounts). Writes to production " +
      "on a Stripe test key; see the spec header for the blast-radius controls.",
  },
};

/**
 * Does a spec answer Supabase from a mock?
 *
 * Read from the spec's own source rather than declared, so a spec that switches
 * sides changes this test's answer on the same commit. `installSupabaseMocks`
 * is the suite's shared stub installer; a bare `page.route` on the Supabase
 * origin is the hand-rolled form.
 */
function mocksSupabase(spec: string): boolean {
  const src = readFileSync(join(E2E, spec), "utf8");
  return /installSupabaseMocks|mockTable\(|mockRpc\(/.test(src) || /page\.route\(\s*["'`]\*\*\/rest\/v1/.test(src);
}

/**
 * Does a spec actually reach a real backend?
 *
 * "Not mocked" is not the same as "unmocked coverage". `happy-path/` runs
 * against `npm run build && vite preview` with a placeholder Supabase key: a
 * spec there that installs no stubs (popupFooterFit.spec.ts scans source and
 * measures layout) touches no backend at all, real or fake. Counting it as
 * boundary-crossing coverage would let the real answer go to zero while this
 * test stayed green — the precise dishonesty it exists to prevent.
 */
function crossesMockBoundary(spec: string): boolean {
  return !spec.startsWith("happy-path/") && !mocksSupabase(spec);
}

/** Does a spec self-skip on an environment variable the workflows may not set? */
function selfSkipsOnEnv(spec: string): boolean {
  const src = readFileSync(join(E2E, spec), "utf8");
  return /test\.skip\(\s*!/.test(src) && /process\.env\.PLAYWRIGHT_/.test(src);
}

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
    const src = readFileSync(join(WORKFLOWS, file), "utf8");
    for (const rawLine of joinContinuations(src)) {
      const line = rawLine.trim();
      // Comments describe commands; they do not run them.
      if (line.startsWith("#")) continue;

      if (/(^|\s|`)(npx\s+)?playwright\s+test\b/.test(line)) {
        for (const command of expandMatrix(line, src)) found.push({ workflow: file, command });
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

/**
 * Shell line-continuations, folded back into one line.
 *
 * This scanner is line-based, and a `run: |` block may spread one command over
 * several lines with a trailing backslash. Unfolded, the scanner sees
 * `npx playwright test --project=chromium \` — a project run with NO positional
 * filters — and the spec paths on the following lines are invisible to it.
 *
 * Both directions are wrong and the second is the dangerous one:
 *   - a spec named only on a continuation line reads as run by nothing;
 *   - a command naming SOME specs reads as running the WHOLE project, which
 *     credits coverage to specs the job never touches. That is exactly the
 *     false "covered" this file exists to catch, manufactured by this file.
 *
 * Found 2026-09-21 by wiring a four-spec step as a multi-line `run: |` and
 * watching all four still report as run by no CI job. The step that shipped is
 * single-line, so nothing depends on this today — it is closed because the next
 * person to wrap a long command at 80 columns should not silently lose it.
 *
 * Related and NOT fixed here: ui-sweep.yml runs `playwright test
 * --project=happy-path --workers=4 $SPECS`, and a shell variable cannot be
 * resolved by a static scan, so that command reads as running the whole
 * happy-path project when it usually runs one spec. Latent rather than live —
 * e2e-happy-path.yml genuinely runs that whole project on every push, so no
 * spec is falsely credited today. Reported rather than patched around.
 */
function joinContinuations(src: string): string[] {
  const out: string[] = [];
  let acc: string | null = null;
  for (const raw of src.split("\n")) {
    const trimmed = raw.trim();
    if (acc !== null) {
      acc += " " + trimmed.replace(/\\$/, "").trim();
      if (!trimmed.endsWith("\\")) { out.push(acc); acc = null; }
      continue;
    }
    if (trimmed.endsWith("\\") && !trimmed.startsWith("#")) {
      acc = trimmed.replace(/\\$/, "").trim();
      continue;
    }
    out.push(raw);
  }
  if (acc !== null) out.push(acc);
  return out;
}

/**
 * `--project=${{ matrix.project }}` is one line that runs once per matrix
 * value. Expand it from the same file's `project: <name>` matrix entries so
 * each project is credited — before this (2026-09-12) the unexpanded
 * `${{`/`matrix.project`/`}}` tokens were treated as positional filters that
 * matched nothing, and every matrix-driven workflow (e2e-journeys,
 * a11y-webkit-prod) credited no spec at all.
 */
function expandMatrix(line: string, src: string): string[] {
  const m = /\$\{\{\s*matrix\.([a-zA-Z0-9_]+)\s*\}\}/.exec(line);
  if (!m) return [line];
  const key = m[1];
  const values = [...src.matchAll(new RegExp(`^\\s*-?\\s*${key}:\\s*([a-zA-Z0-9_-]+)\\s*$`, "gm"))].map((x) => x[1]);
  return values.length ? values.map((v) => line.replace(m[0], v)) : [line];
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

    /*
     * Positional filters: Playwright matches them as substrings/regexes of the
     * file path. A shell variable ($SPECS) cannot be resolved statically.
     *
     * THE COMMENT HERE USED TO SAY the unresolvable token was "treated as
     * matching NOTHING", and the code did the opposite. Dropping `$SPECS` left
     * the filter list EMPTY, `filters.length > 0` was then false, the `continue`
     * never ran, and the command was credited with the WHOLE project — so a job
     * that usually runs one spec read as running all of them, and every other
     * spec in that project was recorded as covered by a job that never touches
     * it. That is the exact false "covered" this file exists to catch,
     * manufactured by this file. (Trust the declaration, not the comment beside
     * it — including when the comment is this one.)
     *
     * So an unresolvable token now makes the command's scope UNKNOWN, and an
     * unknown scope credits only what is statically visible — which, when the
     * variable is the sole positional argument, is nothing at all. Under-
     * crediting shows up as a spec that looks unrun and gets investigated;
     * over-crediting shows up as nothing.
     *
     * Reported latent rather than live by the lane that found it, and verified:
     * `ui-sweep.yml` is the one command in this shape, and every happy-path
     * spec is genuinely run wholesale by `e2e-happy-path.yml` on push. It would
     * have gone live the moment that wholesale run was narrowed.
     */
    const positional = command
      .replace(/^.*playwright\s+test\b/, "")
      .split(/\s+/)
      .filter((t) => t && !t.startsWith("-"));
    const filters = positional.filter((t) => !t.includes("$"));
    const scopeIsUnknown = filters.length !== positional.length;

    for (const p of selected) {
      for (const s of specsInProject(p, specs)) {
        const narrowed = filters.length > 0 || scopeIsUnknown;
        if (narrowed && !filters.some((f) => s.includes(f.replace(/^e2e\//, "")))) continue;
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
  it("finds the projects and resolves them to non-empty, disjoint file sets", () => {
    // happy-path-webkit opens with a comment before `name:` and is not parsed,
    // which is fine — it collects the same files as happy-path.
    expect(projects.map((p) => p.name).sort()).toEqual([
      "a11y-prod", "a11y-prod-webkit", "canary", "chromium", "happy-path", "journeys", "journeys-webkit", "prod-audit", "slow-network",
    ]);
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
    if (runners && selfSkipsOnEnv(spec) && !GATED_IN_CI[spec]) {
      throw new Error(
        `${spec} is named by ${runners.join(", ")} but self-skips unless a PLAYWRIGHT_* env var is set, ` +
          `and it is not listed in GATED_IN_CI.\n\n` +
          `"A workflow names it" and "it executed" are different claims. Add it to GATED_IN_CI with the ` +
          `secret it waits on, so the skip is announced instead of read as coverage.`,
      );
    }
    expect(runners ?? exempt).toBeTruthy();
  });

  it("every exemption names a spec that still exists", () => {
    const stale = Object.keys(NOT_RUN_IN_CI).filter((f) => !existsSync(join(E2E, f)));
    expect(stale, `NOT_RUN_IN_CI names spec files that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  /*
   * AN EXEMPTION'S REASON IS A CLAIM, AND CLAIMS GET CHECKED.
   *
   * Added 2026-09-21, after this file sat green at 72/72 while five chromium
   * specs had never executed — all five exempted here, two of them on the
   * reason "ui-sweep.yml covers the same ground locally". That is not merely
   * stale, it is impossible: ui-sweep runs `--project=happy-path`, and that
   * project's testDir/testIgnore cannot collect a spec in the chromium set at
   * all. Nobody noticed because the reason was free text nothing read.
   *
   * So: if a reason names a workflow as the thing providing cover, that
   * workflow must exist AND must run at least one project that could actually
   * collect this spec. Anything else is a promise with no one behind it.
   */
  it("an exemption that names a workflow as cover names one that could actually run the spec", () => {
    const failures: string[] = [];
    for (const [spec, reason] of Object.entries(NOT_RUN_IN_CI)) {
      for (const wf of reason.match(/[a-z0-9-]+\.yml/gi) ?? []) {
        const wfPath = join(WORKFLOWS, wf);
        if (!existsSync(wfPath)) {
          failures.push(`${spec}: reason cites ${wf}, which does not exist`);
          continue;
        }
        const yaml = readFileSync(wfPath, "utf8");
        const named = [...yaml.matchAll(/--project=([a-z0-9-]+)/gi)].map((m) => m[1]);
        const canCollect = named.some((projName) => {
          const proj = projects.find((x) => x.name === projName);
          return proj ? specsInProject(proj, specs).includes(spec) : false;
        });
        if (!canCollect) {
          failures.push(
            `${spec}: reason claims ${wf} covers it, but ${wf} runs ${
              named.length ? named.map((n) => `--project=${n}`).join(", ") : "no project"
            } and none of those projects can collect ${spec}`,
          );
        }
      }
    }
    expect(
      failures,
      "an exemption is only as good as its reason. If the reason names a workflow as cover, that " +
        "workflow has to be able to run the spec:\n  " + failures.join("\n  "),
    ).toEqual([]);
  });

  it("every GATED_IN_CI entry names a real spec and a workflow that really names it", () => {
    for (const [spec, { runner }] of Object.entries(GATED_IN_CI)) {
      expect(existsSync(join(E2E, spec)), `GATED_IN_CI names a missing spec: ${spec}`).toBe(true);
      expect(
        reach.get(spec) ?? [],
        `GATED_IN_CI says ${runner} runs ${spec}, but no workflow command reaches it`,
      ).toContain(runner);
    }
  });

  it("reports the current split, so the number is visible rather than inferred", () => {
    const run = specs.filter((s) => reach.has(s));
    const notRun = specs.filter((s) => !reach.has(s));
     
    console.log(
      `\nPlaywright specs: ${run.length} run in CI, ${notRun.length} not.\n` +
        `Not run:\n${notRun.map((s) => `  - ${s}: ${NOT_RUN_IN_CI[s] ?? "UNEXPLAINED"}`).join("\n")}\n`,
    );
    expect(run.length + notRun.length).toBe(specs.length);
  });
});

/**
 * The mock boundary.
 *
 * Everything above proves a spec is REACHED by a CI command. This proves
 * something stronger and more easily lost: that CI's coverage does not lie
 * entirely on one side of the mock.
 *
 * Measured 2026-09-06, before `e2e-real-backend.yml` existed: of the specs any
 * workflow reached, every one that runs unconditionally answered Supabase from
 * a `page.route()` stub, except `mobile-viewports.spec.ts` — which hits the
 * deployed site but asserts only layout, so a 401 feed and a populated feed
 * look identical to it. The three specs that talk to a real backend
 * authenticated existed, were skipped for want of env vars no workflow set, and
 * had never executed. Green CI meant "the mocks agree with themselves".
 */
describe("CI crosses the mock boundary", () => {
  const reach = reachableSpecs();
  const reached = specs.filter((s) => reach.has(s));

  it("knows which specs are mocked, and it is most of them", () => {
    // Guards the classifier. If `mocksSupabase` stopped matching, every spec
    // would read as unmocked and the assertion below would pass for the worst
    // possible reason.
    //
    // A FLOOR, NOT A MAJORITY. This used to require the mocked specs to
    // OUTNUMBER the unmocked ones, which was true when it was written and is
    // a ratio the owner's standing order is deliberately driving to zero ("no
    // mock mode ever" — every new suite is real-backend, and the mocked ones
    // are being migrated). It tipped to exactly half on 2026-09-20 when one
    // prod-audit spec was added, and a guard that goes red because the repo
    // moved the way it was told to is a guard that will be edited without
    // being read. What it is actually for is the classifier: a broken
    // `mocksSupabase` reads ~0, and the membership checks below pin both
    // answers by name.
    const mocked = reached.filter(mocksSupabase);
    expect(reached.length).toBeGreaterThan(10);
    expect(mocked.length).toBeGreaterThan(10);
    expect(mocked).toContain("happy-path/customer-post-job.spec.ts");
    expect(mocksSupabase("auth.spec.ts")).toBe(false);
    // popupFooterFit installs no stubs but reaches no backend either — it runs
    // against the local preview. The boundary classifier must exclude it, or
    // "unmocked coverage" counts a layout measurement.
    expect(mocksSupabase("happy-path/popupFooterFit.spec.ts")).toBe(false);
    expect(crossesMockBoundary("happy-path/popupFooterFit.spec.ts")).toBe(false);
    expect(crossesMockBoundary("auth.spec.ts")).toBe(true);
  });

  const crossing = reached.filter(crossesMockBoundary);
  const unconditional = crossing.filter((s) => !GATED_IN_CI[s]);

  it("reports the boundary split, separating what exists from what executes", () => {
     
    console.log(
      `\nMock boundary: ${reached.length} specs reached by CI — ` +
        `${reached.length - crossing.length} never touch a real backend, ${crossing.length} do ` +
        `(${unconditional.length} unconditionally, ${crossing.length - unconditional.length} gated on a secret).\n` +
        crossing
          .map((s) => `  - ${s}${GATED_IN_CI[s] ? ` [GATED, does not execute: ${GATED_IN_CI[s].needs}]` : " [runs]"}`)
          .join("\n") +
        "\n",
    );
    expect(crossing.length + (reached.length - crossing.length)).toBe(reached.length);
  });

  it("has real-backend specs at all", () => {
    // Distinct from the next assertion on purpose. This one fails when the
    // specs are DELETED; the next fails when they all exist but none of them
    // can run. Collapsing the two would let "we removed them" and "they are
    // all skipped" produce the same message, and they need different fixes.
    expect(
      crossing,
      "No spec CI runs reaches a real backend at all. That is the state in which guest " +
        "browse returned 401 for months, a dead RPC stayed dead, and six fixtures described " +
        "rows the database would reject — every one of them with a green tick.",
    ).not.toEqual([]);
  });

  it("has real-backend coverage that no missing secret can silence", () => {
    // The honest version of "does CI cross the boundary". Every spec in
    // GATED_IN_CI can sit skipped forever — nobody has to set a secret, and a
    // skipped spec and a passing one look identical on the Actions tab. So the
    // claim that matters is about what executes UNCONDITIONALLY.
    //
    // This deliberately does NOT require the authenticated lifecycle suite:
    // its backend target is an open question, and a guard that reds until an
    // unrelated decision is made is a guard people delete. It requires only
    // that SOMETHING crosses the boundary without provisioning.
    expect(
      unconditional,
      `Every real-backend spec CI runs is gated on a secret that may never be set ` +
        `(${crossing.map((s) => s).join(", ")}). "Exists but skipped" reads exactly like ` +
        `"passes" on the Actions tab. At least one unmocked check must execute unconditionally.`,
    ).not.toEqual([]);
  });

  it("the prod loop and its sweeper agree on the marker that identifies their rows", () => {
    // These two files each declare E2E_TITLE_MARKER. They cannot share a module:
    // the spec is compiled under tsconfig.e2e (which includes `e2e`, not
    // `scripts`), and the sweeper runs top-level code that exits when its env is
    // absent, so importing it from a spec would kill the run.
    //
    // A literal duplicated across two files is exactly the shape that rots. The
    // marker is the ONLY handle the sweeper has on the rows the spec creates, so
    // if they drift, the sweeper silently finds nothing and every stranded
    // production job stays stranded — while reporting "OK — nothing stranded".
    // Hence: derive both, and diff.
    const read = (rel: string) => {
      const src = readFileSync(join(REPO, rel), "utf8");
      const m = /E2E_TITLE_MARKER\s*=\s*"([^"]+)"/.exec(src);
      expect(m, `${rel} no longer declares E2E_TITLE_MARKER`).toBeTruthy();
      return m![1];
    };
    const spec = read("e2e/prod-lifecycle.spec.ts");
    const sweeper = read("scripts/e2e/prod-lifecycle-sweeper.mjs");
    expect(spec.length, "the marker must be substantial enough to match nothing else").toBeGreaterThan(8);
    expect(
      sweeper,
      `the lifecycle spec tags its rows "${spec}" but the sweeper looks for "${sweeper}" — ` +
        `every production row the suite creates would be unreachable by teardown`,
    ).toBe(spec);
  });

  it("keeps a real-backend check that needs no provisioning", () => {
    // The gated specs above can be uncovered indefinitely — nobody has to set a
    // secret. So one real-backend check must exist that CANNOT be silenced by an
    // absent credential, and it must run on push to main rather than only on a
    // schedule someone can quietly disable.
    const workflow = join(WORKFLOWS, "e2e-real-backend.yml");
    expect(existsSync(workflow), "e2e-real-backend.yml is gone — the unmocked leg went with it").toBe(true);

    const src = readFileSync(workflow, "utf8");
    expect(src, "the anon contract script is no longer invoked").toContain(
      "scripts/e2e/anon-surface-contract.mjs",
    );
    expect(
      existsSync(join(REPO, "scripts/e2e/anon-surface-contract.mjs")),
      "the workflow names a script that does not exist",
    ).toBe(true);

    // Triggers, not just existence. A guard that only runs on `schedule` or
    // `pull_request` is dormant in a repo that commits directly to main — the
    // exact way migration-guard, migration-lint and db-smoke sat inert here.
    const triggers = src.slice(src.indexOf("\non:"), src.indexOf("\njobs:"));
    expect(triggers, "e2e-real-backend.yml must fire on push to main").toMatch(/push:\s*\n\s*branches:\s*\[main\]/);

    // And the anon leg specifically must not be conditioned on a secret.
    //
    // WHY THIS IS NO LONGER A BLANKET `not.toMatch(/\bif:/)`. That line read
    // the WORD, not the MEANING, and on 2026-09-19 it went red on
    // `if: always()` — a condition that makes the guest-listing-horizon step
    // run MORE, so its day-by-day runway still prints when the contract step
    // above has already failed. That is the step that NAMES the cause of a
    // dark marketplace; forbidding it fails a workflow that is strictly harder
    // to silence, not easier. The rule the line was written for is intact and
    // is now stated as itself: NOTHING on this leg may be conditioned on
    // something a person can unset or a fork will not have.
    //
    // This is deliberately an allow-list of always-run forms, not a
    // deny-list of suspicious ones: a new `if:` shape lands here as a failure
    // that someone has to look at, which is the behaviour the blanket line
    // had and the reason it is not simply being deleted.
    const anonJob = src.slice(src.indexOf("  anon-surface:"), src.indexOf("  authenticated:"));
    expect(
      skippableConditions(anonJob),
      "a condition on the anon leg that can SKIP it — this guard exists so the one unmocked check in CI " +
        "cannot be silenced by an unset secret, a fork, or a branch filter",
    ).toEqual([]);
    expect(anonJob).not.toMatch(/secrets\./);
  });

  it("that condition check can fail — a secret-gated or event-gated anon leg is caught", () => {
    // PROOF IT CAN FAIL, without touching .github/workflows (owned elsewhere).
    // Every one of these is the defect the blanket line was guarding against.
    expect(skippableConditions("  anon-surface:\n    if: ${{ secrets.E2E_KEY != '' }}\n")).toEqual([
      "${{ secrets.E2E_KEY != '' }}",
    ]);
    expect(skippableConditions("    steps:\n      - name: x\n        if: github.event_name == 'schedule'\n")).toEqual([
      "github.event_name == 'schedule'",
    ]);
    expect(skippableConditions("        if: vars.E2E_SUPABASE_URL\n")).toEqual(["vars.E2E_SUPABASE_URL"]);
    // …and the always-run forms it must keep tolerating.
    expect(skippableConditions("        if: always()\n")).toEqual([]);
    expect(skippableConditions("        if: ${{ always() }}\n")).toEqual([]);
  });
});
