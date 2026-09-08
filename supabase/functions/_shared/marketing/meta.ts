// Meta (Facebook Page + Instagram Business) publishing adapter.
//
// This module talks to the Graph API and NOTHING ELSE. It does not read
// `marketing_settings`, does not claim rows, and does not write status back —
// `marketing-publish/index.ts` owns all of that. The split matters: the only
// irreversible thing this system does is call Meta, so the code that makes that
// call is kept small enough to read in one sitting.
//
// ─── The one failure this file cannot fully close ────────────────────────
//
// Graph API has no idempotency key. If a POST to /feed or /media_publish
// SUCCEEDS server-side and the response is lost (timeout, cold-start kill,
// network drop), the row keeps `status = 'publishing'`, gets reclaimed 15
// minutes later, and a naive retry posts the same content a second time. The
// UNIQUE (channel, external_id) index cannot help — we never learned the id.
//
// So `findRecentDuplicate()` exists: before a RETRY (attempts > 1) the
// dispatcher asks Meta whether the previous attempt actually landed, and adopts
// the existing post instead of re-posting. It is best-effort — a read failure
// must never block a first publish — but it converts the common case of this
// race from "posted twice" into "recorded correctly".
//
// ─── Knowledge freshness ─────────────────────────────────────────────────
//
// Meta changes endpoints, field names and limits more often than this file will
// be read. Every place where the exact shape is remembered rather than verified
// carries a `// VERIFY:` comment naming what to check. Treat those as open
// questions, not as documentation.

/** One place to bump the Graph version. Meta deprecates versions ~2 years out. */
// VERIFY: v21.0 was current as of late 2024. Check
// https://developers.facebook.com/docs/graph-api/changelog for the current
// version and whether v21.0 is still inside its support window before relying
// on this in production.
export const META_GRAPH_VERSION = "v21.0";

const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Every Graph call is bounded. A hung fetch strands the row in 'publishing'. */
const GRAPH_TIMEOUT_MS = 15_000;

/**
 * Instagram caption limit.
 * VERIFY: Meta documents 2,200 characters for a caption. Confirm against
 * https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
export const IG_CAPTION_MAX_CHARS = 2200;

/**
 * Instagram hashtag limit, counted across the WHOLE caption (not just the
 * `hashtags` column) because that is how Meta counts it.
 * VERIFY: 30 is the long-standing documented limit. Meta rejects the post
 * outright past it rather than truncating.
 */
export const IG_HASHTAG_MAX = 30;

/**
 * Facebook post body limit.
 * VERIFY: 63,206 characters is the widely-cited limit for a Page post message
 * and is not prominently documented. It is enforced here only as a sanity
 * ceiling — nothing this system generates comes close.
 */
export const FB_MESSAGE_MAX_CHARS = 63_206;

/** How long a container may take to become FINISHED before we give up. */
const IG_CONTAINER_POLL_ATTEMPTS = 10;
const IG_CONTAINER_POLL_DELAY_MS = 2_000;

/** How far back `findRecentDuplicate` looks for our own lost post. */
const DUPLICATE_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 2 hours
/** How many recent posts to scan when looking for a lost publish. */
const DUPLICATE_SCAN_LIMIT = 25;

export type MarketingChannel = "instagram" | "facebook";

/** The subset of `marketing_content` this module needs. */
export interface MarketingRow {
  id: string;
  channel: MarketingChannel;
  body: string;
  hashtags: string[] | null;
  media_urls: string[] | null;
  attempts: number;
}

export interface PublishResult {
  /** Goes into `marketing_content.external_id`. Never empty. */
  externalId: string;
  /** Goes into `external_url`. Null when Meta gave us no permalink. */
  externalUrl: string | null;
  /** True when this came from `findRecentDuplicate`, not a fresh post. */
  adopted?: boolean;
}

/**
 * Secrets, read once. Fields are optional here and asserted per-channel, so a
 * Facebook-only run is not blocked by a missing Instagram id.
 */
