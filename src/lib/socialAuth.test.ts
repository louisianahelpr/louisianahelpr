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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: unknown[]) => signInWithIdTokenMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  initializeMock.mockReset();
  loginMock.mockReset();
  signInWithIdTokenMock.mockReset();
  signInWithOAuthMock.mockReset();
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
      redirectTo: "https://example.com/dashboard",
    });
    expect(result).toEqual({ kind: "redirecting" });
    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.com/dashboard" },
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
