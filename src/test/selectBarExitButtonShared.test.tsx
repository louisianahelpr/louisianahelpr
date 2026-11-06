/**
 * Q2709 "nothing hand-made" (Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical). The ✕ that leaves
 * select mode on the dark select bar, in Posts (BulkDismissBar, "Cancel selection") and in the Messages list
 * (ConversationListBody), were two hand-made <button>s with one class set, one inline colour and one glyph; they are
 * the shared SelectBarExitButton now. Look-identical by construction: the rendered class SET equals the hand-made
 * literal, the inline colour and the 16px X are the same, type stays "button", each caller keeps its handler and label.
 *
 * @mutate src/components/ui/SelectBarExitButton.tsx | "h-9 w-9 ctl-exit bg-[hsl(var(--parchment)/0.06)] ctl-tint-invert | "h-9 w-9 ctl-exit bg-[hsl(var(--parchment)/0.08)] ctl-tint-invert
 * @mutate src/components/ui/SelectBarExitButton.tsx |       style={{ color: "hsl(var(--parchment) / 0.85)", ...style }} |       style={{ color: "hsl(var(--parchment) / 0.7)", ...style }}
 * @mutate src/components/ui/SelectBarExitButton.tsx |       <X className="w-4 h-4" /> |       <X className="w-5 h-5" />
 * @mutate src/pages/posts/BulkDismissBar.tsx |             onClick={() => { hapticLight(); onCancel(); }}\n            aria-label="Cancel selection" |             onClick={onCancel}\n            aria-label="Cancel selection"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { SelectBarExitButton } from "@/components/ui/SelectBarExitButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE =
  "h-9 w-9 ctl-exit bg-[hsl(var(--parchment)/0.06)] ctl-tint-invert inline-flex items-center justify-center btn-press transition";
const FILES = ["src/pages/posts/BulkDismissBar.tsx", "src/components/messages/ConversationListBody.tsx"];

describe("the select bar's ✕ is the shared SelectBarExitButton, class for class the hand-made look", () => {
  it("renders the hand-made class set, colour and 16px X, as type=button", () => {
    const b = render(<SelectBarExitButton aria-label="Cancel selection" />).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(HAND_MADE));
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("style")).toContain("color: hsl(var(--parchment) / 0.85)");
    const svg = b.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("w-4 h-4");
    expect(svg.getAttribute("class")).toContain("lucide-x");
  });

  it("both select bars use it with their own handler and label; neither keeps the hand-made ✕", () => {
    expect(FILES.length).toBeGreaterThan(1);
    for (const f of FILES) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toContain(HAND_MADE);
      expect(s, f).toContain("<SelectBarExitButton\n");
    }
    const posts = readFileSync(FILES[0], "utf8");
    expect(posts).toContain('onClick={() => { hapticLight(); onCancel(); }}\n            aria-label="Cancel selection"');
    const messages = readFileSync(FILES[1], "utf8");
    expect(messages).toContain('onClick={exitSelectMode}\n                    aria-label={t("chat.cancelSelection")}');
  });
});
