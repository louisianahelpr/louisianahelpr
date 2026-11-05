/**
 * Q1816 (axe 4.14 label-content-name-mismatch, WCAG 2.5.3, lead 11-04): the two messages-thread controls the
 * #4120 happy-path smoke flagged are named by content, not aria-label, so the drawn text never contradicts a
 * given name: the read receipt (drawn "MT" / "Read 12:00 PM") and the thread header's profile button (drawn
 * avatar, name, presence and subtitle).
 *
 * @mutate src/components/ChatPresence.tsx | ? `Read by ${recipientName}${readAtLabel ? ` at ${readAtLabel}` : ""}` | ? recipientName
 * @mutate src/components/ChatPresence.tsx | <span aria-hidden="true" className="text-ds-9 font-sans" | <span className="text-ds-9 font-sans"
 * @mutate src/components/messages/ChatHeader.tsx |         aria-describedby={subtitleId} |         aria-label={`View ${activeConvo.otherUserName}'s profile`} aria-describedby={subtitleId}
 * @mutate src/components/messages/ChatHeader.tsx |         <span aria-hidden="true" className="min-w-0 flex-1 flex flex-col"> |         <span className="min-w-0 flex-1 flex flex-col">
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadReceipt } from "@/components/ChatPresence";
import { blankComments } from "./helpers/blankNonCode";

const contentName = (el: HTMLElement) => {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (c.textContent ?? "").replace(/\s+/g, " ").trim();
};

describe("messages-thread controls are named by content (Q1816)", () => {
  it("the read receipt: no aria-label, named 'Read by <name> at <time>', drawn initials and time hidden", () => {
    render(<ReadReceipt read readAt="2026-08-13T17:00:00Z" sentByMe recipientName="Marcus T." />);
    const b = screen.getByRole("button", { name: /^Read by Marcus T\. at / });
    expect(b.hasAttribute("aria-label")).toBe(false);
    fireEvent.click(b);
    expect(b.textContent).toMatch(/Read \d/);
    expect(contentName(b)).toMatch(/^Read by Marcus T\. at \d{1,2}:\d{2}\s?[AP]M$/);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("the thread header's profile button: no aria-label; the sr-only line is the name, the drawn block hidden", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "components/messages/ChatHeader.tsx"), "utf8"));
    const at = src.indexOf("onClick={noProfile ? undefined : onViewProfile}");
    expect(at).toBeGreaterThan(0);
    const button = src.slice(src.lastIndexOf("<button", at), src.indexOf("</button>", at));
    const openTag = button.slice(0, button.indexOf("\n      >"));
    expect(openTag.length).toBeGreaterThan(50);
    expect(openTag).not.toMatch(/\saria-label=/);
    expect(button).toContain('<span className="sr-only">{noProfile ? activeConvo.otherUserName : `View ${activeConvo.otherUserName}\'s profile`}</span>');
    expect(button).toContain('<span aria-hidden="true" className="min-w-0 flex-1 flex flex-col">');
  });
});
