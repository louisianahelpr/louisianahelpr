/**
 * S018 (Shops audit 11-12): the buyer's problem report takes one optional photo (L43, as Declutter's report). The photo
 * waits on the device until "Report it"; the report uploads it into <buyer>/shops/problem/<order>/<file> of the private
 * shop-handover bucket and sends its path (20261112090512; src/test/pglite/shopsProblemPhoto.pglite.mjs). A refused
 * report removes the unsent upload. The admin queue opens a buyer's photo from shop-handover, a Helpr's from helpr-tasks.
 *
 * @mutate src/components/shops/ShopHandoverActions.tsx |     mutationFn: () => reportNotReceived(order.id, note, problemPhoto ? { userId, file: problemPhoto } : null), |     mutationFn: () => reportNotReceived(order.id, note, null),
 * @mutate src/lib/shops/handover.ts |     ...(photoPath ? { p_photo_path: photoPath } : {}), |
 * @mutate src/lib/shops/handover.ts |       const removed = await supabase.storage.from(SHOP_HANDOVER_BUCKET).remove([photoPath]); |       const removed = { error: null };
 * @mutate src/lib/shops/handover.ts |   const path = `${userId}/shops/problem/${orderId}/${nonce}.jpg`; |   const path = `${userId}/shops/handover/${orderId}/${nonce}.jpg`;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";

const sb = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: sb.rpc, storage: { from: () => ({ upload: sb.upload, remove: sb.remove }) } },
}));
vi.mock("@/lib/declutter/photos", () => ({
  cleanListingPhoto: vi.fn(async (f: File) => new File([f], "clean.jpg", { type: "image/jpeg" })),
  LISTING_PHOTO_UPLOAD_TYPES: ["image/jpeg"],
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, primaryLabel, onPrimary, children }: {
    open: boolean; title: string; primaryLabel: string; onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));

import * as handoverLib from "@/lib/shops/handover";
import { ShopHandoverActions } from "./ShopHandoverActions";

const order = (): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u2", shop_id: "s1", status: "accepted", close_reason: null, ready_date: "2026-01-01",
  cancel_policy: "until_accept", note: "", decline_reason: null, items_cents: 6000, premium_cents: 370, tax_cents: 0,
  total_cents: 6370, captured_at: "2025-12-30T10:00:00Z", handover_mode: "in_person", fulfillment: "pickup", handed_over_at: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: "Candle", kind: "made", unit_cents: 6000, quantity: 1, line_cents: 6000 }],
} as unknown as ShopOrder);

beforeEach(() => {
  vi.clearAllMocks();
  sb.upload.mockResolvedValue({ error: null });
  sb.remove.mockResolvedValue({ error: null });
});

describe("the buyer's problem report photo", () => {
  it("adds a photo in the report dialog and sends it with the report", async () => {
    vi.spyOn(handoverLib, "fetchHandovers").mockResolvedValue(new Map());
    sb.rpc.mockResolvedValue({ data: { result: "reported" }, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ShopHandoverActions order={order()} side="buyer" userId="u1" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /didn.t get it/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Add a photo (optional)");
    expect(dialog.textContent).toContain("Only Louisiana Helpr sees the photo, not the shop.");
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "box.jpg", { type: "image/jpeg" })] } });
    expect((await screen.findByTestId("shop-problem-photo-name")).textContent).toContain("box.jpg");
    fireEvent.change(dialog.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "The box was empty" } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm/ }));
    await vi.waitFor(() => expect(sb.rpc).toHaveBeenCalled());
    const [name, args] = sb.rpc.mock.calls[0] as [string, Record<string, string>];
    expect(name).toBe("shops_report_not_received");
    expect(args.p_photo_path).toMatch(/^u1\/shops\/problem\/o1\/[^/]+\.jpg$/);
    expect(sb.upload).toHaveBeenCalledTimes(1);
  });
});

describe("reportNotReceived", () => {
  it("sends no photo argument without a photo", async () => {
    sb.rpc.mockResolvedValue({ data: {}, error: null });
    await handoverLib.reportNotReceived("o1", " note ");
    expect(sb.rpc).toHaveBeenCalledWith("shops_report_not_received", { p_order_id: "o1", p_note: "note" });
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("removes the unsent photo when the report is refused", async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: "order_not_open", code: "55000" } });
    await expect(handoverLib.reportNotReceived("o1", "note", { userId: "u1", file: new File(["x"], "a.jpg", { type: "image/jpeg" }) }))
      .rejects.toBeTruthy();
    const uploaded = (sb.upload.mock.calls[0] as unknown as [string])[0];
    expect(uploaded).toMatch(/^u1\/shops\/problem\/o1\//);
    expect(sb.remove).toHaveBeenCalledWith([uploaded]);
  });
  it("tells a buyer's problem photo from a Helpr's answer photo", () => {
    expect(handoverLib.isShopProblemPhotoPath("u1/shops/problem/o1/a.jpg")).toBe(true);
    expect(handoverLib.isShopProblemPhotoPath("u9/task/t1/a.jpg")).toBe(false);
    expect(handoverLib.isShopProblemPhotoPath(null)).toBe(false);
  });
});
