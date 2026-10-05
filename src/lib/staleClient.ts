/**
 * Stale web client: bring an open or returning tab onto the deployed build.
 *
 * THE HOLE (launch blocker, 2026-10-05). The service worker already uses
 * skipWaiting + clientsClaim and NetworkFirst HTML (vite.config.ts), so a NEW
 * navigation gets the new build. But a tab that stays open, or that iOS Safari
 * restores from memory, never navigates: it keeps running the JS it loaded,
 * for days, and nothing ever asks whether a newer build exists. When a
 * migration narrows a grant (20261004191007), that tab's reads fail with
 * 42501 and the user sees "We couldn't load this" until they happen to
 * hard-reload. (The owner's own failing rows on 2026-10-05 came from the
 * native binary, which ForceUpdateGate covers; this module is the web half.)
 *
 * WHAT IT DOES (web only; native bundles live in the binary):
 *   1. Checks on boot (after paint), on focus / visibilitychange-to-visible /
 *      online (throttled), and at once on any 42501 (permission-denied
 *      event from errorLogger.report):
 *        · registration.update(), so a new sw.js installs and takes control;
 *        · the deployed commit, read from index.html's build-commit meta
 *          with a no-store fetch the service worker does not intercept;
 *        · client_compat_floor() against CLIENT_COMPAT_EPOCH.
 *   2. Decides:
 *        · a newer deploy is waiting (below the floor or not): reload at the
 *          next in-app navigation, so a half-typed form is never thrown
 *          away, or now if a read was just refused (the screen is already
 *          broken). Below the floor with nothing newer deployed yet is a
 *          no-op: reloading would land on the same broken bundle.
 *   3. Never reloads while a mutation is in flight (no reload mid-submit),
 *      while the tab is hidden, or while chunkReload's own recovery reload is
 *      under way. Reloads at most once per target per RELOAD_GUARD_MS (a
 *      sessionStorage record), so a deploy still propagating, or a CDN copy
 *      of the old HTML, can never loop; without storage it does not reload at
 *      all (fail closed, as chunkReload does).
 */
import { queryClient } from "./queryClient";
import { isRecoveryReloadInFlight } from "./chunkReload";
import { CLIENT_COMPAT_EPOCH, isBelowFloor, readClientCompatFloor } from "./clientCompat";
import { PERMISSION_DENIED_EVENT } from "./permissionDenied";

export const CHECK_THROTTLE_MS = 30_000;
/** Even a forced check (a refused read) runs at most this often. */
export const FORCED_CHECK_THROTTLE_MS = 5_000;
export const RELOAD_GUARD_MS = 10 * 60_000;
const GUARD_KEY = "helpr_update_reload";

export type Pending = { kind: "hard" | "soft"; target: string } | null;

let pending: Pending = null;
let lastCheckAt = 0;
let checking: Promise<Pending> | null = null;

/** The commit this bundle was built from ("dev" when unknown). */
const runningCommit = (): string => (typeof __APP_COMMIT_FULL__ === "string" ? __APP_COMMIT_FULL__ : "dev");

