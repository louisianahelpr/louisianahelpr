#!/usr/bin/env node
/**
 * `npm run vacuity` — the gate behind CLAUDE.md's "every check must be shown
 * able to fail".
 *
 * Four parts, cheapest first, so the expensive one only runs on what changed:
 *
 *   1. RATCHET (ms). Every guard in src/test must either register a mutation
 *      or be listed in src/test/vacuity.baseline.json. A NEW guard with no
 *      mutation fails the push. The baseline may only shrink — a stale entry
 *      is itself a failure, so it cannot rot into a permanent excuse.
 *   2. SCAN (~1s). Static detectors for the vacuity classes a parser can
 *      honestly decide: empty-inventory (a) and self-referential inventory
 *      (d), plus the mount-wiring report (b). Also ratcheted.
 *   3. PREFLIGHT (~150ms). Is the harness real — browsers installed, tracer
 *      wired, mock clauses actually recorded.
 *   4. MUTATE. For each registered mutation: break the guarded source, run
 *      ONLY that guard, and fail if the guard stayed green. Default scope is
 *      what changed vs origin/main; `--all` is the full set (weekly in vacuity.yml).
 *
 * Usage:
 *   node scripts/vacuity/index.mjs              # per-push: ratchet+scan+preflight+changed mutations
 *   node scripts/vacuity/index.mjs --all        # weekly (vacuity.yml): every registered mutation
 *   node scripts/vacuity/index.mjs --report     # no gate, print the full vacuity report
 */
import fs from "node:fs";
import path from "node:path";
import { REPO, guardFiles, untrackedGuardFiles, parseDirectives, loadBaseline, BASELINE_PATH, changedFiles, c } from "./lib.mjs";
import { scanAll } from "./scan.mjs";
import { preflight } from "./preflight.mjs";
import { collectMutations, runMutations } from "./run.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const ALL = has("--all");
const REPORT_ONLY = has("--report");
const NO_MUTATE = has("--no-mutate");

let failed = 0;
const fail = (msg) => { failed++; console.error(`\n${c.red("✗ VACUITY")} ${msg}`); };
const ok = (msg) => console.log(`${c.green("✓")} ${msg}`);

const t0 = Date.now();
const guards = guardFiles();
const baseline = loadBaseline();

// ── 1. RATCHET: every guard registers a mutation, or is grandfathered ───────
const registration = new Map();
for (const g of guards) {
  const { mutations, exemptions } = parseDirectives(g);
  registration.set(g, { mutations, exemptions });
}
const unregistered = guards.filter(
  (g) => registration.get(g).mutations.length === 0 && registration.get(g).exemptions.length === 0,
);
const grandfathered = new Set(baseline.unregistered ?? []);
const newlyUnregistered = unregistered.filter((g) => !grandfathered.has(g));
const staleBaseline = [...grandfathered].filter((g) => !unregistered.includes(g));

if (newlyUnregistered.length) {
  fail(
    `${newlyUnregistered.length} guard(s) declare no mutation and are not in ${BASELINE_PATH}.\n` +
      `  A guard nobody has shown able to fail is not a guard. Add ONE line to each:\n` +
      `    // @mutate <file the guard protects> | <text to break> | <replacement>\n` +
      newlyUnregistered.map((g) => `    ${c.bold(g)}`).join("\n"),
  );
} else {
  /*
   * THREE CATEGORIES, NOT TWO. An @mutate-exempt guard satisfies `unregistered`
   * (see the filter above, which accepts EITHER a mutation or an exemption), so
   * until 2026-09-21 it was counted inside "registers a mutation" — and an
   * exemption then read as proof. That is the mirror of the complaint that a
   * lumped total reads as debt: lumped the other way, it reads as coverage.
   *
   * An exemption is a RECORDED GAP. It belongs in its own number, printed every
   * run, so the headline cannot drift away from what is actually proven.
   */
  const exempted = guards.filter((g) => registration.get(g).mutations.length === 0 && registration.get(g).exemptions.length > 0);
  const proven = guards.length - unregistered.length - exempted.length;
  ok(`registration: ${proven}/${guards.length} guards register a mutation (${exempted.length} exempt with a reason, ${grandfathered.size} grandfathered)`);
  if (exempted.length) {
    console.log(
      `${c.bold("  exempt")} — the gate cannot express a mutation for these; each reason must say how the guard IS shown able to fail, or that nothing does:\n` +
        exempted.map((g) => `    ${g}\n      ${String(registration.get(g).exemptions[0]?.reason ?? "").slice(0, 160)}`).join("\n"),
    );
  }
}

