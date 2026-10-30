import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";

/** Quiet time after the page's last read, so a page that reads in steps counts as one. */
export const PAGE_READS_QUIET_MS = 400;
/** Nothing waits longer than this, however busy the page stays. */
export const PAGE_READS_CAP_MS = 5000;

/**
 * The To-do badge's reads wait for the page's own on every page but Home, so a
 * page's first photos do not queue behind them on a slow phone. The chrome's
 * other reads (Messages badge and bell, Helpr online pill, the post-job warm-up)
 * wait only on a launch into Declutter (useChromeReadsMayStart). Terms and ban
 * checks never wait: they do not use this.
 *
 * One latch for the whole app, closed once per launch: a chrome chunk that
 * mounts late must not start a wait of its own (with nothing fetching any more,
 * it would sit out the whole cap). It stays open when no watch ever started, so
 * a component rendered on its own reads at once. Home does not wait: it reads
 * the same rows for its own list.
 */
let started = false;
let waiting = false;
let declutterLaunch = false;
let stop: () => void = () => {};
const listeners = new Set<() => void>();

const settle = () => {
  if (!waiting) return;
  waiting = false;
  stop();
  listeners.forEach((l) => l());
};

/** Starts the one watch; later calls do nothing. Runs as soon as a maybe-signed-in visitor's chrome renders. */
export function startPageReadsWatch(client: QueryClient): void {
  if (started) return;
  started = true;
  if (window.location.pathname === "/home") return;
  waiting = true;
  declutterLaunch = window.location.pathname.startsWith("/declutter");
  let sawReads = false;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    if (client.isFetching() > 0) {
      sawReads = true;
      if (quiet !== null) clearTimeout(quiet);
      quiet = null;
      return;
    }
    if (!sawReads || quiet !== null) return;
    quiet = setTimeout(settle, PAGE_READS_QUIET_MS);
  };
  const unsubscribe = client.getQueryCache().subscribe(check);
  const cap = setTimeout(settle, PAGE_READS_CAP_MS);
  stop = () => {
    unsubscribe();
    clearTimeout(cap);
    if (quiet !== null) clearTimeout(quiet);
  };
  check();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => !waiting;

export function usePageReadsSettled(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const chromeSnapshot = () => !waiting || !declutterLaunch;

/** For the chrome's own reads: false only while a launch into Declutter is still reading its first screen. */
export function useChromeReadsMayStart(): boolean {
  return useSyncExternalStore(subscribe, chromeSnapshot, chromeSnapshot);
}

/** Tests only: back to a fresh launch. */
export function __resetPageReadsWatch(): void {
  stop();
  stop = () => {};
  started = false;
  waiting = false;
  declutterLaunch = false;
  listeners.clear();
}
