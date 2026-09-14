import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import {
  MESSAGING_LOCKOUT_HOURS,
  REFUSAL_LATENCY_MS,
  THREAD_CLOSED_NOTICE,
  isLockoutRefusal,
  isThreadClosed,
  resetServerClock,
  serverNow,
  syncServerClock,
} from "./messagingLockout";
import { ChatComposer } from "@/components/messages/chatView/ChatComposer";
import type { Conversation } from "@/components/messages/types";

const NOW = Date.parse("2026-09-14T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe("isThreadClosed", () => {
  it("is open before the closing instant and closed at/after it", () => {
    expect(isThreadClosed(at(60_000), NOW)).toBe(false);
    expect(isThreadClosed(at(0), NOW)).toBe(true);
    expect(isThreadClosed(at(-1), NOW)).toBe(true);
  });
  it("is open when there is no closing instant (not completed / RPC missing)", () => {
    expect(isThreadClosed(null, NOW)).toBe(false);
    expect(isThreadClosed(undefined, NOW)).toBe(false);
    expect(isThreadClosed("not a date", NOW)).toBe(false);
  });
});

describe("isLockoutRefusal", () => {
  it("only explains an RLS refusal (42501), never another error", () => {
    expect(isLockoutRefusal({ code: "42501" }, at(-1), NOW)).toBe(true);
    expect(isLockoutRefusal({ code: "23503" }, at(-1), NOW)).toBe(false);
    expect(isLockoutRefusal(null, at(-1), NOW)).toBe(false);
  });
  it("allows only request latency before the closing instant, not clock skew", () => {
    expect(isLockoutRefusal({ code: "42501" }, at(REFUSAL_LATENCY_MS - 1), NOW)).toBe(true);
    expect(isLockoutRefusal({ code: "42501" }, at(60_000), NOW)).toBe(false);
    expect(isLockoutRefusal({ code: "42501" }, null, NOW)).toBe(false);
  });
});

// The device clock is not the server's. Both directions are real: a phone set
// fast would show "closed" while the server still accepts sends (client
// stricter than server); one set slow would keep a composer the server
// already refuses. Every comparison must run in server-corrected time.
describe("server-corrected clock", () => {
  const SERVER = Date.parse("2026-09-14T12:00:00Z");
  const closesAt = new Date(SERVER + 60_000).toISOString(); // closes 1 min after server "now"
  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
  });

  it("device clock 10 minutes FAST: still open until the server's closing instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 10 * 60_000);
    // Uncorrected, the device thinks the thread closed 9 minutes ago.
    expect(isThreadClosed(closesAt, Date.now())).toBe(true);
    syncServerClock(new Date(SERVER).toISOString());
    expect(isThreadClosed(closesAt)).toBe(false);
    expect(isLockoutRefusal({ code: "42501" }, closesAt)).toBe(false);
    vi.setSystemTime(SERVER + 10 * 60_000 + 61_000); // 61s later on both clocks
    expect(isThreadClosed(closesAt)).toBe(true);
    expect(isLockoutRefusal({ code: "42501" }, closesAt)).toBe(true);
  });

  it("device clock 10 minutes SLOW: closed as soon as the server's closing instant passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER - 10 * 60_000);
    syncServerClock(new Date(SERVER).toISOString());
    expect(isThreadClosed(closesAt)).toBe(false);
    vi.setSystemTime(SERVER - 10 * 60_000 + 61_000);
    // Uncorrected, the device would still think 9 minutes remain.
    expect(isThreadClosed(closesAt, Date.now())).toBe(false);
    expect(isThreadClosed(closesAt)).toBe(true);
    expect(isLockoutRefusal({ code: "42501" }, closesAt)).toBe(true);
    expect(serverNow()).toBe(SERVER + 61_000);
  });

  it("ignores an unparseable server_now instead of corrupting the offset", () => {
    syncServerClock("garbage");
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });
});

describe("ChatComposer read-only notice", () => {
  const convo = { jobId: "j1", otherUserId: "u2" } as unknown as Conversation;
  const base = {
    composerLocked: false,
    chatLoadError: false,
    keyboardInset: 0,
    activeConvo: convo,
    messages: [],
    userId: "u1",
    draft: "",
    setDraft: () => {},
    sendMessage: async () => true,
    broadcastTyping: () => {},
  };
  it("replaces the composer with a notice when the thread is closed, for any viewer", () => {
    for (const composerLocked of [false, true]) {
      const { unmount } = render(<ChatComposer {...base} composerLocked={composerLocked} threadClosed />);
      expect(screen.getByTestId("thread-closed-notice")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(THREAD_CLOSED_NOTICE);
      expect(screen.queryByRole("textbox")).toBeNull();
      unmount();
    }
  });
});

// Class check: the client never owns the clock. The gate, the client RPC and
// the constant must all agree on ONE server expression, read from the latest
// migration that defines each function.
describe("lockout gate, client RPC and constant share one clock", () => {
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latestBody = (fn: string) => {
    const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, "i");
    for (const f of [...files].reverse()) {
      const m = fs.readFileSync(path.join(dir, f), "utf8").match(re);
      if (m) return m[1];
    }
    return "";
  };

  it("can_message_in_job refuses once job_messaging_closes_at has passed", () => {
    expect(latestBody("can_message_in_job").replace(/\s+/g, " ")).toContain(
      "COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)",
    );
  });
  it("get_messaging_closes_at returns that same expression", () => {
    expect(latestBody("get_messaging_closes_at")).toMatch(/public\.job_messaging_closes_at\(j\.id\),\s*now\(\)/);
  });
  it("the window in SQL matches MESSAGING_LOCKOUT_HOURS", () => {
    const m = latestBody("job_messaging_closes_at").match(/interval '(\d+) hours'/);
    expect(m, "job_messaging_closes_at has no interval").toBeTruthy();
    expect(Number(m![1])).toBe(MESSAGING_LOCKOUT_HOURS);
  });
  it("the clock is the trigger-stamped completed_at, not the per-party stamps", () => {
    expect(latestBody("job_messaging_closes_at").replace(/\s+/g, " ")).toMatch(/COALESCE\( j\.completed_at,/);
  });
});
