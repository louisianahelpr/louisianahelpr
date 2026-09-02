import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { report } from "@/lib/errorLogger";

/**
 * Realtime channels that come back after a drop — and say so when they can't.
 *
 * THE DEFECT THIS EXISTS FOR.
 *
 * Every `postgres_changes` channel in this app was opened with a bare
 * `.subscribe()` — no status callback, no retry, nothing. Supabase's
 * `.subscribe()` reports `SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` /
 * `CLOSED` to a callback and to nobody otherwise, so a dropped socket produced
 * no error, no log and no visible change: the app kept rendering the data it
 * already had and simply never heard about anyone else's writes again. Messages
 * stopped arriving, unread badges froze, a job's status stayed on the step it
 * was on when the socket died. Every one of those looks exactly like "nothing
 * is happening", which is why it has never been reported as a bug.
 *
 * One place had a status callback (`useActivityData`) and it only forwarded to
 * Sentry — useful for us, invisible to the person holding the phone.
 *
 * THREE THINGS ARE REQUIRED, AND RECONNECTING IS ONLY THE FIRST.
 *
 *  1. Reconnect. Backoff with jitter, plus an immediate wake on `online` and on
 *     tab/app foreground — a backgrounded WKWebView losing its socket is the
 *     likeliest real-world path here, and `appLifecycle.ts` wires app resume
 *     into TanStack's focusManager but has never touched realtime.
 *
 *  2. Backfill the gap. A channel that reconnects starts delivering FUTURE
 *     events; everything written during the outage is simply missing, and the
 *     screen stays wrong in a way that now looks connected. So every recovery
 *     fires `onRecovered`, and every caller passes the same refetch/invalidate
 *     its own listeners call. Reconnection without this trades a visibly stale
 *     screen for an invisibly stale one.
 *
 *  3. Tell the user. Until a channel is back, live updates are not happening,
 *     and the honest thing is to say so rather than let the screen imply
 *     otherwise. Channels publish their health here; `OfflineBanner` reads it
 *     through `useRealtimeDegraded()` and shows the same banner it uses for a
 *     dropped network.
 *
 * WHY A REBUILD AND NOT `channel.subscribe()` AGAIN. Supabase dedupes channels
 * BY NAME (the reason `channelNonce()` exists at all — see realtimeChannel.ts),
 * and a channel that has errored is not reliably reusable. So each attempt
 * removes the old channel and asks the caller to build a fresh one under a
 * fresh nonce. That is why `build` takes the channel NAME rather than the
 * caller passing an already-constructed channel: a pre-built channel could only
 * ever be subscribed once.
 */

/** Backoff schedule. Capped rather than unbounded — a channel that is down for
 *  an hour should still be retrying every 30s, because the user is looking at
 *  a stale screen the whole time. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

/** Statuses that mean "this channel is not delivering". */
const DEAD_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

// ── Health registry ─────────────────────────────────────────────────────────
// Module-level rather than context: channels are opened from hooks, module
// singletons (useCurrentUser's refcounted registry) and async callbacks alike,
// and none of those can reach a React provider.

const downChannels = new Set<string>();
const healthListeners = new Set<() => void>();
/** Snapshot for useSyncExternalStore — must be a stable value, not a new Set. */
let degradedSnapshot = false;

function publishHealth() {
  const next = downChannels.size > 0;
  if (next === degradedSnapshot) return;
  degradedSnapshot = next;
  for (const listener of [...healthListeners]) listener();
}

function subscribeHealth(listener: () => void) {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

const readHealth = () => degradedSnapshot;

/**
 * True while at least one realtime channel is down. Drives the "live updates
 * paused" state of the global banner.
 *
 * `getServerSnapshot` returns false: SSR/prerender has no socket, and claiming
 * degradation in a prerendered shell would flash the banner on every cold load.
 */
export function useRealtimeDegraded(): boolean {
  return useSyncExternalStore(subscribeHealth, readHealth, () => false);
}

/** Test seam — resets the registry between cases. */
export function __resetRealtimeHealth() {
  downChannels.clear();
  degradedSnapshot = false;
  healthListeners.clear();
}

// ── Wake-ups ────────────────────────────────────────────────────────────────

const pendingWakes = new Set<() => void>();

function wakeAll() {
  for (const wake of [...pendingWakes]) wake();
}

let wakeWired = false;
function ensureWakeWiring() {
  if (wakeWired || typeof window === "undefined") return;
  wakeWired = true;
  // `online` covers the browser's own reconnect. `visibilitychange` covers the
  // case backoff handles worst: a phone in a pocket for twenty minutes, whose
  // channel died at minute one and is now on a 30s cadence the user has to wait
  // out after unlocking. Both just collapse the current backoff to zero.
  window.addEventListener("online", wakeAll);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) wakeAll();
    });
  }
}

// ── The subscription ────────────────────────────────────────────────────────

export interface RecoveringSubscription {
  /**
   * The channel currently subscribed, or null while an attempt is pending.
   * Only read this for `.track()` / `.send()` style calls that need the live
   * instance (see useChatPresence) — teardown goes through `close()`.
   */
  readonly current: RealtimeChannel | null;
  /** Tear down for good. Idempotent; safe to call from an effect cleanup. */
  close: () => void;
}

