import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import type { ReportQueueFilter } from "@/components/admin/adminQueueKeys";
import { hydrateReportedListings, listingCanComeDown, listingSubject, LISTING_REPORT } from "@/components/admin/adminReports/reportedListings";
import { hydrateReportedWanted, wantedSubject, WANTED_REPORT } from "@/components/admin/adminReports/reportedWanted";
import { hydrateReportedQuestions, isQuestionReport, questionAuthor, questionSubject } from "@/components/admin/adminReports/reportedQuestions";
import type { Report } from "@/components/admin/adminReports/reportType";

// The moderation queue's read, moved out of AdminReports.tsx unchanged (Q806, componentSizeRatchet). The list AND
// its pill counts (useFilterCounts) and the admin rail's pending badge (adminRailBadges) all read this one function.

/** One status tab's reports, test accounts left out: the list AND its pill count (useFilterCounts) read this. */
export async function fetchReports(filter: ReportQueueFilter): Promise<Report[]> {
  // For the pending queue, oldest-first surfaces SLA-breaching items at
  // the top (they need triage soonest). For resolved/all, newest-first
  // matches the rest of admin views.
  const ascending = filter === "pending" || filter === "investigating";
  let query = supabase.from("reports")
    .select("*")
    .neq("reported_type", "support")
    .order("created_at", { ascending });
  if (filter === "pending") query = query.in("status", ["pending", "new"]);
  if (filter === "investigating") query = query.eq("status", "investigating");
  if (filter === "resolved") query = query.eq("status", "resolved");
  if (filter === "dismissed") query = query.eq("status", "dismissed");

  // Throw into React Query rather than returning a fallback: an empty
  // array here is indistinguishable from "the queue is clear".
  const reportRows = (unwrap(await query) || []) as Report[];
  // `reported_id` IS NOT ALWAYS A USER. For reported_type 'job' it holds a
  // JOB id, and looking that up in `profiles` can only ever miss — which
  // the fallback below then renders as "Deleted user". Measured in prod
  // 2026-09-05: all four job reports in the queue read "Deleted user",
  // including two whose job row is alive and titled, while the three user
  // reports beside them showed real names. An admin opening the moderation
  // queue could not tell WHAT had been reported, and the two states the
  // fallback exists to distinguish — gone vs. unreadable — were both wrong
  // for every job report.
  // Item B: a listing report holds a declutter_items id; its person is the seller (reportedListings.ts).
  const isUserSubject = (r: Report) => r.reported_type !== "job" && r.reported_type !== "application" && r.reported_type !== LISTING_REPORT && r.reported_type !== WANTED_REPORT && !isQuestionReport(r.reported_type);
  const { listings, failed: listingsFailed } = await hydrateReportedListings(reportRows);
  const [{ posts: wantedPosts, failed: wantedFailed }, { questions, failed: questionsFailed }] = await Promise.all([hydrateReportedWanted(reportRows), hydrateReportedQuestions(reportRows)]);
  // Q366: an 'application' report holds an APPLICATION id. The person is
  // its helper and the context is its job; both are read from the row.
  const appIds = [...new Set(reportRows.filter(r => r.reported_type === "application").map(r => r.reported_id))];
  const appHelper = new Map<string, string>();
  const appJob = new Map<string, string>();
  if (appIds.length > 0) {
    const { data: appRows, error: appsError } = await supabase
      .from("applications")
      .select("id, helper_id, job_id")
      .in("id", appIds);
    if (appsError) report(appsError, { severity: "warning", tags: { source: "AdminReports.hydrateApplications" } });
    for (const a of appRows || []) {
      if (a.helper_id) appHelper.set(a.id, a.helper_id);
      if (a.job_id) appJob.set(a.id, a.job_id);
    }
  }
  const subjectUserOf = (r: Report): string | null =>
    r.reported_type === "application" ? appHelper.get(r.reported_id) ?? null
      : r.reported_type === LISTING_REPORT ? listings.get(r.reported_id)?.seller_id ?? null
      : r.reported_type === WANTED_REPORT ? wantedPosts.get(r.reported_id)?.poster_id ?? null
      : isQuestionReport(r.reported_type) ? questionAuthor(r.reported_type, questions.get(r.reported_id))
      : isUserSubject(r) ? r.reported_id : null;
  const userIds = [
    ...new Set(reportRows.flatMap(r => [
      r.reporter_id,
      subjectUserOf(r),
      r.assigned_to,
    ].filter(Boolean) as string[])),
  ];
  // Hydrated separately because it is a different table, and kept OUT of
  // `nameMap` so `reported_exists` still means "is a messageable user" —
  // a job report has no person to message, and that button must stay off.
  const jobIds = [...new Set([
    ...reportRows.filter(r => r.reported_type === "job").map(r => r.reported_id),
    ...appJob.values(),
  ].filter(Boolean))];
  const jobTitles = new Map<string, string>();
  const seedIds = new Set<string>();
  if (jobIds.length > 0) {
    const { data: jobRows, error: jobsError } = await supabase
      .from("jobs")
      .select("id, title, is_seed")
      .in("id", jobIds);
    // Same rule as the profile read below: never drop the error, never let
    // a failed lookup blank the queue.
    if (jobsError) report(jobsError, { severity: "warning", tags: { source: "AdminReports.hydrateJobTitles" } });
    for (const j of jobRows || []) {
      jobTitles.set(j.id, j.title);
      if (j.is_seed) seedIds.add(j.id);
    }
  }
  if (userIds.length > 0) {
  // Secondary name-hydration read. Don't drop the error: on failure every
  // row silently renders the "Unknown"/fallback name, which looks like real
  // data rather than a failed lookup. Report it, then still render the list
  // — a missing display name must not blank the whole surface.
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, full_name, is_seed")
      .in("user_id", userIds);
  if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminReports.hydrateNames" } });
    const nameMap = new Map((profiles || []).map(p => [p.user_id, formatName(p.full_name, "Unknown")]));
    for (const p of profiles || []) if (p.is_seed) seedIds.add(p.user_id);

    // "Unknown" used to cover two very different situations, and an admin
    // could not tell them apart on the card:
    //
    //   the lookup FAILED  — the name exists, we just could not read it
    //   the user IS GONE   — there is no such row to read
    //
    // Only `assigned_to` has a foreign key (ON DELETE SET NULL);
    // `reporter_id` and `reported_id` have none, so a report survives the
    // deletion of the person it names and keeps pointing at a dead id.
    // Prod has one: report b9a558e0 names a `reported_id` that is absent
    // from BOTH `profiles` and `auth.users`.
    //
    // So: if the read errored, every miss is "unavailable" — we genuinely
    // do not know. If it succeeded, a miss means the row is not there.
    // Accepts null: `reporter_id` is nulled by purge_user_data() when the
    // reporter deletes their account, and a null owner is the same thing to
    // an admin as an id with no profile behind it — ADMIN_DELETED_ACCOUNT_LABEL.
    const nameFor = (id: string | null) =>
      (id ? nameMap.get(id) : undefined) ??
      (profilesError && id ? "Name unavailable" : ADMIN_DELETED_ACCOUNT_LABEL);

    // A job report names the JOB. Falling back to "Deleted job" keeps the
    // same two-state honesty as `nameFor`: the row is genuinely gone (a
    // cancelled job the admin can no longer read) rather than mislabelled
    // as a person who never existed.
    const subjectFor = (r: Report) => {
      if (r.reported_type === "application") {
        const helper = appHelper.get(r.reported_id);
        if (!helper) return "Deleted application";
        const title = jobTitles.get(appJob.get(r.reported_id) ?? "");
        return title ? `${nameFor(helper)} · application on "${title}"` : `${nameFor(helper)} · application`;
      }
      if (r.reported_type === LISTING_REPORT) return listingSubject(listings.get(r.reported_id), listingsFailed);
      if (r.reported_type === WANTED_REPORT) return wantedSubject(wantedPosts.get(r.reported_id), wantedFailed);
      if (isQuestionReport(r.reported_type)) return questionSubject(r.reported_type, questions.get(r.reported_id), questionsFailed);
      return isUserSubject(r) ? nameFor(r.reported_id) : (jobTitles.get(r.reported_id) ?? "Deleted job");
    };

    // Owner 2026-10-27: admin never shows a report a test account is part of.
    return reportRows.map(r => ({
      ...r,
      // A Wanted report with no reporter came from the automatic photo check, never from a deleted account.
      reporter_name: r.reported_type === WANTED_REPORT && !r.reporter_id ? "Automatic check" : nameFor(r.reporter_id),
      reported_wanted: r.reported_type === WANTED_REPORT ? wantedPosts.get(r.reported_id) : undefined,
      reported_question_gone: isQuestionReport(r.reported_type) && questions.get(r.reported_id)?.removed === true,
      reported_name: subjectFor(r),
      // Deleted actors cannot receive a message — the notification would
      // be written against a user_id with nothing behind it.
      reporter_exists: r.reporter_id !== null && nameMap.has(r.reporter_id),
      reported_exists: (() => { const u = subjectUserOf(r); return u !== null && nameMap.has(u); })(),
      subject_user_id: subjectUserOf(r),
      // A job subject that still exists is one the admin can open.
      reported_job_exists: r.reported_type === "job" && jobTitles.has(r.reported_id),
      reported_listing_down_ok: r.reported_type === LISTING_REPORT && listingCanComeDown(listings.get(r.reported_id)),
      assigned_to_name: r.assigned_to ? nameMap.get(r.assigned_to) : undefined,
      is_test: seedIds.has(r.reported_id)
        || (r.reported_type === LISTING_REPORT && listings.get(r.reported_id)?.is_seed === true)
        || (r.reported_type === WANTED_REPORT && wantedPosts.get(r.reported_id)?.is_seed === true)
        || (isQuestionReport(r.reported_type) && questions.get(r.reported_id)?.is_seed === true)
        || (r.reporter_id !== null && seedIds.has(r.reporter_id))
        || (r.reported_type === "application"
          && (seedIds.has(appHelper.get(r.reported_id) ?? "") || seedIds.has(appJob.get(r.reported_id) ?? ""))),
    })).filter(r => !r.is_test);
  }
  return reportRows;
}
