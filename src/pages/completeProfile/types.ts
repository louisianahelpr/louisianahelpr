/**
 * Shape of the single lightweight profile-completion DB update written on
 * submit. Avatar / ID URLs are optional because they're only set when a file
 * was actually uploaded this session (an existing avatar_url on the row is
 * left untouched by omitting the key).
 */
export interface ProfileCompletionUpdates {
  full_name: string;
  phone: string;
  bio: string;
  location: string;
  /** Optional — unlocks parish-based helper notifications + LA sales tax. */
  zip_code?: string;
  parish?: string | null;
  date_of_birth: string;
  /**
   * `approval_status` is deliberately absent. `tr_prevent_self_escalation`
   * pins it back to OLD for every non-admin caller, so sending it from the
   * client is a no-op at best and (for an admin) a self-demotion. Approval is
   * an admin/server transition, never something this form asserts.
   */
  /**
   * FIRST-EVER acceptance of the Terms / Privacy / Platform Rules. The client
   * always sends `now()`; `tr_preserve_first_consent` (migration
   * 20260901035252) pins it back to its existing value when one is already
   * recorded, so a re-submit can never destroy the original consent. Sending
   * it unconditionally is deliberate — a read-then-write here would be a race,
   * and the database is the right place to own "first wins".
   */
  accepted_terms_at: string;
  /**
   * When the user accepted the version named in `terms_version_accepted`.
   * Written alongside the above so this screen records consent in the SAME
   * shape as the signup path (`complete-signup`) rather than into a private
   * column of its own — the drift that left 12/30 prod profiles with an
   * `accepted_terms_at` and 22/30 without a `terms_accepted_at`.
   */
  terms_accepted_at: string;
  terms_version_accepted: string;
  avatar_url?: string;
  id_document_url?: string;
}
