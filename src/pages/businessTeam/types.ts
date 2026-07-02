// Shared types for the BusinessTeam workspace, extracted from
// BusinessTeam.tsx (behavior-preserving split).

import type { ExtendedRole } from "@/hooks/useMyBusiness";

export interface Member {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  role: "owner" | "member";
  extended_role: ExtendedRole;
  status: "pending" | "active" | "removed";
  invited_at: string;
  joined_at: string | null;
  full_name?: string;
  email?: string;
}

export type TabValue = "members" | "approvals" | "spend" | "activity" | "settings";
