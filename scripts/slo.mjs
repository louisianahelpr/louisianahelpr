#!/usr/bin/env node
/**
 * TARGETS ("SLOs") — what "working" means, as numbers (docs/OPEN.md Q66).
 *
 * Each metric names the ONE source that measures it, its window, its target
 * and which way is good. scripts/scoreboard.mjs shows them twice:
 *   LOCAL  one INFO row per metric with its target and source, diffed on every
 *          push, so the definitions on the scoreboard cannot drift from here;
 *   LIVE   the measured value against the target, PASS / FAIL, refreshed by
 *          `node scripts/scoreboard.mjs --write` and daily by
 *          .github/workflows/scoreboard.yml with its existing secrets
 *          (GH_TOKEN, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF). That run
 *          also writes the dated record test-results/slo/slo-<date>.json into
 *          its artifact.
 *
 * Rules (same as the scoreboard's): a metric with no source here is UNKNOWN
 * with the reason ("not measured: ..."), never a number; a query that fails, or
 * a window with nothing in it, is UNKNOWN with the reason; only a real value
 * inside its target is PASS. A value exactly on the target passes.
 *
 * Every metric maps to a phrase of Q66's own list (`q66`); the two lists are
 * checked both ways by src/test/sloTargetsTwoWay.test.ts.
 */
import { execFileSync } from "node:child_process";

export const GROUP = "targets (SLOs)";

/**
 * @typedef {{ id:string, q66:string, name:string, target:number, unit:"ms"|"%"|"h",
 *   good:"max"|"min", window:string, source:string, ci:string|null, notMeasured?:string }} Slo
 * `good: "max"` = the value must stay AT OR BELOW the target; "min" = at or above.
 * `ci`: how CI measures it (null when it cannot).
 */
/** @type {Slo[]} */
export const SLOS = [
  {
    id: "page-load-web", q66: "p95 page load (web + app)", name: "p95 page load, web (real users)",
    target: 4000, unit: "ms", good: "max", window: "7d",
    source: "Vercel Speed Insights (`SpeedInsights` in src/App.tsx)",
    ci: null,
    notMeasured: "real-user load times go only to Vercel Speed Insights, and no script or CI secret here reads them (VERCEL_TOKEN is optional and used only for billing in supabase-usage.yml). lighthouse.yml is one simulated lab load per URL, weekly, not a p95 of real loads",
  },
  {
    id: "page-load-app", q66: "p95 page load (web + app)", name: "p95 page load, iOS/Android app",
    target: 4000, unit: "ms", good: "max", window: "7d",
    source: "none: the app records no load timing",
    ci: null,
    notMeasured: "the native app records no load or launch timing anywhere (no timing property is sent to analytics_events or Sentry from src/; checked 2026-09-23)",
  },
  {
    id: "api-error-rate", q66: "API error rate", name: "API error rate (5xx share of Supabase API requests)",
    target: 1, unit: "%", good: "max", window: "24h",
    source: "Management API logs.all: edge_logs (every REST, auth, storage and edge-function request), status_code >= 500",
    ci: "scoreboard.yml (SUPABASE_ACCESS_TOKEN)",
  },
  {
    id: "uptime", q66: "uptime", name: "uptime (share of uptime.yml probes that found prod up)",
    target: 99.5, unit: "%", good: "min", window: "7d",
    source: "GitHub Actions: scheduled uptime.yml runs on main (every 10 min; a failed run = site or database down)",
    ci: "scoreboard.yml (GH_TOKEN)",
  },
  {
    id: "payment-success", q66: "payment success rate", name: "payment success rate (Stripe payment intents)",
    target: 95, unit: "%", good: "min", window: "7d",
    source: "public.stripe_webhook_events: payment_intent.succeeded / (succeeded + payment_intent.payment_failed)",
    ci: "scoreboard.yml (SUPABASE_ACCESS_TOKEN, read-only SQL)",
  },
  {
    id: "notification-delivery", q66: "notification delivery rate", name: "notification delivery rate (in-app + email)",
    target: 99, unit: "%", good: "min", window: "7d",
    source: "public.notification_logs: status sent / (sent + failed); suppressed and skipped are intentional and not counted",
    ci: "scoreboard.yml (SUPABASE_ACCESS_TOKEN, read-only SQL)",
  },
  {
    id: "time-to-payout", q66: "time to a payout", name: "p95 time from job completed to payout transfer",
    target: 30, unit: "h", good: "max", window: "30d",
    source: "public.payout_transfers (status paid) joined to public.jobs.completed_at; target = 24h hold (auto-release-payment) + 6h stranded window (money-reconciliation)",
    ci: "scoreboard.yml (SUPABASE_ACCESS_TOKEN, read-only SQL)",
  },
];

