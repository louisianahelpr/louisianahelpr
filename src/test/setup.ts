import { appendFileSync } from "node:fs";
import { afterEach, beforeEach, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { installProdNetworkGuard } from "./prodNetworkGuard";
import { resetConnectivityForTests } from "@/lib/connectivity";

// Payout setup only after a hire (owner 2026-10-25): every component that
// reads usePayoutSetupPaused() now also asks the server whether the member was
// hired (a React Query read of payout_setup_hire_allowed_for_me). Tests not
// ABOUT that rule read "hired" here, as they read the edge mock's
// payout_setup_hire_allowed: true, so they keep testing what they were written
// for. The rule itself is tested with the real hook
// (src/hooks/usePayoutSetupHireAllowed.test.tsx unmocks it) and on the server
// (src/test/edge/stripeConnectNeedsHire.test.ts, payoutAfterHire.pglite.mjs).
vi.mock("@/hooks/usePayoutSetupHireAllowed", () => ({ usePayoutSetupHireAllowed: () => true }));

// Unmount every render after every test, in every file. RTL only registers its
// own auto-cleanup when a test file imports it statically; a file that loads it
// with `await import(...)` left its renders mounted, and a React update fired
// after jsdom teardown failed a whole CI shard with "document global ... not
// defined anymore" (helperDisputeCopy, CI run 36880636360, twice).
// Guarded by src/test/rtlCleanupIsGlobal.test.ts.
// Radix FocusScope (every Dialog, Popover, Sheet, AlertDialog) dispatches its
// unmount event from a setTimeout(0) scheduled DURING that unmount. Registered
// before the cleanup hook, so with vitest's default "stack" order it runs after
// it (and it unmounts itself too, so the order cannot matter): wait one real
// tick so that timer fires while jsdom is alive. Without it, a file's last test
// could leave the timer to fire after teardown, failing the run with "parameter
// 1 is not of type 'Event'" while every test passed (land-vitest-changed
// 2026-10-15). Fake timers left on by a file never fire after teardown.
// Guarded by src/test/radixUnmountTimerDrains.test.tsx.
afterEach(async () => {
  cleanup();
  if (!vi.isFakeTimers()) await new Promise((r) => setTimeout(r, 0));
});
afterEach(() => cleanup());

// Connectivity (src/lib/connectivity.ts) confirms a false navigator.onLine with
// a backend probe before the app says offline. Unit tests never reach the
// network, so by default the probe agrees with navigator.onLine: a test that
// sets onLine=false still sees offline (after the probe's microtask). Tests
// ABOUT the probe pass their own (src/lib/useOnlineStatus.test.ts).
beforeEach(() => resetConnectivityForTests(async () => navigator.onLine !== false));

// Unit tests never reach prod Supabase (Q55a): see src/test/prodNetworkGuard.ts.
installProdNetworkGuard();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom gaps that Radix UI (Dialog, Select, Popover, …) calls at mount time.
// Without these, a Radix Dialog can silently fail to open — the click that
// sets its `open` renders a subtree that throws on the missing API, so the
// confirm button never appears. It only bit tests that render a Radix overlay
// AND run in a worker where no earlier test happened to install these globals
// first, which is why JobTracking.doneInFlight / ReuploadIdDialog passed in the
// full suite but failed in isolation and flaked under load. Defining them here
// (the one setupFile every test file loads) makes every Dialog test
// self-sufficient — order- and load-independent.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ─── Vacuity tracer (scripts/vacuity/) ───────────────────────────────────────
// Off unless LH_VACUITY_TRACE points at a file. When on, every test appends one
// JSONL record with the number of assertions it ACTUALLY executed. A guard that
// iterates an inventory and asserts per member reports 0 when the inventory is
// empty — that is empty-inventory vacuity (class (a)) measured, not guessed.
// Deliberately in the one setupFile every spec loads so no guard can opt out.
if (process.env.LH_VACUITY_TRACE) {
  const tracePath = process.env.LH_VACUITY_TRACE;
  afterEach((ctx: { task?: { name?: string; file?: { name?: string } } }) => {
    try {
      const state = expect.getState() as { assertionCalls?: number; testPath?: string };
      appendFileSync(
        tracePath,
        JSON.stringify({
          file: ctx?.task?.file?.name ?? state.testPath ?? "?",
          test: ctx?.task?.name ?? "?",
          assertions: state.assertionCalls ?? 0,
        }) + "\n",
      );
    } catch {
      /* tracing must never fail a test */
    }
  });
}

// Q259: React's dev-only render-phase warnings are bugs, not noise — a
// setState during another component's render, or an input flipping between
// uncontrolled and controlled. Production strips them, so a test is the only
// place they can be caught. Any test that triggers one fails.
const RENDER_BUG_WARNINGS = [
  /Cannot update a component .* while rendering a different component/,
  /is changing an? (un)?controlled .* to be (un)?controlled/,
  /changing the (default )?value state of an? (un)?controlled/i,
  /is changing from (un)?controlled to (un)?controlled/, // Radix Select/Checkbox
];
for (const level of ["error", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    if (RENDER_BUG_WARNINGS.some((re) => re.test(text))) {
      throw new Error(`React render-phase warning (Q259): ${text.slice(0, 300)}`);
    }
    orig(...args);
  };
}
