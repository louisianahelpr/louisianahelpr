// "A channel is enabled but its Meta secret is missing" is an OWNER ACTION,
// not an outage (docs/OPEN.md Q42).
//
// Until 2026-09-23 marketing-publish treated it as both a defect AND a
// critical page: every 15-minute tick returned HTTP 500 (a `cron-http` error
// item) and posted a critical "auto-publish is on but not configured" Slack
// alert — 11 critical pages and 21 cron failures in one morning for a config
// gap only the owner can close (adding META_* secrets is a credentials step).
// Nothing was broken: the function claims nothing when a secret is missing, so
// the queue is intact. A page that repeats every 15 minutes for a to-do item
// is the kind of noise people mute, which is how a real page gets missed.
//
// So the gap is ONE ledger item:
//   - severity 'warning' (not critical — nothing is broken, nothing is lost);
//   - a STABLE title (the ledger fingerprints on it, so every tick bumps the
//     same item instead of opening a new one);
//   - a once-per-day key, so Slack hears about it once a day, not 96 times;
//   - and the cron run is an OUTCOME, not a defect (HTTP 200), so it no longer
//     also raises a `cron-http` failure item.
//
// src/test/marketingSecretGapIsOwnerAction.test.ts holds all four.

export const META_SECRET_GAP_TITLE =
  "Owner action: a marketing channel is enabled but its Meta secret is missing";

/** Stable across ticks and days — the dedupe key must never carry a timestamp. */
export const META_SECRET_GAP_KEY = "marketing-publish:meta-secret-missing";

export interface SecretGapAlert {
  kind: "custom";
  severity: "warning";
  title: string;
  message: string;
  fields: Record<string, string>;
  oncePerDayKey: string;
}

/** The single alert for "enabled channel, missing secret". Never critical. */
export function metaSecretGapAlert(secretGaps: string[]): SecretGapAlert {
  return {
    kind: "custom",
    severity: "warning",
    title: META_SECRET_GAP_TITLE,
    message:
      "`auto_publish_enabled` is true and a channel is switched on, but its Meta credentials are not set. " +
      "Nothing was claimed, so the queue is intact. Either add the secret (owner, credentials) or switch the " +
      "channel off in /admin?view=social. This is a to-do, not an outage: it posts once a day.",
    fields: { missing: secretGaps.join(" | ") },
    oncePerDayKey: META_SECRET_GAP_KEY,
  };
}
