// socialLogin wraps the native Apple/Google OAuth plugins and exchanges
// the returned idToken for a Supabase session. Critical contract:
//   - initSocialLogin must be idempotent (dev hot-reload safe)
//   - the apple+google IDs in the config MUST match what's in
//     reference_oauth_client_ids.md / Supabase Studio. Drift here means
//     auth silently fails for native users.
//   - sign-in throws on any failure so the caller can toast properly
//   - Q1791: on iOS the Apple authorization code goes to apple-token-store
// @mutate src/lib/socialAuth.ts |   if (error) throw error;\n  storeAppleToken(appleCode); |   if (error) throw error;\n  void appleCode;
// @mutate src/lib/socialAuth.ts |   if (Capacitor.getPlatform() !== "ios") return null; |   if (Capacitor.getPlatform() === "ios") return null;

import { describe, it, expect, vi, beforeEach } from "vitest";

const initializeMock = vi.fn();
const loginMock = vi.fn();
const signInWithIdTokenMock = vi.fn();
const isNativePlatformMock = vi.fn();
const getPlatformMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
    getPlatform: () => getPlatformMock(),
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
    },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

beforeEach(() => {
  vi.resetModules();
  initializeMock.mockReset();
  loginMock.mockReset();
  signInWithIdTokenMock.mockReset();
  isNativePlatformMock.mockReset();
  getPlatformMock.mockReset().mockReturnValue("android");
  invokeMock.mockReset().mockResolvedValue({ data: { stored: true }, error: null });
});

async function load() {
  return await import("./socialLogin");
}

describe("initSocialLogin — gates + idempotency", () => {
  it("no-ops on web (isNativePlatform=false)", async () => {
    isNativePlatformMock.mockReturnValue(false);
    const { initSocialLogin } = await load();
    await initSocialLogin();
    expect(initializeMock).not.toHaveBeenCalled();
  });

  it("initializes Apple + Google with the canonical IDs from reference_oauth_client_ids", async () => {
    isNativePlatformMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    const { initSocialLogin } = await load();
    await initSocialLogin();

    expect(initializeMock).toHaveBeenCalledOnce();
    const config = initializeMock.mock.calls[0][0];
    expect(config.apple.clientId).toBe("com.Helpr.signin");
    expect(config.google.iOSClientId).toBe(
      "830470550612-4q4rslusnsu72c62vo18udtjb638q8is.apps.googleusercontent.com",
    );
    expect(config.google.mode).toBe("online");
  });

  it("idempotent — second call no-ops (dev hot-reload safe)", async () => {
    isNativePlatformMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
    const { initSocialLogin } = await load();
    await initSocialLogin();
    await initSocialLogin();
    expect(initializeMock).toHaveBeenCalledOnce();
  });
});

describe("nativeAppleSignIn", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
  });

  it("logs in with provider=apple + scopes, exchanges idToken for Supabase session", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });

    const { nativeAppleSignIn } = await load();
    await nativeAppleSignIn();

    expect(loginMock).toHaveBeenCalledWith({
      provider: "apple",
      options: { scopes: ["email", "name"] },
    });
    expect(signInWithIdTokenMock).toHaveBeenCalledWith({
      provider: "apple",
      token: "apple-jwt",
    });
  });

  // Q1791: on iOS the one-time Apple code goes to apple-token-store (App ID client) so
  // account deletion can revoke the Apple token; nowhere else, and never on failure.
  it("iOS: hands the Apple authorization code to apple-token-store after sign-in", async () => {
    getPlatformMock.mockReturnValue("ios");
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt", accessToken: { token: "apple-code" } } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });
    const { nativeAppleSignIn } = await load();
    await nativeAppleSignIn();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("apple-token-store", {
      body: { authorizationCode: "apple-code", clientId: "com.Helpr" },
    });
  });

  it("no code is stored off iOS, or when sign-in fails", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt", accessToken: { token: "apple-code" } } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });
    const { nativeAppleSignIn } = await load();
    await nativeAppleSignIn();
    expect(invokeMock).not.toHaveBeenCalled();
    getPlatformMock.mockReturnValue("ios");
    signInWithIdTokenMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(nativeAppleSignIn()).rejects.toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("throws when no idToken returned (defensive)", async () => {
    loginMock.mockResolvedValue({ result: {} });
    const { nativeAppleSignIn } = await load();
    await expect(nativeAppleSignIn()).rejects.toThrow(/no idToken/);
  });

  it("throws when supabase signInWithIdToken errors", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "apple-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({
      error: { message: "invalid token" },
    });

    const { nativeAppleSignIn } = await load();
    await expect(nativeAppleSignIn()).rejects.toBeTruthy();
  });
});

describe("nativeGoogleSignIn", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    initializeMock.mockResolvedValue(undefined);
  });

  it("logs in with provider=google + scopes, exchanges idToken for Supabase session", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({ error: null });

    const { nativeGoogleSignIn } = await load();
    await nativeGoogleSignIn();

    expect(loginMock).toHaveBeenCalledWith({
      provider: "google",
      options: { scopes: ["email", "profile"] },
    });
    expect(signInWithIdTokenMock).toHaveBeenCalledWith({
      provider: "google",
      token: "google-jwt",
    });
  });

  it("throws when no idToken returned", async () => {
    loginMock.mockResolvedValue({ result: {} });
    const { nativeGoogleSignIn } = await load();
    await expect(nativeGoogleSignIn()).rejects.toThrow(/no idToken/);
  });

  it("throws when supabase signInWithIdToken errors", async () => {
    loginMock.mockResolvedValue({ result: { idToken: "google-jwt" } });
    signInWithIdTokenMock.mockResolvedValue({
      error: { message: "session refused" },
    });

    const { nativeGoogleSignIn } = await load();
    await expect(nativeGoogleSignIn()).rejects.toBeTruthy();
  });
});
// Drop the Supabase error and both native sign-ins resolve successfully with no
// session — the caller navigates to /home and the app bounces them back out.
// @mutate src/lib/socialAuth.ts | if (error) throw error; | void error;
