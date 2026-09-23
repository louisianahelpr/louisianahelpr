/**
 * THE MUTATION RUNNER — "every check must be shown able to fail", mechanised.
 *
 * For each guard that registers a mutation, this breaks the code the guard is
 * supposed to protect, runs ONLY that guard, and fails if the guard stayed
 * green. A guard that survives its own mutation is not a guard.
 *
 * Why mutation and not more static analysis: classes (b), (c) and (e) are not
 * statically decidable. Whether `auto-release-payment` mentioning the literal
 * "in_progress" means the sweep COVERS in_progress is a semantic question; the
 * only honest way to ask it is to remove the behaviour and see who notices.
 *
 * SAFETY IN A SHARED TREE. Two other lanes edit src/** while this runs, so:
 *   - a target with uncommitted changes is SKIPPED, loudly, never mutated;
 *   - original bytes are captured before the write and restored in `finally`,
 *     on SIGINT, on SIGTERM and on process exit;
 *   - the restore is verified byte-for-byte and a failure to restore is a
 *     hard error that names the file and the backup path.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { REPO, guardFiles, parseDirectives, gitIsClean, c } from "./lib.mjs";

/**
 * Vitest's CLI entry, RESOLVED rather than guessed.
 *
 * This was `path.join(REPO, "node_modules", "vitest", "vitest.mjs")`. An agent
 * worktree under `.claude/worktrees/` has an (almost) empty `node_modules` and
 * resolves its dependencies up to the main checkout, so that path does not
 * exist there: every baseline run died with MODULE_NOT_FOUND, every guard
 * looked "RED before any mutation", and the mutation phase reported
 * `inconclusive` for all of them while still exiting 0. "Every check must be
 * shown able to fail" was therefore enforced on the main checkout and in CI
 * and silently skipped in the trees where most agent work happens (measured
 * 2026-09-20: three registrations in one worktree, each green on its own).
 *
 * It also red `src/test/vacuityGate.test.ts` in any worktree — a REQUIRED
 * check failing for an environment reason rather than a code one.
 */
const VITEST_BIN = (() => {
  const local = path.join(REPO, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(local)) return local;
  // Resolve the PACKAGE, then join the CLI entry: `vitest/vitest.mjs` is not
  // one of vitest's `exports` subpaths, so asking for it directly throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. `vitest/package.json` is.
  try {
    const pkg = createRequire(path.join(REPO, "package.json")).resolve("vitest/package.json");
    const hoisted = path.join(path.dirname(pkg), "vitest.mjs");
    if (fs.existsSync(hoisted)) return hoisted;
  } catch { /* fall through to the local path, so the spawn names what it looked for */ }
  return local;
})();

/**
 * Playwright's CLI entry, RESOLVED the same way VITEST_BIN is, for the same
 * reason: `path.join(REPO, "node_modules", "@playwright", "test", "cli.js")`
 * does not exist in an agent worktree's near-empty `node_modules`, where npm
 * hoists dependencies up to the main checkout instead. Every Playwright-guard
 * mutation then died with MODULE_NOT_FOUND, was reported "guard is RED before
 * any mutation", and scored `inconclusive` — the identical failure mode
 * VITEST_BIN above exists to fix, just on the e2e half of the gate. Measured
 * 2026-09-23: docs/OPEN.md Q297's registration (the only Playwright mutation
 * touched by that fix) came back `inconclusive` in a fresh agent worktree with
 * this exact MODULE_NOT_FOUND, and `killed` once resolved this way.
 */
const PLAYWRIGHT_CLI = (() => {
  const local = path.join(REPO, "node_modules", "@playwright", "test", "cli.js");
  if (fs.existsSync(local)) return local;
  try {
    const pkg = createRequire(path.join(REPO, "package.json")).resolve("@playwright/test/package.json");
    const hoisted = path.join(path.dirname(pkg), "cli.js");
    if (fs.existsSync(hoisted)) return hoisted;
  } catch { /* fall through to the local path, so the spawn names what it looked for */ }
  return local;
})();

