#!/usr/bin/env node
/**
 * Settle forward every hired-AND-funded E2E leftover sitting in escrow on prod.
 *
 * The backlog half of the teardown fix. `02-marketplace.spec.ts` now settles
 * its OWN job forward when `cancel_escrow` refuses it, but nothing was ever
 * going to clear the pile that refusal had already built: 16 rows on
 * 2026-09-22, the oldest from 2026-09-15, none of which `auto-release-payment`
 * could ever see (it wants `helper_completed_at`, and these had none).
 *
 * Every row it touches must pass `settleRefusalReason` — is_seed, owned by THIS
 * poster and THIS helper, funded into escrow, hired, and NOT under dispute.
 * Anything else is listed and skipped, including the disputed fixture whose
 * escrow belongs to the admin who will decide where it goes.
 *
 * Usage (mints both test sessions itself; --dry-run lists and touches nothing):
 *   node scripts/e2e/settle-stranded-escrow.mjs [--dry-run] [--limit N] [--job <uuid>]
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { settleJobForward, settleRefusalReason, readJobRow } from "./settleForward.mjs";

const BASE = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";
const DRY = process.argv.includes("--dry-run");
const LIMIT = Number(argOf("--limit") ?? Infinity);
const ONLY = argOf("--job");
const MARKER = "[E2E DO NOT ACCEPT]";

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function session(account) {
  const raw = JSON.parse(
    execFileSync("node", [resolve(process.cwd(), "scripts/test-signin-link.mjs"), account, "--session", "--json"], {
      encoding: "utf8",
      maxBuffer: 1 << 24,
    }),
  );
  const parsed = JSON.parse(raw.value);
  return { userId: parsed.user.id, token: parsed.access_token };
}

const poster = session("poster-e2e");
const helper = session("helper-e2e");

const seats = { posterId: poster.userId, helperId: helper.userId };

async function stranded() {
  if (ONLY) return [await readJobRow({ base: BASE, anon: ANON, posterToken: poster.token, jobId: ONLY })];
  const url =
    `${BASE}/rest/v1/jobs?select=id,title,stripe_session_id,status,payment_status,customer_id,helper_id,is_seed,disputed_at,has_active_dispute,created_at` +
    `&customer_id=eq.${poster.userId}&helper_id=eq.${helper.userId}` +
    `&payment_status=eq.escrow&status=in.(accepted,in_progress,revision_requested)` +
    `&title=like.*${encodeURIComponent(MARKER)}*&order=created_at.asc`;
  const r = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${poster.token}` } });
  if (!r.ok) throw new Error(`listing stranded rows: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

const rows = await stranded();
console.log(`Settle-forward sweep — ${BASE}`);
console.log(`Hired + funded leftovers matching "${MARKER}": ${rows.length}${DRY ? "  (DRY RUN)" : ""}\n`);

const settled = [];
const skipped = [];
const failed = [];
let touched = 0;

for (const row of rows) {
  const refusal = settleRefusalReason(row, seats);
  console.log(`  ${row.id}  ${row.status}/${row.payment_status}  created ${row.created_at ?? "?"}  ${refusal ? `SKIP — ${refusal}` : "→ settle forward"}`);
  if (refusal) {
    skipped.push({ id: row.id, refusal });
    continue;
  }
  if (DRY || touched >= LIMIT) continue;
  // ONE ROW PER RATE-LIMIT WINDOW. `create-payment` allows 10 calls per 60s per
  // subject and counts refusals, so a back-to-back queue spends the whole sweep
  // being told no (measured 2026-09-22: six consecutive 429s on the second row).
  if (touched > 0) await new Promise((r) => setTimeout(r, 65_000));
  touched += 1;
  try {
    const out = await settleJobForward({
      base: BASE,
      anon: ANON,
      posterToken: poster.token,
      helperToken: helper.token,
      posterId: poster.userId,
      helperId: helper.userId,
      jobId: row.id,
      log: (line) => console.log(line),
    });
    (out.settled ? settled : failed).push({ id: row.id, ...out });
  } catch (err) {
    console.error(`    ${row.id}: ${String(err).slice(0, 300)}`);
    failed.push({ id: row.id, reason: String(err).slice(0, 300) });
  }
}

console.log(`\nsettled=${settled.length} skipped=${skipped.length} failed=${failed.length}`);
if (failed.length) {
  console.error(failed.map((f) => `  ${f.id}: ${f.reason}`).join("\n"));
  process.exit(1);
}
