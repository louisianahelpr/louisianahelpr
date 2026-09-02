// Only render image URLs whose scheme we control. Local previews are
// `blob:` (createObjectURL) and stored review photos are `https:` Supabase
// public URLs — anything else (e.g. a `javascript:`/`data:` value smuggled
// into a stored photo_urls row) is dropped rather than handed to the DOM.
export const safeImageSrc = (url: string): string | undefined => {
  try {
    const scheme = new URL(url, window.location.origin).protocol;
    return scheme === "blob:" || scheme === "https:" || scheme === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

export interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
  /**
   * May THIS reviewer tip the person they just reviewed?
   *
   * Only the poster can — `create-payment` action=tip refuses anyone else
   * outright ("Only the customer can tip the helper", create-payment:785).
   * The same form serves both directions, so without this flag a HELPER who
   * gave the poster 5 stars was shown "Send <poster> a tip?" and walked into
   * a dialog that can only fail, offering to pay money up the wrong side of
   * the marketplace. Defaults to false so a new mount cannot re-open that by
   * omission.
   */
  canTip?: boolean;
}

export type CategoryKey = "rating" | "punctuality" | "quality" | "communication";

export const CATEGORY_ROWS: { key: CategoryKey; label: string; sublabel: string; required: boolean }[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience", required: true },
  { key: "punctuality", label: "Punctuality", sublabel: "Showed up on time", required: false },
  { key: "quality", label: "Quality of work", sublabel: "Met expectations", required: false },
  { key: "communication", label: "Communication", sublabel: "Clear and responsive", required: false },
];

// Display reviews for a user
export interface ReviewListProps {
  userId: string;
}

export type Review = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  photo_urls?: string[] | null;
  reviewerName?: string;
};
