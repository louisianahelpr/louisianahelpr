// Profile-completion checklist — single source of truth, consumed by the
// Edit-Profile meter.
//
// ─── WHY THIS WAS REBUILT (owner, 2026-08-27: "make it count things that
//     vary") ───────────────────────────────────────────────────────────────
//
// The previous version counted eight fields: full_name, avatar_url, bio,
// date_of_birth, phone, location, id_document_url and ZIP. Its own comments
// asserted that all eight were "required at signup", concluded that the
// honest checklist was therefore empty, and shipped a progress bar that read
// 100% on every real account — a meter that could not meter, above an
// actionable list that was literally `[]`.
//
// The premise was half wrong, which is what made it unfixable in place.
// Walking the two real gates:
//
//   • Signup.tsx enforces first name, last name and date of birth. Avatar,
//     phone and bio are explicitly DEFERRED there ("keeps signup under a
//     minute"); city is not collected at signup at all.
//   • CompleteProfile.tsx — the required post-signup gate — enforces city,
//     bio (>= 20 chars) and profile photo, and explicitly does NOT require
//     the government ID ("Government-issued ID is intentionally NOT in the
//     required checklist").
//
// So the true mandatory set is: name, DOB, photo, bio, city. Every one of
// those is satisfied before an account can do anything, which is exactly why
// counting them pinned the bar at 100%.
//
// What is left over is genuinely optional, and that is what this now counts:
//
//   1. Phone number       — profiles.phone
//   2. ZIP code           — profiles.zip_code
//   3. Skills & services  — profiles.skills
//   4. Government ID      — profiles.id_document_url
//   5. Work photos        — profiles.portfolio_urls (at least one)
//
// Five items, UNWEIGHTED — 20% each. No weighting scheme, because none could
// be explained to a user in one sentence, and an unexplainable number is just
// a different flavour of the lie this replaced.
//
// ─── THE THREE RULES EACH ITEM OBEYS ─────────────────────────────────────
//
//  • OPTIONAL. None of the four is enforced by Signup or CompleteProfile
//    (see the walk above), so the number genuinely moves between accounts.
//
//  • REACHABLE. All four are edited on the Edit-Profile screen that renders
//    this meter, so every incomplete row scrolls to its own control via
//    `anchorId`. A checklist row you cannot act on is worse than no row.
//
//  • DOABLE NOW. Nothing here is earned history. Completed jobs and reviews
//    received are deliberately absent: the old Preview card counted "three
//    completed jobs" and "one review", which told the user to finish their
//    profile by waiting for a stranger to hire them.
//
// ─── DELIBERATELY EXCLUDED ───────────────────────────────────────────────
//
//  • Hourly rate (profiles.hourly_rate) — RETIRED 2026-08-27, not merely
//    unbuilt. The platform prices jobs poster-side, so a helper hourly rate
//    describes nothing the app charges on; every surface that rendered it has
//    been removed and Profile.tsx no longer writes it. The column still exists
//    because four RPCs select it, but it is not a profile field any more, so
//    it is not a completion item.
//    (Skills was excluded here for the opposite reason — it had no editor.
//    That editor was restored on the same date, so skills is item 3 above.)
//  • Intro video — the `profiles.intro_video_*` columns were dropped by
//    migration 20260827120000. There is no field to complete.
//  • Trade license / insurance (Credentials tab) — real, optional and
//    reachable, but trade-specific: a pet sitter has neither and never will,
//    so it would cap most accounts below 100% forever. That is precisely the
//    "a finished profile reported 70%" failure this file already learned.
//  • "Available now" (profiles.available_until) — a 4-hour toggle that
//    expires. A completed item that un-completes itself overnight is not
//    profile completion.
//  • ID *verification status* rather than the uploaded document — waiting on
//    a reviewer is not something the user can do right now, so item 3 counts
//    the upload, which is entirely in their hands.

export interface ProfileCompletionItem {
  /** Short row label, e.g. "Phone number". */
  label: string;
  /** One line saying what completing it buys the user. */
  hint: string;
  done: boolean;
  /** DOM id of the control on Edit Profile that completes this item. */
  anchorId: string;
}

export interface ProfileCompletion {
  /** All four optional items, complete and incomplete alike. */
  items: ProfileCompletionItem[];
  /** How many are done. */
  done: number;
  /** How many there are (5). */
  total: number;
  /** Percentage, 20% per item. */
  pct: number;
  /** First incomplete item, or null when everything is done. */
  next: ProfileCompletionItem | null;
}

/** DOM ids of the Edit-Profile controls each item scrolls to. */
export const PROFILE_COMPLETION_ANCHORS = {
  phone: "phone",
  zip: "zipCode",
  skills: "skills",
  idDocument: "id-verification-card",
  workPhotos: "work-portfolio-card",
} as const;

/**
 * Compute profile completion from whatever the caller has on hand. The live
 * Edit-Profile form passes in-progress field values; anything else can pass
 * the saved profile row.
 */
export function getProfileCompletion(input: {
  phone?: string | null;
  zipCode?: string | null;
  skills?: string | null;
  idDocumentUrl?: string | null;
  portfolioCount?: number;
}): ProfileCompletion {
  const items: ProfileCompletionItem[] = [
    {
      label: "Phone number",
      hint: "So posters can reach you about a job.",
      done: !!input.phone && input.phone.replace(/\D/g, "").length >= 10,
      anchorId: PROFILE_COMPLETION_ANCHORS.phone,
    },
    {
      label: "ZIP code",
      hint: "Places you in the right parish for nearby jobs.",
      done: !!input.zipCode && String(input.zipCode).trim().length > 0,
      anchorId: PROFILE_COMPLETION_ANCHORS.zip,
    },
    {
      label: "Skills & services",
      hint: "Decides which jobs get matched and sent to you.",
      // Comma-separated string; blank and "  ,  " both mean no skills.
      done: (input.skills ?? "").split(",").some((s) => s.trim().length > 0),
      anchorId: PROFILE_COMPLETION_ANCHORS.skills,
    },
    {
      label: "Government ID",
      hint: "Unlocks the Verified badge on your public profile.",
      done: !!input.idDocumentUrl,
      anchorId: PROFILE_COMPLETION_ANCHORS.idDocument,
    },
    {
      label: "Work photos",
      hint: "Posters hire the helpr whose work they can see.",
      done: (input.portfolioCount ?? 0) > 0,
      anchorId: PROFILE_COMPLETION_ANCHORS.workPhotos,
    },
  ];

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / total) * 100);
  const next = items.find((i) => !i.done) ?? null;
  return { items, done, total, pct, next };
}
