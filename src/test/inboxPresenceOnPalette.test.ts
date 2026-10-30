/**
 * Audit #53 (2026-10-21; lead: "Active now" is real, the bright green is not):
 * the presence dot and its label wear the spec's olive, the status chip is
 * sentence case at a readable size, and the composer placeholder fits at 375.
 *
 * @mutate src/components/messages/ConversationRow.tsx | olive presence dot.\n                        background: "hsl(var(--bark))", | olive presence dot.\n                        background: "hsl(var(--live))",
 * @mutate src/components/messages/ConversationRow.tsx | className="text-ds-11 font-sans font-semibold px-1.5 py-0.5 rounded-full shrink-0" | className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
 * @mutate src/components/RichMessageInput.tsx |               : t("chat.placeholder") |               : "Type a message…"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("inbox presence and chips are on palette", () => {
  it("no bright green presence in the inbox row or the profile header", () => {
    for (const f of ["src/components/messages/ConversationRow.tsx", "src/pages/user/ProfileHeaderCard.tsx"]) {
      expect(read(f), f).not.toMatch(/--live\b|--live-ink/);
    }
  });
  it("the status chip is not tiny uppercase", () => {
    const row = read("src/components/messages/ConversationRow.tsx");
    const i = row.indexOf('data-testid="row-status-chip"');
    expect(row.slice(i, i + 300)).not.toMatch(/uppercase|text-ds-9/);
  });
  it("the composer placeholder is short", () => {
    expect(read("src/components/RichMessageInput.tsx")).toMatch(/: t\("chat\.placeholder"\)/);
  });
});
