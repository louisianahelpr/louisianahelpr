/**
 * OA-010: an unrecognised provider error must read "<Provider> sign-in didn't work".
 * @mutate src/lib/socialAuth.ts | recognizedAuthError(raw) ?? | (recognizedAuthError(raw) ?? "Couldn't sign you in — give it another try?") ??
 */
// signInWithProvider locks in:
//   - structured result kinds (success / redirecting / cancelled / error)
//   - never throws; the UI switches on `kind`
//   - friendly-error mapping wraps raw Supabase/native messages
//   - cancel detection on the native cancel codes the plugin returns
//
// Web fallback path is exercised via isPluginAvailable=false, native via
// isNativePlatform=true + isPluginAvailable("SocialLogin")=true so we
// hit nativeSignIn → SocialLogin.login → supabase.signInWithIdToken.

import { describe, it, expect, vi, beforeEach } from "vitest";

const initializeMock = vi.fn();
const loginMock = vi.fn();
const signInWithIdTokenMock = vi.fn();
const signInWithOAuthMock = vi.fn();
const rpcMock = vi.fn();
const isNativePlatformMock = vi.fn();
const isPluginAvailableMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
    isPluginAvailable: (name: string) => isPluginAvailableMock(name),
  },
}));

vi.mock("@capgo/capacitor-social-login", () => ({
  SocialLogin: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    login: (...args: unknown[]) => loginMock(...args),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...args: unknown[]) => reportMock(...args) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: unknown[]) => signInWithIdTokenMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

beforeEach(() => {
  vi.resetModules();
  initializeMock.mockReset();
  loginMock.mockReset();
  signInWithIdTokenMock.mockReset();
  signInWithOAuthMock.mockReset();
  rpcMock.mockReset();
  isNativePlatformMock.mockReset();
  isPluginAvailableMock.mockReset();
});

async function load() {
  return await import("./socialAuth");
}

describe("signInWithProvider — native path", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
  });

  it("returns kind=success for Apple when login + signInWithIdToken succeed", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result).toEqual({ kind: "success" });
    expect(loginMock).toHaveBeenCalledWith({
      provider: "apple",
      options: { scopes: ["email", "name"] },
    });
    expect(signInWithIdTokenMock).toHaveBeenCalledWith({
      provider: "apple",
      token: "apple-jwt",
    });
  });

  it("returns kind=success for Google", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("google");
    expect(result).toEqual({ kind: "success" });
    expect(loginMock).toHaveBeenCalledWith({
      provider: "google",
      options: { scopes: ["email", "profile"] },
    });
  });

  it("returns kind=cancelled when the native plugin throws ASAuthorizationError 1001", async () => {
    loginMock.mockRejectedValue(new Error("ASAuthorizationError 1001: canceled"));

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result).toEqual({ kind: "cancelled" });
    // Cancel must not reach Supabase — we never minted a token.
    expect(signInWithIdTokenMock).not.toHaveBeenCalled();
  });

  it("returns kind=cancelled when Google SDK throws SIGN_IN_CANCELLED", async () => {
    loginMock.mockRejectedValue(new Error("SIGN_IN_CANCELLED"));

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("google");
    expect(result).toEqual({ kind: "cancelled" });
  });

  it("returns kind=error with friendly copy when no idToken is returned", async () => {
    loginMock.mockResolvedValue({ result: {} });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/Apple sign-in didn't work/);
    }
  });

  it("returns kind=error with friendly copy when supabase signInWithIdToken errors", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({
      error: { message: "id_token verification failed" },
    });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("google");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      // Should NOT leak the raw "id_token verification failed" string.
      expect(result.message).not.toMatch(/id_token/);
    }
  });
});

