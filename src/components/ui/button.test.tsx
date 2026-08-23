import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";

/**
 * These tests document the per-variant *depth contract* added in response to
 * TestFlight #2 feedback ("buttons look flat next to cards"). The four
 * cumulative treatments are:
 *
 *   1. 3-layer drop shadow              — `0_1px_1px_...` + `0_2px_6px_...` + `0_4px_12px_-2px_...`
 *   2. inner top-edge cream highlight   — `inset_0_1px_0_...parchment/0.22` (filled)
 *                                          or `inset_0_1px_0_rgba(255,255,255,0.55)` (outline)
 *   3. active-press scale               — `active:scale-[0.97]`
 *   4. subtle vertical gradient         — `linear-gradient(180deg,...0.92)`
 *
 * The assertions look at the className string (not computed style) because
 * Tailwind arbitrary-value classes are emitted verbatim; this is enough to
 * lock the contract that future edits don't accidentally regress an entire
 * variant family back to flat.
 */
describe("Button", () => {
  it("renders children and forwards onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Submit</Button>);
    const btn = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("merges a caller-supplied className", () => {
    render(<Button className="mt-4">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveClass("mt-4");
  });

  describe("elevation contract", () => {
    const expectFilledElevation = (className: string) => {
      // 3-layer drop shadow (tight 1px contact + 2/6 ambient + 4/12 halo)
      expect(className).toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(className).toContain("0_2px_6px_hsl(var(--ink-deep)/0.12)");
      expect(className).toContain("0_4px_12px_-2px_hsl(var(--ink-deep)/0.08)");
      // inner top-edge cream highlight (parchment/0.22)
      expect(className).toContain("inset_0_1px_0_hsl(var(--parchment)/0.22)");
      // active press — scale down 0.97 (crisper than translate alone)
      expect(className).toContain("active:scale-[0.97]");
    };

    const expectOutlineElevation = (className: string) => {
      // 3-layer drop shadow — outline family uses softer alphas
      expect(className).toContain("0_1px_1px_hsl(var(--ink-deep)/0.08)");
      expect(className).toContain("0_2px_6px_hsl(var(--ink-deep)/0.10)");
      expect(className).toContain("0_4px_12px_-2px_hsl(var(--ink-deep)/0.06)");
      // outline uses a white inner highlight, NOT the cream/parchment one
      expect(className).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.22)");
      expect(className).toContain("inset_0_1px_0_rgba(255,255,255,0.55)");
      // active press
      expect(className).toContain("active:scale-[0.97]");
    };

    it("primary CTA gets all 4 treatments (gradient + highlight + 3-layer shadow + press)", () => {
      render(<Button variant="primary">Sign In</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      // Bark shares the primary CTA gradient via the hand-written
      // .btn-grad-primary CSS class (same as `default`), so every
      // "Post a job"–family CTA reads identically. Asserting the class — not
      // an inline arbitrary gradient — keeps this in step with that unifying.
      expect(cls).toContain("btn-grad-primary");
    });

    it("default primary gets gradient + highlight + shadow + press", () => {
      render(<Button>Continue</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      // Gradient ships via the hand-written .btn-grad-primary CSS class, NOT a
      // Tailwind arbitrary value — the slash-alpha-on-var arbitrary form silently
      // dropped out of the prod JIT build, rendering the CTA as a near-white pill.
      expect(cls).toContain("btn-grad-primary");
    });

    it("destructive gets shadow + highlight + press but NO gradient (red stays flat to discourage misclicks)", () => {
      render(<Button variant="destructive">Delete</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      expect(cls).not.toContain("linear-gradient");
    });

    it("secondary gets shadow + highlight + press, no gradient", () => {
      render(<Button variant="secondary">Cancel</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      expect(cls).not.toContain("linear-gradient");
    });

    it("outline gets ONLY the 2-layer shadow + press (no inner highlight, no gradient)", () => {
      render(<Button variant="outline">Back</Button>);
      const cls = screen.getByRole("button").className;
      expectOutlineElevation(cls);
      expect(cls).not.toContain("linear-gradient");
    });

    it("ghost stays intentionally flat (no shadow, no highlight, no press scale)", () => {
      render(<Button variant="ghost">Skip</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(cls).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.22)");
      expect(cls).not.toContain("active:scale-[0.97]");
    });

    it("link stays intentionally flat", () => {
      render(<Button variant="link">Learn More</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(cls).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.22)");
      expect(cls).not.toContain("active:scale-[0.97]");
    });

    it("primary + shimmer (marketing CTA) keeps all 4 treatments", () => {
      render(<Button variant="primary" shimmer>Get Started</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      // Same gradient delivery as `default` — via .btn-grad-primary, see above.
      expect(cls).toContain("btn-grad-primary");
    });

    it("outline gets outline-family elevation (shadow + press only)", () => {
      render(<Button variant="outline">Browse</Button>);
      const cls = screen.getByRole("button").className;
      expectOutlineElevation(cls);
      expect(cls).not.toContain("linear-gradient");
    });
  });
});
