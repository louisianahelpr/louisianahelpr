/**
 * Q1655: the /unsubscribe page asks before anything changes, and only its
 * button POSTs. Pairs with src/test/edge/unsubscribeGetWritesNothing.test.ts
 * (the function's GET writes nothing and 303s here).
 *
 *   1. The link parser and the display address (display only; the server
 *      decides what is written).
 *   2. sendUnsubscribeChoice: the exact POST it sends, and that it reads
 *      success ONLY from the matching JSON status (a 200 text answer from an
 *      old deploy, or a network failure, is a failure, never "you're off").
 *   3. The page: renders the question signed out, sends nothing until the
 *      button, then shows the result and Resubscribe; a link with no
 *      signature says so and offers no button. The signed link leaves the
 *      address bar on arrival and travels only in the POST body, never a URL
 *      PostHog, Sentry or replay records (lh-authz-rls review of Q1655, #1).
 */
// @mutate src/lib/emailUnsubscribe.ts |   if (res.ok && body.status === want) return { ok: true, status: want }; |   if (res.ok) return { ok: true, status: want };
// @mutate src/lib/emailUnsubscribe.ts |   if (!e \|\| !sig) return null; |   if (!e) return null;
// @mutate src/pages/auth/Unsubscribe.tsx |     if (outcome.ok) setStage(outcome.status); |     setStage("unsubscribed");
// @mutate src/pages/auth/Unsubscribe.tsx |     if (window.location.search) window.history.replaceState( |     if (false) window.history.replaceState(
// @mutate src/lib/emailUnsubscribe.ts | /functions/v1/email-unsubscribe`, { | /functions/v1/email-unsubscribe?${form.toString()}`, {
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { addressFromLink, parseUnsubscribeLink, sendUnsubscribeChoice } from "@/lib/emailUnsubscribe";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // AuthShell renders the marketing Navbar, which mounts useAuthReady.
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

const E = "bWVtYmVyQGV4YW1wbGUuY29t"; // base64url("member@example.com")

describe("the link parser and display address", () => {
  it("reads e/sig/list and refuses a half link", () => {
    expect(parseUnsubscribeLink(`?e=${E}&sig=s1&list=job_matches`)).toEqual({ e: E, sig: "s1", list: "job_matches" });
    expect(parseUnsubscribeLink(`?e=${E}&sig=s1`)).toEqual({ e: E, sig: "s1", list: "promotions" });
    expect(parseUnsubscribeLink(`?e=${E}&sig=s1&list=other`)?.list).toBe("promotions");
    expect(parseUnsubscribeLink(`?e=${E}`)).toBeNull();
    expect(parseUnsubscribeLink(`?sig=s1`)).toBeNull();
  });

  it("decodes the address for display, and shows nothing it cannot decode", () => {
    expect(addressFromLink(E)).toBe("member@example.com");
    expect(addressFromLink("not*base64")).toBeNull();
    expect(addressFromLink(btoa("no-at-sign"))).toBeNull();
  });
});

describe("sendUnsubscribeChoice", () => {
  const link = { e: E, sig: "s1", list: "job_matches" as const };
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it("POSTs the choice and the signed link in the form body, never the URL", async () => {
    const f = reply(200, { status: "unsubscribed", list: "job_matches" });
    expect(await sendUnsubscribeChoice("https://x.supabase.co/", link, "unsubscribe", f as unknown as typeof fetch)).toEqual({ ok: true, status: "unsubscribed" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url, "the signed link must not be in a URL Sentry or replay records").toBe("https://x.supabase.co/functions/v1/email-unsubscribe");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(`action=unsubscribe&e=${E}&sig=s1&list=job_matches`);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("reads success only from the matching JSON status", async () => {
    const run = (f: ReturnType<typeof vi.fn>, action: "unsubscribe" | "resubscribe" = "unsubscribe") =>
      sendUnsubscribeChoice("https://x.supabase.co", link, action, f as unknown as typeof fetch);
    expect(await run(reply(200, "Unsubscribed"))).toEqual({ ok: false, reason: "failed" });
    expect(await run(reply(200, { status: "resubscribed" }))).toEqual({ ok: false, reason: "failed" });
    expect(await run(reply(400, { error: "invalid_link" }))).toEqual({ ok: false, reason: "invalid_link" });
    expect(await run(reply(503, { error: "unavailable" }))).toEqual({ ok: false, reason: "unavailable" });
    expect(await run(reply(500, { error: "failed" }))).toEqual({ ok: false, reason: "failed" });
    expect(await run(vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).toEqual({ ok: false, reason: "network" });
    expect(await run(reply(200, { status: "resubscribed" }), "resubscribe")).toEqual({ ok: true, status: "resubscribed" });
  });
});

describe("the /unsubscribe page", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderAt = async (search: string) => {
    // jsdom's own address bar, so the page's replaceState is observable.
    window.history.replaceState(null, "", `/unsubscribe${search}`);
    const { default: Unsubscribe } = await import("@/pages/auth/Unsubscribe");
    return render(
      <MemoryRouter initialEntries={[`/unsubscribe${search}`]}>
        <Unsubscribe />
      </MemoryRouter>,
    );
  };
  const supabaseCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/functions/v1/email-unsubscribe"));

  it("asks first, sends nothing until the button, then offers the way back", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) =>
      new Response(JSON.stringify({ status: String(init.body).startsWith("action=resubscribe") ? "resubscribed" : "unsubscribed", list: "job_matches" }), { status: 200 }),
    );
    await renderAt(`?e=${E}&sig=s1&list=job_matches`);
    expect(screen.getByRole("heading", { name: "Turn off new-job emails?" })).toBeTruthy();
    expect(screen.getByText(/member@example\.com/)).toBeTruthy();
    expect(supabaseCalls(), "opening the page must send nothing").toHaveLength(0);
    expect(window.location.search, "the signed link is dropped from the address bar").toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Turn Off New-Job Emails" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "New-job emails are off" })).toBeTruthy());
    expect(supabaseCalls()).toHaveLength(1);
    expect((supabaseCalls()[0][1] as RequestInit).body).toBe(`action=unsubscribe&e=${E}&sig=s1&list=job_matches`);

    fireEvent.click(screen.getByRole("button", { name: "Turn New-Job Emails Back On" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "New-job emails are back on" })).toBeTruthy());
    expect((supabaseCalls()[1][1] as RequestInit).body).toBe(`action=resubscribe&e=${E}&sig=s1&list=job_matches`);
  });

  it("a failed save says it may not have saved and keeps the question", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "failed" }), { status: 500 }));
    await renderAt(`?e=${E}&sig=s1`);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/may not have saved/));
    expect(screen.getByRole("heading", { name: "Unsubscribe from promotional email?" })).toBeTruthy();
  });

  it("a link with no signature says so and offers no button", async () => {
    await renderAt(`?e=${E}`);
    expect(screen.getByRole("heading", { name: "This link isn't valid" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Unsubscribe|Turn Off/ })).toBeNull();
    expect(supabaseCalls()).toHaveLength(0);
  });
});
