#!/usr/bin/env node
/**
 * audit-bus — the shared findings bus for the launch-audit agent fleet.
 *
 * WHY THIS EXISTS: parallel sessions in this repo have repeatedly clobbered
 * each other's work by rewriting a shared file. This bus is APPEND-ONLY:
 * every record is one JSON object on one line, written with a single
 * O_APPEND write. Nothing ever rewrites an existing line — a status change
 * is a NEW record referencing the original id. That makes 3 concurrent
 * agents safe without locking, and makes the history auditable.
 *
 *   node scripts/audit-bus.mjs file --agent lh-money-escrow --severity HIGH \
 *     --surface "/post-job" --claim "..." --repro "..." \
 *     --evidence "shots/a.png,sql-output.txt" [--blocker]
 *   node scripts/audit-bus.mjs list [--agent X] [--severity HIGH] [--status filed] [--blockers]
 *   node scripts/audit-bus.mjs show <id>
 *   node scripts/audit-bus.mjs status <id> --set verified --by lh-verifier --note "..."
 *   node scripts/audit-bus.mjs dupe <id> --of <other-id> --by lh-verifier
 *   node scripts/audit-bus.mjs msg --to lh-visual-critic --from lh-route-walker --body "..."
 *   node scripts/audit-bus.mjs inbox --agent lh-visual-critic
 *   node scripts/audit-bus.mjs rollup
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs/audit/launch-2026-09");
const LOG = join(DIR, "findings.jsonl");
const INBOX = join(DIR, "inbox");

const SEVERITIES = ["HIGH", "MEDIUM", "LOW", "POLISH"];
const STATUSES = ["filed", "verified", "retracted", "duplicate", "fixed", "wontfix"];

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function die(msg) { console.error(`audit-bus: ${msg}`); process.exit(1); }

function readAll() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => { try { return JSON.parse(l); } catch { die(`corrupt line ${i + 1}`); } });
}

/** Single atomic append. Never read-modify-write. */
function emit(rec) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  return rec;
}

/**
 * Fold the append-only log into current state: the newest status record for an
 * id wins. This is what every consumer should use instead of reading raw lines.
 */
function fold() {
  const findings = new Map();
  for (const r of readAll()) {
    if (r.kind === "finding") {
      // A SECOND finding under an existing id must never delete the first.
      // `nextId` now makes this unreachable for new rows, but the ledger is
      // append-only, so the 12 findings already shadowed on 2026-09-02 exist on
      // disk and have to stay readable. The incumbent keeps the id (it owns any
      // status rows filed against it); the newcomer is kept under a distinct
      // key so it is visible rather than silently dropped.
      const incumbent = findings.get(r.id);
      if (incumbent && incumbent.agent !== r.agent) {
        findings.set(`${r.id}#${r.agent}`, {
          ...r,
          id: `${r.id}#${r.agent}`,
          collided_with: r.id,
          status: "filed",
          history: [],
        });
        continue;
      }
      findings.set(r.id, { ...r, status: "filed", history: [] });
    } else if (r.kind === "status") {
      const f = findings.get(r.id);
      if (!f) continue;
      f.status = r.status;
      if (r.dupe_of) f.dupe_of = r.dupe_of;
      f.history.push(r);
    }
  }
  return [...findings.values()];
}

/**
 * Allocate the next free id.
 *
 * THE COUNTER IS SCOPED TO THE PREFIX, NOT TO THE AGENT — and that is the whole
 * point. Word initials are NOT unique across the fleet: `lh-visual-critic` and
 * `lh-verification-credentials` both reduce to "VC", `lh-copy-content` and
 * `lh-concurrency-cache` both reduce to "CC", and `lh-test-ci` collides with
 * `main`. Counting per AGENT made every one of those pairs start at 001 and
 * march in lockstep, so the collision was not occasional — it was TOTAL. On
 * 2026-09-02 that silently hid 12 filed findings (all 8 of
 * lh-verification-credentials', 3 of lh-copy-content's, 1 of main's) because
 * `fold()` is last-write-wins by id. Counting per PREFIX means a lane simply
 * takes the next free number in a shared sequence and two lanes can never be
 * handed the same id.
 *
 * This does NOT renumber anything already filed: it only ever returns an id
 * above the highest one that exists for the prefix.
 */
