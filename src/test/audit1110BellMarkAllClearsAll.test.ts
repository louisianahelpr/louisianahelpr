/**
 * F434 (whole-app audit 2026-11-10, Medium): the bell footer said "Showing 100 · 723 unread in total" over a 99+
 * badge, "Mark all read" cleared only the rows on screen (so 623 stayed unread and the badge stayed 99+), and titles
 * cut off mid-sentence ("Hallie H. marked the job compl..."). Now "Mark all read" marks every unread notice of this
 * member (user_id + read = false, still only the `read` column), the footer says what the button does in plain
 * words, and a title wraps to two lines before it clips.
 * @mutate src/components/NotificationPanel.tsx | .update({ read: true }).eq("user_id", uid).eq("read", false) | .update({ read: true }).in("id", unreadIds)
 * @mutate src/components/NotificationPanel.tsx |     setUnreadTotal((t) => (t === null ? t : 0)); |     setUnreadTotal((t) => (t === null ? t : Math.max(0, t - unreadIds.length)));
 * @mutate src/lib/i18n/enNotifications.ts | "Showing your newest {count}. Mark all read clears all {unread} unread." | "Showing {count} · {unread} unread in total"
 * @mutate src/components/NotificationPanelView.tsx | font-sans font-bold leading-tight line-clamp-2 [overflow-wrap:anywhere] text-ds-15 | font-sans font-bold leading-tight truncate text-ds-15
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const panel = blankComments(readFileSync("src/components/NotificationPanel.tsx", "utf8"));
const view = blankComments(readFileSync("src/components/NotificationPanelView.tsx", "utf8"));

function body(src: string, start: string, end: string) {
  const a = src.indexOf(start);
  expect(a, start).toBeGreaterThan(-1);
  return src.slice(a, src.indexOf(end, a));
}

describe("F434: Mark all read clears every unread notice, and the bell says so", () => {
  const mark = body(panel, "const markAllRead = async () => {", "\n  };\n");

  it("Mark all read writes read = true for ALL of this member's unread rows, not only the page", () => {
    expect(mark).toMatch(/\.from\("notifications"\)\s*\.update\(\{ read: true \}\)\.eq\("user_id", uid\)\.eq\("read", false\)\.select\("id"\)/);
    expect(mark).not.toMatch(/\.in\("id", unreadIds\)\.select/);
    // Every unread row is now read, so the badge total goes to 0 (rolled back on a failed write).
    expect(mark).toMatch(/setUnreadTotal\(\(t\) => \(t === null \? t : 0\)\)/);
    expect(mark).toMatch(/setUnreadTotal\(prevTotal\)/);
  });

  it("the footer says what the button does; a title wraps to two lines", () => {
    // F260q: the words are in the dictionary (enNotifications.ts), filled with the page count and the true unread total.
    const words = readFileSync("src/lib/i18n/enNotifications.ts", "utf8");
    expect(words).toContain('"notif.showingNewest": "Showing your newest {count}. Mark all read clears all {unread} unread."');
    expect(words).not.toContain("unread in total");
    expect(view).toContain('{t("notif.showingNewest", { count: notifications.length, unread: unreadTotal })}');
    expect(view).toMatch(/className="min-w-0 flex-1 font-sans font-bold leading-tight line-clamp-2 \[overflow-wrap:anywhere\] text-ds-15"/);
  });
});
