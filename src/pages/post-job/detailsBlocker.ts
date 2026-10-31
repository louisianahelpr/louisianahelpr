import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { contactLeakFieldError } from "@/lib/contactLeakField";

/**
 * The first thing keeping the Details section from COMPLETE, as the submit
 * button's label, or null when the section is complete.
 *
 * One function answers both "is Details done?" (useJobDerived) and "what does
 * the button say?" (FormStep). They used to be two lists: detailsComplete had
 * seven conditions, the label named three and called everything else
 * "Replace the [Placeholders]". A reposted 33-char title (cap 32) left the
 * button disabled and asking for placeholders the description did not have
 * (Q353, measured on prod 2026-09-24).
 */
/** The one blocker the details step's Continue still lets the poster press (POST-H15): pressing it says so in red and
 *  focuses the first placeholder, instead of a greyed button. */
export const PLACEHOLDER_BLOCK = "Replace the [placeholders] to continue";

export function detailsBlocker(f: { title: string; description: string; category: string | null | undefined }): string | null {
  if (!f.title.trim()) return "Add a title to continue";
  if (f.title.length > TITLE_MAX) return "Shorten the title to continue";
  if (!f.description.trim()) return "Add a description to continue";
  // The DB refuses a description over 1000 (jobs_description_length, Q782);
  // a prefill (Repost, AI builder, draft) can carry one past the textarea's
  // maxLength, so name it here instead of failing at checkout.
  if (f.description.length > DESCRIPTION_MAX) return "Shorten the description to continue";
  if (!f.category) return "Pick a category to continue";
  if (hasUnfilledPlaceholders(f.description)) return PLACEHOLDER_BLOCK;
  if (contactLeakFieldError(f.title, "job title") || contactLeakFieldError(f.description, "job description"))
    return "Remove contact details to continue";
  return null;
}
