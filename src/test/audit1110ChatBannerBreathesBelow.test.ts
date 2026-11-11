/**
 * Audit 11-10 W5 F479: the grey "Keep chats & payments on Helpr" banner touched the "Today" divider under it with no
 * gap once the thread was scrolled to the latest message (shot chat-photo-bottom-P-375-light). The banner now carries
 * 8px below it (`mb-2`). The leading classes stay as the earlier guards pin them (chatThreadNoDeadBandAboveMessages,
 * ChatView.layout): this test reads only the trailing margin.
 *
 * @mutate src/components/messages/ChatView.tsx | gap-1.5 pr-11 mb-2"> | gap-1.5 pr-11">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = blankComments(readFileSync(join(__dirname, "..", "components", "messages", "ChatView.tsx"), "utf8"));

describe("F479: the safety banner has 8px below it", () => {
  const banner = /<div data-off-platform-note className="([^"]*)"/.exec(code);
  it("finds the banner", () => {
    expect(banner).toBeTruthy();
  });
  it("ends with an 8px bottom margin", () => {
    expect(banner?.[1].split(/\s+/)).toContain("mb-2");
  });
});
