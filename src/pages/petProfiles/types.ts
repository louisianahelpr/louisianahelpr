import type { Database } from "@/integrations/supabase/types";

export type PetProfile = Database["public"]["Tables"]["pet_profiles"]["Row"];
export type PetInsert = Database["public"]["Tables"]["pet_profiles"]["Insert"];