// ── judging ────────────────────────────────────────────────────────────────

export const fmt = (v, unit) => (unit === "%" ? `${Number(v).toFixed(2)}%` : unit === "h" ? `${Number(v).toFixed(1)} h` : `${Math.round(v)} ms`);
export const targetText = (s) => `${s.good === "max" ? "≤" : "≥"} ${s.unit === "ms" ? `${s.target} ms` : s.unit === "%" ? `${s.target}%` : `${s.target} h`}`;

/** PASS when the value is inside the target (on the target counts as inside). */
export function judge(slo, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "UNKNOWN";
  return (slo.good === "max" ? value <= slo.target : value >= slo.target) ? "PASS" : "FAIL";
}

/** Deterministic definition rows for the scoreboard's LOCAL section. */
export function sloTargetRows(at) {
  return SLOS.map((s) => ({
    group: GROUP, signal: `target: ${s.name}`, status: "INFO", total: targetText(s), at,
    source: s.source,
    note: s.ci ? `window ${s.window}; measured daily in CI by ${s.ci}; verdict in the live section` : `window ${s.window}; NOT MEASURED: ${s.notMeasured}`,
  }));
}

// ── measuring (IO injected, so the test drives it with fixtures) ───────────

const errMsg = (e) => String(e?.stderr || e?.message || e).split("\n").find((l) => l.trim())?.slice(0, 160) ?? "error";
const pct = (ok, bad) => (100 * ok) / (ok + bad);

export const SQL = {
  payment: `SELECT count(*) FILTER (WHERE event_type = 'payment_intent.succeeded')::int AS ok,
      count(*) FILTER (WHERE event_type = 'payment_intent.payment_failed')::int AS bad
    FROM public.stripe_webhook_events WHERE processed_at > now() - interval '7 days'`,
  notifications: `SELECT count(*) FILTER (WHERE status = 'sent')::int AS ok,
      count(*) FILTER (WHERE status = 'failed')::int AS bad,
      count(*) FILTER (WHERE status IN ('suppressed', 'skipped'))::int AS intentional
    FROM public.notification_logs WHERE created_at > now() - interval '7 days'`,
  payout: `SELECT count(*)::int AS n,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM coalesce(pt.paid_at, pt.created_at) - j.completed_at) / 3600) AS p95_h,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM coalesce(pt.paid_at, pt.created_at) - j.completed_at) / 3600) AS p50_h
    FROM public.payout_transfers pt JOIN public.jobs j ON j.id = pt.job_id
    WHERE pt.status = 'paid' AND pt.created_at > now() - interval '30 days' AND j.completed_at IS NOT NULL`,
  apiErrors: "select count(*) as total, countif(r.status_code >= 500) as errors from edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r",
};

/**
 * One live row per SLO. Each fetcher may throw; that metric is then UNKNOWN.
 * @param {{ now?:Date, sqlFn:(q:string)=>Promise<any[]>, logsFn:(q:string, startIso:string, endIso:string)=>Promise<any[]>,
 *   runsFn:(sinceIso:string)=>Promise<{conclusion:string}[]> }} io
 */
