import { createElement, lazy, useEffect, useState, type ComponentType } from "react";
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
  return lazy(() => optionalLoad(load, source, onFail));
}

/** The load behind optionalLazy and quietLazy: a failure is reported (or handed to the stale-chunk reload) and draws nothing. */
function optionalLoad<T>(load: () => Promise<{ default: T }>, source: string, onFail?: (err: unknown) => void): Promise<{ default: T }> {
  const Nothing = (() => null) as unknown as T;
  return (
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
    })
  );
}

/**
 * optionalLazy for a piece mounted BESIDE the routes (the dock, banners, the Terms / ID / permission mounts): the
 * same quiet failure, but it never suspends. It draws nothing until its chunk is in, then draws itself.
 *
 * Why (Builder 2, speed7 11-15): a suspended lazy anywhere in the tree turns React 18's reveal of the page into a
 * throttled retry. When the route's content arrives while chrome chunks are still loading, the render ends
 * "suspended" (even though each chrome piece has its own null Suspense). React then holds the commit for up to
 * FALLBACK_THROTTLE_MS (500 ms) after the last fallback it showed, and restarts the whole render on every chunk that
 * lands. Measured with temporary marks on signed-in /jobs (cwv-lab, Slow 4G, 4x CPU): the page rendered four times,
 * at 4.24, 4.38, 4.76 and 4.85 s, with its cards in each pass. It first committed at 4.91 s, after the chrome chunks
 * requested at 4.15 s had all arrived.
 */
export function quietLazy<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, source: string, onFail?: (err: unknown) => void) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;
  const start = () => (pending ??= optionalLoad(load, source, onFail).then((m) => { loaded = m.default as ComponentType<P>; }));
  function Quiet(props: P) {
    const [, setReady] = useState(false);
    if (!loaded) void start();
    useEffect(() => {
      let live = true;
      // Always: the chunk may have landed between this render (which drew nothing) and this effect.
      void start().then(() => { if (live) setReady(true); });
      return () => { live = false; };
    }, []);
    return loaded ? createElement(loaded, props) : null;
  }
  Quiet.displayName = `Quiet(${source})`;
  return Quiet;
}
