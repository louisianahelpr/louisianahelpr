import { safeStorage } from "@/lib/safeStorage";
import { getBrandColors } from "@/lib/celebrate";

// Fires brand-tinted confetti for the user's first 3 successful posts.
// After post #3 the novelty fades back to a quiet checkmark — counter
// kept in safeStorage (per-device, not per-account) so we don't burn
// a DB column on a vibe.
const FIRST_POST_CONFETTI_LIMIT = 3;

export async function maybeFireFirstPostConfetti() {
  try {
    const key = "helpr_post_count";
    const current = parseInt(safeStorage.getItem(key) ?? "0", 10) || 0;
    if (current >= FIRST_POST_CONFETTI_LIMIT) return;
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.4 },
      colors: getBrandColors(),
      scalar: 0.9,
    });
    safeStorage.setItem(key, String(current + 1));
  } catch {
    /* confetti is candy — never break the flow */
  }
}
