#!/usr/bin/env node
/**
 * Expiry monitor (docs/OPEN.md Q62): things that die silently on a date.
 *
 *   node scripts/expiry-check.mjs [--ci] [--json] [--warn-days 30] [--inventory <path>]
 *
 * Reads every item in scripts/audit/expiry-inventory.json the way the
 * inventory says (TLS handshake, RDAP, JWT exp, .p12/.pem notAfter, App Store
 * Connect API, Vercel/Graph/Supabase Management APIs) and prints one line per
 * item. Logic and statuses: scripts/lib/expiryMonitor.mjs.
 *
 * Exits non-zero when any item is DUE (inside warnDays) or EXPIRED, and, with --ci,
 * when an item the inventory marks ciReadable came back UNREADABLE (the
 * monitor went blind where it promised to see). Every other UNREADABLE is
 * printed as a ::warning:: line and counted in the summary — never folded
 * into a green "all clear".
 *
 * Writes expiry-report.md, and warn/summary to GITHUB_OUTPUT when present.
 * The ledger write and the Slack page are the workflow's job
 * (.github/workflows/expiry-monitor.yml), the same split as supabase-usage.yml.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadInventory, renderReport, runAll, verdict } from "./lib/expiryMonitor.mjs";

const args = process.argv.slice(2);
const ci = args.includes("--ci");
const asJson = args.includes("--json");
const wi = args.indexOf("--warn-days");
const ii = args.indexOf("--inventory");
const root = resolve(import.meta.dirname, "..");
// --inventory: a fixture inventory (src/test/expiryMonitor.test.ts drives this CLI with one).
const inv = ii >= 0 ? JSON.parse(readFileSync(resolve(args[ii + 1]), "utf8")) : loadInventory(root);
const now = new Date();
const { results, warnDays } = await runAll(inv, now, { root, warnDays: wi >= 0 ? Number(args[wi + 1]) : undefined });
const v = verdict(results, { ci });

if (asJson) {
  console.log(JSON.stringify({ at: now.toISOString(), warnDays, verdict: { fail: v.fail, summary: v.summary }, results }, null, 2));
} else {
  for (const r of results) {
    const when = r.expiresAt ? `${r.expiresAt.slice(0, 10)} (${r.daysLeft}d)` : "—";
    console.log(`${r.status.padEnd(10)} ${r.label.padEnd(64)} ${when.padEnd(18)} ${r.detail}`);
  }
  console.log(`\n${v.summary}${v.fail ? " — FAILING" : ""}`);
}

const gha = !!process.env.GITHUB_ACTIONS;
for (const r of v.due) console.log(`${gha ? "::error::" : "ERROR "}${r.label} ${r.status === "EXPIRED" ? "EXPIRED" : "expires"} ${r.expiresAt.slice(0, 10)} (${r.daysLeft} days) — ${r.source}`);
for (const r of v.unreadable) {
  const blind = v.blind.includes(r);
  console.log(`${gha ? (blind ? "::error::" : "::warning::") : blind ? "ERROR " : "WARNING "}UNREADABLE here: ${r.label} — ${r.detail}${blind ? " (the inventory says CI can read this)" : ""}`);
}

writeFileSync(resolve(process.env.EXPIRY_REPORT ?? "expiry-report.md"), renderReport(results, v, now, warnDays));
if (process.env.GITHUB_OUTPUT) {
  const summary = v.due.length
    ? v.due.map((r) => `${r.label} ${r.status === "EXPIRED" ? "EXPIRED" : "expires"} ${r.expiresAt.slice(0, 10)}`).join("; ")
    : v.summary;
  appendFileSync(process.env.GITHUB_OUTPUT, `warn=${v.due.length ? "true" : "false"}\nsummary=${summary.replace(/\n/g, " ")}\n`);
}
process.exit(v.fail ? 1 : 0);
