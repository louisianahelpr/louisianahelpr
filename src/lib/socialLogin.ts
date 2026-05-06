import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { supabase } from "@/integrations/supabase/client";

// Initialize @capgo/capacitor-social-login on native platforms.
// No-op on web — web flow uses supabase.auth.signInWithOAuth in the
// individual button components.
//
// Call once from main.tsx during app boot. Idempotent guard so dev
// hot-reload doesn't re-init.
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

// Native Apple sign-in. Uses Apple's ASAuthorization framework via the
// plugin, then exchanges the returned idToken for a Supabase session.
// Throws on failure — caller handles toast.
export async function nativeAppleSignIn(): Promise<void> {
  await initSocialLogin();
  const { result } = await SocialLogin.login({
    provider: "apple",
    options: { scopes: ["email", "name"] },
  });
  // result has idToken when Apple sign-in succeeds
  const idToken = (result as { idToken?: string })?.idToken;
  if (!idToken) throw new Error("Apple sign-in returned no idToken");
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: idToken,
  });
  if (error) throw error;
}

// Native Google sign-in. Uses the iOS Sign-In SDK via the plugin, then
// exchanges the returned idToken for a Supabase session. Throws on
// failure — caller handles toast.
export async function nativeGoogleSignIn(): Promise<void> {
  await initSocialLogin();
  const { result } = await SocialLogin.login({
    provider: "google",
    options: { scopes: ["email", "profile"] },
  });
  const idToken = (result as { idToken?: string })?.idToken;
  if (!idToken) throw new Error("Google sign-in returned no idToken");
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
}
