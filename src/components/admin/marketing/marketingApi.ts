// The data layer for the social auto-poster admin UI.
//
// ── WHY A MODULE INSTEAD OF INLINE `supabase.from(...)` CALLS ─────────────
// `marketing_content` and `marketing_settings` are NOT in
// `src/integrations/supabase/types.ts` yet (the migration is newer than the
// last type regeneration), so every call site would otherwise need its own
// `as any`. This module is the ONE place that acknowledges the generated types
// lag the deployed schema — the same containment `callUntypedRpc` applies to
// RPCs in `postedJobsHelpers.ts`. Everything this module EXPORTS is fully
// typed; the looseness stops at the `marketingTable` boundary below.
//
// ── EVERY WRITE HERE CHANGES WHAT GETS POSTED PUBLICLY ────────────────────
// So every write ends in `.select("id")` and goes through `unwrapMutation()`.
// A zero-row UPDATE returns `{ data: [], error: null }` — indistinguishable
// from success if you only check `error` — and on this table that means the
// owner is told a post was cancelled when it is still queued to publish. The
// guard predicates (`.eq("status", "draft")`) are load-bearing for the same
// reason: they are what makes "the dispatcher already claimed this row" a
// visible refusal instead of a silent overwrite of a row mid-flight.

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { unwrapMutation } from "@/lib/mutationResult";
import type {
  MarketingContentRow,
  MarketingDraftInput,
  MarketingSettingsRow,
  MarketingStatus,
} from "./marketingTypes";

/** What every PostgREST call in this module resolves to. */
type RawResult = { data: unknown; error: { message: string } | null };
/** What a mutation ending in `.select("id")` resolves to. */
type RowsResult = { data: { id: string }[] | null; error: { message: string } | null };

interface Chain extends PromiseLike<RawResult> {
  select(cols: string): Chain;
  eq(col: string, val: unknown): Chain;
  in(col: string, vals: readonly unknown[]): Chain;
  order(col: string, opts: { ascending: boolean }): Chain;
  limit(n: number): Chain;
  maybeSingle(): PromiseLike<RawResult>;
}

interface Table {
  select(cols: string): Chain;
  insert(rows: Record<string, unknown>[]): Chain;
  update(patch: Record<string, unknown>): Chain;
  delete(): Chain;
}

/**
 * THE boundary. `.bind(supabase)` because `from` reads `this` — an unbound
 * reference works today and breaks on a client refactor with no type error to
 * catch it (the reason `postedJobsHelpers` binds `rpc` the same way).
 */
function marketingTable(table: "marketing_content" | "marketing_settings"): Table {
  return (supabase.from.bind(supabase) as unknown as (t: string) => Table)(table);
}

/** Columns of `marketing_content` the UI reads. Explicit, so a schema change
 *  that drops one fails loudly here rather than rendering a blank cell. */
const CONTENT_COLUMNS =
  "id, channel, status, body, hashtags, media_urls, parish, campaign, generated_by, model, " +
  "scheduled_for, locked_at, attempts, last_error, published_at, external_id, external_url, " +
  "created_at, updated_at, created_by";

const SETTINGS_COLUMNS = "auto_publish_enabled, channels_enabled, daily_post_cap, updated_at";

/** How many rows the queue loads. Beyond this the owner should be filtering. */
export const QUEUE_LIMIT = 200;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Read the kill switch and config.
 *
 * A MISSING singleton throws rather than returning a default. This is the
 * whole reason the function is shaped this way: the migration seeds the row
 * with everything OFF, so "no row" means something is wrong with the database
 * or with RLS — and defaulting to `auto_publish_enabled: false` there would
 * paint a reassuring "auto-publish is off" banner while having NO IDEA whether
 * posts are going out. An unknown state must reach the UI as unknown.
 */
export async function fetchMarketingSettings(): Promise<MarketingSettingsRow> {
  const row = unwrap(
    await marketingTable("marketing_settings")
      .select(SETTINGS_COLUMNS)
      .eq("id", true)
      .maybeSingle(),
  ) as MarketingSettingsRow | null;

  if (!row) {
    throw new Error(
      "The marketing_settings row is missing, so the auto-publish state can't be read.",
    );
  }
  return row;
}

export async function fetchMarketingQueue(): Promise<MarketingContentRow[]> {
  const rows = unwrap(
    await marketingTable("marketing_content")
      .select(CONTENT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(QUEUE_LIMIT),
  ) as MarketingContentRow[] | null;
  return rows ?? [];
}

export interface MarketingSettingsPatch {
  auto_publish_enabled?: boolean;
  channels_enabled?: Record<string, boolean>;
  daily_post_cap?: number;
}

/**
 * Update the singleton.
 *
 * `updated_at` is set by hand because `marketing_settings` has no touch
 * trigger (only `marketing_content` does) — without this the "last changed"
 * stamp beside the kill switch would freeze at the migration's seed time and
 * quietly lie about when the switch was last touched.
 */
export async function updateMarketingSettings(
  patch: MarketingSettingsPatch,
): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_settings")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: await currentUserId(),
      })
      .eq("id", true)
      .select("id")) as RowsResult,
    {
      action: "save the auto-publish settings",
      rejectedMessage:
        "That setting didn't save — your admin access may have changed. Reload and check the switch before relying on it.",
      context: { keys: Object.keys(patch).join(",") },
    },
  );
}

