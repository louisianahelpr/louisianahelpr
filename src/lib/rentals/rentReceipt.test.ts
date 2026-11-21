/**
 * R5 receipts on the web: the receipt is handed over as a .txt download named as asked, the member is told it
 * downloaded, and a failure is told and reported instead of passing silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts: Array<[string, string]> = [];
const reports: Array<{ err: unknown; opts: { tags?: Record<string, string> } }> = [];

vi.mock("sonner", () => {
  const toast = Object.assign((m: string) => { toasts.push(["plain", m]); }, {
    error: (m: string) => { toasts.push(["error", m]); },
  });
  return { toast };
});
vi.mock("@/lib/errorLogger", () => ({
  report: (err: unknown, opts: { tags?: Record<string, string> }) => { reports.push({ err, opts }); },
}));

import { saveRentReceipt } from "./rentReceipt";

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let blobs: Blob[] = [];
let revoked: string[] = [];
let clicked: Array<{ href: string; download: string; attached: boolean }> = [];

beforeEach(() => {
  toasts.length = 0;
  reports.length = 0;
  blobs = [];
  revoked = [];
  clicked = [];
  URL.createObjectURL = ((b: Blob) => { blobs.push(b); return "blob:receipt-1"; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => { revoked.push(u); }) as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute("href") ?? "", download: this.download, attached: document.body.contains(this) });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe("saveRentReceipt on the web", () => {
  it("downloads the receipt text under the given file name and says so", async () => {
    vi.useFakeTimers();
    await saveRentReceipt("rent-receipt-2026-11.txt", "Rent received: $900.00");
    expect(clicked).toEqual([{ href: "blob:receipt-1", download: "rent-receipt-2026-11.txt", attached: true }]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/plain;charset=utf-8");
    expect(await blobs[0].text()).toBe("Rent received: $900.00");
    // The link does not stay on the page, and the object URL is released a moment later.
    expect(document.body.querySelector("a[download]")).toBeNull();
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(["blob:receipt-1"]);
    expect(toasts).toEqual([["plain", "rent-receipt-2026-11.txt downloaded"]]);
    expect(reports).toEqual([]);
  });
  it("tells the member and reports it when the download cannot start", async () => {
    const boom = new Error("blob storage is full");
    URL.createObjectURL = (() => { throw boom; }) as typeof URL.createObjectURL;
    await expect(saveRentReceipt("r.txt", "x")).resolves.toBeUndefined();
    expect(clicked).toEqual([]);
    expect(toasts).toEqual([["error", "Couldn't download the receipt. Try again."]]);
    expect(reports).toHaveLength(1);
    expect(reports[0].err).toBe(boom);
    expect(reports[0].opts.tags).toEqual({ source: "rentReceipt.download" });
  });
});
