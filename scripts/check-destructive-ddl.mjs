#!/usr/bin/env node
/**
 * check-destructive-ddl.mjs — FAIL a migration that destroys data unless the
 * author has said, in the diff, exactly what they are destroying and why.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.github/workflows/db-deploy.yml` runs `supabase db push` against
 * PRODUCTION on every merge to main. Before this file, nothing between a
 * `DROP TABLE` and prod's schema was blocking:
 *
 *   - db-deploy's `environment: production-db` approval gate is commented out.
 *   - migration-lint's only DROP rule ("DROP without IF EXISTS") prints a
 *     warning and never sets FAIL — and it is about REPLAY-safety, not about
 *     destructiveness. `DROP TABLE IF EXISTS payments` passes it cleanly.
 *   - Nothing anywhere matched TRUNCATE, ALTER TABLE … DROP COLUMN, or an
 *     unqualified DELETE/UPDATE.
 *   - The stated trust model ("branch protection on main requires the
 *     checks") describes a PR process this repo abandoned when it moved to
 *     direct-to-main commits.
 *
 * And the asymmetry that makes it matter: this project is on the Supabase
 * free tier with no restorable backup (a deliberate, accepted constraint —
 * see CLAUDE.md). A destructive migration is therefore not a bad afternoon,
 * it is permanent. The gate is the compensating control for the missing
 * restore path, which is why it FAILS rather than warns.
 *
 * WHAT IT FLAGS  (each = irreversible loss of rows or columns)
 *   DROP TABLE            — the rows go with it
 *   DROP SCHEMA           — ditto, wholesale
 *   ALTER TABLE … DROP COLUMN
 *   TRUNCATE
 *   DELETE FROM <t>  with no WHERE
 *   UPDATE  <t> SET  with no WHERE   (overwrites every row; the old values
 *                                     are not recoverable without a backup)
 *   ALTER TABLE … DROP CONSTRAINT — unless the SAME constraint name is
 *                                   re-added later in the same file (the
 *                                   drop-and-recreate idiom, which is not
 *                                   destructive). A constraint dropped for
 *                                   good lets data that violates it enter a
 *                                   populated table, and re-adding it later
 *                                   then fails — which is the "DROP
 *                                   CONSTRAINT on a populated table" case.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG, and why
 *   ALTER PUBLICATION … DROP TABLE   — removes a table from replication.
 *                                      Reads as a DROP TABLE, destroys
 *                                      nothing. (10 of the 25 `DROP TABLE`
 *                                      hits in this repo's history were
 *                                      this or a comment.)
 *   REVOKE TRUNCATE …                — the opposite of destructive.
 *   DROP POLICY / TRIGGER / INDEX / VIEW / FUNCTION / TYPE
 *                                    — no rows are lost, and the migration
 *                                      history is itself the restore path.
 *   Bodies of CREATE FUNCTION/PROCEDURE — a function body runs when CALLED,
 *                                      not at migration time. This repo has
 *                                      ~20 sweep functions that legitimately
 *                                      DELETE rows; flagging their
 *                                      definitions would drown the signal
 *                                      and get the gate switched off, which
 *                                      is how migration-lint spent three
 *                                      months not running. DO $$ … $$ blocks
 *                                      ARE scanned — those execute now.
 *
 * THE ESCAPE HATCH
 * ----------------
 * A gate with no way through gets ripped out the first time someone
 * genuinely has to drop a column. So there is one, and it is in the file,
 * in the diff, per statement:
 *
 *     -- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.profiles.intro_video_url
 *     -- ACK-REASON: feature removed in 20260827120000; column unread since.
 *     -- ACK-DATA-LOSS: 412 non-null rows of a URL that points at deleted
 *     --   storage objects. Nothing else can produce them again.
 *     ALTER TABLE public.profiles DROP COLUMN IF EXISTS intro_video_url;
 *
 * It cannot fire by accident, by four independent properties:
 *   1. It must name the EXACT operation and object the checker computed
 *      ("DROP COLUMN public.profiles.intro_video_url"). Pasting another
 *      migration's ack does not work; there is no wildcard and no blanket.
 *   2. It must sit in the comment block IMMEDIATELY above that statement,
 *      with no blank line between. A file header cannot cover a file.
 *   3. All three lines are required, and ACK-REASON / ACK-DATA-LOSS must be
 *      substantive prose (>= 25 chars, no placeholder text). There is no
 *      one-token silencer.
 *   4. There is no CLI flag and no environment variable that skips the
 *      check — deliberately, because those are invisible in review. The
 *      only way through is three added lines that a reader sees.
 *
 * USAGE
 *   node scripts/check-destructive-ddl.mjs <file.sql> [...]   # explicit set
 *   node scripts/check-destructive-ddl.mjs --all              # whole tree
 * Exit 0 = clean (or every finding acknowledged). Exit 1 = blocked.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

// ── 1. Lexing ────────────────────────────────────────────────────────────
//
// Comments are blanked (not deleted) so line numbers survive, and so a
// commented-out DROP is genuinely not a DROP. Single-quoted strings are
// blanked too — otherwise `RAISE NOTICE 'dropping the old table'` trips the
// gate — but their contents are kept aside and re-scanned in step 3, so
// `EXECUTE 'DROP TABLE x'` is still caught. Dollar-quoted bodies are NOT
// blanked; they are handled structurally in step 2.

/** @typedef {{ text: string, start: number }} Chunk */

