/**
 * Audit 1122 #137: the Declutter order chat was a different chat design from the job chat in the same inbox (grey "You"
 * bubbles with the sender's label inside, a form label, Close and Send in a footer under everything), and at 375 the
 * Send button measured 800-856px in an 812px viewport, below the fold. CLASS CHECK:
 *   - every chat bubble in the app (MessageBubble for job chats, DeclutterOrderTalk for order chats) takes its look
 *     from the one shared module, chatBubbleLook.ts; neither file draws its own bubble fill;
 *   - the order chat's message box and its Send button sit OUTSIDE the scrolling part of the sheet (pinned at the
 *     bottom), so Send is on screen without scrolling however long the history is;
 *   - one way to close (the sheet's X): no second Close button.
 *
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | style={chatBubbleStyle(m.mine)} | style={undefined}
 * @mutate src/components/messages/MessageBubble.tsx |         style={chatBubbleStyle(mine)} |         style={{ background: "hsl(var(--muted))" }}
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx |         </div>\n        {t && open && !talk.isError && ( |         {t && open && !talk.isError && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", p), "utf8"));
const TALK = "src/components/declutter/DeclutterOrderTalk.tsx";
const BUBBLE = "src/components/messages/MessageBubble.tsx";

describe("the order chat uses the shared chat design (#137)", () => {
  it("both chats draw their bubbles from chatBubbleLook, and neither hand-draws a fill", () => {
    for (const file of [TALK, BUBBLE]) {
      const src = read(file);
      expect(src, file).toMatch(/from "[^"]*chatView\/chatBubbleLook"/);
      expect(src, file).toMatch(/style=\{chatBubbleStyle\((m\.)?mine\)\}/);
      expect(src, file).not.toMatch(/hsl\(var\(--bark\)\s*\/\s*0\.1\)|bg-\[hsl\(var\(--bark\)\/0\.1\)\]/);
      expect(src, file).not.toMatch(/linear-gradient\(180deg, hsl\(var\(--bark\)\)/);
    }
    const look = read("src/components/messages/chatView/chatBubbleLook.ts");
    expect(look).toMatch(/--bark/);
    expect(look).toMatch(/--ivory-sand/);
  });

  it("the message box and Send sit after the sheet's scrolling part closes, and there is no second Close", () => {
    const src = read(TALK);
    const scrollAt = src.indexOf("data-order-talk-scroll");
    const composerAt = src.indexOf("data-order-talk-composer");
    expect(scrollAt).toBeGreaterThan(0);
    expect(composerAt).toBeGreaterThan(scrollAt);
    // Walk the JSX between the scroll div's opening and the composer: its <div> opens and closes must balance to -1
    // (the scroll div itself closed before the composer starts).
    const between = src.slice(scrollAt, composerAt);
    const selfClosing = (between.match(/<div\b[^<>]*\/>/g) ?? []).length;
    const opens = (between.match(/<div\b/g) ?? []).length - selfClosing;
    const closes = (between.match(/<\/div>/g) ?? []).length;
    expect(closes - opens).toBe(1);
    expect(src).toMatch(/className="min-h-0 flex-1 overflow-y-auto" data-order-talk-scroll/);
    expect(src).not.toMatch(/SheetSecondaryAction|cp\.ot\.close/);
    expect(src).toMatch(/type="submit"[^>]*aria-label=\{[^}]*cp\.ot\.send/);
  });
});
