/**
 * Polish audit 11-27 #13 (owner phone polish audit, Inbox > Notifications): rows were ~250px, three a screen: a 40px
 * icon in a tinted circle, the time on a line of its own, a see-through sticky "TODAY" band ("5h ago" showed through)
 * and a fixed "Showing the newest 50" footer that left white space under the list.
 *
 * Now: the type icon is bare (no tinted circle), the time ends the title line (12px), the day band is opaque white
 * with a 1px line, and the page note is a 13px line at the END of the list (it scrolls with the rows).
 * "More" stays for a long message (AUD31-19: the end of a long notice must be readable; notificationMessageShowsAll).
 *
 * @mutate src/components/NotificationPanelView.tsx |                       background: "hsl(var(--background))",\n |                       background: "hsl(var(--surface-band) / 0.78)",\n
 * @mutate src/components/NotificationPanelView.tsx |                               <span data-notif-time="" | <p data-notif-time=""
 * @mutate src/components/notificationPanel/NotificationLeading.tsx |       className="shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center | className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const panel = blankComments(readFileSync(resolve(__dirname, "../components/NotificationPanelView.tsx"), "utf8"));
const leading = blankComments(readFileSync(resolve(__dirname, "../components/notificationPanel/NotificationLeading.tsx"), "utf8"));

describe("polish audit 11-27 #13: compact notification rows", () => {
  it("is not vacuous", () => {
    expect(panel.length).toBeGreaterThan(20000);
    expect(panel).toContain("groupedNotifications.map");
  });

  it("the sticky day band is opaque white with a 1px line, no blur", () => {
    const at = panel.indexOf('data-notif-day=""');
    expect(at).toBeGreaterThan(-1);
    const band = panel.slice(at, panel.indexOf("}}", at));
    expect(band).toContain('background: "hsl(var(--background))"');
    expect(band).toContain('borderBottom: "1px solid hsl(var(--border))"');
    expect(band).not.toMatch(/backdropFilter|\/ 0\.\d+\)/);
  });

  it("the time sits on the title line, once per row", () => {
    const row = panel.slice(panel.indexOf("const body = ("), panel.indexOf("return framer ? (", panel.indexOf("const body = (")));
    expect(row.match(/timeAgo\(n\.created_at\)/g)).toHaveLength(1);
    // Inside the title's flex row: after the title text, before the unread dot.
    const title = row.indexOf("{say(n.title)}");
    const time = row.indexOf('<span data-notif-time=""');
    const dot = row.indexOf('aria-label={t("notif.unreadDot")}');
    expect(title).toBeGreaterThan(-1);
    expect(time).toBeGreaterThan(title);
    expect(dot).toBeGreaterThan(time);
    expect(row.slice(time, row.indexOf(">", time))).toContain("text-ds-12");
  });

  it("the type icon is bare: no tinted circle behind it", () => {
    const icon = leading.slice(leading.indexOf("const money"));
    expect(icon).toContain("data-notif-tint={tint}");
    expect(icon).not.toMatch(/rounded-full|background/);
  });

  it("the page note ends the scrolling list (13px), not a fixed footer under it", () => {
    const note = panel.indexOf('data-notif-page-note=""');
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(panel.indexOf("</PullToRefreshWrapper>"));
    expect(panel.slice(note, panel.indexOf(">", note))).toContain("text-ds-13");
  });
});

/**
 * Polish audit 11-27 #13, the rest: "one page scroll". On the Inbox page the Unread / All row, the rows, the page note and
 * the push row are ONE scroll (the list's), and the room for the dock is that scroll's end, not padding under a short
 * box (which left a fixed push footer over a blank band).
 *
 * @mutate src/components/NotificationPanelView.tsx |           top={inlineHeader}\n | \n
 * @mutate src/components/NotificationPanelView.tsx |           {inline && pushRow}\n | \n
 * @mutate src/components/inbox/InboxNotifications.tsx |         className="flex-1 min-h-0 flex flex-col"\n |         className="flex-1 min-h-0 flex flex-col"\n        style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px))" }}\n
 */
describe("polish audit 11-27 #13: the Inbox's notifications are one scroll", () => {
  const inbox = blankComments(readFileSync(resolve(__dirname, "../components/inbox/InboxNotifications.tsx"), "utf8"));
  const wrapAt = panel.indexOf("<PullToRefreshWrapper");
  const wrapEnd = panel.indexOf("</PullToRefreshWrapper>");
  const wrapper = panel.slice(wrapAt, wrapEnd);

  it("is not vacuous", () => {
    expect(wrapAt).toBeGreaterThan(-1);
    expect(wrapEnd).toBeGreaterThan(wrapAt);
    expect(inbox).toContain("<NotificationPanel inline />");
  });

  it("the Unread / All row scrolls with the rows (the scroller's top), never pinned above it", () => {
    expect(panel).toContain('data-notif-inline-head=""');
    expect(wrapper).toContain("top={inlineHeader}");
    // The chips are drawn once, inside inlineHeader, defined before the panel body.
    expect(panel.split("{inboxChips}").length - 1).toBe(1);
    expect(panel.indexOf("{inboxChips}")).toBeLessThan(panel.indexOf("const body = ("));
  });

  it("the push row ends the scroll on the Inbox page; the dock's room is the scroll's own end", () => {
    expect(wrapper).toContain("{inline && pushRow}");
    expect(wrapper).toContain("style={inline ? { paddingBottom: inlineBottomPad } : undefined}");
    expect(panel.slice(wrapEnd)).toContain("{!inline && pushRow}");
    const tabpanel = inbox.slice(inbox.indexOf('role="tabpanel"'), inbox.indexOf("<NotificationPanel inline />"));
    expect(tabpanel.length).toBeGreaterThan(20);
    expect(tabpanel).not.toMatch(/paddingBottom|bottom-nav-h/);
  });
});
