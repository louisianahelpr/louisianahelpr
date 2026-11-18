import { safeStorage } from "@/lib/safeStorage";
import { WANTED_RADIUS_CHOICES, type WantedForm } from "@/lib/declutter/wanted";

export const EMPTY: WantedForm = { what: "", category: "", maxPrice: "", radius: 10 };

/**
 * Audit 10-30 #13: what was typed survives a reload, an app kill or leaving the page. Words, category, price and
 * distance only; chosen photos can't be kept and are picked again.
 */
const WANTED_DRAFT_KEY = "helpr_wanted_draft";


export function readWantedDraft(): WantedForm {
  try {
    const raw = safeStorage.getItem(WANTED_DRAFT_KEY);
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<WantedForm>;
    return {
      what: typeof d.what === "string" ? d.what : "",
      category: typeof d.category === "string" ? d.category : "",
      maxPrice: typeof d.maxPrice === "string" ? d.maxPrice : "",
      radius: WANTED_RADIUS_CHOICES.find((m) => m === d.radius) ?? EMPTY.radius,
    };
  } catch (err) {
    console.warn("[declutter] ignored an unreadable Wanted draft", err);
    return EMPTY;
  }
}

export function clearWantedDraft() {
  safeStorage.removeItem(WANTED_DRAFT_KEY);
}

export function saveWantedDraft(form: WantedForm) {
  if (form.what === "" && form.category === "" && form.maxPrice === "" && form.radius === EMPTY.radius) clearWantedDraft();
  else safeStorage.setItem(WANTED_DRAFT_KEY, JSON.stringify(form));
}
