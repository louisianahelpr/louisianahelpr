import type { Database } from "@/integrations/supabase/types";

/**
 * The columns of `public.applications` a signed-in client may SELECT.
 *
 * WHY THIS LIST EXISTS (Q1232). `applications.flag_reason` is a moderation
 * internal (which contact-info detector fired on a note). RLS is row-level, so
 * migration 20261004191007 withholds that one column with a column privilege:
 * authenticated's table-level SELECT is gone and every OTHER column is granted
 * back. `supabase.from("applications").select("*")` would therefore be refused
 * (42501) for the whole query, so a read that wants "the whole row" selects
 * THIS list. `flagged_hidden` (the applicant's note) and
 * `offer_message_flagged_hidden` (the poster's offer message, Q1206) stay
 * readable: the app shows "hidden" notices from them, while the withheld
 * text itself lives in server-only columns.
 *
 * The list is the applications Row of the generated types minus
 * APPLICATION_PRIVATE_COLUMNS; src/test/applicationFlagWithheld.test.ts fails
 * when the two drift, and when the migrations' column grant disagrees with it.
 */
// Q1206: a flagged text is moved out of the readable column into a server-only one.
export const APPLICATION_PRIVATE_COLUMNS = ["flag_reason", "message_withheld", "offer_message_withheld"] as const;

export const APPLICATION_READABLE_COLUMN_LIST = [
  "attachment_urls",
  "closed_reason",
  "created_at",
  "decline_reason",
  "flagged_hidden",
  "helper_id",
  "id",
  "job_id",
  "job_latitude",
  "job_longitude",
  "message",
  "offer_message",
  "offer_message_flagged_hidden",
  "poster_viewed_at",
  "stake_amount",
  "stake_status",
  "status",
  "updated_at",
] as const;

/** Comma-joined, ready for `.select(APPLICATION_READABLE_COLUMNS)`. */
export const APPLICATION_READABLE_COLUMNS: string = APPLICATION_READABLE_COLUMN_LIST.join(", ");

/**
 * Columns a later migration added to the list (Q1206). prod-deploy.yml ships
 * the web app without waiting for db-deploy, so a build can run against a
 * database that does not have them yet, and PostgREST answers the whole read
 * with 42703 (undefined_column). readApplicationRows then reads once more
 * without them; a row read that way has the flag undefined, which the cards
 * treat as not flagged, which is what that older database means anyway.
 */
export const APPLICATION_COLUMNS_AHEAD_OF_DB = ["offer_message_flagged_hidden"] as const;

const APPLICATION_READABLE_COLUMNS_BEHIND_DB: string = APPLICATION_READABLE_COLUMN_LIST
  .filter((c) => !(APPLICATION_COLUMNS_AHEAD_OF_DB as readonly string[]).includes(c))
  .join(", ");

/**
 * Every client read of applications rows goes through this: `run` builds the
 * query from the column list it is handed (the useJobSubmit `withExtras`
 * pattern). Retries once without the newest columns on 42703; any other
 * error, and any second error, comes back to the caller as it was.
 */
export async function readApplicationRows<R extends { error: { code?: string } | null }>(
  run: (columns: string) => PromiseLike<R>,
): Promise<R> {
  const first = await run(APPLICATION_READABLE_COLUMNS);
  if (first.error?.code === "42703") return run(APPLICATION_READABLE_COLUMNS_BEHIND_DB);
  return first;
}

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];

/** An applications row as a signed-in client can read it directly. */
export type ReadableApplicationRow = Omit<ApplicationRow, (typeof APPLICATION_PRIVATE_COLUMNS)[number]>;

/**
 * The rows of a `.select(APPLICATION_READABLE_COLUMNS)` read, typed: supabase-js
 * infers a row type only from a LITERAL column list (see readableJobRows).
 */
export const readableApplicationRows = (data: unknown): ReadableApplicationRow[] => (data ?? []) as ReadableApplicationRow[];
