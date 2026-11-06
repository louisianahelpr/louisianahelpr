/**
 * Q2709 "nothing hand-made" (Declutter packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * Declutter's native radio circles (free-claim and buy "How you'll get it", meet-up spot, porch place, "What's
 * stopping you?") were hand-made <input type="radio">s with one class set and the olive accent; they are the shared
 * NativeRadio now. Look-identical by construction: the rendered class SET equals the hand-made literal (CSS does not
 * read class order), the inline accent colour is the same, and each caller keeps its own row offset and handlers.
 *
 * @mutate src/components/ui/NativeRadio.tsx | className={`h-4 w-4 min-h-0 min-w-0 shrink-0 ${className}`.trim()} | className={`h-4 w-4 shrink-0 ${className}`.trim()}
 * @mutate src/components/ui/NativeRadio.tsx | style={{ accentColor: "hsl(var(--primary))", ...style }} | style={style}
 * @mutate src/components/ui/NativeRadio.tsx | <input ref={ref} type="radio" | <input ref={ref} type="checkbox"
 * @mutate src/components/declutter/DeclutterMeetup.tsx |             className="mt-1" |             className="mt-0.5"
 * @mutate src/components/declutter/DeliveryCantFinish.tsx |                 <NativeRadio | <input type="radio" className="h-4 w-4 min-h-0 min-w-0 shrink-0"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NativeRadio } from "@/components/ui/NativeRadio";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE = "h-4 w-4 min-h-0 min-w-0 shrink-0";
// file -> the row offset its hand-made radio carried
const FILES: Record<string, string> = {
  "src/components/declutter/DeclutterFreeClaim.tsx": "mt-1",
  "src/components/declutter/DeclutterMeetup.tsx": "mt-1",
  "src/components/declutter/DeclutterPorchPlaces.tsx": "mt-1",
  "src/components/declutter/DeclutterTradeViews.tsx": "mt-1",
  "src/components/declutter/DeliveryCantFinish.tsx": "",
};

describe("Declutter's radios are the shared NativeRadio, class for class the hand-made look", () => {
  it("renders the hand-made class set, type=radio and the olive accent", () => {
    const r = render(<NativeRadio name="x" className="mt-1" readOnly />).container.querySelector("input")!;
    expect(set(r.className)).toEqual(set(`mt-1 ${HAND_MADE}`));
    expect(r.getAttribute("type")).toBe("radio");
    expect(r.style.accentColor).toBe("hsl(var(--primary))");
    const bare = render(<NativeRadio name="y" readOnly />).container.querySelector("input")!;
    expect(bare.className).toBe(HAND_MADE);
  });

  it("every Declutter radio uses it with its own offset; none keeps the hand-made input", () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(4);
    for (const [f, offset] of Object.entries(FILES)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/type="radio"/);
      const at = s.indexOf("<NativeRadio");
      expect(at, f).toBeGreaterThan(-1);
      const tag = s.slice(at, s.indexOf("/>", at));
      if (offset) expect(tag, f).toContain(`className="${offset}"`);
      else expect(tag, f).not.toContain("className=");
    }
  });
});
