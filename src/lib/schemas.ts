/**
 * Zod schemas for the highest-stakes Supabase reads.
 *
 * These run inside `validateResult()` (src/lib/validateResult.ts) at the
 * boundary where a Supabase payload becomes typed app data. Each schema
 * is *partial by design* — `.passthrough()` keeps unknown columns intact
 * and we only assert the fields the consumer actually relies on. Adding a
 * new nullable column on the backend should NOT trip a drift alert; only
 * a type mismatch on a field a screen actually renders should.
 *
 * Keep these schemas alongside the TS types they shadow — when the TS
 * shape changes, update the Zod shape in the same diff.
 */
import { z } from "zod";

// ── Profile (src/hooks/useProfile.ts → SharedProfile) ────────────────
//
// The "small" profile slice every consumer renders — avatar, name, ban /
// approval / IDV state. Mismatches here drive blank Profile screens,
// missing avatars in Messages, and incorrect "verified" badges.
const sharedProfileSchema = z
  .object({
    user_id: z.string(),
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    avatar_url: z.string().nullable(),
    ban_status: z.string().nullable(),
    approval_status: z.string().nullable(),
    idv_status: z.string().nullable(),
    created_at: z.string().nullable(),
    bio: z.string().nullable(),
    location: z.string().nullable(),
    onboarding_fee_paid: z.boolean().nullable(),
  })
  .passthrough();

export const sharedProfileOrNullSchema = sharedProfileSchema.nullable();

// ── Job row (jobs table, single fetch) ───────────────────────────────
//
// The minimum set of fields the job-detail view + rebook flow read. Full
// jobs.Row has 80+ columns and we don't care about most of them; partial
// schema + .passthrough() catches drift on the columns that drive UI
// without false-positiving on every new admin column.
export const jobRowSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    customer_id: z.string(),
    helper_id: z.string().nullable(),
    budget: z.number(),
    category: z.string(),
    status: z.string(),
    location: z.string(),
    date_needed: z.string(),
    created_at: z.string(),
    photos: z.array(z.string()).nullable(),
    is_flexible_schedule: z.boolean(),
    helpers_needed: z.number().nullable(),
  })
  .passthrough();

// ── Applications-for-helper (applications table, list fetch) ─────────
//
// Powers the AppliedJobs tab on Activity. A schema mismatch here means
// the helper sees the wrong job in their applied list or an item with a
// broken status badge. Validated as an array — the call site fetches
// every application for the current helper.
const applicationRowSchema = z
  .object({
    id: z.string(),
    job_id: z.string(),
    helper_id: z.string(),
    status: z.string(),
    message: z.string().nullable(),
    attachment_urls: z.array(z.string()).nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

export const helperApplicationsSchema = z.array(applicationRowSchema);
