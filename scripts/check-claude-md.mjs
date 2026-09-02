#!/usr/bin/env node
/**
 * Fail if CLAUDE.md makes a claim that is no longer true.
 *
 * WHY THIS EXISTS
 * CLAUDE.md is a mirror of reality with no freshness guard — the same shape as
 * `types.ts` before `check-types-fresh.mjs`, and it drifts the same way. On
 * 2026-09-02 two of its statements were stale, and both were the dangerous kind:
 * stated as settled fact, in a file every agent reads first and trusts.
 *
 *   1. A long passage said push notifications were broken because the
 *      AppDelegate never posts `.capacitorDidRegisterForRemoteNotifications`.
 *      It does — `AppDelegate.swift:127-140`, verified against the plugin's own
 *      source. Every agent that read that file went hunting a closed bug.
 *   2. It instructed running `code-reviewer`, `silent-failure-hunter` and
 *      `security-auditor` before any money/auth/data-model commit. None of the
 *      three exists, so the guard silently never ran on a repo whose entire
 *      safety argument is "we review the diff because there is no PR gate".
 *
 * The owner asked whether the file should simply be deleted. The evidence says
 * no: the same file's "verify CSS against dist, not the dev server" rule is the
 * only reason a defect was found that left every Chromium visitor seeing a flat,
 * un-frosted app in production, and its "never await a Capacitor plugin object"
 * rule was checked across 28 dynamic imports and had prevented the bug
 * everywhere. Deleting it would discard rules that actively catch defects to
 * solve a staleness problem that has a guard-shaped answer.
 *
 * WHAT THIS CAN AND CANNOT CHECK
 * It checks the MECHANICAL claims — paths, line numbers, script names, agent and
 * skill names, the project ref. It cannot check prose. A sentence like "the
 * minifier keeps only the LAST declaration" is not verifiable here, and pretending
 * otherwise would be the vacuous-pass bug this repo keeps hitting. So the report
 * always states how many claims it actually checked; a number that collapses is
 * itself the signal.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FILE = "CLAUDE.md";
if (!existsSync(FILE)) {
  console.error(`✖ ${FILE} not found — run from the repo root.`);
  process.exit(1);
}
const text = readFileSync(FILE, "utf8");
const problems = [];
let checked = 0;

// ── 1. `path:line` citations — the file exists AND is long enough ───────────
// A citation pointing past the end of a file is the clearest possible proof the
// surrounding sentence was written against a different version.
// Anchored on a backtick or whitespace, and node_modules paths are allowed —
// otherwise a citation like
// `node_modules/@capacitor/push-notifications/ios/Sources/...swift:38` is
// captured from `ios/` onward and reported as a missing file. That was this
// checker's own first false positive.
for (const m of text.matchAll(/(?:^|[`\s(])((?:node_modules|src|ios|supabase|scripts|e2e|docs)\/[A-Za-z0-9_@./-]+\.(?:ts|tsx|swift|css|sql|mjs|yml)):(\d+)/gm)) {
  const [, path, lineStr] = m;
  checked++;
  if (!existsSync(path)) { problems.push(`cites ${path}:${lineStr} — file does not exist`); continue; }
  const lines = readFileSync(path, "utf8").split("\n").length;
  if (Number(lineStr) > lines) {
    problems.push(`cites ${path}:${lineStr} — file has only ${lines} lines`);
  }
}

// ── 1b. BARE filename citations, e.g. `AppDelegate.swift:127` ──────────────
// Found by testing this checker against an injected regression: T1 (a line
// number past end of file) did NOT fire, because CLAUDE.md cites most files by
// bare name with no directory. Without this the commonest citation form in the
// document was entirely unchecked — the checker would have passed forever while
// missing the exact drift it exists to catch.
const repoFiles = new Map();
(function index(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    // `.claude/worktrees` holds other agents' checkouts, often at old commits.
    // Indexing them made a bare-name citation resolve to a stale 49-line copy of
    // AppDelegate.swift instead of the real 200-line one — a confident,
    // completely wrong failure. Only the working tree counts.
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" ||
        e.name === "worktrees" || e.name === ".lh-audit" || e.name === "coverage") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) index(full);
    else if (!repoFiles.has(e.name)) repoFiles.set(e.name, full);
  }
})(".");

for (const m of text.matchAll(/`([A-Za-z0-9_]+\.(?:ts|tsx|swift|css|sql|mjs)):(\d+)/g)) {
  const [, base, lineStr] = m;
  const resolved = repoFiles.get(base);
  checked++;
  if (!resolved) { problems.push(`cites \`${base}:${lineStr}\` — no file named ${base} in the repo`); continue; }
  const lines = readFileSync(resolved, "utf8").split("\n").length;
  if (Number(lineStr) > lines) {
    problems.push(`cites \`${base}:${lineStr}\` — ${resolved} has only ${lines} lines`);
  }
}

// ── 2. Repo-relative paths in backticks ────────────────────────────────────
// Local-only artifacts, deliberately NOT tracked by git. They exist on a
// developer's machine and never in CI or a fresh worktree, so requiring them
// would make this guard fail 100% of the time in the one place it runs
// automatically — which is how a guard gets disabled by whoever is unblocking
// the build. Found by running this checker in a clean worktree rather than in
// the tree I wrote it in; the same class of mistake as check-types-fresh.mjs
// trusting an env var. The list is explicit and short ON PURPOSE: skipping
// "anything gitignored" would also skip a file that was genuinely deleted.
const LOCAL_ONLY = new Set(["supabase/.temp/project-ref"]);

for (const m of text.matchAll(/`((?:src|ios|supabase|scripts|e2e|docs|\.github|\.claude)\/[A-Za-z0-9_./*-]+)`/g)) {
  const path = m[1];
  if (path.includes("*")) continue; // globs are illustrative, not claims
  if (LOCAL_ONLY.has(path)) continue;
  checked++;
  if (!existsSync(path)) problems.push(`cites path \`${path}\` — does not exist`);
}

// ── 3. npm scripts it tells you to run ─────────────────────────────────────
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const m of text.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
  const script = m[1];
  checked++;
  if (!pkg.scripts?.[script]) problems.push(`says \`npm run ${script}\` — no such script in package.json`);
}

// ── 4. Agent and skill names ───────────────────────────────────────────────
// This is the failure that actually disabled a guard: three named agents that
// did not exist, so the spawn failed inside an agent's context and the review
// silently never happened.
const known = new Set();
try { for (const f of readdirSync(".claude/agents")) if (f.endsWith(".md")) known.add(f.replace(/\.md$/, "")); } catch { /* none */ }
try { for (const d of readdirSync(".claude/skills", { withFileTypes: true })) if (d.isDirectory()) known.add(d.name); } catch { /* none */ }
try { for (const f of readdirSync(".claude/commands")) if (f.endsWith(".md")) known.add(f.replace(/\.md$/, "")); } catch { /* none */ }

