import { supabase } from "@/integrations/supabase/client";
import type { CareRelationship, ProfileStub } from "./types";

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function fetchCareRelationships(userId: string): Promise<{
  asCaregiver: CareRelationship[];
  asRecipient: CareRelationship[];
}> {
  const [cgRes, crRes] = await Promise.all([
    supabase
      .from("care_relationships")
      .select("*")
      .eq("caregiver_id", userId)
      .neq("status", "revoked"),
    supabase
      .from("care_relationships")
      .select("*")
      .eq("care_recipient_id", userId)
      .neq("status", "revoked"),
  ]);
  // CLAUDE.md: never drop the Supabase error
  if (cgRes.error) throw cgRes.error;
  if (crRes.error) throw crRes.error;
  return {
    asCaregiver: (cgRes.data ?? []) as CareRelationship[],
    asRecipient: (crRes.data ?? []) as CareRelationship[],
  };
}

export async function fetchProfileStubs(userIds: string[]): Promise<ProfileStub[]> {
  if (!userIds.length) return [];
  const res = await supabase
    .from("profiles")
    .select("user_id, full_name, avatar_url")
    .in("user_id", userIds);
  if (res.error) throw res.error;
  return (res.data ?? []) as ProfileStub[];
}
