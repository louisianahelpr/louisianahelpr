/**
 * OPS-5 (owner 10-29): where a new member came from, privacy-safe. The device keeps only two short words (source and
 * campaign) from the first visit, the first one wins for 30 days, and a signed-in account sends them once.
 *
 * @mutate src/lib/signupSource.ts |   const kept = readFirstTouch(now);\n  if (kept) return kept; |   const kept = readFirstTouch(now);
 * @mutate src/lib/signupSource.ts |     if (now - t.at > TOUCH_DAYS * 86_400_000) return null; |
 * @mutate src/lib/signupSource.ts |   if (!word \|\| word.includes("@") \|\| word.includes("%40") \|\| | if (!word \|\| word.includes("%40") \|\|
 * @mutate src/lib/signupSource.ts | \|\| /\d{7,}/.test(word.replace(/\D/g, ""))) return null; |) return null;
 * @mutate src/lib/signupSource.ts | word.includes("@") \|\| word.includes("%40") \|\| | word.includes("@") \|\|
 * @mutate src/lib/signupSource.ts | /\d{7,}/.test(word.replace(/\D/g, "")) | /\d{7,}/.test(word)
 * @mutate src/lib/signupSource.ts | rawTag && clean(rawTag) === null ? null : | false ? null :
 * @mutate src/lib/signupSource.ts |   if (safeStorage.getItem(SENT_KEY) === userId) return; |
 * @mutate src/lib/signupSource.ts |       if (!isMissingRpcNamed(error, "record_my_signup_source")) report(error, { tags: { source: "signup-source" } });\n      return; |       if (!isMissingRpcNamed(error, "record_my_signup_source")) report(error, { tags: { source: "signup-source" } });
 * @mutate src/lib/signupSource.ts |       if (!isMissingRpcNamed(error, "record_my_signup_source")) report | if (false) report
 * @mutate src/lib/signupSource.ts |       if (/^\s*email_unconfirmed\b/.test(String(error.message ?? ""))) return; |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const report = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import { readFirstTouch, rememberFirstTouch, reportSignupSource } from "./signupSource";

const DAY = 86_400_000;

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  report.mockReset();
});

describe("rememberFirstTouch", () => {
  it("keeps only utm_source and utm_campaign, cleaned to short words", () => {
    const t = rememberFirstTouch("?utm_source=Facebook&utm_campaign=Post-12&email=a@b.c&fbclid=xyz", "", 1000);
    expect(t).toEqual({ source: "facebook", campaign: "post-12", at: 1000 });
    expect(localStorage.getItem("lh_first_touch")).not.toMatch(/a@b|xyz|email/);
  });

  it("the first visit wins: a later tagged visit does not replace it", () => {
    rememberFirstTouch("?utm_source=facebook", "", 1000);
    const t = rememberFirstTouch("?utm_source=google&utm_campaign=x", "", 2000);
    expect(t.source).toBe("facebook");
    expect(readFirstTouch(2000)?.source).toBe("facebook");
  });

  it("after 30 days the old touch is gone and a new visit counts", () => {
    rememberFirstTouch("?utm_source=facebook", "", 0);
    expect(readFirstTouch(31 * DAY)).toBeNull();
    expect(rememberFirstTouch("?utm_source=google", "", 31 * DAY).source).toBe("google");
  });

  it("a word holding an email address is never kept", () => {
    const t = rememberFirstTouch("?utm_source=me@mail.com&utm_campaign=you@mail.com", "", 1000);
    expect(t.source).toBe("direct");
    expect(t.campaign).toBeNull();
  });

  it("a word with a phone number in it is never kept", () => {
    const t = rememberFirstTouch("?utm_source=5045551234&utm_campaign=call-3375550000", "", 1000);
    expect(t.source).toBe("direct");
    expect(t.campaign).toBeNull();
  });

  it("a phone number written with separators is never kept (review 10-31)", () => {
    for (const phone of ["555-123-4567", "(555) 123-4567", "+1 555 123 4567"]) {
      localStorage.clear();
      const q = new URLSearchParams({ utm_source: phone, utm_campaign: phone }).toString();
      const t = rememberFirstTouch(`?${q}`, "", 1000);
      expect(t.source, phone).toBe("direct");
      expect(t.campaign, phone).toBeNull();
    }
  });

  it("a link-encoded email (%40) is never kept (review 10-31)", () => {
    // %2540 decodes to the literal text "%40" that a double-encoded share link carries.
    const t = rememberFirstTouch("?utm_source=jo%2540x.com&utm_campaign=jo%2540x.com", "", 1000);
    expect(t.source).toBe("direct");
    expect(t.campaign).toBeNull();
  });

  it("a word with only a few digits (a year, a post number) is still kept", () => {
    const t = rememberFirstTouch("?utm_source=fall-2026&utm_campaign=post-12", "", 1000);
    expect(t).toMatchObject({ source: "fall-2026", campaign: "post-12" });
  });

  it("no tag and no outside referrer is direct", () => {
    expect(rememberFirstTouch("", "", 1000)).toEqual({ source: "direct", campaign: null, at: 1000 });
  });
});

describe("reportSignupSource", () => {
  it("sends the kept words once per account", async () => {
    rememberFirstTouch("?utm_source=facebook&utm_campaign=post-12", "");
    rpc.mockResolvedValue({ data: true, error: null });
    await reportSignupSource("u1");
    await reportSignupSource("u1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_my_signup_source", { p_source: "facebook", p_campaign: "post-12" });
  });

  it("a missing function (web before the migration) is quiet and tried again next time", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    await reportSignupSource("u1");
    await reportSignupSource("u1");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
  });

  it("an unconfirmed email's refusal is quiet and tried again once confirmed (lead 10-31)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "email_unconfirmed" } });
    await reportSignupSource("u1");
    expect(report).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await reportSignupSource("u1");
    expect(rpc).toHaveBeenCalledTimes(2);
    await reportSignupSource("u1");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("any other failure is reported, never thrown", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "nope" } });
    await expect(reportSignupSource("u1")).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
