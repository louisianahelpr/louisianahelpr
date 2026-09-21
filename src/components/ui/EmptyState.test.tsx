import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the eyebrow, title, and body copy", () => {
    render(
      <EmptyState
        icon={Inbox}
        eyebrow="No messages"
        title="Inbox zero"
        body="You're all caught up."
      />,
    );
    expect(screen.getByText("No messages")).toBeInTheDocument();
    expect(screen.getByText("Inbox zero")).toBeInTheDocument();
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it("renders the supplied icon", () => {
    const { container } = render(
      <EmptyState icon={Inbox} eyebrow="e" title="t" body="b" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the optional action node when provided", () => {
    render(
      <EmptyState
        icon={Inbox}
        eyebrow="e"
        title="t"
        body="b"
        action={<button>Browse jobs</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Browse jobs" })).toBeInTheDocument();
  });

  it("renders no action element when none is supplied", () => {
    render(<EmptyState icon={Inbox} eyebrow="e" title="t" body="b" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the footnote node inside the card", () => {
    render(
      <EmptyState
        icon={Inbox}
        eyebrow="e"
        title="t"
        body="b"
        footnote={<span>Syncs every 6 hours</span>}
      />,
    );
    expect(screen.getByText("Syncs every 6 hours")).toBeInTheDocument();
  });

  it("renders the illustration INSTEAD of the icon bubble when one is given", () => {
    const { container } = render(
      <EmptyState
        icon={Inbox}
        illustration={<svg data-testid="line-art" />}
        eyebrow="e"
        title="t"
        body="b"
      />,
    );
    expect(screen.getByTestId("line-art")).toBeInTheDocument();
    // The frosted bubble must not render alongside it — two glyphs stacked is
    // the defect this branch exists to avoid.
    expect(container.querySelector(".rounded-full")).toBeNull();
  });

  /*
   * THE BOX-IN-A-BOX RULE — the thing this component was rewritten for.
   *
   * The owner rejected an inner bordered box on the empty states three times
   * (2026-08-31, 2026-09-07 "just delete the inner box, only one is needed",
   * and again at 1440 on 2026-09-11). The fix was that the `dock` variant —
   * the DEFAULT, used by Messages, My Posts / My Jobs and Browse — paints
   * NOTHING: it sits inside PageScaffold's panel, which already is the card.
   *
   * jsdom resolves no Tailwind, so this asserts the class STRING, not a
   * painted surface: what is proven is that `liquid-glass` is not applied to
   * the dock root and IS applied to the inline root. That is exactly the
   * single token whose presence drew the second box, so the string is the
   * right thing to pin here; the rendered result is checked at 375 by the
   * state-matrix screenshots.
   */
  const rootOf = (variant?: "dock" | "inline" | "bare") =>
    render(
      <EmptyState icon={Inbox} eyebrow="e" title="t" body="b" variant={variant} />,
    ).container.firstElementChild as HTMLElement;

  it("dock (the default) paints no surface of its own — no second box", () => {
    for (const root of [rootOf(), rootOf("dock")]) {
      expect(root.className).toContain("empty-state-dock");
      expect(root.className, "dock must not paint a card inside the panel").not.toContain(
        "liquid-glass",
      );
      expect(root.className, "dock must not round its own top corners").not.toContain(
        "rounded-2xl",
      );
      // Bottom radii + border zeroed inline so the card bleeds under the dock.
      expect(root.style.borderBottomLeftRadius).toBe("0px");
      // jsdom expands the `borderBottom: "none"` shorthand, so read the
      // longhand — `.borderBottom` comes back as the "medium" width default.
      expect(root.style.borderBottomStyle).toBe("none");
    }
  });

  it("inline IS the card — glass surface, rounded on all four corners", () => {
    const root = rootOf("inline");
    expect(root.className).toContain("liquid-glass");
    expect(root.className).toContain("rounded-2xl");
    expect(root.className).not.toContain("empty-state-dock");
    expect(root.style.borderBottomLeftRadius).toBe("");
  });

  it("bare is layout only — no fill, no border, no radius", () => {
    const root = rootOf("bare");
    expect(root.className).not.toContain("liquid-glass");
    expect(root.className).not.toContain("empty-state-dock");
    expect(root.className).not.toContain("rounded-2xl");
  });
});

// The box-in-a-box the owner rejected three times: the dock variant painting
// its own glass card inside PageScaffold's panel.
// @mutate src/components/ui/EmptyState.tsx | ? "empty-state-dock flex-1 min-w-0 | ? "empty-state-dock liquid-glass flex-1 min-w-0
// The illustration/icon branch: the line art must REPLACE the frosted bubble,
// never sit beside it (and the bubble must still render when there is none).
// @mutate src/components/ui/EmptyState.tsx | {illustration ? ( | {!illustration ? (
