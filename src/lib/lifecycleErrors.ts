/**
 * Human copy for the preconditions our lifecycle RPCs enforce.
 *
 * These RPCs `RAISE EXCEPTION 'job_not_started'` (etc.) — deliberately terse,
 * machine-readable codes. The clients were funnelling every one of them into a
 * single generic "Couldn't do that — please try again", which is wrong twice
 * over: it hides a reason the user could act on, and "try again" is false
 * advice when the answer is "wait until the start time".
 *
 * Owner, 2026-08-25: "I'm trying to file a dispute but it's not letting me" /
 * "Also can't report no show". The guards were doing their job; nothing told
 * them so. (The no-show guards exist to close the R1 ban-abuse path — a poster
 * could otherwise ban any Helpr with two throwaway jobs — so they stay.)
 *
 * Unknown codes fall through to the caller's own fallback string.
 */
import { isWriteRejected } from "./mutationResult";
import { loadModule } from "./loadModule";
import type * as LifecycleErrorCopy from "./lifecycleErrorCopy";

export { BEFORE_PHOTO_GATE_REASON } from "./beforePhotoGate";

/**
 * THE WORDS LOAD ON THEIR OWN (Q1158/Q654, B48 11-03).
 *
 * The copy tables (src/lib/lifecycleErrorCopy.ts, ~120 KB) used to live here,
 * and this module is on every signed-in first screen, so a phone downloaded
 * every refusal sentence before it could draw /jobs. They are only read once
 * something has gone wrong, so they are fetched on their own:
 *   - on the first tap, touch or key press (a refusal answers a tap, and the
 *     RPC's round trip is about as long as this small chunk's fetch);
 *   - after COPY_IDLE_MS on a visit with no input (a background read's refusal);
 *   - and the first time a sentence is asked for before either.
 * Until they arrive, rpcErrorMessage and lifecycleErrorMessage answer `null`,
 * exactly what they answer for a code we have no words for, so every caller
 * shows its own plain fallback sentence. Never the raw code: no caller may
 * fall back to the error's own message (src/test/lifecycleErrorCopyIsLazy.test.ts).
 * rpcErrorCode decides what a caller DOES, so it waits for the words.
 */
type CopyModule = typeof LifecycleErrorCopy;
type RpcErrorCopyTable = (typeof LifecycleErrorCopy)["RPC_ERROR_COPY"];

// Loaded alone, then used: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const errorLogger = () => loadModule(() => import("@/lib/errorLogger"));
const lifecycleErrorCopy = () => loadModule(() => import("./lifecycleErrorCopy"));

let copy: CopyModule | null = null;
let loading: Promise<CopyModule | null> | null = null;

/** Tests only: the suite's setup file loads the words once, so every test reads them as a loaded page does. */
function testCopy(): CopyModule | null {
  if (import.meta.env.MODE !== "test") return null;
  return ((globalThis as { __lhLifecycleErrorCopy?: CopyModule }).__lhLifecycleErrorCopy ?? null);
}

function loadedCopy(): CopyModule | null {
  return copy ?? testCopy();
}

/**
 * Fetch the words (once). Resolves the module, or `null` when it could not be
 * fetched (offline, or a deploy replaced the chunk): then `loading` resets and
 * the next call tries again, and callers keep showing their own fallback.
 */
export function loadLifecycleErrorCopy(): Promise<CopyModule | null> {
  const ready = loadedCopy();
  if (ready) return Promise.resolve(ready);
  loading ??= lifecycleErrorCopy().then(
    (m) => {
      loading = null;
      if (!m) return null; // a recovery reload is under way: the next call tries again
      copy = m;
      return m;
    },
    (err: unknown) => {
      loading = null;
      // Only the specific sentence is lost (the caller shows its own); reported so a chunk that keeps failing is seen.
      void errorLogger()
        .then((lg) => lg?.report(err, { severity: "warning", tags: { source: "lifecycleErrors.loadLifecycleErrorCopy" } }))
        .catch(() => {
          // The logger chunk failed to load as well (offline): there is nothing left to report with.
        });
      return null;
    },
  );
  return loading;
}

/** No input yet this long after boot: fetch the words anyway, long after the first draw. */
export const COPY_IDLE_MS = 8000;

function warmOnFirstInput(): void {
  if (typeof window === "undefined" || import.meta.env.MODE === "test") return;
  const events = ["pointerdown", "touchstart", "keydown"] as const;
  const warm = () => {
    for (const e of events) window.removeEventListener(e, warm, true);
    window.clearTimeout(timer);
    void loadLifecycleErrorCopy();
  };
  for (const e of events) window.addEventListener(e, warm, { capture: true, passive: true });
  const timer = window.setTimeout(warm, COPY_IDLE_MS);
}
warmOnFirstInput();

