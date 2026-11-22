/**
 * The gift lists' "links to create" queue (owner 2026-11-21: "people can put in the wish list or family can send each
 * other wish lists, we see the list, create the links if we don't have it, and send - they buy with our link";
 * "someone can just type in ideas ... and we find a link"). Server side: src/test/pglite/wishLinkRequests.pglite.mjs.
 *   - A pasted shop link or typed idea kept as typed is sent to us (wish_link_request_add); the gift keeps the request
 *     id, and our link (when the server already has one) replaces the pasted one. A failed send keeps the gift and says so.
 *   - Our links made later are swapped in when a list opens (useOurLinkSync -> planActions.applyOurLinks).
 *   - A share carries a gift from any store as {r}; the shared page shows its words and our link, or "Link coming soon".
 *   - Admin -> Wish list links lists the requests grouped by list and fills one with our link.
 *
 * @mutate src/pages/info/giftGuides/wishLinkSync.ts |     write.setIdea(person.id, idea.id, { req: a.id, ask: undefined, ...(a.link ? { href: a.link } : {}) }); |     write.setIdea(person.id, idea.id, { ask: undefined });
 * @mutate src/pages/info/giftGuides/AnyStoreAdd.tsx |       setNote(wishErrorCopy(e) ?? WISH.anyQueueFailed); |       void e;
 * @mutate src/pages/info/giftGuides/AnyStoreAdd.tsx |     queue({ name: words }); |     actions.addIdea(person.id, { name: words });
 * @mutate src/pages/info/giftGuides/AnyStoreAdd.tsx |     const id = actions.addIdea(person.id, { ...idea, ask: true }); |     const id = actions.addIdea(person.id, { ...idea });
 * @mutate src/pages/info/giftGuides/wishLinkSync.ts |     if (NEVER_PASSES.test(e instanceof Error ? e.message : "")) write.setIdea | if (false) write.setIdea
 * @mutate src/pages/info/giftGuides/wishLinkSync.ts |       askForLink(w.person, w.idea, write).catch( |       Promise.resolve().catch(
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |         if (!link \|\| link === i.href) return i; |         if (link \|\| link === i.href) return i;
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |         if (!found.has(i.req)) { |         if (false) {
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |     if (next !== p) changed = true; |     changed = true;
 * @mutate src/pages/info/giftGuides/saveForPeople.ts | : i.req ? [{ r: i.req }] : [])), | : [])),
 * @mutate src/content/giftGuideFun1120.ts | ...(typeof d.req === "string" && PLAN_REQ.test(d.req) ? { req: d.req } : {}), | ...(typeof d.req === "string" ? { req: d.req } : {}),
 * @mutate src/lib/giftWishListApi.ts | href: typeof x.h === "string" && /^https:\/\//.test(x.h) ? x.h : null, | href: typeof x.h === "string" ? x.h : null,
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx |           {!item.dismissed && <small | {true && <small
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx |           {(list.any ?? []).map((row) => <SharedAnyRow key={row.id} item={row} />)} |           {null}
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx |   if (item.href) return <WishRow | if (item.href && false) return <WishRow
 * @mutate src/components/admin/AdminWishLinks.tsx |   const ok = /^https:\/\/\S+\.\S+/.test(url.trim()); |   const ok = url.trim().length > 0;
 * @mutate src/components/admin/AdminWishLinks.tsx |           {saved && <p | {false && <p
 * @mutate src/components/admin/AdminWishLinks.tsx |     const g = groups.get(r.list_key) ?? { key: r.list_key, name: r.list_name, rows: [] }; |     const g = { key: r.list_key, name: r.list_name, rows: [] as WishLinkRow[] };
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/giftWishListApi", async (orig) => {
  const real = await orig<typeof import("@/lib/giftWishListApi")>();
  return { ...real, requestWishLink: api.request, readWishLinks: api.read };
});
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/toast", () => ({ errorToast: vi.fn(), successToast: vi.fn() }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(), setSecretSantaWishList: vi.fn(), createSecretSanta: vi.fn(), SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(), saveAccountPlan: vi.fn(),
}));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import AdminWishLinks, { groupByList, type WishLinkRow } from "@/components/admin/AdminWishLinks";
import { planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { privateIdeas, shareListOf } from "@/pages/info/giftGuides/saveForPeople";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { cleanPlan } from "@/content/giftGuideFun1120";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { asSharedList } from "@/lib/giftWishListApi";

await loadAllGuidePicks();
const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);
const R1 = "11111111-2222-4333-8444-555555555555";
const R2 = "11111111-2222-4333-8444-666666666666";
const OURS = "https://ours.example.com/scarf?aff=lh";

beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
  api.request.mockReset();
  api.read.mockReset();
  // Every request asked about still exists, with no link of ours yet.
  api.read.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, null])));
  rpc.mockReset();
});
afterEach(() => {
  cleanup();
  resetGiftListForTests();
  resetHintsForTests();
});

describe("a gift from any store is sent to us to make our link", () => {
  const start = async () => {
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    fireEvent.change(view.container.querySelector("[data-plan-new-name]")!, { target: { value: "Mom" } });
    fireEvent.click(view.container.querySelector("[data-plan-add-person]")!);
    const id = await waitFor(() => stored().people[0].id);
    return { c: view.container, id };
  };
  const go = (c: HTMLElement, id: string, text: string) => {
    fireEvent.change(c.querySelector(`[data-anystore-input="${id}"]`)!, { target: { value: text } });
    fireEvent.click(c.querySelector(`[data-anystore-go="${id}"]`)!);
  };

  it("a pasted shop link: queued with the person's list; the gift keeps the request and takes our link when there is one", async () => {
    api.request.mockResolvedValueOnce({ id: R1, link: OURS });
    const { c, id } = await start();
    go(c, id, "https://www.etsy.com/listing/99/hand-knit-scarf?utm_source=ig");
    fireEvent.click(c.querySelector("[data-anystore-add-link]")!);
    expect(api.request).toHaveBeenCalledWith("link", "Hand knit scarf", "https://www.etsy.com/listing/99/hand-knit-scarf", id, "Mom");
    await waitFor(() => expect(stored().people[0].ideas[0]).toMatchObject({ name: "Hand knit scarf", req: R1, href: OURS }));
  });

  it("typed words kept as typed are queued as an idea; a failed send keeps the gift and says so", async () => {
    api.request.mockRejectedValueOnce(Object.assign(new Error("rate_limited"), { copy: "Added. You've added a lot just now, so we'll look for its link later." }));
    const { c, id } = await start();
    go(c, id, "zzqx qqzz");
    expect(api.request).toHaveBeenCalledWith("idea", "zzqx qqzz", null, id, "Mom");
    await waitFor(() => expect(c.querySelector(`[data-anystore="${id}"] [role="status"]`)?.textContent).toBe("Added. You've added a lot just now, so we'll look for its link later."));
    expect(stored().people[0].ideas[0]).toMatchObject({ name: "zzqx qqzz", ask: true });
    expect(stored().people[0].ideas[0].req).toBeUndefined();
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("a gift still waiting to be sent is sent again when the planner opens; a refusal that never passes stops the asking", async () => {
    setPlanViewer(null);
    const pid = planActions.addPerson("Dad")!;
    const a = planActions.addIdea(pid, { name: "Fishing reel", ask: true })!;
    const b = planActions.addIdea(pid, { name: "Bad name", ask: true })!;
    api.request.mockImplementation(async (_k: string, words: string) => {
      if (words === "Bad name") throw new Error("invalid_words");
      return { id: R1, link: null };
    });
    render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    await waitFor(() => expect(stored().people[0].ideas.find((i) => i.id === a)).toMatchObject({ req: R1 }));
    expect(stored().people[0].ideas.find((i) => i.id === a)?.ask).toBeUndefined();
    await waitFor(() => expect(stored().people[0].ideas.find((i) => i.id === b)?.ask).toBeUndefined());
    expect(stored().people[0].ideas.find((i) => i.id === b)?.req).toBeUndefined();
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it("our links made later replace the pasted link when the planner opens; a request that is gone is forgotten", async () => {
    setPlanViewer(null);
    const pid = planActions.addPerson("Dad")!;
    const ideaId = planActions.addIdea(pid, { name: "Scarf", href: "https://www.etsy.com/listing/99/scarf" })!;
    planActions.setIdea(pid, ideaId, { req: R2 });
    const goneId = planActions.addIdea(pid, { name: "Old", href: "https://www.etsy.com/listing/1/old" })!;
    planActions.setIdea(pid, goneId, { req: R1 });
    api.read.mockResolvedValue(new Map([[R2, OURS]]));
    render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    await waitFor(() => expect(api.read).toHaveBeenCalledWith([R1, R2]));
    await waitFor(() => expect(stored().people[0].ideas[0].href).toBe(OURS));
    expect(stored().people[0].ideas[1].req).toBeUndefined();
    expect(stored().people[0].ideas[1].href).toBe("https://www.etsy.com/listing/1/old");
  });

  it("an answer for a person or gift that is gone writes nothing (no newer, emptier plan)", () => {
    setPlanViewer(null);
    const pid = planActions.addPerson("Dad")!;
    const writes = vi.spyOn(Storage.prototype, "setItem");
    planActions.setIdea(pid, "no-such-idea", { req: R1 });
    planActions.setIdea("no-such-person", "x", { req: R1 });
    expect(writes.mock.calls.filter(([k]) => k === PLANNER_KEY)).toHaveLength(0);
    writes.mockRestore();
  });
});

describe("sharing a gift from any store", () => {
  it("a share carries it as {r}; a typed idea never sent to us stays private; cleanPlan keeps only a real request id", () => {
    const person = { id: "p1", name: "Mom", ideas: [
      { id: "a", name: "From guide", bought: false, guide: "her", href: "https://www.amazon.com/dp/B0TEST0001?tag=louisianahelpr-20" },
      { id: "b", name: "Scarf", bought: false, href: "https://www.etsy.com/x", req: R1 },
      { id: "c", name: "Old typed idea", bought: false },
    ] };
    expect(shareListOf(person).items).toEqual([expect.objectContaining({ g: "her" }), { r: R1 }]);
    expect(privateIdeas([person])).toBe(1);
    const back = cleanPlan({ people: [{ id: "p", name: "M", ideas: [{ id: "1", name: "A", req: R1 }, { id: "2", name: "B", req: "not-a-uuid" }] }] });
    expect(back.people[0].ideas.map((i) => i.req)).toEqual([R1, undefined]);
  });

  it("the shared list reads {r, w, h}: our https link or none; a list without them reads as before", () => {
    const l = asSharedList({ name: "Gift lists", items: [], lists: [{ n: "Mom", items: [
      { g: "her", i: "abc1" }, { r: R1, w: "Scarf", h: OURS }, { r: R2, w: "Locket", h: null }, { r: "bad", w: "X", h: OURS }, { r: R2, w: "Evil", h: "javascript:alert(1)" },
    ] }] });
    expect(l?.lists?.[0]).toEqual({ name: "Mom", items: [{ g: "her", i: "abc1" }], any: [
      { id: R1, name: "Scarf", href: OURS }, { id: R2, name: "Locket", href: null }, { id: R2, name: "Evil", href: null },
    ] });
    expect(asSharedList({ name: "x", items: [], lists: [{ n: "Mom", items: [{ g: "her", i: "abc1" }] }] })?.lists?.[0]).toEqual({ name: "Mom", items: [{ g: "her", i: "abc1" }] });
  });

  it("the shared page shows our link as Shop, and Link coming soon (no link) until we make it; both count", async () => {
    const read = vi.fn(async () => ({ name: "Gift lists", items: [], lists: [{ name: "Mom", items: [], any: [{ id: R1, name: "Scarf", href: OURS }, { id: R2, name: "Locket", href: null }] }] }));
    const view = render(<MemoryRouter><GiftGuideSharedList code="cccccccccccc" read={read} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector("[data-gift-shared-any-soon]")?.textContent).toBe("Link coming soon"));
    const shops = [...view.container.querySelectorAll<HTMLAnchorElement>("[data-gift-out]")].map((a) => a.href);
    expect(shops).toContain(OURS);
    expect(view.container.querySelector(`[data-gift-shared-any="${R2}"] a`)).toBeNull();
    expect(view.container.querySelector("[data-gift-shared-person-total]")?.textContent).toMatch(/^2 gifts/);
  });

  it("a gift we dismissed shows its words only, never promising a link", async () => {
    const R3 = "11111111-2222-4333-8444-777777777777";
    const read = vi.fn(async () => ({ name: "Gift lists", items: [], lists: [{ name: "Mom", items: [], any: [{ id: R3, name: "Moon rock", href: null, dismissed: true as const }] }] }));
    const view = render(<MemoryRouter><GiftGuideSharedList code="cccccccccccc" read={read} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector(`[data-gift-shared-any="${R3}"]`)?.textContent).toBe("MMoon rock"));
    expect(view.container.querySelector("[data-gift-shared-any-soon]")).toBeNull();
    expect(asSharedList({ name: "x", items: [], lists: [{ n: "Mom", items: [{ r: R3, w: "Moon rock", h: null, d: true }] }] })?.lists?.[0].any).toEqual([{ id: R3, name: "Moon rock", href: null, dismissed: true }]);
  });
});

describe("Admin -> Wish list links", () => {
  const row = (o: Partial<WishLinkRow>): WishLinkRow => ({ id: R1, kind: "link", words: "Scarf", url: "https://www.etsy.com/x", list_key: "p1", list_name: "Mom", status: "open", affiliate_url: null, created_at: "2026-11-21T20:00:00Z", ...o });

  it("groups by list, lists with waiting gifts first", () => {
    const g = groupByList([row({ id: "1", list_key: "a", list_name: "Ann", status: "filled", affiliate_url: OURS }), row({ id: "2", list_key: "b", list_name: "Bo" }), row({ id: "3", list_key: "a", list_name: "Ann" })]);
    expect(g.map((x) => [x.name, x.rows.map((r) => r.id)])).toEqual([["Ann", ["1", "3"]], ["Bo", ["2"]]]);
    const g2 = groupByList([row({ id: "1", list_key: "a", status: "filled", affiliate_url: OURS }), row({ id: "2", list_key: "b" })]);
    expect(g2[0].key).toBe("b");
  });

  it("shows each gift in the person's words under their list; Save sends our https link (a non-https one cannot be saved)", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "admin_wish_link_requests"
      ? { data: [row({}), row({ id: R2, kind: "idea", words: "LSU hoodie size M", url: null, list_key: "p2", list_name: "Dad" })], error: null }
      : { data: { id: R1, also_filled: 2 }, error: null }));
    const view = render(<QueryClientProvider client={new QueryClient()}><AdminWishLinks /></QueryClientProvider>);
    await waitFor(() => expect(view.container.querySelectorAll("[data-admin-wish-list]")).toHaveLength(2));
    expect(view.container.querySelector('[data-admin-wish-list="p2"]')?.textContent).toContain("LSU hoodie size M");
    const input = view.container.querySelector<HTMLInputElement>(`[data-admin-wish-link-url="${R1}"]`)!;
    const save = view.container.querySelector<HTMLButtonElement>(`[data-admin-wish-link-save="${R1}"]`)!;
    fireEvent.change(input, { target: { value: "http://ours.example.com/x" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: OURS } });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_wish_link_request_fill", { p_id: R1, p_url: OURS }));
    await waitFor(() => expect(view.container.querySelector("[data-admin-wish-links-saved]")?.textContent).toBe("Saved. 2 more lists with the same gift got it too."));
  });

  it("is a real /admin view with a menu row", () => {
    const admin = readFileSync(join(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8");
    expect(admin).toContain('case "wishlinks": return <AdminWishLinks />;');
    expect(admin).toContain('wishlinks: "Wish list links"');
    expect(readFileSync(join(process.cwd(), "src/components/admin/adminNavGroups.tsx"), "utf8")).toContain('{ id: "wishlinks", label: "Wish list links", icon: ListPlus }');
  });
});
