/**
 * F303 (whole-app audit 11-10): the post flow's screens lived in React state, so the browser's Back on any step left
 * /post-job (the audit went from step 4 to /messages). Each forward move now pushes a same-URL entry tagged with its
 * depth (usePostStepHistory): Back steps the form back one screen with the fields kept, the page's back arrow pops
 * only an entry the flow pushed, and Back on the first screen still leaves the flow.
 *
 * Harness: the real usePostJobForm under a MemoryRouter that starts on /messages -> /post-job; Back is the router's
 * navigate(-1), as a popstate is. Red first (2026-11-11) on 54101db804: the first Back left for /messages.
 *
 * @mutate src/pages/post-job/usePostStepHistory.ts |       if (t < depth) back.current(); |       if (false) back.current();
 * @mutate src/pages/post-job/usePostStepHistory.ts |     if (depth > (tag ?? base.current)) { |     if (false) {
 * @mutate src/pages/post-job/usePostStepHistory.ts |       if (pushed !== null) navigate(-pushed); |       if (pushed !== null) navigate(-(tag as number));
 * @mutate src/pages/post-job/usePostStepHistory.ts |       if (pushed !== null) navigate(-pushed); |       if (false) navigate(-pushed);
 *
 * Audit 11-21 (High): a reload mid-post went back by the depth tag, but the depth skips (groups 0 -> kinds 2), so it
 * overshot /post-job to /home or about:blank. The mount now goes back by the count of entries the flow pushed.
 * Red first (2026-11-21) on f21fdc64ab: "reload at When-and-where left Post a job".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const result = { data: null, error: null, count: 0 };
  for (const k of ["select", "eq", "neq", "in", "not", "or", "is", "gte", "lte", "gt", "lt", "order", "limit", "range", "filter", "match", "contains"]) chain[k] = () => chain;
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, loading: false }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => [], usePostedBefore: () => false }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));

import { usePostJobForm } from "./usePostJobForm";
import { postScreenDepth, postStepFromHistory } from "./usePostStepHistory";

const mount = (entries: Array<string | { pathname: string; state?: unknown }> = ["/messages", "/post-job"]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ form: usePostJobForm(), location: useLocation(), navigate: useNavigate() }), { wrapper });
};
type Hook = ReturnType<typeof mount>["result"];
const browserBack = async (r: Hook) => { await act(async () => { r.current.navigate(-1); }); };
/** A group tile on the first screen (EntryChoice), then a kind (JobCategoryGroups' onPicked). */
const toDetails = async (r: Hook) => {
  await act(async () => { r.current.form.startFresh(); r.current.form.setFormPage(1); r.current.form.setCategoryGroup("home"); });
  await act(async () => { r.current.form.setCategory("cleaning"); r.current.form.setTitle("Clean the kitchen"); });
  await act(async () => { r.current.form.setCategoryGroup(null); r.current.form.setFormPage(2); });
};

beforeEach(() => cleanup());

