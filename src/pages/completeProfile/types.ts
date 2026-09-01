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
  date_of_birth: string;
  /**
   * `approval_status` is deliberately absent. `tr_prevent_self_escalation`
   * pins it back to OLD for every non-admin caller, so sending it from the
   * client is a no-op at best and (for an admin) a self-demotion. Approval is
   * an admin/server transition, never something this form asserts.
   */
  accepted_terms_at: string;
  avatar_url?: string;
  id_document_url?: string;
}