/**
 * Blank out `--` and slash-star comments, replacing every character with a
 * space (newlines kept) so offsets and line numbers are unchanged.
 * Also returns the string literals it blanked, with their offsets.
 * @param {string} sql
 * @returns {{ masked: string, literals: Chunk[] }}
 */
function maskCommentsAndStrings(sql) {
  const out = sql.split("");
  /** @type {Chunk[]} */
  const literals = [];
  let i = 0;
  const n = sql.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };

  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      let j = sql.indexOf("\n", i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (two === "/*") {
      // Postgres block comments nest.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql.slice(j, j + 2) === "/*") { depth++; j += 2; continue; }
        if (sql.slice(j, j + 2) === "*/") { depth--; j += 2; continue; }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    // Dollar-quoted body: skip over it wholesale here (step 2 recurses in).
    const dq = matchDollarTag(sql, i);
    if (dq) {
      const close = sql.indexOf(dq, i + dq.length);
      i = close === -1 ? n : close + dq.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      literals.push({ text: sql.slice(i + 1, Math.max(i + 1, j - 1)), start: i + 1 });
      blank(i, j);
      i = j;
      continue;
    }
    if (sql[i] === '"') {
      // Quoted identifier — keep it, it is part of the object name.
      let j = i + 1;
      while (j < n && sql[j] !== '"') j++;
      i = j + 1;
      continue;
    }
    i++;
  }
  return { masked: out.join(""), literals };
}

/** Return the dollar-quote tag starting at `i` (e.g. "$$" or "$fn$"), or null. */
function matchDollarTag(sql, i) {
  if (sql[i] !== "$") return null;
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
  return m ? m[0] : null;
}

/**
 * Split SQL into top-level statements, honouring dollar-quoted bodies and
 * blanked strings/comments. Returns each statement's text and byte offset.
 * @param {string} sql raw SQL (dollar bodies intact)
 * @param {string} masked same string with comments/strings blanked
 * @returns {Chunk[]}
 */
function splitStatements(sql, masked) {
  /** @type {Chunk[]} */
  const stmts = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const dq = matchDollarTag(sql, i);
    if (dq) {
      const close = sql.indexOf(dq, i + dq.length);
      i = close === -1 ? n : close + dq.length;
      continue;
    }
    if (masked[i] === ";") {
      stmts.push({ text: sql.slice(start, i), start });
      i++;
      start = i;
      continue;
    }
    i++;
  }
  if (sql.slice(start).trim()) stmts.push({ text: sql.slice(start), start });
  return stmts;
}

// ── 2. Classification ────────────────────────────────────────────────────

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

/** Normalize `  public . "jobs" ` → `public.jobs`. */
function normObj(raw) {
  return raw
    .split(".")
    .map((p) => p.trim().replace(/^"(.*)"$/, "$1"))
    .join(".");
}

/** Strip the leading whitespace/newlines of a statement for verb matching. */
function head(text) {
  return text.replace(/^[\s;]+/, "");
}

