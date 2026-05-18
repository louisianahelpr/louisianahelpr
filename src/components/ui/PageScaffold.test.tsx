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
});
