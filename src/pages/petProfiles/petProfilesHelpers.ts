import type { PetInsert, PetProfile } from "./types";

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

/** The shape PetForm edits — every pet column except the owner FK. */
export type PetFormValues = Omit<PetInsert, "owner_id">;

// `pet_profiles.photo_url` exists in the DB but is deliberately NOT part of
// this form: nothing sets it (there is no photo picker) and nothing reads it
// — PetCard, PetRailRow and PetDetail all render `speciesEmoji()`. Carrying
// it here meant every save wrote a value no screen could ever show. Omitting
// it from the payload also leaves any pre-existing column value untouched on
// update, so removing it loses nothing. Add it back alongside a real photo
// picker + a consumer that displays it, not before.
const BLANK_FORM: PetFormValues = {
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
  is_evacuation_registered: false,
};

/** Form values a pet sheet opens with — blank for "add", the pet for "edit". */
export function buildPetForm(initialValues?: PetProfile | null): PetFormValues {
  if (!initialValues) return { ...BLANK_FORM };
  return {
    ...BLANK_FORM,
    name: initialValues.name,
    species: initialValues.species,
    breed: initialValues.breed ?? "",
    age_years: initialValues.age_years,
    weight_lbs: initialValues.weight_lbs,
    color_markings: initialValues.color_markings ?? "",
    microchip_id: initialValues.microchip_id ?? "",
    vet_name: initialValues.vet_name ?? "",
    vet_phone: initialValues.vet_phone ?? "",
    medical_notes: initialValues.medical_notes ?? "",
    behavioral_notes: initialValues.behavioral_notes ?? "",
    emergency_contact: initialValues.emergency_contact ?? "",
    feeding_schedule: initialValues.feeding_schedule ?? "",
    is_evacuation_registered: initialValues.is_evacuation_registered,
  };
}

/**
 * Has the user actually typed something? Drives the unsaved-changes guard, so
 * it must never report "clean" for a form the user filled in. Null and "" are
 * treated as the same empty value — `buildPetForm` normalises DB nulls to ""
 * for text fields, and clearing a field returns it to that same baseline.
 */
export function isPetFormDirty(
  current: PetFormValues,
  initial: PetFormValues,
): boolean {
  return (Object.keys(initial) as Array<keyof PetFormValues>).some(
    (key) => (current[key] ?? "") !== (initial[key] ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Validation
//
// The age/weight inputs advertise min/max, but they live outside a <form>, so
// browser constraint validation never fires — these bounds are the ones
// actually enforced. Keep them in sync with the `min`/`max` on the inputs.
// ---------------------------------------------------------------------------

/** Oldest age accepted (matches the age input's `max`). 30 rejected real pets —
 *  parrots and tortoises routinely outlive it, and a boarded horse would too.
 *  100 still catches an order-of-magnitude typo without calling a customer's
 *  animal impossible. */
export const PET_AGE_MAX = 100;
/** Heaviest weight accepted — catches order-of-magnitude typos (450 for 45)
 *  while still clearing any realistic household pet. */
export const PET_WEIGHT_MAX = 500;

export interface PetFormErrors {
  age_years?: string;
  weight_lbs?: string;
  vet_phone?: string;
  microchip_id?: string;
}

/**
 * Field-level validation for everything except `name` (required-ness is
 * handled by the caller so a pristine "Add a pet" sheet doesn't open shouting
 * at the user). Returns only the fields that are wrong — an empty object means
 * the form is safe to save.
 */
export function validatePetForm(form: PetFormValues): PetFormErrors {
  const errors: PetFormErrors = {};

  const age = form.age_years;
  if (age != null) {
    if (!Number.isFinite(age)) {
      errors.age_years = "Enter age as a number, like 3.";
    } else if (age < 0) {
      errors.age_years = "Age can't be negative.";
    } else if (age > PET_AGE_MAX) {
      errors.age_years = `Age can't be more than ${PET_AGE_MAX} years.`;
    }
  }

  const weight = form.weight_lbs;
  if (weight != null) {
    if (!Number.isFinite(weight)) {
      errors.weight_lbs = "Enter weight as a number, like 45.";
    } else if (weight <= 0) {
      errors.weight_lbs = "Weight must be more than 0 lbs.";
    } else if (weight > PET_WEIGHT_MAX) {
      errors.weight_lbs = `Weight can't be more than ${PET_WEIGHT_MAX} lbs.`;
    }
  }

  // Vet phone is what a Helpr dials in an emergency, so a half-typed number is
  // worse than none. Deliberately lenient about punctuation — only the digit
  // count has to make sense (10, or 11 with a leading US country code).
  const phone = (form.vet_phone ?? "").trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    const plausible =
      digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
    if (!plausible) {
      errors.vet_phone = "Enter a 10-digit phone number, like (504) 555-0100.";
    }
  }

  // Microchip numbers are 15 digits (ISO), or 9–10 characters on older AVID /
  // Trovan chips. Spaces and dashes are ignored so a pasted "985 112 345…"
  // still saves.
  const chip = (form.microchip_id ?? "").trim();
  if (chip) {
    const compact = chip.replace(/[\s-]/g, "");
    if (!/^[A-Za-z0-9]{9,15}$/.test(compact)) {
      errors.microchip_id =
        "Microchip IDs are 9–15 letters or numbers (most are 15 digits).";
    }
  }

  return errors;
}
