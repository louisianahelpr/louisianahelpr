/**
 * str-ical-sync — fetch iCal feeds for active STR calendar connections,
 * detect guest checkouts in the next 7 days, and record each as a cleaning
 * job for the host to post (Q768: never a jobs row before payment).
 *
 * Invocation:
 *   - POST with empty body  → syncs ALL active connections
 *   - POST { connection_id } → syncs a single connection (manual "sync now")
 *   - Cron (Authorization: Bearer <CRON_SECRET>) → syncs all active
 *
 * SCHEDULED by migration 20260831193040 — every six hours at minute :44.
 * Until that migration it existed in no cron.schedule call and no workflow, so
 * this header described a cron that had never run: STR calendars only synced
 * when a host opened Settings and tapped "Sync now". Anything that changes the
 * schedule must change it there, not here.
 *
 * Idempotent: str_processed_events has a UNIQUE(connection_id, event_uid)
 * constraint — re-running never imports (or notifies about) a checkout twice.
 */

import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { cronError, cronResult, defectTracker } from '../_shared/cron-result.ts';
import { BlockedUrlError, FeedTooLargeError, fetchIcalFeed } from './safeFetch.ts';
import { lookAheadWindow, parseIcalDate } from './dates.ts';

// SECRET_KEY first, matching every other cron-invoked function here
// (auto-expire-jobs, cleanup-notifications, …). Reading only the legacy
// SUPABASE_SERVICE_ROLE_KEY is the exact shape of the mismatch that 401'd five
// cron-invoked functions in May — see migration 20260505220500.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
  { global: { fetch: boundedFetch() } },
);

// ---------------------------------------------------------------------------
// Simple iCal parser — no external dependency needed for our use case.
// Handles multi-line folded values (RFC 5545 §3.1) and the two date formats
// Airbnb / VRBO emit: YYYYMMDD (date-only) and YYYYMMDDTHHmmssZ (UTC datetime).
// ---------------------------------------------------------------------------
interface IcalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
}

function parseIcal(icalText: string): IcalEvent[] {
  // Unfold continuation lines (CRLF + whitespace → nothing)
  const unfolded = icalText.replace(/\r?\n[ \t]/g, '');
  const events: IcalEvent[] = [];
  const eventBlocks = unfolded.split(/BEGIN:VEVENT/);

  for (const block of eventBlocks.slice(1)) {
    const uid = block.match(/\nUID:([^\r\n]+)/)?.[1]?.trim() ?? '';
    const summary = block.match(/\nSUMMARY:([^\r\n]+)/)?.[1]?.trim() ?? '';
    // DTSTART / DTEND may carry VALUE=DATE or TZID parameters before the colon
    const dtstart = block.match(/\nDTSTART[^:]*:([^\r\n]+)/)?.[1]?.trim() ?? '';
    const dtend   = block.match(/\nDTEND[^:]*:([^\r\n]+)/)?.[1]?.trim() ?? '';

    if (uid && dtend) {
      events.push({ uid, summary, dtstart, dtend });
    }
  }
  return events;
}

/**
 * Map a sync failure to a message that is safe to store where the connection's
 * OWNER can read it, and still actionable enough for the "Sync now" toast.
 *
 * The rule: the host learns THAT their feed did not load and what to do about
 * it; they never learn anything about what the platform's network can see. So
 * every transport-level outcome collapses to one string — a refused connection,
 * a timeout and a DNS failure must be indistinguishable, because telling them
 * apart is precisely the scanner primitive.
 */
