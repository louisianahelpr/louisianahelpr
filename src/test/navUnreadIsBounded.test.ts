/**
 * PD-012: the nav unread badge fetched every unread message row with no
 * limit. It is mounted on every signed-in page and recounts on each inbound
 * message, so the read must stay bounded. Since NOID-20 (lead 2026-10-31) the
 * query lives in src/lib/unreadConversations.ts, shared with the inbox.
 *
 * @mutate src/lib/unreadConversations.ts |     .limit(UNREAD_ROW_CAP); // PD-012 bounded |     ; // PD-012 bounded
 * @mutate src/components/mobileNav/useNavUnreadCount.ts |     const { data, error } = await unreadRowsQuery(userId); |     const { data, error } = await supabase.from("messages").select("job_id").eq("receiver_id", userId).eq("read", false);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SHARED = blankComments(readFileSync(resolve(__dirname, "../lib/unreadConversations.ts"), "utf8"));
const BADGE = blankComments(readFileSync(resolve(__dirname, "../components/mobileNav/useNavUnreadCount.ts"), "utf8"));

describe("nav unread count is a bounded read (PD-012)", () => {
  it("the unread messages query carries a limit", () => {
    const q = SHARED.slice(SHARED.indexOf("export function unreadRowsQuery"), SHARED.indexOf("export function inboxShowsRow"));
    expect(q, "unread query not found").toContain('.eq("read", false)');
    expect(q).toMatch(/\.limit\(\s*UNREAD_ROW_CAP\s*\)/);
    expect(SHARED).toMatch(/export const UNREAD_ROW_CAP = \d+;/);
  });

  it("the badge reads unread rows only through that bounded query", () => {
    expect(BADGE).toMatch(/await unreadRowsQuery\(userId\)/);
    // The only other messages access is the mark-all-read update.
    expect(BADGE.match(/\.from\("messages"\)/g) ?? []).toHaveLength(1);
    expect(BADGE).toMatch(/\.from\("messages"\)\s*\.update\(/);
  });
});