if (staleBaseline.length)
  fail(
    `${BASELINE_PATH} is stale — these are no longer unregistered (or no longer exist). The baseline may only SHRINK; remove them:\n` +
      staleBaseline.map((g) => `    ${g}`).join("\n"),
  );

// ── 2. SCAN ─────────────────────────────────────────────────────────────────
const scan = scanAll();
const classA = scan.guards.filter((g) => g.classA).map((g) => g.file);
const classD = scan.guards.filter((g) => g.classD);
const aBaseline = new Set(baseline.noInventoryFloor ?? []);
const newA = classA.filter((f) => !aBaseline.has(f));
const staleA = [...aBaseline].filter((f) => !classA.includes(f));

if (newA.length)
  fail(
    `${newA.length} guard(s) read the world, iterate what they find, and never assert the inventory is non-empty.\n` +
      `  An empty inventory makes every per-member assertion pass. Add a floor:\n` +
      `    expect(FILES.length).toBeGreaterThan(<a number you checked>);\n` +
      newA.map((f) => `    ${c.bold(f)}`).join("\n"),
  );
else ok(`class (a) empty-inventory: ${classA.length} known, 0 new (${scan.guards.filter((g) => g.inventoryDriven).length} guards are inventory-driven)`);

if (staleA.length)
  fail(`${BASELINE_PATH}.noInventoryFloor is stale — these now have a floor, remove them:\n` + staleA.map((f) => `    ${f}`).join("\n"));

const dBaseline = new Set(baseline.selfReferential ?? []);
const newD = classD.filter((g) => !dBaseline.has(g.file));
if (newD.length)
  fail(
    `${newD.length} guard(s) iterate a list declared in the test file and assert only about that list — input and oracle are the same thing, so it cannot fail for a missing member:\n` +
      newD.map((g) => `    ${c.bold(g.file)}  ${c.dim(g.selfReferential[0])}`).join("\n"),
  );
else ok(`class (d) self-referential inventory: ${classD.length} known, 0 new`);

// TWO-WAY, same as every other section: a grandfathered self-referential guard
// that is no longer detected as one (fixed, or deleted) must leave the list.
const staleD = [...dBaseline].filter((f) => !classD.some((g) => g.file === f));
if (staleD.length)
  fail(
    `${BASELINE_PATH}.selfReferential is stale — these are no longer self-referential (or no longer exist). ` +
      `stale baseline entry — remove it (lower the baseline):\n` +
      staleD.map((f) => `    ${f}`).join("\n"),
  );

// ── 3. PREFLIGHT ────────────────────────────────────────────────────────────
const pf = await preflight();
const pfFail = pf.filter((f) => f.severity === "fail");
for (const f of pf) {
  const line = `${f.id}: ${f.msg}${f.detail ? `\n  ${c.dim(f.detail)}` : ""}`;
  if (f.severity === "fail") fail(`harness — ${line}`);
  else console.log(`${c.yellow("!")} ${line}`);
}
if (!pfFail.length) ok(`harness preflight: ${pf.length - pfFail.length} advisory, 0 blocking`);

// ── 4. MUTATE ───────────────────────────────────────────────────────────────
/*
 * A guard that exists but is not yet `git add`ed still gets mutated. The
 * ratchet above stays tracked-only (an untracked scratch spec must not make
 * someone else's push red), but a brand-new guard is precisely the one whose
 * ability to fail has never been demonstrated — see untrackedGuardFiles().
 */
