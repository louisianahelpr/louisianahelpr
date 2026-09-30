#!/usr/bin/env node
/**
 * Stripe webhook endpoint guard — the class check for issue #1586
 * ("every webhook delivered twice").
 *
 * Two independent failure modes, neither visible from one side alone:
 *
 *   A. DUPLICATE ENDPOINTS. scripts/e2e/stripe-sandbox-on.sh used to POST a new
 *      test-mode webhook endpoint on every run and stash the id in /tmp. When
 *      /tmp was wiped, stripe-sandbox-off.sh deleted nothing, and the next run
 *      added a second enabled endpoint on the same url. Both signing secrets
 *      were still in the comma-separated STRIPE_WEBHOOK_SECRET that
 *      supabase/functions/stripe-webhook/index.ts accepts, so BOTH copies of
 *      every event verified and were processed. Double refunds, double
 *      transfers, double escrow releases. The same failure is possible in live
 *      mode from the dashboard, so the live half asserts exactly one.
 *
 *   B. EVENT DRIFT. The subscription list and the EVENT_HANDLERS dispatch map
 *      drift apart in both directions, and both directions are silent:
 *        - subscribed, no handler  -> the event is delivered and dropped on the
 *          floor ("Unhandled event type"), so a money path looks wired and is not.
 *        - handler, not subscribed -> the handler never runs at all.
 *      As of 2026-09-12 the shipped script's hardcoded list had EIGHT missing
 *      events and still carried invoice.paid, which has no handler.
 *
 * Structure: the STATIC half needs no credentials and always runs. The LIVE
 * half reads Stripe LIVE mode (Stripe went live on prod 2026-09-27; the
 * test-mode endpoint is disabled on purpose, Q839) with a RESTRICTED read-only
 * key in STRIPE_LIVE_READ_KEY (owner decision 2026-09-30: rk_live_, only
 * "Webhook Endpoints: Read"). A missing key is RED on any run that includes the
 * live half, never a skip that still exits 0 — the live half is the only thing
 * that can see a duplicate endpoint, so a pass from a run that never made the
 * request would be exactly the false green this guard exists to prevent.
 * Skipping it must be asked for explicitly (--static), and that run says so in
 * its own PASS line.
 *
 * READ ONLY. The key must have the rk_live_ shape (sk_ keys, which can write,
 * and test keys are refused before any request), and the only request made is
 * GET /v1/webhook_endpoints. Never prints a secret.
 *
 * Not covered here: undelivered events (pending_webhooks > 0, Q156). That read
 * is GET /v1/events, which needs "Events: Read" on the key; the owner's key is
 * scoped to Webhook Endpoints only, so the check was dropped when the guard
 * moved to live mode (see docs/OPEN.md).
 *
 * Usage:
 *   node scripts/check-stripe-webhook-events.mjs              # static + live; RED if the key is missing
 *   node scripts/check-stripe-webhook-events.mjs --static     # static half only
 *   node scripts/check-stripe-webhook-events.mjs --require-live  # accepted no-op
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  handlerEventTypes,
  WEBHOOK_URL,
  WEBHOOK_INDEX,
} from "./stripe-webhook-events.mjs";
import { gradeLiveEndpoints, liveReadKeyProblem } from "./lib/stripeWebhookGuard.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SANDBOX_ON = join(root, "scripts/e2e/stripe-sandbox-on.sh");
const SANDBOX_OFF = join(root, "scripts/e2e/stripe-sandbox-off.sh");

const argv = process.argv.slice(2);
const args = new Set(argv);
const STATIC_ONLY = args.has("--static");
/*
 * The live half is REQUIRED whenever it is meant to run. Opting out has to be
 * explicit (--static); it can never be the silent consequence of an unset key.
 * A bare no-flag run used to note "SKIPPED" and still exit 0, so the one check
 * that can actually see a duplicate endpoint — the #1586 bug — reported PASS
 * while grading nothing. --require-live is kept as an accepted no-op so the
 * workflow and any muscle memory keep working.
 */
/**
 * --fixture <file>: grade a recorded /v1/webhook_endpoints response instead of
 * calling Stripe. This exists so the live half can be PROVEN RED without a key
 * and without recreating the duplicate-endpoint incident on the real account —
 * a check never shown able to fail does not count. Fixtures live in
 * scripts/fixtures/stripe-webhook-endpoints/. Never used by CI's live job.
 */
const FIXTURE = argv.includes("--fixture") ? argv[argv.indexOf("--fixture") + 1] : null;

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

// ---------------------------------------------------------------- static half

const handlers = handlerEventTypes();
notes.push(`EVENT_HANDLERS in ${WEBHOOK_INDEX.replace(root, "")} declares ${handlers.length} event types.`);

const onSrc = readFileSync(SANDBOX_ON, "utf8");
const offSrc = readFileSync(SANDBOX_OFF, "utf8");

