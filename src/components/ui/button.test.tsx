import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";

/**
 * These tests document the per-variant *depth contract* added in response to
 * TestFlight #2 feedback ("buttons look flat next to cards"). The four
 * cumulative treatments are:
 *
 *   1. 2-layer drop shadow              — `0_1px_1px_...` + `0_2px_4px_...`
 *   2. inner top-edge cream highlight   — `inset_0_1px_0_...parchment/0.18`
 *   3. active-press translate           — `active:translate-y-px`
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
      // 2-layer drop shadow
      expect(className).toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(className).toContain("0_2px_4px_hsl(var(--ink-deep)/0.12)");
      // inner top-edge highlight
      expect(className).toContain("inset_0_1px_0_hsl(var(--parchment)/0.18)");
      // active press
      expect(className).toContain("active:translate-y-px");
    };

    const expectOutlineElevation = (className: string) => {
      // 2-layer drop shadow
      expect(className).toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(className).toContain("0_2px_4px_hsl(var(--ink-deep)/0.12)");
      // NO inner highlight on outline
      expect(className).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.18)");
      // active press
      expect(className).toContain("active:translate-y-px");
    };

    it("bark primary CTA gets all 4 treatments (gradient + highlight + 2-layer shadow + press)", () => {
      render(<Button variant="bark">Sign in</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      // Subtle vertical gradient — primary CTAs only
      expect(cls).toContain("linear-gradient(180deg,hsl(var(--bark))_0%,hsl(var(--bark)/0.92)_100%)");
    });

    it("default primary gets gradient + highlight + shadow + press", () => {
      render(<Button>Continue</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      expect(cls).toContain("linear-gradient(180deg,hsl(var(--primary))_0%,hsl(var(--primary)/0.92)_100%)");
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

    it("ghost stays intentionally flat (no shadow, no highlight, no press translate)", () => {
      render(<Button variant="ghost">Skip</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(cls).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.18)");
      expect(cls).not.toContain("active:translate-y-px");
    });

    it("link stays intentionally flat", () => {
      render(<Button variant="link">Learn more</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("0_1px_1px_hsl(var(--ink-deep)/0.10)");
      expect(cls).not.toContain("inset_0_1px_0_hsl(var(--parchment)/0.18)");
      expect(cls).not.toContain("active:translate-y-px");
    });

    it("hero (marketing primary CTA) gets all 4 treatments", () => {
      render(<Button variant="hero">Get started</Button>);
      const cls = screen.getByRole("button").className;
      expectFilledElevation(cls);
      expect(cls).toContain("linear-gradient(180deg,hsl(var(--primary))_0%,hsl(var(--primary)/0.92)_100%)");
    });

    it("hero-outline gets outline-family elevation (shadow + press only)", () => {
      render(<Button variant="hero-outline">Browse</Button>);
      const cls = screen.getByRole("button").className;
      expectOutlineElevation(cls);
      expect(cls).not.toContain("linear-gradient");
    });
  });
});
