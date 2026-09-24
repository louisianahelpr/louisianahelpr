/**
 * PD-012: the nav unread badge fetched every unread message row with no
 * limit. It is mounted on every signed-in page and recounts on each inbound
 * message, so the read must stay bounded.
 *
 * @mutate src/components/mobileNav/useNavUnreadCount.ts |       .limit(UNREAD_ROW_CAP); // PD-012 bounded |       ; // PD-012 bounded
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../components/mobileNav/useNavUnreadCount.ts"), "utf8");

describe("nav unread count is a bounded read (PD-012)", () => {
  it("the unread messages query carries a limit", () => {
    const q = SRC.slice(SRC.indexOf('.from("messages")'), SRC.indexOf("// `is_system`"));
    expect(q, "unread query not found").toContain('.eq("read", false)');
    expect(q).toMatch(/\.limit\(\s*UNREAD_ROW_CAP\s*\)/);
    expect(SRC).toMatch(/const UNREAD_ROW_CAP = \d+;/);
  });
});
