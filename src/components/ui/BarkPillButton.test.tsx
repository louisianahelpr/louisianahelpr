import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BarkPillButton } from "./BarkPillButton";

describe("BarkPillButton", () => {
  it("renders its children inside a button", () => {
    render(<BarkPillButton>Browse jobs</BarkPillButton>);
    expect(screen.getByRole("button", { name: "Browse jobs" })).toBeInTheDocument();
  });

  it("forwards onClick", () => {
    const onClick = vi.fn();
    render(<BarkPillButton onClick={onClick}>Go</BarkPillButton>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the pill base class and merges a caller-supplied className", () => {
    render(<BarkPillButton className="mt-4">Go</BarkPillButton>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toHaveClass("rounded-ds-md", "mt-4");
  });

  /*
   * The two things this wrapper exists FOR, neither of which the tests above
   * could see. Both are class-name assertions and jsdom resolves no Tailwind
   * and computes no layout, so what is proven here is the STRING the merge
   * produced — not a rendered gradient and not a wrapped line. The gradient
   * itself is asserted as a computed `background-image` in the Playwright
   * gloss checks (CLAUDE.md, "Gloss tests"); this is the unit-level half:
   * that the delegation and the override are still in the output at all.
   */
  it("delegates to the primary Button variant, so it wears the bark gloss", () => {
    // `variant="primary"` is the whole reason this component is a wrapper
    // rather than a div. Drop it and the CTA silently renders as a plain
    // (or outline) button everywhere: empty states, ErrorState retry, the
    // Browse-jobs / Post-a-job pills.
    render(<BarkPillButton>Go</BarkPillButton>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("btn-grad-primary");
  });

  it("overrides the Button base's whitespace-nowrap so a long label wraps at 320w", () => {
    // The Button base class is `whitespace-nowrap`. Without this override a
    // long CTA ("Get notified of new jobs") forces the pill wider than its
    // empty-state card and the whole page overflows horizontally at 320w.
    // Asserting BOTH directions proves tailwind-merge actually dropped the
    // base — a present `whitespace-normal` next to a surviving
    // `whitespace-nowrap` would lose in the cascade and look identical here.
    const btn = render(<BarkPillButton>Get notified of new jobs</BarkPillButton>).container
      .querySelector("button")!;
    expect(btn).toHaveClass("whitespace-normal", "h-auto", "min-h-12", "max-w-full");
    expect(btn).not.toHaveClass("whitespace-nowrap");
  });

  it("forwards the disabled prop and blocks clicks while disabled", () => {
    const onClick = vi.fn();
    render(
      <BarkPillButton disabled onClick={onClick}>
        Go
      </BarkPillButton>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

// The bark gloss is the component's reason to exist; without the primary
// variant every empty-state CTA renders as a flat outline button.
// @mutate src/components/ui/BarkPillButton.tsx | variant="primary"\n      {...props} | variant="outline"\n      {...props}
// The 320w wrap override: drop it and the Button base's `whitespace-nowrap`
// wins, pushing the pill wider than its card and overflowing the page.
// @mutate src/components/ui/BarkPillButton.tsx | max-w-full whitespace-normal text-center | max-w-full text-center
