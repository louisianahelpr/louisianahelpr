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
  approval_status: string;
  accepted_terms_at: string;
  avatar_url?: string;
  id_document_url?: string;
}
