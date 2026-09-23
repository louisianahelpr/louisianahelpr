#!/usr/bin/env node
/**
 * rollback.mjs — the three undo paths, scripted (docs/OPEN.md Q69).
 * Runbook: docs/RUNBOOK-rollback.md. Guard: src/test/rollbackDryRunNeverMutates.test.ts.
 *
 *   node scripts/rollback/rollback.mjs web       [--to <deployment-url-or-id>]
 *   node scripts/rollback/rollback.mjs migration  --version <14-digit> [--down <file.sql>]
 *   node scripts/rollback/rollback.mjs function   --name <fn> [--to <git-sha>]
 *   node scripts/rollback/rollback.mjs plan       (all three, dry-run only)
 *
 * DRY-RUN IS THE DEFAULT. A dry run prints every command it WOULD run, in
 * order, and runs only the READ steps (listing deployments, reading git
 * history) so the plan names real ids. It never runs a step of kind "mutate".
 * `--offline` skips the reads too (prints them instead): what the guard uses.
 *
 * LIVE needs BOTH `--execute` and LH_ROLLBACK_CONFIRM=<path> (web, migration
 * or function) in the environment. Two independent switches, because the
 * failure this exists to prevent is a copy-pasted command doing the real thing.
 *
 * EVERY STEP IS TIMED and appended as one JSON line to the timing log
 * (default ~/.lh-rollback/timing.jsonl, override with --log <file>), dry run
 * included, so a drill leaves a record of how long each path took.
 *
 * Every external command goes through `step()`, which calls the binary named
 * by LH_ROLLBACK_BIN_<NAME> (default: the bare name on PATH). The guard puts
 * recording shims first on PATH and proves no mutating verb is ever invoked
 * in a dry run.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROJECT_REF = "fncmgoasalhdgfwzhsqa";
export const VERCEL_PROJECT = "louisianahelpr";
export const VERCEL_TEAM = "team_UQHppAVoPIPQbyh2b43y21BG";
const PATHS = ["web", "migration", "function"];

function parseArgs(argv) {
  const out = { path: argv[0], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out.flags[key] = next;
      i++;
    } else out.flags[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const LIVE = args.flags.execute === true && process.env.LH_ROLLBACK_CONFIRM === args.path;
const OFFLINE = args.flags.offline === true;
const LOG = args.flags.log || join(homedir(), ".lh-rollback", "timing.jsonl");
const RUN_ID = new Date().toISOString();
const started = Date.now();
let n = 0;

function bin(name) {
  return process.env[`LH_ROLLBACK_BIN_${name.toUpperCase()}`] || name;
}

function log(entry) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ run: RUN_ID, path: args.path, mode: LIVE ? "live" : "dry-run", ...entry }) + "\n");
  } catch (e) {
    console.error(`  (timing log not written: ${e.message})`);
  }
}

/**
 * One step. kind "read" runs in a dry run (unless --offline); kind "mutate"
 * runs ONLY when LIVE. Returns stdout ("" when not run).
 */
