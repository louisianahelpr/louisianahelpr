// marketing-publish — the cron that puts scheduled rows onto the business's
// public Facebook and Instagram feeds.
//
// Auto-publish is ON by owner decision. Nothing human stands between a row in
// `marketing_content` and Louisiana Helpr's public feed, which makes this the
// highest-stakes scheduled function in the project. Two properties matter more
// than throughput, and both are load-bearing in the code below:
//
//   1. NOTHING PUBLISHES TWICE. A duplicate post cannot be un-seen.
//   2. NOTHING PUBLISHES WHEN THE OWNER SAID STOP. Every read that could
//      authorise a post fails CLOSED — a settings read that errors publishes
//      nothing, because a kill switch that only works when the database is
//      healthy is decoration.
//
// ─── Order of operations, and why each step is where it is ───────────────
//
//   auth → settings (fail closed) → kill switch → SECRETS → claim → per row:
//   channel enabled? → under cap? → publish → record
//
// The secrets check sits BEFORE the claim on purpose. `claim_marketing_content`
// increments `attempts`, and a row is abandoned at 5. If a missing
// META_PAGE_ACCESS_TOKEN were discovered after the claim, five cron ticks would
// silently burn a week of scheduled content down to 'failed' because of a
// config gap — the queue would be destroyed by the check that was supposed to
// protect it. Checked first, a missing secret costs nothing and is loud.
//
// ─── Why a release restores `attempts` ───────────────────────────────────
//
// The claim increments `attempts` for every row it hands over, including rows
// this function then declines to publish (channel off, over cap, out of time).
// Those are not failed attempts — no API call was made — so the release path
// gives the increment back. Without that, a channel switched off for three days
// would quietly exhaust every queued row's retry budget and mark it 'failed'
// the moment it was switched back on.
//
// ─── The one race this cannot fully close ────────────────────────────────
//
// Graph API has no idempotency key, so a POST that succeeds server-side with a
// lost response is indistinguishable from one that never happened. See the
// header of `_shared/marketing/meta.ts` and `findRecentDuplicate`, which turns
// the common case of that race into an adoption rather than a second post.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  findRecentDuplicate,
  MetaConfigError,
  missingSecretsFor,
  publishFacebook,
  publishInstagram,
  readMetaEnv,
  type MarketingChannel,
  type MarketingRow,
  type MetaEnv,
  type PublishResult,
} from "../_shared/marketing/meta.ts";

const FN = "marketing-publish";

/**
 * The client type, derived from the exact call this file makes.
 *
 * Writing `ReturnType<typeof createClient>` instead looks equivalent and is
 * not: `createClient` is generic, so bare `ReturnType` resolves the schema
 * parameters to their defaults and every `.update()` payload below becomes
 * `never`. Deriving it from a concrete call keeps the helper signatures honest,
 * which matters here because these helpers are the ones that must catch a
 * zero-row write.
 */
function makeDb(url: string, key: string) {
  return createClient(url, key);
}
type Db = ReturnType<typeof makeDb>;

/**
 * MUST match `attempts < 5` inside `claim_marketing_content`. A row returned by
 * the claim carries the POST-increment value, so `attempts === MAX_ATTEMPTS`
 * means the claim will never hand it over again — and leaving such a row in
 * 'scheduled' would make it look due forever while nothing ever ran it. That is
 * the silent-drop shape this project keeps finding, so it is closed explicitly:
 * a row on its last attempt goes to 'failed', which is visible.
 */
const MAX_ATTEMPTS = 5;

/**
 * Rows claimed per run. Deliberately small.
 *
 * An Instagram publish is a container create + up to 20s of polling + a publish
 * + a permalink read, so a handful of rows can approach the function's wall
 * clock. Every row claimed and not processed is a row stranded in 'publishing'
 * until the 15-minute reclaim, holding a burned attempt. With a default cap of
 * 2 posts per channel per day there is no reason to reach for more.
 */
const CLAIM_LIMIT = Number(Deno.env.get("MARKETING_CLAIM_LIMIT") ?? "3");

/**
 * Wall-clock budget for the publish loop. Past it, remaining rows are RELEASED
 * (attempts restored) rather than left to be killed mid-flight — a row cut off
 * between the Meta call and the status write is the one state that can double
 * post.
 */
const BUDGET_MS = 60_000;

interface MarketingSettings {
  auto_publish_enabled: boolean;
  channels_enabled: Record<string, unknown> | null;
  daily_post_cap: number;
}

