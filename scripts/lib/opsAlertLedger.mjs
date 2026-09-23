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
import { execFileSync } from "node:child_process";

/** SQL string literal. standard_conforming_strings is on in Supabase. */
export const lit = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`;

export async function sql(query, { readOnly = false, timeoutMs = 20000 } = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  const args = ["db", "query", "--linked", "-o", "json", query];
  if (process.env.LH_SUPABASE_WORKDIR) args.unshift("--workdir", process.env.LH_SUPABASE_WORKDIR);
  const out = execFileSync("supabase", args, {
    encoding: "utf8",
    maxBuffer: 1 << 24,
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
export function newestNightlyIssueByTitle(repo, title, run) {
  const want = String(title).trim().toLowerCase();
  const found = run(["issue", "list", "--repo", repo, "--label", "nightly-red", "--state", "all", "--limit", "50",
    "--search", `in:title "${String(title).replace(/"/g, "")}"`, "--json", "number,title"]) ?? [];
  const same = found.filter((i) => String(i.title).trim().toLowerCase() === want).sort((a, b) => b.number - a.number);
  return same.length ? run(["api", `repos/${repo}/issues/${same[0].number}`]) : null;
}
