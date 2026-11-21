/**
 * Owner 11-21 on the Log in / Create account card: "do we need a back button here so they can get back to home??".
 * Every auth card's top row (AuthCardMarkRow: /login, /signup's first step, and every AuthCardHead card: forgot
 * password, set a new password, check your email, confirm your email) holds the H, linking home, with the shared
 * BackButton at the card's top-left on the same line. The arrow goes back to where you came from inside the site,
 * else Home ("/"); one behaviour on phone web and in the app (no platform branch).
 *
 * @mutate src/components/auth/AuthCardHead.tsx |       <div className="absolute left-0 top-1/2 -translate-y-1/2" data-auth-card-back="">\n        <BackButton />\n      </div> |       <div className="absolute left-0 top-1/2 -translate-y-1/2" data-auth-card-back="" />
 * @mutate src/components/auth/AuthCardHead.tsx |       <AuthCardMarkRow />\n      <h1 |       <h1
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <AuthCardMarkRow /> | <span />
 * @mutate src/components/auth/AuthCardHead.tsx | <div className="relative mb-2 flex w-full items-center justify-center" data-auth-card-mark=""> | <div className="relative mb-2 flex w-full flex-col items-center justify-center" data-auth-card-mark="">
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { AuthCardHead } from "@/components/auth/AuthCardHead";

afterEach(cleanup);

const at = (entries: string[], index: number) => render(
  <MemoryRouter initialEntries={entries} initialIndex={index}>
    <Routes>
      <Route path="/" element={<p>landing page</p>} />
      <Route path="/declutter" element={<p>declutter page</p>} />
      <Route path="/forgot-password" element={<AuthCardHead title="Reset your password" />} />
    </Routes>
  </MemoryRouter>,
);

describe("auth cards: a back arrow at the card's top-left, beside the H that links home", () => {
  it("the arrow and the H share the card's top row, arrow first, and the H links home", () => {
    at(["/forgot-password"], 0);
    const back = screen.getByRole("button", { name: "Go back" });
    const row = document.querySelector("[data-auth-card-mark]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.contains(back)).toBe(true);
    const home = row.querySelector("a[href='/']");
    expect(home).not.toBeNull();
    expect(back.compareDocumentPosition(home!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "items-center", "justify-center"]));
    expect(row.className).not.toMatch(/flex-col/);
    // Above the heading, inside the card head.
    expect(back.compareDocumentPosition(screen.getByRole("heading", { name: "Reset your password" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("cold (no history inside the site): it goes Home", () => {
    at(["/forgot-password"], 0);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByText("landing page")).toBeInTheDocument();
  });

  it("every auth card head uses the one row: Log in, Create account step 1, and AuthCardHead", () => {
    const files = ["src/pages/auth/Login.tsx", "src/pages/auth/signup/SignupStep1.tsx", "src/components/auth/AuthCardHead.tsx"];
    for (const f of files) expect(blankComments(readFileSync(f, "utf8")), f).toContain("<AuthCardMarkRow />");
    const users = ["src/pages/auth/ForgotPassword.tsx", "src/pages/auth/ResetPassword.tsx", "src/pages/auth/SignupPending.tsx"];
    for (const f of users) expect(blankComments(readFileSync(f, "utf8")), f).toMatch(/<AuthCardHead\b/);
    // No platform branch in the row.
    expect(blankComments(readFileSync("src/components/auth/AuthCardHead.tsx", "utf8"))).not.toMatch(/isNativePlatform|Capacitor/);
  });
});
