/**
 * Holiday audit 1121 (Medium): signed in, My Wish List said "Saved to your account" even when the account save failed
 * (offline showed nothing at all), and a first visit from a new device saved an unchanged list again.
 *   - Any failed save says so in plain words ("Couldn't save to your account just now ..."), with Try again; the list
 *     stays on the device and is saved on the next change, when the page comes back online, or on Try again.
 *   - A list that already matches the account's is not saved again on arrival.
 *
 * @mutate src/pages/info/giftGuides/wishListSync.ts |           setSyncProblem(wishErrorCopy(e) ?? WISH.syncFailed); |           setSyncProblem(wishErrorCopy(e));
 * @mutate src/pages/info/giftGuides/wishListSync.ts |         if (remote && JSON.stringify(listRefs(l)) === JSON.stringify(remote.items) && listName(l) === listName({ ...l, name: remote.name })) markSynced(uid); |         void remote;
 * @mutate src/pages/info/giftGuides/wishListSync.ts |     const online = () => push(); |     const online = () => undefined;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "acct-1" }, isReady: true }) }));
const api = vi.hoisted(() => ({ mine: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  getMyWishList: api.mine,
  saveWishList: api.save,
}));

import { retryWishListSync, useSyncProblem, useWishListSync } from "@/pages/info/giftGuides/wishListSync";
import { addToWishList, itemId, resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { WISH } from "@/content/giftWishList";

await loadAllGuidePicks();
const her = guideBySlug("her")!.picks;
const A = { href: her[0].href, name: her[0].name, guide: "her" };
function Probe() {
  useWishListSync();
  const p = useSyncProblem();
  return <p data-problem="">{p ?? ""}</p>;
}

beforeEach(() => {
  window.localStorage.clear();
  resetGiftListForTests();
  api.mine.mockReset();
  api.save.mockReset();
});
afterEach(() => cleanup());

describe("the signed-in wish list's account save", () => {
  it("a failed save (offline) says so; Try again and coming back online save again", async () => {
    api.mine.mockResolvedValue(null);
    api.save.mockRejectedValue(new TypeError("Failed to fetch"));
    addToWishList(A);
    const view = render(<Probe />);
    await waitFor(() => expect(view.container.querySelector("[data-problem]")?.textContent).toBe(WISH.syncFailed));
    expect(WISH.syncFailed).toBe("Couldn't save to your account just now. It's kept on this device and we'll try again.");
    const before = api.save.mock.calls.length;
    api.save.mockResolvedValue("abcdef123456");
    act(() => { retryWishListSync(); });
    await waitFor(() => expect(api.save.mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(view.container.querySelector("[data-problem]")?.textContent).toBe(""));
    api.save.mockClear();
    addToWishList({ href: her[1].href, name: her[1].name, guide: "her" });
    api.save.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(api.save).toHaveBeenCalled());
  });

  it("a list that already matches the account's is not saved again on arrival", async () => {
    api.mine.mockResolvedValue({ name: "", items: [{ g: "her", i: itemId(her[0].href) }], code: "abcdef123456" });
    api.save.mockResolvedValue("abcdef123456");
    render(<Probe />);
    await waitFor(() => expect(api.mine).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(api.save).not.toHaveBeenCalled();
  });
});
