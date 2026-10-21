// Rust is money only (spec v2 §1.1). Messages painted rust on a pinned chip,
// the pinned-filter chip, the Hide button, the swipe trails, the Mute sheet's
// unmute row, the hidden-unread dot, the composer lock and the smart-reply
// chips (builder1g, 2026-10-21). The only rust left in Messages is a PRICE.
// @mutate src/components/messages/PinnedChip.tsx |         background: "hsl(var(--bark))", |         background: "hsl(var(--burnt-sienna))",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
/** Files allowed rust, each for a money figure only. */
const MONEY = new Set(["src/components/messages/chatView/DealCard.tsx"]);

describe("Messages: rust is money only", () => {
  it("no Messages component paints a rust token outside a price", () => {
    const files = [
      ...trackedFiles("src/components/messages"),
      ...trackedFiles("src/pages/messages"),
      "src/components/QuickReplies.tsx",
    ].filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(20);
    const bad = files.filter(
      (f) => !MONEY.has(f) && /--burnt-sienna|--sienna-ink|--money\b|--rust\b/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))),
    );
    expect(bad).toEqual([]);
  });
});
