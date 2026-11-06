/**
 * Q2709 "nothing hand-made" (Messages packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The voice-note controls (recorder Discard / Stop / Send in RichMessageInput, player Play / Pause in
 * MessageAttachment) were hand-made <button>s; they are the shared RoundIconButton now. Look-identical by
 * construction: the rendered class SET equals the hand-made literal (CSS does not read class order), the inline
 * fill/ink style passes through untouched, and type stays "button".
 *
 * @mutate src/components/ui/RoundIconButton.tsx | const ROUND_ICON = "shrink-0 rounded-full flex items-center justify-center transition-all active:scale-90"; | const ROUND_ICON = "shrink-0 rounded-full flex items-center justify-center transition-all";
 * @mutate src/components/ui/RoundIconButton.tsx | const SIZES = { md: "w-11 h-11", sm: "w-9 h-9" } as const; | const SIZES = { md: "w-11 h-11", sm: "w-11 h-11" } as const;
 * @mutate src/components/ui/RoundIconButton.tsx |   <button ref={ref} type="button" {...props} | <button ref={ref} {...props}
 * @mutate src/components/MessageAttachment.tsx |       <RoundIconButton\n        size="sm" |       <RoundIconButton
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { RoundIconButton } from "@/components/ui/RoundIconButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE = (wh: string) => `shrink-0 ${wh} rounded-full flex items-center justify-center transition-all active:scale-90`;

describe("the voice-note controls are the shared RoundIconButton, class for class the hand-made look", () => {
  it("md (recorder, 44px) and sm (player, 36px): the hand-made class sets; type=button; style passes through", () => {
    const md = render(<RoundIconButton aria-label="Discard" style={{ background: "red", color: "white" }}>x</RoundIconButton>).container.querySelector("button")!;
    const sm = render(<RoundIconButton size="sm" aria-label="Play">x</RoundIconButton>).container.querySelector("button")!;
    expect(set(md.className)).toEqual(set(HAND_MADE("w-11 h-11")));
    expect(set(sm.className)).toEqual(set(HAND_MADE("w-9 h-9")));
    expect(md.getAttribute("type")).toBe("button");
    expect(md.style.background).toBe("red");
    expect(md.style.color).toBe("white");
  });

  it("the callers keep no hand-made voice-note button and use the right size", () => {
    const rich = readFileSync("src/components/RichMessageInput.tsx", "utf8");
    const att = readFileSync("src/components/MessageAttachment.tsx", "utf8");
    for (const s of [rich, att]) expect(s).not.toMatch(/<button[^>]*?rounded-full flex items-center justify-center transition-all active:scale-90/);
    expect(rich.match(/<RoundIconButton\n/g)?.length).toBe(3);
    expect(rich).not.toMatch(/<RoundIconButton\n\s+size=/);
    expect(att).toMatch(/<RoundIconButton\n\s+size="sm"\n\s+aria-label=\{playing \? "Pause voice note" : "Play voice note"\}/);
  });
});