function nextId(agent) {
  const prefix = agent.replace(/^lh-/, "").split("-").map((s) => s[0]).join("").toUpperCase();
  const used = readAll()
    .filter((r) => r.kind === "finding" && typeof r.id === "string" && r.id.startsWith(`${prefix}-`))
    .map((r) => Number(r.id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

const cmd = process.argv[2];
const a = args(process.argv.slice(3));
const now = () => new Date().toISOString();

if (cmd === "file") {
  for (const k of ["agent", "severity", "surface", "claim"]) if (!a[k] || a[k] === true) die(`--${k} is required`);
  const severity = String(a.severity).toUpperCase();
  if (!SEVERITIES.includes(severity)) die(`--severity must be one of ${SEVERITIES.join("|")}`);
  const evidence = a.evidence && a.evidence !== true ? String(a.evidence).split(",").map((s) => s.trim()).filter(Boolean) : [];
  // An unevidenced claim is allowed to be filed, but it is MARKED, not hidden.
  // The verifier treats evidence:[] as "reproduce from scratch or retract".
  const rec = emit({
    kind: "finding",
    id: nextId(String(a.agent)),
    ts: now(),
    agent: String(a.agent),
    lane: a.lane && a.lane !== true ? String(a.lane) : null,
    severity,
    launch_blocker: Boolean(a.blocker),
    surface: String(a.surface),
    claim: String(a.claim),
    repro: a.repro && a.repro !== true ? String(a.repro) : null,
    evidence,
    unevidenced: evidence.length === 0,
  });
  console.log(`filed ${rec.id}${rec.unevidenced ? "  [UNEVIDENCED — verifier will reproduce or retract]" : ""}`);
} else if (cmd === "status") {
  const id = a._[0];
  if (!id) die("usage: status <id> --set <status> --by <agent> [--note ...]");
  const status = String(a.set || "").toLowerCase();
  if (!STATUSES.includes(status)) die(`--set must be one of ${STATUSES.join("|")}`);
  if (!fold().some((f) => f.id === id)) die(`no such finding: ${id}`);
  emit({ kind: "status", id, ts: now(), status, by: a.by && a.by !== true ? String(a.by) : null, note: a.note && a.note !== true ? String(a.note) : null });
  console.log(`${id} -> ${status}`);
} else if (cmd === "dupe") {
  const id = a._[0];
  if (!id || !a.of) die("usage: dupe <id> --of <other-id> --by <agent>");
  emit({ kind: "status", id, ts: now(), status: "duplicate", dupe_of: String(a.of), by: a.by && a.by !== true ? String(a.by) : null, note: null });
  console.log(`${id} -> duplicate of ${a.of}`);
} else if (cmd === "list") {
  let all = fold();
  if (a.agent && a.agent !== true) all = all.filter((f) => f.agent === a.agent);
  if (a.severity && a.severity !== true) all = all.filter((f) => f.severity === String(a.severity).toUpperCase());
  if (a.status && a.status !== true) all = all.filter((f) => f.status === a.status);
  if (a.blockers) all = all.filter((f) => f.launch_blocker);
  const rank = (f) => SEVERITIES.indexOf(f.severity) + (f.launch_blocker ? -10 : 0);
  all.sort((x, y) => rank(x) - rank(y));
  if (a.json) { console.log(JSON.stringify(all, null, 2)); }
  else if (!all.length) console.log("(no findings)");
  else for (const f of all) console.log(`${f.launch_blocker ? "!" : " "} ${f.id.padEnd(8)} ${f.severity.padEnd(6)} ${f.status.padEnd(9)} ${f.surface.padEnd(28)} ${f.claim.slice(0, 70)}`);
} else if (cmd === "show") {
  const f = fold().find((x) => x.id === a._[0]);
  if (!f) die(`no such finding: ${a._[0]}`);
  console.log(JSON.stringify(f, null, 2));
} else if (cmd === "msg") {
  for (const k of ["to", "from", "body"]) if (!a[k] || a[k] === true) die(`--${k} is required`);
  mkdirSync(INBOX, { recursive: true });
  appendFileSync(join(INBOX, `${a.to}.md`), `\n## ${now()} — from ${a.from}\n\n${a.body}\n`);
  console.log(`message delivered to ${a.to}`);
} else if (cmd === "inbox") {
  if (!a.agent || a.agent === true) die("--agent is required");
  const p = join(INBOX, `${a.agent}.md`);
  console.log(existsSync(p) ? readFileSync(p, "utf8") : "(empty inbox)");
} else if (cmd === "rollup") {
  const all = fold();
  const live = all.filter((f) => !["retracted", "duplicate"].includes(f.status));
  const lines = [
    "# Launch audit — findings rollup",
    "",
    `_Generated ${now()} from findings.jsonl. Do not hand-edit — run \`node scripts/audit-bus.mjs rollup\`._`,
    "",
    `**${live.length} live findings** · ${live.filter((f) => f.launch_blocker).length} launch blockers · `
      + `${all.filter((f) => f.status === "retracted").length} retracted · ${all.filter((f) => f.status === "fixed").length} fixed`,
    "",
  ];
  for (const sev of SEVERITIES) {
    const bucket = live.filter((f) => f.severity === sev);
    if (!bucket.length) continue;
    lines.push(`## ${sev} (${bucket.length})`, "");
    lines.push("| ID | Blocker | Status | Surface | Claim | Agent | Evidence |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const f of bucket) {
      lines.push(`| ${f.id} | ${f.launch_blocker ? "**YES**" : ""} | ${f.status}${f.unevidenced ? " ⚠︎" : ""} | \`${f.surface}\` | ${f.claim.replace(/\|/g, "\\|")} | ${f.agent} | ${f.evidence.length || "—"} |`);
    }
    lines.push("");
  }
  writeFileSync(join(DIR, "ROLLUP.md"), lines.join("\n"));
  console.log(`rollup written: ${live.length} live findings`);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].split("/**")[1].trim());
}
