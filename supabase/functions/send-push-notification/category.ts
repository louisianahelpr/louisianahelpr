// APNs action-button category inference.
//
// Split out of index.ts so it can be unit-tested: index.ts calls `Deno.serve`
// at module load, so importing it from vitest is not possible, and this is the
// one piece of that file whose correctness is decidable from data alone.

// Action-button category identifiers. The actual UNNotificationCategory
// + UNNotificationAction registration happens on the iOS side (typically
// in AppDelegate or a Capacitor plugin). The strings below are the
// contract — both sides must agree on the spelling.
//
//   JOB_APPLY    → Apply, Save           (browse-notifications)
//   MESSAGE      → Reply (text input)    (incoming chat messages)
//   JOB_ACCEPTED → Message, View         (a job you are already on)
//
// Future categories should be added here AND registered on the iOS
// side; an unknown category falls back to a tappable notification with
// no action buttons (no error — APNs ignores unknown identifiers).
export type PushCategory = 'JOB_APPLY' | 'MESSAGE' | 'JOB_ACCEPTED'

/**
 * Infer a category from the payload's link when the caller didn't set one
 * explicitly. Keeps existing callers (DB triggers, edge functions) working
 * without a code change while still picking up sensible action buttons.
 * Returns undefined when no inference applies — callers can always override by
 * passing `category` explicitly.
 *
 * Written against the links that actually exist. Almost every push here is
 * fanned out from a `notifications` row by fan_out_push_on_notification
 * (20260506150000), which forwards `notifications.link` verbatim, so that
 * column IS the inventory. Measured in production on 2026-09-01 over all
 * 1,709 rows:
 *
 *   /admin 627 · /dashboard 619 · /my-posts 150 · /messages 120 · /post-job 72
 *   · /my-jobs 48 · /jobs/:id 28 · /earnings 16 · /profile 11 · /activity 6
 *   · /support 3 · /warnings 3 · null 5
 *
 * Two things the old three-line version made look true and were not:
 *
 *   1. `link.includes('accepted')` never matched anything. ZERO of the 1,709
 *      links contain that substring — the notification that reads
 *      "Application accepted!" links to `/dashboard`, not to a URL with the
 *      word in it — so JOB_ACCEPTED was genuinely unreachable and the
 *      Message/View pair had never once been attached to a push.
 *   2. `startsWith('/jobs/')` was NOT dead (28 rows), but every one of those
 *      is a lifecycle ping on a job you are already on — "Starting soon",
 *      "Did you start this job?", "Has your helpr arrived?" — and they were
 *      handed Apply/Save, buttons for a job you have not got yet.
 *
 * So the split is by RELATIONSHIP to the job, which is what the two job button
 * pairs actually differ on. Everything else (/admin, /earnings, /profile,
 * /post-job, /support, /warnings) stays uncategorised on purpose: there is no
 * honest pair of buttons for "your payout landed" or "email delivery failed",
 * and APNs renders an absent or unknown category as a plain tappable
 * notification.
 *
 * NOTE: none of this reaches a device yet. The UNNotificationCategory /
 * UNNotificationAction registration this contract depends on does not exist
 * anywhere in the iOS project — grep JOB_APPLY outside these two files and
 * there are no hits — so APNs currently drops every identifier below. The
 * inference being right is a precondition for that registration, not a
 * substitute for it.
 */
export function inferCategoryFromLink(link: string | null | undefined): PushCategory | undefined {
  // Strip the query string first: many live links carry `?job=<uuid>`.
  const path = (link?.toLowerCase() ?? '').split('?')[0]

  if (path.startsWith('/messages')) return 'MESSAGE'

  // A job you already hold: the poster's own posts, the helper's own jobs,
  // and the per-job detail route the reminder crons link to.
  if (path.startsWith('/my-posts') || path.startsWith('/my-jobs') || path.startsWith('/jobs/')) {
    return 'JOB_ACCEPTED'
  }

  // A job you could take: the browse feed (job_match is 470 of the 619
  // /dashboard rows) and the direct-offer notifications on /activity.
  if (path.startsWith('/dashboard') || path.startsWith('/activity')) return 'JOB_APPLY'

  return undefined
}
