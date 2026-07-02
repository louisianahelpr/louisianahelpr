import type { Database } from "@/integrations/supabase/types";

export type EvacPet = Database["public"]["Tables"]["evacuation_pets"]["Row"] & {
  pet_profiles?: { name: string; species: string; breed: string | null } | null;
};
export type PetProfile = Database["public"]["Tables"]["pet_profiles"]["Row"];