export interface MetaEnv {
  pageId?: string;
  pageAccessToken?: string;
  igUserId?: string;
  /** Optional. Enables the real `/debug_token` inspection in token-health. */
  appId?: string;
  appSecret?: string;
}

/**
 * A configuration problem: a secret is missing or a row can never publish as
 * written. `permanent` because retrying changes nothing — the dispatcher should
 * stop burning attempts and say why.
 */
export class MetaConfigError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = "MetaConfigError";
  }
}

/**
 * Meta answered, and said no. NOT permanent by default: an expired token
 * (code 190) is fixed by the owner pasting a new one, and the queued rows
 * should still go out afterwards. Burning them to 'failed' on the first 190
 * would mean a token refresh silently loses a week of scheduled posts.
 */
export class MetaApiError extends Error {
  readonly permanent = false;
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Reads the secrets. Never throws — absence is reported per-channel below. */
export function readMetaEnv(): MetaEnv {
  return {
    pageId: nonEmpty(Deno.env.get("META_PAGE_ID")),
    pageAccessToken: nonEmpty(Deno.env.get("META_PAGE_ACCESS_TOKEN")),
    igUserId: nonEmpty(Deno.env.get("META_IG_USER_ID")),
    appId: nonEmpty(Deno.env.get("META_APP_ID")),
    appSecret: nonEmpty(Deno.env.get("META_APP_SECRET")),
  };
}

function nonEmpty(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Which secrets a channel needs and does not have.
 *
 * The dispatcher calls this BEFORE claiming rows. A missing secret discovered
 * after the claim would increment `attempts` on rows that never had a chance,
 * and five cron ticks later they would be permanently 'failed' because of a
 * config gap nobody had noticed. Checking first keeps a missing secret a loud,
 * recoverable, zero-damage condition.
 */
export function missingSecretsFor(
  channel: MarketingChannel,
  env: MetaEnv,
): string[] {
  const missing: string[] = [];
  if (!env.pageAccessToken) missing.push("META_PAGE_ACCESS_TOKEN");
  if (channel === "facebook") {
    if (!env.pageId) missing.push("META_PAGE_ID");
  } else {
    if (!env.igUserId) missing.push("META_IG_USER_ID");
  }
  return missing;
}

function requireSecrets(channel: MarketingChannel, env: MetaEnv): void {
  const missing = missingSecretsFor(channel, env);
  if (missing.length > 0) {
    throw new MetaConfigError(
      `Cannot publish to ${channel}: missing Supabase function secret(s) ${missing.join(", ")}. ` +
        `Set them with \`supabase secrets set ${missing.map((m) => `${m}=...`).join(" ")}\`.`,
    );
  }
}

// ─── Caption assembly ─────────────────────────────────────────────────────

/**
 * body + hashtags, as the post will actually read.
 *
 * `hashtags` is stored without any guarantee about the leading '#', so each tag
 * is normalised. A tag that is only punctuation is dropped rather than emitted
 * as a bare '#', which Meta counts as a hashtag and which reads as a typo.
 */
export function buildCaption(row: MarketingRow): string {
  const body = (row.body ?? "").trim();
  const tags = (row.hashtags ?? [])
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .filter((t) => t.length > 1);
  return tags.length > 0 ? `${body}\n\n${tags.join(" ")}` : body;
}

/** Counts hashtags the way Meta does: every '#token' anywhere in the caption. */
export function countHashtags(caption: string): number {
  // VERIFY: Meta's exact tokenisation is not published. This counts a '#'
  // that starts a word and is followed by letters/digits/underscore, which
  // matches observed behaviour and never UNDER-counts, so the guard errs
  // toward rejecting locally rather than being rejected by Meta.
  const matches = caption.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu);
  return matches ? matches.length : 0;
}

/** Extensions we will not send as `image_url`. */
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i;

/**
 * Everything that must be true before a Graph call is worth making.
 * Throws `MetaConfigError` (permanent) so the dispatcher fails the row with a
 * legible `last_error` instead of letting Meta reject it opaquely five times.
 */
function validateForChannel(row: MarketingRow, caption: string): void {
  if (caption.trim().length === 0) {
    throw new MetaConfigError(`Row ${row.id}: caption is empty after assembly.`);
  }

  if (row.channel === "facebook") {
    if (caption.length > FB_MESSAGE_MAX_CHARS) {
      throw new MetaConfigError(
        `Row ${row.id}: Facebook message is ${caption.length} characters, over the ${FB_MESSAGE_MAX_CHARS} limit.`,
      );
    }
    return;
  }

  // Instagram.
  if (caption.length > IG_CAPTION_MAX_CHARS) {
    throw new MetaConfigError(
      `Row ${row.id}: Instagram caption is ${caption.length} characters, over the ${IG_CAPTION_MAX_CHARS} limit. ` +
        `Shorten the body or drop hashtags — Meta rejects the post rather than truncating it.`,
    );
  }
  const tagCount = countHashtags(caption);
  if (tagCount > IG_HASHTAG_MAX) {
    throw new MetaConfigError(
      `Row ${row.id}: caption contains ${tagCount} hashtags, over Instagram's limit of ${IG_HASHTAG_MAX}.`,
    );
  }
  const media = firstMediaUrl(row);
  if (!media) {
    // The DB CHECK already forbids this for non-draft rows; it is asserted
    // again because the adapter must not depend on a constraint it cannot see.
    throw new MetaConfigError(
      `Row ${row.id}: Instagram requires at least one media_url. There is no text-only Instagram post.`,
    );
  }
  if (!/^https:\/\//i.test(media)) {
    throw new MetaConfigError(
      `Row ${row.id}: media_url must be a public https URL — Meta fetches it server-side. Got: ${media}`,
    );
  }
  if (VIDEO_EXT.test(media)) {
    // Honest refusal rather than a silent failure: a video URL sent as
    // `image_url` produces a container that never reaches FINISHED.
    throw new MetaConfigError(
      `Row ${row.id}: media_url looks like a video (${media}). Video/Reels publishing is not implemented ` +
        `(it needs media_type=REELS + video_url and a much longer container poll). Use an image.`,
    );
  }
}

function firstMediaUrl(row: MarketingRow): string | undefined {
  const urls = (row.media_urls ?? []).map((u) => (u ?? "").trim()).filter((u) => u.length > 0);
  return urls[0];
}

// ─── Graph transport ──────────────────────────────────────────────────────

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

/**
 * One place where a Graph response becomes either a value or a `MetaApiError`.
 *
 * Graph returns HTTP 200 with an `error` object in some paths and a 4xx with
 * the same object in others, so BOTH are checked. A response that is neither
 * is still an error — an unparseable body means we do not know what happened,
 * and "we do not know" must never read as success on this path.
 */
async function graphCall<T>(
  url: string,
  init: RequestInit,
  what: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  } catch (err) {
    // A timeout here is the dangerous case: Meta may well have accepted the
    // post. Say so in the message so whoever reads `last_error` knows to check
    // the feed before assuming nothing went out.
    const msg = err instanceof Error ? err.message : String(err);
    throw new MetaApiError(
      `${what}: network/timeout failure (${msg}). The request MAY have succeeded server-side — verify the feed before retrying.`,
    );
  }

