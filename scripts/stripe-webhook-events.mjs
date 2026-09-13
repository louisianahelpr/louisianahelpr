#!/usr/bin/env node
/**
 * Single source of truth for "which Stripe events should the test-mode webhook
 * endpoint be subscribed to": the keys of the EVENT_HANDLERS dispatch map in
 * supabase/functions/stripe-webhook/index.ts.
 *
 * Why this file exists (issue #1586): scripts/e2e/stripe-sandbox-on.sh used to
 * carry its own hardcoded enabled_events[] list. It drifted — by 2026-09-12 it
 * was missing 8 handled events and still subscribing to invoice.paid, which has
 * no handler at all. A subscribed-but-unhandled event is a silent no-op; a
 * handled-but-unsubscribed event is a money path that never fires. Neither is
 * visible from either side alone, so both the sandbox script and the CI guard
 * now derive the list from the handler map rather than restating it.
 *
 * Used by:
 *   - scripts/e2e/stripe-sandbox-on.sh  (`node scripts/stripe-webhook-events.mjs`)
 *   - scripts/check-stripe-webhook-events.mjs (imports handlerEventTypes)
 *
 * CLI: prints one event type per line, sorted, for shell consumption.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

export const WEBHOOK_INDEX = join(
  root,
  "supabase/functions/stripe-webhook/index.ts",
);

/**
 * The Supabase function URL the test-mode endpoint must point at. Shared so the
 * guard and the sandbox script cannot disagree about which endpoint they mean.
 */
export const WEBHOOK_URL =
  "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/stripe-webhook";

/**
 * Parse the keys of the EVENT_HANDLERS object literal.
 *
 * Deliberately a narrow text parse rather than an import: index.ts is Deno code
 * with .ts import specifiers and npm: Stripe types, so Node cannot load it. We
 * slice the object literal by its declaration and its terminating `};` at column
 * zero, then take quoted keys that are followed by a colon. Anything that fails
 * to find the block throws — a rename must break the guard loudly, not silently
 * return an empty set that would make every comparison trivially pass.
 */
export function handlerEventTypes(source = readFileSync(WEBHOOK_INDEX, "utf8")) {
  const start = source.indexOf("const EVENT_HANDLERS");
  if (start === -1) {
    throw new Error(
      `Could not find "const EVENT_HANDLERS" in ${WEBHOOK_INDEX}. If the dispatch map was renamed, update scripts/stripe-webhook-events.mjs to match.`,
    );
  }
  // The map's value type is a multi-line generic, so the first "{" after the
  // declaration is not necessarily the object literal — but the literal is the
  // one closed by a `};` at column zero, which is the block we want.
  const endRel = source.slice(start).search(/^\};$/m);
  if (endRel === -1) {
    throw new Error(
      `Found EVENT_HANDLERS in ${WEBHOOK_INDEX} but no terminating "};" at column zero. Reformatting broke the parse in scripts/stripe-webhook-events.mjs.`,
    );
  }
  const block = source.slice(start, start + endRel);
  const open = block.indexOf("= {");
  if (open === -1) {
    throw new Error(
      `EVENT_HANDLERS in ${WEBHOOK_INDEX} is not an object literal assignment.`,
    );
  }
  const body = block.slice(open + 3);

  const events = [];
  // Keys are always quoted in this map because every Stripe event type contains
  // dots, which are not valid bare identifiers.
  for (const m of body.matchAll(/["']([a-z0-9_.]+)["']\s*:/g)) {
    events.push(m[1]);
  }
  if (events.length === 0) {
    throw new Error(
      `Parsed zero event types out of EVENT_HANDLERS in ${WEBHOOK_INDEX}. The guard refuses to treat that as "nothing to check".`,
    );
  }
  const unique = [...new Set(events)].sort();
  if (unique.length !== events.length) {
    const seen = new Set();
    const dupes = events.filter((e) => (seen.has(e) ? true : (seen.add(e), false)));
    throw new Error(
      `Duplicate keys in EVENT_HANDLERS: ${[...new Set(dupes)].join(", ")} — the later entry silently shadows the earlier handler.`,
    );
  }
  return unique;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(handlerEventTypes().join("\n") + "\n");
}
