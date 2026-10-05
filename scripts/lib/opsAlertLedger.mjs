/**
 * Talk to public.ops_alert_ledger (docs/OPEN.md Q1) from Node: GitHub
 * workflows, repo scripts and the session-start hook.
 *
 * Transport, first that is configured:
 *   1. SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — Management API SQL (CI;
 *      the same token prod-errors / drift / backup already hold).
 *   2. SUPABASE_SERVICE_ROLE_KEY + (SUPABASE_URL | SUPABASE_PROJECT_REF) —
 *      PostgREST RPC. Only `recordOpsAlert` uses this path.
 *   3. the linked Supabase CLI (`supabase db query --linked`), for a local
 *      session. LH_SUPABASE_WORKDIR points it at a linked checkout.
 *
 * recordOpsAlert NEVER throws: a ledger write must not turn a Slack alert or a
 * sweep into a failure. It returns false and prints a ::warning instead.
 */
import { apiBase } from "./apiBase.mjs";
import { supabaseDbQuery } from "./supabaseDbQuery.mjs";

/** SQL string literal. standard_conforming_strings is on in Supabase. */
export const lit = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`;

export async function sql(query, { readOnly = false, timeoutMs = 20000 } = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com")}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  const globalArgs = process.env.LH_SUPABASE_WORKDIR ? ["--workdir", process.env.LH_SUPABASE_WORKDIR] : [];
  const out = supabaseDbQuery(["--linked", "-o", "json", query], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
    timeout: timeoutMs,
  }, { globalArgs });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return json.rows ?? json;
}

/**
 * Record one occurrence. Returns true when the ledger accepted it.
 * @param {{sourceKind:'workflow'|'nightly_red'|'sentry'|'edge_slack'|'sql_slack'|'error_logs', source:string,
 *   title:string, severity:string, sample?:string, sampleRef?:object, verifyKind?:string, verifyRef?:string,
 *   seenAt?:string}} o
 */
export async function recordOpsAlert(o) {
  const args = [
    lit(o.sourceKind), lit(o.source), lit(o.title), lit(o.severity),
    lit((o.sample ?? o.title).slice(0, 2000)),
    `${lit(JSON.stringify(o.sampleRef ?? {}))}::jsonb`,
    lit(o.verifyKind ?? null), lit(o.verifyRef ?? null),
    o.seenAt ? `${lit(o.seenAt)}::timestamptz` : "NULL",
  ];
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const base = process.env.SUPABASE_URL ?? (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);
    if (!process.env.SUPABASE_ACCESS_TOKEN && key && base) {
      const res = await fetch(`${base}/rest/v1/rpc/ops_alert_record`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_source_kind: o.sourceKind, p_source: o.source, p_title: o.title, p_severity: o.severity,
          p_sample: (o.sample ?? o.title).slice(0, 2000), p_sample_ref: o.sampleRef ?? {},
          p_verify_kind: o.verifyKind ?? null, p_verify_ref: o.verifyRef ?? null, p_seen_at: o.seenAt ?? null,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`rpc ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return true;
    }
    await sql(`SELECT public.ops_alert_record(${args.join(", ")}) AS id`);
    return true;
  } catch (e) {
    console.log(`::warning title=Ops alert ledger NOT written::${o.title}: ${e.message}`);
    return false;
  }
}

// Occurrences ops_alert_record queued because the ledger row was busy (Q1e).
// They are NOT in the ledger until ops_alert_fold_pending() runs, so a listing
// that ignores them undercounts during a storm.
export const PENDING_SQL = `
SELECT count(*)::int AS n, min(queued_at) AS oldest
  FROM public.ops_alert_pending`;

/**
 * Why the ledger could not be read, in words a session can act on (Q43). A
 * cloud session has neither the linked Supabase CLI nor a Management API
 * token, and "spawnSync supabase ENOENT" says neither of those things.
 */
export function unreadableReason(err, env = process.env) {
  const msg = String(err?.message ?? err).split("\n")[0].slice(0, 160);
  if (/ENOENT/.test(msg) && !(env.SUPABASE_ACCESS_TOKEN && env.SUPABASE_PROJECT_REF)) {
    return (
      "no transport here: no SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF and no supabase CLI on PATH. " +
      "The count is NOT known; read public.ops_alert_ledger another way (e.g. the Supabase MCP, read-only)"
    );
  }
  return msg;
}