  const text = await res.text();
  let parsed: (T & GraphErrorBody) | null = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    throw new MetaApiError(
      `${what}: HTTP ${res.status} with unparseable body: ${text.slice(0, 300)}`,
      undefined,
      undefined,
      undefined,
      res.status,
    );
  }

  const e = parsed?.error;
  if (e) {
    throw new MetaApiError(
      `${what}: ${e.error_user_msg || e.message || "unknown Graph error"}` +
        `${e.type ? ` (${e.type})` : ""}`,
      e.code,
      e.error_subcode,
      e.fbtrace_id,
      res.status,
    );
  }
  if (!res.ok) {
    throw new MetaApiError(
      `${what}: HTTP ${res.status} — ${text.slice(0, 300)}`,
      undefined,
      undefined,
      undefined,
      res.status,
    );
  }
  if (parsed === null) {
    throw new MetaApiError(`${what}: empty response body with HTTP ${res.status}`, undefined, undefined, undefined, res.status);
  }
  return parsed as T;
}

/** POST with a form-encoded body — the shape every Graph write endpoint takes. */
function graphPost<T>(path: string, params: Record<string, string>, what: string): Promise<T> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, v);
  return graphCall<T>(
    `${GRAPH_BASE}/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    what,
  );
}

function graphGet<T>(path: string, params: Record<string, string>, what: string): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  return graphCall<T>(`${GRAPH_BASE}/${path}?${qs}`, { method: "GET" }, what);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Facebook ─────────────────────────────────────────────────────────────

/**
 * Publish a Page post.
 *
 * Two shapes, chosen by whether the row carries media:
 *   • with media → POST /{PAGE_ID}/photos  (`url` + `caption`)
 *   • text only  → POST /{PAGE_ID}/feed    (`message`)
 *
 * The photo endpoint is the better shape when there is art: /feed with a `link`
 * produces a link preview card, not an image post, and a marketing image posted
 * as a link preview is materially worse-looking.
 */
export async function publishFacebook(row: MarketingRow, env: MetaEnv): Promise<PublishResult> {
  requireSecrets("facebook", env);
  const caption = buildCaption(row);
  validateForChannel(row, caption);

  const pageId = env.pageId as string;
  const token = env.pageAccessToken as string;
  const media = firstMediaUrl(row);

  if (media) {
    // VERIFY: /{page-id}/photos accepts `url` (a publicly reachable image URL
    // that Meta fetches) plus `caption`, and returns `{ id, post_id }` where
    // `id` is the PHOTO node and `post_id` is the feed post. Confirm both field
    // names against
    // https://developers.facebook.com/docs/graph-api/reference/page/photos/
    const out = await graphPost<{ id?: string; post_id?: string }>(
      `${pageId}/photos`,
      { url: media, caption, published: "true", access_token: token },
      "facebook photo post",
    );
    // `post_id` is the thing a human can open; `id` alone is the photo node and
    // does NOT form a working /{id} permalink. Prefer post_id, fall back to id
    // so we never lose the receipt entirely.
    const externalId = out.post_id || out.id;
    if (!externalId) {
      throw new MetaApiError(
        "facebook photo post: Meta returned no id. The post may or may not exist — check the Page before retrying.",
      );
    }
    return { externalId, externalUrl: facebookPermalink(externalId) };
  }

  // VERIFY: /{page-id}/feed with `message` returns `{ id: "{pageId}_{postId}" }`.
  const out = await graphPost<{ id?: string }>(
    `${pageId}/feed`,
    { message: caption, access_token: token },
    "facebook feed post",
  );
  if (!out.id) {
    throw new MetaApiError(
      "facebook feed post: Meta returned no id. The post may or may not exist — check the Page before retrying.",
    );
  }
  return { externalId: out.id, externalUrl: facebookPermalink(out.id) };
}

/**
 * VERIFY: `https://www.facebook.com/{pageId}_{postId}` resolves for Page posts.
 * If Meta changes this, the stored `external_url` becomes a dead link — it is
 * cosmetic, not load-bearing (`external_id` is what the metrics puller joins
 * on), so a wrong guess here degrades gracefully.
 */
function facebookPermalink(id: string): string {
  return `https://www.facebook.com/${id}`;
}

// ─── Instagram ────────────────────────────────────────────────────────────

/**
 * Publish to an Instagram Business/Creator account. TWO steps, and the gap
 * between them is where this goes wrong if rushed.
 *
 *   1. POST /{IG_USER_ID}/media   → a CONTAINER (`creation_id`). Meta fetches
 *      `image_url` server-side at this point, which is why a signed or private
 *      Supabase URL fails: Meta's fetcher has no session. The bucket is public
 *      for exactly this reason.
 *   2. POST /{IG_USER_ID}/media_publish with `creation_id` → the real media id.
 *
 * Between them the container is not necessarily ready. Publishing a container
 * still in IN_PROGRESS fails, so its `status_code` is polled to FINISHED first.
 * An orphaned container costs nothing — Meta expires them (~24h) and an
 * unpublished container is not visible to anyone.
 */
export async function publishInstagram(row: MarketingRow, env: MetaEnv): Promise<PublishResult> {
  requireSecrets("instagram", env);
  const caption = buildCaption(row);
  validateForChannel(row, caption);

  const igUserId = env.igUserId as string;
  const token = env.pageAccessToken as string;
  const imageUrl = firstMediaUrl(row) as string;

  // Step 1 — container.
  // VERIFY: /{ig-user-id}/media takes `image_url` + `caption` and returns
  // `{ id }`, which is the creation_id. Confirm against
  // https://developers.facebook.com/docs/instagram-platform/content-publishing
  const container = await graphPost<{ id?: string }>(
    `${igUserId}/media`,
    { image_url: imageUrl, caption, access_token: token },
    "instagram container create",
  );
  const creationId = container.id;
  if (!creationId) {
    throw new MetaApiError("instagram container create: Meta returned no creation_id.");
  }

  // Step 1b — wait for the container. Nothing is public yet, so this loop is
  // free to fail; the expensive mistake is publishing an unfinished container.
  await waitForContainer(creationId, token);

  // Step 2 — publish. THIS is the irreversible call.
  // VERIFY: /{ig-user-id}/media_publish takes `creation_id` and returns `{ id }`
  // (the published media id, not the container id).
  const published = await graphPost<{ id?: string }>(
    `${igUserId}/media_publish`,
    { creation_id: creationId, access_token: token },
    "instagram media_publish",
  );
  const mediaId = published.id;
  if (!mediaId) {
    throw new MetaApiError(
      "instagram media_publish: Meta returned no media id. The post MAY be live — check the account before retrying.",
    );
  }

  return { externalId: mediaId, externalUrl: await instagramPermalink(mediaId, token) };
}

/**
 * Poll `status_code` until FINISHED. ERROR and EXPIRED are terminal.
 *
 * VERIFY: the documented values are IN_PROGRESS, FINISHED, ERROR, EXPIRED,
 * PUBLISHED, and `status` carries a human-readable reason on ERROR.
 */
async function waitForContainer(creationId: string, token: string): Promise<void> {
  let lastStatus = "unknown";
  for (let i = 0; i < IG_CONTAINER_POLL_ATTEMPTS; i++) {
    // Give Meta a moment before the first read — a container is essentially
    // never FINISHED the instant it is created, and an immediate poll just
    // spends one of the attempts.
    await sleep(IG_CONTAINER_POLL_DELAY_MS);
    const out = await graphGet<{ status_code?: string; status?: string }>(
      creationId,
      { fields: "status_code,status", access_token: token },
      "instagram container status",
    );
    lastStatus = out.status_code ?? "unknown";
    if (lastStatus === "FINISHED" || lastStatus === "PUBLISHED") return;
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      throw new MetaApiError(
        `instagram container ${lastStatus}: ${out.status ?? "no detail"}. ` +
          `The most common cause is that Meta could not fetch the image URL — confirm it is public and returns an image.`,
      );
    }
  }
  throw new MetaApiError(
    `instagram container did not reach FINISHED within ` +
      `${(IG_CONTAINER_POLL_ATTEMPTS * IG_CONTAINER_POLL_DELAY_MS) / 1000}s (last status ${lastStatus}). ` +
      `Nothing was published — the container will expire on its own.`,
  );
}

