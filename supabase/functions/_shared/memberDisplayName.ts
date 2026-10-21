/**
 * A member's name as another member may see it: "First L." (owner rule 2026-10-21: never a last name,
 * only its first letter). The same rule as formatName (src/lib/utils.ts) and the SQL helper
 * public.member_display_name (20261021061341_member_display_name.sql), for text an edge function writes
 * into a notification, push or email that another member reads (Q2292). Staff screens keep full names.
 */
export function memberDisplayName(fullName: string | null | undefined, fallback = "A neighbor"): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}.`;
}
