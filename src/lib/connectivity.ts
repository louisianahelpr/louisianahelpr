/**
 * The app's ONE connectivity state, shared by useOnlineStatus, the error
 * boundaries and TanStack's onlineManager (wired in queryClient.ts).
 *
 * Why it is not just `navigator.onLine` (owner, 10-31): she was online, but
 * Chrome reported `navigator.onLine === false`, and /jobs?tab=posted showed a
 * full-page "You're offline." plus the banner. On the web a `false` there is
 * only a HINT. Before the app says "offline" anywhere it confirms the hint
 * with a short request to the backend (`probeBackend`):
 *   - the request reaches a server (any HTTP answer, even an opaque one): we
 *     are online, whatever navigator.onLine says;
 *   - it fails or times out: we are offline.
 * While marked offline it asks again on window focus, on the `online` event
 * and every OFFLINE_REPROBE_MS. Any Supabase request that comes back
 * (`noteReachable`, called from the Supabase client's fetch and the query
 * cache) flips it back to online at once.
 *
 * Native (Capacitor) keeps its own path: useOnlineStatus layers
 * @capacitor/network on top and calls setConnectivity with the OS answer.
 */
import { raceVisibleDeadlineAbortable } from "@/lib/visibleDeadline";

export interface OnlineStatus {
  online: boolean;
  /** Epoch-ms of the most recent transition. */
  lastChangedAt: number;
}

/** How long one probe may take before it counts as "no connection". */
const PROBE_TIMEOUT_MS = 4_000;
/** While marked offline, how often the probe runs again. */
export const OFFLINE_REPROBE_MS = 20_000;

export type ConnectivityProbe = () => Promise<boolean>;

/**
 * A HEAD request to the Supabase auth health endpoint (or our own origin when
 * no Supabase URL is configured). `no-cors` keeps it a simple request with no
 * preflight: an opaque answer still proves the network carried it, and only a
 * network failure rejects. The service worker never caches the API
 * (src/test/swRuntimeCachingNeverStoresApi.test.ts), so a cached copy cannot
 * fake "online".
 */
async function probeBackend(): Promise<boolean> {
  if (typeof fetch !== "function") return true;
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
  const url = base
    ? `${base.replace(/\/$/, "")}/auth/v1/health?probe=${Date.now()}`
    : `${typeof location === "undefined" ? "" : location.origin}/robots.txt?probe=${Date.now()}`;
  try {
    // The deadline counts only visible time (src/lib/visibleDeadline.ts): a phone put away mid-probe
    // comes back to the probe's real answer, never a wall-clock timeout that reads as "offline".
    await raceVisibleDeadlineAbortable(
      (signal) => fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store", signal }),
      PROBE_TIMEOUT_MS,
      "connectivity probe timed out",
    );
    return true;
  } catch {
    // A rejected fetch (network failure or the deadline's abort) IS the answer: offline.
    return false;
  }
}

let state: OnlineStatus = { online: true, lastChangedAt: Date.now() };
const subscribers = new Set<() => void>();
let probe: ConnectivityProbe = probeBackend;
let probing: Promise<void> | null = null;
let reprobeTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastProbeAt = 0;
/** A new subscriber re-checks a false navigator.onLine at most this often. */
const HINT_RECHECK_MS = 10_000;

function notify() {
  for (const fn of subscribers) fn();
}

function syncReprobeTimer() {
  if (!state.online && reprobeTimer === null && typeof setInterval === "function") {
    reprobeTimer = setInterval(() => void confirmConnectivity(), OFFLINE_REPROBE_MS);
  } else if (state.online && reprobeTimer !== null) {
    clearInterval(reprobeTimer);
    reprobeTimer = null;
  }
}

/** Set the state directly (native Network plugin, a confirmed probe, a fetch that came back). */
export function setConnectivity(online: boolean): void {
  if (state.online === online) return;
  state = { online, lastChangedAt: Date.now() };
  syncReprobeTimer();
  notify();
}

/** A request to the backend came back with an HTTP answer: we are online. */
export function noteReachable(): void {
  setConnectivity(true);
}

/** Wrap a fetch so every answered request (any HTTP status) counts as "reachable". */
export function noteReachableFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await fetchImpl(input, init);
    noteReachable();
    return res;
  };
}

/** Run the probe (one at a time) and set the state from its answer. */
function confirmConnectivity(): Promise<void> {
  if (probing) return probing;
  probing = (async () => {
    let ok: boolean;
    try {
      ok = await probe();
    } catch {
      // A probe that throws could not reach anything: same answer as a failed request.
      ok = false;
    }
    lastProbeAt = Date.now();
    setConnectivity(ok);
  })().finally(() => {
    probing = null;
  });
  return probing;
}

/** The current state, without subscribing. */
export function getConnectivity(): OnlineStatus {
  return state;
}

/** True only once offline is CONFIRMED. Use instead of `navigator.onLine === false`. */
export function isConfirmedOffline(): boolean {
  return !state.online;
}

export function subscribeConnectivity(fn: () => void): () => void {
  ensureConnectivityStarted();
  subscribers.add(fn);
  // A screen mounting while the browser says offline re-checks the hint
  // (throttled), so a hint that arrived without an event is still confirmed.
  if (
    state.online &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false &&
    Date.now() - lastProbeAt > HINT_RECHECK_MS
  ) {
    void confirmConnectivity();
  }
  return () => {
    subscribers.delete(fn);
  };
}

/** Attach the window listeners once. Safe to call many times. */
export function ensureConnectivityStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // `offline` (and a false onLine at start) is only a hint: confirm it.
  window.addEventListener("offline", () => void confirmConnectivity());
  window.addEventListener("online", () => {
    if (!state.online) void confirmConnectivity();
  });
  window.addEventListener("focus", () => {
    if (!state.online) void confirmConnectivity();
  });
  if (typeof navigator !== "undefined" && navigator.onLine === false) void confirmConnectivity();
}

/** Tests only: swap the probe and start from a clean, online state. */
export function resetConnectivityForTests(nextProbe?: ConnectivityProbe): void {
  probe = nextProbe ?? probeBackend;
  probing = null;
  lastProbeAt = 0;
  if (reprobeTimer !== null) clearInterval(reprobeTimer);
  reprobeTimer = null;
  state = { online: true, lastChangedAt: Date.now() };
}
