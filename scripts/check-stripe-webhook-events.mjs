#!/usr/bin/env node
/**
 * Stripe webhook endpoint guard — the class check for issue #1586
 * ("test mode delivers every webhook twice").
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
 *      transfers, double escrow releases.
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
 * half needs a Stripe TEST-MODE key in STRIPE_TEST_SECRET_KEY. If that secret
 * is absent the live half SKIPS EXPLICITLY and says so in the summary — it
 * never reports a silent pass. Pass --require-live (CI does) to turn a missing
 * key into a failure instead of a skip.
 *
 * TEST MODE ONLY. The key is asserted to be a test key before any request, and
 * no live-mode object is ever read, created or deleted. Never prints a secret.
 *
 * Usage:
 *   node scripts/check-stripe-webhook-events.mjs              # static + live if key present
 *   node scripts/check-stripe-webhook-events.mjs --static     # static half only
 *   node scripts/check-stripe-webhook-events.mjs --require-live
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  handlerEventTypes,
  WEBHOOK_URL,
  WEBHOOK_INDEX,
} from "./stripe-webhook-events.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SANDBOX_ON = join(root, "scripts/e2e/stripe-sandbox-on.sh");
const SANDBOX_OFF = join(root, "scripts/e2e/stripe-sandbox-off.sh");

const argv = process.argv.slice(2);
const args = new Set(argv);
const STATIC_ONLY = args.has("--static");
const REQUIRE_LIVE = args.has("--require-live");
/**
 * --fixture <file>: grade a recorded /v1/webhook_endpoints response instead of
 * calling Stripe. This exists so the live half can be PROVEN RED without a key
 * and without recreating the duplicate-endpoint incident on the real account —
 * a check never shown able to fail does not count. Fixtures live in
 * scripts/fixtures/stripe-webhook-endpoints/. Never used by CI.
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

async function stripeGet(key, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.json();
  if (!res.ok) {
    // body.error.message is Stripe's own text and never contains our key.
    throw new Error(`Stripe GET /v1/${path} -> ${res.status}: ${body?.error?.message ?? "unknown error"}`);
  }
  return body;
}

async function liveHalf() {
  if (FIXTURE) {
    notes.push(`FIXTURE MODE: grading ${FIXTURE} instead of the live Stripe account.`);
    return gradeEndpoints(JSON.parse(readFileSync(FIXTURE, "utf8")));
  }
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (!key) {
    const msg =
      "STRIPE_TEST_SECRET_KEY is not set, so the live endpoint check did NOT run.\n" +
      "   This half is what catches a second enabled endpoint on the webhook url — the actual #1586 bug.\n" +
      "   Add a Stripe TEST-MODE restricted key (read-only on Webhook Endpoints) as the STRIPE_TEST_SECRET_KEY repo secret.";
    if (REQUIRE_LIVE) {
      fail(msg);
    } else {
      notes.push(`SKIPPED (live half): ${msg}`);
    }
    return;
  }
  if (!/^(sk|rk)_test_/.test(key)) {
    fail(
      "STRIPE_TEST_SECRET_KEY is not a test-mode key (expected sk_test_/rk_test_ prefix). Refusing to make any request — Stripe stays in sandbox until launch.",
    );
    return;
  }

  let list;
  try {
    list = await stripeGet(key, "webhook_endpoints?limit=100");
  } catch (e) {
    fail(`Could not list Stripe test-mode webhook endpoints: ${e.message}`);
    return;
  }

  return gradeEndpoints(list);
}

/** Grade a /v1/webhook_endpoints list — the same logic for live and fixture. */
function gradeEndpoints(list) {
  const ours = list.data.filter((e) => e.url === WEBHOOK_URL);
  // A test key cannot return live objects; assert it anyway so a mis-scoped key
  // can never let this guard silently inspect live mode.
  if (ours.some((e) => e.livemode)) {
    fail("Live-mode webhook endpoints came back from a test-mode key. Refusing to grade live mode.");
    return;
  }
  const enabled = ours.filter((e) => e.status === "enabled");
  notes.push(
    `Stripe test mode: ${ours.length} endpoint(s) on ${WEBHOOK_URL}, ${enabled.length} enabled.`,
  );

  // B1. Exactly one enabled endpoint. Two means every event is delivered twice.
  if (enabled.length > 1) {
    fail(
      `${enabled.length} ENABLED test-mode webhook endpoints point at ${WEBHOOK_URL}:\n` +
        enabled.map((e) => `     ${e.id} (created ${new Date(e.created * 1000).toISOString()}, ${e.enabled_events.length} events)`).join("\n") +
        `\n   Every event is delivered once per endpoint, and the edge function accepts a comma-separated STRIPE_WEBHOOK_SECRET, so both copies verify and BOTH are processed. This is issue #1586.\n` +
        `   Delete all but one in the Stripe dashboard (TEST mode), then re-run scripts/e2e/stripe-sandbox-on.sh to reset the signing secret.`,
    );
  } else if (enabled.length === 0) {
    notes.push(
      `No enabled test-mode endpoint on ${WEBHOOK_URL} — sandbox is off. Event drift not graded.`,
    );
    return;
  }

  // B2. The kept endpoint's subscription must match the handler map both ways.
  const kept = enabled[0];
  const subscribed = [...new Set(kept.enabled_events)].sort();
  if (subscribed.includes("*")) {
    fail(`${kept.id} subscribes to "*" (all events). Subscribe to the handled set, not everything.`);
    return;
  }
  const noHandler = subscribed.filter((e) => !handlers.includes(e));
  const notSubscribed = handlers.filter((e) => !subscribed.includes(e));
  if (noHandler.length) {
    fail(
      `${kept.id} is subscribed to ${noHandler.length} event(s) with NO handler in EVENT_HANDLERS: ${noHandler.join(", ")}.\n` +
        `   These are delivered and silently dropped ("Unhandled event type"). Either add a handler or unsubscribe.`,
    );
  }
  if (notSubscribed.length) {
    fail(
      `${kept.id} does NOT subscribe to ${notSubscribed.length} handled event(s): ${notSubscribed.join(", ")}.\n` +
        `   Those handlers can never run. Re-run scripts/e2e/stripe-sandbox-on.sh to resubscribe from the handler map.`,
    );
  }
  if (!noHandler.length && !notSubscribed.length) {
    notes.push(`${kept.id} subscribes to exactly the ${handlers.length} handled events.`);
  }
}

if (!STATIC_ONLY) await liveHalf();

// ----------------------------------------------------------------- reporting

console.log("Stripe webhook endpoint guard (issue #1586)\n");
for (const n of notes) console.log(`  - ${n}`);
if (failures.length === 0) {
  console.log(`\nPASS — ${STATIC_ONLY ? "static checks" : "all checks"} clean.`);
  process.exit(0);
}
console.error(`\n${failures.length} problem(s):\n`);
for (const f of failures) console.error(` - ${f}\n`);
process.exit(1);
