import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { TITLE_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";
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
export function detailsBlocker(f: { title: string; description: string; category: string | null | undefined }): string | null {
  if (!f.title.trim()) return "Add a Title to Continue";
  if (f.title.length > TITLE_MAX) return "Shorten the Title to Continue";
  if (!f.description.trim()) return "Add a Description to Continue";
  if (!f.category) return "Pick a Category to Continue";
  if (hasUnfilledPlaceholders(f.description)) return "Replace the [Placeholders] to Continue";
  if (contactLeakFieldError(f.title, "job title") || contactLeakFieldError(f.description, "job description"))
    return "Remove Contact Details to Continue";
  return null;
}