// A user-report title is text a person (or a guest) typed. The repo is PUBLIC
// and prod-errors.yml prints this listing into Actions logs and the job
// summary, so the title is redacted HERE, at the one query every printer
// uses (Q64 review, 2026-09-23). Read the real text on /admin?view=health.
export const OPEN_ITEMS_SQL = `
SELECT id, severity, status, source_kind, source,
       CASE WHEN source_kind = 'user-report' THEN 'a user report (read it on /admin?view=health)' ELSE title END AS title,
       count, first_seen, last_seen, verify_kind,
       coalesce(verify_ref, '') AS verify_ref, coalesce(verify_note, '') AS verify_note
  FROM public.ops_alert_ledger
 WHERE status <> 'closed'
 ORDER BY array_position(ARRAY['fatal','critical','error','warning','info'], severity), last_seen DESC`;

/**
 * The newest nightly-red issue (any state) whose title equals `title`,
 * compared case-insensitively (the ledger stores the normalised, lower-cased
 * title). `run(args)` is the gh JSON runner. Returns the full issue (with
 * closed_by) or null. Used by `ops-alert-ledger.mjs sync` for nightly_red
 * items that lost their issue number (docs/OPEN.md Q42).
 */
/**
 * Q1139: the run that may close a nightly_red item whose issue a PERSON
 * closed. A hand-closed issue proves nothing, so sync step 2 never takes it as
 * evidence; but once the issue is closed the workflow's next green run has no
 * issue left to close, so the item could never close at all (2026-10-03: four
 * such items, issues closed by louisianahelpr). The evidence is instead the
 * workflow's own newest completed SCHEDULED or DISPATCHED run on main, green
 * and started after the item's last occurrence. A push run does not count: it
 * may skip the nightly jobs (staleness-watch's "Nothing stale" runs on
 * schedule and dispatch only). `runs` is `gh run list --json
 * conclusion,status,createdAt,url,event`. Returns that run, else null.
 */
export function greenNightlyRunAfter(runs, lastSeen) {
  const nightly = (runs ?? [])
    .filter((r) => r.status === "completed" && (r.event === "schedule" || r.event === "workflow_dispatch"))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = nightly[0];
  if (!newest || newest.conclusion !== "success") return null;
  return Date.parse(newest.createdAt) > Date.parse(lastSeen) ? newest : null;
}

export function newestNightlyIssueByTitle(repo, title, run) {
  const want = String(title).trim().toLowerCase();
  const found = run(["issue", "list", "--repo", repo, "--label", "nightly-red", "--state", "all", "--limit", "50",
    "--search", `in:title "${String(title).replace(/"/g, "")}"`, "--json", "number,title"]) ?? [];
  const same = found.filter((i) => String(i.title).trim().toLowerCase() === want).sort((a, b) => b.number - a.number);
  return same.length ? run(["api", `repos/${repo}/issues/${same[0].number}`]) : null;
}

/**
 * Every name a workflow goes by, lower-cased, mapped to its file base
 * (`quota-monitor.yml` -> `quota-monitor`): the file base itself, its
 * top-level `name:`, and the `workflow-name:` it hands nightly-issue-sync
 * (the nightly-red issue title). `files` is [{ file, text }].
 */
