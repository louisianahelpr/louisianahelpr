/**
 * NB-002: no push ever carried aps.badge (no caller set payload.badge), so the
 * app-icon badge froze while the app was closed. send-push-notification now
 * counts the recipient's unread, non-system, non-blocked messages and sets the
 * badge itself whenever the caller did not.
 *
 * @mutate supabase/functions/send-push-notification/index.ts | payload.badge = count // NB-002 server badge | void count // NB-002 server badge
 * @mutate supabase/functions/send-push-notification/index.ts | .not('is_system', 'is', true) | .not('is_system', 'is', null)
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
    expect(block).toContain("not('sender_id', 'in'");
    expect(block).toMatch(/payload\.badge = count \/\/ NB-002 server badge/);
  });
});
