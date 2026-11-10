/**
 * "Permit on file" for the shop owner (docs/NOT-LAUNCHED.md Q1952, migration 20261110195956):
 *  1. each sent permit says where it stands: waiting, checked until a date, expired, or turned down with the reason;
 *  2. Send uploads to user-documents under <uid>/shop-permits/<kind>-<13 digits>.<ext> and sends that path with the date;
 *  3. a refused send removes the upload and shows the server's words beside the button (never only a toast).
 *
 * @mutate src/components/shops/ShopPermitSection.tsx |   if (p.status === "rejected") return `We couldn't check it: ${p.review_note ?? "no reason given"} Send a new copy below.`; |   if (p.status === "rejected") return "We couldn't check it. Send a new copy below.";
 * @mutate src/lib/shops/permits.ts |   const path = `${userId}/shop-permits/${kind}-${Date.now()}.${ext}`; |   const path = `${userId}/permits/${kind}-${Date.now()}.${ext}`;
 * @mutate src/lib/shops/permits.ts |     const rm = await supabase.storage.from("user-documents").remove([path]); |     const rm = { error: null };
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));
const remove = vi.hoisted(() => vi.fn(async () => ({ data: [], error: null })));
const storageFrom = vi.hoisted(() => vi.fn(() => ({ upload, remove })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, storage: { from: storageFrom } } }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import ShopPermitSection from "./ShopPermitSection";

const MINE = [
  { kind: "food_permit", status: "rejected", expires_on: "2027-05-29", review_note: "The copy is blurry.", sent_at: "2026-11-10T00:00:00Z", expired: false },
  { kind: "inflatable_registration", status: "verified", expires_on: "2027-03-01", review_note: null, sent_at: "2026-11-01T00:00:00Z", expired: false },
];

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopPermitSection userId="u1" /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => {
    if (name === "shops_my_permits") return { data: MINE, error: null };
    if (name === "shops_submit_permit") return { data: "pm1", error: null };
    return { data: null, error: null };
  });
});

describe("ShopPermitSection (Q1952)", () => {
  it("says where each permit stands, with the admin's reason", async () => {
    renderIt();
    const rows = await screen.findAllByTestId("shop-permit-row");
    expect(rows[0].textContent).toBe("Food permit: We couldn't check it: The copy is blurry. Send a new copy below.");
    expect(rows[1].textContent).toMatch(/Inflatable \(bounce house\) registration: Checked\. Your shop shows "Permit on file" until March 1, 2027\./);
  });

  it("uploads to the permit path and sends it with the date", async () => {
    renderIt();
    await screen.findAllByTestId("shop-permit-row");
    const file = new File(["%PDF"], "permit.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Photo or PDF of the permit"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Expires on"), { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for a check" }));
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "shops_submit_permit")).toBe(true));
    const path = (upload.mock.calls[0] as unknown as [string])[0];
    expect(storageFrom).toHaveBeenCalledWith("user-documents");
    expect(path).toMatch(/^u1\/shop-permits\/food_permit-\d{13}\.pdf$/);
    const args = rpc.mock.calls.find((c) => c[0] === "shops_submit_permit")![1];
    expect(args).toEqual({ p_kind: "food_permit", p_document_path: path, p_expires_on: "2027-06-30" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("a refused send removes the upload and shows why beside the button", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "shops_my_permits") return { data: [], error: null };
      return { data: null, error: { message: "invalid_permit_expiry", code: "22023" } };
    });
    renderIt();
    const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(await screen.findByLabelText("Photo or PDF of the permit"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Expires on"), { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for a check" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/can't be in the past/);
    expect(remove).toHaveBeenCalledWith([(upload.mock.calls[0] as unknown as [string])[0]]);
  });

  it("asks for a file before sending anything", async () => {
    renderIt();
    await screen.findAllByTestId("shop-permit-row");
    fireEvent.click(screen.getByRole("button", { name: "Send for a check" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a photo or PDF of the permit.");
    expect(upload).not.toHaveBeenCalled();
  });
});
