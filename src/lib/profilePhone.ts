/**
 * The profile phone field's own check, the SAME rule as the database's
 * guard_profile_phone (20261009175007), which save_my_phone answers as
 * 'phone_invalid': an empty field is fine (it clears the phone); otherwise the
 * digits must be 10, or 11 with a leading 1 (the country code).
 *
 * Account audit 1102d row 14 (Q2654): "555" showed no message until a toast
 * after Save, and each refused try counted toward save_my_phone's limit.
 */
export const PHONE_FIELD_ERROR = "Enter a 10-digit phone number.";

/** The phone is a number the server will save (non-empty and 10 digits). */
export function profilePhoneComplete(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

/** The words to show under the field, or null when the server would accept it. */
export function profilePhoneError(phone: string): string | null {
  if (!phone.trim()) return null;
  return profilePhoneComplete(phone) ? null : PHONE_FIELD_ERROR;
}