/** Pure: the build-commit meta out of an index.html body, or null. */
export function parseBuildCommit(html: string): string | null {
  const m = /<meta\s+name=["']build-commit["']\s+content=["']([0-9a-f]{7,40})["']/i.exec(html);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pure: what the check found, as a pending reload (or none).
 *
 * A reload only helps when a NEWER bundle is deployed: below the floor with
 * the same commit still deployed (db-deploy lands before prod-deploy, up to
 * ~20 min) would reload into the same broken bundle, so it is nothing to do.
 * "hard" (below the floor, newer deploy waiting) and "soft" (newer deploy) both
 * land at the next navigation or on a refused read; neither interrupts a form.
 */
export function decidePending(input: { floor: number; epoch: number; deployed: string | null; running: string }): Pending {
  const running = input.running.toLowerCase();
  if (!input.deployed || !/^[0-9a-f]{7,40}$/.test(running) || input.deployed === running) return null;
  return { kind: isBelowFloor(input.floor, input.epoch) ? "hard" : "soft", target: input.deployed };
}

/** Pure: may we reload for `target` now, given the last guard record? */
export function guardAllows(record: { target: string; at: number } | null, target: string, now: number): boolean {
  if (!record) return true;
  return record.target !== target || now - record.at > RELOAD_GUARD_MS;
}

async function fetchDeployedCommit(): Promise<string | null> {
  try {
    // A plain fetch (mode "cors"), not a navigation, so the service worker's
    // navigate rule never answers it from html-pages; no-store skips HTTP
    // caches. The query string keeps any intermediary from reusing a copy.
    const res = await fetch(`/?build_check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    return parseBuildCommit(await res.text());
  } catch {
    // Offline or blocked: no answer, so no reload. The next check retries.
    return null;
  }
}

async function updateServiceWorker(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update();
  } catch {
    // No worker, or the update fetch failed: the HTML check below still runs.
  }
}

const readGuard = (): { target: string; at: number } | null => {
  try {
    const raw = sessionStorage.getItem(GUARD_KEY);
    return raw ? (JSON.parse(raw) as { target: string; at: number }) : null;
  } catch {
    // Unreadable record: treat as none; writeGuard below still has to succeed.
    return null;
  }
};

const writeGuard = (target: string): boolean => {
  try {
    const value = JSON.stringify({ target, at: Date.now() });
    sessionStorage.setItem(GUARD_KEY, value);
    return sessionStorage.getItem(GUARD_KEY) === value;
  } catch {
    // Storage blocked: no loop cap across reloads, so the caller must not reload.
    return false;
  }
};

/** Reload for the pending update, if it is safe right now. True when a reload started. */
export function reloadIfSafe(): boolean {
  const p = pending;
  if (!p) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (queryClient.isMutating() > 0) return false;
  if (isRecoveryReloadInFlight()) return false;
  if (!guardAllows(readGuard(), p.target, Date.now())) return false;
  if (!writeGuard(p.target)) return false;
  window.location.reload();
  return true;
}

/** Run one check (throttled unless forced). Resolves to what is pending. */
export function checkForUpdate(opts: { force?: boolean } = {}): Promise<Pending> {
  const now = Date.now();
  if (checking) return checking;
  if (now - lastCheckAt < (opts.force ? FORCED_CHECK_THROTTLE_MS : CHECK_THROTTLE_MS)) return Promise.resolve(pending);
  lastCheckAt = now;
  checking = (async () => {
    try {
      const [, deployed, floor] = await Promise.all([
        updateServiceWorker(),
        fetchDeployedCommit(),
        readClientCompatFloor({ force: opts.force }),
      ]);
      pending = decidePending({ floor, epoch: CLIENT_COMPAT_EPOCH, deployed, running: runningCommit() });
      return pending;
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Call on every in-app navigation: a pending soft update lands here. */
export function onRouteChange(): void {
  reloadIfSafe();
}

let installed = false;

/** Wire the checks. Web production only; call once from main.tsx. */
export function installStaleClientWatch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onVisible = () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", () => void checkForUpdate());
  window.addEventListener("online", () => void checkForUpdate());
  // pageshow with persisted=true is a tab restored from the back/forward
  // cache: the same "old JS, new day" state as a long-hidden tab.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) void checkForUpdate({ force: true });
  });
  window.addEventListener(PERMISSION_DENIED_EVENT, () => {
    void checkForUpdate({ force: true }).then(() => reloadIfSafe());
  });
  // First check after the page has painted and settled.
  setTimeout(() => void checkForUpdate({ force: true }), 5_000);
}

export function __resetStaleClientForTests(): void {
  pending = null;
  lastCheckAt = 0;
  checking = null;
}
