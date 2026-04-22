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
import { supabase } from "@/integrations/supabase/client";

/**
 * Curated list of "aha moment" + funnel events. Adding the type up here
 * keeps event names consistent and makes them easy to grep.
 */
export const AhaEvent = {
  // Activation funnel
  SignupStarted: "signup_started",
  SignupCompleted: "signup_completed",
  EmailVerified: "email_verified",
  ProfileCompleted: "profile_completed",
  // Aha moments — moments where users "get it"
  FirstJobPosted: "first_job_posted",
  FirstJobApplication: "first_job_application_sent",
  FirstHelperHired: "first_helper_hired",
  FirstJobCompleted: "first_job_completed",
  FirstReviewLeft: "first_review_left",
  FirstPayoutReceived: "first_payout_received",
  // Engagement
  JobPosted: "job_posted",
  JobApplied: "job_applied",
  JobAccepted: "job_accepted",
  JobCompleted: "job_completed",
  PaymentMade: "payment_made",
  PayoutRequested: "payout_requested",
  ReviewLeft: "review_left",
  ReferralShared: "referral_shared",
  // Retention
  AppOpenedFromPush: "app_opened_from_push",
  AppOpenedFromDeepLink: "app_opened_from_deep_link",
  ReturnedAfter30Days: "returned_after_30_days",
  // Monetization
  ProUpgradeViewed: "pro_upgrade_viewed",
  ProUpgradeStarted: "pro_upgrade_started",
  ProUpgradeCompleted: "pro_upgrade_completed",
  // Friction
  ErrorShown: "error_shown",
  PermissionDenied: "permission_denied",
  AppCrashed: "app_crashed",
} as const;

export type EventName = typeof AhaEvent[keyof typeof AhaEvent] | (string & {});

const queue: any[] = [];
let flushTimer: number | null = null;

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await supabase.from("analytics_events" as any).insert(batch);
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
 * Track an event. Non-blocking — fires and forgets. Buffered for 1.5s
 * before flushing to cut request volume on the dashboard.
 */
export function track(event: EventName, props: Record<string, any> = {}) {
  if (typeof window === "undefined") return;
  queue.push({
    event,
    user_id: resolveUserId(),
    properties: props,
    url: window.location.pathname,
    referrer: document.referrer || null,
    platform: (window as any).Capacitor?.getPlatform?.() ?? "web",
  });
  schedule();
}

/** Flush immediately. Call before navigating away or closing the app. */
export function flushNow() {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return flush();
}

if (typeof window !== "undefined") {
  // Best-effort flush on page hide.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
