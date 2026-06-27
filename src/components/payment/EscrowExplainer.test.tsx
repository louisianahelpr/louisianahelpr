import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  EscrowExplainer,
  ESCROW_EXPLAINER_SEEN_KEY,
} from "./EscrowExplainer";

/**
 * @capacitor/preferences is async/native and shimmed to localStorage on
 * web. The component talks to it through safeStorage's fire-and-forget
 * mirror; we just need it to be inert in jsdom so writes don't dangle.
 */
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ value: null }),
    remove: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue({ keys: [] }),
  },
}));

describe("EscrowExplainer suppression logic", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the always-on inline reassurance pill for every customer", () => {
    // Stamp seen — this is the repeat-customer path. The pill must
    // still render; only the auto-open nudge goes away.
    localStorage.setItem(ESCROW_EXPLAINER_SEEN_KEY, "1");
    render(<EscrowExplainer />);
    expect(
      screen.getByText("Held securely until complete"),
    ).toBeInTheDocument();
  });

  it("auto-opens the popover the first time (no seen-at flag)", () => {
    expect(localStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY)).toBeNull();
    render(<EscrowExplainer />);
    // Radix renders open content into a portal; query by the tooltip body.
    expect(screen.getByText(/your payment is held securely/i)).toBeInTheDocument();
  });

  it("stamps localStorage once the popover has been seen", () => {
    expect(localStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY)).toBeNull();
    render(<EscrowExplainer />);
    // Mount-time auto-open triggers the effect that stamps the key.
    const stamped = localStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY);
    expect(stamped).not.toBeNull();
    // Stamp is a millisecond timestamp string.
    expect(Number(stamped)).toBeGreaterThan(0);
  });

  it("does NOT auto-open when seen-at flag already exists", () => {
    localStorage.setItem(ESCROW_EXPLAINER_SEEN_KEY, String(Date.now()));
    render(<EscrowExplainer />);
    // The pill is still there, but the popover body is not in the DOM.
    expect(
      screen.getByText("Held securely until complete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/your payment is held securely/i),
    ).not.toBeInTheDocument();
  });

  it("preserves the original seen-at timestamp across re-opens", () => {
    const originalStamp = "1700000000000";
    localStorage.setItem(ESCROW_EXPLAINER_SEEN_KEY, originalStamp);

    render(<EscrowExplainer />);
    // Repeat customer manually opens via the info trigger.
    const trigger = screen.getByRole("button", {
      name: /how payment works/i,
    });
    fireEvent.click(trigger);
    // Stamp must not be overwritten — we don't re-up the timer on every
    // viewing, just on the first reveal.
    expect(localStorage.getItem(ESCROW_EXPLAINER_SEEN_KEY)).toBe(
      originalStamp,
    );
  });
});
