/**
 * Holiday audit 1121 (High): the gift planner's account sync replaced the account's whole plan with a newer device
 * copy (a 5-person laptop plan lost to a 1-person phone draft), and the planner took edits before the account copy
 * loaded. Now the two are merged by id (everything either side holds, this device's removals kept, the newer version of
 * a shared person or idea), and nothing on the planner can be changed until the merge is done.
 *
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |         const take = remote ? mergePlans(remote, local, mine ? c.removed ?? [] : []) : local; |         const take = remote && remote.updatedAt > local.updatedAt ? remote : local;
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |       if (seen.has(x.id) \|\| gone.has(x.id)) continue; |       if (seen.has(x.id)) continue;
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |   const removed = [...(readCopy().removed ?? []), ...gone].filter((id) => !present.has(id)).slice(-500); |   const removed = [...(readCopy().removed ?? []), ...gone].slice(-500);
 * @mutate src/pages/info/giftGuides/fun/plannerStore.ts |   const people = byId(first.people, second.people, (a, b) => ({ ...a, ideas: byId(a.ideas, b.ideas, (x) => x, PLAN_MAX_IDEAS) }), PLAN_MAX_PEOPLE); |   const people = byId(first.people, second.people, (a) => a, PLAN_MAX_PEOPLE);
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |       <fieldset className="m-0 min-w-0 border-0 p-0" disabled={!ready} | <fieldset className="m-0 min-w-0 border-0 p-0" disabled={false}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: "acct-1" } as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));
const fun = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(), setSecretSantaWishList: vi.fn(), createSecretSanta: vi.fn(), SantaSaveError: class extends Error {},
  loadAccountPlan: fun.load, saveAccountPlan: fun.save,
}));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  readWishLinks: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, null]))),
  requestWishLink: vi.fn(),
}));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { mergePlans, planActions, resetPlanStoreForTests, setPlanViewer } from "@/pages/info/giftGuides/fun/plannerStore";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { cleanPlan, type GiftPlan, type PlanPerson } from "@/content/giftGuideFun1120";

const person = (id: string, name: string, ideas: string[] = []): PlanPerson => ({ id, name, ideas: ideas.map((i) => ({ id: i, name: i, bought: false })) });
const plan = (updatedAt: number, people: PlanPerson[]): GiftPlan => ({ updatedAt, people });
const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);

beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
  fun.load.mockReset();
  fun.save.mockReset();
  fun.save.mockResolvedValue(undefined);
  auth.user = { id: "acct-1" };
});
afterEach(() => cleanup());

describe("merging the account's plan and this device's", () => {
  it("account 3 people + a newer device draft with 1 person = 4 (none replaced)", () => {
    const merged = mergePlans(plan(100, [person("a", "Mom"), person("b", "Dad"), person("c", "Jake")]), plan(200, [person("d", "Zander")]));
    expect(merged.people.map((p) => p.name).sort()).toEqual(["Dad", "Jake", "Mom", "Zander"]);
    expect(merged.updatedAt).toBe(200);
  });

  it("the same person on both sides: the newer version, with both sides' ideas", () => {
    const merged = mergePlans(plan(100, [person("a", "Mom", ["x", "y"])]), plan(200, [person("a", "Mama", ["y", "z"])]));
    expect(merged.people).toHaveLength(1);
    expect(merged.people[0].name).toBe("Mama");
    expect(merged.people[0].ideas.map((i) => i.id).sort()).toEqual(["x", "y", "z"]);
  });

  it("this device's removals stay removed; an older device copy never wins a shared person", () => {
    const merged = mergePlans(plan(300, [person("a", "Mom", ["x", "y"]), person("b", "Dad")]), plan(200, [person("a", "Old name", ["x"])]), ["b", "y"]);
    expect(merged.people.map((p) => p.id)).toEqual(["a"]);
    expect(merged.people[0].name).toBe("Mom");
    expect(merged.people[0].ideas.map((i) => i.id)).toEqual(["x"]);
  });

  it("a removal undone on this device is not kept as a removal", () => {
    setPlanViewer(null);
    const id = planActions.addPerson("Ann")!;
    const ideaId = planActions.addIdea(id, { name: "Mug" })!;
    const idea = stored().people[0].ideas[0];
    planActions.removeIdea(id, ideaId);
    expect((JSON.parse(window.localStorage.getItem(PLANNER_KEY)!) as { removed?: string[] }).removed).toContain(ideaId);
    planActions.restoreIdea(id, idea, 0);
    expect((JSON.parse(window.localStorage.getItem(PLANNER_KEY)!) as { removed?: string[] }).removed ?? []).not.toContain(ideaId);
  });
});

describe("signing in on a device with a newer draft", () => {
  it("the planner shows and saves all 4 people, and nothing can be edited until the account's plan is in", async () => {
    window.localStorage.setItem(PLANNER_KEY, JSON.stringify({ ownerId: null, plan: plan(Date.now(), [person("d", "Zander")]) }));
    let release: (p: GiftPlan) => void = () => undefined;
    fun.load.mockReturnValue(new Promise<GiftPlan>((r) => { release = r; }));
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector("[data-plan-loading]")).not.toBeNull());
    expect(view.container.querySelector<HTMLInputElement>("[data-plan-new-name]")!.closest("fieldset")!.disabled).toBe(true);
    expect(view.container.querySelector("[data-plan-empty]")).toBeNull();
    release(plan(100, [person("a", "Mom"), person("b", "Dad"), person("c", "Jake")]));
    await waitFor(() => expect(stored().people.map((p) => p.name).sort()).toEqual(["Dad", "Jake", "Mom", "Zander"]));
    await waitFor(() => expect(fun.save).toHaveBeenCalled());
    const sent = fun.save.mock.calls[0][1] as GiftPlan;
    expect(sent.people).toHaveLength(4);
    expect(view.container.querySelector<HTMLInputElement>("[data-plan-new-name]")!.closest("fieldset")!.disabled).toBe(false);
  });
});