/**
 * Classify one statement. Returns a list of findings:
 *   { op, object, descriptor, offset }
 * `descriptor` is the exact string an ack must name.
 */
function classifyStatement(stmt, maskedStmt) {
  /** @type {{op: string, descriptor: string, offset: number}[]} */
  const found = [];
  // Offsets are computed against the MASKED text, where comments are spaces.
  // Against the raw text a file's leading comment header would count as part
  // of the first statement and anchor every finding in it to line 1.
  const s = head(maskedStmt);
  const lead = maskedStmt.length - s.length;
  const at = stmt.start + lead;

  // TRUNCATE must be the statement's own verb — this is what keeps
  // `REVOKE TRUNCATE, TRIGGER ON ALL TABLES …` and
  // `ALTER DEFAULT PRIVILEGES … REVOKE TRUNCATE …` out of the results.
  let m = new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(${QUALIFIED})`, "i").exec(s);
  if (m) found.push({ op: "TRUNCATE", descriptor: `TRUNCATE ${normObj(m[1])}`, offset: at });

  // DROP TABLE / DROP SCHEMA as the statement's own verb. `ALTER PUBLICATION
  // … DROP TABLE` starts with ALTER and is therefore not matched.
  m = new RegExp(String.raw`^DROP\s+(TABLE|SCHEMA)\s+(?:IF\s+EXISTS\s+)?(${QUALIFIED})`, "i").exec(s);
  if (m) {
    const op = `DROP ${m[1].toUpperCase()}`;
    found.push({ op, descriptor: `${op} ${normObj(m[2])}`, offset: at });
  }

  // DELETE / UPDATE with no WHERE. A CTE-qualified or RETURNING form still
  // needs a WHERE; the absence of the keyword anywhere in the statement is
  // the test, which is conservative in the safe direction.
  m = new RegExp(String.raw`^DELETE\s+FROM\s+(?:ONLY\s+)?(${QUALIFIED})`, "i").exec(s);
  if (m && !/\bWHERE\b/i.test(s)) {
    found.push({ op: "DELETE", descriptor: `DELETE FROM ${normObj(m[1])} (no WHERE)`, offset: at });
  }
  m = new RegExp(String.raw`^UPDATE\s+(?:ONLY\s+)?(${QUALIFIED})\s+SET\b`, "i").exec(s);
  if (m && !/\bWHERE\b/i.test(s)) {
    found.push({ op: "UPDATE", descriptor: `UPDATE ${normObj(m[1])} (no WHERE)`, offset: at });
  }

  // ALTER TABLE … DROP COLUMN / DROP CONSTRAINT. One ALTER can carry several
  // comma-separated actions; each is its own finding with its own ack.
  const alter = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})`, "i").exec(s);
  if (alter) {
    const table = normObj(alter[1]);
    const actions = new RegExp(
      String.raw`\bDROP\s+(COLUMN|CONSTRAINT)\s+(?:IF\s+EXISTS\s+)?(${IDENT})`,
      "gi",
    );
    let a;
    while ((a = actions.exec(s)) !== null) {
      const kind = a[1].toUpperCase();
      const name = normObj(a[2]);
      found.push({
        op: `DROP ${kind}`,
        descriptor: `DROP ${kind} ${table}.${name}`,
        // `offset` anchors the acknowledgement, and for a multi-action ALTER
        // that is the ALTER line — one stack of acks above the statement,
        // rather than comments wedged between its comma-separated actions.
        // `actionOffset` is where the action itself sits, for the message.
        offset: at,
        actionOffset: at + a.index,
        constraintName: kind === "CONSTRAINT" ? name : null,
        table,
      });
    }
  }

  return found;
}

// ── 3. File scan ─────────────────────────────────────────────────────────

const DESTRUCTIVE_VERB = /^\s*(TRUNCATE|DROP\s+(TABLE|SCHEMA)|DELETE\s+FROM|ALTER\s+TABLE\b[\s\S]*\bDROP\s+(COLUMN|CONSTRAINT))\b/i;

/**
 * @param {string} file
 * @returns {{descriptor:string, op:string, line:number, acked:boolean, ackProblem:string|null}[]}
 */
function scanFile(file) {
  const sql = readFileSync(file, "utf8");
  const { masked, literals } = maskCommentsAndStrings(sql);
  const lines = sql.split("\n");
  const lineOf = (off) => sql.slice(0, off).split("\n").length;

  /** @type {any[]} */
  const raw = [];

  // Top-level statements.
  const stmts = splitStatements(sql, masked);
  for (const st of stmts) {
    const maskedStmt = { text: masked.slice(st.start, st.start + st.text.length), start: st.start };
    raw.push(...classifyStatement(st, maskedStmt.text));

    // DO $$ … $$ executes immediately, so recurse into its body. Function and
    // procedure DEFINITIONS are skipped on purpose — see the header.
    if (/^\s*DO\b/i.test(head(maskedStmt.text))) {
      for (const body of dollarBodies(sql, st.start, st.start + st.text.length)) {
        const inner = maskCommentsAndStrings(body.text);
        for (const ist of splitStatements(body.text, inner.masked)) {
          const shifted = { text: ist.text, start: body.start + ist.start };
          raw.push(...classifyStatement(shifted, inner.masked.slice(ist.start, ist.start + ist.text.length)));
        }
        // Dynamic SQL inside the DO block.
        for (const lit of inner.literals) {
          if (!DESTRUCTIVE_VERB.test(lit.text)) continue;
          const chunk = { text: lit.text, start: body.start + lit.start };
          raw.push(...classifyStatement(chunk, lit.text).map((f) => ({ ...f, dynamic: true })));
        }
      }
    }
  }

  // Dynamic SQL at the top level (`EXECUTE 'DROP TABLE …'` outside a DO is
  // rare but free to cover).
  for (const lit of literals) {
    if (!DESTRUCTIVE_VERB.test(lit.text)) continue;
    raw.push(...classifyStatement({ text: lit.text, start: lit.start }, lit.text).map((f) => ({ ...f, dynamic: true })));
  }

  // Drop-and-recreate exemption: a constraint dropped and re-added in the
  // same file is a redefinition, not a loss. Checked against the masked text
  // so a commented-out ADD CONSTRAINT does not excuse a real DROP.
  const readded = new Set();
  const addRe = new RegExp(String.raw`\bADD\s+CONSTRAINT\s+(${IDENT})`, "gi");
  let ar;
  while ((ar = addRe.exec(masked)) !== null) readded.add(normObj(ar[1]).toLowerCase());

  const findings = [];
  const seen = new Set();
  for (const f of raw) {
    if (f.constraintName && readded.has(f.constraintName.toLowerCase())) continue;
    const line = lineOf(f.offset);
    const actionLine = lineOf(f.actionOffset ?? f.offset);
    const key = `${f.descriptor}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ack = checkAck(lines, line, f.descriptor);
    findings.push({ ...f, line, actionLine, acked: ack.ok, ackProblem: ack.problem });
  }
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

