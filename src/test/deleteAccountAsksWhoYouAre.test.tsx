/**
 * A3-I5 (owner 2026-10-29): deleting an account asks for the password first,
 * and a member with no password (Google / Apple sign-up) gets an emailed code
 * instead of being locked out. Typing DELETE alone only proved someone held an
 * unlocked, signed-in device.
 *
 * Two layers, both pinned:
 *  - the server: delete-own-account refuses (403 reauth_required) unless the
 *    token's newest sign-in (`amr` timestamp) is at most ten minutes old,
 *    checked before anything writes;
 *  - the dialog: the delete button stays off until a password (or a sent
 *    code) is entered, and the delete runs only after it checks out.
 */
// @mutate supabase/functions/delete-own-account/index.ts | if (!signedInWithin(token, REAUTH_WINDOW_SECONDS, Math.floor(Date.now() / 1000))) { | if (false) {
// @mutate supabase/functions/_shared/recentSignIn.ts |   return nowSeconds - at <= windowSeconds; |   return true;
// @mutate src/hooks/useDeleteAccount.ts |     if (!confirmed) { |     if (false) {
// @mutate src/components/profile/DeleteAccountDialog.tsx | disabled={deleteConfirmText !== CONFIRM_PHRASE \|\| !reauth.ready \|\| deletingAccount} | disabled={deleteConfirmText !== CONFIRM_PHRASE \|\| deletingAccount}
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { signedInWithin, lastSignInAt, REAUTH_WINDOW_SECONDS } from "../../supabase/functions/_shared/recentSignIn";

const invoke = vi.fn();
const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const currentUser: { user: { id: string; email: string; identities: { provider: string }[] } } = {
  user: { id: "u1", email: "member@example.com", identities: [{ provider: "email" }] },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signInWithOtp: (...a: unknown[]) => signInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: async () => {} }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

function Host() {
  const del = useDeleteAccount();
  return (
    <>
      <button type="button" onClick={del.requestDelete}>Open delete</button>
      {del.isOpen ? <DeleteAccountDialog {...del.dialogProps} /> : null}
    </>
  );
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  currentUser.user = { id: "u1", email: "member@example.com", identities: [{ provider: "email" }] };
});

async function openStepTwo() {
  render(<MemoryRouter initialEntries={["/profile"]}><Host /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /open delete/i }));
  fireEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
  fireEvent.change(await screen.findByLabelText(/type delete to confirm/i), { target: { value: "DELETE" } });
  return screen.getByRole("button", { name: /delete my account/i });
}

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("A3-I5 server: delete-own-account needs a sign-in from the last ten minutes", () => {
  const now = 1_800_000_000;
  it("accepts a token signed in just now, refuses one refreshed from an old sign-in", () => {
    expect(signedInWithin(jwt({ amr: [{ method: "password", timestamp: now - 30 }] }), REAUTH_WINDOW_SECONDS, now)).toBe(true);
    // A refreshed token keeps its sign-in time (measured on prod 2026-10-29).
    expect(signedInWithin(jwt({ amr: [{ method: "password", timestamp: now - 3600 }] }), REAUTH_WINDOW_SECONDS, now)).toBe(false);
    // The newest of several proofs counts (an old password session + a fresh code).
    expect(lastSignInAt(jwt({ amr: [{ method: "password", timestamp: now - 9000 }, { method: "otp", timestamp: now - 5 }] }))).toBe(now - 5);
    expect(REAUTH_WINDOW_SECONDS).toBe(600);
  });

  it("fails closed with no amr or a garbled token", () => {
    expect(signedInWithin(jwt({ sub: "u1" }), REAUTH_WINDOW_SECONDS, now)).toBe(false);
    expect(signedInWithin("not-a-jwt", REAUTH_WINDOW_SECONDS, now)).toBe(false);
    expect(signedInWithin("h.%%%.s", REAUTH_WINDOW_SECONDS, now)).toBe(false);
  });

  it("the edge function checks it before any write, and refuses with 403 reauth_required", () => {
    const src = blankComments(readFileSync("supabase/functions/delete-own-account/index.ts", "utf8"));
    const check = src.indexOf("if (!signedInWithin(token, REAUTH_WINDOW_SECONDS, Math.floor(Date.now() / 1000))) {");
    expect(check, "delete-own-account must call signedInWithin").toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf("closeUnpaidShopPages(supabaseAdmin"));
    expect(check).toBeLessThan(src.indexOf("purgeAccount(supabaseAdmin"));
    expect(check).toBeLessThan(src.indexOf("auth.admin.deleteUser("));
    const block = src.slice(check, src.indexOf("}", src.indexOf("status:", check)));
    expect(block).toMatch(/REAUTH_REQUIRED_CODE/);
    expect(block).toMatch(/status: 403/);
  });
});

describe("A3-I5 dialog: password first, then the delete", () => {
  it("keeps Delete off until the password is typed, checks it, then deletes", async () => {
    const del = await openStepTwo();
    expect(del).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: "hunter22" } });
    await waitFor(() => expect(del).toBeEnabled());
    fireEvent.click(del);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete-own-account", { body: { confirmation: "DELETE MY ACCOUNT" } }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "member@example.com", password: "hunter22", options: { captchaToken: undefined } });
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  });

  it("a wrong password deletes nothing, says so, and leaves the dialog open", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    const del = await openStepTwo();
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: "nope" } });
    fireEvent.click(del);
    expect(await screen.findByText(/that password isn't right/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeEnabled();
  });

  it("a member with no password (Google / Apple only) gets an emailed code, not a lock-out", async () => {
    currentUser.user = { id: "u2", email: "g@example.com", identities: [{ provider: "google" }] };
    const del = await openStepTwo();
    expect(screen.queryByLabelText(/your password/i)).toBeNull();
    expect(del).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));
    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith({ email: "g@example.com", options: { shouldCreateUser: false, captchaToken: undefined } }),
    );
    // The send shows a visible result, not only a flicked label (src/test/authEmailSendsShowAResult.test.ts).
    expect((await screen.findByText(/we sent a 6-digit code to/i)).textContent).toMatch(/we sent a 6-digit code to/i);
    fireEvent.change(await screen.findByLabelText(/code from the email/i), { target: { value: "123456" } });
    await waitFor(() => expect(del).toBeEnabled());
    fireEvent.click(del);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledWith({ email: "g@example.com", token: "123456", type: "email" });
  });

  it("a wrong code deletes nothing", async () => {
    currentUser.user = { id: "u2", email: "g@example.com", identities: [{ provider: "apple" }] };
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid" } });
    const del = await openStepTwo();
    fireEvent.click(screen.getByRole("button", { name: /^email me a code$/i }));
    fireEvent.change(await screen.findByLabelText(/code from the email/i), { target: { value: "000000" } });
    await waitFor(() => expect(del).toBeEnabled());
    fireEvent.click(del);
    expect(await screen.findByText(/that code isn't right/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a password member can switch to the code", async () => {
    await openStepTwo();
    fireEvent.click(screen.getByRole("button", { name: /no password\? email me a code/i }));
    expect(screen.getByRole("button", { name: /^email me a code$/i })).toBeInTheDocument();
  });
});