const { mutations, errors } = collectMutations([...guards, ...untrackedGuardFiles()]);
for (const e of errors) fail(`registration — ${e}`);

// TWO-WAY, statically (no mutation run needed): a survivingMutations entry
// that names no registered @mutate line any more can never be re-checked —
// the guard or its registration is gone — so it is stale.
{
  const registered = new Set(mutations.map((m) => `${m.guard}|${m.target}|${m.find}`));
  const orphanSurvivors = (baseline.survivingMutations ?? []).filter((k) => !registered.has(k));
  if (orphanSurvivors.length)
    fail(
      `${BASELINE_PATH}.survivingMutations names registrations that no longer exist. ` +
        `stale baseline entry — remove it (lower the baseline):\n` +
        orphanSurvivors.map((k) => `    ${k}`).join("\n"),
    );
}

let scoped = mutations;
if (!ALL && !REPORT_ONLY) {
  const changed = changedFiles();
  scoped = changed
    ? mutations.filter((m) => changed.has(m.guard) || changed.has(m.target))
    : mutations;
}

if (!NO_MUTATE && !REPORT_ONLY && scoped.length) {
  console.log(`\n${c.bold("mutating")} ${scoped.length} registration(s)${ALL ? " (full set)" : " (changed since origin/main)"}…`);
  const results = runMutations(scoped, {
    onResult: (r) => {
      const tag =
        r.verdict === "killed" ? c.green("killed  ") :
        r.verdict === "SURVIVED" ? c.red("SURVIVED") :
        c.yellow(r.verdict.padEnd(8));
      console.log(`  ${tag} ${r.guard} ⟵ ${r.target}${r.why ? c.dim("  (" + r.why + ")") : ""}`);
    },
  });
  const key = (r) => `${r.guard}|${r.target}|${r.find}`;
  const knownSurvivors = new Set(baseline.survivingMutations ?? []);
  const survived = results.filter((r) => r.verdict === "SURVIVED");
  const newSurvivors = survived.filter((r) => !knownSurvivors.has(key(r)));
  const known = survived.filter((r) => knownSurvivors.has(key(r)));

  for (const s of newSurvivors)
    fail(
      `${s.guard} SURVIVED its own mutation.\n` +
        `  Broke ${s.target}: ${JSON.stringify(s.find)} → ${JSON.stringify(s.replace)}\n` +
        `  The guard stayed GREEN. It is not protecting what it claims to protect.`,
    );
  for (const s of known)
    console.log(
      `${c.yellow("! KNOWN VACUOUS")} ${s.guard} survives breaking ${s.target} ` +
        `(${JSON.stringify(s.find).slice(0, 60)}). Listed in ${BASELINE_PATH}; the list may only shrink.`,
    );
  // A survivor that has been FIXED must leave the baseline, or the baseline
  // rots into a permanent excuse — same ratchet as every other class here.
  const stillListed = new Set(results.filter((r) => r.verdict === "SURVIVED").map(key));
  const nowKilled = results.filter((r) => r.verdict === "killed" && knownSurvivors.has(key(r)));
  // Was `nowKilled.length && !stillListed.size` until 2026-09-22: a fixed
  // survivor only failed when NO other survivor remained, so one vacuous guard
  // left in the list shielded every fixed one beside it. Any kill is stale.
  void stillListed;
  if (nowKilled.length)
    fail(
      `${BASELINE_PATH}.survivingMutations is stale — these mutations now KILL their guard. Remove them:\n` +
        nowKilled.map((r) => `    ${key(r)}`).join("\n"),
    );
  /*
   * AN INCONCLUSIVE BATCH IS NOT A PASS.
   *
   * `inconclusive` means the guard was already RED before anything was broken,
   * so breaking the code told us nothing. The commonest cause is environmental:
   * in an agent worktree with no resolvable vitest, EVERY registration comes
   * back inconclusive — and until now the run still printed a green
   * "mutation: 0/6 killed … 6 not run" and exited 0. Reported 2026-09-21 by a
   * lane that hit exactly that and had to symlink node_modules to get real
   * verdicts.
   *
   * The gate whose entire purpose is "every check must be shown able to fail"
   * was itself reporting green while blind, in the environment where most agent
   * work happens. That is the same defect it exists to find, one level up.
   *
   * `skipped` is different and stays green: it means the target file has
   * uncommitted changes and another lane may own it — a deliberate refusal to
   * act, not a failure to observe.
   */
  const inconclusive = results.filter((r) => /inconc/.test(r.verdict));
  if (inconclusive.length)
    fail(
      `mutation: ${inconclusive.length} of ${results.length} registration(s) INCONCLUSIVE — the guard was ` +
        `already red before any mutation, so nothing was proven. This is usually the environment (no ` +
        `resolvable vitest in this worktree), not the code. A run that could not observe anything is not ` +
        `a run that found nothing:\n` +
        inconclusive.map((r) => `    ${r.guard} ⟵ ${r.target}  (${r.why ?? "unknown"})`).join("\n"),
    );
  else if (!newSurvivors.length && results.length) {
    const skipped = results.filter((r) => /skip/.test(r.verdict));
    /*
     * A RUN THAT MUTATED NOTHING IS NOT A PASS.
     *
     * A single skip is legitimate and deliberate: the target has uncommitted
     * changes, so another lane may own it and mutating it would corrupt their
     * work. But if EVERY registration in scope skipped, the phase observed
     * nothing at all — and until now it printed "N/N killed, N not run" with a
     * green tick, which is the same green-while-blind shape as the
     * all-inconclusive case (see the `inconclusive` block above).
     *
     * This happens for real: two concurrent `npm run vacuity` runs in ONE tree
     * downgrade each other's mutations to "not run", because each sees the
     * other's in-flight edit as an uncommitted change. Reported 2026-09-21 by a
     * lane whose money-path mutation was skipped that way and had to be
     * reproduced by hand.
     */
    if (skipped.length === results.length)
      fail(
        `mutation: ALL ${results.length} registration(s) in scope were skipped — nothing was mutated, so ` +
          `nothing was proven. A skip means a target had uncommitted changes (commonly another lane, or a ` +
          `second vacuity run in the same tree). Re-run on a clean tree:\n` +
          skipped.map((r) => `    ${r.guard} ⟵ ${r.target}  (${r.why ?? "unknown"})`).join("\n"),
      );
    else
      ok(
        `mutation: ${results.filter((r) => r.verdict === "killed").length}/${results.length} killed, ` +
          `${known.length} known-vacuous, ${skipped.length} not run` +
          (skipped.length ? c.yellow(`  — ${skipped.length} SKIPPED target(s) are unproven this run`) : ""),
      );
  }
} else if (!scoped.length) {
  ok("mutation: nothing in scope (no guard or guarded file changed since origin/main)");
}

// ── Report ──────────────────────────────────────────────────────────────────
if (REPORT_ONLY) {
  const out = {
    generated: new Date().toISOString(),
    guards: guards.length,
    registered: guards.length - unregistered.length,
    unregistered,
    classA_noInventoryFloor: classA,
    classD_selfReferential: classD.map((g) => ({ file: g.file, why: g.selfReferential })),
    classB_mountWiring: scan.mount,
    edge_classA: scan.edge.filter((g) => g.classA).map((g) => g.file),
    // NOT the harness preflight: it describes the MACHINE (browsers, .env,
    // secrets), so a committed copy made on one host never matched a CI
    // regeneration and check:generated went red on every push (2026-09-23).
    // It is printed above on every run; the file holds facts about the code.
  };
  const dest = path.join(REPO, "docs", "audit", "vacuity-report.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`\nreport → ${path.relative(REPO, dest)}`);
}

console.log(`\n${c.dim(`vacuity: ${((Date.now() - t0) / 1000).toFixed(1)}s`)}`);
if (failed) {
  console.error(`\n${c.red(`${failed} vacuity failure(s).`)} CLAUDE.md: "every check must be shown able to fail".`);
  process.exit(1);
}
