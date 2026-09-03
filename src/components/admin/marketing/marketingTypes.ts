// Shapes, platform limits and the "can this row legally move to that status?"
// rules for the social auto-poster admin UI.
//
// Pure — no Supabase, no React — so the validation that stands between the
// owner and a public post is testable and is asserted in ONE place rather than
// re-derived by the composer and the queue separately.
//
// ── WHY THE VALIDATION LIVES HERE AND NOT ONLY IN THE DB ──────────────────
// The migration already refuses an unpublishable row (an `instagram` row that
// is not draft/cancelled with no media violates
// `marketing_content_instagram_needs_media`). That CHECK is the backstop and
// must stay. But a constraint violation surfaces as a PostgREST error string
// AFTER the owner has written a caption and hit Schedule, which reads as "the
// app is broken" rather than "Instagram cannot post without an image". These
// rules mirror the CHECKs so the UI can refuse EARLY, in words, with the fix
// named — and so the Schedule button is disabled rather than merely failing.

/** `public.marketing_channel`. Exactly the two the owner has accounts for. */
export type MarketingChannel = "instagram" | "facebook";

/** `public.marketing_status`. */
export type MarketingStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export const MARKETING_CHANNELS: readonly MarketingChannel[] = ["instagram", "facebook"];

export const CHANNEL_LABEL: Record<MarketingChannel, string> = {
  instagram: "Instagram",
  facebook: "Facebook Page",
};

