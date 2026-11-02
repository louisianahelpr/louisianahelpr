/**
 * Built-in sample data for the admin Messages preview (/admin/preview/messages, lead 11-02 for audit 1102d: "Messages
 * thread / blocked / reported (no test account has a conversation)").
 *
 * The page is drawn for the signed-in admin (the Messages page reads its viewer from the real session), so the sample
 * is built around their id: every other person, job and message is made up (fixed made-up UUIDs), and the preview's
 * backend (messagesPreviewBackend.ts) answers the page's reads from this, so it never reads or writes a real message.
 * Made-up ids also mean a real live update can never land in a preview thread (they match on job and person).
 */

export const MESSAGES_PREVIEW_STAGES = [
  { key: "inbox", label: "Inbox" },
  { key: "thread", label: "Thread" },
  { key: "reported", label: "Report sheet" },
  { key: "block_sheet", label: "Block sheet" },
  { key: "blocked", label: "After a block" },
  { key: "empty", label: "Empty inbox" },
] as const;

export type MessagesPreviewStage = (typeof MESSAGES_PREVIEW_STAGES)[number]["key"];
/** Which side of the job the admin is on in the sample: the person who posted it, or the Helpr. */
export type MessagesPreviewSide = "poster" | "helpr";

export function isMessagesPreviewStage(v: string | null | undefined): v is MessagesPreviewStage {
  return MESSAGES_PREVIEW_STAGES.some((s) => s.key === v);
}

const MP_ELI = "00000000-0000-4000-a000-000000000012";
const MP_MAYA = "00000000-0000-4000-a000-000000000013";
const MP_JOE = "00000000-0000-4000-a000-000000000014";
const MP_JOB_RAKE = "00000000-0000-4000-b000-000000000101";
const MP_JOB_MOVE = "00000000-0000-4000-b000-000000000102";
const MP_JOB_PAINT = "00000000-0000-4000-b000-000000000103";

type Read = unknown | ((body: Record<string, unknown>) => unknown);

export interface MessagesPreviewSample {
  stage: MessagesPreviewStage;
  side: MessagesPreviewSide;
  /** The thread the page opens on its own (its deep link: ?jobId=&userId=), or null for the inbox. */
  openThread: { jobId: string; userId: string } | null;
  /** A control the preview presses once the thread has drawn (the Report sheet stage), or null. */
  opens: string[] | null;
  /** Every read RPC the page makes, by name (one not here is answered null and reported, never sent). */
  reads: Record<string, Read>;
  /** Every table the page reads, by name (one not here is answered [] and reported, never sent). */
  tables: Record<string, unknown[]>;
}

const PEOPLE = [
  { id: MP_ELI, full_name: "Eli Robichaux", first: "Eli" },
  { id: MP_MAYA, full_name: "Maya Thibodeaux", first: "Maya" },
  { id: MP_JOE, full_name: "Joe Fontenot", first: "Joe" },
];

