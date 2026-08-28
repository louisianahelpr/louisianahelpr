import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DirectionsButton } from "./DirectionsButton";

/**
 * Two things about this button are load-bearing and easy to break silently:
 *
 *  1. It must never render with nothing to navigate to. A "Directions" button
 *     that opens an empty maps search is worse than no button.
 *  2. Its click must NOT reach the card shell, which owns expand/collapse.
 *     Every other control in these sections is inside a wrapper that stops
 *     propagation; this one carries its own guard so it stays correct if it is
 *     ever moved.
 */
describe("DirectionsButton", () => {
  it("renders nothing without an address", () => {
    const { container } = render(<DirectionsButton location="" />);
    expect(container.firstChild).toBeNull();
    const nullish = render(<DirectionsButton location={null} />);
    expect(nullish.container.firstChild).toBeNull();
  });

  it("links through mapsSearchUrl — the address, never coordinates", () => {
    render(<DirectionsButton location="123 Main St, Lafayette, LA 70503" />);
    const link = screen.getByRole("link", { name: /get directions/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent("123 Main St, Lafayette, LA 70503"));
    // No lat/lng ever leaves in the query string.
    expect(href).not.toMatch(/\d+\.\d{3,},-?\d+\.\d{3,}/);
  });

  it("stops the click from toggling the card shell", () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <DirectionsButton location="123 Main St, Lafayette, LA 70503" />
      </div>,
    );
    const link = screen.getByRole("link", { name: /get directions/i });
    // Prevent jsdom "navigation not implemented" noise; the assertion is about
    // propagation, which runs regardless.
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
