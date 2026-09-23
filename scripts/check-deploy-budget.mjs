#!/usr/bin/env node
/**
 * Pre-push warning: how close is Vercel's free-tier daily deploy limit?
 *
 * 2026-09-13: ~100 production deploys in 24h hit "Deployment rate limited —
 * retry in 24 hours" and app fixes stopped reaching prod while main moved.
 * The owner's rule since then is to batch pushes; this makes the budget
 * visible at the moment it matters. Counts GitHub "Production" deployments
 * (Vercel creates one per production build) in the last 24h. Warns, never
 * blocks: since Q271 (2026-09-23) a push costs no deploy at all; production
 * deploys are batched by .github/workflows/prod-deploy.yml (at most ~3/hour).
 *
 *   node scripts/check-deploy-budget.mjs   # prints the count; exit 0 always
 */
import { execFileSync } from "node:child_process";

const LIMIT = Number(process.env.LH_VERCEL_DAILY_LIMIT || 100);
const WARN_AT = Math.floor(LIMIT * 0.7);

let count;
try {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const out = execFileSync(
    "gh",
    ["api", "repos/louisianahelpr/louisianahelpr/deployments?environment=Production&per_page=100", "-q",
      `[.[] | select(.created_at > "${since}")] | length`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 },
  ).trim();
  count = Number(out);
} catch {
  console.log("[deploy-budget] could not read deployments (gh offline or unauthenticated) — not checked.");
  process.exit(0);
}

if (!Number.isFinite(count)) process.exit(0);
if (count >= WARN_AT) {
  console.warn(
    `\n[deploy-budget] ⚠️  ${count} production deploys in the last 24h (free-tier limit ~${LIMIT}).\n` +
      "  An app change pushed now may be rate-limited and NOT reach prod. Batch it with other work.\n",
  );
} else {
  console.log(`[deploy-budget] ${count}/${LIMIT} production deploys in the last 24h.`);
}