/** The sample for one stage and side, around the admin's own id. `now` is injectable so a test can pin the clock. */
export function messagesPreviewSample(stage: MessagesPreviewStage, side: MessagesPreviewSide, me: string, now: number = Date.now()): MessagesPreviewSample {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const poster = side === "poster";
  // The admin posted the jobs (side poster) or is the hired Helpr on jobs the others posted (side helpr).
  const job = (id: string, title: string, other: string, status: string) => ({
    id, title, status, customer_id: poster ? me : other, helper_id: poster ? other : me, helper_confirmed_at: ago(60 * 24),
    cancelled_by: null, cancellation_reason: null,
  });
  const jobs = [
    job(MP_JOB_RAKE, "Rake the front yard and bag the leaves", MP_ELI, "accepted"),
    job(MP_JOB_MOVE, "Move a couch and boxes upstairs", MP_MAYA, "in_progress"),
    job(MP_JOB_PAINT, "Paint the back fence", MP_JOE, "completed"),
  ];
  let n = 0;
  const msg = (jobId: string, from: string, to: string, content: string, minAgo: number, read = true) => ({
    id: `00000000-0000-4000-e000-${String(++n).padStart(12, "0")}`, job_id: jobId, sender_id: from, receiver_id: to, content,
    read, read_at: read ? ago(minAgo - 1) : null, created_at: ago(minAgo), edited_at: null, attachment_url: null, attachment_mime: null,
    attachment_size: null, attachment_duration: null, reply_to_id: null, is_system: false, flagged_hidden: false, team_thread_user_id: null,
  });
  // Audit 1102e: the thread said "Saturday morning" about a job on another day; it names only the time both agree on.
  const messages = stage === "empty" ? [] : [
    msg(MP_JOB_RAKE, poster ? MP_ELI : me, poster ? me : MP_ELI, "Hi! I can be there at 9 on the day. Are the bags in the shed?", 180),
    msg(MP_JOB_RAKE, poster ? me : MP_ELI, poster ? MP_ELI : me, "Yes, by the driveway. The gate code is on the job page.", 170),
    msg(MP_JOB_RAKE, poster ? MP_ELI : me, poster ? me : MP_ELI, "Great, see you at 9.", 20, false),
    msg(MP_JOB_MOVE, MP_MAYA, me, "I'm here, which door should I use?", 65, false),
    msg(MP_JOB_MOVE, me, MP_MAYA, "The side door, I'll open it now.", 60),
    msg(MP_JOB_PAINT, me, MP_JOE, "Thanks again, the fence looks great.", 60 * 26),
  ];
  const profiles = PEOPLE.map((p) => ({ id: p.id, user_id: p.id, full_name: p.full_name, avatar_url: null, created_at: "2025-06-02T15:00:00Z" }));
  // A block takes the thread out of the inbox (loadConversations hides a blocked person's rows), so "After a block" is
  // the inbox without Eli; the two sheets open over his thread.
  const openThread = stage === "thread" || stage === "reported" || stage === "block_sheet" ? { jobId: MP_JOB_RAKE, userId: MP_ELI } : null;
  return {
    stage, side, openThread,
    // The chat header's menu, then its Report or Block item: the sheet itself.
    opens: stage === "reported" ? ["Conversation options", "Report user"] : stage === "block_sheet" ? ["Conversation options", "Block user"] : null,
    reads: {
      get_safe_profiles: (body: Record<string, unknown>) => {
        const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
        return profiles.filter((p) => ids.includes(p.id));
      },
      get_user_last_active: (body: Record<string, unknown>) => {
        const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
        return ids.filter((id) => PEOPLE.some((p) => p.id === id)).map((id) => ({ user_id: id, last_active_at: ago(5) }));
      },
      are_users_blocked: stage === "blocked",
      get_public_profile_stats: (body: Record<string, unknown>) => {
        const ids = Array.isArray(body.p_user_ids) ? (body.p_user_ids as string[]) : [];
        return ids.filter((id) => PEOPLE.some((p) => p.id === id)).map((id) => ({
          user_id: id, avg_rating: 4.9, review_count: 11, completed_jobs_as_helper: 14, completed_jobs_total: 14, posted_jobs_total: 3,
          jobs_total: 17, cancelled_jobs: 0, cancellation_rate: 0, on_time_rate: 1, on_time_sample: 14, poster_avg_rating: 4.8,
          has_pending_credentials: false, has_stripe_account: true, is_background_checked: false, is_id_verified: true,
        }));
      },
      // The send gate: the admin may message the other person on the job (the Blocked stage's block still closes it).
      can_send_message_to_in_job: stage !== "blocked",
      get_off_job_thread_state: null,
      get_muted_threads: [],
      get_job_offer_targets: [],
      declutter_my_order_talks: [],
      get_message_thread_job_titles: (body: Record<string, unknown>) => {
        const ids = Array.isArray(body.p_job_ids) ? (body.p_job_ids as string[]) : [];
        return jobs.filter((j) => ids.includes(j.id)).map((j) => ({ job_id: j.id, title: j.title }));
      },
      // Every thread open to new messages (no close time yet).
      get_messaging_closes_at: (body: Record<string, unknown>) => {
        const ids = Array.isArray(body._job_ids) ? (body._job_ids as string[]) : [];
        return ids.map((id) => ({ job_id: id, closes_at: null, server_now: new Date(now).toISOString() }));
      },
    },
    tables: {
      messages,
      jobs,
      // The admin blocked Eli (the Blocked stage): his thread opens with the composer closed.
      user_blocks: stage === "blocked" ? [{ blocker_id: me, blocked_id: MP_ELI }] : [],
      notifications: [],
      applications: jobs.map((j) => ({ job_id: j.id, helper_id: j.helper_id, status: "accepted", closed_reason: null })),
      job_tracking: [],
      job_schedule_change_requests: [],
      message_reactions: [],
      thread_archives: [],
      thread_pins: [],
      tips: [],
      gift_cards: [],
      // The nav's Customize row (Q2199): none, so the nav keeps its default order and nothing is read from prod.
      member_section_prefs: [],
    },
  };
}
