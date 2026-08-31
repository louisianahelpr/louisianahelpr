#!/usr/bin/env node
/**
 * check-trigger-timing — an AFTER trigger cannot change the row.
 *
 * In plpgsql, assignments to `NEW.<col>` only persist when the trigger fires
 * BEFORE the write. Attach the same function AFTER INSERT/UPDATE and Postgres
 * discards every `NEW.x := …` silently — no error, no warning, the row just
 * lands unmodified.
 *
 * This exact bug has shipped twice on this repo, both times on the message
 * moderation scan:
 *   • 20260819060000_security_authz_hardening.sql §5 fixed it for the
 *     INSERT-time trigger.
 *   • 20260831003117 reintroduced it for the new edit-time trigger
 *     (`scan_message_on_edit` AFTER UPDATE) — an edited message that tripped
 *     the content scan never got hidden. Fixed again in 20260831015232.
 *
 * Both times the SQL was valid, both times the tests passed, and both times
 * the only symptom was a moderation flag that quietly did nothing. That is
 * what makes it worth a static check rather than a checklist line.
 *
 * The rule: if a trigger function assigns to NEW.*, every trigger bound to it
 * must be BEFORE (or INSTEAD OF). Function bodies are collected from the whole
 * migrations tree — latest definition of each function wins, since a function
 * may be redefined across migrations — while only the migrations passed on
 * argv are linted, so re-running an old CREATE TRIGGER doesn't trip it.
 *
 * Usage: node scripts/check-trigger-timing.mjs <migration.sql> [...]
 * Exits 1 on a violation.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Map of function name (lowercased, unqualified) → whether its latest
 * definition assigns to NEW.*. Files are read in filename order, which for
 * timestamp-prefixed migrations is chronological, so later definitions
 * overwrite earlier ones.
 */
function collectNewAssigningFunctions() {
  const assigns = new Map();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Split on each function definition; chunk N is the body of function N.
    const parts = sql.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i);
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const nameMatch = chunk.match(/^(?:public\.)?"?([a-z0-9_]+)"?/i);
      if (!nameMatch) continue;
      const name = nameMatch[1].toLowerCase();
      // `:=` is unambiguous — plpgsql assignment, never a comparison.
      assigns.set(name, /\bNEW\.[a-z0-9_]+\s*:=/i.test(chunk));
    }
  }
  return assigns;
}

/** Extract CREATE TRIGGER statements with their timing and target function. */
function findTriggers(sql) {
  const triggers = [];
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-z0-9_]+)"?([\s\S]*?)EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, triggerName, middle, fnName] = m;
    // Timing keyword sits between the trigger name and the ON clause.
    const timing = /\bINSTEAD\s+OF\b/i.test(middle)
      ? "INSTEAD OF"
      : /\bBEFORE\b/i.test(middle)
        ? "BEFORE"
        : /\bAFTER\b/i.test(middle)
          ? "AFTER"
          : null;
    triggers.push({
      triggerName,
      fnName: fnName.toLowerCase(),
      timing,
      line: sql.slice(0, m.index).split("\n").length,
    });
  }
  return triggers;
}

const targets = process.argv.slice(2).filter((a) => a.trim().length > 0);
if (targets.length === 0) {
  console.log("check-trigger-timing: no migrations to lint — skipping");
  process.exit(0);
}

const newAssigning = collectNewAssigningFunctions();
let failed = false;

for (const file of targets) {
  let sql;
  try {
    sql = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in this diff
  }

  for (const t of findTriggers(sql)) {
    if (t.timing !== "AFTER") continue;
    if (!newAssigning.get(t.fnName)) continue;

    failed = true;
    console.error(
      `❌ ${file}:${t.line} — trigger '${t.triggerName}' is AFTER, but ` +
        `${t.fnName}() assigns to NEW.*`,
    );
    console.error(
      "   An AFTER trigger cannot modify the row: every NEW.x := … in that " +
        "function is silently discarded.",
    );
    console.error(`   Fix: use BEFORE ${"<event>"} instead of AFTER.`);
  }
}

if (failed) {
  console.error("\n❌ Trigger-timing lint failed — see errors above");
  process.exit(1);
}
console.log("✅ Trigger timing OK (no AFTER trigger mutates NEW)");