describe("signInWithProvider — web fallback path", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    isPluginAvailableMock.mockReturnValue(false);
  });

  it("calls supabase.auth.signInWithOAuth and returns kind=redirecting", async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("google", {
      redirectTo: "https://example.com/home",
    });
    expect(result).toEqual({ kind: "redirecting" });
    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.com/home" },
    });
    // Native path must not be touched on web.
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("returns kind=error with friendly copy when supabase OAuth errors", async () => {
    signInWithOAuthMock.mockResolvedValue({
      error: { message: "provider misconfigured" },
    });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/Apple sign-in didn't work/);
    }
  });

  // CONTRACT INVERTED 2026-08-20, by the owner's decision.
  //
  // This used to assert that native falls back to web OAuth when the plugin is
  // missing. That fallback navigates the WebView, which opens an in-app browser
  // sheet and redirects to the app's OWN origin — so the sheet rendered Helpr's
  // own login page inside browser chrome with an X in the corner. The owner hit
  // it on a real device, did not recognise it as their app, and asked for that
  // screen to be deleted.
  //
  // A missing plugin on a native build is a BUILD defect. Report it; do not
  // paper over it with a second, unrecognisable login surface.
  it("returns an error on native when the SocialLogin plugin isn't available — never opens the web sheet", async () => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(false);
    signInWithOAuthMock.mockResolvedValue({ error: null });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result.kind).toBe("error");
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });
});

describe("isSocialLoginPluginAvailable", () => {
  it("false on web", async () => {
    isNativePlatformMock.mockReturnValue(false);
    const { isSocialLoginPluginAvailable } = await load();
    expect(isSocialLoginPluginAvailable()).toBe(false);
  });

  it("true on native when Capacitor reports the plugin is wired", async () => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    const { isSocialLoginPluginAvailable } = await load();
    expect(isSocialLoginPluginAvailable()).toBe(true);
  });
});

// AUTH, contract inverted 2026-08-20 by the owner. Without this branch a native
// build whose SocialLogin pod did not link falls through to web OAuth, which
// opens an in-app browser sheet rendering Helpr's OWN login page inside browser
// chrome — the screen the owner hit on device and did not recognise as theirs.
// @mutate src/lib/socialAuth.ts | if (Capacitor.isNativePlatform()) { | if (false) {

// OA-018: GoTrue's identity-linking refusals are permanent for the attempt,
// so they get their own copy instead of "give it another try?".
describe("signInWithProvider — linking refusals (OA-018)", () => {
  it("native: provider_email_needs_verification names the provider and the fix", async () => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({
      error: {
        code: "provider_email_needs_verification",
        message: "Unverified email with google. A confirmation email has been sent to your google email",
      },
    });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("google");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/isn't verified yet/);
      expect(result.message).toMatch(/Verify it with Google/);
      expect(result.message).not.toMatch(/give it another try/);
    }
  });

  it("native: an unverified provider email is reported as a warning, a server fault as an error", async () => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    const { signInWithProvider } = await load();

    reportMock.mockReset();
    signInWithIdTokenMock.mockResolvedValue({ error: { code: "provider_email_needs_verification", message: "Unverified email with google" } });
    await signInWithProvider("google");
    expect(reportMock.mock.calls[0][1].severity).toBe("warning");

    reportMock.mockReset();
    signInWithIdTokenMock.mockResolvedValue({ error: { code: "unexpected_failure", message: "Database error saving new user" } });
    await signInWithProvider("google");
    expect(reportMock.mock.calls[0][1].severity).toBe("error");
  });

  it("native: two accounts on one address (no GoTrue code) is named, not retried", async () => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({
      error: {
        code: "unexpected_failure",
        message: "Multiple accounts with the same email address in the same linking domain detected: default",
      },
    });

    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result.kind === "error" && result.message).toMatch(/More than one Helpr account uses this email/);
  });

  it("web: marks the round trip as pending before leaving the page", async () => {
    isNativePlatformMock.mockReturnValue(false);
    isPluginAvailableMock.mockReturnValue(false);
    sessionStorage.clear();
    signInWithOAuthMock.mockImplementation(async () => {
      // The marker must already be written when the browser navigates away.
      expect(JSON.parse(sessionStorage.getItem("helpr_oauth_pending") ?? "{}").provider).toBe("apple");
      return { error: null };
    });

    const { signInWithProvider } = await load();
    expect(await signInWithProvider("apple")).toEqual({ kind: "redirecting" });
    expect(signInWithOAuthMock).toHaveBeenCalledTimes(1);
  });

  it("web: clears the marker when the redirect never left (signInWithOAuth errored)", async () => {
    isNativePlatformMock.mockReturnValue(false);
    isPluginAvailableMock.mockReturnValue(false);
    sessionStorage.clear();
    signInWithOAuthMock.mockResolvedValue({ error: { message: "provider misconfigured" } });

    const { signInWithProvider } = await load();
    expect((await signInWithProvider("google")).kind).toBe("error");
    expect(sessionStorage.getItem("helpr_oauth_pending")).toBeNull();
  });

  it("web: the marker records the redirect's path", async () => {
    isNativePlatformMock.mockReturnValue(false);
    isPluginAvailableMock.mockReturnValue(false);
    sessionStorage.clear();
    signInWithOAuthMock.mockResolvedValue({ error: null });

    const { signInWithProvider } = await load();
    await signInWithProvider("google", { redirectTo: "https://example.com/home" });
    expect(JSON.parse(sessionStorage.getItem("helpr_oauth_pending") ?? "{}").path).toBe("/home");
  });
});

