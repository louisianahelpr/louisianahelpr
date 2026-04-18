// Shared catalog of canned denial reasons used by:
// - AdminIDVQueue (quick-select chips)
// - stripe-idv-webhook (mapping Stripe failure codes)
// - AccountPending/AccountDenied "Fix It" UI

export type DenialReasonKey =
  | "blurry_photo"
  | "expired_id"
  | "selfie_mismatch"
  | "incomplete_profile"
  | "out_of_area"
  | "document_unsupported";

export interface DenialReasonMeta {
  key: DenialReasonKey;
  label: string;            // Short admin chip label
  userMessage: string;      // What the user sees ("here's how to fix it")
  canRetry: boolean;        // Show "Try Again" CTA?
}

export const DENIAL_REASONS: DenialReasonMeta[] = [
  {
    key: "blurry_photo",
    label: "Blurry Photo",
    userMessage:
      "We couldn't verify your identity — the photo of your ID was a bit blurry. Please try again with better lighting and hold the camera steady.",
    canRetry: true,
  },
  {
    key: "expired_id",
    label: "Expired ID",
    userMessage:
      "It looks like your ID is expired. Please upload a current, valid government-issued ID and try again.",
    canRetry: true,
  },
  {
    key: "selfie_mismatch",
    label: "Selfie Didn't Match",
    userMessage:
      "Your selfie didn't quite match the photo on your ID. Please retry in a well-lit area, facing the camera directly.",
    canRetry: true,
  },
  {
    key: "incomplete_profile",
    label: "Incomplete Profile",
    userMessage:
      "Your profile is missing some details. Please add a clearer profile photo and complete your 'About You' section, then resubmit.",
    canRetry: true,
  },
  {
    key: "document_unsupported",
    label: "Unsupported Document",
    userMessage:
      "The document you submitted isn't one we can accept. Please use a U.S. driver's license, state ID, or passport.",
    canRetry: true,
  },
  {
    key: "out_of_area",
    label: "Out of Service Area",
    userMessage:
      "Helpr currently only operates in select Louisiana parishes. We'll let you know as soon as we expand to your area — stay tuned!",
    canRetry: false,
  },
];

export const getDenialReason = (key: string | null | undefined): DenialReasonMeta | null => {
  if (!key) return null;
  return DENIAL_REASONS.find((r) => r.key === key) ?? null;
};

// Map raw Stripe Identity failure codes / reasons to a friendly key.
export const stripeReasonToKey = (raw: string | null | undefined): DenialReasonKey => {
  const r = (raw || "").toLowerCase();
  if (r.includes("expired")) return "expired_id";
  if (r.includes("selfie")) return "selfie_mismatch";
  if (r.includes("unsupported") || r.includes("type_not_supported")) return "document_unsupported";
  if (
    r.includes("blur") ||
    r.includes("unreadable") ||
    r.includes("image") ||
    r.includes("quality") ||
    r.includes("document_unverified_other")
  ) {
    return "blurry_photo";
  }
  return "blurry_photo"; // safest default — assume retryable image issue
};