function step(kind, why, cmd, cmdArgs, opts = {}) {
  n += 1;
  const shown = `${cmd} ${cmdArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
  const willRun = kind === "read" ? !OFFLINE : LIVE;
  const tag = kind === "mutate" ? (LIVE ? "RUN   " : "WOULD ") : willRun ? "read  " : "WOULD ";
  console.log(`${String(n).padStart(2)}. [${tag}] ${why}\n      $ ${shown}`);
  if (!willRun) {
    log({ step: n, kind, why, cmd: shown, ran: false, ms: 0 });
    return "";
  }
  const t0 = Date.now();
  const r = spawnSync(bin(cmd), cmdArgs, { cwd: opts.cwd || REPO, encoding: "utf8", env: process.env });
  const ms = Date.now() - t0;
  const ok = r.status === 0 && !r.error;
  log({ step: n, kind, why, cmd: shown, ran: true, ok, ms });
  if (!ok) {
    const msg = r.error ? r.error.message : (r.stderr || "").trim().slice(0, 400);
    if (kind === "mutate") {
      console.error(`      FAILED after ${ms}ms: ${msg}`);
      process.exit(1);
    }
    console.log(`      (read failed after ${ms}ms, plan continues with a placeholder: ${msg})`);
    return "";
  }
  console.log(`      ok in ${ms}ms`);
  return (r.stdout || "").trim();
}

/** A local file write: the only non-command mutation. Same LIVE gate. */
function writeLocal(why, file, contents) {
  n += 1;
  console.log(`${String(n).padStart(2)}. [${LIVE ? "RUN   " : "WOULD "}] ${why}\n      write ${file} (${contents.length} bytes)`);
  log({ step: n, kind: "mutate", why, cmd: `write ${file}`, ran: LIVE, ms: 0 });
  if (LIVE) writeFileSync(file, contents);
}

function note(text) {
  console.log(`    - ${text}`);
}

// ─── 1. Web: Vercel instant rollback ─────────────────────────────────────────
function web() {
  console.log("\n== WEB: Vercel instant rollback of production ==");
  let target = typeof args.flags.to === "string" ? args.flags.to : "";
  if (!target) {
    const listed = step("read", "list recent production deployments (newest first)", "vercel", [
      "list", VERCEL_PROJECT, "--prod", "--scope", VERCEL_TEAM,
    ]);
    // Row 0 is what is live now; row 1 is the previous production deploy.
    const urls = [...listed.matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/g)].map((m) => m[0]);
    target = urls[1] || "<previous-production-deployment-url>";
    note(`target = ${target} (the deployment BEFORE the current one; pass --to to choose another)`);
  }
  step("read", "confirm the target is a READY production build", "vercel", ["inspect", target, "--scope", VERCEL_TEAM]);
  step("mutate", "point production traffic at the previous deployment (no rebuild)", "vercel", [
    "rollback", target, "--yes", "--scope", VERCEL_TEAM,
  ]);
  step("read", "wait for the rollback to finish", "vercel", ["rollback", "status", VERCEL_PROJECT, "--scope", VERCEL_TEAM, "--timeout", "3m"]);
  note("verify: the live site's <meta name=\"build-commit\"> shows the target's commit (runbook step 3); prod-freshness.yml goes red until the fix is promoted (expected).");
  note("undo the undo / ship the fix: `vercel promote <fixed-deployment-url>` (explicit, whatever the auto-assign state).");
  note("the NATIVE app is not affected: it bundles its own dist/ (capacitor.config.ts). See the runbook for the app-build path.");
}

// ─── 2. Migration: a forward revert migration, deployed by db-deploy ─────────
function migration() {
  console.log("\n== MIGRATION: revert a bad migration with a NEW forward migration ==");
  const version = typeof args.flags.version === "string" ? args.flags.version : "";
  if (!/^\d{14}$/.test(version)) {
    console.error("  --version <14-digit migration version> is required");
    process.exit(2);
  }
  const dir = join(REPO, "supabase/migrations");
  const bad = readdirSync(dir).find((f) => f.startsWith(`${version}_`));
  if (!bad) {
    console.error(`  no migration ${version}_*.sql in supabase/migrations`);
    process.exit(2);
  }
  const downFile = typeof args.flags.down === "string" ? resolve(args.flags.down) : join(REPO, "supabase/rollbacks", `${version}.down.sql`);
  note(`bad migration: supabase/migrations/${bad} — it is NEVER deleted or renamed (prod's schema_migrations holds its version).`);
  note(`down SQL: ${downFile}${existsSync(downFile) ? "" : "  (MISSING: write it first; the runbook says how)"}`);
  if (LIVE && !existsSync(downFile)) {
    console.error("  LIVE revert refused: the down SQL file does not exist (see the runbook, step M2).");
    process.exit(2);
  }
  step("read", "confirm prod has applied it (both columns must show the version)", "supabase", ["migration", "list", "--linked"]);
  step("read", "who else touched the same objects since (a revert must not undo their work)", "git", [
    "log", "--oneline", "-n", "20", "--", "supabase/migrations",
  ]);
  const slug = `revert_${version}`;
  // Same clock-stamp rule as scripts/new-migration.mjs; never hand-typed.
  step("mutate", "stamp the revert migration (collision-safe version)", "npm", ["run", "migration:new", "--", slug, `revert ${bad}`]);
  const header =
    `-- Revert of ${bad} (docs/RUNBOOK-rollback.md, scripts/rollback/rollback.mjs).\n` +
    `-- Replay-safe: every statement is guarded (IF EXISTS / to_regprocedure) so a\n` +
    `-- fresh replay of the whole history, where ${version} ran just before, is a no-op-safe undo.\n`;
  const body = existsSync(downFile) ? readFileSync(downFile, "utf8") : "-- <down SQL goes here>\n";
  const stamped = LIVE ? readdirSync(dir).find((f) => f.endsWith(`_${slug}.sql`)) : undefined;
  const revertFile = join(dir, stamped || `<new-version>_${slug}.sql`);
  writeLocal("write the down SQL into the new migration", revertFile, header + body);
  step("mutate", "prove it in PGlite: bad once, then the revert 3x (replay-safety), per CLAUDE.md", "node", [
    "scripts/rollback/pglite-apply.mjs", join(dir, bad), revertFile, "3",
  ]);
  step("mutate", "commit the revert migration", "git", ["commit", "-m", `revert migration ${version}`, "--", "supabase/migrations"]);
  step("mutate", "push to main: db-deploy.yml applies it to prod (the ONLY way migrations reach prod)", "git", ["push", "origin", "HEAD:main"]);
  note("then watch db-deploy to green and verify by object state (to_regclass / pg_get_functiondef), never by run colour.");
  note("dropping a column/table in the revert trips check-destructive-ddl: add the three DESTRUCTIVE-DDL-ACK lines it names.");
}

// ─── 3. Edge function: redeploy the previous version from git ───────────────
function fn() {
  console.log("\n== EDGE FUNCTION: redeploy a previous version ==");
  const name = typeof args.flags.name === "string" ? args.flags.name : "";
  if (!name || !existsSync(join(REPO, "supabase/functions", name))) {
    console.error(`  --name <function> is required and must exist under supabase/functions (got "${name}")`);
    process.exit(2);
  }
  let sha = typeof args.flags.to === "string" ? args.flags.to : "";
  if (!sha) {
    const hist = step("read", "last two commits that changed this function or _shared", "git", [
      "log", "-n", "2", "--format=%H", "--", `supabase/functions/${name}`, "supabase/functions/_shared",
    ]);
    sha = hist.split("\n")[1] || "<previous-sha>";
    note(`target = ${sha} (the commit BEFORE the latest change; pass --to to choose another)`);
  }
  step("read", "what prod runs now (version + updated_at)", "supabase", ["functions", "list", "--project-ref", PROJECT_REF]);
  const tree = join(tmpdir(), `lh-rollback-${name}-${Date.now()}`);
  step("mutate", "check the previous version out beside this tree (no branch switch here)", "git", ["worktree", "add", "--detach", tree, sha]);
  step("mutate", "deploy that version to prod", "supabase", ["functions", "deploy", name, "--project-ref", PROJECT_REF, "--workdir", tree]);
  step("mutate", "remove the temporary checkout", "git", ["worktree", "remove", "--force", tree]);
  note("functions-deploy.yml redeploys main's copy on the next push touching this function or _shared:");
  note("land `git revert <bad-sha>` on main too, or the rollback is silently undone.");
}

if (!PATHS.includes(args.path) && args.path !== "plan") {
  console.error("usage: rollback.mjs <web|migration|function|plan> [--execute] [--offline] [--log file] ...\n  see docs/RUNBOOK-rollback.md");
  process.exit(2);
}
if (args.flags.execute && !LIVE) {
  console.error(`--execute given but LH_ROLLBACK_CONFIRM is not "${args.path}": refusing, running as a DRY RUN instead.`);
}
if (args.path === "plan" && args.flags.execute) {
  console.error("plan is dry-run only.");
  process.exit(2);
}
console.log(`rollback ${args.path}: ${LIVE ? "LIVE — mutating steps WILL run" : "DRY RUN — nothing is changed"}${OFFLINE ? " (offline: reads printed, not run)" : ""}`);
if (args.path === "web" || args.path === "plan") web();
if (args.path === "migration" || args.path === "plan") {
  if (args.path === "plan" && !args.flags.version) args.flags.version = readdirSync(join(REPO, "supabase/migrations")).filter((f) => /^\d{14}_/.test(f)).sort().at(-1).slice(0, 14);
  migration();
}
if (args.path === "function" || args.path === "plan") {
  if (args.path === "plan" && !args.flags.name) args.flags.name = "create-payment";
  fn();
}
const total = Date.now() - started;
log({ step: "total", kind: "summary", ran: LIVE, ms: total });
console.log(`\n${LIVE ? "Done" : "Dry run done"} in ${total}ms. Timing log: ${LOG}`);