function sanitizeSyncError(err: unknown): string {
  if (err instanceof BlockedUrlError) {
    // Safe to be specific: this is a verdict on the URL the host typed, and
    // saying so is the only way they can fix it.
    return `This calendar URL was rejected: ${err.reason}. Paste the public iCal export link from Airbnb or VRBO.`;
  }
  if (err instanceof FeedTooLargeError) {
    return 'That calendar feed is too large to sync. Check the link points at a single property export.';
  }
  return "We couldn't load that calendar feed. Check the link is the public iCal export URL and still works, then try again.";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  // Auth gate — two valid callers:
  //   1. Internal (cron / service role): CRON_SECRET or SERVICE_ROLE_KEY → may sync all or one connection
  //   2. User JWT: may only sync a specific connection they own (manual "sync now" from UI)
  // Without this gate any unauthenticated caller could trigger platform-wide iCal fetches
  // or auto-create cleaning jobs for connections they don't own.
  const cronSecret     = Deno.env.get('CRON_SECRET')
  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader     = req.headers.get('Authorization') ?? ''
  const isInternal =
    (cronSecret     && authHeader === `Bearer ${cronSecret}`) ||
    (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`)

  let body: { connection_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  // All-connections sync is internal-only
  if (!body.connection_id && !isInternal) {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  // For user JWT callers, validate the token and extract their user id so we
  // can enforce ownership on the connection below.
  let callerUserId: string | null = null
  if (!isInternal) {
    if (!authHeader) return errorResponse('Unauthorized', 401, corsHeaders);
    const anonKey = Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      anonKey,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return errorResponse('Unauthorized', 401, corsHeaders);
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;
    callerUserId = user.id
  }

  // Build query — optionally filter to a single connection for manual sync
  let query = supabase
    .from('str_calendar_connections')
    .select('*')
    .eq('is_active', true);

  if (body.connection_id) {
    query = query.eq('id', body.connection_id);
    // Enforce ownership for non-internal callers
    if (callerUserId) query = query.eq('user_id', callerUserId);
  }

  // Defect counter for the cron watcher. Counts work that was SUPPOSED to
  // happen and didn't because something is broken — a feed we couldn't fetch, a
  // job insert the DB rejected, a processed-event row that failed to record. It
  // does NOT count business outcomes; see _shared/cron-result.ts.
  const defects = defectTracker();

  const { data: connections, error: connError } = await query;
  if (connError || !connections) {
    console.error('Failed to fetch STR connections:', connError);
    return cronError('str-ical-sync', `failed to fetch connections: ${connError?.message ?? 'no rows'}`, corsHeaders);
  }

  // Compare DAY to DAY, not day to instant — see ./dates.ts for why today's
  // turnover was dropped on every single run before this.
  const { from: today, to: oneWeekOut } = lookAheadWindow(new Date());
  const results: Array<{ connection_id: string; turnovers_imported?: number; error?: string }> = [];

  for (const conn of connections) {
    try {
      // Fetch the iCal feed through the SSRF gate. `ical_url` is a user-supplied
      // string on a table whose RLS policy is `USING (auth.uid() = user_id)`, so
      // this is the one place the platform dereferences an address an ordinary
      // account chose. See safeFetch.ts for the measured proof of what the bare
      // `fetch(conn.ical_url)` this replaces could reach — loopback, ULA and
      // CGNAT space directly, and 169.254.169.254 via a 302 from a public host.
      const icalText = await fetchIcalFeed(conn.ical_url);
      const events   = parseIcal(icalText);

      let turnoversImported = 0;

      for (const event of events) {
        const checkoutDate = parseIcalDate(event.dtend);

        // Only process checkouts in the 7-day look-ahead window, TODAY included.
        if (checkoutDate < today || checkoutDate > oneWeekOut) continue;
        // Skip Airbnb/VRBO "Blocked" / "Not available" pseudo-events
        const lc = event.summary.toLowerCase();
        if (lc.includes('blocked') || lc.includes('unavailable') || lc.includes('not available')) continue;

        // Dedup check — skip if already processed
        const { data: existing } = await supabase
          .from('str_processed_events')
          .select('id')
          .eq('connection_id', conn.id)
          .eq('event_uid', event.uid)
          .maybeSingle();

        if (existing) continue;

        // Import the turnover for the host to post (Q768, owner 2026-09-27:
        // "Import as drafts"). This used to INSERT a jobs row here, unpaid:
        // invisible to every Helpr (browse lists only funded jobs) and, since
        // Q767 removed Fund & Publish, unfundable by the host. Now the sync
        // creates NO jobs row: it records the checkout (job_id NULL) and tells
        // the host, whose tap opens Post a Job pre-filled
        // (/post-job?turnover=<event id>, useJobFormEffects); they pay like any
        // new post, and link_str_turnover_job points the event at that job.
        // src/test/noJobRowBeforePayment.test.ts keeps every edge function
        // that inserts into jobs to an exact, reasoned list.
        if (conn.auto_create_cleaning) {
          const checkoutDateStr = checkoutDate.toISOString().slice(0, 10);

          // ST-007: claim the event first. The cron and the host's "Sync now"
          // can run one connection at once; both pass the read above, and only
          // the UNIQUE (connection_id, event_uid) index decides who owns the
          // event, so only one of them tells the host.
          const { data: claim, error: claimError } = await supabase
            .from('str_processed_events')
            .insert({
              connection_id:  conn.id,
              event_uid:      event.uid,
              checkout_date:  checkoutDateStr,
              job_id:         null,
            })
            .select('id')
            .single();
          if (claimError) {
            // 23505: a concurrent run claimed it first and owns the job.
            if (claimError.code !== '23505') {
              console.error('Failed to claim processed event:', claimError);
              defects.record(`${conn.id}: processed-event claim failed for ${event.uid}: ${claimError.message}`);
            }
            continue;
          }

          const propName = conn.property_name ?? 'your property';
          const { error: notifyError } = await supabase.from('notifications').insert({
            user_id: conn.user_id,
            title:   'Cleaning job ready to post',
            message: `Guests check out of ${propName} on ${checkoutDateStr}. Tap to post the cleaning job.`,
            // A change on the host's own posting work: the same category the
            // other poster job notices use (auto-expire-jobs).
            type:    'job_updates',
            link:    `/post-job?turnover=${claim.id}`,
          });
          if (notifyError) {
            console.error('Failed to notify host of imported turnover:', notifyError);
            defects.record(`${conn.id}: turnover notice failed for ${event.uid}: ${notifyError.message}`);
            // Release the claim so the next run retries (and tells them then).
            const { error: releaseError } = await supabase
              .from('str_processed_events')
              .delete()
              .eq('id', claim.id);
            if (releaseError) {
              defects.record(`${conn.id}: claim release failed for ${event.uid}: ${releaseError.message}`);
            }
            continue;
          }

          turnoversImported++;
        }
      }

      // Update sync metadata
      await supabase
        .from('str_calendar_connections')
        .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
        .eq('id', conn.id);

      results.push({ connection_id: conn.id, turnovers_imported: turnoversImported });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Operator-side: the FULL error, to the function log only.
      console.error(`Sync error for connection ${conn.id}:`, errMsg);
      defects.record(`${conn.id}: ${errMsg}`);

      // Owner-side: a sanitised reason. `last_sync_error` is readable by the
      // connection's owner (RLS: `USING (auth.uid() = user_id)`), and the raw
      // transport error is an SSRF oracle — "Connection refused" vs "Signal
      // timed out" vs "dns error" vs an HTTP status distinguishes a live
      // internal host from a filtered one from a nonexistent name. Measured on
      // prod 2026-09-01: all four were distinguishable and all four were
      // written here verbatim. Blocking the fetch without blocking the readback
      // would leave a working scanner behind, so the two land together.
      const safeMsg = sanitizeSyncError(err);
      await supabase
        .from('str_calendar_connections')
        .update({ last_sync_error: safeMsg })
        .eq('id', conn.id);
      results.push({ connection_id: conn.id, error: safeMsg });
    }
  }

  // NB: `body` is already taken by the request payload above.
  const summary = { synced: results.length, results };

  // The cron path answers with the shared convention: `fn` so
  // sweep_silent_cron_failures / sweep_cron_http_failures can attribute the
  // response to THIS function rather than guessing by timestamp, and non-2xx
  // when the run dropped work. Before this the function always answered 200
  // with no `fn`, so a run that failed every connection was invisible to both
  // watchers.
  if (isInternal) return cronResult('str-ical-sync', summary, defects.defects, corsHeaders);

  // The manual "Sync now" path stays 200 and keeps the exact body shape
  // StrSettings.tsx reads. It checks `res.ok` FIRST and would replace the
  // specific per-connection error with a generic "(500) — try again?", so
  // borrowing the cron status code here would make the one caller who can act
  // on the reason stop seeing it. Browser fetches never reach
  // net._http_response, so no watcher is missing anything.
  return jsonResponse(
    { ok: defects.count === 0, fn: 'str-ical-sync', ...summary, defects: defects.count },
    200,
    corsHeaders,
  );
});
