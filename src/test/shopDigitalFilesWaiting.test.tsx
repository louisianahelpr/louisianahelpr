/**
 * S2-005 (shops audit 2, 11-12): an upload cut off before its check leaves a waiting row that blocks Publish
 * (files_required counts only checked files and refuses any waiting one). The owner must SEE it, with "Try again"
 * and Remove, and Publish must name it, instead of the list hiding it while Publish refuses.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const confirmDigitalFile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/shops/digitalFiles", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/digitalFiles")>()),
  fetchMyDigitalFiles: vi.fn().mockResolvedValue([
    { id: "f1", file_name: "pattern.pdf", ext: "pdf", byte_size: 2048, position: 0, checked_at: "2026-11-12T00:00:00Z" },
    { id: "f2", file_name: "cut-off.zip", ext: "zip", byte_size: 4096, position: 1, checked_at: null },
  ]),
  confirmDigitalFile: (id: string) => confirmDigitalFile(id),
  removeDigitalFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import ShopDigitalFiles from "@/components/shops/ShopDigitalFiles";
import { publishBlockers } from "@/components/shops/ShopItemEditor";

describe("S2-005 a waiting download file is shown and named", () => {
  it("lists the waiting file as Still checking with Try again and Remove", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ShopDigitalFiles itemId="i1" /></QueryClientProvider>);
    expect(await screen.findByText("cut-off.zip")).toBeTruthy();
    expect(screen.getByTestId("shop-digital-file-waiting").textContent).toBe("Still checking");
    expect(screen.getByRole("button", { name: "Remove cut-off.zip" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try cut-off.zip again" }));
    await waitFor(() => expect(confirmDigitalFile).toHaveBeenCalledWith("f2"));
  });

  it("Publish names a waiting file instead of passing it", () => {
    const base = { photos: 3, title: "Pattern", price: "5", unticked: 0, cottageNeedsTick: false, cottageUnknown: false };
    expect(publishBlockers({ ...base, digitalFiles: 1, digitalWaiting: 1 }))
      .toEqual(["A file is still checking. Try again or remove it below."]);
    expect(publishBlockers({ ...base, digitalFiles: 0, digitalWaiting: 0 })).toEqual(["Add 1 to 5 files for buyers to download."]);
    expect(publishBlockers({ ...base, digitalFiles: 2, digitalWaiting: 0 })).toEqual([]);
  });
});
