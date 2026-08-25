// Profile-completion checklist — single source of truth, shared by the
// Profile landing hero meter, the Edit-Profile meter, and the Dashboard
// "finish your profile" banner.
//
// Two distinct jobs, deliberately split:
//
//  - `items` is the ACTIONABLE checklist — only the three genuine
//    post-signup enhancements (ZIP, ID verified, work photos). Profile
//    photo, name, phone, DOB, city, bio and the government-ID document
//    are all required at signup (Step 2), so listing them would clutter
//    the checklist with things every user already did.
//
//  - `pct` is the HONEST progress bar — it spans the core signup fields
//    (passed in via `core`) AND the three enhancements. A normally-
//    onboarded account therefore reads as mostly-complete and climbing,
//    never a discouraging "0%". (An earlier version counted only the
//    three enhancements, so a brand-new-but-fully-onboarded profile
//    showed 0% — the first thing a returning user saw on Profile.)
//
// Callers that don't have the core fields on hand can omit `core`; the
// percentage then spans the enhancements only (the legacy behaviour).

export interface ProfileCompletionItem {
  label: string;
  done: boolean;
}

export interface ProfileCompletion {
  /** Actionable post-signup enhancements — what the UI checklist lists. */
  items: ProfileCompletionItem[];
  /** Completed count across core + enhancements (matches `pct`). */
  done: number;
  /** Total count across core + enhancements (matches `pct`). */
  total: number;
  /** Overall completion percentage across core + enhancements. */
  pct: number;
  /** First incomplete *enhancement* label, or null when all are done. */
  nextLabel: string | null;
}

/**
 * Compute profile completion from whatever values the caller has on
 * hand. Accepts a loose input shape so the live Edit-Profile form can
 * pass in-progress field values while the read-only views pass the
 * saved profile row.
 */
export function getProfileCompletion(input: {
  zipCode?: string | null;
  idvStatus?: string | null;
  portfolioCount?: number;
  /**
   * Completion flags for the core fields signup already collects (name,
   * photo, bio, DOB, phone, city, ID doc). When supplied they count
   * toward `pct` so a finished signup doesn't read as 0%. Omit for the
   * enhancements-only percentage.
   */
  core?: boolean[];
}): ProfileCompletion {
  // The checklist was wrong on all three rows, so it is now empty by default.
  //
  //  • ZIP code is collected at SIGNUP, so listing it told an onboarded user to
  //    add something they already gave us. It now counts as a core field.
  //  • ID verification is gated at the first post or first accepted job — not
  //    a profile chore. Nagging for it on day one asks people to verify before
  //    they have decided to use the product, and made "Verify ID" look
  //    outstanding for accounts that will never need it.
  //  • Work photos are OPTIONAL. An optional extra must not sit in a list
  //    titled "Finish your profile" or count against a completion percentage —
  //    that is how a finished profile reported 70%.
  //
  // What is left is nothing, which is the honest answer for a normally
  // onboarded account: the card hides and the meter reads 100%. If a genuinely
  // required post-signup step is ever added, it goes here.
  const items: ProfileCompletionItem[] = [];

  // ZIP joins the core set: required at signup, so it belongs in the
  // percentage rather than the to-do list.
  const zipDone = !!input.zipCode && String(input.zipCode).trim().length > 0;
  const core = [...(input.core ?? []), zipDone];
  // `pct` / `done` / `total` span core + enhancements; `items` (the
  // visible checklist) stays scoped to the actionable enhancements.
  const enhancementsDone = items.filter((i) => i.done).length;
  const coreDone = core.filter(Boolean).length;
  const done = enhancementsDone + coreDone;
  const total = items.length + core.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  // "Next" always points at an actionable enhancement — never a core
  // field, which is satisfied at signup and absent from the checklist.
  const nextLabel = items.find((i) => !i.done)?.label ?? null;
  return { items, done, total, pct, nextLabel };
}
