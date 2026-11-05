import { splitName } from "@/lib/splitName";

/**
 * Edit Profile's fields, as loaded from the saved profile.
 *
 * Profile.tsx copies the saved profile into the form every time the cached
 * profile changes (its first load, and every refetch). It used to overwrite
 * every field, so a profile that arrived late, or was refetched while the
 * member typed, wiped what they had typed: e2e-journeys 41934715217
 * (journeys-webkit, 03-account profile on a dropping network) filled "About
 * you" and the late load put the saved bio back, so Save changes never came.
 * Now a field takes the loaded value only while it still shows the value
 * last loaded into it, which means the member has not edited it.
 * Guard: src/pages/profile/profileFieldHydration.test.tsx.
 */
export type HydratedFields = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  zipCode: string;
  parish: string | null;
  bio: string;
  skills: string;
  dateOfBirth: string;
};

type SavedProfile = {
  full_name?: string | null;
  phone?: string | null;
  location?: string | null;
  zip_code?: string | null;
  parish?: string | null;
  bio?: string | null;
  skills?: string | null;
  date_of_birth?: string | null;
};

/** The form's values before anything loads (Profile.tsx's useState initials). */
export const EMPTY_FIELDS: HydratedFields = {
  firstName: "", lastName: "", phone: "", location: "", zipCode: "", parish: null, bio: "", skills: "", dateOfBirth: "",
};

export function hydratedFieldsOf(p: SavedProfile): HydratedFields {
  const { firstName, lastName } = splitName(p.full_name ?? null);
  return {
    firstName,
    lastName,
    phone: p.phone || "",
    location: p.location || "",
    zipCode: p.zip_code || "",
    parish: p.parish || null,
    bio: p.bio || "",
    skills: p.skills || "",
    dateOfBirth: p.date_of_birth || "",
  };
}

/** A setState updater: the loaded value, unless the member has edited the field since the last load. */
export function unlessEdited<T>(lastLoaded: T, loaded: T): (current: T) => T {
  return (current) => (current === lastLoaded ? loaded : current);
}
