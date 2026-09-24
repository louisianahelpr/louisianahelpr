/**
 * Q68 (rural Louisiana): the core journey steps the slow-network suite must
 * cover, and the network it throttles to. ONE list: the spec takes its test
 * titles from it and src/test/slowNetworkCoversEverySteps.test.ts checks it
 * two ways (every step has both modes in the spec; the spec has no step or
 * mode that is not here; every route is a real route in src/App.tsx).
 */

/**
 * Chrome DevTools' "3G" preset (Network.emulateNetworkConditions): 562.5ms
 * RTT, 1.6 Mbps down and 750 Kbps up, each derated by 0.9 the way DevTools
 * does. Throughputs are bytes/second.
 */
export const NETWORK_3G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8,
  uploadThroughput: (750 * 1024 * 0.9) / 8,
} as const;

/** A wait longer than this must show progress (spinner, busy button, skeleton, busy text) by this point. */
export const PROGRESS_GRACE_MS = 1_000;
/** A wait that shows nothing for this long counts as hanging silently. */
export const HANG_MS = 90_000;
/**
 * A COLD PAGE LOAD is judged on total time, not on showing progress within
 * PROGRESS_GRACE_MS: the owner chose a plain background for the chunk wait
 * (Q201) and kept it over a loading sign (Q324 pop-up, 2026-09-23). First live
 * run 35931277278 measured /login 5159ms and /browse 8621ms on NETWORK_3G.
 */
export const COLD_LOAD_BUDGET_MS = 15_000;

/**
 * `write` is the server write the drop test cuts, and whether a retry could
 * double it. `null` = a read-only step: its drop test asserts the offline copy
 * and recovery, and has nothing to double.
 */
export const SLOW_NETWORK_STEPS = [
  { id: "sign-in", route: "/login", write: "POST /auth/v1/token (a new session; nothing to double)" },
  { id: "browse", route: "/browse", write: null },
  { id: "post", route: "/post-job", write: "POST /rest/v1/jobs" },
  { id: "apply", route: "/home", write: "POST /rest/v1/rpc/apply_to_job" },
  { id: "message", route: "/messages", write: "POST /rest/v1/messages" },
  { id: "pay-start", route: "/post-job", write: "POST /functions/v1/create-payment" },
] as const;

export const NETWORK_MODES = ["3g", "drop"] as const;

export type StepId = (typeof SLOW_NETWORK_STEPS)[number]["id"];
export type NetworkMode = (typeof NETWORK_MODES)[number];

/** The one title format: `<step> · <mode>`. The guard parses it back out of the spec. */
export function stepTitle(step: StepId, mode: NetworkMode) {
  return `${step} · ${mode}`;
}
