/**
 * Brand-tinted celebration confetti. Reused across first-job-posted,
 * first-review-left, and first-job-completed moments so the marketplace
 * has a consistent "win" beat.
 *
 * Limit: per-event firing capped to the first N occurrences (default 3)
 * — counter stored in safeStorage so we don't burn a DB column for a
 * delight beat. After the limit, the moment fades to a quiet checkmark
 * elsewhere in the flow.
 */
import { safeStorage } from "@/lib/safeStorage";

function getBrandColors(): string[] {
  if (typeof window === "undefined")
    return ["#5E6544", "#8C947D", "#A0613B", "#D4A55F", "#FAF8F5"];
  const s = getComputedStyle(document.documentElement);
  const r = (v: string, fb: string) => {
    const val = s.getPropertyValue(v).trim();
    return val ? `hsl(${val})` : fb;
  };
  return [
    r("--bark", "#5E6544"),
    r("--sage", "#8C947D"),
    r("--burnt-sienna", "#A0613B"),
    r("--gold-warm", "#D4A55F"),
    r("--parchment", "#FAF8F5"),
  ];
}

const STORAGE_KEYS: Record<CelebrateEvent, string> = {
  first_post: "helpr_post_count",
  first_review: "helpr_review_count",
  first_complete: "helpr_complete_count",
};

export type CelebrateEvent = "first_post" | "first_review" | "first_complete";

interface CelebrateOptions {
  /** How many times to fire this event before going quiet. Default 3. */
  limit?: number;
  /** Override origin (defaults to mid-screen). */
  originY?: number;
  /** More particles for bigger moments (default 80, payment success uses 120). */
  particleCount?: number;
}

export async function maybeCelebrate(
  event: CelebrateEvent,
  options: CelebrateOptions = {},
): Promise<void> {
  const { limit = 3, originY = 0.4, particleCount = 80 } = options;
  try {
    const key = STORAGE_KEYS[event];
    const current = parseInt(safeStorage.getItem(key) ?? "0", 10) || 0;
    if (current >= limit) return;
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount,
      spread: 70,
      origin: { y: originY },
      colors: getBrandColors(),
      scalar: 0.9,
    });
    safeStorage.setItem(key, String(current + 1));
  } catch {
    /* confetti is candy — never break the flow */
  }
}