// A1. The sandbox script must not restate the event list. Any literal
// `enabled_events[]=<something>` is a hardcode by definition — the generated
// form interpolates a shell variable.
const hardcoded = [...onSrc.matchAll(/enabled_events\[\]=([a-z0-9_.]+)/g)].map((m) => m[1]);
if (hardcoded.length > 0) {
  fail(
    `scripts/e2e/stripe-sandbox-on.sh hardcodes ${hardcoded.length} event type(s): ${hardcoded.join(", ")}.\n` +
      `   Derive them instead: \`node scripts/stripe-webhook-events.mjs\` prints the EVENT_HANDLERS keys.\n` +
      `   A hardcoded list is how invoice.paid stayed subscribed with no handler for weeks.`,
  );
}

// A2. ...and it must actually call the generator.
if (!onSrc.includes("scripts/stripe-webhook-events.mjs")) {
  fail(
    `scripts/e2e/stripe-sandbox-on.sh never invokes scripts/stripe-webhook-events.mjs, so its event list is not derived from the handler map.`,
  );
}

// A3. The endpoint id must not live in /tmp — that is the root cause of #1586.
for (const [name, src] of [
  ["stripe-sandbox-on.sh", onSrc],
  ["stripe-sandbox-off.sh", offSrc],
]) {
  const tmpRefs = [...src.matchAll(/\/tmp\/[\w.-]+/g)].map((m) => m[0]);
  if (tmpRefs.length > 0) {
    fail(
      `scripts/e2e/${name} still stores state in /tmp (${tmpRefs.join(", ")}).\n` +
        `   /tmp does not reliably survive on this machine; a lost id file is how a stale webhook endpoint was left enabled. Use $HOME/.lh-*.`,
    );
  }
}

// A4. Both scripts must agree on the id file path, or off.sh cleans up nothing.
const idPath = (src) => src.match(/ID_FILE="([^"]+)"/)?.[1] ?? null;
const onId = idPath(onSrc);
const offId = idPath(offSrc);
if (!onId || !offId) {
  fail(`Could not find ID_FILE= in both sandbox scripts (on: ${onId}, off: ${offId}).`);
} else if (onId !== offId) {
  fail(
    `The sandbox scripts disagree about the endpoint id file: on.sh writes ${onId}, off.sh reads ${offId}. off.sh would clean up nothing.`,
  );
}

// A5. The id file must be gitignored — it is machine state, not source.
if (onId) {
  const base = onId.split("/").pop();
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  if (!ignore.includes(base)) {
    fail(`${base} (the webhook id file) is not in .gitignore.`);
  }
}

// ------------------------------------------------------------------ live half

// LH_STRIPE_API_BASE exists only so src/test/liveCheckScriptsFailClosed.test.ts
// can point the live read at a stub that fails or returns nothing.
const STRIPE_API = process.env.LH_STRIPE_API_BASE ?? "https://api.stripe.com";

/** The ONLY request this guard makes: an authenticated GET. There is no write path. */
async function stripeGet(key, path) {
  const res = await fetch(`${STRIPE_API}/v1/${path}`, {
    method: "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.json();
  if (!res.ok) {
    // body.error.message is Stripe's own text and never contains our key.
    throw new Error(`Stripe GET /v1/${path} -> ${res.status}: ${body?.error?.message ?? "unknown error"}`);
  }
  return body;
}

/** Grade a /v1/webhook_endpoints list — the same logic for live and fixture. */
function grade(list) {
  const r = gradeLiveEndpoints(list, handlers, WEBHOOK_URL);
  failures.push(...r.failures);
  notes.push(...r.notes);
}

async function liveHalf() {
  if (FIXTURE) {
    notes.push(`FIXTURE MODE: grading ${FIXTURE} instead of the live Stripe account.`);
    grade(JSON.parse(readFileSync(FIXTURE, "utf8")));
    return;
  }
  const key = process.env.STRIPE_LIVE_READ_KEY;
  const problem = liveReadKeyProblem(key);
  if (problem) {
    fail(
      key
        ? problem
        : "STRIPE_LIVE_READ_KEY is not set, so the live endpoint check did NOT run.\n" +
            "   This half is what catches a second enabled endpoint on the webhook url (the #1586 bug) and event drift.\n" +
            '   Add a Stripe LIVE-mode restricted key (rk_live_, only "Webhook Endpoints: Read") as the STRIPE_LIVE_READ_KEY repo secret.',
    );
    return;
  }

  let list;
  try {
    list = await stripeGet(key, "webhook_endpoints?limit=100");
  } catch (e) {
    fail(`Could not list Stripe live-mode webhook endpoints: ${e.message}`);
    return;
  }
  grade(list);
}

if (!STATIC_ONLY) await liveHalf();

// ----------------------------------------------------------------- reporting

console.log("Stripe webhook endpoint guard (issue #1586)\n");
for (const n of notes) console.log(`  - ${n}`);
if (failures.length === 0) {
  console.log(
    STATIC_ONLY
      ? "\nPASS — static checks clean. The live half did NOT run (--static): a duplicate endpoint would NOT be caught by this run."
      : "\nPASS — static and live checks clean.",
  );
  process.exit(0);
}
console.error(`\n${failures.length} problem(s):\n`);
for (const f of failures) console.error(` - ${f}\n`);
process.exit(1);
