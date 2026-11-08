/**
 * The app's half of the server Terms check (src/lib/termsGate.ts): a request
 * the server refused with terms_not_accepted opens the re-agree dialog and is
 * sent once more after I agree, so the screen that asked gets the real answer.
 *
 *   F1 a PostgREST refusal (403 {message:"terms_not_accepted"}) waits for the
 *      member, then the same request is sent again and its answer returned;
 *   F2 an edge refusal (403 {code:"terms_not_accepted"}) is handled the same;
 *   F3 no dialog listening (signed out, banned, tests) -> the refusal as is;
 *   F4 the dialog will not open (settle false) -> the refusal, no second send;
 *   F5 any other 403 is untouched; a FormData body is never re-sent;
 *   F6 the retry happens once: a second refusal is returned as is;
 *   F7 a dialog that never shows (its chunk failed) does not hang the request:
 *      the refusal comes back after the show timeout;
 *   D1 the real dialog: a refusal mounts it for a member behind on the Terms,
 *      I agree pins the version and the waiting request is sent again;
 *   D2 a member this build sees as current: the refusal is handed back at
 *      once (no dialog, no hang).
 *
 * @mutate src/lib/termsGate.ts |     const agreed = await requestTermsAcceptance();\n    if (!agreed) return res;\n    return fetchImpl(input, init); |     return res;
 * @mutate src/lib/termsGate.ts |     return body?.message === TERMS_NOT_ACCEPTED \|\| body?.code === TERMS_NOT_ACCEPTED; |     return body?.message === TERMS_NOT_ACCEPTED;
 * @mutate src/lib/termsGate.ts |   showTimer = setTimeout(() => finish(false), DIALOG_SHOW_MS); |   showTimer = null;
 * @mutate src/components/TermsReconsentDialog.tsx |       settleTermsRequest(true); |       void 0;
 * @mutate src/components/TermsReconsentDialog.tsx |     else settleTermsRequest(false); |     else void 0;
 * @mutate src/components/TermsReconsentMount.tsx |       setBehind(true);\n      setRequestSeq((n) => n + 1); |       setRequestSeq((n) => n + 1);
 */
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

let acceptedVersion: string | null = "Sep 2026";
const updates: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    let pending: Record<string, unknown> | null = null;
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.update = (row: Record<string, unknown>) => {
      pending = row;
      return b;
    };
    b.maybeSingle = async () => ({ data: { terms_version_accepted: acceptedVersion }, error: null });
    b.insert = async () => ({ error: null });
    b.then = (res: (v: unknown) => void) => {
      if (pending) {
        updates.push(pending);
        acceptedVersion = String(pending.terms_version_accepted);
      }
      res({ data: pending ? [{ user_id: "u-1" }] : [], error: null });
    };
    return b;
  };
  return { supabase: { from: () => build() } };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "u-1", email_confirmed_at: "2026-09-01T00:00:00Z" },
    // The profile row the mount reads looks CURRENT: only the server refusal opens the dialog.
    profile: { ban_status: "active", terms_version_accepted: "Oct 2026" },
    refresh: async () => {},
  }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { listenForTermsRequests, settleTermsRequest, termsGateFetch, termsRequestPending } from "@/lib/termsGate";
import { TermsReconsentMount } from "@/components/TermsReconsentMount";
import { LATEST_TERMS_VERSION } from "@/lib/consent";

const PGRST_REFUSAL = JSON.stringify({ code: "42501", message: "terms_not_accepted", details: "Oct 2026", hint: "Agree…" });
const EDGE_REFUSAL = JSON.stringify({ error: "Please agree to the updated Terms of Service to continue.", code: "terms_not_accepted" });
const resp = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers from a queue and records each call. */
function queueFetch(answers: Array<() => Response>) {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init]);
    const next = answers.shift();
    if (!next) throw new Error("unexpected extra request");
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const POST = { method: "POST", body: JSON.stringify({ title: "Move a couch" }) };