export async function measureSlos({ now = new Date(), sqlFn, logsFn, runsFn }) {
  const at = now.toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");
  const out = [];
  const row = (s, fields) => ({ group: GROUP, signal: s.name, at, source: s.source, ...fields });
  const unk = (s, why) => row(s, { status: "UNKNOWN", value: null, note: `UNKNOWN: ${why}` });
  const verdict = (s, value, fields, extra) => row(s, {
    status: judge(s, value), value, ...fields,
    note: `${fmt(value, s.unit)} vs target ${targetText(s)} over ${s.window}${extra ? `; ${extra}` : ""}`,
  });

  for (const s of SLOS) {
    if (s.notMeasured) { out.push(unk(s, `not measured (${s.notMeasured})`)); continue; }
    try {
      if (s.id === "api-error-rate") {
        const end = now.toISOString(), start = new Date(now - 864e5).toISOString();
        const [r] = await logsFn(SQL.apiErrors, start, end);
        const total = Number(r?.total), errors = Number(r?.errors);
        if (!Number.isFinite(total) || !Number.isFinite(errors)) throw new Error("no count in the logs response");
        if (!total) { out.push(unk(s, "no API requests in the window (logs empty?)")); continue; }
        out.push(verdict(s, (100 * errors) / total, { pass: total - errors, fail: errors, total }, `${errors} of ${total} requests answered 5xx`));
      } else if (s.id === "uptime") {
        const runs = await runsFn(new Date(now - 7 * 864e5).toISOString());
        const ok = runs.filter((r) => r.conclusion === "success").length;
        const bad = runs.filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion)).length;
        if (!ok && !bad) { out.push(unk(s, "no conclusive scheduled uptime.yml run on main in 7 days")); continue; }
        out.push(verdict(s, pct(ok, bad), { pass: ok, fail: bad, total: ok + bad },
          `${ok + bad} conclusive probes of ~1008 scheduled (GitHub drops some cron runs); ${runs.length - ok - bad} cancelled/skipped not counted`));
      } else if (s.id === "payment-success") {
        const [r] = await sqlFn(SQL.payment);
        const ok = Number(r?.ok), bad = Number(r?.bad);
        if (!Number.isFinite(ok) || !Number.isFinite(bad)) throw new Error("unexpected result shape");
        if (!ok && !bad) { out.push(unk(s, "no payment_intent succeeded/failed events in 7 days")); continue; }
        out.push(verdict(s, pct(ok, bad), { pass: ok, fail: bad, total: ok + bad }, "Stripe is in SANDBOX until launch: these are test-card payments"));
      } else if (s.id === "notification-delivery") {
        const [r] = await sqlFn(SQL.notifications);
        const ok = Number(r?.ok), bad = Number(r?.bad);
        if (!Number.isFinite(ok) || !Number.isFinite(bad)) throw new Error("unexpected result shape");
        if (!ok && !bad) { out.push(unk(s, "no sent or failed notification_logs rows in 7 days")); continue; }
        out.push(verdict(s, pct(ok, bad), { pass: ok, fail: bad, total: ok + bad }, `${Number(r.intentional) || 0} suppressed/skipped not counted; push delivery is the check_push_token_health row`));
      } else if (s.id === "time-to-payout") {
        const [r] = await sqlFn(SQL.payout);
        const n = Number(r?.n);
        if (!Number.isFinite(n)) throw new Error("unexpected result shape");
        if (!n) { out.push(unk(s, "no paid payout transfer with a completed job in 30 days")); continue; }
        const p95 = Number(r.p95_h), p50 = Number(r.p50_h);
        out.push(verdict(s, p95, { total: n }, `median ${fmt(p50, "h")}, ${n} paid transfers; Stripe SANDBOX until launch`));
      } else {
        throw new Error(`no measurement for ${s.id}`);
      }
    } catch (e) {
      out.push(unk(s, `measurement failed: ${errMsg(e)}`));
    }
  }
  return out;
}

// ── the real fetchers (CI: GH_TOKEN + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF) ──

export async function realIo(sqlFn) {
  const logsFn = async (q, start, end) => {
    const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
    if (!token || !ref) throw new Error("needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (scoreboard.yml has them)");
    const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(q)}&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(end)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Management API ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 160));
    return body.result ?? [];
  };
  const runsFn = async (sinceIso) => {
    const out = execFileSync("gh", ["api", "--paginate",
      `repos/{owner}/{repo}/actions/workflows/uptime.yml/runs?branch=main&event=schedule&status=completed&per_page=100&created=>=${sinceIso.slice(0, 10)}`,
      "--jq", ".workflow_runs[] | {conclusion, created_at}"], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    return out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.created_at >= sinceIso);
  };
  return { sqlFn, logsFn, runsFn };
}

/** The dated record the scheduled run keeps (test-results/slo/slo-<date>.json, uploaded as an artifact). */
export function sloRecord(rows, now = new Date()) {
  return {
    measuredAt: now.toISOString(),
    metrics: rows.map((r) => {
      const s = SLOS.find((x) => x.name === r.signal);
      return { id: s?.id, name: r.signal, status: r.status, value: r.value ?? null, unit: s?.unit, target: s ? targetText(s) : null, window: s?.window, note: r.note };
    }),
  };
}