export const STATUS_LABEL: Record<MarketingStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** A row of `public.marketing_content`. */
export interface MarketingContentRow {
  id: string;
  channel: MarketingChannel;
  status: MarketingStatus;
  body: string;
  hashtags: string[];
  media_urls: string[];
  parish: string | null;
  campaign: string | null;
  generated_by: string | null;
  model: string | null;
  scheduled_for: string | null;
  locked_at: string | null;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
  external_id: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** The `marketing_settings` singleton. */
export interface MarketingSettingsRow {
  auto_publish_enabled: boolean;
  /** jsonb. A channel ABSENT from this object is OFF — see `isChannelEnabled`. */
  channels_enabled: Record<string, unknown> | null;
  daily_post_cap: number;
  updated_at: string;
}

/**
 * Is this channel switched on?
 *
 * The migration's contract is "a channel ABSENT from this object is OFF", so
 * the test is an explicit `=== true` rather than truthiness: a missing key, a
 * null, a `"false"` string or a malformed object all read as OFF. Anything
 * looser would turn a typo in the jsonb into a live publishing channel.
 */
export function isChannelEnabled(
  settings: Pick<MarketingSettingsRow, "channels_enabled"> | null | undefined,
  channel: MarketingChannel,
): boolean {
  return settings?.channels_enabled?.[channel] === true;
}

// ── Platform limits ───────────────────────────────────────────────────────
//
// `verified` is not decoration. A limit we are confident about BLOCKS the
// owner from scheduling; a limit we are not confident about may only warn.
// Asserting a number we have not checked would either block a legitimate post
// or wave through one the platform will reject at 6am.

export interface PlatformLimit {
  /** Max characters in the composed caption, or null when we impose none. */
  captionMax: number | null;
  /** Max hashtags, or null when we impose none. */
  hashtagMax: number | null;
  /**
   * True when the number is one we are confident enough in to BLOCK on.
   * False means: show it, label it, warn — never refuse.
   */
  verified: boolean;
  /** Shown next to an unverified limit so nobody mistakes it for fact. */
  note?: string;
}

export const PLATFORM_LIMITS: Record<MarketingChannel, PlatformLimit> = {
  // Instagram's documented caption ceiling and hashtag ceiling. These are the
  // two the Content Publishing API actually rejects on, so they block.
  instagram: { captionMax: 2200, hashtagMax: 30, verified: true },
  // Facebook tolerates captions far longer than anything this tool will
  // produce. A specific ceiling is commonly quoted (~63,206) but has NOT been
  // verified against current platform docs here, so it is deliberately not
  // enforced and not displayed as fact — an unverified number that blocks a
  // post is worse than no number at all.
  facebook: {
    captionMax: null,
    hashtagMax: null,
    verified: false,
    note: "Facebook's exact caption ceiling is unverified — no limit is enforced here.",
  },
};

/**
 * The caption as it will actually be posted: body, then the tags on their own
 * line with the `#` the database does not store.
 *
 * ASSUMPTION, and the one worth checking against the publisher: `hashtags` is
 * stored WITHOUT the leading `#` (the marketing standard's §7 output contract
 * states this), so the `#` is re-added at compose time. The character count
 * shown to the owner counts THIS string, not `body` alone, because Instagram's
 * 2200 applies to the whole caption — counting `body` alone would let a post
 * with 28 tags sail past the limit and fail at publish time.
 */
export function composeCaption(body: string, hashtags: readonly string[]): string {
  const tags = hashtags.map((t) => `#${t}`).join(" ");
  if (!tags) return body;
  return `${body.trimEnd()}\n\n${tags}`;
}

/**
 * Parse the hashtag field into the array the column stores.
 *
 * Accepts whatever the owner types — `#nola, #baton rouge` or newline-separated
 * — and normalises to bare tokens WITHOUT `#` (the storage contract). Dedupes
 * case-insensitively because Instagram counts a repeated tag against the 30 and
 * silently gains nothing from it.
 */
export function parseHashtags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const tag = token.replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Render stored tags back into an editable string. */
export function formatHashtags(hashtags: readonly string[]): string {
  return hashtags.map((t) => `#${t}`).join(" ");
}

/** The fields a composer/editor can set, independent of any row. */
export interface MarketingDraftInput {
  channel: MarketingChannel;
  body: string;
  hashtags: string[];
  media_urls: string[];
  parish: string | null;
  campaign: string | null;
  scheduled_for: string | null;
}

export interface ValidationIssue {
  /** `blocking` disables the action; `warning` is shown but permits it. */
  level: "blocking" | "warning";
  message: string;
}

/**
 * Every reason this draft may not move to `target`.
 *
 * Mirrors, in order, the DB constraints that would otherwise reject the write:
 *   - `body` CHECK length(btrim(body)) > 0
 *   - `marketing_content_scheduled_needs_time`
 *   - `marketing_content_instagram_needs_media`
 * plus the platform limits, which the DB does not know about.
 */
export function validateDraft(
  input: MarketingDraftInput,
  target: MarketingStatus,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limits = PLATFORM_LIMITS[input.channel];
  // Only these two statuses exempt a row from the "must be publishable" rules;
  // the enum names them explicitly in the CHECK, so they are named here too.
  const isParked = target === "draft" || target === "cancelled";

  if (!input.body.trim()) {
    issues.push({ level: "blocking", message: "The post body can't be empty." });
  }

  if (target === "scheduled" && !input.scheduled_for) {
    issues.push({
      level: "blocking",
      message: "Pick a date and time — a scheduled post with no time would never be picked up.",
    });
  }

  // THE INSTAGRAM CONSTRAINT. Refused here, in words, rather than as a CHECK
  // violation after the write.
  if (input.channel === "instagram" && !isParked && input.media_urls.length === 0) {
    issues.push({
      level: "blocking",
      message:
        "Instagram can't post without an image — its publishing API fetches a picture from a public URL, so there is no such thing as a text-only Instagram post. Attach an image, or save this as a draft instead.",
    });
  }

  const caption = composeCaption(input.body, input.hashtags);
  if (limits.captionMax !== null && caption.length > limits.captionMax) {
    issues.push({
      level: limits.verified ? "blocking" : "warning",
      message: `Caption is ${caption.length.toLocaleString()} characters — ${CHANNEL_LABEL[input.channel]}'s limit is ${limits.captionMax.toLocaleString()}. Hashtags count toward it.`,
    });
  }
  if (limits.hashtagMax !== null && input.hashtags.length > limits.hashtagMax) {
    issues.push({
      level: limits.verified ? "blocking" : "warning",
      message: `${input.hashtags.length} hashtags — ${CHANNEL_LABEL[input.channel]} allows ${limits.hashtagMax}.`,
    });
  }

  // Not blocking: a past time is legitimate ("send on the next tick"). But with
  // auto-publish ON it means "publish within minutes", which is worth saying
  // out loud before the owner clicks rather than after the post is live.
  if (target === "scheduled" && input.scheduled_for) {
    const when = new Date(input.scheduled_for).getTime();
    if (Number.isFinite(when) && when < Date.now()) {
      issues.push({
        level: "warning",
        message: "That time is in the past — this will go out on the next dispatcher run.",
      });
    }
  }

  return issues;
}

export const blockingIssues = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.level === "blocking");

// ── Date helpers ──────────────────────────────────────────────────────────
//
// `formatTimestamp` / `formatShortDate` in `@/lib/format` both drop the time
// of day, which is the half that matters for a scheduled post — "Sep 4" does
// not tell the owner whether something goes out at 8am or 8pm. These add the
// clock, and convert to and from the value an `<input type="datetime-local">`
// expects.

/** "Sep 4, 2026, 8:30 AM" — local time, which is the owner's frame. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * ISO timestamp → the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">`
 * needs. Built from the LOCAL getters on purpose: `toISOString().slice(0,16)`
 * is the obvious one-liner and is wrong, because it renders UTC into a control
 * the browser then interprets as local — shifting every prefilled time by the
 * timezone offset each time a row is opened and re-saved.
 */
export function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The datetime-local value back to an ISO timestamp, or null when empty. */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
