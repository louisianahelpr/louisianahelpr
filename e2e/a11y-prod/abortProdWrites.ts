/**
 * THE PROD A11Y SWEEP IS READ-ONLY BY CONSTRUCTION (lead, 10-31).
 *
 * The a11y-prod projects sign in as the shared test accounts against PROD
 * Supabase, and `npm run check:changed` (the pre-push hook) runs them on every
 * builder push. The spec only looks at screens, but the app writes on its own
 * as screens load (login_history on sign-in, for one), and a page could fire
 * a volatile RPC or an edge function that sends an email or a notice. So
 * every context the a11y-prod specs create goes through abortProdWrites(),
 * which lets through only what cannot write:
 *
 *   - GET / HEAD / OPTIONS to REST, storage and auth (reads);
 *   - POST /auth/v1/token (the session refresh the seeded session needs);
 *   - POST /rest/v1/rpc/<fn> when <fn>'s newest definition is STABLE or
 *     IMMUTABLE (readOnlyRpcs.ts, derived from the migrations at run time);
 *   - /functions/v1/<fn> ONLY for a name in READ_ONLY_FUNCTIONS, whatever the
 *     method (an edge function can send email on a GET).
 *
 * Everything else under the Supabase URL is aborted: table writes
 * (POST/PATCH/PUT/DELETE /rest/v1/<table>), volatile RPCs, storage writes,
 * other auth writes, GraphQL, and every other edge function. Each abort is
 * printed and appended to <SWEEP_OUTPUT_DIR>/aborted-writes.jsonl, so a run
 * shows exactly what the app would have written.
 *
 * Guard: src/test/a11yProdSweepAbortsWrites.test.ts.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Request } from "@playwright/test";
import { readOnlyRpcNames } from "./readOnlyRpcs";

/** Edge functions a swept screen may call: named, read-only, and short. Empty until a screen needs one. */
export const READ_ONLY_FUNCTIONS: ReadonlySet<string> = new Set<string>([]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let readOnlyRpcs: Set<string> | null = null;
function rpcAllowList(): Set<string> {
  readOnlyRpcs ??= readOnlyRpcNames();
  return readOnlyRpcs;
}

/** Why `req` must not reach prod, or null when it may. Pure, so the guard can call it. */
export function writeVerdict(method: string, path: string, rpcs: ReadonlySet<string> = rpcAllowList()): string | null {
  const m = method.toUpperCase();
  const fn = /^\/functions\/v1\/([^/?#]+)/.exec(path);
  if (fn) return READ_ONLY_FUNCTIONS.has(fn[1]) ? null : `edge function ${fn[1]}`;
  if (READ_METHODS.has(m)) return null;
  if (m === "POST" && /^\/auth\/v1\/token(?:[?#]|$)/.test(path)) return null;
  const rpc = /^\/rest\/v1\/rpc\/([^/?#]+)/.exec(path);
  if (rpc) return rpcs.has(rpc[1]) ? null : `volatile rpc ${rpc[1]}`;
  if (path.startsWith("/rest/v1/")) return `table write ${m}`;
  if (path.startsWith("/storage/v1/")) return `storage write ${m}`;
  if (path.startsWith("/auth/v1/")) return `auth write ${m}`;
  return `write ${m}`;
}

/** Edge functions this sweep aborted, per browser context (the same facts aborted-writes.jsonl records). */
const abortedFunctions = new WeakMap<BrowserContext, Set<string>>();
export function abortedFunctionsIn(ctx: BrowserContext): ReadonlySet<string> {
  return abortedFunctions.get(ctx) ?? new Set();
}

/**
 * Screens whose OWN error state a function abort explains (lead 11-03): Money
 * reads the wallet from stripe-payouts, which stays blocked (a Stripe-calling
 * function is never on READ_ONLY_FUNCTIONS), so /profile?tab=earnings correctly
 * says it couldn't load the payout data. Excused only when THIS context really
 * aborted that function, on that screen, and only that exact copy.
 */
export const ABORT_EXPLAINED_ERRORS: ReadonlyArray<{ fn: string; path: string; tab: string; copy: string }> = [
  { fn: "stripe-payouts", path: "/profile", tab: "earnings", copy: "We couldn't load your payout data." },
  // ?tab=payment renders the same Money screen (ProfileTabPanels: tab === "earnings" || tab === "payment"),
  // and Payout history reads the same stripe-payouts query (useEarningsData); A11y 41598471444 failed on both.
  { fn: "stripe-payouts", path: "/profile", tab: "payment", copy: "We couldn't load your payout data." },
  { fn: "stripe-payouts", path: "/profile", tab: "payout_history", copy: "We couldn't load your payouts." },
];

/** The copy `pageUrl`'s screen may show because `aborted` holds its function, or null. Pure. */
export function abortExplainedError(pageUrl: string, aborted: ReadonlySet<string>): string | null {
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    // Not a URL (about:blank before the first goto): no screen, so nothing to excuse; the error check still runs.
    return null;
  }
  const hit = ABORT_EXPLAINED_ERRORS.find((e) => e.path === u.pathname && u.searchParams.get("tab") === e.tab && aborted.has(e.fn));
  return hit ? hit.copy : null;
}

/** Abort every request to `supabaseUrl` that could write prod; log each one. */
export async function abortProdWrites(ctx: BrowserContext, supabaseUrl: string, outputDir: string): Promise<void> {
  const base = supabaseUrl.replace(/\/$/, "");
  const log = join(outputDir, "aborted-writes.jsonl");
  const aborted = new Set<string>();
  abortedFunctions.set(ctx, aborted);
  await ctx.route(`${base}/**`, async (route) => {
    const req: Request = route.request();
    const path = req.url().slice(base.length);
    const why = writeVerdict(req.method(), path);
    if (!why) return route.continue();
    const fnName = /^\/functions\/v1\/([^/?#]+)/.exec(path)?.[1];
    if (fnName) aborted.add(fnName);
    const line = { at: new Date().toISOString(), why, method: req.method(), path: path.slice(0, 200), page: safePageUrl(req) };
    console.log(`[a11y-prod] aborted ${why}: ${req.method()} ${line.path}`);
    try {
      mkdirSync(outputDir, { recursive: true });
      appendFileSync(log, JSON.stringify(line) + "\n");
    } catch (e) {
      console.warn(`[a11y-prod] could not record the abort in ${log}: ${(e as Error).message}`);
    }
    return route.abort("blockedbyclient");
  });
}

function safePageUrl(req: Request): string {
  try {
    return req.frame().url().slice(0, 160);
  } catch {
    return ""; // a service-worker or detached-frame request has no frame; the path still names it
  }
}
