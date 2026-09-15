import { MapPin } from "lucide-react";

/**
 * The job's full street address, as text (VN-55, owner 2026-09-14: "they need
 * to be able to actually see the full address when the offer is sent to the
 * helpr, not just in the map").
 *
 * The card's meta row only ever prints the city, so an offered or hired Helpr
 * could read the address nowhere but the map pin. This line prints it. It adds
 * no access: `get_jobs_for_my_applications` returns the full `location` only
 * when `user_may_see_job_address` allows it (poster, hired Helpr, pending
 * direct offer, accepted application) and the masked city otherwise — so a
 * location with no street part renders nothing.
 */
export function hasStreetAddress(location: string | null | undefined): location is string {
  const first = (location ?? "").split(",")[0]?.trim() ?? "";
  return /\d/.test(first) && (location ?? "").includes(",");
}

export function JobAddressLine({ location }: { location: string | null | undefined }) {
  if (!hasStreetAddress(location)) return null;
  return (
    // `px-4` matches the card's other sections, so the pin lines up with the
    // meta row above instead of sitting on the card's category border.
    <p className="px-4 pt-2 pb-1 flex items-start gap-1.5 text-ds-13 leading-snug select-text" style={{ color: "hsl(var(--ink-deep))" }}>
      <MapPin className="w-3.5 h-3.5 shrink-0 mt-[3px]" aria-hidden style={{ color: "hsl(var(--olivewood))" }} />
      <span>
        <span className="sr-only">Job address: </span>
        {location.trim()}
      </span>
    </p>
  );
}
