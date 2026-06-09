// socialAuth — single source of truth for Apple + Google sign-in.
//
// Wraps @capgo/capacitor-social-login on native (iOS/Android) and falls
// back to supabase.auth.signInWithOAuth on web. Surfaces structured
// results so the UI can:
//   - distinguish "user cancelled" from a real failure (no scary toast)
//   - emit hapticError on cancel/error per the haptics design
//   - map the raw provider/Supabase message to friendly copy via
//     friendlyAuthError, instead of leaking "id_token invalid" verbatim
//
// The legacy `socialLogin.ts` thin shim re-exports these so the existing
// vitest suite (src/lib/socialLogin.test.ts) still covers the native path
// without any churn.
import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/authErrors";

export type SocialProvider = "apple" | "google";

export type SocialSignInResult =
  | { kind: "success" }
  // Web OAuth always redirects the browser away from the page, so the
  // caller should keep the spinner up rather than navigate.
  | { kind: "redirecting" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

// Initialize the native plugin once. Idempotent so dev hot-reload doesn't
// re-init. Safe to call on web — no-ops there.
let initialized = false;
export async function initSocialLogin(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;
  await SocialLogin.initialize({
    apple: { clientId: "com.Helpr.signin" },
    google: {
      iOSClientId:
        "830470550612-4q4rslusnsu72c62vo18udtjb638q8is.apps.googleusercontent.com",
      mode: "online",
    },
  });
  initialized = true;
}

// True iff @capgo/capacitor-social-login is actually wired into the
// native shell. On web this is always false. On native it should be true
// once the plugin pod is installed and SocialLogin.initialize() succeeded
// at app boot — see src/lib/nativeInit.ts.
//
// Using Capacitor.isPluginAvailable("SocialLogin") rather than just
// isNativePlatform() means we'll gracefully fall back to the web OAuth
// flow even on a hypothetical native build where the pod wasn't linked
// (instead of throwing "plugin not implemented" at the user).
export function isSocialLoginPluginAvailable(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return Capacitor.isPluginAvailable("SocialLogin");
  } catch {
    return false;
  }
}

// Heuristic: the @capgo/capacitor-social-login plugin returns
// platform-specific cancel errors. ASAuthorization on iOS throws
// ASAuthorizationError.canceled (code 1001), Google's SDK uses
// "SIGN_IN_CANCELLED". Web OAuth never reaches this path because the
// browser redirects away — cancels there don't return to us.
function isCancelError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.toLowerCase();
  return (
    msg.includes("cancel") ||
    msg.includes("canceled") ||
    msg.includes("cancelled") ||
    msg.includes("user cancel") ||
    msg.includes("aborted") ||
    msg.includes("1001")
  );
}

// Provider-aware error string. Re-uses friendlyAuthError so the social
// flow shows the same warm copy as the email/password flow, with a final
// fallback that names the provider.
function friendlyProviderError(provider: SocialProvider, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw) return providerLabel(provider) + " sign-in failed. Please try again.";
  const mapped = friendlyAuthError(raw);
  // friendlyAuthError returns the generic fallback for unrecognised input;
  // when that happens, prefer a provider-named line over the bare generic.
  if (mapped === "Something went wrong. Please try again.") {
    return `${providerLabel(provider)} sign-in failed. Please try again.`;
  }
  return mapped;
}

function providerLabel(provider: SocialProvider): string {
  return provider === "apple" ? "Apple" : "Google";
}

// Internal: the native sign-in path. Throws on any non-cancel failure so
// the caller's catch can run friendlyProviderError + hapticError.
async function nativeSignIn(provider: SocialProvider): Promise<void> {
  await initSocialLogin();
  const options =
    provider === "apple"
      ? { scopes: ["email", "name"] }
      : { scopes: ["email", "profile"] };
  const { result } = await SocialLogin.login({ provider, options } as Parameters<
    typeof SocialLogin.login
  >[0]);
  const idToken = (result as { idToken?: string })?.idToken;
  if (!idToken) throw new Error(`${providerLabel(provider)} sign-in returned no idToken`);
  const { error } = await supabase.auth.signInWithIdToken({ provider, token: idToken });
  if (error) throw error;
}

// Public: drive an Apple or Google sign-in.
//   - On native (plugin available) → native ASAuthorization / GoogleSignIn flow
//     → supabase.auth.signInWithIdToken → returns { kind: "success" } so the
//     caller navigates to /dashboard.
//   - On web (or any platform where the plugin isn't wired) → supabase
//     OAuth redirect flow → returns { kind: "redirecting" } so the caller
//     leaves the spinner up; the post-redirect handler picks up the
//     session.
//   - User cancels the native sheet → { kind: "cancelled" } (no scary
//     toast; the caller still fires hapticError so the cancel feels
//     intentional).
//   - Anything else → { kind: "error", message } with friendly copy.
//
// Never throws. The caller switches on `kind`.
export async function signInWithProvider(
  provider: SocialProvider,
  opts: { redirectTo?: string } = {},
): Promise<SocialSignInResult> {
  if (isSocialLoginPluginAvailable()) {
    try {
      await nativeSignIn(provider);
      return { kind: "success" };
    } catch (err) {
      if (isCancelError(err)) return { kind: "cancelled" };
      return { kind: "error", message: friendlyProviderError(provider, err) };
    }
  }

  // Web fallback — supabase.auth.signInWithOAuth navigates the browser
  // straight to the provider's authorization page. We can't observe the
  // outcome here; the post-redirect handler at /dashboard (or redirectTo)
  // takes over.
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo:
          opts.redirectTo ??
          (typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined),
      },
    });
    if (error) {
      return { kind: "error", message: friendlyProviderError(provider, error) };
    }
    return { kind: "redirecting" };
  } catch (err) {
    return { kind: "error", message: friendlyProviderError(provider, err) };
  }
}

// Back-compat named exports — the existing tests + a couple of older call
// sites (AppleSignInButton.tsx, GoogleSignInButton.tsx) still reference
// these directly. They throw on failure so the legacy "try/catch around
// nativeAppleSignIn" call sites keep working.
export async function nativeAppleSignIn(): Promise<void> {
  await nativeSignIn("apple");
}

export async function nativeGoogleSignIn(): Promise<void> {
  await nativeSignIn("google");
}
