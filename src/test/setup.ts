import "@testing-library/jest-dom";

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
