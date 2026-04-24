/**
 * Tracks "have we shown onboarding to this user yet" + "should we re-engage".
 *
 * Storage rules:
 *   helpr_onboarding_completed_at  → ISO timestamp, set when user finishes/skips
 *   helpr_last_seen_at              → ISO timestamp, refreshed on every app open
 *
 * The 30-day re-engagement banner shows when last_seen_at > 30 days ago.
 *
 * Routed through safeStorage so iOS WebKit eviction doesn't reset state.
 */
import { safeStorage } from "@/lib/safeStorage";

const COMPLETED_KEY = "helpr_onboarding_completed_at";
const LAST_SEEN_KEY = "helpr_last_seen_at";

export function isOnboardingComplete(): boolean {
  return Boolean(safeStorage.getItem(COMPLETED_KEY));
}

export function markOnboardingComplete() {
  safeStorage.setItem(COMPLETED_KEY, new Date().toISOString());
}

export function recordAppOpen() {
  safeStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}

export function daysSinceLastSeen(): number {
  const raw = safeStorage.getItem(LAST_SEEN_KEY);
  if (!raw) return 0;
  const last = new Date(raw).getTime();
  if (isNaN(last)) return 0;
  return Math.floor((Date.now() - last) / (1000 * 60 * 60 * 24));
}

export function shouldShowReengagement(): boolean {
  return daysSinceLastSeen() >= 30;
}
