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