/** All dollar-quoted body texts inside [from,to). */
function dollarBodies(sql, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const tag = matchDollarTag(sql, i);
    if (!tag) { i++; continue; }
    const close = sql.indexOf(tag, i + tag.length);
    if (close === -1) break;
    out.push({ text: sql.slice(i + tag.length, close), start: i + tag.length });
    i = close + tag.length;
  }
  return out;
}

// ── 4. The escape hatch ──────────────────────────────────────────────────

const PLACEHOLDER = /^(n\/?a|none|tbd|todo|xxx|\.+|-+|because|reasons?|see above|fix|cleanup|removed?)\.?$/i;
const MIN_PROSE = 25;

/**
 * An ack is the contiguous run of `--` comment lines directly above the
 * statement, with no blank line between them and it.
 * @returns {{ok: boolean, problem: string|null}}
 */
function checkAck(lines, stmtLine, descriptor) {
  const block = [];
  for (let i = stmtLine - 2; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === "") break;              // blank line ends the block — a file
    if (!t.startsWith("--")) break;   // header can never reach the statement
    block.unshift(t.replace(/^--\s?/, ""));
  }
  if (block.length === 0) return { ok: false, problem: "no comment block directly above the statement" };

  const joined = block.join("\n");
  if (!/DESTRUCTIVE-DDL-ACK:/i.test(joined)) {
    return { ok: false, problem: "comment block above the statement carries no DESTRUCTIVE-DDL-ACK line" };
  }

  const ackLine = block.find((l) => /^DESTRUCTIVE-DDL-ACK:/i.test(l));
  if (!ackLine) {
    return { ok: false, problem: "DESTRUCTIVE-DDL-ACK must start its own comment line" };
  }
  const named = ackLine.replace(/^DESTRUCTIVE-DDL-ACK:\s*/i, "").trim().replace(/\s+/g, " ");
  if (named.toLowerCase() !== descriptor.toLowerCase()) {
    return {
      ok: false,
      problem: `ack names "${named}" but this statement is "${descriptor}" — the ack must name the exact operation and object`,
    };
  }

  for (const field of ["ACK-REASON", "ACK-DATA-LOSS"]) {
    const idx = block.findIndex((l) => new RegExp(`^${field}:`, "i").test(l));
    if (idx === -1) return { ok: false, problem: `missing a "-- ${field}: …" line` };
    // Continuation lines (indented, not another field) belong to this field.
    let prose = block[idx].replace(new RegExp(`^${field}:\\s*`, "i"), "");
    for (let j = idx + 1; j < block.length; j++) {
      if (/^(DESTRUCTIVE-DDL-ACK|ACK-REASON|ACK-DATA-LOSS):/i.test(block[j])) break;
      prose += " " + block[j];
    }
    prose = prose.trim().replace(/\s+/g, " ");
    if (PLACEHOLDER.test(prose)) return { ok: false, problem: `${field} is a placeholder ("${prose}")` };
    if (prose.length < MIN_PROSE) {
      return { ok: false, problem: `${field} is ${prose.length} chars; needs at least ${MIN_PROSE} of real explanation` };
    }
  }
  return { ok: true, problem: null };
}