export interface RecoveryOptions {
  /**
   * Stable base name. A fresh `channelNonce()` is appended on every attempt,
   * so pass the name WITHOUT one — e.g. `messages-realtime-${userId}`.
   */
  name: string;
  /**
   * Called after a channel comes back from a failure. This is where the caller
   * refetches: the socket missed every write during the outage, and nothing
   * else will ever deliver them. Not called on the FIRST successful subscribe.
   */
  onRecovered?: () => void;
  /**
   * Extra status handling the caller needs (e.g. presence `.track()` on
   * SUBSCRIBED). Runs before recovery bookkeeping and never replaces it.
   *
   * The live channel is passed in rather than read back off the returned
   * subscription: the caller writes `const sub = subscribeWithRecovery(…)`, and
   * a status delivered synchronously during that call would hit `sub` in its
   * temporal dead zone. Supabase resolves asynchronously today, so that is a
   * latent trap rather than a live bug — which is exactly the kind worth
   * designing out instead of relying on.
   */
  onStatus?: (status: string, err: Error | undefined, channel: RealtimeChannel) => void;
  /**
   * Use `name` verbatim instead of appending a fresh `channelNonce()`.
   *
   * ONLY for a channel whose name is a rendezvous point rather than a private
   * subscription — i.e. presence and broadcast, where both participants must
   * open the SAME name or they are simply in different rooms and presence
   * never syncs. `useChatPresence` is the one such channel in the app; every
   * `postgres_changes` channel wants the nonce, because for those a shared
   * name is the silent-dedupe bug channelNonce exists to prevent.
   *
   * Safe on rebuild despite the dedupe: an attempt removes the old channel
   * before building the next, so the name is free again.
   */
  stableName?: boolean;
}

/**
 * Subscribe `build(name)`'s channel, and keep it subscribed.
 *
 * ```ts
 * const sub = subscribeWithRecovery(
 *   (name) => supabase.channel(name).on("postgres_changes", { … }, handler),
 *   { name: `unread-nav-${userId}`, onRecovered: loadCounts },
 * );
 * return () => sub.close();
 * ```
 */
export function subscribeWithRecovery(
  build: (channelName: string) => RealtimeChannel,
  opts: RecoveryOptions,
): RecoveringSubscription {
  ensureWakeWiring();

  // Identity in the health registry. Per-subscription, not per-name: two mounts
  // of the same hook are two independent channels and either can be down.
  const healthKey = `${opts.name}#${channelNonce()}`;

  let channel: RealtimeChannel | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let everSubscribed = false;
  let degraded = false;
  let reportedThisOutage = false;

  const markDown = () => {
    if (degraded) return;
    degraded = true;
    downChannels.add(healthKey);
    publishHealth();
  };

  const markUp = () => {
    if (!degraded) return;
    degraded = false;
    downChannels.delete(healthKey);
    publishHealth();
  };

  const wake = () => {
    if (closed || !degraded) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    attempt = 0;
    open();
  };

  const scheduleRetry = () => {
    if (closed || timer) return;
    const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    attempt += 1;
    // Jitter: eleven channels die together when one socket drops, and eleven
    // reconnects on the same tick is a self-inflicted thundering herd.
    timer = setTimeout(
      () => {
        timer = null;
        open();
      },
      base + Math.floor(Math.random() * 400),
    );
  };

  const open = () => {
    if (closed) return;

    if (channel) {
      const stale = channel;
      // Null FIRST: removeChannel makes the old channel emit CLOSED, and the
      // `channel !== mine` guard below is what stops that from being read as a
      // fresh failure and scheduling a second retry loop.
      channel = null;
      void supabase.removeChannel(stale);
    }

    const mine = build(opts.stableName ? opts.name : `${opts.name}-${channelNonce()}`);
    channel = mine;

    mine.subscribe((status: string, err?: Error) => {
      // A status from an attempt we have already abandoned. Ignore it entirely
      // — including the caller's onStatus, which would otherwise see a CLOSED
      // for a channel it has already stopped caring about.
      if (channel !== mine || closed) return;

      opts.onStatus?.(status, err, mine);

      if (status === "SUBSCRIBED") {
        attempt = 0;
        reportedThisOutage = false;
        const recovering = degraded;
        markUp();
        // Only after a real outage. A first subscribe has no gap to backfill,
        // and firing here would double every hook's initial load.
        if (recovering && everSubscribed) opts.onRecovered?.();
        everSubscribed = true;
        return;
      }

      if (!DEAD_STATUSES.has(status)) return;

      markDown();
      if (!reportedThisOutage) {
        reportedThisOutage = true;
        report(err ?? new Error(`realtime channel ${status}`), {
          severity: "warning",
          tags: { source: "realtimeRecovery", channel: opts.name, status },
        });
      }
      scheduleRetry();
    });
  };

  const registeredWake = () => wake();
  pendingWakes.add(registeredWake);
  open();

  return {
    get current() {
      return channel;
    },
    close() {
      if (closed) return;
      closed = true;
      pendingWakes.delete(registeredWake);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // A deliberately closed channel is not a degraded one — leaving it in the
      // registry would pin the banner open for the rest of the session.
      markUp();
      if (channel) {
        const stale = channel;
        channel = null;
        void supabase.removeChannel(stale);
      }
    },
  };
}
