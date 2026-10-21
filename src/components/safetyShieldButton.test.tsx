/**
 * Board 156: the shield entry shows only while SOS is offered, and opens the
 * one "Are you safe?" sheet with the emergency number first.
 *
 * @mutate src/components/SosShareButton.tsx |   if (!sosOffered(job)) return null; |   if (false) return null;
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SafetyShieldButton } from "@/components/SosShareButton";

const live = { id: "j1", helper_arrived_at: "2026-10-20T15:00:00Z", helper_completed_at: null, poster_completed_at: null };

describe("SafetyShieldButton (board 156)", () => {
  it("renders nothing before the Helpr arrives or once the job is done", () => {
    const { container, rerender } = render(<MemoryRouter><SafetyShieldButton job={{ ...live, helper_arrived_at: null }} /></MemoryRouter>);
    expect(container.querySelector("[data-sos-shield]")).toBeNull();
    rerender(<MemoryRouter><SafetyShieldButton job={{ ...live, helper_completed_at: "2026-10-20T16:00:00Z" }} /></MemoryRouter>);
    expect(container.querySelector("[data-sos-shield]")).toBeNull();
  });

  it("opens Are you safe? with Call 911 as a real tel: link", async () => {
    render(<MemoryRouter><SafetyShieldButton job={live} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /SOS/ }));
    expect(await screen.findByText("Are you safe?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call 911" }).getAttribute("href")).toBe("tel:911");
    expect(screen.getByText("Talk to Helpr")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I'm safe now" })).toBeTruthy();
  });
});
