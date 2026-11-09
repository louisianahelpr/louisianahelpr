import { lazy } from "react";
import { report } from "@/lib/errorLogger";
import { getChunkRecoveryDecline, handOffStaleChunk, isChunkLoadError } from "@/lib/chunkReload";
import { ModuleUnavailableError } from "@/lib/loadModule";

/**
 * React.lazy for an OPTIONAL piece of a page: a one-time prompt or an ask that
 * is often not even due (Q2544), and every lazy piece mounted beside the routes
 * (Q1816, chromeLaziesFailQuietly). When its chunk fails to load, the failure is
 * reported once as a warning and the piece draws nothing, instead of throwing
 * into the page's error boundary and replacing the whole route with
 * "Something went sideways" (2026-10-31 23:30Z, /jobs, SmsPhonePrompt-<hash>.js).
 *
 * A stale chunk (a deploy changed the hashes) also starts the same bounded
 * recovery reload the error boundaries start (ErrorBoundary.tsx), so the piece
 * comes back on the reloaded page instead of staying missing until the member
 * reloads by hand (lh-silent-failure review of 46b7b91713); while that reload is on
 * its way the failure is not reported (11-09, the same hand-off as createLazyModule
 * and loadModule: chunkReload.ts handOffStaleChunk). A ModuleUnavailableError
 * (untilReload) is already reported by errorLogger's listener: not reported again.
 * `onFail` runs once per failed load, for a piece whose callers must hear that it
 * is not there (the ID-check sheet: markIdentitySheetUnavailable).
 *
 * Use it only for parts the page works without. A page's own content, or
 * anything the member asked to open, keeps plain lazy() and the boundaries'
 * stale-chunk recovery.
 */
/** React's own bound for lazy() (ComponentType<any>), read from lazy's signature so this file adds no `any` (anyRatchet). */
type LazyBound = Awaited<ReturnType<Parameters<typeof lazy>[0]>>["default"];

export function optionalLazy<T extends LazyBound>(load: () => Promise<{ default: T }>, source: string, onFail?: (err: unknown) => void) {
  const Nothing = (() => null) as unknown as T;
  return lazy(() =>
    load().catch((err: unknown) => {
      const unavailable = err instanceof ModuleUnavailableError;
      // A stale chunk goes to the shared recovery (handOffStaleChunk) and is quiet while that reload is on its way;
      // reported only when recovery declined, with the reason, or when it is not a chunk error at all.
      if (!unavailable && !handOffStaleChunk(err)) {
        report(err, {
          severity: "warning",
          tags: { source, kind: "optional-chunk-failed" },
          ...(isChunkLoadError(err) ? { context: { chunkRecovery: getChunkRecoveryDecline() } } : {}),
        });
      }
      try {
        onFail?.(err);
      } catch (hookErr) {
        // The hook only tells callers; its own failure must not undo the quiet fallback.
        report(hookErr, { severity: "warning", tags: { source, kind: "optional-chunk-onfail-failed" } });
      }
      return { default: Nothing };
    }),
  );
}
