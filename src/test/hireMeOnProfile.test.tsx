/**
 * "Hire me" on a Helpr's public page /u/<handle> (owner 2026-11-04 8:31 AM, OWNER-DECISIONS: "'Hire me' on every
 * Helpr's page; link -> Hire me -> creates the listing offered to that Helpr; free for everyone; get rid of
 * memberships reference").
 *  - a guest's Hire me goes through signup and back to this page with ?hire=1;
 *  - a member's tap asks rpc_hire_target_by_handle for the id and opens Post a job with the direct offer set;
 *  - arriving back with ?hire=1 continues the tap ONCE; a refusal shows its words and goes nowhere;
 *  - never on your own page; nothing in the flow names a plan or membership;
 *  - the prefill: ?offerTo opens the form (no start screen), sets the offer target, and the post carries
 *    offered_to_helper_id with direct_offer_status 'pending' (the existing direct-offer path, unchanged).
 * Server side (refusals, block, ban, free member): ~/.lh-pglite/b113-hire.mjs against 20261104143437.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | {!isMe && <HireMeButton handle={p.handle} signedIn={signedIn} />} | {<HireMeButton handle={p.handle} signedIn={signedIn} />}
 * @mutate src/lib/hireMe.ts |   return signupUrlFor(`/u/${encodeURIComponent(handle)}?${HIRE_PARAM}=1`); |   return signupUrlFor(`/u/${encodeURIComponent(handle)}`);
 * @mutate src/pages/u/PublicProfilePage.tsx |     if (r.id) navigate(hireOfferPath(r.id)); |     if (r.id) navigate("/post-job");
 * @mutate src/pages/u/PublicProfilePage.tsx |     if (!resume \|\| resumed.current) return; |     if (!resume) return;
 * @mutate src/lib/hireMe.ts |   return `/post-job?offerTo=${encodeURIComponent(userId)}`; |   return `/post-job?offer=${encodeURIComponent(userId)}`;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
const toastError = vi.fn();
let signedIn: { id: string } | null = null;
let myHandle: string | null = null;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: myHandle ? { handle: myHandle } : null }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
const { buildJobInsertPayload } = await import("@/pages/post-job/jobSubmitHelpers");
const { HIRE_ME_RPC_ERROR_COPY } = await import("@/lib/hireMe");

const HELPR = "3f2a1b0c-1111-4222-8333-444455556666";
const PAGE = {
  handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 2, avg_rating: 4.5 }, listings: [], jobs: [],
  helpr: { jobs_done: 2, categories: ["moving"], reviews: [] }, wanted: [],
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

// StrictMode, as the app runs in development: effects mount twice, so "continues ONCE" is really tested.
const show = (path: string) =>
  render(
    <StrictMode>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/u/:handle" element={<><PublicProfilePage /><Where /></>} />
          <Route path="/post-job" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
    </StrictMode>,
  );

const answer = (hire: { data?: unknown; error?: unknown }) =>
  rpc.mockImplementation(async (name: string) =>
    name === "public_profile_by_handle" ? { data: PAGE, error: null } : { data: hire.data ?? null, error: hire.error ?? null });

beforeEach(() => {
  rpc.mockReset();
  toastError.mockReset();
  signedIn = null;
  myHandle = null;
});

describe("Hire me on /u/<handle>", () => {
  it("a guest's Hire me goes through signup and back to this page to continue", async () => {
    answer({});
    show("/u/eli-b");
    const link = await screen.findByRole("link", { name: "Hire me" });
    expect(link.getAttribute("href")).toBe(`/signup?redirect=${encodeURIComponent("/u/eli-b?hire=1")}`);
    expect(rpc).not.toHaveBeenCalledWith("rpc_hire_target_by_handle", expect.anything());
  });

  it("a member's tap opens Post a job with the direct offer to that Helpr set", async () => {
    signedIn = { id: "m1" };
    answer({ data: HELPR });
    show("/u/eli-b");
    fireEvent.click(await screen.findByRole("button", { name: "Hire me" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/post-job?offerTo=${HELPR}`));
    expect(rpc).toHaveBeenCalledWith("rpc_hire_target_by_handle", { p_handle: "eli-b" });
  });

  it("coming back from signup with ?hire=1 continues the tap once", async () => {
    signedIn = { id: "m1" };
    answer({ data: HELPR });
    show("/u/eli-b?hire=1");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/post-job?offerTo=${HELPR}`));
    expect(rpc.mock.calls.filter(([n]) => n === "rpc_hire_target_by_handle")).toHaveLength(1);
  });

  it("a refusal shows its words and stays on the page", async () => {
    signedIn = { id: "m1" };
    answer({ error: { message: "hire_unavailable", code: "P0001" } });
    show("/u/eli-b");
    fireEvent.click(await screen.findByRole("button", { name: "Hire me" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(HIRE_ME_RPC_ERROR_COPY.rpc_hire_target_by_handle.hire_unavailable));
    expect(screen.getByTestId("where").textContent).toBe("/u/eli-b");
  });

  it("never on your own page", async () => {
    signedIn = { id: "m1" };
    myHandle = "eli-b";
    answer({});
    show("/u/eli-b?hire=1");
    expect(await screen.findByRole("button", { name: /share my profile/i })).toBeTruthy();
    expect(screen.queryByText("Hire me")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("rpc_hire_target_by_handle", expect.anything());
  });

  it("nothing in the flow names a plan or membership", () => {
    const files = ["src/lib/hireMe.ts", "src/pages/u/PublicProfilePage.tsx", "src/pages/post-job/DirectOfferBanner.tsx"];
    const offenders = files.filter((f) =>
      /\b(pro|plus|elite|membership|subscri\w*|upgrade|tier)\b/i.test(
        blankComments(readFileSync(resolve(import.meta.dirname, "../..", f), "utf8")).replace(/\bprops?\b/gi, ""),
      ),
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(2);
  });
});

describe("the prefill Hire me lands in (the existing direct-offer path)", () => {
  const src = (f: string) => blankComments(readFileSync(resolve(import.meta.dirname, "../..", f), "utf8"));

  it("?offerTo skips the start screen and sets the offer target", () => {
    const form = src("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/const skipEntry = [^;]*searchParams\.get\("offerTo"\)/);
    const effects = src("src/pages/post-job/useJobFormEffects.ts");
    const at = effects.indexOf('const offerTo = searchParams.get("offerTo");');
    expect(at).toBeGreaterThan(0);
    expect(effects.indexOf("setOfferToHelperId(offerTo);", at)).toBeGreaterThan(at);
  });

  it("the post carries the offer to that Helpr, pending", () => {
    const row = buildJobInsertPayload({
      userId: "u1", businessId: null, title: "Mow the lawn", description: "Front and back",
      category: "yard_work", streetAddress: "1 Main", city: "Houma", addrState: "LA",
      zipCode: "70360", parish: "Terrebonne",
      dateNeeded: "2032-10-02", startTime: "09:00", isFlexibleSchedule: false,
      estimatedHours: "2", budget: "60", materialsNote: null,
      isRecurring: false, recurrenceInterval: "weekly", recurrenceEndDate: "",
      isGroupJob: false, helpersNeeded: "1", isUrgent: false, urgentFee: "5",
      salesTaxRate: 0, offerToHelperId: HELPR,
    }) as Record<string, unknown>;
    expect(row.offered_to_helper_id).toBe(HELPR);
    expect(row.direct_offer_status).toBe("pending");
  });
});
