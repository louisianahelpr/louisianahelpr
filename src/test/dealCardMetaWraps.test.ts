/**
 * Q955 (375 pass, 2026-11-04, Builder 1): the deal card on top of a chat thread printed its date + parish line on ONE
 * truncated line, so at 375 "Thu, Nov 12 · East Baton Rouge Parish" read "Thu, Nov 12 · East Baton Roug..." (measured on
 * prod as helper-e2e: the line is 176px wide and needs 210px; shot ~/.lh-shots/b1-q955/helper-thread-2.png). Louisiana
 * has long parish names (East Baton Rouge, St. John the Baptist), so the line may take two lines instead.
 * @mutate src/components/messages/chatView/DealCard.tsx | text-muted-foreground line-clamp-2">{meta}</p> | text-muted-foreground truncate">{meta}</p>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../components/messages/chatView/DealCard.tsx"), "utf8"));

describe("the chat deal card's date + parish line wraps instead of cutting the parish (Q955)", () => {
  it("builds the line from the date and the parish", () => {
    // F260q: the parish words come from the dictionary (msg.dc.parish: "{parish} Parish").
    expect(src).toMatch(/job\.parish \? t\("msg\.dc\.parish", \{ parish: job\.parish \}\) : null/);
    expect(src.length).toBeGreaterThan(2000);
  });

  it("the meta line may take two lines and is never a one-line truncate", () => {
    const line = /<p className="([^"]*)">\{meta\}<\/p>/.exec(src);
    expect(line, "meta <p> found").not.toBeNull();
    const cls = line![1].split(/\s+/);
    expect(cls).toContain("line-clamp-2");
    expect(cls).not.toContain("truncate");
  });
});
