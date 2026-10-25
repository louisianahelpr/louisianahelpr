/**
 * The signed-out home has a "Post a job" action (lead, 2026-10-25: the landing
 * had only Join free / Create account / Browse, and the "I need help" side of
 * How a job works said "Post what you need" with nothing to press).
 *
 * Layers checked here:
 *   1. the page: Index mounts the real How it works, and its "I need help" side
 *      renders a "Post a job" link whose static href (what a signed-out visitor
 *      and a crawler get) is sign-up carrying /post-job as the return path;
 *   2. the click: signed out goes to that sign-up URL, signed in goes straight
 *      to /post-job (goSignedInOr, which falls back to the signed-out target);
 *   3. the round trip: Signup stores `?redirect=` (rememberSignupRedirect) and
 *      the first signed-in landing spends it (postAuthDestination), so the new
 *      account arrives on /post-job, not on /home.
 *
 * @mutate src/components/landing/HowItWorksSection.tsx | export const POST_JOB_SIGNED_OUT = signupUrlFor(POST_JOB_PATH); | export const POST_JOB_SIGNED_OUT = "/signup";
 * @mutate src/components/landing/HowItWorksSection.tsx |         {side === "hire" && ( |         {side === "work" && (
 * @mutate src/components/landing/HowItWorksSection.tsx |               void goSignedInOr(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT); |               void goSignedInOr(navigate, "/home", POST_JOB_SIGNED_OUT);
 * @mutate src/components/landing/HowItWorksSection.tsx |             to={POST_JOB_SIGNED_OUT} |             to={POST_JOB_PATH}
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

import HowItWorksSection, { POST_JOB_PATH, POST_JOB_SIGNED_OUT } from "@/components/landing/HowItWorksSection";
import { postAuthDestination, rememberSignupRedirect } from "@/lib/jobIntent";

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

  it("the I need help side shows Post a job; its href is sign-up returning to /post-job", () => {
    renderAtHome();
    const links = screen.getAllByRole("link", { name: /post a job/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toBe("/signup?redirect=%2Fpost-job");
    expect(POST_JOB_SIGNED_OUT).toBe("/signup?redirect=%2Fpost-job");
  });

  it("signed out (the real client, no session): the tap goes to sign-up with the post-job return path", async () => {
    renderAtHome();
    fireEvent.click(screen.getByTestId("landing-post-job"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/signup?redirect=%2Fpost-job"));
  });

  it("signed in: the same tap targets /post-job itself (the shared goSignedInOr rule; no mocked session)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/landing/HowItWorksSection.tsx"), "utf8"));
    expect(src).toMatch(/goSignedInOr\(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT\)/);
    expect(POST_JOB_PATH).toBe("/post-job");
  });

  it("the sign-up round trip lands the new account on /post-job", () => {
    const redirect = new URLSearchParams(POST_JOB_SIGNED_OUT.split("?")[1]).get("redirect");
    rememberSignupRedirect(redirect);
    expect(postAuthDestination()).toBe("/post-job");
    // Spent: a later, unrelated sign-in is not yanked into the form.
    expect(postAuthDestination()).toBe("/home");
  });
});
