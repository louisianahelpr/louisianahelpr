/**
 * declutter-ai-draft: the model's answer, whitelisted, typed and bounded
 * before it reaches the seller's form (the ai-job-builder A-002 rule: model
 * output is untrusted input). Dependency-free so vitest imports it
 * (src/test/declutterAiDraftSanitize.test.ts).
 */
export const DECLUTTER_CATEGORIES = [
  "furniture", "appliances", "electronics", "kitchen", "home_decor", "tools",
  "outdoor_garden", "sports_outdoors", "toys_games", "baby_kids", "clothing",
  "books_media", "other",
] as const;

export const DELIVERY_SIZES = ["small", "large", "xl"] as const;

export interface DeclutterDraft {
  title: string;
  description: string;
  category: (typeof DECLUTTER_CATEGORIES)[number];
  deliverySize: (typeof DELIVERY_SIZES)[number];
  conditionStars: number;
  flagged: boolean;
  /** Why the AI thinks the item may be banned (row 34); never shown to buyers. */
  flagReason: string | null;
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** null when the answer is unusable (no title). */
export function sanitizeDraft(raw: unknown): DeclutterDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? oneLine(r.title).slice(0, 80) : "";
  if (title.length < 3) return null;
  const description = typeof r.description === "string" ? r.description.trim().slice(0, 2000) : "";
  const category = (DECLUTTER_CATEGORIES as readonly string[]).includes(r.category as string)
    ? (r.category as DeclutterDraft["category"])
    : "other";
  const deliverySize = (DELIVERY_SIZES as readonly string[]).includes(r.delivery_size as string)
    ? (r.delivery_size as DeclutterDraft["deliverySize"])
    : "large";
  const stars = Math.round(Number(r.condition_stars));
  const conditionStars = Number.isFinite(stars) ? Math.min(5, Math.max(1, stars)) : 3;
  // Fail closed: anything but an explicit `false` from the model is a flag,
  // so a malformed answer sends the listing to an admin, never straight live.
  const flagged = r.possibly_banned !== false;
  const reasonRaw = typeof r.banned_reason === "string" ? oneLine(r.banned_reason).slice(0, 300) : "";
  const flagReason = flagged ? (reasonRaw || "The photo check could not confirm the item is allowed.") : null;
  return { title, description, category, deliverySize, conditionStars, flagged, flagReason };
}
