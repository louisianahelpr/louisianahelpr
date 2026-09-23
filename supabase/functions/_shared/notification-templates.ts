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

/** The row facts a template may read. Loaded server-side by job id. */
export interface TemplateJob {
  id: string;
  title: string | null;
  customer_id: string | null;
  helper_id: string | null;
  response_deadline: string | null;
  dispute_status: string | null;
}

export interface TemplateFacts {
  job: TemplateJob;
  /** Which side of the job the CALLER is on. Decided by the edge function. */
  senderRole: "poster" | "helper";
  /** Newest job_revisions.description for the job (revision_requested). */
  revisionDescription?: string | null;
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
export type TemplateNeed = "revision" | "application" | "posterName" | "noShow";

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
   * Returns null when the database does not show the event happened (no
   * revision row, no no-show strike, no declined application). The caller
   * then refuses the send instead of announcing something untrue.
   */
  build(f: TemplateFacts): BuiltNotification | null;
}

function jobTitle(f: TemplateFacts): string {
  return f.job.title?.trim() || "your job";
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  work_started: {
    sender: "helper",
    build: (f) => ({
      title: "Work has started",
      message: `Your Helpr started working on "${jobTitle(f)}".`,
      type: "info",
      link: `/my-posts?job=${f.job.id}`,
    }),
  },
  dispute_withdrawn: {
    sender: "helper",
    build: (f) => ({
      title: "Dispute withdrawn",
      message: `The Helpr withdrew the dispute on "${jobTitle(f)}". The payment is off hold and back on its normal schedule.`,
      type: "info",
      link: `/my-posts?job=${f.job.id}`,
    }),
  },
  dispute_response: {
    sender: "helper",
    build: (f) => {
      // Same rule as helperDisputeCopy.ts: escalated / under_review means an
      // admin owns the outcome, so the poster has nothing to decide.
      const awaitingAdmin = f.job.dispute_status === "escalated" || f.job.dispute_status === "under_review";
      return {
        title: "Helpr responded to dispute",
        message: awaitingAdmin
          ? `The Helpr added their side of the dispute on "${jobTitle(f)}". An admin is reviewing it.`
          : `The Helpr has responded to the dispute on "${jobTitle(f)}". Please review and mark resolved or escalate.`,
        type: "info",
        link: `/my-posts?job=${f.job.id}`,
      };
    },
  },
  revision_acknowledged: {
    sender: "helper",
    build: (f) => ({
      title: "Helpr acknowledged the revision",
      message: "Your Helpr has seen your revision request and will fix it. Payment stays held until you confirm.",
      type: "info",
      link: `/my-posts?job=${f.job.id}`,
    }),
  },
  job_confirmed: {
    sender: "either",
    build: (f) => {
      const byPoster = f.senderRole === "poster";
      return {
        title: byPoster ? "The person who posted this job confirmed it!" : "Helpr confirmed the job!",
        message: `${byPoster ? "The person who posted this job" : "The Helpr"} confirmed they're committed to "${jobTitle(f)}". Tap to confirm your side too.`,
        type: "info",
        link: byPoster ? `/my-jobs?job=${f.job.id}` : `/my-posts?job=${f.job.id}`,
      };
    },
  },
  dispute_resolved: {
    sender: "poster",
    build: (f) => ({
      title: "Dispute resolved ✓",
      message: `The person who posted this job confirmed the issue on "${jobTitle(f)}" is resolved. Payment will be released.`,
      type: "payment",
      link: `/my-jobs?job=${f.job.id}`,
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
        link: `/my-jobs?job=${f.job.id}`,
      };
    },
  },
  arrival_confirmed: {
    sender: "poster",
    build: (f) => ({
      title: "✅ Arrival confirmed",
      message: `The person who posted this job confirmed you've arrived for "${jobTitle(f)}".`,
      type: "success",
      link: `/my-jobs?job=${f.job.id}`,
    }),
  },
  work_confirmed: {
    sender: "poster",
    build: (f) => ({
      title: "✅ Work confirmed",
      message: `The person who posted this job confirmed you're working on "${jobTitle(f)}".`,
      type: "success",
      link: `/my-jobs?job=${f.job.id}`,
    }),
  },
  job_offer: {
    sender: "poster",
    build: (f) => {
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
        link: `/my-jobs?job=${f.job.id}`,
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
        link: `/my-jobs?job=${f.job.id}`,
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
