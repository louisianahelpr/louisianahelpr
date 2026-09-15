/**
 * Which dispute evidence URLs the app will render as a link + image.
 *
 * Evidence is stored as strings a party supplied, and it renders in the admin
 * console and in the other party's dialog. Only this project's SIGNED
 * proof-photos object URLs are trusted (the bucket is private; that is the only
 * URL shape DisputeDialog and DisputeTimelineDialog ever store). Anything else —
 * an attacker host, a `javascript:` URL, a legacy value — is withheld and
 * counted, never rendered. The server-side twin is
 * public.dispute_evidence_url_ok (migration 20260915034822, section 8).
 */
export function isTrustedEvidenceUrl(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    return (
      u.protocol === "https:" &&
      u.origin === base.origin &&
      u.pathname.startsWith("/storage/v1/object/sign/proof-photos/") &&
      !u.pathname.includes("..")
    );
  } catch {
    // Not a parseable URL, so not a trusted one: withholding it IS the handling
    // (it is counted and shown as "not shown"), and a party's bad string is not
    // an app defect to report.
    return false;
  }
}

export function partitionEvidenceUrls(
  urls: readonly string[] | null | undefined,
  supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? "",
): { trusted: string[]; withheld: number } {
  const trusted: string[] = [];
  let withheld = 0;
  for (const url of urls ?? []) {
    if (typeof url === "string" && isTrustedEvidenceUrl(url, supabaseUrl)) trusted.push(url);
    else withheld++;
  }
  return { trusted, withheld };
}
