#!/usr/bin/env node
/**
 * How much of a vacuity run needs the shared prod test accounts? (docs/OPEN.md Q551)
 *
 * vacuity.yml splits its mutation phase in two: the plain-vitest registrations
 * run in a job with no credentials, and the Playwright ones (guards under e2e/,
 * which sign in as the shared poster/helper accounts) run in `vacuity-e2e`,
 * which holds `prod-lifecycle-shared-accounts`. A job-level lock is taken
 * BEFORE any step runs, so the lock job must not even be queued when a push
 * touched no e2e guard: this script, run by the lock-free `scope` job, says so.
 * It selects registrations with the SAME function the gate uses
 * (run.mjs scopeMutations), so the two cannot disagree.
 *
 *   node scripts/vacuity/scope.mjs [--all | --only a,b]
 *       prints `e2e=<n> unit=<n>` and, when $GITHUB_OUTPUT is set, writes
 *       have_e2e=true|false, e2e_count=<n> and unit_count=<n>.
 *
 * No dependencies beyond node: the scope job runs before `npm install`.
 * Guard: src/test/vacuityE2eIsLocked.test.ts.
 */
import { appendFileSync } from "node:fs";
import { changedFiles } from "./lib.mjs";
import { collectMutations, scopeMutations, selectKind } from "./run.mjs";

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null;

const { mutations, errors } = collectMutations();
const sel = scopeMutations(mutations, { all, only, changed: only || all ? null : changedFiles() });
// A registration or --only error is the gate's to report (index.mjs fails on it
// in the unit job); here it must not hide the lock job when e2e work is selected.
for (const e of [...errors, ...sel.errors]) console.log(`::warning title=vacuity scope::${e}`);
const e2e = selectKind(sel.scoped, "e2e").length;
const unit = selectKind(sel.scoped, "unit").length;
console.log(`e2e=${e2e} unit=${unit}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `have_e2e=${e2e > 0}\ne2e_count=${e2e}\nunit_count=${unit}\n`);
