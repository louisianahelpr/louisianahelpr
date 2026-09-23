#!/usr/bin/env node
/**
 * The ops alert ledger CLI (docs/OPEN.md Q1; table public.ops_alert_ledger).
 *
 *   node scripts/ops-alert-ledger.mjs list [--limit 10] [--brief]
 *       Open items, worst first. --brief is the session-start one-liner form;
 *       it never exits non-zero.
 *
 *   node scripts/ops-alert-ledger.mjs record --source-kind workflow --source <name> \
 *        --title <text> --severity critical|error|warning|info [--sample <text>] \
 *        [--verify-ref <workflow file>] [--run-url <url>]
 *       What a workflow Slack step runs next to its curl. Never exits non-zero.
 *
 *   node scripts/ops-alert-ledger.mjs sync
 *       Hourly, from prod-errors.yml:
 *        1. every OPEN GitHub issue labelled nightly-red / prod-down /
 *           prod-errors / supabase-usage becomes (or bumps) a ledger item;
 *        2. a nightly_red item whose issue was CLOSED BY github-actions[bot] —
 *           i.e. by that workflow's own green run — closes, evidence = the
 *           issue; closed by a person does NOT close it (not a re-run);
 *        3. a workflow item closes when its workflow's newest completed run on
 *           main is green AND started after the item's last_seen;
 *        4. Sentry unresolved issues (if SENTRY_AUTH_TOKEN/ORG/PROJECT are
 *           set) become items; otherwise it SAYS it skipped Sentry;
 *        5. public.ops_alert_verify() re-asks every sql_condition item.
 *
 *   node scripts/ops-alert-ledger.mjs close --id <uuid> --evidence <what was re-run and what it showed> \
 *        --rerun-started-at <iso>
 *       For a manual item, after re-running its detector yourself. Refused by
 *       the database unless the re-run started after the last occurrence.
 */
import { execFileSync } from "node:child_process";
import { OPEN_ITEMS_SQL, lit, recordOpsAlert, sql } from "./lib/opsAlertLedger.mjs";

const [, , cmd, ...rest] = process.argv;
const opt = (name, dflt = undefined) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && i + 1 < rest.length ? rest[i + 1] : dflt;
};
const flag = (name) => rest.includes(`--${name}`);

const TRACKED_LABELS = ["nightly-red", "prod-down", "prod-errors", "supabase-usage"];

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 24 }) || "null");
}

async function list() {
  const brief = flag("brief");
  const limit = Number(opt("limit", brief ? 5 : 50));
  let rows;
  try {
    rows = await sql(OPEN_ITEMS_SQL, { readOnly: true, timeoutMs: brief ? 8000 : 20000 });
  } catch (e) {
    console.log(`ops alert ledger: could not read (${String(e.message).split("\n")[0].slice(0, 160)})`);
    process.exit(brief ? 0 : 2);
  }
  if (brief) {
    if (!rows.length) {
      console.log("ops alert ledger: 0 open alerts.");
      return;
    }
    console.log(`ops alert ledger: ${rows.length} OPEN alert(s) — each needs a fix and its detector re-run (CLAUDE.md). Top ${Math.min(limit, rows.length)}:`);
    for (const r of rows.slice(0, limit)) {
      console.log(`  [${r.severity}] ${r.source}: ${String(r.title).slice(0, 90)} (x${r.count}, last ${String(r.last_seen).slice(0, 16)}, verify ${r.verify_kind})`);
    }
    console.log("  full list: node scripts/ops-alert-ledger.mjs list");
    return;
  }
  console.log(`${rows.length} open`);
  for (const r of rows.slice(0, limit)) {
    console.log(
      `${r.id}  ${r.severity.padEnd(8)} ${r.status.padEnd(9)} ${String(r.count).padStart(5)}x  ${r.source_kind}/${r.source}: ${r.title}` +
        `\n    first ${r.first_seen}  last ${r.last_seen}  verify ${r.verify_kind}${r.verify_ref ? `(${r.verify_ref})` : ""}${r.verify_note ? `  — ${r.verify_note}` : ""}`,
    );
  }
}

async function record() {
  const title = opt("title");
  if (!title) {
    console.log("::warning::ops-alert-ledger record: --title is required; nothing recorded");
    return;
  }
  await recordOpsAlert({
    sourceKind: opt("source-kind", "workflow"),
    source: opt("source", process.env.GITHUB_WORKFLOW ?? "unknown"),
    title,
    severity: opt("severity", "error"),
    sample: opt("sample", title),
    sampleRef: { run_url: opt("run-url", null) },
    verifyKind: opt("verify-kind", undefined),
    verifyRef: opt("verify-ref", undefined),
  });
}

