// Server-built copy for every notification a NON-ADMIN client may cause
// (Q223 / bus EF-003).
//
// `create-notification` used to insert whatever `title`, `message` and `type`
// the caller sent, gated only by "the two of you share a job, or one of you
// applied to the other's job". An applicant could therefore put a `payment` /
// `verified` / `financial_alerts` / `system_alert` notification, worded any way
// they liked, into the poster's bell AND a Helpr-branded email. The rate
// limiter (EF-02) capped the volume; nothing capped the words.
//
// Now a non-admin caller names a TEMPLATE and a job. Every word, the type and
// the link come from this file; the facts in the copy (the job title, the offer
// deadline, the revision text, the no-show rung) are read from the database by
// the edge function, never taken from the request. A template also names which
// side of the job may send it, so a mere applicant can send nothing at all.
//
// Admin callers keep free text (system announcements, ban notices); that path
// is decided in create-notification, not here.
//
// WHETHER, not only WHO (Q307). Being the right side of the job is not proof
// the event happened: the assigned Helpr could send "Dispute withdrawn" on a
// job with no dispute, and the poster "Dispute resolved ✓ … Payment will be
// released" (type payment) before resolving anything. Every template now reads
// the database state its own transition writes, and returns null (the edge
// function answers 409, nothing is inserted) when that state is not there:
//
//   work_started          job in_progress + the Helpr's job_tracking row = working
//   dispute_withdrawn     newest disputes row withdrawn, opened by the sender
//   dispute_response      jobs.dispute_status live + jobs.dispute_helper_response
//   revision_acknowledged newest job_revisions row accepted
//   job_confirmed         the sender's own stamp: poster_confirmed_at /
//                         helper_dayof_confirmed_at
//   dispute_resolved      newest disputes row withdrawn, opened by the sender
//                         (rpc_withdraw_dispute: only the opener may close it)
//   revision_requested    a job_revisions row with a description
//   arrival_confirmed     jobs.poster_confirmed_arrival_at
//   work_confirmed        jobs.poster_confirmed_working_at
//   job_offer             the target's application is accepted
//   application_declined  the target's application is rejected
//   no_show_reported      a no_show user_violations row for (target, job)
//
// src/test/edge/create-notification.test.ts holds one "state not reached →
// 409" case per template, keyed by this registry, both directions exact.

/** The row facts a template may read. Loaded server-side by job id. */
interface TemplateJob {
  id: string;
  title: string | null;
  customer_id: string | null;
  helper_id: string | null;
  response_deadline: string | null;
  dispute_status: string | null;
  status?: string | null;
  dispute_helper_response?: string | null;
  poster_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
}

export interface TemplateFacts {
  job: TemplateJob;
  /** Which side of the job the CALLER is on. Decided by the edge function. */
  senderRole: "poster" | "helper";
  /** Newest job_revisions.description for the job (revision_requested). */
  revisionDescription?: string | null;
  /** Newest job_revisions.status for the job (revision_acknowledged). */
  revisionStatus?: string | null;
  /** Newest disputes row for the job (dispute_* templates). */
  dispute?: { status: string | null; opener_id: string | null } | null;
  /** The assigned Helpr's job_tracking.status for the job (work_started). */
  trackingStatus?: string | null;
  /** The caller's user id (auth.uid()), for "the sender did it" checks. */
  senderId?: string | null;
  /** The target's application on the job (application_declined). */
  application?: { status: string | null; decline_reason: string | null } | null;
  /** First word of the poster's profiles.full_name (application_declined). */
  posterFirstName?: string | null;
  /** user_violations.action_taken of the no-show row for (target, job). */
  noShowAction?: string | null;
  now: Date;
}

export interface BuiltNotification {
  title: string;
  message: string;
  type: string;
  link: string | null;
}

/** Extra reads a template needs before it can be built. */
type TemplateNeed = "revision" | "application" | "posterName" | "noShow" | "dispute" | "tracking";

