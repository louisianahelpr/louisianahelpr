/**
 * OFF-GITHUB UPTIME HEARTBEAT (docs/OPEN.md Q936, owner 2026-10-07).
 *
 * WHY. .github/workflows/uptime.yml asks "is prod answering?" on an every-10-minute cron,
 * but GitHub throttles scheduled workflows: its last 40 scheduled runs
 * (2026-09-28 16:49Z .. 2026-10-06 19:05Z) were 164-558 minutes apart, and
 * prod had no heartbeat of its own. An outage could go unseen for nine hours.
 *
 * WHAT. A Vercel Cron (vercel.json `crons`, every 10 minutes; Vercel Pro, no
 * extra cost) calls this function, which runs the SAME check as uptime.yml
 * (scripts/lib/uptimeProbe.mjs: the site answers 200, and open_jobs_browse
 * answers 200 with at least one row; two consecutive failed rounds before
 * "down"). On `down` it posts a CRITICAL alert to #ops-alerts through the
 * slack-ops-alert edge function. The edge function records its ops-ledger row
 * with a 5 s timeout and posts to Slack regardless, so a dead database does
 * not silence the alert about it.
 *
 * Only `down` alerts. `empty` (a zero-row marketplace before launch, owner
 * 2026-10-02) is uptime.yml's WARNING ledger item already; paging it every 10
 * minutes from here would be noise. Recovery is not announced.
 *
 * WHO MAY TRIGGER AN ALERT. Vercel Cron calls with `user-agent: vercel-cron/1.0`
 * (and, when the project has CRON_SECRET, `Authorization: Bearer <it>`). Any
 * other caller gets the verdict but never an alert, so the URL cannot be used
 * to spam the channel; with CRON_SECRET set, a request without it is refused.
 *
 * ENV (existing Vercel production variables only, owner 2026-10-07):
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY | VITE_SUPABASE_PUBLISHABLE_KEY | SUPABASE_ANON_KEY  (the probe)
 *   SUPABASE_SECRET_KEY, then SUPABASE_SERVICE_ROLE_KEY  (slack-ops-alert accepts either;
 *     the first answered 401 is retried with the second)
 *   CRON_SECRET (optional)
 */
import { runUptime, EMPTY_IS_WARNING_BEFORE_LAUNCH } from "../scripts/lib/uptimeProbe.mjs";

const SITE_URL = "https://www.louisianahelpr.com/";

type Verdict = { status: string; summary: string };

function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return "";
}

/** Post one critical alert through slack-ops-alert; returns what happened. */
export async function alertDown(summary: string): Promise<string> {
  const base = env("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/+$/, "");
  const keys = [env("SUPABASE_SECRET_KEY"), env("SUPABASE_SERVICE_ROLE_KEY")].filter(Boolean);
  if (!base || !keys.length) return "not sent: no SUPABASE_URL or service key in this environment";
  const body = JSON.stringify({
    kind: "custom",
    severity: "critical",
    title: "Prod is DOWN (Vercel uptime heartbeat)",
    message: summary,
    fields: { source: "Vercel Cron → /api/uptime-heartbeat (every 10 min)", site: SITE_URL },
  });
  let last = "";
  for (const key of keys) {
    try {
      const res = await fetch(`${base}/functions/v1/slack-ops-alert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return `sent (HTTP ${res.status})`;
      last = `HTTP ${res.status}`;
      if (res.status !== 401) break; // only a refused key is worth the other key
    } catch (e) {
      // Not swallowed: the reason is kept in `last`, logged below and returned.
      last = e instanceof Error ? e.message : "fetch failed";
      break;
    }
  }
  // Never silent: Vercel's function log keeps this line.
  console.error(`uptime-heartbeat: the DOWN alert was not delivered (${last})`);
  return `not delivered (${last})`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization") ?? "";
    if (secret && auth !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    const fromCron = (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/") || (!!secret && auth === `Bearer ${secret}`);
    const gap = Number(process.env.UPTIME_ROUND_GAP_MS ?? 20_000);
    const verdict: Verdict = await runUptime({
      siteUrl: SITE_URL,
      supabaseUrl: env("SUPABASE_URL", "VITE_SUPABASE_URL"),
      key: env("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"),
      rounds: 3,
      roundGapMs: Number.isFinite(gap) ? gap : 20_000,
      timeoutMs: 10_000,
      emptyIsWarning: EMPTY_IS_WARNING_BEFORE_LAUNCH,
      userAgent: "louisianahelpr-uptime-vercel/1",
      log: (line: string) => console.log(line),
    });
    const alerted = verdict.status === "down" && fromCron ? await alertDown(verdict.summary) : "no";
    console.log(`uptime-heartbeat: ${verdict.summary} (alert: ${alerted})`);
    return new Response(JSON.stringify({ status: verdict.status, summary: verdict.summary, alerted }), {
      status: verdict.status === "down" ? 503 : 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  },
};
