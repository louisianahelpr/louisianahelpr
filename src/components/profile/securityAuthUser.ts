import type { User, UserIdentity } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * ONE auth `/user` read for the whole Security tab (docs/OPEN.md Q1648).
 *
 * `supabase.auth.mfa.listFactors()` and `supabase.auth.getUserIdentities()`
 * are thin wrappers: each one awaits its own `getUser()`, which is a network
 * GET of auth/v1/user (read in @supabase/auth-js 2.117.2 GoTrueClient
 * `_listFactors` and `getUserIdentities`; with no `lock` option, which this app
 * does not set, the calls are not queued behind each other). The tab gates its
 * first paint on the factor read (useArrivalGate, Q169), and SignInMethodsCard
 * only mounts after that gate, so its identity read started only once the
 * first one had answered. On e2e-journeys 37996630522 (iphone-webkit
 * slow-heavy) the trace shows auth/v1/user answering in 8042 ms, then a second
 * auth/v1/user starting 8 ms later, still pending when the 15 s health check
 * gave up: two identical round trips back to back.
 *
 * Both cards now read the same query (this key). The factor list and the
 * identity list are derived from the one User the way auth-js derives them,
 * so the tab costs one round trip, and the gate that waits for it covers both
 * cards. Guard: src/components/profile/securityTabOneAuthRead.test.tsx.
 */
export const SECURITY_AUTH_USER_KEY = ["security", "auth-user"] as const;

export async function readSecurityAuthUser(): Promise<User> {
  const user = unwrap<{ user: User | null }>(await supabase.auth.getUser()).user;
  // getUser pairs a null user with an error, which unwrap() has thrown; a
  // null here without one is still not "an account with no factors".
  if (!user) throw new Error("security: no signed-in user");
  return user;
}

export interface VerifiedFactor {
  id: string;
  friendlyName: string | null | undefined;
}

/** auth-js `_listFactors` keeps a factor in `totp` only when verified; this is that, first match. */
export function verifiedTotpOf(user: User): VerifiedFactor | null {
  const totp = (user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
  return totp ? { id: totp.id, friendlyName: totp.friendly_name } : null;
}

/** auth-js `getUserIdentities`: `user.identities ?? []`. */
export function identitiesOf(user: User): UserIdentity[] {
  return user.identities ?? [];
}
