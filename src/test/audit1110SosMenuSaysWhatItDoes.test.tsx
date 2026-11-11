/**
 * Audit 11-10 W2 F280: the job page's More-options sheet listed an item that said only "SOS" — a member could not tell
 * whether it calls 911, alerts Helpr, or messages support. In the sheet's list the button now says what the sheet
 * offers ("SOS — call 911 or share where you are"); in the page's side-by-side pair it keeps the short word, and both
 * carry the full name.
 *
 * @mutate src/components/job-card/jobStepMenu.tsx | {pair ? "SOS" : SOS_MENU_LABEL} | SOS
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuAction } from "@/components/job-card/jobStepMenu";
import { SosShareButton } from "@/components/SosShareButton";

describe("F280: the SOS menu item says what it does", () => {
  it("in the sheet's list it names the call and the location share", () => {
    render(<MenuAction chip={<SosShareButton onOpen={vi.fn()} />} className="w-full" />);
    const btn = screen.getByRole("button", { name: /^SOS — call 911/ });
    expect(btn.textContent).toContain("call 911");
    expect(btn.textContent).toContain("share where you are");
  });
  it("in the page's pair it stays the short word, with the full words as its name", () => {
    render(<MenuAction chip={<SosShareButton onOpen={vi.fn()} />} pair />);
    const btn = screen.getByRole("button", { name: /^SOS — call 911/ });
    expect(btn.textContent?.trim()).toBe("SOS");
  });
});