async function sync() {
  const repo = process.env.GITHUB_REPOSITORY ?? gh(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  const log = [];

  // 1. open tracked issues -> items (one per issue title). An issue counts as a
  // new occurrence only when it changed (a "still red" comment bumps
  // updatedAt), so an hourly sync does not inflate the count.
  const known = new Map();
  for (const r of await sql(`SELECT sample_ref->>'issue' AS issue, last_seen FROM public.ops_alert_ledger
                               WHERE source_kind = 'nightly_red' AND sample_ref ? 'issue'`)) {
    known.set(String(r.issue), new Date(r.last_seen));
  }
  for (const label of TRACKED_LABELS) {
    const issues = gh(["issue", "list", "--repo", repo, "--label", label, "--state", "open", "--limit", "100",
      "--json", "number,title,updatedAt,url"]);
    for (const i of issues) {
      const seen = known.get(String(i.number));
      if (seen && seen >= new Date(i.updatedAt)) continue;
      await recordOpsAlert({
        sourceKind: "nightly_red", source: label, title: i.title, severity: label === "prod-down" ? "critical" : "error",
        sample: `${i.title} — ${i.url}`, sampleRef: { issue: i.number, url: i.url },
        verifyKind: "workflow", verifyRef: i.title, seenAt: i.updatedAt,
      });
    }
    log.push(`${label}: ${issues.length} open issue(s) synced`);
  }

  // 2 + 3. close what its own detector has shown green.
  const open = await sql(`SELECT id, source_kind, source, title, sample_ref, last_seen, verify_ref
                            FROM public.ops_alert_ledger
                           WHERE status <> 'closed' AND source_kind IN ('nightly_red', 'workflow')`);
  for (const it of open) {
    const ref = typeof it.sample_ref === "string" ? JSON.parse(it.sample_ref) : it.sample_ref ?? {};
    let evidence = null;
    let rerunAt = null;
    if (it.source_kind === "nightly_red" && ref.issue) {
      const iss = gh(["api", `repos/${repo}/issues/${ref.issue}`]);
      if (iss.state === "closed" && iss.closed_by?.login === "github-actions[bot]") {
        evidence = `issue #${ref.issue} closed by its workflow's own green run (github-actions[bot]) at ${iss.closed_at}: ${iss.html_url}`;
        rerunAt = iss.closed_at;
      }
    } else if (it.source_kind === "workflow" && it.verify_ref) {
      const runs = gh(["run", "list", "--repo", repo, "--workflow", it.verify_ref, "--branch", "main", "--limit", "5",
        "--json", "conclusion,status,createdAt,url"]);
      const done = runs.find((r) => r.status === "completed");
      if (done?.conclusion === "success" && new Date(done.createdAt) > new Date(it.last_seen)) {
        evidence = `${it.verify_ref} re-ran green on main after the last alert: ${done.url}`;
        rerunAt = done.createdAt;
      }
    }
    if (evidence) {
      const r = await sql(`SELECT public.ops_alert_close(${lit(it.id)}::uuid, ${lit(evidence)}, ${lit(rerunAt)}::timestamptz) AS ok`);
      log.push(`${r?.[0]?.ok ? "closed" : "NOT closed (re-run predates last occurrence)"}: ${it.title}`);
    }
  }

  // 4. Sentry
  const { SENTRY_AUTH_TOKEN: st, SENTRY_ORG: so, SENTRY_PROJECT: sp } = process.env;
  if (st && so && sp) {
    const res = await fetch(`https://sentry.io/api/0/projects/${so}/${sp}/issues/?query=is:unresolved&statsPeriod=24h&limit=50`, {
      headers: { Authorization: `Bearer ${st}` }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Sentry ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const issues = await res.json();
    for (const i of issues) {
      await recordOpsAlert({
        sourceKind: "sentry", source: `sentry:${i.culprit ?? "unknown"}`.slice(0, 120), title: i.title,
        severity: i.level === "fatal" ? "fatal" : i.level === "warning" ? "warning" : "error",
        sample: `${i.title} — ${i.permalink}`, sampleRef: { sentry_id: i.id, url: i.permalink }, seenAt: i.lastSeen,
      });
    }
    log.push(`sentry: ${issues.length} unresolved issue(s) synced`);
  } else {
    log.push("sentry: SKIPPED — SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT not all set, so Sentry alerts are NOT in the ledger");
    console.log("::warning::Sentry is not synced into the ops alert ledger (SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT).");
  }

  // 5. re-ask every sql_condition item.
  const v = await sql(`SELECT public.ops_alert_verify() AS r`);
  log.push(`ops_alert_verify: ${JSON.stringify(v?.[0]?.r ?? v)}`);

  for (const l of log) console.log(l);
  const rows = await sql(OPEN_ITEMS_SQL, { readOnly: true });
  console.log(`\n${rows.length} open item(s) after sync.`);
}

async function close() {
  const id = opt("id");
  const evidence = opt("evidence");
  const at = opt("rerun-started-at");
  if (!id || !evidence || !at) {
    console.error("close needs --id, --evidence and --rerun-started-at");
    process.exit(2);
  }
  const r = await sql(`SELECT public.ops_alert_close(${lit(id)}::uuid, ${lit(evidence)}, ${lit(at)}::timestamptz) AS ok`);
  if (!r?.[0]?.ok) {
    console.error("NOT closed: already closed, or the re-run started before the last occurrence (re-run the detector again).");
    process.exit(1);
  }
  console.log("closed");
}

const cmds = { list, record, sync, close };
if (!cmds[cmd]) {
  console.error("usage: ops-alert-ledger.mjs list|record|sync|close (see the header)");
  process.exit(2);
}
await cmds[cmd]();