/** Create a row. Always starts as `draft` or `scheduled` — never anything the
 *  dispatcher could pick up without the owner choosing a time. */
export async function createMarketingContent(
  input: MarketingDraftInput,
  status: Extract<MarketingStatus, "draft" | "scheduled">,
): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .insert([
        {
          channel: input.channel,
          status,
          body: input.body.trim(),
          hashtags: input.hashtags,
          media_urls: input.media_urls,
          parish: input.parish,
          campaign: input.campaign,
          // Provenance: this row was typed by a person in the admin UI, not
          // produced by a generation agent. The publisher and any later
          // attribution report both read this.
          generated_by: "admin-ui",
          // Kept even for a draft: a draft may carry a planned time the owner
          // has not committed to yet, and dropping it would make them retype it
          // at the moment they schedule.
          scheduled_for: input.scheduled_for,
          created_by: await currentUserId(),
        },
      ])
      .select("id")) as RowsResult,
    { action: "create this post", context: { channel: input.channel, status } },
  );
}

/**
 * Edit a row's content.
 *
 * Guarded to the statuses where editing is meaningful. `publishing` is
 * deliberately excluded: a dispatcher holds that row and may be mid-API-call,
 * so editing it would change what gets posted underneath the process that is
 * posting it. `published` is excluded because the post is already public and
 * the row is now a receipt.
 */
export async function updateMarketingContent(
  id: string,
  input: MarketingDraftInput,
): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .update({
        body: input.body.trim(),
        hashtags: input.hashtags,
        media_urls: input.media_urls,
        parish: input.parish,
        campaign: input.campaign,
        scheduled_for: input.scheduled_for,
      })
      .eq("id", id)
      .in("status", ["draft", "scheduled", "failed", "cancelled"])
      .select("id")) as RowsResult,
    {
      action: "save this post",
      rejectedMessage:
        "This post has already moved on — it may be publishing right now. Refresh to see where it is.",
      context: { id },
    },
  );
}

/** draft → scheduled. */
export async function scheduleMarketingContent(
  id: string,
  scheduledFor: string,
): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .update({ status: "scheduled", scheduled_for: scheduledFor, last_error: null })
      .eq("id", id)
      .in("status", ["draft", "cancelled"])
      .select("id")) as RowsResult,
    {
      action: "schedule this post",
      rejectedMessage: "This post isn't a draft any more — refresh to see its current state.",
      context: { id },
    },
  );
}

/**
 * scheduled → cancelled. The stop button for ONE post.
 *
 * Guarded to `scheduled` on purpose. If the dispatcher claimed the row a
 * moment ago it is now `publishing`, this write matches zero rows, and the
 * owner is TOLD it could not be stopped — rather than seeing a success toast
 * for a post that is already on its way to Instagram.
 */
export async function cancelMarketingContent(id: string): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", ["scheduled", "failed"])
      .select("id")) as RowsResult,
    {
      action: "cancel this post",
      rejectedMessage:
        "Couldn't cancel — this post is already publishing. Turn OFF auto-publish above if you need to stop everything.",
      context: { id },
    },
  );
}

/**
 * failed → scheduled, with the attempt counter reset.
 *
 * `claim_marketing_content()` only picks up rows with `attempts < 5`, so a row
 * that burned down its retries is inert until the counter is cleared. Resetting
 * it is the whole point of the button — leaving it would produce a row that
 * says "Scheduled" and never publishes.
 */
export async function retryMarketingContent(
  id: string,
  scheduledFor: string,
): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .update({
        status: "scheduled",
        scheduled_for: scheduledFor,
        attempts: 0,
        last_error: null,
        locked_at: null,
      })
      .eq("id", id)
      .eq("status", "failed")
      .select("id")) as RowsResult,
    {
      action: "retry this post",
      rejectedMessage: "This post is no longer in a failed state — refresh to see where it is.",
      context: { id },
    },
  );
}

/** cancelled → draft, so a stopped post can be reworked instead of retyped. */
export async function reopenMarketingContent(id: string): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .update({ status: "draft", scheduled_for: null, last_error: null })
      .eq("id", id)
      .in("status", ["cancelled", "failed"])
      .select("id")) as RowsResult,
    { action: "reopen this post", context: { id } },
  );
}

/** Delete — drafts and cancelled rows only. A published row is a receipt and
 *  a scheduled one should be cancelled first, deliberately, before it can go. */
export async function deleteMarketingContent(id: string): Promise<void> {
  unwrapMutation(
    (await marketingTable("marketing_content")
      .delete()
      .eq("id", id)
      .in("status", ["draft", "cancelled"])
      .select("id")) as RowsResult,
    {
      action: "delete this post",
      rejectedMessage:
        "Couldn't delete — only drafts and cancelled posts can be removed. Cancel it first.",
      context: { id },
    },
  );
}
