/**
 * F441 (audit 11-10, Messages thread header): the grey dot beside the other person's name was "unexplained". It is the
 * offline mark (online draws nothing), and it is named Offline both for hover (`title`) and for screen readers / touch
 * (role img + aria-label); online renders no dot at all.
 * @mutate src/components/ChatPresence.tsx |       role="img" |
 * @mutate src/components/ChatPresence.tsx |       aria-label="Offline" |
 * @mutate src/components/ChatPresence.tsx |   if (isOnline) return null; |   if (false) return null;
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OnlineIndicator } from "@/components/ChatPresence";

afterEach(cleanup);

describe("F441: the presence dot is named Offline", () => {
  it("offline: one dot with the accessible name Offline and the hover title", () => {
    render(<OnlineIndicator isOnline={false} />);
    const dot = screen.getByRole("img", { name: "Offline" });
    expect(dot.getAttribute("title")).toBe("Offline");
  });
  it("online: no dot", () => {
    const { container } = render(<OnlineIndicator isOnline />);
    expect(container.innerHTML).toBe("");
  });
});
