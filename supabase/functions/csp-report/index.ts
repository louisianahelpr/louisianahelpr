// csp-report — where browsers send Content-Security-Policy violations
// (vercel.json: `report-uri` and `report-to csp-endpoint` + Reporting-Endpoints).
//
// Public by necessity: a browser posts a violation report with no apikey and
// no Authorization header, so config.toml sets verify_jwt = false. It writes
// ONE public.error_logs row per request and nothing else.
//
// Why it cannot reach Slack or mute a server page (Q1159's origin rule): the
// insert runs on a client built from the PUBLISHABLE (anon) key, the same
// identity a browser already has for its own error_logs INSERT
// (anyone_can_insert_errors). stamp_error_log_origin keys on current_user, so
// the row is stamped tags.origin = 'client': notify_slack_on_error_log and
// ops_alert_ledger_from_error_log return early on it, every server throttle
// and dedupe ignores it, and throttle_client_error_log's guest caps apply. A
// service-role insert here would be stamped 'server' and page #ops-alerts.
// Severity is 'warning' (see report.ts toErrorLogRow).
//
// Cheapest checks first, so noise never costs a database call: method, size
// (64 KB, enforced while reading), shape, extension noise; then the per-IP limit (_shared/rate-limit.ts,
// durable, server-derived address), then the insert. Browsers ignore the
// response, so success is an empty 204.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { serve } from "../_shared/buildStamp.ts";
import { MAX_BODY_BYTES, isNoise, parseReports, toErrorLogRow } from "./report.ts";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_IP = 20;

/**
 * The body as text, or null once it passes `max` bytes. Read as a stream with
 * the cap applied while reading, so a body with no Content-Length (chunked) is
 * never buffered past the cap.
 */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      // Stop the upload; the 413 is the answer either way.
      await reader.cancel().catch((e) => console.warn(`[csp-report] cancel after cap: ${String(e).slice(0, 100)}`));
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...corsHeaders, ...extra } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // The Reporting API preflights a cross-origin endpoint
    // (Content-Type application/reports+json is not CORS-safelisted).
    return empty(204, { "Access-Control-Allow-Methods": "POST, OPTIONS" });
  }
  if (req.method !== "POST") return empty(405, { Allow: "POST, OPTIONS" });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413);
  const body = await readCapped(req, MAX_BODY_BYTES);
  if (body === null) return empty(413);

  const parsed = parseReports(req.headers.get("content-type"), body);
  if (!parsed.ok) return empty(parsed.status);

  const kept = parsed.violations.filter((v) => !isNoise(v));
  if (kept.length === 0) return empty(204);

  const rl = await checkRateLimit(req, {
    windowMs: RATE_WINDOW_MS,
    maxRequests: RATE_MAX_PER_IP,
    ipMaxRequests: RATE_MAX_PER_IP,
    keyPrefix: "csp-report",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) {
    console.error("[csp-report] SUPABASE_URL or the publishable key is not set; report not stored");
    return empty(503);
  }

  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const row = toErrorLogRow(kept, parsed.violations.length - kept.length, req.headers.get("user-agent"));
  // No `.select()`: anon has no SELECT on error_logs. Zero rows is legitimate
  // here: throttle_client_error_log drops a guest row over its caps by design.
  const { error } = await anon.from("error_logs").insert(row);
  if (error) {
    console.error(`[csp-report] error_logs insert failed: ${error.message}`);
    return empty(500);
  }
  return empty(204);
});
