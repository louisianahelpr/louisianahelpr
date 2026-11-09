/**
 * Splits a stored `full_name` into first/last name parts.
 *
 * The first whitespace-delimited word becomes `firstName`; everything after
 * it (joined by a single space) becomes `lastName`. Null, undefined, or
 * empty/whitespace-only input yields two empty strings.
 */
export function splitName(fullName: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * The stored `full_name` from the two name fields. When one field already holds the whole name, it is not said twice
 * (owner UI audit 11-09, F085: three accounts typed their full name into both boxes and were saved as "Annette Washum
 * Annette Washum", which the admins' new-member summary then repeated). The same rule as the data fix
 * (20261109184020): only the SAME name of two or more words in both boxes is said once; a one-word repeat ("Lee" +
 * "Lee") and near-repeats ("John Paul" + "Paul") are real names and are kept. Spaces are collapsed; case is kept.
 * Guard: src/test/fullNameNeverRepeats.test.ts.
 */
export function joinName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = (firstName || "").trim().split(/\s+/).filter(Boolean).join(" ");
  const last = (lastName || "").trim().split(/\s+/).filter(Boolean).join(" ");
  if (!first || !last) return first || last;
  if (first === last && first.includes(" ")) return first;
  return `${first} ${last}`;
}