/**
 * Best-effort permalink. There is no way to derive an Instagram URL from a
 * media id without asking, so a failure here returns null rather than
 * fabricating a link that 404s.
 */
async function instagramPermalink(mediaId: string, token: string): Promise<string | null> {
  try {
    const out = await graphGet<{ permalink?: string }>(
      mediaId,
      { fields: "permalink", access_token: token },
      "instagram permalink",
    );
    return out.permalink ?? null;
  } catch (err) {
    console.warn(
      "[meta] permalink lookup failed (post IS published; external_url left null):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Lost-response recovery ───────────────────────────────────────────────

/**
 * Did the PREVIOUS attempt at this row actually post?
 *
 * Called only on a retry. Reads the last handful of posts on the account and
 * looks for one whose text matches this row's caption and was created within
 * the lookback window. A hit means the earlier attempt succeeded and only the
 * response was lost — so the dispatcher adopts that post's id instead of
 * publishing a second copy.
 *
 * Deliberately best-effort: a read failure returns null and the publish
 * proceeds. Blocking a legitimate first-time post because a status read
 * flaked would be a worse failure than the one this guards against, and the
 * duplicate window is narrow (a matching caption within 2 hours).
 */
/**
 * The three distinct answers a duplicate scan can give.
 *
 * `null` used to mean both "no duplicate" and "the scan itself failed", which
 * are opposite facts: the first says it is safe to publish, the second says we
 * do not know. Collapsing them made a permanently-dead guard — a token without
 * read scope, a revoked permission, Meta erroring — look exactly like a clean
 * run, forever, with nothing counted and nothing raised. This is the anti-
 * double-post mechanism; it is the last thing that should fail quietly.
 */
export type DuplicateScan =
  | { kind: "adopt"; result: PublishResult }
  | { kind: "none" }
  | { kind: "scan_failed"; reason: string };

export async function findRecentDuplicate(
  row: MarketingRow,
  env: MetaEnv,
): Promise<DuplicateScan> {
  try {
    const caption = buildCaption(row);
    const needle = normaliseForCompare(caption);
    // Genuinely "no duplicate to find": too short to match anything confidently.
    if (needle.length < 20) return { kind: "none" };
    const token = env.pageAccessToken;
    if (!token) return { kind: "scan_failed", reason: "no page access token" };
    const cutoff = Date.now() - DUPLICATE_LOOKBACK_MS;

    if (row.channel === "facebook") {
      if (!env.pageId) return { kind: "scan_failed", reason: "META_PAGE_ID not set" };
      // VERIFY: /{page-id}/feed?fields=id,message,created_time returns the
      // Page's own posts newest-first.
      const out = await graphGet<{
        data?: Array<{ id?: string; message?: string; created_time?: string }>;
      }>(
        `${env.pageId}/feed`,
        {
          fields: "id,message,created_time",
          limit: String(DUPLICATE_SCAN_LIMIT),
          access_token: token,
        },
        "facebook recent-post scan",
      );
      for (const p of out.data ?? []) {
        if (!p.id || !p.message) continue;
        if (Date.parse(p.created_time ?? "") < cutoff) continue;
        if (normaliseForCompare(p.message) === needle) {
          return {
            kind: "adopt",
            result: { externalId: p.id, externalUrl: facebookPermalink(p.id), adopted: true },
          };
        }
      }
      return { kind: "none" };
    }

    if (!env.igUserId) return { kind: "scan_failed", reason: "META_IG_USER_ID not set" };
    // VERIFY: /{ig-user-id}/media?fields=id,caption,timestamp,permalink returns
    // the account's own media newest-first.
    const out = await graphGet<{
      data?: Array<{ id?: string; caption?: string; timestamp?: string; permalink?: string }>;
    }>(
      `${env.igUserId}/media`,
      {
        fields: "id,caption,timestamp,permalink",
        limit: String(DUPLICATE_SCAN_LIMIT),
        access_token: token,
      },
      "instagram recent-media scan",
    );
    for (const m of out.data ?? []) {
      if (!m.id || !m.caption) continue;
      if (Date.parse(m.timestamp ?? "") < cutoff) continue;
      if (normaliseForCompare(m.caption) === needle) {
        return {
          kind: "adopt",
          result: { externalId: m.id, externalUrl: m.permalink ?? null, adopted: true },
        };
      }
    }
    return { kind: "none" };
  } catch (err) {
    // Still proceed with the publish — a read failure must never block a first
    // post — but say so, so the caller can count it and the run can report it.
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[meta] duplicate scan failed; proceeding with publish:", reason);
    return { kind: "scan_failed", reason };
  }
}

function normaliseForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// ─── Token inspection (used by marketing-token-health) ────────────────────

export interface TokenHealth {
  valid: boolean;
  /** Unix seconds. 0 means "never expires" (Meta's own encoding). Null = unknown. */
  expiresAt: number | null;
  /** Separate 90-day clock Meta applies to data access. Null = unknown/absent. */
  dataAccessExpiresAt: number | null;
  /** How the answer was obtained — the caller reports this, since the tiers differ in strength. */
  method: "debug_token_app" | "debug_token_self" | "liveness";
  scopes?: string[];
  message?: string;
}

/**
 * Inspect the Page access token.
 *
 * Three tiers, strongest first. The fallbacks exist because `/debug_token`
 * wants an APP access token, and this deployment may only have the page token:
 *
 *  1. `debug_token` with `{APP_ID}|{APP_SECRET}` — the documented, authoritative
 *     path. Gives validity, `expires_at`, `data_access_expires_at` and scopes.
 *  2. `debug_token` inspecting the token WITH ITSELF. Works when the token
 *     belongs to an app the caller administers.
 *     VERIFY: Meta documents the `access_token` parameter as an app token or a
 *     token from a developer of the app; the self-inspect case is observed to
 *     work but is not guaranteed.
 *  3. Liveness only — `GET /me`. Proves the token still authenticates and
 *     nothing more. NO expiry warning is possible at this tier, which is
 *     exactly the silent death this whole function exists to prevent, so the
 *     caller must surface that the check ran degraded.
 */
export async function inspectPageToken(env: MetaEnv): Promise<TokenHealth> {
  const token = env.pageAccessToken;
  if (!token) {
    throw new MetaConfigError(
      "Cannot check token health: META_PAGE_ACCESS_TOKEN is not set.",
    );
  }

  if (env.appId && env.appSecret) {
    return await debugToken(token, `${env.appId}|${env.appSecret}`, "debug_token_app");
  }

  try {
    return await debugToken(token, token, "debug_token_self");
  } catch (err) {
    console.warn(
      "[meta] self-inspect debug_token failed, falling back to liveness:",
      err instanceof Error ? err.message : err,
    );
  }

  // VERIFY: `GET /me` with a Page token returns the Page node. Any 2xx here
  // means the token still authenticates.
  const me = await graphGet<{ id?: string; name?: string }>(
    "me",
    { fields: "id,name", access_token: token },
    "meta token liveness",
  );
  return {
    valid: Boolean(me.id),
    expiresAt: null,
    dataAccessExpiresAt: null,
    method: "liveness",
    message:
      `Liveness only — set META_APP_ID and META_APP_SECRET to enable /debug_token, ` +
      `without which token EXPIRY cannot be seen in advance (identified as ${me.name ?? me.id ?? "unknown"}).`,
  };
}

async function debugToken(
  inputToken: string,
  accessToken: string,
  method: "debug_token_app" | "debug_token_self",
): Promise<TokenHealth> {
  // VERIFY: /debug_token returns
  // { data: { is_valid, expires_at, data_access_expires_at, scopes, type, error } }
  // https://developers.facebook.com/docs/graph-api/reference/debug_token
  const out = await graphGet<{
    data?: {
      is_valid?: boolean;
      expires_at?: number;
      data_access_expires_at?: number;
      scopes?: string[];
      error?: { message?: string; code?: number };
    };
  }>("debug_token", { input_token: inputToken, access_token: accessToken }, "meta debug_token");

  const d = out.data;
  if (!d) {
    throw new MetaApiError("meta debug_token: response had no `data` object.");
  }
  return {
    valid: d.is_valid === true,
    expiresAt: typeof d.expires_at === "number" ? d.expires_at : null,
    dataAccessExpiresAt:
      typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : null,
    method,
    scopes: d.scopes,
    message: d.error?.message,
  };
}