const live = new Map(); // abs path -> original bytes

function restoreAll() {
  for (const [abs, bytes] of live) {
    try {
      fs.writeFileSync(abs, bytes);
    } catch (e) {
      process.stderr.write(`FAILED TO RESTORE ${abs}: ${e.message}\n`);
    }
  }
  live.clear();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { restoreAll(); process.exit(130); });
process.on("exit", restoreAll);
process.on("uncaughtException", (e) => { restoreAll(); throw e; });

/**
 * A KILLED SPAWN IS NOT A VERDICT.
 *
 * `spawnSync({ timeout })` kills the child with SIGTERM when the budget runs
 * out, and the run then exits NON-ZERO. The mutation phase reads non-zero as
 * "the guard noticed", so a run that simply ran out of wall clock was scored
 * `killed` — a green verdict manufactured out of a timeout, with the guard
 * having observed nothing at all.
 *
 * Found 2026-09-21 on the Playwright path, where it is worst: a full overlay
 * sweep is ~22 minutes against a 900s budget, so EVERY mutation of it would
 * have "passed". The same channel exists on the vitest path at 180s. This is
 * the third way this gate has manufactured a proof it never performed, after
 * the unescaped-`||` parse bug and the batched-baseline/solo-mutation split —
 * all three shaped the same way: something that is not evidence being read as
 * evidence because it happened to be non-zero.
 *
 * A timeout is `inconclusive`, which is already a hard failure. The honest
 * answer when nothing was observed.
 */
export function timedOut(r) {
  return r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM" || r.signal === "SIGKILL";
}

function runVitest(guards, extraEnv = {}) {
  const list = Array.isArray(guards) ? guards : [guards];
  const r = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", "--silent=true", "--maxWorkers=1", ...list],
    {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv, LH_VACUITY_TRACE: "", CI: "1" },
      timeout: 180_000,
    },
  );
  const out = (r.stdout || "") + (r.stderr || "");
  if (timedOut(r)) {
    return {
      green: false,
      timedOut: true,
      out: `vitest run of ${list.join(", ")} was KILLED at the 180s spawn budget — it did not finish, ` +
        `so nothing was observed either way.\n` + out.slice(-2000),
    };
  }
  return { green: r.status === 0, out };
}

/**
 * PLAYWRIGHT GUARDS. `runVitest` cannot execute a spec under `e2e/` — vitest's
 * `include` does not match it, so the run dies with "No test files found",
 * exit 1, and every e2e registration came back `inconclusive`: the gate
 * reporting "nothing proven" for the 60 specs that cover the rendered app.
 * Registering a mutation the gate cannot run is the same "green while blind"
 * defect one level up, so e2e guards are dispatched to the Playwright CLI.
 *
 * THE TRAP THIS EXISTS TO AVOID. The happy-path project loads the app from
 * `vite preview` of `dist/`, NOT from `src/`. Mutating a source file and
 * running the spec therefore tests the PREVIOUS bundle, and every mutation
 * would report SURVIVED for a reason that has nothing to do with the spec.
 * So a mutation whose target is bundle-affecting (anything under `src/`)
 * forces `npm run build` before the spec runs. `PLAYWRIGHT_WEB_SERVER=1` with
 * CI unset means the config's webServer block reuses the already-running
 * preview instead of rebuilding a second time; vite preview stats each file
 * per request, so the fresh `dist/` is picked up without a restart.
 *
 * One browser at a time: e2e/globalSetup.ts takes ~/.lh-browser.lock, and
 * these runs are sequential by construction.
 */
export const isPlaywrightGuard = (rel) => rel.startsWith("e2e/");

