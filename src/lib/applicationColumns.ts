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
 * THIS list. `flagged_hidden` stays readable: the app shows "your note was
 * withheld" from it.
 *
 * The list is the applications Row of the generated types minus
 * APPLICATION_PRIVATE_COLUMNS; src/test/applicationFlagWithheld.test.ts fails
 * when the two drift, and when the migrations' column grant disagrees with it.
 */
export const APPLICATION_PRIVATE_COLUMNS = ["flag_reason"] as const;

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
  "poster_viewed_at",
  "stake_amount",
  "stake_status",
  "status",
  "updated_at",
] as const;

/** Comma-joined, ready for `.select(APPLICATION_READABLE_COLUMNS)`. */
export const APPLICATION_READABLE_COLUMNS: string = APPLICATION_READABLE_COLUMN_LIST.join(", ");

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];

/** An applications row as a signed-in client can read it directly. */
export type ReadableApplicationRow = Omit<ApplicationRow, (typeof APPLICATION_PRIVATE_COLUMNS)[number]>;

/**
 * The rows of a `.select(APPLICATION_READABLE_COLUMNS)` read, typed: supabase-js
 * infers a row type only from a LITERAL column list (see readableJobRows).
 */
export const readableApplicationRows = (data: unknown): ReadableApplicationRow[] => (data ?? []) as ReadableApplicationRow[];
