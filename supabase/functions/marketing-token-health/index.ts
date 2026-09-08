// marketing-token-health — the watcher for the way this integration actually
// dies.
//
// Meta access tokens expire. When one does, `marketing-publish` starts failing
// every row with a 190 and the owner learns about it when they notice the feed
// has been quiet for a week. There is no email from Meta, no banner, no
// exception anywhere in this codebase — the posting simply stops. That is the
// documented failure mode of every self-hosted Meta poster, and it is why this
// function exists as a separate, independently scheduled thing rather than a
// branch inside the dispatcher: a dispatcher that is not running cannot warn
// you that it is not running.
//
// TWO questions, because the silence has two causes:
//
//   1. Is the credential alive, and for how much longer?
//   2. Is the QUEUE draining? A live token in front of a dispatcher that never
//      runs produces exactly the same silence.
//
// ─── Defect vs outcome, decided deliberately ─────────────────────────────
//
// Per `_shared/cron-result.ts`, the defect count is what pages someone, so it
// must mean "work was dropped", not "the news is bad".
//
//   DEFECT  — the check could not run (secret missing, Graph unreachable, DB
//             read failed); the token is INVALID (positive evidence the
//             publisher is dropping every row right now); the queue is overdue
//             and not draining; rows are stranded in 'publishing' past the
//             reclaim window while auto-publish is on.
//   OUTCOME — a token expiring in six days (nothing has been dropped yet; the
//             Slack warning is the correct channel for it, and answering 500
//             for a week would train the watcher to be ignored); rows that
//             ended 'failed' (the dispatcher ALREADY counted each of those as a
//             defect when it happened — counting them again here pages twice
//             for one event).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { inspectPageToken, readMetaEnv, type TokenHealth } from "../_shared/marketing/meta.ts";

const FN = "marketing-token-health";

/**
 * The client type, derived from the exact call this file makes. Bare
 * `ReturnType<typeof createClient>` resolves the generic schema parameters to
 * their defaults and turns every query below into a type error — see the same
 * note in `marketing-publish/index.ts`.
 */
function makeDb(url: string, key: string) {
  return createClient(url, key);
}
type Db = ReturnType<typeof makeDb>;

/** Warn this far ahead of expiry. Long enough to act, short enough to mean it. */
const EXPIRY_WARN_DAYS = 7;

/**
 * A scheduled row is "overdue" this long past its time. Generous: the
 * dispatcher's own cadence, a cap release and a retry all legitimately push a
 * row past its scheduled minute without anything being wrong.
 */
const OVERDUE_MINUTES = 90;

/** With overdue rows waiting and nothing published in this long, the queue is stuck. */
const STALL_HOURS = 24;

/**
 * `claim_marketing_content` reclaims a 'publishing' row after 15 minutes. A row
 * still stranded at twice that means the reclaim is not happening — the
 * dispatcher is not running, or it is dying in the same place every time.
 */
