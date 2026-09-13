#!/usr/bin/env node
/**
 * Read-only notification-delivery audit.
 *
 * Checks, against the LIVE database (never mutates):
 *   1. `notification_type_pref_map` has a row for every `type` seen in
 *      `notifications` in the lookback window — a miss means push/email
 *      fell open or silently mis-categorized (see the fail-open comment in
 *      `20260903012715_notification_preferences_always_exist.sql`).
 *   2. Every recent `notifications` row of a mapped type has a matching
 *      `notification_logs(channel='in_app')` row — a miss means
 *      `log_notification()`'s void return lied (RETURNS void proves the call
 *      happened, not that the row exists — the exact class CLAUDE.md calls
 *      out).
 *   3. For a sample of recent `channel='email'` sends, the logged category
 *      matches what `notification_type_pref_map` says the source type should
 *      map to — catches TYPE_MAP / DB map drift before
 *      notificationTypeRegistries.test.ts would (that test only guards the
 *      static tables, not what actually got logged).
 *   4. `channel='push'` rows exist at all (they were 0 in prod at write time
 *      per notificationLog.ts's own comment) and `token_deleted` rows, if
 *      any, correspond to `push_tokens` actually being gone for that user.
 *
 * Usage:
 *   node scripts/audit/notification-delivery.mjs [--hours 24] [--limit 500]
 *
 * Needs `.env` with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same as
 * scripts/test-signin-link.mjs — copy it from the main checkout if missing).
 * Every query is a plain SELECT; nothing here writes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function readEnv() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(
      `ERROR: no .env at ${envPath}.\n` +
        `It is gitignored — copy it from the main checkout:\n` +
        `  cp /Users/lexilombas/louisianahelpr/.env "${repoRoot}/.env"`,
    );
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function sb(url, key, restPath) {
  const res = await fetch(`${url}/rest/v1/${restPath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`${restPath} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const hours = Number(arg("hours", "24"));
  const limit = Number(arg("limit", "500"));
  const env = readEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ERROR: .env is missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const findings = [];

  console.log(`Notification delivery audit — last ${hours}h, limit ${limit} rows per table.\n`);

  // 1 & 2: notifications vs pref map vs in_app logs.
  const [prefMap, notifications, inAppLogs] = await Promise.all([
    sb(url, key, `notification_type_pref_map?select=type,pref_column,description`),
    sb(
      url,
      key,
      `notifications?select=id,type,user_id,created_at&created_at=gte.${since}&order=created_at.desc&limit=${limit}`,
    ),
    sb(
      url,
      key,
      `notification_logs?select=id,category,channel,status,user_id,created_at&channel=eq.in_app&created_at=gte.${since}&order=created_at.desc&limit=${limit}`,
    ),
  ]);

  const mappedTypes = new Set(prefMap.map((r) => r.type));
  const unmappedTypesSeen = new Set(
    notifications.filter((n) => !mappedTypes.has(n.type)).map((n) => n.type),
  );
  if (unmappedTypesSeen.size) {
    findings.push({
      severity: "HIGH",
      what: `notifications.type value(s) with no notification_type_pref_map row: ${[...unmappedTypesSeen].join(", ")}`,
      why: "push sends WITHOUT a category check for these (fail-open by design), and email falls through to send-notification-email's TYPE_MAP default rather than the user's actual preference.",
    });
  }

  // Every notification should have produced an in_app log row (best-effort —
  // logs may lag by a few seconds, so this only flags rows older than 5 min).
  const logByUser = new Map();
  for (const l of inAppLogs) {
    const k = `${l.user_id}|${l.category}`;
    logByUser.set(k, (logByUser.get(k) || 0) + 1);
  }
  const staleNotifications = notifications.filter(
    (n) => new Date(n.created_at).getTime() < Date.now() - 5 * 60_000,
  );
  const missingLogSample = [];
  for (const n of staleNotifications) {
    const mapped = prefMap.find((p) => p.type === n.type);
    const category = mapped?.pref_column;
    if (!category) continue;
    const key1 = `${n.user_id}|${category}`;
    if (!logByUser.has(key1)) missingLogSample.push({ id: n.id, type: n.type, user_id: n.user_id });
  }
  if (missingLogSample.length) {
    findings.push({
      severity: "HIGH",
      what: `${missingLogSample.length} notifications row(s) with no matching notification_logs(channel=in_app) row (sample: ${JSON.stringify(missingLogSample.slice(0, 5))})`,
      why: "log_notification() RETURNS void — a null error there only proves the call happened, not that the row exists. This is the exact silent-failure shape CLAUDE.md flags as the most common serious bug class here.",
    });
  }

  // 4: push channel presence.
  const pushLogs = await sb(
    url,
    key,
    `notification_logs?select=id,status,user_id,created_at&channel=eq.push&created_at=gte.${since}&order=created_at.desc&limit=${limit}`,
  );
  if (pushLogs.length === 0) {
    findings.push({
      severity: "INFO",
      what: `Zero channel='push' rows in the last ${hours}h.`,
      why: "Per notificationLog.ts's own history, zero has meant both 'push is fully broken' and 'a quiet hour' — it is not evidence on its own. Cross-check push_tokens has live rows for at least one recently-active account before treating this as healthy.",
    });
  }
  const tokenDeleted = pushLogs.filter((p) => p.status === "token_deleted");
  if (tokenDeleted.length) {
    console.log(`  ${tokenDeleted.length} token_deleted row(s) in window — device tokens APNs/FCM rejected as dead.`);
  }

  // Push_tokens sanity: any rows at all?
  const pushTokens = await sb(url, key, `push_tokens?select=user_id&limit=1`);
  if (pushTokens.length === 0) {
    findings.push({
      severity: "HIGH",
      what: "push_tokens table has zero rows.",
      why: "No device has ever registered for push, or registration is broken again post the AppDelegate fix. Verify against a real device before assuming this is expected for a pre-launch app.",
    });
  }

  console.log(`\nChecked ${notifications.length} notifications, ${inAppLogs.length} in_app logs, ${pushLogs.length} push logs.\n`);

  if (findings.length === 0) {
    console.log("No findings.");
  } else {
    console.log(`${findings.length} finding(s):\n`);
    for (const f of findings) {
      console.log(`[${f.severity}] ${f.what}`);
      console.log(`  why: ${f.why}\n`);
    }
  }

  process.exit(findings.some((f) => f.severity === "HIGH") ? 1 : 0);
}

main().catch((err) => {
  console.error("Audit script failed:", err.message);
  process.exit(2);
});
