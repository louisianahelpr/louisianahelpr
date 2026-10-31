/**
 * AUD31-19: the bell clamped every message to two lines and a tap on the row navigated, so the end of a long notice
 * ("Miss again and the sale is cancelled with a strike") was never shown. "More" opens the whole text in place,
 * without the row's navigation; a short message has no toggle.
 *
 * @mutate src/components/notificationPanel/NotificationMessage.tsx |       {long && ( |       {false && (
 * @mutate src/components/notificationPanel/NotificationMessage.tsx |             e.stopPropagation();\n            setOpen | setOpen
 * @mutate src/components/NotificationPanel.tsx |                             <NotificationMessage text={n.message} /> |                             <p className="line-clamp-2">{n.message}</p>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NotificationMessage } from "@/components/notificationPanel/NotificationMessage";
import { blankComments } from "@/test/helpers/blankNonCode";

const MISSED =
  "Lamp: You missed your pickup at 3:00 PM. The seller can pick a new time with you. Miss again and the sale is cancelled with a strike.";

describe("a bell row shows its whole message on More (AUD31-19)", () => {
  it("a long message starts clamped; More opens it in place and the row's tap never fires", () => {
    const rowTap = vi.fn();
    render(<div role="button" onClick={rowTap}><NotificationMessage text={MISSED} /></div>);
    const p = document.querySelector("[data-notif-message]")!;
    expect(p.className).toMatch(/\bline-clamp-2\b/);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(p.className).not.toMatch(/line-clamp/);
    expect(p.textContent).toContain("Miss again and the sale is cancelled with a strike.");
    expect(screen.getByRole("button", { name: "Less" }).getAttribute("aria-expanded")).toBe("true");
    expect(rowTap).not.toHaveBeenCalled();
  });

  it("a short message has no toggle", () => {
    render(<NotificationMessage text="Pickup booked for Sat 10:00 AM." />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the bell's rows draw their message through it (no clamped paragraph of their own)", () => {
    const src = blankComments(readFileSync(path.resolve(__dirname, "../components/NotificationPanel.tsx"), "utf8"));
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain("<NotificationMessage text={n.message} />");
    expect(src).not.toMatch(/>\s*\{n\.message\}\s*</);
  });
});
