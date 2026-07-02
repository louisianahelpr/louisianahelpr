import type { PetInsert } from "./types";

export const SPECIES_OPTIONS = [
  { value: "dog", emoji: "🐕", label: "Dog" },
  { value: "cat", emoji: "🐈", label: "Cat" },
  { value: "bird", emoji: "🐦", label: "Bird" },
  { value: "rabbit", emoji: "🐇", label: "Rabbit" },
  { value: "reptile", emoji: "🦎", label: "Reptile" },
  { value: "other", emoji: "🐾", label: "Other" },
] as const;

export const speciesEmoji = (species: string) =>
  SPECIES_OPTIONS.find((s) => s.value === species)?.emoji ?? "🐾";

export const BLANK_FORM: Omit<PetInsert, "owner_id"> = {
  name: "",
  species: "dog",
  breed: "",
  age_years: null,
  weight_lbs: null,
  color_markings: "",
  microchip_id: "",
  vet_name: "",
  vet_phone: "",
  medical_notes: "",
  behavioral_notes: "",
  emergency_contact: "",
  feeding_schedule: "",
  photo_url: "",
  is_evacuation_registered: false,
};