/** The per-RPC table when the words are here, else null (and they are sent for). */
function rpcTable(): RpcErrorCopyTable | null {
  const m = loadedCopy();
  if (!m) void loadLifecycleErrorCopy();
  return m?.RPC_ERROR_COPY ?? null;
}

export type MappedRpc = keyof RpcErrorCopyTable;
export type RpcErrorCode<R extends MappedRpc> = Extract<keyof RpcErrorCopyTable[R], string>;

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "";
}

/**
 * The code in `codes` that `error` names, or `null`. Matched as a whole token
 * so `not_authorized` never fires on a longer code that happens to contain it.
 * Shared with the admin console's table (adminRpcErrorCopy.ts) so both match
 * the same way.
 */
export function codeNamedIn<C extends string>(codes: Record<C, string>, error: unknown): C | null {
  const raw = rawMessage(error);
  if (!raw) return null;
  for (const code of Object.keys(codes) as C[]) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return code;
  }
  return null;
}

/**
 * The code `rpc` raised, when it is one we have copy for; `null` otherwise.
 * Async because a caller branches on it: it waits for the words, and answers
 * `null` only when they cannot be fetched at all (the caller's plain path).
 */
export async function rpcErrorCode<R extends MappedRpc>(rpc: R, error: unknown): Promise<RpcErrorCode<R> | null> {
  const m = await loadLifecycleErrorCopy();
  return m ? codeNamedIn(m.RPC_ERROR_COPY[rpc] as Record<RpcErrorCode<R>, string>, error) : null;
}

/**
 * Human copy for an error `rpc` returned, or `null` when it is not a code we
 * have wording for (so the caller keeps its own fallback).
 */
export function rpcErrorMessage(rpc: MappedRpc, error: unknown): string | null {
  const table = rpcTable();
  if (!table) return null; // the words are on their way: the caller's own plain sentence
  const codes = table[rpc] as Record<string, string>;
  const code = codeNamedIn(codes, error);
  return code ? codes[code] : null;
}

/**
 * The admin console's RPC copy, fetched on demand by the few shared modules
 * that call an admin-only RPC (categorySuggestions, declutter/api,
 * declutter/handover, the team thread's send handler). The admin pages import
 * it statically; this keeps it out of every member's chunks. Resolves `null`
 * when the chunk cannot be fetched (offline, or a deploy replaced it): the
 * caller then shows its own fallback words, and the RPC error itself is still
 * thrown or reported exactly as before.
 */
export function loadAdminRpcErrorCopy(): Promise<typeof import("@/components/admin/adminRpcErrorCopy") | null> {
  return import("@/components/admin/adminRpcErrorCopy").catch((err: unknown) => {
    // The caller's own fallback copy is shown and the RPC error is still thrown
    // or reported; only the more specific sentence is lost. Q1883: that loss is
    // reported (warning), so a chunk that keeps failing to load is visible.
    void errorLogger()
      .then((m) => m?.report(err, { severity: "warning", tags: { source: "lifecycleErrors.loadAdminRpcErrorCopy" } }))
      .catch(() => {
        // The logger chunk failed to load as well (offline): there is nothing left to report with.
      });
    return null;
  });
}

/**
 * Codes that are a designed refusal rather than a defect: the user is shown the
 * copy above, and the caller does NOT report them to Sentry (a settlement in
 * progress is the lock working, not a bug — round-4 review, LOW).
 */
// continue_day_ahead (A3-115): "done" before the day set to finish is the trigger working, not a defect.
const EXPECTED_REFUSALS = ["dispute_settlement_in_progress", "continue_day_ahead"] as const;

export function isExpectedLifecycleRefusal(error: unknown): boolean {
  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: string } | null)?.message ?? "");
  return !!raw && EXPECTED_REFUSALS.some((code) => raw.includes(code));
}

/**
 * Map a Postgres/PostgREST error onto human copy, or `null` when the code is
 * not one we have specific wording for (so the caller keeps its own fallback).
 */
export function lifecycleErrorMessage(error: unknown): string | null {
  // A write that matched zero rows carries its own human sentence (see
  // mutationResult.ts). It never has a Postgres code to match on, so it has to
  // be handled before the code table.
  if (isWriteRejected(error)) return error.userMessage;

  // A non-string message (a thrown object carrying a number, say) has no code to match: null, never a throw.
  const message = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof message === "string" ? message : "";
  if (!raw) return null;
  const m = loadedCopy();
  if (!m) {
    void loadLifecycleErrorCopy();
    return null; // the words are on their way: the caller's own plain sentence
  }
  for (const [code, copy] of Object.entries(m.LIFECYCLE_REASONS)) {
    // Postgres wraps the code in its own prose, so match on containment
    // rather than equality.
    if (raw.includes(code)) return copy;
  }
  return null;
}
