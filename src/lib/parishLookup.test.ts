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

import { lookupParishByZip } from "./parishLookup";

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
