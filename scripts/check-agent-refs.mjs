#!/usr/bin/env node
/**
 * Verify that every agent name the instructions tell you to USE actually exists.
 *
 * WHY THIS EXISTS
 * Twice in one day, instructions named an agent that did not exist. Both read as
 * perfectly followable, both failed silently, and both disabled something that
 * mattered:
 *
 *   1. CLAUDE.md, PROTOCOL.md, both audit commands, the lh-audit skill and all 33
 *      lane definitions said to run `code-reviewer`, `silent-failure-hunter` and
 *      `security-auditor` over any money/auth/data-model diff before committing.
 *      None of the three exist. On a repo whose entire safety argument is "we
 *      review the diff because there is no PR gate", that guard had silently not
 *      run for an unknown period.
 *
 *   2. All 35 lanes were told to route cross-talk with SendMessage to
 *      `lh-orchestrator`. No such agent — the lead is `team-lead`. Every hand-off
 *      between lanes would have vanished, with nothing anywhere looking wrong.
 *
 * A misspelled agent name is not a typo, it is a disabled safety mechanism. The
 * failure is invisible by construction: the spawn fails somewhere inside an agent's
 * context, and the run continues.
 *
 * WHAT IT CHECKS
 * Every `.claude/agents/*.md` name, plus the non-agent addresses the harness
 * provides (`team-lead`, `main`), form the known set. Any name referenced in an
 * instruction-shaped context that is not in that set is an error.
 *
 * Deliberately NOT flagged: prose in historical audit reports under docs/audit that
 * merely *describes* a past run ("a security-auditor-shaped review found…"). Those
 * are records, not instructions, and rewriting history to satisfy a linter is worse
 * than the lint.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const AGENT_DIR = ".claude/agents";

// Addresses the harness provides that are not files in .claude/agents.
const BUILTIN = new Set([
  "team-lead", // the orchestrator / lead session
  "main", // the main conversation, for background subagents
  "general-purpose",
  "Explore",
  "Plan",
  "fork",
  "statusline-setup",
  "claude",
]);

if (!existsSync(AGENT_DIR)) {
  console.error(`✖ ${AGENT_DIR} not found — run from the repo root.`);
  process.exit(1);
}

const known = new Set(
  readdirSync(AGENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, "")),
);
for (const b of BUILTIN) known.add(b);

// SKILLS are not agents, but they are referenced the same way ("invoke the
// `lh-audit` skill") and are equally real. Load them so the checker does not
// flag a correct skill reference — while still catching a MISSPELLED one.
try {
  for (const d of readdirSync(".claude/skills", { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(join(".claude/skills", d.name, "SKILL.md"))) known.add(d.name);
  }
} catch { /* no skills dir is fine */ }
try {
  for (const f of readdirSync(".claude/commands")) {
    if (f.endsWith(".md")) known.add(f.replace(/\.md$/, ""));
  }
} catch { /* no commands dir is fine */ }

// Files that INSTRUCT. Historical reports are excluded on purpose (see header).
const TARGETS = [
  "CLAUDE.md",
  ".claude/commands/launch-audit.md",
  ".claude/commands/audit.md",
  ".claude/commands/improve.md",
  ".claude/skills/lh-audit/SKILL.md",
  "docs/audit/launch-2026-09/PROTOCOL.md",
  "docs/audit/launch-2026-09/WAVES.md",
  ...readdirSync(AGENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(AGENT_DIR, f)),
];

// Instruction-shaped references only:
//   SendMessage({to: "x"})   |   dispatch `x`   |   run `x`   |   `x` agent
const PATTERNS = [
  /SendMessage\(\{\s*to:\s*"([A-Za-z0-9_-]+)"/g,
  /\bto:\s*"([A-Za-z0-9_-]+)"\s*,\s*message/g,
  /\bsubagent_type:\s*"([A-Za-z0-9_-]+)"/g,
];

// A name that appears in backticks AND looks like one of ours, in a line that is
// telling you to do something with it.
const IMPERATIVE = /\b(run|dispatch|spawn|invoke|use|ask|send|message|relay|route)\b/i;
const BACKTICKED = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;

// Names known to be dead. Naming them explicitly turns "unknown token" into a
// specific, actionable error the next person can act on immediately.
const KNOWN_DEAD = new Map([
  ["code-reviewer", "removed; use lh-silent-failure / lh-authz-rls REVIEW-ONLY, or /code-review"],
  ["silent-failure-hunter", "removed; use lh-silent-failure"],
  ["security-auditor", "removed; use lh-authz-rls, or /security-review"],
  ["pr-test-analyzer", "removed; use lh-test-ci"],
  ["comment-analyzer", "removed; no replacement"],
  ["type-design-analyzer", "removed; no replacement"],
  ["lh-orchestrator", "never existed; the lead's address is `team-lead`"],
]);

const problems = [];

for (const file of TARGETS) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    const seen = new Set();

    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) seen.add(m[1]);
    }

    if (IMPERATIVE.test(line)) {
      BACKTICKED.lastIndex = 0;
      let m;
      while ((m = BACKTICKED.exec(line)) !== null) {
        const name = m[1];
        // Only consider names that look like agent ids we own, or known-dead ones.
        if (name.startsWith("lh-") || KNOWN_DEAD.has(name)) seen.add(name);
      }
    }

    for (const name of seen) {
      if (known.has(name)) continue;
      // A line that is explicitly documenting the deadness is the fix, not the bug.
      if (/DO NOT EXIST|does NOT resolve|is NOT an agent|never existed|removed;|used to name|previously named|the old |replaces |instead of/i.test(line)) {
        continue;
      }
      const why = KNOWN_DEAD.get(name) ?? "no such agent in .claude/agents/";
      problems.push({ file, line: i + 1, name, why, text: line.trim().slice(0, 100) });
    }
  });
}

if (problems.length === 0) {
  console.log(`✔ agent references: every name resolves (${known.size} known agents)`);
  process.exit(0);
}

console.error(`\n✖ ${problems.length} reference(s) to an agent that does not exist.\n`);
console.error("  These fail SILENTLY at runtime — the spawn or send fails inside an");
console.error("  agent's context and the run continues, so the instruction looks");
console.error("  followed and the guard it protects simply never ran.\n");
for (const p of problems) {
  console.error(`    ${p.file}:${p.line}  \`${p.name}\` — ${p.why}`);
  console.error(`      ${p.text}`);
}
console.error("");
process.exit(1);
