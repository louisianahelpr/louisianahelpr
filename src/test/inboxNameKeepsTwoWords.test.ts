/**
 * AUD31-40 (audit 10-31, Messages at 375 and the 1440 inbox pane): a row's name shared line 1 with its status chip
 * and was cut to "Former memb…" / "Former mem…" with an 88px basis. The name's basis must hold "Former member"
 * (13 characters) at ds-15: at least 7rem, so the chip wraps under the name instead of eating it.
 *
 * @mutate src/components/messages/ConversationRow.tsx | basis-[7.5rem] grow text-ds-15 | basis-[5.5rem] grow text-ds-15
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";

describe("AUD31-40: an inbox row's name keeps a two-word label whole", () => {
  it("row-name's flex basis holds 'Former member' at ds-15 (>= 7rem)", () => {
    const src = blankComments(readFileSync("src/components/messages/ConversationRow.tsx", "utf8"));
    const at = src.indexOf('data-testid="row-name"');
    expect(at).toBeGreaterThan(-1);
    const cls = /className="([^"]*)"/.exec(src.slice(at))?.[1] ?? "";
    const rem = Number(/\bbasis-\[(\d+(?:\.\d+)?)rem\]/.exec(cls)?.[1] ?? 0);
    expect(FORMER_MEMBER_LABEL.length).toBeGreaterThan(10);
    // ~8.5px a character at ds-15 (15px Satoshi): 13 characters need ~110px.
    expect(rem * 16).toBeGreaterThanOrEqual(112);
    expect(cls).toMatch(/\bgrow\b/);
  });
});