type ClaimedRow = MarketingRow & {
  status: string;
  scheduled_for: string | null;
  campaign: string | null;
  parish: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const started = Date.now();
  const defects = defectTracker();
  const outcomes = {
    // ── CONTRACT KEYS — do not rename, do not nest, keep them numbers ─────
    // `20260903040120_schedule_marketing_crons.sql` registers this job with the
    // silent-failure detector (20260829020000) using candidate key `claimed`
    // and disposition keys published/failed/released/skipped. That detector
    // reads them from the TOP LEVEL of this body and casts each one with
    // `(body ->> k)::numeric`.
    //
    // Two distinct ways to break it, and they fail differently:
    //   • RENAME one → `body ? candidate_key` stops matching and the run is
    //     never evaluated. The rule silently stops existing, which is exactly
    //     the shape it was written to catch.
    //   • Emit a BOOLEAN → `'true'::numeric` raises, and it raises inside the
    //     detector's own query, which breaks silent-failure detection for
    //     EVERY OTHER CRON in the table, not just this one. (An earlier draft
    //     of this file returned `skipped: true` on the kill-switch path.)
    // So: always present, always a number.
    claimed: 0,
    published: 0,
    failed: 0,
    released: 0,
    /**
     * Reserved by the contract. Nothing produces a "skipped" row today — every
     * claimed row is published, failed or released — but the key must exist on
     * every response or the rule stops evaluating this job.
     */
    skipped: 0,

    // ── Detail. Not part of the contract; safe to rename. ────────────────
    /** Publishes that were really recoveries of a lost response. */
    adopted: 0,
    /**
     * Retries where the duplicate scan could NOT be performed.
     *
     * The twin of `adopted`, and the more important of the two: a scan that
     * fails means we published without knowing whether the previous attempt
     * had already landed. Counted separately because `adopted: 0` alone cannot
     * distinguish "no duplicates happened" from "the guard is dead".
     */
    duplicateScanFailed: 0,
    /** PUBLISHED to Meta but the status write did not land. Critical. */
    unrecorded: 0,
    failedPermanently: 0,
    retryScheduled: 0,
    releasedChannelOff: 0,
    releasedOverCap: 0,
    releasedCapUnknown: 0,
    releasedDeferred: 0,
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      // Not recoverable and not silent: without the service key the claim RPC
      // would refuse anyway (it is service-role only).
      return cronError(
        FN,
        "Missing SUPABASE_URL or SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY — cannot reach the queue.",
        corsHeaders,
      );
    }
    const supabase = makeDb(supabaseUrl, serviceKey);

    // ── 1. Settings. FAIL CLOSED. ────────────────────────────────────────
    // An error, or a missing singleton row, publishes NOTHING. The kill switch
    // is only a kill switch if an unreadable switch means "off".
    const { data: settingsRow, error: settingsError } = await supabase
      .from("marketing_settings")
      .select("auto_publish_enabled, channels_enabled, daily_post_cap")
      .eq("id", true)
      .maybeSingle();

    if (settingsError) {
      defects.record(`settings read failed: ${settingsError.message}`);
      return cronResult(
        FN,
        { ...outcomes, aborted: "settings_unreadable" },
        defects.defects,
        corsHeaders,
      );
    }
    if (!settingsRow) {
      // The migration seeds this row. Its absence means the migration did not
      // run or something deleted it — broken, not a business outcome.
      defects.record(
        "marketing_settings singleton row is missing — published nothing (fail closed).",
      );
      return cronResult(
        FN,
        { ...outcomes, aborted: "settings_missing" },
        defects.defects,
        corsHeaders,
      );
    }
    const settings = settingsRow as MarketingSettings;

    // ── 2. Kill switch. An OUTCOME, not a defect. ────────────────────────
    // The owner turning auto-publish off is the system working. Counting it as
    // a defect would page someone every hour for a deliberate decision, and a
    // watcher people mute is worse than no watcher.
    if (settings.auto_publish_enabled !== true) {
      return cronResult(
        FN,
        { ...outcomes, reason: "auto_publish_disabled" },
        { count: 0 },
        corsHeaders,
      );
    }

    // ── 3. Secrets, BEFORE the claim. ────────────────────────────────────
    const env = readMetaEnv();
    const enabledChannels = (["facebook", "instagram"] as MarketingChannel[]).filter(
      (c) => isChannelEnabled(settings, c),
    );
    if (enabledChannels.length === 0) {
      return cronResult(
        FN,
        { ...outcomes, reason: "no_channels_enabled" },
        { count: 0 },
        corsHeaders,
      );
    }
    const secretGaps: string[] = [];
    for (const c of enabledChannels) {
      const missing = missingSecretsFor(c, env);
      if (missing.length > 0) {
        secretGaps.push(`${c}: ${missing.join(", ")}`);
      }
    }
    if (secretGaps.length > 0) {
      // Claiming nothing keeps every queued row intact and retryable the moment
      // the secret is set.
      defects.record(
        `Meta secrets missing, claimed nothing — ${secretGaps.join(" | ")}`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Marketing auto-publish is on but not configured",
        message:
          "`auto_publish_enabled` is true and rows may be due, but the Meta credentials are missing. " +
          "Nothing was claimed, so the queue is intact — set the secrets and the backlog goes out on the next run.",
        fields: { missing: secretGaps.join(" | ") },
      });
      return cronResult(
        FN,
        { ...outcomes, aborted: "meta_secrets_missing" },
        defects.defects,
        corsHeaders,
      );
    }

    // ── 4. Claim. The ONLY safe way to take work. ────────────────────────
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_marketing_content",
      { p_limit: Number.isFinite(CLAIM_LIMIT) ? CLAIM_LIMIT : 3 },
    );

    if (claimError) {
      // PGRST202 = "function not found", the documented deploy-lag window for a
      // brand-new RPC. Named explicitly so the alert says "wait for db-deploy"
      // rather than sending someone to debug the publisher.
      const isDeployLag = (claimError as { code?: string }).code === "PGRST202";
      defects.record(
        isDeployLag
          ? "claim_marketing_content not found (PGRST202) — the migration has not deployed yet."
          : `claim_marketing_content failed: ${claimError.message}`,
      );
      return cronResult(
        FN,
        { ...outcomes, aborted: "claim_failed" },
        defects.defects,
        corsHeaders,
      );
    }

    const rows = (claimed ?? []) as ClaimedRow[];
    outcomes.claimed = rows.length;
    if (rows.length === 0) {
      // Zero rows due is an ordinary Tuesday, not a defect.
      return cronResult(FN, { ...outcomes, reason: "nothing_due" }, { count: 0 }, corsHeaders);
    }

    // ── 5-8. Per row. Sequential on purpose: the daily cap is read per row and
    // counts this run's own successes, which only works if the posts are not
    // racing each other.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (Date.now() - started > BUDGET_MS) {
        // Out of wall clock. Release the rest cleanly rather than risk being
        // killed between a Meta call and its status write.
        for (const rest of rows.slice(i)) {
          await releaseRow(supabase, defects, rest, "deferred: run out of time budget", true);
          outcomes.released++;
          outcomes.releasedDeferred++;
        }
        break;
      }

      // 5a. Channel enabled? (Re-read from the same settings snapshot — see
      // scenario (e) in this function's verification notes: a mid-run flip is
      // honoured on the NEXT tick, and the cap plus the small claim limit bound
      // what a stale snapshot can do to at most CLAIM_LIMIT posts.)
      if (!isChannelEnabled(settings, row.channel)) {
        await releaseRow(supabase, defects, row, `channel ${row.channel} is disabled`, true);
        outcomes.released++;
        outcomes.releasedChannelOff++;
        continue;
      }

      // 5b. Under the daily cap? Read per row so this run's own posts count.
      const { data: postedToday, error: capError } = await supabase.rpc(
        "marketing_published_today",
        { p_channel: row.channel },
      );
      if (capError) {
        // Fail closed: without knowing the count we cannot know we are under
        // the ceiling, and the ceiling is the guard against a generation bug
        // becoming 400 posts. Release, do not publish.
        defects.record(
          `marketing_published_today(${row.channel}) failed: ${capError.message} — released row ${row.id} unpublished`,
        );
        await releaseRow(supabase, defects, row, "cap check unavailable", true);
        outcomes.released++;
        outcomes.releasedCapUnknown++;
        continue;
      }
      const already = Number(postedToday ?? 0);
      if (already >= settings.daily_post_cap) {
        await releaseRow(
          supabase,
          defects,
          row,
          `daily cap reached for ${row.channel} (${already}/${settings.daily_post_cap})`,
          true,
        );
        outcomes.released++;
        outcomes.releasedOverCap++;
        continue;
      }

      // ── 6. Publish. ───────────────────────────────────────────────────
      let result: PublishResult;
      try {
        result = await publishRow(row, env, (reason) => {
          outcomes.duplicateScanFailed++;
          // A defect, not an outcome: the guard intended to run and could not.
          // It does not fail the publish — proceeding is correct — but the run
          // must not answer 2xx as though the safety check had happened.
          defects.record(`duplicate scan failed for row ${row.id}: ${reason}`);
        });
      } catch (err) {
        const permanent = err instanceof MetaConfigError;
        const message = err instanceof Error ? err.message : String(err);
        // Per the cron doctrine this IS a defect: a post the function intended
        // to make did not happen. "Meta rejected our post" is broken, not a
        // business outcome like a declined card.
        defects.record(`row ${row.id} (${row.channel}) publish failed: ${message}`);
        const exhausted = permanent || row.attempts >= MAX_ATTEMPTS;
        await recordFailure(supabase, defects, row, message, exhausted);
        outcomes.failed++;
        if (exhausted) outcomes.failedPermanently++;
        else outcomes.retryScheduled++;
        continue;
      }

      if (result.adopted) outcomes.adopted++;

      // ── 7. Record it. A LOST STATUS WRITE MEANS A RE-POST. ────────────
      const wrote = await recordSuccess(supabase, row, result);
      if (wrote.ok) {
        outcomes.published++;
        continue;
      }

      // The post is LIVE and the database does not know. On the next tick the
      // 15-minute reclaim picks the row up again and, but for the duplicate
      // scan, posts it a second time. This is the loudest thing this function
      // can say.
      // Counted as `published` because it IS published — the post is on the
      // public feed and saying otherwise in this body would be false. What the
      // database does not know is carried by `unrecorded`, the defect reason,
      // and the critical alert below.
      outcomes.published++;
      outcomes.unrecorded++;
      defects.record(
        `row ${row.id} PUBLISHED to ${row.channel} as ${result.externalId} but the status write failed: ${wrote.error}`,
      );
      console.error(
        `[${FN}] CRITICAL: published ${row.channel} post ${result.externalId} for row ${row.id}; status write failed:`,
        wrote.error,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Marketing post is live but was not recorded",
        message:
          "The post went out to the public feed and the database write that marks it published did not land. " +
          "Until this row is corrected by hand it can be re-claimed and posted AGAIN. " +
          "Set it to `published` with the external_id below, or cancel it.",
        fields: {
          row_id: row.id,
          channel: row.channel,
          external_id: result.externalId,
          external_url: result.externalUrl ?? "(none)",
          db_error: wrote.error ?? "(unknown)",
        },
      });
      // Last resort: at minimum get the external_id onto the row so a human has
      // the receipt even if the status could not be set.
      await stashReceipt(supabase, row, result, wrote.error ?? "unknown");
    }

    return cronResult(FN, outcomes, defects.defects, corsHeaders);
  } catch (err) {
    // Nothing type-checks edge functions before deploy, so an undefined
    // variable reaches production and lands here. `cronError` answers non-2xx
    // and names this function, which is the only reason the watcher would ever
    // hear about it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${FN}] unhandled:`, err);
    return cronError(FN, message, corsHeaders);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * A channel is on ONLY when `channels_enabled` holds boolean `true` for it.
 * Absent is off, per the schema comment; anything that is not literally `true`
 * is also treated as off, because the safe direction of a misconfiguration
 * here is "did not post", never "posted".
 */
function isChannelEnabled(settings: MarketingSettings, channel: MarketingChannel): boolean {
  const raw = settings.channels_enabled?.[channel];
  if (raw === true) return true;
  if (raw !== undefined && raw !== false) {
    console.warn(
      `[${FN}] channels_enabled.${channel} is ${JSON.stringify(raw)}, not boolean true — treating as OFF.`,
    );
  }
  return false;
}

async function publishRow(
  row: ClaimedRow,
  env: MetaEnv,
  onScanFailure: (reason: string) => void,
): Promise<PublishResult> {
  // On a RETRY, ask Meta whether the previous attempt actually landed before
  // making a second one. `attempts` is post-increment, so 1 is the first try.
  if (row.attempts > 1) {
    const scan = await findRecentDuplicate(row, env);
    if (scan.kind === "adopt") {
      console.warn(
        `[${FN}] row ${row.id} was already posted as ${scan.result.externalId} — adopting instead of re-posting.`,
      );
      return scan.result;
    }
    if (scan.kind === "scan_failed") {
      // Publish anyway — blocking here would strand every retry behind a read
      // permission. But this row is now being posted WITHOUT the guard, and
      // that fact has to leave the function.
      onScanFailure(scan.reason);
    }
  }
  return row.channel === "instagram"
    ? await publishInstagram(row, env)
    : await publishFacebook(row, env);
}

/**
 * Put a claimed row back on the queue without consuming it.
 *
 * `restoreAttempt` gives back the increment the claim made, for the cases where
 * no API call happened (channel off, over cap, cap unreadable, out of time).
 * Those are not failures and must not spend the retry budget.
 *
 * The `.eq("status", "publishing")` guard means we only write the row we still
 * hold. Zero rows means someone else reclaimed it, which is worth knowing.
 */
async function releaseRow(
  supabase: Db,
  defects: ReturnType<typeof defectTracker>,
  row: ClaimedRow,
  reason: string,
  restoreAttempt: boolean,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "scheduled",
    locked_at: null,
    last_error: reason,
  };
  if (restoreAttempt) patch.attempts = Math.max(0, (row.attempts ?? 1) - 1);

  const { data, error } = await supabase
    .from("marketing_content")
    .update(patch)
    .eq("id", row.id)
    .eq("status", "publishing")
    .select("id");

  if (error) {
    defects.record(`release of row ${row.id} failed: ${error.message}`);
    return;
  }
  // A null error does NOT mean the write happened. Zero rows here leaves the
  // row in 'publishing' until the 15-minute reclaim — recoverable, but it means
  // our view of the row was wrong, which is exactly the thing worth surfacing.
  if (!data || data.length === 0) {
    defects.record(
      `release of row ${row.id} matched zero rows — it is no longer 'publishing' (reclaimed elsewhere?).`,
    );
  }
}

