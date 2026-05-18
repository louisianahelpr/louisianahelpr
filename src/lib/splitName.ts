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
