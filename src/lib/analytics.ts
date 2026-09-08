/**
 * Helpr analytics — first-party, privacy-respecting.
 *
 * Writes event rows to `analytics_events` in Supabase. No third-party SDK,
 * no IDFA, nothing that needs ATT. App Store reviewers don't flag this.
 *
 * Usage:
 *   import { track, AhaEvent } from "@/lib/analytics";
 *   track(AhaEvent.JobPosted, { budget_cents: 2500, parish: "Orleans" });
 */
type AnalyticsEventRow = {
  event: string;
  user_id: string | null;
  properties: Record<string, unknown>;
  url: string | null;
  referrer: string | null;
  platform: string;
};

// Supabase client is dynamically imported (NOT statically) to keep the
// ~50KB supabase-js chunk out of pages that only call track() (e.g. landing).
// flush() is debounced 1.5s, well past any dynamic-import resolution time.
async function getSupabase() {
  const mod = await import("@/integrations/supabase/client");
  return mod.supabase;
}

// PostHog is dynamically imported (NOT statically) to keep posthog-js
// out of the initial bundle — Lighthouse "Reduce unused JavaScript"
// flagged it at ~60KB / 55% unused. Lazy import resolves to a no-op
// until initPostHog() runs in main.tsx.
async function fanOutToPostHog(event: string, props: Record<string, unknown>) {
  try {
    const { captureEvent } = await import("@/lib/posthog");
    captureEvent(event, props);
  } catch {
    /* analytics must never break the app */
  }
}

/**
 * Curated list of "aha moment" + funnel events. Adding the type up here
 * keeps event names consistent and makes them easy to grep.
 */
export const AhaEvent = {
  // Activation funnel
  SignupStarted: "signup_started",
  SignupStepCompleted: "signup_step_completed",
  SignupStepValidationFailed: "signup_step_validation_failed",
  SignupCompleted: "signup_completed",
  EmailVerified: "email_verified",
  ProfileCompleted: "profile_completed",
  // Aha moments — moments where users "get it"
  FirstJobPosted: "first_job_posted",
  FirstJobApplication: "first_job_application_sent",
  FirstHelperHired: "first_helper_hired",
  FirstJobAccepted: "first_job_accepted",
  FirstJobCompleted: "first_job_completed",
  FirstReviewLeft: "first_review_left",
  FirstFiveStarReview: "first_five_star_review",
  FirstPaymentCollected: "first_payment_collected",
  FirstPayoutReceived: "first_payout_received",
  // Engagement
  JobPosted: "job_posted",
  JobApplied: "job_applied",
  JobAccepted: "job_accepted",
  PaymentMade: "payment_made",
  PayoutSetupStarted: "payout_setup_started",
  PayoutSetupCompleted: "payout_setup_completed",
  ReviewLeft: "review_left",
  // Retention
  AppOpenedFromPush: "app_opened_from_push",
  AppOpenedFromDeepLink: "app_opened_from_deep_link",
  PushReceivedForeground: "push_received_foreground",
  // Friction
  ErrorShown: "error_shown",
  PermissionDenied: "permission_denied",
  AppCrashed: "app_crashed",
  // Forced /login bounce from ProtectedRoute when the profile fetch fails.
  // Pair with a Sentry rule on `tags.source: ProtectedRoute.profileFetchError`
  // so the next has_role-style regression pages within minutes instead of
  // taking hours to diagnose (see PR #355, PR #358).
  ForcedLogoutBounce: "forced_logout_bounce",
} as const;

type EventName = typeof AhaEvent[keyof typeof AhaEvent] | (string & {});

const queue: AnalyticsEventRow[] = [];
let flushTimer: number | null = null;

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    const supabase = await getSupabase();
    // Cast needed: local AnalyticsEventRow.properties is Record<string,unknown>;
    // Supabase insert expects Json. The shapes are compatible at runtime.
    await supabase.from("analytics_events").insert(batch as any[]);
  } catch {
    // Network failed — silently drop, don't recurse.
  }
}

function schedule() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 1500);
}

let cachedUserId: string | null = null;

function resolveUserId(): string | null {
  if (cachedUserId) return cachedUserId;
  try {
    // Supabase v2 stores under a key shaped like `sb-<project-ref>-auth-token`.
    const ks = Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    for (const k of ks) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
      if (id) {
        cachedUserId = id;
        return id;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Campaign parameters copied onto every event, when the current URL carries them.
 *
 * `url` stores `window.location.pathname` ONLY — the query string is dropped —
 * so before this, `analytics_events` could not answer "which post drove that
 * signup" even in principle. Not for want of tagging: the tag arrived, was
 * captured by PostHog, and was thrown away on our own side.
 *
 * This is an ALLOWLIST rather than `location.search`, deliberately. Capturing
 * the whole query string would mean every future param is logged by default,
 * including any that turns out to carry something private — and an analytics
 * table is the wrong place to find that out. Today `/reset-password` reads its
 * token from `location.hash`, which never reaches `search`; that is luck, not a
 * guarantee, and an allowlist does not depend on it staying true.
 */
const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
] as const;

/** The campaign params present on the current URL, or `{}`. Never throws. */
function campaignProps(): Record<string, string> {
  try {
    const q = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const key of CAMPAIGN_PARAMS) {
      const v = q.get(key);
      // Bounded: a hostile or malformed link should not push a large string
      // into every row of the events table.
      if (v) out[key] = v.slice(0, 200);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Track an event. Non-blocking — fires and forgets. Buffered for 1.5s
 * before flushing to cut request volume on the dashboard.
 */
export function track(event: EventName, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // Caller-supplied props win: an explicit value beats one scraped from the URL.
  const campaign = campaignProps();
  queue.push({
    event,
    user_id: resolveUserId(),
    properties: Object.keys(campaign).length ? { ...campaign, ...props } : props,
    url: window.location.pathname,
    referrer: document.referrer || null,
    platform: (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "web",
  });
  schedule();
  // Fan out to PostHog (lazy-loaded). No-op until initPostHog() runs.
  void fanOutToPostHog(event, props);
}

if (typeof window !== "undefined") {
  // Best-effort flush on page hide.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
