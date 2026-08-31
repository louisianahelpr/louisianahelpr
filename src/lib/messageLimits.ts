/**
 * Shared cap on chat message `content` length, enforced client-side here
 * AND server-side by a `CHECK` constraint (see
 * supabase/migrations/20260831014020_add_message_content_length_check.sql).
 * Applies identically to new sends and edits — there was previously no
 * limit anywhere, so a message of unbounded size could reach the DB.
 */
export const MESSAGE_MAX_LENGTH = 4000;
