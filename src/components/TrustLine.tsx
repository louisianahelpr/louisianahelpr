import { REPLY_BUCKET_COPY, isNewMember, trustLineParts, useMemberTrust, type MemberTrust, type ReplyBucket, type TrustInputs } from "@/lib/trustLine";

/**
 * Q2478 (owner 2a/2b, 2026-10-29): the trust record as plain text under a Helpr's four profile tiles, e.g.
 * "12 jobs done · 92% on time · 3 repeat customers" and, when the server has a bucket, "Usually replies in
 * a few hours". Not a tile and not a button: a quiet line, so the four tiles stay exactly as they are.
 */
export function TrustLine({ stats, reply, className = "" }: { stats: TrustInputs; reply: ReplyBucket | null; className?: string }) {
  // Under 3 jobs the profile shows no record line at all (lead decision, 2026-10-29): its rating tile already says
  // "New", so a second "New" under the tiles says nothing. The reply speed still shows when the server has one.
  const isNew = isNewMember(stats);
  if (isNew && !reply) return null;
  return (
    <div data-trust-line className={`font-sans text-ds-13 leading-snug text-center ${className}`} style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
      {isNew ? null : <p>{trustLineParts(stats).join(" · ")}</p>}
      {reply ? <p data-reply-speed>{REPLY_BUCKET_COPY[reply]}</p> : null}
    </div>
  );
}

/**
 * The applicant card's form: one quiet line, the reply bucket on the end ("Usually replies in …", Q2478
 * item 4). Every card passes the SAME list of applicant ids, so React Query makes one request for the list
 * (the ids are sorted into the key) and each card reads its own row.
 */
export function ApplicantTrustLine({ helperId, helperIds }: { helperId: string; helperIds: string[] }) {
  const trust: Map<string, MemberTrust> = useMemberTrust(helperIds);
  const t = trust.get(helperId);
  if (!t) return null;
  // A new member's "New" sits right of their name (ApplicantNewTag, owner 2026-10-31 LEAD-APPLICANT-TAG), never
  // alone at the bottom of the card; the reply speed still shows here when the server has one.
  const parts = isNewMember(t.stats) ? [] : trustLineParts(t.stats);
  if (t.reply) parts.push(REPLY_BUCKET_COPY[t.reply]);
  if (!parts.length) return null;
  return (
    <p data-trust-line className="font-sans mt-0.5 leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
      {parts.join(" · ")}
    </p>
  );
}

/** "New" right of an applicant's name (owner 2026-10-31, LEAD-APPLICANT-TAG): the same rule and the same one read
 *  as ApplicantTrustLine, which no longer says it at the bottom of the card. */
export function ApplicantNewTag({ helperId, helperIds }: { helperId: string; helperIds: string[] }) {
  const t = useMemberTrust(helperIds).get(helperId);
  if (!t || !isNewMember(t.stats)) return null;
  return (
    <span data-new-tag className="shrink-0 rounded-full px-1.5 py-0.5 font-sans text-ds-11 font-semibold leading-none" style={{ background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))" }}>
      New
    </span>
  );
}
