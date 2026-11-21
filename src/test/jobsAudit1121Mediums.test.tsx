/**
 * Jobs audit 11-21 (public + poster), the copy and routing findings fixed together. Each block names its finding.
 *
 * P1: Log in from an OPEN job said "This job is only visible to the person who posted it…".
 * @mutate src/pages/auth/loginNotice.ts |   if (reason === "apply" && /^\/jobs\/[0-9a-f-]{36}$/i.test(path)) return JOB_APPLY_NOTICE; |
 * @mutate src/lib/jobIntent.ts | `/login?redirect=${encodeURIComponent(`/jobs/${jobId}`)}&reason=apply` | `/login?redirect=${encodeURIComponent(`/jobs/${jobId}`)}`
 *
 * P2: the direct-offer banner read "Direct offer to this H." (the fallback formatted twice).
 * @mutate src/pages/post-job/DirectOfferBanner.tsx |   const name = formatName(offerToHelperName, "this Helpr"); |   const name = formatName(formatName(offerToHelperName, "this Helpr"), "your saved Helpr");
 *
 * P7: a member opening /browse landed on /home and lost ?cat=.
 * @mutate src/App.tsx | <MarketingRedirect to="/jobs" keepQuery fallback={<DashboardRouteSkeleton />}> | <MarketingRedirect fallback={<DashboardRouteSkeleton />}>
 * @mutate src/components/SignedInRedirect.tsx | <Navigate to={keepQuery && search ? `${to}${search}` : to} replace /> | <Navigate to={to} replace />
 *
 * G16: the no-show sheet said "pick a new date" with no way to, and read "Confirm No-Show".
 * @mutate src/components/job-card/NoShowDialog.tsx | "Confirm no-show" | "Confirm No-Show"
 *
 * P4: a guest's pet job showed "Loading your pets…" forever, and Add a pet left the post for a login wall.
 * @mutate src/components/postjob/PetPicker.tsx |   if (!user) { |   if (false) {
 *
 * P0: guest post / hire entry points still forced sign-up first (owner 11-20/21: sign up at the end).
 * @mutate src/pages/info/HireTownPage.tsx |   const post = form; |   const post = `/signup?redirect=${encodeURIComponent(form)}`;
 * @mutate src/lib/bookMe.ts |   return bookOfferPath(userId); |   return signupUrlFor(bookOfferPath(userId));
 * @mutate src/pages/home/DashboardGuest.tsx | onHire={() => navigate("/post-job")} | onHire={() => navigate("/signup")}
 *
 * P14: /search and /post-job were indexable with the home description; /helprs had no head of its own.
 * @mutate src/hooks/useNoIndex.ts |     el.setAttribute("content", "noindex, follow"); |     el.setAttribute("content", "index, follow");
 * @mutate src/pages/post-job/PostJob.tsx |   useNoIndex();\n |
 *
 * G3: the card hold was explained three different ways (held until accepted / not charged until accepted / saved).
 * @mutate supabase/functions/_shared/cardHoldCopy.ts | postPromise: "Pay by card and you're only charged when you hire a Helpr. | postPromise: "Your card is held, not charged, until a Helpr accepts your offer.
 * @mutate src/lib/i18n/enJobPoster.ts | "Your card isn't charged until you hire a Helpr." | "Your card isn't charged until a Helpr accepts your offer."
 *
 * G19: Post a job's search found nothing for "gutter".
 * @mutate src/components/postjob/JobCategoryGroups.tsx |   [/\bgutters?\b/, ["handyman", "storm_prep", "roofing"]], |
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const user = vi.hoisted(() => ({ current: { id: "m1" } as { id: string } | null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: user.current, isLoading: false }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/posterCancelQuote", () => ({ fetchPosterCancelQuote: async () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit", "maybeSingle", "single"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});

import { loginNotice, JOB_APPLY_NOTICE, JOB_LINK_NOTICE } from "@/pages/auth/loginNotice";
import { guestLogInUrl } from "@/lib/jobIntent";
import { DirectOfferBanner } from "@/pages/post-job/DirectOfferBanner";
import SignedInRedirect from "@/components/SignedInRedirect";
import { NoShowDialog } from "@/components/job-card/NoShowDialog";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { PetPicker } from "@/components/postjob/PetPicker";

describe("P4: a guest's pet job never hangs on 'Loading your pets…' or leaves the post", () => {
  it("a guest sees a plain line, no endless loading and no Add a pet link to a login wall", () => {
    user.current = null;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><PetPicker selectedIds={[]} onToggle={() => {}} /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("pet-picker-guest").textContent).toMatch(/Which pet is this for\?/);
    expect(document.body.textContent).not.toMatch(/Loading your pets/);
    expect(screen.queryByRole("link", { name: /Add a pet/ })).toBeNull();
    user.current = { id: "m1" };
  });
});

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));
const JOB = "/jobs/3f2a1b0c-1111-4222-8333-444455556666";

describe("P1: Log in from an open job does not call it private", () => {
  const notice = (redirect: string, reason?: string | null) =>
    loginNotice({ oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true, redirect, reason }).notice;
  it("the guest job page's Log in carries reason=apply, and Login says log in to apply", () => {
    const url = new URL(guestLogInUrl("3f2a1b0c-1111-4222-8333-444455556666"), "https://x.invalid");
    expect(url.searchParams.get("reason")).toBe("apply");
    expect(notice(url.searchParams.get("redirect")!, url.searchParams.get("reason"))).toBe(JOB_APPLY_NOTICE);
  });
  it("a bounce from a job that is not public (no reason) keeps the private-job line", () => {
    expect(notice(JOB)).toBe(JOB_LINK_NOTICE);
  });
});

describe("P2: the direct-offer banner formats the name once", () => {
  const banner = (name: string) =>
    render(<DirectOfferBanner offerToHelperName={name} onCancel={() => {}} responseHours={24} onResponseHoursChange={() => {}} />);
  it("a profile with no name reads 'this Helpr', never 'this H.'", () => {
    banner("");
    expect(screen.getByText(/^Direct offer to /).textContent).toBe("Direct offer to this Helpr");
  });
  it("a full name is shortened to First L., once", () => {
    banner("Hallie Helper");
    expect(screen.getByText(/^Direct offer to /).textContent).toBe("Direct offer to Hallie H.");
  });
  it("the form stores the raw name (the banner is the one place that formats it)", () => {
    expect(code("src/pages/post-job/useJobFormEffects.ts")).not.toMatch(/setOfferToHelperName\(formatName\(/);
  });
});

describe("P7: a member opening /browse lands on the Jobs board with the query kept", () => {
  it("the /browse route sends a member to /jobs and keeps the query", () => {
    expect(code("src/App.tsx")).toMatch(/<Route path="\/browse" element=\{<RouteErrorBoundary><MarketingRedirect to="\/jobs" keepQuery /);
  });
  it("SignedInRedirect keepQuery carries ?cat= to the destination", async () => {
    user.current = { id: "m1" };
    render(
      <MemoryRouter initialEntries={["/browse?cat=plumbing"]}>
        <Routes>
          <Route path="/browse" element={<SignedInRedirect to="/jobs" keepQuery><p>guest board</p></SignedInRedirect>} />
          <Route path="/jobs" element={<Loc />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByTestId("loc")).textContent).toBe("/jobs?cat=plumbing");
  });
});

import { useLocation } from "react-router-dom";
function Loc() {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search}</p>;
}

describe("G16: the no-show sheet says what happens next, in sentence case", () => {
  it("names the next step after the report and folds the strike policy", () => {
    render(<NoShowDialog jobId="j1" helperName="Bea T." onClose={() => {}} onConfirm={() => {}} reporting={false} />);
    expect(screen.getByRole("button", { name: "Confirm no-show" })).toBeTruthy();
    expect(screen.getByTestId("no-show-next").textContent).toMatch(/Then pick a new date on the job to hire someone else\./);
    expect(screen.getByText("How strikes work")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/No-Show/);
  });
});

describe("G19: Post a job's search finds the common Louisiana jobs", () => {
  const search = (q: string) => {
    const r = render(
      <QueryClientProvider client={new QueryClient()}>
        <JobCategoryGroups category="" setCategory={() => {}} group={null} setGroup={() => {}} onPicked={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
    const found = screen.queryByRole("region", { name: /match/i })?.textContent ?? document.body.textContent ?? "";
    r.unmount();
    return found;
  };
  // Inventory floor: each common ask the category names did not contain.
  const ASKS: Array<[string, RegExp]> = [
    ["gutter", /Handyman|Storm/i],
    ["clean gutters", /Handyman|Storm/i],
    ["leaky faucet", /Plumbing/i],
    ["ceiling fan", /Electrical/i],
    ["crawfish boil", /Event/i],
    ["walk my dog", /Pet/i],
  ];
  it("has asks to check", () => expect(ASKS.length).toBeGreaterThan(4));
  it.each(ASKS)("%s offers a category, not 'No category matches'", (q, want) => {
    const text = search(q);
    expect(text).not.toMatch(/No category matches/);
    expect(text).toMatch(want);
  });
});

describe("P0: a guest's post / hire entry opens Post a job itself (sign-up comes at the end)", () => {
  it("no source sends a guest through /signup on the way to /post-job", async () => {
    const { walkSource } = await import("./helpers/walkSource");
    const { join, relative } = await import("node:path");
    const ROOT = resolve(__dirname, "../..");
    const files = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));
    // Inventory floor: the scan reads the app.
    expect(files.length).toBeGreaterThan(500);
    const SIGNUP_THEN_POST = /signupUrlFor\([^)]*post-job|\/signup\?redirect=[^"'`\s]*post-job|\/signup\?redirect=\$\{encodeURIComponent\(form\)\}|signupUrlFor\(bookOfferPath/;
    const hits = files.filter((f) => SIGNUP_THEN_POST.test(blankComments(readFileSync(f, "utf8")))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it("the guest empty board's 'hire someone' opens Post a job", () => {
    expect(code("src/pages/home/DashboardGuest.tsx")).toContain('onHire={() => navigate("/post-job")}');
  });
});

describe("P14: tool pages are noindex, /helprs has its own head, an unavailable job is noindex after JS too", () => {
  it("useNoIndex says noindex while mounted and takes it away after", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useNoIndex } = await import("@/hooks/useNoIndex");
    const h = renderHook(() => useNoIndex());
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    h.unmount();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
  it("Post a job and Search call it; Find a Helpr names itself; the unavailable guest job says noindex", () => {
    expect(code("src/pages/post-job/PostJob.tsx")).toMatch(/\buseNoIndex\(\);/);
    expect(code("src/pages/search/SearchPage.tsx")).toMatch(/\buseNoIndex\(\);/);
    expect(code("src/pages/helprs/FindHelprs.tsx")).toMatch(/canonical: "https:\/\/www\.louisianahelpr\.com\/helprs"/);
    expect(code("src/pages/jobs/JobDetail.tsx")).toMatch(/robots: !authLoading && !user && !isLoading && !isError && !job \? "noindex, follow" : undefined/);
  });
});

describe("G3: every card-hold promise is the same one: charged only when you hire", () => {
  it("Post a job, the job page and payment success all say it, and none says 'until a Helpr accepts'", async () => {
    const { CARD_HOLD_COPY } = await import("../../supabase/functions/_shared/cardHoldCopy");
    const { enJobPoster } = await import("@/lib/i18n/enJobPoster");
    const lines = [
      CARD_HOLD_COPY.postPromise,
      CARD_HOLD_COPY.checkout(2500),
      CARD_HOLD_COPY.held(2500),
      CARD_HOLD_COPY.scheduled(2500),
      (enJobPoster as Record<string, string>)["jp.heldLine"],
    ];
    // Inventory floor: the five places a poster reads the promise.
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) {
      expect(l, l).toMatch(/charged (?:until|when) you hire/);
      expect(l, l).not.toMatch(/until a Helpr accepts/);
    }
    expect(code("src/pages/jobs/jobPage/JobPageParts.tsx")).not.toMatch(/until a Helpr accepts/);
  });
});

describe("G2: the Price button names the urgent bonus, so its sum is Review's total", () => {
  it("the button adds '+ $X urgent' beside the typed price when a bonus is on", () => {
    expect(code("src/pages/post-job/FormStep.tsx")).toMatch(/\{form\.urgentFeeNum > 0 && <span data-testid="post-job-cta-urgent"> \+ \$\{formatPriceExact\(form\.urgentFeeNum\)\} urgent<\/span>\}/);
  });
});
