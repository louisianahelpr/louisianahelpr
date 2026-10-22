// Q1803 (OWNER RULING 2026-10-21, COPPA): a member whose birthday makes them
// UNDER 13 is blocked and their account deleted at once, through the normal
// accountPurge path. Used by complete-signup (the birthday save) and by
// under-13-delete (called by the profiles trigger block_under_13_birthday,
// and every 5 minutes as the backstop).
//
// RETAINED: nothing beyond what accountPurge keeps for any deletion
// (retained_bans only for an account that was already banned). No birthday,
// no fingerprint and no under-13 flag survives the deletion.
//
// MONEY IN FLIGHT (lead, 2026-10-21): an account findActiveWork says cannot be
// deleted yet (escrow, a payout owed, an open Shops order...) stays LOCKED
// (under_13_blocked_at), has its personal profile fields blanked as far as is
// safe, and gets ONE admin alert ("under-13 account waiting on money: settle
// then delete"), stamped under_13_waiting_since so it is never repeated; the
// sweep then skips it quietly until the money clears.

import { closeUnpaidShopPages, findActiveWork, purgeAccount } from "./accountPurge.ts";
import { postSlackOpsAlert } from "./slack-alerts.ts";

/** The profile fields blanked while an under-13 account waits on money (nothing a payout or a refund reads). */
const UNDER_13_BLANKED_FIELDS = {
  date_of_birth: null,
  phone: null,
  bio: null,
  location: null,
  zip_code: null,
  latitude: null,
  longitude: null,
  avatar_url: null,
  portfolio_urls: null,
  business_name: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  extra_comments: null,
  tools_equipment: null,
  transportation: null,
  hear_about_us: null,
  skills: null,
} as const;

export type Under13Outcome =
  | { status: "deleted" }
  | { status: "waiting_on_money"; reason: string; firstTime: boolean }
  /** purge_user_data is not deployed yet (the deploy-lag window): a deferral, not a fault. */
  | { status: "deferred"; detail: string }
  | { status: "failed"; detail: string };

// The service-role client (accountPurge's PurgeCapableClient plus auth.admin).
// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * Delete an under-13 account now: close unpaid Shops pages, refuse while money
 * is in flight (lock + blank + one alert, see the file note), else
 * accountPurge then auth.admin.deleteUser. `alert` posts the ONE admin alert.
 */
export async function deleteUnder13Account(
  admin: Admin,
  userId: string,
  alert: (userId: string, reason: string) => Promise<void>,
): Promise<Under13Outcome> {
  const pages = await closeUnpaidShopPages(admin, userId);
  if (!pages.ok) return { status: "failed", detail: `closeUnpaidShopPages: ${pages.detail ?? "failed"}` };

  const active = await findActiveWork(admin, userId);
  if (!active.ok) return { status: "failed", detail: "findActiveWork could not read the account" };
  if (active.active) {
    const reason = String(active.reason ?? "active_work");
    const { data: row, error: readErr } = await admin
      .from("profiles")
      .select("under_13_waiting_since")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) return { status: "failed", detail: `waiting read: ${readErr.message}` };
    if (row?.under_13_waiting_since) return { status: "waiting_on_money", reason, firstTime: false };
    // First time: lock (already stamped), blank what is safe, stamp, alert once.
    const { error: blankErr } = await admin
      .from("profiles")
      .update({ ...UNDER_13_BLANKED_FIELDS, under_13_blocked_at: new Date().toISOString(), under_13_waiting_since: new Date().toISOString() })
      .eq("user_id", userId);
    if (blankErr) {
      // A field that will not take a blank must not stop the lock and the one alert.
      const { error: stampErr } = await admin
        .from("profiles")
        .update({ under_13_blocked_at: new Date().toISOString(), under_13_waiting_since: new Date().toISOString() })
        .eq("user_id", userId);
      if (stampErr) return { status: "failed", detail: `waiting stamp: ${stampErr.message}` };
      console.warn(`[under13] ${userId}: personal fields not blanked (${blankErr.message}); locked and stamped`);
    }
    await alert(userId, reason);
    return { status: "waiting_on_money", reason, firstTime: true };
  }

  const purge = await purgeAccount(admin, userId);
  if (!purge.ok) {
    return purge.reason === "rpc_not_deployed"
      ? { status: "deferred", detail: "purge_user_data not deployed" }
      : { status: "failed", detail: `purge: ${purge.reason ?? "incomplete"}` };
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return { status: "failed", detail: `deleteUser: ${deleteError.message}` };
  return { status: "deleted" };
}

/** The ONE admin alert for an under-13 account that cannot be deleted while money is in flight. */
export async function alertWaitingOnMoney(userId: string, reason: string): Promise<void> {
  await postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "Under-13 account waiting on money: settle then delete",
    message:
      `An account whose member gave a birthday under 13 (Q1803, COPPA) cannot be deleted yet: ${reason}. ` +
      "It is locked on the server (is_caller_banned) and its personal fields are blanked, so the member cannot release or confirm anything themselves: an ADMIN must settle the money (release, refund or cancel). The next under-13-delete run after that deletes the account.",
    fields: { user_id: userId, blocked_by: reason },
  });
}
