import { AhaEvent, track } from "@/lib/analytics";

/**
 * One real-user page-load sample per cold load (Q762).
 *
 * The "p95 page load (web + app)" target (scripts/slo.mjs) had no data source:
 * real-user timings went only to Vercel Speed Insights, which nothing here can
 * read, and the native app recorded none at all. This sends the browser's own
 * Navigation Timing for the document as one `page_load` row in analytics_events
 * (first-party, no third party, no PII: three durations and the navigation
 * type), with `platform` = web / ios / android from track(). scripts/slo.mjs
 * reads the p95 of `load_ms` per platform over 7 days.
 *
 * Automated browsers are not users: Playwright and every CI journey run with
 * navigator.webdriver = true against the prod backend, and their loads would
 * otherwise be most of the sample. They are skipped.
 */
export interface PageLoadSample {
  /** Navigation start to the end of the load event, ms. */
  load_ms: number;
  /** Navigation start to the first response byte, ms. */
  ttfb_ms: number;
  /** Navigation start to the end of DOMContentLoaded, ms. */
  dcl_ms: number;
  nav_type: string;
}

type NavLike = Pick<PerformanceNavigationTiming, "loadEventEnd" | "responseStart" | "domContentLoadedEventEnd" | "type">;

/** The sample for one navigation entry, or null when it is not a usable measurement. */
export function pageLoadSample(nav: NavLike | undefined | null): PageLoadSample | null {
  if (!nav) return null;
  const load = Math.round(nav.loadEventEnd);
  // 0 = the load event has not finished; over 10 minutes = a tab left in the
  // background or a clock jump, not a page load.
  if (!(load > 0) || load > 600_000) return null;
  return {
    load_ms: load,
    ttfb_ms: Math.max(0, Math.round(nav.responseStart)),
    dcl_ms: Math.max(0, Math.round(nav.domContentLoadedEventEnd)),
    nav_type: String(nav.type || "navigate"),
  };
}

let sent = false;

/** Send this document's sample once, after its load event. Never throws. */
export function reportPageLoadOnce(): void {
  try {
    if (sent || typeof window === "undefined" || typeof performance === "undefined") return;
    if (navigator.webdriver) return;
    const send = () => {
      if (sent) return;
      const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
      const sample = pageLoadSample(nav);
      if (!sample) return;
      sent = true;
      track(AhaEvent.PageLoad, { ...sample });
    };
    if (document.readyState === "complete") setTimeout(send, 0);
    else window.addEventListener("load", () => setTimeout(send, 0), { once: true });
  } catch {
    /* a timing sample must never break the app */
  }
}
