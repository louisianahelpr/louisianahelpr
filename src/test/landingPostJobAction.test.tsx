/**
 * The signed-out home has a "Post a job" action (lead, 2026-10-25: the landing
 * had only Join free / Create account / Browse, and the "I need help" side of
 * How a job works said "Post what you need" with nothing to press).
 *
 * Layers checked here:
 * Owner 2026-11-21 (changes the rule): "when they click post a job or sell
 * something should we let them post and sell and before it will be submitted
 * make them sign up so they can see how it's set up?" -> yes. So the link no
 * longer goes to sign-up first: it opens /post-job, where a guest fills the post
 * and is asked to sign up at the end (src/lib/guestPostDraft.ts; that round trip
 * is guestPostDraftSurvivesSignup.test.tsx).
 *
 * Layers checked here:
 *   1. the page: Index mounts the real How it works, and its "I need help" side
 *      renders a "Post a job" link whose static href (what a signed-out visitor
 *      and a crawler get) is /post-job itself;
 *   2. the click: signed out and signed in both go to /post-job (goSignedInOr);
 *   3. the route lets a guest in (allowGuest), and the guest's sign-up at the
 *      end comes back to the draft (guestPostSignupUrl -> postAuthDestination).
 *
 * @mutate src/components/landing/HowItWorksSection.tsx | export const POST_JOB_SIGNED_OUT = POST_JOB_PATH; | export const POST_JOB_SIGNED_OUT = "/signup?redirect=%2Fpost-job";
 * @mutate src/components/landing/HowItWorksSection.tsx | signedOut: POST_JOB_SIGNED_OUT, signedIn: POST_JOB_PATH, testId: "landing-post-job" }, | signedOut: POST_JOB_SIGNED_OUT, signedIn: POST_JOB_PATH, testId: "landing-post-job-x" },
 * @mutate src/components/landing/HowItWorksSection.tsx |                 void goSignedInOr(navigate, action.signedIn, action.signedOut); |                 void goSignedInOr(navigate, "/home", action.signedOut);
 * @mutate src/components/landing/HowItWorksSection.tsx |               to={action.signedOut} |               to="/signup"
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

import HowItWorksSection, { POST_JOB_PATH, POST_JOB_SIGNED_OUT } from "@/components/landing/HowItWorksSection";
import { postAuthDestination, rememberSignupRedirect } from "@/lib/jobIntent";
import { GUEST_POST_RESUME_PATH, guestPostSignupUrl } from "@/lib/guestPostDraft";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAtHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HowItWorksSection />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("signed-out home: Post a job", () => {
  it("Index mounts How it works (the section this action lives in)", () => {
    const index = blankComments(readFileSync(join(process.cwd(), "src/pages/info/Index.tsx"), "utf8"));
    expect(index).toContain("<HowItWorksSection />");
  });

  it("the I need help side shows Post a job; its href is the post form itself (owner 11-21)", () => {
    renderAtHome();
    const links = screen.getAllByRole("link", { name: /post a job/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toBe("/post-job");
    expect(POST_JOB_SIGNED_OUT).toBe("/post-job");
  });

  it("signed out (the real client, no session): the tap opens the post form, not sign-up", async () => {
    renderAtHome();
    fireEvent.click(screen.getByTestId("landing-post-job"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/post-job"));
  });

  it("signed in: the same tap targets /post-job itself (the shared goSignedInOr rule; no mocked session)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/landing/HowItWorksSection.tsx"), "utf8"));
    // D012/D020 (11-10): each side's one action comes from SIDE_ACTION; the I need help side's is Post a job.
    expect(src).toMatch(/goSignedInOr\(navigate, action\.signedIn, action\.signedOut\)/);
    expect(src).toMatch(/hire: \{ label: "Post a job", key: "landing.postJob", signedOut: POST_JOB_SIGNED_OUT, signedIn: POST_JOB_PATH,/);
    expect(POST_JOB_PATH).toBe("/post-job");
  });

  it("a guest can open /post-job, and its sign-up at the end lands the new account back on the draft", () => {
    const routes = blankComments(readFileSync(join(process.cwd(), "src/App.tsx"), "utf8"));
    expect(routes).toContain("<ProtectedRoute fullProfile allowGuest><PostJob /></ProtectedRoute>");
    const redirect = new URL(guestPostSignupUrl(), "https://x.invalid").searchParams.get("redirect");
    rememberSignupRedirect(redirect);
    expect(postAuthDestination()).toBe(GUEST_POST_RESUME_PATH);
    // Spent: a later, unrelated sign-in is not yanked into the form.
    expect(postAuthDestination()).toBe("/home");
  });
});
