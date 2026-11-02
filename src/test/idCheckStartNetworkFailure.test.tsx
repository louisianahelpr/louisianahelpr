/**
 * Q2316: "We couldn't start the ID check" (ledger 5d96992ce6da, 5 events,
 * 2026-10-21 13:54:42Z). Read-only prod SQL (Builder 4, 2026-11-02): the row
 * came in ONE error_logs batch with "TypeError: Load failed" on
 * fetchJobOfferTargets, fetchMyScheduleClashes and two more reads plus
 * "Profile request timed out": the phone lost its connection. functions-js
 * then returns a FunctionsFetchError (no Response), so functionErrorMessage
 * fell back to "We couldn't start the ID check" and it was reported as a
 * defect. A transport failure now gets the connection line and no report; a
 * real server refusal still reports.
 *
 * Lead review 11-02: the transport failure is still COUNTED, as a localOnly
 * error_logs row (report() then skips Sentry and PostHog, proven by
 * src/lib/heldSignedInRequestStaysLocal.test.ts), so no alert-ledger item.
 *
 * @mutate src/components/identity/IdentityCheckSheet.tsx |         if (isNetworkFailure(error)) { |         if (false) {
 * @mutate src/components/identity/IdentityCheckSheet.tsx |             localOnly: true, |             localOnly: false,
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const state = {
  profile: { idv_status: "manual_review" as string | null, updated_at: new Date().toISOString() as string | null },
  since: null as string | null,
  invoke: vi.fn(),
  opened: [] as string[],
};

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: state.since ? { changed_at: state.since } : null, error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: (...a: unknown[]) => state.invoke(...a) },
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    },
  };
});
// A stable refresh and user, as the real hook's are (useCallback / state).
const stable = { user: { id: "u1" }, refresh: async () => {} };
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: stable.user, profile: state.profile, refresh: stable.refresh }),
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async (url: string) => { state.opened.push(url); }) }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
const reportSpy = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errorLogger", () => ({ report: reportSpy }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));

import { IdentityCheckHost } from "@/components/identity/IdentityCheckSheet";
import { closeIdentityCheck, openIdentityCheck } from "@/lib/identityCheck";
import { CONNECTION_TROUBLE_COPY } from "@/lib/networkFailure";

// These cases test the ID check while it is ON. The owner switched it off on
// 2026-10-23 (switch `identity_check`); src/test/identityCheckOffEntryPoints.test.ts
// covers the off state.
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckOn: () => true, useIdentityCheckStatus: () => ({ on: true, settled: true }) }));
// The host also publishes payout_after_hire (owner 2026-10-25); off here, not what this test is about.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
beforeEach(() => setIdentityCheckOn(true));
afterEach(() => setIdentityCheckOn(false));


async function openSheet() {
  render(
    <MemoryRouter initialEntries={["/post-job"]}>
      <IdentityCheckHost />
    </MemoryRouter>,
  );
  await act(async () => { openIdentityCheck("post"); });
  // Let the review-since read settle.
  await act(async () => { await Promise.resolve(); });
}

/** A functions.invoke error whose body the sheet reads (functionErrorBody reads context Response). */
function fnError(status: number, body: Record<string, unknown>) {
  const err = new Error("Edge Function returned a non-2xx status code") as Error & { context: Response };
  err.context = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  return { data: null, error: err };
}


/** What functions-js returns when the request never got an answer. */
function fetchFailure() {
  const err = new Error("Failed to send a request to the Edge Function");
  err.name = "FunctionsFetchError";
  return { data: null, error: err };
}

describe("Q2316: a dropped connection while starting the ID check is not reported", () => {
  beforeEach(() => {
    closeIdentityCheck();
    state.profile = { idv_status: null, updated_at: null };
    state.since = null;
    state.opened = [];
    reportSpy.mockClear();
    toastError.mockClear();
  });

  it("FunctionsFetchError: the connection line, one localOnly count (never Sentry), nothing opened", async () => {
    state.invoke = vi.fn(async () => fetchFailure());
    await openSheet();
    await act(async () => { fireEvent.click(screen.getByTestId("identity-check-primary")); });
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(CONNECTION_TROUBLE_COPY);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    const [err, opts] = reportSpy.mock.calls[0] as [Error, { localOnly?: boolean; severity?: string; tags?: Record<string, unknown> }];
    expect(err.name).toBe("FunctionsFetchError");
    expect(opts.localOnly).toBe(true);
    expect(opts.severity).toBe("warning");
    expect(opts.tags?.source).toBe("IdentityCheckSheet.startNetworkFailure");
    expect(state.opened).toEqual([]);
  });

  it("a server failure with no words still reports (the floor)", async () => {
    state.invoke = vi.fn(async () => fnError(500, {}));
    await openSheet();
    await act(async () => { fireEvent.click(screen.getByTestId("identity-check-primary")); });
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(String((reportSpy.mock.calls[0][0] as Error).message)).toBe("We couldn't start the ID check");
    // A server failure is a real defect: it goes to Sentry (not localOnly).
    expect((reportSpy.mock.calls[0][1] as { localOnly?: boolean } | undefined)?.localOnly).not.toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