// Every backticked `lh-*` name must resolve — no verb heuristic.
//
// This started as "only flag names used imperatively", matching run/dispatch/
// spawn/invoke on the same line. That guess failed in BOTH directions and I
// only found out by testing the checker against injected drift:
//   - False negative: CLAUDE.md wraps its bullets, so `lh-silent-failure` sits
//     on line 346 while the verb that governs it is on 345. The single most
//     important name in the document — one of the three review agents whose
//     absence silently disabled the money/auth review — was UNCHECKED.
//   - False positive: "`lh-deps-and-drift` hung 19 hours on a blocked merge" is
//     a past session, but its bullet opens "resolve or abort within the run",
//     so any block-level version of the same heuristic flags it too.
// A name is either a real address or it is not; that is decidable, so decide it
// instead of inferring intent from nearby words. PROSE_ONLY is the escape
// hatch, and it is deliberately explicit: adding a name here is a conscious
// statement that it is history, not an address.
const PROSE_ONLY = new Map([
  ["lh-deps-and-drift", "a past session recounted in the git-idling rule, not an agent"],
]);

for (const m of text.matchAll(/`(lh-[a-z0-9-]+)`/g)) {
  const name = m[1];
  if (PROSE_ONLY.has(name)) continue;
  checked++;
  if (!known.has(name)) problems.push(`names \`${name}\` — no such agent, skill or command`);
}

