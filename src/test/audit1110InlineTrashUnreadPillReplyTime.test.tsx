/**
 * Whole-app audit 11-10, Builder 2:
 *   F427 Job chat: an unlabelled trash icon sat beside every message you sent, one tap from the delete confirm. The
 *         inline button is gone; delete lives in the long-press MessageActionSheet (its handleDelete, same confirm).
 *   F432 Messages list: the only unread cue was a weight step and a small dot; unread rows now carry a count pill
 *         ("2") in the top-right cluster beside the time.
 *   F235 /support (public and Profile > Support): the reply-time promise showed only after sending; it now sits at
 *         the top of both forms. (Signed-in members were already not asked for name/email: Support.tsx `identified`.)
 *
 * @mutate src/components/messages/ConversationRow.tsx | {hasUnreadFromOther && (\n                  <span\n                    aria-hidden="true"\n                    data-testid="row-unread-count" | {false && (\n                  <span\n                    aria-hidden="true"\n                    data-testid="row-unread-count"
 * @mutate src/components/messages/ConversationRow.tsx | {c.unread > 99 ? "99+" : c.unread} | {c.unread}
 * @mutate src/pages/info/Support.tsx | A real person reads every message. {SUPPORT_REPLY_PROMISE} | A real person reads every message.
 * @mutate src/components/profile/SupportInline.tsx | A real person reads every message. {SUPPORT_REPLY_PROMISE} | A real person reads every message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("F427: no inline trash button on a sent message", () => {
  it("MessageBubble renders no delete control; MessageActionSheet still owns delete", () => {
    const bubble = code("src/components/messages/MessageBubble.tsx");
    expect(bubble).not.toContain("Trash2");
    expect(bubble).not.toContain('aria-label={t("chat.deleteMessage")}');
    expect(bubble).not.toMatch(/onClick=\{\(\) => onDelete\(m\.id\)\}/);
    const sheet = code("src/components/messages/MessageActionSheet.tsx");
    expect(sheet).toContain("onDelete(message.id);");
  });
});

describe("F432: unread rows carry a count pill beside the time", () => {
  it("renders row-unread-count only for unread rows, capped at 99+", () => {
    const src = code("src/components/messages/ConversationRow.tsx");
    const start = src.indexOf('data-testid="row-time-cluster"');
    expect(start).toBeGreaterThan(0);
    const cluster = src.slice(start, src.indexOf("</span>\n            </div>", start));
    expect(cluster).toMatch(/\{hasUnreadFromOther && \(\s*<span\s+aria-hidden="true"\s+data-testid="row-unread-count"/);
    expect(cluster).toContain('{c.unread > 99 ? "99+" : c.unread}');
    expect(cluster).toContain('background: "hsl(var(--bark))"');
  });
});

describe("F235: both support forms state the reply time before sending", () => {
  it.each(["src/pages/info/Support.tsx", "src/components/profile/SupportInline.tsx"])("%s", (file) => {
    const src = code(file);
    const form = src.slice(src.indexOf("<form"), src.indexOf("</form>"));
    expect(form).toMatch(/data-support-reply-time="">\s*A real person reads every message\. \{SUPPORT_REPLY_PROMISE\}/);
  });
});
