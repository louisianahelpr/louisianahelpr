#!/usr/bin/env node
/**
 * Mirror every open source item from the other trackers into docs/OPEN.md,
 * the ONE open-work list (owner, 2026-09-27). Feeds, and the tag each item carries
 * (scripts/lib/openFeeds.mjs):
 *
 *   ops alert ledger, rows with status <> 'closed'   feed: ledger <fp[0:12]>
 *   open GitHub issues labelled nightly-red          feed: issue #N
 *   open audit-bus findings (findings.jsonl fold)    feed: bus <ID>
 *
 * For each open source it ensures exactly ONE not-done queue item carries its
 * tag. If none does, it attaches the tag and `done-when:` marker to the single
 * open queue item that already names the source, or else files a new item
 * (numbered from queue-count's next free) under the FEEDS heading. A nightly-red
 * ledger row and its issue share one item. When every source an open item
 * mirrors has CLOSED, the item flips to `[~]`, and scripts/open-done-when.mjs
 * (nightly) confirms its markers and reports it ready to tick.
 *
 * It also writes docs/audit/open-feeds.json: the ledger and issue sources it
 * measured, which src/test/openFeedsMirrored.test.ts reads offline (the bus it
 * folds directly).
 *
 *   node scripts/open-sync-trackers.mjs                    measure live, apply, write both files
 *   node scripts/open-sync-trackers.mjs --offline          ledger/issues from the committed snapshot,
 *                                                          bus from the tree (after `audit-bus.mjs file`)
 *   node scripts/open-sync-trackers.mjs --measure-only --out <json>
 *   node scripts/open-sync-trackers.mjs --from <json>      apply a measured snapshot to THIS tree
 *   --dry-run                                              print the plan, write nothing
 *
 * Ledger reads go through scripts/lib/opsAlertLedger.mjs sql() read-only (CI:
 * Management API; locally the linked CLI, LH_SUPABASE_WORKDIR). A feed that
 * cannot be read is left alone (none of its items created or flipped) and the
 * run exits 1. Nightly: .github/workflows/scoreboard.yml (measure, then land on
 * latest main through its refresh PR).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nextFreeAcross } from "./queue-count.mjs";
import { FINDINGS, SNAPSHOT, LEDGER_SQL, applyFeeds, busSources, busStatus, groupSources, mirrored, feedCounts } from "./lib/openFeeds.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPEN = "docs/OPEN.md";

async function measure() {
  const snap = { note: "written by scripts/open-sync-trackers.mjs; read by src/test/openFeedsMirrored.test.ts", measured_at: new Date().toISOString().slice(0, 16) + "Z" };
  try {
    const out = execFileSync("gh", ["issue", "list", "--label", "nightly-red", "--state", "open", "--limit", "200", "--json", "number,title"], { encoding: "utf8", timeout: 30000, cwd: ROOT });
    snap.issues = { readable: true, open: JSON.parse(out).map((i) => ({ number: i.number, title: i.title })).sort((a, b) => a.number - b.number) };
  } catch (e) {
    snap.issues = { readable: false, error: String(e.message).split("\n")[0], open: [] };
  }
  try {
    const { sql } = await import("./lib/opsAlertLedger.mjs");
    const rows = await sql(LEDGER_SQL, { readOnly: true, timeoutMs: 30000 });
    snap.ledger = {
      readable: true,
      open: rows.map((r) => ({ fingerprint: r.fingerprint, source_kind: r.source_kind, source: r.source, status: r.status, title: r.title, issue: (typeof r.sample_ref === "string" ? JSON.parse(r.sample_ref) : r.sample_ref)?.issue ?? null })),
    };
  } catch (e) {
    snap.ledger = { readable: false, error: String(e.message).split("\n")[0], open: [] };
  }
  return snap;
}

function apply(snap, { dryRun }) {
  const md = readFileSync(join(ROOT, OPEN), "utf8");
  const busText = readFileSync(join(ROOT, FINDINGS), "utf8");
  const ledger = snap.ledger.readable ? snap.ledger.open.map((r) => ({ ...r, sample_ref: { issue: r.issue } })) : [];
  const issues = snap.issues.readable ? snap.issues.open : [];
  const groups = [...groupSources({ ledger, issues }), ...busSources(busText)];
  const openIssues = new Set(issues.map((i) => `issue #${i.number}`));
  const openLedger = new Set(ledger.map((r) => `ledger ${r.fingerprint.slice(0, 12)}`));
  const bus = busStatus(busText);
  const status = (k) => {
    if (k.startsWith("issue ")) return snap.issues.readable ? (openIssues.has(k) ? "open" : "closed") : null;
    if (k.startsWith("ledger ")) return snap.ledger.readable ? (openLedger.has(k) ? "open" : "closed") : null;
    return bus.get(k) ?? null;
  };
  // A ledger-only group whose issue feed was unreadable may still be joined
  // later; never file it alone while its partner is unknown.
  const usable = snap.issues.readable ? groups : groups.filter((g) => !g.keys.some((k) => k.startsWith("ledger ")) || !ledger.find((r) => g.keys.includes(`ledger ${r.fingerprint.slice(0, 12)}`) && r.source_kind === "nightly_red"));
  // Next free on this tree AND origin/main: the nightly refresh PR numbered
  // from its base and collided with lanes that landed meanwhile (Q909/Q914).
  const res = applyFeeds(md, usable, { status, nextFree: Number(nextFreeAcross(ROOT).slice(1)), today: new Date().toISOString().slice(0, 10) });
  const by = mirrored(res.md);
  const keys = Object.fromEntries([...by].map(([k, ids]) => [k, ids[0]]).sort());
  const out = { ...snap, mirrored: keys };
  const counts = feedCounts(res.md);
  console.log(`sources open: ${issues.length} nightly-red issue(s)${snap.issues.readable ? "" : " (UNREADABLE)"}, ${ledger.length} ledger row(s)${snap.ledger.readable ? "" : " (UNREADABLE)"}, ${[...bus.values()].filter((s) => s === "open").length - (bus.get("bus V-001") === "open" ? 1 : 0)} bus finding(s)`);
  for (const c of res.created) console.log(`  created ${c.id}  ${c.keys.join(" + ")}`);
  for (const a of res.attached) console.log(`  attached to ${a.id}  ${a.keys.join(" + ")}`);
  for (const f of res.flipped) console.log(`  source closed -> [~] ${f}`);
  for (const a of res.ambiguous) console.error(`  AMBIGUOUS ${a.keys.join(" + ")}: first line of ${a.ids.join(", ")} — add \`feed: ${a.keys[0]}\` to the ONE item that owns it`);
  console.log(`OPEN.md items from feeds: ${counts.ledger} ledger, ${counts.issue} nightly-red, ${counts.bus} audit bus (${res.created.length} created, ${res.attached.length} attached, ${res.flipped.length} flipped)`);
  if (!dryRun) {
    writeFileSync(join(ROOT, OPEN), res.md);
    writeFileSync(join(ROOT, SNAPSHOT), JSON.stringify(out, null, 2) + "\n");
  }
  return snap.issues.readable && snap.ledger.readable && !res.ambiguous.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  let snap;
  if (argv.includes("--offline") || opt("from")) {
    const p = opt("from") ?? join(ROOT, SNAPSHOT);
    if (!existsSync(p)) { console.error(`open-sync-trackers: no snapshot at ${p}`); process.exit(1); }
    snap = JSON.parse(readFileSync(p, "utf8"));
  } else {
    snap = await measure();
  }
  if (argv.includes("--measure-only")) {
    const out = opt("out") ?? join(ROOT, SNAPSHOT);
    writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
    console.log(`measured ${snap.issues.open.length} issue(s), ${snap.ledger.open.length} ledger row(s) -> ${out}`);
    process.exit(snap.issues.readable && snap.ledger.readable ? 0 : 1);
  }
  const ok = apply(snap, { dryRun: argv.includes("--dry-run") });
  if (!ok) { console.error(`::error::a feed could not be read, or a source is ambiguous (see AMBIGUOUS above): ${[snap.issues.error, snap.ledger.error].filter(Boolean).join("; ")}`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