/** Bundle-affecting: the browser only sees it after a rebuild. */
/**
 * Does mutating `target` change what `vite preview` serves out of `dist/`?
 *
 * A Playwright spec loads the built bundle, so a mutation that never reaches
 * `dist/` tests the PREVIOUS build and comes back SURVIVED — a confident wrong
 * answer, and the worst kind this gate can give.
 *
 * This was `target.startsWith("src/")`, which is most of the truth and not all
 * of it. `tailwind.config.ts`, `vite.config.ts`, `index.html` and the postcss
 * config all shape the bundle and none of them live under `src/`. Found
 * 2026-09-21 by a lane that went to register a dock-clearance mutation against
 * `tailwind.config.ts`, worked out it would have been scored false-SURVIVED,
 * and stopped rather than register a guess.
 *
 * Erring toward rebuilding is the safe direction: a needless rebuild costs
 * ~60-90s, a missed one invents a result.
 */
const BUNDLE_AFFECTING = [
  /^src\//,
  /^index\.html$/,
  /^tailwind\.config\.[cm]?[jt]s$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^postcss\.config\.[cm]?[jt]s$/,
  /^package(-lock)?\.json$/,
  /^public\//,
];
export const needsRebuild = (target) => BUNDLE_AFFECTING.some((re) => re.test(target));

const PW_PROJECT = (rel) => {
  const m = /^e2e\/([^/]+)\//.exec(rel);
  const dir = m?.[1];
  return ["happy-path", "journeys", "prod-audit", "a11y-prod"].includes(dir) ? dir : "chromium";
};

/*
 * The rebuild carries the VITE_* fallbacks ITSELF.
 *
 * `.env` is gitignored, so a fresh `git worktree add` — where every agent lane
 * works — does not have one. vite.config.ts throws from `buildStart` when
 * VITE_SUPABASE_URL is missing (a deliberate guard: without it supabase-js
 * throws and React never mounts, i.e. a white screen with no error). So a
 * rebuild that inherits only `process.env` FAILS in exactly the environment
 * this gate is supposed to work in, every `src/`-targeted e2e mutation comes
 * back with a red baseline, and the verdict is `inconclusive` for a reason
 * that has nothing to do with any guard.
 *
 * These are the same publishable/anon values playwright.config.ts already
 * hands its webServer block — public by design, in every shipped bundle, RLS
 * is the real boundary — so the two builds agree instead of one silently
 * having credentials the other lacks.
 */
const BUILD_ENV = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
};

