// Persists which auth method the user last successfully used so the Login
// screen can show a quiet "Last time you used Google" hint above the
// buttons. Surfaces the method even after a force-quit by riding the
// safeStorage Preferences mirror.
//
// Written on every successful sign-in path:
//   - email/password   → "email"
//   - Google OAuth     → "google"
//   - Apple OAuth      → "apple"
//
// The hint is intentionally a small UX nudge, not a security signal:
// nothing user-private is stored — just a short string label — so we
// stash it without identifying who the user is.

import { safeStorage } from "@/lib/safeStorage";

export type AuthMethod = "email" | "google" | "apple";

// The handoff brief mentions `helpr.last_auth_method` as the key, but
// safeStorage mirrors keys via the `helpr_` prefix — using a dot would
// silently skip the durable Preferences mirror. Underscore matches the
// rest of the app's persistence convention.
const KEY = "helpr_last_auth_method";

export function setLastAuthMethod(method: AuthMethod): void {
  safeStorage.setItem(KEY, method);
}
