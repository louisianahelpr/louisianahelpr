/**
 * Lead 11-01 (B107): the poster's Working row on the job page was [SOS | Message Yusef] with SOS drawn as the card's
 * red-tinted chip at full size, reading as a big red main button. On the page SOS is the row's ordinary outlined
 * button with a red shield icon; Message stays the main (green, right) action.
 *
 * @mutate src/components/job-card/jobStepMenu.tsx | if (isValidElement(chip) && chip.type === SosShareButton) { | if (isValidElement(chip) && chip.type === SosShareButton && false) {
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuAction } from "@/components/job-card/jobStepMenu";
import { SosShareButton } from "@/components/SosShareButton";

describe("the job page's SOS is a secondary button", () => {
  it("draws the card's SOS chip as an outlined button with a red icon, no red fill or tint", () => {
    const onOpen = vi.fn();
    render(<MenuAction chip={<SosShareButton onOpen={onOpen} />} className="w-full" />);
    const btn = screen.getByRole("button", { name: /SOS/ });
    expect(btn.hasAttribute("data-sos-secondary")).toBe(true);
    // The chip's tint (inline background / border) is gone: the outline variant draws it like its neighbours.
    expect(btn.getAttribute("style") ?? "").not.toMatch(/background|border/);
    expect(btn.className).not.toMatch(/\bbg-destructive\b|btn-grad-primary/);
    expect(btn.className).not.toMatch(/text-destructive/);
    const icon = btn.querySelector("svg");
    expect(icon?.getAttribute("class") ?? "").toMatch(/text-destructive-ink/);
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
