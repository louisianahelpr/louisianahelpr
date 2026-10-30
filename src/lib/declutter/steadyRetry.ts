/**
 * Trying again by itself (owner 2026-10-30, on an iPhone: "I listed a few pictures of each item and bulk upload added
 * it as each picture a separate item"; "it took so long to load that some pictures timed out"). A phone drops requests
 * when the signal dips, the screen locks or the seller leaves the page: the browser reports "Load failed", and nothing
 * reached the server. So a step waits a little and tries again, and never while the page is away, because iOS would
 * only kill that try too.
 */
import { isNetworkFailure } from "@/lib/networkFailure";

const realPause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let timesAway = 0;
let listening = false;

function listenForAway(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") timesAway += 1;
  });
}

/** How many times this page has gone to the background: a try that spanned one was killed by iOS, not by the network. */
export function pageAwayCount(): number {
  listenForAway();
  return timesAway;
}

/** Resolves at once while the page is on screen, otherwise when the seller comes back to it. */
export function whenPageIsBack(): Promise<void> {
  listenForAway();
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const back = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
      resolve();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
  });
}

/** Failures another try can cure. A refusal (under 18, restricted, a bad photo) answers the same every time. */
export function worthTryingAgain(error: unknown): boolean {
  if (isNetworkFailure(error)) return true;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return ["ai_timed_out", "ai_unavailable", "ai_rate_limited", "photo_not_uploaded"].includes(message);
}

export interface RetryOptions {
  /** The wait before each further try: its length is how many more tries there are. */
  delays: readonly number[];
  pause?: (ms: number) => Promise<void>;
  whenBack?: () => Promise<void>;
  awayCount?: () => number;
  worthIt?: (error: unknown) => boolean;
  onRetry?: (error: unknown) => void;
}

/** The step, tried again after each delay. A try the page was sent away during doesn't use up a delay. */
export async function withRetries<T>(step: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { delays, pause = realPause, whenBack = whenPageIsBack, awayCount = pageAwayCount, worthIt = worthTryingAgain, onRetry } = options;
  let used = 0;
  for (;;) {
    await whenBack();
    const awayBefore = awayCount();
    try {
      return await step();
    } catch (error) {
      if (!worthIt(error)) throw error;
      if (awayCount() !== awayBefore) {
        onRetry?.(error);
        continue;
      }
      if (used >= delays.length) throw error;
      onRetry?.(error);
      await pause(delays[used]);
      used += 1;
    }
  }
}
