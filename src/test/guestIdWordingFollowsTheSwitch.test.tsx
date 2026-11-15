/**
 * Q2788 (L003 follow-up): a signed-out visitor's ID wording (the legal short versions, /safety, the landing's trust
 * card) was a client constant, ID_CHECK_BEFORE_ANSWER = true, because a guest could not read identity_check
 * (features_open_to_everyone answers only the section switches). Had the owner turned ID checks off for everyone,
 * guests would still have read the ID rule. A guest now asks identity_check_on_for_everyone() (migration
 * 20261115181414, one boolean granted to anon; PGlite proof src/test/pglite/identityCheckOnForEveryone.pglite.mjs,
 * ALL PASS applied 3 times, RED with NEW_MIGRATION=skip) and the server's answer wins; the constant stands only
 * until it arrives, and when the read fails or the function is not deployed yet.
 *
 * @mutate src/lib/guestIdCheckAnswer.ts |     guestIdCheck = res.data; |     guestIdCheck = true;
 * @mutate src/lib/guestIdCheckAnswer.ts |     const res = await supabase.rpc("identity_check_on_for_everyone"); |     const res = await supabase.rpc("features_open_to_everyone");
 * @mutate src/lib/useIdCheckOnForViewer.ts |   if (!user) return guestAnswer ?? ID_CHECK_BEFORE_ANSWER; |   if (!user) return ID_CHECK_BEFORE_ANSWER;
 * @mutate src/lib/guestIdCheckAnswer.ts |     if (res.error) throw res.error; |     if (res.error) { guestIdCheck = false; guestIdCheckListeners.forEach((l) => l()); return; }
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, isReady: true }));
const rpc = vi.hoisted(() => vi.fn());
const memberOn = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/identityCheckSwitch", () => ({ useIdentityCheckOnStore: () => memberOn.on }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.unmock("@/lib/guestIdCheckAnswer"); // src/test/setup.ts answers null for every other test

async function freshHook() {
  vi.resetModules(); // the guest answer is asked once per page session (module state)
  const mod = await import("@/lib/useIdCheckOnForViewer");
  return { mod, view: renderHook(() => mod.useIdCheckOnForViewer()) };
}

beforeEach(() => {
  auth.user = null;
  auth.isReady = true;
  memberOn.on = false;
  rpc.mockReset();
});

describe("a guest's ID wording follows the identity_check switch (Q2788)", () => {
  it("the migration exposes exactly one boolean to anon (floor + shape)", () => {
    const sql = blankSqlComments(readFileSync(resolve(__dirname, "../../supabase/migrations/20261115181414_identity_check_on_for_everyone.sql"), "utf8"));
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.identity_check_on_for_everyone\(\)\s+RETURNS boolean/);
    expect(sql).toMatch(/WHERE key = 'identity_check'\s+AND audience = 'everyone'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.identity_check_on_for_everyone\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length).toBe(1);
  });

  it("guest, switch turned off for everyone: the answer, once in, says off", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { mod, view } = await freshHook();
    expect(view.result.current).toBe(mod.ID_CHECK_BEFORE_ANSWER); // before the answer: the rule true today
    await waitFor(() => expect(view.result.current).toBe(false));
    expect(rpc).toHaveBeenCalledWith("identity_check_on_for_everyone");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("guest, switch on for everyone: on", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { view } = await freshHook();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(view.result.current).toBe(true);
  });

  it("guest, the read fails or the function is not deployed yet: the constant stands", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const a = await freshHook();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(a.view.result.current).toBe(a.mod.ID_CHECK_BEFORE_ANSWER);
    a.view.unmount();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.identity_check_on_for_everyone without parameters", hint: null } });
    const b = await freshHook();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(b.view.result.current).toBe(b.mod.ID_CHECK_BEFORE_ANSWER);
  });

  it("member: their own switch answer, and no guest read", async () => {
    auth.user = { id: "u1" };
    memberOn.on = false;
    rpc.mockResolvedValue({ data: true, error: null });
    const { view } = await freshHook();
    await act(async () => {});
    expect(view.result.current).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
