/**
 * Q1942: a Declutter "Add a Helpr" job whose link to its paid order fails at posting is tried once more, remembered,
 * linked again on PaymentSuccess, and told THERE when it still fails. Posting redirects to Stripe a second after its
 * toast, so a failure told only at posting was effectively never read (lh-silent-failure@c57d948d0#4).
 *
 * @mutate src/pages/post-job/useTellPendingSetupLink.ts |       if (result.ok) return; |       return;
 * @mutate src/lib/declutter/setupLinkPending.ts |       if (why) return last; |       if (why) continue;
 * @mutate src/lib/declutter/setupLinkPending.ts |   for (let attempt = 0; attempt < 2; attempt += 1) { |   for (let attempt = 0; attempt < 1; attempt += 1) {
 * @mutate src/pages/post-job/PaymentSuccess.tsx |   useTellPendingSetupLink(resolvedJobId); |   void resolvedJobId;
 * @mutate src/lib/authSignOut.ts |   clearPendingSetupLink();\n |   void 0;\n
 * @mutate src/pages/post-job/useJobSubmit.ts |     pending?.clearPendingSetupLink(); |     void pending;
 * @mutate src/lib/declutter/setupLinkPending.ts |   safeStorage.setItem(SETUP_LINK_PENDING_KEY, JSON.stringify(p)); |   safeStorage.setItem(SETUP_LINK_PENDING_KEY, JSON.stringify({ ...p, at: Date.now() }));
 *
 * The link itself is idempotent (lead's condition for the retry, 11-02): declutter_link_setup_job answers yes at once
 * for the caller's job already linked to the caller's order, inserts ON CONFLICT (job_id) DO NOTHING, moves no money
 * and sends no notice, and no trigger sits on declutter_order_jobs. Proven in src/test/pglite/declutterAddAHelpr.pglite.mjs
 * H5 (a second link leaves one row and the job's status and payment_status unchanged).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const linkSetupJob = vi.fn<(orderId: string, jobId: string) => Promise<boolean>>();
const toastError = vi.fn();
vi.mock("@/lib/declutter/setupHelpr", () => ({ linkSetupJob: (o: string, j: string) => linkSetupJob(o, j) }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/chunkReload", () => ({ backgroundImport: <T,>(load: () => Promise<T>) => load() }));

import {
  SETUP_LINK_PENDING_KEY,
  linkSetupJobOnceMore,
  rememberPendingSetupLink,
  takePendingSetupLink,
} from "@/lib/declutter/setupLinkPending";
import { useTellPendingSetupLink } from "@/pages/post-job/useTellPendingSetupLink";

const ORDER = "40000000-0000-4000-8000-000000000004";
const JOB = "10000000-0000-4000-8000-000000000001";
const callFailed = () => Object.assign(new Error("Failed to fetch"), {});
const refused = () => Object.assign(new Error("declutter_switch_off"), { userMessage: "Declutter is paused right now." });

beforeEach(() => {
  linkSetupJob.mockReset();
  toastError.mockReset();
  localStorage.clear();
});

describe("the link is tried once more only when the call failed", () => {
  it("a failed call, then a link: linked, two calls", async () => {
    const link = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(callFailed()).mockResolvedValueOnce(true);
    expect(await linkSetupJobOnceMore(link)).toEqual({ ok: true });
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("two failed calls: not linked, two calls", async () => {
    const link = vi.fn<() => Promise<boolean>>().mockRejectedValue(callFailed());
    expect((await linkSetupJobOnceMore(link)).ok).toBe(false);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("a refusal the server explains is final: one call, its words kept", async () => {
    const link = vi.fn<() => Promise<boolean>>().mockRejectedValue(refused());
    const r = await linkSetupJobOnceMore(link);
    expect(r).toMatchObject({ ok: false, why: "Declutter is paused right now." });
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("a server answer of no is final: one call", async () => {
    const link = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    expect((await linkSetupJobOnceMore(link)).ok).toBe(false);
    expect(link).toHaveBeenCalledTimes(1);
  });
});

describe("the pending link is taken once, for its own job", () => {
  it("returns the record for this job and clears it", () => {
    rememberPendingSetupLink({ orderId: ORDER, jobId: JOB });
    expect(takePendingSetupLink(JOB)).toEqual({ orderId: ORDER, jobId: JOB });
    expect(localStorage.getItem(SETUP_LINK_PENDING_KEY)).toBeNull();
    expect(takePendingSetupLink(JOB)).toBeNull();
  });

  it("drops a record for another job, or one it cannot read", () => {
    rememberPendingSetupLink({ orderId: ORDER, jobId: "other" });
    expect(takePendingSetupLink(JOB)).toBeNull();
    expect(localStorage.getItem(SETUP_LINK_PENDING_KEY)).toBeNull();
    localStorage.setItem(SETUP_LINK_PENDING_KEY, "{not json");
    expect(takePendingSetupLink(JOB)).toBeNull();
    expect(localStorage.getItem(SETUP_LINK_PENDING_KEY)).toBeNull();
  });
});

describe("the record holds two ids and nothing else, and is cleared on success and on sign-out", () => {
  it("stores only orderId and jobId (no amount, card or payment data)", () => {
    rememberPendingSetupLink({ orderId: ORDER, jobId: JOB });
    expect(Object.keys(JSON.parse(localStorage.getItem(SETUP_LINK_PENDING_KEY)!)).sort()).toEqual(["jobId", "orderId"]);
  });

  it("Post a job clears it when the link lands, and sign-out clears it for the next member", () => {
    const read = (rel: string) => blankComments(readFileSync(join(__dirname, "..", rel), "utf8"));
    expect(read("pages/post-job/useJobSubmit.ts")).toMatch(/if \(result\.ok\) \{\n\s*pending\?\.clearPendingSetupLink\(\);\n\s*return;/);
    const signOut = read("lib/authSignOut.ts");
    expect(signOut).toContain('import { clearPendingSetupLink } from "@/lib/declutter/setupLinkPending";');
    expect(signOut).toMatch(/\n {2}clearPendingSetupLink\(\);\n/);
  });
});

describe("PaymentSuccess links again and tells the buyer only when it still fails", () => {
  it("still failing: the buyer is told, with the server's words", async () => {
    rememberPendingSetupLink({ orderId: ORDER, jobId: JOB });
    linkSetupJob.mockRejectedValue(refused());
    renderHook(() => useTellPendingSetupLink(JOB));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(linkSetupJob).toHaveBeenCalledWith(ORDER, JOB);
    expect(toastError.mock.calls[0][0]).toBe("Your job posted, but it isn't showing on your Declutter purchase");
    expect(toastError.mock.calls[0][1]).toMatchObject({ description: "Declutter is paused right now." });
  });

  it("linked now: nothing to tell", async () => {
    rememberPendingSetupLink({ orderId: ORDER, jobId: JOB });
    linkSetupJob.mockResolvedValue(true);
    renderHook(() => useTellPendingSetupLink(JOB));
    await waitFor(() => expect(linkSetupJob).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("nothing pending: no call", async () => {
    renderHook(() => useTellPendingSetupLink(JOB));
    await new Promise((r) => setTimeout(r, 0));
    expect(linkSetupJob).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("PaymentSuccess runs it for the job it resolved", () => {
    const src = blankComments(readFileSync(join(__dirname, "../pages/post-job/PaymentSuccess.tsx"), "utf8"));
    expect(src).toContain("useTellPendingSetupLink(resolvedJobId);");
  });
});
