/**
 * Q2709 "nothing hand-made" (Messages packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * ChatPresence's two tap-to-reveal read receipts ("✓ Delivered" and the reader's avatar + "Read <time>") were
 * hand-made <button aria-pressed>s with one class set; they are the shared ReceiptToggleButton now. Look-identical by
 * construction: the rendered class SET equals the hand-made literal, type stays "button", aria-pressed follows
 * `pressed`, and each receipt keeps its own label, title and contents.
 *
 * @mutate src/components/ui/ReceiptToggleButton.tsx | relative inline-flex items-center gap-1 ml-1 -my-[14px] | relative inline-flex items-center gap-1 ml-1
 * @mutate src/components/ui/ReceiptToggleButton.tsx | <button ref={ref} type="button" aria-pressed={pressed} | <button ref={ref} type="button"
 * @mutate src/components/ChatPresence.tsx |         aria-label="Delivered"\n        pressed={revealed} |         aria-label="Delivered"\n        pressed={false}
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ReceiptToggleButton } from "@/components/ui/ReceiptToggleButton";
import { ReadReceipt } from "@/components/ChatPresence";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
// The hand-made literal, verbatim from ChatPresence.tsx at main 793859cd9c (both receipts).
const HAND_MADE = "relative inline-flex items-center gap-1 ml-1 -my-[14px]";

describe("the chat read receipts are the shared ReceiptToggleButton, class for class the hand-made look", () => {
  it("renders the hand-made class set as type=button with aria-pressed from `pressed`", () => {
    const b = render(<ReceiptToggleButton pressed={false} aria-label="Delivered">x</ReceiptToggleButton>).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(HAND_MADE));
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("ChatPresence uses it for both receipts and the Delivered one still toggles; no hand-made receipt is left", () => {
    const s = readFileSync("src/components/ChatPresence.tsx", "utf8");
    expect(s).not.toContain("-my-[14px]\"");
    expect(s.split("<ReceiptToggleButton").length - 1).toBeGreaterThan(1);
    render(<ReadReceipt sentByMe read={false} />);
    const d = screen.getByRole("button", { name: "Delivered" });
    expect(set(d.className)).toEqual(set(HAND_MADE));
    expect(d.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(d);
    expect(d.getAttribute("aria-pressed")).toBe("true");
  });
});
