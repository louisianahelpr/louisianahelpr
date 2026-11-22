/**
 * Holiday audit 1121 (Medium): "No way to delete a wish list or stop a shared link". Server side:
 * src/test/pglite/giftWishListDelete.pglite.mjs.
 *   - Right after a share, the browser keeps a random token for that link (only its hash goes to the server,
 *     gift_wish_list_claim), and the share menu offers "Stop sharing this link" (gift_wish_list_unshare with that
 *     token). An account's own list (the claim says no) offers no Stop.
 *   - Signed in, "Delete my list" asks first in the app's own dialog, deletes the account's list
 *     (gift_wish_list_delete) and empties it here, not synced, so nothing is saved back.
 *
 * @mutate src/lib/giftWishListOwnApi.ts |   if (data === true) writeTokens({ ...readTokens(), [code]: token }); |   if (data !== null) writeTokens({ ...readTokens(), [code]: token });
 * @mutate src/lib/giftWishListOwnApi.ts |   const { data, error } = await sb.rpc("gift_wish_list_unshare", { p_code: code, p_token: token }); |   const { data, error } = await sb.rpc("gift_wish_list_unshare", { p_code: code, p_token: "0".repeat(64) });
 * @mutate src/pages/info/giftGuides/GiftWishShare.tsx |           {canStop && <Button | {false && <Button
 * @mutate src/pages/info/giftGuides/giftList.tsx | export const forgetAccountList = () => write({ ...read(), picks: [], name: "", synced: null }); | export const forgetAccountList = () => write({ ...read(), picks: [] });
 * @mutate src/pages/info/giftGuides/DeleteMyList.tsx |       await deleteMyWishList(); |       void deleteMyWishList;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { GiftWishShare } from "@/pages/info/giftGuides/GiftWishShare";
import { DeleteMyList } from "@/pages/info/giftGuides/DeleteMyList";
import { canStopSharing, claimShare, stopSharing } from "@/lib/giftWishListOwnApi";
import { addToWishList, giftListNow, resetGiftListForTests, setListName } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { LISTS } from "@/content/giftListsManage";

const CODE = "abcdef123456";
const tokens = () => JSON.parse(window.localStorage.getItem("lh-gift-share-tokens") ?? "{}") as Record<string, string>;

beforeEach(() => {
  window.localStorage.clear();
  resetGiftListForTests();
  resetHintsForTests();
  rpc.mockReset();
});
afterEach(() => cleanup());

describe("stopping a shared link", () => {
  it("a share keeps a 64-hex token for its link (only when the server took the claim), and Stop sends that token", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await claimShare(CODE);
    const [, claimArgs] = rpc.mock.calls[0] as [string, { p_code: string; p_token: string }];
    expect(rpc.mock.calls[0][0]).toBe("gift_wish_list_claim");
    expect(claimArgs.p_token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens()[CODE]).toBe(claimArgs.p_token);
    expect(canStopSharing(CODE)).toBe(true);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await stopSharing(CODE)).toBe(true);
    expect(rpc.mock.calls[1]).toEqual(["gift_wish_list_unshare", { p_code: CODE, p_token: claimArgs.p_token }]);
    expect(canStopSharing(CODE)).toBe(false);
    // An account's own list: the claim says no, so no token and no Stop.
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await claimShare("zzzzzz999999");
    expect(canStopSharing("zzzzzz999999")).toBe(false);
  });

  it("the share menu offers Stop sharing for a link this browser made, and says when it has stopped", async () => {
    rpc.mockImplementation(async (fn: string) => ({ data: true, error: null, fn }));
    const view = render(<MemoryRouter><GiftWishShare name="Lexi's list" refs={[{ g: "her", i: "abc1" }]} save={async () => CODE} hint={false} /></MemoryRouter>);
    fireEvent.click(view.container.querySelector("[data-gift-wish-share-btn]")!);
    const stop = await waitFor(() => {
      const b = view.container.querySelector<HTMLButtonElement>("[data-gift-wish-stop]");
      expect(b?.textContent).toBe("Stop sharing this link");
      return b!;
    });
    fireEvent.click(stop);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-stopped]")?.textContent).toBe(LISTS.sharingStopped));
    expect(view.container.querySelector("[data-gift-wish-link]")).toBeNull();
  });
});

describe("deleting my list (signed in)", () => {
  it("asks first, deletes the account's list and empties it here, unsynced", async () => {
    setListName("Lexi's list");
    addToWishList({ href: "https://www.amazon.com/dp/B0D3L9BYFZ?tag=louisianahelpr-20", name: "Leggings", guide: "her" });
    rpc.mockResolvedValue({ data: true, error: null });
    const view = render(<DeleteMyList />);
    fireEvent.click(view.container.querySelector("[data-gift-wish-delete]")!);
    // The confirm dialog loads on the first tap, so wait until it is really there.
    const dialog = await waitFor(() => {
      const d = [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((x) => x.textContent?.includes(LISTS.deleteMyListTitle));
      expect(d).toBeTruthy();
      return d!;
    });
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === LISTS.deleteMyList)!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("gift_wish_list_delete"));
    await waitFor(() => expect(giftListNow().picks).toEqual([]));
    expect(giftListNow().name).toBe("");
    expect(giftListNow().synced).toBeNull();
    expect(view.container.querySelector("[data-gift-wish-delete-said]")?.textContent?.trim()).toBe(LISTS.deleteMyListDone);
  });

  it("a failed delete says so and keeps the list", async () => {
    addToWishList({ href: "https://www.amazon.com/dp/B0D3L9BYFZ?tag=louisianahelpr-20", name: "Leggings", guide: "her" });
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const view = render(<DeleteMyList />);
    fireEvent.click(view.container.querySelector("[data-gift-wish-delete]")!);
    // The confirm dialog loads on the first tap, so wait until it is really there.
    const dialog = await waitFor(() => {
      const d = [...document.querySelectorAll<HTMLElement>("[role='alertdialog'], [role='dialog']")].find((x) => x.textContent?.includes(LISTS.deleteMyListTitle));
      expect(d).toBeTruthy();
      return d!;
    });
    fireEvent.click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === LISTS.deleteMyList)!);
    await waitFor(() => expect(view.container.querySelector("[data-gift-wish-delete-said]")?.textContent?.trim()).toBe(LISTS.deleteMyListFailed));
    expect(giftListNow().picks).toHaveLength(1);
  });
});
