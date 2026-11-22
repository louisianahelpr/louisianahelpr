/**
 * Secret Santa wish lists (owner 2026-11-21: "the person should list what they want from their Secret Santa; once they
 * have their list we create the links").
 *   - On their own reveal page a person types what they would like or pastes a link (the any-store box), or adds the
 *     gifts they saved; it is kept per group on the device (never in the planner, never with the reveal token).
 *   - "Send my list to my Santa" shares it as a lists share (names and refs: {r} for a gift from any store) and attaches
 *     the code through their own token; changed since, "Send the update".
 *   - Their Santa's reveal shows that list in place, with our links as we make them.
 *
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |       const ok = await setSecretSantaWishList(code, token, listCode); |       const ok = true;
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |   const isSent = !!sentCode && lastSent === signature; |   const isSent = !!sentCode;
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |       <AnyStoreAdd person={person} actions={actions} /> |       <AnyStoreAdd person={person} />
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |   const fromSaved = saved.picks.filter((s) => !person.ideas.some((i) => i.href === s.href)); |   const fromSaved = saved.picks;
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |   if (!list?.lists?.length) return null; |   if (!list) return null;
 * @mutate src/pages/info/giftGuides/fun/SecretSantaReveal.tsx | {state.r.matchWishList && <SantaTheirList listCode={state.r.matchWishList} />} | {null}
 * @mutate src/pages/info/giftGuides/fun/santaWishStore.ts |   if (next !== before) save({ ...cur, [code]: next }); |   save({ ...cur, [code]: next });
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |   const key = santaKey(code, me); |   const key = code;
 * @mutate src/pages/info/giftGuides/fun/SantaWishList.tsx |       const listCode = made.current?.signature === signature ? made.current.listCode : await shareGiftLists([share]); |       const listCode = await shareGiftLists([share]);
 * @mutate src/pages/info/giftGuides/fun/santaWishStore.ts |           if (!link \|\| link === i.href) return i; |           if (link \|\| link === i.href) return i;
 * @mutate src/pages/info/giftGuides/fun/santaWishStore.ts |         const person = GROUP.test(code) ? cleanPlan({ people: [p] }).people[0] : undefined; |         const person = cleanPlan({ people: [p] }).people[0];
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const fun = vi.hoisted(() => ({ reveal: vi.fn(), attach: vi.fn() }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: fun.reveal, setSecretSantaWishList: fun.attach, createSecretSanta: vi.fn(), SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(async () => null), saveAccountPlan: vi.fn(async () => undefined),
}));
const api = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), share: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  // A share now keeps a token to stop its link (wishListDelete1121.test.tsx); here it never reaches a server.
  claimShare: vi.fn(async () => undefined),
  requestWishLink: api.request, readWishLinks: api.read, shareGiftLists: api.share, getSharedList: api.get,
}));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import SecretSantaReveal from "@/pages/info/giftGuides/fun/SecretSantaReveal";
import { revealPath } from "@/content/giftGuideFun1120";
import { loadAllGuidePicks, guideBySlug } from "@/content/giftGuideCatalog";
import { resetSantaWishForTests, santaKey, santaWishActions } from "@/pages/info/giftGuides/fun/santaWishStore";
import { resetGiftListForTests, togglePick } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { resetPlanStoreForTests } from "@/pages/info/giftGuides/fun/plannerStore";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";

await loadAllGuidePicks();
const her = guideBySlug("her")!.picks;
const CODE = "abcdef0123";
const TOKEN = "d".repeat(64);
const KEY = santaKey(CODE, "Ann");
const R1 = "11111111-2222-4333-8444-555555555555";
const OURS = "https://ours.example.com/x?aff=lh";
const santa = () => JSON.parse(window.localStorage.getItem("lh-santa-wish") ?? "{}") as Record<string, { id: string; name: string; ideas: { name: string; req?: string; href?: string }[] }>;

const open = (match: string | null = null, mine: string | null = null) => {
  fun.reveal.mockResolvedValue({ name: "Ann", match: "Ben", budget: 25, exchangeOn: null, size: 4, matchWishList: match, myWishList: mine });
  return render(
    <MemoryRouter initialEntries={[revealPath(CODE, TOKEN)]}>
      <Routes><Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} /></Routes>
    </MemoryRouter>,
  ).container;
};
const type = (c: HTMLElement, text: string) => {
  fireEvent.change(c.querySelector("[data-santa-my-list] [data-anystore-input]")!, { target: { value: text } });
  fireEvent.click(c.querySelector("[data-santa-my-list] [data-anystore-go]")!);
};

beforeEach(() => {
  window.localStorage.clear();
  resetSantaWishForTests();
  resetPlanStoreForTests();
  for (const f of Object.values(fun)) f.mockReset();
  for (const f of Object.values(api)) f.mockReset();
  // Every request asked about still exists, with no link of ours yet.
  api.read.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, null])));
  api.request.mockResolvedValue({ id: R1, link: null });
  api.get.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  resetGiftListForTests();
  resetHintsForTests();
});

describe("a Secret Santa participant's own wish list", () => {
  it("a typed wish goes on this group's list (not the planner) and is sent to us under the list's own key, never the token", async () => {
    const c = open();
    await waitFor(() => expect(c.querySelector("[data-santa-my-list]")).not.toBeNull());
    type(c, "zzqx qqzz");
    await waitFor(() => expect(santa()[KEY]?.ideas[0]).toMatchObject({ name: "zzqx qqzz", req: R1 }));
    const key = santa()[KEY].id;
    expect(api.request).toHaveBeenCalledWith("idea", "zzqx qqzz", null, key, "Ann");
    expect(key).toMatch(/^[a-z0-9]{1,16}$/);
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    expect(window.localStorage.getItem(PLANNER_KEY)).toBeNull();
  });

  it("Send shares the list ({r} for gifts from any store) and attaches it through the person's token; a change offers Send the update", async () => {
    api.share.mockResolvedValue("aaaaaaaaaaaa");
    fun.attach.mockResolvedValue(true);
    const c = open();
    await waitFor(() => expect(c.querySelector("[data-santa-my-list]")).not.toBeNull());
    expect(c.querySelector("[data-reveal-share-mine]")).toBeNull();
    type(c, "zzqx qqzz");
    const btn = await waitFor(() => {
      const b = c.querySelector<HTMLButtonElement>("[data-reveal-share-mine]");
      expect(b?.textContent).toBe("Send my list to my Santa");
      return b!;
    });
    fireEvent.click(btn);

    await waitFor(() => expect(fun.attach).toHaveBeenCalledWith(CODE, TOKEN, "aaaaaaaaaaaa"));
    expect(api.share).toHaveBeenCalledWith([{ n: "Ann", items: [{ r: R1 }] }]);
    await waitFor(() => expect(c.querySelector("[data-reveal-share-mine]")?.textContent).toBe("Sent"));
    expect(c.querySelector<HTMLButtonElement>("[data-reveal-share-mine]")!.disabled).toBe(true);
    api.request.mockResolvedValue({ id: "11111111-2222-4333-8444-666666666666", link: null });
    type(c, "qqxx zzvv");
    await waitFor(() => expect(c.querySelector("[data-reveal-share-mine]")?.textContent).toBe("Send the update"));
  });

  it("two people of one group on one device each see only their own list, shared under their own name", async () => {
    santaWishActions(santaKey(CODE, "Ben"), "Ben").addIdea("x", { name: "Ben's own wish" });
    const c = open();
    await waitFor(() => expect(c.querySelector("[data-santa-my-list]")).not.toBeNull());
    expect(c.querySelector("[data-santa-my-list]")!.textContent).not.toContain("Ben's own wish");
    expect(c.querySelectorAll("[data-santa-wish-item]")).toHaveLength(0);
  });

  it("a failed attach is sent again with the same list, never a second share", async () => {
    api.share.mockResolvedValue("aaaaaaaaaaaa");
    fun.attach.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const c = open();
    await waitFor(() => expect(c.querySelector("[data-santa-my-list]")).not.toBeNull());
    type(c, "zzqx qqzz");
    const btn = await waitFor(() => {
      const b = c.querySelector<HTMLButtonElement>("[data-reveal-share-mine]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(c.querySelector("[data-reveal-share-msg]")?.textContent).toBe("We couldn't share your list. Try again."));
    fireEvent.click(c.querySelector("[data-reveal-share-mine]")!);
    await waitFor(() => expect(fun.attach).toHaveBeenCalledTimes(2));
    expect(api.share).toHaveBeenCalledTimes(1);
    expect(fun.attach.mock.calls.map((a) => a[2])).toEqual(["aaaaaaaaaaaa", "aaaaaaaaaaaa"]);
  });

  it("the gifts saved in the guides can be added in one tap, each once", async () => {
    togglePick({ href: her[0].href, name: her[0].name, guide: "her" });
    const c = open();
    const add = await waitFor(() => {
      const b = c.querySelector<HTMLButtonElement>("[data-santa-add-saved]");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(add);
    expect(santa()[KEY].ideas).toEqual([expect.objectContaining({ name: her[0].name, href: her[0].href, guide: "her" })]);
    await waitFor(() => {
      expect(santa()[KEY].ideas).toHaveLength(1);
      expect(c.querySelector("[data-santa-add-saved]")).toBeNull();
    });
  });

  it("our links made later are swapped in on this list; a request that is gone is forgotten", () => {
    const a = santaWishActions(KEY, "Ann");
    const one = a.addIdea("x", { name: "Scarf", href: "https://www.etsy.com/x" })!;
    a.setIdea("x", one, { req: R1 });
    const two = a.addIdea("x", { name: "Old" })!;
    a.setIdea("x", two, { req: "11111111-2222-4333-8444-999999999999" });
    a.applyOurLinks([R1, "11111111-2222-4333-8444-999999999999"], new Map([[R1, OURS]]));
    expect(santa()[KEY].ideas.map((i) => [i.href, i.req])).toEqual([[OURS, R1], [undefined, undefined]]);
    // A late answer for a gift that is gone writes nothing.
    const writes = vi.spyOn(Storage.prototype, "setItem");
    a.setIdea("x", "no-such-gift", { req: R1 });
    a.applyOurLinks([R1], new Map([[R1, OURS]]));
    expect(writes.mock.calls.filter(([k]) => k === "lh-santa-wish")).toHaveLength(0);
    writes.mockRestore();
  });
});

describe("their Santa sees the list in place", () => {
  it("the match's list shows on the reveal with our links, and Link coming soon until we make one", async () => {
    api.get.mockResolvedValue({ name: "Gift lists", items: [], lists: [{ name: "Ben", items: [], any: [{ id: R1, name: "Fly rod", href: OURS }, { id: "11111111-2222-4333-8444-666666666666", name: "Waders", href: null }] }] });
    const c = open("bbbbbbbbbbbb");
    await waitFor(() => expect(c.querySelector("[data-santa-their-list]")).not.toBeNull());
    expect(api.get).toHaveBeenCalledWith("bbbbbbbbbbbb");
    expect(c.querySelector("[data-santa-their-list]")!.textContent).toContain("Fly rod");
    expect([...c.querySelectorAll<HTMLAnchorElement>("[data-santa-their-list] [data-gift-out]")].map((x) => x.href)).toContain(OURS);
    expect(c.querySelector("[data-santa-their-list] [data-gift-shared-any-soon]")?.textContent).toBe("Link coming soon");
  });

  it("an older single wish list keeps only its link (nothing in place)", async () => {
    api.get.mockResolvedValue({ name: "Ben's list", items: [{ g: "her", i: "abc1" }] });
    const c = open("bbbbbbbbbbbb");
    await waitFor(() => expect(c.querySelector("[data-reveal-their-list]")).not.toBeNull());
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(c.querySelector("[data-santa-their-list]")).toBeNull();
  });

  it("a stored list under a key that is not a group code is never read", () => {
    window.localStorage.setItem("lh-santa-wish", JSON.stringify({ "not-a-code": { id: "s1", name: "X", ideas: [{ id: "1", name: "Y" }] }, [KEY]: { id: "s2", name: "Ann", ideas: [] } }));
    resetSantaWishForTests();
    const a = santaWishActions(KEY, "Ann");
    a.addIdea("s2", { name: "Mug" });
    expect(Object.keys(santa())).toEqual([KEY]);
  });
});
