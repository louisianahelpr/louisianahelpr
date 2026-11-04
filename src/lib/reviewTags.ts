import { HELPER_QUICK_TAGS, POSTER_QUICK_TAGS, RETIRED_QUICK_TAGS } from "@/components/reviewPanel/types";

/**
 * Q1088: review one-tap tags live in `reviews.tags` (migration 20261103224601_review_tags_column), not glued onto
 * the end of `reviews.feedback`.
 *
 * - Writers send `reviewSubmitFields(text)`: the trailing known tags go to `tags`, the prose stays in `feedback`.
 * - Readers that select `feedback` from `reviews` also select `tags` and show `reviewText(feedback, tags)`: the text the
 *   form used to store ("prose, Tag, Tag"), so every screen reads as before, old rows included (their `tags` is
 *   empty and their tags are still inside `feedback`). public.review_text(feedback, tags) is the same rule in SQL.
 * Guard: src/test/reviewTagsColumn.test.ts.
 */

/** Every one-tap tag the review form can write, both directions, retired ones included (stored rows hold them). */
export const ALL_QUICK_TAGS: readonly string[] = [...new Set([...HELPER_QUICK_TAGS, ...POSTER_QUICK_TAGS, ...RETIRED_QUICK_TAGS])];

/**
 * Pull the one-tap tags back out of a free-text comment: only a TRAILING run of parts, each matching a known tag
 * exactly; the prose comes back byte-identical (rejoined with the ", " it was split on). See reviewCard.tsx.
 */
export function splitReviewTags(feedback: string | null | undefined): { prose: string | null; tags: string[] } {
  if (!feedback) return { prose: null, tags: [] };
  const parts = feedback.split(", ");
  let cut = parts.length;
  while (cut > 0 && ALL_QUICK_TAGS.includes(parts[cut - 1])) cut -= 1;
  // All tags and nothing else is a legitimate review (the form lets you submit with no prose), so prose is null.
  const prose = parts.slice(0, cut).join(", ").trim();
  return { prose: prose.length > 0 ? prose : null, tags: parts.slice(cut) };
}

/** The columns a new review row gets from the form's one text box: prose in feedback, the picked tags in tags. */
export function reviewSubmitFields(text: string): { feedback: string | null; tags: string[] } {
  const { prose, tags } = splitReviewTags(text.trim());
  return { feedback: prose, tags: [...new Set(tags)] };
}

/** The text a review shows (public.review_text in SQL): the prose, then its tags, joined by ", ". */
export function reviewText(feedback: string | null | undefined, tags: readonly string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return feedback ?? null;
  const prose = feedback?.trim();
  return [...(prose ? [prose] : []), ...tags].join(", ");
}

type PgResult = { error: { code?: string | null; message?: string | null } | null };

/**
 * The `tags` column is not on this database yet (42703 / PGRST204). Not notDeployedYet.ts: that module sits in the
 * home-schedule-reads chunk, and importing it from here (signed-in-shared) pulled scheduleChange/scheduleClashes onto
 * every first screen (check-deferred-vendors, train 7).
 */
function tagsColumnMissing(error: PgResult["error"]): boolean {
  const code = String(error?.code ?? "");
  return code === "42703" || code === "PGRST204";
}

/**
 * Run a `reviews` read that selects `tags`, and the same read without it when the database has no tags column yet
 * (the web deploy ran ahead of db-deploy: 42703 / PGRST204). The fallback's rows simply lack `tags`, which
 * reviewText treats as none (their tags are still inside feedback), so it is typed as the first read's result.
 */
export async function withReviewTags<T extends PgResult>(withTags: () => PromiseLike<T>, without: () => PromiseLike<PgResult>): Promise<T> {
  const first = await withTags();
  if (first.error && tagsColumnMissing(first.error)) return (await without()) as unknown as T;
  return first;
}

/**
 * Insert a review with its tags in their own column; if the database has no tags column yet, insert the text the
 * form typed, tags included, the way rows were stored before Q1088.
 */
export async function insertReviewWithTags<T extends PgResult>(
  text: string,
  run: (fields: { feedback: string | null; tags?: string[] }) => PromiseLike<T>,
): Promise<T> {
  const first = await run(reviewSubmitFields(text));
  if (first.error && tagsColumnMissing(first.error)) return run({ feedback: text.trim() || null });
  return first;
}
