import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { lookupParishByZip, resolveParishByZip } from "./parishLookup";

describe("lookupParishByZip", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    reportMock.mockReset();
    sessionStorage.clear(); // a found ZIP answer is kept for the tab's session (parishLookup.ts)
  });

  it("returns null when zip is null/undefined/empty", async () => {
    expect(await lookupParishByZip(null)).toBeNull();
    expect(await lookupParishByZip(undefined)).toBeNull();
    expect(await lookupParishByZip("")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("strips non-digits before validating length", async () => {
    rpcMock.mockResolvedValue({ data: "Orleans", error: null });
    await lookupParishByZip("70112-1234");
    // Should pass cleaned 5-digit value
    expect(rpcMock).toHaveBeenCalledWith("get_parish_for_zip", { p_zip: "70112" });
  });

  it("returns null when fewer than 5 digits remain after cleaning", async () => {
    expect(await lookupParishByZip("701")).toBeNull();
    expect(await lookupParishByZip("abc-12")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the parish name on a successful RPC", async () => {
    rpcMock.mockResolvedValue({ data: "Orleans", error: null });
    expect(await lookupParishByZip("70112")).toBe("Orleans");
    expect(rpcMock).toHaveBeenCalledWith("get_parish_for_zip", { p_zip: "70112" });
  });

  // Q104 (B58): a found parish is fixed reference data, kept for the tab's session; every signed-in page load used
  // to ask the server again for the member's own ZIP. An unknown ZIP is NOT kept (the next test).
  // @mutate src/lib/parishLookup.ts | const known = zipAnswer("parish", cleaned); | const known = null as string \| null;
  it("asks the server once per tab session for a ZIP it found", async () => {
    rpcMock.mockResolvedValue({ data: "Orleans", error: null });
    expect(await lookupParishByZip("70112")).toBe("Orleans");
    expect(await lookupParishByZip("70112")).toBe("Orleans");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("asks again for a ZIP it could not place", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await lookupParishByZip("99999");
    await lookupParishByZip("99999");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when RPC returns null (zip not in lookup)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await lookupParishByZip("99999")).toBeNull();
  });

  it("reports an unresolvable ZIP so the hole is visible to somebody", async () => {
    // The operator-facing half of the guard. Before this, a ZIP the table could
    // not place produced a NULL parish, no error, and no record anywhere — so
    // an unreachable account was created and nobody found out. It stays a
    // WARNING because an out-of-state ZIP is a legitimate outcome.
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await lookupParishByZip("99999")).toBeNull();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    const { tags, severity } = opts as { tags: Record<string, string>; severity: string };
    expect(tags.source).toBe("parishLookup.unknownZip");
    expect(tags.zip).toBe("99999");
    expect(severity).toBe("warning");
  });

  it("does NOT report when the ZIP resolves", async () => {
    // The non-vacuous half: a warning on every successful lookup would bury the
    // one that matters.
    rpcMock.mockResolvedValue({ data: "Orleans", error: null });
    await lookupParishByZip("70112");
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("returns null and reports when RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("function does not exist") });
    expect(await lookupParishByZip("70112")).toBeNull();
    expect(reportMock).toHaveBeenCalledOnce();
    // tags should include source so logs can grep for it
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("parishLookup.rpc");
  });

  it("returns null and reports when RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await lookupParishByZip("70112")).toBeNull();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("parishLookup");
  });

  it("uses only the first 5 digits for ZIP+4 input", async () => {
    rpcMock.mockResolvedValue({ data: "Jefferson", error: null });
    await lookupParishByZip("70001-9999");
    expect(rpcMock).toHaveBeenCalledWith("get_parish_for_zip", { p_zip: "70001" });
  });
});

describe("resolveParishByZip", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    reportMock.mockReset();
    sessionStorage.clear(); // a found ZIP answer is kept for the tab's session (parishLookup.ts)
  });

  it("tells 'not a Louisiana ZIP' apart from 'the lookup broke'", async () => {
    // The whole reason this function exists. Both used to be `null`, so the UI
    // could not warn about the first without also accusing people whose only
    // problem was our own RPC failing.
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await resolveParishByZip("99999")).toEqual({ status: "unknown-zip", zip: "99999" });

    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });
    expect(await resolveParishByZip("70112")).toEqual({ status: "lookup-failed", zip: "70112" });

    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await resolveParishByZip("70112")).toEqual({ status: "lookup-failed", zip: "70112" });
  });

  it("reports a partial ZIP as incomplete without calling the RPC", async () => {
    expect(await resolveParishByZip("701")).toEqual({ status: "incomplete" });
    expect(await resolveParishByZip("")).toEqual({ status: "incomplete" });
    expect(await resolveParishByZip(null)).toEqual({ status: "incomplete" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("resolves a known ZIP, normalising ZIP+4", async () => {
    rpcMock.mockResolvedValue({ data: "Vermilion", error: null });
    expect(await resolveParishByZip("70528-1234")).toEqual({ status: "resolved", parish: "Vermilion" });
    expect(rpcMock).toHaveBeenCalledWith("get_parish_for_zip", { p_zip: "70528" });
  });
});

// Re-collapses the distinction this module exists for: a ZIP Louisiana does
// not have becomes indistinguishable from our own RPC falling over, so the UI
// goes silent and an unreachable (NULL-parish) account is created.
// @mutate src/lib/parishLookup.ts | return { status: "unknown-zip", zip: cleaned }; | return { status: "lookup-failed", zip: cleaned };

// Q2502: test data never reaches the owner. Every "ZIP N resolved to no
// Louisiana parish" row from a signed-in account on prod (6 of 8, 2026-10-09..30)
// was the journeys' deliberate bad ZIP 99999 typed by an is_seed test account
// in an automated browser (tags.automated = true), and Sentry mirrored it into
// the owner's alert ledger (row 07e2a58f38a2). The operator report is for a
// real person's ZIP; a test session keeps the inline warning (the status) but
// sends no report.
// @mutate src/lib/parishLookup.ts | if (automationReason() === null) { | if (true) {
describe("resolveParishByZip in a test session (Q2502)", () => {
  beforeEach(async () => {
    rpcMock.mockReset();
    reportMock.mockReset();
    sessionStorage.clear(); // a found ZIP answer is kept for the tab's session (parishLookup.ts)
    const { markTestProfileSession } = await import("@/lib/automatedBrowser");
    markTestProfileSession(false);
    localStorage.removeItem("lh_automation");
    Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  });

  const sessions: Array<[string, () => Promise<void>]> = [
    ["a test profile (is_seed) is signed in", async () => {
      const { markTestProfileSession } = await import("@/lib/automatedBrowser");
      markTestProfileSession(true);
    }],
    ["the browser is driven by Playwright (navigator.webdriver)", async () => {
      Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    }],
    ["the harness set the lh_automation flag", async () => {
      localStorage.setItem("lh_automation", "1");
    }],
  ];

  it.each(sessions)("an unknown ZIP is not reported when %s, but still warns the screen", async (_label, enter) => {
    await enter();
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await resolveParishByZip("99999")).toEqual({ status: "unknown-zip", zip: "99999" });
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("a real person's unknown ZIP is still reported (the non-vacuous half)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await resolveParishByZip("78503")).toEqual({ status: "unknown-zip", zip: "78503" });
    expect(reportMock).toHaveBeenCalledOnce();
  });

  it("a test session's broken lookup is still reported (a real defect, tagged automated)", async () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });
    expect(await resolveParishByZip("70112")).toEqual({ status: "lookup-failed", zip: "70112" });
    expect(reportMock).toHaveBeenCalledOnce();
  });
});
