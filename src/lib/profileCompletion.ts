// Profile-completion checklist — single source of truth, shared by the
// Profile landing hero meter, the Edit-Profile meter, and the Dashboard
// "finish your profile" banner.
//
// Why only three items: profile photo, first/last name, phone, date of
// birth, city, bio (20+ chars) and the government-ID document are ALL
// required fields in the signup flow (Step 2). Every normally-onboarded
// account already has them — counting them would peg the meter at a
// meaningless ~70% for every user and never reflect what they still
// need to do. So the meter tracks only genuine post-signup
// enhancements:
//
//  - ZIP code     — signup collects city only, never a ZIP.
//  - ID verified  — signup uploads an ID *document*; the Stripe
//                   Identity check (idv_status) runs separately, later.
//  - Work photos  — the portfolio gallery is optional (signup Step 3).

export interface ProfileCompletionItem {
  label: string;
  done: boolean;
}

export interface ProfileCompletion {
  items: ProfileCompletionItem[];
  done: number;
  total: number;
  pct: number;
  /** First incomplete item's label, or null when fully complete. */
  nextLabel: string | null;
}

const IDV_DONE_STATUSES = ["verified", "pending", "processing", "manual_review"];

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
}): ProfileCompletion {
  const items: ProfileCompletionItem[] = [
    { label: "ZIP code", done: !!input.zipCode && String(input.zipCode).trim().length > 0 },
    { label: "ID verified", done: !!input.idvStatus && IDV_DONE_STATUSES.includes(input.idvStatus) },
    { label: "Work photos", done: (input.portfolioCount ?? 0) > 0 },
  ];
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  const nextLabel = items.find((i) => !i.done)?.label ?? null;
  return { items, done, total, pct, nextLabel };
}
