import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type { PetFormValues } from "./petProfilesHelpers";

// Moved out of PetForm.tsx unchanged (Q806 god-component ratchet, pure move).

// Species-filtered breed suggestions for the datalist under the Breed field.
// Louisiana-common picks, not a taxonomy — free text remains the source of
// truth.
export const BREED_SUGGESTIONS: Record<string, string[]> = {
  dog: ["Lab mix", "Catahoula Leopard Dog", "Labrador Retriever", "Pit bull mix", "Golden Retriever", "German Shepherd", "Beagle", "Chihuahua", "Shih Tzu", "Mixed breed"],
  cat: ["Domestic Shorthair", "Domestic Longhair", "Orange Tabby", "Tabby", "Siamese", "Calico", "Maine Coon", "Tuxedo", "Mixed breed"],
  bird: ["Parakeet", "Cockatiel", "Conure", "Chicken", "Duck"],
  rabbit: ["Holland Lop", "Lionhead", "Rex", "Mixed breed"],
  reptile: ["Bearded Dragon", "Ball Python", "Red-Eared Slider", "Leopard Gecko"],
  other: [],
};

/** The pet_profiles row PetForm's Save writes. */
export function petProfilePayload(form: PetFormValues, ownerId: string) {
  return {
    owner_id: ownerId,
    name: form.name.trim(),
    species: form.species as string,
    breed: form.breed || null,
    age_years: form.age_years,
    weight_lbs: form.weight_lbs,
    color_markings: form.color_markings || null,
    microchip_id: form.microchip_id || null,
    vet_name: form.vet_name || null,
    vet_phone: form.vet_phone || null,
    medical_notes: form.medical_notes || null,
    behavioral_notes: form.behavioral_notes || null,
    emergency_contact: form.emergency_contact || null,
    feeding_schedule: form.feeding_schedule || null,
    updated_at: new Date().toISOString(),
  };
}

/** Update the pet when it has an id, insert it otherwise; throws on a refused write. */
export async function savePetProfile(payload: ReturnType<typeof petProfilePayload>, id: string | undefined) {
  if (id) {
    unwrap(
      await supabase
        .from("pet_profiles")
        .update(payload)
        .eq("id", id),
    );
  } else {
    unwrap(await supabase.from("pet_profiles").insert(payload));
  }
}

/** Inline field error — sienna, announced, and tied to its input via id. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="text-ds-11 mt-1 leading-snug"
      style={{ color: "hsl(var(--burnt-sienna))" }}
    >
      {children}
    </p>
  );
}
