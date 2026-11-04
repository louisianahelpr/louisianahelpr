/* Shared by CredentialsTab and its CredentialCard (moved out of CredentialsTab.tsx unchanged, Q806). */

export type Kind = "license" | "insurance";

/**
 * A document the user has PICKED but not SENT. It lives only in this
 * component — nothing touches storage or `profiles` until "Send for review".
 *
 * Why client-only: the schema has no draft state to write to. `license_status`
 * is `CHECK (... IN ('none','pending','verified','rejected'))` and is column-
 * locked from the client by `prevent_self_escalation()`; the moment
 * `license_url` is written, the `trg_auto_pending_credentials` BEFORE UPDATE
 * trigger stamps 'pending' and the row appears in the admin queue
 * (`get_pending_credentials()`). So "attached but not submitted" cannot be
 * represented server-side without a data-model change — and it doesn't need to
 * be: an unsent attachment is exactly as durable as any other unsubmitted form
 * field, and we label it as such.
 */
export interface Draft {
  file: File;
  /** Object URL for image thumbnails only. Revoked on discard/unmount. */
  previewUrl: string | null;
}

/**
 * The one vocabulary for credential state on this screen. Each word appears in
 * exactly ONE place — the credential's own card — so the same fact can't be
 * phrased three ways in the same scroll. These are five DISTINCT states, not
 * synonyms:
 *
 *   off       — the user says this credential doesn't apply to them
 *   empty     — applies, but no document picked yet
 *   attached  — a document is picked and sitting on this device, NOT sent
 *   review    — sent; `<kind>_status = 'pending'`; in the admin queue
 *   verified  — admin approved it; the badge is live
 *   rejected  — admin looked and couldn't verify it; a new copy is needed
 */
export type CredState = "off" | "empty" | "attached" | "review" | "verified" | "rejected";

// Sentence-position nouns ("Your license is attached."). Insurance is
// "COI" — the card's own body copy introduces the acronym, and the long
// form truncated the view link at 375 ("View the insurance certificat…").
export const KIND_NOUN: Record<Kind, string> = {
  license: "license",
  insurance: "COI",
};
// Control-position nouns — buttons and links are Title Case.
export const KIND_NOUN_TITLE: Record<Kind, string> = {
  license: "License",
  insurance: "COI",
};

export const formatBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
