import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

/**
 * Where an admin notification about a job should land, per RECIPIENT.
 *
 * Two things were wrong at the three call sites below, and neither is visible
 * from the producer side:
 *
 * 1. THE SURFACE WAS THE OTHER PARTY'S. `/jobs` is the HELPER surface
 *    (`Activity defaultTab="applied"`, App.tsx:170); the poster's is
 *    `/posts` (App.tsx:171). Every notice addressed to
 *    `detailJob.customer_id` — the poster — linked to `/jobs`, a screen
 *    built from that user's *applications*, where their own posted job cannot
 *    appear at all. The helper's notices went to `/home` (Browse), which
 *    is not wrong so much as silent: it says nothing about the job that just
 *    changed under them.
 *
 * 2. THE BUCKET WAS THE WRONG ONE. Both Activity routes open on "Needs You"
 *    (`defaultStatusFilterFor`, activityConstants.ts). An admin-removed job is
 *    Cancelled and an override lands in Done/Cancelled/Needs You depending on
 *    the target status — essentially never Needs You. And no fixed `?filter=`
 *    can fix that from here: which bucket a job is in is a question about its
 *    LIVE state ("whose move is it?"), and the answer keeps changing while the
 *    notification sits unread.
 *
 * `?job=<id>` is the one shape that is always right and stays right — the
 * deep-link effect in src/components/job-card/JobListPage.tsx resolves the live bucket at open
 * time. It is what every other producer in the app was swept onto in
 * 20260831232514_notification_links_land_on_the_right_spot.sql; these two call
 * sites were the last ones still writing a bare surface.
 *
 * The CASE-on-the-recipient is the same fix that migration applied to
 * `block_user_and_settle` (entry 39), which had the identical defect: one
 * hard-coded surface for a notification that can be addressed to either party.
 */
export const activityLinkFor = (role: "poster" | "helper", jobId: string): string =>
  role === "poster" ? `/posts?job=${jobId}` : `/jobs?job=${jobId}`;

/**
 * Insert one admin notification, and refuse to let it fail silently.
 *
 * These inserts used to be a bare `await supabase.from("notifications")
 * .insert({...})` with the result thrown on the floor — the shape CLAUDE.md
 * forbids twice over: the `error` half was dropped, and a null `error` proves
 * nothing on its own. This notification is the ONLY signal the poster and the
 * helpr ever get that an admin removed or re-statused their job; a dropped
 * insert means the job changes under them with no explanation at all.
 *
 * Best-effort by design: the job write has already landed by the time we get
 * here, so a failed notify must not report the admin action as failed (same
 * rule as AdminUsers.unbanUser). It is *surfaced* instead — `unwrapMutation`
 * reports it to error_logs, and the admin gets a toast naming which party was
 * not told, so they can reach out by hand.
 */
export const notifyJobParty = async (
  row: { user_id: string; job_id: string; title: string; message: string; type: string; link: string },
  who: "the poster" | "the helpr",
  context: Record<string, unknown>,
): Promise<void> => {
  // Q157: a seed (test) job never notifies a REAL account. The notifications
  // BEFORE INSERT trigger (Q137, trg_notifications_seed_boundary) drops such a
  // row, and a dropped row comes back as zero rows, which unwrapMutation below
  // would report as "could not be notified" when the rule worked. So ask the
  // same question first, with the same arguments the trigger uses, and call a
  // TRUE answer what it is: a deliberate skip. A zero-row insert after a FALSE
  // answer is still a real rejection (RLS, stale id) and is still reported.
  // If the question itself cannot be answered, it is reported and the insert
  // goes ahead: the trigger still enforces the rule, never this client.
  try {
    const { data: crossesSeed, error: seedCheckError } = await supabase.rpc(
      "admin_notification_crosses_seed_boundary",
      { p_recipient: row.user_id, p_job_id: row.job_id, p_link: row.link },
    );
    if (seedCheckError) {
      report(seedCheckError, {
        severity: "warning",
        tags: { source: "AdminJobs.notifyJobParty.seedCheck" },
        context,
      });
    } else if (crossesSeed === true) {
      toast.message(
        `That change is saved. ${who === "the poster" ? "The poster" : "The Helpr"} was not notified: this is a test job and they are a real account, and test jobs never notify real people.`,
      );
      return;
    }
  } catch (err) {
    report(err, { severity: "warning", tags: { source: "AdminJobs.notifyJobParty.seedCheck" }, context });
  }

  try {
    // .select("id"): without it `data` comes back null and the row count is
    // unobservable, so unwrapMutation cannot tell a landed write from a no-op.
    unwrapMutation(await supabase.from("notifications").insert(row).select("id"), {
      action: `notify ${who}`,
      rejectedMessage: `That change is saved, but ${who} could not be notified.`,
      context,
    });
  } catch (err) {
    // WriteRejectedError is already reported by unwrapMutation; anything else
    // (transport, RLS, constraint) has not been, so report it here.
    if (!isWriteRejected(err)) {
      report(err, { severity: "error", tags: { source: "AdminJobs.notifyJobParty" }, context });
    }
    toast.error(
      mutationErrorMessage(
        err,
        `That change is saved, but ${who} couldn't be notified — tell them directly.`,
      ),
    );
  }
};