export function workflowAliases(files) {
  const map = new Map();
  for (const { file, text } of files) {
    const base = String(file).replace(/^.*\//, "").replace(/\.ya?ml$/, "");
    const names = [base, /^name:\s*["']?(.+?)["']?\s*$/m.exec(text)?.[1]];
    for (const m of String(text).matchAll(/workflow-name:\s*["']?([^"'\s#]+)/g)) names.push(m[1]);
    for (const n of names) if (n) map.set(n.trim().toLowerCase(), base);
  }
  return map;
}

/**
 * One workflow alerting TWICE in the ledger (2026-09-27: quota-monitor was
 * open as `nightly_red` 79f3fe46 from its nightly-red issue AND as
 * `workflow` d2df1e5e from its own record step). Each closes on a different
 * detector, so the same red counts twice and can half-close.
 *
 * Key: a nightly_red item's title minus "nightly-red: " / "main: "; a
 * workflow item's verify_ref file base, else its source. Both go through
 * `aliases` (workflowAliases) to the workflow file base. A group is a possible
 * duplicate when it has 2+ open items and at least one is nightly_red (two
 * `workflow` items of one workflow are distinct alerts, e.g. two quotas).
 * Returns [{ workflow, items }].
 */
export function ledgerWorkflowKey(r, aliases) {
  let k;
  if (r.source_kind === "nightly_red") k = String(r.title).replace(/^(nightly-red:\s*|main:\s*)+/i, "");
  else if (r.source_kind === "workflow") k = /([^/\s]+)\.ya?ml\b/.exec(String(r.verify_ref ?? ""))?.[1] ?? r.source;
  else return null;
  k = String(k).trim().toLowerCase();
  return aliases.get(k) ?? k;
}

export function duplicateGroups(rows, aliases) {
  const keyOf = (r) => ledgerWorkflowKey(r, aliases);
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups]
    .filter(([, items]) => items.length > 1 && items.some((r) => r.source_kind === "nightly_red"))
    .map(([workflow, items]) => ({ workflow, items }));
}

/**
 * The workflow running this process, as a duplicateGroups key (2026-10-03).
 * prod-errors.yml runs `list --fail-on-dupes`. A group keyed to prod-errors
 * ITSELF (its own nightly_red item plus a workflow item verified by
 * prod-errors.yml, e.g. 42166b2c "Sentry alerts are not synced") closes only
 * on a green prod-errors run, which failing on that group never allows: run
 * 37123912578 stayed red for nothing else, a red that sustained itself.
 * GITHUB_WORKFLOW_REF is "<owner>/<repo>/.github/workflows/<file>@<ref>".
 * Returns null outside GitHub Actions.
 */
export function runningWorkflowKey(env, aliases) {
  const m = /\/\.github\/workflows\/([^/@]+)\.ya?ml@/.exec(String(env.GITHUB_WORKFLOW_REF ?? ""));
  if (!m) return null;
  const k = m[1].toLowerCase();
  return aliases.get(k) ?? k;
}

/** The duplicate groups `list --fail-on-dupes` fails on inside workflow `self`: every group but its own. */
export function dupesThatFail(dupes, self) {
  return dupes.filter((g) => g.workflow !== self);
}

/**
 * The sampleRef for an item recorded on a path that turns the run RED
 * (process.exit(1) next). `fails_run` + `job` let `ops-alert-ledger.mjs sync`
 * prove every failed job of a run recorded its own item (redRunCovered)
 * before it drops the generic nightly_red item for that workflow.
 */
export function failingRunRef(env = process.env) {
  const run_url = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  return { run_url, job: env.GITHUB_JOB ?? null, fails_run: true };
}

// Steps a self-recording workflow may run besides its checks: none can turn a
// run red on a finding, so none needs an item of its own.
const PROD_LOAD_QUEUE_STEP = "node scripts/ci/wait-prod-load.mjs";
const SELF_RECORDING_USES = /^(actions\/checkout@|actions\/setup-node@|\.\/\.github\/actions\/nightly-issue-sync$)/;

/**
 * Workflows that record their OWN ledger item on every red (2026-09-27, the
 * quota-monitor pair). Derived, never listed: every `run:` step of the
 * workflow is exactly `node scripts/<x>.mjs` (no flags, so no --no-ledger),
 * every other step is checkout / setup-node / nightly-issue-sync, and every
 * such script calls failingRunRef() and records with verifyRef "<file>.yml".
 * For these, a generic nightly_red item would count each red twice.
 * `files` is [{ file, text }]; `readScript(path)` returns the script text or null.
 * Returns a Set of workflow file bases.
 */
export function selfRecordingWorkflows(files, readScript) {
  const out = new Set();
  for (const { file, text } of files) {
    const base = String(file).replace(/^.*\//, "").replace(/\.ya?ml$/, "");
    const src = String(text);
    // The prod-load queue job (Q1161) orders a run; it is not a check, so it neither records nor disqualifies.
    const runs = [...src.matchAll(/^\s*(?:-\s+)?run:\s*(.*)$/gm)].map((m) => m[1].trim()).filter((r) => r !== PROD_LOAD_QUEUE_STEP);
    const uses = [...src.matchAll(/^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/gm)].map((m) => m[1]);
    if (!runs.length || !uses.every((u) => SELF_RECORDING_USES.test(u))) continue;
    const scripts = runs.map((r) => /^node (scripts\/[\w./-]+\.mjs)$/.exec(r)?.[1] ?? null);
    if (scripts.some((p) => !p)) continue;
    const ok = scripts.every((p) => {
      const body = readScript(p);
      return typeof body === "string" && body.includes("failingRunRef(") && body.includes(`"${base}.yml"`);
    });
    if (ok) out.add(base);
  }
  return out;
}

/**
 * Did every failed job of red run `runId` record its own item? True only when
 * at least one job failed and the open items with fails_run for that run name
 * at least as many distinct jobs as failed. `items` are ledger rows already
 * filtered to the workflow. False keeps the generic nightly_red item (fail safe).
 */
export function redRunCovered({ runId, failedJobs, items }) {
  if (!(failedJobs > 0)) return false;
  const jobs = new Set();
  for (const r of items) {
    const ref = typeof r.sample_ref === "string" ? JSON.parse(r.sample_ref) : r.sample_ref ?? {};
    if (!ref.fails_run) continue;
    if (/\/actions\/runs\/(\d+)/.exec(String(ref.run_url ?? ""))?.[1] !== String(runId)) continue;
    jobs.add(ref.job ?? r.source);
  }
  return jobs.size >= failedJobs;
}
