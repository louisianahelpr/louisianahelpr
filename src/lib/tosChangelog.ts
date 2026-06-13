/** Current ToS version string (ISO date of last meaningful policy change). */
export const CURRENT_TOS_VERSION = "2026-06-01";

export interface TosChange {
  section: string;
  summary: string;
}

/**
 * Changelog entries keyed by version string.
 * Add a new entry (keyed by the new CURRENT_TOS_VERSION) whenever the Terms
 * of Service change. Keep entries to 2–4 bullets — this is a user-friendly
 * summary, not a full legal diff.
 */
export const TOS_CHANGELOG: Record<string, TosChange[]> = {
  "2026-06-01": [
    {
      section: "Payments",
      summary:
        "Added Stripe Connect escrow details and clarified the dispute process for held funds.",
    },
    {
      section: "Privacy",
      summary:
        "Clarified how location data is retained after job completion and how to request deletion.",
    },
    {
      section: "Prohibited conduct",
      summary:
        "Added examples of off-platform solicitation that result in immediate account termination.",
    },
  ],
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

const DISMISSED_KEY = (v: string) => `helpr_tos_dismissed_${v}`;

/**
 * Returns true if the user has already dismissed the banner for `version`.
 * Safe to call during SSR (returns true so the banner never flickers in).
 */
export function isTosChangeDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY(version)) === "1";
  } catch {
    return true;
  }
}

/**
 * Record that the user dismissed the banner for `version` so it doesn't
 * reappear on the next visit.
 */
export function dismissTosChange(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY(version), "1");
  } catch {
    // Ignore quota / private-mode errors — worst case the banner re-shows.
  }
}
