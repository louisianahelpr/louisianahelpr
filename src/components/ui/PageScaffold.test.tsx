import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageScaffold } from "./PageScaffold";

describe("PageScaffold", () => {
  it("renders the header, title card, and panel children", () => {
    render(
      <PageScaffold header={<div>Page header</div>} titleCard={<h1>Good morning</h1>}>
        <p>Panel body</p>
      </PageScaffold>,
    );
    expect(screen.getByText("Page header")).toBeInTheDocument();
    expect(screen.getByText("Good morning")).toBeInTheDocument();
    expect(screen.getByText("Panel body")).toBeInTheDocument();
  });

  it("renders the optional aboveTitle and beforePanel slots", () => {
    render(
      <PageScaffold
        header={<div>h</div>}
        titleCard={<div>t</div>}
        aboveTitle={<div>Broadcast banner</div>}
        beforePanel={<div>Nudge</div>}
      >
        <div>c</div>
      </PageScaffold>,
    );
    expect(screen.getByText("Broadcast banner")).toBeInTheDocument();
    expect(screen.getByText("Nudge")).toBeInTheDocument();
  });

  it("renders every slot in animate mode too", () => {
    render(
      <PageScaffold header={<div>h</div>} titleCard={<div>Animated title</div>} animate>
        <div>Animated panel</div>
      </PageScaffold>,
    );
    expect(screen.getByText("Animated title")).toBeInTheDocument();
    expect(screen.getByText("Animated panel")).toBeInTheDocument();
  });

  it("omits the title card (and its layout gap) entirely when none is given", () => {
    const { container } = render(
      <PageScaffold header={<div>h</div>}>
        <div>c</div>
      </PageScaffold>,
    );
    // The title card is the only `.page-title-card`-material element; with no
    // titleCard prop there must be no empty card sitting above the panel.
    const panel = container.querySelector("section.page-panel")!;
    expect(panel.previousElementSibling).toBeNull();
  });

  /*
   * THE SHELL CONTRACT. CLAUDE.md: `AppShell` is the ONLY fixed-viewport
   * primitive and a page must never hand-roll the 100dvh lock. PageScaffold
   * is a thin wrapper over it — everything below asserts that it still IS
   * one, because the three slot tests above pass just as happily if the
   * scaffold is re-implemented as a plain <div> tree.
   */
  it("renders THROUGH AppShell rather than re-implementing the viewport lock", () => {
    const { container } = render(
      <PageScaffold header={<div>h</div>} titleCard={<div>t</div>}>
        <div>c</div>
      </PageScaffold>,
    );
    const frame = container.querySelector<HTMLElement>(".app-shell-frame");
    expect(frame, "PageScaffold must render through AppShell").not.toBeNull();
    // The lock itself comes from AppShell's inline style, not from here.
    expect(frame!.style.height).toBe("100dvh");
  });

  it("takes the top safe-area inset ONLY when no header owns it", () => {
    // Two things own the notch gap and exactly one may apply it: a header
    // (via `.glass-header`) or, when there is none, the scaffold. Both, and
    // the gap double-counts; neither, and the content sits under the status
    // bar on every notched iPhone.
    const withHeader = render(
      <PageScaffold header={<div>h</div>} titleCard={<div>t</div>}>
        <div>c</div>
      </PageScaffold>,
    ).container.querySelector<HTMLElement>(".app-shell-frame")!;
    expect(withHeader.className).not.toContain("pt-safe-top");

    const headerless = render(
      <PageScaffold titleCard={<div>t</div>}>
        <div>c</div>
      </PageScaffold>,
    ).container.querySelector<HTMLElement>(".app-shell-frame")!;
    expect(headerless.className).toContain("pt-safe-top");
  });

  it("keeps bg-premium-page and the caller's className on ONE element", () => {
    // Two className props on one JSX element silently drops the first, which
    // is why these are concatenated in the component rather than passed twice.
    const frame = render(
      <PageScaffold titleCard={<div>t</div>} className="ds-mount-fade">
        <div>c</div>
      </PageScaffold>,
    ).container.querySelector<HTMLElement>(".app-shell-frame")!;
    expect(frame.className).toContain("bg-premium-page");
    expect(frame.className).toContain("ds-mount-fade");
    expect(frame.className).toContain("pt-safe-top");
  });

  it("wraps children in the liquid-glass panel that bleeds under the dock", () => {
    // `page-panel` is the stylesheet HOOK that lets desktop restore the
    // bottom radius over the inline style; `liquid-glass` is the material.
    // jsdom resolves no Tailwind, so these are class STRINGS — but they are
    // the exact two tokens the desktop `!important` rule hangs on.
    const { container } = render(
      <PageScaffold header={<div>h</div>} titleCard={<div>t</div>}>
        <p>Panel body</p>
      </PageScaffold>,
    );
    const panel = container.querySelector<HTMLElement>("section.page-panel")!;
    expect(panel, "the panel must be a <section>.page-panel").not.toBeNull();
    expect(panel.className).toContain("liquid-glass");
    expect(panel).toContainElement(screen.getByText("Panel body"));
    // Bottom radii zeroed inline so the panel bleeds under the floating dock.
    expect(panel.style.borderBottomLeftRadius).toBe("0px");
    expect(panel.style.borderBottomRightRadius).toBe("0px");
  });
});

// With no header there is nothing else to own the notch gap; drop this and
// headerless pages (My Jobs, My Posts, Messages) sit under the status bar.
// @mutate src/components/ui/PageScaffold.tsx | (header ? "" : " pt-safe-top") + | "" +
// The panel's material and its stylesheet hook: without `liquid-glass` the
// content surface stops popping off the page gradient.
// @mutate src/components/ui/PageScaffold.tsx | "page-panel liquid-glass overflow-hidden flex-1 min-h-0 flex flex-col" | "page-panel overflow-hidden flex-1 min-h-0 flex flex-col"