// ── 4b. CSS declarations quoted from the stylesheet ────────────────────────
// The failure this catches, verbatim: CLAUDE.md told every agent that the
// desktop rail inset was `.app-shell-frame { left: var(--desktop-sidebar-w) }`
// and `#root { padding-left: var(--desktop-sidebar-w) }`. NEITHER DECLARATION
// EXISTED. The rail had moved to the right edge and the only two insets in the
// whole stylesheet were `right:` and `padding-right:`. The paragraph read as a
// precise, quotable fact — it quoted CSS — which is exactly what made it
// dangerous: a lane measured the rail on the wrong edge because the document
// told it which edge to look at.
//
// Only declarations naming a CSS CUSTOM PROPERTY are checked. A bare
// `display: grid` is prose; `padding-left: var(--desktop-sidebar-w)` is a
// quotation from a specific file and either appears there or does not.
const cssFiles = ["src/index.css"].filter(existsSync);
if (cssFiles.length) {
  const css = cssFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const haystack = norm(css);
  for (const m of text.matchAll(/`([a-z-]+:\s*var\(--[a-z0-9-]+\))[^`]*`/gi)) {
    const decl = norm(m[1]);
    // A leading `no ` / `not ` marks a declaration the document is BANNING, not
    // quoting — "no per-page `paddingLeft: var(--desktop-sidebar-w)`" must not
    // require that the banned thing exist.
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    if (/\b(no|not|never|without)\b[^.]*$/.test(before)) continue;
    checked++;
    if (!haystack.includes(decl)) {
      problems.push(`quotes CSS \`${decl}\` — that declaration is not in ${cssFiles.join(", ")}`);
    }
  }
}

// ── 5. The Supabase project refs ───────────────────────────────────────────
// CLAUDE.md states which ref is prod and which is staging, and that the linked
// CLI points at staging. That last claim has been true all day and is exactly
// the kind that silently stops being true.
const PROD = "fncmgoasalhdgfwzhsqa";
const STAGING = "okpxtpfvwtmbuxugqsws";
if (text.includes(PROD) || text.includes(STAGING)) {
  checked++;
  const linkedPath = "supabase/.temp/project-ref";
  if (existsSync(linkedPath)) {
    const linked = readFileSync(linkedPath, "utf8").trim();
    const claimsStaging = /points at \*\*staging\*\*|currently points at \*staging\*/i.test(text);
    if (claimsStaging && linked !== STAGING) {
      problems.push(
        `says the linked CLI points at STAGING, but supabase/.temp/project-ref is "${linked}"` +
          (linked === PROD ? " — that is PROD, and the warning is now inverted" : ""),
      );
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
if (checked === 0) {
  console.error("✖ Parsed ZERO checkable claims from CLAUDE.md.");
  console.error("  A checker that finds nothing passes for exactly the reason it exists");
  console.error("  to prevent. Refusing to report success.");
  process.exit(1);
}

if (problems.length === 0) {
  console.log(`✔ CLAUDE.md: ${checked} mechanical claims verified (paths, line numbers, scripts, agent names, project ref)`);
  console.log("  Note: prose claims are NOT checked and cannot be. This is a staleness");
  console.log("  guard, not a correctness proof.");
  process.exit(0);
}

console.error(`\n✖ CLAUDE.md has ${problems.length} stale claim(s), out of ${checked} checked.\n`);
for (const p of problems) console.error(`    ${p}`);
console.error("");
console.error("  Every agent reads this file first and trusts it. A stale line here does not");
console.error("  cause an error — it sends the next reader to hunt a closed bug, or to run a");
console.error("  guard that cannot run. Fix the line; do not delete the rule around it.\n");
process.exit(1);
