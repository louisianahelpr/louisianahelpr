/**
 * Who the app believes is signed in, mirrored from useAuthReady's snapshot
 * (src/hooks/useAuthReady.ts writes every snapshot here) for async work that
 * must not carry on past its user's sign-out.
 *
 * A3-L10 (app audit 2026-10-28): useCurrentUser's admin-role lookup retries
 * (3 tries, 250/500 ms apart) kept reading user_roles after Log out, as anon.
 *
 * Its own module, not an export of useAuthReady, so the many tests that mock
 * useAuthReady leave it untouched: never written, it reads "not known yet"
 * and the work goes on as before.
 */
let mirrored: { isReady: boolean; userId: string | null } = { isReady: false, userId: null };

export function noteAuthUser(isReady: boolean, userId: string | null): void {
  mirrored = { isReady, userId };
}

/**
 * Has `userId` stopped being the signed-in user (signed out, or someone else
 * signed in)? False while auth is not ready: nothing is known then.
 */
export function authUserChangedFrom(userId: string): boolean {
  return mirrored.isReady && mirrored.userId !== userId;
}
