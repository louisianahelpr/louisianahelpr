// @mutate src/components/messages/SwipeableConversationRow.tsx |     <div className="relative overflow-hidden" onPointerDownCapture={swipeLayer.start}> |     <div className="relative overflow-hidden">
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { SwipeableConversationRow } from "./SwipeableConversationRow";

/** The row's content: a node with identity and local state, standing in for ConversationRow. */
function Content() {
  const [n, setN] = useState(0);
  return <button data-testid="content" onClick={() => setN(n + 1)}>{`taps ${n}`}</button>;
}

describe("SwipeableConversationRow (Q1299)", () => {
  it("shows its row before the swipe layer loads and keeps the SAME DOM node and state when it arrives", async () => {
    const { container, getByTestId } = render(
      <SwipeableConversationRow isPinned={false} onArchive={() => {}} onTogglePin={() => {}}>
        <Content />
      </SwipeableConversationRow>,
    );
    const content = getByTestId("content");
    fireEvent.click(content);
    expect(content.textContent).toBe("taps 1");
    // Plain first frame: no framer drag surface yet.
    expect(container.querySelector('[style*="touch-action"]')).toBeNull();

    // The first touch of a row starts the layer.
    fireEvent.pointerDown(content);
    await waitFor(() => expect(container.querySelector('[style*="touch-action"]')).not.toBeNull());

    // Same node, same local state: nothing remounted.
    expect(getByTestId("content")).toBe(content);
    expect(content.textContent).toBe("taps 1");
    expect(content.closest('[style*="touch-action"]')).not.toBeNull();
  });
});
