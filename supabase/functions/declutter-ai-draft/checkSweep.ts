/**
 * THE SERVER CHECKS WHAT THE APP DIDN'T (LEAD-CHECK-SWEEP, lead 10-31; owner rule: "everyday items must never be held
 * just because a check didn't run"). Migration 20261101031241_declutter_check_sweep.sql.
 *
 * The app runs a posted listing's photo check right after Post. If the app closes mid-bunch, or the check tool is busy,
 * nothing is recorded. Every 5 minutes pg_cron (pg_net) posts {"mode":"check_sweep"} here with the vault service key:
 *   1. any other caller is refused (verify, = verifyCronSecret in index.ts) before anything is read; a member's JWT
 *      can never start a sweep, and no seller or item id is ever taken from the request;
 *   2. declutter_check_sweep_claim picks the listings due a check and counts the try first (a crashed run still
 *      counts), returning each item's seller FROM THE ROW;
 *   3. each is judged and recorded through declutter_record_ai_check, as the app's check is.
 * After 3 failed tries the 15-minute fail-safe holds the listing; until then it stays on sale.
 *
 * Dependency-free (no Deno, no network): index.ts passes the real pieces in. Guard:
 * src/test/declutterCheckSweep.test.ts (and src/test/pglite/declutterCheckSweep.pglite.mjs for the SQL).
 */

const CHECK_SWEEP_MODE = "check_sweep";
/**
 * Listings per run (the claim caps it at 20): ~4 s a check, two at a time, well inside the 120 s pg_net timeout, and
 * few enough that reading up to 12 photos each stays inside the function's own time and memory (review should-fix 4).
 */
const CHECK_SWEEP_BATCH = 5;
const PARALLEL = 2;

/**
 * failed = the check could not run on this listing (a photo missing or unreadable): retried next run, held after 3.
 * busy   = the model answered 429 or 5xx (busy or down): the try is GIVEN BACK (lead 10-31, owner rule: an outage
 *          never holds everyday listings), and the run answers 500 ONCE so the watcher pages.
 * defect = our own read or write broke (a query errored, the verdict did not record): the try is given back and each
 *          is a cron defect, so the run answers 500 and sweep_cron_http_failures sees it.
 */
export type SweepOutcome = "checked" | "flagged" | "stale" | "failed" | "busy" | "defect";

/**
 * The media type Claude is told, from the photo's own first bytes (lead 10-31: every photo went as image/jpeg, so a
 * PNG listing was misdescribed). Only the types the model reads; anything else (HEIC, unknown) is null.
 */
export function imageMediaType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export interface SweepClaim {
  itemId: string;
  sellerId: string;
  attempt: number;
}

export interface CheckSweepDeps {
  /** null when the caller is the service (cron); otherwise the refusal to send. */
  verify: (req: Request) => Response | null;
  claim: (limit: number) => Promise<{ ok: true; rows: SweepClaim[] } | { ok: false; error: string }>;
  judge: (claim: SweepClaim) => Promise<SweepOutcome>;
  /** Gives the claimed try back (declutter_check_sweep_give_back): a defect or a stale verdict says nothing about the listing. */
  giveBack: (claim: SweepClaim) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The run's answer (index.ts: cronResult("declutter-ai-draft", ...), 500 when defects.count > 0). */
  answer: (body: Record<string, unknown>, defects: { count: number; reasons?: string[] }) => Response;
  /** A run that could not start (index.ts: cronError). */
  fail: (message: string) => Response;
}

/** The request's mode, read from a COPY of the body so the member path can still read it. */
async function modeOf(req: Request): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  try {
    const body = await req.clone().json();
    return body && typeof body === "object" ? (body as { mode?: unknown }).mode : undefined;
  } catch (_e) {
    // Not JSON: not a sweep. The member path answers it as it always has.
    return undefined;
  }
}

/** Runs the sweep for a service call with mode check_sweep; every other request goes to `handler` unchanged. */
export function withCheckSweep(
  handler: (req: Request) => Promise<Response>,
  deps: CheckSweepDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if ((await modeOf(req)) !== CHECK_SWEEP_MODE) return handler(req);
    const refused = deps.verify(req);
    if (refused) return refused;
    return runCheckSweep(deps);
  };
}

async function runCheckSweep(deps: CheckSweepDeps): Promise<Response> {
  const claimed = await deps.claim(CHECK_SWEEP_BATCH);
  if (!claimed.ok) {
    // Loud: cron_http_tag records the 500, and no listing is held for it (no try was counted).
    console.error("[declutter-ai-draft] check sweep claim failed:", claimed.error);
    return deps.fail("sweep_claim_failed");
  }
  const counts: Record<SweepOutcome, number> = { checked: 0, flagged: 0, stale: 0, failed: 0, busy: 0, defect: 0 };
  const reasons: string[] = [];
  const queue = [...claimed.rows];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      let outcome: SweepOutcome;
      try {
        outcome = await deps.judge(next);
      } catch (e) {
        console.error("[declutter-ai-draft] check sweep judge threw:", next.itemId, e instanceof Error ? e.message : String(e));
        outcome = "defect";
      }
      if (outcome === "failed") console.error("[declutter-ai-draft] check sweep: check failed", next.itemId, "try", next.attempt);
      if (outcome === "defect") reasons.push(`check of ${next.itemId} broke (try ${next.attempt})`);
      if (outcome === "defect" || outcome === "stale" || outcome === "busy") {
        const back = await deps.giveBack(next);
        if (!back.ok) {
          // The try stays counted: loud, so a listing is never held for our fault without anyone told.
          console.error("[declutter-ai-draft] check sweep: try not given back", next.itemId, back.error);
          if (outcome !== "defect") outcome = "defect";
          reasons.push(`try of ${next.itemId} not given back`);
        }
      }
      counts[outcome]++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  const { defect, ...rest } = counts;
  // The model busy or down: one page per run (not one per listing), and every such try was given back.
  if (counts.busy > 0) reasons.unshift(`the model was busy or down for ${counts.busy} check(s); tries given back`);
  return deps.answer({ claimed: claimed.rows.length, ...rest }, { count: defect + (counts.busy > 0 ? 1 : 0), reasons });
}