// ── 5. CLI ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2).filter(Boolean);
  let files;
  if (args.includes("--all")) {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f));
  } else {
    files = args.filter((a) => !a.startsWith("--"));
  }
  if (files.length === 0) {
    console.log("check-destructive-ddl: no migration files to inspect.");
    return 0;
  }

  let blocked = 0;
  let acked = 0;
  let scanned = 0;

  for (const file of files) {
    let findings;
    try {
      findings = scanFile(file);
    } catch (err) {
      console.error(`::error file=${file}::check-destructive-ddl could not parse this file: ${err.message}`);
      blocked++;
      continue;
    }
    scanned++;
    for (const f of findings) {
      if (f.acked) {
        acked++;
        console.log(`  ✓ ${file}:${f.line} ${f.descriptor} — acknowledged`);
        continue;
      }
      blocked++;
      const at = f.actionLine !== f.line ? `${f.line} (action on line ${f.actionLine})` : `${f.line}`;
      console.error("");
      console.error(`::error file=${file},line=${f.actionLine}::DESTRUCTIVE DDL: ${f.descriptor}${f.dynamic ? " (in dynamic SQL)" : ""}`);
      console.error(`  ${file}:${at}  ${f.descriptor}`);
      console.error(`  Reason it is blocked: ${f.ackProblem}.`);
      console.error("");
      console.error("  This deploys straight to production, and this project has NO restorable");
      console.error("  backup (Supabase free tier, an accepted constraint). There is no undo.");
      console.error("");
      console.error("  If the loss is intended, say so ON THE LINES DIRECTLY ABOVE the statement:");
      console.error("");
      console.error(`      -- DESTRUCTIVE-DDL-ACK: ${f.descriptor}`);
      console.error("      -- ACK-REASON: <why this has to go, in a sentence>");
      console.error("      -- ACK-DATA-LOSS: <what rows/values disappear, and how many>");
      console.error("");
      console.error("  No blank line between that block and the statement. Both prose lines are");
      console.error(`  required and must be at least ${MIN_PROSE} real characters. There is no flag`);
      console.error("  and no env var that skips this — the acknowledgement lives in the diff.");
    }
  }

  console.log("");
  console.log(`check-destructive-ddl: ${scanned} file(s) scanned, ${acked} acknowledged, ${blocked} blocked.`);
  if (blocked > 0) {
    console.error("");
    console.error(`❌ ${blocked} destructive statement(s) without an acknowledgement. Deploy blocked.`);
    return 1;
  }
  console.log("✅ No unacknowledged destructive DDL.");
  return 0;
}

process.exit(main());