describe("F303: Back inside the post flow goes to the previous step", () => {
  it("the depth reads every screen in order, and only this flow's tag counts", () => {
    const at = (o: Partial<Parameters<typeof postScreenDepth>[0]>) => postScreenDepth({ step: "form", formPage: 1, entryPanel: null, categoryGroup: null, skipEntry: false, ...o });
    expect([at({ step: "entry" }), at({ step: "entry", entryPanel: "ai" }), at({ categoryGroup: "home" }), at({ formPage: 2 }), at({ formPage: 3 }), at({ formPage: 4 }), at({ step: "checkout" })]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(at({ skipEntry: true }), "a deep link's first screen has nothing behind it").toBe(0);
    expect(postStepFromHistory({ postStep: 3 })).toBe(3);
    expect([postStepFromHistory(null), postStepFromHistory({ step: 2 }), postStepFromHistory({ postStep: "3" }), postStepFromHistory({ postStep: 0 })]).toEqual([null, null, null, null]);
  });

  it("forward then browser Back walks the screens back, fields kept, and Back on the first screen leaves as before", async () => {
    const { result: r } = mount();
    await toDetails(r);
    expect(r.current.form.formPage).toBe(2);
    // Inventory floor: the flow pushed one entry per forward screen (the kinds, then Details).
    expect(postStepFromHistory(r.current.location.state)).toBe(3);

    await browserBack(r);
    expect(r.current.location.pathname, "Back from Details left the post flow").toBe("/post-job");
    expect(r.current.form.step).toBe("form");
    expect(r.current.form.formPage).toBe(1);
    expect(r.current.form.categoryGroup, "Back from Details is the group's kinds").toBe("home");
    expect(r.current.form.title, "the typed title was lost").toBe("Clean the kitchen");

    await browserBack(r);
    expect(r.current.location.pathname).toBe("/post-job");
    expect(r.current.form.step, "Back from the kinds is the groups").toBe("entry");

    await browserBack(r);
    expect(r.current.location.pathname, "Back on the first screen leaves the flow, as before").toBe("/messages");
  });

  it("the page's back arrow pops the entry the flow pushed, so the next browser Back is not a dead press", async () => {
    const { result: r } = mount();
    await toDetails(r);
    await act(async () => { r.current.form.handlePostJobBack(); });
    expect(r.current.form.formPage).toBe(1);
    expect(r.current.form.categoryGroup).toBe("home");
    expect(postStepFromHistory(r.current.location.state), "the arrow forked the history instead of popping").toBe(2);
    await browserBack(r);
    expect(r.current.form.step).toBe("entry");
    expect(r.current.location.pathname).toBe("/post-job");
  });

  it("a reload mid-post stays on /post-job: the mount goes back by the entries the flow pushed, not by the depth tag", async () => {
    // Audit 11-21 (High): the groups (depth 0) jump straight to a group's kinds (2), so the flow pushes fewer
    // entries than the depth tag says. Going back by the tag overshot past /post-job (to /home, or to about:blank
    // when /post-job was the tab's first page). Record the real entries the flow pushes, then remount on them.
    const { result: r, unmount } = mount();
    const pushed: Array<{ pathname: string; state: unknown }> = [];
    const record = () => { const st = r.current.location.state; if (postStepFromHistory(st) !== null) pushed.push({ pathname: "/post-job", state: st }); };
    await act(async () => { r.current.form.startFresh(); r.current.form.setFormPage(1); r.current.form.setCategoryGroup("home"); });
    record();
    await act(async () => { r.current.form.setCategory("cleaning"); r.current.form.setTitle("Clean the kitchen"); });
    await act(async () => { r.current.form.setCategoryGroup(null); r.current.form.setFormPage(2); });
    record();
    await act(async () => { r.current.form.setFormPage(3); });
    record();
    unmount();
    // Inventory floor: three forward screens pushed three entries, and the deepest tag (4) exceeds that count.
    expect(pushed.length).toBe(3);
    expect(postStepFromHistory(pushed[2].state)).toBeGreaterThan(pushed.length);

    for (const first of [["/home", "/post-job"], ["/post-job"]]) {
      cleanup();
      const { result: r2 } = mount([...first, ...pushed]);
      await act(async () => {});
      expect(r2.current.location.pathname, `reload at When-and-where left Post a job (history ${first.join(" > ")})`).toBe("/post-job");
      expect(postStepFromHistory(r2.current.location.state), "the reload did not return to the flow's first entry").toBeNull();
    }
  });

  it("landing on an entry the flow pushed (a reload, or Back from the page a posted job went to) returns to the flow's first entry", async () => {
    const { result: r } = mount([
      "/messages",
      "/post-job",
      { pathname: "/post-job", state: { postStep: 2, postPushed: 1 } },
      { pathname: "/post-job", state: { postStep: 3, postPushed: 2 } },
    ]);
    await act(async () => {});
    expect(postStepFromHistory(r.current.location.state), "a finished form's entries were left to walk").toBeNull();
    expect(r.current.location.pathname, "the flow's first entry is still Post a job").toBe("/post-job");
    await browserBack(r);
    expect(r.current.location.pathname).toBe("/messages");
  });
});
