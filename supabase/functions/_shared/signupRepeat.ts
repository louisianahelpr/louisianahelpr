/**
 * Q2089: a complete-signup call that ran twice for the same account.
 *
 * Signup.tsx sends complete-signup a second time when the first send came back
 * as a FunctionsFetchError (Q1810, src/pages/auth/signup/retrySignupCompletion.ts).
 * That error also covers a request that LANDED and only lost its answer, so the
 * second send can be a repeat of a finished completion. With no session the
 * repeat is refused (Q1887: terms_accepted_at is set). With a session it runs
 * the whole function again, and two of its writes are not repeat-safe:
 *   - legal_acceptances: a second identical consent row for the same moment;
 *   - record_referral_signup: answers FALSE ("already referred"), so the client
 *     tracks referral_recorded false for a referral the first run recorded.
 *
 * Both reads below fail open in the direction that keeps the record: a read
 * that errors is treated as "not there yet", so the consent row is still
 * written (a duplicate beats a missing consent record) and the referral answer
 * stays as the RPC gave it.
 */

import { caughtMessage } from "./caughtMessage.ts";

/** A consent row this recent, for the same user and the same versions, is the same completion. */
export const CONSENT_REPEAT_WINDOW_MS = 30 * 60 * 1000;

type ReadResult = { data: unknown; error: { message?: string } | null };

/**
 * The slice of the Supabase client these reads use. Kept to one shallow
 * signature: matching the full client type against a nested interface is
 * "excessively deep" for the edge type check (TS2589).
 */
export interface RepeatReadClient {
  from(table: string): unknown;
}

type From = { select(columns: string): Chain };

type Chain = {
  eq(column: string, value: string): Chain;
  gte(column: string, value: string): Chain;
  limit(n: number): PromiseLike<ReadResult>;
};

function rows(result: ReadResult): number {
  return Array.isArray(result.data) ? result.data.length : 0;
}

/**
 * True when this user already has a consent row for these exact versions,
 * written inside the last CONSENT_REPEAT_WINDOW_MS: the completion being
 * repeated wrote it.
 */
export async function consentAlreadyRecorded(
  client: RepeatReadClient,
  userId: string,
  termsVersion: string,
  privacyVersion: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const since = new Date(now - CONSENT_REPEAT_WINDOW_MS).toISOString();
    const chain = (client.from("legal_acceptances") as From).select("id").eq("user_id", userId);
    const result = await chain
      .eq("terms_version", termsVersion)
      .eq("privacy_version", privacyVersion)
      .gte("created_at", since)
      .limit(1);
    if (result.error) {
      console.error(`[complete-signup] consent repeat check failed for ${userId}:`, result.error.message ?? result.error);
      return false;
    }
    return rows(result) > 0;
  } catch (err) {
    console.error(`[complete-signup] consent repeat check threw for ${userId}:`, caughtMessage(err));
    return false;
  }
}

/**
 * True when a referrals row already names this user as the one referred.
 * complete-signup is the only writer for a new account (record_referral_signup),
 * and referred_id is UNIQUE, so a row means an earlier run of this completion
 * recorded the referral.
 */
export async function referralAlreadyRecorded(client: RepeatReadClient, userId: string): Promise<boolean> {
  try {
    const chain = (client.from("referrals") as From).select("id").eq("referred_id", userId);
    const result = await chain.limit(1);
    if (result.error) {
      console.error(`[complete-signup] referral repeat check failed for ${userId}:`, result.error.message ?? result.error);
      return false;
    }
    return rows(result) !== 0;
  } catch (err) {
    console.error(`[complete-signup] referral repeat check threw for ${userId}:`, caughtMessage(err));
    return false;
  }
}
