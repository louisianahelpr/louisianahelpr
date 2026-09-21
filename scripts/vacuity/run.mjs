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
  return { green: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
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
export const needsRebuild = (target) => target.startsWith("src/");

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

function runPlaywright(guard, { rebuild = false } = {}) {
  if (rebuild) {
    const b = runBuild();
    if (!b.ok) return { green: false, out: "npm run build FAILED before the spec ran:\n" + b.out.slice(-4000) };
  }
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, "node_modules", "@playwright", "test", "cli.js"),
     "test", guard, `--project=${PW_PROJECT(guard)}`, "--reporter=line", "--workers=1"],
    {
      cwd: REPO, encoding: "utf8", timeout: 900_000,
      env: {
        ...process.env,
        PLAYWRIGHT_WEB_SERVER: "1",
        ...BUILD_ENV,
        // NOT CI: `reuseExistingServer: !CI` is what stops a second build.
        CI: "",
        LH_VACUITY_TRACE: "",
      },
    },
  );
  return { green: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/** Dispatch one guard to the engine that can actually execute it. */
function runGuard(guard, { rebuild = false } = {}) {
  return isPlaywrightGuard(guard) ? runPlaywright(guard, { rebuild }) : runVitest([guard]);
}

/** Collect every registered mutation, plus every registration error. */
export function collectMutations(guards = guardFiles()) {
  const mutations = [];
  const errors = [];
  const exemptions = [];
  for (const g of guards) {
    const { mutations: ms, exemptions: es } = parseDirectives(g);
    exemptions.push(...es);
    for (const m of ms) {
      if (m.malformed) {
        errors.push(`${g}:${m.line} malformed @mutate — need "<file> | <find> | <replace>": ${m.raw}`);
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

  // One batched baseline run: a guard that is already red proves nothing, and
  // running each guard twice would double the wall clock for no information.
  const guards = [...new Set(mutations.map((m) => m.guard))];
  const baselineRed = new Set();
  const baselineWhy = new Map();
  // Playwright guards cannot be batched into one vitest invocation; each is
  // its own CLI run against the built preview.
  const pw = guards.filter(isPlaywrightGuard);
  const vt = guards.filter((g) => !isPlaywrightGuard(g));
  if (vt.length) {
    const b = runVitest(vt);
    if (!b.green) {
      // Narrow: find which ones are red, one at a time, only when the batch is red.
      for (const g of vt) if (!runVitest([g]).green) baselineRed.add(g);
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
      verdict = r.green ? "SURVIVED" : "killed";
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
