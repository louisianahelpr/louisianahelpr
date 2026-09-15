import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type { PetProfile } from "./types";

/**
 * THE ONE READ OF "MY PETS", shared by the pets page (/profile?tab=pets) and
 * Post a Job's "Which Pet Is This For?" picker.
 *
 * VN-53 (owner, 2026-09-14): the picker did not show pets saved on the pets
 * page. It had its own cache key (`pet_profiles_for_post`, 5-minute
 * staleTime) that the pets page never invalidated, so a picker that loaded
 * empty kept showing nothing after the poster added a dog; and it read
 * `pet_profiles` with no owner filter, leaning entirely on RLS. Same key,
 * same query, same row shape now — so the pets page's invalidation on
 * save/delete refreshes the picker too, and a shared cache entry can never
 * hold a partial row one screen selected for the other.
 */
export const petProfilesQueryKey = (userId: string | null | undefined) =>
  ["pet_profiles", userId ?? null] as const;

export async function fetchPetProfiles(userId: string): Promise<PetProfile[]> {
  return unwrap(
    await supabase
      .from("pet_profiles")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true }),
  ) as PetProfile[];
}
