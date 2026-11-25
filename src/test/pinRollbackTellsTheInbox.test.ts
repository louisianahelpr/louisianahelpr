/**
 * Deep audit 11-22 #139: a pin that failed to save kept showing as pinned, with no message.
 *
 * Swiping a thread right pinned it at once (optimistic); the POST to thread_pins was refused, and togglePinned rolled
 * back its cache and mirror, but the inbox re-reads the set only when its pin nonce moves, and nothing moved it. So the
 * row stayed on top with the pin icon until a reload, and no toast said the pin had not saved.
 *
 * Fix: the rollback fires PIN_ROLLED_BACK_EVENT ({ pinned, gone }); the inbox (useConversationListState) bumps its pin
 * nonce on it and, unless the thread's job is gone (23503, dropped silently as before), shows an error toast. The
 * rollback also bumps the load generation, so a loadPins already in flight cannot write its older snapshot back.
 *
 * @mutate src/lib/pinnedConversations.ts |       window.dispatchEvent(new CustomEvent<PinRolledBackDetail>(PIN_ROLLED_BACK_EVENT, { detail: { pinned: next, gone } })); |       void next;
 * @mutate src/components/messages/useConversationListState.ts |     window.addEventListener(PIN_ROLLED_BACK_EVENT, onPinRolledBack); |     void onPinRolledBack;
 * @mutate src/components/messages/useConversationListState.ts |       if (detail && !detail.gone) toast.error( |       if (false) toast.error(
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const JOB = "00000000-0000-4000-8000-000000000003";

let failWith: { code: string; message: string } | null = null;
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: failWith }),
      delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: failWith }) }) }) }),
    }),
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  failWith = null;
  localStorage.clear();
  vi.resetModules();
});

async function toggleAndCollect(): Promise<{ details: unknown[]; pinnedAfter: boolean }> {
  const mod = await import("@/lib/pinnedConversations");
  const details: unknown[] = [];
  const on = (e: Event) => details.push((e as CustomEvent).detail);
  window.addEventListener(mod.PIN_ROLLED_BACK_EVENT, on);
  try {
    expect(mod.togglePinned(ME, JOB, OTHER)).toBe(true);
    await settle();
    return { details, pinnedAfter: mod.getPinnedSet(ME).has(mod.pinnedKey(JOB, OTHER)) };
  } finally {
    window.removeEventListener(mod.PIN_ROLLED_BACK_EVENT, on);
  }
}

describe("deep audit 11-22 #139: a refused pin tells the inbox", () => {
  it("a refused pin rolls back AND fires the event the inbox re-reads on", async () => {
    failWith = { code: "42501", message: "new row violates row-level security policy" };
    const { details, pinnedAfter } = await toggleAndCollect();
    expect(pinnedAfter).toBe(false);
    expect(details).toEqual([{ pinned: true, gone: false }]);
  });

  it("a gone thread (23503) still rolls back and refreshes, marked gone so no toast is shown", async () => {
    failWith = { code: "23503", message: 'violates foreign key constraint "thread_pins_job_id_fkey"' };
    const { details } = await toggleAndCollect();
    expect(details).toEqual([{ pinned: true, gone: true }]);
  });

  it("a saved pin fires nothing", async () => {
    const { details, pinnedAfter } = await toggleAndCollect();
    expect(pinnedAfter).toBe(true);
    expect(details).toEqual([]);
  });

  it("the inbox listens: bumps its pin nonce and toasts unless gone", () => {
    const hook = blankComments(readFileSync(join(process.cwd(), "src/components/messages/useConversationListState.ts"), "utf8"));
    const at = hook.indexOf("const onPinRolledBack = (e: Event) => {");
    expect(at).toBeGreaterThan(0);
    const body = hook.slice(at, at + 600);
    expect(body).toContain("setPinNonce((n) => n + 1);");
    expect(body).toContain("if (detail && !detail.gone) toast.error(");
    expect(hook).toContain("window.addEventListener(PIN_ROLLED_BACK_EVENT, onPinRolledBack);");
    expect(hook).toContain("window.removeEventListener(PIN_ROLLED_BACK_EVENT, onPinRolledBack);");
  });
});
