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
//   revision_acknowledged newest job_revisions row accepted AND requested by the
//                         poster (job_revisions RLS lets the Helpr write rows)
//   job_confirmed         the sender's own stamp: poster_confirmed_at /
//                         helper_dayof_confirmed_at
//   dispute_resolved      newest disputes row withdrawn, opened by the sender
//                         (rpc_withdraw_dispute: only the opener may close it)
//                         AND the escrow released (payment_status
//                         payout_pending / released), because the copy says so
//   revision_requested    a job_revisions row with a description
//   arrival_confirmed     jobs.poster_confirmed_arrival_at
//   work_confirmed        jobs.poster_confirmed_working_at
//   job_offer             the target's application is accepted
//   application_declined  the target's application is rejected
//   no_show_reported      a no_show user_violations row for (target, job)
//
// What this does NOT stop: the facts are durable state, so while they hold the
// same notice can be sent again (bounded by create-notification's rate limit).
// The notice is then still true, only repeated.
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
  /** The job's day (YYYY-MM-DD), for "You're both confirmed for <date>." (job_confirmed). */
  date_needed?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  payment_status?: string | null;
}

export interface TemplateFacts {
  job: TemplateJob;
  /** Which side of the job the CALLER is on. Decided by the edge function. */
  senderRole: "poster" | "helper";
  /** Newest job_revisions.description for the job (revision_requested). */
  revisionDescription?: string | null;
  /** Newest job_revisions.status for the job (revision_acknowledged). */
  revisionStatus?: string | null;
  /** Newest job_revisions.requested_by (revision_acknowledged). */
  revisionRequestedBy?: string | null;
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
  /** First word of the SENDER's profiles.full_name (audit 11-01 JA-57: notices name people, as the app does). */
  senderFirstName?: string | null;
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
type TemplateNeed = "revision" | "application" | "posterName" | "senderName" | "noShow" | "dispute" | "tracking";

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

/** "Sat, Nov 1" for a YYYY-MM-DD job day; "" when there is none or it does not parse. */
function bothConfirmedDay(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * "Sat 9 AM" / "Sat 9:30 AM" in Louisiana time, for a notice's "Next: ... by <when>" (owner 11-01: every Jobs
 * notice ends with the next step and its deadline). "" when there is no time.
 */
export function noticeWhen(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00 ", " ");
  return `${day} ${time}`;
}

/** The sender's first name, or the plain fallback for their side (JA-57: never "The person who posted this job"). */
function sender(f: TemplateFacts, fallback: string): string {
  return f.senderFirstName?.trim() || fallback;
}

/** The job page itself (JA-58: a notice opens the job, not the list). */
function jobPage(f: TemplateFacts): string {
  return `/jobs/${f.job.id}`;
}

function jobTitle(f: TemplateFacts): string {
  return f.job.title?.trim() || "your job";
}

/** jobs.payment_status after create-payment "release" (payout_pending, then released). */
const RELEASED = new Set(["payout_pending", "released"]);

/** jobs.dispute_status values that mean a dispute is still live. */
const ACTIVE_DISPUTE = new Set(["open", "helper_responded", "escalated", "under_review"]);

/** The newest dispute on the job is one the SENDER opened and then withdrew. */
function senderWithdrewDispute(f: TemplateFacts): boolean {
  return f.dispute?.status === "withdrawn" && !!f.senderId && f.dispute.opener_id === f.senderId;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  work_started: {
    sender: "helper",
    needs: ["tracking", "senderName"],
    build: (f) => f.job.status !== "in_progress" || f.trackingStatus !== "working" ? null : ({
      title: `${sender(f, "Your Helpr")} started work`,
      message: `${sender(f, "Your Helpr")} started work on "${jobTitle(f)}". Next: check it and confirm it's done once they mark it done.`,
      type: "info",
      link: jobPage(f),
    }),
  },
  dispute_withdrawn: {
    sender: "helper",
    needs: ["dispute", "senderName"],
    build: (f) => !senderWithdrewDispute(f) ? null : ({
      title: "Issue withdrawn",
      message: `${sender(f, "Your Helpr")} withdrew the issue on "${jobTitle(f)}". The payment is back on its normal schedule. Next: nothing for you to do.`,
      type: "info",
      link: jobPage(f),
    }),
  },
  dispute_response: {
    sender: "helper",
    needs: ["senderName"],
    build: (f) => {
      // jobs.dispute_status, not the disputes row: two live jobs (2026-09-26)
      // carry an active dispute_status with no disputes row at all.
      if (!ACTIVE_DISPUTE.has(f.job.dispute_status ?? "") || !f.job.dispute_helper_response?.trim()) return null;
      // Same rule as helperDisputeCopy.ts: escalated / under_review means an
      // admin owns the outcome, so the poster has nothing to decide.
      const awaitingAdmin = f.job.dispute_status === "escalated" || f.job.dispute_status === "under_review";
      const who = sender(f, "Your Helpr");
      return {
        title: `${who} answered the issue`,
        message: awaitingAdmin
          ? `${who} added their side of the issue on "${jobTitle(f)}". Next: Helpr support decides; nothing for you to do.`
          : `${who} answered the issue on "${jobTitle(f)}". Next: read it, then mark it resolved or ask Helpr support to step in.`,
        type: "info",
        link: jobPage(f),
      };
    },
  },
  revision_acknowledged: {
    sender: "helper",
    needs: ["revision", "senderName"],
    build: (f) =>
      f.revisionStatus !== "accepted" || !f.job.customer_id || f.revisionRequestedBy !== f.job.customer_id ? null : ({
      title: `${sender(f, "Your Helpr")} will fix it`,
      message: `${sender(f, "Your Helpr")} saw your fix request on "${jobTitle(f)}" and will fix it. Payment stays held until you confirm. Next: confirm it's done once it's fixed.`,
      type: "info",
      link: jobPage(f),
    }),
  },
  job_confirmed: {
    sender: "either",
    needs: ["senderName"],
    build: (f) => {
      const byPoster = f.senderRole === "poster";
      // The sender's OWN confirmation stamp, the one JobConfirmation writes.
      if (!(byPoster ? f.job.poster_confirmed_at : f.job.helper_dayof_confirmed_at)) return null;
      // Owner 10-31 (job 7b1da54b): the OTHER side had already confirmed, and was still told "Tap to confirm your
      // side too". When both stamps are set the notice only says so, with no ask.
      if (byPoster ? f.job.helper_dayof_confirmed_at : f.job.poster_confirmed_at) {
        const day = bothConfirmedDay(f.job.date_needed);
        return {
          title: "You're both confirmed",
          message: `You're both confirmed for "${jobTitle(f)}"${day ? ` on ${day}` : ""}.`,
          type: "info",
          link: jobPage(f),
        };
      }
      const who = sender(f, byPoster ? "The poster" : "Your Helpr");
      const day = bothConfirmedDay(f.job.date_needed);
      return {
        title: `${who} confirmed the job`,
        message: `${who} confirmed "${jobTitle(f)}". Next: confirm your side${day ? ` before ${day}` : ""}.`,
        type: "info",
        link: jobPage(f),
      };
    },
  },
  dispute_resolved: {
    sender: "poster",
    needs: ["dispute", "senderName"],
    // JA-60 (audit 11-01): no symbol in the title, and the copy says whose pay and where it goes. The state check
    // above (payout_pending / released) is what makes "is on its way" true; no date is promised because the
    // payout's arrival date is the bank's, not a fact this function holds.
    build: (f) => !senderWithdrewDispute(f) || !RELEASED.has(f.job.payment_status ?? "") ? null : ({
      title: "Issue resolved",
      message: `${sender(f, "The poster")} marked the issue on "${jobTitle(f)}" resolved, and your pay is on its way to your payout account. Next: nothing for you to do; track it in Money.`,
      type: "payment",
      link: jobPage(f),
    }),
  },
  revision_requested: {
    sender: "poster",
    needs: ["revision", "senderName"],
    build: (f) => {
      const d = f.revisionDescription?.trim();
      if (!d) return null;
      const who = sender(f, "The poster");
      return {
        title: `${who} asked for a fix`,
        message: `${who} asked for a small fix on "${jobTitle(f)}": "${d.slice(0, 80)}${d.length > 80 ? "…" : ""}". Next: fix it, then mark the job done again.`,
        type: "warning",
        link: jobPage(f),
      };
    },
  },
  arrival_confirmed: {
    sender: "poster",
    needs: ["senderName"],
    build: (f) => !f.job.poster_confirmed_arrival_at ? null : ({
      title: "Arrival confirmed",
      message: `${sender(f, "The poster")} confirmed you've arrived for "${jobTitle(f)}". Next: start the work, and mark it done when you finish.`,
      type: "success",
      link: jobPage(f),
    }),
  },
  work_confirmed: {
    sender: "poster",
    needs: ["senderName"],
    build: (f) => !f.job.poster_confirmed_working_at ? null : ({
      title: "Work confirmed",
      message: `${sender(f, "The poster")} confirmed you're working on "${jobTitle(f)}". Next: mark it done when you finish.`,
      type: "success",
      link: jobPage(f),
    }),
  },
  job_offer: {
    sender: "poster",
    needs: ["application", "senderName"],
    build: (f) => {
      // accept_application / accept_group_application set the target's
      // application to accepted before this is sent.
      if (f.application?.status !== "accepted") return null;
      // The deadline is the one the offer RPC stamped on the job, not a number
      // the caller typed.
      const deadline = f.job.response_deadline ? Date.parse(f.job.response_deadline) : NaN;
      const by = Number.isFinite(deadline) && deadline > f.now.getTime() ? noticeWhen(f.job.response_deadline) : "";
      const who = sender(f, "The poster");
      return {
        // The title stays "New job offer": sms_kind_for keys the offer text on it (20261030215251).
        title: "New job offer",
        message: `${who} picked you for "${jobTitle(f)}". Next: accept ${by ? `by ${by}` : "soon"}, or the offer expires.`,
        type: "new_offers",
        link: jobPage(f),
      };
    },
  },
  application_declined: {
    sender: "poster",
    needs: ["application", "posterName"],
    build: (f) => {
      if (f.application?.status !== "rejected") return null;
      const who = f.posterFirstName?.trim() || "The poster";
      const note = f.application.decline_reason?.trim();
      return {
        title: "Application declined",
        message: note
          ? `${who} declined your application for "${jobTitle(f)}": ${note.slice(0, 500)} Next: find another job in Find work.`
          : `${who} declined your application for "${jobTitle(f)}". Next: find another job in Find work.`,
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
