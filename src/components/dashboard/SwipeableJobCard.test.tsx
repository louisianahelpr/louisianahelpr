// @mutate src/components/dashboard/SwipeableJobCard.tsx |       onPointerDownCapture={swipeLayer.start} |       onPointerDownCapture={undefined}
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// The card's content: a node with identity and local state, standing in for JobCard's image and expand state.
vi.mock("./JobCard", async () => {
  const { useState } = await import("react");
  const MockJobCard = () => {
    const [n, setN] = useState(0);
    return <button data-testid="content" onClick={() => setN(n + 1)}>{`taps ${n}`}</button>;
  };
  return { default: MockJobCard };
});

import SwipeableJobCard from "./SwipeableJobCard";
import type { EnrichedJob } from "./types";

const job = { id: "j1" } as unknown as EnrichedJob;
const noop = () => {};

describe("SwipeableJobCard (Q1172)", () => {
  it("shows its content before the swipe layer loads and keeps the SAME DOM node and state when it arrives", async () => {
    const { container, getByTestId } = render(
      <SwipeableJobCard job={job} effectiveFee={0} onApply={noop} onReport={noop} onSelect={noop} onDismiss={noop} />,
    );
    const content = getByTestId("content");
    fireEvent.click(content);
    expect(content.textContent).toBe("taps 1");
    // Plain first frame: no framer drag surface yet.
    expect(container.querySelector('[style*="touch-action"]')).toBeNull();

    // The first touch of a card starts the layer.
    fireEvent.pointerDown(content);
    await waitFor(() => expect(container.querySelector('[style*="touch-action"]')).not.toBeNull());

    // Same node, same local state: nothing remounted (no image fade restart, no lost state).
    expect(getByTestId("content")).toBe(content);
    expect(content.textContent).toBe("taps 1");
    // And it now sits inside the draggable surface.
    expect(content.closest('[style*="touch-action"]')).not.toBeNull();
  });
});