const STRANDED_MINUTES = 45;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const defects = defectTracker();
  const report: Record<string, unknown> = {};

  /**
   * ── CONTRACT KEYS — top level, always present, always numbers ──────────
   * `20260903040120_schedule_marketing_crons.sql` registers this job with the
   * silent-failure detector (20260829020000) using candidate key `checked` and
   * disposition keys healthy/alerted/skipped. The detector reads them from the
   * TOP LEVEL of the response body and casts each with `(body ->> k)::numeric`,
   * so nesting one inside `report` disables the rule and emitting a boolean
   * errors the detector's query for every other cron in the table.
   *
   * A "probe" is one health question this run asked. Every probe lands in
   * EXACTLY ONE of healthy / alerted / skipped, so `checked` always equals
   * their sum and the detector can never see work taken and then vanish.
   *
   * ── WHY THE HEALTHY BUCKET IS NOT CALLED `ok` ────────────────────────
   * It was, briefly, and it was wrong. `cronResult` builds
   * `{ ok: count === 0, fn, ...body, defects }` — `...body` comes AFTER `ok`,
   * so a disposition key named `ok` OVERWRITES cronResult's boolean "was the
   * run clean" field with a count. `body.ok` became `3` instead of `true`.
   *
   * Nothing read it (verified 2026-09-02: no migration reads `ok` out of a cron
   * response body — the watchers key on `fn`, `defects`, the candidate key, the
   * disposition keys and the HTTP status), so it broke nothing. It was renamed
   * anyway, in BOTH places at once, because a shadowed field that silently
   * changes type is a trap for whoever adds the first reader.
   *
   * So: do not "tidy" `healthy` back to `ok`. The name is half of a contract
   * whose other half lives in `cron_work_expectations`, and renaming one side
   * alone does not error — it silently stops the rule from ever evaluating this
   * job. And nothing may ever cast `(body ->> 'ok')::boolean`: on a cron whose
   * body shadows it, that cast errors on a number.
   */
  const probes = { checked: 0, healthy: 0, alerted: 0, skipped: 0 };
  const probe = (result: "healthy" | "alerted" | "skipped") => {
    probes.checked++;
    probes[result]++;
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return cronError(
        FN,
        "Missing SUPABASE_URL or SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY — cannot read the queue.",
        corsHeaders,
      );
    }
    const supabase = makeDb(supabaseUrl, serviceKey);

    // ── Is auto-publish even on? ─────────────────────────────────────────
    // Most of the queue checks below only mean something when the dispatcher is
    // supposed to be running. With the switch off, an overdue queue is the
    // owner's decision, not a fault.
    let autoPublishEnabled: boolean | null = null;
    const { data: settings, error: settingsError } = await supabase
      .from("marketing_settings")
      .select("auto_publish_enabled, channels_enabled, daily_post_cap")
      .eq("id", true)
      .maybeSingle();
    if (settingsError) {
      defects.record(`settings read failed: ${settingsError.message}`);
    } else if (!settings) {
      defects.record("marketing_settings singleton row is missing.");
    } else {
      autoPublishEnabled = settings.auto_publish_enabled === true;
    }
    report.autoPublishEnabled = autoPublishEnabled;

    // ── 1. The credential ────────────────────────────────────────────────
    const env = readMetaEnv();
    let token: TokenHealth | null = null;
    let tokenError: string | null = null;
    if (!env.pageAccessToken) {
      tokenError = "META_PAGE_ACCESS_TOKEN is not set.";
    } else {
      try {
        token = await inspectPageToken(env);
      } catch (err) {
        tokenError = err instanceof Error ? err.message : String(err);
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let daysToExpiry: number | null = null;
    if (token?.expiresAt && token.expiresAt > 0) {
      daysToExpiry = Math.floor((token.expiresAt - nowSec) / 86_400);
    }
    report.token = {
      checked: token !== null,
      method: token?.method ?? null,
      valid: token?.valid ?? null,
      // Meta encodes a non-expiring token as 0. Saying "expires in -20000 days"
      // instead would be a false alarm every single run.
      expiresAt: token?.expiresAt === 0 ? "never" : token?.expiresAt ?? null,
      daysToExpiry,
      dataAccessExpiresAt: token?.dataAccessExpiresAt ?? null,
      note: token?.message ?? null,
      error: tokenError,
    };

    if (tokenError) {
      // The check itself did not run. That is a defect: the thing that is
      // supposed to notice silent death was itself silent.
      probe("alerted");
      defects.record(`token check could not run: ${tokenError}`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Meta token health check could not run",
        message:
          "The auto-poster's credential could not be inspected, so an expiry cannot be seen coming. " +
          "Auto-posting may already be failing.",
        fields: { error: tokenError, auto_publish_enabled: String(autoPublishEnabled) },
      });
    } else if (token && !token.valid) {
      // Positive evidence that every publish attempt is failing right now.
      probe("alerted");
      defects.record(`Meta page access token is INVALID${token.message ? `: ${token.message}` : ""}`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Meta access token is invalid — auto-posting is dead",
        message:
          "Facebook/Instagram publishing is failing on every row and will keep failing silently until the token is replaced. " +
          "Generate a new long-lived Page access token and set `META_PAGE_ACCESS_TOKEN`.",
        fields: {
          detail: token.message ?? "(no detail from Meta)",
          check_method: token.method,
          auto_publish_enabled: String(autoPublishEnabled),
        },
      });
    } else if (token && daysToExpiry !== null && daysToExpiry <= EXPIRY_WARN_DAYS) {
      probe("alerted");
      // Nothing has been dropped yet — warn, do not page.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: `Meta access token expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"}`,
        message:
          "When it lapses, Facebook/Instagram auto-posting stops with no other warning. Replace `META_PAGE_ACCESS_TOKEN` before then.",
        fields: {
          expires_at: new Date((token.expiresAt ?? 0) * 1000).toISOString(),
          check_method: token.method,
        },
      });
    } else {
      probe("healthy");
    }

    if (token?.method === "liveness") {
      // Deliberately NOT its own alert. This is a standing configuration state,
      // not an event, and a daily Slack message about a state nobody has
      // changed is how a channel gets muted. It rides along on every alert this
      // function does raise, sits in the response body the cron sweep stores,
      // and is logged.
      console.warn(
        `[${FN}] DEGRADED: token expiry is not visible. Set META_APP_ID and META_APP_SECRET to enable /debug_token.`,
      );
      report.tokenCheckDegraded = true;
    }

    // ── 2. Is the queue draining? ────────────────────────────────────────
    const overdueCutoff = new Date(Date.now() - OVERDUE_MINUTES * 60_000).toISOString();
    const strandedCutoff = new Date(Date.now() - STRANDED_MINUTES * 60_000).toISOString();
    const failedSince = new Date(Date.now() - 24 * 3_600_000).toISOString();

    // Head counts, not row reads: an unpaged PostgREST select silently caps at
    // 1000 rows, and a count that quietly stops at 1000 would understate
    // exactly the backlog this is looking for.
    const overdue = await headCount(
      supabase,
      defects,
      "overdue scheduled rows",
      (q) => q.eq("status", "scheduled").lte("scheduled_for", overdueCutoff),
    );
    const stranded = await headCount(
      supabase,
      defects,
      "rows stranded in publishing",
      (q) => q.eq("status", "publishing").lte("locked_at", strandedCutoff),
    );
    const recentlyFailed = await headCount(
      supabase,
      defects,
      "rows failed in the last 24h",
      (q) => q.eq("status", "failed").gte("updated_at", failedSince),
    );

    const { data: lastPub, error: lastPubError } = await supabase
      .from("marketing_content")
      .select("published_at")
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPubError) {
      defects.record(`last-published read failed: ${lastPubError.message}`);
    }
    const lastPublishedAt = lastPub?.published_at ?? null;
    const hoursSincePublish =
      lastPublishedAt === null
        ? null
        : Math.floor((Date.now() - Date.parse(lastPublishedAt)) / 3_600_000);

    report.queue = {
      overdue,
      stranded,
      recentlyFailed,
      lastPublishedAt,
      hoursSincePublish,
    };

    // A queue that is due and not draining is the same silent failure as a dead
    // token, wearing a different hat. `hoursSincePublish === null` (nothing has
    // EVER published) counts as stalled too — a system that has never worked
    // looks identical to one that stopped, and both need someone to look.
    const notDraining =
      hoursSincePublish === null || hoursSincePublish >= STALL_HOURS;
    if (autoPublishEnabled !== true || overdue === null) {
      // Cannot judge: either the owner has auto-publish off (an overdue queue
      // is then their decision, not a fault) or the count did not read.
      probe("skipped");
    } else if ((overdue ?? 0) > 0 && notDraining) {
      probe("alerted");
    } else {
      probe("healthy");
    }
    if (autoPublishEnabled === true && overdue !== null && overdue > 0 && notDraining) {
      defects.record(
        `${overdue} scheduled post(s) are overdue and nothing has published ${
          hoursSincePublish === null ? "ever" : `in ${hoursSincePublish}h`
        } — the queue is not draining.`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Marketing queue is due and not draining",
        message:
          "Auto-publish is on and posts are past their scheduled time, but nothing is going out. " +
          "Check that the `marketing-publish` cron is scheduled and running, and read `last_error` on the overdue rows.",
        fields: {
          overdue_rows: String(overdue ?? "unknown"),
          last_published: lastPublishedAt ?? "never",
          token_valid: String(token?.valid ?? "unknown"),
          token_check: token?.method ?? "failed",
          ...(report.tokenCheckDegraded ? { token_expiry_visible: "NO — set META_APP_ID/META_APP_SECRET" } : {}),
        },
      });
    }

    if (autoPublishEnabled !== true || stranded === null) {
      probe("skipped");
    } else if (stranded > 0) {
      probe("alerted");
    } else {
      probe("healthy");
    }
    if (autoPublishEnabled === true && stranded !== null && stranded > 0) {
      // The claim reclaims at 15 minutes. Past 45, the reclaim is not happening.
      defects.record(
        `${stranded} row(s) stranded in 'publishing' for over ${STRANDED_MINUTES} minutes — the reclaim is not running.`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Marketing rows stuck mid-publish",
        message:
          `Rows have been in 'publishing' for over ${STRANDED_MINUTES} minutes, well past the 15-minute reclaim window. ` +
          "Either the dispatcher is not running at all, or it is dying in the same place every run. " +
          "A row stuck here may ALSO already be live on the feed — check before re-queuing it.",
        fields: { stranded_rows: String(stranded ?? "unknown") },
      });
    }

    if (recentlyFailed === null) {
      probe("skipped");
    } else if (recentlyFailed > 0) {
      probe("alerted");
    } else {
      probe("healthy");
    }
    if (recentlyFailed !== null && recentlyFailed > 0) {
      // Warning, not a defect — see the header. Each of these was already
      // counted by the dispatcher on the run that failed it.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: `${recentlyFailed} marketing post(s) gave up in the last 24h`,
        message:
          "These rows exhausted their retries and will not go out. Read `last_error` on each — a caption over the limit or an unreachable image URL are the usual causes, and both need the row edited, not re-queued.",
        fields: { failed_rows: String(recentlyFailed ?? "unknown") },
      });
    }

    // `probes` FIRST and un-nested: the detector reads these at the top level.
    return cronResult(FN, { ...probes, ...report }, defects.defects, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${FN}] unhandled:`, err);
    return cronError(FN, message, corsHeaders);
  }
});

/**
 * `count: 'exact', head: true` — the server counts, no rows cross the wire, and
 * the 1000-row response cap cannot silently truncate the answer.
 *
 * Returns null on error AND records a defect: a count we could not read is not
 * a count of zero, and treating it as zero would make every check below it
 * quietly pass.
 */
async function headCount(
  supabase: Db,
  defects: ReturnType<typeof defectTracker>,
  label: string,
  // deno-lint-ignore no-explicit-any
  refine: (q: any) => any,
): Promise<number | null> {
  const { count, error } = await refine(
    supabase.from("marketing_content").select("id", { count: "exact", head: true }),
  );
  if (error) {
    defects.record(`count of ${label} failed: ${error.message}`);
    return null;
  }
  return count ?? 0;
}
