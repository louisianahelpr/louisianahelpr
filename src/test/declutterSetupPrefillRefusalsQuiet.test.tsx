/**
 * Q1943: Post a Job's Declutter "Add a Helpr" pre-fill (`?declutterOrder=`) does not log a designed refusal
 * (a code declutter_setup_helpr raises that has words, e.g. item_not_found) to error_logs; it still tells the buyer.
 * An error with no words is still reported.
 *
 * @mutate src/pages/post-job/useJobFormEffects.ts |         if ((err as { designedRefusal?: unknown } \| null)?.designedRefusal !== true) { |         if (true) {
 * @mutate src/lib/declutter/setupHelpr.ts | Object.assign(e, { userMessage: msg, designedRefusal: true }); | Object.assign(e, { userMessage: msg });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpcError: null as null | { message: string; code?: string }, toasts: [] as string[] }));
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("sonner", () => ({ toast: Object.assign((m: string) => h.toasts.push(m), { error: (m: string) => h.toasts.push(`error:${m}`), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (fn: string) => (fn === "declutter_setup_helpr" ? { data: null, error: h.rpcError } : { data: null, error: null }), from: () => ({}) },
}));

import { useJobFormEffects } from "@/pages/post-job/useJobFormEffects";

const noop = () => undefined;
function params(): never {
  const sp = new URLSearchParams("declutterOrder=33333333-3333-4333-8333-333333333333&help=assembly");
  return new Proxy({}, {
    get: (_t, k) => {
      if (k === "searchParams") return sp;
      if (k === "profile" || k === "offerToHelperId") return null;
      if (typeof k === "string" && /^(set|flush|save|on)[A-Z]/.test(k)) return noop;
      if (k === "helpersNeeded") return "1";
      if (k === "credentialTier") return 0;
      return typeof k === "string" && /^(is|include)/.test(k) ? false : "";
    },
  }) as never;
}

beforeEach(() => {
  report.mockClear();
  h.toasts.length = 0;
});

describe("Add a Helpr pre-fill: designed refusals are not logged (Q1943)", () => {
  it("item_not_found (a code with words): the buyer is told, nothing is reported", async () => {
    h.rpcError = { message: "item_not_found", code: "P0001" };
    renderHook(() => useJobFormEffects(params()));
    await waitFor(() => expect(h.toasts).toContain("error:Couldn't load that purchase. Fill in the job yourself."));
    expect(report.mock.calls.filter((c) => (c[1] as { tags?: { source?: string } })?.tags?.source === "useJobFormEffects.declutterSetupPrefill")).toEqual([]);
  });

  it("an error with no words is still reported", async () => {
    h.rpcError = { message: "relation \"x\" does not exist", code: "42P01" };
    renderHook(() => useJobFormEffects(params()));
    await waitFor(() => expect(report.mock.calls.some((c) => (c[1] as { tags?: { source?: string } })?.tags?.source === "useJobFormEffects.declutterSetupPrefill")).toBe(true));
  });
});
