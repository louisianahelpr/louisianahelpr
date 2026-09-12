import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

/**
 * EVERY TOAST IS BOTTOM-ANCHORED. Owner ruling, 2026-09-12.
 *
 * This is a test rather than a comment because the decision has already been
 * reversed once and defended with a reasonable-sounding argument (a top banner
 * is the iOS convention for transient confirmations). That argument lost to
 * three measured collisions in a single day, each one patched individually
 * before anyone noticed the shape:
 *   · the push nudge did not merely overlap the My Jobs title card, it
 *     REPLACED it — the <h1> invisible and its Search and Filter controls
 *     unreachable for a full 12 seconds;
 *   · at 1440 the toast sat over the right rail's "Post a Job" and over the
 *     header's Notifications control, with elementFromPoint returning the
 *     toast rather than the control;
 *   · at 375 every top-centre toast covered the header's Notifications bell.
 *
 * A comment could not stop a fourth reversal. This fails the build.
 */

const setWidth = (w: number) => {
  // jsdom's matchMedia is not implemented; the Toaster reads
  // `(min-width: 768px)` on mount and on change, so answer that one query.
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: /min-width:\s*768px/.test(query) ? w >= 768 : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

describe("toast placement", () => {
  beforeAll(() => {
    // Sonner measures the document; jsdom reports 0 for everything, which is
    // fine — we assert the ANCHOR attributes, not pixel geometry.
  });

  it("anchors to the bottom on a phone", async () => {
    setWidth(375);
    render(<Toaster />);
    toast("probe");
    const container = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toaster]");
      expect(el, "sonner never mounted its container").toBeTruthy();
      return el as HTMLElement;
    });
    expect(
      container.getAttribute("data-y-position"),
      "phone toasts must anchor to the BOTTOM — a top anchor lands on the title card and its controls",
    ).toBe("bottom");
    expect(container.getAttribute("data-x-position")).toBe("center");
  });

  it("anchors to the bottom on desktop too", async () => {
    setWidth(1440);
    render(<Toaster />);
    toast("probe");
    const container = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toaster]");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(
      container.getAttribute("data-y-position"),
      "desktop toasts must anchor to the BOTTOM — a top-right anchor lands on the rail's Post a Job and the header's Notifications control",
    ).toBe("bottom");
    expect(container.getAttribute("data-x-position")).toBe("right");
  });

  it("renders the toast it was given", async () => {
    // Guards the two assertions above from passing vacuously on a Toaster that
    // mounts a container but never shows anything.
    setWidth(375);
    render(<Toaster />);
    toast("a visible message");
    await waitFor(() => expect(screen.getAllByText("a visible message").length).toBeGreaterThan(0));
  });
});
