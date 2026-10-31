import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { safeStorage } from "@/lib/safeStorage";
import { signupLeadSource } from "@/lib/signupLead";

/**
 * OPS-5 (owner 10-29): which posts and links bring sign-ups and first posts, privacy-safe.
 *
 * 1. rememberFirstTouch: on the first page a visitor opens, keep WHERE they came from on this device: utm_source (or
 *    the outside site's host, or "direct", the same rule as signup_leads) and utm_campaign. Only those two short words,
 *    never the link, the query string or anything about the person. The first one wins for 30 days.
 * 2. useSignupSourceReport: once someone is signed in, send that pair once per account to record_my_signup_source
 *    (20261031220447). The server keeps it only for an account made in the last 2 days, so an old member opening a
 *    tagged link is never counted as a new sign-up. The admin report (admin_signup_source_report) counts sign-ups and
 *    first posts per source, real members only.
 *
 * Fire-and-forget: never throws, never blocks anything. A missing function (PGRST202, the web shipped before the
 * migration) is quiet and retried next time.
 */

const TOUCH_KEY = "lh_first_touch";
const SENT_KEY = "lh_signup_source_sent";
const TOUCH_DAYS = 30;

export interface FirstTouch {
  source: string;
  campaign: string | null;
  at: number;
}

function clean(word: string | null | undefined): string | null {
  // An @ (an email) or 7+ digits in a row (a phone number) may be someone's details: never kept.
  if (!word || word.includes("@") || /\d{7,}/.test(word)) return null;
  const w = word.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64);
  return w || null;
}

/** The kept first touch, or null when none or older than 30 days. */
export function readFirstTouch(now = Date.now()): FirstTouch | null {
  try {
    const raw = safeStorage.getItem(TOUCH_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as FirstTouch;
    if (typeof t?.source !== "string" || typeof t.at !== "number") return null;
    if (now - t.at > TOUCH_DAYS * 86_400_000) return null;
    return t;
  } catch {
    // A broken stored value is no touch at all; the next visit writes a fresh one.
    return null;
  }
}

/** Keep where this visit came from, unless a touch from the last 30 days is already kept. */
export function rememberFirstTouch(search: string, referrer: string, now = Date.now()): FirstTouch {
  const kept = readFirstTouch(now);
  if (kept) return kept;
  const q = new URLSearchParams(search);
  const rawTag = q.get("utm_source");
  const touch: FirstTouch = {
    // signupLeadSource strips an @ itself, so the raw tag is checked first.
    source: (rawTag && clean(rawTag) === null ? null : clean(signupLeadSource(search, referrer))) ?? "direct",
    campaign: clean(q.get("utm_campaign")),
    at: now,
  };
  safeStorage.setItem(TOUCH_KEY, JSON.stringify(touch));
  return touch;
}

/** Send the kept source for this account once. Resolves; never rejects. */
export async function reportSignupSource(userId: string): Promise<void> {
  if (safeStorage.getItem(SENT_KEY) === userId) return;
  const touch = readFirstTouch() ?? { source: "direct", campaign: null, at: Date.now() };
  try {
    const { error } = await supabase.rpc("record_my_signup_source", {
      p_source: touch.source,
      p_campaign: touch.campaign ?? undefined,
    });
    if (error) {
      if (error.code !== "PGRST202") report(error, { tags: { source: "signup-source" } });
      return;
    }
    safeStorage.setItem(SENT_KEY, userId);
  } catch (e) {
    report(e, { tags: { source: "signup-source" } });
  }
}

/** Mounted once in SessionManager: remembers the first touch at boot, then reports it when someone signs in. */
export function useSignupSourceReport(userId: string | undefined) {
  useEffect(() => {
    try {
      rememberFirstTouch(window.location.search, document.referrer);
    } catch (e) {
      report(e, { tags: { source: "signup-source" } });
    }
  }, []);
  useEffect(() => {
    if (userId) void reportSignupSource(userId);
  }, [userId]);
}
