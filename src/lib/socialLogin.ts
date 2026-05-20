import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";

// Supabase client is dynamically imported (NOT statically) to keep the
// ~205KB supabase-js chunk out of the entry bundle. main.tsx -> nativeInit
// -> initSocialLogin used to pull supabase into the critical static graph
// (via this file's static import), which forced the supabase chunk to load
// and its top-level await (keychainStorageAdapter hydratePromise) to run
// before React could mount on native cold starts. Lazy-importing here keeps
// the sign-in functions identical at the call sites — the import resolves
// before the user can possibly tap the Apple/Google sign-in button.
async function getSupabase() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

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
  const supabase = await getSupabase();
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
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
}
