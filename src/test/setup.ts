import { appendFileSync } from "node:fs";
import { afterEach, expect } from "vitest";
import "@testing-library/jest-dom";
import { installProdNetworkGuard } from "./prodNetworkGuard";

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
