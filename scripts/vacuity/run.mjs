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
  if (guards.length) {
    const b = runVitest(guards);
    if (!b.green) {
      // Narrow: find which ones are red, one at a time, only when the batch is red.
      for (const g of guards) if (!runVitest([g]).green) baselineRed.add(g);
    }
  }

  for (const m of mutations) {
    const id = `${m.guard} ⟵ ${m.target}`;
    if (baselineRed.has(m.guard)) {
      results.push({ ...m, verdict: "inconclusive", why: "guard is RED before any mutation" });
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
      const r = runVitest([m.guard]);
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

export { runVitest };
