/**
 * Q1655: the /unsubscribe page changes nothing until the member taps the
 * button. On load it only asks the function to CHECK the link (no write); the
 * opt-out is posted by the tap, and the token is taken out of the address bar
 * (analytics records page URLs, and the token carries the email address).
 */
// @mutate src/pages/info/EmailUnsubscribe.tsx |     void postUnsubscribe(SUPABASE_URL, link, "check").then((r) => { |     void postUnsubscribe(SUPABASE_URL, link, "unsubscribe").then((r) => {
// @mutate src/pages/info/EmailUnsubscribe.tsx |       window.history.replaceState({ ...state, unsubscribeLink: fromUrl }, "", window.location.pathname); |       window.history.replaceState({ ...state, unsubscribeLink: fromUrl }, "", window.location.href);
// @mutate src/pages/info/EmailUnsubscribe.tsx |     onBody: (email: string) => `${email} is back to the email settings it had before you unsubscribed.`, |     onBody: (email: string) => `${email} will get Louisiana Helpr news and offers again.`,
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EmailUnsubscribe from "./EmailUnsubscribe";

const actions: string[] = [];

beforeEach(() => {
  actions.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const action = new URLSearchParams(String(init?.body ?? "")).get("action") ?? "";
      actions.push(action);
      return new Response(JSON.stringify({ ok: true, action, list: "promotions", email: "member@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  window.history.replaceState(null, "", "/unsubscribe#e=bWVtYmVy&sig=abc");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/unsubscribe"]}>
      <EmailUnsubscribe />
    </MemoryRouter>,
  );

describe("/unsubscribe", () => {
  it("only checks the link on load, and unsubscribes on the tap", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Unsubscribe" });
    expect(actions, "opening the page must write nothing").toEqual(["check"]);
    expect(screen.getByText(/member@example\.com/)).toBeTruthy();
    expect(window.location.hash, "the token leaves the address bar").toBe("");

    fireEvent.click(button);
    await screen.findByRole("heading", { name: "You're unsubscribed" });
    expect(actions).toEqual(["check", "unsubscribe"]);

    fireEvent.click(screen.getByRole("button", { name: "Resubscribe" }));
    await waitFor(() => expect(actions).toEqual(["check", "unsubscribe", "resubscribe"]));
    await screen.findByRole("heading", { name: "Unsubscribe undone" });
    // Q?unsub-resubscribe-consent: the undo restores only what was turned off,
    // so an address that never agreed to news and offers still gets none; the
    // page must not promise otherwise.
    expect(screen.queryByText(/news and offers again/i)).toBeNull();
    expect(screen.getByText(/back to the email settings it had before/)).toBeTruthy();
  });

  it("with no token, says to open the link from the email and posts nothing", async () => {
    window.history.replaceState(null, "", "/unsubscribe");
    renderPage();
    await screen.findByRole("heading", { name: "Open the link from your email" });
    expect(actions).toEqual([]);
  });
});
