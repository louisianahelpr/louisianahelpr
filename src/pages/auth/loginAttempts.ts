import { safeStorage } from "@/lib/safeStorage";

// Moved out of Login.tsx unchanged (component-size ratchet, Q806).
// Anti-bruteforce: 5 failed attempts in a rolling 5-minute window triggers
// a soft lockout. Persisted to safeStorage so a force-quit doesn't reset
// the counter — otherwise an attacker on a stolen phone could kill the app
// between guesses and ignore the cooldown.
const LOGIN_ATTEMPTS_KEY = "helpr_login_attempts";
export const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

export interface LoginAttemptState {
  /** Epoch ms timestamps of failed attempts inside the rolling window. */
  attempts: number[];
  /** If non-null, the epoch ms when the lockout expires. */
  lockedUntil: number | null;
}

export function readAttemptState(): LoginAttemptState {
  try {
    const raw = safeStorage.getItem(LOGIN_ATTEMPTS_KEY);
    if (!raw) return { attempts: [], lockedUntil: null };
    const parsed = JSON.parse(raw) as LoginAttemptState;
    const now = Date.now();
    return {
      attempts: (parsed.attempts ?? []).filter(
        (t) => typeof t === "number" && now - t < LOGIN_ATTEMPT_WINDOW_MS,
      ),
      lockedUntil:
        parsed.lockedUntil && parsed.lockedUntil > now ? parsed.lockedUntil : null,
    };
  } catch {
    // Silent by design: an unreadable or corrupt attempt record resets the
    // client-side rate-limit hint to "no attempts yet". That is only a UI
    // affordance — the real throttle is server-side — so failing open here
    // costs a local hint, not a protection. Reporting would fire for every
    // private-mode user on every load.
    return { attempts: [], lockedUntil: null };
  }
}

export function writeAttemptState(state: LoginAttemptState): void {
  try {
    safeStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(state));
  } catch {
    // Silent by design, and unreachable in practice — safeStorage already
    // swallows the quota/private-mode throw. Same reasoning as the read
    // above: this record only drives a local hint, never the real throttle.
  }
}

export function clearAttemptState(): void {
  safeStorage.removeItem(LOGIN_ATTEMPTS_KEY);
}
