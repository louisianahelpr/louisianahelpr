// ─── Types ───────────────────────────────────────────────────────────────────

export interface CareRelationship {
  id: string;
  caregiver_id: string;
  care_recipient_id: string;
  relationship: string;
  permissions: string[];
  status: string;
  invite_token: string | null;
  created_at: string;
}

export interface ProfileStub {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}