function runBuild() {
  const r = spawnSync("npm", ["run", "build"], {
    cwd: REPO, encoding: "utf8", timeout: 600_000,
    env: { ...process.env, ...BUILD_ENV, CI: "" },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * Env a spec needs before it will RUN ITS OWN TESTS.
 *
 * Several suites gate themselves behind a variable so they do not run on every
 * push — `const d = process.env.RUN_EMPTY_SWEEP ? test.describe :
 * test.describe.skip`. Without it they collect their tests and skip all of
 * them, and Playwright exits 0. To this gate a spec that skipped everything is
 * indistinguishable from a spec that passed, so a mutation against it comes
 * back SURVIVED for an environment reason and the guard looks hollow when it
 * is not.
 *
 * Measured 2026-09-21: `empty-state-sweep` (138 tests) and `error-state-sweep`
 * (276 tests) both do this, and both ARE wired into CI (ui-sweep.yml sets the
 * vars) — so the coverage was fine and only the PROVABILITY was missing. A
 * lane correctly refused to register a mutation it knew would be scored
 * wrongly, and equally refused to `@mutate-exempt` them, which would have
 * retired two real guards from the burn-down.
 *
 * `--list` cannot detect this: it collects identically with the gate on or off.
 */
function specGateEnv(guard) {
  const GATES = {
    "e2e/happy-path/empty-state-sweep.spec.ts": { RUN_EMPTY_SWEEP: "1" },
    // SCOPED, for the same reason overlay-sweep is. The full sweep is 276 tests
    // at --workers=1 and was measured reaching only 209 when spawnSync's 900s
    // timeout hit — so an unscoped mutation here is scored on the TIMEOUT, which
    // used to read as `killed` and is now `inconclusive`. One role and the error
    // pass exercise the same assertion code path as all four variants, which is
    // what the mutation proves.
    "e2e/happy-path/error-state-sweep.spec.ts": {
      RUN_ERROR_SWEEP: "1",
      ERROR_SWEEP_ROLES: "customer",
      ERROR_SWEEP_MODES: "error",
    },
    // Found 2026-09-21 by selfGatedSpecsAreRunnable, not by anyone reading the
    // tree: ~91 components in src/ render an overlay and none was ever audited
    // until this sweep existed.
    // …and SCOPED. A full overlay sweep is 66 routes at up to 40 button clicks
    // each — measured at ~70 minutes, which is FIVE TIMES the 900s spawnSync
    // timeout above. A timed-out run exits non-zero, and a non-zero run under
    // mutation scores as `killed`, so registering this spec unscoped would have
    // manufactured a green verdict out of a timeout without the guard having
    // noticed anything. The two routes below are the ones the registered
    // mutations act on; the assertion code path is identical at 2 routes and at
    // 66, which is what the mutation is proving.
    "e2e/happy-path/overlay-sweep.spec.ts": {
      RUN_OVERLAY_SWEEP: "1",
      OVERLAY_SWEEP_ROUTES: "/dashboard,/settings",
    },
    "e2e/happy-path/appstore-screenshots.spec.ts": { RUN_APPSTORE_SHOTS: "1" },
    // SCOPED, third of its kind and for the same reason as the two sweeps
    // above. The full prod sweep is 149 tests (`--list`, 2026-09-21) — every
    // anon screen, then the whole authed catalog twice (poster and helper),
    // then job detail in all eight statuses, then the admin surface — each one
    // a fresh context, a sign-in, a page load against prod Supabase and a full
    // axe run.
    //
    // NOT SCOPED, and the claim that it had to be was WRONG. This carried
    // `SWEEP_ROUTES: "/login"` on the stated grounds that the spec "does not
    // finish inside the 900s spawnSync budget". Measured 2026-09-21 rather than
    // assumed: 148 of 149 tests pass in 552 SECONDS — comfortably inside the
    // budget. The scoping narrowed the proof from 148 screens to 1 for no
    // reason, which is its own small version of the defect this whole row
    // exists to remove: a guard weakened on an unmeasured belief.
    //
    // A runtime estimate is a measurement, not an intuition. `--list` gives the
    // test count and says nothing about wall clock; 149 axe runs sounded like
    // too many and were not.
    /* SCOPED, and unlike a11y-prod's the claim is MEASURED: the full spec takes
       3705 SECONDS — just over an hour — against the 900s spawnSync budget.
       Four times over, so a mutation run here would be scored on the timeout.
       (a11y-prod carried the same justification on an unmeasured belief and
       turned out to finish in 552s; its scoping is gone. Same sentence, one
       true and one false, which is the argument for measuring rather than
       estimating: `--list` gives a COUNT and says nothing about wall clock.)
       94 tests: 29 whole-form sweeps, 14 targeted rules, 51 explore passes,
       each a fresh context and a sign-in against prod. `MESSY_INPUT_SCOPE` is a
       regex on the test title, and the spec declares everything else SKIPPED so
       `--list` and the reported inventory are unchanged; this pins the one
       targeted rule the registered mutation acts on. */
    "e2e/prod-audit/messy-input.spec.ts": { MESSY_INPUT_SCOPE: "^login: " },
  };
  return GATES[guard] ?? {};
}

function runPlaywright(guard, { rebuild = false } = {}) {
  if (rebuild) {
    const b = runBuild();
    if (!b.ok) return { green: false, out: "npm run build FAILED before the spec ran:\n" + b.out.slice(-4000) };
  }
  const r = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI,
     "test", guard, `--project=${PW_PROJECT(guard)}`, "--reporter=line", "--workers=1"],
    {
      cwd: REPO, encoding: "utf8", timeout: 900_000,
      env: {
        ...process.env,
        PLAYWRIGHT_WEB_SERVER: "1",
        ...BUILD_ENV,
        ...specGateEnv(guard),
        // NOT CI: `reuseExistingServer: !CI` is what stops a second build.
        CI: "",
        LH_VACUITY_TRACE: "",
      },
    },
  );
  const out = (r.stdout || "") + (r.stderr || "");

  if (timedOut(r)) {
    return {
      green: false,
      timedOut: true,
      out:
        `${guard} was KILLED at the 900s spawn budget — it did not finish, so nothing was ` +
        `observed either way. Scope it down in specGateEnv (the sweeps take ` +
        `OVERLAY_SWEEP_ROUTES / EMPTY_SWEEP_ROLES / ERROR_SWEEP_ROLES) so the mutated code path ` +
        `runs inside the budget. The assertion being proven is identical at 2 routes and at 66.\n` +
        out.slice(-3000),
    };
  }

  /*
   * A RUN WHERE EVERYTHING SKIPPED IS NOT A PASS — and scored as one it
   * produces a FALSE SURVIVED, which convicts a good spec of being hollow.
   *
   * Playwright exits 0 when every test skips. Two ways that happens here, both
   * measured today:
   *   - a spec self-gates on an env var (handled by specGateEnv above);
   *   - a spec calls `test.skip()` because its fixture could not authenticate.
   *     `sessionsAvailable()` reads `.env`, which is gitignored, so a fresh
   *     `git worktree add` has none — and every session-gated spec skips. A
   *     lane hit exactly this: the registration came back SURVIVED in about a
   *     minute, and one `ln -s` of `.env` turned the identical directive into
   *     `killed`.
   *
   * The runner cannot otherwise tell "the guard did not notice" from "the
   * guard did not run". Reporting it as not-green makes the mutation phase
   * call it `inconclusive`, which is already a hard failure — the honest
   * answer when nothing was observed.
   */
  const m = /(\d+)\s+skipped/.exec(out);
  const ranSomething = /\b(\d+)\s+(passed|failed)\b/.test(out);
  if (r.status === 0 && m && !ranSomething) {
    return {
      green: false,
      allSkipped: true,
      out:
        `EVERY test in ${guard} SKIPPED (${m[1]}), and Playwright exits 0 when that happens — so this ` +
        `run observed nothing. Commonest cause in a fresh worktree: no .env, so the session fixture ` +
        `cannot authenticate and every session-gated test skips. Symlink .env from the main checkout ` +
        `and re-run.\n` + out.slice(-2000),
    };
  }
  return { green: r.status === 0, out };
}

/** Dispatch one guard to the engine that can actually execute it. */
function runGuard(guard, { rebuild = false } = {}) {
  return isPlaywrightGuard(guard) ? runPlaywright(guard, { rebuild }) : runVitest([guard]);
}

/** Collect every registered mutation, plus every registration error. */
/**
 * `--only <guard>[,<guard>...]` (index.mjs): exactly these guard files'
 * registrations. A named guard with no registration, or an empty list, is an
 * error: a filter that matched nothing must never read as a clean run.
 */
export function selectOnly(mutations, only) {
  const errors = [];
  if (!only.length) errors.push("--only was given no guard file");
  for (const g of only)
    if (!mutations.some((m) => m.guard === g)) errors.push(`--only names ${g}, which registers no @mutate line`);
  return { scoped: mutations.filter((m) => only.includes(m.guard)), errors };
}

export function collectMutations(guards = guardFiles()) {
  const mutations = [];
  const errors = [];
  const exemptions = [];
  for (const g of guards) {
    const { mutations: ms, exemptions: es } = parseDirectives(g);
    exemptions.push(...es);
    for (const m of ms) {
      if (m.malformed) {
        errors.push(
          m.tooManyFields
            ? `${g}:${m.line} @mutate has an UNESCAPED "|" inside a field — escape every literal pipe as \\| . ` +
              `Left as-is the parser would keep only the text before the 2nd and 3rd pipes, splice unparseable ` +
              `code into the target, and score the guard's failure to load as "killed" — a proof that never ran: ${m.raw}`
            : `${g}:${m.line} malformed @mutate — need "<file> | <find> | <replace>": ${m.raw}`,
        );
        continue;
      }
      const abs = path.join(REPO, m.target);
      if (!fs.existsSync(abs)) {
        errors.push(`${g}:${m.line} @mutate target does not exist: ${m.target}`);
        continue;
      }
      if (m.find === m.replace) {
        errors.push(`${g}:${m.line} @mutate is a no-op (find === replace)`);
        continue;
      }
      const src = fs.readFileSync(abs, "utf8");
      const n = src.split(m.find).length - 1;
      if (n === 0) {
        errors.push(`${g}:${m.line} @mutate find-string is not in ${m.target}: ${JSON.stringify(m.find)}`);
        continue;
      }
      if (n > 1) {
        errors.push(
          `${g}:${m.line} @mutate find-string occurs ${n}× in ${m.target} — ambiguous, make it unique: ${JSON.stringify(m.find)}`,
        );
        continue;
      }
      mutations.push(m);
    }
  }
  return { mutations, errors, exemptions };
}

export function runMutations(mutations, { onResult, allowDirty = false } = {}) {
  const results = [];

  /*
   * THE BASELINE MUST RUN THE GUARD THE SAME WAY THE MUTATION WILL — ALONE.
   *
   * This used to take ONE batched vitest run over every guard and only narrow
   * to individual runs when that batch came back red, to avoid "running each
   * guard twice for no information". There IS information in the second run,
   * and skipping it manufactured fake kills:
   *
   *   baseline:  runVitest([...all guards])   <- batched, GREEN
   *   mutation:  runGuard(one guard)          <- ALONE,   red
   *   verdict:   killed
   *
   * A guard that is green in a batch and red on its own — a warm module cache
   * for a React.lazy import, a global another spec happens to set, an
   * ordering dependency — fails the mutated run for a reason that has nothing
   * to do with the mutation, and is scored as a proof. That is the same
   * "reported a proof it had not performed" defect as the unescaped-`||`
   * parse bug above, arriving through a different door.
   *
   * Measured 2026-09-21: src/components/admin/adminStalledJobsWiring.test.tsx
   * passes in the suite and fails standing alone (its lazily-mounted queue
   * needs longer than findBy's 1s default once the module cache is cold). Any
   * registration on it would have scored a fake kill.
   *
   * So: one solo run per guard, and the cost is accepted. The gate normally
   * mutates only the registrations changed since origin/main, where this is a
   * handful of runs; the full sweep is weekly and has the wall clock.
   */
  const guards = [...new Set(mutations.map((m) => m.guard))];
  const baselineRed = new Set();
  const baselineWhy = new Map();
  // Playwright guards cannot be batched into one vitest invocation; each is
  // its own CLI run against the built preview.
  const pw = guards.filter(isPlaywrightGuard);
  const vt = guards.filter((g) => !isPlaywrightGuard(g));
  for (const g of vt) {
    const r = runVitest([g]);
    if (r.green) continue;
    baselineRed.add(g);
    baselineWhy.set(g, r.out.trim().split("\n").slice(-25).join("\n"));
  }
  /*
   * A guard red ALONE but green TOGETHER is its own finding, not just a skip:
   * it means that guard's green in CI is borrowed from whatever else the suite
   * happened to load first. Name it, because it is invisible in a normal
   * `vitest run`.
   */
  if (baselineRed.size && vt.length > 1) {
    const together = runVitest(vt);
    if (together.green) {
      process.stderr.write(
        `\n! TEST ISOLATION: ${baselineRed.size} guard(s) are RED standing alone and GREEN in the\n` +
          `  batch, so their passing grade in CI depends on another spec running first:\n` +
          [...baselineRed].map((g) => `    ${g}`).join("\n") +
          `\n  Each is reported inconclusive below rather than scored. Fix the isolation —\n` +
          `  a guard that only passes with company cannot be trusted to fail on its own.\n`,
      );
    }
  }
  // The FIRST playwright baseline builds dist/ (the preview may be stale or
  // absent); the rest reuse it, since nothing is mutated yet.
  let builtOnce = false;
  for (const g of pw) {
    const r = runPlaywright(g, { rebuild: !builtOnce });
    builtOnce = true;
    if (r.green) continue;
    /*
     * A RED BASELINE MUST SAY WHY. The verdict "guard is RED before any
     * mutation" was reported with the run's output thrown away, so an
     * environmental failure (a webServer that did not come up, a browser the
     * lock handed to someone else, one flaky test out of twenty) is
     * indistinguishable from a genuinely broken guard — and the operator has
     * nothing to act on. Measured 2026-09-21: activity-card-density.spec.ts
     * came back inconclusive in the gate and then passed 20/20 standing alone
     * two minutes later, with no evidence retained either way.
     *
     * Retried ONCE before being called red, for the same reason: the first
     * playwright run of a session pays the cold webServer build and is the
     * only one that can lose a race with it.
     */
    const again = runPlaywright(g, { rebuild: false });
    if (again.green) {
      process.stderr.write(
        `\n! ${g} was RED on its first baseline and GREEN on retry.\n` +
          `  Read the tail below before blaming the spec: a failed rebuild or a webServer that did\n` +
          `  not come up looks identical here to a genuinely flaky test. If it IS the spec, that is a\n` +
          `  finding — a guard that needs a retry gets ignored, and a real failure ignored with it.\n` +
          `  First run's tail:\n${c.dim(r.out.trim().split("\n").slice(-25).join("\n"))}\n`,
      );
      continue;
    }
    baselineRed.add(g);
    baselineWhy.set(g, again.out.trim().split("\n").slice(-25).join("\n"));
  }

  for (const m of mutations) {
    const id = `${m.guard} ⟵ ${m.target}`;
    if (baselineRed.has(m.guard)) {
      results.push({
        ...m,
        verdict: "inconclusive",
        why: "guard is RED before any mutation" + (baselineWhy.has(m.guard) ? `\n      ${baselineWhy.get(m.guard).replace(/\n/g, "\n      ")}` : ""),
      });
      onResult?.(results.at(-1));
      continue;
    }
    if (!allowDirty && !gitIsClean(m.target)) {
      results.push({ ...m, verdict: "skipped", why: `${m.target} has uncommitted changes (another lane may own it)` });
      onResult?.(results.at(-1));
      continue;
    }
    const abs = path.join(REPO, m.target);
    const original = fs.readFileSync(abs);
    live.set(abs, original);
    let verdict, why = "";
    const mutated = Buffer.from(original.toString("utf8").replace(m.find, m.replace));
    try {
      fs.writeFileSync(abs, mutated);
      const r = runGuard(m.guard, { rebuild: isPlaywrightGuard(m.guard) && needsRebuild(m.target) });
      if (r.timedOut) {
        verdict = "inconclusive";
        why = r.out.trim().split("\n").slice(0, 3).join("\n      ");
      } else {
        verdict = r.green ? "SURVIVED" : "killed";
      }
      if (r.green) why = "guard stayed GREEN with the mutation applied";
    } finally {
      // Another lane may have written this file inside the mutation window.
      // Restoring blindly would clobber their work, so restore ONLY when what
      // is on disk is still exactly the bytes we wrote.
      const now = fs.readFileSync(abs);
      if (now.equals(mutated)) {
        fs.writeFileSync(abs, original);
        if (!fs.readFileSync(abs).equals(original)) throw new Error(`restore verification failed for ${m.target}`);
      } else if (!now.equals(original)) {
        const backup = path.join(REPO, "node_modules", ".vacuity-rescue-" + path.basename(m.target));
        fs.writeFileSync(backup, original);
        process.stderr.write(
          `\n!! ${m.target} was written by something else while mutated. NOT restoring over it.\n` +
            `   Pre-mutation bytes saved to ${backup}\n`,
        );
      }
      live.delete(abs);
    }
    results.push({ ...m, verdict, why, id });
    onResult?.(results.at(-1));
  }
  return results;
}

export { runVitest, runPlaywright, runGuard };
