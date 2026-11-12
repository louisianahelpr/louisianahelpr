/**
 * S054 (Shops audit 11-12): a NEW shop item can start from photos, like a Declutter listing. Before the first save the
 * editor holds the picked photos on the device, "Suggest details from my photos" sends them (cleaned, smaller, never
 * uploaded by that call) to declutter-ai-draft with target shop_item and fills the form, and the first save adds the
 * held photos to the new item. The edge side is src/test/edge/shopAiDraftFromPhotos.test.ts.
 *
 * @mutate src/components/shops/ShopItemEditor.tsx |       if (!id && held.length > 0) { |       if (false) {
 * @mutate src/lib/shops/items.ts |   return (await invokeAiBody({ mode: "draft", target: "shop_item", photos })) as ShopItemAiDraft; |   return (await invokeAiBody({ mode: "draft", photos })) as ShopItemAiDraft;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fx = vi.hoisted(() => ({ invokes: [] as unknown[][], answer: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (...a: unknown[]) => { fx.invokes.push(a); return { data: fx.answer, error: null }; } } },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: async (f: File) => f,
  blobToBase64: async (b: Blob) => `b64-${(b as File).name}`,
}));
const api = vi.hoisted(() => ({ createShopItem: vi.fn(), addShopItemPhoto: vi.fn() }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...api }));

import ShopItemEditor from "./ShopItemEditor";
import { requestShopItemAiDraftFromPhotos } from "@/lib/shops/items";

const file = (n: string) => new File([n], n, { type: "image/jpeg" });

beforeEach(() => {
  fx.invokes.length = 0;
  fx.answer = { title: "Fig soy candle", description: "Hand-poured, 8 oz.", kind: "made", subtype: "candles", flagged: false };
  api.createShopItem.mockReset().mockResolvedValue("new-item");
  api.addShopItemPhoto.mockReset().mockResolvedValue(undefined);
});

describe("S054: a new shop item starts from photos", () => {
  it("sends up to 4 held photos in the body for target shop_item, uploading nothing", async () => {
    await requestShopItemAiDraftFromPhotos(["a", "b", "c", "d", "e"].map((n) => file(`${n}.jpg`)));
    expect(fx.invokes).toEqual([["declutter-ai-draft", { body: { mode: "draft", target: "shop_item", photos: ["b64-a.jpg", "b64-b.jpg", "b64-c.jpg", "b64-d.jpg"] } }]]);
    await expect(requestShopItemAiDraftFromPhotos([])).rejects.toThrow("ai_photos_required");
  });

  it("the editor fills the form from the held photos, and the first save adds them to the new item", async () => {
    const onCreated = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter>
      <ShopItemEditor ownerId="u1" item={null} onCreated={onCreated} onDone={() => {}} />
    </MemoryRouter></QueryClientProvider>);
    const suggest = screen.getByRole("button", { name: "Suggest details from my photos" }) as HTMLButtonElement;
    expect(suggest.disabled).toBe(true);
    fireEvent.change(document.querySelector("[data-testid=item-start-photos] input[type=file]") as HTMLInputElement, { target: { files: [file("a.jpg"), file("b.jpg")] } });
    expect(suggest.disabled).toBe(false);
    fireEvent.click(suggest);
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Fig soy candle"));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Hand-poured, 8 oz.");
    expect(api.addShopItemPhoto).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Price (dollars)"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-item"));
    expect(api.addShopItemPhoto.mock.calls.map((c) => [c[0], c[1], (c[2] as File).name])).toEqual([["u1", "new-item", "a.jpg"], ["u1", "new-item", "b.jpg"]]);
  });

  // S2-035 (Shops audit 2): a new item's main button says what comes next and is solid; no lone "Save draft".
  it("S2-035: a new item's first screen has a solid 'Save and continue' and names the next steps", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter>
      <ShopItemEditor ownerId="u1" item={null} onCreated={() => {}} onDone={() => {}} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    const main = screen.getByRole("button", { name: "Save and continue" });
    expect(main.className).toContain("btn-grad-primary");
    expect(screen.getByTestId("item-new-next-steps").textContent).toBe("Saves it as a draft. Next: 3 or more photos, then Publish.");
  });
});