describe("termsGateFetch", () => {
  let unlisten: (() => void) | null = null;
  afterEach(() => {
    unlisten?.();
    unlisten = null;
    settleTermsRequest(false);
  });

  for (const [label, body] of [["F1 PostgREST", PGRST_REFUSAL], ["F2 edge", EDGE_REFUSAL]] as const) {
    it(`${label} refusal: waits for I agree, then sends the same request again`, async () => {
      const asked = vi.fn();
      unlisten = listenForTermsRequests(asked);
      const { impl, calls } = queueFetch([() => resp(403, body), () => resp(201, '[{"id":"j-1"}]')]);
      const p = termsGateFetch(impl)("https://x/rest/v1/jobs", POST);
      await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
      expect(termsRequestPending()).toBe(true);
      settleTermsRequest(true);
      const res = await p;
      expect(res.status).toBe(201);
      expect(await res.text()).toBe('[{"id":"j-1"}]');
      expect(calls.length).toBe(2);
      expect(calls[1]).toEqual(calls[0]);
    });
  }

  it("F3 no dialog listening: the refusal comes back as is, nothing re-sent", async () => {
    const { impl, calls } = queueFetch([() => resp(403, PGRST_REFUSAL)]);
    const res = await termsGateFetch(impl)("https://x/rest/v1/jobs", POST);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(PGRST_REFUSAL);
    expect(calls.length).toBe(1);
  });

  it("F4 the dialog will not open: the refusal, no second send", async () => {
    unlisten = listenForTermsRequests(() => setTimeout(() => settleTermsRequest(false), 0));
    const { impl, calls } = queueFetch([() => resp(403, EDGE_REFUSAL)]);
    const res = await termsGateFetch(impl)("https://x/functions/v1/shop-checkout", POST);
    expect(res.status).toBe(403);
    expect(calls.length).toBe(1);
  });

  it("F5 another 403 is untouched, and a FormData body is never re-sent", async () => {
    const asked = vi.fn();
    unlisten = listenForTermsRequests(asked);
    const other = JSON.stringify({ code: "42501", message: "permission denied for table jobs" });
    const a = queueFetch([() => resp(403, other)]);
    expect((await termsGateFetch(a.impl)("https://x/rest/v1/jobs", POST)).status).toBe(403);
    const fd = new FormData();
    fd.append("f", "1");
    const b = queueFetch([() => resp(403, PGRST_REFUSAL)]);
    expect((await termsGateFetch(b.impl)("https://x/storage/v1/object", { method: "POST", body: fd })).status).toBe(403);
    expect(asked).not.toHaveBeenCalled();
    expect(a.calls.length + b.calls.length).toBe(2);
  });

  it("F6 retries once: a second refusal is returned as is", async () => {
    unlisten = listenForTermsRequests(() => setTimeout(() => settleTermsRequest(true), 0));
    const { impl, calls } = queueFetch([() => resp(403, PGRST_REFUSAL), () => resp(403, PGRST_REFUSAL)]);
    const res = await termsGateFetch(impl)("https://x/rest/v1/jobs", POST);
    expect(res.status).toBe(403);
    expect(calls.length).toBe(2);
  });

  it("F7 a dialog that never shows does not hang the request", async () => {
    vi.useFakeTimers();
    try {
      unlisten = listenForTermsRequests(() => {});
      const { impl, calls } = queueFetch([() => resp(403, PGRST_REFUSAL)]);
      let res: Response | null = null;
      void termsGateFetch(impl)("https://x/rest/v1/jobs", POST).then((r) => (res = r));
      await vi.advanceTimersByTimeAsync(10_001);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
      expect(calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the re-agree dialog answers a server refusal", () => {
  beforeEach(() => {
    updates.length = 0;
    document.body.innerHTML = "";
  });

  it("D1 a member behind on the Terms: the dialog opens, I agree pins the version, the request is sent again", async () => {
    acceptedVersion = "Sep 2026";
    render(<MemoryRouter><TermsReconsentMount /></MemoryRouter>);
    // The mount's own profile read says current: nothing shown yet.
    expect(screen.queryByText(/Please take a moment to re-agree/)).toBeNull();
    const { impl, calls } = queueFetch([() => resp(403, PGRST_REFUSAL), () => resp(201, '[{"id":"j-1"}]')]);
    let res: Response | null = null;
    await act(async () => {
      void termsGateFetch(impl)("https://x/rest/v1/jobs", POST).then((r) => (res = r));
    });
    expect(await screen.findByText(/Please take a moment to re-agree/)).toBeTruthy();
    expect(calls.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "I agree" }));
    await waitFor(() => expect(res).not.toBeNull());
    expect(updates[0]?.terms_version_accepted).toBe(LATEST_TERMS_VERSION);
    expect(res!.status).toBe(201);
    expect(calls.length).toBe(2);
  });

  it("D2 a member this build sees as current: the refusal comes back at once, no dialog", async () => {
    acceptedVersion = LATEST_TERMS_VERSION;
    render(<MemoryRouter><TermsReconsentMount /></MemoryRouter>);
    const { impl, calls } = queueFetch([() => resp(403, PGRST_REFUSAL)]);
    let res: Response | null = null;
    await act(async () => {
      void termsGateFetch(impl)("https://x/rest/v1/jobs", POST).then((r) => (res = r));
    });
    await waitFor(() => expect(res).not.toBeNull(), { timeout: 3000 });
    expect(res!.status).toBe(403);
    expect(calls.length).toBe(1);
    expect(screen.queryByText(/Please take a moment to re-agree/)).toBeNull();
  });
});
