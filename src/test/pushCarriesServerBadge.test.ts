/**
 * NB-002: no push ever carried aps.badge (no caller set payload.badge), so the
 * app-icon badge froze while the app was closed. send-push-notification now
 * counts the recipient's unread, non-system, non-blocked messages and sets the
 * badge itself whenever the caller did not.
 *
 * N-006 (owner, 2026-09-27): the badge is unread messages PLUS unread
 * notifications, the same sum useNavUnreadCount puts on the icon, so a push
 * arriving cannot overwrite the icon with the messages count alone.
 *
 * @mutate supabase/functions/send-push-notification/index.ts | payload.badge = count + notifCount // NB-002 server badge | payload.badge = count // NB-002 server badge
 * @mutate supabase/functions/send-push-notification/index.ts | .not('is_system', 'is', true) | .not('is_system', 'is', null)
 * @mutate supabase/functions/send-push-notification/index.ts |       const count = msgs.error ? null : threads.size |       const count = msgs.error ? null : (msgs.data ?? []).length
 * @mutate supabase/functions/send-push-notification/index.ts |           .filter((m) => !m.flagged_hidden) |           .filter(() => true)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/send-push-notification/index.ts", "utf8");

describe("every iOS push carries the server's unread count (NB-002)", () => {
  it("the APNs body still emits aps.badge from payload.badge", () => {
    expect(src).toMatch(/typeof payload\.badge === 'number' \? \{ badge: payload\.badge \}/);
  });
  it("a push with no caller badge gets the recipient's unread count", () => {
    const block = src.slice(src.indexOf("// NB-002:"), src.indexOf("// NB-002 server badge") + 30);
    expect(block).toContain("typeof payload.badge !== 'number'");
    expect(block).toMatch(/\.eq\('receiver_id', payload\.user_id\)\s*\.eq\('read', false\)\s*\.not\('is_system', 'is', true\)/);
    // Blocked senders stay out, except Team-thread rows (Q1591(b), teamMessagesPassBlocks.test.ts).
    expect(block).toContain("sender_id.not.in.(${blocked.join(',')}),team_thread_user_id.not.is.null");
    expect(block).toMatch(/payload\.badge = count \+ notifCount \/\/ NB-002 server badge/);
  });
  it("the messages part counts unread CONVERSATIONS, as the in-app badge does (NOID-20, lead 2026-10-31)", () => {
    const block = src.slice(src.indexOf("// NB-002:"), src.indexOf("// NB-002 server badge") + 30);
    expect(block).toMatch(/\.limit\(1000\)/);
    expect(block).toContain(".filter((m) => !m.flagged_hidden)");
    expect(block).toContain("m.job_id === null ? `team:${m.team_thread_user_id ?? ''}` : `${m.job_id}_${m.sender_id ?? 'deleted-account'}`");
    expect(block).toContain("const count = msgs.error ? null : threads.size");
  });

  it("the badge adds the bell's unread notifications (N-006)", () => {
    const block = src.slice(src.indexOf("// NB-002:"), src.indexOf("// NB-002 server badge") + 30);
    expect(block).toMatch(/\.from\('notifications'\)\s*\.select\('id', \{ count: 'exact', head: true \}\)\s*\.eq\('user_id', payload\.user_id\)\s*\.eq\('read', false\)/);
    expect(block).toContain("!notifs.error");
  });
});