export interface NotificationTemplate {
  /**
   * Who may send it:
   *   poster — the caller is jobs.customer_id; the target is the assigned
   *            Helpr or an applicant on the job.
   *   helper — the caller is jobs.helper_id; the target is jobs.customer_id.
   *   either — whichever of those two the caller is.
   */
  sender: "poster" | "helper" | "either";
  needs?: TemplateNeed[];
  /**
   * Returns null when the database does not show the event happened (Q307:
   * EVERY template checks its own state, see the table at the top). The
   * caller then refuses the send instead of announcing something untrue.
   */
  build(f: TemplateFacts): BuiltNotification | null;
}

function jobTitle(f: TemplateFacts): string {
  return f.job.title?.trim() || "your job";
}

/** jobs.dispute_status values that mean a dispute is still live. */
const ACTIVE_DISPUTE = new Set(["open", "helper_responded", "escalated", "under_review"]);

/** The newest dispute on the job is one the SENDER opened and then withdrew. */
function senderWithdrewDispute(f: TemplateFacts): boolean {
  return f.dispute?.status === "withdrawn" && !!f.senderId && f.dispute.opener_id === f.senderId;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  work_started: {
    sender: "helper",
    needs: ["tracking"],
    build: (f) => f.job.status !== "in_progress" || f.trackingStatus !== "working" ? null : ({
      title: "Work has started",
      message: `Your Helpr started working on "${jobTitle(f)}".`,
      type: "info",
      link: `/posts?job=${f.job.id}`,
    }),
  },
  dispute_withdrawn: {
    sender: "helper",
    needs: ["dispute"],
    build: (f) => !senderWithdrewDispute(f) ? null : ({
      title: "Dispute withdrawn",
      message: `The Helpr withdrew the dispute on "${jobTitle(f)}". The payment is off hold and back on its normal schedule.`,
      type: "info",
      link: `/posts?job=${f.job.id}`,
    }),
  },
  dispute_response: {
    sender: "helper",
    build: (f) => {
      // jobs.dispute_status, not the disputes row: two live jobs (2026-09-26)
      // carry an active dispute_status with no disputes row at all.
      if (!ACTIVE_DISPUTE.has(f.job.dispute_status ?? "") || !f.job.dispute_helper_response?.trim()) return null;
      // Same rule as helperDisputeCopy.ts: escalated / under_review means an
      // admin owns the outcome, so the poster has nothing to decide.
      const awaitingAdmin = f.job.dispute_status === "escalated" || f.job.dispute_status === "under_review";
      return {
        title: "Helpr responded to dispute",
        message: awaitingAdmin
          ? `The Helpr added their side of the dispute on "${jobTitle(f)}". An admin is reviewing it.`
          : `The Helpr has responded to the dispute on "${jobTitle(f)}". Please review and mark resolved or escalate.`,
        type: "info",
        link: `/posts?job=${f.job.id}`,
      };
    },
  },
  revision_acknowledged: {
    sender: "helper",
    needs: ["revision"],
    build: (f) => f.revisionStatus !== "accepted" ? null : ({
      title: "Helpr acknowledged the revision",
      message: "Your Helpr has seen your revision request and will fix it. Payment stays held until you confirm.",
      type: "info",
      link: `/posts?job=${f.job.id}`,
    }),
  },
  job_confirmed: {
    sender: "either",
    build: (f) => {
      const byPoster = f.senderRole === "poster";
      // The sender's OWN confirmation stamp, the one JobConfirmation writes.
      if (!(byPoster ? f.job.poster_confirmed_at : f.job.helper_dayof_confirmed_at)) return null;
      return {
        title: byPoster ? "The person who posted this job confirmed it!" : "Helpr confirmed the job!",
        message: `${byPoster ? "The person who posted this job" : "The Helpr"} confirmed they're committed to "${jobTitle(f)}". Tap to confirm your side too.`,
        type: "info",
        link: byPoster ? `/jobs?job=${f.job.id}` : `/posts?job=${f.job.id}`,
      };
    },
  },
  dispute_resolved: {
    sender: "poster",
    needs: ["dispute"],
    build: (f) => !senderWithdrewDispute(f) ? null : ({
      title: "Dispute resolved ✓",
      message: `The person who posted this job confirmed the issue on "${jobTitle(f)}" is resolved. Payment will be released.`,
      type: "payment",
      link: `/jobs?job=${f.job.id}`,
    }),
  },
  revision_requested: {
    sender: "poster",
    needs: ["revision"],
    build: (f) => {
      const d = f.revisionDescription?.trim();
      if (!d) return null;
      return {
        title: "Revision requested",
        message: `The person who posted this job wants a small fix on "${d.slice(0, 80)}${d.length > 80 ? "…" : ""}". Tap to see details.`,
        type: "warning",
        link: `/jobs?job=${f.job.id}`,
      };
    },
  },
  arrival_confirmed: {
    sender: "poster",
    build: (f) => !f.job.poster_confirmed_arrival_at ? null : ({
      title: "✅ Arrival confirmed",
      message: `The person who posted this job confirmed you've arrived for "${jobTitle(f)}".`,
      type: "success",
      link: `/jobs?job=${f.job.id}`,
    }),
  },
  work_confirmed: {
    sender: "poster",
    build: (f) => !f.job.poster_confirmed_working_at ? null : ({
      title: "✅ Work confirmed",
      message: `The person who posted this job confirmed you're working on "${jobTitle(f)}".`,
      type: "success",
      link: `/jobs?job=${f.job.id}`,
    }),
  },
  job_offer: {
    sender: "poster",
    needs: ["application"],
    build: (f) => {
      // accept_application / accept_group_application set the target's
      // application to accepted before this is sent.
      if (f.application?.status !== "accepted") return null;
      // The deadline is the one the offer RPC stamped on the job, not a number
      // the caller typed.
      const deadline = f.job.response_deadline ? Date.parse(f.job.response_deadline) : NaN;
      const hours = Number.isFinite(deadline) ? Math.ceil((deadline - f.now.getTime()) / 3_600_000) : NaN;
      const respond = Number.isFinite(hours) && hours >= 1
        ? `Respond within ${hours} hour${hours > 1 ? "s" : ""} or the offer expires.`
        : "Respond soon or the offer expires.";
      return {
        title: "📋 New job offer!",
        message: `You've been selected for "${jobTitle(f)}". ${respond}`,
        type: "info",
        link: `/jobs?job=${f.job.id}`,
      };
    },
  },
  application_declined: {
    sender: "poster",
    needs: ["application", "posterName"],
    build: (f) => {
      if (f.application?.status !== "rejected") return null;
      const who = f.posterFirstName?.trim() || "The person who posted this job";
      const note = f.application.decline_reason?.trim();
      return {
        title: "Application declined",
        message: note
          ? `${who} declined your application for "${jobTitle(f)}": ${note.slice(0, 500)}`
          : `${who} declined your application for "${jobTitle(f)}".`,
        type: "info",
        link: `/jobs?job=${f.job.id}`,
      };
    },
  },
  no_show_reported: {
    sender: "poster",
    needs: ["noShow"],
    build: (f) => {
      // The rung is the one report_helper_no_show recorded, never the
      // caller's claim — a poster must not be able to tell a Helpr they are
      // banned.
      const a = f.noShowAction;
      if (!a) return null;
      const legacyBanned = a === "permanent_ban";
      const restricted = a === "pending_ban_review";
      return {
        title: legacyBanned ? "⛔ Account banned for no-show" : restricted ? "⛔ Account restricted for 7 days" : "⚠️ No-show warning",
        message: legacyBanned
          ? "Your account has been permanently banned for repeated no-shows."
          : restricted
            ? "A second no-show was reported against you. Your account is restricted for 7 days while an admin reviews it. If you think this is wrong, email admin@louisianahelpr.com."
            : `You received a no-show warning for "${jobTitle(f)}".`,
        type: "warning",
        link: "/profile?tab=warnings",
      };
    },
  },
};

/** The one template a non-admin may send to THEMSELVES (Settings → Send a Test). */
export function buildSelfTestNotification(now: Date): BuiltNotification {
  return {
    title: "Test from Helpr",
    message: `If you got this, notifications are working. ${now.toISOString().slice(11, 19)} UTC`,
    type: "info",
    link: null,
  };
}

export const SELF_TEST_TEMPLATE = "test";
