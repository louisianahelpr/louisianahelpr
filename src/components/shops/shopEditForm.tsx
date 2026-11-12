/**
 * Edit my shop's form model (split out of ShopEditView.tsx for componentSizeRatchet, train 1112-j): the form shape, the
 * default hours, field ids, the server refusal -> field map, client validation and the field error line (audit 11-10 F2).
 */
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";
import { WEEKDAYS } from "./shopsUi";

export interface Form {
  name: string;
  about: string;
  category: string;
  areaLabel: string;
  storefront: boolean;
  parishes: string[];
  offersSelling: boolean;
  offersQuotes: boolean;
  sosNumber: string;
  hours: Record<number, { open: boolean; opens: string; closes: string }>;
}

export const EMPTY_HOURS = (): Form["hours"] =>
  Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: false, opens: "09:00", closes: "17:00" }]));
/** A new shop starts open Monday to Friday, 9 to 5 (audit 11-10 F6); the owner changes what differs. */
const NEW_SHOP_HOURS = (): Form["hours"] =>
  Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: i >= 1 && i <= 5, opens: "09:00", closes: "17:00" }]));

/**
 * Audit 11-10 F2: a problem shows in red under its own field and the page scrolls to the first one, never as a toast
 * that stacks at the bottom over the button. The server's refusal is mapped to its field the same way.
 */
export type FieldKey = "name" | "category" | "about" | "area" | "offers" | "parishes" | "hours" | "sos";
export const FIELD_ORDER: FieldKey[] = ["name", "category", "about", "area", "offers", "parishes", "hours", "sos"];
const FIELD_ID: Record<FieldKey, string> = {
  name: "shop-name", category: "shop-category", about: "shop-about", area: "shop-area", offers: "shop-selling",
  parishes: "shop-parishes", hours: "shop-hours", sos: "shop-sos",
};
const FIELD_OF_CODE: Record<string, FieldKey> = {
  invalid_name: "name", invalid_category: "category", about_too_long: "about", invalid_area: "area",
  area_looks_like_address: "area", invalid_location: "area", offers_required: "offers", invalid_parishes: "parishes",
  invalid_hours: "hours", invalid_sos_number: "sos",
};
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** The field a server refusal is about (its code as a whole word in the message), or null for a form-wide problem. */
export function fieldOfError(err: unknown): FieldKey | null {
  const e = err as { message?: unknown; code?: unknown } | null;
  const msg = typeof e?.message === "string" ? e.message : "";
  // The contact-leak filter (check_violation) refuses a phone, email or link typed into the shop's words.
  if (e?.code === "23514" && /contact details/.test(msg)) return "about";
  for (const [code, field] of Object.entries(FIELD_OF_CODE)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(msg)) return field;
  }
  return null;
}

export function validate(form: Form): FieldErrors {
  const out: FieldErrors = {};
  const name = form.name.trim().length;
  if (name < 2 || name > 60) out.name = SHOPS_ERROR_COPY.invalid_name;
  if (!form.category) out.category = SHOPS_ERROR_COPY.invalid_category;
  if (form.about.length > 2000) out.about = SHOPS_ERROR_COPY.about_too_long;
  const area = form.areaLabel.trim().length;
  if (area < 2 || area > 80) out.area = SHOPS_ERROR_COPY.invalid_area;
  if (!form.offersSelling && !form.offersQuotes) out.offers = SHOPS_ERROR_COPY.offers_required;
  const sos = form.sosNumber.trim();
  if (sos && !/^[A-Za-z0-9-]{3,20}$/.test(sos)) out.sos = SHOPS_ERROR_COPY.invalid_sos_number;
  if (Object.values(form.hours).some((h) => h.open && !(h.opens && h.closes && h.opens < h.closes))) out.hours = SHOPS_ERROR_COPY.invalid_hours;
  return out;
}

export function FieldError({ field, errors }: { field: FieldKey; errors: FieldErrors }) {
  const msg = errors[field];
  if (!msg) return null;
  return <p id={`${FIELD_ID[field]}-error`} className="text-ds-13 text-destructive-ink" role="alert">{msg}</p>;
}
export const invalidProps = (field: FieldKey, errors: FieldErrors) =>
  errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${FIELD_ID[field]}-error` } : {};

export function focusField(field: FieldKey) {
  const el = document.getElementById(FIELD_ID[field]);
  if (!el) return;
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el.focus?.({ preventScroll: true });
}

export const EMPTY: Form = {
  name: "",
  about: "",
  category: "",
  areaLabel: "",
  storefront: false,
  parishes: [],
  offersSelling: true,
  offersQuotes: false,
  sosNumber: "",
  hours: NEW_SHOP_HOURS(),
};
