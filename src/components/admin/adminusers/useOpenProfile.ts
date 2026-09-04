/**
 * useOpenProfile
 *
 * Returns an `openProfile` callback that fetches all supplemental data
 * for a profile detail dialog and populates the provided setters.
 * Extracted verbatim from AdminUsers.tsx — behaviour-preserving structural
 * refactor.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import type { Profile } from "../adminUserHelpers";

interface OpenProfileDeps {
  setViewProfile: (p: Profile | null) => void;
  setIdDocSignedUrl: (url: string | null) => void;
  setEmailTracking: (rows: { event_type: string; email_type: string; created_at: string }[]) => void;
  setEmailSendStats: (rows: { template_name: string; count: number; last_sent: string }[]) => void;
  setProfileJobs: (jobs: any[]) => void;
  setProfileReviews: (reviews: { rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[]) => void;
  setProfileReviewsLeft: (reviews: { rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[]) => void;
  setProfileViolations: (violations: any[]) => void;
  setProfileBans: (bans: any[]) => void;
}

export const makeOpenProfile = (deps: OpenProfileDeps) => {
  const {
    setViewProfile,
    setIdDocSignedUrl,
    setEmailTracking,
    setEmailSendStats,
    setProfileJobs,
    setProfileReviews,
    setProfileReviewsLeft,
    setProfileViolations,
    setProfileBans,
  } = deps;

  return async (profile: Profile) => {
    setViewProfile(profile);
    setIdDocSignedUrl(null);
    setEmailTracking([]);
    setEmailSendStats([]);
    setProfileJobs([]);

    const [reviewsRes, reviewsLeftRes, violationsRes, bansRes, trackingRes, sendLogRes, jobsRes] = await Promise.all([
      supabase.from("reviews").select("rating, feedback, reviewer_id, created_at, job_id").eq("reviewee_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("reviews").select("rating, feedback, reviewee_id, created_at, job_id").eq("reviewer_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("user_violations").select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("user_bans").select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("email_tracking").select("event_type, email_type, created_at").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      profile.email
        ? supabase.from("email_send_log")
            .select("template_name, message_id, status, created_at")
            .eq("recipient_email", profile.email)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabase
        .from("jobs")
        .select("id, title, status, payment_status, budget, helper_fee_percent, customer_fee_amount, platform_fee_amount, sales_tax_amount, customer_id, helper_id, created_at, updated_at, poster_completed_at, helper_completed_at, parish")
        .or(`customer_id.eq.${profile.user_id},helper_id.eq.${profile.user_id}`)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (jobsRes.error) console.error("[AdminUsers] openProfile jobs:", jobsRes.error);
    if (reviewsRes.error) console.error("[AdminUsers] openProfile reviews:", reviewsRes.error);
    if (reviewsLeftRes.error) console.error("[AdminUsers] openProfile reviewsLeft:", reviewsLeftRes.error);
    if (violationsRes.error) console.error("[AdminUsers] openProfile violations:", violationsRes.error);
    if (bansRes.error) console.error("[AdminUsers] openProfile bans:", bansRes.error);
    if (trackingRes.error) console.error("[AdminUsers] openProfile emailTracking:", trackingRes.error);
    if (sendLogRes.error) console.error("[AdminUsers] openProfile sendLog:", sendLogRes.error);
    setProfileJobs(jobsRes.data || []);

    // Generate signed URL for private ID document
    if (profile.id_document_url) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(profile.id_document_url, 3600); // 1 hour
      if (signedError) console.error("[AdminUsers] openProfile signedUrl:", signedError);
      if (signedData?.signedUrl) {
        setIdDocSignedUrl(signedData.signedUrl);
      }
    }

    // Build a single lookup of all related users + jobs from both review sets.
    //
    // `reviews.reviewer_id` is NULLABLE — it is ON DELETE SET NULL, so a
    // review whose AUTHOR has since deleted their account keeps the review
    // (it is the subject's reputation, not the author's) with a null author.
    // That null must not reach the `.in()` below: PostgREST sends
    // `in.(<uuid>,null)`, Postgres rejects `null` as a uuid literal, and the
    // whole request returns HTTP 400 `22P02`. The error is only logged, so
    // `relatedUsersRes.data` comes back null, `nameMap` ends up EMPTY, and
    // every reviewer on the panel renders as the "User" fallback — one
    // departed author silently anonymising every other name on an admin
    // trust-review surface, which reads as data rather than a failed lookup.
    //
    // `reviewee_id` is NOT NULL (ON DELETE CASCADE) so it needs no guard, but
    // it is filtered the same way rather than relying on that staying true.
    const relatedUserIds = new Set<string>();
    const relatedJobIds = new Set<string>();
    const addUser = (id: string | null | undefined) => { if (id) relatedUserIds.add(id); };
    (reviewsRes.data || []).forEach((r: any) => { addUser(r.reviewer_id); if (r.job_id) relatedJobIds.add(r.job_id); });
    (reviewsLeftRes.data || []).forEach((r: any) => { addUser(r.reviewee_id); if (r.job_id) relatedJobIds.add(r.job_id); });

    const [relatedUsersRes, relatedJobsRes] = await Promise.all([
      relatedUserIds.size > 0
        ? supabase.from("profiles").select("user_id, full_name").in("user_id", Array.from(relatedUserIds))
        : Promise.resolve({ data: [] as any[], error: null }),
      relatedJobIds.size > 0
        ? supabase.from("jobs").select("id, title").in("id", Array.from(relatedJobIds))
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (relatedUsersRes.error) console.error("[AdminUsers] openProfile relatedUsers:", relatedUsersRes.error);
    if (relatedJobsRes.error) console.error("[AdminUsers] openProfile relatedJobs:", relatedJobsRes.error);
    const nameMap = new Map((relatedUsersRes.data || []).map((p: any) => [p.user_id, formatName(p.full_name)]));
    const jobMap = new Map((relatedJobsRes.data || []).map((j: any) => [j.id, j.title]));

    setProfileReviews((reviewsRes.data || []).map((r: any) => ({
      rating: r.rating,
      feedback: r.feedback,
      reviewer_name: nameMap.get(r.reviewer_id) || "User",
      created_at: r.created_at,
      job_title: r.job_id ? jobMap.get(r.job_id) : undefined,
    })));
    setProfileReviewsLeft((reviewsLeftRes.data || []).map((r: any) => ({
      rating: r.rating,
      feedback: r.feedback,
      reviewee_name: nameMap.get(r.reviewee_id) || "User",
      created_at: r.created_at,
      job_title: r.job_id ? jobMap.get(r.job_id) : undefined,
    })));

    setProfileViolations(violationsRes.data || []);
    setProfileBans(bansRes.data || []);
    setEmailTracking(trackingRes.data || []);

    // Deduplicate email_send_log by message_id (latest status per email),
    // count successful sends per template_name.
    const rows = (sendLogRes.data || []) as { template_name: string; message_id: string | null; status: string; created_at: string }[];
    const latestByMsg = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const key = r.message_id || `${r.template_name}-${r.created_at}`;
      if (!latestByMsg.has(key)) latestByMsg.set(key, r); // first iteration is latest (ordered desc)
    }
    const counts = new Map<string, { count: number; last_sent: string }>();
    for (const r of latestByMsg.values()) {
      if (!["sent", "pending"].includes(r.status)) continue; // count delivered/queued only
      const existing = counts.get(r.template_name);
      if (existing) {
        existing.count += 1;
        if (r.created_at > existing.last_sent) existing.last_sent = r.created_at;
      } else {
        counts.set(r.template_name, { count: 1, last_sent: r.created_at });
      }
    }
    setEmailSendStats(
      Array.from(counts.entries())
        .map(([template_name, v]) => ({ template_name, count: v.count, last_sent: v.last_sent }))
        .sort((a, b) => b.count - a.count)
    );
  };
};
