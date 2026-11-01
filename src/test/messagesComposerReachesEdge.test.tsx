/**
 * Owner 11-01 (B107, /messages at ~1900px): the composer bar stopped 24px short of the window's right edge (the page
 * gutter beyond the panel). Desktop Messages' PageScaffold drops its right gutter from lg, so the panel and the
 * composer dock reach the edge. Measured: dock right 1895 -> 1919 at 1920, 1415 -> 1439 at 1440, 375 unchanged
 * (~/.lh-shots/b107/msgs-{before,after}/*.txt, MEASURE).
 *
 * @mutate src/pages/messages/MessagesTwoPane.tsx |     <PageScaffold flushRight> |     <PageScaffold>
 * @mutate src/components/ui/PageScaffold.tsx | ${flushRight ? " lg:pr-0 xl:pr-0" : ""} | ${flushRight ? "" : ""}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessagesTwoPane } from "@/pages/messages/MessagesTwoPane";

describe("desktop Messages: the composer reaches the right edge", () => {
  it("the two panes' page has no right gutter from lg, and keeps its phone gutters", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><MessagesTwoPane list={<div />} chat={<div data-testid="chat" />} hasConversations /></MemoryRouter>
      </QueryClientProvider>,
    );
    const box = container.querySelector("[data-scaffold-container]") ?? document.querySelector("[data-scaffold-container]");
    expect(box).not.toBeNull();
    const cls = box!.className.split(/\s+/);
    expect(cls).toContain("lg:pr-0");
    expect(cls).toContain("xl:pr-0");
    expect(cls).toContain("px-5");
  });
});
