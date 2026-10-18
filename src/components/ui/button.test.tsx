import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";

/**
 * These tests document the per-variant FLAT contract (owner, 2026-10-17:
 * design C "Warm Modern", flat buttons, the gloss rule retired). Every filled
 * and outline variant carries exactly two treatments:
 *
 *   1. no elevation      — `shadow-none` (no drop shadow, no inner highlight)
 *   2. active-press scale — `active:scale-[0.97]`
 *
 * and no variant carries a gradient. The primary fill itself is the
 * hand-written `.btn-grad-primary` rule in src/index.css (flat brand green);
 * that the RULE is flat is checked by reading the stylesheet
 * (src/test/glossyPrimaryInvariant.test.ts), and that a real element computes
 * it only in a browser (e2e/happy-path/apply-single-sheet.spec.ts).
 *
 * WHAT THIS FILE CANNOT SEE: jsdom loads no stylesheet and computes no style,
 * so every assertion below is a CLASS-NAME PROXY, never a rendered-pixel fact.
 * CLAUDE.md's rule — verify CSS against `dist/assets/*.css` after a build,
 * never the dev server — applies.
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

  describe("flat contract", () => {
    const expectFlat = (className: string) => {
      expect(className).toContain("shadow-none");
      expect(className).toContain("active:scale-[0.97]");
      // the retired depth treatments (inner highlight + 3-layer shadow)
      expect(className).not.toContain("inset_0_1px_0");
      expect(className).not.toContain("0_2px_6px");
      expect(className).not.toContain("linear-gradient");
    };

    it("primary CTA is flat and wears btn-grad-primary (the flat brand fill)", () => {
      render(<Button variant="primary">Sign In</Button>);
      const cls = screen.getByRole("button").className;
      expectFlat(cls);
      expect(cls).toContain("btn-grad-primary");
    });

    it("default primary is flat and wears btn-grad-primary", () => {
      render(<Button>Continue</Button>);
      const cls = screen.getByRole("button").className;
      expectFlat(cls);
      expect(cls).toContain("btn-grad-primary");
    });

    it("destructive is flat", () => {
      render(<Button variant="destructive">Delete</Button>);
      expectFlat(screen.getByRole("button").className);
    });

    it("secondary is flat", () => {
      render(<Button variant="secondary">Cancel</Button>);
      expectFlat(screen.getByRole("button").className);
    });

    it("outline is flat", () => {
      render(<Button variant="outline">Back</Button>);
      expectFlat(screen.getByRole("button").className);
    });

    it("ghost has no shadow and no press scale", () => {
      render(<Button variant="ghost">Skip</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("inset_0_1px_0");
      expect(cls).not.toContain("active:scale-[0.97]");
    });

    it("link has no shadow and no press scale", () => {
      render(<Button variant="link">Learn More</Button>);
      const cls = screen.getByRole("button").className;
      expect(cls).not.toContain("inset_0_1px_0");
      expect(cls).not.toContain("active:scale-[0.97]");
    });

    it("primary + shimmer (marketing CTA) is flat", () => {
      render(<Button variant="primary" shimmer>Get Started</Button>);
      const cls = screen.getByRole("button").className;
      expectFlat(cls);
      expect(cls).toContain("btn-grad-primary");
    });
  });
});

// The flat contract, which every filled and outline variant shares. Putting
// the retired inner highlight back on ELEV_FILLED fails five tests in one edit.
// (Class names only — see the header on what this cannot see.)
// @mutate src/components/ui/button.tsx | const ELEV_FILLED = "shadow-none active:scale-[0.97]"; | const ELEV_FILLED = "shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22)] active:scale-[0.97]";
