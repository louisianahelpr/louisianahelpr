import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { markChunkLoadSucceeded } from "./chunkReload";

 

/**
 * `React.lazy`, plus a `.preload()` that starts the dynamic import WITHOUT
 * rendering the component.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every protected page is `<ProtectedRoute><SomeLazyPage /></ProtectedRoute>`,
 * and `ProtectedRoute` returns its fallback — never `children` — while the
 * session is still unknown. React only starts a `lazy()` import when the
 * element is actually RENDERED, so the page's JS chunk was not even requested
 * until auth had resolved. The route chunk fetch and the auth round-trip,
 * which have nothing to do with each other, ran strictly one after the other.
 *
 * Measured on prod (www.louisianahelpr.com/my-posts, seeded poster with 6
 * jobs, Chromium 393x852, unthrottled, warm H2): `GET /assets/Activity-*.js`
 * was not requested until **2046ms** — the exact millisecond the `profiles`
 * response landed — even though the app bundle had finished at ~1.2s. It then
 * pulled a second-level chunk (`activityConstants`, 2190→2416ms) before the
 * posted-jobs query could fire at 2622ms. Three serial waits stacked on top of
 * a page whose data query depends on none of them.
 *
 * `ProtectedRoute` calls `.preload()` on its lazy children in an effect on
 * first render, so the chunk downloads alongside the auth calls instead of
 * behind them. Nothing is rendered and no query runs — this only warms the
 * module cache, so an unauthenticated visitor who is about to be redirected
 * pays a chunk fetch and nothing else.
 *
 * The promise is memoised: repeated `preload()` calls (re-renders, route
 * re-entry) reuse the first import. A rejected import is deliberately NOT
 * cached as a permanent failure — `lazy()` itself retries on render and
 * `chunkReload` handles a stale-deploy 404 — so a preload failure is swallowed
 * here and left for the render path to surface.
 */
export interface PreloadableComponent<T extends ComponentType<any>> extends LazyExoticComponent<T> {
  preload: () => void;
}

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let started: Promise<{ default: T }> | null = null;
  const load = () => {
    if (!started) {
      started = factory().then((mod) => {
        markChunkLoadSucceeded();
        return mod;
      });
    }
    return started;
  };
  const Component = lazy(load) as PreloadableComponent<T>;
  Component.preload = () => {
    void load().catch(() => {
      // Let the render path own the failure: reset so `lazy()` re-attempts.
      started = null;
    });
  };
  return Component;
}

/** Narrow an unknown element type to something carrying `preload()`. */
export const hasPreload = (t: unknown): t is { preload: () => void } =>
  typeof (t as { preload?: unknown } | null)?.preload === "function";