// Q446: a sign-in that matches no account is refused by the Before User
// Created hook (migration 20261005182630) with `lh_account_choice:<id>`. The
// app must ask before anything is created, and only "I'm new here" retries.
describe("one account per person (Q446)", () => {
  const CHOICE = "lh_account_choice:0f8c4a52-6a0e-4d55-9a53-1b2c3d4e5f60:relay";
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    isPluginAvailableMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt" } });
    reportMock.mockReset();
  });

  it("native: the refusal becomes a choice (with the token kept), never an error or a report", async () => {
    signInWithIdTokenMock.mockResolvedValue({ error: { status: 403, code: "unknown", message: CHOICE } });
    const { signInWithProvider } = await load();
    const result = await signInWithProvider("apple");
    expect(result).toEqual({
      kind: "choose",
      choice: { provider: "apple", choiceId: "0f8c4a52-6a0e-4d55-9a53-1b2c3d4e5f60", relay: true, idToken: "apple-jwt" },
    });
    expect(signInWithIdTokenMock).toHaveBeenCalledTimes(1);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("I'm new here: marks the choice, then replays the same token", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    signInWithIdTokenMock.mockResolvedValue({ error: null });
    const { continueAsNewAccount } = await load();
    const result = await continueAsNewAccount({ provider: "apple", choiceId: "c-1", relay: true, idToken: "apple-jwt" });
    expect(result).toEqual({ kind: "success" });
    expect(rpcMock).toHaveBeenCalledWith("choose_new_social_account", { p_choice: "c-1" });
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(signInWithIdTokenMock.mock.invocationCallOrder[0]);
    expect(signInWithIdTokenMock).toHaveBeenCalledWith({ provider: "apple", token: "apple-jwt" });
  });

  it("I'm new here: an expired choice signs nobody in", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const { continueAsNewAccount } = await load();
    const result = await continueAsNewAccount({ provider: "apple", choiceId: "c-1", relay: false, idToken: "apple-jwt" });
    expect(result.kind).toBe("error");
    expect(signInWithIdTokenMock).not.toHaveBeenCalled();
  });

  it("web: I'm new here marks the choice, then goes back through the provider", async () => {
    isNativePlatformMock.mockReturnValue(false);
    isPluginAvailableMock.mockReturnValue(false);
    rpcMock.mockResolvedValue({ data: true, error: null });
    signInWithOAuthMock.mockResolvedValue({ error: null });
    const { continueAsNewAccount } = await load();
    expect(await continueAsNewAccount({ provider: "google", choiceId: "c-2", relay: false })).toEqual({ kind: "redirecting" });
    expect(signInWithOAuthMock).toHaveBeenCalledTimes(1);
  });
});
