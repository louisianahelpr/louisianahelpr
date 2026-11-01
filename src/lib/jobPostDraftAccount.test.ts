// @mutate src/lib/jobPostDraftAccount.ts | if (!(await signedIn())) return null; | void signedIn;
/**
 * The account's copy of a half-finished job post (OPS-3): signed out never calls the server, a failure never throws into
 * typing, and a read that fails or stalls answers null so Post a job doesn't wait. Mocked client: these don't prove the
 * server's rules (src/test/pglite/jobPostDrafts.pglite.mjs does).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, auth: { getSession: h.getSession } } }));

import { clearDraftOnAccount, readDraftFromAccount, saveDraftToAccount } from "./jobPostDraftAccount";

describe("the job draft kept on the account", () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.getSession.mockReset();
    h.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    h.rpc.mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signed out: nothing reaches the server, and the read answers null", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    await saveDraftToAccount({ title: "x" });
    await clearDraftOnAccount();
    expect(await readDraftFromAccount()).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("signed in: save sends the draft, clear calls clear, read returns the draft", async () => {
    await saveDraftToAccount({ title: "Mow" });
    expect(h.rpc).toHaveBeenCalledWith("save_my_job_post_draft", { p_draft: { title: "Mow" } });
    await clearDraftOnAccount();
    expect(h.rpc).toHaveBeenCalledWith("clear_my_job_post_draft");
    h.rpc.mockResolvedValue({ data: { title: "Mow" }, error: null });
    expect(await readDraftFromAccount()).toEqual({ title: "Mow" });
  });

  it("a server error or a throw is logged and never reaches the caller", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "draft_too_large" } });
    await expect(saveDraftToAccount({})).resolves.toBeUndefined();
    await expect(clearDraftOnAccount()).resolves.toBeUndefined();
    expect(await readDraftFromAccount()).toBeNull();
    h.rpc.mockRejectedValue(new Error("offline"));
    await expect(saveDraftToAccount({})).resolves.toBeUndefined();
    await expect(clearDraftOnAccount()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(5);
  });

  it("a read with no answer gives up, so Post a job never waits on it", async () => {
    vi.useFakeTimers();
    h.rpc.mockReturnValue(new Promise(() => undefined));
    const read = readDraftFromAccount();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await read).toBeNull();
  });
});
