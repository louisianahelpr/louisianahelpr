/**
 * Owner 2026-11-20 (ease batch, item 6): while a sign-up's email is pending, people browse and START a post freely;
 * only the final action that needs an account (posting live, messaging, paying: each sends a signed-out visitor to
 * /signup) is held, with a friendly "Check your email to finish" and a way to get a new link. Supabase gives an
 * unconfirmed address no session, so the device remembers the waiting sign-up (src/lib/pendingSignup.ts).
 *
 * @mutate src/pages/auth/Signup.tsx |         {step === 1 && !pendingSignup && ( |         {step === 1 && (
 * @mutate src/lib/pendingSignup.ts |     if (typeof v.email !== "string" \|\| !v.email \|\| typeof v.at !== "number" \|\| now - v.at > MAX_AGE_MS \|\| v.at > now + 60_000) { |     if (typeof v.email !== "string") {
 * @mutate src/components/auth/PendingSignupCard.tsx | navigate("/signup-pending", { state: { email, resend: true } }) | navigate("/signup")
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { clearPendingSignup, readPendingSignup, rememberPendingSignup } from "@/lib/pendingSignup";
import { PendingSignupCard } from "@/components/auth/PendingSignupCard";

const read = (p: string) => readFileSync(p, "utf8");
const DAY = 24 * 60 * 60 * 1000;

function Landed() {
  const loc = useLocation();
  return <p data-testid="landed">{`${loc.pathname} ${JSON.stringify(loc.state)}`}</p>;
}

beforeEach(() => clearPendingSignup());
afterEach(cleanup);

describe("a pending sign-up holds only the final step (owner 11-20)", () => {
  it("the device remembers the waiting address for 7 days, then forgets it", () => {
    const t0 = Date.UTC(2026, 10, 20);
    expect(readPendingSignup(t0)).toBeNull();
    rememberPendingSignup(" jo@example.com ", t0);
    expect(readPendingSignup(t0 + 6 * DAY)).toEqual({ email: "jo@example.com" });
    expect(readPendingSignup(t0 + 8 * DAY)).toBeNull();
    expect(readPendingSignup(t0)).toBeNull(); // the stale record was dropped
  });

  it("the card says check your email, names the address, and its button sends a new link from /signup-pending", () => {
    let usedDifferent = false;
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Routes>
          <Route path="/signup" element={<PendingSignupCard email="jo@example.com" onUseDifferent={() => { usedDifferent = true; }} />} />
          <Route path="/signup-pending" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Check your email to finish" })).toBeTruthy();
    expect(screen.getByText(/jo@example\.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(usedDifferent).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(screen.getByTestId("landed").textContent).toBe('/signup-pending {"email":"jo@example.com","resend":true}');
  });

  it("/signup shows the card instead of a second form while a sign-up waits; finishing or signing in clears it", () => {
    const signup = read("src/pages/auth/Signup.tsx");
    expect(signup).toContain("{step === 1 && pendingSignup && (");
    expect(signup).toContain("{step === 1 && !pendingSignup && (");
    // Both ways a sign-up reaches "Check your email" remember it first.
    expect(signup.match(/rememberPendingSignup\(email\);[^\n]*\n\s*navigate\("\/signup-pending", \{ state: \{ email \} \}\);/g)?.length).toBe(2);
    const pending = read("src/pages/auth/SignupPending.tsx");
    expect(pending).toMatch(/if \(sessionUser\?\.email_confirmed_at\) \{[\s\S]{0,200}clearPendingSignup\(\);/);
    expect(pending).toContain("onConfirmed={() => { clearPendingSignup();");
    // The card's button arrives with `resend` and sends once.
    expect(pending).toMatch(/if \(!resendAsked \|\| resendOnArrival\.current \|\| !prefillEmail\) return;\s*resendOnArrival\.current = true;\s*void handleResend\(\);/);
    expect(read("src/pages/auth/Login.tsx")).toMatch(/clearPendingSignup\(\);[^\n]*\n\s*navigate\(postAuthDestination\(postLoginDest\)/);
  });

  it("while waiting they can browse and start a post: /signup-pending links to jobs, a new job post and Declutter, all open to guests", () => {
    const pending = read("src/pages/auth/SignupPending.tsx");
    for (const to of ["/browse", "/post-job", "/declutter"]) expect(pending).toContain(`<Link to="${to}">`);
    const app = read("src/App.tsx");
    expect(app).toContain("<ProtectedRoute fullProfile allowGuest><PostJob /></ProtectedRoute>");
    expect(app).toMatch(/path="\/declutter" element=\{<RouteErrorBoundary>\{routeEl\(<DeclutterGuestOrMember/);
  });
});