/**
 * A publish attempt failed. Either back to 'scheduled' for another go, or
 * 'failed' when there is no go left. NEVER left in 'publishing' — a row parked
 * there is invisible until the reclaim window and looks like a silent drop.
 */
async function recordFailure(
  supabase: Db,
  defects: ReturnType<typeof defectTracker>,
  row: ClaimedRow,
  message: string,
  exhausted: boolean,
): Promise<void> {
  const { data, error } = await supabase
    .from("marketing_content")
    .update({
      status: exhausted ? "failed" : "scheduled",
      locked_at: null,
      // Truncated: `last_error` is read in an admin table and a multi-kilobyte
      // Graph error makes the row unreadable.
      last_error: message.slice(0, 1000),
    })
    .eq("id", row.id)
    .eq("status", "publishing")
    .select("id");

  if (error) {
    defects.record(`failure write for row ${row.id} failed: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    defects.record(`failure write for row ${row.id} matched zero rows — it may still be 'publishing'.`);
  }
}

/**
 * The write that stops a re-post. Retried, because a transient PostgREST blip
 * here has a public consequence and the cost of trying again is milliseconds.
 *
 * `.select("id")` and a zero-row check are mandatory on this path: a null error
 * does not mean the write happened, and here a lost write means the row is
 * re-claimed and the content is POSTED TWICE.
 */
async function recordSuccess(
  supabase: Db,
  row: ClaimedRow,
  result: PublishResult,
): Promise<{ ok: boolean; error?: string }> {
  const patch = {
    status: "published",
    published_at: new Date().toISOString(),
    external_id: result.externalId,
    external_url: result.externalUrl,
    locked_at: null,
    last_error: null,
  };

  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabase
      .from("marketing_content")
      .update(patch)
      .eq("id", row.id)
      .eq("status", "publishing")
      .select("id");

    if (!error && data && data.length > 0) return { ok: true };

    if (error) {
      lastError = error.message;
      // 23505 = unique violation on (channel, external_id): this exact post is
      // already recorded, on this row or another. Retrying cannot help and the
      // situation needs a human, so stop immediately rather than burn retries.
      if ((error as { code?: string }).code === "23505") {
        return {
          ok: false,
          error: `unique violation on (channel, external_id) — ${result.externalId} is already recorded on another row: ${error.message}`,
        };
      }
    } else {
      lastError =
        "matched zero rows (the row is no longer 'publishing' — another dispatcher may hold it)";
      // A zero-row match will not become a one-row match by trying again.
      return { ok: false, error: lastError };
    }

    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
  }
  return { ok: false, error: lastError };
}

/**
 * Best-effort: when the status write is unrecoverable, still try to land the
 * external id on the row so a human has the receipt. Written WITHOUT the
 * 'publishing' guard and without touching `status`, so it cannot itself cause
 * the row to look published when it is not.
 */
async function stashReceipt(
  supabase: Db,
  row: ClaimedRow,
  result: PublishResult,
  dbError: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("marketing_content")
      .update({
        external_id: result.externalId,
        external_url: result.externalUrl,
        last_error:
          `PUBLISHED to ${row.channel} as ${result.externalId} but the status write failed (${dbError}). ` +
          `Set status='published' by hand, or cancel — otherwise this row can be re-posted.`.slice(0, 1000),
      })
      .eq("id", row.id)
      .select("id");
    if (error) {
      console.error(`[${FN}] receipt stash for row ${row.id} also failed:`, error.message);
    }
  } catch (err) {
    console.error(`[${FN}] receipt stash threw for row ${row.id}:`, err);
  }
}
